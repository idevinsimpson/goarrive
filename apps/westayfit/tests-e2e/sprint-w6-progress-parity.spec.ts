import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type Browser, type Page } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';

/**
 * PROGRESS-PARITY-1 — PHASE A (Director #451 `5840571885` / `5840750907` /
 * `5840756702`; re-sequenced to W6 by #365 `5840912166` §A).
 *
 * The accepted Lovable Progress reference (`09b8a73c`) as a PURE view,
 * `src/ui/ProgressParityView.tsx`, driven here through its gated component
 * fixture `/design-target/progress-parity?state=…`. The route
 * `app/(tabs)/activity.tsx` is W9's during PERF-MOBILE-1 and is NOT touched in
 * Phase A; the route hook and its real-route tests are Phase B.
 *
 * EVIDENCE IS OPT-IN (WSF_CAPTURE_FRAMES=1): fixture frames at device pixel
 * ratio 1 (the reference originals are 390-wide at ratio 1), and for each
 * with an original a side-by-side, a 50 % overlay and a difference image,
 * CROPPED TO THE SAME BODY WINDOW — below the reference's masthead (92 px, or
 * 86 at its max-height 700 px breakpoint) and above its 75 px tab bar. A second,
 * ALIGNED set shifts the view so both heroes' bottom rules sit on one row.
 * Nothing accepted is written.
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/review/progress-parity-1');
const LOVABLE = path.join(OUT, 'lovable-09b8a73c');
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const FIXTURE = (state: string) => `/design-target/progress-parity?state=${state}`;
const topFor = (height: number) => (height <= 700 ? 86 : 92);
const TAB_BAR = 75;

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

async function open(page: Page, state: string) {
  await page.goto(FIXTURE(state));
  await expect(page.getByTestId('wsf-progress-parity-fixture')).toHaveAttribute('data-state', state, {
    timeout: 30_000,
  });
}

async function box(page: Page, testId: string) {
  const b = await page.getByTestId(testId).first().boundingBox();
  expect(b, `${testId} has no box`).not.toBeNull();
  return b!;
}

const pressed = (page: Page) => page.getByTestId('wsf-progress-parity-fixture').getAttribute('data-pressed');

for (const vp of [
  { width: 390, height: 844 },
  { width: 390, height: 640 },
]) {
  test.describe(`PROGRESS-PARITY-1 · view · ${vp.width}x${vp.height}`, () => {
    test('populated: private total leads, then receipts, then goals, in the reference order', async ({ browser }) => {
      const { context, page } = await phone(browser, vp);
      await open(page, 'populated');
      await expect(page.getByTestId('wsf-activity-title')).toHaveText('Your progress');
      await expect(page.getByTestId('wsf-activity-subtitle')).toHaveText('Your recorded contributions, by goal.');
      await expect(page.getByTestId('wsf-activity-total-0')).toHaveAttribute('aria-label', '145 squats recorded');
      await expect(page.getByTestId('wsf-activity-privacy')).toHaveCount(1);
      await expect(page.getByTestId('wsf-activity-receipts-unavailable')).toBeVisible();
      await expect(page.locator('[data-testid^="wsf-activity-goal-"][data-testid$="-yours"]')).toHaveCount(4);
      const y = {
        title: (await box(page, 'wsf-activity-title')).y,
        totals: (await box(page, 'wsf-activity-totals')).y,
        privacy: (await box(page, 'wsf-activity-privacy')).y,
        receipts: (await box(page, 'wsf-activity-receipts')).y,
        goals: (await box(page, 'wsf-activity-goals')).y,
      };
      expect(y.title).toBeLessThan(y.totals);
      expect(y.totals).toBeLessThan(y.privacy);
      expect(y.privacy).toBeLessThan(y.receipts);
      expect(y.receipts).toBeLessThan(y.goals);
      // The private total and its clarification are on the first screen.
      await expect(page.getByTestId('wsf-activity-totals')).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId('wsf-activity-privacy')).toBeInViewport({ ratio: 1 });
      // The reference's short-phone block: 10 px screen top and a 25 px
      // heading on 37.5 px lines at <= 700 px tall; 14 and 29 on 43.5 otherwise.
      const compact = vp.height <= 700;
      await expect(page.getByTestId('wsf-activity')).toHaveAttribute('data-compact', String(compact));
      const title = await box(page, 'wsf-activity-title');
      expect(Math.round(title.height * 10) / 10).toBe(compact ? 37.5 : 43.5);
      const hero = await box(page, 'wsf-activity-hero');
      expect(Math.round(hero.y - topFor(vp.height))).toBe(compact ? 10 : 14);
      await context.close();
    });

    test('first eligible: Start moving is whole on screen and only calls back', async ({ browser }) => {
      const { context, page } = await phone(browser, vp);
      await open(page, 'first-eligible');
      await expect(page.getByTestId('wsf-activity-empty')).toHaveAttribute('data-state', 'first-eligible');
      await expect(page.getByTestId('wsf-activity-totals')).toHaveCount(0);
      const start = page.getByTestId('wsf-activity-start');
      await start.scrollIntoViewIfNeeded();
      await expect(start).toBeInViewport({ ratio: 1 });
      expect((await start.boundingBox())!.height).toBeGreaterThanOrEqual(54);
      await start.click();
      expect(await pressed(page)).toBe('move');
      await context.close();
    });

    test('no open goal: no Start moving, a way to the community', async ({ browser }) => {
      const { context, page } = await phone(browser, vp);
      await open(page, 'no-open-goal');
      await expect(page.getByTestId('wsf-activity-empty')).toHaveAttribute('data-state', 'no-open-goal');
      await expect(page.getByTestId('wsf-activity-start')).toHaveCount(0);
      await page.getByTestId('wsf-activity-open-community').click();
      expect(await pressed(page)).toBe('community');
      await context.close();
    });

    test('partial: said above the lists, counted only from what loaded, Retry calls back', async ({ browser }) => {
      const { context, page } = await phone(browser, vp);
      await open(page, 'partial');
      await expect(page.getByTestId('wsf-activity-partial')).toContainText('This list is partial.');
      await expect(page.getByTestId('wsf-activity-total-0')).toHaveAttribute('aria-label', '45 squats recorded');
      expect((await box(page, 'wsf-activity-partial')).y).toBeLessThan((await box(page, 'wsf-activity-rows')).y);
      await page.getByTestId('wsf-activity-partial-retry').click();
      expect(await pressed(page)).toBe('retry');
      await context.close();
    });

    test('failure keeps identity, guesses nothing, retries by callback', async ({ browser }) => {
      const { context, page } = await phone(browser, vp);
      await open(page, 'failure');
      await expect(page.getByTestId('wsf-activity-error')).toContainText('Your progress couldn’t be loaded');
      await expect(page.getByText('PRIVATE TO YOU · ALEX M.')).toBeVisible();
      await expect(page.getByTestId('wsf-activity-totals')).toHaveCount(0);
      const retry = page.getByTestId('wsf-activity-retry');
      await retry.scrollIntoViewIfNeeded();
      await expect(retry).toBeInViewport({ ratio: 1 });
      await retry.click();
      expect(await pressed(page)).toBe('retry');
      await context.close();
    });

    test('unknown shared totals: OPEN and CLOSED only, Unknown never 0', async ({ browser }) => {
      const { context, page } = await phone(browser, vp);
      await open(page, 'unknown-shared');
      const open_ = page.getByTestId('wsf-activity-goal-harbor-150');
      await expect(open_).toContainText('OPEN');
      await expect(open_).not.toContainText('REACHED');
      await expect(page.getByTestId('wsf-activity-goal-harbor-150-shared')).toHaveText('SHAREDUnknown');
      const closed = page.getByTestId('wsf-activity-goal-oak-jul');
      await expect(closed).toContainText('CLOSED');
      await expect(closed).toContainText('Oak Grove Together · Ended Jul 31');
      await expect(closed).not.toContainText('UNFINISHED');
      await expect(page.getByTestId('wsf-activity-goal-oak-jul-shared')).toHaveText('SHAREDUnknown');
      // Own parts are known and still add up: 25 + 20 + 60 + 40.
      await expect(page.getByTestId('wsf-activity-total-0')).toHaveAttribute('aria-label', '145 squats recorded');
      await context.close();
    });

    test('keyboard: receipts are reached by Tab in order and open with Enter', async ({ browser }) => {
      const { context, page } = await phone(browser, vp);
      await open(page, 'receipts-contract');
      const seen: string[] = [];
      for (let i = 0; i < 8; i += 1) {
        await page.keyboard.press('Tab');
        const id = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-testid'));
        if (id && !seen.includes(id)) seen.push(id);
      }
      const receipts = seen.filter((id) => id.startsWith('wsf-activity-receipt-'));
      expect(receipts.slice(0, 5)).toEqual([1, 2, 3, 4, 5].map((k) => `wsf-activity-receipt-r${k}`));
      await page.getByTestId('wsf-activity-receipt-r1').focus();
      await page.keyboard.press('Enter');
      expect(await pressed(page)).toBe('receipt:r1');
      await context.close();
    });
  });
}

// ---------------------------------------------------------------------------
// EVIDENCE: fixture frames at DPR 1, then side-by-side / 50 % overlay /
// difference against the frozen Lovable originals.
// ---------------------------------------------------------------------------

type Shot = { state: string; vp: { width: number; height: number }; lovable: string | null };

const V844 = { width: 390, height: 844 };
const V640 = { width: 390, height: 640 };
const SHOTS: Shot[] = [
  { state: 'populated', vp: V844, lovable: 'progress-populated-390x844.png' },
  { state: 'populated', vp: V640, lovable: null },
  // The slot filled from FIXTURE PROPS, laid over the reference's populated
  // frame to show the rows are ready for a source. Not a canonical state.
  { state: 'receipts-contract', vp: V844, lovable: 'progress-populated-390x844.png' },
  { state: 'first-eligible', vp: V844, lovable: 'progress-first-eligible-390x844.png' },
  { state: 'first-eligible', vp: V640, lovable: 'progress-first-eligible-390x640.png' },
  { state: 'no-open-goal', vp: V844, lovable: 'progress-no-open-goal-390x844.png' },
  { state: 'no-open-goal', vp: V640, lovable: null },
  { state: 'partial', vp: V844, lovable: 'progress-partial-390x844.png' },
  { state: 'partial', vp: V640, lovable: null },
  { state: 'failure', vp: V844, lovable: 'progress-failure-390x844.png' },
  { state: 'failure', vp: V640, lovable: null },
  // Canonical truth the reference never draws (Director #492 5841012915).
  { state: 'unknown-shared', vp: V844, lovable: null },
  { state: 'unknown-shared', vp: V640, lovable: null },
];

const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/**
 * The first row, at or below `from`, where columns x = 30, 200 and 350 are all
 * the border colour (#D7DFE7 within 10): the hero's full-width bottom rule in
 * both the reference and the view, so a shared landmark for the aligned set.
 * Three columns, because one column also matches an anti-aliased glyph edge.
 */
