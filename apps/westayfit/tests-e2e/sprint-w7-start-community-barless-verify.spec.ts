import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { inflateSync } from 'node:zlib';

import { expect, test, type Page, type Route } from '@playwright/test';

import {
  AUTH_EMULATOR,
  FIRESTORE_EMULATOR,
  PROJECT_ID,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
  visibleCount,
} from './helpers/mobile';

/**
 * W7 — PRE-STAGED VERIFICATION for W4's barless `/start-community` on the
 * integrated shell `dd86721` (L0 `5799845823`). Written before the delivery
 * exists, so that it discriminates in advance rather than being fitted to it.
 *
 * WHAT "BEFORE" MEANS HERE, measured, not assumed. `d467754` (W4) merged onto
 * `dd86721` is ALREADY barless — the route sits outside `(tabs)` — so a live
 * "no bar" check passes on it and proves nothing about the delivery. What
 * separates a correct delivery from BEFORE is:
 *
 *   SEAM  four defects measured on BEFORE (#434 `5800444443`, `5800531433`,
 *         `5800875664`), each of which W4's own code comments promise the
 *         opposite of. Every SEAM test FAILS on BEFORE by design; that is the
 *         recorded BEFORE result, not a flaky suite.
 *   FRAMES 21 of the 24 committed AFTER frames still show the old bar.
 *
 * And the BARLESS checks, which pass on BEFORE, are proved able to fail two
 * ways: they FAIL on the old shell (`d467754 ⊕ 37367fd`, bar present), and a
 * same-revision POSITIVE CONTROL — a FormShell page INSIDE `(tabs)`,
 * `/community/<id>/challenge` with no active challenge — shows the instruments
 * seeing the top bar, the tab bar and a second masthead when they are there.
 *
 * MEASURED MATRIX. BEFORE = W4's delivered `5c28e45` (product tree
 * `e5cfabd6`, identical to `d467754 ⊕ dd86721`; the delivery changed only
 * specs and frames), run with this file. Old shell = `d467754 ⊕ 37367fd`
 * (`05d2aef9`, local, never pushed), run with this file.
 *
 *   test                                  old shell   BEFORE (5c28e45)   correct fix
 *   SEAM-1 390x844, 4 press methods          FAIL ×4     FAIL ×4          PASS
 *   SEAM-1 430x932, 4 press methods          FAIL ×4     FAIL ×4          PASS
 *   SEAM-1 390x640, 4 press methods          PASS ×4     PASS ×4          PASS  (see below)
 *   SEAM-2  list opt-in survives the click    PASS        FAIL             PASS  (Q2 — W9's)
 *   SEAM-2b reload with a remembered group    PASS        FAIL             PASS  (Q2 — W9's)
 *   SEAM-2c Back / Forward around the click   PASS 2/2    FAIL 2/2         PASS  (Q2 — W9's; Forward
 *                                                                               opens the older group)
 *   SEAM-3  unverified gate way out           PASS        FAIL             PASS  (M4 — ruling pending)
 *   SEAM-4  leaving mid-create                FAIL        FAIL             PASS  (M5 — ruling pending)
 *   SEAM-1b blur by keyboard moves nothing     not run     FAIL ×2 (+52 px) PASS  (W4's stated design;
 *     (its valid-name CONTROL: PASS ×2)                                           see note below)
 *   SEAM-1c blur marks red, no sentence        —           FAIL (sentence)  PASS on 9f27c6ea
 *   SEAM-3n the way out, by name, goes Home    —           FAIL (none) ×2   PASS ×2 on 9f27c6ea
 *   SEAM-1 CONTROL ×8 (reader can see a pass)  —           PASS ×8          PASS
 *   SEAM-4 CONTROL (assertions satisfiable)    —           PASS             PASS
 *   BARLESS ×4 states                         FAIL        PASS             PASS
 *   CONTROL instruments see chrome            n/a (no     PASS             PASS
 *                                             top bar)
 *   FRAMES calibration on d467754             PASS        PASS             PASS
 *   FRAMES delivery (WSF_W7_DELIVERY_SHA)     —           PASS on 5c28e45  PASS
 *
 * SEAM-1c and SEAM-3n: the BEFORE column is the preview below (W4's 5c28e45
 * route); the candidate column is 9f27c6ea (QA report, Check 16). On
 * 9f27c6ea the whole file passes, with SEAM-1's risky position reached 4×
 * at 390x844 and 430x932 and 0× at 390x640 (now asserted).
 *
 * PREVIEW (local, never pushed): f2f901a ⊕ W9 a87cd3b ⊕ W8 eff65b0 ⊕ 5c28e45
 * (6c98f485, tree 77129e6a). SEAM-2, 2b and 2c PASS there with W9's fix;
 * SEAM-1 at 390x844 / 430x932, SEAM-3 and SEAM-4 still FAIL, as W4's
 * successor has not landed. W9's and W8's own specs pass on it.
 *
 * SEAM-1b was measured on the preview below, whose /start-community route
 * and shell are byte-for-byte 5c28e45's (W9's and W8's commits touch neither);
 * not run on the old shell, whose route blob is the same.
 *
 * SEAM-1 at 390x640 cannot fail first: at every scroll position where the
 * whole Create button is on screen, the name field's bottom is at y ≤ −84, so
 * the risky condition (field still on screen at press time) does not exist at
 * that class. It is a regression guard there, and the test's `risky-positions`
 * annotation reports 0 for it. At 390x844 and 430x932 EVERY pressable
 * position has the field on screen, so the natural path always takes it.
 *
 * Verification only: no product file and no W4 test is edited; the frames are
 * read from git objects in memory and nothing is written to disk.
 */

const PHONE = { width: 390, height: 844 };
const CREATE = '**/wsfCreateCommunity';
const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };

/* ── people and server reads ─────────────────────────────────────────────── */

type Person = { uid: string; email: string; password: string };

async function person(tag: string): Promise<Person> {
  const email = `wsf-w7bl-${tag}-${stampId()}@example.com`;
  const password = `Aa1!${randomBytes(6).toString('hex')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Robin Vale');
  return { uid, email, password };
}

async function unverifiedPerson(tag: string): Promise<Person> {
  const email = `wsf-w7bl-${tag}-${stampId()}@example.com`;
  const password = `Aa1!${randomBytes(6).toString('hex')}`;
  const res = await fetch(`${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers: OWNER,
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`signUp failed: ${res.status}`);
  const { localId } = (await res.json()) as { localId: string };
  await seedProfile(localId, 'Ada Unverified');
  return { uid: localId, email, password };
}

/**
 * THE SERVER'S ANSWER, FILTERED ON THE SERVER. Not a paged listing filtered in
 * the client: W4's `communityNames` reads the emulator's first page only (150
 * documents even at pageSize=300), which makes presence checks intermittent and
 * absence checks vacuous on a long-lived emulator (#434 `5800875664`).
 */
async function communitiesOf(uid: string): Promise<string[]> {
  const res = await fetch(`${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`, {
    method: 'POST',
    headers: OWNER,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'wsfCommunityGroups' }],
        where: { fieldFilter: { field: { fieldPath: 'createdByUserId' }, op: 'EQUAL', value: { stringValue: uid } } },
      },
    }),
  });
  if (!res.ok) throw new Error(`runQuery failed: ${res.status}`);
  const rows = (await res.json()) as { document?: { name: string } }[];
  return rows.filter((r) => r.document).map((r) => r.document!.name.split('/').pop()!);
}

