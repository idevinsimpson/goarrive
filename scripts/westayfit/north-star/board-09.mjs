/**
 * BOARD 09 — LIFECYCLE & HISTORY.
 *
 * Locked by PR #365 comment 5771469193: "Board 09 now locks closed-goal /
 * history / lifecycle semantics around current confirmed truth." Status layer,
 * from that lock: "CURRENT BUILD / REVIEW; this board locks lifecycle truth,
 * not a new History route."
 *
 * THE ONE RULE EVERY PANEL HERE SERVES. A goal's present state is read from the
 * CONFIRMED CURRENT TOTAL against its target and its open/closed status —
 * `progressPhase()` in `src/ui/progressFormat.ts` — and never from a historical
 * stamp. `reachedAt` is an event, and events do not un-happen; an authoritative
 * later correction can take the total back below target while the stamp still
 * stands. Both surfaces that could print that date guard it on the CURRENT
 * phase, and `app/activity.tsx` carries the note recording that this was once
 * wrong in the build.
 *
 * Provenance, three kinds, never blurred:
 *
 *   ACCEPTED BUILD · LATER CAPTURE   Home and Progress are accepted pages at
 *                                    the staging pin 3562156. The lifecycle
 *                                    crops and phones shown here were captured
 *                                    afterwards, for Boards 01 and 02 and for
 *                                    the Home one-mark correction. That is a
 *                                    fact about the frame, not about the
 *                                    route's standing.
 *
 *   ACCEPTED BUILD · CAPTURED        the accepted Page 4 AFTER evidence.
 *
 *   CURRENT BUILD · CAPTURED       Corrected-Below-Target, photographed at last.
 *                                    The first cut of this board had no frame of
 *                                    it on any surface and said so rather than
 *                                    drawing one; the Director passed the layout
 *                                    and held coverage PARTIAL for exactly that
 *                                    gap (5785588557), because the board's main
 *                                    lifecycle contract needed a visible
 *                                    specimen and not a text promise. The
 *                                    producer is this worker's own
 *                                    sprint-w1b-lifecycle-capture.spec.ts: the
 *                                    goal really reaches its target, the server
 *                                    stamps reachedAt, a real Champion
 *                                    correction moves the confirmed total below
 *                                    it, and the stamp is asserted to survive.
 *
 * NO MINI LIVING WE IS REINTRODUCED. Community Home's secondary and History
 * rows lost their mini marks in the 2026-09-22 one-mark correction, and the
 * frames used here are the corrected ones. Progress keeps exactly one mark, on
 * the most recent finished goal, filled by that goal's real final total — the
 * same one-per-screen rule on a different surface, and that is said where it
 * appears rather than left to look like a relapse.
 *
 * Nothing private is shown. No dated personal contribution log, no streaks, no
 * ranking, no names or faces. The lock keeps the private dated history as Board
 * 04's separate unbuilt seam, and this board does not annex it.
 */
import path from 'node:path';
import {
  REPO,
  frameHeight,
  frameImg,
  header,
  footer,
  page,
  phone,
  NAVY,
  CREAM,
  HAIRLINE,
  TEXT_MUTED,
} from './lib.mjs';

const B01 = (f) => path.join(REPO, 'docs/design-target/north-star-final/board-01/captures', f);
const B02 = (f) => path.join(REPO, 'docs/design-target/north-star-final/board-02/captures', f);
const HOME = (f) =>
  path.join(REPO, 'docs/design-target/review/page-01-home/correction-2026-09-22', f);
const P04 = (f) => path.join(REPO, 'docs/design-target/review/page-04-progress/after', f);
const CORR = (f) => path.join(REPO, 'docs/design-target/review/lifecycle-corrected-current', f);

export const width = 1280;
export const height = 4281;

const W = 268;
const LATER = 'ACCEPTED BUILD · LATER CAPTURE';
const ACCEPTED = 'ACCEPTED BUILD · CAPTURED';
const CAPTURED = 'CURRENT BUILD · CAPTURED';

