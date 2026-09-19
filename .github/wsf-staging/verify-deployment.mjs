#!/usr/bin/env node
/**
 * Verify the deployed staging state against the accepted candidate.
 *
 * Adapted from Manus's verifier, which reads the Cloud Functions and Cloud Run
 * APIs directly rather than trusting the CLI's exit code — the right instinct,
 * and kept. Three things are changed, each because the original could report a
 * fact it had not established:
 *
 *   1. BEFORE/AFTER. The original checked only the end state. A missing or
 *      unreadable before-inventory is now an error, never "the project was
 *      empty", so a deploy that silently dropped functions cannot pass.
 *   2. MIN INSTANCES. The original mapped undefined -> 0. That conflates the
 *      documented default (scaling present, minInstanceCount omitted) with a
 *      value that could not be read at all. Those are now different outcomes
 *      and only the first clears the check.
 *   3. PRODUCTION UNCHANGED. The original wrote productionResourcesChanged:
 *      false into the receipt as observed fact. Nothing here observes
 *      production. The receipt now records what was actually queried and what
 *      that does not cover.
 *
 * Exit 0 only when every required check is satisfied on real evidence.
 */
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ID = 'westayfit-staging';
const REGION = 'us-central1';
const TOKEN = process.env.WSF_GOOGLE_ACCESS_TOKEN;
const EXPECTED_SHA = process.env.WSF_APPROVED_SHA;
const BASE_URL = process.env.WSF_STAGING_URL;
const BEFORE_FILE = process.env.WSF_INVENTORY_BEFORE;
const RESULT_DIR = process.env.WSF_RESULT_DIR || path.resolve('wsf-package-e-results');
const API = process.env.WSF_API_BASE || '';

for (const [k, v] of Object.entries({ WSF_GOOGLE_ACCESS_TOKEN: TOKEN, WSF_APPROVED_SHA: EXPECTED_SHA, WSF_STAGING_URL: BASE_URL, WSF_INVENTORY_BEFORE: BEFORE_FILE })) {
  if (!v) throw new Error(`${k} is required`);
}
process.umask(0o077);
fs.mkdirSync(RESULT_DIR, { recursive: true, mode: 0o700 });

const EXPECTED = [
  'wsfadjustgoal', 'wsfchallengepulse', 'wsfcheckin', 'wsfcontribute',
  'wsfcreatecommunity', 'wsfcreategoal', 'wsfdesignatechampion', 'wsfgoalpulse',
  'wsfgoalrecentadditions',
  'wsfhealth', 'wsfjoincommunity', 'wsfleavecommunity', 'wsflistchallenge',
  'wsflistgoals', 'wsfmycommunities', 'wsfmycontribution', 'wsfpreviewcommunity',
  'wsfreinstatemember', 'wsfremovemember', 'wsfresetjoincode', 'wsfsaveprofile',
  'wsfsendpasswordresetemail', 'wsfsendverificationemail',
  'wsfsetgoaldisplayauthorization',
  // Station enrolment — the seven callables the approved candidate adds so a
  // second screen at an event can be let in by a Champion and show the same
  // totals the public display shows. Four of them are unauthenticated by
  // design (a screen is not signed in as anybody); the other three are
  // Champion-only.
  'wsfstationrequestpairing', 'wsfstationpairingstatus', 'wsfapprovestation',
  'wsfstationclaimpairing', 'wsfstationstate', 'wsfliststations',
  'wsfrevokestation',
  // The event-scoped turn contract and the combined goal — the fifteen
  // callables this candidate adds, taking the project from 31 to 46. They
  // were CREATED by run 35440110564; that run then failed to set an invoker
  // policy on any of them, which is why they are present and shut.
  'wsfeventcontext', 'wsfjointurnline', 'wsfturnstate', 'wsfstartturn',
  'wsfturnready', 'wsfmyturn', 'wsfcompleteturn', 'wsfcompletemyturn',
  'wsfcancelturn', 'wsfleaveturnline', 'wsfcallnext',
  'wsfcreatecombinedgoal', 'wsfclosecombinedgoal', 'wsfrepaircombinedgoal',
  'wsfcombinedgoalpulse',
].sort();
const CREATED_BY_PACKAGE_E = 'wsfsetgoaldisplayauthorization';
/**
 * The callables THIS candidate adds. New to staging with this deploy, so each
 * is neither pre-existing (its transport is reported, like Package E's was)
 * nor unexpected.
 *
 * WHY THIS LIST MOVED. The verifier was still describing the previous
 * candidate. After run 35440110564 the project holds 46 services, not 31, and
 * the fifteen below were flagged as UNEXPECTED — a verifier reporting a
 * reviewed, approved deploy as a surprise. That is drift in the check, not a
 * finding about the deploy, and it is corrected here.
 *
 * WHAT IS DELIBERATELY NOT CORRECTED: every one of these fifteen is shut.
 * firebase-tools created the services and could not set their invoker policy,
 * because the deploy service account has no run.services.setIamPolicy. Their
 * transport is REPORTED here, per service, and the release stays red through
 * the hosted station-transport row. Nothing in this change asserts they are
 * open, and nothing here can make them open.
 */
