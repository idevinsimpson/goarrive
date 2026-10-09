/**
 * EXPO-ATTENDEE-HOSTED-DRIVERS-1: the eight EXPO-ATTENDEE-JOURNEY-PROOF-1
 * journeys (#563), driven against the hosted staging site.
 *
 * WHAT IS THE SAME AS THE EMULATOR PROOF. The journeys, their setups, and the
 * screens and controls they use. Every device is its own browser context, so
 * phones, station screens and a shared kiosk share nothing but the server.
 * Seeding is the fixture kit's; the one callable a fixture makes is the
 * Champion's station approval (a Champion task, not an attendee's step); the
 * screen still asks for its own code and claims its own credential.
 *
 * WHAT IS DIFFERENT. The emulator proof also read the store to check what each
 * screen claimed. A hosted driver asserts ONLY what the product renders: every
 * assertion below is read from a page. The two claims that only the store can
 * make (which attempt a station turn is recorded under, and the goal's one
 * uncredited target crossing) are named as exclusions in the manifest, not
 * asserted. The kit's reads of a turn entry and of a station are cleanup
 * provenance, never an assertion. The 45-second no-show is waited out for real;
 * the kiosk's 90 seconds run on the page's own clock.
 *
 * Every assertion is tagged with the manifest row it measures, and every row
 * of each journey is asserted: the owner card prints the manifest's rows.
 */
import { recorder, textWhen, vis } from './helpers.mjs';

export const EXPO_ROWS = Object.freeze({
  'event-use-my-phone': {
    activity: 'the event\'s one activity stands selected and is said back as squats',
    phone: 'Move on my phone opens /contribute/{goalId} with no kiosk Finish control',
    noPlace: 'choosing the phone creates no place in any line',
    receipt: 'the receipt shows the member\'s own amount, and the shared total includes it exactly once',
  },
  'event-join-line': {
    deliberate: 'nothing is in the line until the join button is pressed, and the station still reads Nobody is waiting.',
    joined: 'after joining, the member\'s own queue page opens and the station counts them as a number',
    private: 'the station screen never shows the member\'s account name, the name they chose, or any identifier while they wait',
  },
  'two-station-turns': {
    calls: 'Station 1 calls the first member and Station 2 the second, each by the chosen name and a three-character code, and the two codes differ',
    phones: 'each phone shows its own station\'s code and Go to Station 1. or Go to Station 2., never the other\'s',
    ready: 'a station\'s Start stays disabled until its own called member taps I\'m ready; another member\'s ready does not open it',
    results: 'each station\'s result shows its own code with 20 squats recorded. or 30 squats recorded., and each phone\'s receipt shows its own amount',
    cleared: 'once the result clears, neither station shows any name or code from the finished turns',
  },
  'phone-and-stations-converge': {
    stations: 'both station screens settle on 105 of 100 squats, 100% complete, 5 beyond our goal · still open',
    phone: 'the phone, read fresh, shows the same shared total of 105',
    once: 'each of the three is recorded once: the settled total is exactly the seeded 40 plus 15, 20 and 30, and each device shows only its own amount',
  },
  'station-lost-answer': {
    kept: 'the station keeps the same turn and the same count available to try again',
    same: 'the second press reports the same 25 squats recorded. and adds nothing',
    once: 'the shared total rises by 25 exactly once',
    phone: 'while offline the phone claims no result; once reconnected it shows 25 squats recorded.',
  },
  'line-place-ends': {
    switched: 'Switch to my phone opens the contribution screen for the same activity and the station stops counting them',
    noShow: 'the unanswered call ends with Your turn timed out on the member\'s phone and an empty station',
    letGo: 'Let them go returns the third member to You\'re not in the line with no receipt',
    onlyTen: 'only the switched member\'s 10 is recorded; neither of the other two records anything',
  },
  'closed-goal-turn': {
    refused: 'recording the turn started before the closure: Station 1 prints This goal is closed.',
    nothing: 'nothing is recorded and neither event\'s shared total moves',
    noReceipt: 'no member\'s phone shows a receipt',
    start: 'Start their turn is refused: Station 2 prints This goal is closed., shows no count to record and still serves the same member',
    ready: 'I\'m ready is refused: the called member\'s phone prints This goal is closed. and still shows them called to the second event\'s Station 1',
    call: 'Call next is refused: the second event\'s idle Station 2 prints This goal is closed. and serves nobody, and the waiting member\'s phone still shows them in the line',
    join: 'joining is refused: the event page prints This goal is closed., the member does not reach the queue page, and the hall\'s waiting count does not change',
  },
  'shared-screen-finish': {
    finish: 'after Finish the screen is back at its start, signed out, with no previous person\'s name, email, own credit, receipt or pending record',
    next: 'the next person starts at the sign-in gate and their own credit reads zero, while the shared total keeps both people\'s contributions',
    countdown: 'left untouched, the countdown performs the same Finish and Stay puts it back',
  },
  'unverified-participant': {
    signin: 'signing in, the unverified account is taken to its profile step, not held at a verification page',
    profile: 'the profile step offers the unverified account its name form, and Save profile moves on',
    marker: 'the approved marker offers Join Fixture Open Community, and joining shows How will you take part?',
    link: 'the community\'s join link then opens the same community for the member',
    contribute: 'Move on my phone records 15: Your total on this goal: 15 squats, and the shared total of 115 counts it once',
    history: 'Your progress lists the goal with YOURS 15 squats',
    fresh: 'in a fresh browser with nothing stored, signing in again reaches the same member, whose progress still reads YOURS 15 squats',
    round: 'a new round of 10 is accepted: Your total on this goal: 25 squats, and a shared total of 125',
    control: 'a verified account with no profile, on the same path, lands on its profile step, saves it, joins by the marker and records its own 5',
  },
});

const PHONE = { width: 390, height: 844 };
const SCREEN = { width: 1280, height: 720 };
const TABLET = { width: 800, height: 1280 };
const TURN_CODE = /^[A-HJ-NP-Z2-9]{3}$/;
const NO_SHOW = 'The screen called you and the 45 seconds ran out, so it moved on. Get back in line and it will call you again.';
const LEASE_LEFT = /^\d+s to say you’re coming$/;
const KIOSK_IDLE_MS = 90_000;

// ---- page reads ---------------------------------------------------------------------
async function until(page, check, timeout = 30_000) {
  for (let tries = Math.ceil(timeout / 500); tries > 0; tries -= 1) {
    try { if (await check()) return true; } catch { /* re-rendering; poll again */ }
    await page.waitForTimeout(500);
  }
  return false;
}
const present = async (page, id) => (await vis(page, id).count()) > 0;
const shown = (page, id, timeout) => until(page, () => present(page, id), timeout);
const absent = (page, id, timeout) => until(page, async () => !(await present(page, id)), timeout);
const enabled = (page, id, timeout) => until(page, async () => (await present(page, id)) && !(await vis(page, id).isDisabled()), timeout);
async function isDisabled(page, id) { return (await present(page, id)) && vis(page, id).isDisabled(); }
/** Press a control if the page is showing it; a missing control is reported by the row that needed it, never thrown past. */
async function tap(page, id) { if (!(await present(page, id))) return false; await vis(page, id).click(); return true; }
async function type(page, id, value) { if (!(await present(page, id))) return false; await vis(page, id).fill(value); return true; }
/** What a control says at this instant, or null when the page is not showing it. */
async function textNow(page, id) {
  if (!(await present(page, id))) return null;
  return ((await vis(page, id).innerText({ timeout: 2_000 })) || '').replace(/\s+/g, ' ').trim();
}
const hallText = async (page) => `${await page.evaluate(() => document.body.innerText)}\n${await page.content()}`;
const pathOf = (page) => new URL(page.url()).pathname;
const countOf = (text) => Number(/(\d[\d,]*)/.exec(text || '')?.[1]?.replace(/,/g, '') ?? NaN);

