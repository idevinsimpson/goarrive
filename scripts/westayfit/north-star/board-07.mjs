/**
 * BOARD 07 — CHAMPION MANAGEMENT.
 *
 * Locked by PR #365 comment 5771412585: "Board 07 locks Champion management
 * around the product capability that actually exists: a contextual Manage
 * sheet over Home/Community. It does NOT invent a separate admin product."
 * Status layer, from that lock: "current Manage sheet = BUILT / current-build
 * review; dedicated dashboard beyond it = NOT BUILT."
 *
 * FRAMES. Seventeen, all from docs/design-target/review/champion-manage/after,
 * captured by W4 at 5356e3cff2808b52ebc6ac0d3ac5dca24fcfe9de and read in
 * place. Nothing here was drawn, copied, re-captured or altered.
 *
 * TWO PROVENANCES, AND THEY ARE NOT THE SAME FACT.
 *
 *   ACCEPTED BUILD / LATER CAPTURE   the three `page-*` frames. They are Home
 *                             itself -- `/community/[groupId]` IS Page 1
 *                             (app/index.tsx redirects `/` there), accepted at
 *                             3562156 and recorded in
 *                             .github/wsf-staging/approved-candidate.json.
 *                             Exactly two commits touched that route between
 *                             the acceptance and this capture: 6e1ce26, which
 *                             removed the 104px mini Living WEs from secondary
 *                             and closed goal rows so the mark is drawn once
 *                             per screen, and e609c57, which fixed the hero's
 *                             "Try again" from navy on navy. So these are a
 *                             later capture OF an accepted route -- a fact
 *                             about the frame, not about the route's standing.
 *
 *   CURRENT BUILD / CAPTURED  the fourteen Manage-sheet frames. The lock puts
 *                             the sheet at current-build review, and that
 *                             governs -- even though `renderManageSheet` is
 *                             766 lines that are BYTE-IDENTICAL between
 *                             3562156 and 5356e3c. The page verdict rested on
 *                             frames that never open the sheet. Not
 *                             photographed is not the same as not accepted,
 *                             and it is not the same as accepted either.
 *
 * ONE LIVING WE APPEARS ON THIS BOARD, and it is the real one: Home's
 * shared-goal instrument behind the contextual entry, at the goal's confirmed
 * 14,460 of 30,000. The lock forbids a decorative mark inside management, and
 * there is none: the producer asserts it by locator count on every sheet
 * state, and all fourteen sheet frames were read here at 2x as well.
 */
import path from 'node:path';
import { REPO, header, footer, page, phone, NAVY, CREAM } from './lib.mjs';

const CM = (f) => path.join(REPO, 'docs/design-target/review/champion-manage/after', f);

const BUILT = 'CURRENT BUILD · CAPTURED';
const ACCEPTED_LATER = 'ACCEPTED BUILD · LATER CAPTURE';

export const width = 1280;
export const height = 5640;

const W = 268;
const SLOT = Math.round((844 / 390) * W);

