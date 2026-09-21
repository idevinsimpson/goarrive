#!/usr/bin/env node
/**
 * Recomputes route → target coverage FROM THE ROUTE TREE.
 *
 * ROUTE-TARGET-INDEX.md used to carry hand-maintained counts, and they went
 * stale the moment a batch landed: after Atlas Batch A it still called five
 * identity routes "not covered" while their targets sat in the same commit.
 * A number a person types is a number that rots, so this walks
 * apps/westayfit/app and cross-references the target register below.
 *
 * WHAT THIS DOES AND DOES NOT DO. The ROUTE TREE is derived from the file
 * system. The TARGET REGISTRY below and the implemented-list are MAINTAINED BY
 * HAND -- nothing here discovers target files on disk or reads a frame to see
 * which route it draws. The guarantees are narrower than "automatic": a new
 * route appears as uncovered rather than missing from the arithmetic, and a
 * registry entry for a route that no longer exists exits non-zero. Keeping the
 * registry truthful is still a person's job.
 *
 * Run:  node scripts/westayfit/route-target-coverage.mjs
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const APP = path.resolve(process.cwd(), 'apps/westayfit/app');

/** Not member-facing: gated target previews and the ops probe. */
const EXCLUDED = (route) => route.startsWith('/design-target') || route === '/health';

/**
 * WHERE EACH ROUTE'S TARGET LIVES. A route is covered only when a real-RN
 * target frame exists for it; a superseded HTML concept is not a target.
 * Keyed by route so a new route shows up as uncovered rather than silently
 * missing from the arithmetic.
 */
const TARGETS = {
  '/community/[groupId]': 'review/page-01-home/',
  '/community': 'review/page-03-community/',
  '/activity': 'review/page-04-progress/',
  '/you': 'review/page-05-you/',
  '/move': 'review/page-02-move/',
  '/contribute/[goalId]': 'review/page-02-move/',
  '/goals/new': 'review/batch-b-join-and-setup/',
  '/join/[joinCode]': 'review/batch-b-join-and-setup/',
  '/start-community': 'review/batch-b-join-and-setup/',
  '/combined/[setupId]': 'review/batch-b-join-and-setup/',
  '/community/[groupId]/challenge': 'review/batch-c-challenge-and-door/',
  '/': 'review/batch-c-challenge-and-door/',
  '/event/[goalId]': 'review/batch-d-event-and-line/',
  '/queue/[goalId]': 'review/batch-d-event-and-line/',
  '/kiosk/[goalId]': 'review/batch-e-room-screens/',
  '/station/[goalId]': 'review/batch-e-room-screens/',
  '/display/[goalId]': 'review/batch-f-public-display/',
  '/move/[goalId]': 'review/batch-g-follow-along/',
  '/signin': 'review/batch-a-identity/',
  '/signup': 'review/batch-a-identity/',
  '/verify-email': 'review/batch-a-identity/',
  '/reset-password': 'review/batch-a-identity/',
  '/profile-setup': 'review/batch-a-identity/',
};


/**
 * What each covered route's package is, in one line. Kept HERE rather than
 * hand-written into the document, because the document is generated from this
 * file now: `/community`, `/activity` and `/you` each ended up listed BOTH as
 * covered and as not covered, because a covered row was added as each page
 * shipped and the matching uncovered row was never pruned. A table a person
 * edits twice is a table that contradicts itself eventually.
 */