// ---- devices --------------------------------------------------------------------------
/** Each device is its own context: phones and screens share nothing but the server. */
function devices(page) {
  const opened = [];
  return {
    async open(viewport) {
      const context = await page.context().browser().newContext({ viewport, locale: 'en-US' });
      opened.push(context);
      return { context, page: await context.newPage() };
    },
    closeAll: () => Promise.all(opened.map((c) => c.close().catch(() => {}))),
  };
}
async function openPhone(dev, fixtures, baseUrl, account) {
  const d = await dev.open(PHONE);
  await fixtures.signIn(d.page, baseUrl, account);
  return d;
}
/** A station screen enrols the real way: it shows its own code and the Champion approves that code. */
async function openStation(dev, fixtures, baseUrl, ev, slot) {
  const d = await dev.open(SCREEN);
  await d.page.goto(`${baseUrl}/station/${ev.goalId}`);
  const code = await textWhen(d.page, 'wsf-station-pairing-code', (t) => /^[A-Z0-9]{6}$/.test(t.replace(/\s+/g, '')), 60_000);
  if (!code) throw new Error(`station ${slot} showed no pairing code`);
  await fixtures.approveStation(ev, code.replace(/\s+/g, ''), slot);
  if (!(await shown(d.page, 'wsf-station-queue-count', 60_000))) throw new Error(`station ${slot} did not enrol`);
  return { ...d, label: `Station ${slot}` };
}
/** The event page, answered as a phone, up to the member view. */
async function openEvent(phone, baseUrl, ev) {
  await phone.goto(`${baseUrl}/event/${ev.goalId}`);
  await until(phone, async () => (await present(phone, 'wsf-device-choice-personal')) || (await present(phone, 'wsf-event-member')), 40_000);
  if (await present(phone, 'wsf-device-choice-personal')) await tap(phone, 'wsf-device-choice-personal');
  if (!(await shown(phone, 'wsf-event-member', 40_000))) throw new Error('the event page did not reach the member view');
}
/** The deliberate path into the line: Use a kiosk, a chosen name, the one join tap. */
async function joinLine(phone, baseUrl, fixtures, ev, member, calledName) {
  await openEvent(phone, baseUrl, ev);
  await tap(phone, 'wsf-event-queue-start');
  if (!(await shown(phone, 'wsf-event-queue-name', 15_000))) throw new Error('the name control did not open');
  await type(phone, 'wsf-event-queue-name', calledName);
  await tap(phone, 'wsf-event-queue-join');
  if (!(await until(phone, async () => pathOf(phone) === `/queue/${ev.goalId}` && (await present(phone, 'wsf-queue-screen')), 30_000))) {
    throw new Error('joining did not open the member\'s own queue page');
  }
  return fixtures.trackPlace(ev, member);
}
async function callNext(station, name) {
  await tap(station, 'wsf-station-call-next');
  const serving = await textWhen(station, 'wsf-station-queue-serving', (t) => t === name, 25_000);
  const code = await textWhen(station, 'wsf-station-queue-code', (t) => TURN_CODE.test(t), 10_000);
  return { serving, code };
}
async function startTurn(station) {
  await tap(station, 'wsf-station-turn-action');
  return shown(station, 'wsf-station-turn-record', 25_000);
}
/** A setup step that did not happen ends the journey, named; it is never passed over. */
function need(ok, why) {
  if (!ok) throw new Error(why);
}
/**
 * The member answers the call on their own phone. I'm ready is pressed only
 * once the phone SHOWS the call: pressed earlier it is not on the page, the tap
 * does nothing, and the station can never open Start (run 37912780869).
 */
async function sayReady(phone, name) {
  need(await shown(phone, 'wsf-queue-ready', 25_000), `${name}'s phone never showed the call, so I'm ready was never offered`);
  need(await tap(phone, 'wsf-queue-ready'), `${name}'s phone could not press I'm ready`);
}
/** Ready on the phone, then Start at the station; each step is required, by name. */
async function readyThenStart(phone, station, where, name) {
  await sayReady(phone, name);
  need(await enabled(station, 'wsf-station-turn-action', 25_000), `${where} never offered Start their turn after ${name} said ready`);
  need(await startTurn(station), `${where} pressed Start their turn and no turn began`);
}
/** A phone records `count` on its contribution screen; its attempt is tracked as the request leaves. */
async function recordOnPhone(phone, fixtures, ev, member, count) {
  const onRequest = (req) => {
    if (!/\/wsfContribute$/.test(new URL(req.url()).pathname)) return;
    try { fixtures.trackContribution(ev, member, JSON.parse(req.postData() || '{}')?.data?.attemptId); } catch { /* the receipt check fails instead */ }
  };
  phone.on('request', onRequest);
  try {
    await type(phone, 'wsf-contribute-entry', String(count));
    await tap(phone, 'wsf-contribute-review');
    await shown(phone, 'wsf-contribute-submit', 15_000);
    await tap(phone, 'wsf-contribute-submit');
    return await shown(phone, 'wsf-contribute-receipt', 30_000);
  } finally {
    phone.off('request', onRequest);
  }
}
const result = (r, fx) => ({ setupId: fx.setupId, actionsPerformed: r.actionsPerformed, assertions: r.assertions });
function tagged(r, rows) {
  return (key) => (ok, seen) => r.expect(`[${key}] ${rows[key]}`, ok, seen);
}

// ---- 1. event-use-my-phone ----------------------------------------------------------------
async function eventUseMyPhone({ page, baseUrl, fixtures }) {
  const r = recorder();
  const row = tagged(r, EXPO_ROWS['event-use-my-phone']);
  const ev = await fixtures.expoEvent('phone', { attendees: 1, target: 1000, seeded: 100 });
  const [member] = ev.attendees;
  const dev = devices(page);
  try {
    const station = await openStation(dev, fixtures, baseUrl, ev, 1);
    r.did('enrolled one station screen as Station 1 to watch the line');
    const phone = (await openPhone(dev, fixtures, baseUrl, member)).page;
    r.did('signed in on the member\'s own phone');
    await openEvent(phone, baseUrl, ev);
    r.did('opened the event page and answered My own phone');
    const activity = await textWhen(phone, 'wsf-event-choice-activity', (t) => t === 'squats');
    row('activity')(activity === 'squats', activity);
    const label = await textWhen(phone, 'wsf-event-add', (t) => t === 'Move on my phone');
    await tap(phone, 'wsf-event-add');
    r.did('pressed Move on my phone');
    const onEntry = await until(phone, async () => pathOf(phone) === `/contribute/${ev.goalId}` && (await present(phone, 'wsf-contribute-entry-screen')), 40_000);
    const noFinish = !(await present(phone, 'wsf-kiosk-finish'));
    row('phone')(label === 'Move on my phone' && onEntry && noFinish, `${label}; ${pathOf(phone)}; kiosk Finish ${noFinish ? 'absent' : 'present'}`);
    await page.waitForTimeout(6_000); // three of the hall's two-second polls
    const before = await textWhen(station.page, 'wsf-station-queue-count', (t) => t === 'Nobody is waiting.');
    const recorded = await recordOnPhone(phone, fixtures, ev, member, 15);
    r.did('entered 15, pressed Review, then Record');
    const after = await textWhen(station.page, 'wsf-station-queue-count', (t) => t === 'Nobody is waiting.');
    row('noPlace')(before === 'Nobody is waiting.' && after === 'Nobody is waiting.', `${before} / ${after}`);
    const amount = await textWhen(phone, 'wsf-contribute-result-amount', (t) => /\b15\b/.test(t));
    const shared = await textWhen(phone, 'wsf-contribute-shared-total', (t) => countOf(t) === 115);
    row('receipt')(recorded && /\b15\b/.test(amount || '') && countOf(shared) === 115, `${amount}; ${shared}`);
  } finally {
    await dev.closeAll();
  }
  return result(r, ev);
}

