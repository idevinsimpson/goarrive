/**
 * The figure a follow-along screen shows, drawn by this app.
 *
 * There is no movement video catalog in this repository, so the screen draws
 * rather than plays. Two poses per movement, alternated on the step's own
 * cadence, read as movement without claiming to be a demonstration of one.
 *
 * Drawn as an inline SVG data URI, the same technique `qr.ts` already uses, so
 * nothing is fetched: the picture is part of the page and appears the instant
 * the step does. That matters on an expo floor where the network is other
 * people's phones.
 *
 * Deliberately anonymous: a stick figure has no body type, no gender, no skin
 * and no age. It is a diagram of a shape, not a picture of a person anyone is
 * being asked to resemble.
 */

export type MovePose = 'start' | 'end';

/** The movements this module can draw. Anything else falls back to `generic`. */
export type MoveFigureKind = 'squat' | 'pushup' | 'reach' | 'step' | 'generic';

const NAVY = '#0B1F3A';
const GREEN = '#91CB7D';

/**
 * Which figure to draw for a unit. Falls back rather than failing: an unknown
 * activity still gets a moving figure, just a general one.
 */
export function figureKindFor(unit: string | null | undefined): MoveFigureKind {
  const u = (unit ?? '').trim().toLowerCase();
  if (!u) return 'generic';
  if (/squat|sit|chair|lunge/.test(u)) return 'squat';
  if (/push|press|plank/.test(u)) return 'pushup';
  if (/reach|stretch|arm|overhead|jack/.test(u)) return 'reach';
  if (/step|walk|mile|run|march|lap/.test(u)) return 'step';
  return 'generic';
}

/** One figure, as SVG body content. Coordinates are in a 100x120 box. */
function body(kind: MoveFigureKind, pose: MovePose): string {
  const head = (cx: number, cy: number) => `<circle cx="${cx}" cy="${cy}" r="9"/>`;
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;

  switch (kind) {
    case 'squat':
      return pose === 'start'
        ? head(50, 18) + line(50, 27, 50, 66) + line(50, 66, 38, 104) + line(50, 66, 62, 104) +
            line(50, 36, 34, 52) + line(50, 36, 66, 52)
        : head(50, 34) + line(50, 43, 50, 74) + line(50, 74, 32, 88) + line(32, 88, 34, 104) +
            line(50, 74, 68, 88) + line(68, 88, 66, 104) + line(50, 50, 30, 46) + line(50, 50, 70, 46);
    case 'pushup':
      return pose === 'start'
        ? head(24, 54) + line(33, 58, 78, 72) + line(36, 60, 36, 86) + line(70, 70, 70, 88) +
            line(78, 72, 92, 92)
        : head(24, 72) + line(33, 76, 78, 84) + line(36, 78, 36, 90) + line(70, 82, 70, 92) +
            line(78, 84, 92, 96);
    case 'reach':
      return pose === 'start'
        ? head(50, 20) + line(50, 29, 50, 74) + line(50, 74, 38, 106) + line(50, 74, 62, 106) +
            line(50, 40, 30, 56) + line(50, 40, 70, 56)
        : head(50, 26) + line(50, 35, 50, 76) + line(50, 76, 34, 106) + line(50, 76, 66, 106) +
            line(50, 42, 26, 22) + line(50, 42, 74, 22);
    case 'step':
      return pose === 'start'
        ? head(50, 20) + line(50, 29, 50, 70) + line(50, 70, 36, 104) + line(50, 70, 64, 104) +
            line(50, 40, 34, 58) + line(50, 40, 66, 58)
        : head(50, 20) + line(50, 29, 50, 70) + line(50, 70, 26, 96) + line(50, 70, 72, 100) +
            line(50, 40, 30, 30) + line(50, 40, 70, 58);
    default:
      return pose === 'start'
        ? head(50, 20) + line(50, 29, 50, 72) + line(50, 72, 38, 104) + line(50, 72, 62, 104) +
            line(50, 40, 32, 54) + line(50, 40, 68, 54)
        : head(50, 20) + line(50, 29, 50, 72) + line(50, 72, 34, 100) + line(50, 72, 66, 100) +
            line(50, 40, 28, 36) + line(50, 40, 72, 36);
  }
}

/** What every figure URI below is built on. Shared with `qr.ts` on purpose. */
const SVG_DATA_URI_PREFIX = 'data:image/svg+xml;utf8,';

/** The figure as plain SVG markup, drawn in the brand colours and nothing else. */
export function moveFigureSvg(input: {
  kind: MoveFigureKind;
  pose: MovePose;
  accent?: boolean;
}): string {
  const stroke = input.accent ? GREEN : NAVY;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" width="100" height="120" role="img">` +
    `<g fill="none" stroke="${stroke}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">` +
    body(input.kind, input.pose) +
    `</g></svg>`
  );
}

/**
 * The figure as a data URI carrying RAW markup — the form react-native-web's
 * `<Image>` needs.
 *
 * This is the same two-variant contract `qr.ts` already keeps, and it is not a
 * style choice: react-native-web percent-encodes an inline-SVG source itself,
 * so a pre-encoded URI arrives encoded twice, fails to load, and RNW then
 * renders no `<img>` at all — a blank box rather than a broken image. That is
 * exactly the bug this pairing exists to prevent, so a screen using `<Image>`
 * must call THIS function and never `moveFigureSvgDataUri`.
 */
export function moveFigureSvgDataUriRaw(input: {
  kind: MoveFigureKind;
  pose: MovePose;
  accent?: boolean;
}): string {
  return `${SVG_DATA_URI_PREFIX}${moveFigureSvg(input)}`;
}

/**
 * The same URI with the markup percent-encoded — the form a plain `<img src>`
 * needs, since the `#` in a brand colour would otherwise start a fragment and
 * truncate the drawing.
 *
 * Percent-encoded rather than base64 so the markup stays greppable in a DOM
 * snapshot and a test can assert what was drawn rather than that some picture
 * appeared.
 */
export function moveFigureSvgDataUri(input: {
  kind: MoveFigureKind;
  pose: MovePose;
  accent?: boolean;
}): string {
  return `${SVG_DATA_URI_PREFIX}${encodeURIComponent(moveFigureSvg(input))}`;
}

/**
 * What a screen reader is told. It names the shape and the moment, and makes
 * no claim about the person looking at it.
 */
export function moveFigureLabel(kind: MoveFigureKind, pose: MovePose): string {
  const shape: Record<MoveFigureKind, string> = {
    squat: 'a figure standing, then bending at the knees',
    pushup: 'a figure holding a plank, then lowering',
    reach: 'a figure with arms down, then reaching overhead',
    step: 'a figure standing, then mid-step',
    generic: 'a figure standing, then moving',
  };
  const moment = pose === 'start' ? 'first position' : 'second position';
  return `Diagram: ${shape[kind]} (${moment}).`;
}
