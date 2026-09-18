import { describe, expect, it } from 'vitest';

import { encodeQr } from '../src/ui/qr';
import { LINK_JOINABLE_POLICIES, buildJoinUrl, isLinkJoinable } from '../src/ui/joinLink';

/**
 * The join URL is the one string the copy control, the share sheet and the QR
 * all have to agree on. These tests pin the derivation itself — that it is the
 * server's own admission rule, and that it returns NOTHING rather than
 * something plausible when the community does not admit by link.
 */

const CODE = '9wq2Zc4TpK1nRu7bVdA0Xg';

describe('isLinkJoinable', () => {
  it('matches the server LINK_JOINABLE set exactly', () => {
    // functions-westayfit/src/index.ts: new Set(['public', 'inviteOnly'])
    expect([...LINK_JOINABLE_POLICIES].sort()).toEqual(['inviteOnly', 'public']);
    expect(isLinkJoinable('public')).toBe(true);
    expect(isLinkJoinable('inviteOnly')).toBe(true);
  });

  it('treats private, unknown and missing policies as not joinable', () => {
    // The default direction matters: an unrecognised policy must fall on the
    // closed side. Being wrong the other way hands out a working invite link
    // for a community whose policy this build does not understand.
    for (const policy of ['private', 'PUBLIC', 'inviteonly', 'somethingNew', '', null, undefined]) {
      expect(isLinkJoinable(policy as string | null | undefined), String(policy)).toBe(false);
    }
  });
});

describe('buildJoinUrl', () => {
  it('builds the /join/<code> URL on the current origin', () => {
    expect(
      buildJoinUrl({ origin: 'https://westayfit.example.com', joinCode: CODE, joinPolicy: 'public' })
    ).toBe(`https://westayfit.example.com/join/${CODE}`);
    expect(
      buildJoinUrl({
        origin: 'https://westayfit.example.com',
        joinCode: CODE,
        joinPolicy: 'inviteOnly',
      })
    ).toBe(`https://westayfit.example.com/join/${CODE}`);
  });

  it('never builds a URL for a private community, even with a code in hand', () => {
    // Private groups DO carry a joinCode — it is minted on create so the
    // callables cannot be used as an existence oracle. Having one must not be
    // mistaken for being joinable by one.
    expect(buildJoinUrl({ origin: 'https://x.example', joinCode: CODE, joinPolicy: 'private' })).toBe(
      null
    );
    expect(
      buildJoinUrl({ origin: 'https://x.example', joinCode: CODE, joinPolicy: 'brandNew' })
    ).toBe(null);
  });

  it('returns null rather than a partial URL when something is missing', () => {
    expect(buildJoinUrl({ origin: null, joinCode: CODE, joinPolicy: 'public' })).toBe(null);
    expect(buildJoinUrl({ origin: undefined, joinCode: CODE, joinPolicy: 'public' })).toBe(null);
    expect(buildJoinUrl({ origin: 'https://x.example', joinCode: null, joinPolicy: 'public' })).toBe(
      null
    );
    expect(buildJoinUrl({ origin: 'https://x.example', joinCode: '', joinPolicy: 'public' })).toBe(
      null
    );
  });

  it('does not double a slash when the origin carries one', () => {
    expect(
      buildJoinUrl({ origin: 'https://x.example/', joinCode: CODE, joinPolicy: 'public' })
    ).toBe(`https://x.example/join/${CODE}`);
  });

  it('matches what the invite card renders, character for character', () => {
    // The screen's own expression, kept here so a change to either side has to
    // be made in both: `${window.location.origin}/join/${code}`.
    const origin = 'https://we-stay-fit.web.app';
    expect(buildJoinUrl({ origin, joinCode: CODE, joinPolicy: 'public' })).toBe(
      `${origin}/join/${CODE}`
    );
  });

  it('produces a URL that a rotated code changes', () => {
    const before = buildJoinUrl({ origin: 'https://x.example', joinCode: 'aaaa', joinPolicy: 'public' });
    const after = buildJoinUrl({ origin: 'https://x.example', joinCode: 'bbbb', joinPolicy: 'public' });
    expect(before).not.toBe(after);
  });
});

describe('the QR encodes the join URL and nothing else', () => {
  it('fits a realistic join URL well inside the supported versions', () => {
    const url = buildJoinUrl({
      origin: 'https://we-stay-fit-staging.web.app',
      joinCode: CODE,
      joinPolicy: 'public',
    }) as string;
    const code = encodeQr(url);
    expect(code.version).toBeLessThanOrEqual(5);
  });

  it('re-encodes to a different symbol when the join code is rotated', () => {
    const origin = 'https://we-stay-fit.web.app';
    const a = encodeQr(buildJoinUrl({ origin, joinCode: 'AAAA1111BBBB2222CCCC33', joinPolicy: 'public' }) as string);
    const b = encodeQr(buildJoinUrl({ origin, joinCode: 'ZZZZ9999YYYY8888XXXX77', joinPolicy: 'public' }) as string);
    expect(JSON.stringify(a.modules)).not.toBe(JSON.stringify(b.modules));
  });
});
