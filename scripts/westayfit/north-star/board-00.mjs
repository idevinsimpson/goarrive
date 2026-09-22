/**
 * BOARD 00 — BRAND FOUNDATION.
 *
 * Reconstructed from its lock verdict, PR #365 comment 5770785512, which made
 * this board "the governing visual constitution for Boards 01–17". Every panel
 * below exists because that verdict names it, and the two revision holds that
 * preceded it (`5770746420`, `5770764323`) say what must NOT appear.
 *
 * Nothing here is invented. Where the lock did not settle a detail, the detail
 * is absent rather than guessed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const BRAND = path.join(REPO, 'apps/westayfit/assets/brand/derived');

const asset = (f) => pathToFileURL(path.join(BRAND, f)).href;

/* ── the real calibration, not a re-derivation ────────────────────────────
   The same JSON `livingWeCalibration.ts` requires at runtime. The fill height
   for a ratio is read from it here exactly as `heightFractionForFill()` reads
   it in the product, interpolation included — so the green AREA on this board
   is the green area the instrument paints. */
const calibration = JSON.parse(
  readFileSync(path.join(BRAND, 'living-we-calibration.json'), 'utf8')
);

function heightFractionForFill(ratio) {
  const table = calibration.heightFractionByFill;
  const steps = calibration.steps;
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  if (ratio >= 1) return 1;
  const pos = ratio * steps;
  const lo = Math.floor(pos);
  const hi = Math.min(steps, lo + 1);
  const t = pos - lo;
  return table[lo] + (table[hi] - table[lo]) * t;
}

export const LIVING_WE_ASPECT = calibration.width / calibration.height;

/* ── locked palette ──────────────────────────────────────────────────────── */
const NAVY = '#0B1F3A';
const CREAM = '#F7F5F0';
const SURFACE = '#FFFFFF';
const PROGRESS_GREEN = '#91CB7D';
const ACTION_GREEN = '#22C55E';
const INK_QUIET = '#6B7C93';
const TEXT_MUTED = '#5A6B85';
const HAIRLINE = '#E6E2DA';
const ON_NAVY_MUTED = 'rgba(247,245,240,0.76)';
const ON_NAVY_RULE = 'rgba(247,245,240,0.16)';

/**
 * One Living WE.
 *
 * `ratio === null` means NO DENOMINATOR, and the lock is explicit: the
 * instrument is ABSENT, not empty. A blank mark still asserts 0%, which is
 * false when there is nothing to be 0% of — the earlier revision drew a grey
 * WE beside the words "Living WE not shown" and was held for exactly that.
 */
function livingWe({ ratio, width, surface }) {
  const h = Math.round(width / LIVING_WE_ASPECT);
  const unfilled = surface === 'dark' ? 'monogram-unfilled-white.png' : 'monogram-unfilled-navy.png';
  if (ratio === null) {
    return `<div class="we-absent" style="width:${width}px;height:${h}px">
      <span>no instrument</span>
    </div>`;
  }
  const clipped = Math.min(1, Math.max(0, ratio));
  const fillPx = heightFractionForFill(clipped) * h;
  return `<div class="we" style="width:${width}px;height:${h}px">
    <img class="we-base" src="${asset(unfilled)}" alt="">
    <div class="we-clip" style="height:${fillPx.toFixed(2)}px">
      <img class="we-fill" src="${asset('monogram-fill-green.png')}"
           style="width:${width}px;height:${h}px" alt="">
    </div>
  </div>`;
}

/* The states the lock names, in the order it names them. */
const STATES = [
  { key: 'empty', ratio: 0, label: '0 of 500', note: 'unfilled silhouette' },
  { key: 'building', ratio: 241 / 500, label: '241 of 500', note: '48.2% · area-calibrated' },
  { key: 'near', ratio: 461 / 500, label: '461 of 500', note: '92.2% · near goal' },
  { key: 'reached', ratio: 1, label: '500 of 500', note: '100% · fully filled' },
  { key: 'overshoot', ratio: 515 / 500, label: '515 of 500', note: '103% · numbers keep the overshoot' },
  { key: 'no-goal', ratio: null, label: 'no goal', note: 'no denominator' },
];

