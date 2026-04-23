# Zoom Meeting SDK — Setup Guide

This guide covers the Zoom Marketplace configuration and Firebase secret setup for the
embedded Zoom Meeting SDK join flow.

It is intentionally scoped so Phase 1 does **not** over-configure the Zoom Marketplace.
Only do the work in the "Phase 1 — Required" section to ship the member beta. The
"Future-only" sections document what would be needed later for coach host-start and for
the native mobile dev-client; do not do that work yet.

---

## Context: how this fits with existing Zoom apps

GoArrive already uses two separate Zoom Marketplace apps. The Meeting SDK app is a
**third, distinct** Marketplace app — it does not replace either of the existing ones.

| Marketplace app | Purpose | Secrets in Firebase | Status |
|---|---|---|---|
| Server-to-Server OAuth | Meeting CRUD (create/update/cancel meetings, recordings) | `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_WEBHOOK_SECRET` | Live |
| General App (RTMS) | Real-Time Media Streaming (WebSocket transcripts) | `ZOOM_RTMS_CLIENT_ID`, `ZOOM_RTMS_CLIENT_SECRET`, `ZOOM_RTMS_SECRET_TOKEN`, `ZOOM_RTMS_OAUTH_REDIRECT` | Live |
| **Meeting SDK (new)** | **Signing embedded join payloads for the web client SDK** | **`ZOOM_MEETING_SDK_KEY`, `ZOOM_MEETING_SDK_SECRET`** | **To be created (Phase 1)** |

None of the existing app credentials can be reused for the Meeting SDK signature — Zoom
requires a Meeting SDK app type for that key/secret pair.

---

## Phase 1 scope (what we are actually shipping)

- Member beta only. Secondary "Join in app (beta)" entry point on `my-sessions.tsx`
  next to the existing "Join" button.
- The existing `Linking.openURL(inst.zoomJoinUrl)` flow stays in place and remains the
  default. Phase 1 does not remove or alter it.
- `role: 0` (attendee/participant) only. No host-start UI.
- Callable name (backend contract): `getEmbeddedSessionJoinConfig`. Intentionally broader
  than "signature" because the same callable will later return the shared join payload
  for web, native, and (future) coach host-start.
- Web only (runs inside the existing React Native Web build via the Zoom Web Meeting SDK
  Client View). Native mobile remains on `openURL` in Phase 1.

Phase 1 explicitly does **not** need:
- ZAK tokens (host-only; see "Future" below)
- OAuth redirect URIs on the Meeting SDK app
- Any additional Zoom API scopes

---

## Phase 1 — Required Zoom Marketplace setup

### 1. Create a Meeting SDK app

1. Sign in to `https://marketplace.zoom.us/` with the GoArrive Zoom admin account (same
   account used by the existing S2S OAuth and RTMS apps).
2. Develop → Build App → choose **Meeting SDK**.
3. App name: `GoArrive Meeting SDK` (internal; members never see this string).
4. Company: `GoArrive`. Contact: the current Zoom admin email.
5. On the **App Credentials** page, copy the values labeled `SDK Key` (a.k.a. Client ID)
   and `SDK Secret` (a.k.a. Client Secret). These are what the callable uses to sign
   the JWT payload.
6. **Scopes:** leave empty. Signature-only flows do not need scopes. Adding scopes here
   would force an OAuth install step that Phase 1 does not use.
7. **Redirect URL for OAuth:** leave blank. Not used for the signature flow.
8. **Embed → Meeting SDK:** leave defaults. (Phase 1 uses Client View only; Component
   View is not required.)
9. Activate the app.

### 2. Add the secrets to Firebase

From the repo root on a machine with Firebase CLI access:

```bash
firebase functions:secrets:set ZOOM_MEETING_SDK_KEY    --project goarrive-staging
firebase functions:secrets:set ZOOM_MEETING_SDK_SECRET --project goarrive-staging
firebase functions:secrets:set ZOOM_MEETING_SDK_KEY    --project goarrive
firebase functions:secrets:set ZOOM_MEETING_SDK_SECRET --project goarrive
```

Paste the SDK Key / SDK Secret when prompted. Both environments can use the same
Meeting SDK app credentials (Zoom does not require separate apps per environment for
signature generation).

### 3. Wire the secrets into the new callable

`getEmbeddedSessionJoinConfig` will declare these two secrets via `defineSecret(...)`
and include them in its `runWith({ secrets: [...] })` block. No other function needs
these secrets — the existing Zoom callables remain unchanged.