const b = (t) => `<b style="color:${NAVY}">${t}</b>`;
const w = (t) => `<b style="color:${CREAM}">${t}</b>`;

/*
  A card crop, not a phone. These frames photograph ONE element — the goal card,
  a closed History row — so they get a shallow shell rather than a phone's
  radius, and the slot is measured from the files so a taller crop in a row
  cannot overrun its own provenance tag.
*/
function card({ file, title, sub, tagText, width: cw = W, slot }) {
  return `<div class="phone" style="width:${cw}px">
    <div class="slot" style="height:${slot}px"><div class="crop">${frameImg(file, cw)}</div></div>
    <div><span class="tag real">${tagText}</span></div>
    <div class="cap">${title}</div>
    <div class="sub">${sub}</div>
  </div>`;
}

const OPEN_ROW = [
  B01('state-zero.png'),
  B01('state-building.png'),
  B01('state-near.png'),
  B01('state-reached-open.png'),
];
const OPEN_SLOT = Math.max(...OPEN_ROW.map((f) => frameHeight(f, W)));

const CLOSED_W = 537;
const CLOSED_SLOT = Math.max(
  frameHeight(B01('state-closed-reached.png'), CLOSED_W),
  frameHeight(B01('state-closed-unfinished.png'), CLOSED_W)
);

const LIVE_ROW = [
  B02('confirmed-post-target-390x844.png'),
  B01('phone-short-reached-open-390x640-actions.png'),
  P04('AFTER-rows-390x844.png'),
  B01('state-unavailable.png'),
];
const LIVE_SLOT = Math.max(...LIVE_ROW.map((f) => frameHeight(f, W)));

/* The corrected-below-target pair and its control, one device class. */
const CORR_SLOT = frameHeight(CORR('home-corrected-below-target-390x844.png'), W);