// ---- 2. event-join-line -------------------------------------------------------------------
async function eventJoinLine({ page, baseUrl, fixtures }) {
  const r = recorder();
  const row = tagged(r, EXPO_ROWS['event-join-line']);
  const ev = await fixtures.expoEvent('join', { attendees: 1, target: 1000, seeded: 0 });
  const [member] = ev.attendees;
  const chosen = 'Fixture Q';
  const dev = devices(page);
  try {
    const station = (await openStation(dev, fixtures, baseUrl, ev, 1)).page;
    const phone = (await openPhone(dev, fixtures, baseUrl, member)).page;
    await openEvent(phone, baseUrl, ev);
    r.did('opened the event page and answered My own phone');
    const label = await textWhen(phone, 'wsf-event-queue-start', (t) => t === 'Use a kiosk');
    await tap(phone, 'wsf-event-queue-start');
    const boxOpen = await shown(phone, 'wsf-event-queue-name', 15_000);
    r.did('pressed Use a kiosk and left the name box open without joining');
    await page.waitForTimeout(6_000);
    const waiting = await textWhen(station, 'wsf-station-queue-count', (t) => t === 'Nobody is waiting.');
    row('deliberate')(label === 'Use a kiosk' && boxOpen && waiting === 'Nobody is waiting.', `${label}; ${waiting}`);
    await type(phone, 'wsf-event-queue-name', chosen);
    await tap(phone, 'wsf-event-queue-join');
    r.did('typed the name the screen should use and pressed the join button');
    const own = await until(phone, async () => pathOf(phone) === `/queue/${ev.goalId}` && (await present(phone, 'wsf-queue-screen')), 30_000);
    await fixtures.trackPlace(ev, member);
    const counted = await textWhen(station, 'wsf-station-queue-count', (t) => t === '1 person waiting.', 25_000);
    row('joined')(own && counted === '1 person waiting.', `${pathOf(phone)}; ${counted}`);
    const seen = await hallText(station);
    const leaked = [chosen, 'Fixture Attendee 1', member.uid, member.email].filter((s) => seen.includes(s));
    row('private')(leaked.length === 0, leaked.length ? `the hall carried ${leaked.length} identifying value(s)` : 'nothing identifying');
  } finally {
    await dev.closeAll();
  }
  return result(r, ev);
}

// ---- 3. two-station-turns -----------------------------------------------------------------
async function twoStationTurns({ page, baseUrl, fixtures }) {
  const r = recorder();
  const row = tagged(r, EXPO_ROWS['two-station-turns']);
  const ev = await fixtures.expoEvent('turns', { attendees: 2, target: 1000, seeded: 0 });
  const [first, second] = ev.attendees;
  const dev = devices(page);
  try {
    const s1 = (await openStation(dev, fixtures, baseUrl, ev, 1)).page;
    const s2 = (await openStation(dev, fixtures, baseUrl, ev, 2)).page;
    const p1 = (await openPhone(dev, fixtures, baseUrl, first)).page;
    const p2 = (await openPhone(dev, fixtures, baseUrl, second)).page;
    const e1 = await joinLine(p1, baseUrl, fixtures, ev, first, 'Fixture B');
    const e2 = await joinLine(p2, baseUrl, fixtures, ev, second, 'Fixture C');
    r.did('two members joined the line from their own phones, in order');
    await textWhen(s2, 'wsf-station-queue-count', (t) => t === '2 people waiting.', 25_000);
    const c1 = await callNext(s1, 'Fixture B');
    r.did('pressed Call next on Station 1');
    const c2 = await callNext(s2, 'Fixture C');
    r.did('pressed Call next on Station 2');
    row('calls')(c1.serving === 'Fixture B' && c2.serving === 'Fixture C' && TURN_CODE.test(c1.code || '') && TURN_CODE.test(c2.code || '') && c1.code !== c2.code,
      `${c1.serving} ${c1.code} / ${c2.serving} ${c2.code}`);
    const code1 = await textWhen(p1, 'wsf-queue-code', (t) => t === c1.code, 25_000);
    const where1 = await textWhen(p1, 'wsf-queue-station', (t) => t === 'Go to Station 1.', 25_000);
    const code2 = await textWhen(p2, 'wsf-queue-code', (t) => t === c2.code, 25_000);
    const where2 = await textWhen(p2, 'wsf-queue-station', (t) => t === 'Go to Station 2.', 25_000);
    row('phones')(code1 === c1.code && where1 === 'Go to Station 1.' && code2 === c2.code && where2 === 'Go to Station 2.', `${code1} ${where1} / ${code2} ${where2}`);
    const bothShut = (await isDisabled(s1, 'wsf-station-turn-action')) && (await isDisabled(s2, 'wsf-station-turn-action'));
    await tap(p2, 'wsf-queue-ready');
    r.did('pressed I\'m ready on the second member\'s phone');
    const s2Open = await enabled(s2, 'wsf-station-turn-action', 25_000);
    await page.waitForTimeout(4_000);
    const s1StillShut = await isDisabled(s1, 'wsf-station-turn-action');
    await tap(p1, 'wsf-queue-ready');
    r.did('pressed I\'m ready on the first member\'s phone');
    const s1Open = await enabled(s1, 'wsf-station-turn-action', 25_000);
    row('ready')(bothShut && s2Open && s1StillShut && s1Open, `both shut ${bothShut}; Station 2 opened ${s2Open}; Station 1 still shut ${s1StillShut}; Station 1 opened ${s1Open}`);
    await startTurn(s1);
    await startTurn(s2);
    r.did('pressed Start their turn on both stations');
    await fixtures.trackStationTurn(ev, first, e1);
    await fixtures.trackStationTurn(ev, second, e2);
    await type(s1, 'wsf-station-turn-count', '20');
    await type(s2, 'wsf-station-turn-count', '30');
    await tap(s1, 'wsf-station-turn-action');
    await tap(s2, 'wsf-station-turn-action');
    r.did('entered 20 on Station 1 and 30 on Station 2 and recorded both');
    const res1 = await textWhen(s1, 'wsf-station-queue-result', (t) => t.includes(c1.code) && t.includes('20 squats recorded.'), 25_000);
    const res2 = await textWhen(s2, 'wsf-station-queue-result', (t) => t.includes(c2.code) && t.includes('30 squats recorded.'), 25_000);
    const rc1 = await textWhen(p1, 'wsf-queue-receipt-amount', (t) => t === '20 squats recorded.', 30_000);
    const rc2 = await textWhen(p2, 'wsf-queue-receipt-amount', (t) => t === '30 squats recorded.', 30_000);
    row('results')(Boolean(res1?.includes(c1.code) && res1.includes('20 squats recorded.') && res2?.includes(c2.code) && res2.includes('30 squats recorded.'))
      && rc1 === '20 squats recorded.' && rc2 === '30 squats recorded.', `${res1} / ${res2} / ${rc1} / ${rc2}`);
    let clean = true;
    for (const s of [s1, s2]) {
      const gone = (await absent(s, 'wsf-station-queue-result', 30_000)) && (await shown(s, 'wsf-station-queue-serving-empty', 25_000));
      const text = await hallText(s);
      clean &&= gone && ![c1.code, c2.code, 'Fixture B', 'Fixture C', first.uid, second.uid].some((v) => text.includes(v));
    }
    row('cleared')(clean, clean ? 'both halls empty' : 'a finished turn was still on a station');
  } finally {
    await dev.closeAll();
  }
  return result(r, ev);
}

