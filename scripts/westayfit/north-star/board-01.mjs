/**
 * BOARD 01 — HOME.
 *
 * Reconstructed from its lock: PR #365 comment 5770964377, corrected by
 * 5771119797, and the two precision holds 5771373306 (revision 6) and
 * 5771398679 (revision 7). Revision 7 accepted the creative direction and the
 * privacy/visibility concept and held the board for nine truth/precision
 * items, the first of which is the reason this file exists:
 *
 *   "All wordmarks and Living WE marks are still generated approximations.
 *    Final lock must composite the exact owner wordmark and real calibrated
 *    LivingWeProgress output."
 *
 * The captures are the product: the phones and eight lifecycle states below
 * are not drawn, they are PNGs photographed from the emulator build by
 * `apps/westayfit/tests-e2e/north-star-board-01-capture.spec.ts`, each state
 * seeded and asserted (percent, status line, fill-ratio attribute, eyebrow)
 * before the shot. The wordmark is the owner-derived PNG. The mark in every
 * captured frame is `LivingWeProgress` itself. Targets and seams are
 * COMPOSITIONS from the same exact assets and the same calibration table,
 * labelled as such — a labelled target may carry the mark; it is composed
 * from the owner PNGs and `living-we-calibration.json` exactly as Board 00
 * is, never approximated. (Round 3/4 clarification: the earlier claim that
 * only a photograph can carry the mark was too strong.)
 *
 * What the lock names as an INTENDED SEAM — opted-in member visibility — is
 * drawn here as a labelled composition and nowhere presented as a capture.
 *
 * TWO CORRECTIONS from the Round 2 direction (PR #365 comment 5781542755),
 * and nothing else changed:
 *
 *   1. STALE. The first candidate left the state out because Home does not
 *      distinguish it. Current capability cannot erase intended coverage, so
 *      the state is back — as the strip's ninth cell, drawn, dashed and
 *      labelled TARGET / NOT IMPLEMENTED, carrying the building state's own
 *      confirmed values unchanged. Its words are not invented: /display,
 *      /kiosk and /station already ship `stale ? 'Last confirmed' :
 *      'Confirmed'` and the display's "Connection interrupted". Home's
 *      `renderFreshness` has no such branch. It carries the confirmed Living
 *      WE at 241/500, composed from the owner monogram and the calibration
 *      table: a stale state has a valid last-confirmed ratio, so it is NOT a
 *      no-denominator state, and the mark persists unchanged while the
 *      screen stops presenting itself as current.
 *
 *   2. SEAM SEMANTICS. PR #390 approves opted-in NAME + ROLE visibility in
 *      one community's members list. It does not approve attributed movement
 *      and it does not approve photos. The panel's approved pair now shows
 *      exactly that — and only that — while the named-movement concept it
 *      previously carried is a separate, struck cell labelled NOT AUTHORIZED
 *      / NOT IMPLEMENTED. The initials disc went with it: #390's own members
 *      screen draws no avatar and no initials.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const BRAND = path.join(REPO, 'apps/westayfit/assets/brand/derived');
const CAPTURES = path.join(REPO, 'docs/design-target/north-star-final/board-01/captures');

const asset = (f) => pathToFileURL(path.join(BRAND, f)).href;

/* ── the confirmed Living WE for the drawn stale cell ─────────────────────
   Same source as Board 00: the JSON `livingWeCalibration.ts` requires at
   runtime, read exactly as `heightFractionForFill()` reads it, interpolation
   included — so the green AREA on the drawn cell is the green area the
   product paints for 241/500. The monogram PNGs are the owner assets. */