async function signInLoosely(page: Page, p: Person): Promise<void> {
  await page.goto('/signin');
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-signin-email').fill(p.email);
  await page.getByTestId('wsf-signin-password').fill(p.password);
  await page.getByTestId('wsf-signin-submit').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 20_000 });
}

/* ── instruments ─────────────────────────────────────────────────────────── */

/** Count programmatic focus() calls on the name field — onSubmit's own signature. */
async function watchFieldFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __w7fc: number };
    w.__w7fc = 0;
    const orig = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (this: HTMLElement, ...a: unknown[]) {
      if (this.dataset?.testid === 'wsf-start-name') w.__w7fc += 1;
      return orig.apply(this, a as []);
    };
  });
}

type Placed = {
  scrollTop: number;
  max: number;
  inputTop: number;
  inputBottom: number;
  cx: number;
  cy: number;
  valid: boolean;
};

/**
 * PUT THE BUTTON WHERE A MEMBER WOULD PRESS IT, AND PROVE THE POINTER IS ON IT.
 *
 * Placement is relative to the SCROLLER, never the window: on the old shell the
 * bottom 76 px of the window is the tab bar, outside the scroller, and a
 * window-relative placement once put the pointer on the tab bar and was
 * recorded as a swallowed press (#434 `5800531433` — my instrument error).
 */
async function placeAt(page: Page, scrollTop: number): Promise<Placed> {
  return page.evaluate((st) => {
    const btn = document.querySelector('[data-testid="wsf-start-submit"]') as HTMLElement;
    let sc: HTMLElement | null = btn;
    while (sc && !(sc.scrollHeight > sc.clientHeight + 1)) sc = sc.parentElement;
    if (!sc) throw new Error('no scroller above the submit');
    sc.scrollTop = st;
    const s = sc.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const i = (document.querySelector('[data-testid="wsf-start-name"]') as HTMLElement).getBoundingClientRect();
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    let n = document.elementFromPoint(cx, cy) as HTMLElement | null;
    while (n && !n.dataset?.testid) n = n.parentElement;
    return {
      scrollTop: Math.round(sc.scrollTop),
      max: sc.scrollHeight - sc.clientHeight,
      inputTop: Math.round(i.top),
      inputBottom: Math.round(i.bottom),
      cx,
      cy,
      valid: b.top >= s.top && b.bottom <= s.bottom && !!n && n.dataset.testid === 'wsf-start-submit',
    };
  }, scrollTop);
}

async function maxScroll(page: Page): Promise<number> {
  return page.evaluate(() => {
    const b = document.querySelector('[data-testid="wsf-start-submit"]') as HTMLElement;
    let sc: HTMLElement | null = b;
    while (sc && !(sc.scrollHeight > sc.clientHeight + 1)) sc = sc.parentElement;
    return sc ? sc.scrollHeight - sc.clientHeight : 0;
  });
}

async function openForm(page: Page): Promise<void> {
  await page.goto('/start-community');
  await expect(page.getByTestId('wsf-start')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('wsf-start-name')).toBeVisible({ timeout: 20_000 });
}

/* ════════════════════════════════════════════════════════════════════════ */
/* SEAM — each FAILS on BEFORE by design                                    */
/* ════════════════════════════════════════════════════════════════════════ */

/**
 * One press, the way a member makes it: a mouse click held for `ms`, or a touch
 * (CDP Input.dispatchTouchEvent, so RN-web sees real touch events) held for `ms`.
 * For holds of 80 ms and more, the element under the pointer is sampled at the
 * end of the hold, just before release — that is the element the release lands
 * on. A 5 ms press is not sampled, because sampling would lengthen it.
 */
type Press = { kind: 'mouse' | 'touch'; ms: number };
const PRESSES: Press[] = [
  { kind: 'mouse', ms: 5 },
  { kind: 'mouse', ms: 120 },
  { kind: 'touch', ms: 80 },
  { kind: 'touch', ms: 150 },
];

async function underPointer(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(([px, py]) => {
    let n = document.elementFromPoint(px, py) as HTMLElement | null;
    while (n && !n.dataset?.testid) n = n.parentElement;
    return n?.dataset.testid ?? '-';
  }, [x, y] as const);
}

async function pressAt(page: Page, press: Press, x: number, y: number): Promise<string> {
  let under = 'not sampled';
  if (press.kind === 'mouse') {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(press.ms);
    if (press.ms >= 80) under = await underPointer(page, x, y);
    await page.mouse.up();
  } else {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(press.ms);
    if (press.ms >= 80) under = await underPointer(page, x, y);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  }
  return under;
}

/**
 * What the first press did. SUBMITTED means onSubmit ran: it calls focus() on
 * the name field (counted by watchFieldFocus), or focus now sits on the field
 * or its error. A swallowed press leaves focus on the button, which took it on
 * press-down. EXPOSED means the error is on screen after the press, inside the
 * viewport — the member can read what to fix.
 */
async function outcome(page: Page): Promise<{ submitted: boolean; exposed: boolean; active: string; errorBox: string }> {
  return page.evaluate(() => {
    const fc = (window as unknown as { __w7fc: number }).__w7fc;
    const a = document.activeElement as HTMLElement | null;
    const active = a?.dataset?.testid ?? a?.tagName.toLowerCase() ?? 'null';
    const err = document.querySelector('[data-testid="wsf-start-name-error"]') as HTMLElement | null;
    const r = err?.getBoundingClientRect();
    const exposed = !!r && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
    return {
      submitted: fc > 0 || active === 'wsf-start-name' || active === 'wsf-start-name-error',
      exposed,
      active,
      errorBox: r ? `${Math.round(r.top)}..${Math.round(r.bottom)}` : 'absent',
    };
  });
}

