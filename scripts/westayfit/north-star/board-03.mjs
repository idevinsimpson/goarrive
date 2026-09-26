/**
 * BOARD 03 — COMMUNITY.
 *
 * Locked by PR #365 comment 5771275765: "/community is the identity /
 * membership / switching surface; /community/[groupId] remains Home and is
 * not redesigned here." Status layer: "/community is ACCEPTED BUILD. The Join
 * placement inset is PRODUCT QUESTION / SEAM only."
 *
 * Frames: the accepted Page 3 AFTER evidence (docs/design-target/review/
 * page-03-community/after, accepted at a8f2ecf). Every state the lock names
 * has an accepted frame. The Join placement is drawn as a labelled question,
 * not as a screen.
 */
import path from 'node:path';
import { REPO, PHONE_W, SLOT_H, header, footer, page, phone, NAVY, CREAM, ON_NAVY_RULE, PROGRESS_GREEN, ON_NAVY_MUTED } from './lib.mjs';

const AFTER = (f) => path.join(REPO, 'docs/design-target/review/page-03-community/after', f);

export const width = 1280;
export const height = 1720;

const SMALL_W = 200;
const SMALL_SLOT = Math.round((844 / 390) * SMALL_W);

export const html = page({
  width,
  height,
  body: `
  ${header('03', 'Community')}

  <div class="copy">
    <div class="lead">Which community, and who you are in it.</div>
    <div class="gov">INTERNAL BOARD COPY — NOT IN-APP MESSAGING. THE ONLY GOVERNING PUBLIC COPY IS BOARD 00'S LOCKED PAIR.</div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">/community · ACCEPTED PAGE 3 EVIDENCE</div>
        <h3>Identity, role and member count lead; one compact Living WE on the current lead goal; other memberships as text and track.</h3>
      </div>
      <div class="how">The accepted AFTER frames at 3× — byte-frozen evidence the route was accepted on (a8f2ecf). Member counts are real counts of real membership rows; recent movement is <b style="color:${NAVY}">{amount, unit, age}</b> and never who.</div>
    </div>
    <div class="phones">
      ${phone({ file: AFTER('AFTER-several-current-390x844.png'), title: 'Several · one current', sub: 'The current community leads with identity, role, member count, the lead goal’s mark and anonymous recent movement. Others: Switch.' })}
      ${phone({ file: AFTER('AFTER-several-nocurrent-390x844.png'), title: 'Several · none remembered', sub: 'It asks. Every row is an equal Choose; nothing is marked CURRENT by convenience.' })}
      ${phone({ file: AFTER('AFTER-one-390x844.png'), title: 'One membership', sub: 'The same identity block, with nothing to switch to.' })}
      ${phone({ file: AFTER('AFTER-none-390x844.png'), title: 'No membership', sub: 'Join through an invite link or QR from someone already in a community, or start one. No Living WE without a shared ratio.' })}
    </div>
  </div>

  <div class="two">
    <div>
      <div class="sec-head">
        <div>
          <div class="eyebrow quiet">THREE STATES THAT MUST STAY DISTINCT</div>
          <h3>A failed read is never a fake empty list.</h3>
        </div>
      </div>
      <div class="phones" style="gap:26px">
        ${phone({ file: AFTER('AFTER-loading-390x844.png'), width: SMALL_W, slot: SMALL_SLOT, title: 'Loading', sub: 'The shell and the question, no invented rows.' })}
        ${phone({ file: AFTER('AFTER-partial-failure-390x844.png'), width: SMALL_W, slot: SMALL_SLOT, title: 'One community’s goals failed', sub: 'That community says so. The rest, the current one included, keep their progress.' })}
        ${phone({ file: AFTER('AFTER-failure-390x844.png'), width: SMALL_W, slot: SMALL_SLOT, title: 'The whole list failed', sub: 'An error with recovery — not “you are in no community.”' })}
      </div>
    </div>
    <div class="side">
      <div class="panel dark">
        <div class="eyebrow seam">JOIN PLACEMENT · AN EXPLICIT PRODUCT QUESTION · NOT A BUILD REQUEST</div>
        <h3>Where does “Join with a code” live?</h3>
        <p class="note">Accepted build: typed code entry exists on the resolver <b style="color:${CREAM}">/</b>; invite links and QR route to <b style="color:${CREAM}">/join/[joinCode]</b>; <b style="color:${CREAM}">no Join control is shipped on /community</b>.</p>
        <div style="margin-top:12px;border:1px dashed ${ON_NAVY_RULE};border-radius:12px;padding:12px 14px">
          <div style="font-size:10.5px;letter-spacing:1.3px;font-weight:900;color:${PROGRESS_GREEN}">OPTION · NOT IMPLEMENTED · OWNER DECISION</div>
          <div style="font-size:13px;line-height:18px;margin-top:6px;color:${CREAM}">A compact secondary <b>Join with a code</b> treatment on /community. It must not outrank Home, MOVE or <b>Start a community</b>, and it is not authorized by this board.</div>
        </div>
        <p class="note" style="margin-top:10px">Nothing here is a capture. The inset exists so the question is visible where a future pass will look for it.</p>
      </div>
      <div class="panel">
        <div class="eyebrow quiet">THE LOCK · WHAT EVERY FRAME ABOVE OBEYS</div>
        <div class="rules">
          <div><b>No faces, photos, named movers, reactions, rankings</b>, presence claims or “people moved” counts.</div>
          <div>Switch / Choose rows are <b>text and track</b>, never decorative Living WEs.</div>
          <div>A current-community failure <b>does not blank</b> the other memberships.</div>
          <div>Exact WSF wordmark, calibrated Living WE, Board 00 colours; the five-slot shell.</div>
        </div>
      </div>
    </div>
  </div>

  ${footer('WE_STAY_FIT_NORTH_STAR_BOARD_03_COMMUNITY_FINAL', 'LOCKED / ACCEPTED · PR #365 comment 5771275765 · accepted build, from the accepted Page 3 evidence; Join placement is a seam')}
  `,
});
