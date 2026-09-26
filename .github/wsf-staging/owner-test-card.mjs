#!/usr/bin/env node
/**
 * Render the owner test card from a milestone manifest plus the hosted
 * changed-journey results (docs/westayfit/ops/OWNER_TEST_CARD_AND_SMOKE_CONTRACT.md).
 *
 * The card states only what was run. In particular:
 * - a journey with no result is NOT RUN, never passed;
 * - a result observed on a build other than the manifest's productSha is NOT
 *   VERIFIED, whatever its status says: a pass or a failure on the wrong build
 *   is not evidence about this one;
 * - a `passed` result must carry its assertions and every one must hold;
 * - an unknown status, a result for a journey the manifest does not name, or two
 *   results for one journey are refused rather than guessed at;
 * - device review is always NOT RUN here: visual and feel review is Devin's
 *   verdict and no script can supply it.
 *
 * Summary: FAILED when any verified journey failed; PASSED only when every
 * journey passed on the manifest's build; INCOMPLETE otherwise.
 *
 * Deterministic: no clock, no network. Exit 0 = rendered. Exit 1 = refused.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateManifest } from './milestone-manifest.mjs';

const SHA = /^[0-9a-f]{40}$/;
const STATUSES = ['passed', 'failed', 'blocked'];
const RESULT_KEYS = ['journeyId', 'status', 'servedMarker', 'setupId', 'actionsPerformed', 'assertions', 'reason', 'artifact'];
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export class Refusal extends Error {}
const refuse = (m) => { throw new Refusal(m); };

/** Check the results document against the manifest; returns journeyId -> result. */
export function checkResults(manifest, results) {
  const byId = new Map();
  if (results === null) return { servedSha: null, byId };
  if (!isObject(results)) refuse('the results must be a JSON object');
  for (const k of Object.keys(results)) if (!['schemaVersion', 'servedSha', 'results'].includes(k)) refuse(`results: unknown key ${JSON.stringify(k)}`);
  if (results.schemaVersion !== 1) refuse('results.schemaVersion must be 1');
  if (!(results.servedSha === null || SHA.test(results.servedSha || ''))) refuse('results.servedSha must be a 40-character SHA or null');
  if (!Array.isArray(results.results)) refuse('results.results must be an array');
  const ids = new Set(manifest.journeys.map((j) => j.id));
  results.results.forEach((r, i) => {
    const where = `results[${i}]`;
    if (!isObject(r)) refuse(`${where} must be an object`);
    for (const k of Object.keys(r)) if (!RESULT_KEYS.includes(k)) refuse(`${where}: unknown key ${JSON.stringify(k)}`);
    if (!ids.has(r.journeyId)) refuse(`${where} is for journey ${JSON.stringify(r.journeyId)}, which the manifest does not name`);
    if (byId.has(r.journeyId)) refuse(`${where} is a second result for journey ${r.journeyId}`);
    if (!STATUSES.includes(r.status)) refuse(`${where} has status ${JSON.stringify(r.status)}; only ${STATUSES.join(', ')} are known`);
    if (!(r.servedMarker === null || SHA.test(r.servedMarker || ''))) refuse(`${where}.servedMarker must be a 40-character SHA or null`);
    if (!Array.isArray(r.actionsPerformed) || !r.actionsPerformed.every((a) => typeof a === 'string')) refuse(`${where}.actionsPerformed must be an array of strings`);
    if (!Array.isArray(r.assertions) || !r.assertions.every((a) => isObject(a) && typeof a.expected === 'string' && typeof a.ok === 'boolean' && Object.keys(a).length === 2)) {
      refuse(`${where}.assertions must be an array of {expected, ok}`);
    }
    for (const k of ['setupId', 'reason', 'artifact']) if (!(r[k] === null || typeof r[k] === 'string')) refuse(`${where}.${k} must be a string or null`);
    if (r.status === 'passed' && (r.assertions.length === 0 || r.assertions.some((a) => !a.ok))) {
      refuse(`${where} says passed but ${r.assertions.length === 0 ? 'carries no assertions' : 'an assertion did not hold'}`);
    }
    if (r.status !== 'passed' && !r.reason) refuse(`${where} is ${r.status} without a reason`);
    byId.set(r.journeyId, r);
  });
  return { servedSha: results.servedSha, byId };
}

