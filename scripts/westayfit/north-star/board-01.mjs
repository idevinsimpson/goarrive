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
 * The only thing that satisfies that sentence is the running product. So the
 * phones and the lifecycle strip below are not drawn: they are PNGs
 * photographed from the emulator build by
 * `apps/westayfit/tests-e2e/north-star-board-01-capture.spec.ts`, each state
 * seeded and asserted (percent, status line, fill-ratio attribute, eyebrow)
 * before the shot. The wordmark is the owner-derived PNG. The mark in every
 * frame is `LivingWeProgress` itself.
 *
 * What the lock names as an INTENDED SEAM — opted-in member visibility — is
 * drawn here as a labelled composition and nowhere presented as a capture.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const BRAND = path.join(REPO, 'apps/westayfit/assets/brand/derived');
const CAPTURES = path.join(REPO, 'docs/design-target/north-star-final/board-01/captures');

const asset = (f) => pathToFileURL(path.join(BRAND, f)).href;
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
    title: 'Member · a second goal under way',
    sub: 'One Living WE, on the featured goal only · the roll-up counts goals, never people',
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

/* The lifecycle strip, in the order the lock names the states. */
const STATE_W = 134;
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
export const height = 1935;

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

  .strip { display: flex; gap: 14px; align-items: flex-start; margin-top: 12px }
  .state { width: ${STATE_W}px; display: flex; flex-direction: column; gap: 7px }
  .state .slot { height: 150px; display: flex; flex-direction: column; justify-content: flex-end; gap: 6px }
  .state .slot img { border-radius: 8px; box-shadow: 0 2px 8px rgba(11,31,58,0.10) }
  .state .nm { font-size: 13px; line-height: 17px; font-weight: 800 }
  .state .nt { font-size: 11px; line-height: 15px; color: ${TEXT_MUTED} }

  .two { display: grid; grid-template-columns: 1.15fr 1fr; gap: 22px }

  .example { margin-top: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 14px }
  .ex { border: 1px solid ${ON_NAVY_RULE}; border-radius: 14px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px }
  .ex .h { font-size: 10.5px; letter-spacing: 1.3px; font-weight: 900; color: ${PROGRESS_GREEN} }
  .row { display: flex; align-items: center; gap: 10px }
  .disc { width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
          font-size: 12px; font-weight: 900; flex: none }
  .disc.vis { background: ${PROGRESS_GREEN}; color: ${NAVY} }
  .disc.priv { background: rgba(247,245,240,0.12); color: ${ON_NAVY_MUTED}; border: 1px dashed ${ON_NAVY_RULE} }
  .who { font-size: 14px; line-height: 18px; font-weight: 700 }
  .what { font-size: 12px; line-height: 16px; color: ${ON_NAVY_MUTED} }
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
          <div><span class="tag real">CURRENT BUILD · CAPTURED</span></div>
          <div class="cap">${p.title}</div>
          <div class="sub">${p.sub}</div>
        </div>`
      ).join('')}
    </div>
  </div>

  <div class="panel">
    <div class="eyebrow quiet">LIFECYCLE · EVERY STATE THE PRODUCT DISTINGUISHES, EACH ONE CAPTURED</div>
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
    </div>
    <p class="note" style="margin-top:12px">Reached and closed are separate facts, so the product carries four ends, not two: <b style="color:${NAVY}">reached / open</b>, <b style="color:${NAVY}">closed / reached</b>, <b style="color:${NAVY}">closed / unfinished</b>, and no goal at all. A closed goal is a History row on Home — it is never a hero. Nothing here streaks, ranks, compares or counts people.</p>
  </div>

  <div class="two">
    <div class="panel dark">
      <div class="eyebrow seam">INTENDED MEMBER-VISIBILITY SEAM · APPROVED DIRECTION · NOT SHIPPED</div>
      <h3>The same contribution, seen two ways.</h3>
      <p class="note">Per community, private by default, explicit opt-in. Nothing on this panel is a capture.</p>
      <div class="example">
        <div class="ex">
          <div class="h">MEMBER CHOSE VISIBLE</div>
          <div class="row"><div class="disc vis">AR</div><div><div class="who">Alex Rivera</div><div class="what">added 20 squats · fixture member</div></div></div>
          <div class="what">Name and role, shown to members of this community only.</div>
        </div>
        <div class="ex">
          <div class="h">MEMBER STAYED PRIVATE</div>
          <div class="row"><div class="disc priv">·</div><div><div class="who">A member</div><div class="what">added 20 squats</div></div></div>
          <div class="what">Counted in full. Named nowhere. The default.</div>
        </div>
      </div>
      <div class="legend"><b>Visible members shown by permission; private members contribute anonymously.</b></div>
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
        <tr><td class="k">Intended seam</td><td class="d">Opted-in member visibility and attributed recent movement — the navy panel to the left. Owner-approved direction; not shipped behaviour and not shown as a capture.</td></tr>
        <tr><td class="k">Hero action</td><td class="d">The build's primary reads <b style="color:${NAVY}">Start moving</b>; "Add your contribution" is the build's wording on a secondary goal's card, not the hero. Both journeys are present on every open goal, short phone included.</td></tr>
        <tr><td class="k">Not on this board</td><td class="d">Notification bell, streak, "consistency", "Great work, community!", "Keep moving", "A new challenge will appear here", "We'll keep your progress safe", any header slogan beyond Board 00's pair. None exists in the product; none is drawn.</td></tr>
        <tr><td class="k">Found while making it</td><td class="d">The hero's "Try again" label was navy on navy — invisible in the first unavailable capture. Fixed in the build and pinned by two colour-asserting tests; the frame above is the corrected product.</td></tr>
      </table>
    </div>
  </div>

  <footer>
    <span>WE_STAY_FIT_NORTH_STAR_BOARD_01_HOME_CANDIDATE</span>
    <span>PRECISION CANDIDATE · creative direction LOCKED by PR #365 comments 5771373306 / 5771398679 · awaiting the final review these nine corrections were held for</span>
  </footer>

</div></body></html>`;
