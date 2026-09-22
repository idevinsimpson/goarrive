/**
 * BOARD 04 — PROGRESS.
 *
 * Locked by PR #365 comment 5771310017: "/activity is ACCEPTED BUILD Phase A.
 * Private dated history is SEAM only." Frames: the accepted Page 4 AFTER
 * evidence (docs/design-target/review/page-04-progress/after, accepted at
 * aebd1aa).
 *
 * One state the lock names — "Nothing finished yet" — has no accepted
 * capture. It is flagged on the board and not drawn.
 */
import path from 'node:path';
import { REPO, header, footer, page, phone, NAVY, CREAM } from './lib.mjs';

const AFTER = (f) => path.join(REPO, 'docs/design-target/review/page-04-progress/after', f);

export const width = 1280;
export const height = 1560;

const W = 210;
const SLOT = Math.round((844 / 390) * W);

export const html = page({
  width,
  height,
  body: `
  ${header('04', 'Progress')}

  <div class="copy">
    <div class="lead">What you recorded. Private, not a score, never compared.</div>
    <div class="gov">INTERNAL BOARD COPY — NOT IN-APP MESSAGING. THE ONLY GOVERNING PUBLIC COPY IS BOARD 00'S LOCKED PAIR.</div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">/activity · ACCEPTED PAGE 4 EVIDENCE · PHASE A</div>
        <h3>A summary that counts goals, what you’re part of now, and what you’ve been part of — with exactly one Living WE, on the goal the community finished.</h3>
      </div>
      <div class="how">The accepted AFTER frames at 3× (aebd1aa). <b style="color:${NAVY}">recorded</b> is the governing verb throughout: the system knows a contribution was recorded, never that a person exercised.</div>
    </div>
    <div class="phones" style="gap:30px">
      ${phone({ file: AFTER('AFTER-rows-390x844.png'), width: W, slot: SLOT, title: 'Running and finished', sub: 'N goals you have added to · running · finished. Own credit, RECORDED, goal and community, the goal’s confirmed total and slim track. One mark, on the finished, reached goal.' })}
      ${phone({ file: AFTER('AFTER-empty-390x844.png'), width: W, slot: SLOT, title: 'Nothing recorded yet', sub: 'Distinct from “no goals exist”: goals with ownCredit ≤ 0 do not become personal-record rows.' })}
      ${phone({ file: AFTER('AFTER-loading-390x844.png'), width: W, slot: SLOT, title: 'Loading', sub: 'The page and its promise; no invented rows.' })}
      ${phone({ file: AFTER('AFTER-partial-failure-390x844.png'), width: W, slot: SLOT, title: 'Partial read', sub: 'What could be read is shown; a note says what could not. The record is unchanged.' })}
      ${phone({ file: AFTER('AFTER-failure-390x844.png'), width: W, slot: SLOT, title: 'Could not be loaded', sub: '“This is the reading, not the record.” Retry.' })}
    </div>
  </div>

  <div class="two">
    <div class="panel dark">
      <div class="eyebrow seam">PRIVATE DATED HISTORY · SEAM · NOT BUILT · NOT AUTHORIZED</div>
      <h3>No streak, no dates, no weekly totals, no contribution counts are drawn as shipped.</h3>
      <p class="note">The data exists in storage (<b style="color:${CREAM}">wsfContributions</b> carries a server timestamp per contribution) and <b style="color:${CREAM}">no callable returns it</b>. A future own-only history would require an approved callable contract for {count, unit, createdAt}, bounded pagination and retention, timezone and day-boundary semantics, idempotent attempts and timestamp meaning, and privacy / data-access controls — with owner and privacy review before any backend or UI implementation.</p>
      <p class="note" style="margin-top:8px">The contract that would be needed is written at <b style="color:${CREAM}">review/page-04-progress/PRIVATE-HISTORY-CONTRACT.md</b>. Nothing on this board implements it.</p>
    </div>
    <div class="side">
      <div class="panel">
        <div class="eyebrow quiet">THE LOCK · WHAT EVERY FRAME ABOVE OBEYS</div>
        <div class="rules">
          <div>The summary counts <b>goals only</b> and never adds unlike units.</div>
          <div><b>No Living WE on ordinary running rows.</b> Exactly one, on the most recent finished goal with a real final shared ratio — the shared celebration, not a score of the member’s part.</div>
          <div>Finished rows keep the member’s own part, goal and community, end context, and reached / not-reached truth.</div>
          <div>No cross-goal totals, no own/share ratio, no rankings or comparison, no named public figures, no community-wide ticker presented as personal activity.</div>
        </div>
      </div>
      <div class="panel">
        <div class="eyebrow quiet">ONE STATE, INSIDE ANOTHER FRAME</div>
        <table>
          <tr><td class="k">Nothing finished yet</td><td class="d">The accepted evidence holds no standalone frame for it; it is on the board inside the <b style="color:${NAVY}">Partial read</b> frame (2 goals \u00b7 0 finished \u00b7 \u201cNothing finished yet \u2014 when a goal you have added to ends, it stays here\u201d). Finished rows have simply not arrived; an unreached closed goal still belongs in the finished record when the member contributed.</td></tr>
        </table>
      </div>
    </div>
  </div>

  ${footer('WE_STAY_FIT_NORTH_STAR_BOARD_04_PROGRESS_FINAL', 'LOCKED / ACCEPTED · PR #365 comment 5771310017 · accepted build Phase A, from the accepted Page 4 evidence; dated history is a seam')}
  `,
});
