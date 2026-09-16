/**
 * DEPLOYMENT CONFIGURATION, not runtime behaviour.
 *
 * These tests read the deployment metadata Firebase itself discovers — the
 * `__endpoint` the SDK attaches to each exported function — and resolve it the
 * way the CLI does. They never invoke a handler, never touch Firestore and
 * never need an emulator, which is why they run under their own jest config
 * instead of the callable suite's.
 *
 * The blocker they exist for: wsfCheckIn declared `minInstances: 1`, which
 * keeps an instance warm and billing continuously. That is deliberate for
 * production — a cold start on check-in is the one latency anybody sees at the
 * event — and wrong for a staging project, which has no event to be fast for
 * and was blocked from deploying because of it.
 */

// A demo project and a loopback Firestore host, so nothing here could reach a
// real backend even though no handler is invoked.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Expression } from 'firebase-functions/params';

import * as wsf from '../../src/index';

const PRODUCTION = 'goarrive';
const STAGING = 'westayfit-staging';

type Endpoint = {
  minInstances?: unknown;
  region?: unknown;
  callableTrigger?: unknown;
};

function endpointOf(name: string): Endpoint {
  const fn = (wsf as unknown as Record<string, { __endpoint?: Endpoint }>)[name];
  if (!fn?.__endpoint) throw new Error(`${name} is not an exported function with deployment metadata`);
  return fn.__endpoint;
}

/**
 * Resolve a deployment value the way the Firebase CLI does during discovery:
 * firebase-functions' built-in projectID parameter reads the target project
 * out of FIREBASE_CONFIG, which the CLI sets from `--project`.
 */
function resolveForProject(value: unknown, projectId: string): unknown {
  const previous = process.env.FIREBASE_CONFIG;
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
  try {
    if (value instanceof Expression) {
      return (value as unknown as { runtimeValue: () => unknown }).runtimeValue();
    }
    return value;
  } finally {
    if (previous === undefined) delete process.env.FIREBASE_CONFIG;
    else process.env.FIREBASE_CONFIG = previous;
  }
}

/** Unset, zero, or the SDK's ResetValue marker all mean "keep nothing warm". */
function isNoMinimum(resolved: unknown): boolean {
  if (resolved === undefined || resolved === null || resolved === 0) return true;
  return resolved?.constructor?.name === 'ResetValue';
}

describe('wsfCheckIn minimum instances resolve per project at deploy time', () => {
  it('is a deploy-time expression on the EXPORTED callable, not a fixed number', () => {
    // Read off the real exported function's metadata. A helper that agreed
    // while the export still said `1` would prove nothing.
    const ep = endpointOf('wsfCheckIn');
    expect(ep.minInstances).toBeInstanceOf(Expression);
  });

  it(`resolves to 0 for ${STAGING}`, () => {
    expect(resolveForProject(endpointOf('wsfCheckIn').minInstances, STAGING)).toBe(0);
  });

  it(`resolves to 1 for ${PRODUCTION}, unchanged`, () => {
    expect(resolveForProject(endpointOf('wsfCheckIn').minInstances, PRODUCTION)).toBe(1);
  });

  it('resolves to 0 for any other project, including the local demo project', () => {
    // Production is the only project that pays to stay warm. Anything else —
    // a future preview project, the demo project — costs nothing by default.
    for (const project of ['demo-wsf-local', 'some-future-preview', '']) {
      expect(resolveForProject(endpointOf('wsfCheckIn').minInstances, project)).toBe(0);
    }
  });

  it('compiles to the CEL expression Firebase evaluates while preparing the deploy', () => {
    const cel = (
      endpointOf('wsfCheckIn').minInstances as unknown as { toCEL: () => string }
    ).toCEL();
    expect(cel).toBe(`{{ params.PROJECT_ID == "${PRODUCTION}" ? 1 : 0 }}`);
  });

  it('leaves the rest of wsfCheckIn deployment configuration alone', () => {
    const ep = endpointOf('wsfCheckIn');
    expect(ep.region).toEqual(['us-central1']);
    expect(ep.callableTrigger).toBeDefined();
  });
});

describe('no other WSF function keeps an instance warm', () => {
  // The same blocker would recur from any other positive minimum, so this
  // asserts across every exported function rather than trusting a grep.
  it('every other export has no warm minimum for either project', () => {
    const offenders: string[] = [];
    for (const [name, value] of Object.entries(wsf as unknown as Record<string, unknown>)) {
      const ep = (value as { __endpoint?: Endpoint } | undefined)?.__endpoint;
      if (!ep || name === 'wsfCheckIn') continue;
      for (const project of [PRODUCTION, STAGING]) {
        const resolved = resolveForProject(ep.minInstances, project);
        // ResetValue is the SDK's "use the platform default" marker and
        // serialises to null; it means no warm instance, same as unset.
        if (!isNoMinimum(resolved)) {
          offenders.push(`${name} -> ${JSON.stringify(resolved)} on ${project}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('covers a meaningful number of exported functions', () => {
    // Guards the assertion above from passing because nothing was inspected.
    const withEndpoints = Object.values(wsf as unknown as Record<string, unknown>).filter(
      (v) => (v as { __endpoint?: unknown } | undefined)?.__endpoint
    );
    expect(withEndpoints.length).toBeGreaterThanOrEqual(20);
  });
});
