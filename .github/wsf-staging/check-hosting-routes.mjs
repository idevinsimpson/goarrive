#!/usr/bin/env node
/**
 * Does the OPERATIONAL hosting config actually route the candidate's pages?
 *
 * WHY THIS EXISTS. The rewrites that make a dynamic route survive a direct load
 * or a refresh live in TWO files that no checkout holds together:
 *
 *   the candidate's  app/firebase.westayfit.json     — reviewed with the app
 *   the operational  ops/firebase.westayfit.staging.json  — reviewed on main,
 *                    copied into the candidate checkout at deploy time, and the
 *                    one the staging deploy actually uses
 *
 * Their own comments say "Keep the two in sync", and nothing enforced it. Two
 * rules had gone missing from the operational copy while being present on the
 * candidate: `/community/*` + `/members`, which the `/community/**` catch-all
 * then served the community HOME document for, and `/move/**`, which matched
 * nothing at all and fell through to a 404. Neither was caught, and neither
 * could have been: `scripts/westayfit/inject_meta.py` DOES fail a build whose
 * dynamic route has no rewrite, but it reads `firebase.westayfit.json` — the
 * candidate's file — so it cannot see an omission in the operational one.
 *
 * The deploy job is the first and only place both checkouts and the built
 * artifact exist together, so the check belongs there, and before the
 * credential: nothing here needs one.
 *
 * WHAT IT IS NOT. Not a whole-config comparison. The two files differ
 * deliberately — site, project, headers, ignore lists — and those differences
 * are the point of having two files. Only rewrites are compared.
 *
 * CANDIDATE-RELATIVE, WHICH IS THE SUBTLE PART. The requirements come from the
 * candidate being deployed, never from the operational file. An operational
 * rewrite the candidate has no page for is a NOTE, not a failure — otherwise
 * the first rollback to an older candidate would fail on a route that candidate
 * never had. That case is live today: the operational config carries
 * a members rewrite while the currently served `c8f38e3` has no members
 * page, and rolling back to it must not be blocked by that.
 *
 * Exit 0 only when every page this candidate builds is reachable.
 */
import fs from 'node:fs';
import path from 'node:path';

const candidateRoot = process.argv[2] || 'app';
const opsRoot = process.argv[3] || 'ops';

const failures = [];
const notes = [];

/** A required input that cannot be read is an error, never an empty result. */
function readJson(file, what) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    console.error(`::error::${what} is missing or unreadable: ${file}`);
    console.error('ROUTES=error (required input unreadable)');
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch {
    console.error(`::error::${what} is not valid JSON: ${file}`);
    console.error('ROUTES=error (required input malformed)');
    process.exit(1);
  }
}

function rewritesOf(config, what, file) {
  const hosting = config?.hosting;
  if (hosting === null || typeof hosting !== 'object' || Array.isArray(hosting)) {
    console.error(`::error::${what} has no hosting object: ${file}`);
    console.error('ROUTES=error (required input malformed)');
    process.exit(1);
  }
  const rewrites = hosting.rewrites ?? [];
  if (!Array.isArray(rewrites)) {
    console.error(`::error::${what} has a non-array rewrites: ${file}`);
    console.error('ROUTES=error (required input malformed)');
    process.exit(1);
  }
  for (const r of rewrites) {
    if (r === null || typeof r !== 'object' || typeof r.source !== 'string' || typeof r.destination !== 'string') {
      console.error(`::error::${what} has a rewrite that is not {source, destination}: ${file}`);
      console.error('ROUTES=error (required input malformed)');
      process.exit(1);
    }
  }
  return rewrites;
}

const candidateFile = path.join(candidateRoot, 'firebase.westayfit.json');
const opsFile = path.join(opsRoot, 'firebase.westayfit.staging.json');
const distDir = path.join(candidateRoot, 'apps/westayfit/dist');

const candidateRewrites = rewritesOf(readJson(candidateFile, "the candidate's hosting config"), "the candidate's hosting config", candidateFile);
const opsRewrites = rewritesOf(readJson(opsFile, 'the operational staging hosting config'), 'the operational staging hosting config', opsFile);

if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
  console.error(`::error::the built artifact is missing: ${distDir}`);
  console.error('ROUTES=error (required input unreadable)');
  process.exit(1);
}

/**
 * Firebase Hosting rewrite matching, and FIRST MATCH WINS — which is the whole
 * reason precedence is checked rather than mere presence. `*` matches within
 * one path segment, `**` across segments.
 */
