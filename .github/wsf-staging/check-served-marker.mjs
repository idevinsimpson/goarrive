#!/usr/bin/env node
/**
 * THE SERVED BUILD, READ BEFORE ANYTHING IS SEEDED.
 *
 * A no-deploy proof is only a proof of the build that is actually served. This
 * reads the hosted /health page by exactly the rule the deploy verifier uses
 * for HOSTED_MARKER_MATCHES (verify-deployment.mjs: the approved SHA's
 * 7-character prefix must appear), so "served" means the same thing in both
 * places. It runs before the workflow authenticates, so a wrong
 * or unreadable marker stops the run with no credential minted and no fixture
 * created.
 *
 * Writes served-marker.json into WSF_RESULT_DIR (the scanned evidence).
 * Exit 0 = SERVED_MARKER=match. Exit 1 = SERVED_MARKER=mismatch | unreachable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Returns { ok, status, detail } and never throws. */
export async function readServedMarker({ stagingUrl, approvedSha, fetchImpl = fetch }) {
  if (!/^[0-9a-f]{40}$/.test(approvedSha || '')) return { ok: false, status: 'refused', detail: 'the approved SHA is not a 40-character SHA' };
  let res;
  let body;
  try {
    res = await fetchImpl(`${stagingUrl.replace(/\/+$/, '')}/health`, { redirect: 'follow' });
    body = await res.text();
  } catch (e) {
    return { ok: false, status: 'unreachable', detail: `hosted /health unreachable (${e?.code || e?.name || 'error'})` };
  }
  if (!res.ok) return { ok: false, status: 'unreachable', detail: `hosted /health returned HTTP ${res.status}` };
  const prefix = approvedSha.slice(0, 7);
  if (!body.includes(prefix)) return { ok: false, status: 'mismatch', detail: `hosted /health does not name ${prefix}` };
  return { ok: true, status: 'match', detail: `hosted /health names ${prefix}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const run = async () => {
    const approvedSha = process.env.WSF_APPROVED_SHA;
    const stagingUrl = process.env.WSF_STAGING_URL;
    const resultDir = process.env.WSF_RESULT_DIR;
    if (!approvedSha) throw new Error('WSF_APPROVED_SHA is required');
    if (!stagingUrl) throw new Error('WSF_STAGING_URL is required');
    if (!resultDir) throw new Error('WSF_RESULT_DIR is required');
    const r = await readServedMarker({ stagingUrl, approvedSha });
    fs.mkdirSync(resultDir, { recursive: true });
    fs.writeFileSync(path.join(resultDir, 'served-marker.json'), `${JSON.stringify({ approvedSha, ...r }, null, 2)}\n`);
    console.log(`SERVED_MARKER=${r.status} (${r.detail})`);
    if (!r.ok) {
      console.error(`::error::the served build is not ${approvedSha.slice(0, 8)}: ${r.detail}. Stopping before any credential or fixture.`);
      process.exit(1);
    }
  };
  run().catch((e) => { console.error(`::error::${e.message}`); console.log('SERVED_MARKER=refused'); process.exit(1); });
}
