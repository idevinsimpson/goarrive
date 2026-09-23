import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

import { CAPTURE_FRAMES, saveFrame } from './helpers/capture';

/**
 * PUBLIC DISPLAY — RESPONSIVE TARGET CHECKPOINT · BEFORE → PROPOSED TARGET.
 *
 * W2's packet from the Director's Board 10 verdict (PR #422, `5786952407`).
 * Two classes only — 800×1280 portrait and 1920×1080 collective — with three
 * treatments each, and a compact comparison per class.
 *
 * BOTH HALVES COME FROM ONE RUN, ONE FIXTURE, ONE COMMIT.
 *
 * The BEFOREs are the real `/display/[goalId]`; the TARGETs are the gated
 * preview `/design-target/public-display-next`. They are shot in the same run
 * against the same seeded fixture, so the only thing that differs inside a
 * pair is the composition being proposed. That is why the BEFOREs are re-shot
 * here rather than copied from `review/sprint-w2-board10/after/`: those frames
 * are valid — the display route is byte-identical between that capture SHA and
 * this branch's — but they carry a different clock and a different community
 * from anything drawn, and a comparison assembled across two runs invites the
 * reader to attribute an incidental difference to the proposal.
 *
 * THE WRITE GATE is `WSF_CAPTURE_FRAMES=1`. An ordinary run asserts every
 * state, on both halves, and writes nothing.
 *
 * NOTHING HERE IS AN IMPLEMENTATION. The preview route renders only behind
 * `EXPO_PUBLIC_WSF_USE_EMULATORS`, which `build-staging.sh` refuses. No
 * product route, polling, auth or backend behaviour is touched.
 */

const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const FUNCTIONS_EMULATOR = 'http://127.0.0.1:5001';
const PROJECT_ID = 'demo-wsf-local';
const OUT = path.resolve(__dirname, '..', '..', '..', 'docs/design-target/review/public-display-next');
const BEFORE_DIR = path.join(OUT, 'before');
const TARGET_DIR = path.join(OUT, 'target');

const PORTRAIT = { width: 800, height: 1280 };
const COLLECTIVE = { width: 1920, height: 1080 };

const COMMUNITY = 'Maple Street Movers';
const GOAL_TZ = 'America/New_York';
const OPEN_START = '2026-09-15T04:00:00.000Z';
const OPEN_END = '2026-10-06T03:30:00.000Z';
const OPEN_PERIOD = 'Open · Ends Mon, Oct 5';

function callableUrl(name: string): string {
  return `${FUNCTIONS_EMULATOR}/${PROJECT_ID}/us-central1/${name}`;
}

async function firestoreWrite(docPath: string, fields: Record<string, unknown>): Promise<void> {
  const url = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`emulator write ${docPath} failed: ${res.status} ${await res.text()}`);
}

function tsField(d: Date): { timestampValue: string } {
  return { timestampValue: d.toISOString() };
}

type Fx = { stamp: string; groupId: string; championUid: string; memberUid: string; joinCode: string };

