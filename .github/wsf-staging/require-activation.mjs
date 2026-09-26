#!/usr/bin/env node
/**
 * THE ACTIVATION VERDICT (CONTROL-PLANE-ACTIVATION-1).
 *
 * The last step of the no-deploy `journey-activation` mode, and the only one
 * that decides its result. It recomputes the owner-card verdict from the
 * evidence itself (the manifest, the journey results and the cleanup
 * receipt, through owner-test-card.mjs) rather than trusting a printed line,
 * and it passes only when ALL of these hold:
 *
 * - the served marker named the manifest's product before anything was seeded;
 * - the manifest names exactly the journeys this activation is for;
 * - the card verdict is PASSED: every named journey passed, with its own
 *   assertions, on the manifest's build;
 * - cleanup is COMPLETE or NO_FIXTURES by the cleaner's own receipt (never
 *   "not needed": a run in which the drivers ran created fixtures), and the
 *   blocking cleanup step itself succeeded;
 * - the evidence scan passed.
 *
 * Anything else is ACTIVATION=FAILED with every reason listed; the evidence
 * (and a preserved cleanup manifest, when cleanup did not complete) stays in
 * the uploaded artifact for recovery.
 *
 * Exit 0 = ACTIVATION=PASSED. Exit 1 = ACTIVATION=FAILED.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanupStatus, driversRanIn, renderCard } from './owner-test-card.mjs';

const read = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

/**
 * @param {{ manifestPath: string, changedDir: string, stagingUrl: string, journeys: string[],
 *           outcomes: { marker: string, cleanup: string, scan: string } }} input
 * @returns {{ passed: boolean, reasons: string[], summary: string|null, cleanup: string|null }}
 */
export function activationVerdict({ manifestPath, changedDir, stagingUrl, journeys, outcomes }) {
  const reasons = [];
  if (outcomes.marker !== 'success') reasons.push(`the served-marker check did not pass (${outcomes.marker || 'not run'}); nothing may be claimed about the served build`);
  const manifest = read(manifestPath);
  if (manifest === null) reasons.push('the activation manifest is missing or unreadable');
  const ids = manifest?.journeys?.map?.((j) => j.id) ?? [];
  if (manifest && [...ids].sort().join() !== [...journeys].sort().join()) {
    reasons.push(`the manifest names ${ids.join(', ') || 'no journeys'}, not exactly ${journeys.join(', ')}`);
  }
  const results = read(path.join(changedDir, 'changed-journeys.json'));
  if (results === null) reasons.push('no changed-journey results were written');
  const cleanup = cleanupStatus({
    manifestPath: path.join(changedDir, 'cleanup-manifest.json'),
    receiptPath: path.join(changedDir, 'cleanup-receipt.json'),
    driversRan: driversRanIn(results),
  });
  if (!['COMPLETE', 'NO_FIXTURES'].includes(cleanup)) reasons.push(`changed-journey cleanup is ${cleanup}, not COMPLETE`);
  if (outcomes.cleanup !== 'success') reasons.push(`the blocking cleanup step did not succeed (${outcomes.cleanup || 'not run'})`);
  if (outcomes.scan !== 'success') reasons.push(`the evidence scan did not pass (${outcomes.scan || 'not run'})`);
  let summary = null;
  if (manifest && results) {
    try {
      summary = renderCard(manifest, results, { stagingUrl, cleanup }).summary;
      if (summary !== 'PASSED') reasons.push(`the owner-card verdict is ${summary}`);
    } catch (e) {
      reasons.push(`the owner card refused the evidence: ${String(e.message).split('\n')[0]}`);
    }
    for (const r of results.results || []) {
      if (r.status !== 'passed') reasons.push(`journey ${r.journeyId} is ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
    }
  }
  return { passed: reasons.length === 0, reasons, summary, cleanup };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const env = process.env;
  const need = (k) => { if (!env[k]) { console.error(`::error::${k} is required`); console.log('ACTIVATION=FAILED'); process.exit(1); } return env[k]; };
  const v = activationVerdict({
    manifestPath: need('WSF_ACTIVATION_MANIFEST'),
    changedDir: need('WSF_CHANGED_DIR'),
    stagingUrl: need('WSF_STAGING_URL'),
    journeys: need('WSF_ACTIVATION_JOURNEYS').split(','),
    outcomes: { marker: env.WSF_MARKER_OUTCOME, cleanup: env.WSF_CLEANUP_OUTCOME, scan: env.WSF_SCAN_OUTCOME },
  });
  console.log(`ACTIVATION_CARD=${v.summary ?? 'not rendered'}`);
  console.log(`ACTIVATION_CLEANUP=${v.cleanup}`);
  for (const r of v.reasons) console.error(`::error::${r}`);
  console.log(`ACTIVATION=${v.passed ? 'PASSED' : 'FAILED'}`);
  process.exit(v.passed ? 0 : 1);
}