for (const vp of [
  { width: 390, height: 844 },
  { width: 390, height: 640 },
  { width: 430, height: 932 },
]) {
  for (const press of PRESSES) {
    const label = `${press.kind} ${press.ms} ms`;
    test.describe(`SEAM-1 @${vp.width}x${vp.height} ${label}`, () => {
      test.use(
        press.kind === 'touch'
          ? { viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 3 }
          : { viewport: vp },
      );

      /**
       * THE FIRST INVALID PRESS SUBMITS, including with the name field still
       * partly on screen, and the error is then on screen. W4's own comment:
       * "The button stays tappable; an invalid name sends the member to the
       * field with the message under it". Measured on BEFORE: on blur the error
       * renders ABOVE the button, the button drops 52 px mid-press, the release
       * lands on the summary line and the press is cancelled — at every
       * reachable position at 390x844, and at 430x932. Proved causal by
       * excluding the field from scroll anchoring, which makes the same press
       * submit (#434 `5800875664`).
       *
       * Positions are a sweep of the scroller's own scrollTop from max−120 to
       * max, fresh page each time; a position counts only if the pointer is
       * verified on the button before pressing (placeAt).
       */
      test(`the first invalid press submits and shows the error, every pressable position @${vp.width}x${vp.height} ${label}`, async ({ page }) => {
        test.setTimeout(600_000);
        const me = await person(`s1${vp.height}${press.kind[0]}${press.ms}`);
        await signInVia(page, me.email, me.password);
        await openForm(page);
        const max = await maxScroll(page);
        const stops = [...new Set([max - 120, max - 90, max - 60, max - 40, max - 20, max].map((v) => Math.max(0, v)))];

        const rows: string[] = [];
        const bad: string[] = [];
        let pressed = 0;
        let pressedWithFieldVisible = 0;
        for (const st of stops) {
          await openForm(page);
          await watchFieldFocus(page);
          await page.getByTestId('wsf-start-name').fill('a');
          const p = await placeAt(page, st);
          await page.waitForTimeout(150);
          if (!p.valid) {
            rows.push(`scrollTop ${p.scrollTop}/${p.max}: not pressable (button clipped or covered)`);
            continue;
          }
          pressed += 1;
          if (p.inputBottom > 0) pressedWithFieldVisible += 1;
          const under = await pressAt(page, press, p.cx, p.cy);
          await page.waitForTimeout(600);
          const o = await outcome(page);
          const verdict = !o.submitted ? 'SWALLOWED' : !o.exposed ? 'SUBMITTED-ERROR-OFFSCREEN' : 'SUBMITTED';
          const row = `scrollTop ${p.scrollTop}/${p.max} field[${p.inputTop}..${p.inputBottom}] press@(${Math.round(p.cx)},${Math.round(p.cy)}) under-at-release=${under} -> ${verdict} (focus=${o.active}, error=${o.errorBox})`;
          rows.push(row);
          if (verdict !== 'SUBMITTED') bad.push(row);
        }
        test.info().annotations.push({ type: 'sweep', description: rows.join(' | ') });
        console.log(`[SEAM-1 ${vp.width}x${vp.height} ${label}]\n  ${rows.join('\n  ')}`);
        // NON-VACUOUS: at least one real press happened, and the report states
        // whether the risky condition (field still on screen) was reached.
        test.info().annotations.push({ type: 'risky-positions', description: String(pressedWithFieldVisible) });
        // The risky condition is REACHED where it exists and absent where it
        // cannot exist, so this test cannot pass by never meeting it.
        if (vp.height === 640) expect(pressedWithFieldVisible, '390x640 unexpectedly has a pressable position with the field on screen').toBe(0);
        else expect(pressedWithFieldVisible, 'no pressable position had the field on screen — the test would be vacuous').toBeGreaterThan(0);
        expect(pressed, `no pressable position was found at all: ${rows.join(' | ')}`).toBeGreaterThan(0);
        expect(bad, `first presses that did not submit and show the error`).toEqual([]);
      });
    });
  }
}

/**
 * SEAM-1b — LEAVING THE NAME FIELD SHORT MOVES NOTHING. The direct test of the
 * mechanism, with no press at all: the field is left by the keyboard (Tab), so
 * no pointer is involved. The Create button's position IN THE CONTENT (its box
 * top plus the scroller's scrollTop) and the content height must not change.
 * On BEFORE the blur inserts the name error above the button (+52 px).
 *
 * This measures W4's own stated design for Q3 (#394 `5801525555`: "on blur, a
 * short name marks the field invalid with a route-local border-colour change
 * only — same width, zero layout change"). A fix that reserves the error's
 * space passes it too; one that only suppresses the reveal when focus moves to
 * Create would not, and the report would say so rather than call it wrong.
 */
