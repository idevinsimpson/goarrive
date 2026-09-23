#!/usr/bin/env node
/**
 * The two-checkout hosting check.
 *
 * The cases that matter are the two real defects this exists because of — a
 * specific route quietly swallowed by a catch-all, and a route matched by
 * nothing at all — plus the one that must NOT fail: an operational rewrite for
 * a page an older rollback candidate never built.
 *
 * Fixtures are built on disk rather than mocked, because the thing under test
 * is what two checkouts and a build directory say together.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CHECK = path.resolve('.github/wsf-staging/check-hosting-routes.mjs');
let passed = 0;

/** The rewrite list the served candidate `c8f38e3` declares. */
const C8_REWRITES = [
  { source: '/community/*/challenge', destination: '/community/__dynamic/challenge.html' },
  { source: '/community/**', destination: '/community/__dynamic.html' },
  { source: '/move/**', destination: '/move/__dynamic.html' },
];
/** `37367fd` adds the members page. */
const MEMBERS = { source: '/community/*/members', destination: '/community/__dynamic/members.html' };

const PAGES_C8 = ['community/__dynamic/challenge.html', 'community/__dynamic.html', 'move/__dynamic.html'];
const PAGES_37 = [...PAGES_C8, 'community/__dynamic/members.html'];

function tree({ candidateRewrites, opsRewrites, pages, omitDist = false, opsRaw, candidateRaw }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-routes-'));
  const app = path.join(dir, 'app');
  const ops = path.join(dir, 'ops');
  fs.mkdirSync(app, { recursive: true });
  fs.mkdirSync(ops, { recursive: true });
  fs.writeFileSync(
    path.join(app, 'firebase.westayfit.json'),
    candidateRaw ?? JSON.stringify({ hosting: { site: 'westayfit-app', rewrites: candidateRewrites } })
  );
  fs.writeFileSync(
    path.join(ops, 'firebase.westayfit.staging.json'),
    opsRaw ?? JSON.stringify({
      hosting: {
        site: 'westayfit-staging',
        headers: [{ source: '/**', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }],
        rewrites: opsRewrites,
      },
      functions: [{ source: 'functions-westayfit', codebase: 'westayfit' }],
    })
  );
  if (!omitDist) {
    const dist = path.join(app, 'apps/westayfit/dist');
    for (const page of pages ?? []) {
      const full = path.join(dist, page);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, '<html></html>');
    }
    fs.mkdirSync(dist, { recursive: true });
  }
  return { dir, app, ops };
}

