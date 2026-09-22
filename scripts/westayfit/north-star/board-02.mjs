/**
 * BOARD 02 — MOVE.
 *
 * Locked by PR #365 comment 5771235529: "Board 02 now clears the MOVE +
 * contribution + confirmation North Star gate." Status layer, from the lock:
 * "/move and /contribute/[goalId] are ACCEPTED BUILD; this board is a North
 * Star refinement of accepted behavior, not proof of new capability."
 *
 * So the frames are the accepted Page 2 AFTER evidence — the byte-frozen
 * captures the route was accepted on (docs/design-target/review/page-02-move/
 * after, accepted at dd608a8) — plus two confirmations the lock names that
 * the AFTER set never photographed, captured by
 * north-star-board-02-capture.spec.ts through the real flow.
 */
import path from 'node:path';
import { REPO, PHONE_W, SLOT_H, header, footer, page, phone, NAVY } from './lib.mjs';

const AFTER = (f) => path.join(REPO, 'docs/design-target/review/page-02-move/after', f);
const CAP = (f) => path.join(REPO, 'docs/design-target/north-star-final/board-02/captures', f);

export const width = 1280;
export const height = 2470;

const SMALL_W = 200;
const SMALL_SLOT = Math.round((844 / 390) * SMALL_W);

export const html = page({
  width,
  height,
  body: `
  ${header('02', 'MOVE')}

  <div class="copy">
    <div class="lead">One raised action. One confirmed total. Never a prediction.</div>
    <div class="gov">INTERNAL BOARD COPY — NOT IN-APP MESSAGING. THE ONLY GOVERNING PUBLIC COPY IS BOARD 00'S LOCKED PAIR.</div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">THE JOURNEY · ACCEPTED PAGE 2 EVIDENCE</div>
        <h3>MOVE asks which goal; the contribution anchors to it; the review shows only your own credit.</h3>
      </div>
      <div class="how">The accepted AFTER frames of <b style="color:${NAVY}">/move</b> and <b style="color:${NAVY}">/contribute/[goalId]</b> at 2× — the byte-frozen evidence the route was accepted on (dd608a8). Fixture community and totals are synthetic.</div>
    </div>
    <div class="phones">
      ${phone({ file: AFTER('AFTER-move-choose-390x844.png'), title: 'MOVE · which goal?', sub: 'A focused chooser over the real Home context. Only open goals are selectable.' })}
      ${phone({ file: AFTER('AFTER-contribute-move-390x844.png'), title: 'Ready to move', sub: 'Anchored to the confirmed community goal, one calibrated Living WE. The timer guides movement and counts nobody.' })}
      ${phone({ file: AFTER('AFTER-contribute-entry-390x844.png'), title: 'Amount', sub: 'What you did, in the goal’s unit. The shared total is not touched until the server says so.' })}
      ${phone({ file: AFTER('AFTER-contribute-review-390x844.png'), title: 'Review · your own credit only', sub: 'Previews the member’s own part before and after. The pre-write shared total is never predicted.' })}
    </div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">THE CONFIRMED MOMENT · THE ONE MEMBER SCREEN THAT EARNS A FULL NAVY FIELD</div>
        <h3>The server-confirmed receipt owns the new shared total, and the Living WE moves from that receipt.</h3>
      </div>
      <div class="how">Exact result copy stays authoritative. <b style="color:${NAVY}">Record more &lt;unit&gt;</b> appears only where the repeat policy and server state permit it.</div>
    </div>
    <div class="phones">
      ${phone({ file: AFTER('AFTER-contribute-confirmed-390x844.png'), title: 'Confirmed · ordinary', sub: '1,847 → 1,867 of 5,000 · "You moved us closer." · the mark fills from the receipt.' })}
      ${phone({ file: CAP('confirmed-reached-open-390x844.png'), tag: 'fresh', title: 'Confirmed · reached, still open', sub: '495 + 20 = 515 of 500 · "Our goal is reached." · the mark is fully #91CB7D; the goal stays open.' })}
      ${phone({ file: CAP('confirmed-post-target-390x844.png'), tag: 'fresh', title: 'Confirmed · after the goal was met', sub: '512 + 20 = 532 of 500 · percent capped at 100% · "32 beyond our goal · still open" keeps the overshoot.' })}
      ${phone({ file: AFTER('AFTER-contribute-confirmed-390x640.png'), title: '390 × 640 · confirmed', sub: 'The result, the mark and the next action inside the first viewport on the short phone.' })}
    </div>
  </div>

  <div class="two">
    <div>
      <div class="sec-head">
        <div>
          <div class="eyebrow quiet">WHEN THE WRITE DOES NOT LAND · TWO DIFFERENT TRUTHS</div>
          <h3>Unknown is not refused.</h3>
        </div>
      </div>
      <div class="phones" style="gap:26px">
        ${phone({ file: AFTER('AFTER-contribute-pending-390x844.png'), width: SMALL_W, slot: SMALL_SLOT, title: 'Unknown outcome', sub: 'No shared-goal anchor, no progress claim. The same attempt is kept for safe reconciliation — it cannot count twice.' })}
        ${phone({ file: AFTER('AFTER-contribute-refused-390x844.png'), width: SMALL_W, slot: SMALL_SLOT, title: 'Definitive refusal', sub: 'The server said no, and why, in human copy. Distinct from not knowing.' })}
        ${phone({ file: AFTER('AFTER-move-nogoal-390x844.png'), width: SMALL_W, slot: SMALL_SLOT, title: 'MOVE · nothing running', sub: 'No Living WE without a ratio. Past contributions stay in Progress; a new one needs an open goal.' })}
      </div>
    </div>
    <div class="side">
      <div class="panel">
        <div class="eyebrow quiet">THE LOCK · WHAT EVERY FRAME ABOVE OBEYS</div>
        <div class="rules">
          <div><b>The pre-write shared total is never predicted.</b> Review shows the member’s own credit only.</div>
          <div><b>The receipt owns the new total.</b> The Living WE updates from what the server confirmed.</div>
          <div><b>Reached / open</b> keeps a full mark and truthful open-state copy; contributing stays possible.</div>
          <div><b>Post-target</b> keeps the mark full, the percent at 100%, and the overshoot in the exact total.</div>
          <div><b>Unknown outcome</b> anchors to no goal and claims no progress; the attempt is preserved.</div>
          <div><b>Refusal</b> is definitive and distinct from unknown.</div>
          <div>The <b>timer</b> may guide movement. It never counts the person.</div>
          <div>Kiosk and event infrastructure are contextual and separate from this ordinary member flow.</div>
        </div>
      </div>
      <div class="panel">
        <div class="eyebrow quiet">WHERE THE ACCEPTED BUILD READS DIFFERENTLY FROM THE LOCK’S FIXTURE</div>
        <table>
          <tr><td class="k">Numbers</td><td class="d">The lock’s illustrative fixture was 241 → 261 of 500 and own credit 120 → 140. The accepted evidence carries the accepted fixture, 1,847 → 1,867 of 5,000; the two new confirmations use 500-target fixtures so the reached and post-target states are exact.</td></tr>
          <tr><td class="k">Crossing claim</td><td class="d">The receipt contract carries <code>crossedTarget</code> but the server does not raise it yet, so the member whose attempt crossed reads the state truth “Our goal is reached.” and no “this one took us past” line. The frame shows what the product says.</td></tr>
          <tr><td class="k">Not on this board</td><td class="d">No predicted total, no per-person counting from the timer, no kiosk or event chrome, no celebration copy beyond the exact result.</td></tr>
        </table>
      </div>
    </div>
  </div>

  ${footer('WE_STAY_FIT_NORTH_STAR_BOARD_02_MOVE_FINAL', 'LOCKED / ACCEPTED · PR #365 comment 5771235529 · accepted build, from the accepted Page 2 evidence plus two captured confirmations')}
  `,
});
