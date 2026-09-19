import { beforeEach, describe, expect, it } from 'vitest';

import {
  forgetVerificationSend,
  readVerificationSend,
  recordVerificationSend,
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
});
