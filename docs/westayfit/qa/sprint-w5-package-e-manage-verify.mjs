#!/usr/bin/env node
// W5 independent check of the hosted Package E smoke's Manage-surface helpers
// (W3 dc639571, composed onto operational main). Read-only: it copies the tree
// under review into its own temp dir with `git archive`, mutates only that
// copy, and removes it. No network, no browser, no credentials.
//
//   ROOT=<git checkout> REV=<commit or tree to review> node docs/westayfit/qa/sprint-w5-package-e-manage-verify.mjs
//
// Rows:
//   C0  control: the unmutated contract suite passes in the copy.
//   B*  behaviour of the helpers' REAL source (extracted between the marker
//       comments, not retyped) against an independent page model that is
//       deliberately unlike the contract's: elements render LATE (async), the
//       menu is a toggle, and a Champion's row registers after the menu opens.
//   X*  mutants of the smoke; each must turn the contract suite red. A mutant
//       whose target text is not found exactly once is an INSTRUMENT error.
//   G*  mutants the contract is NOT expected to catch today (open gaps); they
//       are reported OPEN/CLOSED and do not fail the run.
//   S*  static facts about the diff that a mutant cannot express.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.env.ROOT || process.cwd();
const REV = process.env.REV;
const BASE = process.env.BASE; // operational main the delta composes onto (for S rows)
if (!REV) { console.error('REV is required'); process.exit(2); }
const SMOKE_PATH = '.github/wsf-staging/hosted-package-e-smoke.mjs';
const CONTRACT = '.github/wsf-staging/tests/hosted-smoke-contract.test.mjs';