// ---- 4. phone-and-stations-converge -------------------------------------------------------
async function phoneAndStationsConverge({ page, baseUrl, fixtures }) {
  const r = recorder();
  const row = tagged(r, EXPO_ROWS['phone-and-stations-converge']);
  const ev = await fixtures.expoEvent('converge', { attendees: 3, target: 100, seeded: 40 });
  const [onPhone, atOne, atTwo] = ev.attendees;
  const dev = devices(page);
  try {
    const s1 = (await openStation(dev, fixtures, baseUrl, ev, 1)).page;
    const s2 = (await openStation(dev, fixtures, baseUrl, ev, 2)).page;
    const pA = (await openPhone(dev, fixtures, baseUrl, onPhone)).page;
    const pB = (await openPhone(dev, fixtures, baseUrl, atOne)).page;
    const pC = (await openPhone(dev, fixtures, baseUrl, atTwo)).page;
    const eB = await joinLine(pB, baseUrl, fixtures, ev, atOne, 'Fixture B');
    const eC = await joinLine(pC, baseUrl, fixtures, ev, atTwo, 'Fixture C');
    const c1 = await callNext(s1, 'Fixture B');
    need(c1.serving === 'Fixture B', `Station 1 called ${c1.serving ?? 'nobody'}, not Fixture B`);
    const c2 = await callNext(s2, 'Fixture C');
    need(c2.serving === 'Fixture C', `Station 2 called ${c2.serving ?? 'nobody'}, not Fixture C`);
    await readyThenStart(pB, s1, 'Station 1', 'Fixture B');
    await readyThenStart(pC, s2, 'Station 2', 'Fixture C');
    await fixtures.trackStationTurn(ev, atOne, eB);
    await fixtures.trackStationTurn(ev, atTwo, eC);
    r.did('two members mid-turn at Station 1 and Station 2');
    await openEvent(pA, baseUrl, ev);
    await tap(pA, 'wsf-event-add');
    await shown(pA, 'wsf-contribute-entry-screen', 40_000);
    r.did('one member on Move on my phone');
    let attempt = null;
    pA.on('request', (req) => {
      if (/\/wsfContribute$/.test(new URL(req.url()).pathname)) {
        try { attempt = JSON.parse(req.postData() || '{}')?.data?.attemptId; fixtures.trackContribution(ev, onPhone, attempt); } catch { /* the receipt check fails instead */ }
      }
    });
    await type(pA, 'wsf-contribute-entry', '15');
    await tap(pA, 'wsf-contribute-review');
    await shown(pA, 'wsf-contribute-submit', 15_000);
    await type(s1, 'wsf-station-turn-count', '20');
    await type(s2, 'wsf-station-turn-count', '30');
    await Promise.all([tap(pA, 'wsf-contribute-submit'), tap(s1, 'wsf-station-turn-action'), tap(s2, 'wsf-station-turn-action')]);
    r.did('recorded 15 on the phone, 20 at Station 1 and 30 at Station 2 at the same moment');
    const settled = [];
    for (const s of [s1, s2]) {
      const line = await textWhen(s, 'wsf-station-total-line', (t) => t === '105 of 100 squats', 30_000);
      const pct = await textWhen(s, 'wsf-station-percent', (t) => t === '100% complete');
      const status = await textWhen(s, 'wsf-station-status', (t) => t === '5 beyond our goal · still open');
      settled.push([line, pct, status]);
    }
    row('stations')(settled.every(([l, p, s]) => l === '105 of 100 squats' && p === '100% complete' && s === '5 beyond our goal · still open'), settled.map((x) => x.join(', ')).join(' / '));
    const own = await textWhen(pA, 'wsf-contribute-result-amount', (t) => /\b15\b/.test(t), 30_000);
    const res1 = await textWhen(s1, 'wsf-station-queue-result', (t) => t.includes('20 squats recorded.'), 25_000);
    const res2 = await textWhen(s2, 'wsf-station-queue-result', (t) => t.includes('30 squats recorded.'), 25_000);
    const rB = await textWhen(pB, 'wsf-queue-receipt-amount', (t) => t === '20 squats recorded.', 30_000);
    const rC = await textWhen(pC, 'wsf-queue-receipt-amount', (t) => t === '30 squats recorded.', 30_000);
    await pA.goto(`${baseUrl}/contribute/${ev.goalId}`);
    r.did('read the phone fresh');
    const fresh = await textWhen(pA, 'wsf-contribute-shared-total', (t) => countOf(t) === 105, 30_000);
    row('phone')(countOf(fresh) === 105, fresh);
    row('once')(/\b15\b/.test(own || '') && Boolean(res1?.includes(c1.code)) && Boolean(res2?.includes(c2.code))
      && rB === '20 squats recorded.' && rC === '30 squats recorded.' && settled.every(([l]) => l === '105 of 100 squats') && countOf(fresh) === 105,
    `${own} / ${res1} / ${res2} / ${rB} / ${rC}`);
  } finally {
    await dev.closeAll();
  }
  return result(r, ev);
}

// ---- 5. station-lost-answer ---------------------------------------------------------------
async function stationLostAnswer({ page, baseUrl, fixtures }) {
  const r = recorder();
  const row = tagged(r, EXPO_ROWS['station-lost-answer']);
  const ev = await fixtures.expoEvent('lost', { attendees: 1, target: 1000, seeded: 100 });
  const [member] = ev.attendees;
  const dev = devices(page);
  try {
    const station = (await openStation(dev, fixtures, baseUrl, ev, 1)).page;
    const phoneDevice = await openPhone(dev, fixtures, baseUrl, member);
    const phone = phoneDevice.page;
    const entry = await joinLine(phone, baseUrl, fixtures, ev, member, 'Fixture R');
    const call = await callNext(station, 'Fixture R');
    need(call.serving === 'Fixture R', `Station 1 called ${call.serving ?? 'nobody'}, not Fixture R`);
    await readyThenStart(phone, station, 'Station 1', 'Fixture R');
    await fixtures.trackStationTurn(ev, member, entry);
    r.did('one member mid-turn at Station 1 after tapping I\'m ready');
    await phoneDevice.context.setOffline(true);
    r.did('the member\'s phone lost its connection');
    // The hall's network drops: its polls fail, and its FIRST Record reaches the
    // server but the answer never comes back.
    await station.route('**/wsfTurnState', (route) => route.abort('internetdisconnected'));
    let completes = 0;
    await station.route('**/wsfCompleteTurn', async (route) => {
      completes += 1;
      if (completes === 1) { await route.fetch(); await route.abort('connectionreset'); return; }
      await route.continue();
    });
    await type(station, 'wsf-station-turn-count', '25');
    await tap(station, 'wsf-station-turn-action');
    r.did('entered 25 and recorded while the station\'s answer was lost');
    const told = await shown(station, 'wsf-station-queue-error', 25_000);
    const keptCount = (await present(station, 'wsf-station-turn-count')) ? await vis(station, 'wsf-station-turn-count').inputValue() : null;
    const keptTurn = await present(station, 'wsf-station-turn-record');
    row('kept')(told && keptCount === '25' && keptTurn, `error shown ${told}; count ${keptCount}; turn ${keptTurn ? 'kept' : 'gone'}`);
    await page.waitForTimeout(4_000);
    const offlineClaim = await present(phone, 'wsf-queue-receipt-amount');
    await tap(station, 'wsf-station-turn-action');
    r.did('pressed record again once');
    const again = await textWhen(station, 'wsf-station-queue-result', (t) => t.includes('25 squats recorded.'), 25_000);
    await station.unroute('**/wsfTurnState');
    const total = await textWhen(station, 'wsf-station-total-line', (t) => t === '125 of 1,000 squats', 30_000);
    row('same')(Boolean(again?.includes('25 squats recorded.')) && completes === 2 && total === '125 of 1,000 squats', `${again}; ${completes} completions sent; ${total}`);
    row('once')(total === '125 of 1,000 squats', total);
    await phoneDevice.context.setOffline(false);
    r.did('reconnected the phone');
    const back = await textWhen(phone, 'wsf-queue-receipt-amount', (t) => t === '25 squats recorded.', 40_000);
    row('phone')(!offlineClaim && back === '25 squats recorded.', `offline: ${offlineClaim ? 'claimed a result' : 'no result'}; reconnected: ${back}`);
  } finally {
    await dev.closeAll();
  }
  return result(r, ev);
}

