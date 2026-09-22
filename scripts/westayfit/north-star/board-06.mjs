/**
 * BOARD 06 — CREATE / JOIN / AUTH.
 *
 * Locked by PR #365 comment 5771368550: "Visual-reference verdict only... This
 * board does NOT promote the underlying routes to accepted-page status; it
 * records the current build truth and the intended visual grammar." Status
 * layer, from that lock: "Board 06 surfaces are CURRENT BUILD / REVIEW, not
 * accepted Pages 1-5."
 *
 * So this board carries THREE provenances and never blurs them:
 *
 *   CURRENT BUILD / CAPTURED  the routes that are built and are being reviewed
 *                             -- `/join/[joinCode]` (batch-b `after/`) and the
 *                             identity funnel (batch-a `after/`). Real captures
 *                             of the real routes, read in place. Neither set is
 *                             an accepted page: batch-a is frozen only so a
 *                             routine run cannot change what is under review,
 *                             and batch-b's `after/` is deliberately not frozen
 *                             at all, because it has not been reviewed.
 *
 *   TARGET / NOT IMPLEMENTED  `/start-community` -- drawn, never built. These
 *                             frames carry their own TARGET strip burnt into
 *                             the image, and are tagged again here. A target is
 *                             never an after.
 *
 * `/goals/new` and `/combined/[setupId]` are also unbuilt. They are named on
 * the seam panel rather than drawn, because this board's lock is create / join
 * / auth and a goal being opened belongs to Board 08.
 *
 * NO LIVING WE APPEARS ANYWHERE ON THIS BOARD. The lock forbids it on setup and
 * auth surfaces without a confirmed ratio, and not one of these screens has a
 * shared total to be a ratio of.
 */
import path from 'node:path';
import { REPO, header, footer, page, phone, NAVY, CREAM } from './lib.mjs';

const IDENT = (f) => path.join(REPO, 'docs/design-target/review/batch-a-identity/after', f);
const JOIN = (f) => path.join(REPO, 'docs/design-target/review/batch-b-join-and-setup/after', f);
const TARGET = (f) => path.join(REPO, 'docs/design-target/review/batch-b-join-and-setup', f);

export const width = 1280;
export const height = 3860;

const W = 268;
const SLOT = Math.round((844 / 390) * W);
const SMALL_W = 200;
const SMALL_SLOT = Math.round((844 / 390) * SMALL_W);

const BUILT = 'CURRENT BUILD · CAPTURED';
const DRAWN = 'TARGET · NOT IMPLEMENTED';

