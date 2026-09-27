/**
 * HOME: open Home for one community, read its goal, open both actions and come
 * back, leave for the Community tab and return.
 *
 * What changed at a3127651 (HOME-NORTHSTAR-PARITY-1): Home at
 * /community/<groupId> recomposed around the community's goal card -- the
 * exact confirmed total, "Start moving" and "Already moved" as a pair, and the
 * member's own part set beside the shared confirmed total, never merged.
 *
 * Asserted from the product's own rendering of seeded, known facts. The
 * member is a plain member of community A (fixture-kit.mjs), whose one open
 * goal has 120 of 500 squats confirmed and no own total for this member, so
 * the own part is its true zero state.
 *
 * Not asserted: who moved today, the presence faces and the Members link,
 * which read wsfCommunityMembers / wsfCommunityActivity, services staging
 * holds transport-shut; a failed read there is not a Home defect. Not
 * exercised: recording a contribution. The driver opens both action screens
 * and leaves them without submitting, so it creates nothing outside its own
 * tracked fixtures.
 *
 * How each screen is left is the served contract, not a guess (run 56 threw
 * clicking a Back the served screen does not draw): at a3127651 "Start
 * moving" opens MOVE's flow as a SHEET over the still-mounted Home
 * (APP-FEEL-PARITY-1, isMoveSheetRoute: move mode only) whose one exit is
 * Close (wsf-contribute-close) and which draws no page Back; "Already moved"
 * (record mode) is the page flow, left by its Back (wsf-contribute-back).
 * Because Home stays painted under the sheet, returning is asserted only once
 * the sheet itself is gone.
 *
 * Every assertion is tagged with the manifest row it measures ([identity],
 * [goal], …): the owner card prints the manifest's rows, so each one has to be
 * a row this driver asserts.
 */
import { attr, recorder, textWhen, vis } from './helpers.mjs';

/** The manifest's `expected` rows, in order, keyed by the tag each assertion carries. */
export const HOME_ROWS = Object.freeze({
  identity: 'Home opens for the intended community, named in its header',
  goal: 'the community\'s own open goal renders with its title and open window, and no other community\'s goal',
  figures: 'the goal reads its exact confirmed total: 120 of 500 squats',
  own: 'the member\'s own part is its true zero state beside the shared confirmed total, never a fabricated or merged figure',
  actions: 'Start moving and Already moved are present, labelled, and each opens its own screen for this goal',
  returns: 'Close from Start moving\'s sheet and Back from Already moved\'s screen, and Community then Home, return to the same community and goal',
});

/** Community A's goal as fixture-kit.mjs seeds it (target, confirmed shards, unit); no own total. */
export const HOME_SEEDED = Object.freeze({ target: 500, shared: 120, unit: 'squats' });