for (const vp of [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test.describe(`SEAM-1b @${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });
    for (const [label, name] of [['short', 'a'], ['CONTROL valid', 'W7 Valid Name']] as const) {
    test(`leaving the name field ${label} by keyboard moves nothing @${vp.width}x${vp.height}`, async ({ page }) => {
      // The CONTROL uses a valid name, so nothing is revealed: it proves the
      // Tab and the focus change themselves move nothing, i.e. the check can pass.
      test.setTimeout(240_000);
      const me = await person(`s1b${vp.height}${label[0]}`);
      await signInVia(page, me.email, me.password);
      await openForm(page);
      await page.getByTestId('wsf-start-name').fill(name);
      const p = await placeAt(page, await maxScroll(page));
      await page.waitForTimeout(150);
      const geo = () =>
        page.evaluate(() => {
          const btn = document.querySelector('[data-testid="wsf-start-submit"]') as HTMLElement;
          let sc: HTMLElement | null = btn;
          while (sc && !(sc.scrollHeight > sc.clientHeight + 1)) sc = sc.parentElement;
          return {
            btnInContent: Math.round(btn.getBoundingClientRect().top + (sc ? sc.scrollTop : 0)),
            contentHeight: sc ? sc.scrollHeight : -1,
            active: (document.activeElement as HTMLElement | null)?.dataset?.testid ?? '-',
          };
        });
      const before = await geo();
      expect(before.active, 'the field did not have focus before the blur').toBe('wsf-start-name');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(400);
      const after = await geo();
      const row = `field[${p.inputTop}..${p.inputBottom}] before=${JSON.stringify(before)} after=${JSON.stringify(after)}`;
      test.info().annotations.push({ type: 'geometry', description: row });
      expect(after.active, 'Tab did not move focus off the field').not.toBe('wsf-start-name');
      expect(Math.abs(after.btnInContent - before.btnInContent), `the blur moved Create: ${row}`).toBeLessThanOrEqual(1);
      expect(Math.abs(after.contentHeight - before.contentHeight), `the blur changed the content height: ${row}`).toBeLessThanOrEqual(1);
    });
    }
  });
}

/**
 * SEAM-1c — THE NEUTRAL BLUR, THEN THE FIRST PRESS. The Director ruled W4's
 * red-border-only blur state a NARROW FAIL (#365 `5802873607`; L0
 * `5802882084`, `5803227673`). Leaving the field with a too-short name must
 * stay visually NEUTRAL while no sentence is shown: the same border as a
 * validly named, unfocused field. The FIRST invalid Create activation then
 * gives, in that one activation, the sentence, focus in the field and the
 * invalid border, and sends nothing. A corrected name returns to normal; a
 * too-long name keeps saying so while typing.
 *
 * Colours are read, not assumed: `normal` from a validly named, unfocused
 * field and `focusedValid` from the same field focused, so focus styling
 * cannot pass for invalid styling. The invalid colour is W4's ERROR_RED,
 * rgb(180, 35, 44), the one the delivered Q3 behaviour paints.
 *
 * Every state is read before any assertion, so a build that fails early
 * still records the press state.
 *
 * MEASURED on 9f27c6ea: FAILS at the blur (a red border with no sentence,
 * the ruled defect). The recorded press state there already has the
 * sentence, focus and red. The earlier SEAM-1c asserted W4's superseded
 * red-on-blur design and passed there.
 */
const ERROR_RED = 'rgb(180, 35, 44)';
test.describe('SEAM-1c', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('a short name left by blur stays neutral with no sentence; the first Create press gives the sentence, focus and the invalid border at once', async ({ page }) => {
    test.setTimeout(240_000);
    const me = await person('s1c');
    await signInVia(page, me.email, me.password);
    await openForm(page);
    let creates = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/wsfCreateCommunity/.test(r.url())) creates += 1;
    });
    const field = page.getByTestId('wsf-start-name');
    const border = () => field.evaluate((el) => getComputedStyle(el).borderTopColor);
    const sentence = () => visibleCount(page, 'wsf-start-name-error');
    const sentenceText = async () => (await page.locator('[data-testid="wsf-start-name-error"]:visible').first().innerText().catch(() => '')).trim();
    const focused = () => field.evaluate((el) => document.activeElement === el);

    await field.fill('W7 Valid Name');
    await page.waitForTimeout(200);
    const focusedValid = await border();
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    const normal = await border();

    await field.click();
    await field.fill('a');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    const shortBlurred = { border: await border(), sentence: await sentence(), focused: await focused() };

    // The first invalid activation: one press on Create.
    const submit = page.locator('[data-testid="wsf-start-submit"]:visible').first();
    await submit.scrollIntoViewIfNeeded();
    await submit.click();
    await page.waitForTimeout(400);
    const firstPress = { border: await border(), sentence: await sentence(), text: await sentenceText(), focused: await focused(), creates };

    await field.fill('Ab');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    const corrected = { border: await border(), sentence: await sentence() };
    await field.click();
    await field.fill('x'.repeat(81));
    await page.waitForTimeout(300);
    const tooLongTyping = { border: await border(), sentence: await sentenceText() };
    test.info().annotations.push({
      type: 'field states',
      description: JSON.stringify({ normal, focusedValid, shortBlurred, firstPress, corrected, tooLongTyping }),
    });

    expect(normal, 'a valid name shows the error red').not.toBe(ERROR_RED);
    expect(focusedValid, 'focus alone paints the error red, so invalid cannot be told from focused').not.toBe(ERROR_RED);
    expect(shortBlurred.sentence, 'leaving the field short inserted a sentence (the Q3 mechanism)').toBe(0);
    expect(shortBlurred.border, 'leaving the field short changed the border with no sentence (ruled a NARROW FAIL)').toBe(normal);
    expect(firstPress.creates, 'the invalid press sent a create').toBe(0);
    expect(firstPress.sentence, 'the first invalid press showed no sentence').toBeGreaterThan(0);
    expect(firstPress.text, 'the sentence does not say why').not.toBe('');
    expect(firstPress.focused, 'the first invalid press did not put focus in the field').toBe(true);
    expect(firstPress.border, 'the first invalid press did not apply the invalid border').toBe(ERROR_RED);
    expect(corrected.border, 'a corrected name stayed marked').toBe(normal);
    expect(corrected.sentence, 'a corrected name kept its sentence').toBe(0);
    expect(tooLongTyping.sentence, 'a too-long name no longer says so while typing').toMatch(/80 characters or fewer/);
  });
});

/**
 * SEAM-1 POSITIVE CONTROL — the instrument can read SUBMITTED on this build.
 * SEAM-1 has never passed at 390x844 or 430x932 on any build, so without this
 * a correct fix could fail for an instrument reason. Same fixture, placement,
 * press and outcome reader as SEAM-1, at max scroll (field on screen); the only
 * difference is a TEST-SIDE capture listener that cancels the default of a
 * mousedown on Create, so pressing it does not blur the field and nothing is
 * revealed mid-press — the shape of the fix "don't move the control being
 * pressed". The click still fires, so onSubmit runs as it would after a fix.
 * No product file is touched; it proves the reader, not a fix.
 *
 * Two other controls were tried and rejected as geometry-dependent (measured,
 * QA report Check 14): excluding the field from scroll anchoring (submits at
 * 390x844, not at 430x932, where content above the field becomes the anchor),
 * and taking the error out of flow (submits at both, but the out-of-flow error
 * lands off screen at 390x844).
 */
for (const vp of [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  for (const press of PRESSES) {
    const label = `${press.kind} ${press.ms} ms`;
    test.describe(`SEAM-1 CONTROL @${vp.width}x${vp.height} ${label}`, () => {
      test.use(
        press.kind === 'touch'
          ? { viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 3 }
          : { viewport: vp },
      );
      test(`CONTROL the SEAM-1 reader sees a first press submit when the button stays put @${vp.width}x${vp.height} ${label}`, async ({ page }) => {
        test.setTimeout(300_000);
        const me = await person(`c1${vp.height}${press.kind[0]}${press.ms}`);
        await signInVia(page, me.email, me.password);
        await openForm(page);
        await watchFieldFocus(page);
        await page.evaluate(() => {
          document.addEventListener(
            'mousedown',
            (e) => {
              if ((e.target as HTMLElement | null)?.closest('[data-testid="wsf-start-submit"]')) e.preventDefault();
            },
            true,
          );
        });
        await page.getByTestId('wsf-start-name').fill('a');
        const p = await placeAt(page, await maxScroll(page));
        await page.waitForTimeout(150);
        expect(p.valid, 'the button is not pressable at max scroll').toBe(true);
        expect(p.inputBottom, 'the field is not on screen — the control would be vacuous').toBeGreaterThan(0);
        const under = await pressAt(page, press, p.cx, p.cy);
        await page.waitForTimeout(600);
        const o = await outcome(page);
        const row = `scrollTop ${p.scrollTop}/${p.max} field[${p.inputTop}..${p.inputBottom}] under-at-release=${under} focus=${o.active} error=${o.errorBox}`;
        console.log(`[SEAM-1 CONTROL ${vp.width}x${vp.height} ${label}] ${row}`);
        expect(o.submitted, `the reader did not see the submit: ${row}`).toBe(true);
        expect(o.exposed, `the error is not on screen: ${row}`).toBe(true);
      });
    });
  }
}

test.describe('SEAM-2/3/4', () => {
  test.use({ viewport: PHONE });

  /** Lose the response after the server commits: the community really exists. */
  async function toUnconfirmed(page: Page, name: string): Promise<void> {
    await page.route(CREATE, async (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fetch().catch(() => undefined);
      await route.abort('failed').catch(() => undefined);
    });
    await page.getByTestId('wsf-start-name').fill(name);
    await page.getByTestId('wsf-start-submit').click();
    await expect(page.getByTestId('wsf-start-check-communities')).toBeVisible({ timeout: 25_000 });
    await page.unroute(CREATE);
  }

  /**
   * SEAM-2 — THE LIST OPT-IN SURVIVES THE REAL JOURNEY. Reached in-app from
   * Home, as a member reaches it. Measured on BEFORE: the click pushes "/"
   * (Expo Router's URL sync drops a query that crosses from the root Stack
   * into the unmounted (tabs)), so a reload opens a community, not the list.
   */
  test('SEAM-2 "Check your communities", reached in-app, keeps the list through a reload', async ({ page }) => {
    test.setTimeout(300_000);
    const me = await person('s2');
    await signInVia(page, me.email, me.password);
    await page.goto('/');
    await expect(page.getByTestId('wsf-home-start').last()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('wsf-home-start').last().click();
    await expect(page.getByTestId('wsf-start-name')).toBeVisible({ timeout: 25_000 });
    await toUnconfirmed(page, 'W7 Barless Opt-in');
    await page.getByTestId('wsf-start-check-communities').click();
    await expect(page.getByTestId('wsf-home-my-list').last()).toBeVisible({ timeout: 25_000 });
    expect(new URL(page.url()).search, 'the opt-in left the URL on the click').toBe('?view=communities');
    await page.reload();
    await expect(page.getByTestId('wsf-home-my-list').last()).toBeVisible({ timeout: 25_000 });
    expect(new URL(page.url()).pathname).toBe('/');
    expect(new URL(page.url()).search, 'the opt-in did not survive a reload').toBe('?view=communities');
    expect(await communitiesOf(me.uid), 'the lost-response create did not commit').toHaveLength(1);
  });

  /** SEAM-2b — with a remembered older community, a reload must not open it. */
  test('SEAM-2b a reload does not drop a member with two communities into the remembered older one', async ({ page }) => {
    test.setTimeout(300_000);
    const me = await person('s2b');
    const stamp = stampId();
    const older = `w7bl-old-${stamp}`;
    const newer = `w7bl-new-${stamp}`;
    await seedCommunity({ groupId: older, displayName: 'Older Community', joinPolicy: 'private', members: [{ uid: me.uid, role: 'member' }] });
    await seedCommunity({ groupId: newer, displayName: 'Newer Community', joinPolicy: 'private', members: [{ uid: me.uid, role: 'member' }] });
    await signInVia(page, me.email, me.password);
    await page.evaluate(({ uid, gid }) => localStorage.setItem(`wsf.currentCommunity.${uid}`, gid), { uid: me.uid, gid: older });
    await openForm(page);
    await toUnconfirmed(page, 'W7 Barless Remembered');
    await page.getByTestId('wsf-start-check-communities').click();
    await expect(page.getByTestId('wsf-home-my-list').last()).toBeVisible({ timeout: 25_000 });
    await page.reload();
    await page.waitForTimeout(2_500);
    expect(new URL(page.url()).pathname, 'the reload opened the remembered older community').toBe('/');
    await expect(page.getByTestId('wsf-home-my-list').last()).toBeVisible({ timeout: 25_000 });
  });

  /**
   * SEAM-2c — BACK AND FORWARD AROUND THE CLICK. The fix for Q2 must not buy
   * the address with history: the click adds exactly one entry, Back returns
   * to the unconfirmed screen the member left (its "Check your communities"
   * still there), and Forward returns to the LIST — not to a bare "/" that
   * opens the remembered older community. History writes are traced.
   */
  test('SEAM-2c after the click, Back returns to the unconfirmed screen and Forward to the list', async ({ page }) => {
    test.setTimeout(300_000);
    await page.addInitScript(() => {
      const w = window as unknown as { __w7hist: string[] };
      w.__w7hist = [];
      for (const m of ['pushState', 'replaceState'] as const) {
        const orig = History.prototype[m];
        History.prototype[m] = function (this: History, ...args: [unknown, string, (string | URL | null)?]) {
          w.__w7hist.push(`${m} ${String(args[2] ?? '')}`);
          return orig.apply(this, args as never);
        };
      }
    });
    const me = await person('s2c');
    const stamp = stampId();
    const older = `w7bl-old-${stamp}`;
    await seedCommunity({ groupId: older, displayName: 'Older Community', joinPolicy: 'private', members: [{ uid: me.uid, role: 'member' }] });
    await seedCommunity({ groupId: `w7bl-new-${stamp}`, displayName: 'Newer Community', joinPolicy: 'private', members: [{ uid: me.uid, role: 'member' }] });
    await signInVia(page, me.email, me.password);
    await page.evaluate(({ uid, gid }) => localStorage.setItem(`wsf.currentCommunity.${uid}`, gid), { uid: me.uid, gid: older });
    await openForm(page);
    await toUnconfirmed(page, 'W7 Barless Back Forward');
    const before = await page.evaluate(() => history.length);
    await page.evaluate(() => {
      (window as unknown as { __w7hist: string[] }).__w7hist.length = 0;
    });
    await page.getByTestId('wsf-start-check-communities').click();
    await expect(page.getByTestId('wsf-home-my-list').last()).toBeVisible({ timeout: 25_000 });
    await page.waitForTimeout(1_500);
    const ops = await page.evaluate(() => (window as unknown as { __w7hist: string[] }).__w7hist);
    test.info().annotations.push({ type: 'history', description: JSON.stringify(ops) });
    expect(await page.evaluate(() => history.length), `the click added other than one entry: ${JSON.stringify(ops)}`).toBe(before + 1);

    await page.goBack();
    await expect(page.getByTestId('wsf-start-check-communities').last()).toBeVisible({ timeout: 20_000 });
    expect(new URL(page.url()).pathname, 'Back did not return to the unconfirmed screen').toBe('/start-community');

    await page.goForward();
    await page.waitForTimeout(2_500);
    expect(new URL(page.url()).pathname, 'Forward opened a community instead of the list').toBe('/');
    expect(new URL(page.url()).search, 'Forward lost the list opt-in').toBe('?view=communities');
    await expect(page.getByTestId('wsf-home-my-list').last()).toBeVisible({ timeout: 20_000 });
  });

  /**
   * SEAM-3 (M4) — THE UNVERIFIED GATE HAS A WAY OUT. Measured on BEFORE: the
   * only reachable control is "Verify email"; the old shell also offered its
   * five tabs. W9's own standard is one explicit way out at a real touch size.
   * PENDING THE DIRECTOR'S RULING — if "Verify email" is ruled sufficient, this
   * test is withdrawn, not weakened.
   */
  test('SEAM-3 the unverified gate offers an in-app way out besides verifying', async ({ page }) => {
    test.setTimeout(240_000);
    const me = await unverifiedPerson('s3');
    await signInLoosely(page, me);
    await page.goto('/start-community');
    await expect(page.getByTestId('wsf-start-unverified')).toBeVisible({ timeout: 25_000 });
    await page.waitForTimeout(800);
    const reachable = await page.evaluate(() => {
      const out: { id: string; href: string | null; h: number }[] = [];
      document.querySelectorAll('a[href], [role="button"], [role="link"], button').forEach((n) => {
        const h = n as HTMLElement;
        const r = h.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!top || !(h === top || h.contains(top))) return;
        let t: HTMLElement | null = h;
        while (t && !t.dataset?.testid) t = t.parentElement;
        out.push({ id: t ? t.dataset.testid! : h.tagName.toLowerCase(), href: h.getAttribute('href'), h: Math.round(r.height) });
      });
      return out;
    });
    test.info().annotations.push({ type: 'reachable', description: JSON.stringify(reachable) });
    // Anchor: the gate really is the gate, with its primary reachable.
    expect(reachable.some((c) => c.id === 'wsf-start-unverified-verify')).toBe(true);
    const others = reachable.filter((c) => c.id !== 'wsf-start-unverified-verify' && c.h >= 44);
    expect(others, 'the only way off the unverified gate is to verify').not.toEqual([]);
  });

  /**
   * SEAM-3n — THE WAY OUT, BY NAME. SEAM-3 accepts any second reachable
   * control; this names it: `wsf-start-unverified-back`, a real touch target
   * hit-tested at its own centre, a link to "/", and pressing it lands Home.
   * Absent on 5c28e45 (W4's own unit test there fails "offers Back to home
   * beside Verify email").
   */
  for (const vp of [{ width: 390, height: 640 }, { width: 390, height: 844 }]) {
    test(`SEAM-3n the unverified gate's way out is "Back to home", pressable, and goes Home @${vp.width}x${vp.height}`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.setViewportSize(vp);
      const me = await unverifiedPerson(`s3n${vp.height}`);
      await signInLoosely(page, me);
      await page.goto('/start-community');
      await expect(page.getByTestId('wsf-start-unverified')).toBeVisible({ timeout: 25_000 });
      const back = page.locator('[data-testid="wsf-start-unverified-back"]:visible').first();
      await expect(back, 'no named way out on the gate').toBeVisible();
      await back.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const probe = await back.evaluate((el) => {
        const r = el.getBoundingClientRect();
        let hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) as HTMLElement | null;
        while (hit && !hit.dataset?.testid) hit = hit.parentElement;
        const link = el.closest('a') ?? (el.tagName === 'A' ? el : null);
        return { h: Math.round(r.height), hit: hit?.dataset.testid ?? '-', href: link?.getAttribute('href') ?? null, text: (el as HTMLElement).innerText.trim() };
      });
      test.info().annotations.push({ type: 'way out', description: JSON.stringify(probe) });
      expect(probe.hit, 'something covers the way out').toBe('wsf-start-unverified-back');
      expect(probe.h, 'the way out is smaller than a touch target').toBeGreaterThanOrEqual(44);
      expect(probe.href, 'the way out is not a link to Home').toBe('/');
      await back.click();
      await expect.poll(() => new URL(page.url()).pathname, { timeout: 20_000 }).toBe('/');
    });
  }

  /**
   * SEAM-4 (M5) — LEAVING MID-CREATE DOES NOT NAVIGATE THE MEMBER AFTERWARDS.
   * Measured on BEFORE and on the old shell: "Back to home" is a push, the form
   * stays mounted, and the late success router.replace()s the member off Home
   * into the new community 4 s later. W4's own comment: "the settled call must
   * not write onto the page they landed on."
   *
   * This is the assertion my check-10 item 8 should have made: it asserted
   * only that the URL was not /start-community, which the yank satisfies.
   */
  test('SEAM-4 leaving by the route\'s own exit mid-create leaves the member where they went', async ({ page }) => {
    test.setTimeout(300_000);
    const me = await person('s4');
    await signInVia(page, me.email, me.password);
    await page.goto('/');
    await expect(page.getByTestId('wsf-home-start').last()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('wsf-home-start').last().click();
    await expect(page.getByTestId('wsf-start-name')).toBeVisible({ timeout: 25_000 });
    let creates = 0;
    const gate: { release: () => void } = { release: () => {} };
    const held = new Promise<void>((r) => {
      gate.release = r;
    });
    await page.route(CREATE, async (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue();
      creates += 1;
      await held;
      await route.continue().catch(() => undefined);
    });
    await page.getByTestId('wsf-start-name').fill('W7 Barless Left Early');
    await page.getByTestId('wsf-start-submit').click();
    await page.waitForTimeout(400);
    await page.getByTestId('wsf-start-back').click();
    await page.waitForURL((u) => u.pathname === '/', { timeout: 20_000 });
    // Home has rendered for a member with no community yet (the create is held).
    // Shell-independent on purpose: waiting for the new shell's top bar made this
    // a fixture failure on the old shell, where there is no top bar.
    await expect(page.getByTestId('wsf-home-start').last()).toBeVisible({ timeout: 20_000 });
    gate.release();
    // Long enough for the create to settle and for W4's 1.5 s navigation grace.
    await page.waitForTimeout(4_000);
    expect(new URL(page.url()).pathname, 'the late success navigated the member after they left').toBe('/');
    expect(creates, 'more than one create left the browser').toBe(1);
    expect(await communitiesOf(me.uid), 'the create did not commit exactly once').toHaveLength(1);
    expect(await visibleCount(page, 'wsf-start-created'), 'a created card is painted on the page the member is on').toBe(0);
  });

  /**
   * SEAM-4 POSITIVE CONTROL — the four assertions can all hold together in this
   * harness. The same journey, but the held create's RESPONSE is lost (the
   * server commits, the page never hears back), so there is no late success to
   * navigate on. Expected: still on `/`, one request, one community, no created
   * card. SEAM-4 has never passed on any build; this shows it is satisfiable.
   */
  test('SEAM-4 CONTROL with no late success to act on, the member stays where they went', async ({ page }) => {
    test.setTimeout(300_000);
    const me = await person('c4');
    await signInVia(page, me.email, me.password);
    await page.goto('/');
    await expect(page.getByTestId('wsf-home-start').last()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('wsf-home-start').last().click();
    await expect(page.getByTestId('wsf-start-name')).toBeVisible({ timeout: 25_000 });
    let creates = 0;
    const gate: { release: () => void } = { release: () => {} };
    const held = new Promise<void>((r) => {
      gate.release = r;
    });
    await page.route(CREATE, async (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue();
      creates += 1;
      await held;
      await route.fetch().catch(() => undefined);
      await route.abort('connectionreset').catch(() => undefined);
    });
    await page.getByTestId('wsf-start-name').fill('W7 Barless Control');
    await page.getByTestId('wsf-start-submit').click();
    await page.waitForTimeout(400);
    await page.getByTestId('wsf-start-back').click();
    await page.waitForURL((u) => u.pathname === '/', { timeout: 20_000 });
    await expect(page.getByTestId('wsf-home-start').last()).toBeVisible({ timeout: 20_000 });
    gate.release();
    await page.waitForTimeout(4_000);
    expect(new URL(page.url()).pathname, 'the control moved the member').toBe('/');
    expect(creates, 'more than one create left the browser').toBe(1);
    expect(await communitiesOf(me.uid), 'the server did not commit exactly once').toHaveLength(1);
    expect(await visibleCount(page, 'wsf-start-created'), 'a created card is painted').toBe(0);
  });
});

