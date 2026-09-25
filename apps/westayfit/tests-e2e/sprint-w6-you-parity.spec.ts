import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type Browser, type Page } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';

/**
 * YOU-PARITY-1 — PHASE A (Director #365 `5840666502` lane C; #456 `5840756497`).
 *
 * The accepted Lovable You reference (`642f830b`) as a PURE view,
 * `src/ui/YouParityView.tsx`, driven here through its gated component fixture
 * `/design-target/you-parity?state=…`. The route `app/(tabs)/you.tsx` is W9's
 * during PERF-MOBILE-1 and is NOT touched in Phase A; the real-route tests for
 * the hook (Phase B) are preserved at `1720c44b` and return with it.
 *
 * EVIDENCE IS OPT-IN (WSF_CAPTURE_FRAMES=1): fixture frames at device pixel
 * ratio 1 (the reference originals are 390-wide at ratio 1), and for each a
 * side-by-side, a 50 % overlay and a difference image against the original,
 * CROPPED TO THE SAME BODY WINDOW — below the reference's 92 px masthead and
 * above its 75 px tab bar — because masthead and tab bar are the shell, W9's.
 * A second, ALIGNED set shifts the view so both community bands start on one
 * row, which separates the head's height difference from everything below it.
 * Nothing accepted is written.
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/review/you-parity-1');
const LOVABLE = path.join(OUT, 'lovable-642f830b');
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const FIXTURE = (state: string) => `/design-target/you-parity?state=${state}`;
/**
 * The reference's masthead (prototype strip 30 + top bar 62, or 56 at the
 * reference's max-height 700 px breakpoint) and tab bar.
 */
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
  await expect(page.getByTestId('wsf-you-parity-fixture')).toHaveAttribute('data-state', state, { timeout: 30_000 });
}

async function top(page: Page, testId: string): Promise<number> {
  const box = await page.getByTestId(testId).first().boundingBox();
  expect(box, `${testId} has no box`).not.toBeNull();
  return box!.y;
}

const pressed = (page: Page) => page.getByTestId('wsf-you-parity-fixture').getAttribute('data-pressed');