export const html = page({
  width,
  height,
  body: `
  ${header('06', 'Create / join / auth')}

  <div class="copy">
    <div class="lead">One link, one account, and the community a Champion starts.</div>
    <div class="gov">INTERNAL BOARD COPY — NOT IN-APP MESSAGING. THE ONLY GOVERNING PUBLIC COPY IS BOARD 00'S LOCKED PAIR.</div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">THE INVITATION · /join/[joinCode] · BUILT, UNDER REVIEW</div>
        <h3>The link says what joining means before it asks for anything, and it never says whether a community exists.</h3>
      </div>
      <div class="how">Real captures of the built route at 2× (<b style="color:${NAVY}">batch-b .../after</b>), read in place. Implemented and awaiting visual and functional acceptance — <b style="color:${NAVY}">not</b> an accepted page. Community and names are fixtures.</div>
    </div>
    <div class="phones">
      ${phone({ file: JOIN('AFTER-invite-out-390x844.png'), width: W, slot: SLOT, tag: 'fresh', tagText: BUILT, title: 'Signed out · the invitation', sub: '“What joining means” is three existing capabilities and nothing else: see the goals and shared progress, add your own contributions, leave whenever you like. “You’ll need a free account first.” One filled <b style="color:' + NAVY + '">Sign up to join</b>; sign-in stays text weight.' })}
      ${phone({ file: JOIN('AFTER-invite-in-390x844.png'), width: W, slot: SLOT, tag: 'fresh', tagText: BUILT, title: 'Signed in · one primary action', sub: 'The same invitation with the account already in hand: one primary <b style="color:' + NAVY + '">Join</b> for this community. The forwarding truth is on the card — anyone with the link can join, including anyone it is forwarded to, until a new link is created.' })}
      ${phone({ file: JOIN('AFTER-device-choice-390x844.png'), width: W, slot: SLOT, tag: 'fresh', tagText: BUILT, title: 'Arrived from an event', sub: 'Asked only of a signed-out visitor arriving from event context, before an account would exist. An ordinary community invitation never sees this question.' })}
      ${phone({ file: JOIN('AFTER-device-shared-390x844.png'), width: W, slot: SLOT, tag: 'fresh', tagText: BUILT, title: 'Shared screen · no account', sub: 'The shared answer creates no account and routes to the shared-device path. <b style="color:' + NAVY + '">Use my own phone instead</b> stays a real escape from a remembered answer.' })}
    </div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">THE FUNNEL THE CODE SURVIVES · BUILT, UNDER REVIEW</div>
        <h3>A pending join code outlives sign-up, verification and profile setup, and lands back on the same invitation.</h3>
      </div>
      <div class="how">Real captures of the identity routes at 2× (<b style="color:${NAVY}">batch-a .../after</b>), read in place. Frozen only so a routine run cannot change what is under review — freezing is not acceptance.</div>
    </div>
    <div class="phones" style="gap:26px">
      ${phone({ file: IDENT('AFTER-signup-390x844.png'), width: SMALL_W, slot: SMALL_SLOT, tag: 'fresh', tagText: BUILT, title: '1 · Sign up', sub: 'The free account the invitation said would be needed.' })}
      ${phone({ file: IDENT('AFTER-verify-carrying-390x844.png'), width: SMALL_W, slot: SMALL_SLOT, tag: 'fresh', tagText: BUILT, title: '2 · Verify, still carrying', sub: 'The destination is still named while the address is confirmed.' })}
      ${phone({ file: IDENT('AFTER-profile-carrying-390x844.png'), width: SMALL_W, slot: SMALL_SLOT, tag: 'fresh', tagText: BUILT, title: '3 · Profile, still carrying', sub: 'The last step before the join fires — a join against a profile that does not exist yet would fail.' })}
      ${phone({ file: IDENT('AFTER-return-join-390x844.png'), width: SMALL_W, slot: SMALL_SLOT, tag: 'fresh', tagText: BUILT, title: '4 · Back to the same invitation', sub: 'The terminal hop, and the same community that was opened at the start.' })}
    </div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">WHEN THE LINK DOES NOT OPEN · FOUR TRUTHS THAT STAY APART</div>
        <h3>Invalid, private and never-existed are one answer, so the page cannot be asked whether a community is real.</h3>
      </div>
      <div class="how">The invalid state offers <b style="color:${NAVY}">no retry</b>: a retry is what would turn a link into an existence oracle. Rate limiting blames the link load, not the person.</div>
    </div>
    <div class="phones" style="gap:26px">
      ${phone({ file: JOIN('AFTER-not-valid-390x844.png'), width: SMALL_W, slot: SMALL_SLOT, tag: 'fresh', tagText: BUILT, title: 'Not valid', sub: 'One state for invalid, private and nonexistent alike. “Ask the person who shared it to send you a new one.” No retry, and no hint either way.' })}
      ${phone({ file: JOIN('AFTER-too-many-390x844.png'), width: SMALL_W, slot: SMALL_SLOT, tag: 'fresh', tagText: BUILT, title: 'Too many attempts', sub: 'Distinct from invalid. The limit is on the link being loaded, not an accusation about the visitor.' })}
      ${phone({ file: JOIN('AFTER-load-failed-390x844.png'), width: SMALL_W, slot: SMALL_SLOT, tag: 'fresh', tagText: BUILT, title: 'The preview did not load', sub: 'A generic read failure, kept apart from “not valid” — this one may honestly be retried, because it claims nothing about the link.' })}
      ${phone({ file: JOIN('AFTER-working-390x844.png'), width: SMALL_W, slot: SMALL_SLOT, tag: 'fresh', tagText: BUILT, title: 'Joining', sub: 'The write in flight. No membership is claimed before the server confirms one.' })}
    </div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">WHAT A CHAMPION STARTS · /start-community · DRAWN, NOT BUILT</div>
        <h3>Family and friends is private by default; any other community is anyone-with-the-link; public is opt-in and still not discoverable.</h3>
      </div>
      <div class="how">These five are <b style="color:${NAVY}">drawings</b> from batch-b, read in place. Each carries its own TARGET strip burnt into the image, and is tagged again here. <b style="color:${NAVY}">A target is never an after.</b></div>
    </div>
    <div class="phones" style="gap:26px">
      ${phone({ file: TARGET('TARGET-start-signin-390x844.png'), width: SMALL_W, slot: SMALL_SLOT, tag: 'seam', tagText: DRAWN, title: 'Signed out → Sign in', sub: 'Starting a community needs an account, like joining one does.' })}
      ${phone({ file: TARGET('TARGET-start-verify-390x844.png'), width: SMALL_W, slot: SMALL_SLOT, tag: 'seam', tagText: DRAWN, title: 'Unverified → Verify email', sub: 'The same gate the join funnel uses, in the same order.' })}
      ${phone({ file: TARGET('TARGET-start-form-390x844.png'), width: SMALL_W, slot: SMALL_SLOT, tag: 'seam', tagText: DRAWN, title: 'Family and friends → Private', sub: 'One primary <b style="color:' + NAVY + '">Create community</b>. Private is not link-joinable and there is no add-by-name path, so a private community holds only its creator today — the form says so rather than leaving it to be discovered.' })}
      ${phone({ file: TARGET('TARGET-start-form-other-390x844.png'), width: SMALL_W, slot: SMALL_SLOT, tag: 'seam', tagText: DRAWN, title: 'Other → Anyone with the link', sub: 'The default that makes a community joinable. Public remains opt-in on top of it, and public still means undiscoverable: no directory, no search, no listing.' })}
      ${phone({ file: TARGET('TARGET-start-name-missing-390x844.png'), width: SMALL_W, slot: SMALL_SLOT, tag: 'seam', tagText: DRAWN, title: 'A name that will not do', sub: 'The complaint arrives after the attempt, not while the first letter is being typed.' })}
    </div>
  </div>

  <div class="two">
    <div class="panel dark">
      <div class="eyebrow seam">STATUS LAYER · WHAT THIS BOARD DOES NOT PROMOTE</div>
      <h3>Nothing here becomes an accepted page by appearing on a board.</h3>
      <p class="note">The lock is explicit: <b style="color:${CREAM}">“This board does NOT promote the underlying routes to accepted-page status; it records the current build truth and the intended visual grammar.”</b> The built frames are <b style="color:${CREAM}">CURRENT BUILD / REVIEW</b>, not Pages 1–5. <b style="color:${CREAM}">/join/[joinCode]</b> is implemented and awaiting acceptance; the identity funnel is submitted and frozen against routine runs, which guards what is under review rather than blessing it.</p>
      <p class="note" style="margin-top:8px"><b style="color:${CREAM}">/start-community</b> is drawn and not built. <b style="color:${CREAM}">/goals/new</b> and <b style="color:${CREAM}">/combined/[setupId]</b> are unbuilt too; they are named here and not drawn, because opening a goal belongs to Board 08 and a board should not annex its neighbour's subject to look complete.</p>
      <p class="note" style="margin-top:8px"><b style="color:${CREAM}">No Living WE appears on this board.</b> The lock forbids it on setup and auth surfaces without a confirmed ratio, and none of these screens has a shared total to be a ratio of. The wordmark carries the brand instead.</p>
    </div>
    <div class="side">
      <div class="panel">
        <div class="eyebrow quiet">THE LOCK · WHAT EVERY FRAME ABOVE OBEYS</div>
        <div class="rules">
          <div><b>Private / nonexistent share one invalid state</b>, so the page is never a community-existence oracle.</div>
          <div><b>No retry on invalid</b> — a retry is the leak. The generic load failure may retry, because it claims nothing.</div>
          <div>The preview exposes <b>only safe link-joinable metadata</b>.</div>
          <div><b>What joining means</b> is limited to capabilities that exist today.</div>
          <div>Signed out gets one filled <b>Sign up to join</b>; sign-in stays text weight.</div>
          <div>Signed in gets <b>one primary Join</b> for the named community.</div>
          <div>A pending join code <b>survives signup → verify → profile</b> and returns to the same invitation.</div>
          <div>The device question is asked <b>only from event context</b>, never on an ordinary invitation.</div>
          <div><b>Use my own phone instead</b> remains a real escape from a remembered shared-screen answer.</div>
          <div>Rate limiting <b>blames the link load</b>, not the person.</div>
          <div><b>No directory, no search</b>, no fake people, activity or counts.</div>
          <div>Exact WSF assets, one obvious primary per form, and <b>no Living WE without a confirmed ratio</b>.</div>
        </div>
      </div>
      <div class="panel">
        <div class="eyebrow quiet">WHERE THE BOARD IS HONEST ABOUT ITS OWN LIMITS</div>
        <table>
          <tr><td class="k">Three provenances</td><td class="d">Two tags do the work: <b style="color:${NAVY}">CURRENT BUILD · CAPTURED</b> for a real capture of a built route under review, <b style="color:${NAVY}">TARGET · NOT IMPLEMENTED</b> for a drawing. No frame on this board carries an accepted-build tag, because none of these routes is an accepted page.</td></tr>
          <tr><td class="k">Fixtures</td><td class="d">“Harbor Walkers” and the addresses are synthetic. No real community, person or invite link appears.</td></tr>
          <tr><td class="k">Not drawn here</td><td class="d">The reset-password and auth-error surfaces exist in batch-a and belong to the identity story rather than to create / join; the arrival states at 390×640 and 430×932 exist for every frame above and are not reproduced on a board at this width.</td></tr>
        </table>
      </div>
    </div>
  </div>

  ${footer('WE_STAY_FIT_NORTH_STAR_BOARD_06_CREATE_JOIN_AUTH_FINAL', 'SELF-CHECKED · INDEPENDENT REVIEW PENDING · PR #365 comment 5771368550 · current build / review, not an accepted page')}
  `,
});