/* ════════════════════════════════════════════════════════════════════════ */
/* BARLESS — PASS on BEFORE; FAIL on the old shell; CONTROL proves the eyes  */
/* ════════════════════════════════════════════════════════════════════════ */

type Chrome = { topbar: number; tabs: number; move: number; formMark: number; barMark: number; scrollerBottom: number; innerHeight: number; bandHitsInShell: number };

async function chrome(page: Page): Promise<Chrome> {
  const counts = {
    topbar: await visibleCount(page, 'wsf-member-topbar'),
    tabs: await visibleCount(page, 'wsf-member-tabs'),
    move: await visibleCount(page, 'wsf-member-tab-move'),
    formMark: await visibleCount(page, 'wsf-form-wordmark'),
    barMark: await visibleCount(page, 'wsf-member-topbar-wordmark'),
  };
  const geo = await page.evaluate(() => {
    const mark = Array.from(document.querySelectorAll('[data-testid="wsf-form-wordmark"]')).find((e) => (e as HTMLElement).getBoundingClientRect().height > 0) as HTMLElement | undefined;
    let sc: HTMLElement | null = mark ?? null;
    while (sc && !['auto', 'scroll'].includes(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
    const H = window.innerHeight;
    const W = window.innerWidth;
    let inShell = 0;
    for (const y of [H - 12, H - 40, 12]) {
      for (let i = 1; i <= 9; i += 1) {
        let n = document.elementFromPoint(Math.round((W * i) / 10), y) as HTMLElement | null;
        while (n && !(n.dataset?.testid ?? '').startsWith('wsf-member-')) n = n.parentElement;
        if (n) inShell += 1;
      }
    }
    return { scrollerBottom: sc ? Math.round(sc.getBoundingClientRect().bottom) : -1, innerHeight: H, bandHitsInShell: inShell };
  });
  return { ...counts, ...geo };
}

test.describe('BARLESS', () => {
  test.use({ viewport: PHONE });

  for (const state of ['idle', 'unconfirmed', 'refused-profile', 'unverified'] as const) {
    test(`BARLESS /start-community in the ${state} state wears no member chrome, one masthead, no reservation`, async ({ page }) => {
      test.setTimeout(300_000);
      if (state === 'unverified') {
        const me = await unverifiedPerson('blu');
        await signInLoosely(page, me);
        await page.goto('/start-community');
        await expect(page.getByTestId('wsf-start-unverified')).toBeVisible({ timeout: 25_000 });
      } else {
        const me = await person(`bl${state.slice(0, 3)}`);
        await signInVia(page, me.email, me.password);
        await openForm(page);
        if (state !== 'idle') {
          await page.route(CREATE, async (route: Route) => {
            if (route.request().method() !== 'POST') return route.continue();
            await route.fulfill({
              status: state === 'unconfirmed' ? 500 : 400,
              contentType: 'application/json',
              body: JSON.stringify({ error: { status: state === 'unconfirmed' ? 'INTERNAL' : 'FAILED_PRECONDITION', message: 'x' } }),
            });
          });
          await page.getByTestId('wsf-start-name').fill('W7 Barless State');
          await page.getByTestId('wsf-start-submit').click();
          await expect(page.getByTestId(state === 'unconfirmed' ? 'wsf-start-check-communities' : 'wsf-start-profile')).toBeVisible({ timeout: 25_000 });
        }
      }
      await page.waitForTimeout(600);
      const c = await chrome(page);
      test.info().annotations.push({ type: 'chrome', description: JSON.stringify(c) });
      // Anchor first: the route's own masthead is on screen.
      expect(c.formMark, 'the route has no visible masthead of its own').toBe(1);
      expect(c.topbar, 'a member top bar is visible').toBe(0);
      expect(c.barMark, 'a second (top-bar) masthead is visible').toBe(0);
      expect(c.tabs, 'the member tab bar is visible').toBe(0);
      expect(c.move, 'the raised MOVE control is visible').toBe(0);
      expect(c.bandHitsInShell, 'a tap in the top or bottom band lands on member chrome').toBe(0);
      expect(c.scrollerBottom, 'the screen stops short of the viewport bottom (a reservation)').toBeGreaterThanOrEqual(c.innerHeight - 1);
    });
  }

  /**
   * THE CONTROL: the same instruments, on a FormShell page that IS inside
   * (tabs). If they did not report the top bar, the tab bar, a second
   * masthead and a scroller ending above the bar here, every BARLESS pass
   * above would be meaningless.
   */
  test('CONTROL the instruments see member chrome on a FormShell page inside (tabs)', async ({ page }) => {
    test.setTimeout(240_000);
    const me = await person('ctl');
    const groupId = `w7bl-ctl-${stampId()}`;
    await seedCommunity({ groupId, displayName: 'Control Community', joinPolicy: 'private', members: [{ uid: me.uid, role: 'member' }] });
    await signInVia(page, me.email, me.password);
    await page.goto(`/community/${groupId}/challenge`);
    await expect(page.getByTestId('wsf-challenge-none').last()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    const c = await chrome(page);
    test.info().annotations.push({ type: 'chrome', description: JSON.stringify(c) });
    expect(c.formMark).toBe(1);
    expect(c.topbar, 'the control did not show the top bar — the instrument is blind').toBe(1);
    expect(c.barMark, 'the second masthead was not seen').toBe(1);
    expect(c.tabs, 'the tab bar was not seen').toBe(1);
    expect(c.bandHitsInShell, 'band taps did not land on member chrome').toBeGreaterThan(0);
    expect(c.scrollerBottom, 'the scroller did not end above the bar').toBeLessThan(c.innerHeight - 1);
  });
});

/* ════════════════════════════════════════════════════════════════════════ */
/* FRAMES — read from git objects, decoded in memory                         */
/* ════════════════════════════════════════════════════════════════════════ */

const FRAME_DIR = 'docs/design-target/review/start-community-next/after';
const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

function gitBlob(sha: string, path: string): Buffer {
  return execFileSync('git', ['cat-file', 'blob', `${sha}:${path}`], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });
}
function gitNames(sha: string): string[] {
  return execFileSync('git', ['ls-tree', '--name-only', `${sha}:${FRAME_DIR}`], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

type Img = { w: number; h: number; ch: number; px: Buffer };
function decodePng(buf: Buffer): Img {
  let pos = 8;
  let w = 0;
  let h = 0;
  let depth = 0;
  let ctype = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      depth = body[8];
      ctype = body[9];
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || (ctype !== 2 && ctype !== 6)) throw new Error(`unsupported PNG depth=${depth} type=${ctype}`);
  const ch = ctype === 2 ? 3 : 4;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < h; y += 1) {
    const f = raw[p];
    p += 1;
    const line = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= ch ? line[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      if (f === 1) line[i] = (line[i] + a) & 255;
      else if (f === 2) line[i] = (line[i] + b) & 255;
      else if (f === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    line.copy(out, y * stride);
    prev = line;
  }
  return { w, h, ch, px: out };
}

const near = (img: Img, x: number, y: number, rgb: [number, number, number], tol: number) => {
  const i = (y * img.w + x) * img.ch;
  return Math.abs(img.px[i] - rgb[0]) <= tol && Math.abs(img.px[i + 1] - rgb[1]) <= tol && Math.abs(img.px[i + 2] - rgb[2]) <= tol;
};

/** The old bar's signature: the CARD_BORDER row across the width, or the MOVE disc. */
function showsOldBar(img: Img): boolean {
  const BORDER: [number, number, number] = [227, 231, 225];
  for (let y = Math.floor(img.h / 2); y < img.h; y += 1) {
    const edges = [0, 1, 2, img.w - 3, img.w - 2, img.w - 1].every((x) => near(img, x, y, BORDER, 4));
    if (!edges) continue;
    let n = 0;
    for (let x = 0; x < img.w; x += 1) if (near(img, x, y, BORDER, 4)) n += 1;
    if (n >= img.w * 0.75) return true;
  }
  const GREEN: [number, number, number] = [34, 197, 94];
  const cx = Math.floor(img.w / 2);
  let discRows = 0;
  for (let y = Math.max(0, img.h - 120); y < img.h; y += 1) {
    if (!near(img, cx, y, GREEN, 6)) continue;
    let l = cx;
    let r = cx;
    while (l > 0 && near(img, l - 1, y, GREEN, 6)) l -= 1;
    while (r < img.w - 1 && near(img, r + 1, y, GREEN, 6)) r += 1;
    const run = r - l + 1;
    if (run >= 30 && run <= 62) discRows += 1;
  }
  return discRows >= 20;
}

const CLASSES = ['390x844', '390x640', '430x932'];
const EXPECTED_FRAMES = CLASSES.flatMap((c) => [
  ...['arrival', 'name-too-long', 'unconfirmed', 'gate-signed-out', 'gate-unverified', 'refused-profile'].map((s) => `AFTER-start-${s}-${c}.png`),
  `AFTER-start-unconfirmed-${c}-end.png`,
  `AFTER-start-refused-profile-${c}-end.png`,
]).sort();

test.describe('FRAMES', () => {
  /** The instrument is calibrated on the committed W4 frames before it is trusted. */
  test('FRAMES calibration: the old-bar signature finds exactly the 21 signed-in frames at d467754', () => {
    const names = gitNames('d467754');
    expect(names.sort()).toEqual(EXPECTED_FRAMES);
    const hits = names.filter((n) => showsOldBar(decodePng(gitBlob('d467754', `${FRAME_DIR}/${n}`))));
    const misses = names.filter((n) => !hits.includes(n)).sort();
    expect(hits, 'the calibration did not reproduce 21 bar frames — the instrument is blind').toHaveLength(21);
    expect(misses).toEqual(CLASSES.map((c) => `AFTER-start-gate-signed-out-${c}.png`).sort());
  });

  const DELIVERY = process.env.WSF_W7_DELIVERY_SHA;
  test('FRAMES delivery: 24 frames, right sizes, none showing the old bar, the 21 re-shot', () => {
    test.skip(!DELIVERY, 'set WSF_W7_DELIVERY_SHA to W4\'s delivery — the verification run must report 0 skipped');
    // 063747b9 added one frame of the short-and-blurred state; it is checked
    // on its own below and is not one of the 24.
    const names = gitNames(DELIVERY!).filter((n) => n !== SHORT_BLURRED).sort();
    expect(names).toEqual(EXPECTED_FRAMES);
    for (const n of names) {
      const img = decodePng(gitBlob(DELIVERY!, `${FRAME_DIR}/${n}`));
      const [w, h] = n.match(/(\d+)x(\d+)/)!.slice(1).map(Number);
      expect([img.w, img.h], `${n} is not its class size`).toEqual([w, h]);
      expect(showsOldBar(img), `${n} still shows the old member bar`).toBe(false);
    }
    const reShot = names.filter((n) => !n.includes('gate-signed-out'));
    for (const n of reShot) {
      const a = execFileSync('git', ['rev-parse', `d467754:${FRAME_DIR}/${n}`], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
      const b = execFileSync('git', ['rev-parse', `${DELIVERY}:${FRAME_DIR}/${n}`], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
      expect(b, `${n} was carried, not re-shot`).not.toBe(a);
    }
  });

  /*
    THE SHORT-AND-BLURRED FRAME (W4 `063747b9`, recaptured under the
    Director's neutral-blur ruling `5802873607`). Measured against the
    arrival frame at the same size and SHA: W4 states that every pixel that
    differs lies in the name field's box (x 20-369, y 376-425), so the box
    below has a 2 px margin. The reader counts red-dominant pixels, and
    compares the field's border ring (the box less a 5 px inset, where the
    typed character cannot reach) and everything outside the box.
  */
  test('FRAMES short-blurred calibration: the reader sees 063747b9\'s red border, and the too-long sentence under the field', () => {
    const blurred = decodePng(gitBlob('063747b9', `${FRAME_DIR}/${SHORT_BLURRED}`));
    const arrival = decodePng(gitBlob('063747b9', `${FRAME_DIR}/AFTER-start-arrival-390x844.png`));
    const tooLong = decodePng(gitBlob('063747b9', `${FRAME_DIR}/AFTER-start-name-too-long-390x844.png`));
    const m = {
      blurredBoxRed: redCount(blurred, FIELD_BOX),
      arrivalBoxRed: redCount(arrival, FIELD_BOX),
      blurredBandRed: redCount(blurred, SENTENCE_BAND),
      tooLongBandRed: redCount(tooLong, SENTENCE_BAND),
      ringDiff: ringDiff(blurred, arrival),
      outsideDiff: outsideDiff(blurred, arrival),
    };
    test.info().annotations.push({ type: 'calibration', description: JSON.stringify(m) });
    expect(m.blurredBoxRed, 'the reader cannot see the red border').toBeGreaterThan(500);
    expect(m.ringDiff, 'the ring comparison cannot see the red border').toBeGreaterThan(500);
    expect(m.arrivalBoxRed).toBe(0);
    expect(m.tooLongBandRed, 'the reader cannot see a sentence under the field').toBeGreaterThan(300);
    expect(m.blurredBandRed).toBe(0);
    expect(m.outsideDiff).toBe(0);
  });

  const BLUR_FRAME = process.env.WSF_W7_BLUR_FRAME_SHA;
  test('FRAMES short-blurred delivery: the recaptured frame shows the field as on arrival, with no sentence', () => {
    test.skip(!BLUR_FRAME, 'set WSF_W7_BLUR_FRAME_SHA to the neutral-blur successor — the verification run must report 0 skipped');
    expect(gitNames(BLUR_FRAME!)).toContain(SHORT_BLURRED);
    const img = decodePng(gitBlob(BLUR_FRAME!, `${FRAME_DIR}/${SHORT_BLURRED}`));
    const arrival = decodePng(gitBlob(BLUR_FRAME!, `${FRAME_DIR}/AFTER-start-arrival-390x844.png`));
    expect([img.w, img.h]).toEqual([390, 844]);
    const before = execFileSync('git', ['rev-parse', `063747b9:${FRAME_DIR}/${SHORT_BLURRED}`], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    const now = execFileSync('git', ['rev-parse', `${BLUR_FRAME}:${FRAME_DIR}/${SHORT_BLURRED}`], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    const m = { boxRed: redCount(img, FIELD_BOX), bandRed: redCount(img, SENTENCE_BAND), ringDiff: ringDiff(img, arrival), outsideDiff: outsideDiff(img, arrival), blob: now };
    test.info().annotations.push({ type: 'the recaptured frame', description: JSON.stringify(m) });
    expect(m.boxRed, 'the name field is still painted red').toBe(0);
    expect(m.ringDiff, 'the field border differs from the arrival frame\'s').toBe(0);
    expect(m.bandRed, 'red under the field (a sentence)').toBe(0);
    expect(m.outsideDiff, 'something outside the field differs from the arrival frame (a sentence, or a shift)').toBe(0);
    expect(now, 'the frame was carried from 063747b9, not recaptured').not.toBe(before);
  });
});

const SHORT_BLURRED = 'AFTER-start-name-too-short-blurred-390x844.png';
type Box = { x0: number; y0: number; x1: number; y1: number };
const FIELD_BOX: Box = { x0: 18, y0: 374, x1: 371, y1: 427 };
const SENTENCE_BAND: Box = { x0: 0, y0: 428, x1: 389, y1: 470 };
const TOL = 16;
const differs = (a: Img, b: Img, i: number) =>
  Math.abs(a.px[i] - b.px[i]) > TOL || Math.abs(a.px[i + 1] - b.px[i + 1]) > TOL || Math.abs(a.px[i + 2] - b.px[i + 2]) > TOL;
function redCount(img: Img, box: Box): number {
  let n = 0;
  for (let y = box.y0; y <= box.y1; y += 1)
    for (let x = box.x0; x <= box.x1; x += 1) {
      const i = (y * img.w + x) * img.ch;
      const [r, g, b] = [img.px[i], img.px[i + 1], img.px[i + 2]];
      if (r > 120 && r - g > 60 && r - b > 50) n += 1;
    }
  return n;
}
function ringDiff(a: Img, b: Img, box: Box = FIELD_BOX, inset = 5): number {
  let n = 0;
  for (let y = box.y0; y <= box.y1; y += 1)
    for (let x = box.x0; x <= box.x1; x += 1) {
      if (x >= box.x0 + inset && x <= box.x1 - inset && y >= box.y0 + inset && y <= box.y1 - inset) continue;
      if (differs(a, b, (y * a.w + x) * a.ch)) n += 1;
    }
  return n;
}
function outsideDiff(a: Img, b: Img, box: Box = FIELD_BOX): number {
  let n = 0;
  for (let y = 0; y < a.h; y += 1)
    for (let x = 0; x < a.w; x += 1) {
      if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) continue;
      if (differs(a, b, (y * a.w + x) * a.ch)) n += 1;
    }
  return n;
}
