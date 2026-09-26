import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';
import { firestoreWrite, seedProfile, seedShards, seedVerifiedUser, signInVia, stampId, tsField } from './helpers/mobile';

/**
 * W9 — COMMUNITY-SETTINGS-PARITY-1: THE MATCHED-FIXTURE ROUTE COMPARISON
 * (Director #506 `5844878042` item 3, ring `5845316335`).
 *
 * The real Community and Settings ROUTES — masthead, tab bar, overlay and all —
 * served from the emulator build with the frozen reference's OWN sample state
 * (Lovable `e15b9fa0…` @ `d4f60624`): "Oak Grove Together", 23 members, three
 * goals, "500 squats together" at 241 of 500 this week, "1,000 squats in April"
 * at 1,084 and "800 squats in March" at 612 behind it, "Harbor Lunch Crew"
 * beside it; Settings with Oak's name off / activity on and Harbor's name on /
 * activity off. The 390×640 original is the reference's Champion capture, so
 * that fixture's member is Oak's founding Champion; the 390×844 one is a member.
 *
 * FULL FRAMES, NO CROP, NO ALIGNMENT: each candidate is the whole 390×H
 * viewport at device pixel ratio 1 (the originals' ratio), laid against the
 * whole original. The side-by-side carries its labels in a strip ABOVE both
 * frames; the overlay and difference are the two frames exactly as captured.
 * The differing share is a measurement, not a verdict.
 *
 * FIXTURE ONLY: every person, name and figure here is the reference's sample
 * data, seeded into the local emulator (`demo-wsf-local`) for this comparison.
 * Nothing reads or writes production, and the manifest says so.
 *
 * THE RING: the banner's 170×170 top-right corner of each candidate is also
 * measured against the original's, where both pixels are banner paint (navy,
 * ring, or the blend between them) rather than text.
 *
 * Writes only with WSF_CAPTURE_FRAMES=1.
 */

const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.join(ROOT, 'docs/design-target/review/community-settings-parity-1/matched');
const LOVABLE = path.join(ROOT, 'docs/design-target/review/community-parity-1/lovable-d4f60624');
const DAY = 864e5;

const SHOTS = [
  {
    key: '390x844',
    vp: { width: 390, height: 844 },
    role: 'member' as const,
    community: 'community-390x844.png',
    settings: 'settings-390x844.png',
    bannerTop: 92,
  },
  {
    key: '390x640',
    vp: { width: 390, height: 640 },
    role: 'foundingChampion' as const,
    community: 'manage-community-page-390x640.png',
    settings: 'settings-390x640.png',
    bannerTop: 96,
  },
];

const sha256 = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Monday 00:00 of this week, and the following Monday, local time. */
function thisWeek(): [Date, Date] {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return [d, new Date(d.getTime() + 7 * DAY - 1000)];
}

async function goal(
  id: string,
  groupId: string,
  owner: string,
  title: string,
  target: number,
  shared: number,
  startsAt: Date,
  endsAt: Date,
  open: boolean,
) {
  const f: Record<string, unknown> = {
    ownerUid: { stringValue: owner },
    communityGroupId: { stringValue: groupId },
    title: { stringValue: title },
    target: { integerValue: String(target) },
    unit: { stringValue: 'squats' },
    status: { stringValue: open ? 'active' : 'closed' },
    startsAt: tsField(startsAt),
    endsAt: tsField(endsAt),
    timezone: { stringValue: 'America/New_York' },
    aggregateDisplayAuthorized: { booleanValue: true },
    createdAt: tsField(startsAt),
    updatedAt: tsField(new Date()),
  };
  if (!open) f.closedAt = tsField(endsAt);
  await firestoreWrite(`wsfGoals/${id}`, f);
  await seedShards(id, shared);
}

