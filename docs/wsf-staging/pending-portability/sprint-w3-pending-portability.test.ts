/**
 * INTENDED DESTINATION: apps/westayfit/tests/sprint-w3-pending-portability.test.ts
 * (the westayfit vitest harness, on the `claude/wsf-app-shell` lineage).
 *
 * It is parked here because this worker's session may push only to its own
 * branch, which does not carry `apps/westayfit/`. Move it to the path above
 * unchanged; it needs no edits.
 *
 * ── What this covers that the existing tests do not ──────────────────────────
 *
 * `contribute-account-isolation.test.ts` proves a DIFFERENT uid cannot read the
 * record, and `kiosk-session.test.ts` proves an unresolved attempt survives
 * Finish. Both use ONE `window.localStorage`, so both are about one device.
 *
 * Nothing covered the SAME uid in TWO independent storages — which is the only
 * question that decides whether "check it from your own device" is true. Note
 * in particular that `kiosk-session.test.ts`'s "leaves an unresolved attempt
 * readable by the member who made it" reads as if it settled this; it asserts
 * `window.localStorage.getItem(...)` in the same context, so it establishes
 * retention on the kiosk, not portability away from it.
 *
 * Storage-level, not a browser run: two `localStorage` backings are swapped
 * under the module, which reads `window.localStorage` at call time. That models
 * two devices for every purpose this module has, and claims nothing about
 * rendering, routing or the network.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearPendingIfAttempt,
  loadPending,
  pendingKey,
  savePendingNew,
  type PendingContribution,
} from '../src/pendingContribution';

const GOAL = 'goal-1';
const UID = 'uid-a';
const OTHER_UID = 'uid-b';
const ATTEMPT = 'attempt-xyz';

class FakeStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
  keys(): string[] {
    return [...this.m.keys()];
  }
}

let kiosk: FakeStorage;
let ownDevice: FakeStorage;
const on = (s: FakeStorage) => {
  (globalThis as unknown as { window: unknown }).window = { localStorage: s };
};

const row = (): PendingContribution => ({
  goalId: GOAL,
  attemptId: ATTEMPT,
  count: 30,
  ts: Date.now(),
  state: 'unknown',
});

beforeEach(() => {
  kiosk = new FakeStorage();
  ownDevice = new FakeStorage();
  on(kiosk);
  savePendingNew(row(), UID);
});

describe('an unresolved attempt does not travel with the account', () => {
  it('is readable on the device that made it', () => {
    on(kiosk);
    expect(loadPending(GOAL, UID)).toMatchObject({ attemptId: ATTEMPT, state: 'unknown' });
  });

  it('IS INVISIBLE TO THE SAME MEMBER ON THEIR OWN DEVICE', () => {
    // The claim under test: "check it from your own device."
    on(ownDevice);
    expect(loadPending(GOAL, UID)).toBeNull();
    expect(ownDevice.keys()).toEqual([]);
  });

  it('keeps the attempt id only where it was written, so it cannot be replayed from elsewhere', () => {
    // Replaying the SAME attempt id is what returns the original receipt
    // instead of booking a second contribution. Without the id, the other
    // device has no idempotent move available to it.
    on(kiosk);
    expect(kiosk.keys()).toEqual([pendingKey(GOAL, UID)]);
    on(ownDevice);
    expect(ownDevice.keys()).toEqual([]);
  });

  it('survives an unresolved Finish on the kiosk and is still invisible on the own device', () => {
    // kioskFinishPlan sets clearPendingDraft:false for 'unresolved', so Finish
    // does not clear it. Retention and invisibility are asserted together:
    // separately, either one reads as reassuring.
    on(kiosk);
    expect(kiosk.getItem(pendingKey(GOAL, UID))).not.toBeNull();
    on(ownDevice);
    expect(loadPending(GOAL, UID)).toBeNull();
  });

  it('cannot be inherited by another account on either device', () => {
    on(kiosk);
    expect(loadPending(GOAL, OTHER_UID)).toBeNull();
    on(ownDevice);
    expect(loadPending(GOAL, OTHER_UID)).toBeNull();
  });
});

describe('the local record cannot answer whether the attempt landed', () => {
  it('refuses to parse a settled state, so "confirmed" is not representable', () => {
    // `state` is only 'sending' | 'unknown'. The store is a reminder that an
    // attempt happened, never a record of its outcome — so the outcome has to
    // come from the server (wsfMyContribution), not from this key.
    on(kiosk);
    kiosk.setItem(pendingKey(GOAL, UID), JSON.stringify({ ...row(), state: 'confirmed' }));
    expect(loadPending(GOAL, UID)).toBeNull();
  });
});

describe('control', () => {
  it('a resolved Finish does clear the record, so the guard above is not vacuous', () => {
    on(kiosk);
    expect(clearPendingIfAttempt(GOAL, UID, ATTEMPT)).toBe(true);
    expect(loadPending(GOAL, UID)).toBeNull();
  });
});