async function seedCommunity(tag: string): Promise<Fx> {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const groupId = `pdn-${tag}-${stamp}`;
  const championUid = `pdn-champ-${stamp}`;
  const memberUid = `pdn-member-${stamp}`;
  const joinCode = `JOIN${randomBytes(4).toString('hex')}`;
  const now = new Date();
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: COMMUNITY },
    groupType: { stringValue: 'familyFriends' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: joinCode },
    createdByUserId: { stringValue: championUid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
  for (const [uid, role] of [[championUid, 'foundingChampion'], [memberUid, 'member']] as const) {
    await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, {
      groupId: { stringValue: groupId },
      userId: { stringValue: uid },
      role: { stringValue: role },
      membershipStatus: { stringValue: 'active' },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
  }
  return { stamp, groupId, championUid, memberUid, joinCode };
}

async function seedGoal(fx: Fx, key: string, authorized: boolean): Promise<string> {
  const goalId = `pdn-${key}-${fx.stamp}`;
  const now = new Date();
  const fields: Record<string, unknown> = {
    ownerUid: { stringValue: fx.championUid },
    communityGroupId: { stringValue: fx.groupId },
    title: { stringValue: 'Squats together this week' },
    target: { integerValue: '500' },
    unit: { stringValue: 'squats' },
    status: { stringValue: 'active' },
    startsAt: { timestampValue: OPEN_START },
    endsAt: { timestampValue: OPEN_END },
    timezone: { stringValue: GOAL_TZ },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  };
  if (authorized) fields.aggregateDisplayAuthorized = { booleanValue: true };
  await firestoreWrite(`wsfGoals/${goalId}`, fields);
  await firestoreWrite(`wsfGoalCounters/${goalId}/shards/0`, { count: { integerValue: '241' } });
  await firestoreWrite(`wsfGoalMemberTotals/${goalId}_${fx.memberUid}`, {
    goalId: { stringValue: goalId },
    userId: { stringValue: fx.memberUid },
    total: { integerValue: '7331' },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
  return goalId;
}

async function seedAdditions(goalId: string): Promise<void> {
  const entries = [
    { amount: 20, minutesAgo: 1 },
    { amount: 35, minutesAgo: 4 },
    { amount: 12, minutesAgo: 9 },
    { amount: 50, minutesAgo: 14 },
    { amount: 25, minutesAgo: 22 },
  ];
  for (const [i, e] of entries.entries()) {
    await firestoreWrite(
      `wsfGoals/${goalId}/recentAdditions/pdnattempt${String(i).padStart(4, '0')}${randomBytes(4).toString('hex')}`,
      {
        amount: { integerValue: String(e.amount) },
        at: { stringValue: new Date(Date.now() - e.minutesAgo * 60_000).toISOString() },
      }
    );
  }
}

function out(dir: string, name: string): string {
  if (CAPTURE_FRAMES) mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}.png`);
}

/** Anonymous aggregate only — the contract the proposal must not widen. */
async function expectAnonymous(page: Page, fx: Fx): Promise<void> {
  const html = await page.content();
  for (const s of [fx.memberUid, fx.championUid, fx.joinCode, '7331', 'familyFriends']) {
    expect(html, `a public display must not contain ${s}`).not.toContain(s);
  }
}

async function expectBeforeReady(page: Page, fx: Fx): Promise<void> {
  await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('wsf-display-community')).toHaveText(COMMUNITY);
  await expect(page.getByTestId('wsf-display-total-line')).toHaveText('241 of 500 squats');
  await expect(page.getByTestId('wsf-display-percent')).toHaveText('48.2% complete');
  await expect(page.getByTestId('wsf-display-remaining')).toHaveText('259 to go');
  await expect(page.getByTestId('wsf-display-period')).toHaveText(OPEN_PERIOD);
  await expect(page.getByTestId('wsf-display-we')).toHaveCount(1);
  await expect(page.getByTestId('wsf-tabbar')).toHaveCount(0);
  await expect(page.getByTestId('wsf-move-button')).toHaveCount(0);
  await expectAnonymous(page, fx);
}

/* ───────────────────────── BEFORE — the real route ───────────────────────── */

for (const [cls, viewport, expectedLayout] of [
  ['portrait', PORTRAIT, 'phone'],
  ['collective', COLLECTIVE, 'wide'],
] as const) {
  test.describe(`BEFORE · ${cls}`, () => {
    test.use({ viewport, deviceScaleFactor: 1, isMobile: false, hasTouch: false });

    test(`the real display route at ${viewport.width}×${viewport.height}`, async ({ page }) => {
      test.setTimeout(240_000);
      const fx = await seedCommunity(`before-${cls}`);

      // ---- confirmed progress -------------------------------------------------
      const goalId = await seedGoal(fx, `ok-${cls}`, true);
      await seedAdditions(goalId);
      let dropping = false;
      await page.route(callableUrl('wsfGoalPulse'), async (route: Route) => {
        if (dropping) return route.abort('failed');
        return route.continue();
      });
      await page.goto(`/display/${goalId}`);
      await expectBeforeReady(page, fx);
      // The breakpoint the proposal is about: 800 is below 900, so a picture
      // frame takes the PHONE composition in the build as it stands.
      await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-layout', expectedLayout);
      await expect(page.getByTestId('wsf-display-recent')).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(250);
      await saveFrame(page, out(BEFORE_DIR, `BEFORE-progress-${viewport.width}x${viewport.height}`), { fullPage: false });

      // ---- stale --------------------------------------------------------------
      dropping = true;
      await expect(page.getByTestId('wsf-display-stale')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('wsf-display-confirmed-at')).toContainText('Last confirmed');
      await expect(page.getByTestId('wsf-display-total-line')).toHaveText('241 of 500 squats');
      await expect(page.getByTestId('wsf-display-we')).toHaveCount(1);
      await saveFrame(page, out(BEFORE_DIR, `BEFORE-stale-INJECTED-NETWORK-${viewport.width}x${viewport.height}`), { fullPage: false });

      // ---- refused ------------------------------------------------------------
      dropping = false;
      const refusedId = await seedGoal(fx, `refused-${cls}`, false);
      await page.goto(`/display/${refusedId}`);
      await expect(page.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('wsf-display-not-available')).toContainText('Nothing to show here');
      for (const id of ['wsf-display-community', 'wsf-display-total-line', 'wsf-display-we', 'wsf-display-recent']) {
        await expect(page.getByTestId(id)).toHaveCount(0);
      }
      await expectAnonymous(page, fx);
      await saveFrame(page, out(BEFORE_DIR, `BEFORE-refused-${viewport.width}x${viewport.height}`), { fullPage: false });
    });
  });
}

/* ──────────────────── PROPOSED TARGET — the gated preview ─────────────────── */

test.describe('PROPOSED TARGET · the gated preview', () => {
  /*
    THE VIEWPORT MUST CONTAIN THE TALLEST FRAME, not merely the widest.

    At 1200 tall the 1280-tall portrait frame was taller than the window, and
    Playwright's element screenshot returned the overflow as a blank white
    band — the seam block was laid out correctly and simply never painted.
    That looked exactly like a clipped layout and was not one, so the height
    is now larger than any frame and the precondition is asserted below.
  */
  test.use({ viewport: { width: 2100, height: 1500 }, deviceScaleFactor: 1 });

  test('six proposed frames, each asserted before it is photographed', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto('/design-target/public-display-next');

    for (const cls of ['portrait', 'collective'] as const) {
      const size = cls === 'portrait' ? PORTRAIT : COLLECTIVE;

      for (const treatment of ['progress', 'stale', 'refused'] as const) {
        const frame = page.getByTestId(`wsf-pdnext-frame-${treatment}-${cls}`);
        await expect(frame).toBeVisible({ timeout: 30_000 });
        // The frame must be its real device size, or the proposal is a picture
        // of a different screen.
        const box = await frame.boundingBox();
        expect(box, `${treatment}/${cls} must have a box`).not.toBeNull();
        expect(Math.round(box!.width)).toBe(size.width);
        expect(Math.round(box!.height)).toBe(size.height);
        // A frame taller than the window comes back with an unpainted band.
        const view = page.viewportSize()!;
        expect(size.height, 'the viewport must contain the whole frame').toBeLessThanOrEqual(view.height);

        if (treatment === 'refused') {
          // No context, no total, no mark, no list, and no seam: there is
          // nothing here to join.
          await expect(frame.getByTestId('wsf-pdnext-refused')).toBeVisible();
          await expect(frame).toContainText('Nothing to show here');
          await expect(frame).toContainText('This display isn’t currently available.');
          await expect(frame.getByTestId('wsf-pdnext-we')).toHaveCount(0);
          await expect(frame.getByTestId('wsf-pdnext-recent')).toHaveCount(0);
          await expect(frame.getByTestId('wsf-pdnext-join-seam')).toHaveCount(0);
        } else {
          await expect(frame.getByTestId('wsf-pdnext-we')).toHaveCount(1);
          await expect(frame).toContainText('MAPLE STREET MOVERS');
          await expect(frame).toContainText('241');
          await expect(frame).toContainText('of 500 squats');
          await expect(frame).toContainText('48.2% complete');
          await expect(frame).toContainText('259 to go');
          await expect(frame.getByTestId('wsf-pdnext-recent')).toBeVisible();
          // The seam is labelled wherever it is drawn.
          await expect(frame.getByTestId('wsf-pdnext-join-seam')).toContainText('INTENDED SEAM · NOT WIRED');
          /*
            A FIXED CANVAS THAT CANNOT SCROLL GIVES NO SECOND CHANCE. The
            first draft of the portrait target pushed the seam block off the
            bottom edge — the one label that must be legible, clipped — so
            containment is asserted rather than eyeballed.
          */
          for (const id of ['wsf-pdnext-we', 'wsf-pdnext-recent', 'wsf-pdnext-join-seam']) {
            const inner = await frame.getByTestId(id).boundingBox();
            expect(inner, `${id} must have a box in ${treatment}/${cls}`).not.toBeNull();
            expect(
              Math.round(inner!.y + inner!.height),
              `${id} must not overflow ${treatment}/${cls}`
            ).toBeLessThanOrEqual(Math.round(box!.y + box!.height));
            expect(Math.round(inner!.x + inner!.width)).toBeLessThanOrEqual(Math.round(box!.x + box!.width));
          }
          /*
            THE PROPOSAL MUST NOT ARGUE AGAINST ITSELF. Its case is that the
            instrument has to grow with the room; the shipped route gives the
            mark 320px on an 800 frame and caps it at 640px on a 1920. A draft
            of this target came in UNDER the second of those, which would have
            made the proposal a regression dressed as a fix.
          */
          const weBox = await frame.getByTestId('wsf-pdnext-we').boundingBox();
          const shippedWidth = cls === 'portrait' ? 320 : 640;
          expect(
            Math.round(weBox!.width),
            `the proposed mark must exceed the shipped ${shippedWidth}px at ${cls}`
          ).toBeGreaterThan(shippedWidth);

          const staleCount = treatment === 'stale' ? 1 : 0;
          await expect(frame.getByTestId('wsf-pdnext-stale')).toHaveCount(staleCount);
          if (treatment === 'stale') {
            await expect(frame).toContainText('Last confirmed');
            // Stale keeps the number and the mark; only the claim changes.
            await expect(frame).toContainText('241');
          } else {
            await expect(frame).toContainText('Confirmed');
          }
        }
        // No member chrome anywhere in the proposal.
        for (const forbidden of ['wsf-tabbar', 'wsf-move-button']) {
          await expect(frame.getByTestId(forbidden)).toHaveCount(0);
        }
        await saveFrame(frame, out(TARGET_DIR, `TARGET-${treatment}-${size.width}x${size.height}`));
      }
    }
  });
});

/* ───────────────────────── the compact comparison ────────────────────────── */

test.describe('COMPARISON · before beside proposed', () => {
  test.use({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });

  test('one sheet per class, assembled from the frames this run produced', async ({ page }) => {
    test.setTimeout(180_000);
    test.skip(!CAPTURE_FRAMES, 'the sheets are assembled from frames only a capture run writes');

    for (const [cls, size] of [['portrait', PORTRAIT], ['collective', COLLECTIVE]] as const) {
      const rows = (['progress', 'stale', 'refused'] as const).map((t) => {
        const beforeName =
          t === 'stale'
            ? `BEFORE-stale-INJECTED-NETWORK-${size.width}x${size.height}`
            : `BEFORE-${t}-${size.width}x${size.height}`;
        const b64 = (dir: string, name: string) =>
          `data:image/png;base64,${readFileSync(path.join(dir, `${name}.png`)).toString('base64')}`;
        return {
          label:
            t === 'progress'
              ? 'Confirmed progress'
              : t === 'stale'
                ? 'Stale — the number is kept, the claim is dropped'
                : 'Refused — one generic state',
          before: b64(BEFORE_DIR, beforeName),
          target: b64(TARGET_DIR, `TARGET-${t}-${size.width}x${size.height}`),
        };
      });

      const col = 520;
      const shot = Math.round((size.height / size.width) * col);
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{width:${col * 2 + 150}px;background:#F7F5F0;font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#0B1F3A;padding:40px 44px}
        h1{font-size:24px;font-weight:800;letter-spacing:-0.3px}
        .sub{font-size:12px;color:#5A6B85;margin-top:6px;line-height:17px}
        .head{display:flex;gap:30px;margin:26px 0 8px}
        .head div{width:${col}px;font-size:11px;font-weight:900;letter-spacing:1.6px}
        .a{color:#5A6B85}.b{color:#15803D}
        .row{margin-top:22px}
        .lab{font-size:13px;font-weight:800;margin-bottom:8px}
        .pair{display:flex;gap:30px}
        img{width:${col}px;height:${shot}px;display:block;border:1px solid #E6E2DA;border-radius:8px}
        .foot{margin-top:30px;font-size:11px;color:#5A6B85;line-height:16px}
      </style></head><body>
        <h1>Public display · ${size.width} × ${size.height} — actual build beside the proposed target</h1>
        <div class="sub">Both halves of every pair are from one run, one seeded fixture and one commit. PROPOSED TARGET IS NOT IMPLEMENTED: it renders only behind the emulator-gated design-target preview, and no product route, polling, auth or backend behaviour is changed by it.</div>
        <div class="head"><div class="a">ACTUAL BUILD · CAPTURED</div><div class="b">PROPOSED TARGET · NOT IMPLEMENTED</div></div>
        ${rows
          .map(
            (r) => `<div class="row"><div class="lab">${r.label}</div><div class="pair">
              <img src="${r.before}" alt=""><img src="${r.target}" alt=""></div></div>`
          )
          .join('')}
        <div class="foot">Fixture: Maple Street Movers · Squats together this week · 241 of 500 squats — synthetic, and the same on both sides. The confirmed clock differs between the halves because the actual capture carries the run's real receipt time and the proposal carries a fixture string.</div>
      </body></html>`;

      await page.setContent(html, { waitUntil: 'load' });
      const body = page.locator('body');
      await expect(body).toContainText('PROPOSED TARGET · NOT IMPLEMENTED');
      await expect(page.locator('img')).toHaveCount(6);
      await saveFrame(body, out(OUT, `COMPARISON-${cls}-${size.width}x${size.height}`));
    }
  });
});
