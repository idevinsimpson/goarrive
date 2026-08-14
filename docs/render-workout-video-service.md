# Render workout video service

The Phase 2 renderer is a private **Cloud Run service**, not a Cloud Run Job.
Cloud Tasks sends an HTTP `POST` to the service and attaches a Google-signed
OIDC token. Cloud Run validates that token and the caller's `run.invoker` IAM
binding before the request reaches `lib/renderJob.js`.

This document is a runbook, not deployment authorization. Staging deployment
must still follow the repository release process; production requires explicit
approval.

## Runtime contract

- Service name: `render-workout-video`
- Region and Cloud Tasks queue location: `us-central1`
- Queue name: `render-workout-video`
- Container entry point: `node lib/renderJob.js`
- Request body: `{ workoutId, version, sourceHash }`
- `RENDER_SERVICE_URL`: the deployed default `https://*.run.app` service URL
- OIDC audience: the service **origin** (`https://service-...run.app`), without
  a route, query, or fragment
- Caller: a dedicated same-project service account supplied through
  `RENDER_TASK_INVOKER_SA`

The trigger rejects a missing, placeholder, non-HTTPS, or non-`run.app`
`RENDER_SERVICE_URL`. It does not fall back to a guessed endpoint or service
account.

## Staging provisioning outline

Use project-specific values in the authenticated staging environment:

```sh
PROJECT_ID="your-staging-project"
REGION="us-central1"
SERVICE="render-workout-video"
QUEUE="render-workout-video"
INVOKER_SA="render-workout-tasks@${PROJECT_ID}.iam.gserviceaccount.com"
TRIGGER_SA="your-functions-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/goarrive/${SERVICE}"
```

Create the dedicated task identity and queue once:

```sh
gcloud iam service-accounts create render-workout-tasks --project "$PROJECT_ID"
gcloud tasks queues create "$QUEUE" --location "$REGION" --project "$PROJECT_ID"
```

Build the repository's explicit Dockerfile, push the image, and deploy the
private service:

```sh
docker build -f docker/renderWorkoutVideo.Dockerfile -t "$IMAGE" .
docker push "$IMAGE"
gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --no-allow-unauthenticated \
  --set-env-vars "STORAGE_BUCKET=${PROJECT_ID}.firebasestorage.app"
```

After the service exists, grant only the dedicated task identity permission to
invoke it. The Firestore trigger runtime identity needs Cloud Tasks enqueue
permission and `iam.serviceAccounts.actAs` on that dedicated identity:

```sh
gcloud run services add-iam-policy-binding "$SERVICE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --member "serviceAccount:${INVOKER_SA}" \
  --role roles/run.invoker
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:${TRIGGER_SA}" \
  --role roles/cloudtasks.enqueuer
gcloud iam service-accounts add-iam-policy-binding "$INVOKER_SA" \
  --project "$PROJECT_ID" \
  --member "serviceAccount:${TRIGGER_SA}" \
  --role roles/iam.serviceAccountUser
```

Keep the Cloud Run service private; never grant `allUsers` invoker access.

Configure these non-secret environment values on the Firestore trigger before
deploying it:

```text
RENDER_SERVICE_URL=https://the-deployed-service-url.run.app
RENDER_TASK_INVOKER_SA=render-workout-tasks@your-staging-project.iam.gserviceaccount.com
RENDER_TASK_QUEUE=render-workout-video
RENDER_TASK_LOCATION=us-central1
```

## Durable media and read-time URLs

Firestore stores `renderedVideo.storagePath`, `version`, and `sourceHash`.
The path is immutable and versioned:

```text
gs://BUCKET/rendered-videos/WORKOUT_ID/vVERSION/SOURCE_HASH.mp4
```

Never persist a signed URL. The authenticated `resolveRenderedWorkoutVideo`
callable is the read-time boundary. It loads durable metadata from Firestore,
reconstructs the only valid object path from the default bucket, workout ID,
version, and source hash, then mints a V4 read URL that expires after 15
minutes. The returned object includes `expiresAt`; the client must resolve
again after that time rather than caching or persisting the URL.

The callable accepts `workoutId` and at most one access proof:

- no proof for the owning coach, a platform admin, or an authenticated coach
  reading a shared workout;
- `assignmentId` for the member who owns that exact workout assignment; or
- `sessionInstanceId` for the member whose pinned or current playbook workout
  is being played.

The assignment/session IDs are verified against trusted documents. A caller
cannot submit a storage path, bucket, URL, version, or source hash. Invalid or
cross-workout durable metadata is rejected before Storage is called. The
callable performs Firestore reads only and never writes the URL or credentials.

App code calls `resolveRenderedVideoForPlayback` immediately before activating
the continuous-video hook. Until a resolved response exists, the existing
segment player remains the safe fallback.

## Verification before activation

1. Run `npm run test:contract` and `npm run build` in `functions/`.
2. Confirm the build emits `functions/lib/renderJob.js` and does not emit a
   nested `functions/lib/functions/src/renderJob.js`.
3. Confirm the Cloud Run service denies unauthenticated requests.
4. Enqueue one staging task and verify its OIDC audience is the service origin.
5. Change the workout while a render is running and verify the older
   `{version, sourceHash}` cannot commit ready or failed state.
6. Call `resolveRenderedWorkoutVideo` as the owner, assigned member, and session
   member; verify each receives a URL with a 15-minute `expiresAt` value.
7. Repeat with a different member and a mismatched assignment/session; verify
   each request is denied before a Storage signature is minted.
8. Smoke-test playback through `resolveRenderedVideoForPlayback`. Do not deploy
   or test this flow against production without explicit authorization.