const NOTES = {
  '/community/[groupId]':
    'Community Home, where `/` lands a member with a current community. Three device classes plus a twelve-state matrix. **Implemented and accepted.**',
  '/community':
    "The community list — Community's only route, since `/community/[groupId]` is Home. **Implemented and accepted.** The per-community `PROPOSAL-*` frames are exploration only and were explicitly ruled out of implementation.",
  '/activity':
    'Progress — the private record of what the member recorded. **Implemented (Phase A) and accepted.** The data audit in that package is why there is no streak.',
  '/you':
    'You — identity, the community you belong to, and the account actions that really work. Target only; the truth table in that package is why there is no photo, streak or personal-impact claim.',
  '/move':
    'MOVE entry. **Implemented and accepted**, with the sheet mechanic declared as a difference (it needs a transparent-modal presentation).',
  '/contribute/[goalId]':
    'Contribution entry, review, and all six outcomes on a PHONE. **Implemented and accepted.** Its kiosk mode (`?kiosk=1`) at 800x1280 is a separate target in `review/batch-e-room-screens/`, **not approved**.',
  '/goals/new':
    'Opening a goal — eight states, three phone classes. Target only, **not approved**. `review/page-02-move/` also holds a unit-shortcut PROPOSAL for this route; the two disagree and that package records the open decision.',
  '/join/[joinCode]':
    'The invitation — ten states including the event-path device question, which lives on this route and is NOT drawn again in Batch D. Target only, **not approved**.',
  '/start-community':
    'Starting a community — seven states. One page, not a wizard, and no success screen: the success is Community Home. Target only, **not approved**.',
  '/combined/[setupId]':
    'Watching a combined goal — five states. Read-only; NOT a setup flow. Target only, **not approved**.',
  '/community/[groupId]/challenge':
    'The challenge in the room — ten states plus a move-card state strip. The one surface that counts people, and the package says why that is honest here. Target only, **not approved**.',
  '/':
    'The home resolver. Drawn only in the states where the redirect does NOT happen, because every other case replaces into Community Home. Target only, **not approved**.',
  '/event/[goalId]':
    'Standing in the room — eleven states, including the event route\'s OWN device question (the join route\'s variant differs and is Batch B). Target only, **not approved**.',
  '/queue/[goalId]':
    'Waiting, being called, finishing — thirteen states. The name a screen in a room will read is chosen by the person it is about, before anything is sent. Target only, **not approved**.',
  '/kiosk/[goalId]':
    'The kiosk start screen, 800x1280 portrait — six states. A display with one button: it chooses no movement, shows no QR and runs no contribution. Target only, **not approved**.',
  '/station/[goalId]':
    'The station beside the mat, 1280x800 landscape — fifteen states, including the three that prove no name survives a recorded turn. Target only, **not approved**.',
  '/display/[goalId]':
    'The public display — ten states on four boards (390x844, 800x1280, 1280x800, 1920x1080), a 40-frame matrix. Target only, **not approved**.',
  '/move/[goalId]':
    'The follow-along on its own route — seven states on both layouts. No turn, no queue, nobody called: a timer anybody can start, beside a way to enter what they counted. The player counts nothing. Target only, **not approved**.',
  '/signin':
    'Plus its error state and both pending-destination returns, which are states of this route rather than routes of their own. Target only, **not approved**.',
  '/signup': 'Target only, **not approved**.',
  '/verify-email': 'Target only, **not approved**.',
  '/reset-password': 'Target only, **not approved**.',
  '/profile-setup': 'Target only, **not approved**. Carries an owed truth correction — see that package.',
};

/** What an uncovered route is, so the gap is legible without opening the code. */
const WHAT = {
};

/**
 * THE ATLAS BATCHES, AND THE REASON THIS IS DECLARED RATHER THAN DESCRIBED.
 *
 * The prose that used to live in ROUTE-TARGET-INDEX.md said "Batches B-F are
 * not started" while B, C, D, E, F and G were shipping underneath it. The
 * route tables were generated and correct; the section below them was hand-
 * written and stale, which is the same failure the generated tables were
 * introduced to end, one heading further down the page.
 *
 * So the batch table, the device table and the state-to-file mapping are all
 * derived now: the ROUTES and the review status are declared here, and every
 * COUNT comes from the PNGs actually on disk. A batch that loses its frames
 * stops claiming them.
 */
