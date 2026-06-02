# Placeholder Movements — Build Plan

**Status:** draft — direction approved by Devin 2026-06-02. Awaiting build sign-off.
**Author:** Maia (engine: Claude Code, Opus 4.7)
**Scope:** 4 phases, surgical. No core player rewrite, no media-system rewrite.

---

## 1. Goal

Allow coaches to create a usable Movement entry **without uploading a video yet**. The movement still has all the metadata (name, work/rest, audio cue, etc.), still appears in the workout picker, still plays inside the workout player — but the 4:5 media frame renders the GoArrive logo on a dark background instead of a looped video.

When the coach is ready, they can add the video later via an "Add Video" button in the edit view; the system reuses the existing upload → crop → derivative → AI pipeline. AI may suggest a refined title, but the coach must approve any title change.

---

## 2. Data shape (Firestore `movements`)

No schema migration required. `videoUrl`, `thumbnailUrl`, `gifLoopUrl`, `gifLowUrl`, `thumbnailImageUrl` are already optional in `MovementDetailData` (`apps/goarrive/components/MovementDetail.tsx:37-70`). Adding one new optional field:

```ts
// in MovementDetailData and the picker MovementOption
isPlaceholder?: boolean; // true if created without a video; flipped to false on successful video add
```

Behavior:
- New placeholder movements: `isPlaceholder: true`, `videoUrl: ''`, `thumbnailUrl: ''`, `gifLoopUrl: ''`, `gifLowUrl: ''`, `thumbnailImageUrl: ''`.
- Defensive UI: any movement with `isPlaceholder === true` **OR** `!videoUrl` is treated as a placeholder. (Belt-and-suspenders for older docs that pre-date the flag.)
- When add-video-later succeeds: set `isPlaceholder: false` in the same Firestore write that sets the new media URLs.

No Firestore Rules changes. `firestore.rules:258-266` only enforces `coachId` / `isGlobal` — nothing about video fields.

---

## 3. Files to touch

**Phase 1 (player fallback):**
- `apps/goarrive/components/WorkoutPlayer.tsx` — replace generic icon placeholder at lines 1226-1230; add `placeholderLogo` and `placeholderLogoFrame` styles near line 1846.

**Phase 2 (create-placeholder flow):**
- `apps/goarrive/components/MovementForm.tsx` —
  - `CreateStep` union add `'placeholder-meta'` (line ~141).
  - Upload-choice screen at lines 1221-1272 gets a third button: *"Create without video"* alongside *Camera* and *Library*.
  - New handler `startPlaceholderCreate()` that initializes state and jumps to a metadata form.
  - New render branch for `createStep === 'placeholder-meta'` showing the metadata form (reuses existing field components from edit mode at lines 192-220).
  - New save path that writes the doc with `isPlaceholder: true`, empty media URLs, then fires `generateMovementVoice(docId, name)` (same as existing line 615).
- `apps/goarrive/components/MovementDetail.tsx` — extend `MovementDetailData` interface with `isPlaceholder?: boolean` (line 37-70).

**Phase 3 (add-video-later):**
- `apps/goarrive/components/MovementForm.tsx` (edit mode) — when `movement.isPlaceholder === true || !movement.videoUrl`, show *"Add Video"* button in the edit view. Reuses existing `pickFromLibrary` / `recordFromCamera` / `processAfterCrop` / `generateAndUploadDerivatives` / `analyzeMovementMedia` pipeline.
  - On successful pipeline completion: write `isPlaceholder: false` + new media fields in the existing update path.
  - Pass the current movement name into `analyzeMovementMedia` as `existingName`.
  - If AI returns a different name with high confidence, show a confirm modal before overwriting; never silently rename.

**Phase 4 (AI hint):**
- `apps/goarrive/utils/analyzeMovementMedia.ts` — accept new optional `existingName?: string` argument; thread it through to the callable.
- `functions/src/index.ts` — `analyzeMovement` callable (line 7816-7930). Extend request shape to accept `existingName?: string`. When present, append to the system prompt: *"The user has already titled this movement '<X>'. Treat that as a strong hint. Confirm the existing name in your 'name' field unless you have high confidence the video shows a clearly different movement; in that case return your best name plus a high confidence score."* Coach-side confirmation handles any actual rename.