// ---- 6. line-place-ends -------------------------------------------------------------------
async function linePlaceEnds({ page, baseUrl, fixtures }) {
  const r = recorder();
  const row = tagged(r, EXPO_ROWS['line-place-ends']);
  const ev = await fixtures.expoEvent('ends', { attendees: 3, target: 1000, seeded: 0 });
  const [switcher, absentee, released] = ev.attendees;
  const dev = devices(page);
  try {
    const station = (await openStation(dev, fixtures, baseUrl, ev, 1)).page;
    const pS = (await openPhone(dev, fixtures, baseUrl, switcher)).page;
    const pN = (await openPhone(dev, fixtures, baseUrl, absentee)).page;
    const pR = (await openPhone(dev, fixtures, baseUrl, released)).page;

    await joinLine(pS, baseUrl, fixtures, ev, switcher, 'Fixture S');
    const one = await textWhen(station, 'wsf-station-queue-count', (t) => t === '1 person waiting.', 25_000);
    await tap(pS, 'wsf-queue-switch-to-phone');
    r.did('first member pressed Switch to my phone');
    const onPhone = await until(pS, async () => pathOf(pS) === `/contribute/${ev.goalId}` && (await present(pS, 'wsf-contribute-screen')), 30_000);
    const none = await textWhen(station, 'wsf-station-queue-count', (t) => t === 'Nobody is waiting.', 25_000);
    row('switched')(one === '1 person waiting.' && onPhone && none === 'Nobody is waiting.', `${one}; ${pathOf(pS)}; ${none}`);
    await shown(pS, 'wsf-contribute-entry-screen', 30_000);
    const tenRecorded = await recordOnPhone(pS, fixtures, ev, switcher, 10);
    r.did('recorded 10 on that phone');

    await joinLine(pN, baseUrl, fixtures, ev, absentee, 'Fixture N');
    await callNext(station, 'Fixture N');
    const called = await shown(pN, 'wsf-queue-called', 25_000);
    r.did('second member was called and did not answer');
    // The real 45-second lease, on the hosted clock, WATCHED rather than slept
    // through. The phone says Your turn timed out for one poll only: its next
    // read (TURN_POLL_MS = 3_000, app/queue/[goalId].tsx at ec162d17) finds the
    // place still gone and drops the notice. A single read after a 47-second
    // sleep lands in or after that window by chance (run 37912780869).
    //
    // The lease is read off the phone's own countdown (wsf-queue-lease, which
    // the server computes from the lease on every 1-second poll): first seen,
    // it stands at the full 45 seconds less at most one waiting poll and its
    // round trips; it is then watched down to its last seconds with the call
    // still standing, and only then may the notice come. A call that ends
    // early, or one offered for longer, fails the row.
    const offeredFor = countOf(await textWhen(pN, 'wsf-queue-lease', (t) => LEASE_LEFT.test(t), 5_000));
    const lastSeconds = countOf(await textWhen(pN, 'wsf-queue-lease', (t) => LEASE_LEFT.test(t) && countOf(t) <= 3, 50_000));
    const stood = offeredFor >= 40 && offeredFor <= 45 && lastSeconds <= 3;
    let reason = null;
    let heading = null;
    const timedOut = stood && (await until(pN, async () => {
      reason = await textNow(pN, 'wsf-queue-not-in-line-reason');
      heading = await textNow(pN, 'wsf-queue-standing');
      return reason === NO_SHOW && Boolean(heading?.includes('Your turn timed out'));
    }, 15_000));
    const empty = (await shown(station, 'wsf-station-queue-serving-empty', 25_000)) && !(await present(station, 'wsf-station-turn-action'));
    row('noShow')(called && stood && timedOut && empty,
      `${stood ? reason : `the call was offered for ${offeredFor}s and was last seen at ${lastSeconds}s`}; station ${empty ? 'empty' : 'still serving'}`);

    await joinLine(pR, baseUrl, fixtures, ev, released, 'Fixture L');
    // Each step toward Let them go is part of the row: a step that did not happen
    // fails the row by name, never silently (run 37912780869).
    const callL = await callNext(station, 'Fixture L');
    const calledL = callL.serving === 'Fixture L';
    const offered = calledL && (await shown(pR, 'wsf-queue-ready', 25_000));
    const said = offered && (await tap(pR, 'wsf-queue-ready'));
    const opened = said && (await enabled(station, 'wsf-station-turn-action', 25_000));
    const letGo = opened && (await enabled(station, 'wsf-station-turn-cancel', 10_000)) && (await tap(station, 'wsf-station-turn-cancel'));
    const missed = !calledL ? `the station called ${callL.serving ?? 'nobody'}, not Fixture L`
      : !offered ? 'Fixture L\'s phone never showed the call'
        : !said ? 'Fixture L\'s phone could not press I\'m ready'
          : !opened ? 'the station never offered Start their turn after Fixture L said ready'
            : !letGo ? 'the station never offered Let them go' : null;
    r.did(letGo ? 'third member tapped I\'m ready; the station pressed Let them go' : `stopped before Let them go: ${missed}`);
    const stationEmpty = letGo && (await shown(station, 'wsf-station-queue-serving-empty', 25_000));
    const out = letGo && (await shown(pR, 'wsf-queue-not-in-line', 30_000));
    const standing = letGo ? await textWhen(pR, 'wsf-queue-standing', (t) => t.includes('You’re not in the line'), 10_000) : null;
    const noReceipt = !(await present(pR, 'wsf-queue-receipt-amount'));
    row('letGo')(letGo && stationEmpty && out && Boolean(standing?.includes('You’re not in the line')) && noReceipt,
      missed ?? `${standing}; receipt ${noReceipt ? 'none' : 'shown'}`);

    const total = await textWhen(station, 'wsf-station-total-line', (t) => t === '10 of 1,000 squats', 30_000);
    const quiet = !(await present(pN, 'wsf-queue-receipt-amount')) && noReceipt;
    row('onlyTen')(tenRecorded && total === '10 of 1,000 squats' && quiet, `${total}; others ${quiet ? 'recorded nothing' : 'show a receipt'}`);
  } finally {
    await dev.closeAll();
  }
  return result(r, ev);
}

// ---- 7. closed-goal-turn ------------------------------------------------------------------
/*
 * EXPO-CLOSED-GOAL-QUEUE-GATE-1 (#571): a closed goal refuses join, call, ready
 * and start before anything advances, in the contribute path's own sentence,
 * and a refusal leaves the place as it was. Every window is set up BEFORE the
 * one closure (reopening is not a product path), and each is read only from
 * the screen that shows it.
 */
const CLOSED = 'This goal is closed.';
/*
 * The backend admits two station slots per event (`normalizeStationSlot`:
 * slot 1 or 2), so the four windows stand on TWO events, each with its own two
 * stations, and both goals are closed. Run 37912780869 failed here enrolling
 * a third and fourth station: wsfApproveStation refused, INVALID_ARGUMENT.
 */
