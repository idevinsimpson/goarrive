import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isShareableHttpsUrl, shareControlLabel, shareRoute } from '../src/shareGoalDisplay';
import { canAttemptCopy, copyLink, hasShareSheet, linkShareRoute, offerableLink, shareLinkSheet } from '../src/ui/shareLink';

/**
 * NATIVE-MEMBER-1 F-3 (MF-01): the web's half of the copy and share helper is
 * exactly what the six call sites did inline before; the display route gains
 * `nativeShare` for React Native's navigator; and the call sites all go
 * through the helper. The app's half is share-link-native.test.ts.
 */

const RN_NAVIGATOR = { product: 'ReactNative' };

describe("shareRoute: React Native's navigator (MF-01 case 4)", () => {
  it('is nativeShare once there is an absolute https origin', () => {
    expect(shareRoute(RN_NAVIGATOR, 'https://westayfit.app')).toBe('nativeShare');
  });
  it('is unavailable with no origin (release, INT-08) or the Metro origin (dev, case 5)', () => {
    expect(shareRoute(RN_NAVIGATOR, null)).toBe('unavailable');
    expect(shareRoute(RN_NAVIGATOR, 'http://192.168.1.20:8081')).toBe('unavailable');
    expect(shareRoute(RN_NAVIGATOR, 'https://192.168.1.20:8081')).toBe('unavailable');
  });
  it('a browser navigator is decided exactly as before, whatever the origin', () => {
    expect(shareRoute({ share: () => Promise.resolve() }, null)).toBe('webShare');
    expect(shareRoute({ clipboard: { writeText: () => {} } }, null)).toBe('clipboard');
    expect(shareRoute({}, 'https://westayfit.app')).toBe('unavailable');
  });
  it('the native route is labelled Share, like the Web Share route', () => {
    expect(shareControlLabel('nativeShare', 'idle')).toBe('Share');
    expect(shareControlLabel('nativeShare', 'failed')).toBe('Share');
  });
  it('isShareableHttpsUrl', () => {
    expect(isShareableHttpsUrl('https://westayfit.app')).toBe(true);
    expect(isShareableHttpsUrl('https://westayfit.app/display/goal%201')).toBe(true);
    for (const bad of ['http://westayfit.app', 'https://host:443/x', 'https://a@b/x', 'https://', 'https://host./x', ' https://host', 'ftp://host', null, 7]) {
      expect(isShareableHttpsUrl(bad)).toBe(false);
    }
  });
});

describe('the web helper does what the call sites did inline', () => {
  const nav = window.navigator as unknown as Record<string, unknown>;
  afterEach(() => {
    delete nav.share;
    delete nav.clipboard;
  });

  it('copyLink: writeText, copied on success, failed on rejection or no clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(nav, 'clipboard', { value: { writeText }, configurable: true });
    expect(await copyLink('https://x.test/join/a')).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('https://x.test/join/a');
    writeText.mockRejectedValueOnce(new Error('denied'));
    expect(await copyLink('https://x.test/join/a')).toBe('failed');
    delete nav.clipboard;
    expect(await copyLink('https://x.test/join/a')).toBe('failed');
  });

  it('shareLinkSheet: navigator.share with {title, url} or {url}; dismissal is quiet; no API, no call', async () => {
    const shareFn = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(nav, 'share', { value: shareFn, configurable: true });
    expect(hasShareSheet()).toBe(true);
    await shareLinkSheet({ title: 'Join our We Stay Fit community', url: 'https://x.test/join/a' });
    expect(shareFn).toHaveBeenLastCalledWith({ title: 'Join our We Stay Fit community', url: 'https://x.test/join/a' });
    await shareLinkSheet({ url: 'https://x.test/display/g' });
    expect(shareFn).toHaveBeenLastCalledWith({ url: 'https://x.test/display/g' });
    shareFn.mockRejectedValueOnce(new Error('AbortError'));
    await expect(shareLinkSheet({ url: 'https://x.test/display/g' })).resolves.toBeUndefined();
    delete nav.share;
    expect(hasShareSheet()).toBe(false);
    await shareLinkSheet({ url: 'https://x.test/display/g' });
    expect(shareFn).toHaveBeenCalledTimes(3);
  });

  it('offers any link the web built, as before (http included)', () => {
    expect(offerableLink('http://localhost:8081/join/a')).toBe(true);
    expect(offerableLink('')).toBe(false);
    expect(offerableLink(null)).toBe(false);
    expect(canAttemptCopy()).toBe(true);
  });

  it('linkShareRoute reads the live navigator', () => {
    Object.defineProperty(nav, 'share', { value: () => Promise.resolve(), configurable: true });
    expect(linkShareRoute()).toBe('webShare');
    delete nav.share;
    Object.defineProperty(nav, 'clipboard', { value: { writeText: () => Promise.resolve() }, configurable: true });
    expect(linkShareRoute()).toBe('clipboard');
  });
});