async function ruleTop(page: Page, file: string, from: number): Promise<number | null> {
  const src = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
  await page.setContent('<html><body style="margin:0"></body></html>');
  return page.evaluate(
    async ([s, f]) => {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = s!;
      });
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const x = c.getContext('2d')!;
      x.drawImage(img, 0, 0);
      const cols = [30, 200, 350].map((cx) => x.getImageData(cx, 0, 1, img.height).data);
      const rule = (col: Uint8ClampedArray, y: number) =>
        Math.abs(col[y * 4]! - 0xd7) <= 10 &&
        Math.abs(col[y * 4 + 1]! - 0xdf) <= 10 &&
        Math.abs(col[y * 4 + 2]! - 0xe7) <= 10;
      for (let y = Number(f); y < img.height; y += 1) {
        if (cols.every((col) => rule(col, y))) return y;
      }
      return null;
    },
    [src, String(from)] as const,
  );
}

/**
 * Compose in the browser: [reference | view] side by side, a 50 % overlay and
 * an absolute-difference image, plus the share of pixels whose summed channel
 * difference exceeds 48 (a measured figure, not a verdict).
 */
async function compose(
  page: Page,
  lovable: string,
  canonical: string,
  base: string,
  crop: { ya: number; yb: number; h: number },
  prefix = '',
) {
  const a = `data:image/png;base64,${fs.readFileSync(lovable).toString('base64')}`;
  const b = `data:image/png;base64,${fs.readFileSync(canonical).toString('base64')}`;
  await page.setContent('<html><body style="margin:0"></body></html>');
  const out = await page.evaluate(
    async ([srcA, srcB, cya, cyb, ch]) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        });
      const [ia, ib] = await Promise.all([load(srcA!), load(srcB!)]);
      const w = Math.max(ia.width, ib.width);
      const ya = Number(cya);
      const yb = Number(cyb);
      const h = Number(ch);
      const canvas = (cw: number, chh: number) => {
        const c = document.createElement('canvas');
        c.width = cw;
        c.height = chh;
        return [c, c.getContext('2d')!] as const;
      };
      const [side, sx] = canvas(w * 2 + 12, h);
      sx.fillStyle = '#ffffff';
      sx.fillRect(0, 0, side.width, side.height);
      sx.drawImage(ia, 0, ya, w, h, 0, 0, w, h);
      sx.drawImage(ib, 0, yb, w, h, w + 12, 0, w, h);
      const [over, ox] = canvas(w, h);
      ox.drawImage(ia, 0, ya, w, h, 0, 0, w, h);
      ox.globalAlpha = 0.5;
      ox.drawImage(ib, 0, yb, w, h, 0, 0, w, h);
      const [diff, dx] = canvas(w, h);
      dx.drawImage(ia, 0, ya, w, h, 0, 0, w, h);
      dx.globalCompositeOperation = 'difference';
      dx.drawImage(ib, 0, yb, w, h, 0, 0, w, h);
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
      };
    },
    [a, b, String(crop.ya), String(crop.yb), String(crop.h)] as const,
  );
  const write = (suffix: string, url: string) => {
    const file = `${base}-${prefix}${suffix}.png`;
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

test.describe('PROGRESS-PARITY-1 · evidence', () => {
  test('fixture frames and cropped comparisons against the frozen reference', async ({ browser }) => {
    test.skip(!CAPTURE_FRAMES, 'evidence is written only under WSF_CAPTURE_FRAMES=1');
    test.setTimeout(300_000);
    const dir = path.join(OUT, 'fixture');
    fs.mkdirSync(dir, { recursive: true });
    const manifest: Array<Record<string, unknown>> = [];
    for (const shot of SHOTS) {
      const { context, page } = await phone(browser, shot.vp, 1);
      await open(page, shot.state);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(500);
      const name = `progress-${shot.state}-${shot.vp.width}x${shot.vp.height}`;
      const file = path.join(dir, `${name}.png`);
      await page.screenshot({ path: file });
      const TOP = topFor(shot.vp.height);
      const crop = { y: TOP, h: shot.vp.height - TOP - TAB_BAR };
      const entry: Record<string, unknown> = {
        state: shot.state,
        viewport: `${shot.vp.width}x${shot.vp.height}`,
        fixture: path.relative(OUT, file),
        fixtureSha256: sha256(file),
        lovable: shot.lovable ? `lovable-09b8a73c/${shot.lovable}` : null,
        lovableSha256: shot.lovable ? sha256(path.join(LOVABLE, shot.lovable)) : null,
        crop: { x: 0, y: crop.y, width: shot.vp.width, height: crop.h },
      };
      if (shot.state === 'receipts-contract') entry.note = 'receipt rows are fixture props; no canonical source';
      if (shot.lovable) {
        const ref = path.join(LOVABLE, shot.lovable);
        const cmp = await compose(page, ref, file, path.join(dir, `cmp-${name}`), { ya: crop.y, yb: crop.y, h: crop.h });
        entry.sideBySide = path.relative(OUT, cmp.sideBySide);
        entry.overlay50 = path.relative(OUT, cmp.overlay50);
        entry.difference = path.relative(OUT, cmp.difference);
        entry.differingPixelShare = Number(cmp.differingShare.toFixed(4));
        const ya = await ruleTop(page, ref, TOP);
        const yb = await ruleTop(page, file, TOP);
        if (ya !== null && yb !== null) {
          const bottom = shot.vp.height - TAB_BAR;
          const h = Math.min(bottom - ya, bottom - yb);
          const al = await compose(page, ref, file, path.join(dir, `cmp-${name}`), { ya, yb, h }, 'aligned-');
          entry.aligned = {
            referenceRuleY: ya,
            viewRuleY: yb,
            viewShiftPx: ya - yb,
            window: { referenceY: ya, viewY: yb, height: h },
            sideBySide: path.relative(OUT, al.sideBySide),
            overlay50: path.relative(OUT, al.overlay50),
            difference: path.relative(OUT, al.difference),
            differingPixelShare: Number(al.differingShare.toFixed(4)),
          };
        } else {
          entry.aligned = { unavailable: 'hero rule not found in one of the frames' };
        }
      }
      manifest.push(entry);
      await context.close();
    }
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      `${JSON.stringify(
        {
          lovableRef: '09b8a73cc4e661115e52cb1ec4aebcb625c5fc9a',
          source: 'src/ui/ProgressParityView.tsx via /design-target/progress-parity',
          frames: manifest,
        },
        null,
        2,
      )}\n`,
    );
  });
});