const BATCHES = [
  {
    key: 'A',
    title: 'Identity and onboarding',
    dir: 'batch-a-identity',
    routes: ['/signin', '/signup', '/verify-email', '/reset-password', '/profile-setup'],
    status: '**reviewed & accepted** as target reference · NOT implemented',
  },
  {
    key: 'B',
    title: 'The invitation, and what a Champion starts',
    dir: 'batch-b-join-and-setup',
    routes: ['/join/[joinCode]', '/start-community', '/goals/new', '/combined/[setupId]'],
    status: '**reviewed & accepted** as target reference · NOT implemented',
  },
  {
    key: 'C',
    title: 'The challenge, and the door',
    dir: 'batch-c-challenge-and-door',
    routes: ['/community/[groupId]/challenge', '/'],
    status: '**reviewed & accepted** as target reference · NOT implemented',
  },
  {
    key: 'D',
    title: 'The event and the line, on your own phone',
    dir: 'batch-d-event-and-line',
    routes: ['/event/[goalId]', '/queue/[goalId]'],
    status: '**reviewed & accepted** as target reference · NOT implemented',
  },
  {
    key: 'E',
    title: 'The screens in the room',
    dir: 'batch-e-room-screens',
    routes: ['/kiosk/[goalId]', '/contribute/[goalId]?kiosk=1', '/station/[goalId]'],
    status: '**reviewed & accepted** as target reference · NOT implemented',
  },
  {
    key: 'F',
    title: 'The public display',
    dir: 'batch-f-public-display',
    routes: ['/display/[goalId]'],
    status: '**reviewed & accepted** as target reference · NOT implemented',
  },
  {
    key: 'G',
    title: 'The follow-along',
    dir: 'batch-g-follow-along',
    routes: ['/move/[goalId]'],
    status: '**reviewed & accepted** as target reference · NOT implemented',
  },
];

/** Boards that are not a route's destination target. */
const BOARDS = [
  {
    key: 'FLOW',
    title: 'The physical product, end to end',
    dir: 'physical-flow',
    routes: ['(no single route — the whole journey)'],
    status: '**reviewed & accepted** as target reference · NOT implemented',
  },
];

/** The page packages, which are NOT atlas drawings and must not be counted as
 * though they were. Their review state is a human act, so it is declared. */
const PAGES = [
  { page: '1', title: 'Home', dir: 'page-01-home', routes: ['/community/[groupId]'], status: 'implemented, **accepted**' },
  { page: '2', title: 'MOVE and contribution', dir: 'page-02-move', routes: ['/move', '/contribute/[goalId]'], status: 'implemented, **accepted**' },
  { page: '3', title: 'Community', dir: 'page-03-community', routes: ['/community'], status: 'implemented, **accepted**' },
  { page: '4', title: 'Progress', dir: 'page-04-progress', routes: ['/activity'], status: 'implemented (Phase A), **accepted**' },
  { page: '5', title: 'You', dir: 'page-05-you', routes: ['/you'], status: '**target accepted** · implementation in progress' },
];

/**
 * Reads a package directory and returns what is actually drawn in it.
 * Frame names are `TARGET-<state>-<class>[-end].png`; the class is the trailing
 * NNNxNNN. Anything that does not parse is returned in `unparsed` rather than
 * silently dropped, because a frame nobody can attribute to a state is exactly
 * the kind of thing a coverage count should refuse to hide.
 */
function readPackage(dir) {
  const full = path.join(REVIEW, dir);
  let files = [];
  try {
    files = readdirSync(full).filter((f) => f.endsWith('.png')).sort();
  } catch {
    return { missing: true, states: new Map(), classes: new Map(), sheets: [], unparsed: [], frames: 0 };
  }
  const states = new Map();
  const classes = new Map();
  const sheets = [];
  const unparsed = [];
  for (const f of files) {
    if (!f.startsWith('TARGET-')) {
      sheets.push(f);
      continue;
    }
    const m = /^TARGET-(.+)-(\d+x\d+)(-end)?\.png$/.exec(f);
    if (!m) {
      unparsed.push(f);
      continue;
    }
    const [, state, cls, end] = m;
    if (!states.has(state)) states.set(state, []);
    states.get(state).push({ file: f, cls, end: Boolean(end) });
    classes.set(cls, (classes.get(cls) ?? 0) + 1);
  }
  return { missing: false, states, classes, sheets, unparsed, frames: files.length };
}

/** Implemented against an APPROVED target. Approval is a human act, so it is declared. */
const IMPLEMENTED = ['/community/[groupId]', '/move', '/contribute/[goalId]', '/community', '/activity'];

