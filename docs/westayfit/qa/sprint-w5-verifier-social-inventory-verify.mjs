#!/usr/bin/env node
/**
 * W5 — independent local-fixture review of the staging verifier's
 * candidate-addition change (L0 packet 5797498066).
 *
 * WRITTEN FROM THE CONTRACT, NOT FROM W3's TEST FILE. W3's suite lives at
 * .github/wsf-staging/tests/verify-deployment.test.mjs and is not read as a
 * source of fixtures here: a reviewer who reuses the author's harness inherits
 * the author's blind spots. The mock shape below is derived from what the
 * verifier itself reads (the Cloud Functions list, the Cloud Run services
 * list, the Hosting channels list and /health).
 *
 * BOTH VERIFIERS ARE DRIVEN. The claim under review is a DIFFERENCE between
 * the old verifier and the new one, and a test that exercises only the new one
 * cannot establish a difference. Each script is copied into its own temporary
 * directory beside a crafted approved-candidate.json, because the new script
 * resolves that file through `new URL('./approved-candidate.json',
 * import.meta.url)` — copying it is the only honest way to vary it.
 *
 * Usage: node docs/westayfit/qa/sprint-w5-verifier-social-inventory-verify.mjs
 *   OLD=<path to main's verify-deployment.mjs> NEW=<path to the draft's>
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const OLD = process.env.OLD || path.resolve('/tmp/w5-old/verify-deployment.mjs');
const NEW = process.env.NEW || path.resolve('/tmp/w5-new/verify-deployment.mjs');
const SHA = '8e1a3ed485a5c0eadbcb23c1f35becad455923c7';

// The 46-name inventory exactly as main's verifier hardcodes it.
const BASE = [
  'wsfadjustgoal','wsfchallengepulse','wsfcheckin','wsfcontribute','wsfcreatecommunity',
  'wsfcreategoal','wsfdesignatechampion','wsfgoalpulse','wsfgoalrecentadditions','wsfhealth',
  'wsfjoincommunity','wsfleavecommunity','wsflistchallenge','wsflistgoals','wsfmycommunities',
  'wsfmycontribution','wsfpreviewcommunity','wsfreinstatemember','wsfremovemember',
  'wsfresetjoincode','wsfsaveprofile','wsfsendpasswordresetemail','wsfsendverificationemail',
  'wsfsetgoaldisplayauthorization',
  'wsfstationrequestpairing','wsfstationpairingstatus','wsfapprovestation',
  'wsfstationclaimpairing','wsfstationstate','wsfliststations','wsfrevokestation',
  'wsfeventcontext','wsfjointurnline','wsfturnstate','wsfstartturn','wsfturnready',
  'wsfmyturn','wsfcompleteturn','wsfcompletemyturn','wsfcancelturn','wsfleaveturnline',
  'wsfcallnext','wsfcreatecombinedgoal','wsfclosecombinedgoal','wsfrepaircombinedgoal',
  'wsfcombinedgoalpulse',
];
// The three the reviewed social rollout adds.
const SOCIAL = ['wsfsetcommunityvisibility','wsfcommunitymembers','wsfcommunityactivity'];

const results = [];
function record(id, verdict, detail) {
  results.push({ id, verdict, detail });
  const tag = verdict === 'PASS' ? 'PASS' : verdict === 'FAIL' ? 'FAIL' : 'CANNOT-MEASURE';
  console.log(`[${tag}] ${id} — ${detail}`);
}

function fnRes(n) { return { name: `projects/westayfit-staging/locations/us-central1/functions/${n}` }; }
function svcRes(n, extra = {}) {
  return {
    name: `projects/westayfit-staging/locations/us-central1/services/${n}`,
    invokerIamDisabled: true, template: { scaling: {} }, ...extra,
  };
}

/**
 * `functions` is a list of NAMES. An earlier revision of this harness passed
 * it already mapped through fnRes() and then derived the Cloud Run list from
 * those objects, so every service name came out malformed and the verifier
 * reported the whole inventory missing. The control case caught it. Names in,
 * mapping here, once.
 */
