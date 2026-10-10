/**
 * BOARD 10 — PUBLIC DISPLAY FAMILY.
 *
 * Locked by PR #365 comment 5771496484: "Board 10 now locks the public-display
 * family around one confirmed truth recomposed by distance." Status layer,
 * from that lock: "public display route / wide propagation-revocation logic is
 * CURRENT BUILD; portrait-frame composition + QR-to-join are TARGET / SEAM as
 * labelled."
 *
 * TWO PROVENANCES, AND THE LOCK REQUIRES THEM KEPT DISTINCT.
 *
 *   CURRENT BUILD / CAPTURED  twenty frames of the REAL `/display/[goalId]`,
 *                             produced for this board at canonical 7fbc45d by
 *                             tests-e2e/sprint-w2-board10-capture.spec.ts,
 *                             write-gated by WSF_CAPTURE_FRAMES=1. Released by
 *                             the Director on PR #416 because no current
 *                             screenshot of this route existed at any locked
 *                             viewport: batch-f is a drawing of a redesign,
 *                             the e5 artifacts are 1280x720 authorization
 *                             evidence, and ui-display's frames are not
 *                             committed. Every shot is preceded by an
 *                             assertion of the named state.
 *
 *   TARGET / NOT IMPLEMENTED  three frames from batch-f, captured from the
 *                             gated preview route /design-target/display-boards
 *                             rendering DisplayBoardTargets.tsx. Each carries
 *                             its own TARGET strip burnt into the image. A
 *                             target is never an after.
 *
 * ONE CALIBRATED LIVING WE PER COHERENT DISPLAY, and it is the product's own:
 * every ready frame asserts `wsf-display-we` has count 1, and the fill is the
 * area calibration, not the green height. No member tab bar, no raised MOVE,
 * no member action appears on any of these screens -- asserted, not eyeballed.
 *
 * TWO FIXTURE SETS, NEITHER CONTINUING THE OTHER. The current-build frames
 * carry Maple Street Movers at 241 of 500 squats; the batch-f targets carry
 * Riverside Church at 6,420 of 10,000 push-ups. Both are synthetic.
 */
import path from 'node:path';
import { REPO, header, footer, page, phone, NAVY, CREAM } from './lib.mjs';

const CUR = (f) => path.join(REPO, 'docs/design-target/review/sprint-w2-board10/after', f);
const TGT = (f) => path.join(REPO, 'docs/design-target/review/batch-f-public-display', f);

const BUILT = 'CURRENT BUILD · CAPTURED';
const DRAWN = 'TARGET · NOT IMPLEMENTED';

export const width = 1280;
export const height = 4630;

const P = 180;
const P_SLOT = Math.round((844 / 390) * P);
const F = 268;
const F_SLOT = Math.round((844 / 390) * F);
const PORT = 290;
const PORT_SLOT = Math.round((1303 / 800) * PORT);
const BOOTH = 282;
const BOOTH_SLOT = Math.round((823 / 1280) * BOOTH);
const WALL = 376;
const WALL_SLOT = Math.round((1103 / 1920) * WALL);
const WIDEFAIL = 276;
const WIDEFAIL_SLOT = Math.round((800 / 1280) * WIDEFAIL);