async function membership(groupId: string, uid: string, role: string, name: 'visible' | 'private', activity: 'visible' | 'private') {
  const now = new Date();
  await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, {
    groupId: { stringValue: groupId },
    userId: { stringValue: uid },
    role: { stringValue: role },
    membershipStatus: { stringValue: 'active' },
    communityNameVisibility: { stringValue: name },
    communityActivityVisibility: { stringValue: activity },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
}

async function group(id: string, name: string, champ: string) {
  const now = new Date();
  await firestoreWrite(`wsfCommunityGroups/${id}`, {
    displayName: { stringValue: name },
    groupType: { stringValue: 'familyFriends' },
    joinPolicy: { stringValue: 'inviteOnly' },
    joinCode: { stringValue: `JOIN${crypto.randomBytes(4).toString('hex')}` },
    createdByUserId: { stringValue: champ },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
}

/** The reference's sample state. FIXTURE ONLY. */
async function fixture(tag: string, role: 'member' | 'foundingChampion') {
  const s = `${stampId()}${tag}`;
  const email = `wsf-w9match-${tag}-${stampId()}@example.com`;
  const password = `Aa1!${crypto.randomBytes(6).toString('hex')}`;
  const alex = await seedVerifiedUser(email, password);
  await seedProfile(alex, 'Alex M.');
  const others = Array.from({ length: 22 }, (_, i) => `w9match-${s}-p${i}`);
  await seedProfile(others[0]!, 'Jordan P.');
  await seedProfile(others[1]!, 'Kira T.');
  const oak = `w9match-oak-${s}`;
  const harbor = `w9match-harbor-${s}`;
  const oakChamp = role === 'foundingChampion' ? alex : others[0]!;
  await group(oak, 'Oak Grove Together', oakChamp);
  await membership(oak, alex, role, 'private', 'visible');
  for (const [i, uid] of others.entries()) {
    await membership(oak, uid, uid === oakChamp ? 'foundingChampion' : 'member', i < 2 ? 'visible' : 'private', 'visible');
  }
  await group(harbor, 'Harbor Lunch Crew', others[1]!);
  await membership(harbor, others[1]!, 'foundingChampion', 'visible', 'visible');
  await membership(harbor, alex, 'member', 'visible', 'private');
  const [weekStart, weekEnd] = thisWeek();
  await goal(`w9match-500-${s}`, oak, oakChamp, '500 squats together', 500, 241, weekStart, weekEnd, true);
  await goal(`w9match-apr-${s}`, oak, oakChamp, '1,000 squats in April', 1000, 1084, new Date(2026, 3, 1), new Date(2026, 3, 30, 23, 59), false);
  await goal(`w9match-mar-${s}`, oak, oakChamp, '800 squats in March', 800, 612, new Date(2026, 2, 1), new Date(2026, 2, 31, 23, 59), false);
  return { alex, email, password, oak };
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
      if (ia.width !== ib.width || ia.height !== ib.height) {
        throw new Error(`size mismatch ${ia.width}x${ia.height} vs ${ib.width}x${ib.height}`);
      }
      const w = ia.width;
      const h = ia.height;
      const canvas = (cw: number, chh: number) => {
        const c = document.createElement('canvas');
        c.width = cw;
        c.height = chh;
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
      for (let i = 0; i < data.length; i += 4) {
        if (data[i]! + data[i + 1]! + data[i + 2]! > 48) differing += 1;
      }
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

/**
 * The ring, measured: each frame's 170×170 banner top-right corner, where
 * BOTH pixels are banner paint -- navy, ring, or the blend between them --
 * rather than text. Reports the channel deltas and how many pixels each frame
 * paints as ring.
 */
async function measureRing(
  page: Page,
  lovable: string,
  candidate: string,
  lovableBanner: { right: number; top: number },
  candidateBanner: { right: number; top: number },
) {
  const a = `data:image/png;base64,${fs.readFileSync(lovable).toString('base64')}`;
  const b = `data:image/png;base64,${fs.readFileSync(candidate).toString('base64')}`;
  await page.setContent('<html><body style="margin:0"></body></html>');
  return page.evaluate(
    async ([srcA, srcB, la, lt, ca, ct]) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        });
      const [ia, ib] = await Promise.all([load(srcA!), load(srcB!)]);
      const S = 170;
      const grab = (img: HTMLImageElement, right: number, top: number) => {
        const c = document.createElement('canvas');
        c.width = S;
        c.height = S;
        const x = c.getContext('2d')!;
        x.drawImage(img, right - S, top, S, S, 0, 0, S, S);
        return x.getImageData(0, 0, S, S).data;
      };
      const pa = grab(ia, Number(la), Number(lt));
      const pb = grab(ib, Number(ca), Number(ct));
      const NAVY = [11, 31, 58];
      const RING = [29, 55, 67];
      // t along navy -> ring, or null if the pixel is off that line (text).
      const along = (d: Uint8ClampedArray, i: number) => {
        const t = (d[i]! - NAVY[0]!) / (RING[0]! - NAVY[0]!);
        const tc = Math.max(0, Math.min(1, t));
        for (let k = 0; k < 3; k++) {
          if (Math.abs(d[i + k]! - (NAVY[k]! + tc * (RING[k]! - NAVY[k]!))) > 4) return null;
        }
        return tc;
      };
      let compared = 0;
      let sum = 0;
      let max = 0;
      let ringA = 0;
      let ringB = 0;
      let agree = 0;
      for (let i = 0; i < pa.length; i += 4) {
        const ta = along(pa, i);
        const tb = along(pb, i);
        if (ta === null || tb === null) continue;
        compared++;
        const d = Math.max(Math.abs(pa[i]! - pb[i]!), Math.abs(pa[i + 1]! - pb[i + 1]!), Math.abs(pa[i + 2]! - pb[i + 2]!));
        sum += d;
        max = Math.max(max, d);
        if (ta > 0.5) ringA++;
        if (tb > 0.5) ringB++;
        if (ta > 0.5 === tb > 0.5) agree++;
      }
      return {
        window: '170x170 at each banner top-right corner',
        comparedPixels: compared,
        maxChannelDelta: max,
        meanChannelDelta: Math.round((sum / Math.max(1, compared)) * 1000) / 1000,
        ringPixelsLovable: ringA,
        ringPixelsCandidate: ringB,
        ringClassificationAgreement: Math.round((agree / Math.max(1, compared)) * 10_000) / 10_000,
      };
    },
    [a, b, String(lovableBanner.right), String(lovableBanner.top), String(candidateBanner.right), String(candidateBanner.top)] as const,
  );
}

test.describe('COMMUNITY-SETTINGS-PARITY-1 · matched-fixture route comparison', () => {
  test.use({ deviceScaleFactor: 1 });

  for (const shot of SHOTS) {
    test(`${shot.key}: Community and Settings routes against the frozen originals`, async ({ page }) => {
      test.skip(!CAPTURE_FRAMES, 'evidence is written only under WSF_CAPTURE_FRAMES=1');
      test.setTimeout(300_000);
      await page.setViewportSize(shot.vp);
      await page.goto('/health');
      const commit = ((await page.getByTestId('wsf-health-commit').innerText()).match(/[0-9a-f]{7,40}/) ?? [''])[0];
      expect(commit).not.toBe('');

      const fx = await fixture(`m${shot.vp.height}`, shot.role);
      await signInVia(page, fx.email, fx.password);
      await page.evaluate(([u, g]) => localStorage.setItem(`wsf.currentCommunity.${u}`, g), [fx.alex, fx.oak] as const);
      await page.goto('/community');
      await expect(page.getByText('500 squats together').first()).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('[data-testid="wsf-parity-name"]:visible')).toHaveText('Oak Grove Together');
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(1_500);
      fs.mkdirSync(OUT, { recursive: true });
      const communityFile = path.join(OUT, `CANDIDATE-FIXTURE-community-${shot.key}.png`);
      await page.screenshot({ path: communityFile });
      const banner = await page.locator('[data-testid="wsf-parity-banner"]:visible').boundingBox();
      const ringBox = await page.locator('[data-testid="wsf-parity-banner-ring"]:visible').boundingBox();
      const facts = {
        members: await page.locator('[data-testid="wsf-parity-fact-members"]:visible').textContent(),
        role: await page.locator('[data-testid="wsf-parity-fact-role"]:visible').textContent(),
        goals: await page.locator('[data-testid="wsf-parity-fact-goals"]:visible').textContent(),
      };

      await page.locator('[data-testid="wsf-member-tab-you"]:visible').last().click();
      await expect(page.locator('[data-testid="wsf-you-settings"]:visible')).toBeVisible({ timeout: 40_000 });
      await page.waitForTimeout(600);
      await page.locator('[data-testid="wsf-you-settings"]:visible').click();
      await expect(page.getByText('Show my name').first()).toBeVisible({ timeout: 40_000 });
      await page.waitForTimeout(1_200);
      const settingsFile = path.join(OUT, `CANDIDATE-FIXTURE-settings-${shot.key}.png`);
      await page.screenshot({ path: settingsFile });
      const panel = await page.locator('[data-testid="wsf-settings-panel"]:visible').boundingBox();
      const switches = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[role="switch"][data-testid^="wsf-privacy-panel-"]')).map(
          (n) => `${n.getAttribute('data-testid')}=${n.getAttribute('aria-checked')}`,
        ),
      );

      const capA = `FROZEN LOVABLE d4f60624 (original, ${shot.key})`;
      const capB = `CANDIDATE ${commit} · FIXTURE SAMPLE DATA · NOT ACCEPTED`;
      const community = await compose(
        page,
        path.join(LOVABLE, shot.community),
        communityFile,
        path.join(OUT, `cmp-community-${shot.key}`),
        [capA, capB],
      );
      const settings = await compose(
        page,
        path.join(LOVABLE, shot.settings),
        settingsFile,
        path.join(OUT, `cmp-settings-${shot.key}`),
        [capA, capB],
      );
      const ring = await measureRing(
        page,
        path.join(LOVABLE, shot.community),
        communityFile,
        { right: shot.vp.width, top: shot.bannerTop },
        { right: Math.round(banner!.x + banner!.width), top: Math.round(banner!.y) },
      );

      const manifest = {
        fixtureOnly:
          'Every person, name and figure is the frozen reference’s sample data, seeded into the local emulator (demo-wsf-local) for this comparison only. No production read or write.',
        commit,
        viewport: shot.vp,
        deviceScaleFactor: 1,
        crop: 'none — full viewport frames on both sides',
        memberRole: shot.role,
        facts,
        settingsSwitches: switches,
        community: {
          lovable: path.relative(OUT, path.join(LOVABLE, shot.community)),
          lovableSha256: sha256(path.join(LOVABLE, shot.community)),
          candidate: path.relative(OUT, communityFile),
          candidateSha256: sha256(communityFile),
          ...community,
          bannerBox: banner,
          ringBox,
          ring,
        },
        settings: {
          lovable: path.relative(OUT, path.join(LOVABLE, shot.settings)),
          lovableSha256: sha256(path.join(LOVABLE, shot.settings)),
          candidate: path.relative(OUT, settingsFile),
          candidateSha256: sha256(settingsFile),
          ...settings,
          panelBox: panel,
        },
      };
      fs.writeFileSync(path.join(OUT, `manifest-${shot.key}.json`), `${JSON.stringify(manifest, null, 2)}\n`);

      // The geometry the Director set, and the ring kept inside the banner.
      expect(Math.round(panel!.x), 'panel 12 px in from the left').toBe(12);
      expect(Math.round(panel!.width), 'panel 366 wide at 390').toBe(366);
      expect(Math.round(panel!.y), 'panel 12 px down').toBe(12);
      expect(Math.round(panel!.y + panel!.height), 'panel 12 px up from the bottom').toBe(shot.vp.height - 12);
      expect(Math.round(ringBox!.x + ringBox!.width), 'ring laid out inside the banner').toBeLessThanOrEqual(
        Math.round(banner!.x + banner!.width),
      );
      expect(facts.members).toBe('Members23');
      expect(facts.goals).toBe('Goals3');
    });
  }
});
