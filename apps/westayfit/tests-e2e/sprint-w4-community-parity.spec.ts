import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type Browser, type Page } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';

/**
 * COMMUNITY-PRESENTATION-ACCELERATOR-1 (Director #447 `5840798701`, data
 * mapping `5840935220`) — the two pure views through their gated component
 * fixture `/design-target/community-parity?state=…`. The Community and
 * Settings routes are W9's and are NOT touched; this is component-level
 * evidence, not route acceptance.
 *
 * THE FUNCTIONAL CASES (always run) check, at 390×844 and 390×640: the
 * reference hierarchy by on-screen position; the controls' 44 px targets and
 * no horizontal overflow; the no-goal state; and the privacy panel's failure
 * contract — the switch stays on the stored value when pressed, and a failed
 * save stays visible.
 *
 * EVIDENCE IS OPT-IN (WSF_CAPTURE_FRAMES=1): fixture frames at device pixel
 * ratio 1 (the reference originals are 390-wide at ratio 1) and, where the
 * frozen reference has an original, a side-by-side, a 50 % overlay and a
 * difference image, cropped to the same window: below the reference's 92 px
 * masthead and above its 75 px tab bar for Community (masthead and tab bar
 * are the shell, W9's), and below the panel header for Settings (the header
 * and Close are overlay chrome, W9's). Nothing accepted is written.
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/review/community-parity-1');
const LOVABLE = path.join(OUT, 'lovable-d4f60624');
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const FIXTURE = (state: string, h: number) => `/design-target/community-parity?state=${state}&h=${h}`;
/** The reference's masthead (prototype strip 30 + top bar 62) and tab bar. */
const TOP = 92;
const TAB_BAR = 75;
/** The reference Settings panel: 12 px inset, then its header (83 px incl. rule, measured on the original). */
const PANEL_INSET = 12;
const PANEL_BODY_TOP = PANEL_INSET + 83;

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

async function open(page: Page, state: string, h: number) {
  await page.goto(FIXTURE(state, h));
  await expect(page.getByTestId('wsf-community-parity-fixture')).toHaveAttribute('data-state', state, {
    timeout: 30_000,
  });
}

async function box(page: Page, testId: string) {
  const b = await page.getByTestId(testId).first().boundingBox();
  expect(b, `${testId} has no box`).not.toBeNull();
  return b!;
}

const pressed = (page: Page) => page.getByTestId('wsf-community-parity-fixture').getAttribute('data-pressed');

