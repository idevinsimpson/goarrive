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
 * app-shell head (`5356e3c`) alike — one file, unchanged across all three. Two
 * neighbouring documents read the route as unbuilt: batch-b's README ("`/goals/
 * new` ... not implemented") and Board 06's status panel ("`/goals/new` and
 * `/combined/[setupId]` are unbuilt as well"). Both are contradicted by the
 * route file and by a frozen capture of it rendering, committed in the same
 * commit as that README. This board states the route's real state and changes
 * nobody else's file to do it.
 *
 * So this board carries TWO provenances and never blurs them:
 *
 *   CURRENT BUILD · CAPTURED   the two frozen BEFORE frames in
 *                              page-02-move/before — photographs of the real
 *                              route, at 02e24df. They are the ONLY frames of
 *                              this route that exist. They show arrival and
 *                              nothing below the fold.
 *
 *   TARGET DRAWING · NEVER     batch-b's B3 `TARGET-goal-*` set — drawn against
 *   BUILT                      the real kit in a gated preview route, never
 *                              implemented, and in three places not what the
 *                              lock locked. Each carries its own TARGET strip
 *                              burnt into the image and is tagged again here.
 *                              A target is never an after.
 *
 * Every locked state with no capture is NAMED, with where it is verified — the
 * route file and `e5-goal-form.spec.ts` — and is not drawn. A board does not
 * invent a screenshot for a state nobody photographed.
 *
 * NO LIVING WE APPEARS ON THIS BOARD. Setup has no confirmed shared total, and
 * the lock is explicit that the created screen does not fetch one merely
 * because a denominator now exists.
 */
import path from 'node:path';
import { REPO, frameHeight, header, footer, page, phone, NAVY, CREAM } from './lib.mjs';

const BUILT = (f) => path.join(REPO, 'docs/design-target/review/page-02-move/before', f);
const TARGET = (f) => path.join(REPO, 'docs/design-target/review/batch-b-join-and-setup', f);

export const width = 1280;
export const height = 2651;

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
const DRAWN = 'TARGET DRAWING · NEVER BUILT';

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
          <tr><td class="k">Their limit</td><td class="d">They are ${b('arrival only')}. No frame of this route exists for the repeat policy, the summary, submitting, the created screen, or any refusal. Those are named below and <b>not drawn</b>.</td></tr>
        </table>
      </div>
      <div class="panel">
        <div class="eyebrow quiet">LOCKED, BELOW THE FOLD, NOT PHOTOGRAPHED · READ FROM THE SOURCE</div>
        <div class="rules">
          <div>Durations are exactly ${b('1 week / 2 weeks / 1 month / Custom')}; preset start is the quarter-hour just passed and the end derives from it.</div>
          <div>Zone comes from the device and is said in words — <b>"Times are in Eastern Time"</b>. The spec asserts there is ${b('no picker and no Change control')}.</div>
          <div>Two repeat choices, defaulting to ${b('One contribution per member')}; "Members can contribute again" is chosen deliberately.</div>
          <div>${b('Check it over')} is a card on the same form — Community, Goal, Target, Starts, Ends, Time zone, Members — not a wizard screen.</div>
          <div>Validation appears ${b('after submit')}, under its own field; the first refused field takes focus.</div>
          <div>The primary reads ${b('Start this goal')} → ${b('Starting…')}; one server message at a time, in human words.</div>
          <div>Created: ${b('Your goal is live')} + "Send it to your members and put it on a screen.", the goal summary, one primary ${b('Open the contribute page')}, secondary ${b('Show on a big screen')}, and ${b('Back to community')}.</div>
          <div>Verified in ${b('app/goals/new.tsx')} and ${b('tests-e2e/e5-goal-form.spec.ts')}, which asserts the defaults, every validation message, the focus, the absent zone picker, the created screen's links — and that neither the goal id nor the group id is ever on screen.</div>
        </div>
      </div>
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
      <h3>Built and reachable on staging; refused everywhere else; accepted nowhere.</h3>
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
          <tr><td class="k">"Unbuilt" — corrected here</td><td class="d">Batch B's README (<b>"/goals/new ... not implemented"</b>) and Board 06's status panel (<b>"/goals/new and /combined/[setupId] are unbuilt as well"</b>) both read this route as unbuilt. The route file and a frozen capture of it rendering were committed in ${b('the same commit')} as that README. Board 08 states the route as ${b('built and staging-gated')} and cites the blob. Those are other workers' files; ${b('neither was touched')} — the correction is recorded, not applied to them.</td></tr>
          <tr><td class="k">Captured vs. verified</td><td class="d">Two frames are photographs. Everything else about the route on this board is read from the route file and its spec and is ${b('named, never drawn')}.</td></tr>
          <tr><td class="k">Not drawn here</td><td class="d">The 430×932 class; the ${b('-end')} scrolled variants of the target set; ${b('/combined/[setupId]')}, which is a read-only watch surface, not setup; and page-02-move's ${b('unit-shortcut proposal')} for this route, which is an open owner decision and is adopted by nothing on this board.</td></tr>
          <tr><td class="k">Fixtures</td><td class="d">"Alpharetta Morning Movers" on the captures, "The Henderson Family" and "October Push-Up Challenge" on the drawings, are synthetic and stay as captured. No real community, person or goal appears.</td></tr>
        </table>
      </div>
    </div>
  </div>

  ${footer('WE_STAY_FIT_NORTH_STAR_BOARD_08_GOAL_SETUP_FINAL', 'SELF-CHECKED · INDEPENDENT REVIEW PENDING · PR #365 comment 5771436211 · current build, staging-only: built route photographed at arrival; the batch-b redesign is drawn and never built')}
  `,
});