function run({ app, ops }) {
  const r = spawnSync(process.execPath, [CHECK, app, ops], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
async function test(name, f) { await f(); passed += 1; console.log(`  ok  ${name}`); }

await test('the served candidate passes against the corrected operational config', async () => {
  const t = tree({ candidateRewrites: C8_REWRITES, opsRewrites: [C8_REWRITES[0], MEMBERS, C8_REWRITES[1], C8_REWRITES[2]], pages: PAGES_C8 });
  const r = run(t);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /ROUTES=pass/);
  // The members rewrite points at a page c8f38e3 never built. That is a NOTE,
  // never a failure — a rollback to this candidate must not be blocked by a
  // route it never had.
  assert.match(r.out, /note: operational rewrite \/community\/\*\/members points at \/community\/__dynamic\/members\.html, which this candidate does not build/);
});

await test('DEFECT 1: a members page the catch-all swallows is caught', async () => {
  // 37367fd builds members.html; the operational list has only the catch-all,
  // which is exactly what main 340e141 looked like. The page is built and
  // nothing routes to it, and a request resolves to the community home.
  const t = tree({
    candidateRewrites: [C8_REWRITES[0], MEMBERS, C8_REWRITES[1], C8_REWRITES[2]],
    opsRewrites: [C8_REWRITES[0], C8_REWRITES[1], C8_REWRITES[2]],
    pages: PAGES_37,
  });
  const r = run(t);
  assert.equal(r.code, 1);
  assert.match(r.err, /the candidate builds \/community\/__dynamic\/members\.html and the operational config routes nothing to it/);
  assert.match(r.err, /\/community\/\*\/members .*matches no operational rewrite|resolves to/);
});

await test('DEFECT 2: a route matched by nothing at all is caught', async () => {
  // /move/** absent operationally, which is what main 340e141 actually was.
  const t = tree({
    candidateRewrites: C8_REWRITES,
    opsRewrites: [C8_REWRITES[0], C8_REWRITES[1]],
    pages: PAGES_C8,
  });
  const r = run(t);
  assert.equal(r.code, 1);
  assert.match(r.err, /the candidate builds \/move\/__dynamic\.html and the operational config routes nothing to it/);
  assert.match(r.err, /\/move\/\*\* is declared by the candidate and matches no operational rewrite/);
});

await test('PRECEDENCE: a specific rule placed after the catch-all is caught, though present', async () => {
  // The rule exists, its destination is right, and it is unreachable. Presence
  // alone would have passed this.
  const t = tree({
    candidateRewrites: [C8_REWRITES[0], MEMBERS, C8_REWRITES[1], C8_REWRITES[2]],
    opsRewrites: [C8_REWRITES[0], C8_REWRITES[1], MEMBERS, C8_REWRITES[2]],
    pages: PAGES_37,
  });
  const r = run(t);
  assert.equal(r.code, 1);
  assert.match(r.err, /\/community\/\*\/members resolves to \/community\/__dynamic\.html operationally \(via \/community\/\*\*\)/);
});

await test('SHADOWING, ONE SEGMENT: a /move/* rule ahead of /move/** is caught', async () => {
  // Every real MOVE address has ONE segment after the prefix: /move/<goalId>.
  // A rule matching exactly that shape, placed ahead of the candidate's
  // /move/**, serves every real MOVE page something else. Asking only a
  // two-segment sample never reaches it, which is how this passed before.
  const t = tree({
    candidateRewrites: C8_REWRITES,
    opsRewrites: [C8_REWRITES[0], C8_REWRITES[1], { source: '/move/*', destination: '/index.html' }, C8_REWRITES[2]],
    pages: PAGES_C8,
  });
  const r = run(t);
  assert.equal(r.code, 1, r.out);
  assert.match(r.err, /\/move\/\*\* resolves to \/index\.html operationally \(via \/move\/\*\) for \/move\/__seg__, but the candidate declares \/move\/__dynamic\.html/);
});

await test('SHADOWING, ONE SEGMENT: a single /*/* ahead of every ** rule is caught for each', async () => {
  // One broad rule mis-serves the one-segment address of every ** route at
  // once. Each must be named, not just the first.
  const t = tree({
    candidateRewrites: C8_REWRITES,
    opsRewrites: [{ source: '/*/*', destination: '/index.html' }, ...C8_REWRITES],
    pages: PAGES_C8,
  });
  const r = run(t);
  assert.equal(r.code, 1, r.out);
  assert.match(r.err, /\/community\/\*\* resolves to \/index\.html operationally \(via \/\*\/\*\) for \/community\/__seg__/);
  assert.match(r.err, /\/move\/\*\* resolves to \/index\.html operationally \(via \/\*\/\*\) for \/move\/__seg__/);
});

await test('SHADOWING, TWO SEGMENTS: a rule capturing only deeper addresses is still caught', async () => {
  // The two-segment sample is kept alongside the one-segment one. Drop it and
  // a rule like /move/*/* placed ahead of /move/** goes unasked.
  const t = tree({
    candidateRewrites: C8_REWRITES,
    opsRewrites: [C8_REWRITES[0], C8_REWRITES[1], { source: '/move/*/*', destination: '/index.html' }, C8_REWRITES[2]],
    pages: PAGES_C8,
  });
  const r = run(t);
  assert.equal(r.code, 1, r.out);
  assert.match(r.err, /\/move\/\*\* resolves to \/index\.html operationally \(via \/move\/\*\/\*\) for \/move\/__seg_a__\/__seg_b__/);
});

await test('a rule that fails in both shapes is counted once, not once per shape', async () => {
  // The count is part of the receipt: the real-config matrix reads failed (2)
  // for c8f38e3 against the old operational config, and asking two shapes
  // must not turn one missing /move/** into two findings.
  const t = tree({
    candidateRewrites: C8_REWRITES,
    opsRewrites: [C8_REWRITES[0], C8_REWRITES[1], { source: '/move/**', destination: '/index.html' }],
    pages: PAGES_C8,
  });
  const r = run(t);
  assert.equal(r.code, 1, r.out);
  assert.match(r.err, /ROUTES=failed \(2\)/);
  assert.equal((r.err.match(/\/move\/\*\* resolves to/g) || []).length, 1);

  // And a rule matched by nothing at all: the DEFECT 2 shape, which is the
  // c8f38e3 cell of the real matrix.
  const missing = run(tree({ candidateRewrites: C8_REWRITES, opsRewrites: [C8_REWRITES[0], C8_REWRITES[1]], pages: PAGES_C8 }));
  assert.equal(missing.code, 1, missing.out);
  assert.match(missing.err, /ROUTES=failed \(2\)/);
  assert.equal((missing.err.match(/matches no operational rewrite/g) || []).length, 1);
});

await test('a destination that differs between the two files is caught', async () => {
  const t = tree({
    candidateRewrites: C8_REWRITES,
    opsRewrites: [C8_REWRITES[0], C8_REWRITES[1], { source: '/move/**', destination: '/move.html' }],
    pages: PAGES_C8,
  });
  const r = run(t);
  assert.equal(r.code, 1);
  assert.match(r.err, /the candidate builds \/move\/__dynamic\.html and the operational config routes nothing to it/);
});

await test("a rewrite whose page the candidate's own build does not contain is caught", async () => {
  const t = tree({
    candidateRewrites: [C8_REWRITES[0], MEMBERS, C8_REWRITES[1], C8_REWRITES[2]],
    opsRewrites: [C8_REWRITES[0], MEMBERS, C8_REWRITES[1], C8_REWRITES[2]],
    pages: PAGES_C8, // members.html missing from the build
  });
  const r = run(t);
  assert.equal(r.code, 1);
  assert.match(r.err, /the candidate declares \/community\/\*\/members -> \/community\/__dynamic\/members\.html, which its own build does not contain/);
});

await test('deliberate differences between the two files are not compared', async () => {
  // Different site, different headers, an extra functions block, a different
  // ignore list — none of it is a rewrite, and none of it may fail a deploy.
  const t = tree({ candidateRewrites: C8_REWRITES, opsRewrites: C8_REWRITES, pages: PAGES_C8 });
  const r = run(t);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /ROUTES=pass/);
  assert.match(r.out, /CANDIDATE_REWRITES=3\nOPERATIONAL_REWRITES=3\nBUILT_DYNAMIC_PAGES=3/);
});