function routes(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...routes(full, `${prefix}/${entry}`));
    } else if (entry.endsWith('.tsx') && entry !== '_layout.tsx') {
      const base = entry.replace(/\.tsx$/, '');
      out.push(base === 'index' ? prefix || '/' : `${prefix}/${base}`);
    }
  }
  return out;
}

const REVIEW = path.resolve(process.cwd(), 'docs/design-target/review');

const all = routes(APP).sort();
const facing = all.filter((r) => !EXCLUDED(r));
const covered = facing.filter((r) => TARGETS[r]);
const uncovered = facing.filter((r) => !TARGETS[r]);

// A declared target for a route that no longer exists is a stale register.
const orphans = Object.keys(TARGETS).filter((r) => !facing.includes(r));

/*
  MARKDOWN MODE. The route tables in ROUTE-TARGET-INDEX.md are GENERATED from
  here — `--markdown` prints them, `--check` fails if the committed document
  does not match. Hand-maintaining two tables is how three routes came to be
  listed as covered AND as not covered at the same time.
*/
const BEGIN = '<!-- BEGIN GENERATED ROUTES -->';
const END = '<!-- END GENERATED ROUTES -->';

function markdown() {
  const lines = [];
  lines.push(BEGIN);
  lines.push('');
  lines.push('> Generated by `node scripts/westayfit/route-target-coverage.mjs --markdown`.');
  lines.push('> Do not hand-edit between the markers; `npm run wsf:route-coverage -- --check`');
  lines.push('> fails if this block and the route tree disagree.');
  lines.push('');
  lines.push('| | |');
  lines.push('| --- | --- |');
  lines.push(`| User-facing routes | **${facing.length}** |`);
  lines.push(`| Routes with a real-RN target | **${covered.length}** |`);
  lines.push(`| Routes with no target | **${uncovered.length}** |`);
  lines.push(`| Routes implemented against an approved target | **${IMPLEMENTED.length}** |`);
  lines.push('');
  lines.push('### Covered — a real-RN target exists');
  lines.push('');
  lines.push('| Route | Target package | Notes |');
  lines.push('| --- | --- | --- |');
  for (const r of covered) {
    lines.push(`| \`${r}\` | \`${TARGETS[r]}\` | ${NOTES[r] ?? ''} |`);
  }
  lines.push('');
  lines.push('### Not covered — no target of any kind');
  lines.push('');
  if (uncovered.length === 0) {
    lines.push('None. Every user-facing route has a target.');
  } else {
    lines.push('| Route | What it is |');
    lines.push('| --- | --- |');
    for (const r of uncovered) lines.push(`| \`${r}\` | ${WHAT[r] ?? ''} |`);
  }
  lines.push('');
  lines.push(END);
  return lines.join('\n');
}

const ATLAS_BEGIN = '<!-- BEGIN GENERATED ATLAS -->';
const ATLAS_END = '<!-- END GENERATED ATLAS -->';

/** Everything the packages on disk actually contain, read once. */
const packages = [
  ...BATCHES.map((b) => ({ ...b, kind: 'batch', pkg: readPackage(b.dir) })),
  ...BOARDS.map((b) => ({ ...b, kind: 'board', pkg: readPackage(b.dir) })),
  ...PAGES.map((p) => ({ ...p, kind: 'page', pkg: readPackage(p.dir) })),
];

/** Device class -> how many frames are drawn at it, across the whole atlas. */
function deviceTally() {
  const tally = new Map();
  for (const entry of packages) {
    for (const [cls, n] of entry.pkg.classes) {
      tally.set(cls, (tally.get(cls) ?? 0) + n);
    }
  }
  return tally;
}