async function closedGoalTurn({ page, baseUrl, fixtures }) {
  const r = recorder();
  const row = tagged(r, EXPO_ROWS['closed-goal-turn']);
  const ev = await fixtures.expoEvent('closed', { attendees: 2, target: 1000, seeded: 200 });
  const ev2 = await fixtures.expoEvent('closed2', { attendees: 3, target: 1000, seeded: 200 });
  const [started, readied] = ev.attendees;
  const [called, waiter, joiner] = ev2.attendees;
  const dev = devices(page);
  try {
    const s1 = (await openStation(dev, fixtures, baseUrl, ev, 1)).page;
    const s2 = (await openStation(dev, fixtures, baseUrl, ev, 2)).page;
    const t1 = (await openStation(dev, fixtures, baseUrl, ev2, 1)).page;
    const t2 = (await openStation(dev, fixtures, baseUrl, ev2, 2)).page;
    // The first event's own public display, which never runs a turn: both of its
    // stations will (a venue-width screen hides its total while a turn runs there,
    // turnRunningWide, app/station/[goalId].tsx at ec162d17), so its total is read here.
    const display = (await dev.open(TABLET)).page;
    await display.goto(`${baseUrl}/kiosk/${ev.goalId}`);
    need(await shown(display, 'wsf-kiosk-total-line', 40_000), 'the first event\'s display never showed its total');
    const [pA, pB, pC, pW, pD] = (await Promise.all([started, readied, called, waiter, joiner]
      .map((m) => openPhone(dev, fixtures, baseUrl, m)))).map((d) => d.page);

    // The first event: a turn running at Station 1, a member ready at Station 2.
    const entryA = await joinLine(pA, baseUrl, fixtures, ev, started, 'Fixture Z');
    const callA = await callNext(s1, 'Fixture Z');
    need(callA.serving === 'Fixture Z', `the first event's Station 1 called ${callA.serving ?? 'nobody'}, not Fixture Z`);
    await readyThenStart(pA, s1, 'the first event\'s Station 1', 'Fixture Z');
    await fixtures.trackStationTurn(ev, started, entryA);
    await joinLine(pB, baseUrl, fixtures, ev, readied, 'Fixture Y');
    const callB = await callNext(s2, 'Fixture Y');
    need(callB.serving === 'Fixture Y', `the first event's Station 2 called ${callB.serving ?? 'nobody'}, not Fixture Y`);
    await sayReady(pB, 'Fixture Y');
    need(await enabled(s2, 'wsf-station-turn-action', 25_000), 'the first event\'s Station 2 never offered Start their turn after Fixture Y said ready');
    // The second event: the member to be called stands first in its line, the
    // member who will wait behind them, and a fifth member is one tap from
    // joining when it closes.
    await joinLine(pC, baseUrl, fixtures, ev2, called, 'Fixture X');
    await joinLine(pW, baseUrl, fixtures, ev2, waiter, 'Fixture V');
    await openEvent(pD, baseUrl, ev2);
    await tap(pD, 'wsf-event-queue-start');
    await shown(pD, 'wsf-event-queue-name', 15_000);
    await type(pD, 'wsf-event-queue-name', 'Fixture U');
    const before = await textWhen(display, 'wsf-kiosk-total-line', (t) => t === '200 of 1,000 squats', 25_000);
    const before2 = await textWhen(t1, 'wsf-station-total-line', (t) => t === '200 of 1,000 squats', 25_000);
    // Called LAST, just before the closure. A call holds for 45 seconds and only
    // a called (assigned) place lapses (isTurnLeaseLapsed at ec162d17); the
    // ready row needs this call still standing when it is read, so nothing slow
    // stands between the call and that row.
    const callC = await callNext(t1, 'Fixture X');
    need(callC.serving === 'Fixture X', `the second event's Station 1 called ${callC.serving ?? 'nobody'}, not Fixture X`);
    need(await shown(pC, 'wsf-queue-ready', 25_000), 'Fixture X\'s phone never showed the call');
    const waitingBefore = await textWhen(t2, 'wsf-station-queue-count', (t) => t === '1 person waiting.', 25_000);
    const inLineBefore = await shown(pW, 'wsf-queue-waiting', 25_000);
    r.did('two events: in the first a turn running at Station 1 and a member ready at Station 2; in the second a member called to Station 1, one waiting with Station 2 idle, and a fifth on its event page with a name chosen');
    await fixtures.closeGoal(ev);
    await fixtures.closeGoal(ev2);
    r.did('both goals were closed');

    // FIRST, the one window with a clock on it: the member called to the second
    // event's Station 1. Ready advances nothing.
    const pressedReady = await tap(pC, 'wsf-queue-ready');
    r.did('tapped I\'m ready on the phone of the member called to the second event\'s Station 1');
    const cSaid = await textWhen(pC, 'wsf-queue-leave-error', (t) => t === CLOSED, 25_000);
    const stillCalled = (await present(pC, 'wsf-queue-called')) && (await present(pC, 'wsf-queue-ready'));
    const where = await textWhen(pC, 'wsf-queue-station', (t) => t === 'Go to Station 1.', 10_000);
    row('ready')(pressedReady && cSaid === CLOSED && stillCalled && where === 'Go to Station 1.',
      `${cSaid}; ${stillCalled ? 'still called' : 'no longer called'}; ${where}`);

    // The first event's Station 1: the turn that started before the closure.
    await type(s1, 'wsf-station-turn-count', '12');
    await tap(s1, 'wsf-station-turn-action');
    r.did('entered 12 on the first event\'s Station 1 and recorded');
    const said = await textWhen(s1, 'wsf-station-queue-error', (t) => t === CLOSED, 25_000);
    row('refused')(said === CLOSED, said);

    // The first event's Station 2: a member ready; start mints nothing.
    const pressedStart = await tap(s2, 'wsf-station-turn-action');
    r.did('pressed Start their turn on the first event\'s Station 2');
    const s2Said = await textWhen(s2, 'wsf-station-queue-error', (t) => t === CLOSED, 25_000);
    const noRecord = !(await present(s2, 'wsf-station-turn-record')) && !(await present(s2, 'wsf-station-turn-count'));
    const s2Serving = await textWhen(s2, 'wsf-station-queue-serving', (t) => t === 'Fixture Y', 10_000);
    row('start')(pressedStart && s2Said === CLOSED && noRecord && s2Serving === 'Fixture Y',
      `${s2Said}; record field ${noRecord ? 'absent' : 'shown'}; serving ${s2Serving}`);

    // The second event's Station 2, idle, with a member waiting: nobody is called.
    const pressedCall = await tap(t2, 'wsf-station-call-next');
    r.did('pressed Call next on the second event\'s Station 2');
    const t2Said = await textWhen(t2, 'wsf-station-queue-error', (t) => t === CLOSED, 25_000);
    const servesNobody = !(await present(t2, 'wsf-station-queue-serving'));
    const stillWaiting = await shown(pW, 'wsf-queue-waiting', 10_000);
    const wCalled = await present(pW, 'wsf-queue-called');
    row('call')(pressedCall && t2Said === CLOSED && servesNobody && waitingBefore === '1 person waiting.' && inLineBefore && stillWaiting && !wCalled,
      `${t2Said}; ${servesNobody ? 'serves nobody' : 'serves someone'}; waiting member ${stillWaiting && !wCalled ? 'still in the line' : 'moved'}`);

    // The fifth member: no place in the second event.
    const hallBeforeJoin = await textWhen(t2, 'wsf-station-queue-count', (t) => /waiting/.test(t), 10_000);
    const pressedJoin = await tap(pD, 'wsf-event-queue-join');
    r.did('the fifth member pressed join on the second event\'s page');
    const dSaid = await textWhen(pD, 'wsf-event-queue-error', (t) => t === CLOSED, 25_000);
    await page.waitForTimeout(4_000);
    const stayed = pathOf(pD) === `/event/${ev2.goalId}` && !(await present(pD, 'wsf-queue-screen'));
    const hallAfterJoin = await textWhen(t2, 'wsf-station-queue-count', (t) => t === hallBeforeJoin, 10_000);
    row('join')(pressedJoin && dSaid === CLOSED && stayed && Boolean(hallBeforeJoin) && hallAfterJoin === hallBeforeJoin,
      `${dSaid}; ${pathOf(pD)}; hall ${hallBeforeJoin} -> ${hallAfterJoin}`);

    await page.waitForTimeout(6_000);
    const after = await textWhen(display, 'wsf-kiosk-total-line', (t) => t === '200 of 1,000 squats', 10_000);
    const after2 = await textWhen(t1, 'wsf-station-total-line', (t) => t === '200 of 1,000 squats', 10_000);
    const noResult = !(await present(s1, 'wsf-station-queue-result'));
    row('nothing')(before === '200 of 1,000 squats' && after === '200 of 1,000 squats' && before2 === '200 of 1,000 squats' && after2 === '200 of 1,000 squats' && noResult,
      `first ${before} -> ${after}; second ${before2} -> ${after2}`);
    const receipts = [];
    for (const [name, p] of [['Station 1 turn', pA], ['ready', pB], ['called', pC], ['waiting', pW], ['joiner', pD]]) {
      if (await present(p, 'wsf-queue-receipt-amount')) receipts.push(name);
    }
    row('noReceipt')(receipts.length === 0, receipts.length ? `a receipt on: ${receipts.join(', ')}` : 'no receipt on any phone');
  } finally {
    await dev.closeAll();
  }
  return result(r, { setupId: `${ev.setupId}; ${ev2.setupId}` });
}

// ---- 8. shared-screen-finish --------------------------------------------------------------
async function signInAtKiosk(kiosk, account) {
  await tap(kiosk, 'wsf-kiosk-start');
  const gate = await shown(kiosk, 'wsf-contribute-signed-out', 20_000);
  await tap(kiosk, 'wsf-contribute-signin-link');
  await shown(kiosk, 'wsf-signin-email', 20_000);
  await type(kiosk, 'wsf-signin-email', account.email);
  await type(kiosk, 'wsf-signin-password', account.password);
  await tap(kiosk, 'wsf-signin-submit');
  const entry = await shown(kiosk, 'wsf-contribute-entry-screen', 40_000);
  return gate && entry;
}
const credit = (n) => `Your total on this goal: ${n} squats`;
/*
 * The kiosk receipt shows own credit as a tile whose label is styled
 * textTransform: uppercase (app/contribute/[goalId].tsx:2078-2079 at ec162d17),
 * and innerText reads the CSS casing: "YOUR TOTAL ON THIS GOAL: 20 squats". The
 * emulator proof's toHaveText reads textContent and never saw it; the hosted read
 * did (run 37912780869). Match the words and the figure, not the case, as run 57
 * taught the Home pill (home.mjs). A wrong figure or wording still fails.
 */
