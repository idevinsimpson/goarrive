import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 F-3 (MF-01): the app's copy and share helper
 * (src/ui/shareLink.native.ts) with expo-clipboard and React Native's Share
 * API stubbed. MF-01 cases 1, 2, 3 and 5 at the helper; case 4's route is in
 * share-link-web.test.ts. No device was used.
 */

const setStringAsync = vi.fn<(text: string) => Promise<boolean>>();
vi.mock('expo-clipboard', () => ({ setStringAsync: (t: string) => setStringAsync(t) }));
const share = vi.fn<(content: unknown) => Promise<{ action: string }>>();
const platform = { OS: 'ios' as string };
vi.mock('react-native', () => ({
  Platform: platform,
  Share: { share: (c: unknown) => share(c), sharedAction: 'sharedAction', dismissedAction: 'dismissedAction' },
}));

const native = await import('../src/ui/shareLink.native');

const INVITE = 'https://westayfit.app/join/Ab3_dE-fGh1JkLmN0pQrSt';
const METRO = 'http://192.168.1.20:8081/join/Ab3_dE-fGh1JkLmN0pQrSt';

beforeEach(() => {
  setStringAsync.mockReset();
  share.mockReset();
  platform.OS = 'ios';
});

describe('offerableLink: absolute https only (case 5)', () => {
  it('offers an https link', () => {
    expect(native.offerableLink(INVITE)).toBe(true);
    expect(native.offerableLink('https://westayfit-staging.web.app/kiosk/goal-1')).toBe(true);
  });
  it.each([
    ['the Metro dev origin', METRO],
    ['https on the Metro port', 'https://192.168.1.20:8081/join/x'],
    ['localhost', 'http://localhost:8081/join/x'],
    ['plain http', 'http://westayfit.app/join/x'],
    ['a relative path', '/join/x'],
    ['userinfo', 'https://user@westayfit.app/join/x'],
    ['whitespace', 'https://westayfit.app/join/x y'],
    ['empty', ''],
    ['null', null],
    ['undefined', undefined],
  ])('refuses %s', (_l, url) => {
    expect(native.offerableLink(url as string | null | undefined)).toBe(false);
  });
});

describe('copyLink (cases 2 and 3)', () => {
  it('puts exactly the URL on the clipboard and reports copied', async () => {
    setStringAsync.mockResolvedValue(true);
    expect(await native.copyLink(INVITE)).toBe('copied');
    expect(setStringAsync).toHaveBeenCalledTimes(1);
    expect(setStringAsync).toHaveBeenCalledWith(INVITE);
  });
  it('reports failed only when the clipboard call rejects or says false', async () => {
    setStringAsync.mockRejectedValueOnce(new Error('no clipboard'));
    expect(await native.copyLink(INVITE)).toBe('failed');
    setStringAsync.mockResolvedValueOnce(false);
    expect(await native.copyLink(INVITE)).toBe('failed');
  });
  it('never copies a Metro or non-https URL', async () => {
    expect(await native.copyLink(METRO)).toBe('failed');
    expect(await native.copyLink('/kiosk/goal-1')).toBe('failed');
    expect(setStringAsync).not.toHaveBeenCalled();
  });
});

describe('shareLinkSheet (case 1)', () => {
  it('iOS: opens the share sheet with the URL, and the title as the message', async () => {
    share.mockResolvedValue({ action: 'sharedAction' });
    await native.shareLinkSheet({ title: 'Join our We Stay Fit community', url: INVITE });
    expect(share).toHaveBeenCalledWith({ url: INVITE, message: 'Join our We Stay Fit community' });
    await native.shareLinkSheet({ url: 'https://westayfit.app/display/goal-1' });
    expect(share).toHaveBeenLastCalledWith({ url: 'https://westayfit.app/display/goal-1' });
  });
  it('Android: shares the URL as the message', async () => {
    platform.OS = 'android';
    share.mockResolvedValue({ action: 'sharedAction' });
    await native.shareLinkSheet({ title: 'Join our We Stay Fit community', url: INVITE });
    expect(share).toHaveBeenCalledWith({ message: INVITE });
  });
  it('a dismissed sheet, or one that cannot open, resolves quietly', async () => {
    share.mockResolvedValueOnce({ action: 'dismissedAction' });
    await expect(native.shareLinkSheet({ url: INVITE })).resolves.toBeUndefined();
    share.mockRejectedValueOnce(new Error('no activity'));
    await expect(native.shareLinkSheet({ url: INVITE })).resolves.toBeUndefined();
  });
  it('never shares a Metro or non-https URL', async () => {
    await native.shareLinkSheet({ url: METRO });
    await native.shareLinkSheet({ url: '/join/x' });
    expect(share).not.toHaveBeenCalled();
  });
});

describe('availability', () => {
  it('the app can always attempt; offerableLink decides what is offered', () => {
    expect(native.canAttemptCopy()).toBe(true);
    expect(native.hasShareSheet()).toBe(true);
  });
});
