/**
 * BOARD 11 — SINGLE-GOAL KIOSK.
 *
 * Locked by PR #365 comment 5771528649: "Board 11 now locks the CURRENT
 * single-goal shared-device kiosk truth, while preserving Board 14 as the
 * future two-station/queue experience." Status layer, from that lock:
 * "CURRENT BUILD / REVIEW."
 *
 * THE ROUTE IS BUILT, AND THE ATLAS HAD NO PHOTOGRAPH OF IT.
 * `app/kiosk/[goalId].tsx` (408 lines) with `src/kioskSession.ts` (289) is the
 * resting screen; the walk-up continues on `/contribute/[goalId]?kiosk=1`,
 * which is the ORDINARY contribution route in kiosk mode. Until this board,
 * the only kiosk pictures in the atlas were batch-e's thirteen DRAWINGS at
 * 800×1280 — a package whose own README says "nothing here has been built" —
 * and a board reconstructed from those would have been a board about a
 * redesign. So the frames here were produced from the running product, by this
 * board's own gated producer, and every state was asserted before it was shot.
 *
 * TWO DEVICE CLASSES, AND THE THRESHOLD BETWEEN THEM. Batch E drew the kiosk
 * at 800×1280 portrait. The built route selects its wide treatment at
 * `windowWidth >= 900`, so at exactly the drawn class it renders its NARROW
 * layout. Both are shown. Device classes are design targets, not installed
 * hardware, and nothing here asserts what is standing in a room.
 *
 * WHAT THIS BOARD REFUSES TO INVENT. No QR or phone pairing, no activity
 * chooser, no queue, turn or station assignment, no participant-name callout,
 * no individual display and no cross-device attempt recovery. None of it
 * exists on this route; all of it belongs to Board 14's intended two-station
 * experience, which this board preserves by naming rather than by backfilling.
 *
 * WHERE THE BUILD AND THE DRAWN TARGET DIVERGE, THE BOARD SAYS SO rather than
 * picking whichever flatters the other — including the one the frames make
 * plain: the kiosk START screen is chrome-free, and the kiosk-mode
 * CONTRIBUTION screen still carries the member shell's tab bar, where batch-e's
 * target says a venue screen has no way off. That is named as a seam, not
 * drawn away and not asserted as a defect beyond what the pixels show.
 */
import path from 'node:path';
import { REPO, frameHeight, header, footer, page, phone, NAVY, CREAM } from './lib.mjs';

const K = (f) => path.join(REPO, 'docs/design-target/review/kiosk-current', f);

export const width = 1280;
export const height = 3196;

const W = 200;
const CAPTURED = 'CURRENT BUILD · CAPTURED';
const CAPTURED_WIDE = 'CURRENT BUILD · CAPTURED · 1024×1366';

const ROW = [
  'kiosk-resting-800x1280.png',
  'kiosk-resting-wide-1024x1366.png',
  'kiosk-stale-800x1280.png',
  'kiosk-loading-800x1280.png',
  'kiosk-refused-800x1280.png',
  'kiosk-unreachable-800x1280.png',
  'kiosk-entry-800x1280.png',
  'kiosk-review-800x1280.png',
  'kiosk-receipt-finish-800x1280.png',
  'kiosk-rested-after-finish-800x1280.png',
];
const SLOT = Math.max(...ROW.map((f) => frameHeight(K(f), W)));

/* The supplement released on PR #423 (`5786222162`): the two locked failure
   states the first pass named but did not photograph. Both are reached by a
   fault injected OUTSIDE the product — no app, backend or config change — and
   both carry the fault in their provenance tag. */
const FAIL = [
  'kiosk-unresolved-800x1280.png',
  'kiosk-rested-after-unresolved-800x1280.png',
  'kiosk-signout-failed-800x1280.png',
];
const FAIL_SLOT = Math.max(...FAIL.map((f) => frameHeight(K(f), W)));
const CAPTURED_TRANSPORT = 'CURRENT BUILD · CAPTURED · INJECTED TRANSPORT FAULT';
const CAPTURED_STORAGE = 'CURRENT BUILD · CAPTURED · INJECTED STORAGE FAULT';

