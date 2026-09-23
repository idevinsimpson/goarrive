/**
 * THE PUBLIC DISPLAY'S TIERS. Display-only; nothing else imports this.
 *
 * `/display/[goalId]` is the only surface in this product whose VIEWING
 * DISTANCE is a variable rather than a constant. The same confirmed numbers
 * have to read at arm's length on a phone, across a hallway on a picture
 * frame, and across a hall on a 1920 — so the composition changes with the
 * room while the content does not.
 *
 * Until this file existed there was one boolean, `windowWidth >= 900`, and
 * everything below it got the phone card. That put an 800×1280 picture frame
 * on the phone composition with the phone's mark cap — 320px of instrument on
 * 800px of glass — and it left a 1920 rendering the booth's type, with
 * `min(640, 0.42 × width)` capping the mark at 33% of the screen where 1280
 * gets 42%.
 *
 * ── THE FLOOR IS THE WHOLE POINT ──────────────────────────────────────────
 *
 * A portrait tier keyed only on "taller than wide" would capture every phone
 * in existence, which is exactly what must not happen: the phone composition
 * is accepted, shipped and out of scope. So portrait requires BOTH a portrait
 * aspect AND at least `PORTRAIT_MIN_WIDTH` of width. 390×844 and 430×932 sit
 * below that floor and are untouched; an 800×1280 frame is above it.
 *
 * ── WHY WIDTH ALONE DECIDES THE WIDE TIERS ────────────────────────────────
 *
 * Booth and collective are both two-column landscape compositions that differ
 * only in scale, so the horizontal room is what separates them. 1280×800 and
 * 1440×900 stay exactly where they were, which is the regression guard the
 * release asked for; the new scale begins at `COLLECTIVE_MIN_WIDTH`, above
 * every viewport the existing suite exercises.
 */

export type DisplayTier = 'phone' | 'portrait' | 'booth' | 'collective';

/** Below this, a portrait aspect is a phone and keeps the phone composition. */
export const PORTRAIT_MIN_WIDTH = 600;

/** At and above this, the layout is wide: two columns on one axis. */
export const WIDE_MIN_WIDTH = 900;

/** At and above this, the wide layout is sized for a room rather than a booth. */
export const COLLECTIVE_MIN_WIDTH = 1600;

/**
 * The tier for a viewport.
 *
 * `hydrated` is not cosmetic. The static export renders with no window, so the
 * first client render has to produce the same tree the export did or React
 * reports a hydration mismatch and rebuilds from scratch (#418). The export's
 * tree is the phone one, so every tier decision waits for hydration — a wide
 * display shows the phone loading card for a single frame and then resolves.
 */
export function displayTier(width: number, height: number, hydrated: boolean): DisplayTier {
  if (!hydrated) return 'phone';
  if (width >= COLLECTIVE_MIN_WIDTH) return 'collective';
  if (width >= WIDE_MIN_WIDTH) return 'booth';
  if (width >= PORTRAIT_MIN_WIDTH && height > width) return 'portrait';
  return 'phone';
}

export function isWideTier(tier: DisplayTier): boolean {
  return tier === 'booth' || tier === 'collective';
}

/**
 * The width of the Living WE, per tier.
 *
 * ONE INSTRUMENT PER DISPLAY, and it has to grow with the room. The shipped
 * rule capped every wide screen at 640px, so a 1920 got a proportionally
 * SMALLER mark than a 1280 — the opposite of what distance needs. The cap is
 * now per tier, and the collective's is high enough that 1920 reads larger in
 * absolute and relative terms both.
 *
 * Phone is returned unchanged from the shipped expression on purpose: that
 * composition is accepted and this change must not move it by a pixel.
 */
export function displayWeWidth(tier: DisplayTier, width: number): number {
  switch (tier) {
    case 'collective':
      /*
        LARGER THAN THE BOOTH'S CAP, AND STILL INSIDE THE CANVAS.

        The first cut of this took 0.42 of the glass, as the booth does — 806px
        on a 1920. Together with the room's type that made the right column
        taller than 1080, and the display cannot scroll, so the recent list was
        clipped off the bottom. The instrument still grows with the room (760
        against the 640 the booth is capped at, 40% of the width against 33%),
        but not at the cost of losing a line of confirmed evidence.
      */
      return Math.min(760, Math.round(width * 0.4));
    case 'booth':
      // Untouched: the shipped expression, so 1280×800 and 1440×900 are
      // pixel-identical to what they render today.
      return Math.min(640, Math.round(width * 0.42));
    case 'portrait':
      // A frame is read from across a room but composed as one column, so the
      // mark takes a little over half the width rather than the phone's 320px
      // ceiling.
      return Math.max(320, Math.min(560, Math.round(width * 0.55)));
    case 'phone':
    default:
      return Math.max(96, Math.min(320, width - 2 * 20 - 2 * 22));
  }
}

/**
 * The type multiplier, per tier, applied to the WIDE size the display already
 * ships — not to the phone size.
 *
 * Portrait and the two wide tiers all use the distance typography as their
 * base, so one number per tier is enough and the length-tiering in
 * `displayTypeScale` keeps working untouched: a long goal title still steps
 * down through its own tiers first, and the room multiplier applies after.
 *
 * Booth is exactly 1. 1280x800 and 1440x900 therefore render the same type
 * they render today, which is the regression the release asked to be guarded.
 * Portrait is below 1 because a single 800px column is nearer the eye than a
 * booth's two columns are.
 */
export function displayTypeFactor(tier: DisplayTier): number {
  switch (tier) {
    case 'collective':
      // 1.3 rather than 1.45: the taller scale pushed the recent list off a
      // 1080 canvas that has no scroll. Measured by the containment assertion
      // in the responsive spec, not by eye.
      return 1.3;
    case 'portrait':
      return 0.8;
    case 'booth':
    case 'phone':
    default:
      return 1;
  }
}

/**
 * The freshness line's size, which is the one element that had no wide variant
 * at all: the pill saying a number is old rendered at 13px on a phone and at
 * 13px on a 1920, so the room could read the total but not the warning that it
 * had stopped being current.
 *
 * It is given its own function rather than the multiplier above because its
 * base is the phone size, not the wide one. Booth keeps 13 deliberately: the
 * release asked for 1280x800 to be guarded against regression, and the wide
 * canvas there is already tight enough that growing chrome could push a long
 * heading off it.
 */
export function displayFreshnessSize(tier: DisplayTier): number {
  switch (tier) {
    case 'collective':
      return 26;
    case 'portrait':
      return 22;
    case 'booth':
    case 'phone':
    default:
      return 13;
  }
}