import { readFileSync } from 'node:fs';
const calibration = JSON.parse(readFileSync(path.join(BRAND, 'living-we-calibration.json'), 'utf8'));
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
const LIVING_WE_ASPECT = calibration.width / calibration.height;
function livingWe(ratio, width) {
  const h = Math.round(width / LIVING_WE_ASPECT);
  const fillPx = heightFractionForFill(Math.min(1, Math.max(0, ratio))) * h;
  return `<div class="we" style="width:${width}px;height:${h}px">
    <img class="we-base" src="${asset('monogram-unfilled-white.png')}" alt="">
    <div class="we-clip" style="height:${fillPx.toFixed(2)}px">
      <img class="we-fill" src="${asset('monogram-fill-green.png')}" style="width:${width}px;height:${h}px" alt="">
    </div>
  </div>`;
}
const capture = (f) => pathToFileURL(path.join(CAPTURES, f)).href;

/* ── locked palette (Board 00) ───────────────────────────────────────────── */
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

/* The phones. Every one is a capture; the caption says what was seeded. */
const PHONE_W = 268;
const PHONES = [
  {
    file: 'phone-member-building-390x844.png',
    css: { w: 390, h: 844 },
    title: 'Member · 241 of 500',
    sub: '312 members (fixture) · 48.2% · both journeys offered · Your Part is private and exact',
  },
  {
    file: 'phone-member-multiple-goals-390x844.png',
    css: { w: 390, h: 844 },
    /* A SCROLLED VIEW, AND LABELLED AS ONE. The capture spec centres the
       second goal's card (`bring()` → scrollIntoView block:center), so this
       frame opens below the hero: the wordmark, the community identity and
       the featured goal's Living WE are above it and not in it. The earlier
       caption asserted that mark; the frame cannot show it (W2, D-01.1). It is
       not presented as the arrival state and is not re-shot -- the capture is
       the product, unchanged. */
    scrolled: true,
    title: 'Member · a second goal under way (scrolled)',
    sub: 'Continued view, scrolled to the second goal — the hero and its Living WE sit above this frame. The second goal gets a compact card: figures, no mark. The roll-up counts goals, never people',
  },
  {
    file: 'phone-champion-building-390x844.png',
    css: { w: 390, h: 844 },
    title: 'Champion · 241 of 500',
    sub: 'Same Home, plus Manage. No streak, no bell — neither exists in the product',
  },
  {
    file: 'phone-short-reached-open-390x640.png',
    css: { w: 390, h: 640 },
    title: '390 × 640 · reached, still open',
    sub: '"Goal reached" carries the news · both routes remain; the quiet one sits at the fold',
  },
];

/* The lifecycle strip, in the order the lock names the states.
   134px never fitted: eight captures and their gaps came to 1170 inside 1128
   of panel, which is why the last caption sat flush against the border. Eight
   at 106, plus the drawn ninth at 156 and its own rule, come to 1105. The
   target cell is the wider one because it is the only cell whose own words
   have to be readable — the captures are read through their captions. */
const STATE_W = 106;
const TARGET_W = 156;
const STATES = [
  { file: 'state-zero.png', css: { w: 350, h: 341 }, name: 'Open · 0%', note: 'Unfilled mark. It is the brand, not a disabled shape.' },
  { file: 'state-building.png', css: { w: 350, h: 341 }, name: 'Building · 48.2%', note: 'Area-calibrated fill; 52.67% of height for 48.2% of area.' },
  { file: 'state-near.png', css: { w: 350, h: 341 }, name: 'Near · 92.2%', note: 'Only the numbers change. "Only 39 to go."' },
  { file: 'state-reached-open.png', css: { w: 350, h: 386 }, name: 'Reached · open', note: 'Fully #91CB7D. Eyebrow "Goal reached"; the overshoot stays in the number.' },
  { file: 'state-closed-reached.png', css: { w: 350, h: 120 }, name: 'Closed · reached', note: 'A History row: "Reached", with the exact total kept.' },
  { file: 'state-closed-unfinished.png', css: { w: 350, h: 120 }, name: 'Closed · unfinished', note: '"Closed at 22.5%" — the result, without dressing or blame.' },
  {
    file: 'state-no-goal-member.png',
    css: { w: 350, h: 102 },
    second: { file: 'state-no-goal-champion.png', css: { w: 350, h: 182 } },
    name: 'No goal',
    note: 'No denominator, so no mark. Member above, Champion below — each told the truth for their role.',
  },
  { file: 'state-unavailable.png', css: { w: 350, h: 277 }, name: 'Unavailable', note: '"Progress couldn’t be loaded just now." · Try again. Nothing promised beyond that.' },
];

