/**
 * The Step-7 staging fast path (STAGING-FRESHNESS-FASTPATH; accepted A+ memo §9.1–§9.3), as pure functions.
 *
 *  - previewEligible   a merge is member-visible when it changes `apps/westayfit/**` (§9.1, R-PREVIEW-ELIGIBLE).
 *                      Docs, evidence, R&D and ops-only merges are never eligible, so they never make staging BEHIND.
 *  - candidate         the NEWEST integrated, preview-eligible merge on the canonical development branch. Only the
 *                      newest is ever a target: an older one is never staged on purpose (coalescing, Phase D row 13).
 *  - fastPathReasons   the §9.3 invariants, against the last FULL-PATH pin (the reviewed approved-candidate.json):
 *                      the candidate descends from the pin, and every path changed since the pin is member-visible
 *                      source outside every protected path. The functions tree is then unchanged, so the pin's
 *                      verified inventory still holds. Any failure is a reason, and the candidate takes the full,
 *                      reviewed path (`BEHIND reason=full-path-required`).
 *  - targetLine        R-FASTPATH `set-target`, derived only when the pin is the recorded served full-path deploy
 *                      (set-staging, with its rollback SHA) and every invariant holds.
 *
 * Nothing here reads the network, dispatches or deploys. The staging gate re-checks the target with git before
 * anything is built, so this is the writer's early, cheap answer; the gate's is the authoritative one.
 */
import { line } from './router.mjs';

export const MEMBER_VISIBLE = 'apps/westayfit/';

/**
 * The protected paths: a change to any of them leaves the fast path. A superset of PROTECTED_PATHS in
 * .github/wsf-staging/pin-candidate.mjs (the writer is pinned on its own code, so it cannot import that file;
 * tests/fastpath.test.mjs holds the two together), plus the §9.3 names wherever they occur.
 */