### 4. No allow-listing, no domain verification

The Meeting SDK signature flow does not require origin/domain allow-listing or domain
verification for Phase 1. The browser loads the Zoom Web Meeting SDK assets from
Zoom's CDN directly.

---

## ⚠️ ZAK is NOT required for Phase 1

Treat this as the single most common source of confusion: **ZAK tokens are only needed
to start a meeting as the host**. The Phase 1 beta is participant-only (`role: 0`), so
there is no ZAK in the Phase 1 callable response, and no ZAK fetch on the backend.

Do not let host-start be treated as a prerequisite for proving embedded participant
join. Shipping the member beta requires only the SDK Key + SDK Secret above.

`getEmbeddedSessionJoinConfig` may scaffold a `zak: string | null` field in its return
type so that host-start can be added later without a breaking change. That field stays
`null` in Phase 1. No coach-facing host-start UI ships in Phase 1.

---

## Future-only: coach host-start (do NOT do this for Phase 1)

When we later want coaches to start their own sessions from inside the app:

- Host-start requires a ZAK token for the host user. ZAK is retrieved from
  `GET /users/{userId}/token?type=zak` on the Zoom REST API.
- That endpoint needs the existing **Server-to-Server OAuth** app (`ZOOM_CLIENT_ID` /
  `ZOOM_CLIENT_SECRET` / `ZOOM_ACCOUNT_ID`) to have the `user:read:zak:admin` scope (or
  equivalent current Zoom scope for reading ZAK). That scope change happens on the
  **S2S OAuth app**, not on the Meeting SDK app.
- Only works for hosts that belong to the same Zoom account as the S2S app. For
  coaches with their own connected Zoom accounts (`coach_zoom_connections`), we will
  need to fetch ZAK via that coach's connection instead.
- The `getEmbeddedSessionJoinConfig` callable is the intended home for the host-start
  payload (`role: 1`, plus ZAK). Shape stays identical; only new fields fill in.

Do not add the ZAK scope in Phase 1. Adding a scope to a live S2S OAuth app forces a
re-authorization step in Zoom admin, which is unnecessary churn for a beta that does
not use the token.

---

## Future-only: native mobile dev-client (do NOT do this for Phase 1)

The Zoom Meeting SDK for React Native requires native modules and therefore an
**Expo dev client build** — it cannot run in Expo Go. When we later want native iOS/
Android embedded join:

- Add `@zoom/meetingsdk-react-native` (or successor package) and rebuild with EAS to
  produce a custom dev client.
- Configure iOS `Info.plist` entries (camera, microphone, local network) and Android
  permissions (`CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, bluetooth as needed).
- No additional Zoom Marketplace changes: the same **Meeting SDK app** (same SDK Key /
  SDK Secret) signs payloads for both web and native clients.
- The same `getEmbeddedSessionJoinConfig` callable serves both — the only difference is
  which SDK the frontend hands the payload to.

Until that dev-client rebuild lands, native mobile members continue using the existing
`Linking.openURL(zoomJoinUrl)` flow, which opens the Zoom app via the standard join URL.

---

## Verifying Phase 1 setup

Once secrets are set and the callable is deployed to staging:

1. On a session instance that already has a `zoomJoinUrl` (i.e., it has been allocated),
   call `getEmbeddedSessionJoinConfig({ sessionInstanceId })` from the web app.
2. Expected response shape (Phase 1):
   ```ts
   {
     meetingNumber: string;   // numeric meeting ID, stringified
     signature:     string;   // JWT signed with SDK Secret
     sdkKey:        string;   // the SDK Key (safe to send to client)
     userName:      string;   // member display name
     userEmail:     string;   // member email (optional per Zoom)
     password:      string;   // meeting password if set, else ""
     role:          0;        // Phase 1 is always 0
     zak:           null;     // reserved for future host-start
   }
   ```
3. From the "Join in app (beta)" button on `my-sessions.tsx`, the Web Meeting SDK should
   load, request mic/camera, and place the member into the meeting as an attendee.
4. The existing "Join" button (which calls `Linking.openURL(inst.zoomJoinUrl)`) must
   continue to work unchanged.

---

## Out of scope for this doc

- The callable's implementation (see `functions/src/index.ts` once landed)
- The web join page UI (`app/(member)/join/[sessionInstanceId].tsx`, Phase 1 step 3)
- RTMS transcript streaming (already covered by `zoomRtms.ts`)
- The existing meeting CRUD / allocation flow (already covered by `allocateSessionInstance`)
