import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';
import {
  firestoreWrite,
  seedActiveGoal,
  seedCommunity,
  seedMembership,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
  tsField,
} from './helpers/mobile';
import { GOAL_TZ, seedContribution } from './sprint-w8-social-fixture';

/**
 * W9 — HOME-NORTHSTAR-PARITY-1 (Director #497 `5846941982`, W9 ACK `5846952566`).
 *
 * THE REFERENCE: Lovable `e15b9fa0…` @ `973e1141`, `motion-handoff-evidence/`
 *   mhc-home-default-390x640.png  sha256 fcb0d786…
 *   mhc-home-default-390x844.png  sha256 8f79bb31…
 * decoded byte for byte from their `.b64` twins into
 * `docs/design-target/review/home-northstar-parity-1/reference/`.
 *
 * THE FIXTURE is the reference's own sample state, FIXTURE DATA ONLY, seeded
 * into the local emulator (`demo-wsf-local`): "Oak Grove Together", 23
 * members, 12 moved today, "500 squats together" at 241 of 500 confirmed, the
 * member's own confirmed 25, the member's own +20 eight minutes ago leading
 * the momentum. Nothing reads or writes production.
 *
 * TWO GATED PRODUCERS (WSF_CAPTURE_FRAMES=1):
 *   WSF_HNS_STAGE=BASE       the development base 6deefe7d, served
 *   WSF_HNS_STAGE=CANDIDATE  this packet's build, served
 * Each writes the full 390×H route frame at device pixel ratio 1 (the
 * originals' ratio), and against the original: side-by-side (labels in a
 * strip ABOVE both frames), a 50 % overlay and a difference image -- no crop,
 * no alignment -- plus a manifest with the measured differing share (a
 * measurement, not a verdict) and the first-screen geometry.
 *
 * UNGATED ROWS (every run): the truth rows the packet carries -- default,
 * stale/unknown, reached-open, no open goal -- and warm return.
 */

const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.join(ROOT, 'docs/design-target/review/home-northstar-parity-1');
const REF = path.join(OUT, 'reference');
const STAGE = (process.env.WSF_HNS_STAGE ?? 'CANDIDATE').toUpperCase();
if (STAGE !== 'BASE' && STAGE !== 'CANDIDATE') throw new Error(`bad stage ${STAGE}`);
const BASE_SHORT = '6deefe7';
/** Local iteration on an uncommitted build: frames say WIP, never CANDIDATE. */
const ITERATE = /^(1|true)$/i.test(process.env.WSF_HNS_ITERATE ?? '');
const LABEL = ITERATE ? 'WIP' : STAGE;
const PASSWORD = 'Sup3rSecret!23';

const SHOTS = [
  { key: '390x844', vp: { width: 390, height: 844 }, ref: 'mhc-home-default-390x844.png' },
  { key: '390x640', vp: { width: 390, height: 640 }, ref: 'mhc-home-default-390x640.png' },
] as const;

const sha256 = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** The member's own exact credit, written the way `wsfContribute` writes it. */
async function seedOwnTotal(goalId: string, uid: string, total: number): Promise<void> {
  await firestoreWrite(`wsfGoalMemberTotals/${goalId}_${uid}`, {
    goalId: { stringValue: goalId },
    userId: { stringValue: uid },
    total: { integerValue: String(total) },
    contributionCount: { integerValue: '2' },
    updatedAt: tsField(new Date()),
  } as never);
}

type Variant = 'default' | 'reached-open' | 'no-open-goal';

/** The reference's sample state. FIXTURE ONLY. */
async function fixture(tag: string, variant: Variant = 'default') {
  const s = `${stampId()}${tag}`;
  const email = `wsf-w9hns-${s}@example.com`;
  const me = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(me, 'Alex M.');
  const groupId = `w9hns-oak-${s}`;
  const goalId = `w9hns-500-${s}`;
  const others = Array.from({ length: 22 }, (_, i) => `w9hns-${s}-p${i}`);
  await seedCommunity({ groupId, displayName: 'Oak Grove Together', joinPolicy: 'private', members: [{ uid: me, role: 'member' }] });
  await seedMembership(groupId, others[0]!, 'foundingChampion');
  for (const uid of others.slice(1)) await seedMembership(groupId, uid, 'member');
  await seedProfile(others[0]!, 'Jordan P.');
  await seedProfile(others[1]!, 'Kira T.');
  // The reference counts 23 members and draws three faces plus "+20": all
  // 23 are visible there. So these twenty are visible here too, under names
  // that say what they are.
  for (const [i, uid] of others.slice(2).entries()) {
    await seedProfile(uid, `Sample Member ${String(i + 3).padStart(2, '0')}`);
  }
  if (variant === 'no-open-goal') return { email, me, groupId, goalId: null as string | null };
  const total = variant === 'reached-open' ? 512 : 241;
  await seedActiveGoal({ goalId, groupId, ownerUid: others[0]!, title: '500 squats together', target: 500, unit: 'squats', total, timezone: GOAL_TZ });
  // Twelve people moved today, the member first (+20, 8 minutes ago).
  await seedContribution(groupId, goalId, me, 20, 8);
  for (const [i, uid] of others.slice(0, 11).entries()) await seedContribution(groupId, goalId, uid, 10 + i, 20 + i * 11);
  await seedOwnTotal(goalId, me, 25);
  return { email, me, groupId, goalId: goalId as string | null };
}

