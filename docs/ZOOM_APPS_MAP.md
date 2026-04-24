# Zoom Marketplace Apps — Source of Truth

GoArrive integrates with three distinct Zoom Marketplace apps. They are **not** interchangeable — each has a different OAuth flow, different scopes, and different stored secrets. This doc exists so nobody re-points a Firebase secret at the wrong app (which has happened once, 2026-04-24).

For per-app setup steps, see also `ZOOM_RTMS_MARKETPLACE_SETUP.md` and `ZOOM_MEETING_SDK_SETUP.md`.

## Summary

- **S2S OAuth app** — Server-to-Server OAuth — Meeting lifecycle management — Firebase secret prefix `ZOOM_`
- **`GoArrive Maia`** (App ID `6BQnrNFJRsSTexu5Zy4Ybw`) — General App — RTMS (live audio + transcript) — Firebase secret prefix `ZOOM_RTMS_`
- **`General app 766`** — Meeting SDK App — Embedded join (web SDK) — Firebase secret prefix `ZOOM_MEETING_SDK_`

## 1. S2S OAuth app — meeting management

- **Purpose:** Create / list / delete Zoom meetings, fetch recording URLs. Cannot open RTMS WebSockets (RTMS requires a General app).
- **Code:** `functions/src/zoom.ts`, `manageZoomRoom`, `refreshRecordingUrl`.
- **Auth flow:** Server-to-Server OAuth (account-level, no user interaction).
- **Firebase secrets:** `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_WEBHOOK_SECRET_TOKEN`.
- **Webhook endpoint:** `zoomWebhook` Cloud Function — signature verified via HMAC-SHA256 with `ZOOM_WEBHOOK_SECRET_TOKEN`.

## 2. `GoArrive Maia` (App ID `6BQnrNFJRsSTexu5Zy4Ybw`) — RTMS

- **Purpose:** Real-Time Media Streaming — live audio + transcript capture from Zoom meetings via WebSocket.
- **Code:** `functions/src/zoomRtms.ts`, `zoomRtmsOauthCallback`, `zoomRtmsWebhook`, `startRtmsStream`.
- **Auth flow:** OAuth authorization code (user-level). Tokens stored in `zoom_tokens/{accountId}`.
- **Required scopes:** `meeting:read:meeting_audio`, `meeting:read:meeting_transcript` (only visible in Marketplace catalog once Zoom enables the RTMS feature flag at the account level).
- **Required events:** `meeting.rtms_started`, `meeting.rtms_stopped`, `meeting.ended`, `endpoint.url_validation` (CRC).
- **Firebase secrets:** `ZOOM_RTMS_CLIENT_ID`, `ZOOM_RTMS_CLIENT_SECRET`, `ZOOM_RTMS_SECRET_TOKEN`, `ZOOM_RTMS_OAUTH_REDIRECT`.
- **OAuth redirect URL:** `https://us-central1-goarrive.cloudfunctions.net/zoomRtmsOauthCallback`
- **Webhook endpoint:** `https://us-central1-goarrive.cloudfunctions.net/zoomRtmsWebhook`
- **Trial status:** Enrollment confirmed 2026-04-23 (claimed expiry 2026-07-31). Account-level feature flag pending as of 2026-04-24 — RTMS scopes/events not yet visible in our Marketplace catalog.

## 3. `General app 766` — Meeting SDK (embedded join)

- **Purpose:** Embedded Zoom Meeting SDK inside the GoArrive web app — lets members join sessions without leaving the app.
- **Code:** `functions/src/index.ts → getEmbeddedSessionJoinConfig` callable.
- **Auth flow:** Client-side SDK initialization with signed JWT from the callable.
- **Firebase secrets:** `ZOOM_MEETING_SDK_KEY`, `ZOOM_MEETING_SDK_SECRET`.
- **No webhook / no OAuth redirect** — the SDK handles session join via short-lived signed tokens.

## Rules

1. **Never cross-wire secrets between apps.** The Client ID for the S2S app will not work for RTMS. The SDK Key is not the same as an OAuth Client ID.
2. **Always verify secret ↔ Marketplace app match after setting.** Simplest check: `firebase functions:secrets:access ZOOM_RTMS_CLIENT_ID` and compare to the Marketplace app's Client ID field.
3. **Rotate after suspected exposure.** If a secret has ever been written into chat logs, task state, or CI logs, rotate it in the Marketplace and re-set in Firebase.
4. **RTMS scopes/events only appear after Zoom flips the account-level feature flag.** If you don't see `meeting:read:meeting_audio` in the scope picker, the flag isn't on — working around this is impossible from our side.
5. **The S2S OAuth app cannot open RTMS WebSockets.** It's a hard Zoom platform limit. RTMS strictly requires a General app.

## Maintenance

- Update this doc when adding a new Zoom app, changing a secret name, or when an app's ID / scopes / webhook URL changes.
- If you rotate a Marketplace Client Secret, always re-set the Firebase secret *and* redeploy the functions that consume it (functions read secret values at boot).