**Phase 2 badge (coach-facing list/picker only):**
- `apps/goarrive/components/WorkoutFolderPage.tsx` — picker card render needs a small *"Video needed"* pill when `m.isPlaceholder || !m.videoUrl`. Picker query already returns these (`apps/goarrive/components/WorkoutFolderPage.tsx:689-737` loads all non-archived movements; no `videoUrl` filter).
- Add the same pill on any coach-facing movements library list (verify location during build — likely a Movements tab page in `apps/goarrive/app/` or under Build tab; not the standalone WorkoutForm.tsx which is dead code per memory). Member-facing surfaces: never show this badge.

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
                    ├─→ Write Firestore doc with isPlaceholder: true,
                    │   videoUrl: '', thumbnailUrl: '', gifLoopUrl: '',
                    │   gifLowUrl: '', thumbnailImageUrl: '', cropScale: 1, etc.
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
                           isPlaceholder: false,
                           name: (confirmed-by-coach),
                           ...AI-merged metadata (only fields the coach hasn't manually edited),
                           updatedAt
                         }
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

This branch fires for any movement where the player ends up with no video AND no thumbnail. Today that's already the "broken movement" case (rare); with placeholders shipped it becomes the expected case for any movement created without media. **Same render path, no special-case branching for `isPlaceholder` in the player.**

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
- **R4 — Older movements without `isPlaceholder` field.** Defensive `!videoUrl` check handles legacy/edge docs. No backfill migration needed; the field is optional.
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
5. After save: `isPlaceholder` is now `false`, `videoUrl` populated, `thumbnailUrl` populated, "Video needed" badge gone from picker, banner gone from edit.
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

**Light update needed.** The blueprint's Movement / Build section currently implies a video-first creation flow. Add a one-line note under the relevant section:

> *Movements can be created without a video (placeholder mode) using `isPlaceholder: true`. The looped-video slot renders the GoArrive logo on a dark frame; voice cue is still generated from the name. Coach can add the video later via the edit view, which reuses the standard upload → crop → derivative → AI pipeline.*

Doc ID `1hn_B6u-LnC5yrpdj127wFtPLEbOOLkTefeIdt3Pgdmg`. I'll do this after Phase 2 ships (when the feature is real on staging), not before.

---

## 14. Operating Changelog entry plan

After each phase deploys to staging, append a row to the Operating Changelog (Doc id `1CCsZO3uYEfqpUDk...` — full id in `memory/goarrive_operating_changelog.md`):

- *Phase 1:* "Player fallback: GoArrive logo on dark frame for movements with no video/thumb. (`WorkoutPlayer.tsx`)"
- *Phase 2:* "Placeholder movements — coaches can create movements without a video. (`MovementForm.tsx`, `MovementDetail.tsx`, `WorkoutFolderPage.tsx`)"
- *Phase 3:* "Add-video-later flow on placeholder movements via edit mode. Reuses existing media pipeline. (`MovementForm.tsx`)"
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

1. **Phase 1** — Player fallback (1 file, ~20 LOC). Lowest risk; ship first so the logo render is in place before any placeholder movements exist.
2. **Phase 2** — Create-placeholder entry + badge (3 files). Coaches can now create placeholders; player handles them via Phase 1 fallback.
3. **Phase 3** — Add-video-later (1 file, reuses existing functions). Closes the loop.
4. **Phase 4** — AI `existingName` hint + rename confirm modal (3 files including the callable). Polish, not blocking.

Estimated effort: Phase 1 = ~1 hour, Phase 2 = ~3-4 hours, Phase 3 = ~2 hours, Phase 4 = ~2 hours including backend deploy. Total ~8-10 hours of focused coding plus testing/deploy cycles.

---

*End of build doc.*