function scaled(file, css, width) {
  const h = Math.round((css.h / css.w) * width);
  return `<img src="${capture(file)}" style="width:${width}px;height:${h}px;display:block" alt="">`;
}

export const width = 1280;
/* 1935 clipped the screen note's last two rows and the footer once the strip
   gained its ninth cell and the seam panel its third. Width is the set's
   constant; height is per board (00 is 1400, 02 is 2470). */
export const height = 2260;

export const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body {
    width: ${width}px; height: ${height}px; background: ${CREAM};
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: ${NAVY}; -webkit-font-smoothing: antialiased;
  }
  .board { padding: 44px 52px 36px; display: flex; flex-direction: column; gap: 22px; height: 100% }

  .eyebrow { font-size: 11px; font-weight: 900; letter-spacing: 1.6px; color: ${PROGRESS_GREEN} }
  .eyebrow.quiet { color: ${INK_QUIET} }
  .eyebrow.seam { color: ${ACTION_GREEN} }

  header { display: flex; align-items: flex-end; justify-content: space-between; gap: 40px }
  header img { width: 300px; display: block }
  .boardname { text-align: right }
  .boardname .n { font-size: 13px; letter-spacing: 1.4px; font-weight: 900; color: ${INK_QUIET} }
  .boardname .t { font-size: 29px; line-height: 33px; font-weight: 800 }

  .copy { display: flex; align-items: baseline; justify-content: space-between; gap: 30px; padding-bottom: 6px; border-bottom: 1px solid ${HAIRLINE} }
  .copy .lead { font-size: 27px; line-height: 33px; font-weight: 800; letter-spacing: -0.3px; white-space: nowrap }
  .copy .gov { font-size: 11px; letter-spacing: 1.2px; font-weight: 800; color: ${INK_QUIET}; text-align: right; max-width: 430px; line-height: 16px }

  .sec-head { display: flex; align-items: baseline; justify-content: space-between; gap: 20px; margin-bottom: 10px }
  .sec-head h3 { font-size: 18px; line-height: 24px; font-weight: 800 }
  .sec-head .how { font-size: 12px; line-height: 16px; color: ${TEXT_MUTED}; max-width: 640px; text-align: right }

  .phones { display: flex; gap: 34px; align-items: flex-start }
  .phone { width: ${PHONE_W}px; display: flex; flex-direction: column; gap: 9px }
  /* One slot height for every phone, so the 390×640 frame's caption sits on
     the same baseline as the three 390×844 frames beside it. */
  .phone .slot { height: ${Math.round((844 / 390) * PHONE_W)}px; display: flex; align-items: flex-start }
  .shell { border-radius: 26px; overflow: hidden; border: 1px solid ${HAIRLINE}; background: ${CREAM};
           box-shadow: 0 10px 28px rgba(11,31,58,0.10) }
  .phone .cap { font-size: 14px; line-height: 19px; font-weight: 800 }
  .phone .sub { font-size: 12px; line-height: 16px; color: ${TEXT_MUTED} }
  .tag { display: inline-block; font-size: 10px; letter-spacing: 1.2px; font-weight: 900; padding: 3px 7px; border-radius: 6px }
  .tag.real { color: ${NAVY}; background: rgba(145,203,125,0.28) }
  .tag.seam { color: ${CREAM}; background: ${ACTION_GREEN} }

  .panel { background: ${SURFACE}; border: 1px solid ${HAIRLINE}; border-radius: 18px; padding: 20px 24px 22px }
  .panel.dark { background: ${NAVY}; border-color: ${NAVY}; color: ${CREAM} }
  .panel h3 { font-size: 18px; line-height: 24px; font-weight: 800; margin-top: 8px }
  .panel p.note { font-size: 13px; line-height: 18px; color: ${TEXT_MUTED} }
  .panel.dark p.note { color: ${ON_NAVY_MUTED} }

  .strip { display: flex; gap: 11px; align-items: flex-start; margin-top: 12px }
  .state { width: ${STATE_W}px; display: flex; flex-direction: column; gap: 7px }
  /* Tall enough for the drawn cell's inset WITH its Living WE (the captured
     cells are bottom-aligned, so extra room above them is empty ground). */
  .state .slot { height: 206px; display: flex; flex-direction: column; justify-content: flex-end; gap: 6px }
  .state .slot img { border-radius: 8px; box-shadow: 0 2px 8px rgba(11,31,58,0.10) }
  .state .nm { font-size: 13px; line-height: 17px; font-weight: 800 }
  .state .nt { font-size: 11px; line-height: 15px; color: ${TEXT_MUTED} }

  /* The ninth cell is DRAWN, not photographed, and has to be unmistakable at a
     glance: its own rule, a dashed edge and its own tag. Its Living WE is the
     confirmed one, composed from the owner monogram and the calibration table
     — the stale state keeps its last-confirmed ratio. */
  .tgt .we { position: relative; display: block; margin: 5px auto 0 }
  .tgt .we-base { position: absolute; inset: 0; width: 100%; height: 100%; display: block }
  .tgt .we-clip { position: absolute; left: 0; right: 0; bottom: 0; overflow: hidden }
  .tgt .we-fill { position: absolute; left: 0; bottom: 0; display: block }
  .state.target { width: ${TARGET_W}px; border-left: 1px dashed ${HAIRLINE}; padding-left: 12px }
  .tgt { position: relative; border: 1px dashed ${INK_QUIET}; border-radius: 10px; padding: 12px 7px 7px; background: ${SURFACE};
         display: flex; flex-direction: column; gap: 6px; margin-top: 9px }
  .tgt .hero { background: ${NAVY}; border-radius: 7px; padding: 8px 9px 9px; color: ${CREAM} }
  .tgt .gt { font-size: 9px; line-height: 12px; font-weight: 800; white-space: nowrap }
  .tgt .gs { font-size: 7.5px; line-height: 10px; color: ${ON_NAVY_MUTED} }
  .tgt .num { font-size: 20px; line-height: 22px; font-weight: 900; margin-top: 4px }
  /* The product stacks the denominator under the count rather than running it
     on; the drawing stacks it too. */
  .tgt .den { font-size: 8px; line-height: 10px; font-weight: 700; color: ${ON_NAVY_MUTED} }
  .tgt .bar { height: 3px; border-radius: 2px; background: rgba(247,245,240,0.18); margin-top: 5px; overflow: hidden }
  .tgt .bar i { display: block; height: 100%; width: 48.2%; background: ${PROGRESS_GREEN} }
  .tgt .pct { font-size: 8px; line-height: 10px; font-weight: 800; color: ${PROGRESS_GREEN}; margin-top: 4px }
  .tgt .togo { font-size: 8px; line-height: 10px; color: ${ON_NAVY_MUTED} }
  /* Home keeps the freshness row OUTSIDE the navy panel, on the page's own
     surface. The drawing keeps it there. */
  .tgt .warn { font-size: 8.5px; line-height: 11px; font-weight: 900; letter-spacing: 0.2px; white-space: nowrap }
  .tgt .conf { font-size: 8px; line-height: 12px; color: ${TEXT_MUTED}; white-space: nowrap }
  .tgt .conf u { color: ${NAVY}; font-weight: 800 }
  /* The tag straddles the inset's top border instead of taking a row of its
     own, so this cell's caption sits on the same line as the eight captured
     cells' captions. */
  .tag.target { position: absolute; top: -9px; left: 8px; color: ${NAVY}; background: ${CREAM}; border: 1px dashed ${INK_QUIET}; font-size: 7px; letter-spacing: 0.5px; padding: 3px 5px; white-space: nowrap }

  .two { display: grid; grid-template-columns: 1.15fr 1fr; gap: 22px }

  .example { margin-top: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 14px }
  .ex { border: 1px solid ${ON_NAVY_RULE}; border-radius: 14px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px }
  .ex .h { font-size: 10.5px; letter-spacing: 1.3px; font-weight: 900; color: ${PROGRESS_GREEN} }
  /* A members-list row, which is all #390 returns: display name and role. No
     avatar and no initials — its own screen draws neither. */
  .listrow { display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
             border: 1px solid ${ON_NAVY_RULE}; border-radius: 9px; padding: 9px 11px }
  .listrow.ghost { border-style: dashed }
  .listrow .role { font-size: 11px; letter-spacing: 0.8px; font-weight: 800; color: ${PROGRESS_GREEN} }
  .listrow.ghost .role { color: ${ON_NAVY_MUTED} }
  .listrow.ghost .who { color: ${ON_NAVY_MUTED}; font-weight: 600; font-style: italic }
  .who { font-size: 14px; line-height: 18px; font-weight: 700 }
  .what { font-size: 12px; line-height: 16px; color: ${ON_NAVY_MUTED} }
  /* Not a counterpart to anything on this panel: a concept #390 does not carry,
     kept visible so it cannot be mistaken for part of it. */
  .ex.refused { margin-top: 12px; border-style: dashed; border-color: rgba(247,245,240,0.30) }
  .ex.refused .h { color: ${ON_NAVY_MUTED} }
  .struck { font-size: 14px; line-height: 18px; font-weight: 700; color: ${ON_NAVY_MUTED}; text-decoration: line-through }
  .legend { margin-top: 12px; font-size: 12.5px; line-height: 17px; color: ${CREAM}; border-top: 1px solid ${ON_NAVY_RULE}; padding-top: 10px }
  .legend b { color: ${PROGRESS_GREEN} }
  .rules { margin-top: 8px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px }
  .rules div { font-size: 11.5px; line-height: 15px; color: ${ON_NAVY_MUTED} }
  .rules div::before { content: '·  '; color: ${PROGRESS_GREEN}; font-weight: 900 }

  table { width: 100%; border-collapse: collapse; margin-top: 10px }
  td { padding: 5px 0; font-size: 12.5px; line-height: 17px; vertical-align: top; border-bottom: 1px solid ${HAIRLINE} }
  tr:last-child td { border-bottom: 0 }
  td.k { font-weight: 800; width: 150px; padding-right: 10px }
  td.d { color: ${TEXT_MUTED} }

  footer { margin-top: auto; display: flex; justify-content: space-between; align-items: center; gap: 48px;
           font-size: 11px; letter-spacing: 0.6px; color: ${INK_QUIET} }
  footer span:first-child { white-space: nowrap }
  footer span:last-child { text-align: right; max-width: 760px; line-height: 15px }