for (const vp of [
  { width: 390, height: 844 },
  { width: 390, height: 640 },
]) {
  test.describe(`YOU-PARITY-1 · view · ${vp.width}x${vp.height}`, () => {
    test('the member story leads, in the reference order, with the account last', async ({ browser }) => {
      const { context, page } = await phone(browser, vp);
      await open(page, 'normal');
      await expect(page.getByTestId('wsf-you-name')).toHaveText('Alex M.');
      await expect(page.getByTestId('wsf-you-community')).toContainText('Oak Grove Together');
      await expect(page.getByTestId('wsf-you-community')).toContainText('23 members');
      await expect(page.getByTestId('wsf-you-lead-status')).toHaveText('OPEN');
      await expect(page.getByTestId('wsf-you-lead-shared')).toHaveText('241 / 500 confirmed');
      await expect(page.getByTestId('wsf-you-lead-own')).toContainText('25');
      await expect(page.getByTestId('wsf-you-others')).toContainText('REACHED · STILL OPEN');
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
      // The reference's short-phone block (max-height 700px): the band sits
      // 8 px under the head instead of 14, and 13 px of band padding, not 18.
      const compact = vp.height <= 700;
      await expect(page.getByTestId('wsf-you')).toHaveAttribute('data-compact', String(compact));
      const head = (await page.getByTestId('wsf-you-identity').boundingBox())!;
      const band = (await page.getByTestId('wsf-you-community').boundingBox())!;
      expect(Math.round(band.y - (head.y + head.height))).toBe(compact ? 8 : 14);
      const eyebrow = (await page.getByTestId('wsf-you-community').getByText('YOUR CURRENT COMMUNITY').boundingBox())!;
      expect(Math.round(eyebrow.y - band.y)).toBe(compact ? 13 : 18);
      // The identity, the community and the whole lead block are on the first
      // screen at 390x844, as in the reference; at 640 the lead starts on it.
      await expect(page.getByTestId('wsf-you-identity')).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId('wsf-you-lead')).toBeInViewport();
      // Settings is a 48 px target; Sign out is reachable by scrolling.
      const settings = await page.getByTestId('wsf-you-settings').boundingBox();
      expect(settings!.width).toBeGreaterThanOrEqual(48);
      expect(settings!.height).toBeGreaterThanOrEqual(48);
      await page.getByTestId('wsf-you-signout').scrollIntoViewIfNeeded();
      await expect(page.getByTestId('wsf-you-signout')).toBeInViewport({ ratio: 1 });
      await page.getByTestId('wsf-you-signout').click();
      expect(await pressed(page)).toBe('signout');
      await context.close();
    });

    test('no own part, a goal open: Start moving is whole on screen and only calls back', async ({ browser }) => {
      const { context, page } = await phone(browser, vp);
      await open(page, 'no-own');
      const start = page.getByTestId('wsf-you-start-moving');
      await expect(start).toBeVisible();
      await start.scrollIntoViewIfNeeded();
      await expect(start).toBeInViewport({ ratio: 1 });
      const box = await start.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(54);
      await start.click();
      expect(await pressed(page)).toBe('move');
      await context.close();
    });

    test('nothing eligible: no Start moving, a way to the community', async ({ browser }) => {
      const { context, page } = await phone(browser, vp);
      await open(page, 'no-eligible');
      await expect(page.getByTestId('wsf-you-nothing-yet')).toHaveAttribute('data-state', 'no-eligible-goal');
      await expect(page.getByTestId('wsf-you-start-moving')).toHaveCount(0);
      await page.getByTestId('wsf-you-open-community').click();
      expect(await pressed(page)).toBe('community');
      await context.close();
    });

    test('failure keeps identity and community, guesses nothing, retries by callback', async ({ browser }) => {
      const { context, page } = await phone(browser, vp);
      await open(page, 'failed');
      await expect(page.getByTestId('wsf-you-failed')).toContainText('Contribution details unavailable');
      await expect(page.getByTestId('wsf-you-community')).toContainText('Oak Grove Together');
      await expect(page.getByTestId('wsf-you-lead-own')).toHaveCount(0);
      await page.getByTestId('wsf-you-retry').click();
      expect(await pressed(page)).toBe('retry');
      await context.close();
    });

    test('keyboard: every control is reachable by Tab in reading order', async ({ browser }) => {
      const { context, page } = await phone(browser, vp);
      await open(page, 'no-own');
      const seen: string[] = [];
      for (let i = 0; i < 12; i += 1) {
        await page.keyboard.press('Tab');
        const id = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-testid'));
        if (id && !seen.includes(id)) seen.push(id);
      }
      const order = ['wsf-you-settings', 'wsf-you-start-moving', 'wsf-you-signout'];
      for (const id of order) expect(seen, `Tab never reached ${id}`).toContain(id);
      expect(seen.indexOf('wsf-you-settings')).toBeLessThan(seen.indexOf('wsf-you-start-moving'));
      expect(seen.indexOf('wsf-you-start-moving')).toBeLessThan(seen.indexOf('wsf-you-signout'));
      await context.close();
    });
  });
}

// ---------------------------------------------------------------------------
// EVIDENCE: canonical frames at DPR 1, then side-by-side / 50 % overlay /
// difference against the frozen Lovable originals.
// ---------------------------------------------------------------------------

type Shot = { state: string; vp: { width: number; height: number }; lovable: string | null };

const SHOTS: Shot[] = [
  { state: 'normal', vp: { width: 390, height: 844 }, lovable: 'you-normal-390x844.png' },
  { state: 'normal', vp: { width: 390, height: 640 }, lovable: 'you-normal-390x640.png' },
  { state: 'no-own', vp: { width: 390, height: 844 }, lovable: 'you-no-own-390x844.png' },
  { state: 'no-own', vp: { width: 390, height: 640 }, lovable: 'you-no-own-390x640.png' },
  { state: 'no-eligible', vp: { width: 390, height: 844 }, lovable: 'you-no-eligible-390x844.png' },
  // The reference has no failure frame; this one is canonical-only evidence.
  { state: 'failed', vp: { width: 390, height: 844 }, lovable: null },
];

