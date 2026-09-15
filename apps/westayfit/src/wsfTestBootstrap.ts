/**
 * WSF-only test bootstrap for emulator isolation (Execution Addendum 1 §2).
 *
 * Nothing here runs in a deployed build. It exists so the local test path can
 * establish, before it does anything, that it is talking to the emulator suite
 * — and **stop loudly if it is not**.
 *
 * The rule it enforces: a missing or incomplete emulator configuration is a
 * hard failure, never a degraded run against live Auth, Firestore or
 * Functions. There is no fallback path, because a silent fallback is exactly
 * the failure mode worth preventing.
 *
 * It reports the project selected and the service destinations it would use,
 * in plain text and without any secret — the Firebase web config is
 * publishable by design, but the API key is still not printed here.
 */
import { wsfEmulatorTargets } from './firebase';

export type EmulatorCheck =
  | { ok: true; report: string }
  | { ok: false; problem: string; report: string };

function describe(): string {
  const t = wsfEmulatorTargets;
  return [
    'WSF local test target',
    `  project selected     : ${t.projectId}`,
    `  emulator project id  : ${t.emulatorProjectId}`,
    `  production project id: ${t.productionProjectId}`,
    `  auth                 : http://${t.host}:${t.authPort}`,
    `  firestore            : ${t.host}:${t.firestorePort}`,
    `  functions            : ${t.host}:${t.functionsPort}`,
    `  emulated             : ${String(t.emulated)}`,
  ].join('\n');
}

/**
 * Decide whether the local test path may proceed.
 *
 * Pure apart from reading the already-resolved targets, so the failure modes
 * are unit-testable without an emulator running.
 */
export function checkEmulatorIsolation(): EmulatorCheck {
  const t = wsfEmulatorTargets;
  const report = describe();

  if (!t.emulated) {
    return {
      ok: false,
      report,
      problem:
        'emulator mode is OFF. The local test path will not run against live services. ' +
        'Set the emulator build flag and serve the app from a loopback host.',
    };
  }

  if (t.projectId !== t.emulatorProjectId) {
    return {
      ok: false,
      report,
      problem:
        `the selected project is "${t.projectId}", not the emulator project ` +
        `"${t.emulatorProjectId}". Refusing to continue.`,
    };
  }

  // The equality above already excludes the production id by construction —
  // the selector can only return one of the two — so no separate production
  // check is needed, and TypeScript rejects one as unreachable.

  for (const [service, port] of [
    ['auth', t.authPort],
    ['firestore', t.firestorePort],
    ['functions', t.functionsPort],
  ] as const) {
    if (!Number.isInteger(port) || port <= 0) {
      return { ok: false, report, problem: `the ${service} emulator port is not configured.` };
    }
  }

  if (t.host !== '127.0.0.1' && t.host !== 'localhost') {
    return {
      ok: false,
      report,
      problem: `emulator host "${t.host}" is not loopback. Refusing to continue.`,
    };
  }

  return { ok: true, report };
}

/** Throw unless the local test path is isolated. Prints the destinations either way. */
export function requireEmulatorIsolation(): void {
  const result = checkEmulatorIsolation();
  // eslint-disable-next-line no-console
  console.info(result.report);
  if (!result.ok) {
    throw new Error(
      `WSF LOCAL TEST PATH REFUSED — emulator configuration is incomplete.\n  ${result.problem}\n` +
        `  It will not fall back to live Auth, Firestore or Functions.`
    );
  }
}