const b = (t) => `<b style="color:${NAVY}">${t}</b>`;
const w = (t) => `<b style="color:${CREAM}">${t}</b>`;

export const html = page({
  width,
  height,
  body: `
  ${header('11', 'Single-goal kiosk')}

  <div class="copy">
    <div class="lead">One goal, one shared device, many separate visitors.</div>
    <div class="gov">INTERNAL BOARD COPY — NOT IN-APP MESSAGING. THE ONLY GOVERNING PUBLIC COPY IS BOARD 00'S LOCKED PAIR.</div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">AT REST · /kiosk/[goalId] · BUILT · PHOTOGRAPHED</div>
        <h3>A public hero and one button. It rests signed out, shows no individual, and says what it will and will not do with the person who walks up.</h3>
      </div>
      <div class="how">Captures of the running route, produced for this board and read in place (${b('docs/design-target/review/kiosk-current/')}, sha256 per frame in its README). Each state was ${b('asserted before its shot')}. Community, goal and totals are synthetic emulator fixtures; the frames' own ${b('SAMPLE DATA')} strip is the build's emulator banner, as captured.</div>
    </div>
    <div class="phones" style="gap:26px">
      ${phone({
        file: K('kiosk-resting-800x1280.png'),
        width: W,
        slot: SLOT,
        tag: 'fresh',
        tagText: CAPTURED,
        title: 'Resting · 800×1280',
        sub: `Navy edge to edge, the exact wordmark, and ${b('one calibrated Living WE')} from the same confirmed public pulse the display uses — ${b('241 of 500 squats')}, ${b('48.2% complete')}, ${b('259 to go')}, ${b('Confirmed 11:30 PM')}. One primary, ${b('Contribute here')}, low on the canvas. Under it the privacy explanation, verbatim: sign in with ${b('your own account')}, enter the number ${b('you counted yourself')}, and ${b('nothing about you stays on it after you finish')}. ${b('No identity anywhere')} — the producer asserts the screen's whole text contains no account name.`,
      })}
      ${phone({
        file: K('kiosk-resting-wide-1024x1366.png'),
        width: W,
        slot: SLOT,
        tag: 'fresh',
        tagText: CAPTURED_WIDE,
        title: 'The same screen, wide',
        sub: `The identical state above the route's own threshold: it selects the wide treatment at ${b('windowWidth ≥ 900')}, so the drawn 800×1280 class renders the ${b('narrow')} layout and this one does not. Bigger wordmark, bigger type, same single action. ${b('A device class is a design target, not hardware.')}`,
      })}
      ${phone({
        file: K('kiosk-stale-800x1280.png'),
        width: W,
        slot: SLOT,
        tag: 'fresh',
        tagText: CAPTURED,
        title: 'Stale · the last confirmed truth, kept',
        sub: `One real confirmation, then the poll fails. The hero ${b('does not blank')} and does not guess: the same ${b('241 of 500')} it actually confirmed, the same calibrated fill, and the freshness line changes from Confirmed to ${b('Last confirmed 11:30 PM')}.`,
      })}
      ${phone({
        file: K('kiosk-loading-800x1280.png'),
        width: W,
        slot: SLOT,
        tag: 'fresh',
        tagText: CAPTURED,
        title: 'Loading · no instrument yet',
        sub: `The wordmark and ${b('Loading display…')}, and nothing else. ${b('No Living WE')} and no number: the producer asserts both are absent, because a mark drawn before a confirmed ratio would be a decoration pretending to be a report.`,
      })}
      ${phone({
        file: K('kiosk-refused-800x1280.png'),
        width: W,
        slot: SLOT,
        tag: 'fresh',
        tagText: CAPTURED,
        title: 'Refused · and it says nothing about why',
        sub: `A goal its Champion has not authorized for display. ${b('Nothing to show here')} / ${b("This display isn't currently available.")} — byte-identical to the public display's refusal, with ${b('Check again')}. The producer asserts the text names no reason and never prints the goal id, so the screen ${b('cannot be asked which goals exist')}.`,
      })}
    </div>
    <div class="phones" style="gap:26px;margin-top:26px">
      ${phone({
        file: K('kiosk-unreachable-800x1280.png'),
        width: W,
        slot: SLOT,
        tag: 'fresh',
        tagText: CAPTURED,
        title: 'Unreachable · a distinct state, before any confirmation',
        sub: `${b('Connection interrupted')} / "Nothing has been confirmed yet. Check again when you're connected." Different words from the refusal above and a different fact: this one claims nothing about the goal. ${b('No invented total')}, no mark.`,
      })}
      ${phone({
        file: K('kiosk-entry-800x1280.png'),
        width: W,
        slot: SLOT,
        tag: 'fresh',
        tagText: CAPTURED,
        title: 'The walk-up · the ordinary route in kiosk mode',
        sub: `${b('Contribute here')} records the return and sends the visitor through the ${b('ordinary')} sign-in — a shared device asking for a password in its own chrome is the shape of a credential harvest. Back is gone and ${b('Finish')} sits in the chrome instead. The community hero stays at ${b('241 of 500')}; the entry is the product's own.`,
      })}
      ${phone({
        file: K('kiosk-review-800x1280.png'),
        width: W,
        slot: SLOT,
        tag: 'fresh',
        tagText: CAPTURED,
        title: 'Review · own credit only',
        sub: `${b('0 → 20 squats')}, and "Private to you. The community total above is what everyone sees." The hero above it still reads ${b('241 of 500')}: the review ${b('does not predict the shared total')}, which is not this member's to promise. The producer asserts the screen never shows 261 of 500.`,
      })}
      ${phone({
        file: K('kiosk-receipt-finish-800x1280.png'),
        width: W,
        slot: SLOT,
        tag: 'fresh',
        tagText: CAPTURED,
        title: 'Confirmed · the receipt owns the new total',
        sub: `${b('+20')}, then the recalibrated mark and ${b('261 of 500 squats')} · ${b('52.2% complete')} — the lock's own illustration, reached by a real write. ${b('Finish')} replaces the ordinary repeat and back controls, with ${b('Finish signs you out and returns this device to its start screen.')} and ${b('Finishing in 89 seconds')} under it.`,
      })}
      ${phone({
        file: K('kiosk-rested-after-finish-800x1280.png'),
        width: W,
        slot: SLOT,
        tag: 'fresh',
        tagText: CAPTURED,
        title: 'Back at rest · the next visitor inherits nobody',
        sub: `Finish signed the account out and returned the device. The hero now carries the total that contribution produced — ${b('261 of 500')}, ${b('52.2%')} — and the producer asserts the screen contains ${b('neither the account name nor the amount')} the last visitor entered.`,
      })}
    </div>
  </div>

  <div style="margin-top:30px">
    <div class="sec-head">
      <div>
        <div class="eyebrow">THE TWO LOCKED FAILURE STATES · REACHED BY INJECTED FAULT · PHOTOGRAPHED</div>
        <h3>Effort whose fate nobody knows, and a device that will not pretend to be free. Both are central to the shared-device contract, so both are shot rather than described.</h3>
      </div>
      <div class="how">Each needs a failure at a precise instant, so one was induced ${b('outside the product')} and named on the frame: a ${b('transport fault')} that aborts the contribution request in flight, and a ${b('storage fault')} that makes Firebase Auth's own IndexedDB refuse the removal by which sign-out happens. ${b('No app, backend, config or existing-producer change')}, and no expected design substituted for what rendered.</div>
    </div>
    <div class="phones" style="gap:26px">
      ${phone({
        file: K('kiosk-unresolved-800x1280.png'),
        width: W,
        slot: FAIL_SLOT,
        tag: 'fresh',
        tagText: CAPTURED_TRANSPORT,
        title: 'Unknown outcome · the screen states uncertainty, not a result',
        sub: `${b('NOT CONFIRMED YET')} · ${b('We couldn’t confirm your contribution yet.')} · "We don’t know whether this effort was recorded. Don’t record it again." · ${b('You entered 20 squats.')} The safe act is offered as itself — ${b('Confirm this contribution')}, "this sends the same attempt again… it will not count twice" — a replay of the same attempt, not a second contribution. ${b('No shared total, no percent and no Living WE anywhere on it')}: all three are asserted absent, because a mark beside "we don’t know" invites exactly the arithmetic the member cannot safely do.`,
      })}
      ${phone({
        file: K('kiosk-rested-after-unresolved-800x1280.png'),
        width: W,
        slot: FAIL_SLOT,
        tag: 'fresh',
        tagText: CAPTURED_TRANSPORT,
        title: 'Finish from unresolved · the account goes, the record stays',
        sub: `The kiosk's own guidance first — ${b('Your attempt is saved to your account; check it from your own device.')} — then Finish. The device rests signed out (no auth record remains, asserted) at ${b('241 of 500 squats')} · ${b('48.2% complete')} · ${b('259 to go')} · ${b('Confirmed 11:43 PM')}: the request never reached the server, so the confirmed truth is unchanged and ${b('nothing is invented in either direction')}. The stored attempt ${b('survives the sign-out')}, keyed to the uid that made it — it is the only thing that lets its owner replay that attempt id and get the original receipt.`,
      })}
      ${phone({
        file: K('kiosk-signout-failed-800x1280.png'),
        width: W,
        slot: FAIL_SLOT,
        tag: 'fresh',
        tagText: CAPTURED_STORAGE,
        title: 'Sign-out failure · it refuses to look free',
        sub: `A real confirmed receipt (${b('261 of 500')} · ${b('52.2%')} · ${b('239 to go')}), then Finish with the removal refused. The device ${b('does not return to its start screen')}; it stays put and says so in red: ${b('We couldn’t sign you out. Don’t leave this device signed in — try Finish again.')} Finish is offered again rather than left spinning. And it is not cosmetic — the account's persisted record is still on the device, and a reload comes back ${b('signed in as the same visitor with no gate')}. Asserted, both ways.`,
      })}
      <div class="panel" style="width:240px">
        <div class="eyebrow seam">ONE DEFECT THESE FRAMES EXPOSE · REPORTED, NOT FIXED</div>
        <p class="note">${b('“Stay” is invisible on the dark screens.')} In the countdown row the control is drawn in ${b('#0B1F3A')} on the receipt screen's ${b('#0B1F3A')} background — a contrast ratio of ${b('1:1')}. It is present, focusable and operable (the producer clicks it and the countdown rises again), and on the light unresolved screen the same control reads normally. On the two dark frames there is ${b('nothing legible')} where it sits — checked pixel by pixel across the right of that row, not inferred.</p>
        <p class="note" style="margin-top:8px">On a shared device this is the one control that keeps a receipt on screen for somebody still reading it. ${b('The product is not this packet’s to change')}, so it is recorded here and nowhere fixed.</p>
        <p class="note" style="margin-top:8px">${b('The tab-bar seam recurs.')} Both contribution-screen frames here carry the member shell's tab bar along the bottom edge, as the entry, review and receipt frames do.</p>
      </div>
    </div>
  </div>

  <div class="two">
    <div class="side">
      <div class="panel dark">
        <div class="eyebrow seam">WHERE THE BUILT ROUTE AND THE DRAWN TARGET DIVERGE</div>
        <h3>Both are recorded. Neither is quietly adopted.</h3>
        <p class="note">${w('a · The drawings were never built.')} Batch E's thirteen kiosk frames at 800×1280 are a ${w('TARGET / CONCEPT')} package whose own README says "nothing here has been built". They are not reproduced on this board, because this board is the ${w('current build')} — and a target is never an after.</p>
        <p class="note" style="margin-top:8px">${w('b · The start screen matches the target’s discipline.')} Navy edge to edge, no chrome, no back, one action low on the canvas, nothing that scrolls. Photographed above, not asserted.</p>
        <p class="note" style="margin-top:8px">${w('c · The contribution screen does not, yet.')} Batch E's rule is that a venue screen has ${w('no way off')}. The built kiosk-mode contribution screen replaces Back with Finish — and still renders the ${w('member shell’s tab bar')} along its bottom edge, visible in the entry, review and receipt frames. This board ${w('names that as a seam')} and draws no substitute for it; what the pixels show is a tab bar present, and nothing here claims more than that.</p>
        <p class="note" style="margin-top:8px">${w('d · The 800×1280 class renders the narrow layout.')} The route's wide treatment begins at ${w('900 px')}. Whether the target class should move or the threshold should, is a product decision and is ${w('left open')}.</p>
      </div>
      <div class="panel">
        <div class="eyebrow quiet">THE LOCK · WHAT EVERY FRAME ABOVE OBEYS</div>
        <div class="rules">
          <div>One display-authorized goal, one shared device; it ${b('always rests signed out')}.</div>
          <div>${b('No individual identity')} on the start screen.</div>
          <div>Exact wordmark and ${b('one calibrated Living WE')} from the same confirmed pulse as the display.</div>
          <div>Current total, status and confirmed time; stale ${b('keeps the last confirmed truth')} and says so.</div>
          <div>A single primary, ${b('Contribute here')}.</div>
          <div>The privacy explanation is exact: own account, own count, ${b('nothing left behind')}.</div>
          <div>No kiosk-only counting: ${b('sign in → amount → review → ordinary account-scoped write')}.</div>
          <div>Review previews ${b('own credit only')} and never predicts the shared total.</div>
          <div>The receipt owns the ${b('new shared total')} and the recalibrated mark.</div>
          <div>${b('Finish')} replaces repeat/back; its sentence is quoted verbatim on the screen.</div>
          <div>The countdown is ${b('90 seconds')}; ${b('Stay')} restarts it rather than pausing it.</div>
          <div>Loading draws ${b('no fake mark')}; a pre-confirmation failure invents ${b('no total')}.</div>
          <div>The refusal is the ${b('generic public-display refusal')} and requires an explicit Check again.</div>
          <div>The kiosk ${b('never verifies')} who moved, or that movement happened. Members self-count.</div>
        </div>
      </div>
    </div>
    <div class="side">
      <div class="panel">
        <div class="eyebrow quiet">WHERE THIS BOARD IS HONEST ABOUT ITS OWN LIMITS</div>
        <table>
          <tr><td class="k">One provenance</td><td class="d">Every frame is ${b('CURRENT BUILD · CAPTURED')} — the running route at app-shell-equivalent product source, shot for this board. There are ${b('no drawings on this board at all')}, and nothing carries an accepted-page verdict: <b>/kiosk/[goalId]</b> has none, and this board grants none.</td></tr>
          <tr><td class="k">Captured, not described</td><td class="d">Thirteen states are photographs. The producer also captured the ${b('signed-out handoff')} and the ${b('Stay')} frame; they are in the evidence set and not reproduced here, where the rule they prove is stated instead.</td></tr>
          <tr><td class="k">The two locked failure states, and a correction</td><td class="d">${b('Both are now photographed')}, under the labelled injected faults above — this supersedes this board's earlier statement that neither was drawn. That statement also said both were covered by <b>ui-kiosk.spec.ts</b>; on re-reading, they are not. That spec reaches neither state end to end (it asserts only that a ${b('confirmed')} receipt carries no unresolved notice). The rules are covered at unit level in <b>tests/kiosk-session.test.ts</b> — "KEEPS an unresolved attempt", "never claims the unresolved attempt was recorded", "reports a FAILED sign-out instead of pretending the device is clean" — and the two frames here are the first end-to-end evidence of either.</td></tr>
          <tr><td class="k">Not on this board, by the lock</td><td class="d">${b('No QR or phone pairing')}, no activity chooser, no queue, turn or station assignment, no participant-name callout, no individual display and no cross-device attempt recovery. None exists on this route; all belong to ${b('Board 14’s')} intended two-station experience, which is ${b('preserved by naming it')} rather than backfilled or erased.</td></tr>
          <tr><td class="k">Fixtures</td><td class="d">"Maple Street Movers", "Squats together this week" and every number are ${b('synthetic emulator fixtures')}, recorded in the evidence set's <b>fixture.json</b> and unchanged here. No real community, person or device appears; no faces, names, counts of people, streaks, rankings or comparison anywhere.</td></tr>
        </table>
      </div>
    </div>
  </div>

  ${footer('WE_STAY_FIT_NORTH_STAR_BOARD_11_SINGLE_GOAL_KIOSK_FINAL', 'SELF-CHECKED · INDEPENDENT REVIEW PENDING · PR #365 comment 5771528649 · current build / review: thirteen photographs of the running kiosk, two of them reached by a labelled injected fault; the batch-e drawings are not reproduced')}
  `,
});
