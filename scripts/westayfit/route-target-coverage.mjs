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
    'Contribution entry, review, and all six outcomes. **Implemented and accepted.**',
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
  '/signin':
    'Plus its error state and both pending-destination returns, which are states of this route rather than routes of their own. Target only, **not approved**.',
  '/signup': 'Target only, **not approved**.',
  '/verify-email': 'Target only, **not approved**.',
  '/reset-password': 'Target only, **not approved**.',
  '/profile-setup': 'Target only, **not approved**. Carries an owed truth correction — see that package.',
};

/** What an uncovered route is, so the gap is legible without opening the code. */
const WHAT = {
  '/display/[goalId]': 'Public / shared display, phone through 1920x1080',
  '/kiosk/[goalId]': 'Kiosk — tablet portrait',
  '/move/[goalId]': 'Movement / player route',
  '/station/[goalId]': 'Station — tablet landscape',
};

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
    console.error('ROUTE-TARGET-INDEX.md is out of date. Run:');
    console.error('  node scripts/westayfit/route-target-coverage.mjs --write');
    process.exit(1);
  }
  console.log(`route index is current — ${facing.length} routes, ${covered.length} covered, ${uncovered.length} not`);
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
  writeFileSync(DOC, doc.slice(0, a) + markdown() + doc.slice(b + END.length));
  console.log(`route index rewritten — ${facing.length} routes, ${covered.length} covered, ${uncovered.length} not`);
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