export async function home({ page, baseUrl, fixtures }) {
  const fx = await fixtures.memberInTwoCommunities('home');
  const r = recorder();
  const row = (key) => (expected, ok, seen) => r.expect(`[${key}] ${expected}`, ok, seen);
  const c = fx.a;
  const other = fx.b;
  const g = c.goalId;
  const total = `${HOME_SEEDED.shared} of ${HOME_SEEDED.target} ${HOME_SEEDED.unit}`;

  await fixtures.signIn(page, baseUrl, fx.member);
  r.did('signed in through /signin as the synthetic member');
  await page.goto(`${baseUrl}/community/${c.id}`);
  r.did(`opened Home for ${c.name} (/community/<groupId>)`);

  // [identity] and [goal]: the right community, its own open goal, nothing else's.
  const name = await textWhen(page, 'wsf-community-name', (t) => t === c.name, 60_000);
  row('identity')(`Home names ${c.name}`, name === c.name, name);
  const title = await textWhen(page, `wsf-community-goal-title-${g}`, (t) => t === c.goalTitle);
  row('goal')(`the goal card shows the community's own goal "${c.goalTitle}"`, title === c.goalTitle, title);
  const period = await textWhen(page, `wsf-community-goal-period-${g}`, (t) => /^Open · Ends /.test(t));
  row('goal')('the goal\'s window reads Open · Ends …', /^Open · Ends /.test(period || ''), period);
  const leaked = await vis(page, `wsf-community-goal-title-${other.goalId}`).count();
  row('goal')(`no goal of ${other.name} is shown on ${c.name}'s Home`, leaked === 0, leaked);

  // [figures] and [own]: exact confirmed facts, the own part never merged into or taken from the shared total.
  const shown = await textWhen(page, `wsf-community-goal-total-${g}`, (t) => t === total);
  row('figures')(`the goal total reads ${total}`, shown === total, shown);
  const part = await textWhen(page, `wsf-community-your-part-${g}`, (t) => t.includes('Your first contribution counts here.'));
  row('own')('the member\'s own part is the zero state "Your first contribution counts here."', (part || '').includes('Your first contribution counts here.'), part);
  row('own')('no own figure is invented ("You’ve added …" is absent)', part !== null && !/You’ve added/.test(part), part);
  const shared = await textWhen(page, `wsf-community-your-part-shared-${g}`, (t) => t === `Part of our shared ${HOME_SEEDED.shared}`);
  row('own')(`beside it, the shared confirmed total reads "Part of our shared ${HOME_SEEDED.shared}"`, shared === `Part of our shared ${HOME_SEEDED.shared}`, shared);

  // [actions] and [returns]: each action opens its own screen for this goal; Back returns to this Home.
  // The two served exits. The sheet's Close and the page's Back are different controls with
  // different testIDs at a3127651, on purpose; neither stands in for the other.
  const CLOSE = { id: 'wsf-contribute-close', label: 'Close', sheet: true };
  const BACK = { id: 'wsf-contribute-back', label: 'Back', sheet: false };
  const sheetOpen = async () => (await vis(page, 'wsf-contribute-sheet').count()) > 0;
  /** Get back to Home after a failed step, by whichever served exit is drawn, so one defect fails only its own row. */
  const recover = async (why, tried = null) => {
    for (const exit of [CLOSE, BACK].filter((x) => x !== tried)) {
      if (await vis(page, exit.id).count()) {
        await vis(page, exit.id).click();
        r.did(`pressed ${exit.label} to recover (${why})`);
        return;
      }
    }
    if ((await vis(page, 'wsf-community-name').count()) === 0 || await sheetOpen()) {
      await page.goto(`${baseUrl}/community/${c.id}`);
      r.did(`reopened Home to recover (${why})`);
    }
  };
  const leave = async (from, exit) => {
    const present = (await vis(page, exit.id).count()) === 1;
    row('returns')(`${from} is left by its ${exit.label} (${exit.id})`, present);
    if (!present) { await recover(`${from} drew no ${exit.label}`); return; }
    await vis(page, exit.id).click();
    r.did(`pressed ${exit.label} from ${from}`);
    // Home stays mounted under the sheet: it is "returned to" only once the sheet itself is gone.
    if (exit.sheet) await vis(page, 'wsf-contribute-sheet').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
    const closed = !(await sheetOpen());
    const again = await textWhen(page, `wsf-community-goal-total-${g}`, (t) => t === total, 30_000);
    const back = await textWhen(page, 'wsf-community-name', (t) => t === c.name, 5_000);
    row('returns')(`${exit.label} from ${from} returns to ${c.name}'s Home with ${total}${exit.sheet ? ', the sheet closed' : ''}`,
      closed && back === c.name && again === total, `${closed ? 'no sheet' : 'sheet still open'} / ${back} / ${again}`);
    if (!closed) await recover(`the ${from} sheet stayed open`, exit);
  };
  const open = async (testId, label, screenId, screen) => {
    const control = vis(page, testId);
    const present = (await control.count()) === 1;
    const aria = present ? await attr(page, testId, 'aria-label') : null;
    row('actions')(`${label} is present, labelled "${aria === null ? label : aria}"`, present && aria === (label === 'Start moving' ? 'Start moving' : `Already moved? Record ${HOME_SEEDED.unit}`), aria);
    if (!present) return false;
    await control.click();
    r.did(`pressed ${label}`);
    await vis(page, screenId).waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    const opened = await vis(page, screenId).isVisible().catch(() => false);
    row('actions')(`${label} opens the ${screen} screen`, opened === true);
    if (!opened) {
      // The row has failed. Get back to Home before the next step, so one defect
      // fails its own row and does not strand the rest of the journey.
      await recover(`the ${screen} screen did not open`);
      return false;
    }
    if (screen === 'move') row('actions')('Start moving opens MOVE as the sheet over Home', await sheetOpen());
    const goalTitle = await textWhen(page, 'wsf-contribute-goal-title', (t) => t === c.goalTitle, 30_000);
    row('actions')(`the ${screen} screen is for "${c.goalTitle}"`, goalTitle === c.goalTitle, goalTitle);
    return true;
  };
  if (await open(`wsf-community-goal-link-${g}`, 'Start moving', 'wsf-contribute-move-screen', 'move')) await leave('Start moving', CLOSE);
  if (await open(`wsf-community-goal-record-${g}`, 'Already moved', 'wsf-contribute-entry-screen', 'record entry')) await leave('Already moved', BACK);

  const tab = async (testId, did) => {
    const present = (await vis(page, testId).count()) === 1;
    row('returns')(`the ${did} tab is available`, present);
    if (!present) return false;
    await vis(page, testId).click();
    r.did(`opened the ${did} tab`);
    return true;
  };
  if (await tab('wsf-member-tab-community', 'Community')) await tab('wsf-member-tab-home', 'Home');
  const returned = await textWhen(page, 'wsf-community-name', (t) => t === c.name, 30_000);
  const returnedTotal = await textWhen(page, `wsf-community-goal-total-${g}`, (t) => t === total, 30_000);
  row('returns')(`Community then Home returns to ${c.name}'s Home with ${total}`, returned === c.name && returnedTotal === total, `${returned} / ${returnedTotal}`);

  return { setupId: fx.setupId, actionsPerformed: r.actionsPerformed, assertions: r.assertions };
}
