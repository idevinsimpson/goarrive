#!/usr/bin/env node
/**
 * PRE-DEPLOY: the frozen milestone manifest must describe the approved
 * candidate, or be absent.
 *
 * Runs in the `gate` job, before the candidate is fetched and before any
 * credential exists, reading the manifest from the OPERATIONAL checkout only.
 *
 * - ABSENT is allowed and said plainly: no member-visible milestone is declared
 *   for this deploy (a backend-only or non-visible release). The contract asks
 *   for a manifest per user-visible milestone; absence is never read as a
 *   visible milestone that passed, and the changed-journey smoke reports
 *   `skipped` for it.
 * - PRESENT must be schema-valid, name exactly the approved SHA as productSha,
 *   and have a registered driver for every journey. Otherwise the deploy is
 *   refused here, before a build: a stale or mismatched manifest would
 *   otherwise surface only after deployment as a report-only
 *   `CHANGED_JOURNEY_SMOKE=error` or a card for the wrong build.
 *
 * Exit 0 = MILESTONE_MANIFEST=absent | valid. Exit 1 = MILESTONE_MANIFEST=refused.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateManifest } from './milestone-manifest.mjs';

/** Returns { status: 'absent' | 'valid' | 'refused', lines: [...] }. */
export function checkMilestone({ manifestPath, approvedSha, drivers }) {
  if (!/^[0-9a-f]{40}$/.test(approvedSha || '')) {
    return { status: 'refused', lines: ['WSF_APPROVED_SHA must be the 40-character approved candidate'] };
  }
  if (!fs.existsSync(manifestPath)) {
    return { status: 'absent', lines: ['no member-visible milestone is declared for this deploy; the changed-journey smoke will report skipped'] };
  }
  let m;
  try { m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { return { status: 'refused', lines: ['the milestone manifest is not JSON'] }; }
  return checkManifestObject(m, { approvedSha, drivers });
}

/** The same check on an already-parsed manifest (the pin generator reads one out of git). */
export function checkManifestObject(m, { approvedSha, drivers }) {
  if (!/^[0-9a-f]{40}$/.test(approvedSha || '')) {
    return { status: 'refused', lines: ['WSF_APPROVED_SHA must be the 40-character approved candidate'] };
  }
  const problems = validateManifest(m);
  if (problems.length) return { status: 'refused', lines: problems };
  const lines = [];
  if (m.productSha !== approvedSha) {
    lines.push(`the manifest is for ${m.productSha}, but the approved candidate is ${approvedSha}: update the manifest with the pin, or remove it for a release with no member-visible milestone`);
  }
  const missing = m.journeys.map((j) => j.id).filter((id) => typeof drivers[id] !== 'function');
  if (missing.length) lines.push(`no registered driver for journey${missing.length === 1 ? '' : 's'} ${missing.join(', ')} (journeys/index.mjs)`);
  if (lines.length) return { status: 'refused', lines };
  return { status: 'valid', lines: [`${m.milestone}: ${m.journeys.length} journey${m.journeys.length === 1 ? '' : 's'} (${m.journeys.map((j) => j.id).join(', ')}), each with a registered driver`] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const manifestPath = process.argv[2];
  if (!manifestPath) { console.error('usage: check-milestone-manifest.mjs <manifest.json>'); process.exit(1); }
  const { drivers } = await import('./journeys/index.mjs');
  const r = checkMilestone({ manifestPath, approvedSha: process.env.WSF_APPROVED_SHA, drivers });
  for (const l of r.lines) (r.status === 'refused' ? console.error : console.log)(r.status === 'refused' ? `::error::${l}` : l);
  console.log(`MILESTONE_MANIFEST=${r.status}`);
  process.exit(r.status === 'refused' ? 1 : 0);
}