export const html = page({
  width,
  height,
  body: `
  <style>
    .crop { border-radius: 14px; overflow: hidden; border: 1px solid ${HAIRLINE};
            box-shadow: 0 8px 22px rgba(11,31,58,0.08) }
    .stack { display: flex; flex-direction: column; gap: 22px }
    .absent { border: 1px dashed ${TEXT_MUTED}; border-radius: 14px; padding: 14px 16px }
  </style>

  ${header('09', 'Lifecycle &amp; history')}

  <div class="copy">
    <div class="lead">What the number means now — and what a finished goal keeps saying.</div>
    <div class="gov">INTERNAL BOARD COPY — NOT IN-APP MESSAGING. THE ONLY GOVERNING PUBLIC COPY IS BOARD 00'S LOCKED PAIR.</div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">THE OPEN LIFE OF ONE GOAL · CONFIRMED TOTAL AGAINST TARGET</div>
        <h3>Every state below is the same card reading a different confirmed number. Nothing here is a mood; it is arithmetic the product can be asked about.</h3>
      </div>
      <div class="how">Real captures of the accepted Home route, made for Board 01 at ${b('05a76bb')} and read in place. Each was ${b('asserted before it was shot')} — percent text, status line, the mark's <b style="color:${NAVY}">data-fill-ratio</b> — so a frame cannot be a picture of the wrong thing. Community and totals are synthetic emulator fixtures.</div>
    </div>
    <div class="phones" style="gap:26px">
      ${card({
        file: B01('state-zero.png'),
        slot: OPEN_SLOT,
        tagText: LATER,
        title: 'Open at zero · 0 of 500',
        sub: `The mark is present and ${b('empty')}. ${b('0% complete')}, ${b('500 to go')}. A denominator exists, so the instrument exists; nothing has been confirmed into it yet.`,
      })}
      ${card({
        file: B01('state-building.png'),
        slot: OPEN_SLOT,
        tagText: LATER,
        title: 'Building · 241 of 500',
        sub: `${b('48.2%')} — one decimal, rounded down, computed in integer arithmetic. The fill is ${b('area-calibrated')} from the bottom, not a proportional height.`,
      })}
      ${card({
        file: B01('state-near.png'),
        slot: OPEN_SLOT,
        tagText: LATER,
        title: 'Near goal · 461 of 500',
        sub: `Near goal begins at ${b('90% of the true target')}, not at a rounded label. ${b('92.2% complete')}, and the line changes to ${b('Only 39 to go')}.`,
      })}
      ${card({
        file: B01('state-reached-open.png'),
        slot: OPEN_SLOT,
        tagText: LATER,
        title: 'Reached, still open · 512 of 500',
        sub: `Mark ${b('full')}, eyebrow ${b('GOAL REACHED')}, percent ${b('capped at 100%')} — and the overshoot survives in the exact numbers: ${b('512 of 500')}, ${b('12 beyond our goal · still open')}. ${b('Reached Sep 22')} prints here because the ${b('current')} phase is reachedOpen.`,
      })}
    </div>
  </div>

  <div class="two">
    <div>
      <div class="sec-head">
        <div>
          <div class="eyebrow">WHEN IT ENDS · HISTORY IS CLOSED GOALS, IN CONTEXT</div>
          <h3>Only closed goals appear, each keeping its exact total and its period — and no row carries a mark.</h3>
        </div>
      </div>
      <div class="phones">
        ${phone({
          file: HOME('ACTUAL-home-history-390x844.png'),
          width: W,
          tag: 'fresh',
          tagText: LATER,
          title: 'HISTORY, on Community Home',
          sub: `The section exists because there is something to record. Two closed goals, each with total, result and period, under a quiet ${b('HISTORY')} eyebrow — and ${b('no Living WE on either row')}. Captured for the one-mark correction at ${b('6e1ce26')}; these frames are scrolled into place, not <b style="color:${NAVY}">fullPage</b>.`,
        })}
        ${phone({
          file: HOME('ACTUAL-home-alsounderway-390x844.png'),
          width: W,
          tag: 'fresh',
          tagText: LATER,
          title: 'Also under way · still open, not history',
          sub: `An open goal that is not the featured one stays in the active section and is ${b('never duplicated into History')}. It prints its own total, percentage, remaining and action — and, since the correction, ${b('no mark')}: the numbers already carry the ratio the mini mark was filling from.`,
        })}
      </div>
    </div>
    <div class="side">
      <div class="sec-head">
        <div>
          <div class="eyebrow quiet">THE TWO CLOSED RESULTS, AT READING SIZE</div>
          <h3>Reached and unfinished are different facts, and neither is a verdict on anyone.</h3>
        </div>
      </div>
      <div class="stack">
        ${card({
          file: B01('state-closed-reached.png'),
          width: CLOSED_W,
          slot: CLOSED_SLOT,
          tagText: LATER,
          title: 'Closed · reached',
          sub: `${b('515 of 500 push-ups')}, ${b('Reached')}, ${b('Aug 19 – Sep 2')}. The overshoot stays visible in the numbers; there is no contribution action on a closed goal.`,
        })}
        ${card({
          file: B01('state-closed-unfinished.png'),
          width: CLOSED_W,
          slot: CLOSED_SLOT,
          tagText: LATER,
          title: 'Closed · unfinished',
          sub: `${b('90 of 400 flights')}, ${b('Closed at 22.5%')}, ${b('Jul 20 – Aug 3')}. Neutral, exact, and ${b('no shame or failure copy')} — the percent is the whole statement.`,
        })}
      </div>
    </div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">WHAT STAYS TRUE WHILE A REACHED GOAL IS STILL OPEN — AND WHAT HAPPENS WHEN NOTHING CAN BE READ</div>
        <h3>Past the target the mark stops moving, the percent stops counting, and the exact total keeps going.</h3>
      </div>
      <div class="how">Board 02's confirmation captures at ${b('4fe51f0')}, Board 01's short phone at ${b('05a76bb')}, and the accepted Page 4 AFTER evidence at ${b('02e24df')} — all read in place.</div>
    </div>
    <div class="phones" style="gap:26px">
      ${phone({
        file: B02('confirmed-post-target-390x844.png'),
        width: W,
        slot: LIVE_SLOT,
        tag: 'fresh',
        tagText: LATER,
        title: 'Post-target · 532 of 500',
        sub: `Twenty added to a total already past the target. The mark was full and ${b('stays full')}; ${b('100% complete')} does not become 106%; and ${b('32 beyond our goal · still open')} is where the extra lives. The frame's own ${b('SAMPLE DATA')} strip is as captured.`,
      })}
      ${phone({
        file: B01('phone-short-reached-open-390x640-actions.png'),
        width: W,
        slot: LIVE_SLOT,
        tag: 'fresh',
        tagText: LATER,
        title: 'Reached and open · the actions remain',
        sub: `The same 512 of 500 on a 390×640 phone, scrolled to the actions: ${b('Start moving')} and ${b('Already moved? Record squats')} are both still there. Reaching the target ${b('does not close the goal')} and does not withdraw the way to add to it.`,
      })}
      ${phone({
        file: P04('AFTER-rows-390x844.png'),
        width: W,
        slot: LIVE_SLOT,
        tag: 'real',
        tagText: ACCEPTED,
        title: 'Progress · running, then finished',
        sub: `The member's own page keeps the same split. ${b('REACHED')} on a finished row is computed from that goal's ${b('confirmed final total')}, never from its stamp. One mark only, on the most recent finished goal, filled by its real final total — ${b('the one-per-screen rule on a different surface')}, not a mini mark returning to Home.`,
      })}
      ${card({
        file: B01('state-unavailable.png'),
        slot: LIVE_SLOT,
        tagText: LATER,
        title: 'No confirmed total · no instrument',
        sub: `When the shared total cannot be read, the card shows ${b("Progress couldn't be loaded just now.")} and ${b('Try again')} — and draws ${b('no mark at all')}. A failed read is an error with a way out, never a fake empty list and never a zero.`,
      })}
    </div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">CORRECTED BELOW TARGET · PHOTOGRAPHED · THE SAME GOAL, BEFORE AND AFTER</div>
        <h3>An authoritative correction can take a goal back under its target. The stamp stays in the record; the present tense does not.</h3>
      </div>
      <div class="how">The goal ${b('actually reaches')} its target — a real <b style="color:${NAVY}">wsfContribute</b> crosses it and the ${b('server')} stamps <b style="color:${NAVY}">reachedAt</b> — and a real <b style="color:${NAVY}">wsfAdjustGoal</b> by the community's own Champion then moves the confirmed total below it. Nothing is seeded reached and no shard is hand-edited. Captured at app-shell ${b('44cc063')}; per-frame sha256 in <b style="color:${NAVY}">lifecycle-corrected-current/README.md</b>.</div>
    </div>
    <div class="phones" style="gap:26px">
      ${phone({
        file: CORR('home-reached-open-before-correction-390x844.png'),
        width: W,
        slot: CORR_SLOT,
        tag: 'fresh',
        tagText: CAPTURED,
        title: 'Before · it really did reach',
        sub: `${b('GOAL REACHED')}, the mark full, ${b('520 of 500 squats')}, ${b('100% complete')}, ${b('20 beyond our goal · still open')} — and ${b('Reached Sep 22')}, printed because that is the phase ${b('now')}. The stamp on this goal is a server event, not a fixture field.`,
      })}
      ${phone({
        file: CORR('home-corrected-below-target-390x844.png'),
        width: W,
        slot: CORR_SLOT,
        tag: 'fresh',
        tagText: CAPTURED,
        title: 'After · the same goal, the same screen',
        sub: `${b('460 of 500 squats')}, ${b('92% complete')}, ${b('Only 40 to go')}, the mark no longer full — and ${b('no reached date anywhere')}, while <b style="color:${NAVY}">reachedAt</b> is ${b('still in Firestore')}, asserted after the correction. 92% is past the 90% threshold, so the goal lands back in ${b('nearGoal')} and takes that phase's wording.`,
      })}
      ${phone({
        file: CORR('progress-corrected-below-target-390x844.png'),
        width: W,
        slot: CORR_SLOT,
        tag: 'fresh',
        tagText: CAPTURED,
        title: 'Progress · the rule, by contrast',
        sub: `The corrected goal runs with ${b('460 of 500 squats · 92%')} and ${b('no REACHED')}. Beside it a goal that ${b('is')} reached and closed keeps its badge and the screen's ${b('one full mark')}. The member's own ${b('520 squats')} is untouched: a goal-level correction moves the ${b('community total')} and makes no claim about whose contribution was wrong.`,
      })}
    </div>
  </div>

  <div class="two">
    <div class="side">
      <div class="panel dark">
        <div class="eyebrow seam">WHY THAT PAIR IS THE WHOLE LOCK</div>
        <h3>The current total decides. A historical stamp never does.</h3>
        <p class="note">${w('What the lock requires:')} current UI shows the current phase and status — ${w('460 of 500')}, ${w('92%')}, ${w('40 to go')} — and ${w('MUST NOT show "Reached on …"')} as if it still described the present. The frames above are that sentence, photographed.</p>
        <p class="note" style="margin-top:8px">${w('What the build does.')} <b style="color:${CREAM}">progressPhase()</b> reads the confirmed total, the target and the status, and nothing else. Community Home prints the reached date only when the goal has a <b style="color:${CREAM}">reachedAt</b> AND the current phase is <b style="color:${CREAM}">reachedOpen</b> or <b style="color:${CREAM}">closedReached</b>. Progress computes its own <b style="color:${CREAM}">reached</b> from <b style="color:${CREAM}">isReached(sharedTotal, target)</b>.</p>
        <p class="note" style="margin-top:8px">${w('The stamp is proved to survive, not assumed.')} After the correction the producer reads the goal document itself and asserts <b style="color:${CREAM}">reachedAt</b> is still there. Otherwise a missing date line would be evidence of ${w('deleted data')} rather than of a page reporting the present tense — the opposite of the rule.</p>
        <p class="note" style="margin-top:8px">${w('A zero is not a pass.')} Every post-correction check names the exact non-zero value, and the progress-error node is asserted absent, so a stale or failed read fails the producer instead of passing as "no reached treatment".</p>
        <p class="note" style="margin-top:8px">${w('It was once wrong, and the source keeps the record:')} <i>"a goal corrected down to 380 of 500 still wore REACHED, and still drew the celebratory Living WE, because of something that had been true a week earlier."</i> The same note adds the other half — an ${w('unconfirmed')} total is not a reached goal either.</p>
      </div>
      <div class="panel">
        <div class="eyebrow quiet">THE LOCK · WHAT EVERY FRAME ABOVE OBEYS</div>
        <div class="rules">
          <div>Building and Near Goal are ${b('current open states')} driven by confirmed total against target.</div>
          <div>Reached/Open keeps the mark full, says so, and ${b('leaves the actions in place')}.</div>
          <div>Past target the mark stays full, percent stays ${b('capped at 100%')}, overshoot stays exact.</div>
          <div>Closed/Reached: ${b('Reached')}, exact final total and period, ${b('no contribution action')}.</div>
          <div>Closed/Unfinished: neutral ${b('Closed at N%')}, exact total and period, ${b('no shame copy')}.</div>
          <div>${b('Only closed goals')} appear in History; open goals stay active and are never duplicated.</div>
          <div>History is ${b('absent when there is nothing to record')} — no decorative empty section.</div>
          <div>A failed read is an ${b('error with recovery')}, never a fake empty history.</div>
          <div>A closed-history row needs a ${b('real shared total and a time zone')} before it renders.</div>
          <div>Labels come from ${b('confirmed total + target + status')} — not from rounded percent text, and ${b('not from reachedAt alone')}.</div>
          <div>${b('reachedAt')} stays audit data; it prints only in reachedOpen or closedReached.</div>
          <div>Closed goals ${b('definitively refuse')} new contributions — distinct from an unknown write outcome.</div>
        </div>
      </div>
    </div>
    <div class="side">
      <div class="panel">
        <div class="eyebrow quiet">WHERE THIS BOARD IS HONEST ABOUT ITS OWN LIMITS</div>
        <table>
          <tr><td class="k">Three provenances</td><td class="d"><b>ACCEPTED BUILD · LATER CAPTURE</b> — Home and Progress are accepted at the staging pin ${b('3562156')}; these frames were shot afterwards (${b('05a76bb')}, ${b('4fe51f0')}, ${b('6e1ce26')}) for Boards 01–02 and the one-mark correction. A later capture of an accepted route is a fact about the frame, not a demotion of the route. <b>ACCEPTED BUILD · CAPTURED</b> — the accepted Page 4 AFTER evidence at ${b('02e24df')}. <b>CURRENT BUILD · CAPTURED</b> — the corrected-below-target trio, shot for this board at app-shell ${b('44cc063')} and awaiting no verdict of its own.</td></tr>
          <tr><td class="k">The gap this board once declared</td><td class="d">Its first cut had ${b('no frame')} of Corrected Below Target anywhere, said so on its own face, and named the fixture a real one would need. That is now built and shot rather than described — the producer is this board's own, gated for writes and ${b('asserted on every ordinary run')}, because the build has worn a stale REACHED before.</td></tr>
          <tr><td class="k">No mark was put back</td><td class="d">Community Home's secondary and History rows lost their mini marks in the ${b('2026-09-22 one-mark correction')}, and the frames used here are the corrected ones — the spec asserts exactly ${b('one')} <b>wsf-community-goal-we-*</b> element on the screen. Progress's single mark on its lead finished goal is ${b('current build')}, on a different surface, and is captioned as such rather than left to read as a relapse.</td></tr>
          <tr><td class="k">Not this board's subject</td><td class="d">The lock is explicit: private dated personal history — an individual activity log, dates, streaks — remains ${b("Board 04's separate unbuilt seam")} and is not community goal History. None is drawn or proposed here. This board also ${b('locks no new History route')}; History is a section of Community Home and a split on Progress, and it stays that.</td></tr>
          <tr><td class="k">Not reproduced</td><td class="d">The 390×640 and 430×932 classes of the Home correction frames; Board 04's loading, empty, failure and partial-failure states, which belong to the Progress page's own board; and the ${b('-end')} scrolled variants elsewhere in the atlas.</td></tr>
          <tr><td class="k">Fixtures</td><td class="d">"Smyrna Strong", "Alpharetta Morning Movers", "500 Squats by Friday", "August push-ups", "July stairs" and every total on these frames are ${b('synthetic emulator fixtures')}, recorded in the JSON sidecars beside the captures and unchanged here. No real community, person or activity appears — and no names, faces, reactions, streaks, rankings or comparison anywhere.</td></tr>
        </table>
      </div>
    </div>
  </div>

  ${footer('WE_STAY_FIT_NORTH_STAR_BOARD_09_LIFECYCLE_HISTORY_FINAL', 'SELF-CHECKED · INDEPENDENT REVIEW PENDING · PR #365 comment 5771469193 · current build / review: lifecycle truth from the confirmed total, never from reachedAt — including Corrected Below Target, photographed before and after on the same goal')}
  `,
});