/** One of PASSED / FAILED / BLOCKED / NOT RUN / NOT VERIFIED per journey. */
function verdict(manifest, served, r) {
  if (!r) return { label: 'NOT RUN', detail: 'no hosted result for this journey' };
  // Blocked means nothing was exercised, so which build was served does not
  // change it, and its reason is the useful fact.
  if (r.status === 'blocked') return { label: 'BLOCKED', detail: r.reason };
  if (served !== manifest.productSha || r.servedMarker !== manifest.productSha) {
    const seen = r.servedMarker || served;
    return { label: 'NOT VERIFIED', detail: seen ? `observed build ${seen.slice(0, 8)} is not the manifest's ${manifest.productSha.slice(0, 8)}` : 'the served build marker was not observed' };
  }
  if (r.status === 'passed') return { label: 'PASSED', detail: `${r.assertions.length} assertion${r.assertions.length === 1 ? '' : 's'} held` };
  const bad = r.assertions.filter((a) => !a.ok).map((a) => a.expected);
  return { label: 'FAILED', detail: bad.length ? `${r.reason}; did not hold: ${bad.join('; ')}` : r.reason };
}

export function renderCard(manifest, results, { stagingUrl }) {
  const errors = validateManifest(manifest);
  if (errors.length) refuse(`the manifest is invalid:\n${errors.join('\n')}`);
  if (typeof stagingUrl !== 'string' || !/^https:\/\/[^\s]+$/.test(stagingUrl)) refuse('--staging-url must be an https URL');
  const { servedSha, byId } = checkResults(manifest, results);

  const rows = manifest.journeys.map((j) => ({ j, v: verdict(manifest, servedSha, byId.get(j.id)) }));
  const count = (l) => rows.filter((r) => r.v.label === l).length;
  const summary = count('FAILED') ? 'FAILED' : count('PASSED') === rows.length ? 'PASSED' : 'INCOMPLETE';
  const tally = ['PASSED', 'FAILED', 'BLOCKED', 'NOT VERIFIED', 'NOT RUN'].map((l) => `${count(l)} ${l.toLowerCase()}`).join(', ');

  const out = [];
  out.push(`# Owner test card: ${manifest.milestone}`, '');
  out.push(`- Staging link: ${stagingUrl}`);
  out.push(`- Served SHA: ${servedSha === null ? 'not observed' : servedSha}${servedSha !== null && servedSha !== manifest.productSha ? ` (NOT the manifest's ${manifest.productSha}; nothing below is verified)` : ''}`);
  out.push(`- Milestone product SHA: ${manifest.productSha}`);
  out.push(`- Previous known-good / rollback SHA: ${manifest.previousKnownGoodSha}`);
  out.push(`- Milestone: ${manifest.milestone}`);
  out.push(`- Hosted changed-journey status: ${results === null ? 'NOT RUN' : summary} (${tally})`);
  out.push('- Device review: NOT RUN — Devin\'s verdict', '');
  rows.forEach(({ j, v }, i) => {
    out.push(`## ${i + 1}. ${j.id}`, '');
    out.push(`1. Where to go: \`${j.entry}\``);
    out.push(`2. Setup that matters: ${j.setup}`);
    out.push(`3. What to do: ${j.actions.join(' → ')}`);
    out.push('4. What should be visible or feel different:');
    for (const e of j.expected) out.push(`   - ${e}`);
    out.push(`5. Intentionally unchanged or unavailable:${j.knownExclusions.length ? '' : ' none recorded'}`);
    for (const e of j.knownExclusions) out.push(`   - ${e}`);
    out.push('', `Hosted smoke: **${v.label}** — ${v.detail}`);
    const r = byId.get(j.id);
    if (r?.artifact) out.push(`Evidence: ${r.artifact}`);
    out.push('');
  });
  out.push('## Device review', '', 'NOT RUN — Devin\'s verdict. Visual and feel review is not something this card or any automated check can pass.', '');
  return { summary: results === null ? 'NOT RUN' : summary, text: out.join('\n') };
}

function arg(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  try {
    const mf = arg(argv, 'manifest');
    const out = arg(argv, 'out');
    if (!mf || !out) refuse('usage: owner-test-card.mjs --manifest <m.json> [--results <r.json>] --staging-url <https://…> --out <card.md>');
    let manifest, results = null;
    try { manifest = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch { refuse('the manifest is missing or is not JSON'); }
    const rf = arg(argv, 'results');
    if (rf !== undefined) {
      try { results = JSON.parse(fs.readFileSync(rf, 'utf8')); } catch { refuse('the results file is missing or is not JSON'); }
    }
    const card = renderCard(manifest, results, { stagingUrl: arg(argv, 'staging-url') });
    fs.writeFileSync(out, card.text);
    console.log(`OWNER_CARD_SUMMARY=${card.summary}`);
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    for (const line of e.message.split('\n')) console.error(`::error::${line}`);
    console.error('OWNER_CARD=refused');
    process.exit(1);
  }
}