for (const vp of [
  { width: 390, height: 844 },
  { width: 390, height: 640 },
]) {
  test.describe(`COMMUNITY-PARITY · ${vp.width}x${vp.height}`, () => {
    test('the reference hierarchy, top to bottom, with truthful banner facts', async ({ browser }) => {
      const { context, page } = await phone(browser, vp);
      await open(page, 'normal', vp.height);
      await expect(page.getByTestId('wsf-parity-name')).toHaveText('Oak Grove Together');
      await expect(page.getByTestId('wsf-parity-banner-eyebrow')).toHaveText('FAMILY AND FRIENDS');
      await expect(page.getByTestId('wsf-parity-descriptor')).toHaveText('Anyone with the link can join');
      await expect(page.getByTestId('wsf-parity-fact-members')).toHaveText('Members23');
      await expect(page.getByTestId('wsf-parity-fact-role')).toHaveText('Your roleMember');
      await expect(page.getByTestId('wsf-parity-fact-goals')).toHaveText('Goals3');
      await expect(page.getByTestId('wsf-parity-period-title')).toHaveText('500 squats together');
      await expect(page.getByTestId('wsf-parity-total')).toHaveText('241');
      await expect(page.getByTestId('wsf-parity-living-we')).toHaveAttribute('data-fill-ratio', '0.4820');
      const order = [
        'wsf-parity-banner',
        'wsf-parity-facts',
        'wsf-parity-switcher',
        'wsf-parity-period',
        'wsf-parity-history',
        'wsf-parity-roster',
      ];
      let last = -1;
      for (const id of order) {
        const y = (await box(page, id)).y;
        expect(y, `${id} is not below the section before it`).toBeGreaterThan(last);
        last = y;
      }
      // The banner starts directly under the (fixture) masthead, full-bleed.
      const banner = await box(page, 'wsf-parity-banner');
      expect(Math.round(banner.y)).toBe(TOP);
      expect(Math.round(banner.x)).toBe(0);
      expect(Math.round(banner.width)).toBe(vp.width);
      // No horizontal overflow at 390: the view scrolls inside its own
      // ScrollView, so every control's right edge is measured, not the document.
      for (const id of [
        'wsf-parity-chip-oak',
        'wsf-parity-chip-harbor',
        'wsf-parity-join',
        'wsf-parity-start',
        'wsf-parity-period-status',
        'wsf-parity-goal-numbers',
        'wsf-parity-history-oak-apr',
        'wsf-parity-history-oak-mar',
      ]) {
        const b = await box(page, id);
        expect(b.x + b.width, `${id} overflows the ${vp.width} px width`).toBeLessThanOrEqual(vp.width);
      }
      await context.close();
    });

    test('every chip is a 44 px target and only calls its callback', async ({ browser }) => {
      const { context, page } = await phone(browser, vp);
      await open(page, 'normal', vp.height);
      for (const id of ['wsf-parity-chip-oak', 'wsf-parity-chip-harbor', 'wsf-parity-join', 'wsf-parity-start']) {
        expect((await box(page, id)).height, `${id} is under 44 px`).toBeGreaterThanOrEqual(44);
      }
      await page.getByTestId('wsf-parity-chip-oak').click();
      expect(await pressed(page)).toBe('');
      await page.getByTestId('wsf-parity-chip-harbor').click();
      expect(await pressed(page)).toBe('select:harbor');
      await page.getByTestId('wsf-parity-start').click();
      expect(await pressed(page)).toBe('start');
      await context.close();
    });

    test('no active goal: no instrument, the member’s next step, facts intact', async ({ browser }) => {
      const { context, page } = await phone(browser, vp);
      await open(page, 'no-goal', vp.height);
      await expect(page.getByTestId('wsf-parity-period-title')).toHaveText('No active goal');
      await expect(page.getByTestId('wsf-parity-no-goal')).toContainText('Your Champion can start the next goal.');
      await expect(page.getByTestId('wsf-parity-living-we')).toHaveCount(0);
      await expect(page.getByTestId('wsf-parity-fact-goals')).toHaveText('Goals2');
      await context.close();
    });

    test('privacy: a press asks, the switch stays on the stored value', async ({ browser }) => {
      const { context, page } = await phone(browser, vp);
      await open(page, 'privacy', vp.height);
      const name = page.getByTestId('wsf-privacy-panel-name-oak');
      await expect(name).toHaveAttribute('aria-checked', 'false');
      expect((await box(page, 'wsf-privacy-panel-name-oak')).height).toBeGreaterThanOrEqual(44);
      await name.click();
      expect(await pressed(page)).toBe('change:oak:name:visible');
      // The fixture stores nothing, so the switch must not have moved.
      await expect(name).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByTestId('wsf-privacy-panel-activity-harbor')).toHaveAttribute('aria-checked', 'false');
      await context.close();
    });

    test('privacy: Space on a focused switch asks once, like a click', async ({ browser }) => {
      const { context, page } = await phone(browser, vp);
      await open(page, 'privacy', vp.height);
      const fixture = page.getByTestId('wsf-community-parity-fixture');
      const sw = page.getByTestId('wsf-privacy-panel-activity-oak');
      await sw.focus();
      await page.keyboard.press(' ');
      await expect(fixture).toHaveAttribute('data-pressed', 'change:oak:activity:private');
      await expect(fixture).toHaveAttribute('data-presses', '1');
      await expect(sw).toHaveAttribute('aria-checked', 'true');
      await page.keyboard.press('Enter');
      await expect(fixture).toHaveAttribute('data-presses', '2');
      await context.close();
    });

    test('privacy: a failed save stays visible beside the stored value, with Retry', async ({ browser }) => {
      const { context, page } = await phone(browser, vp);
      await open(page, 'privacy-failed', vp.height);
      const error = page.getByTestId('wsf-privacy-panel-error-oak');
      await expect(error).toContainText('That change wasn’t saved.');
      await expect(page.getByTestId('wsf-privacy-panel-name-oak')).toHaveAttribute('aria-checked', 'false');
      await page.waitForTimeout(1_500);
      await expect(error).toBeVisible();
      await page.getByTestId('wsf-privacy-panel-retry-oak').click();
      expect(await pressed(page)).toBe('retry:oak');
      await context.close();
    });
  });
}

// ---------------------------------------------------------------------------
// EVIDENCE
// ---------------------------------------------------------------------------

type Shot = {
  state: string;
  vp: { width: number; height: number };
  kind: 'community' | 'panel';
  lovable: string | null;
  note?: string;
};