export const PROTECTED_PREFIXES = Object.freeze([
  'firebase.westayfit.json', 'firebase.westayfit.emulators.json', 'firestore.rules', 'firestore.indexes.json', 'firebase.json',
  '.firebaserc', 'package.json', 'package-lock.json', 'apps/westayfit/package.json', 'apps/westayfit/app.json', '.github/',
  'scripts/westayfit/', 'functions/', 'functions-westayfit/',
]);
const PROTECTED_NAMES = Object.freeze([
  /(^|\/)package(-lock)?\.json$/, /(^|\/)(npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/, /(^|\/)app\.json$/, /(^|\/)app\.config\.[^/]+$/,
  /(^|\/)firebase[^/]*\.json$/, /(^|\/)\.firebaserc$/, /(^|\/)(firestore|storage)\.rules$/, /(^|\/)firestore\.indexes\.json$/,
]);

export const previewEligible = (paths) => Array.isArray(paths) && paths.some((p) => p.startsWith(MEMBER_VISIBLE));
export const protectedPath = (p) => PROTECTED_PREFIXES.some((x) => (x.endsWith('/') ? p.startsWith(x) : p === x)) || PROTECTED_NAMES.some((re) => re.test(p));

const s8 = (sha) => String(sha).slice(0, 8);
const some = (xs) => `${xs.slice(0, 5).join(', ')}${xs.length > 5 ? ` and ${xs.length - 5} more` : ''}`;

/** The deployed functions source: its tree must be the pin's, whatever the path list says (defence in depth). */
export const FUNCTIONS_TREE = 'functions-westayfit';

/**
 * The §9.3 invariants for `candidate` against the full-path `pin`. Empty means the fast path holds. `functionsTree` is
 * { pin, candidate }: the git tree ids of functions-westayfit at both, compared independently of the path list.
 */
export function fastPathReasons({ pinSha, candidateSha, descends, paths, functionsTree }) {
  const out = [];
  const ft = functionsTree ?? {};
  if (typeof ft.pin !== 'string' || typeof ft.candidate !== 'string') out.push(`the ${FUNCTIONS_TREE} tree could not be compared`);
  else if (ft.pin !== ft.candidate) out.push(`the ${FUNCTIONS_TREE} tree changed (${ft.pin.slice(0, 8) || 'absent'} → ${ft.candidate.slice(0, 8) || 'absent'})`);
  if (descends === null || descends === undefined) out.push(`lineage: whether ${s8(candidateSha)} descends from the pin ${s8(pinSha)} could not be read`);
  else if (descends !== true) out.push(`lineage: ${s8(candidateSha)} does not descend from the pin ${s8(pinSha)}`);
  if (!Array.isArray(paths)) { out.push(`the diff ${s8(pinSha)}..${s8(candidateSha)} could not be read in full`); return out; }
  if (!paths.length) out.push(`the diff ${s8(pinSha)}..${s8(candidateSha)} is empty`);
  const outside = paths.filter((p) => !p.startsWith(MEMBER_VISIBLE));
  if (outside.length) out.push(`paths outside ${MEMBER_VISIBLE} changed: ${some(outside)}`);
  const prot = paths.filter(protectedPath);
  if (prot.length) out.push(`protected paths changed: ${some(prot)}`);
  return out;
}

/** Integrated work packets, newest integration first: [{ packet, mergeSha, pr }]. Reads the ledger order. */
export function integrations(state, eventsText) {
  const order = [];
  for (const text of eventsText.trimEnd().split('\n').filter(Boolean)) {
    const e = JSON.parse(text);
    if (e.type === 'integrate') order.push(e.packet);
  }
  const seen = new Set();
  const out = [];
  for (const id of order.reverse()) {
    if (seen.has(id)) continue;
    seen.add(id);
    const p = state.packets[id];
    if (p?.kind === 'work' && p.phase === 'INTEGRATED' && p.artifact.mergeSha && p.pr !== null) out.push({ packet: id, mergeSha: p.artifact.mergeSha, pr: p.pr });
  }
  return out;
}

/**
 * The fast-path decision on this state from the writer's own reads (router-run.mjs fastpathReads):
 *   reads = { pin: { sha } | null, candidate: { packet, mergeSha, pr } | null, descends, paths }
 * Returns { line } (a set-target to append), or { report } (why there is none: a closed reason, never guessed).
 */
export function targetDecision(state, reads) {
  if (!reads?.pin?.sha) return { report: 'NONE reason=the full-path pin (approved-candidate.json at the running main) could not be read' };
  const pinSha = reads.pin.sha;
  if (reads.unknown) return { report: `NONE reason=${reads.unknown}` };
  const c = reads.candidate;
  if (!c) return { report: `NONE reason=no integrated preview-eligible merge on the development branch beyond the pin ${s8(pinSha)}` };
  if (c.mergeSha === pinSha) return { report: `NONE reason=the newest candidate ${s8(c.mergeSha)} (${c.packet}) is the full-path pin` };
  if (state.stagingTarget?.appSha === c.mergeSha) return { report: `HELD target=${c.mergeSha} packet=${c.packet}` };
  if (!state.staging || state.staging.servedSha !== pinSha) {
    return { report: `FULL_PATH_REQUIRED candidate=${c.mergeSha} packet=${c.packet} reason=the pin ${s8(pinSha)} is not the recorded served full-path deploy (set-staging ${state.staging ? s8(state.staging.servedSha) : 'none'})` };
  }
  const reasons = fastPathReasons({ pinSha, candidateSha: c.mergeSha, descends: reads.descends, paths: reads.paths, functionsTree: reads.functionsTree });
  if (reasons.length) return { report: `FULL_PATH_REQUIRED candidate=${c.mergeSha} packet=${c.packet} reason=${reasons.join('; ')}` };
  const pr = { kind: 'pull_request', id: c.pr };
  return { line: line(state.repository, 'set-target', { packet: c.packet, appSha: c.mergeSha, pinSha }, pr, 'R-FASTPATH', [pr, { kind: 'commit', id: c.mergeSha }, { kind: 'commit', id: pinSha }]) };
}

// ---- freshness readback (memo §9.1; acceptance contract "Staging freshness is also derived control state") ----------

/** The staging site the deploy verifier reads; the same value as STAGING_URL in wsf-staging-deploy.yml (held by a test). */
export const STAGING_URL = 'https://westayfit-staging--staging-4a616y5m.web.app';
export const STAGING_WORKFLOW = 'wsf-staging-deploy.yml';
/** The run title of a deploy-mode staging run (the workflow's run-name). Runs titled otherwise are not deploys. */
export const DEPLOY_TITLE = 'WSF staging · mode=deploy';

/** The served SHA: the first of `shas` whose 7-character prefix the hosted /health page names (the verifier's rule). */
export const servedOf = (healthText, shas) => (typeof healthText === 'string' ? shas.find((x) => x && healthText.includes(x.slice(0, 7))) ?? null : null);

/**
 * The facts freshness-view reads, from the writer's own reads: the candidate (the newest preview-eligible merge, or the
 * pin when nothing newer is eligible), the served SHA from the hosted marker, and the newest active and completed
 * deploy-mode staging runs. `runs` null means the runs could not be read; untitled (older) runs are not classified.
 */
export function freshnessFacts(state, reads, { health, runs }) {
  const candidateSha = reads?.candidate?.mergeSha ?? reads?.pin?.sha ?? null;
  const servedSha = servedOf(health, [candidateSha, state.stagingTarget?.appSha, reads?.pin?.sha, state.staging?.servedSha]);
  const deploys = Array.isArray(runs) ? runs.filter((r) => r.title === DEPLOY_TITLE) : null;
  const active = deploys?.find((r) => r.status !== 'completed') ?? null;
  const last = deploys?.find((r) => r.status === 'completed') ?? null;
  return {
    candidateSha, servedSha,
    activeRun: active && { id: active.id, status: active.status },
    lastRun: last && { id: last.id, conclusion: last.conclusion },
    runs: deploys === null ? 'unread' : deploys.length ? 'classified' : 'none-titled',
  };
}