const sameWords = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const isCredit = (n) => (t) => sameWords(t, credit(n));
/** Whether a screen's text still carries any of `values`, in any case. */
const carries = (text, values) => values.filter((v) => text.toLowerCase().includes(v.toLowerCase()));
async function sharedScreenFinish({ page, baseUrl, fixtures }) {
  const r = recorder();
  const row = tagged(r, EXPO_ROWS['shared-screen-finish']);
  const ev = await fixtures.expoEvent('kiosk', { attendees: 2, target: 1000, seeded: 100 });
  const [first, next] = ev.attendees;
  const dev = devices(page);
  try {
    const kiosk = (await dev.open(TABLET)).page;
    // The 90 seconds run on the page's own clock. An installed clock keeps
    // flowing in real time; each runFor adds on top of what has already passed.
    await kiosk.clock.install();
    await kiosk.goto(`${baseUrl}/kiosk/${ev.goalId}`);
    await shown(kiosk, 'wsf-kiosk-screen', 40_000);
    await signInAtKiosk(kiosk, first);
    await recordOnPhone(kiosk, fixtures, ev, first, 20);
    r.did('started, signed in and recorded 20 on the shared screen');
    const ownFirst = await textWhen(kiosk, 'wsf-contribute-own-credit', isCredit(20), 20_000);
    await tap(kiosk, 'wsf-kiosk-finish');
    r.did('pressed Finish');
    const atStart = await shown(kiosk, 'wsf-kiosk-start', 20_000);
    const startText = await kiosk.evaluate(() => document.body.innerText);
    const leftovers = carries(startText, [first.email, 'Fixture Attendee 1', credit(20), '20 squats']);
    const noState = !(await present(kiosk, 'wsf-contribute-receipt')) && !(await present(kiosk, 'wsf-contribute-pending')) && !(await present(kiosk, 'wsf-kiosk-unresolved-note'));
    await tap(kiosk, 'wsf-kiosk-start');
    r.did('started again as the next person');
    const gate = await shown(kiosk, 'wsf-contribute-signed-out', 20_000);
    row('finish')(isCredit(20)(ownFirst) && atStart && leftovers.length === 0 && noState && gate,
      leftovers.length ? `the start screen still carried ${leftovers.length} of the previous person's values` : `${ownFirst}; start ${atStart}; signed-out gate ${gate}`);
    await tap(kiosk, 'wsf-contribute-signin-link');
    await shown(kiosk, 'wsf-signin-email', 20_000);
    await type(kiosk, 'wsf-signin-email', next.email);
    await type(kiosk, 'wsf-signin-password', next.password);
    await tap(kiosk, 'wsf-signin-submit');
    await shown(kiosk, 'wsf-contribute-entry-screen', 40_000);
    const zero = await textWhen(kiosk, 'wsf-contribute-own-credit', isCredit(0), 20_000);
    await recordOnPhone(kiosk, fixtures, ev, next, 5);
    r.did('the next person signed in and recorded 5');
    const both = await textWhen(kiosk, 'wsf-contribute-shared-total', (t) => countOf(t) === 125, 20_000);
    const ownNext = await textWhen(kiosk, 'wsf-contribute-own-credit', isCredit(5), 20_000);
    row('next')(gate && isCredit(0)(zero) && countOf(both) === 125 && isCredit(5)(ownNext), `${zero}; ${both}; ${ownNext}`);
    const full = await textWhen(kiosk, 'wsf-kiosk-countdown', (t) => /^Finishing in \d+ seconds?$/.test(t), 10_000);
    await kiosk.clock.runFor(60_000);
    const midway = countOf(await textWhen(kiosk, 'wsf-kiosk-countdown', () => true, 5_000));
    await tap(kiosk, 'wsf-kiosk-stay');
    await kiosk.clock.runFor(1_000);
    const putBack = countOf(await textWhen(kiosk, 'wsf-kiosk-countdown', () => true, 5_000));
    r.did('left the receipt untouched for 60 seconds, pressed Stay, then left it past the deadline');
    await kiosk.clock.runFor(KIOSK_IDLE_MS + 2_000);
    const finished = await shown(kiosk, 'wsf-kiosk-start', 20_000);
    const after = await kiosk.evaluate(() => document.body.innerText);
    const clean = carries(after, [next.email, 'Fixture Attendee 2', credit(5)]).length === 0;
    await tap(kiosk, 'wsf-kiosk-start');
    const signedOut = await shown(kiosk, 'wsf-contribute-signed-out', 20_000);
    row('countdown')(Boolean(full) && midway <= 31 && putBack >= 85 && finished && clean && signedOut,
      `midway ${midway}s; after Stay ${putBack}s; finished ${finished}; signed out ${signedOut}`);
  } finally {
    await dev.closeAll();
  }
  return result(r, ev);
}

// ---- 9. unverified-participant ------------------------------------------------------------
/*
 * KIOSK-UNVERIFIED-STAGING-RECOVERY-1: an ordinary participant whose address is
 * NOT verified, on the native app's hosted web build (not the Lovable Web Twin),
 * admitted only through the real path: the approved marker, then the
 * community's join link. #586 opened profile, joins and contribution to such an
 * account on the server. Every row reads what the page renders; where the app's
 * own screens still stop the account, the row fails and names the screen that
 * did. Nothing verifies an address: the verification page's Resend and I have
 * verified are never pressed, so a run sends no mail. A verified account with
 * no profile walks the same path as the control.
 */
const UNVERIFIED_STOPS = Object.freeze({
  'wsf-verify': 'held at the verification page (Check your email.), whose only ways on are verifying or signing out',
  'wsf-profile-unverified': 'the profile page shows only Verify your email before completing your profile.',
  'wsf-marker-verify': 'the marker shows Confirm your email to join in place of its Join button',
  // The marker's own error card: its service did not answer (as a new service is, until its transport is opened).
  'wsf-marker-error': null,
  'wsf-join-submit-error': null, // the product's own refusal, read from the page
  'wsf-contribute-not-found': null,
  'wsf-contribute-signed-out': null,
});
/** No synthetic address ever reaches a result: the pages above can print the signed-in email. */
const scrub = (s) => String(s ?? '').replace(/[^\s@]+@[^\s@]+/g, '[address]');
/** Where the page stopped the account, in words: the path (a join link's code withheld) and the screen it shows. */
async function stopSeen(page) {
  const where = pathOf(page).replace(/^\/join\/.+$/, '/join/[link]');
  for (const [id, said] of Object.entries(UNVERIFIED_STOPS)) {
    if (await present(page, id)) return `${where}: ${said ?? scrub(((await vis(page, id).innerText()) || '').replace(/\s+/g, ' ').trim())}`;
  }
  return `${where}: none of the expected screens`;
}
async function firstOf(page, ids, timeout = 30_000) {
  let hit = null;
  await until(page, async () => { for (const id of ids) if (await present(page, id)) { hit = id; return true; } return false; }, timeout);
  return hit;
}
const STOP_IDS = Object.keys(UNVERIFIED_STOPS);
/** The profile step: the name form, the terms, Save profile. False when the form is not offered. */
async function saveProfile(phone, baseUrl, name) {
  if (pathOf(phone) !== '/profile-setup') await phone.goto(`${baseUrl}/profile-setup`);
  if ((await firstOf(phone, ['wsf-profile-displayName', ...STOP_IDS], 30_000)) !== 'wsf-profile-displayName') return false;
  await type(phone, 'wsf-profile-displayName', name);
  await tap(phone, 'wsf-profile-termsCheckbox');
  await tap(phone, 'wsf-profile-submit');
  return until(phone, async () => pathOf(phone) !== '/profile-setup', 30_000);
}
/** The approved marker's Join. Returns the button's words and whether How will you take part? followed. */
async function joinByMarker(phone, baseUrl, fixtures, ev, account) {
  await phone.goto(`${baseUrl}/go/${ev.markerSlug}`);
  const hit = await firstOf(phone, ['wsf-marker-join-button', 'wsf-marker-choose', ...STOP_IDS], 40_000);
  if (hit !== 'wsf-marker-join-button') return { offered: null, joined: false, hit };
  const offered = ((await vis(phone, 'wsf-marker-join-button').innerText()) || '').replace(/\s+/g, ' ').trim();
  await tap(phone, 'wsf-marker-join-button');
  const joined = await shown(phone, 'wsf-marker-choose', 30_000);
  await fixtures.claimMemberships(account);
  return { offered, joined, hit };
}
/** From the marker, Move on my phone, then record `count`. */
async function recordFromMarker(phone, baseUrl, fixtures, ev, account, count) {
  await phone.goto(`${baseUrl}/go/${ev.markerSlug}`);
  if ((await firstOf(phone, ['wsf-marker-phone', 'wsf-marker-join-button', ...STOP_IDS], 40_000)) !== 'wsf-marker-phone') return false;
  await tap(phone, 'wsf-marker-phone');
  if (!(await until(phone, async () => pathOf(phone) === `/contribute/${ev.goalId}` && (await present(phone, 'wsf-contribute-entry-screen')), 40_000))) return false;
  return recordOnPhone(phone, fixtures, ev, account, count);
}
const ownCredit = (n) => `Your total on this goal: ${n} squats`;
const yoursLine = (n) => `YOURS ${n} squats`;
/** The sign-in gates: landing on one of these is not reaching the member. */
const GATE_SCREEN = /^\/(signin|verify-email|profile-setup)$/;