export const html = page({
  width,
  height,
  body: `
  ${header('10', 'Public display')}

  <div class="copy">
    <div class="lead">One confirmed truth, recomposed by distance. Never a person.</div>
    <div class="gov">INTERNAL BOARD COPY — NOT IN-APP MESSAGING. THE ONLY GOVERNING PUBLIC COPY IS BOARD 00'S LOCKED PAIR.</div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">390 × 844 · THE PREVIEW IN SOMEBODY'S HAND · CURRENT BUILD</div>
        <h3>A cream page, one navy hero, the exact Living WE, and anonymous additions — with nothing a member could press.</h3>
      </div>
      <div class="how">The real <b style="color:${NAVY}">/display/[goalId]</b> at canonical <b style="color:${NAVY}">7fbc45d</b>, captured for this board. Every frame asserts one <b style="color:${NAVY}">wsf-display-we</b>, no tab bar and no MOVE control before the shutter.</div>
    </div>
    <div class="phones" style="gap:19px">
      ${phone({ file: CUR('display-recent-390x844.png'), width: P, slot: P_SLOT, tag: 'fresh', tagText: BUILT, title: 'Ordinary progress', sub: '241 of 500 · 48.2% · 259 to go. <b>Recent</b> carries <b>+20 squats · 1 min ago</b> — amount and age, at most five lines. Five lines may be five people or one; the screen never says.' })}
      ${phone({ file: CUR('display-zero-390x844.png'), width: P, slot: P_SLOT, tag: 'fresh', tagText: BUILT, title: 'Nothing yet', sub: '0 of 500 · <b>See what WE can do.</b> The mark is the <b>unfilled white silhouette</b> on navy — the brand, making no progress claim, never a disabled shape.' })}
      ${phone({ file: CUR('display-near-390x844.png'), width: P, slot: P_SLOT, tag: 'fresh', tagText: BUILT, title: 'Near goal', sub: '450 of 500 · 90% · <b>Only 50 to go</b>, which is the one status line that changes weight. The fill is area-calibrated, so 90% of the ratio is 90% of the ink.' })}
      ${phone({ file: CUR('display-reached-390x844.png'), width: P, slot: P_SLOT, tag: 'fresh', tagText: BUILT, title: 'Reached, still open', sub: '515 of 500 · percent <b>capped at 100%</b> · <b>15 beyond our goal · still open</b> · <b>WE did it.</b> The cap is on the percentage only; the overshoot stays exact in the total.' })}
      ${phone({ file: CUR('display-closedreached-390x844.png'), width: P, slot: P_SLOT, tag: 'fresh', tagText: BUILT, title: 'Closed, reached', sub: '<b>515 squats completed together.</b> · <b>Goal: 500 squats</b> · <b>Look what WE did.</b> The closed frame leads with what was done, not with what was left.' })}
      ${phone({ file: CUR('display-closedshort-390x844.png'), width: P, slot: P_SLOT, tag: 'fresh', tagText: BUILT, title: 'Closed, unfinished', sub: '312 of 500 · <b>Closed at 62.4%</b> · <b>312 push-ups completed together.</b> Unfinished is stated plainly and still ends on the total, not on the shortfall.' })}
    </div>
  </div>

  <div class="two">
    <div>
      <div class="sec-head">
        <div>
          <div class="eyebrow">800 × 1280 · A PICTURE FRAME ON A WALL</div>
          <h3>The one composition the lock records as intended rather than wired.</h3>
        </div>
      </div>
      <div class="phones" style="gap:34px">
        ${phone({ file: CUR('display-building-800x1280.png'), width: PORT, slot: PORT_SLOT, tag: 'fresh', tagText: BUILT, title: 'What a frame shows today', sub: `<b style="color:${NAVY}">data-layout="phone"</b>, asserted. <b>app/display/[goalId].tsx:74</b> reads <b>windowWidth >= 900</b>, so a frame below that takes the phone composition and the phone mark cap: <b>320px on an 800px frame — 40% of the width</b>, against 306px on a 390px phone, which is 78%. Twice the glass buys fourteen pixels of instrument.` })}
        ${phone({ file: TGT('TARGET-building-800x1280.png'), width: PORT, slot: PORT_SLOT, tag: 'seam', tagText: DRAWN, title: 'The intended distance composition', sub: 'The same column, breathing at frame scale: identity, the window, what is left, the recent strip, then the mark and the number given the lower half. <b>Drawn, not built</b> — the frame carries its own TARGET strip, and the route has no 800-wide layout to be this.' })}
      </div>
    </div>
    <div class="side">
      <div class="panel dark">
        <div class="eyebrow seam">QR-TO-JOIN · INTENDED SEAM · NOT WIRED</div>
        <p class="note" style="margin-top:8px">Both target frames beside this carry it: a placeholder block, <b style="color:${CREAM}">Scan to join in</b>, and <b style="color:${CREAM}">add your own count from your phone</b>. <b style="color:${CREAM}">The block is empty on purpose — there is no encoded code in the artwork</b>, and no current-build display renders any of it.</p>
        <p class="note" style="margin-top:8px">Per the lock it belongs only to shared portrait and wide displays, and is <b style="color:${CREAM}">omitted from the personal phone preview</b> — a preview in one hand has nobody to invite. It is on this board as a labelled seam and nowhere as a capability.</p>
      </div>
      <div class="panel">
        <div class="eyebrow quiet">WHY DISTANCE IS THE ONLY VARIABLE</div>
        <p class="note" style="margin-top:8px">What changes between these four boards is the <b>composition</b>, never the content: the same community, goal, period, exact total, capped percent, status, last-confirmed time and anonymous recent lines. A display that hides a number at one size would be lying at that size.</p>
      </div>
    </div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">1280 × 800 · A BOOTH SCREEN · CURRENT WIDE BUILD, AND THE REFINEMENT IT IS OWED</div>
        <h3>Two columns on one axis: who is moving and what toward, on the left; the mark and the exact result on the right.</h3>
      </div>
      <div class="how">The wide canvas is fixed and cannot scroll, so a frame <b style="color:${NAVY}">is</b> the whole screen. <b style="color:${NAVY}">SAMPLE DATA</b> on every capture is the emulator banner (<b style="color:${NAVY}">wsfUsingEmulators</b>) and never ships.</div>
    </div>
    <div class="phones" style="gap:16px">
      ${phone({ file: CUR('display-building-1280x800.png'), width: BOOTH, slot: BOOTH_SLOT, tag: 'fresh', tagText: BUILT, title: 'Ordinary, with the list', sub: 'The recent strip sits under the result in the right column. Mark width is <b>42% of the glass</b> here — <b>min(640, 0.42 × width)</b>.' })}
      ${phone({ file: CUR('display-reached-1280x800.png'), width: BOOTH, slot: BOOTH_SLOT, tag: 'fresh', tagText: BUILT, title: 'Reached, still open', sub: '<b>WE did it.</b> sits with the identity on the left; the fully green mark and <b>15 beyond our goal · still open</b> hold the right.' })}
      ${phone({ file: CUR('display-closedreached-1280x800.png'), width: BOOTH, slot: BOOTH_SLOT, tag: 'fresh', tagText: BUILT, title: 'Closed, reached', sub: '<b>Look what WE did.</b> with the CLOSED pill and the dated window. The result line becomes the sentence and the target drops to a quiet <b>Goal: 500 squats</b>.' })}
      ${phone({ file: TGT('TARGET-building-1280x800.png'), width: BOOTH, slot: BOOTH_SLOT, tag: 'seam', tagText: DRAWN, title: 'The refinement, drawn', sub: 'The mark and the number take the whole left column; the words, the recent strip and the QR seam take the right. Fixture is the batch-f one, not a continuation of the three beside it.' })}
    </div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">1920 × 1080 · A COLLECTIVE DISPLAY ACROSS A ROOM</div>
        <h3>The composition survives the jump. The type scale does not move with it — and that is where the refinement is owed.</h3>
      </div>
      <div class="how">Read out of the source, not off the frame: <b style="color:${NAVY}">weWidth = min(640, round(width × 0.42))</b>. At 1280 the cap is slack and the mark is 538px; at 1920 the cap binds and it is 640px — <b style="color:${NAVY}">42% of the glass becomes 33%</b>.</div>
    </div>
    <div class="phones" style="gap:24px">
      ${phone({ file: CUR('display-building-1920x1080.png'), width: WALL, slot: WALL_SLOT, tag: 'fresh', tagText: BUILT, title: 'Hall scale, today', sub: 'Every confirmed value is present and correct, and the two columns hold. But the mark, the title and the number are the booth’s sizes on half again as much glass, so the lower third is empty navy and the room reads a smaller number than it did at 1280.' })}
      ${phone({ file: CUR('display-reached-1920x1080.png'), width: WALL, slot: WALL_SLOT, tag: 'fresh', tagText: BUILT, title: 'Reached, at hall scale', sub: '515 of 500, 100% capped, the overshoot exact, the mark fully <b>#91CB7D</b>. The celebration copy stays the product’s own three words and grows no larger for the room.' })}
      ${phone({ file: TGT('TARGET-building-1920x1080.png'), width: WALL, slot: WALL_SLOT, tag: 'seam', tagText: DRAWN, title: 'What the room is owed', sub: 'The same two columns with the mark and the total scaled to the glass, the title at hall weight, and the recent strip given room. <b>Drawn, not built.</b> This is the refinement the lock names; nothing here is wired today.' })}
    </div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">WHEN THE POLL STOPS ANSWERING · FOUR DIFFERENT TRUTHS, NEVER ONE APOLOGY</div>
        <h3>A number that was confirmed is kept and stops being called current. A number that never existed is not invented.</h3>
      </div>
      <div class="how">Each of these was produced by making something fail or hang, and each says so in its filename — <b style="color:${NAVY}">INJECTED-NETWORK</b>, <b style="color:${NAVY}">INJECTED-DELAY</b>. None is an organic failure presented as one.</div>
    </div>
    <div class="phones">
      ${phone({ file: CUR('display-loading-INJECTED-DELAY-390x844.png'), width: F, slot: F_SLOT, tag: 'fresh', tagText: BUILT, title: 'Loading', sub: '<b>Loading display…</b> inside the same cream page and navy hero the ready state uses, so a cold load and every <b>Check again</b> do not flash navy and repaint cream. No total, asserted.' })}
      ${phone({ file: CUR('display-stale-INJECTED-NETWORK-390x844.png'), width: F, slot: F_SLOT, tag: 'fresh', tagText: BUILT, title: 'Stale · the number is kept', sub: 'A later poll failed. The confirmed <b>241 of 500</b> and the exact mark are <b>retained</b>; only the claim goes: <b>Connection interrupted</b> and <b>Last confirmed 11:16 PM</b>. The time does not move while nothing new is confirmed.' })}
      ${phone({ file: CUR('display-unreachable-INJECTED-NETWORK-390x844.png'), width: F, slot: F_SLOT, tag: 'fresh', tagText: BUILT, title: 'Unreachable · nothing to keep', sub: '<b>Nothing has been confirmed yet. Check again when you’re connected.</b> Before a first confirmation there is no number and no mark to preserve, and none is drawn. This is not stale, and the board does not treat it as one.' })}
      ${phone({ file: CUR('display-not-available-390x844.png'), width: F, slot: F_SLOT, tag: 'fresh', tagText: BUILT, title: 'The one refusal', sub: '<b>Nothing to show here · This display isn’t currently available.</b> Unknown goal, unauthorized viewer and an authorization revoked mid-poll are <b>one state</b>: telling them apart would make the screen an oracle for which goals exist. Context, total, mark and list leave together.' })}
    </div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">THE SAME FAILURES ACROSS A ROOM · WHERE COMPOSITION AND SEVERITY DISAGREE</div>
        <h3>The rules hold at every size. The drawing of them does not.</h3>
      </div>
    </div>
    <div class="phones" style="gap:24px">
      ${phone({ file: CUR('display-stale-INJECTED-NETWORK-1280x800.png'), width: WIDEFAIL, slot: WIDEFAIL_SLOT, tag: 'fresh', tagText: BUILT, title: 'Stale · 1280 × 800', sub: 'The pill and the last-confirmed time sit beside the wordmark; the number and mark stay put. Correct, and legible at booth distance.' })}
      ${phone({ file: CUR('display-stale-INJECTED-NETWORK-1920x1080.png'), width: WIDEFAIL, slot: WIDEFAIL_SLOT, tag: 'fresh', tagText: BUILT, title: 'Stale · 1920 × 1080', sub: `Same pill, same size. <b style="color:${NAVY}">freshness</b> and <b style="color:${NAVY}">freshnessText</b> carry no wide variant at all, so the one element telling a room the number is old is the least legible thing on the wall. A refinement item, not a truth failure.` })}
      ${phone({ file: CUR('display-not-available-1280x800.png'), width: WIDEFAIL, slot: WIDEFAIL_SLOT, tag: 'fresh', tagText: BUILT, title: 'Refused · 1280 × 800', sub: `The same two sentences and the same <b>Check again</b>, <b style="color:${NAVY}">pinned to the top edge</b>: <b>canvasWide</b> is <b>space-between</b> and the refusal renders only this block and the test note, so the lower two thirds is empty navy. The phone refusal is centred. Second refinement item.` })}
      ${phone({ file: CUR('display-recent-failure-INJECTED-NETWORK-1280x800.png'), width: WIDEFAIL, slot: WIDEFAIL_SLOT, tag: 'fresh', tagText: BUILT, title: 'The list failed · nothing else did', sub: 'The recent read is a second endpoint. When it fails the list <b>clears and nothing replaces it</b> — no empty heading, no “no activity yet” — while the pulse-confirmed total and mark stay and the screen does <b>not</b> go stale. Asserted, not inferred.' })}
    </div>
  </div>

  <div class="two">
    <div class="side">
      <div class="panel dark">
        <div class="eyebrow seam">STATUS LAYER · WHAT THIS BOARD ESTABLISHES, AND WHAT IT DOES NOT</div>
        <h3>A reference for a route that is built, beside a drawing of one that is not.</h3>
        <p class="note"><b style="color:${CREAM}">a · The public display route is CURRENT BUILD.</b> Twenty frames here are the real <b style="color:${CREAM}">/display/[goalId]</b> at canonical <b style="color:${CREAM}">7fbc45d</b>, produced by a gated local spec written for this packet. The route's page verdict is not this board's to give, and this board does not give it.</p>
        <p class="note" style="margin-top:8px"><b style="color:${CREAM}">b · The portrait composition and QR-to-join are TARGET / SEAM</b>, exactly as the lock labels them. Three frames carry their own burnt-in TARGET strip and are tagged again here. A target is never an after.</p>
        <p class="note" style="margin-top:8px"><b style="color:${CREAM}">c · Nothing here is hosted proof.</b> Local emulators, synthetic fixtures, <b style="color:${CREAM}">WSF_CAPTURE_FRAMES=1</b>; the ordinary run asserts all eleven cases and writes nothing. No product file, route, shared renderer or frozen frame was touched.</p>
        <p class="note" style="margin-top:8px"><b style="color:${CREAM}">d · The refinements named on this board are findings, not a redesign.</b> Three are stated because the source says so, not because a frame looked wrong: the 900px breakpoint, the 640px mark cap, and the freshness row having no wide variant. Whether to change any of them is an owner decision this board does not take.</p>
      </div>
      <div class="panel">
        <div class="eyebrow quiet">TWO FIXTURE SETS, NEITHER CONTINUING THE OTHER</div>
        <table>
          <tr><td class="k">Current build</td><td class="d"><b style="color:${NAVY}">Maple Street Movers</b> · Squats together this week · 241 of 500 · August push-ups · 312 of 500. The accepted display fixture's community, kept so the family reads as one set.</td></tr>
          <tr><td class="k">batch-f targets</td><td class="d"><b style="color:${NAVY}">Riverside Church</b> · October Push-Up Challenge · 6,420 of 10,000 push-ups. A different synthetic community and a different goal; no frame continues another, and the numbers are not comparable across the two sets.</td></tr>
        </table>
      </div>
    </div>
    <div class="side">
      <div class="panel">
        <div class="eyebrow quiet">THE LOCK · WHAT EVERY FRAME ABOVE OBEYS</div>
        <div class="rules">
          <div>Phone preview is <b>read-only</b>: cream page, navy hero, exact Living WE, anonymous additions, and <b>no member action, raised MOVE or tab bar</b>.</div>
          <div>Every composition shows the <b>same confirmed</b> community, goal, period, exact total, capped percent, status, last-confirmed time and recent lines.</div>
          <div><b>One exact / calibrated Living WE</b> per coherent display; <b>no individual identity anywhere</b>.</div>
          <div>The pulse polls every <b>2s</b>; a changed confirmed pulse renders immediately. <b>No Living-WE animation timing is approved</b>, and none is drawn.</div>
          <div>Recent additions are a <b>separate</b> read — first tick, then every 10s — at most <b>5 visible lines</b>, ages advancing locally.</div>
          <div>Recent lines are <b>{amount, unit, age} only</b> — never id, name or avatar.</div>
          <div><b>Stale</b> retains the last confirmed total and exact mark and stops presenting it as current.</div>
          <div>Before a first confirmation, a transient failure has <b>no number and no mark to preserve</b>.</div>
          <div><b>Refusal is terminal</b> for that polling session: context, total and list leave together.</div>
          <div>Recovery needs an explicit <b>Check again</b>; no automatic resurrection from an old in-flight response.</div>
          <div>A <b>recent-list failure clears only that list</b> and leaves the pulse-confirmed total intact.</div>
          <div>Reached / open, closed / reached and closed / unfinished stay distinct; <b>percent caps at 100%</b> while the overshoot stays visible in the exact total.</div>
        </div>
      </div>
      <div class="panel">
        <div class="eyebrow quiet">WHERE THIS BOARD IS HONEST ABOUT ITS OWN LIMITS</div>
        <table>
          <tr><td class="k">Not photographed</td><td class="d">Two locked data truths have <b style="color:${NAVY}">no frame</b> here because they are behaviour over time, not a picture: the <b style="color:${NAVY}">2s / 10s</b> cadence, and that a refusal cannot be resurrected by an earlier-issued success. Both are asserted in the repository's own <b style="color:${NAVY}">ui-display</b> suite; this board cites them rather than staging a picture of them.</td></tr>
          <tr><td class="k">One frame unused</td><td class="d">The capture set also holds <b style="color:${NAVY}">display-building-390x844</b>, which is the same state as the recent frame without the list. The list frame carries it, so it is not repeated here.</td></tr>
          <tr><td class="k">The emulator banner</td><td class="d"><b style="color:${NAVY}">SAMPLE DATA</b> is in every capture because <b style="color:${NAVY}">wsfUsingEmulators</b> is true; it never ships. On the cream phone page it is cream-on-cream and effectively invisible, so its absence from a phone frame is not evidence it is gone.</td></tr>
          <tr><td class="k">Not this board</td><td class="d">No member navigation, no join control, no kiosk or station chrome, no second mark, no animation. The QR seam is labelled and never wired.</td></tr>
        </table>
      </div>
    </div>
  </div>

  ${footer('WE_STAY_FIT_NORTH_STAR_BOARD_10_PUBLIC_DISPLAY_FINAL', 'SELF-CHECKED · INDEPENDENT REVIEW PENDING · PR #365 comment 5771496484 · current-build display at 7fbc45d, beside the batch-f portrait and wide targets')}
  `,
});