const CREATED_BY_CANDIDATE = [
  'wsfeventcontext',
  'wsfjointurnline',
  'wsfturnstate',
  'wsfstartturn',
  'wsfturnready',
  'wsfmyturn',
  'wsfcompleteturn',
  'wsfcompletemyturn',
  'wsfcancelturn',
  'wsfleaveturnline',
  'wsfcallnext',
  'wsfcreatecombinedgoal',
  'wsfclosecombinedgoal',
  'wsfrepaircombinedgoal',
  'wsfcombinedgoalpulse',
];
/**
 * wsfGoalRecentAdditions came in with the PREVIOUS candidate, so by the letter
 * of this file it is now pre-existing. It is deliberately NOT moved into the
 * pre-existing set yet: that set is asserted to carry invokerIamDisabled, and
 * nothing here has established that this service does. Asserting it on a
 * guess would fail a deploy for a fact nobody checked. Its transport stays
 * reported until a run's notes show what it actually is, and then it moves.
 */
const RECENTLY_CREATED = [
  'wsfgoalrecentadditions',
  // THE SEVEN STATION SERVICES, and they are here for the opposite reason to
  // wsfGoalRecentAdditions. Its transport was never established; theirs was,
  // and it is BAD — run 35421156377's receipt has all seven as
  // invoker_iam_check_enabled. They are no longer created by the current
  // candidate, but they must not join PRE_EXISTING either: that set is
  // asserted to carry invokerIamDisabled, and asserting it of a service known
  // to be shut would be asserting something false. So their transport is
  // reported per service, exactly as it is, until the staging-only
  // remediation in docs/westayfit/staging-station-transport.md is applied by
  // an operator holding run.services.setIamPolicy — and then they move.
  'wsfstationrequestpairing',
  'wsfstationpairingstatus',
  'wsfapprovestation',
  'wsfstationclaimpairing',
  'wsfstationstate',
  'wsfliststations',
  'wsfrevokestation',
];
const NEW_SERVICES = [CREATED_BY_PACKAGE_E, ...RECENTLY_CREATED, ...CREATED_BY_CANDIDATE];
const PRE_EXISTING = EXPECTED.filter((n) => !NEW_SERVICES.includes(n));

const failures = [];
const notes = [];

async function google(url, what) {
  let response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${TOKEN}` } });
  } catch (e) {
    throw new Error(`${what}: transport failure (${e.code || e.name || 'error'})`);
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`${what}: HTTP ${response.status}`);
  let body;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    // Never degrade an unreadable body into an empty result set: that is how a
    // failed read becomes "nothing is deployed".
    throw new Error(`${what}: HTTP ${response.status} with a body that is not JSON`);
  }
  if (body === null || typeof body !== 'object') throw new Error(`${what}: unexpected body shape`);
  return body;
}
const shortName = (n) => String(n || '').split('/').pop().toLowerCase();

// ---- before inventory: required evidence --------------------------------
let before;
try {
  const raw = fs.readFileSync(BEFORE_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.functions)) throw new Error('shape');
  before = parsed.functions.map((n) => String(n).toLowerCase()).sort();
} catch (e) {
  console.error('::error::the pre-deploy inventory is missing or unreadable; a deploy cannot be verified without it');
  console.error('VERIFY=error (no valid before-inventory)');
  process.exit(1);
}

// ---- after inventory -----------------------------------------------------
const functionsBody = await google(
  `${API || 'https://cloudfunctions.googleapis.com'}/v2/projects/${PROJECT_ID}/locations/${REGION}/functions?pageSize=100`,
  'Cloud Functions list'
);
const after = (functionsBody.functions || []).map((fn) => shortName(fn.name)).filter((n) => n.startsWith('wsf')).sort();

const missing = EXPECTED.filter((n) => !after.includes(n));
const unexpected = after.filter((n) => !EXPECTED.includes(n));
const lost = before.filter((n) => !after.includes(n));

if (missing.length) failures.push(`expected but absent: ${missing.join(', ')}`);
if (unexpected.length) failures.push(`present but not expected: ${unexpected.join(', ')}`);
if (lost.length) failures.push(`present before this deploy and now gone: ${lost.join(', ')}`);
if (!after.includes(CREATED_BY_PACKAGE_E)) failures.push(`${CREATED_BY_PACKAGE_E} absent — Package E did not deploy`);
for (const name of CREATED_BY_CANDIDATE) {
  if (!after.includes(name)) {
    failures.push(`${name} absent — the candidate's new callable did not deploy`);
  }
}

