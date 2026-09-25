import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type Browser, type Page, type Route } from '@playwright/test';

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

/**
 * YOU-PARITY-1 (Director #365 `5840666502`, lane C).
 *
 * The You route recomposed to the accepted Lovable reference `642f830b`:
 * identity leads; the current community and role in a navy band; the shared
 * Living WE position beside a SEPARATE exact confirmed own part; "Other goals
 * you helped" with truthful lifecycle; honest no-own / no-eligible / failed
 * states; the account last and quiet.
 *
 * The fixture reproduces the reference's own state as closely as canonical data
 * allows: "Alex M." in "Oak Grove Together" (23 members), "500 squats
 * together" at 241 of 500 with 25 of them this member's, and a reached,
 * still-open goal they also helped.
 *
 * EVIDENCE IS OPT-IN (WSF_CAPTURE_FRAMES=1). `WSF_YOU_PARITY_PHASE` names the
 * build being photographed (`before` = base 0b460ce3, `after` = candidate), so
 * one spec photographs both. Frames are captured at device pixel ratio 1,
 * because the reference originals are 390-wide at ratio 1 and an overlay needs
 * the same pixel grid. Nothing accepted is written.
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/review/you-parity-1');
const LOVABLE = path.join(OUT, 'lovable-642f830b');
const PHASE = process.env.WSF_YOU_PARITY_PHASE === 'before' ? 'before' : 'after';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

async function seedOwnCredit(goalId: string, uid: string, total: number): Promise<void> {
  await firestoreWrite(`wsfGoalMemberTotals/${goalId}_${uid}`, {
    goalId: { stringValue: goalId },
    userId: { stringValue: uid },
    total: { integerValue: String(total) },
    contributionCount: { integerValue: '1' },
    updatedAt: tsField(new Date()),
  });
}

type Fx = { email: string; password: string; uid: string; groupId: string };

type Variant = 'normal' | 'noOwn' | 'noEligible';

/** The reference's member and community. `variant` removes what the state lacks. */
async function seedReference(label: string, variant: Variant): Promise<Fx> {
  const id = stampId();
  const email = `wsf-${label}-${id}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Alex M.');
  const groupId = `${label}g-${id}`;
  await seedCommunity({
    groupId,
    displayName: 'Oak Grove Together',
    joinPolicy: 'inviteOnly',
    members: [{ uid, role: 'member' }],
  });
  // 22 more active members, so the band reads "23 members" as the reference
  // does. Memberships only: no account, profile or activity is invented.
  for (let i = 0; i < 22; i += 1) await seedMembership(groupId, `${label}m${i}-${id}`, 'member');

  if (variant === 'noEligible') return { email, password, uid, groupId };

  const lead = `${label}lead-${id}`;
  await seedActiveGoal({
    goalId: lead,
    groupId,
    ownerUid: uid,
    title: '500 squats together',
    target: 500,
    unit: 'squats',
    total: 241,
    endsAt: new Date(Date.now() + 2 * 24 * 60 * 60_000),
  });
  if (variant === 'noOwn') return { email, password, uid, groupId };
  await seedOwnCredit(lead, uid, 25);

  const other = `${label}other-${id}`;
  await seedActiveGoal({
    goalId: other,
    groupId,
    ownerUid: uid,
    title: '150 squats this week',
    target: 150,
    unit: 'squats',
    total: 155,
    endsAt: new Date(Date.now() + 6 * 24 * 60 * 60_000),
  });
  await seedOwnCredit(other, uid, 20);
  return { email, password, uid, groupId };
}

async function phone(browser: Browser, viewport: { width: number; height: number }, dpr = 2) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: dpr,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    userAgent: IPHONE_UA,
    timezoneId: 'America/New_York',
  });
  return { context, page: await context.newPage() };
}

async function top(page: Page, testId: string): Promise<number> {
  const box = await page.getByTestId(testId).first().boundingBox();
  expect(box, `${testId} has no box`).not.toBeNull();
  return box!.y;
}

const M = { width: 390, height: 844 };

test.describe('YOU-PARITY-1 · behaviour', () => {
  test('the member story leads, in the reference order, and the account is last', async ({ browser }) => {
    test.setTimeout(240_000);
    const fx = await seedReference('yp1', 'normal');
    const { context, page } = await phone(browser, M);
    await signInVia(page, fx.email, fx.password);
    await page.goto('/you');
    await expect(page.getByTestId('wsf-you-member')).toBeVisible({ timeout: 40_000 });

    await expect(page.getByTestId('wsf-you-name')).toHaveText('Alex M.');
    await expect(page.getByTestId('wsf-you-settings')).toBeVisible();
    await expect(page.getByTestId('wsf-you-community')).toContainText('Oak Grove Together');
    await expect(page.getByTestId('wsf-you-community')).toContainText('Member');
    await expect(page.getByTestId('wsf-you-community')).toContainText('23 members');

    const lead = page.getByTestId('wsf-you-lead');
    await expect(lead).toContainText('500 squats together');
    await expect(page.getByTestId('wsf-you-lead-status')).toHaveText('OPEN');
    await expect(page.getByTestId('wsf-you-lead-shared')).toHaveText('241 / 500 confirmed');
    // Your part, in its unit, and nothing joins it to the shared figure.
    await expect(page.getByTestId('wsf-you-lead-own')).toContainText('25');
    await expect(page.getByTestId('wsf-you-lead-own')).toContainText('squats');
    // No claim joins the two: no share of the total, no rank, no streak.
    // (The reference's own truth line says "No rank, streak, score…", so the
    // check is on claims, not on those words.)
    await expect(page.getByTestId('wsf-you-lead-own')).not.toContainText('%');
    await expect(lead).not.toContainText(/your share|of the total|#\d|\d+[- ]day streak/i);
    await expect(lead).toContainText('Shared and yours are separate facts.');

    const others = page.getByTestId('wsf-you-others');
    await expect(others).toContainText('Other goals you helped');
    await expect(others).toContainText('150 squats this week');
    await expect(others).toContainText('REACHED · STILL OPEN');
    await expect(others).toContainText('20 squats');
    await expect(others).toContainText('155 / 150 squats');

    // THE ORDER is the claim: who you are, where you belong, your part, the
    // other goals, and only then the account.
    const y = {
      identity: await top(page, 'wsf-you-identity'),
      community: await top(page, 'wsf-you-community'),
      lead: await top(page, 'wsf-you-lead'),
      others: await top(page, 'wsf-you-others'),
      account: await top(page, 'wsf-you-account'),
    };
    expect(y.identity).toBeLessThan(y.community);
    expect(y.community).toBeLessThan(y.lead);
    expect(y.lead).toBeLessThan(y.others);
    expect(y.others).toBeLessThan(y.account);
    // No email above the member story.
    expect(await top(page, 'wsf-you-email')).toBeGreaterThan(y.lead);

    // Sign-out is still reachable, and still works.
    await page.getByTestId('wsf-you-signout').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('wsf-you-signout')).toBeInViewport();
    await context.close();
  });

  test('no own part, with a goal open: Start moving opens MOVE', async ({ browser }) => {
    test.setTimeout(240_000);
    const fx = await seedReference('yp2', 'noOwn');
    const { context, page } = await phone(browser, M);
    await signInVia(page, fx.email, fx.password);
    await page.goto('/you');
    const card = page.getByTestId('wsf-you-nothing-yet');
    await expect(card).toContainText('Your first confirmed contribution can start here', { timeout: 40_000 });
    await expect(page.getByTestId('wsf-you-lead')).toHaveCount(0);
    await expect(page.getByTestId('wsf-you-community')).toContainText('Oak Grove Together');
    await page.getByTestId('wsf-you-start-moving').click();
    await page.waitForURL(/\/move/, { timeout: 20_000 });
    await context.close();
  });

  test('no own part and nothing open: no Start moving, a way to the community', async ({ browser }) => {
    test.setTimeout(240_000);
    const fx = await seedReference('yp3', 'noEligible');
    const { context, page } = await phone(browser, M);
    await signInVia(page, fx.email, fx.password);
    await page.goto('/you');
    const card = page.getByTestId('wsf-you-nothing-yet');
    await expect(card).toContainText('No goal is open for contributions', { timeout: 40_000 });
    await expect(card).toHaveAttribute('data-state', 'no-eligible-goal');
    await expect(page.getByTestId('wsf-you-start-moving')).toHaveCount(0);
    await expect(page.getByTestId('wsf-you-open-community')).toBeVisible();
    await context.close();
  });

  test('a failed goal read keeps identity AND community, and guesses nothing', async ({ browser }) => {
    test.setTimeout(240_000);
    const fx = await seedReference('yp4', 'normal');
    const { context, page } = await phone(browser, M);
    await signInVia(page, fx.email, fx.password);
    let failed = false;
    await page.route('**/wsfListGoals**', async (route: Route) => {
      if (!failed) {
        failed = true;
        return route.abort('failed');
      }
      return route.fallback();
    });
    await page.goto('/you');
    await expect(page.getByTestId('wsf-you-failed')).toContainText('Contribution details unavailable', {
      timeout: 40_000,
    });
    await expect(page.getByTestId('wsf-you-community')).toContainText('Oak Grove Together');
    await expect(page.getByTestId('wsf-you-name')).toHaveText('Alex M.');
    await expect(page.getByTestId('wsf-you-lead-own')).toHaveCount(0);
    await expect(page.getByTestId('wsf-you-failed')).not.toContainText(/\b0 squats\b/);
    await page.getByTestId('wsf-you-retry').click();
    await expect(page.getByTestId('wsf-you-lead')).toBeVisible({ timeout: 40_000 });
    await context.close();
  });
});

// ---------------------------------------------------------------------------
// EVIDENCE: canonical frames at DPR 1, then side-by-side / 50 % overlay /
// difference against the frozen Lovable originals.
// ---------------------------------------------------------------------------

type Shot = { state: string; variant: Variant | 'failed'; vp: { width: number; height: number }; lovable: string | null };

const SHOTS: Shot[] = [
  { state: 'normal', variant: 'normal', vp: { width: 390, height: 844 }, lovable: 'you-normal-390x844.png' },
  { state: 'normal', variant: 'normal', vp: { width: 390, height: 640 }, lovable: 'you-normal-390x640.png' },
  { state: 'no-own', variant: 'noOwn', vp: { width: 390, height: 844 }, lovable: 'you-no-own-390x844.png' },
  { state: 'no-own', variant: 'noOwn', vp: { width: 390, height: 640 }, lovable: 'you-no-own-390x640.png' },
  { state: 'no-eligible', variant: 'noEligible', vp: { width: 390, height: 844 }, lovable: 'you-no-eligible-390x844.png' },
  // The reference has no failure frame; this one is canonical-only evidence.
  { state: 'failed', variant: 'failed', vp: { width: 390, height: 844 }, lovable: null },
];

const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/**
 * Compose in the browser: [reference | canonical] side by side, a 50 % overlay,
 * and an absolute-difference image, plus the share of pixels whose summed
 * channel difference exceeds 48 (a measured figure, not a verdict).
 */
async function compose(page: Page, lovable: string, canonical: string, base: string) {
  const a = `data:image/png;base64,${fs.readFileSync(lovable).toString('base64')}`;
  const b = `data:image/png;base64,${fs.readFileSync(canonical).toString('base64')}`;
  await page.setContent('<html><body style="margin:0"></body></html>');
  const out = await page.evaluate(
    async ([srcA, srcB]) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        });
      const [ia, ib] = await Promise.all([load(srcA!), load(srcB!)]);
      const w = Math.max(ia.width, ib.width);
      const h = Math.max(ia.height, ib.height);
      const canvas = (cw: number, ch: number) => {
        const c = document.createElement('canvas');
        c.width = cw;
        c.height = ch;
        return [c, c.getContext('2d')!] as const;
      };
      const [side, sx] = canvas(w * 2 + 12, h);
      sx.fillStyle = '#ffffff';
      sx.fillRect(0, 0, side.width, side.height);
      sx.drawImage(ia, 0, 0);
      sx.drawImage(ib, w + 12, 0);
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
      for (let i = 0; i < data.length; i += 4) {
        if (data[i]! + data[i + 1]! + data[i + 2]! > 48) differing += 1;
      }
      return {
        side: side.toDataURL('image/png'),
        over: over.toDataURL('image/png'),
        diff: diff.toDataURL('image/png'),
        differingShare: differing / (w * h),
        size: [w, h],
      };
    },
    [a, b],
  );
  const write = (suffix: string, url: string) => {
    const file = `${base}-${suffix}.png`;
    fs.writeFileSync(file, Buffer.from(url.split(',')[1]!, 'base64'));
    return file;
  };
  return {
    sideBySide: write('side-by-side', out.side),
    overlay50: write('overlay-50', out.over),
    difference: write('difference', out.diff),
    differingShare: out.differingShare,
  };
}

test.describe('YOU-PARITY-1 · evidence', () => {
  test('canonical frames and comparisons against the frozen reference', async ({ browser }) => {
    test.skip(!CAPTURE_FRAMES, 'evidence is written only under WSF_CAPTURE_FRAMES=1');
    test.setTimeout(600_000);
    const dir = path.join(OUT, `canonical-${PHASE}`);
    fs.mkdirSync(dir, { recursive: true });
    const manifest: Array<Record<string, unknown>> = [];

    for (const shot of SHOTS) {
      const fx = await seedReference(`ype${shot.state.replace(/-/g, '')}${shot.vp.height}`, shot.variant === 'failed' ? 'normal' : shot.variant);
      const { context, page } = await phone(browser, shot.vp, 1);
      await signInVia(page, fx.email, fx.password);
      if (shot.variant === 'failed') {
        await page.route('**/wsfListGoals**', (route: Route) => route.abort('failed'));
      }
      await page.goto('/you');
      const settled =
        shot.variant === 'failed'
          ? 'wsf-you-failed'
          : shot.variant === 'normal'
            ? 'wsf-you-member'
            : 'wsf-you-member';
      await expect(page.getByTestId(settled)).toBeVisible({ timeout: 40_000 });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(600);
      const file = path.join(dir, `you-${shot.state}-${shot.vp.width}x${shot.vp.height}.png`);
      await page.screenshot({ path: file });
      const entry: Record<string, unknown> = {
        state: shot.state,
        viewport: `${shot.vp.width}x${shot.vp.height}`,
        phase: PHASE,
        canonical: path.relative(OUT, file),
        canonicalSha256: sha256(file),
        lovable: shot.lovable ? `lovable-642f830b/${shot.lovable}` : null,
        lovableSha256: shot.lovable ? sha256(path.join(LOVABLE, shot.lovable)) : null,
      };
      if (shot.lovable) {
        const cmp = await compose(page, path.join(LOVABLE, shot.lovable), file, path.join(dir, `cmp-you-${shot.state}-${shot.vp.width}x${shot.vp.height}`));
        entry.sideBySide = path.relative(OUT, cmp.sideBySide);
        entry.overlay50 = path.relative(OUT, cmp.overlay50);
        entry.difference = path.relative(OUT, cmp.difference);
        entry.differingPixelShare = Number(cmp.differingShare.toFixed(4));
      }
      manifest.push(entry);
      await context.close();
    }
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      `${JSON.stringify({ lovableRef: '642f830baa1153b0d9465dc75690028768083fb7', phase: PHASE, frames: manifest }, null, 2)}\n`,
    );
  });
});
