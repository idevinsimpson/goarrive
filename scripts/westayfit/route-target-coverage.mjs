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
import { readdirSync, statSync } from 'node:fs';
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
  '/goals/new': 'review/page-02-move/',
  '/signin': 'review/batch-a-identity/',
  '/signup': 'review/batch-a-identity/',
  '/verify-email': 'review/batch-a-identity/',
  '/reset-password': 'review/batch-a-identity/',
  '/profile-setup': 'review/batch-a-identity/',
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
