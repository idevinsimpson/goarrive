#!/usr/bin/env node
/**
 * The changed-journey hosted smoke: exercise the journeys a milestone manifest
 * names against the hosted staging site, from the job that can reach it.
 *
 * REPORT-ONLY. This step always exits 0 and the workflow gate does not read
 * it: until the changed-journey smoke is independently accepted, the hosted
 * authorization suite and the human gates stay the release gate
 * (docs/westayfit/ops/OWNER_TEST_CARD_AND_SMOKE_CONTRACT.md). An internal error
 * is reported as CHANGED_JOURNEY_SMOKE=error, not thrown into the job.
 *
 * - No manifest (WSF_JOURNEY_MANIFEST unset, or no file there): prints
 *   CHANGED_JOURNEY_SMOKE=skipped and does nothing else.
 * - A manifest for a different product SHA than this run deploys: every
 *   journey is BLOCKED; a card for another build would be a false statement.
 * - A journey with no registered driver (journeys/index.mjs): BLOCKED,
 *   "no registered driver". Never passed.
 * - The browser is launched only when at least one driver will run, and only
 *   after the hosted health marker names the deployed SHA.
 * - Drivers seed their own synthetic fixtures (journeys/fixture-kit.mjs) under
 *   this run's `e5c-` tag, tracked in this step's OWN cleanup manifest, which
 *   the workflow's "Remove changed-journey fixtures" step clears. The Package E
 *   suite's manifest is never shared: two writers to one manifest could adopt
 *   or destroy each other's record of what was created.
 *
 * Writes changed-journeys.json (the results document owner-test-card.mjs
 * reads) and owner-test-card.md into WSF_RESULT_DIR/changed-journeys/.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { validateManifest } from './milestone-manifest.mjs';
import { renderCard } from './owner-test-card.mjs';
import { createFixtureKit } from './journeys/fixture-kit.mjs';

const PROJECT_ID = 'westayfit-staging';
const runTag = `e5c-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;

const DRIVER_TIMEOUT_MS = 240_000;
const short = (e) => String(e?.message || e).split('\n')[0].replace(/[?&][A-Za-z]+=[^&\s"']+/g, '?…').slice(0, 300);

function readEnv(env) {
  const STAGING_URL = env.WSF_STAGING_URL;
  const APPROVED_SHA = env.WSF_APPROVED_SHA;
  const RESULT_DIR = env.WSF_RESULT_DIR;
  if (!STAGING_URL) throw new Error('WSF_STAGING_URL is required');
  if (!APPROVED_SHA) throw new Error('WSF_APPROVED_SHA is required');
  if (!RESULT_DIR) throw new Error('WSF_RESULT_DIR is required');
  if (!/^[0-9a-f]{40}$/.test(APPROVED_SHA)) throw new Error('WSF_APPROVED_SHA must be a 40-character SHA');
  return { STAGING_URL: STAGING_URL.replace(/\/+$/, ''), APPROVED_SHA, RESULT_DIR };
}

async function defaultLaunch() {
  // Resolved from the candidate installation, as the other hosted checks do;
  // never imported at module load, so a run with nothing to drive needs no browser.
  const requireFromApp = createRequire(path.resolve('apps/westayfit/package.json'));
  const { chromium } = requireFromApp('@playwright/test');
  return chromium.launch();
}
/** Only when a driver will run: the fixture credentials, read and checked here. */
function defaultFixtures(env) {
  const token = env.WSF_GOOGLE_ACCESS_TOKEN;
  const sdkFile = env.WSF_SDK_CONFIG_FILE;
  const cleanupManifest = env.WSF_CLEANUP_MANIFEST;
  if (!token) throw new Error('WSF_GOOGLE_ACCESS_TOKEN is required');
  if (!sdkFile) throw new Error('WSF_SDK_CONFIG_FILE is required');
  if (!cleanupManifest) throw new Error('WSF_CLEANUP_MANIFEST is required');
  let raw;
  try { raw = JSON.parse(fs.readFileSync(sdkFile, 'utf8')); } catch { throw new Error('the SDK config file is unreadable'); }
  const sdk = raw?.result?.sdkConfig ?? raw?.sdkConfig ?? raw?.result ?? raw;
  if (sdk?.projectId !== PROJECT_ID || typeof sdk?.apiKey !== 'string') throw new Error('the SDK config is not the staging Web App config');
  return createFixtureKit({ projectId: PROJECT_ID, apiKey: sdk.apiKey, token, runTag, cleanupManifest });
}
async function defaultDrivers() {
  return (await import('./journeys/index.mjs')).drivers;
}

const blocked = (journeyId, reason) => ({
  journeyId, status: 'blocked', servedMarker: null, setupId: null,
  actionsPerformed: [], assertions: [], reason, artifact: null,
});