async function unverifiedParticipant({ page, baseUrl, fixtures }) {
  const r = recorder();
  const row = tagged(r, EXPO_ROWS['unverified-participant']);
  const ev = await fixtures.joinableEvent('unverified', { target: 1000, seeded: 100 });
  const visitor = await fixtures.createUnverifiedUser('unverified-v', 'Fixture Visitor');
  const control = await fixtures.createVerifiedUser('unverified-c', 'Fixture Control');
  // What the product will write for each of them, claimed before they act.
  fixtures.expectVisitor(ev, visitor);
  fixtures.expectVisitor(ev, control);
  const dev = devices(page);
  try {
    const first = await dev.open(PHONE);
    const phone = first.page;
    const landed = await fixtures.signInLanding(phone, baseUrl, visitor);
    r.did('signed in on the visitor\'s own phone with an account whose address is not verified');
    row('signin')(landed === '/profile-setup', landed === '/profile-setup' ? landed : await stopSeen(phone));

    const saved = await saveProfile(phone, baseUrl, 'Fixture Visitor');
    r.did(saved ? 'typed a name, accepted the terms and pressed Save profile' : 'opened the profile step');
    row('profile')(saved, saved ? `moved on to ${pathOf(phone)}` : await stopSeen(phone));

    const m = await joinByMarker(phone, baseUrl, fixtures, ev, visitor);
    r.did(m.offered ? 'opened the approved marker and pressed its Join' : 'opened the approved marker');
    row('marker')(m.offered === `Join ${ev.communityName}` && m.joined, m.offered ? `${m.offered}; ${m.joined ? 'How will you take part?' : 'no choice followed'}` : await stopSeen(phone));

    await phone.goto(`${baseUrl}/join/${ev.joinCode}`);
    const j = await firstOf(phone, ['wsf-join-submit', 'wsf-join-invalid', 'wsf-join-error'], 40_000);
    if (j === 'wsf-join-submit') await tap(phone, 'wsf-join-submit');
    r.did('opened the community\'s join link and pressed Join');
    await until(phone, async () => pathOf(phone) === `/community/${ev.groupId}` || (await present(phone, 'wsf-join-submit-error')), 30_000);
    const home = pathOf(phone) === `/community/${ev.groupId}`;
    const name = home ? await textWhen(phone, 'wsf-community-name', (t) => t === ev.communityName, 30_000) : null;
    await fixtures.claimMemberships(visitor);
    row('link')(home && name === ev.communityName, home ? `the community page, named ${name}` : await stopSeen(phone));

    const recorded = await recordFromMarker(phone, baseUrl, fixtures, ev, visitor, 15);
    r.did(recorded ? 'pressed Move on my phone, entered 15, pressed Review, then Record' : 'looked for Move on my phone on the marker');
    const own = recorded ? await textWhen(phone, 'wsf-contribute-own-credit', (t) => t === ownCredit(15), 30_000) : null;
    const shared = recorded ? await textWhen(phone, 'wsf-contribute-shared-total', (t) => countOf(t) === 115, 30_000) : null;
    row('contribute')(recorded && own === ownCredit(15) && countOf(shared) === 115, recorded ? `${own}; ${shared}` : `nothing recorded: ${await stopSeen(phone)}`);

    await phone.goto(`${baseUrl}/activity`);
    const yours = await textWhen(phone, `wsf-activity-goal-${ev.goalId}-yours`, (t) => t === yoursLine(15), 20_000);
    r.did('opened Your progress');
    row('history')(yours === yoursLine(15), yours ?? 'the goal is not listed');

    await first.context.close();
    const second = await dev.open(PHONE);
    const fresh = second.page;
    r.did('cleared the browser: a new one with no cookies, storage or saved sign-in');
    const again = await fixtures.signInLanding(fresh, baseUrl, visitor);
    r.did('signed in again as the same visitor');
    const reached = !GATE_SCREEN.test(again) ? again : await stopSeen(fresh);
    await fresh.goto(`${baseUrl}/activity`);
    const kept = await textWhen(fresh, `wsf-activity-goal-${ev.goalId}-yours`, (t) => t === yoursLine(15), 20_000);
    row('fresh')(!GATE_SCREEN.test(again) && kept === yoursLine(15), `${reached}; ${kept ?? 'the goal is not listed'}`);

    await fresh.goto(`${baseUrl}/contribute/${ev.goalId}`);
    const entry = (await firstOf(fresh, ['wsf-contribute-entry-screen', ...STOP_IDS], 40_000)) === 'wsf-contribute-entry-screen';
    const ten = entry && await recordOnPhone(fresh, fixtures, ev, visitor, 10);
    r.did(ten ? 'recorded a new round of 10' : 'opened the contribution page for a new round');
    const own2 = ten ? await textWhen(fresh, 'wsf-contribute-own-credit', (t) => t === ownCredit(25), 30_000) : null;
    const shared2 = ten ? await textWhen(fresh, 'wsf-contribute-shared-total', (t) => countOf(t) === 125, 30_000) : null;
    row('round')(ten && own2 === ownCredit(25) && countOf(shared2) === 125, ten ? `${own2}; ${shared2}` : `nothing recorded: ${await stopSeen(fresh)}`);

    // The control: verified, with no profile and no membership, on the same path.
    const cp = (await dev.open(PHONE)).page;
    const cLanded = await fixtures.signInLanding(cp, baseUrl, control);
    const cSaved = cLanded === '/profile-setup' && await saveProfile(cp, baseUrl, 'Fixture Control');
    const cm = cSaved ? await joinByMarker(cp, baseUrl, fixtures, ev, control) : { joined: false };
    const cRecorded = cm.joined && await recordFromMarker(cp, baseUrl, fixtures, ev, control, 5);
    const cOwn = cRecorded ? await textWhen(cp, 'wsf-contribute-own-credit', (t) => t === ownCredit(5), 30_000) : null;
    r.did('the verified control signed in, saved a profile, joined by the marker and recorded 5');
    row('control')(cSaved && cm.joined && cOwn === ownCredit(5),
      cOwn === ownCredit(5) ? `${cLanded}; ${cOwn}` : `${cLanded}; saved ${cSaved}; joined ${cm.joined}; ${cRecorded ? cOwn : await stopSeen(cp)}`);
  } finally {
    await dev.closeAll();
  }
  return result(r, ev);
}

export const expoDrivers = Object.freeze({
  'event-use-my-phone': eventUseMyPhone,
  'event-join-line': eventJoinLine,
  'two-station-turns': twoStationTurns,
  'phone-and-stations-converge': phoneAndStationsConverge,
  'station-lost-answer': stationLostAnswer,
  'line-place-ends': linePlaceEnds,
  'closed-goal-turn': closedGoalTurn,
  'shared-screen-finish': sharedScreenFinish,
  'unverified-participant': unverifiedParticipant,
});