const TYPE_SCALE = [
  ['Display XL', '40 / 44'],
  ['Display LG', '34 / 38'],
  ['Display MD', '29 / 33'],
  ['Heading', '28 / 34'],
  ['Subheading', '18 / 24'],
  ['Body', '16 / 22'],
  ['Caption', '13 / 18'],
];

const PALETTE = [
  ['Navy', NAVY, 'weight — heroes, room and display canvases'],
  ['Cream', CREAM, 'the member app ground'],
  ['Surface', SURFACE, 'cards on the ground'],
  ['Progress green', PROGRESS_GREEN, 'confirmed progress — the Living WE fill, eyebrows, tracks'],
  ['Action green', ACTION_GREEN, 'what a thumb is aimed at — primary actions only'],
  ['Ink quiet', INK_QUIET, 'secondary ink'],
  ['Hairline', HAIRLINE, 'edges'],
];

export const width = 1280;
export const height = 1400;

export const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<style>
  @page { margin: 0 }
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body {
    width: ${width}px; height: ${height}px; background: ${CREAM};
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: ${NAVY}; -webkit-font-smoothing: antialiased;
  }
  .board { padding: 44px 52px; display: flex; flex-direction: column; gap: 26px; height: 100% }

  .eyebrow { font-size: 11px; font-weight: 900; letter-spacing: 1.6px; color: ${PROGRESS_GREEN} }
  .eyebrow.quiet { color: ${INK_QUIET} }
  .rule { height: 1px; background: ${HAIRLINE} }

  header { display: flex; align-items: flex-end; justify-content: space-between; gap: 40px }
  header img { width: 300px; display: block }
  .boardname { text-align: right }
  .boardname .n { font-size: 13px; letter-spacing: 1.4px; font-weight: 900; color: ${INK_QUIET} }
  .boardname .t { font-size: 29px; line-height: 33px; font-weight: 800 }

  .copy { display: flex; flex-direction: column; gap: 6px }
  .copy .lead { font-size: 34px; line-height: 38px; font-weight: 800; letter-spacing: -0.4px }
  .copy .sub { font-size: 18px; line-height: 24px; color: ${TEXT_MUTED} }
  .copy .gov { font-size: 11px; letter-spacing: 1.2px; font-weight: 800; color: ${INK_QUIET}; margin-top: 4px }

  .panel { background: ${SURFACE}; border: 1px solid ${HAIRLINE}; border-radius: 18px; padding: 24px 26px }
  .panel.dark { background: ${NAVY}; border-color: ${NAVY}; color: ${CREAM} }
  .panel h3 { font-size: 18px; line-height: 24px; font-weight: 800; margin-bottom: 4px }
  .panel p.note { font-size: 13px; line-height: 18px; color: ${TEXT_MUTED} }
  .panel.dark p.note { color: ${ON_NAVY_MUTED} }

  .we { position: relative; display: block }
  .we-base { position: absolute; inset: 0; width: 100%; height: 100%; display: block }
  .we-clip { position: absolute; left: 0; right: 0; bottom: 0; overflow: hidden }
  .we-fill { position: absolute; left: 0; bottom: 0; display: block }
  .we-absent {
    border: 1.5px dashed ${HAIRLINE}; border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
  }
  .we-absent span { font-size: 11px; letter-spacing: 1px; font-weight: 800; color: ${INK_QUIET}; text-transform: uppercase }

  .states { display: flex; gap: 18px; align-items: flex-start; margin-top: 14px }
  /*
     A fixed mark row and a fixed label row, so a two-line note under one state
     cannot lift that state's label off the baseline the others share — which
     is what 103%'s longer caption did.
  */
  .state { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px }
  .state .mark-slot { height: 84px; display: flex; align-items: flex-end; justify-content: center }
  .state .lab { min-height: 20px }
  .state .lab { font-size: 15px; line-height: 20px; font-weight: 800 }
  .state .sub { font-size: 12px; line-height: 16px; color: ${TEXT_MUTED}; text-align: center }
  .panel.dark .state .sub { color: ${ON_NAVY_MUTED} }

  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 22px }
  .three { display: grid; grid-template-columns: 1.25fr 1fr; gap: 22px }

  .divide { display: grid; grid-template-columns: 1fr 1fr; gap: 0 }
  .divide > div { padding: 0 22px }
  .divide > div:first-child { border-right: 1px solid ${HAIRLINE} }
  .divide .head { font-size: 11px; letter-spacing: 1.5px; font-weight: 900; margin-bottom: 10px }
  .divide .mark { display: flex; align-items: center; gap: 16px; margin-bottom: 10px }
  .divide .say { font-size: 14px; line-height: 20px; color: ${TEXT_MUTED} }

  table { width: 100%; border-collapse: collapse }
  td { padding: 5px 0; font-size: 13px; line-height: 18px; vertical-align: middle }
  td.k { font-weight: 700; width: 168px; white-space: nowrap }
  td.v { color: ${TEXT_MUTED}; font-variant-numeric: tabular-nums; width: 92px }
  td.d { color: ${TEXT_MUTED} }
  .sw { width: 26px; height: 26px; border-radius: 7px; border: 1px solid rgba(11,31,58,0.12); display: inline-block; vertical-align: middle }

  .typerow { display: flex; align-items: baseline; gap: 14px; padding: 3px 0 }
  .typerow .nm { font-size: 12px; color: ${INK_QUIET}; width: 104px; font-weight: 700 }
  .typerow .px { font-size: 12px; color: ${TEXT_MUTED}; width: 66px; font-variant-numeric: tabular-nums }
  .typerow .sp { font-weight: 700; white-space: nowrap; overflow: hidden }

  .rules { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px }
  .rules .r .h { font-size: 11px; letter-spacing: 1.4px; font-weight: 900; color: ${INK_QUIET}; margin-bottom: 6px }
  .rules .r p { font-size: 13px; line-height: 18px; color: ${TEXT_MUTED} }
  .rules .r b { color: ${NAVY} }

  footer { margin-top: auto; display: flex; justify-content: space-between; align-items: center;
           font-size: 11px; letter-spacing: 0.6px; color: ${INK_QUIET} }