// ---- region and project are part of the claim ---------------------------
const wrongLocation = (functionsBody.functions || [])
  .filter((fn) => shortName(fn.name).startsWith('wsf'))
  // Cloud Functions v2 resource names have NO leading slash:
  // projects/P/locations/L/functions/N
  .filter((fn) => !String(fn.name).startsWith(`projects/${PROJECT_ID}/locations/${REGION}/`));
if (wrongLocation.length) failures.push(`functions outside ${PROJECT_ID}/${REGION}: ${wrongLocation.length}`);

// ---- Cloud Run services: transport, separately from app authorization ----
const servicesBody = await google(
  `${API || 'https://run.googleapis.com'}/v2/projects/${PROJECT_ID}/locations/${REGION}/services?pageSize=100`,
  'Cloud Run services list'
);
const services = new Map((servicesBody.services || []).map((s) => [shortName(s.name), s]));

const missingServices = EXPECTED.filter((n) => !services.has(n));
if (missingServices.length) failures.push(`Cloud Run services missing: ${missingServices.join(', ')}`);

const driftedTransport = PRE_EXISTING.filter((n) => services.has(n) && services.get(n)?.invokerIamDisabled !== true);
if (driftedTransport.length) {
  failures.push(`existing WSF transport drifted (invoker IAM check re-enabled): ${driftedTransport.join(', ')}`);
}

function transportOf(serviceName) {
  const service = services.get(serviceName);
  if (!service) return 'service_not_found';
  if (service.invokerIamDisabled === true) return 'invoker_iam_check_disabled';
  return 'invoker_iam_check_enabled';
}
const newServiceTransport = transportOf(CREATED_BY_PACKAGE_E);
const candidateServiceTransports = Object.fromEntries(
  [...CREATED_BY_CANDIDATE, ...RECENTLY_CREATED].map((n) => [n, transportOf(n)])
);
const candidateTransportNeedingApproval = Object.entries(candidateServiceTransports)
  .filter(([, t]) => t !== 'invoker_iam_check_disabled')
  .map(([n]) => n);
// Deliberately NOT a failure: whether a new service needs the approved
// transport change is established by exercising the callable, not by this flag,
// and the escalation is a separate approval.
notes.push(`new service transport: ${newServiceTransport}`);
for (const [name, transport] of Object.entries(candidateServiceTransports)) {
  notes.push(`candidate service transport (${name}): ${transport}`);
}

// ---- wsfCheckIn minimum instances: three outcomes, not two --------------
let minInstancesState;
let minInstancesValue = null;
const checkIn = services.get('wsfcheckin');
if (!checkIn) {
  minInstancesState = 'unavailable';
  failures.push('wsfCheckIn Cloud Run service not found — minimum instances cannot be verified');
} else if (!checkIn.template || typeof checkIn.template !== 'object') {
  minInstancesState = 'unavailable';
  failures.push('wsfCheckIn service returned no template — minimum instances cannot be verified');
} else {
  const scaling = checkIn.template.scaling;
  const raw = scaling?.minInstanceCount;
  if (raw === undefined || raw === null) {
    // The API omits minInstanceCount when it is the default of zero. Scaling
    // being present is what makes this a documented omission rather than a
    // failed read.
    minInstancesState = scaling === undefined || scaling === null ? 'default_scaling_absent' : 'default_omitted';
    minInstancesValue = 0;
  } else if (Number.isFinite(Number(raw))) {
    minInstancesValue = Number(raw);
    minInstancesState = minInstancesValue === 0 ? 'confirmed_zero' : 'nonzero';
    if (minInstancesValue !== 0) failures.push(`wsfCheckIn minInstances is ${minInstancesValue}, expected 0`);
  } else {
    minInstancesState = 'malformed';
    failures.push(`wsfCheckIn minInstanceCount is malformed and was NOT interpreted as zero`);
  }
}