const rows = [];
const gaps = [], gapsClosed = [];
const row = (id, ok, detail) => { rows.push({ id, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${detail}`); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w5-pe-manage-'));
const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
process.on('SIGINT', () => { cleanup(); process.exit(130); });
try {
  execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${REV} | tar -x -C "${tmp}"`]);
  const smokeFile = path.join(tmp, SMOKE_PATH);
  const ORIGINAL = fs.readFileSync(smokeFile, 'utf8');
  const runContract = () => spawnSync(process.execPath, [CONTRACT], { cwd: tmp, encoding: 'utf8', timeout: 120_000 });

  // ---- C0
  const c0 = runContract();
  const c0n = (c0.stdout.match(/hosted-smoke-contract: (\d+) passed/) || [])[1];
  row('C0', c0.status === 0 && Boolean(c0n), `unmutated contract exit=${c0.status} passed=${c0n}`);

  // ---- B rows: the real helper source against a late-rendering page model
  const START = '// --- manage surface helpers (contract-tested from source, see hosted-smoke-contract.test.mjs) ---';
  const END = '// --- end manage surface helpers ---';
  const s = ORIGINAL.indexOf(START), e = ORIGINAL.indexOf(END);
  if (s === -1 || e <= s) throw new Error('helper markers not found');
  const helperSrc = ORIGINAL.slice(s + START.length, e);
  const fnSrc = (name) => { const i = ORIGINAL.indexOf(`async function ${name}(`); const j = ORIGINAL.indexOf('\n}\n', i); return ORIGINAL.slice(i, j + 2); };
  const assertSrc = (() => { const i = ORIGINAL.indexOf('function assert(condition, message)'); const j = ORIGINAL.indexOf('\n}\n', i); return ORIGINAL.slice(i, j + 2); })();
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const load = () => new AsyncFunction(`${assertSrc}\n${fnSrc('visible')}\n${helperSrc}\nreturn { manageSurface, openManage, assertMemberHasNoManage };`)();

  // Page model: a map testId -> time it becomes present (ms from now). Clicks
  // schedule transitions with a render delay, the way React commits after an
  // event. Locator methods follow Playwright: count(), click() (auto-waits
  // for the element), waitFor({state, timeout}).
  function page({ surface, champion, rowDelay = 0, render = 40, menuCloses = true, panelOpensFromRow = true, extra = [] }) {
    const at = new Map();
    const now = () => Date.now();
    const add = (id, delay = 0) => at.set(id, now() + delay);
    const del = (id) => at.delete(id);
    const has = (id) => at.has(id) && at.get(id) <= now();
    const log = [];
    if (surface === 'shell' || surface === 'both') { add('wsf-member-topbar', 150); add('wsf-member-topbar-menu-button', 150); }
    if (surface === 'legacy' || surface === 'both') { add('wsf-community-wordmark', 150); if (champion) add('wsf-community-manage', 150); }
    for (const id of extra) add(id);
    const onClick = (id) => {
      log.push(id);
      if (id === 'wsf-member-topbar-menu-button') {
        if (has('wsf-member-topbar-menu')) { if (menuCloses) { del('wsf-member-topbar-menu'); del('wsf-member-topbar-menu-manage-community'); } }
        else { add('wsf-member-topbar-menu', render); if (champion) add('wsf-member-topbar-menu-manage-community', render + rowDelay); }
      } else if (id === 'wsf-member-topbar-menu-manage-community') {
        del('wsf-member-topbar-menu'); del('wsf-member-topbar-menu-manage-community');
        if (panelOpensFromRow) add('wsf-community-manage-panel', render);
      } else if (id === 'wsf-community-manage') add('wsf-community-manage-panel', render);
    };
    const waitUntil = async (pred, timeout, what) => {
      const deadline = now() + timeout;
      while (!pred()) { if (now() >= deadline) throw new Error(`timeout: ${what}`); await new Promise((r) => setTimeout(r, 10)); }
    };
    return {
      log, has,
      getByTestId: (id) => ({
        count: async () => (has(id) ? 1 : 0),
        click: async () => { await waitUntil(() => has(id), 1500, `click ${id}`); onClick(id); },
        waitFor: async ({ state = 'visible', timeout = 1500 } = {}) => waitUntil(() => has(id) === (state === 'visible'), Math.min(timeout, 1500), `${id} ${state}`),
      }),
    };
  }
  const outcome = async (p) => { try { await p; return { ok: true }; } catch (err) { return { ok: false, msg: String(err.message) }; } };
  const H = await load();
  const T = { timeout: 1200 };
  const B = [
    ['B1 shell Champion opens the panel through the menu', async () => { const p = page({ surface: 'shell', champion: true }); const r = await outcome(H.openManage(p, T)); return r.ok && p.has('wsf-community-manage-panel') && p.log.join() === 'wsf-member-topbar-menu-button,wsf-member-topbar-menu-manage-community'; }],
    ['B2 legacy Champion opens the panel through the in-page control', async () => { const p = page({ surface: 'legacy', champion: true }); const r = await outcome(H.openManage(p, T)); return r.ok && p.has('wsf-community-manage-panel') && p.log.join() === 'wsf-community-manage'; }],
    ['B3 shell member passes, and the menu was really opened and closed', async () => { const p = page({ surface: 'shell', champion: false }); const r = await outcome(H.assertMemberHasNoManage(p, { ...T, holdMs: 300 })); return r.ok && p.log.join() === 'wsf-member-topbar-menu-button,wsf-member-topbar-menu-button' && !p.has('wsf-member-topbar-menu'); }],
    ['B4 legacy member passes', async () => (await outcome(H.assertMemberHasNoManage(page({ surface: 'legacy', champion: false }), T))).ok],
    // Discriminating negatives. B5 is the one the contract's model cannot
    // express: the Champion row registers LATE (after the menu is open). The
    // default hold must still see it.
    ['B5 shell: Champion row registering 500 ms after the menu opens still FAILS the member check (default hold)', async () => { const r = await outcome(H.assertMemberHasNoManage(page({ surface: 'shell', champion: true, rowDelay: 500 }), T)); return !r.ok && /Manage community is in the menu/.test(r.msg); }],
    ['B6 legacy: a drawn control FAILS the member check', async () => { const r = await outcome(H.assertMemberHasNoManage(page({ surface: 'legacy', champion: true }), T)); return !r.ok && /legacy Manage control is drawn/.test(r.msg); }],
    ['B7 neither surface FAILS openManage and the member check', async () => { const a = await outcome(H.openManage(page({ surface: 'none', champion: true }), { timeout: 400 })); const b = await outcome(H.assertMemberHasNoManage(page({ surface: 'none' }), { timeout: 400 })); return !a.ok && !b.ok && /Neither Manage surface/.test(a.msg) && /Neither Manage surface/.test(b.msg); }],
    ['B8 both surfaces FAIL', async () => { const r = await outcome(H.openManage(page({ surface: 'both', champion: true }), T)); return !r.ok && /Both Manage surfaces/.test(r.msg); }],
    ['B9 shell member: a menu that will not close FAILS (menu left open is not silent)', async () => { const r = await outcome(H.assertMemberHasNoManage(page({ surface: 'shell', champion: false, menuCloses: false }), { ...T, holdMs: 100 })); return !r.ok; }],
    ['B10 shell Champion: the row that opens no panel FAILS openManage', async () => { const r = await outcome(H.openManage(page({ surface: 'shell', champion: true, panelOpensFromRow: false }), T)); return !r.ok && /wsf-community-manage-panel/.test(r.msg); }],
    ['B11 member with the panel already open FAILS', async () => { const r = await outcome(H.assertMemberHasNoManage(page({ surface: 'legacy', champion: false, extra: ['wsf-community-manage-panel'] }), T)); return !r.ok && /Manage sheet open/.test(r.msg); }],
    ['B12 shell member: surface detected only once the bar renders (150 ms late), not misread as neither', async () => (await outcome(H.manageSurface(page({ surface: 'shell' }), 1000))).ok],
  ];
  for (const [name, f] of B) { let ok = false; try { ok = await f(); } catch (err) { ok = false; } row(name.split(' ')[0], ok, name.slice(name.indexOf(' ') + 1)); }

  // ---- X rows: mutants that must turn the contract red
  const X = [
    ['X1 member check never opens the menu (vacuous count of a row that only exists in an open menu)',
      "    await visible(page.getByTestId(menuButton), timeout);\n    await page.getByTestId(menuButton).click();\n    await visible(page.getByTestId(menu), timeout);\n    const deadline",
      '    const deadline'],
    ['X2 member hold loop counts a misspelt row id', "assert((await page.getByTestId(manageItem).count()) === 0,", "assert((await page.getByTestId(manageItem + '-x').count()) === 0,"],
    ['X3 neither surface falls back to legacy instead of failing', "  assert(false, `Neither Manage surface", "  return 'legacy';\n  assert(false, `Neither Manage surface"],
    ['X4 the both-surfaces guard removed', "    assert(!(shell > 0 && legacy > 0), 'Both Manage surfaces are on the page at once; the harness cannot tell which candidate this is');\n", ''],
    ['X5 member legacy branch counts the panel instead of the control', "assert((await page.getByTestId(MANAGE_SURFACES.legacy.manageControl).count()) === 0,", "assert((await page.getByTestId(MANAGE_PANEL).count()) === 0,"],
    ['G1 member check no longer asserts the panel closed', "  assert((await page.getByTestId(MANAGE_PANEL).count()) === 0, `${who} unexpectedly has the Champion Manage sheet open`);\n", ''],
    ['X7 member check leaves the menu open', "    await page.getByTestId(menuButton).click();\n    await page.getByTestId(menu).waitFor({ state: 'hidden', timeout });\n", ''],
    ['G2 shell openManage stops after clicking the row (no panel wait on shell)', "    await page.getByTestId(manageItem).click();\n  } else {", "    await page.getByTestId(manageItem).click();\n    return;\n  } else {"],
    ['X9 one member site replaced by a vacuous count', "    await assertMemberHasNoManage(member);\n    await snap(member, '11-phone-community-home');", "    assert((await member.getByTestId('wsf-member-topbar-menu-manage-community').count()) === 0, 'Member unexpectedly has the Champion Manage surface');\n    await snap(member, '11-phone-community-home');"],
    ['X10 member hold inverted (=== 0 -> >= 0)', "assert((await page.getByTestId(manageItem).count()) === 0,", "assert((await page.getByTestId(manageItem).count()) >= 0,"],
    ['X11 surface detection swapped (shell marker read as legacy)', "    if (shell > 0) return 'shell';\n    if (legacy > 0) return 'legacy';", "    if (shell > 0) return 'legacy';\n    if (legacy > 0) return 'shell';"],
    ['G3 member hold shortened to a single look (holdMs default 2_000 -> 0)', 'holdMs = 2_000 }', 'holdMs = 0 }'],
  ];
  for (const [name, from, to] of X) {
    const id = name.split(' ')[0];
    const n = ORIGINAL.split(from).length - 1;
    if (n !== 1) { row(id, false, `INSTRUMENT: target found ${n} times — ${name}`); continue; }
    fs.writeFileSync(smokeFile, ORIGINAL.replace(from, to));
    const r = runContract();
    fs.writeFileSync(smokeFile, ORIGINAL);
    const firstFail = ((r.stdout + r.stderr).match(/(not ok[^\n]*|AssertionError[^\n]*|Error: [^\n]*)/) || [''])[0].slice(0, 140);
    if (id.startsWith('G')) { gaps.push(id); row(id, true, `GAP ${r.status !== 0 ? 'CLOSED (caught)' : 'OPEN (survives the contract)'} — ${name.slice(id.length + 1)}`); if (r.status !== 0) gapsClosed.push(id); continue; }
    row(id, r.status !== 0, `${r.status !== 0 ? 'caught' : 'SURVIVED'} — ${name.slice(id.length + 1)}${r.status !== 0 ? ` [${firstFail}]` : ''}`);
  }

  // ---- S rows: static facts about the delta
  if (BASE) {
    const names = execFileSync('git', ['-C', ROOT, 'diff', '--name-only', BASE, REV], { encoding: 'utf8' }).trim().split('\n');
    row('S1', names.length === 2 && names.includes(SMOKE_PATH) && names.includes(CONTRACT), `files changed vs BASE: ${names.join(', ')}`);
    const before = execFileSync('git', ['-C', ROOT, 'show', `${BASE}:${SMOKE_PATH}`], { encoding: 'utf8' });
    // Every line removed from the smoke is either the old openManage body or one of the three vacuous counts.
    const diff = execFileSync('git', ['-C', ROOT, 'diff', '-U0', BASE, REV, '--', SMOKE_PATH], { encoding: 'utf8' });
    const removed = diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).map((l) => l.slice(1).trim());
    const allowed = (l) => l === '' || /^\*/.test(l) || l.startsWith('//') || /wsf-community-manage/.test(l) || /^async function openManage\(page\)/.test(l);
    const bad = removed.filter((l) => !allowed(l));
    row('S2', bad.length === 0, `removed smoke lines are only the old openManage / old counts / comments (${removed.length} removed${bad.length ? `; unexpected: ${JSON.stringify(bad)}` : ''})`);
    const count = (src, re) => (src.match(re) || []).length;
    const rowNames = (src) => [...src.matchAll(/check\('([^']+)', 'PASS'/g)].map((m) => m[1]).join('|');
    const authBefore = count(before, /wsf-goal-display-auth-/g), authAfter = count(ORIGINAL, /wsf-goal-display-auth-/g);
    const assertsBefore = count(before, /\bassert\(/g) - 3, assertsAfter = count(ORIGINAL, /\bassert\(/g);
    row('S3', authBefore === authAfter, `wsf-goal-display-auth-* references unchanged (${authBefore} -> ${authAfter})`);
    row('S4', /openManage\(/.test(ORIGINAL) && count(before, /await openManage\(/g) === count(ORIGINAL, /await openManage\(/g), `Champion openManage call sites unchanged (${count(before, /await openManage\(/g)} -> ${count(ORIGINAL, /await openManage\(/g)})`);
    row('S5', !/wsf-community-manage'\)\.count\(\)/.test(ORIGINAL), 'no bare count of the removed control remains');
    row('S6', rowNames(before) === rowNames(ORIGINAL) && rowNames(ORIGINAL).split('|').length === 24, `green-run PASS rows identical by name and order (${rowNames(before).split('|').length} -> ${rowNames(ORIGINAL).split('|').length})`);
    const cleanupSig = (src) => (src.match(/finally \{[\s\S]*?\n  \}/g) || []).join('\n');
    row('S7', cleanupSig(before) === cleanupSig(ORIGINAL), `every finally/cleanup block byte-identical (${(before.match(/finally \{/g) || []).length} -> ${(ORIGINAL.match(/finally \{/g) || []).length})`);
    console.log(`INFO assert() calls (before minus the three replaced) ${assertsBefore} -> ${assertsAfter} (the +5 are inside the new helpers)`);
  }
} finally {
  cleanup();
}
const failed = rows.filter((r) => !r.ok);
console.log(`\nGAP rows (a mutant the contract does not catch; recorded, not required): ${gaps.length}, closed ${gapsClosed.length}`);
console.log(`\n${rows.length - failed.length}/${rows.length} rows as required${failed.length ? `; FAILED: ${failed.map((r) => r.id).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
