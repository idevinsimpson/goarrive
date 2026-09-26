/**
 * SETTINGS: select a community, open Settings from You, read the privacy
 * sections, close.
 *
 * What changed at 938e00d8 (COMMUNITY-SETTINGS-PARITY-1): Settings as the
 * inset panel with × Close, and the privacy sections with the selected
 * community first.
 *
 * Asserted against seeded stored values. Not exercised: changing a switch.
 * The save goes through wsfSetCommunityVisibility, which staging holds
 * transport-shut, so a toggle here would test the transport, not the journey.
 */
import { attr, recorder, textWhen, vis } from './helpers.mjs';

export async function settings({ page, baseUrl, fixtures }) {
  const fx = await fixtures.memberInTwoCommunities('settings');
  const r = recorder();
  const selected = fx.b;
  const rest = fx.a;

  await fixtures.signIn(page, baseUrl, fx.member);
  r.did('signed in through /signin as the synthetic member');
  await page.goto(`${baseUrl}/community`);
  r.did('opened the Community tab');
  const shown = await textWhen(page, 'wsf-parity-name', (t) => t === fx.a.name || t === fx.b.name, 60_000);
  if (shown !== selected.name) {
    await page.locator(`[data-testid="wsf-parity-chip-${selected.id}"]:visible`).first().click();
    r.did(`pressed the ${selected.name} chip to select it`);
  }
  const now = await textWhen(page, 'wsf-parity-name', (t) => t === selected.name);
  r.expect(`${selected.name} is the selected community before Settings opens`, now === selected.name, now);

  await vis(page, 'wsf-member-tab-you').click();
  r.did('opened the You tab');
  await vis(page, 'wsf-you-settings').waitFor({ state: 'visible', timeout: 40_000 });
  await vis(page, 'wsf-you-settings').click();
  r.did('pressed Settings');

  const panel = page.locator('[data-testid="wsf-settings-panel"]');
  await panel.first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
  r.expect('Settings opens as the panel overlay', (await panel.count()) === 1, await panel.count());

  await page.locator(`[role="switch"][data-testid="wsf-privacy-panel-name-${rest.id}"]`).first().waitFor({ state: 'visible', timeout: 40_000 }).catch(() => {});
  const order = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="switch"][data-testid^="wsf-privacy-panel-name-"]'))
      .filter((n) => n.getClientRects().length > 0)
      .map((n) => n.getAttribute('data-testid').replace('wsf-privacy-panel-name-', '')));
  r.expect(`the privacy sections list ${selected.name} first`, order[0] === selected.id, order.join(','));
  r.expect('both communities have a privacy section', order.length === 2 && order.includes(rest.id), order.length);

  for (const c of [fx.a, fx.b]) {
    for (const [kind, want] of [['name', c.nameVisible], ['activity', c.activityVisible]]) {
      const got = await attr(page, `wsf-privacy-panel-${kind}-${c.id}`, 'aria-checked');
      r.expect(`${c.name}: the ${kind} switch shows the stored value (${want ? 'on' : 'off'})`, got === String(want), got);
    }
  }
  const blockA = await textWhen(page, `wsf-privacy-panel-block-${fx.a.id}`, (t) => t.includes('Anonymous member'));
  r.expect(`${fx.a.name}: a private name is explained as "Anonymous member"`, (blockA || '').includes('Members see “Anonymous member”'), blockA);
  const blockB = await textWhen(page, `wsf-privacy-panel-block-${fx.b.id}`, (t) => t.includes('CHAMPION'));
  r.expect(`${fx.b.name}: the founding Champion's section carries the CHAMPION badge`, (blockB || '').includes('CHAMPION'), blockB);

  await vis(page, 'wsf-settings-close').click();
  r.did('pressed × Close');
  await panel.first().waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
  r.expect('Close dismisses the panel', (await panel.count()) === 0, await panel.count());
  r.expect('You is showing again after Close', await vis(page, 'wsf-you-settings').isVisible().catch(() => false));

  return { setupId: fx.setupId, actionsPerformed: r.actionsPerformed, assertions: r.assertions };
}
