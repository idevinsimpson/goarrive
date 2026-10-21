import { afterAll, beforeAll, expect } from 'vitest';

/**
 * A PROMISE NOBODY HANDLES IS A FAILURE, NOT A SILENT PASS (heads-12 W13-7,
 * heads-13 RV15-639-N1).
 *
 * Node reports an unhandled rejection some time after it happens, and only
 * then. This guard records each one Node reports while a file runs, with the
 * name of the test that was running WHEN NODE REPORTED IT (vitest's
 * `currentTestName`), which is usually, but not always, the test that raised
 * it: a rejection that surfaces after a test's drain is reported during the
 * next test, and one between tests is reported with no test name.
 *
 *   - `assertNoUnhandledRejections()` fails the calling hook with every
 *     rejection reported since the last check, each with the test it was
 *     reported during. Call it from afterEach (in a `finally`, after the
 *     test's pending work has been drained), so a throwing cleanup cannot
 *     leave entries for the next test.
 *   - A rejection that is handled after all (Node's 'rejectionHandled') is
 *     dropped: handling it late is legitimate.
 *   - `useUnhandledRejectionGuard()` installs the listeners for the file and,
 *     in afterAll, fails on anything reported after the last check, so the
 *     tail is never silent. (While this listener is installed, vitest does
 *     not report unhandled rejections itself: it assumes user code handles
 *     them. This guard is that code, so it must not drop any.)
 */
type Reported = { reason: unknown; during: string | undefined };

const reported = new Map<Promise<unknown>, Reported>();

const onUnhandled = (reason: unknown, promise: Promise<unknown>) => {
  reported.set(promise, { reason, during: expect.getState().currentTestName });
};
const onHandled = (promise: Promise<unknown>) => {
  reported.delete(promise);
};

function describeReason(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Fails with every unhandled rejection Node reported since the last check, naming the test it was reported during. */
export function assertNoUnhandledRejections(where = 'this test'): void {
  const seen = [...reported.values()].map(
    (r) => `${describeReason(r.reason)} (reported during: ${r.during ?? 'no test'})`,
  );
  reported.clear();
  expect(seen, `unhandled rejections Node reported during ${where}`).toEqual([]);
}

/** Install the guard for the file this is called from (top level). */
export function useUnhandledRejectionGuard(): void {
  beforeAll(() => {
    process.on('unhandledRejection', onUnhandled);
    process.on('rejectionHandled', onHandled);
  });
  afterAll(() => {
    try {
      assertNoUnhandledRejections('this file, after its last test');
    } finally {
      process.off('unhandledRejection', onUnhandled);
      process.off('rejectionHandled', onHandled);
    }
  });
}