const SHOTS: Shot[] = [
  { state: 'normal', vp: { width: 390, height: 844 }, kind: 'community', lovable: 'community-390x844.png' },
  {
    state: 'normal',
    vp: { width: 390, height: 640 },
    kind: 'community',
    lovable: 'manage-community-page-390x640.png',
    note: 'The reference 390×640 original is its Champion capture ("Your role: Champion"); the fixture is the member state.',
  },
  { state: 'no-goal', vp: { width: 390, height: 844 }, kind: 'community', lovable: null },
  { state: 'no-goal', vp: { width: 390, height: 640 }, kind: 'community', lovable: null },
  { state: 'privacy', vp: { width: 390, height: 844 }, kind: 'panel', lovable: 'settings-390x844.png' },
  { state: 'privacy', vp: { width: 390, height: 640 }, kind: 'panel', lovable: 'settings-390x640.png' },
  { state: 'privacy-failed', vp: { width: 390, height: 844 }, kind: 'panel', lovable: null },
  { state: 'privacy-failed', vp: { width: 390, height: 640 }, kind: 'panel', lovable: null },
];

const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function compose(page: Page, lovable: string, canonical: string, base: string, crop: { y: number; h: number }) {
  const a = `data:image/png;base64,${fs.readFileSync(lovable).toString('base64')}`;
  const b = `data:image/png;base64,${fs.readFileSync(canonical).toString('base64')}`;
  await page.setContent('<html><body style="margin:0"></body></html>');
  const out = await page.evaluate(
    async ([srcA, srcB, cy, ch]) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        });
      const [ia, ib] = await Promise.all([load(srcA!), load(srcB!)]);
      const w = Math.max(ia.width, ib.width);
      const y = Number(cy);
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
      sx.drawImage(ia, 0, y, w, h, 0, 0, w, h);
      sx.drawImage(ib, 0, y, w, h, w + 12, 0, w, h);
      const [over, ox] = canvas(w, h);
      ox.drawImage(ia, 0, y, w, h, 0, 0, w, h);
      ox.globalAlpha = 0.5;
      ox.drawImage(ib, 0, y, w, h, 0, 0, w, h);
      const [diff, dx] = canvas(w, h);
      dx.drawImage(ia, 0, y, w, h, 0, 0, w, h);
      dx.globalCompositeOperation = 'difference';
      dx.drawImage(ib, 0, y, w, h, 0, 0, w, h);
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
    [a, b, String(crop.y), String(crop.h)] as const,
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

test.describe('COMMUNITY-PARITY · evidence', () => {
  test('fixture frames and cropped comparisons against the frozen reference', async ({ browser }) => {
    test.skip(!CAPTURE_FRAMES, 'evidence is written only under WSF_CAPTURE_FRAMES=1');
    test.setTimeout(300_000);
    const dir = path.join(OUT, 'fixture');
    fs.mkdirSync(dir, { recursive: true });
    const manifest: Array<Record<string, unknown>> = [];
    for (const shot of SHOTS) {
      const { context, page } = await phone(browser, shot.vp, 1);
      await open(page, shot.state, shot.vp.height);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(500);
      const name = `community-parity-${shot.state}-${shot.vp.width}x${shot.vp.height}`;
      const file = path.join(dir, `${name}.png`);
      await page.screenshot({ path: file });
      const crop =
        shot.kind === 'community'
          ? { y: TOP, h: shot.vp.height - TOP - TAB_BAR }
          : { y: PANEL_BODY_TOP, h: shot.vp.height - PANEL_BODY_TOP - PANEL_INSET };
      const entry: Record<string, unknown> = {
        state: shot.state,
        viewport: `${shot.vp.width}x${shot.vp.height}`,
        fixture: path.relative(OUT, file),
        fixtureSha256: sha256(file),
        lovable: shot.lovable ? `lovable-d4f60624/${shot.lovable}` : null,
        lovableSha256: shot.lovable ? sha256(path.join(LOVABLE, shot.lovable)) : null,
        crop: { x: 0, y: crop.y, width: shot.vp.width, height: crop.h },
        ...(shot.note ? { note: shot.note } : {}),
      };
      if (shot.lovable) {
        const cmp = await compose(page, path.join(LOVABLE, shot.lovable), file, path.join(dir, `cmp-${name}`), crop);
        entry.sideBySide = path.relative(OUT, cmp.sideBySide);
        entry.overlay50 = path.relative(OUT, cmp.overlay50);
        entry.difference = path.relative(OUT, cmp.difference);
        entry.differingPixelShare = Number(cmp.differingShare.toFixed(4));
      } else {
        entry.reference = 'none: the frozen reference has no original of this state';
      }
      manifest.push(entry);
      await context.close();
    }
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      `${JSON.stringify(
        {
          lovableProject: 'e15b9fa0-b2a0-4314-bc21-9c573b8eceb1',
          lovableRef: 'd4f606244ba3995080fb0bcd471cbebf4cbbc56a',
          source:
            'src/ui/CommunityParityView.tsx + src/ui/CommunityPrivacyPanelView.tsx via /design-target/community-parity',
          frames: manifest,
        },
        null,
        2,
      )}\n`,
    );
  });
});