async function openHome(page: Page, fx: Awaited<ReturnType<typeof fixture>>) {
  await signInVia(page, fx.email, PASSWORD);
  await page.evaluate(([u, g]) => localStorage.setItem(`wsf.currentCommunity.${u}`, g), [fx.me, fx.groupId] as const);
  await page.goto(`/community/${fx.groupId}`);
  await expect(page.getByText('Oak Grove Together').first()).toBeVisible({ timeout: 60_000 });
}

async function compose(page: Page, lovable: string, candidate: string, base: string, caption: [string, string]) {
  const a = `data:image/png;base64,${fs.readFileSync(lovable).toString('base64')}`;
  const b = `data:image/png;base64,${fs.readFileSync(candidate).toString('base64')}`;
  await page.setContent('<html><body style="margin:0"></body></html>');
  const out = await page.evaluate(
    async ([srcA, srcB, capA, capB]) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        });
      const [ia, ib] = await Promise.all([load(srcA!), load(srcB!)]);
      if (ia.width !== ib.width || ia.height !== ib.height) throw new Error('size mismatch');
      const w = ia.width;
      const h = ia.height;
      const canvas = (cw: number, ch: number) => {
        const c = document.createElement('canvas');
        c.width = cw;
        c.height = ch;
        return [c, c.getContext('2d')!] as const;
      };
      const CAP = 28;
      const [side, sx] = canvas(w * 2 + 12, h + CAP);
      sx.fillStyle = '#ffffff';
      sx.fillRect(0, 0, side.width, side.height);
      sx.fillStyle = '#0B1F35';
      sx.font = '700 10px sans-serif';
      sx.fillText(capA!, 4, 18);
      sx.fillText(capB!, w + 16, 18);
      sx.drawImage(ia, 0, CAP);
      sx.drawImage(ib, w + 12, CAP);
      const [over, ox] = canvas(w, h);
      ox.drawImage(ia, 0, 0);
      ox.globalAlpha = 0.5;
      ox.drawImage(ib, 0, 0);
      const [diff, dx] = canvas(w, h);
      dx.drawImage(ia, 0, 0);
      dx.globalCompositeOperation = 'difference';
      dx.drawImage(ib, 0, 0);
      const data = dx.getImageData(0, 0, w, h).data;
      let differing = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i]! + data[i + 1]! + data[i + 2]! > 48) differing += 1;
      return {
        side: side.toDataURL('image/png'),
        over: over.toDataURL('image/png'),
        diff: diff.toDataURL('image/png'),
        differingShare: Math.round((differing / (w * h)) * 10_000) / 10_000,
      };
    },
    [a, b, caption[0], caption[1]] as const,
  );
  const write = (suffix: string, url: string) => {
    const file = `${base}-${suffix}.png`;
    fs.writeFileSync(file, Buffer.from(url.split(',')[1]!, 'base64'));
    return path.relative(OUT, file);
  };
  return {
    sideBySide: write('side-by-side', out.side),
    overlay50: write('overlay-50', out.over),
    difference: write('difference', out.diff),
    differingShare: out.differingShare,
  };
}

/** Where the first screen's parts land, by visible text, in viewport px. */
async function geometry(page: Page) {
  return page.evaluate(() => {
    const find = (re: RegExp) => {
      const all = Array.from(document.querySelectorAll('*')).filter(
        (n) => n.children.length === 0 && re.test((n.textContent ?? '').trim()) && (n as HTMLElement).getClientRects().length > 0,
      );
      const el = all[0] as HTMLElement | undefined;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
    };
    return {
      name: find(/^Oak Grove Together$/),
      goalTitle: find(/^500 squats together$/),
      total: find(/^241$/),
      startMoving: find(/^Start moving$/),
      alreadyMoved: find(/^Already moved$/),
      contribution: find(/^25 squats$/),
    };
  });
}

