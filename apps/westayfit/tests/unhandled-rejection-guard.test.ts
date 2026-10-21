import { describe, expect, it } from 'vitest';

import { assertNoUnhandledRejections, useUnhandledRejectionGuard } from './unhandledRejectionGuard';

/**
 * RV16-639-3. The guard's own behaviour (tests/unhandledRejectionGuard.ts), in
 * the shipped suite rather than only in a mutant log.
 *
 * Node's events are emitted with `process.emit`, against a promise that never
 * rejects, so no real rejection escapes this file. While the guard is
 * installed vitest leaves the reporting to it, so each case clears what it
 * emitted; the file's own afterAll then checks that nothing is left.
 */
useUnhandledRejectionGuard();

/** A promise that never rejects, standing in for the one Node names. */
const standIn = () => new Promise<void>(() => undefined);

/** What `assertNoUnhandledRejections` threw, or undefined. */
function caught(): { message: string; actual?: unknown } | undefined {
  try {
    assertNoUnhandledRejections();
    return undefined;
  } catch (e) {
    return e as { message: string; actual?: unknown };
  }
}

describe('the unhandled-rejection guard', () => {
  it('a reported rejection fails the check, naming the test it was reported during, and is then cleared', () => {
    process.emit('unhandledRejection', new Error('boom'), standIn());
    const error = caught();
    expect(error?.message).toMatch(/reported during/);
    expect(error?.actual).toEqual([`boom (reported during: ${expect.getState().currentTestName})`]);
    // Cleared by the check that reported it: a second check passes.
    expect(() => assertNoUnhandledRejections()).not.toThrow();
  });

  it('a rejection handled late (rejectionHandled) is dropped', () => {
    const p = standIn();
    process.emit('unhandledRejection', new Error('handled-late'), p);
    process.emit('rejectionHandled', p);
    expect(() => assertNoUnhandledRejections()).not.toThrow();
  });

  it('only the promise handled late is dropped; another one reported with it still fails', () => {
    const late = standIn();
    process.emit('unhandledRejection', new Error('handled-late'), late);
    process.emit('unhandledRejection', new Error('never-handled'), standIn());
    process.emit('rejectionHandled', late);
    expect(caught()?.actual).toEqual([`never-handled (reported during: ${expect.getState().currentTestName})`]);
  });

  it('a reason that is not an Error is reported as text', () => {
    process.emit('unhandledRejection', 'plain reason', standIn());
    expect(caught()?.actual).toEqual([`plain reason (reported during: ${expect.getState().currentTestName})`]);
  });
});