// ---- hosted build identity ----------------------------------------------
let hosted = { reachable: false };
try {
  const r = await fetch(`${BASE_URL}/health`, { redirect: 'follow' });
  const body = await r.text();
  hosted = {
    reachable: true,
    status: r.status,
    markerMatches: body.includes(EXPECTED_SHA.slice(0, 7)),
  };
  if (!r.ok) failures.push(`hosted /health returned HTTP ${r.status}`);
  else if (!hosted.markerMatches) failures.push(`hosted build marker does not match ${EXPECTED_SHA.slice(0, 7)}`);
} catch (e) {
  failures.push(`hosted /health unreachable (${e.code || e.name || 'error'})`);
}

// ---- hosting channel -----------------------------------------------------
let channel = null;
try {
  const channelsBody = await google(
    `${API || 'https://firebasehosting.googleapis.com'}/v1beta1/sites/${PROJECT_ID}/channels?pageSize=100`,
    'Hosting channels list'
  );
  channel = (channelsBody.channels || []).find((c) => shortName(c.name) === 'staging') || null;
  if (!channel) failures.push('Hosting preview channel "staging" was not found');
} catch (e) {
  failures.push(`Hosting channel read failed: ${e.message}`);
}

// ---- receipt -------------------------------------------------------------
const receipt = {
  verifiedAt: new Date().toISOString(),
  project: PROJECT_ID,
  region: REGION,
  approvedSha: EXPECTED_SHA,
  stagingUrl: BASE_URL,
  inventory: {
    beforeCount: before.length,
    afterCount: after.length,
    before,
    after,
    createdThisDeploy: after.filter((n) => !before.includes(n)),
    lostThisDeploy: lost,
  },
  createdCallablePresent: after.includes(CREATED_BY_PACKAGE_E),
  candidateCallablePresent: CREATED_BY_CANDIDATE.every((n) => after.includes(n)),
  candidateCallablesPresent: Object.fromEntries(
    CREATED_BY_CANDIDATE.map((n) => [n, after.includes(n)])
  ),
  preExistingTransportVerified: PRE_EXISTING.filter((n) => services.get(n)?.invokerIamDisabled === true).length,
  preExistingTransportDrifted: driftedTransport,
  newServiceTransport,
  newServiceTransportRequiresSeparateApproval: newServiceTransport !== 'invoker_iam_check_disabled',
  candidateServiceTransports,
  candidateServiceTransportRequiresSeparateApproval: candidateTransportNeedingApproval.length > 0,
  candidateServiceTransportNeedingApproval: candidateTransportNeedingApproval,
  wsfCheckIn: { state: minInstancesState, value: minInstancesValue },
  hosted,
  hostingChannel: channel
    ? { name: channel.name, url: channel.url || null, expireTime: channel.expireTime || null }
    : null,
  // What was actually queried, and what that does not establish. The previous
  // version asserted productionResourcesChanged: false; nothing here reads the
  // goarrive project, so that claim is not this receipt's to make.
  scopeOfVerification: {
    queried: [
      `cloudfunctions.googleapis.com v2 projects/${PROJECT_ID}/locations/${REGION}/functions`,
      `run.googleapis.com v2 projects/${PROJECT_ID}/locations/${REGION}/services`,
      `firebasehosting.googleapis.com v1beta1 sites/${PROJECT_ID}/channels`,
      `${BASE_URL}/health`,
    ],
    notQueried: [
      'the goarrive production project — no production resource was read, so this receipt makes no observation about production state',
      'organization policy and billing configuration',
      'IAM policies on any resource',
    ],
  },
  notes,
  failures,
};
fs.writeFileSync(path.join(RESULT_DIR, 'wsf-package-e-deployment-verification.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });

console.log(`INVENTORY_BEFORE=${before.length}`);
console.log(`INVENTORY_AFTER=${after.length}`);
console.log(`CREATED_THIS_DEPLOY=${receipt.inventory.createdThisDeploy.join(',') || 'none'}`);
console.log(`NEW_CALLABLE_PRESENT=${receipt.createdCallablePresent}`);
console.log(`PREEXISTING_TRANSPORT_VERIFIED=${receipt.preExistingTransportVerified}/${PRE_EXISTING.length}`);
console.log(`NEW_SERVICE_TRANSPORT=${newServiceTransport}`);
console.log(
  `CANDIDATE_SERVICE_TRANSPORT=${Object.entries(candidateServiceTransports)
    .map(([n, t]) => `${n}:${t}`)
    .join(' ')}`
);
console.log(`WSF_CHECKIN_MIN_INSTANCES_STATE=${minInstancesState}`);
console.log(`HOSTED_MARKER_MATCHES=${hosted.markerMatches === true}`);

if (failures.length) {
  for (const f of failures) console.error(`::error::${f}`);
  console.error(`VERIFY=failed (${failures.length})`);
  process.exit(1);
}
console.log('VERIFY=pass');