/** The batch / device / state block that replaces the prose that rotted. */
function atlasMarkdown() {
  const L = [];
  L.push(ATLAS_BEGIN);
  L.push('');
  L.push('> Generated by `node scripts/westayfit/route-target-coverage.mjs --write`.');
  L.push('> Every count below is read from the PNGs on disk, not declared. Do not');
  L.push('> hand-edit between these markers — the prose that used to sit here said');
  L.push('> "Batches B–F are not started" while six of them were shipping underneath it.');
  L.push('');
  L.push('### The atlas batches');
  L.push('');
  L.push('| Batch | What it covers | Routes | States | Frames | Classes | State |');
  L.push('| --- | --- | ---: | ---: | ---: | --- | --- |');
  for (const b of packages.filter((e) => e.kind === 'batch')) {
    const cls = [...b.pkg.classes.keys()].sort().join(' · ') || '—';
    const missing = b.pkg.missing ? ' **package missing**' : '';
    L.push(
      `| **${b.key}** | ${b.title} | ${b.routes.length} | ${b.pkg.states.size} | ${b.pkg.frames} | ${cls} | ${b.status}${missing} |`
    );
  }
  L.push('');
  L.push('### Boards');
  L.push('');
  L.push('| Board | What | Frames | State |');
  L.push('| --- | --- | ---: | --- |');
  for (const b of packages.filter((e) => e.kind === 'board')) {
    L.push(`| **${b.key}** | ${b.title} | ${b.pkg.frames} | ${b.status} |`);
  }
  L.push('');
  L.push('### The page packages — accepted work, not atlas drawings');
  L.push('');
  L.push('| Page | What | Route(s) | Frames | State |');
  L.push('| --- | --- | --- | ---: | --- |');
  for (const p of packages.filter((e) => e.kind === 'page')) {
    L.push(
      `| ${p.page} | ${p.title} | ${p.routes.map((r) => `\`${r}\``).join(' ')} | ${p.pkg.frames} | ${p.status} |`
    );
  }
  L.push('');
  L.push('### Device classes, by frames actually drawn');
  L.push('');
  L.push('| Class | Frames |');
  L.push('| --- | ---: |');
  for (const [cls, n] of [...deviceTally()].sort()) L.push(`| ${cls} | ${n} |`);
  L.push('');
  L.push('The full **state → file** and **device → file** mapping is generated into');
  L.push('`ATLAS-COVERAGE.md` beside this file. A route count alone cannot prove');
  L.push('atlas completion, so that mapping names every state and the frames that');
  L.push('back it.');
  L.push('');
  const unparsed = packages.flatMap((e) => e.pkg.unparsed);
  if (unparsed.length) {
    L.push(`**${unparsed.length} frame(s) could not be attributed to a state:** ` +
      unparsed.map((f) => `\`${f}\``).join(', ') + '.');
    L.push('');
  }
  L.push(ATLAS_END);
  return L.join('\n');
}

/** The exhaustive mapping, its own file because it is long by design. */
const COVERAGE_DOC = path.resolve(process.cwd(), 'docs/design-target/ATLAS-COVERAGE.md');
const ATLAS_DOC = path.resolve(process.cwd(), 'docs/design-target/ATLAS.md');
const SUMMARY_BEGIN = '<!-- BEGIN GENERATED SUMMARY -->';
const SUMMARY_END = '<!-- END GENERATED SUMMARY -->';

/**
 * The headline counts, generated into ATLAS.md.
 *
 * They were typed there, and drifted the moment a capture added six frames:
 * ATLAS.md said 513 while the index said 519. A number a person types is a
 * number that rots, which is the whole reason the tables below it are
 * generated — the summary had simply been left out of that.
 */
function summaryMarkdown() {
  const states = packages.reduce((n, e) => n + e.pkg.states.size, 0);
  const frames = packages.reduce((n, e) => n + e.pkg.frames, 0);
  const L = [];
  L.push(SUMMARY_BEGIN);
  L.push('');
  L.push(`| | |`);
  L.push(`| --- | ---: |`);
  L.push(`| User-facing routes | **${facing.length}** |`);
  L.push(`| Routes with a target | **${covered.length}** |`);
  L.push(`| Routes with no target | **${uncovered.length}** |`);
  L.push(`| States drawn | **${states}** |`);
  L.push(`| Frames on disk | **${frames}** |`);
  L.push(`| Packages | **${packages.length}** |`);
  L.push('');
  L.push(SUMMARY_END);
  return L.join('\n');
}

