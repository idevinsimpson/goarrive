# Design target — the member product

Two kinds of image live here, and they must never be confused with one another.

| Folder | What it is | How it was made |
| --- | --- | --- |
| `before/` | **Real screenshots of the product as served today.** | Captured from the running app at `0dd6cdd`, the merge of `claude/wsf-ui-member-experience` @ `6b257c3` onto the app shell. |
| `targets/` | **Targets: where a page is going. Not implemented, not shipped.** | Rendered from real React Native components in `apps/westayfit/src/ui/designTarget/`, through a preview route that is gated off in any deployed build, and captured by `tests-e2e/design-target-capture.spec.ts`. |
| `owner-north-star/` | **The owner's two approved boards.** Open them before creating or implementing any target. | Supplied by the owner. |
| `superseded-html-concepts/` | The first attempt, as standalone HTML. **No longer the target.** | Kept as a record; its Home concept paints the whole page navy, which is an exploratory miss. |

## The rule these files exist to keep

**A target is never called an "after".**

An *after* is a screenshot of the product once a change has shipped. Nothing in
`targets/` is that, so every one of those images carries the words
`TARGET / CONCEPT — NOT IMPLEMENTED` across the top and again across the bottom,
burnt into the image rather than written in a caption that can be cropped away.
When real after-screenshots exist, they go in an `after/` folder beside these
and are captured the same way `before/` was — from the running app.

## The Living WE in these targets is the real one

The mark filling with green on the Home, short-viewport and confirmed targets is
the product's own monogram, loaded straight from
`apps/westayfit/assets/brand/derived/`. Its fill is not drawn by eye: the clip
height comes from the shipped area-calibration table that
`apps/westayfit/src/ui/livingWeCalibration.ts` reads, so the green *area* is the
true ratio rather than merely the green height.

| Fill | Clip height from the bottom |
| --- | --- |
| 36.9% | 43.55% |
| 39.3% | 45.49% |

An earlier draft of these targets replaced the WE with a generic progress ring.
That was wrong twice over: the Living WE is the product's signature instrument,
and it is already truthful — it is what the served Home renders today. The ring
is gone and the mark is back, giant.

## Why the targets are real React Native and not drawings

Because a drawing can promise something the product never becomes. A target
built from the real components against the real tokens cannot: if it renders,
it is buildable, and the eventual AFTER is a comparison between two things made
of the same material rather than between a photograph and a painting.

Tokens the boards need and the shipped kit does not have live in
`apps/westayfit/src/ui/designTarget/targetTokens.ts` — a brighter action green,
a display type tier, and the first shadow tokens this product has ever had.
They stay there rather than in `ui/kit.ts` until the page they exist for passes
its visual gate, so no approved screen moves because of an unapproved target.

The preview route that renders them, `app/design-target/home.tsx`, is gated on
`EXPO_PUBLIC_WSF_USE_EMULATORS`, which `scripts/westayfit/build-staging.sh`
refuses to build with. A deployed artifact serves a notice and never a target.

## What the sample data is, and what it is not

Every figure, name and timestamp is invented sample data. The targets hold to the
same truth constraints the product does:

- No names against contributions, and no way to tell who added what.
- No rankings, no comparison between people, no health claims.
- No invented faces and no unique-person counts.
- A member's own numbers are private to them; only the community total is shared.

Truth and privacy decide *what* a screen may show. They do not decide how it
feels, which is what these targets are about.

## Regenerating

Edit the components under `apps/westayfit/src/ui/designTarget/`, rebuild with
the emulator flag on, then run the capture spec:

```sh
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 \
  npm --prefix apps/westayfit run build:web
npx playwright test tests-e2e/design-target-capture.spec.ts
```
