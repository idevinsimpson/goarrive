# Placeholder Movements — Build Plan

**Status:** draft — direction + refinements approved by Devin 2026-06-02. Phase 1 already shipped to staging (PR #111). Phase 2+ awaiting go-ahead.
**Author:** Maia (engine: Claude Code, Opus 4.7)
**Scope:** 4 phases, surgical. No core player rewrite, no media-system rewrite.

---

## 0. Core principles (Devin's refinements, 2026-06-02)

These principles override anything later in this doc if they conflict.

**P1 — Placeholder movements are standard movements without uploaded media yet.** They are not a separate movement type. There is no "draft" / "placeholder" / "real" trichotomy in the data model or in any UI code path. A movement is a movement; it may or may not have a video. The player, picker, workout builder, and members all treat them as full movements with a graceful media fallback.

**P2 — Use implicit `!videoUrl` as the truth source, not an explicit `isPlaceholder` flag (for now).** Adding an `isPlaceholder` boolean creates two possible drift states (`isPlaceholder=true` but video exists; `isPlaceholder=false` but video missing) and gives us two truth sources to keep in sync. Until a real query or UX need emerges that `!videoUrl` cannot serve, we don't add the flag. If/when we discover that need (e.g. coaches want to filter "video pending" movements at scale, or analytics need an explicit lifecycle state), we add `isPlaceholder` then with a one-shot backfill of `!videoUrl → isPlaceholder: true`. Defaulting to the simplest truth source.

**P3 — Phase 3 (add-video-later) is the actual product unlock; architect with it in mind from day one.** Phase 1 is visual polish. Phase 2 unlocks the create-without-video flow. Phase 3 is what lets coaches brain-dump movement ideas without interrupting workout-building momentum — it's the strategic win. Every Phase 2 decision (where the metadata form lives, how the save path writes, what fields default to what) should leave a clean handoff for Phase 3 to slot the video pipeline back in.

**P4 — Never silently rename a coach-created movement.** Coaches use shorthand naming AI will misinterpret. The coach's chosen title is intentional unless the coach explicitly accepts an AI suggestion via confirm modal.

**P5 — Do not fork the upload/processing pipeline.** Phase 3's add-video-later flow converges into the existing `upload → crop → derivatives → AI analysis → save` pipeline. The only difference is timing (after the movement already exists). No parallel pipeline, no duplicated code.

**P6 — Keep the member experience premium.** The placeholder media frame should feel intentional ("video coming soon"), not broken ("missing media"). The dark frame + GoArrive logo treatment achieves this; never expose words like "missing", "pending", "broken" to members.

**P7 — Movement libraries are coaches' IP.** Placeholders will become part of creative drafting workflow: capturing movement ideas, organizing future filming sessions, building workouts before media production. Treat them as valid first-class movements awaiting media, never as incomplete junk.

---

## 1. Goal

Allow coaches to create a usable Movement entry **without uploading a video yet**. The movement still has all the metadata (name, work/rest, audio cue, etc.), still appears in the workout picker, still plays inside the workout player — but the 4:5 media frame renders the GoArrive logo on a dark background instead of a looped video.

When the coach is ready, they can add the video later via an "Add Video" button in the edit view; the system reuses the existing upload → crop → derivative → AI pipeline. AI may suggest a refined title, but the coach must approve any title change.

---

## 2. Data shape (Firestore `movements`)

**No schema migration. No new fields. No new TypeScript interface field.** Per Principle P2, we use the implicit `!videoUrl` signal — no `isPlaceholder` flag is added in any phase of this build.

What the data looks like for a placeholder movement, created via Phase 2:
- `name`: coach-entered (required)
- All other metadata fields: coach-entered or defaulted (workSec=30, restSec=15, swapSides=false, etc. — same defaults the AI-create path uses today)
- `videoUrl`: `''` (empty string)
- `thumbnailUrl`: `''`
- `gifLoopUrl`: `''`
- `gifLowUrl`: `''`
- `thumbnailImageUrl`: `''`
- `cropScale`: 1, `cropTranslateX`: 0, `cropTranslateY`: 0, `cropFrameWidth`: 0, `cropFrameHeight`: 0 (defaults; rewritten by Phase 3 when a video is later cropped)
- `coachId`, `tenantId`, `isGlobal: false`, `isArchived: false`, `createdAt`, `updatedAt` — same as today
- `voiceUrl`, `voiceText`, `voiceName` — populated post-save by `generateMovementVoice(docId, name)` (same async pattern as today)

Truth source for "no media yet" everywhere in the app: `!movement.videoUrl` (or equivalently `movement.videoUrl === ''`). Use this single check for:
- Player render fallback (Phase 1 already ships this implicitly — the player just checks `videoLayers.length > 0 || activeThumbUrl`)
- Coach-only "Video needed" badge in picker + library (Phase 2)
- Edit-mode "Add Video" CTA (Phase 3)

`MovementDetailData` interface (`apps/goarrive/components/MovementDetail.tsx:37-70`) already has `videoUrl?: string | null` and `thumbnailUrl?: string | null` — no interface change needed in any phase.

No Firestore Rules changes. `firestore.rules:258-266` only enforces `coachId` / `isGlobal` — nothing about video fields.

If a future need arises to filter or query placeholder movements as a distinct cohort (e.g. coach analytics, batch "remind me to film these" workflows), revisit adding `isPlaceholder` then, with a one-shot backfill where `!videoUrl → isPlaceholder: true`. Not today.

---

## 3. Files to touch

**Phase 1 (player fallback) — SHIPPED to staging 2026-06-02 (PR #111):**
- `apps/goarrive/components/WorkoutPlayer.tsx` — generic icon placeholder at lines 1226-1230 replaced with GoArrive logo render; `placeholderLogo` and `placeholderLogoFrame` styles added near line 1846. *No `isPlaceholder` reference in the player; fallback is purely implicit on `videoLayers.length === 0 && !activeThumbUrl`.*

**Phase 2 (create-without-video flow):**
- `apps/goarrive/components/MovementForm.tsx` —
  - `CreateStep` union add a new step (e.g. `'no-video-meta'`) at line ~141.
  - Upload-choice screen at lines 1221-1272 gets a third button: *"Create without video"* alongside *Camera* and *Library*.
  - New handler `startNoVideoCreate()` that initializes state and jumps to the metadata form.
  - New render branch for the new step showing the metadata form (reuses existing field components from edit mode at lines 192-220).
  - New save path that writes the doc with empty media URLs (no flag) and immediately fires `generateMovementVoice(docId, name)` (same call site pattern as line 615).
- *No edit to `MovementDetail.tsx` interface.* `videoUrl?: string | null` already exists.

**Phase 3 (add-video-later — the strategic unlock):**
- `apps/goarrive/components/MovementForm.tsx` (edit mode) — when `!movement.videoUrl`, show *"Add Video"* button in the edit view. Reuses the existing `pickFromLibrary` / `recordFromCamera` / `processAfterCrop` / `generateAndUploadDerivatives` / `analyzeMovementMedia` pipeline. Per Principle P5, no parallel pipeline — the same code path runs; it just operates on a movement that already exists.
  - On successful pipeline completion: write the new media fields into the existing Firestore doc via the existing update path. *No `isPlaceholder` flag to flip — populating `videoUrl` IS the state transition.*
  - Pass the current movement name into `analyzeMovementMedia` as `existingName` (Phase 4 enables the backend support; until then it's harmlessly ignored).
  - If AI returns a different name with high confidence, show a confirm modal before overwriting (Principle P4). Never silently rename.

**Phase 4 (AI hint):**
- `apps/goarrive/utils/analyzeMovementMedia.ts` — accept new optional `existingName?: string` argument; thread it through to the callable.
- `functions/src/index.ts` — `analyzeMovement` callable (line 7816-7930). Extend request shape to accept `existingName?: string`. When present, append to the system prompt: *"The user has already titled this movement '<X>'. Treat that as a strong hint. Confirm the existing name in your 'name' field unless you have high confidence the video shows a clearly different movement; in that case return your best name plus a high confidence score."* Coach-side confirm modal handles any actual rename.

**Phase 2 badge (coach-facing list/picker only):**
- `apps/goarrive/components/WorkoutFolderPage.tsx` — picker card render needs a small *"Video needed"* pill when `!m.videoUrl`. Picker query already returns these (`apps/goarrive/components/WorkoutFolderPage.tsx:689-737` loads all non-archived movements; no `videoUrl` filter). `MovementOption` interface at line 150 must be extended with `videoUrl?: string | null` so the picker can read it (currently only carries `mediaUrl` + `thumbnailUrl`).
- Add the same pill on any coach-facing movements library list (verify location during build — likely a Movements tab page in `apps/goarrive/app/` or under Build tab; not the standalone `WorkoutForm.tsx` which is dead code per memory). Member-facing surfaces: never show this badge.

**Files explicitly NOT touched:**
- Player core timing, audio queue logic, `WorkoutPlayer` phase machinery
- `generateMovementVoice`, Voicemaker integration, OpenAI TTS code
- Stripe, Connect, billing, earnings caps
- Zoom apps, Meeting SDK
- Plan Builder pricing
- Bulk movement upload (`BulkMovementUpload.tsx`)
- Follow-along video flow
- Any unrelated `.tsx` files

---

## 4. UI copy

| Surface | Element | Copy |
|---|---|---|
| `MovementForm` upload-choice screen | Third button below Camera/Library | *Create without video* |
| `MovementForm` upload-choice screen | Helper subtext under that button | *You can add the video later — the movement will work in workouts now.* |
| `MovementForm` placeholder-meta header | Title | *Create movement (no video yet)* |
| `MovementForm` edit mode (placeholder) | Banner above metadata | *This movement has no video yet. Members will see the GoArrive logo until you add one.* |
| `MovementForm` edit mode (placeholder) | CTA button | *Add Video* |
| AI rename confirm modal | Title | *AI suggests a different name* |
| AI rename confirm modal | Body | *You named this "<existing>". The video looks like "<ai-suggested>". Keep your name or use the suggestion?* |
| AI rename confirm modal | Buttons | *Keep "<existing>"* (primary) / *Use "<ai-suggested>"* |
| Coach picker / list badge | Pill text | *Video needed* (small, neutral gray, not red) |

Slack-mrkdwn note: UI copy above is for the in-app React Native UI — no Slack rendering involved.

---

## 5. Placeholder creation flow

```
[Coach taps + on Movements] 
   └─→ MovementForm opens, createStep = 'upload'
        │
        ├─→ Camera   → existing flow (unchanged)
        ├─→ Library  → existing flow (unchanged)
        └─→ Create without video → startPlaceholderCreate()
              │
              ├─→ createStep = 'placeholder-meta'
              ├─→ Render metadata form (name required; everything else optional with current defaults)
              │   Fields: name, category, equipment, difficulty, muscleGroups,
              │           workSec (default 30), restSec (default 15),
              │           description, regression, progression, contraindications,
              │           swapSides, swapMode, swapWindowSec
              │
              └─→ [Coach taps Save]
                    │
                    ├─→ Write Firestore doc with empty media URLs:
                    │   videoUrl: '', thumbnailUrl: '', gifLoopUrl: '',
                    │   gifLowUrl: '', thumbnailImageUrl: '', cropScale: 1, etc.
                    │   (NO isPlaceholder flag — implicit !videoUrl is the state)
                    ├─→ Fire generateMovementVoice(docId, name) (non-blocking, same as today)
                    └─→ Close MovementForm, return to Movements list
```

The new flow shares **zero** infra with the video pipeline — no upload, no crop, no `generateAndUploadDerivatives`, no `analyzeMovementMedia`. Just a metadata write + voice cue generation.

---

## 6. Add-video-later flow

```
[Coach opens placeholder movement in edit mode]
   └─→ Banner: "This movement has no video yet…" + [Add Video] button
        │
        └─→ [Coach taps Add Video]
              │
              ├─→ existing pickFromLibrary OR recordFromCamera dialog
              ├─→ video uploads → setVideoUrl(downloadUrl)
              ├─→ createStep = 'crop' (existing VideoCropModal)
              │
              └─→ [Coach confirms crop]
                    │
                    ├─→ processAfterCrop(crop)   ← existing pipeline
                    │   ├─→ generateAndUploadDerivatives → gifHighUrl, gifLowUrl, thumbnailImageUrl
                    │   └─→ analyzeMovementMedia(videoUrl, crop, { existingName: movement.name })
                    │
                    ├─→ If AI returns differing name with confidence ≥ 0.7:
                    │       show AI rename confirm modal
                    │       coach picks: existing OR ai-suggested
                    │
                    └─→ Firestore update:
                         {
                           videoUrl, thumbnailUrl, thumbnailImageUrl, gifLowUrl, gifLoopUrl,
                           cropScale, cropTranslateX, cropTranslateY, cropFrameWidth, cropFrameHeight,
                           name: (confirmed-by-coach),
                           ...AI-merged metadata (only fields the coach hasn't manually edited),
                           updatedAt
                         }
                         (Populating videoUrl IS the state transition — no flag flip needed.)
                         Then trigger generateMovementVoice if the name changed.
                         Then trigger analyzeMovementReps for one-rep loop GIF (existing behavior).
```

Coach-edit-wins merge rule for AI metadata: for each AI-returned field (category, equipment, muscleGroups, description, regression, progression, contraindications, workSec, restSec), only overwrite if the existing field is empty/default. Coach's manual edits are sacred.

---

## 7. AI `existingName` behavior

Backend (`functions/src/index.ts` `analyzeMovement` callable, line 7816-7930):

- Request shape gains `existingName?: string` (optional).
- When provided and non-empty, append to the system prompt:

  > *Additional context:* The user has already titled this movement "**<existingName>**". Treat that as a strong hint about what the movement is. Return that same name in your "name" field unless you have high confidence (≥ 0.85) that the video clearly shows a different movement, in which case return your best name and set confidence accordingly. Do not invent a new name out of stylistic preference — only override when the existing name is clearly wrong.

- All other prompt content unchanged. Return shape unchanged.

Client side (`apps/goarrive/utils/analyzeMovementMedia.ts`):
- Add optional `options?: { existingName?: string }` arg on `analyzeMovementMedia`.
- Pass through to the callable payload.

Rename decision:
- If `analysis.name === existingName` (case-insensitive, trim) → no prompt, silent merge.
- If `analysis.name !== existingName` AND `analysis.confidence >= 0.7` → show confirm modal; coach decides.
- If `analysis.name !== existingName` AND `analysis.confidence < 0.7` → keep existing name, don't even prompt (low-confidence rename suggestions are noise).

---

## 8. Player fallback render (Phase 1)

Current chain in `apps/goarrive/components/WorkoutPlayer.tsx:1180-1230`:

1. `videoLayers.length > 0` → render Video
2. else `activeThumbUrl` → render Image
3. else → `<View style={[st.videoPlayer, st.videoPlaceholder]}><Icon name="play-circle" .../></View>` (generic gray)

New chain — replace step 3:

```tsx
) : (
  <View style={[st.videoPlayer, st.placeholderLogoFrame]}>
    <Image
      source={require('../assets/goarrive-icon.png')}
      style={st.placeholderLogo}
      resizeMode="contain"
    />
  </View>
)
```

New styles near line 1846:

```ts
placeholderLogoFrame: {
  justifyContent: 'center',
  alignItems: 'center',
  backgroundColor: '#0E1117',
},
placeholderLogo: {
  width: '60%',
  height: '60%',
  opacity: 0.65,
},
```

The 4:5 frame is already enforced by `mediaInnerSize` (line 191-207) — no aspect-ratio work needed. Logo asset `apps/goarrive/assets/goarrive-icon.png` already has a near-matching dark navy background baked in, so the visual effect is a clean dark frame with the GoArrive G➲A symbol centered at ~60% width, subtle opacity.

This branch fires for any movement where the player ends up with no video AND no thumbnail. Today that's already the "broken movement" case (rare); with placeholders shipped it becomes the expected case for any movement created without media. **Same render path — the fallback is purely implicit on absence of media; no flag and no special-case branching anywhere in the player.** This aligns with Principle P1 (placeholders are standard movements) and P2 (implicit `!videoUrl` truth source).

---

## 9. Logo asset

**Decision:** `apps/goarrive/assets/goarrive-icon.png` (103 KB, square format, dark navy background already baked in).

Alternatives considered and rejected:
- `apps/goarrive/assets/logo.png` / `logo-header.png` — wide wordmark, bad fit for 4:5 frame
- `apps/goarrive/assets/logo-icon-raw.png` — same composition as `goarrive-icon.png` but on transparent/white bg; would need extra styling for the dark backdrop

There is currently **no pure G➲A abs symbol** (without "Arrive" wordmark) in the assets directory. If you decide later you want a symbol-only treatment, that's a design ask — drop it into `apps/goarrive/assets/` and swap the `require()` path in `WorkoutPlayer.tsx`.

---

## 10. Risks

- **R1 — Picker thumbnail rendering with no media.** Picker enrichment at `WorkoutFolderPage.tsx:778-794` only sets `thumbnailUrl` if found; placeholder movements will have empty `thumbnailUrl`. Confirm during build that the picker cell renders cleanly with no thumbnail (likely a fallback already; verify with a placeholder movement on staging).
- **R2 — Workout demo phase audio.** Recent commits (7dcd1cb, fd9b6a5, 62206f0, 18e3fe4) hardened demo-phase audio. Placeholder movements still get `voiceUrl` from `generateMovementVoice`, so this should be unchanged — but worth a quick demo-phase regression check on staging.
- **R3 — AI rename UX trap.** If we show the confirm modal too often, coaches will rage-tap "keep existing" reflexively. The confidence ≥ 0.7 floor for *showing* the modal is the guardrail; if it's still noisy in practice, bump the floor to 0.85.
- **R4 — Existing "broken" movements with no media.** Any pre-existing movements with empty `videoUrl` (rare edge cases — failed uploads, manually-created docs) will now render the new logo fallback instead of the gray icon. This is a strict improvement, but worth a one-time scan during Phase 2 staging to make sure no surprises emerge.
- **R5 — Coach-facing badge on member-facing surfaces.** Easy to leak into a shared component. Guard rule during build: badge component lives next to the picker; never imported by workout player or member screens.
- **R6 — Web Speech fallback voice audio quality.** If `generateMovementVoice` fails for a placeholder, the player will fall back to Web Speech reading the name — same as today's behavior, but more likely to surface since placeholders rely on the name being the entire audio context. Mitigation: the post-save voice fire is already best-effort; coach can manually re-trigger by editing the name.

---

## 11. Staging test plan (for Manus)

Goal: confirm placeholder movements work end-to-end as a normal-feeling movement in the workout experience, with the logo render and no regressions.

Test environment: staging Hosting preview channel — `goarrive--staging-gurfzjak.web.app`. Single Firebase project `goarrive`; no separate staging project.

**Sign in as:** a coach account (Manus has existing dashboard auth).

**Test 1 — Create placeholder movement**
1. Build tab → Movements → +
2. Tap *Create without video*
3. Fill: name = "Test Placeholder Squat", workSec = 30, restSec = 15, leave everything else default
4. Save
5. *Expected:* Movement appears in the Movements list. Coach sees a small "Video needed" pill on its card. No errors in console. Voice cue MP3 generated within ~15s (poll Firestore `movements/{id}.voiceUrl` until set).

**Test 2 — Use placeholder in a workout**
1. Build tab → new Workout → add Block → add Movement → pick "Test Placeholder Squat"
2. Save workout
3. Play the workout (coach preview mode)
4. *Expected:* During the placeholder movement's work and rest phases, the 4:5 frame shows the GoArrive logo on dark navy background, centered, subtle opacity. Audio cue (voiceUrl MP3 or Web Speech fallback) reads "Test Placeholder Squat". Timer / phases / next-up panel all work normally. No layout glitches.

**Test 3 — Add video later**
1. Open "Test Placeholder Squat" in edit mode
2. *Expected:* "This movement has no video yet…" banner + *Add Video* button visible.
3. Tap *Add Video* → pick any sample video → crop → confirm
4. *Expected:* Standard processing UI runs (thumbnails / AI analysis / saving). If AI returns a different name with high confidence, the rename confirm modal appears.
5. After save: `videoUrl` populated, `thumbnailUrl` populated, "Video needed" badge gone from picker, banner gone from edit. (No flag to inspect — the populated `videoUrl` IS the state.)
6. Play the workout again — the 4:5 frame now shows the looped video.

**Test 4 — AI rename guardrails**
1. Edit a placeholder movement named "Barbell Back Squat" and add a video of a clear dumbbell lateral raise.
2. *Expected:* AI returns "Dumbbell Lateral Raise" with high confidence → confirm modal shows. Coach picks "Keep 'Barbell Back Squat'" → name stays. Reopen → name still "Barbell Back Squat".

**Test 5 — No regression on standard (video-first) movements**
1. Create a normal movement via Camera or Library (existing flow).
2. *Expected:* Identical behavior to today — no new banner, no badge, no layout change.

**Test 6 — Member-facing surface check**
1. Sign in (or impersonate) as a member with access to a coach-shared workout that contains a placeholder movement.
2. *Expected:* Workout plays. Placeholder logo renders during the movement. **No "Video needed" badge anywhere member-visible.**

Manus reports: pass/fail per test, screenshots of any unexpected layout, console errors, Firestore doc snapshot for the test movement.

---

## 12. Firestore rules

**No changes.** `firestore.rules:258-266` `match /movements/{movementId}` enforces `coachId` ownership / `isGlobal` read; nothing about media fields. Placeholder movements are created with `coachId: coachId`, `isGlobal: false`, `isArchived: false` — passes existing rules.

---

## 13. V3.2 Blueprint update

**Light update needed.** The blueprint's Movement / Build section currently implies a video-first creation flow. Add a short note under the relevant section:

> *Movements are standard regardless of whether a video has been uploaded yet. A movement with empty `videoUrl` plays normally in workouts — the player renders the GoArrive logo on a dark frame in place of the looped video, and the voice cue is generated from the name. Coaches can add the video later via the edit view, which reuses the standard upload → crop → derivative → AI pipeline. There is no separate "placeholder" data type; `!videoUrl` is the implicit signal.*

Doc ID `1hn_B6u-LnC5yrpdj127wFtPLEbOOLkTefeIdt3Pgdmg`. I'll do this after Phase 2 ships (when the feature is real on staging), not before.

---

## 14. Operating Changelog entry plan

After each phase deploys to staging, append a row to the Operating Changelog (Doc id `1CCsZO3uYEfqpUDk...` — full id in `memory/goarrive_operating_changelog.md`):

- *Phase 1:* "Player fallback: GoArrive logo on dark frame for movements with no video/thumb. (`WorkoutPlayer.tsx`) — PR #111, staging-verified"
- *Phase 2:* "Create-without-video flow — coaches can create movements with metadata only; `!videoUrl` is the implicit state. (`MovementForm.tsx`, `WorkoutFolderPage.tsx`)"
- *Phase 3:* "Add-video-later flow via edit mode — reuses existing upload/crop/derivative/AI pipeline; populating `videoUrl` is the state transition. (`MovementForm.tsx`)"
- *Phase 4:* "`analyzeMovement` accepts `existingName` hint; coach confirms any AI-suggested rename. (`functions/src/index.ts`, `analyzeMovementMedia.ts`, `MovementForm.tsx`)"

Each row notes shipped PR(s), staging verification, follow-ups. Production deploy entries land separately after Devin's explicit go-ahead.

---

## 15. Guardrails (copy of Devin's direction, 2026-06-02)

- Do not touch WorkoutPlayer core timing, audio queue, Voicemaker, Stripe, Zoom, Plan Builder pricing, or unrelated movement/workout flows.
- Do not make this a full media-system rewrite.
- Do not require video for movement creation.
- Do not silently rename coach-created movement titles.

---

## 16. Phase ordering and ship cadence

Ship strictly in order. Each phase: PR → staging deploy → Manus test pass → Devin go-ahead → production deploy. Standard 9-step ship checklist applies per phase.

1. **Phase 1** — *SHIPPED 2026-06-02 (PR #111).* Player fallback, 1 file, ~14 LOC code change. Logo render is in place before any movements-without-video exist.
2. **Phase 2** — Create-without-video entry + coach badge (2 files: `MovementForm.tsx`, `WorkoutFolderPage.tsx`). Coaches can now create movements with metadata only; the player handles them via Phase 1's fallback. Architect the new step + save path with Phase 3 in mind so the edit view drops cleanly in next.
3. **Phase 3** — Add-video-later (1 file: `MovementForm.tsx`, reuses all existing pipeline functions). The strategic unlock — closes the loop and enables the creative drafting workflow (Principle P3, P7).
4. **Phase 4** — AI `existingName` hint + rename confirm modal (3 files including the `analyzeMovement` callable + backend deploy). Polish on top of Phase 3, not blocking.

Estimated effort: Phase 1 = done. Phase 2 = ~3-4 hours, Phase 3 = ~2 hours, Phase 4 = ~2 hours including backend deploy. Remaining ~7-8 hours of focused coding plus testing/deploy cycles.

---

*End of build doc.*