function startMock({ functions, rawFunctions, services, health = SHA.slice(0, 7), healthStatus = 200,
                     channels = [{ name: 'sites/westayfit-staging/channels/staging', url: 'https://x', expireTime: 'later' }] }) {
  const svcList = services || functions.map((n) => svcRes(n));
  const fnList = rawFunctions || functions.map((n) => fnRes(n));
  const server = http.createServer((req, res) => {
    const j = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url.includes('/functions')) return j({ functions: fnList });
    if (req.url.includes('/services')) return j({ services: svcList });
    if (req.url.includes('/channels')) return j({ channels });
    if (req.url.includes('/health')) { res.writeHead(healthStatus, { 'content-type': 'text/html' }); return res.end(`<html>${health}</html>`); }
    res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}');
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

/**
 * Stage a verifier in its own directory next to a chosen approval file, so the
 * approval this run sees is the one this case means to test.
 * `approval === null` deliberately stages NO file at all.
 */
function stage(scriptPath, approval) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w5-verify-'));
  fs.copyFileSync(scriptPath, path.join(dir, 'verify-deployment.mjs'));
  if (approval !== null) {
    fs.writeFileSync(path.join(dir, 'approved-candidate.json'),
      typeof approval === 'string' ? approval : JSON.stringify(approval, null, 2));
  }
  return path.join(dir, 'verify-deployment.mjs');
}

function run(script, base, beforeFile, { cwd } = {}) {
  return new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w5-res-'));
    const c = spawn(process.execPath, [script], {
      cwd: cwd || path.dirname(script),
      env: { ...process.env,
        WSF_GOOGLE_ACCESS_TOKEN: 't', WSF_APPROVED_SHA: SHA, WSF_STAGING_URL: base,
        WSF_INVENTORY_BEFORE: beforeFile, WSF_RESULT_DIR: dir, WSF_API_BASE: base },
    });
    let out = '', err = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => resolve({ code, out, err, all: out + err }));
  });
}

function beforeFileWith(names) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'w5-before-')), 'before.json');
  fs.writeFileSync(f, JSON.stringify({ functions: names }));
  return f;
}

const APPROVAL_46 = { approvedAppSha: SHA, expectedPriorFunctions: 46 };
const APPROVAL_49 = { approvedAppSha: SHA, expectedPriorFunctions: 46, candidateAddedFunctions: SOCIAL };

async function drive(script, approval, { functions = BASE, services, before = BASE, health, healthStatus, cwd } = {}) {
  const { server, base } = await startMock({ functions, services, health, healthStatus });
  try {
    return await run(stage(script, approval), base, beforeFileWith(before), { cwd });
  } finally { server.close(); }
}

const num = (out, key) => (out.match(new RegExp(`^${key}=(.*)$`, 'm')) || [])[1];

console.log('=== W5 independent verification — staging verifier social inventory ===\n');

// ---- ITEM 1: fail-closed, old vs new ------------------------------------
{
  const r = await drive(OLD, APPROVAL_46);
  record('1a OLD + 46-set (control: the old verifier and this harness both work)',
    r.all.includes('VERIFY=pass') ? 'PASS' : 'FAIL',
    `exit=${r.code} VERIFY=${r.all.includes('VERIFY=pass') ? 'pass' : 'not pass'} BEFORE=${num(r.out,'INVENTORY_BEFORE')} AFTER=${num(r.out,'INVENTORY_AFTER')}`);
}
{
  const r = await drive(OLD, APPROVAL_49, { functions: [...BASE, ...SOCIAL], before: BASE });
  const line = (r.all.match(/present but not expected: .*/) || [])[0] || '';
  const namesAll = SOCIAL.every((n) => line.includes(n));
  record('1b OLD + 49-set must REJECT all three additions',
    r.code !== 0 && namesAll ? 'PASS' : 'FAIL',
    `exit=${r.code} "${line}" — names all three: ${namesAll}`);
}
{
  const r = await drive(NEW, APPROVAL_49, { functions: [...BASE, ...SOCIAL], before: BASE });
  record('1c NEW + 49-set + approval naming exactly the three must PASS',
    r.all.includes('VERIFY=pass') ? 'PASS' : 'FAIL',
    `exit=${r.code} APPROVED_ADDITIONS=${num(r.out,'APPROVED_ADDITIONS')} EXPECTED_INVENTORY=${num(r.out,'EXPECTED_INVENTORY')} AFTER=${num(r.out,'INVENTORY_AFTER')}`);
}
{
  const rNew = await drive(NEW, APPROVAL_46);
  const rOld = await drive(OLD, APPROVAL_46);
  const strip = (s) => s.split('\n').filter((l) => /^(VERIFY|INVENTORY_BEFORE|INVENTORY_AFTER|CREATED_THIS_DEPLOY|NEW_CALLABLE_PRESENT|PREEXISTING_TRANSPORT_VERIFIED|NEW_SERVICE_TRANSPORT)=/.test(l)).join('\n');
  const same = strip(rNew.out) === strip(rOld.out);
  record('1d NEW with the key ABSENT behaves as the old verifier on the 46-set',
    rNew.all.includes('VERIFY=pass') && same ? 'PASS' : 'FAIL',
    `new exit=${rNew.code} old exit=${rOld.code} shared verdict lines identical: ${same}; new adds APPROVED_ADDITIONS=${num(rNew.out,'APPROVED_ADDITIONS')} EXPECTED_INVENTORY=${num(rNew.out,'EXPECTED_INVENTORY')}`);
}