</style></head>
<body><div class="board">

  <header>
    <img src="${asset('wordmark-navy-green.png')}" alt="WE STAY FIT">
    <div class="boardname">
      <div class="n">NORTH STAR · BOARD 01</div>
      <div class="t">Home</div>
    </div>
  </header>

  <div class="copy">
    <div class="lead">Same experience. Different states. One community.</div>
    <div class="gov">INTERNAL BOARD COPY — NOT IN-APP MESSAGING. THE ONLY GOVERNING PUBLIC COPY IS BOARD 00'S LOCKED PAIR.</div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">THE ACCEPTED HOME · PHOTOGRAPHED FROM THE BUILD</div>
        <h3 style="font-size:18px;line-height:24px;font-weight:800;margin-top:4px">One community, one navy hero, one Living WE, one strong action — and the quiet second route.</h3>
      </div>
      <div class="how">Every frame is a real capture of the running product at 2×, seeded and asserted before it was shot. The mark is <b style="color:${NAVY}">LivingWeProgress</b> itself; the wordmark is the owner asset. Fixture community and members: synthetic, nobody real.</div>
    </div>
    <div class="phones">
      ${PHONES.map(
        (p) => `<div class="phone">
          <div class="slot"><div class="shell">${scaled(p.file, p.css, PHONE_W)}</div></div>
          <div><span class="tag real">CURRENT BUILD · CAPTURED</span>${p.scrolled ? ' <span class="tag real">SCROLLED VIEW</span>' : ''}</div>
          <div class="cap">${p.title}</div>
          <div class="sub">${p.sub}</div>
        </div>`
      ).join('')}
    </div>
  </div>

  <div class="panel">
    <div class="eyebrow quiet">LIFECYCLE · EIGHT STATES THE PRODUCT DISTINGUISHES, EACH ONE CAPTURED · ONE DRAWN AS TARGET</div>
    <div class="strip">
      ${STATES.map(
        (s) => `<div class="state">
          <div class="slot">
            ${scaled(s.file, s.css, STATE_W)}
            ${s.second ? scaled(s.second.file, s.second.css, STATE_W) : ''}
          </div>
          <div class="nm">${s.name}</div>
          <div class="nt">${s.note}</div>
        </div>`
      ).join('')}
      <div class="state target">
        <div class="slot">
          <div class="tgt">
            <span class="tag target">TARGET · NOT IMPLEMENTED</span>
            <div class="hero">
              <div class="gt">500 Squats by Friday</div>
              <div class="gs">Open · Ends Fri, Sep 25</div>
              ${livingWe(241 / 500, 72)}
              <div class="num">241</div>
              <div class="den">of 500 squats</div>
              <div class="bar"><i></i></div>
              <div class="pct">48.2% complete</div>
              <div class="togo">259 to go</div>
            </div>
            <div>
              <div class="warn">Connection interrupted</div>
              <div class="conf">Last confirmed 5:57 PM · <u>Refresh</u></div>
            </div>
          </div>
        </div>
        <div class="nm">Stale · last confirmed</div>
        <div class="nt">Drawn, not captured. The last confirmed values, the confirmed Living WE and the receipt time, all unchanged — nothing implying anyone moved.</div>
      </div>
    </div>
    <p class="note" style="margin-top:12px">The ninth cell is the one state Home does not distinguish. Its words are the product's own — <b style="color:${NAVY}">/display</b>, <b style="color:${NAVY}">/kiosk</b> and <b style="color:${NAVY}">/station</b> all render <b style="color:${NAVY}">Last confirmed</b> in place of <b style="color:${NAVY}">Confirmed</b> when a later poll fails, and the display adds <b style="color:${NAVY}">Connection interrupted</b> — so the target is Home adopting a treatment the product already ships, not a new idea. Reached and closed are separate facts, so the product carries four ends, not two: <b style="color:${NAVY}">reached / open</b>, <b style="color:${NAVY}">closed / reached</b>, <b style="color:${NAVY}">closed / unfinished</b>, and no goal at all. A closed goal is a History row on Home — it is never a hero. Nothing here streaks, ranks, compares or counts people.</p>
  </div>

  <div class="two">
    <div class="panel dark">
      <div class="eyebrow seam">INTENDED SEAM · APPROVED DIRECTION (#390) · NOT SHIPPED</div>
      <h3>Two members of one community. One chose to be named.</h3>
      <p class="note">What PR #390 approves is membership visibility: display name and role, inside one community, private by default, explicit opt-in, self-only. Nothing on this panel is a capture.</p>
      <div class="example">
        <div class="ex">
          <div class="h">MEMBER CHOSE VISIBLE</div>
          <div class="listrow"><div class="who">Alex Rivera</div><div class="role">MEMBER</div></div>
          <div class="what">Appears in this community's members list, to members of this community. Display name and role — and nothing else: no photo, no initials, no joined date, no activity.</div>
        </div>
        <div class="ex">
          <div class="h">MEMBER STAYED PRIVATE</div>
          <div class="listrow ghost"><div class="who">Not listed</div><div class="role">—</div></div>
          <div class="what">Counted in the member count and in the goal's confirmed total, exactly like anyone else. Named nowhere. The default.</div>
        </div>
      </div>
      <div class="legend"><b>Visible members shown by permission; private members contribute anonymously.</b></div>
      <div class="ex refused">
        <div class="h">NOT AUTHORIZED · NOT IMPLEMENTED</div>
        <div class="struck">Alex Rivera · added 20 squats</div>
        <div class="what">Attributed movement — a row saying who added what — is <b style="color:${CREAM}">not</b> part of the approved seam. #390 returns display name and role and carries nothing about contributions; no callable attributes a contribution to a named member. An earlier revision of this panel drew it beside the approved pair. It is separated here so it cannot be read as approved, and it is not built.</div>
      </div>
      <div class="rules">
        <div>A face row or avatar is a concept for opted-in members only — member-provided, permissioned. No photo appears on this board: none may be stock or fabricated.</div>
        <div>"+18" means eighteen more opted-in visible members. It is never a count of people who moved today.</div>
        <div>Public, kiosk and shared-device displays never carry identity, whatever a member chose here.</div>
        <div>No Champion can make another member visible. Rejoining resets to private and asks again.</div>
      </div>
    </div>

    <div class="panel">
      <div class="eyebrow quiet">SCREEN NOTE · WHAT IS BUILT, WHAT IS INTENDED, WHERE THE WORDS DIFFER</div>
      <table>
        <tr><td class="k">Accepted capability</td><td class="d">Community identity with a member count · one navy featured-goal hero · calibrated Living WE · exact total, one-decimal percent rounded down, "to go" · "Start moving" and "Already moved? Record squats" · private Your Part · other goals compact · History rows · Champion Manage · five-slot shell Home | Community | MOVE | Progress | You.</td></tr>
        <tr><td class="k">Intended seam</td><td class="d">Opted-in <b style="color:${NAVY}">membership</b> visibility — display name and role, in one community's members list, private by default, self-only. That is PR #390's whole approved scope, and it is the navy panel to the left. Not shipped, and not shown as a capture. <b style="color:${NAVY}">Attributed movement is not in it</b> and is marked there as unauthorised.</td></tr>
        <tr><td class="k">Stale progress</td><td class="d">Home distinguishes no stale state: whenever progress is ok it prints "Confirmed <span style="font-style:italic">time</span>" with Refresh, and there is no other branch. <b style="color:${NAVY}">/display, /kiosk and /station do distinguish it.</b> The strip's ninth cell is that treatment drawn for Home — a target, not a capture, and not an implemented after.</td></tr>
        <tr><td class="k">Hero action</td><td class="d">The build's primary reads <b style="color:${NAVY}">Start moving</b>; "Add your contribution" is the build's wording on a secondary goal's card, not the hero. Both journeys are present on every open goal, short phone included.</td></tr>
        <tr><td class="k">Not on this board</td><td class="d">Notification bell, streak, "consistency", "Great work, community!", "Keep moving", "A new challenge will appear here", "We'll keep your progress safe", any header slogan beyond Board 00's pair. None exists in the product; none is drawn.</td></tr>
        <tr><td class="k">Found while making it</td><td class="d">The hero's "Try again" label was navy on navy — invisible in the first unavailable capture. Fixed in the build and pinned by two colour-asserting tests; the frame above is the corrected product.</td></tr>
      </table>
    </div>
  </div>

  <footer>
    <span>WE_STAY_FIT_NORTH_STAR_BOARD_01_HOME_FINAL</span>
    <span>REVIEWED 2026-09-22 · PR #365 comment 5783373780 · creative direction LOCKED by PR #365 comments 5771373306 / 5771398679 · phones and eight lifecycle states are captures of app e609c57; the ninth state and the seam panel are labelled compositions, not captures · Round 2 corrections (5781542755) applied: stale restored as TARGET, seam scoped to what #390 approves</span>
  </footer>

</div></body></html>`;