await test('a missing operational config is an error, not an empty rewrite list', async () => {
  const t = tree({ candidateRewrites: C8_REWRITES, opsRewrites: C8_REWRITES, pages: PAGES_C8 });
  fs.rmSync(path.join(t.ops, 'firebase.westayfit.staging.json'));
  const r = run(t);
  assert.equal(r.code, 1);
  assert.match(r.err, /ROUTES=error \(required input unreadable\)/);
});

await test('a malformed operational config is an error', async () => {
  const t = tree({ candidateRewrites: C8_REWRITES, opsRewrites: C8_REWRITES, pages: PAGES_C8, opsRaw: '{ not json' });
  const r = run(t);
  assert.equal(r.code, 1);
  assert.match(r.err, /ROUTES=error \(required input malformed\)/);
});

await test('a non-array rewrites is an error, never treated as none', async () => {
  const t = tree({
    candidateRewrites: C8_REWRITES,
    opsRewrites: [],
    pages: PAGES_C8,
    opsRaw: JSON.stringify({ hosting: { site: 'x', rewrites: 'all of them' } }),
  });
  const r = run(t);
  assert.equal(r.code, 1);
  assert.match(r.err, /non-array rewrites/);
});

await test('a missing build directory is an error', async () => {
  const t = tree({ candidateRewrites: C8_REWRITES, opsRewrites: C8_REWRITES, omitDist: true });
  const r = run(t);
  assert.equal(r.code, 1);
  assert.match(r.err, /the built artifact is missing/);
});

await test('a candidate with no rewrites at all still has its built pages checked', async () => {
  // The candidate's own config being empty must not read as "nothing is
  // required": the build's aliases are the ground truth, and this is the shape
  // main and the ops branch actually have.
  const t = tree({ candidateRewrites: [], opsRewrites: [], pages: PAGES_C8 });
  const r = run(t);
  assert.equal(r.code, 1);
  assert.match(r.err, /routes nothing to it/);
});

console.log(`\ncheck-hosting-routes: ${passed} passed`);