// ---- ITEM 2: the negatives still fail on the NEW verifier ---------------
const NEG = [
  ['2a a fourth, unlisted function is deployed', { functions: [...BASE, ...SOCIAL, 'wsfrogueservice'], before: BASE }, /present but not expected: wsfrogueservice/],
  ['2b an authorized addition did NOT deploy', { functions: [...BASE, SOCIAL[0], SOCIAL[1]], before: BASE }, /wsfcommunityactivity absent — the approval authorizes/],
  ['2c a required service is missing', { functions: [...BASE.filter((n) => n !== 'wsfcontribute'), ...SOCIAL], before: BASE.filter((n) => n !== 'wsfcontribute') }, /expected but absent: wsfcontribute/],
  ['2d a service present before this deploy is gone', { functions: [...BASE.filter((n) => n !== 'wsfcheckin'), ...SOCIAL], before: BASE }, /present before this deploy and now gone: wsfcheckin/],
  ['2h the hosted build marker does not match the approved SHA', { functions: [...BASE, ...SOCIAL], before: BASE, health: 'deadbee' }, /hosted build marker does not match/],
];
for (const [id, opts, pattern] of NEG) {
  const r = await drive(NEW, APPROVAL_49, opts);
  const hit = pattern.test(r.all);
  record(id, r.code !== 0 && hit ? 'PASS' : 'FAIL',
    `exit=${r.code} expected-message present: ${hit} — ${(r.all.match(pattern) || ['(not found)'])[0]}`);
}
{ // 2e: an unreadable BEFORE baseline is an error, never an empty inventory
  const { server, base } = await startMock({ functions: [...BASE, ...SOCIAL] });
  const r = await run(stage(NEW, APPROVAL_49), base, '/nonexistent/before.json');
  server.close();
  record('2e an unreadable BEFORE baseline is VERIFY=error, not an empty inventory',
    r.code !== 0 && r.all.includes('VERIFY=error (no valid before-inventory)') ? 'PASS' : 'FAIL',
    `exit=${r.code} ${(r.all.match(/VERIFY=error.*/) || ['(none)'])[0]}`);
}
{ // 2f: project / region drift
  // This case needs one resource with a deliberately wrong project/region, so
  // it supplies raw resources through `rawFunctions` rather than names.
  const funcs = [...BASE, ...SOCIAL].map(fnRes);
  funcs[0] = { name: 'projects/westayfit-prod/locations/europe-west1/functions/wsfadjustgoal' };
  const { server, base } = await startMock({ functions: [...BASE, ...SOCIAL], rawFunctions: funcs, services: [...BASE, ...SOCIAL].map((n) => svcRes(n)) });
  const r = await run(stage(NEW, APPROVAL_49), base, beforeFileWith(BASE));
  server.close();
  record('2f a function outside the project/region fails',
    r.code !== 0 && /functions outside westayfit-staging\/us-central1/.test(r.all) ? 'PASS' : 'FAIL',
    `exit=${r.code} ${(r.all.match(/functions outside .*/) || ['(none)'])[0]}`);
}
{ // 2g: transport drift on a pre-existing service
  const services = [...BASE, ...SOCIAL].map((n) => (n === 'wsfcontribute' ? svcRes(n, { invokerIamDisabled: false }) : svcRes(n)));
  const r = await drive(NEW, APPROVAL_49, { functions: [...BASE, ...SOCIAL], before: BASE, services });
  record('2g transport drift on an existing service fails',
    r.code !== 0 && /transport drifted \(invoker IAM check re-enabled\): wsfcontribute/.test(r.all) ? 'PASS' : 'FAIL',
    `exit=${r.code} ${(r.all.match(/existing WSF transport drifted.*/) || ['(none)'])[0]}`);
}