export const html = page({
  width,
  height,
  body: `
  ${header('07', 'Champion management')}

  <div class="copy">
    <div class="lead">A Champion stays a member. The tools are a sheet, not a second product.</div>
    <div class="gov">INTERNAL BOARD COPY — NOT IN-APP MESSAGING. THE ONLY GOVERNING PUBLIC COPY IS BOARD 00'S LOCKED PAIR.</div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">THE CONTEXTUAL ENTRY · ONE QUIET CONTROL, AND EVERYTHING BEHIND IT</div>
        <h3>Home stays member-first and carries the only Living WE. Manage opens over it, community-first, never navigates anywhere, and groups the tools rather than spraying them.</h3>
      </div>
      <div class="how">Home is <b style="color:${NAVY}">/community/[groupId]</b> — accepted Page 1, captured again at <b style="color:${NAVY}">5356e3c</b>. The sheet is capped at 88% of the viewport, which is why the short phone is a reachability question and not a duplicate.</div>
    </div>
    <div class="phones">
      ${phone({ file: CM('page-invite-not-ready-390x844.png'), width: W, slot: SLOT, tag: 'real', tagText: ACCEPTED_LATER, title: 'Home · the instrument, and the control', sub: `<b style="color:${NAVY}">YOUR COMMUNITY · Harbor Walkers · 1 member · moving together this week</b>, the real Living WE at 14,460 of 30,000 squats, and one quiet <b style="color:${NAVY}">Manage</b> pill in the header. This is the whole Champion affordance on Home. <b style="color:${NAVY}">The frame's filename names a state this crop does not show</b>: the “invite link isn’t ready” message sits below this fold, so the board uses this frame for the arrival and claims nothing about that state.` })}
      ${phone({ file: CM('manage-entry-390x844.png'), width: W, slot: SLOT, tag: 'fresh', tagText: BUILT, title: 'Manage · arrival', sub: 'A bottom sheet over a dimmed Home, with the grab handle, the eyebrow <b>CHAMPION TOOLS</b>, the community’s real name, a state line and <b>Close</b>. It opens on <b>Your event</b> — so a board that framed this on Goals would be framing a scrolled position, not the arrival.' })}
      ${phone({ file: CM('manage-entry-390x640.png'), width: W, slot: SLOT, tag: 'fresh', tagText: BUILT, title: '390 × 640 · the same arrival', sub: 'The sheet takes 88% of the short viewport and the same first card is usable inside it. Reachability here is a hit test at the control’s own centre, not <b>toBeVisible</b>.' })}
      ${phone({ file: CM('manage-private-no-link-390x844.png'), width: W, slot: SLOT, tag: 'fresh', tagText: BUILT, title: 'The whole sheet, in one scroll', sub: `Grouped, in this order: <b>Your event</b> → <b>Goals</b> → <b>Members and invites</b> → <b>Advanced</b> · <b>Membership</b>, ending on <b>Leave this community</b> in the danger colour. Under Goals, “A permission you grant per goal.”: each goal has its own block — <b>Public display is not authorized for this goal.</b>, what a display may show (community name, goal name and period, shared progress) and what it never shows (individual contributions, member names), then <b>Authorize public display</b>. No global switch exists. This community is <b style="color:${NAVY}">Private</b>, so there is no <b>Invite link</b> subsection at all — not a disabled one — and Invite QR reads <b>This community cannot be joined from a link, so there is no invite link or QR code to share.</b>` })}
    </div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">THE INVITE LINK · THE ONLY ACTION THAT COSTS SOMEONE ELSE SOMETHING</div>
        <h3>Creating a new link retires the old one, so the sheet asks first — and says whose link it is about to break.</h3>
      </div>
      <div class="how">The caveat is the product’s own: <b style="color:${NAVY}">Anyone with this link can join, including someone it is forwarded to. It keeps working until you create a new one.</b></div>
    </div>
    <div class="phones">
      ${phone({ file: CM('manage-reset-confirming-390x844.png'), width: W, slot: SLOT, tag: 'fresh', tagText: BUILT, title: 'Asks first', sub: 'An inset block, not a dialog over the sheet: <b>The current invite link will stop working for everyone who has it.</b> The consequence is named for the people holding it, not for the Champion. <b>Yes, create a new link</b> · <b>Keep the current link</b> at text weight.' })}
      ${phone({ file: CM('manage-reset-confirming-390x640.png'), width: W, slot: SLOT, tag: 'fresh', tagText: BUILT, title: '390 × 640 · still reachable', sub: 'The confirmation and both of its answers sit inside the capped sheet on the short phone. This is the frame that earns the claim; the 844 one does not.' })}
      ${phone({ file: CM('manage-resetting-INJECTED-DELAY-390x844.png'), width: W, slot: SLOT, tag: 'fresh', tagText: BUILT, title: 'In flight', sub: 'The control itself becomes <b>Creating a new link…</b>. Nothing else moves, and no new link is claimed. The callable was held open to photograph this and released afterwards — <b>INJECTED-DELAY</b>, said in the filename.' })}
      ${phone({ file: CM('manage-reset-done-390x844.png'), width: W, slot: SLOT, tag: 'fresh', tagText: BUILT, title: 'Landed', sub: '<b>The old link no longer works. Copy invite, Share invite and the QR code now use the new one.</b> The old caveat above it goes quiet; the result names every surface the change reaches rather than saying “done”.' })}
    </div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">WHEN THERE IS NO LINK TO GIVE · AND WHERE THE COPY CONTROL ACTUALLY LIVES</div>
        <h3>A link that is not ready yet says so — and copying is a Home control, not a sheet control.</h3>
      </div>
      <div class="how">The lock groups <b style="color:${NAVY}">copied</b> and <b style="color:${NAVY}">copy-failed</b> with the sheet’s states. In this build they are not: the copy control is on Home’s <b style="color:${NAVY}">Invite people</b> card. The frames are named <b style="color:${NAVY}">page-*</b> so the board does not place a control inside a sheet that has none.</div>
    </div>
    <div class="phones">
      ${phone({ file: CM('manage-invite-not-ready-390x844.png'), width: W, slot: SLOT, tag: 'fresh', tagText: BUILT, title: 'Link not ready yet', sub: '<b>Invite QR</b> says <b>This community’s invite link is not ready yet, so there is nothing to encode. Close this and open it again.</b> — a reload, not an empty state. <b style="color:${NAVY}">The sentence beneath it does not adapt</b>: the “Anyone with this link can join…” caveat still describes a link that is not there. Reported, not built around; the product was not touched.' })}
      ${phone({ file: CM('page-invite-copied-390x844.png'), width: W, slot: SLOT, tag: 'real', tagText: ACCEPTED_LATER, title: 'Copied · on Home', sub: 'Home’s <b>Invite people</b> card — <b>Share this community with people you want to move with.</b> The control confirms in place: <b>Copied</b>, with <b>Show QR code</b> beneath it at the same weight.' })}
      ${phone({ file: CM('page-invite-copy-failed-INJECTED-CLIPBOARD-390x844.png'), width: W, slot: SLOT, tag: 'real', tagText: ACCEPTED_LATER, title: 'Copy failed · on Home', sub: '<b>Copy failed — use the QR code.</b> The failure hands over the route that still works instead of asking the Champion to try again. Clipboard write was replaced with a rejecting stub — <b>INJECTED-CLIPBOARD</b>, said in the filename.' })}
    </div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">ADVANCED · MEMBERSHIP · LAST, AND IN THE DANGER COLOUR</div>
        <h3>Leaving asks first, tells the member what survives, and does not claim to be irreversible — because it is not.</h3>
      </div>
      <div class="how">The lock: <b style="color:${NAVY}">do not claim it is universally irreversible because the server may refuse the operation or the member may later rejoin by an allowed path.</b> The build says both halves.</div>
    </div>
    <div class="phones">
      ${phone({ file: CM('manage-leave-confirming-390x640.png'), width: W, slot: SLOT, tag: 'fresh', tagText: BUILT, title: 'The confirmation, in full', sub: '<b>You will stop seeing this community’s goals and can no longer contribute to them. What you have already contributed stays counted toward the community’s totals. You can rejoin with a current invite link.</b> Then <b>Yes, leave</b> and <b>Stay</b>. Three facts, and none of them is “this cannot be undone”.' })}
      ${phone({ file: CM('manage-leave-confirming-390x844.png'), width: W, slot: SLOT, tag: 'fresh', tagText: BUILT, title: 'Where it sits on the tall phone', sub: 'Under <b>Advanced</b> → <b>Membership</b>, after everything routine, in the danger colour so nothing ordinary is read past it. On this viewport the confirmation opens at the fold, which is exactly why the 640 frame beside it is the evidence and this one is the placement.' })}
      ${phone({ file: CM('manage-leave-failed-INJECTED-NETWORK-390x844.png'), width: W, slot: SLOT, tag: 'fresh', tagText: BUILT, title: 'The server could not be reached', sub: '<b>We couldn’t reach the server. Check your connection and try again.</b> + <b>OK</b>. It reports a reading, not a departure: the member is still in the community, and nothing in the sheet says otherwise. <b>INJECTED-NETWORK</b>, said in the filename.' })}
    </div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">THE THREE THAT LOOK ALIKE AND ARE NOT · LOADING, FAILED, GENUINELY EMPTY</div>
        <h3>An operational failure never borrows the empty state’s words — and the sheet says which one it is three times over.</h3>
      </div>
      <div class="how">The header’s second line is a <b style="color:${NAVY}">state line</b>, not a goal count. Five variants appear across this set, two of which disclose a failure before the member scrolls at all.</div>
    </div>
    <div class="phones">
      ${phone({ file: CM('manage-goals-loading-INJECTED-DELAY-390x844.png'), width: W, slot: SLOT, tag: 'fresh', tagText: BUILT, title: 'Reading', sub: 'State line <b>Checking what is running… · 1 member</b>; the kiosk card <b>Loading this community’s goals…</b>; Goals <b>Loading goals…</b>. Community details are already there, because they were already known. <b>INJECTED-DELAY</b>, released after the shot.' })}
      ${phone({ file: CM('manage-goals-error-INJECTED-NETWORK-390x844.png'), width: W, slot: SLOT, tag: 'fresh', tagText: BUILT, title: 'Could not be read', sub: 'State line <b>Goals could not be loaded · 1 member</b>; the kiosk card <b>This community’s goals could not be loaded, so there is no kiosk address to give you. Close this and open it again.</b>; Goals <b>Goals could not be loaded, so there is nothing to manage yet.</b> Three places, and not one of them says “none”.' })}
      ${phone({ file: CM('manage-no-goals-390x844.png'), width: W, slot: SLOT, tag: 'fresh', tagText: BUILT, title: 'Genuinely none', sub: 'State line <b>No goal running yet · 1 member</b>; the kiosk card <b>No goal is running, so there is nothing to put on a screen yet.</b>; Goals <b>No goals yet. Close this and start one from the community page.</b> The empty state points at the way out; the failure above points at a retry.' })}
    </div>
  </div>

  <div class="two">
    <div class="side">
    <div class="panel dark">
      <div class="eyebrow seam">STATUS LAYER · A ROUTE'S STANDING AND A FRAME'S PROVENANCE ARE DIFFERENT FACTS</div>
      <h3>This board grants no acceptance, and it removes none.</h3>
      <p class="note"><b style="color:${CREAM}">a · The page under the sheet is ACCEPTED.</b> <b style="color:${CREAM}">/community/[groupId]</b> is Page 1 — Home; <b style="color:${CREAM}">app/index.tsx</b> redirects <b style="color:${CREAM}">/</b> there for a member with an open community. Accepted at <b style="color:${CREAM}">3562156</b> (2026-09-21), recorded in <b style="color:${CREAM}">.github/wsf-staging/approved-candidate.json</b>. That acceptance stands and this board does not touch it.</p>
      <p class="note" style="margin-top:8px"><b style="color:${CREAM}">b · The three Home frames here postdate it.</b> Exactly two commits touched that route between the acceptance and <b style="color:${CREAM}">5356e3c</b>: <b style="color:${CREAM}">6e1ce26</b> removed the 104px mini Living WEs from secondary and closed goal rows so the mark is drawn once per screen, and <b style="color:${CREAM}">e609c57</b> fixed the hero’s “Try again” from navy on navy. A later capture of an accepted route is still a later capture.</p>
      <p class="note" style="margin-top:8px"><b style="color:${CREAM}">c · The Manage sheet is current-build review</b>, per the lock’s own status layer, and that governs what this board claims. The sheet’s render block is nonetheless <b style="color:${CREAM}">766 lines that are byte-identical between 3562156 and 5356e3c</b> — the page verdict simply rested on frames that never open it. Not photographed is not the same as not accepted, and it is not the same as accepted either; the board records the code fact and defers to the lock for the standing.</p>
      <p class="note" style="margin-top:8px"><b style="color:${CREAM}">d · Nothing here is hosted proof.</b> Every frame is a local emulator run against seeded fixtures, write-gated by <b style="color:${CREAM}">WSF_CAPTURE_FRAMES=1</b>; the ordinary run asserts all ten cases and writes nothing. No product file was edited to produce any of it.</p>
    </div>
    <div class="panel dark">
      <div class="eyebrow seam">EXPLICIT NOT-BUILT BOUNDARY · QUOTED, NOT DRAWN</div>
      <p class="note" style="margin-top:8px">A dedicated <b style="color:${CREAM}">admin dashboard or route</b>; a <b style="color:${CREAM}">member directory</b>; a <b style="color:${CREAM}">role-management system</b>; <b style="color:${CREAM}">broader administration beyond the current Manage sheet</b>. None of the four is drawn anywhere on this board, in any state, at any weight — not as a target, not as a seam. The sheet is the whole capability.</p>
    </div>
    <div class="panel">
      <div class="eyebrow quiet">THE TEN STATES THE LOCK NAMES · WHERE EACH ONE IS, AND THE ONE THAT MOVED</div>
      <div class="rules">
        <div><b>loading</b> · Reading</div>
        <div><b>goal-read failure</b> · Could not be read</div>
        <div><b>no-goals</b> · Genuinely none</div>
        <div><b>invite-not-ready</b> · Link not ready yet</div>
        <div><b>private-community</b> · The whole sheet, in one scroll</div>
        <div><b>resetting / reset-confirming</b> · Asks first, In flight</div>
        <div><b>leave-confirming</b> · The confirmation, in full</div>
        <div><b>leave-failed</b> · The server could not be reached</div>
        <div><b>copied</b> and <b>copy-failed</b> · on <b>Home</b>, not in the sheet. The lock groups them with the sheet's states; in this build the copy control is on Home's <b>Invite people</b> card, so the board shows them where they are and says so.</div>
      </div>
    </div>
    </div>
    <div class="side">
      <div class="panel">
        <div class="eyebrow quiet">THE LOCK · WHAT EVERY FRAME ABOVE OBEYS</div>
        <div class="rules">
          <div>A Champion stays in the <b>same member journey</b>; Home stays member-first and exposes <b>one quiet Manage control</b>.</div>
          <div>Manage is a <b>bottom sheet over the current community</b>, never navigation to an admin section.</div>
          <div>Identity is community-first: <b>Champion tools</b>, the community’s real name, a close control.</div>
          <div>The tools are <b>grouped, not sprayed</b>: Your event, Goals, Members and invites, Advanced / Membership.</div>
          <div>Public display authorization is <b>per goal</b>, never a global community switch.</div>
          <div>Kiosk, station and goal-start flows stay <b>contextual</b>; Boards 08, 10, 11, 12 and 13 detail them rather than duplicating them here.</div>
          <div>Invite QR and link exist <b>only for link-joinable communities</b>; Private has none.</div>
          <div>A new link <b>retires the old one</b>, so it asks first.</div>
          <div>Leaving is an <b>Advanced membership action with explicit confirmation</b>, and is <b>not</b> claimed universally irreversible.</div>
          <div>Ten states stay <b>distinct</b>, and <b>operational failures never masquerade as empty states</b>.</div>
          <div><b>No Living WE as decoration inside management</b> — the only one is Home’s real shared-goal instrument behind the entry.</div>
          <div><b>No invented member identities</b>, directory, role management or broad administration.</div>
        </div>
      </div>
      <div class="panel">
        <div class="eyebrow quiet">WHERE THIS BOARD IS HONEST ABOUT ITS OWN LIMITS</div>
        <table>
          <tr><td class="k">One frame, one claim</td><td class="d"><b style="color:${NAVY}">page-invite-not-ready</b> is a top-of-page capture; the message its name asserts is below its fold. It appears here for the entry and the Living WE, and the board does not claim that state.</td></tr>
          <tr><td class="k">Not opened here</td><td class="d"><b style="color:${NAVY}">Show all details</b> is never expanded in this set, so the returned type, joining mode, status and role the lock permits are not shown — only <b style="color:${NAVY}">Members</b> and <b style="color:${NAVY}">Community since</b>. <b style="color:${NAVY}">Show QR code</b> is never opened either, so no QR appears on this board.</td></tr>
          <tr><td class="k">Below every fold</td><td class="d"><b style="color:${NAVY}">Screens at this event</b> exists in the build as a per-goal sibling of <b style="color:${NAVY}">Set up kiosk</b>, and no frame in this set reaches it. It is named, not drawn; the lock assigns those flows to Boards 10–13.</td></tr>
          <tr><td class="k">Scrolled, not arrival</td><td class="d">Most of these states differ only below the sheet’s top, so the producer scrolls each state’s own section into frame before the shutter. Every frame except the two <b style="color:${NAVY}">manage-entry</b> ones is therefore a scrolled position.</td></tr>
          <tr><td class="k">Fixtures</td><td class="d">“Harbor Walkers”, “Autumn squat challenge”, “Morning walks”, the totals and the dates are synthetic. No real community, person or invite link appears.</td></tr>
        </table>
      </div>
    </div>
  </div>

  ${footer('WE_STAY_FIT_NORTH_STAR_BOARD_07_CHAMPION_MANAGEMENT_FINAL', 'SELF-CHECKED · INDEPENDENT REVIEW PENDING · PR #365 comment 5771412585 · Manage sheet current-build at 5356e3c, over accepted Home captured later')}
  `,
});
