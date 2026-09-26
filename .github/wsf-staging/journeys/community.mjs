/**
 * COMMUNITY: open the Community tab, switch the selected community, return.
 *
 * What changed at 938e00d8 (COMMUNITY-SETTINGS-PARITY-1): the banner with its
 * fact rows (Members, Your role, Goals), the selected community leading, and
 * "Champion" as the founding Champion's role fact.
 *
 * Asserted from the product's own rendering of seeded, known facts. Not
 * asserted: the roster, which reads wsfCommunityMembers, a service staging
 * holds transport-shut until its operator step is done.
 */
import { factValue, attr, recorder, textWhen } from './helpers.mjs';

export async function community({ page, baseUrl, fixtures }) {
  const fx = await fixtures.memberInTwoCommunities('community');
  const r = recorder();
  const byName = (n) => (n === fx.a.name ? fx.a : n === fx.b.name ? fx.b : null);

  await fixtures.signIn(page, baseUrl, fx.member);
  r.did('signed in through /signin as the synthetic member');
  await page.goto(`${baseUrl}/community`);
  r.did('opened the Community tab (/community)');

  const firstName = await textWhen(page, 'wsf-parity-name', (t) => byName(t) !== null, 60_000);
  const start = byName(firstName);
  r.expect('the Community tab opens on one of the member\'s own communities', start !== null, firstName);
  if (!start) return { setupId: fx.setupId, actionsPerformed: r.actionsPerformed, assertions: r.assertions };
  const other = start === fx.a ? fx.b : fx.a;

  const checkShowing = async (c, when) => {
    const members = await textWhen(page, 'wsf-parity-fact-members', (t) => factValue(t, 'Members') === String(c.members));
    r.expect(`${when}: the Members fact reads ${c.members}`, factValue(members, 'Members') === String(c.members), members);
    const role = await textWhen(page, 'wsf-parity-fact-role', (t) => factValue(t, 'Your role') === c.roleText);
    r.expect(`${when}: the Your role fact reads ${c.roleText}`, factValue(role, 'Your role') === c.roleText, role);
    const period = await textWhen(page, 'wsf-parity-period-title', (t) => t === c.goalTitle);
    r.expect(`${when}: This period shows the community's own active goal "${c.goalTitle}"`, period === c.goalTitle, period);
    r.expect(`${when}: the ${c.name} chip is marked as showing`, (await attr(page, `wsf-parity-chip-${c.id}`, 'aria-pressed')) === 'true');
  };
  await checkShowing(start, 'on open');

  await page.locator(`[data-testid="wsf-parity-chip-${other.id}"]:visible`).first().click();
  r.did(`pressed the ${other.name} chip to switch the selected community`);
  const switched = await textWhen(page, 'wsf-parity-name', (t) => t === other.name);
  r.expect(`after switching, the banner names ${other.name}`, switched === other.name, switched);
  await checkShowing(other, 'after switching');

  await page.reload();
  r.did('reloaded the Community tab (return)');
  const returned = await textWhen(page, 'wsf-parity-name', (t) => byName(t) !== null, 60_000);
  r.expect(`on return, the selected community is still ${other.name}`, returned === other.name, returned);

  return { setupId: fx.setupId, actionsPerformed: r.actionsPerformed, assertions: r.assertions };
}