// ---- ITEM 2i / 3: malformed approvals, and no self-approval -------------
const MALFORMED = [
  ['2i-1 no approval file at all', null, /VERIFY=error \(no valid approval file\)/],
  ['2i-2 approval is not JSON', '{not json', /VERIFY=error \(no valid approval file\)/],
  ['2i-3 approval is a JSON array', '[]', /VERIFY=error \(malformed approval file\)/],
  ['2i-4 candidateAddedFunctions is not an array', { approvedAppSha: SHA, candidateAddedFunctions: 'wsfcommunitymembers' }, /is present but is not an array/],
  ['2i-5 an entry is not a wsf service name', { approvedAppSha: SHA, candidateAddedFunctions: ['../../etc/passwd'] }, /not a lower-case wsf service name/],
  ['2i-6 an entry duplicates a name', { approvedAppSha: SHA, candidateAddedFunctions: [SOCIAL[0], SOCIAL[0]] }, /names wsfsetcommunityvisibility twice/],
  ['2i-7 an entry is already in the inventory', { approvedAppSha: SHA, candidateAddedFunctions: ['wsfcontribute'] }, /already part of the expected inventory/],
];
for (const [id, approval, pattern] of MALFORMED) {
  const r = await drive(NEW, approval, { functions: [...BASE, ...SOCIAL], before: BASE });
  const hit = pattern.test(r.all);
  record(id, r.code !== 0 && hit ? 'PASS' : 'FAIL', `exit=${r.code} matched: ${hit}`);
}
{ // 3: a rogue approval in the WORKING DIRECTORY must not be read
  const rogueCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'w5-rogue-'));
  fs.writeFileSync(path.join(rogueCwd, 'approved-candidate.json'),
    JSON.stringify({ approvedAppSha: SHA, candidateAddedFunctions: [...SOCIAL, 'wsfrogueservice'] }));
  const r = await drive(NEW, APPROVAL_49, { functions: [...BASE, ...SOCIAL, 'wsfrogueservice'], before: BASE, cwd: rogueCwd });
  const rejected = r.code !== 0 && /present but not expected: wsfrogueservice/.test(r.all);
  record('3a an approval planted in the working directory cannot authorize an addition',
    rejected ? 'PASS' : 'FAIL',
    `exit=${r.code} rogue rejected: ${rejected} APPROVED_ADDITIONS=${num(r.out,'APPROVED_ADDITIONS')}`);
}
{ // 3b: there is no environment override for the approval path
  const src = fs.readFileSync(NEW, 'utf8');
  const readsEnv = /candidateAddedFunctions[\s\S]{0,400}process\.env/.test(src)
    || /process\.env\.[A-Z_]*APPROV[A-Z_]*(?!ED_SHA)/.test(src.replace(/WSF_APPROVED_SHA/g, ''));
  record('3b the approval path is not env-overridable', readsEnv ? 'FAIL' : 'PASS',
    `no env-sourced approval path in source: ${!readsEnv}; resolved via import.meta.url: ${/new URL\('\.\/approved-candidate\.json', import\.meta\.url\)/.test(src)}`);
}

// ---- ITEM 4: the Director's rollback question ---------------------------
{
  // The three remain deployed; the approval no longer names them.
  const r = await drive(NEW, APPROVAL_46, { functions: [...BASE, ...SOCIAL], before: [...BASE, ...SOCIAL] });
  const rejects = r.code !== 0 && /present but not expected/.test(r.all);
  record('4a rollback: dropping candidateAddedFunctions while the three stay deployed',
    rejects ? 'CONFIRMED-REJECTS' : 'REFUTED',
    `exit=${r.code} EXPECTED_INVENTORY=${num(r.out,'EXPECTED_INVENTORY')} AFTER=${num(r.out,'INVENTORY_AFTER')} — ${(r.all.match(/present but not expected: .*/) || ['(no such failure)'])[0]}`);
}
{
  // Does expectedPriorFunctions alone widen EXPECTED? It must not.
  const r = await drive(NEW, { approvedAppSha: SHA, expectedPriorFunctions: 49 },
    { functions: [...BASE, ...SOCIAL], before: [...BASE, ...SOCIAL] });
  record('4b expectedPriorFunctions=49 alone does NOT widen the expected inventory',
    /EXPECTED_INVENTORY=46/.test(r.out) ? 'PASS' : 'FAIL',
    `exit=${r.code} EXPECTED_INVENTORY=${num(r.out,'EXPECTED_INVENTORY')} (46 = not widened)`);
}
{
  // The re-pin a rollback must carry: the key retained, the services gone.
  const r = await drive(NEW, APPROVAL_46, { functions: BASE, before: [...BASE, ...SOCIAL] });
  record('4c rollback with the three actually REMOVED is still caught as a loss',
    r.code !== 0 && /present before this deploy and now gone/.test(r.all) ? 'PASS' : 'FAIL',
    `exit=${r.code} ${(r.all.match(/present before this deploy and now gone: .*/) || ['(none)'])[0]}`);
}

console.log('\n=== SUMMARY ===');
for (const r of results) console.log(`${r.verdict.padEnd(18)} ${r.id}`);
const bad = results.filter((r) => r.verdict === 'FAIL');
console.log(`\n${results.length} cases; ${bad.length} FAIL`);
process.exit(bad.length ? 1 : 0);