</style></head>
<body><div class="board">

  <header>
    <img src="${asset('wordmark-navy-green.png')}" alt="WE STAY FIT">
    <div class="boardname">
      <div class="n">NORTH STAR · BOARD 00</div>
      <div class="t">Brand foundation</div>
    </div>
  </header>

  <div class="copy">
    <div class="lead">Turn your community into a place that moves.</div>
    <div class="sub">Shared challenges. More movement. Stronger communities.</div>
    <div class="gov">THE ONLY GOVERNING PUBLIC COPY. ANY OTHER PHRASE IS EXPLORATORY UNTIL IT IS LOCKED.</div>
  </div>

  <div class="panel">
    <div class="eyebrow">THE LIVING WE — THE SIGNATURE INSTRUMENT</div>
    <h3 style="margin-top:8px">One silhouette, filled from the bottom by a confirmed ratio.</h3>
    <p class="note">The green <b style="color:${NAVY}">area</b> matches the ratio, not the green height — the
      letterform is irregular, so the clip comes from the silhouette's area calibration. The rounded
      percentage never drives the shape.</p>
    <div class="states">
      ${STATES.map(
        (s) => `<div class="state">
          ${livingWe({ ratio: s.ratio, width: 150, surface: 'light' })}
          <div class="lab">${s.label}</div>
          <div class="sub">${s.note}</div>
        </div>`
      ).join('')}
    </div>
  </div>

  <div class="two">
    <div class="panel dark">
      <div class="eyebrow">ON THE NAVY SURFACE</div>
      <h3 style="margin-top:8px">The unfilled mark is white here.</h3>
      <p class="note">An empty WE reads as the brand in the owner's own colourway — navy on light,
        white on navy — never as a disabled shape.</p>
      <div class="states">
        ${[0, 241 / 500, 1]
          .map(
            (r, i) => `<div class="state">
              ${livingWe({ ratio: r, width: 132, surface: 'dark' })}
              <div class="lab" style="color:${CREAM}">${['0 of 500', '241 of 500', '500 of 500'][i]}</div>
            </div>`
          )
          .join('')}
      </div>
    </div>

    <div class="panel">
      <div class="eyebrow quiet">STATIC WE VERSUS LIVING WE</div>
      <div class="divide" style="margin-top:14px">
        <div>
          <div class="head" style="color:${INK_QUIET}">STATIC — BRANDING</div>
          <div class="mark">
            <img src="${asset('monogram-unfilled-navy.png')}" style="width:92px;display:block" alt="">
          </div>
          <div class="say">A constrained brand mark. It makes <b style="color:${NAVY}">no progress claim</b>,
            and it must never stand in for missing or zero progress.</div>
        </div>
        <div>
          <div class="head" style="color:${PROGRESS_GREEN}">LIVING — PROGRESS</div>
          <div class="mark">
            ${livingWe({ ratio: 241 / 500, width: 92, surface: 'light' })}
          </div>
          <div class="say">The same owner silhouette, filled only from a
            <b style="color:${NAVY}">real confirmed shared ratio</b>. No denominator means no instrument.</div>
        </div>
      </div>
    </div>
  </div>

  <div class="three">
    <div class="panel">
      <div class="eyebrow quiet">PALETTE</div>
      <table style="margin-top:10px">
        ${PALETTE.map(
          ([name, hex, job]) => `<tr>
            <td class="k"><span class="sw" style="background:${hex}"></span>&nbsp;&nbsp;${name}</td>
            <td class="v">${hex}</td>
            <td class="d">${job}</td>
          </tr>`
        ).join('')}
      </table>
      <p class="note" style="margin-top:10px">Two greens, two jobs. Progress green is the confirmed
        ratio; action green is the thing a thumb is aimed at. They are never swapped.</p>
    </div>

    <div class="panel">
      <div class="eyebrow quiet">TYPE — THE SHIPPED PRODUCT SCALE</div>
      <div style="margin-top:10px">
        ${TYPE_SCALE.map(
          ([name, px]) => `<div class="typerow">
            <span class="nm">${name}</span><span class="px">${px}</span>
            <span class="sp" style="font-size:${px.split(' / ')[0]}px;line-height:${px.split(' / ')[1]}px">We stay fit</span>
          </div>`
        ).join('')}
      </div>
      <p class="note" style="margin-top:8px">These are the real tokens the product ships. Design-target
        drawing values are not product tokens and are not published here.</p>
    </div>
  </div>

  <div class="panel">
    <div class="rules">
      <div class="r">
        <div class="h">ARTWORK</div>
        <p>The wordmark and monogram are <b>owner-supplied assets, composited exactly</b>. No redraw,
          no recolour, no generated letterform — on this board or any other.</p>
      </div>
      <div class="r">
        <div class="h">GROUND</div>
        <p>A cream, light member-app ground carrying <b>selective navy weight</b>: the hero, the card that
          matters. Navy room and display canvases are allowed. Navy is not the screen.</p>
      </div>
      <div class="r">
        <div class="h">MOTION</div>
        <p>Confirmed changes <b>render immediately</b>. No animation timing is approved; any future motion
          needs an explicit timing decision and a reduced-motion path.</p>
      </div>
    </div>
  </div>

  <footer>
    <span>WE_STAY_FIT_NORTH_STAR_BOARD_00_BRAND_FOUNDATION_FINAL</span>
    <span>LOCKED · PR #365 comment 5770785512 · governing constitution for boards 01–17</span>
  </footer>

</div></body></html>`;