/**
 * Returns { lines, results } and never throws; `deps` exist so tests can
 * substitute the registry, fetch, the browser and the fixture kit.
 */
export async function runHook(env, deps = {}) {
  const lines = [];
  const say = (l) => lines.push(l);
  try {
    const manifestPath = env.WSF_JOURNEY_MANIFEST;
    if (!manifestPath || !fs.existsSync(manifestPath)) {
      say('CHANGED_JOURNEY_SMOKE=skipped (no milestone manifest for this run)');
      return { lines, results: null };
    }
    const { STAGING_URL, APPROVED_SHA, RESULT_DIR } = readEnv(env);
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { throw new Error('the milestone manifest is not JSON'); }
    const problems = validateManifest(manifest);
    if (problems.length) throw new Error(`the milestone manifest is invalid: ${problems.join('; ')}`);

    const registry = await (deps.loadDrivers || defaultDrivers)();
    const dir = path.join(RESULT_DIR, 'changed-journeys');
    const out = [];
    let servedSha = null;
    if (manifest.productSha !== APPROVED_SHA) {
      for (const j of manifest.journeys) out.push(blocked(j.id, `the manifest is for ${manifest.productSha.slice(0, 8)}, this run deploys ${APPROVED_SHA.slice(0, 8)}`));
    } else {
      const toRun = manifest.journeys.filter((j) => typeof registry[j.id] === 'function');
      let markerOk = false;
      if (toRun.length) {
        try {
          const res = await (deps.fetch || fetch)(`${STAGING_URL}/health`, { redirect: 'follow' });
          markerOk = res.ok && (await res.text()).includes(APPROVED_SHA.slice(0, 7));
        } catch { markerOk = false; }
        if (markerOk) servedSha = APPROVED_SHA;
      }
      let browser = null;
      let fixtures = null;
      try {
        for (const j of manifest.journeys) {
          const driver = registry[j.id];
          if (typeof driver !== 'function') { out.push(blocked(j.id, 'no registered driver')); continue; }
          if (!markerOk) { out.push(blocked(j.id, `the hosted health marker does not name ${APPROVED_SHA.slice(0, 7)}`)); continue; }
          fixtures ||= (deps.fixtures || defaultFixtures)(env);
          browser ||= await (deps.launch || defaultLaunch)();
          const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
          const page = await context.newPage();
          const shot = async () => {
            try {
              fs.mkdirSync(dir, { recursive: true });
              await page.screenshot({ path: path.join(dir, `${j.id}.png`), fullPage: true });
              return `changed-journeys/${j.id}.png`;
            } catch { return null; }
          };
          try {
            const r = await Promise.race([
              driver({ page, baseUrl: STAGING_URL, journey: j, fixtures }),
              new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${DRIVER_TIMEOUT_MS / 1000}s`)), DRIVER_TIMEOUT_MS).unref()),
            ]);
            const assertions = (r?.assertions || []).map((a) => ({ expected: String(a.expected), ok: a.ok === true }));
            const ok = assertions.length > 0 && assertions.every((a) => a.ok);
            out.push({
              journeyId: j.id, status: ok ? 'passed' : 'failed', servedMarker: servedSha,
              setupId: typeof r?.setupId === 'string' ? r.setupId : null, actionsPerformed: (r?.actionsPerformed || []).map(String), assertions,
              reason: ok ? null : assertions.length ? 'an expected assertion did not hold' : 'the driver checked no assertion', artifact: await shot(),
            });
          } catch (e) {
            out.push({ ...blocked(j.id, `the driver threw: ${short(e)}`), status: 'failed', servedMarker: servedSha, artifact: await shot() });
          } finally {
            await context.close().catch(() => {});
          }
        }
      } finally {
        if (browser) await browser.close().catch(() => {});
      }
    }

    const results = { schemaVersion: 1, servedSha, results: out };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'changed-journeys.json'), `${JSON.stringify(results, null, 2)}\n`);
    const card = renderCard(manifest, results, { stagingUrl: STAGING_URL });
    fs.writeFileSync(path.join(dir, 'owner-test-card.md'), card.text);
    for (const r of out) say(`CHANGED_JOURNEY ${r.journeyId}=${r.status}${r.reason ? ` (${r.reason})` : ''}`);
    say(`CHANGED_JOURNEY_SMOKE=${card.summary}`);
    return { lines, results };
  } catch (e) {
    say(`CHANGED_JOURNEY_SMOKE=error (${short(e)})`);
    return { lines, results: null };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { lines } = await runHook(process.env);
  for (const l of lines) console.log(l);
  console.log(`CHANGED_JOURNEY_RUN_TAG=${runTag}`);
  console.log('CHANGED_JOURNEY_SMOKE_GATES=nothing (report-only)');
  process.exit(0);
}
