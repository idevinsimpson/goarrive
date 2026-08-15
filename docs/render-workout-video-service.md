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

## Audio: the rendered video MUST carry a baked-in mix

**Device-verified 2026-08-14 on Devin's iPhone. Do not build against the earlier
"silent PiP video" assumption — it is disproven.**

The original continuous-video feasibility plan proposed rendering a **silent** video and
letting the page's existing audio (Mubert music + TTS voice cues) keep playing underneath
while the video floats in Picture-in-Picture. That does not work on iOS.

What the device test showed: entering PiP **stops the music**. The movement `<Video>` in
`WorkoutPlayer.tsx` is *always* `isMuted` (see the comment at `:294`, applied at `:1676`
and `:1722`) — it carries no audio track at all — and music still stopped. So iOS hands
the audio session to whatever element enters PiP **regardless of whether that element has
audio**, and suspends other page audio. This is platform behavior, not an application bug,
and no amount of keep-alive on our side changes it.

Consequences for this service:

- **Render the workout audio into the MP4.** A silent render guarantees silence in PiP,
  which is the exact scenario the feature exists to serve.
- **Bake one reference mix — do not render per-gain-bucket variants.** The volume-bucket
  system (`music_cache/<style>/gain_<pct>/`) exists so the in-app slider can control
  background loudness on iOS. In PiP the member is *outside the app* with only hardware
  volume, so the slider is not a control surface there. One mix at a sensible default
  level keeps a 40-minute render at ~44 MB instead of ~220 MB across five variants.
- **Open design question, decide before Phase 4 wiring:** in-app (not PiP) the player
  drives live audio through the Web Audio graph, where the slider works. If the rendered
  video also carries audio, playing it in-app would double the sound. The likely shape is
  video muted while in-app, unmuted on PiP entry, re-muted on exit — but the handoff seam
  needs the same care as the `useMusicHandoff` shadow swap, and iOS may not honor an
  unmute at PiP-entry time without a gesture. Prototype that seam before committing.

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

## Render throughput: what is measured, and where the headroom is

Recorded 2026-08-15. Devin's stated requirement is a **3-minute turnaround** from
coach edit to usable video. The naive pipeline does not come close; two
optimizations together plausibly do. Measured figures and projections are
labelled separately — do not quote a projection as a measurement.

### Measured

One real render: workout `Ny1Uz92tXN6LzUb3vT1x`, 8m40s of content, **250.5s** —
roughly **2× realtime**. A design-review estimate of 4–8× realtime predates this
and was wrong in the optimistic direction; it should not be quoted again.

Synthetic benchmark on identical 60s 1080×1920 input, using the real filter
chains from `renderFfmpeg.ts`:

```
Current settings   720x1440 canvas, 30fps, -preset fast, crf23   15.3s
PiP-grade          360x640 flat,    15fps, -preset veryfast      4.8s
Decode-only floor  same input, no encode                          2.1s
Output size        11.96 MB  ->  1.19 MB
```

**Encode alone is ~4.9× faster; total is only ~3.2×.** The 2.1s decode floor does
not move, because output settings change the output, not the input. That gap
widens in the real pipeline, which also pays source download, **one ffmpeg
process spawn per segment**, concat and faststart — none of which shrink.

### The headroom is repetition, not resolution

A workout is mostly the same content repeated. "Rick H - Legs + Chest & Back"
(`eiJ9oMt4AmA9MloCkfig`) is **86 segments across 2,500s** — 37 movement-video,
47 rest, 2 image — but only **12 unique movements**, because every block is
`N movements × 3 rounds`. Each movement is currently encoded three times for
byte-identical output.

This works **because the burned-in timer is segment-local**. `generateAss` emits
`${fmtTime(sec)} / ${totalWorkoutStr}` for movements and a local countdown for
rests — both restart per segment. Two instances of the same movement at the same
duration therefore produce an identical ASS file and identical encoded output.
Had the timer shown running workout-elapsed time, none of this would be possible.

The concat step is already `-c copy`, and **the concat demuxer accepts the same
file path multiple times** — so reuse costs nothing at stitch time. Key each
segment by `(sourceMedia, durationSec, type, label, totalWorkoutStr, geometry)`,
encode each unique key once, reference it N times.

*Projection, not measurement:* ~660s of unique content against a 2,500s timeline
is a **~3.8× reduction in encode work**, which compounds with the 3.2× above to
roughly 12× — landing this workout near 1.5–3 minutes.

### The edit case is what the requirement is actually about

A coach editing one movement should not re-render the whole workout. If segment
files are **content-addressed and cached in Storage**, an edit invalidates only
that movement's segments and everything else is a cache hit — a 60-segment
workout where one exercise changed re-encodes about four segments. Movements
shared across a coach's library warm the cache for each other.

**One design flaw would silently defeat that cache:** `totalWorkoutStr` is baked
into every movement overlay, so adding or removing a block changes the workout's
total duration, which changes *every* movement segment's overlay text and
invalidates everything — the exact edit a coach makes most often. **Drop
`/ total` from the burned-in overlay** (segment-local time only) before relying
on the cache. That single change is the difference between a cache that works and
one that looks fine until the first structural edit.

### Source selection

Download is the floor that output settings cannot touch, so it is worth attacking
directly. Movements carry `gifLowUrl` / `gifHighUrl` / poster / thumbnail
derivatives — **note these are GIFs and stills, not a low-resolution MP4**; there
is one H.264 `videoUrl`. On the Rick H workout **11 of 12** movements have
`gifLowUrl` populated.

**Hazard:** `Dumbbell Seated Bent Over Row` (`et9OHXhJJuKE1u321VWu`) has
`gifLowUrl` present **as an empty string**. Key the fallback on *truthiness*, not
on `in` or `!== undefined`, or ffmpeg receives an empty path — and fall back to
`videoUrl` rather than failing the segment.

Whether GIF decode actually beats MP4 decode is **unmeasured**; palettized GIF is
not automatically cheaper. The download saving is the real argument.

### Related open item

Stored `estimatedDurationMin` (47) disagrees with the computed segment sum
(41.7 min) on this workout. If the stored value feeds `totalWorkoutStr`, the
burned-in timer will disagree with the video's actual length by five minutes.
Dropping `/ total` per above resolves this and the cache problem together.