const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/**
 * The first row, at or below `from`, where column x = 5 is the community band's
 * navy (#0B1F3A within a small tolerance). Both the reference and the view draw
 * that band full-bleed, so it is a shared landmark: shifting the view so the two
 * bands start on the same row measures everything below the head without the
 * head's height difference smeared over the whole frame.
 */
async function bandTop(page: Page, file: string, from: number): Promise<number | null> {
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
      const col = x.getImageData(5, 0, 1, img.height).data;
      for (let y = Number(f); y < img.height; y += 1) {
        const r = col[y * 4]!;
        const g = col[y * 4 + 1]!;
        const b = col[y * 4 + 2]!;
        if (Math.abs(r - 0x0b) <= 6 && Math.abs(g - 0x1f) <= 6 && Math.abs(b - 0x3a) <= 6) return y;
      }
      return null;
    },
    [src, String(from)] as const,
  );
}

/**
 * Compose in the browser: [reference | canonical] side by side, a 50 % overlay,
 * and an absolute-difference image, plus the share of pixels whose summed
 * channel difference exceeds 48 (a measured figure, not a verdict).
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
      const canvas = (cw: number, ch: number) => {
        const c = document.createElement('canvas');
        c.width = cw;
        c.height = ch;
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
        size: [w, h],
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

test.describe('YOU-PARITY-1 · evidence', () => {
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
      const name = `you-${shot.state}-${shot.vp.width}x${shot.vp.height}`;
      const file = path.join(dir, `${name}.png`);
      await page.screenshot({ path: file });
      const TOP = topFor(shot.vp.height);
      const crop = { y: TOP, h: shot.vp.height - TOP - TAB_BAR };
      const entry: Record<string, unknown> = {
        state: shot.state,
        viewport: `${shot.vp.width}x${shot.vp.height}`,
        fixture: path.relative(OUT, file),
        fixtureSha256: sha256(file),
        lovable: shot.lovable ? `lovable-642f830b/${shot.lovable}` : null,
        lovableSha256: shot.lovable ? sha256(path.join(LOVABLE, shot.lovable)) : null,
        crop: { x: 0, y: crop.y, width: shot.vp.width, height: crop.h },
      };
      if (shot.lovable) {
        const ref = path.join(LOVABLE, shot.lovable);
        const cmp = await compose(page, ref, file, path.join(dir, `cmp-${name}`), { ya: crop.y, yb: crop.y, h: crop.h });
        entry.sideBySide = path.relative(OUT, cmp.sideBySide);
        entry.overlay50 = path.relative(OUT, cmp.overlay50);
        entry.difference = path.relative(OUT, cmp.difference);
        entry.differingPixelShare = Number(cmp.differingShare.toFixed(4));
        // ALIGNED: the same two frames with the view shifted so both community
        // bands start on one row; measured from that row to the tab bar.
        const ya = await bandTop(page, ref, TOP);
        const yb = await bandTop(page, file, TOP);
        if (ya !== null && yb !== null) {
          const bottom = shot.vp.height - TAB_BAR;
          const h = Math.min(bottom - ya, bottom - yb);
          const al = await compose(page, ref, file, path.join(dir, `cmp-${name}`), { ya, yb, h }, 'aligned-');
          entry.aligned = {
            referenceBandTop: ya,
            viewBandTop: yb,
            viewShiftPx: ya - yb,
            window: { referenceY: ya, viewY: yb, height: h },
            sideBySide: path.relative(OUT, al.sideBySide),
            overlay50: path.relative(OUT, al.overlay50),
            difference: path.relative(OUT, al.difference),
            differingPixelShare: Number(al.differingShare.toFixed(4)),
          };
        } else {
          entry.aligned = { unavailable: 'community band not found in one of the frames' };
        }
      }
      manifest.push(entry);
      await context.close();
    }
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      `${JSON.stringify({ lovableRef: '642f830baa1153b0d9465dc75690028768083fb7', source: 'src/ui/YouParityView.tsx via /design-target/you-parity', frames: manifest }, null, 2)}\n`,
    );
  });
});
