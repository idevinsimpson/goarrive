/**
 * BOARD 08 — GOAL SETUP.
 *
 * Locked by PR #365 comment 5771436211: "Board 08 now locks the Champion
 * goal-creation flow while preserving its real deployment boundary: this route
 * is hard-gated to staging/emulator/loopback and is NOT a production capability
 * yet." Status layer, from that lock: "CURRENT BUILD · STAGING-ONLY. Production
 * cannot access this route yet."
 *
 * THE ROUTE IS BUILT, AND SAYING OTHERWISE WOULD BE THE ERROR THIS BOARD EXISTS
 * TO AVOID. `apps/westayfit/app/goals/new.tsx` is 1,036 lines and renders every
 * locked line. Its blob is `e5be66f` at the staging pin `3562156`, at the
 * commit the frame below was captured in (`02e24df`) and at the current
 * app-shell head (`5356e3c`) alike — one file, unchanged across all three.
 *
 * That had to be argued when this board was first cut, because two neighbouring
 * documents described the route as unbuilt: batch-b's README ("`/goals/new` ...
 * not implemented") and Board 06's status panel as it then read. Both were
 * contradicted by the route file and by a frozen capture of it rendering,
 * committed in the same commit as that README. The Director reached the same
 * reading independently (5784588305) and Board 06's corrected board is now
 * accepted and integrated, so this is a SETTLED HISTORICAL ERROR rather than a
 * live disagreement — and no neighbouring file was ever changed from here.
 *
 * So this board carries TWO provenances and never blurs them:
 *
 *   CURRENT BUILD · CAPTURED   photographs of the real route. Two frozen BEFORE
 *                              frames in page-02-move/before (02e24df) show
 *                              arrival and nothing below the fold; W4's
 *                              goal-setup-current set (source 0757379) shows
 *                              everything they cannot — the lower form, both
 *                              repeat choices, the same-page summary, the
 *                              validation, the in-flight call, the real created
 *                              receipt, an interrupted request and its
 *                              recovery, and the entry refusals.
 *
 *   TARGET DRAWING · NEVER     batch-b's B3 `TARGET-goal-*` set — drawn against
 *   BUILT                      the real kit in a gated preview route, never
 *                              implemented, and in three places not what the
 *                              lock locked. Each carries its own TARGET strip
 *                              burnt into the image and is tagged again here.
 *                              A target is never an after.
 *
 * A board does not invent a screenshot for a state nobody photographed. The
 * first cut of this board had only the two arrival frames, so every state below
 * the fold was NAMED from the route file and `e5-goal-form.spec.ts` rather than
 * drawn. The Director's review (5785026250) called that honest but insufficient
 * — a description is not pixel evidence — and commissioned the captures. They
 * are here now, so those states are shown rather than described, and the
 * unimplemented drawings still stand in for nothing.
 *
 * NO LIVING WE APPEARS ON THIS BOARD. Setup has no confirmed shared total, and
 * the lock is explicit that the created screen does not fetch one merely
 * because a denominator now exists.
 */
import path from 'node:path';
import { REPO, frameHeight, header, footer, page, phone, NAVY, CREAM } from './lib.mjs';

const BUILT = (f) => path.join(REPO, 'docs/design-target/review/page-02-move/before', f);
const NOW = (f) => path.join(REPO, 'docs/design-target/review/goal-setup-current', f);
const TARGET = (f) => path.join(REPO, 'docs/design-target/review/batch-b-join-and-setup', f);

export const width = 1280;
export const height = 4151;

const W = 268;
const SLOT = Math.round((844 / 390) * W);
const SMALL_W = 200;
/*
  The batch-b targets carry their TARGET strip INSIDE the file, above the
  device area, so each is taller than a bare 390×844 frame. The slot is
  measured from the files themselves rather than assumed from the device
  class, or the tallest frame would spill over its own provenance tag.
*/
const TARGET_FRAMES = [
  'TARGET-goal-form-390x844.png',
  'TARGET-goal-errors-390x844.png',
  'TARGET-goal-live-390x844.png',
  'TARGET-goal-no-community-390x844.png',
  'TARGET-goal-unavailable-390x844.png',
];
const SMALL_SLOT = Math.max(...TARGET_FRAMES.map((f) => frameHeight(TARGET(f), SMALL_W)));