function coverageMarkdown() {
  const L = [];
  L.push('# Atlas coverage — every state, and the frames that back it');
  L.push('');
  L.push('**Generated.** `node scripts/westayfit/route-target-coverage.mjs --write`.');
  L.push('Read from the PNGs on disk. Do not hand-edit.');
  L.push('');
  L.push('A route count cannot prove atlas completion: a route with one frame and a');
  L.push('route with thirty both count as "covered". This file is the answer to that');
  L.push('— every state by name, the device classes it is drawn at, and whether it');
  L.push('carries an end-of-scroll companion.');
  L.push('');
  L.push('`end` means the state overflows its frame and a second frame was captured');
  L.push('scrolled to the bottom. Batches E and F have none by design: a kiosk, a');
  L.push('station and a public display are fixed canvases with no scroll.');
  L.push('');
  for (const e of packages) {
    const head =
      e.kind === 'batch'
        ? `Batch ${e.key} — ${e.title}`
        : e.kind === 'board'
          ? `Board — ${e.title}`
          : `Page ${e.page} — ${e.title}`;
    L.push(`## ${head}`);
    L.push('');
    L.push(`\`review/${e.dir}/\` · ${e.routes.map((r) => `\`${r}\``).join(' ')} · ${e.status}`);
    L.push('');
    if (e.pkg.missing) {
      L.push('**The package directory is missing.**');
      L.push('');
      continue;
    }
    if (e.pkg.sheets.length) {
      L.push(`Contact sheet / other: ${e.pkg.sheets.map((f) => `\`${f}\``).join(', ')}`);
      L.push('');
    }
    if (e.pkg.states.size === 0) {
      L.push('_No `TARGET-` frames in this package._');
      L.push('');
      continue;
    }
    L.push('| State | Classes | end | Files |');
    L.push('| --- | --- | :---: | ---: |');
    for (const [state, frames] of [...e.pkg.states].sort()) {
      const cls = [...new Set(frames.filter((f) => !f.end).map((f) => f.cls))].sort().join(' · ');
      const hasEnd = frames.some((f) => f.end) ? 'yes' : '';
      L.push(`| \`${state}\` | ${cls} | ${hasEnd} | ${frames.length} |`);
    }
    L.push('');
  }
  L.push('## Device → frames');
  L.push('');
  L.push('| Class | Frames | Packages |');
  L.push('| --- | ---: | --- |');
  const byClass = new Map();
  for (const e of packages) {
    for (const [cls, n] of e.pkg.classes) {
      if (!byClass.has(cls)) byClass.set(cls, { n: 0, where: [] });
      const row = byClass.get(cls);
      row.n += n;
      row.where.push(e.kind === 'batch' ? e.key : e.kind === 'board' ? e.key : `P${e.page}`);
    }
  }
  for (const [cls, row] of [...byClass].sort()) {
    L.push(`| ${cls} | ${row.n} | ${row.where.join(' · ')} |`);
  }
  L.push('');
  return L.join('\n');
}

const DOC = path.resolve(process.cwd(), 'docs/design-target/ROUTE-TARGET-INDEX.md');

if (process.argv.includes('--markdown')) {
  console.log(markdown());
  process.exit(orphans.length ? 1 : 0);
}

