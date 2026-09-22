/**
 * BOARD 05 — YOU.
 *
 * Locked by PR #365 comment 5771338856: "/you is ACCEPTED BUILD. Private
 * dated-history capability remains the separate unbuilt seam already
 * documented under Progress." Frames: the accepted Page 5 AFTER evidence
 * (docs/design-target/review/page-05-you/after, accepted at 7e788a9). Every
 * state the lock names has an accepted frame.
 */
import path from 'node:path';
import { REPO, header, footer, page, phone, NAVY } from './lib.mjs';

const AFTER = (f) => path.join(REPO, 'docs/design-target/review/page-05-you/after', f);

export const width = 1280;
export const height = 1720;

const SMALL_W = 200;
const SMALL_SLOT = Math.round((844 / 390) * SMALL_W);

export const html = page({
  width,
  height,
  body: `
  ${header('05', 'You')}

  <div class="copy">
    <div class="lead">Who you are here. Your part, apart from the WE.</div>
    <div class="gov">INTERNAL BOARD COPY — NOT IN-APP MESSAGING. THE ONLY GOVERNING PUBLIC COPY IS BOARD 00'S LOCKED PAIR.</div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">/you · ACCEPTED PAGE 5 EVIDENCE</div>
        <h3>One navy identity field with Sign out above the fold; the selected community; one dominant Living WE on its real open goal; your exact part, separately labelled.</h3>
      </div>
      <div class="how">The accepted AFTER frames at 3× (7e788a9). The identity is text only: no photo, quote, badge, score or rank. The display name and email are fixture values.</div>
    </div>
    <div class="phones">
      ${phone({ file: AFTER('AFTER-member-390x844.png'), title: 'Member', sub: 'Identity · Where you move (selected community, returned role and member count) · YOUR PART beside “The community is at …” · other goals as compact rows.' })}
      ${phone({ file: AFTER('AFTER-pickcommunity-390x844.png'), title: 'Which community?', sub: '“You are in N communities.” + Choose a community. Nothing is picked behind the member’s back.' })}
      ${phone({ file: AFTER('AFTER-nocommunity-390x844.png'), title: 'Not in a community yet', sub: 'The real community-entry path, and nothing invented to fill the space.' })}
      ${phone({ file: AFTER('AFTER-failed-390x844.png'), title: 'Goals could not be loaded', sub: 'Identity and Sign out survive. “Nothing of yours has changed.” + retry.' })}
    </div>
  </div>

  <div class="two">
    <div>
      <div class="sec-head">
        <div>
          <div class="eyebrow quiet">TWO MORE STATES</div>
          <h3>A skeleton is not a result; signed out shows no name.</h3>
        </div>
      </div>
      <div class="phones" style="gap:26px">
        ${phone({ file: AFTER('AFTER-loading-390x844.png'), width: SMALL_W, slot: SMALL_SLOT, title: 'Loading', sub: 'Identity and shell skeleton; no invented result.' })}
        ${phone({ file: AFTER('AFTER-signedout-390x844.png'), width: SMALL_W, slot: SMALL_SLOT, title: 'Signed out', sub: 'The navy You field and Sign in. No member tab bar, no raised MOVE, no name or email exposed.' })}
      </div>
    </div>
    <div class="side">
      <div class="panel">
        <div class="eyebrow quiet">THE LOCK · WHAT EVERY FRAME ABOVE OBEYS</div>
        <div class="rules">
          <div><b>Identity is one navy field</b>: white wordmark, YOU, real display name, member-since month/year, quiet email, Sign out above the fold.</div>
          <div><b>No</b> photo, avatar, quote, bio, badge, score, rank or other invented personal identity.</div>
          <div>Where you move is the <b>selected</b> community and its returned role and member count — no silent selection.</div>
          <div>Exactly <b>one dominant Living WE</b>, on the selected community’s real open-goal shared ratio.</div>
          <div>YOUR PART stays labelled apart from “The community is at …”: <b>no own/share ratio</b>, no “you moved us from X to Y”.</div>
          <div>No cross-unit totals, dated history, weekly counts, streaks, social features, notifications, profile sharing, duplicate leave control, or coaching.</div>
          <div><b>Sign out is available on every resolved signed-in state</b>, including failure.</div>
        </div>
      </div>
      <div class="panel">
        <div class="eyebrow quiet">SEAM · ALREADY DOCUMENTED UNDER BOARD 04</div>
        <p class="note" style="margin-top:8px">Private dated-history capability is the same unbuilt, unauthorized seam Board 04 records. Nothing on You claims it.</p>
      </div>
    </div>
  </div>

  ${footer('WE_STAY_FIT_NORTH_STAR_BOARD_05_YOU_FINAL', 'LOCKED / ACCEPTED · PR #365 comment 5771338856 · accepted build, from the accepted Page 5 evidence')}
  `,
});
