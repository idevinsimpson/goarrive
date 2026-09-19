import { beforeEach, describe, expect, it } from 'vitest';

import {
  beginVerificationSend,
  forgetVerificationSend,
  readVerificationSend,
  recordVerificationSend,
  subscribeVerificationSend,
} from '../src/verificationSendState';

describe('verification send state', () => {
  beforeEach(() => forgetVerificationSend());

  it('knows nothing until an attempt is recorded', () => {
    expect(readVerificationSend('uid-a')).toBeNull();
  });

  it('reports the outcome recorded for that account', () => {
    recordVerificationSend('uid-a', 'sent');
    expect(readVerificationSend('uid-a')).toBe('sent');
    recordVerificationSend('uid-a', 'unconfigured');
    expect(readVerificationSend('uid-a')).toBe('unconfigured');
  });

  // The whole point of the uid: one account's outcome must never describe
  // another's. A screen that cannot match the account says nothing rather than
  // something plausible.
  it("never reports one account's outcome for another", () => {
    recordVerificationSend('uid-a', 'sent');
    expect(readVerificationSend('uid-b')).toBeNull();
    expect(readVerificationSend(null)).toBeNull();
    expect(readVerificationSend(undefined)).toBeNull();
  });

  it('forgets on sign-out, so the next account starts from nothing', () => {
    recordVerificationSend('uid-a', 'sent');
    forgetVerificationSend();
    expect(readVerificationSend('uid-a')).toBeNull();
  });

  it('ignores a record with no account', () => {
    recordVerificationSend('', 'sent');
    expect(readVerificationSend('')).toBeNull();
  });

  // The render boundary this module exists for: the send finishes while the
  // verify screen is already mounted, so storing the answer is not enough —
  // whoever is showing it has to be told.
  it('notifies subscribers when an outcome arrives', () => {
    let notifications = 0;
    const stop = subscribeVerificationSend(() => {
      notifications += 1;
    });
    const attempt = beginVerificationSend('uid-a');
    expect(notifications).toBe(1);
    expect(readVerificationSend('uid-a')).toBe('sending');
    recordVerificationSend('uid-a', 'unconfigured', attempt);
    expect(notifications).toBe(2);
    expect(readVerificationSend('uid-a')).toBe('unconfigured');
    stop();
    recordVerificationSend('uid-a', 'sent');
    expect(notifications).toBe(2);
  });

  // A slow send from sign-up must not overwrite the answer to a Resend the
  // member asked for afterwards.
  it('lets a newer attempt win over a late one', () => {
    const first = beginVerificationSend('uid-a');
    const second = beginVerificationSend('uid-a');
    recordVerificationSend('uid-a', 'sent', second);
    expect(readVerificationSend('uid-a')).toBe('sent');
    // The first attempt finally answers, too late to matter.
    recordVerificationSend('uid-a', 'failed', first);
    expect(readVerificationSend('uid-a')).toBe('sent');
  });

  // A send that lands after the member signed out must not describe whoever
  // signs in next.
  it('ignores a completion that lands after sign-out', () => {
    const attempt = beginVerificationSend('uid-a');
    forgetVerificationSend();
    recordVerificationSend('uid-a', 'sent', attempt);
    expect(readVerificationSend('uid-a')).toBeNull();
  });
});