if (process.argv.includes('--check')) {
  const doc = readFileSync(DOC, 'utf8');
  const a = doc.indexOf(BEGIN);
  const b = doc.indexOf(END);
  if (a < 0 || b < 0) {
    console.error('ROUTE-TARGET-INDEX.md has no generated block. Run --write.');
    process.exit(1);
  }
  const current = doc.slice(a, b + END.length);
  if (current.trim() !== markdown().trim()) {
    console.error('ROUTE-TARGET-INDEX.md route block is out of date. Run:');
    console.error('  node scripts/westayfit/route-target-coverage.mjs --write');
    process.exit(1);
  }
  const c = doc.indexOf(ATLAS_BEGIN);
  const d = doc.indexOf(ATLAS_END);
  if (c < 0 || d < 0) {
    console.error('ROUTE-TARGET-INDEX.md has no generated ATLAS block. Run --write.');
    process.exit(1);
  }
  if (doc.slice(c, d + ATLAS_END.length).trim() !== atlasMarkdown().trim()) {
    console.error('ROUTE-TARGET-INDEX.md atlas block is out of date (frames on disk changed). Run:');
    console.error('  node scripts/westayfit/route-target-coverage.mjs --write');
    process.exit(1);
  }
  let coverage = '';
  try {
    coverage = readFileSync(COVERAGE_DOC, 'utf8');
  } catch {
    console.error('ATLAS-COVERAGE.md is missing. Run --write.');
    process.exit(1);
  }
  if (coverage.trim() !== coverageMarkdown().trim()) {
    console.error('ATLAS-COVERAGE.md is out of date. Run --write.');
    process.exit(1);
  }
  const atlas = readFileSync(ATLAS_DOC, 'utf8');
  const e0 = atlas.indexOf(SUMMARY_BEGIN);
  const e1 = atlas.indexOf(SUMMARY_END);
  if (e0 < 0 || e1 < 0) {
    console.error('ATLAS.md has no generated SUMMARY block. Run --write.');
    process.exit(1);
  }
  if (atlas.slice(e0, e1 + SUMMARY_END.length).trim() !== summaryMarkdown().trim()) {
    console.error('ATLAS.md summary counts disagree with the frames on disk. Run --write.');
    process.exit(1);
  }
  const states = packages.reduce((n, e) => n + e.pkg.states.size, 0);
  const frames = packages.reduce((n, e) => n + e.pkg.frames, 0);
  console.log(
    `route index is current — ${facing.length} routes, ${covered.length} covered, ${uncovered.length} not; ` +
      `${states} states, ${frames} frames across ${packages.length} packages`
  );
  process.exit(orphans.length ? 1 : 0);
}

if (process.argv.includes('--write')) {
  const doc = readFileSync(DOC, 'utf8');
  const a = doc.indexOf(BEGIN);
  const b = doc.indexOf(END);
  if (a < 0 || b < 0) {
    console.error('ROUTE-TARGET-INDEX.md has no generated block to write into.');
    process.exit(1);
  }
  let next = doc.slice(0, a) + markdown() + doc.slice(b + END.length);
  const c = next.indexOf(ATLAS_BEGIN);
  const d = next.indexOf(ATLAS_END);
  if (c < 0 || d < 0) {
    console.error('ROUTE-TARGET-INDEX.md has no generated ATLAS block to write into.');
    process.exit(1);
  }
  next = next.slice(0, c) + atlasMarkdown() + next.slice(d + ATLAS_END.length);
  writeFileSync(DOC, next);
  writeFileSync(COVERAGE_DOC, coverageMarkdown());
  const atlas = readFileSync(ATLAS_DOC, 'utf8');
  const e0 = atlas.indexOf(SUMMARY_BEGIN);
  const e1 = atlas.indexOf(SUMMARY_END);
  if (e0 < 0 || e1 < 0) {
    console.error('ATLAS.md has no generated SUMMARY block to write into.');
    process.exit(1);
  }
  writeFileSync(
    ATLAS_DOC,
    atlas.slice(0, e0) + summaryMarkdown() + atlas.slice(e1 + SUMMARY_END.length)
  );
  const states = packages.reduce((n, e) => n + e.pkg.states.size, 0);
  const frames = packages.reduce((n, e) => n + e.pkg.frames, 0);
  console.log(
    `route index rewritten — ${facing.length} routes, ${covered.length} covered, ${uncovered.length} not; ` +
      `${states} states, ${frames} frames across ${packages.length} packages`
  );
  process.exit(orphans.length ? 1 : 0);
}

console.log(`User-facing routes        ${facing.length}`);
console.log(`With a real-RN target     ${covered.length}`);
console.log(`With no target            ${uncovered.length}`);
console.log(`Implemented vs approved   ${IMPLEMENTED.length}`);
console.log('');
console.log('COVERED');
for (const r of covered) console.log(`  ${r.padEnd(32)} ${TARGETS[r]}`);
console.log('');
console.log('NOT COVERED');
for (const r of uncovered) console.log(`  ${r}`);
if (orphans.length) {
  console.log('');
  console.log('STALE REGISTER ENTRIES (target declared, route gone)');
  for (const r of orphans) console.log(`  ${r}`);
  process.exitCode = 1;
}