test.describe(`HOME-NORTHSTAR-PARITY-1 · matched producer · ${STAGE}`, () => {
  test.use({ deviceScaleFactor: 1 });

  for (const shot of SHOTS) {
    test(`${shot.key}: the Home route against the frozen original`, async ({ page }) => {
      test.skip(!CAPTURE_FRAMES, 'evidence is written only under WSF_CAPTURE_FRAMES=1');
      test.setTimeout(300_000);
      await page.setViewportSize(shot.vp);
      await page.goto('/health');
      const commit = ((await page.getByTestId('wsf-health-commit').innerText()).match(/[0-9a-f]{7,40}/) ?? [''])[0];
      expect(commit).not.toBe('');
      if (STAGE === 'BASE') expect(commit.startsWith(BASE_SHORT)).toBe(true);
      else if (!ITERATE) expect(commit.startsWith(BASE_SHORT)).toBe(false);

      const fx = await fixture(`m${shot.vp.height}`);
      await openHome(page, fx);
      await expect(page.getByText('500 squats together').first()).toBeVisible({ timeout: 60_000 });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(2_000);
      const dir = path.join(OUT, LABEL.toLowerCase());
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${LABEL}-FIXTURE-home-${shot.key}.png`);
      await page.screenshot({ path: file });
      const geo = await geometry(page);

      const ref = path.join(REF, shot.ref);
      const cmp = await compose(page, ref, file, path.join(dir, `cmp-home-${shot.key}`), [
        `FROZEN LOVABLE 973e1141 (original, ${shot.key})`,
        `${LABEL} ${commit} · FIXTURE SAMPLE DATA · NOT ACCEPTED`,
      ]);
      fs.writeFileSync(
        path.join(dir, `manifest-${shot.key}.json`),
        `${JSON.stringify(
          {
            fixtureOnly:
              'Every person, name and figure is the frozen reference’s sample data, seeded into the local emulator (demo-wsf-local) for this comparison only. No production read or write.',
            stage: LABEL,
            commit,
            viewport: shot.vp,
            deviceScaleFactor: 1,
            crop: 'none — full viewport frames on both sides',
            reference: { file: path.relative(OUT, ref), sha256: sha256(ref) },
            candidate: { file: path.relative(OUT, file), sha256: sha256(file) },
            ...cmp,
            geometry: geo,
          },
          null,
          2,
        )}\n`,
      );
    });
  }
});

/*
  THE TRUTH ROWS (ungated). The recomposition moves and restyles; it may not
  change what the screen claims. Each state is seeded, not narrated.
*/
test.describe('HOME-NORTHSTAR-PARITY-1 · truth rows', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });

  const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);

  test('default: the locked hierarchy, confirmed figures only, own part distinct from the shared total', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await fixture('d');
    await openHome(page, fx);
    const g = fx.goalId!;
    await expect(vis(page, `wsf-community-goal-total-${g}`)).toHaveText('241 of 500 squats', { timeout: 30_000 });
    await expect(vis(page, 'wsf-community-descriptor')).toHaveText('Private community');
    // Three faces and "+20": every one of the 23 is visible here.
    await expect(vis(page, 'wsf-presence-row')).toContainText('+20');
    await expect(vis(page, 'wsf-community-hero-moved-today')).toHaveText(/12 people moved today\.$/, { timeout: 30_000 });
    await expect(vis(page, `wsf-community-goal-period-${g}`)).toHaveText(/^Open · Ends /);
    // The exact own part, and beside it the shared confirmed total it is part of.
    await expect(vis(page, `wsf-community-your-part-${g}`)).toContainText('You’ve added 25 squats');
    await expect(vis(page, `wsf-community-your-part-shared-${g}`)).toHaveText('Part of our shared 241');
    // The pair: side by side, both at least 44 tall, the primary the wider.
    const start = await vis(page, `wsf-community-goal-link-${g}`).boundingBox();
    const record = await vis(page, `wsf-community-goal-record-${g}`).boundingBox();
    expect(Math.abs(start!.y - record!.y), 'one row').toBeLessThanOrEqual(1);
    expect(start!.height).toBeGreaterThanOrEqual(44);
    expect(record!.height).toBeGreaterThanOrEqual(44);
    expect(start!.width).toBeGreaterThan(record!.width);
    await expect(vis(page, `wsf-community-goal-record-${g}`)).toHaveAttribute('aria-label', 'Already moved? Record squats');
    // One level-1 heading, and nothing laid out past the viewport.
    expect(await page.locator('h1:visible, [role="heading"][aria-level="1"]:visible').count()).toBe(1);
    const over = await page.evaluate(() =>
      Array.from(document.querySelectorAll('*')).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.right > document.documentElement.clientWidth + 1 || r.left < -1);
      }).length,
    );
    expect(over, 'no element laid out past the viewport').toBe(0);
  });

  test('unknown: a progress read that fails invents no figure, no share and no moved-today line', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await fixture('u');
    // LABELLED INJECTION: the pulse is refused from the start.
    await page.route('**/wsfGoalPulse', (route) => route.abort('failed'));
    await openHome(page, fx);
    const g = fx.goalId!;
    await expect(vis(page, `wsf-community-goal-progress-error-${g}`)).toContainText('Progress couldn’t be loaded just now.', { timeout: 30_000 });
    await expect(vis(page, `wsf-community-goal-total-${g}`)).toHaveCount(0);
    await expect(vis(page, `wsf-community-your-part-shared-${g}`)).toHaveCount(0);
    await expect(vis(page, 'wsf-community-hero-moved-today')).toHaveCount(0);
  });

  test('last known: a refresh that fails keeps the confirmed figure, says so, and drops the live claims', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await fixture('s');
    await openHome(page, fx);
    const g = fx.goalId!;
    await expect(vis(page, `wsf-community-goal-total-${g}`)).toHaveText('241 of 500 squats', { timeout: 30_000 });
    await page.route('**/wsfGoalPulse', (route) => route.abort('failed'));
    await vis(page, 'wsf-community-progress-refresh').click();
    await expect(vis(page, `wsf-community-goal-last-known-${g}`)).toHaveText('Last known', { timeout: 15_000 });
    await expect(vis(page, `wsf-community-goal-period-${g}`)).toHaveCount(0);
    await expect(vis(page, `wsf-community-goal-total-${g}`)).toHaveText('241 of 500 squats');
    await expect(vis(page, `wsf-community-goal-stale-${g}`)).toContainText('last confirmed figure');
    await expect(vis(page, `wsf-community-your-part-shared-${g}`)).toHaveCount(0);
    await expect(vis(page, `wsf-community-your-part-${g}`)).toContainText('Your last-known contribution');
  });

  test('reached and still open: the kicker says so on a confirmed figure', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await fixture('r', 'reached-open');
    await openHome(page, fx);
    const g = fx.goalId!;
    await expect(vis(page, `wsf-community-goal-total-${g}`)).toHaveText('512 of 500 squats', { timeout: 30_000 });
    await expect(vis(page, 'wsf-community-goal-eyebrow')).toHaveText('Goal reached');
    await expect(vis(page, `wsf-community-your-part-shared-${g}`)).toHaveText('Part of our shared 512');
  });

  test('no open goal: no hero, no actions, no invented count', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await fixture('n', 'no-open-goal');
    await openHome(page, fx);
    await expect(vis(page, 'wsf-community-no-goal')).toContainText('No goal running yet', { timeout: 30_000 });
    await expect(vis(page, 'wsf-community-goal-hero')).toHaveCount(0);
    await expect(vis(page, 'wsf-community-hero-moved-today')).toHaveCount(0);
    await expect(page.locator('[data-testid^="wsf-community-goal-link-"]:visible')).toHaveCount(0);
  });

  test('warm return: Home stays mounted -- no loading replacement, no blank -- and reselecting Home is a no-op', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await fixture('w');
    await openHome(page, fx);
    const g = fx.goalId!;
    await expect(vis(page, `wsf-community-goal-total-${g}`)).toHaveText('241 of 500 squats', { timeout: 30_000 });
    // Watch every frame of the round trip for a loading screen or an empty Home.
    await page.evaluate(() => {
      const w = window as unknown as { __hnsSeen: string[] };
      w.__hnsSeen = [];
      const tick = () => {
        const home = document.querySelector('[data-testid="wsf-community-goal-hero"]');
        const loading = document.querySelector('[data-testid="wsf-community-loading"], [data-testid="wsf-community-goals-loading"]');
        if (loading && (loading as HTMLElement).getClientRects().length > 0) w.__hnsSeen.push('loading');
        if (!home) w.__hnsSeen.push('no-hero');
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await vis(page, 'wsf-member-tab-community').last().click();
    await page.waitForTimeout(600);
    await vis(page, 'wsf-member-tab-home').last().click();
    await expect(vis(page, `wsf-community-goal-total-${g}`)).toHaveText('241 of 500 squats');
    await page.waitForTimeout(600);
    const seen = await page.evaluate(() => (window as unknown as { __hnsSeen: string[] }).__hnsSeen);
    expect(seen.filter((s) => s === 'loading'), 'no loading replacement on a warm return').toEqual([]);
    expect(seen.filter((s) => s === 'no-hero'), 'Home never unmounts its hero').toEqual([]);
    // Reselecting the tab already in view changes nothing.
    const url = page.url();
    const hist = await page.evaluate(() => history.length);
    await vis(page, 'wsf-member-tab-home').last().click();
    await page.waitForTimeout(400);
    expect(page.url()).toBe(url);
    expect(await page.evaluate(() => history.length)).toBe(hist);
  });
});