describe('every copy and share call site goes through the helper (MF-01 wiring)', () => {
  const src = readFileSync(resolve(__dirname, '../app/(tabs)/(home)/community/[groupId]/index.tsx'), 'utf8');
  const body = (name: string) => {
    const start = src.indexOf(`const ${name} = useCallback(`);
    expect(start, name).toBeGreaterThan(0);
    // Up to the callback's own dependency list: `}, [` (possibly across a line break).
    const m = /\},\s*\[/.exec(src.slice(start));
    expect(m, name).not.toBeNull();
    return src.slice(start, start + m!.index);
  };

  it('no call site touches navigator.clipboard or navigator.share any more', () => {
    expect(src).not.toMatch(/navigator\.clipboard|navigator as Navigator|\.share\(\{/);
  });

  it.each(['onCopyInvite', 'onCopyKiosk', 'onCopyStation', 'onCopyCombined'])('%s copies through copyLink, gated on offerableLink', (name) => {
    const b = body(name);
    expect(b).toContain('offerableLink(');
    expect(b).toContain('await copyLink(');
  });

  it('onShareInvite shares through shareLinkSheet, gated on offerableLink', () => {
    const b = body('onShareInvite');
    expect(b).toContain('if (!offerableLink(inviteUrl)) return;');
    expect(b).toContain("shareLinkSheet({ title: 'Join our We Stay Fit community', url: inviteUrl })");
  });

  it('onShareGoalDisplay takes its route from the helper and shares natively or on the web', () => {
    const b = body('onShareGoalDisplay');
    expect(b).toContain('const route = linkShareRoute();');
    expect(b).toContain("route === 'webShare' || route === 'nativeShare'");
    expect(b).toContain('await shareLinkSheet({ url })');
    expect(b).toContain('await copyLink(url)');
  });

  it('Share invite derives from the helper, and every Copy/QR branch asks offerableLink', () => {
    expect(src).toContain('const hasShareApi = hasShareSheet();');
    expect(src).toContain('const showInviteCard = isChampion || (linkJoinable && offerableLink(inviteUrl));');
    for (const gate of [
      'offerableLink(inviteUrl) ? (\n                  <JoinQrCode url={inviteUrl} caveat={MANAGE_QR_CAVEAT} />',
      '{offerableLink(kioskUrlFor(goal.goalId)) ? (',
      '{offerableLink(stationUrlFor(goal.goalId)) ? (',
      '{offerableLink(stationUrlFor(goal.goalId)) ? null : (',
      '{offerableLink(combinedUrl) ? (',
      '{offerableLink(combinedUrl) ? null : (',
    ]) {
      expect(src, gate).toContain(gate);
    }
    // The member-facing Invite card's controls sit inside the offerable branch.
    const card = src.indexOf('testID="wsf-community-invite"');
    const branch = src.indexOf('offerableLink(inviteUrl) ? (', card);
    expect(branch).toBeGreaterThan(card);
    expect(src.indexOf('testID="wsf-community-invite-copy"', card)).toBeGreaterThan(branch);
  });
});