const CAPTURED = 'CURRENT BUILD · CAPTURED';
/*
  Two frames in the strip reached their state through an injection, and each
  says which on its own tag rather than in a footnote. The in-flight frame held
  the REAL callable open and then released it, so the receipt beside it is that
  same call's answer. The other ABORTED the call in transport — which is an
  interrupted request, NOT a server refusal, and establishes nothing about
  whether the write landed; the frame is captioned for what it actually shows,
  the recovery. No success response is fabricated anywhere.
*/
const CAPTURED_DELAY = 'CURRENT BUILD · CAPTURED · INJECTED DELAY';
const CAPTURED_NETWORK = 'CURRENT BUILD · CAPTURED · INJECTED NETWORK FAULT';
const CAPTURED_SHORT = 'CURRENT BUILD · CAPTURED · 390×640';
const DRAWN = 'TARGET DRAWING · NEVER BUILT';
/* The strip's frames are a uniform device class; the slot is measured anyway. */
const NOW_SLOT = frameHeight(NOW('form-summary-check-it-over-390x844.png'), SMALL_W);

const b = (t) => `<b style="color:${NAVY}">${t}</b>`;
const w = (t) => `<b style="color:${CREAM}">${t}</b>`;

export const html = page({
  width,
  height,
  body: `
  ${header('08', 'Goal setup')}

  <div class="copy">
    <div class="lead">What the community is counting, for how long, and who may add.</div>
    <div class="gov">INTERNAL BOARD COPY — NOT IN-APP MESSAGING. THE ONLY GOVERNING PUBLIC COPY IS BOARD 00'S LOCKED PAIR.</div>
  </div>

  <div class="two">
    <div>
      <div class="sec-head">
        <div>
          <div class="eyebrow">/goals/new · BUILT · STAGING-GATED · PHOTOGRAPHED</div>
          <h3>The community is already known, so the page names it and asks only what a goal is.</h3>
        </div>
      </div>
      <div class="phones">
        ${phone({
          file: BUILT('BEFORE-goal-new-390x844.png'),
          width: W,
          slot: SLOT,
          tag: 'fresh',
          tagText: CAPTURED,
          title: 'Arrival · 390×844',
          sub: `The community's ${b('name')} leads as the eyebrow and its id is nowhere on the page. Heading ${b('Start a goal')}; under it the locked two lines, verbatim. ${b('The goal')} is one card — Goal name, Target, What you're counting — with the phrase it makes ("5,000 squats", "300 miles") stated as guidance. ${b('When')} opens with ${b('1 week')} already chosen. The member tab bar belongs to the shell the capture was taken in.`,
        })}
        ${phone({
          file: BUILT('BEFORE-goal-new-390x640.png'),
          width: W,
          slot: SLOT,
          tag: 'fresh',
          tagText: CAPTURED,
          title: 'Arrival · 390×640 · the short phone',
          sub: `The same screen where the fold is hardest. Arrival ends ${b('inside the goal card')} — the third field is cut by the tab bar and the whole of ${b('When')}, the repeat policy, ${b('Check it over')} and the primary are below it. Nothing is stretched: this is the frame as captured.`,
        })}
      </div>
    </div>
    <div class="side">
      <div class="panel">
        <div class="eyebrow quiet">WHAT THESE TWO FRAMES ARE, EXACTLY</div>
        <table>
          <tr><td class="k">The frames</td><td class="d">${b('docs/design-target/review/page-02-move/before/BEFORE-goal-new-390x{844,640}.png')} — read in place, never copied or re-captured. Committed at ${b('02e24df')} (2026-09-21) and frozen by <b>check-evidence-intact.mjs</b>. They were shot as the MOVE package's baseline, which is why they are named BEFORE; what they photograph is this route.</td></tr>
          <tr><td class="k">Still current</td><td class="d">${b('app/goals/new.tsx')} is the same blob ${b('e5be66f')} at 02e24df, at the staging pin ${b('3562156')} and at the app-shell head ${b('5356e3c')}. The capture is therefore a photograph of the route those three commits carry, not of an older one.</td></tr>
          <tr><td class="k">Their limit</td><td class="d">They are ${b('arrival only')} — they stop at the top of the form. Everything below it was described from source on the first cut of this board and is now ${b('photographed')}, in the strip beneath.</td></tr>
        </table>
      </div>
      <div class="panel">
        <div class="eyebrow quiet">THE LOWER FORM, READ FROM THE SOURCE — AND NOW PHOTOGRAPHED BELOW</div>
        <div class="rules">
          <div>Durations are exactly ${b('1 week / 2 weeks / 1 month / Custom')}; preset start is the quarter-hour just passed and the end derives from it.</div>
          <div>Zone comes from the device and is said in words — <b>"Times are in Eastern Time"</b>. The spec asserts there is ${b('no picker and no Change control')}.</div>
          <div>Two repeat choices, defaulting to ${b('One contribution per member')}; "Members can contribute again" is chosen deliberately.</div>
          <div>${b('Check it over')} is a card on the same form — Community, Goal, Target, Starts, Ends, Time zone, Members — not a wizard screen.</div>
          <div>Validation appears ${b('after submit')}, under its own field; the first refused field takes focus.</div>
          <div>The primary reads ${b('Start this goal')} → ${b('Starting…')}; one server message at a time, in human words.</div>
          <div>Created: ${b('Your goal is live')} + "Send it to your members and put it on a screen.", the goal summary, one primary ${b('Open the contribute page')}, secondary ${b('Show on a big screen')}, and ${b('Back to community')}.</div>
          <div>Verified in ${b('app/goals/new.tsx')} and ${b('tests-e2e/e5-goal-form.spec.ts')}, which asserts the defaults, every validation message, the focus, the absent zone picker, the created screen's links — and that neither the goal id nor the group id is ever on screen. Every line here is now also ${b('visible in the strip below')}.</div>
        </div>
      </div>
    </div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow">THE REST OF THE ROUTE · PHOTOGRAPHED · /goals/new AT app-shell 0757379</div>
        <h3>Everything the arrival frames stop short of: the window, both repeat choices, the summary on the same page, and what a submit actually does.</h3>
      </div>
      <div class="how">W4's current-build set (${b('docs/design-target/review/goal-setup-current/')}), read in place, ${b('sha256 per frame')} in its README. Each state was ${b('asserted before its shot')}, and the form scrolls inside an element, so every frame is scrolled to the section it is named for. Fixture identity is constant: ${b('Harbor Walkers')} · ${b('Autumn squat challenge')} · ${b('30,000 squats')}.</div>
    </div>
    <div class="phones" style="gap:26px">
      ${phone({
        file: NOW('form-duration-derived-window-390x844.png'),
        width: SMALL_W,
        slot: NOW_SLOT,
        tag: 'fresh',
        tagText: CAPTURED,
        title: 'A preset window, in words',
        sub: `All four durations, ${b('2 weeks')} chosen, and the window that preset derives stated as ${b('Starts today at 10:15 PM')} / ${b('Ends Tuesday, Oct 6 at 10:15 PM')} — fourteen days on, which is what "2 weeks" means here. ${b('Times are in Coordinated Universal Time')} sits under it; the zone is the device's, in words.`,
      })}
      ${phone({
        file: NOW('form-custom-window-390x844.png'),
        width: SMALL_W,
        slot: NOW_SLOT,
        tag: 'fresh',
        tagText: CAPTURED,
        title: 'Custom · both ends explicit',
        sub: `${b('Custom')} exposes a ${b('Starts')} and an ${b('Ends')} control, filled. Note what is ${b('not')} here: no derived "Starts …" line. The route renders that line only while the duration is not custom — in Custom the control states the start. The ends line renders in both.`,
      })}
      ${phone({
        file: NOW('form-summary-check-it-over-390x844.png'),
        width: SMALL_W,
        slot: NOW_SLOT,
        tag: 'fresh',
        tagText: CAPTURED,
        title: 'Two choices, then Check it over',
        sub: `${b('Exactly two')} repeat choices — here the Champion has taken the explicit ${b('Members can contribute again')}. ${b('Check it over')} follows ${b('on the same page')}, reading back all seven rows, ending ${b('Members · Members can contribute again')}. Not a wizard step.`,
      })}
      ${phone({
        file: NOW('form-validation-first-refused-390x844.png'),
        width: SMALL_W,
        slot: NOW_SLOT,
        tag: 'fresh',
        tagText: CAPTURED,
        title: 'Refused, after the attempt',
        sub: `Each message sits ${b('under its own field')} — "Give your goal a name.", "Enter a whole number greater than zero.", "Say what you're counting, like squats or miles." The ${b('first refused field')} is the one brought into view and marked. Nothing complained while the Champion typed.`,
      })}
      ${phone({
        file: NOW('form-submitting-INJECTED-DELAY-390x844.png'),
        width: SMALL_W,
        slot: NOW_SLOT,
        tag: 'fresh',
        tagText: CAPTURED_DELAY,
        title: 'In flight · Starting…',
        sub: `The primary reads ${b('Starting…')} and the form is disabled behind it. The call is the ${b('real')} one, held open to photograph this instant and then ${b('released so it completes')} — the receipt beside is the answer to this same call.`,
      })}
    </div>
    <div class="phones" style="gap:26px;margin-top:26px">
      ${phone({
        file: NOW('created-receipt-390x844.png'),
        width: SMALL_W,
        slot: NOW_SLOT,
        tag: 'fresh',
        tagText: CAPTURED,
        title: 'Created · the real server answer',
        sub: `${b('Your goal is live')} + "Send it to your members and put it on a screen.", the goal read back with window, zone and policy, one primary ${b('Open the contribute page')}, secondary ${b('Show on a big screen')} with its purpose, and ${b('Back to community')}. Produced by the real <b style="color:${NAVY}">wsfCreateGoal</b>; the container carries the server-assigned goal id, which nothing on screen prints. ${b('No Living WE')} — nothing here has a confirmed total yet.`,
      })}
      ${phone({
        file: NOW('form-server-refusal-INJECTED-NETWORK-390x844.png'),
        width: SMALL_W,
        slot: NOW_SLOT,
        tag: 'fresh',
        tagText: CAPTURED_NETWORK,
        title: 'Request interrupted · injected network fault',
        sub: `The call was ${b('aborted in transport')}, which is what this frame establishes — ${b('not')} a server refusal, and nothing here shows whether the write landed. What it does show is the recovery: ${b('one')} message in human words, "Something went wrong. Please try again.", with no raw code; the summary and ${b('the typed title still there')}, so the work is not lost; and the primary back to ${b('Start this goal')}.`,
      })}
      ${phone({
        file: NOW('no-community-390x844.png'),
        width: SMALL_W,
        slot: NOW_SLOT,
        tag: 'fresh',
        tagText: CAPTURED,
        title: 'No community in context',
        sub: `${b('Choose a community before starting a goal.')} → ${b('Go to your communities')}. Nothing is asked for here, because the community page is the way in. This is the state the old drawing answers differently.`,
      })}
      ${phone({
        file: NOW('signed-out-390x844.png'),
        width: SMALL_W,
        slot: NOW_SLOT,
        tag: 'fresh',
        tagText: CAPTURED,
        title: 'Signed out',
        sub: `${b('Sign in to start a goal')} / "Only a signed-in Champion can start a goal for their community.", with ${b('Sign in')} at text weight. Real, and the one state on this route with ${b('no testID')} — reported by its capture, not a defect this board draws.`,
      })}
      ${phone({
        file: NOW('created-actions-390x640.png'),
        width: SMALL_W,
        slot: NOW_SLOT,
        tag: 'fresh',
        tagText: CAPTURED_SHORT,
        title: 'Created · 390×640 reachability',
        sub: `The same receipt on the short phone, where the fold is hardest: the card and the primary ${b('Open the contribute page')} are both above the tab bar. Reachability was proved by a ${b('hit test')} at the control's own centre, not by visibility alone.`,
      })}
    </div>
  </div>

  <div>
    <div class="sec-head">
      <div>
        <div class="eyebrow seam">BATCH B · B3 · DRAWN, NEVER BUILT — AND IN THREE PLACES NOT WHAT THE LOCK LOCKED</div>
        <h3>The redesign of this route exists as drawings only; the shipped route above is the one the lock describes.</h3>
      </div>
      <div class="how">Five ${b('drawings')} from ${b('batch-b-join-and-setup')}, read in place. Each carries its own TARGET strip burnt into the image and is tagged again here. ${b('A target is never an after.')} They are shown so the intended direction stays visible — not as evidence of anything shipped.</div>
    </div>
    <div class="phones" style="gap:26px">
      ${phone({
        file: TARGET('TARGET-goal-form-390x844.png'),
        width: SMALL_W,
        slot: SMALL_SLOT,
        tag: 'seam',
        tagText: DRAWN,
        title: 'The form, drawn',
        sub: `A navy hero and ${b('"Open a goal."')} where the lock and the build say ${b('Start a goal')} on cream; four numbered steps; chips instead of rows. Step 3 offers ${b('three')} choices — Once / Once a day / No limit — where the lock fixes ${b('exactly two')}.`,
      })}
      ${phone({
        file: TARGET('TARGET-goal-errors-390x844.png'),
        width: SMALL_W,
        slot: SMALL_SLOT,
        tag: 'seam',
        tagText: DRAWN,
        title: 'Refused fields, drawn',
        sub: `The one place drawing and build agree in principle: the complaint arrives ${b('after the attempt')} and sits under the field it belongs to. The wording is the drawing's own — "Give the goal a title." where the route says "Give your goal a name."`,
      })}
      ${phone({
        file: TARGET('TARGET-goal-live-390x844.png'),
        width: SMALL_W,
        slot: SMALL_SLOT,
        tag: 'seam',
        tagText: DRAWN,
        title: 'Created, drawn',
        sub: `${b('"Your goal is live."')}, the window, the zone and the policy on one card, then the same two actions the route ships. Its policy line reads "No limit per member" — a value the built form ${b('cannot produce')}. ${b('No Living WE')}, correctly: nothing here has a confirmed total.`,
      })}
      ${phone({
        file: TARGET('TARGET-goal-no-community-390x844.png'),
        width: SMALL_W,
        slot: SMALL_SLOT,
        tag: 'seam',
        tagText: DRAWN,
        title: 'No community, drawn',
        sub: `${b('"A goal needs a community."')} → Start a community. The lock and the route say ${b('"Choose a community before starting a goal"')} → ${b('Go to your communities')}, which sends a Champion to the communities they are already in rather than to making another.`,
      })}
      ${phone({
        file: TARGET('TARGET-goal-unavailable-390x844.png'),
        width: SMALL_W,
        slot: SMALL_SLOT,
        tag: 'seam',
        tagText: DRAWN,
        title: 'The gate, drawn',
        sub: `${b('"Not available here yet."')} — the drawing of the refusal a build outside staging or the emulator actually renders. The route's own card reads ${b("Starting a goal isn't available here yet")}. This state is the deployment boundary, drawn.`,
      })}
    </div>
  </div>

  <div class="two">
    <div class="side">
      <div class="panel dark">
      <div class="eyebrow seam">STATUS LAYER · CURRENT BUILD · STAGING-ONLY</div>
      <h3>Available in staging and local emulators; production UI gated; page acceptance pending.</h3>
      <p class="note">${w('a · The route is built.')} ${w('apps/westayfit/app/goals/new.tsx')}, 1,036 lines, renders every line the lock names. Blob ${w('e5be66f')} at the staging pin ${w('3562156')}, at ${w('02e24df')} and at ${w('5356e3c')} — one unchanged file.</p>
      <p class="note" style="margin-top:8px">${w('b · It is staging-only.')} A client gate refuses any build that is neither the local emulator suite nor a verified staging build, rendering a card and calling nothing. ${w('wsfIsStaging')} is true only where a complete config was verified for a project that is not ${w('goarrive')} — it cannot be switched on for a build pointed at production.</p>
      <p class="note" style="margin-top:8px">${w('c · That gate is a guard, not a boundary.')} The route says so itself: ${w('wsfCreateGoal')} carries no environment, origin or hostname condition — it checks auth, a verified email and an active founding-Champion membership, and nothing else. The screen prevents accidental production writes; it does not prevent deliberate ones.</p>
      <p class="note" style="margin-top:8px">${w('d · It is not an accepted page.')} The staging record accepts five member pages and the identity funnel; goal setup is not among them. This board records the route's state and ${w('grants it nothing')}.</p>
      <p class="note" style="margin-top:8px">${w('e · No Living WE appears on this board.')} Setup has no confirmed shared total, and the lock is explicit that the created screen does not fetch one merely because a denominator now exists.</p>
      </div>
      <div class="panel">
        <div class="eyebrow quiet">THE LOCK · WHAT THE ROUTE ABOVE OBEYS</div>
        <div class="rules">
          <div>The community arrives from route context; the page shows its ${b('name')}, never its id.</div>
          <div>A goal is ${b('one breath')} — name, whole-number target, free-text unit — echoed as a phrase.</div>
          <div>Custom exposes both start and end; presets show the window in words.</div>
          <div>The zone is ${b("the device's")}, stated in words, never guessed and never hidden in a picker.</div>
          <div>Repeat policy defaults ${b('conservatively')}; contributing again is an explicit choice.</div>
          <div>The summary reads back ${b('exactly what the community will see')}.</div>
          <div>Server refusals are ${b('human copy')} — no raw Firebase codes, and never stacked.</div>
          <div>Signed out, unverified, no community, refused, unreachable, submitting and created all stay ${b('distinct')}.</div>
          <div>No faces, names, counts of people, streaks, rankings or comparison; ${b('no Living WE without a confirmed ratio')}.</div>
        </div>
      </div>
    </div>
    <div class="side">
      <div class="panel">
        <div class="eyebrow quiet">WHERE THIS BOARD CORRECTS THE RECORD, AND WHERE IT STOPS</div>
        <table>
          <tr><td class="k">"Unbuilt" — a settled historical error</td><td class="d">Batch B's README (<b>"/goals/new ... not implemented"</b>) and Board 06's status panel, ${b('as it read on 2026-09-22 before its correction')}, both described this route as unbuilt. The route file and a frozen capture of it rendering were committed in ${b('the same commit')} as that README. The Director reached the same reading independently (${b('5784588305')}), Board 06's corrected board is now accepted and integrated, and this row stands as ${b('the record of a resolved discrepancy')}, not a live claim about Board 06. Neither of those files was touched from here.</td></tr>
          <tr><td class="k">Captured vs. verified</td><td class="d">${b('Twelve frames of this route are photographs')} — two arrival frames and W4's ten-state strip. The source and spec are cited where they explain <b>why</b> a frame looks as it does; nothing about the route is asserted here that a frame or a named file does not show. ${b('Nothing is drawn to fill a gap.')}</td></tr>
          <tr><td class="k">Not drawn here</td><td class="d">The 430×932 class; the ${b('-end')} scrolled variants of the target set; ${b('/combined/[setupId]')}, which is a read-only watch surface, not setup; and page-02-move's ${b('unit-shortcut proposal')} for this route, which is an open owner decision and is adopted by nothing on this board.</td></tr>
          <tr><td class="k">Fixtures</td><td class="d">"Alpharetta Morning Movers" on the arrival frames, "Harbor Walkers" / "Autumn squat challenge" / "30,000 squats" on W4's strip, and "The Henderson Family" / "October Push-Up Challenge" on the drawings are all ${b('synthetic')} and stay exactly as captured. No real community, person or goal appears. The strip's clock reads its capture run's own time.</td></tr>
        </table>
      </div>
    </div>
  </div>

  ${footer('WE_STAY_FIT_NORTH_STAR_BOARD_08_GOAL_SETUP_FINAL', 'SELF-CHECKED · INDEPENDENT REVIEW PENDING · PR #365 comment 5771436211 · current build: twelve photographs of the real route, arrival and the whole form; the batch-b redesign is drawn and never built')}
  `,
});