function toRegExp(source) {
  return new RegExp(
    '^' +
      source
        .split(/(\*\*|\*)/)
        .map((part) =>
          part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        )
        .join('') +
      '$'
  );
}
function firstMatch(rewrites, urlPath) {
  for (const r of rewrites) if (toRegExp(r.source).test(urlPath)) return r;
  return null;
}

/**
 * URLs that the given pattern matches, built from tokens no real rule would
 * also match. A sample like `/community/x/members` would be captured by a MORE
 * SPECIFIC operational rule and report a false mismatch; the point is to ask
 * what this pattern's own traffic resolves to, not to collide with a sibling.
 *
 * A `**` is asked in TWO shapes, one segment and two. Every real dynamic
 * address has one (`/move/<goalId>`), and a rule matching exactly that shape
 * placed ahead of the candidate's `**` rule (`/move/` plus one star, or a
 * broad two-star-segment rule) serves every real page something else, and a
 * two-segment sample alone never reaches it. The two-segment shape stays, so
 * a rule that captures only deeper addresses is still asked about.
 */
function samplesFor(source) {
  const single = (s) => s.replace(/(?<!\*)\*(?!\*)/g, '__seg__');
  if (!source.includes('**')) return [single(source)];
  return [
    single(source.replace(/\*\*/g, '__seg__')),
    single(source.replace(/\*\*/g, '__seg_a__/__seg_b__')),
  ];
}

/** Every built file whose path carries the dynamic-route marker. */
function builtDynamicDestinations(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...builtDynamicDestinations(path.join(dir, entry.name), rel));
    else if (entry.isFile() && entry.name.endsWith('.html') && rel.includes('__dynamic')) out.push(`/${rel}`);
  }
  return out;
}
const built = builtDynamicDestinations(distDir).sort();

// ---- 1. every page this candidate BUILT must be routed -------------------
// The build is the ground truth: inject_meta.py wrote these aliases precisely
// so a direct load could reach them, and an alias nothing routes to is a page
// that 404s on refresh.
for (const destination of built) {
  const routed = opsRewrites.some((r) => r.destination === destination);
  if (!routed) {
    failures.push(`the candidate builds ${destination} and the operational config routes nothing to it`);
  }
}

// ---- 2. every rewrite the CANDIDATE declares must resolve the same way ----
// Presence is not enough: a specific rule placed after a catch-all that would
// swallow it is present and unreachable. Asking what a sample URL resolves to
// answers presence, destination and precedence in one question.
// One failure per declared rule, naming the first sample that went wrong: a
// rule missing outright fails every shape, and counting it once per shape
// would change nothing but the number.
for (const wanted of candidateRewrites) {
  for (const sample of samplesFor(wanted.source)) {
    const got = firstMatch(opsRewrites, sample);
    if (!got) {
      failures.push(`${wanted.source} is declared by the candidate and matches no operational rewrite (for ${sample})`);
      break;
    }
    if (got.destination !== wanted.destination) {
      failures.push(
        `${wanted.source} resolves to ${got.destination} operationally (via ${got.source}) for ${sample}, ` +
          `but the candidate declares ${wanted.destination}`
      );
      break;
    }
  }
}

// ---- 3. a destination that this candidate did not build -------------------
// A NOTE and never a failure: this is what a rollback to an older candidate
// looks like from the operational side, and failing here would block it.
for (const r of opsRewrites) {
  if (!r.destination.includes('__dynamic')) continue;
  if (!built.includes(r.destination)) {
    notes.push(`operational rewrite ${r.source} points at ${r.destination}, which this candidate does not build`);
  }
}

// ---- 4. a dynamic route with no page at all ------------------------------
// The candidate declaring a rewrite whose destination it never built is the
// candidate's own defect, and it is worth naming here because the deploy is
// about to publish it.
for (const wanted of candidateRewrites) {
  if (!wanted.destination.includes('__dynamic')) continue;
  if (!built.includes(wanted.destination)) {
    failures.push(`the candidate declares ${wanted.source} -> ${wanted.destination}, which its own build does not contain`);
  }
}

console.log(`CANDIDATE_REWRITES=${candidateRewrites.length}`);
console.log(`OPERATIONAL_REWRITES=${opsRewrites.length}`);
console.log(`BUILT_DYNAMIC_PAGES=${built.length}`);
for (const n of notes) console.log(`note: ${n}`);

if (failures.length) {
  for (const f of failures) console.error(`::error::${f}`);
  console.error(`ROUTES=failed (${failures.length})`);
  process.exit(1);
}
console.log('ROUTES=pass');
