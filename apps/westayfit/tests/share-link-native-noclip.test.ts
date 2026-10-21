import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 F-3, review F3-N1: a binary or development client built
 * BEFORE expo-clipboard was added has no `ExpoClipboard` native module, and
 * importing expo-clipboard there throws ("Cannot find native module"). The
 * helper must load without it, offer no Copy, and keep Share working.
 */

/** expo-clipboard as such a binary sees it: importing it throws. */
let clipboardImports = 0;
vi.mock('expo-clipboard', () => {
  clipboardImports += 1;
  throw new Error("Cannot find native module 'ExpoClipboard'");
});
let present = false;
vi.mock('expo', () => ({
  requireOptionalNativeModule: (name: string) => (present && name === 'ExpoClipboard' ? {} : null),
}));
const share = vi.fn<(content: unknown) => Promise<{ action: string }>>();
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Share: { share: (c: unknown) => share(c) },
}));

// The import itself must not throw: nothing reaches for expo-clipboard yet.
const native = await import('../src/ui/shareLink.native');
const URL = 'https://westayfit.app/join/Ab3_dE-fGh1JkLmN0pQrSt';

beforeEach(() => {
  present = false;
  clipboardImports = 0;
  share.mockReset();
  share.mockResolvedValue({ action: 'sharedAction' });
});

describe('without the ExpoClipboard native module (F3-N1)', () => {
  it('the helper loads, Copy is not offered, and expo-clipboard is never imported', async () => {
    expect(native.offersCopy()).toBe(false);
    expect(native.canAttemptCopy()).toBe(false);
    expect(await native.copyLink(URL)).toBe('failed');
    expect(clipboardImports).toBe(0);
  });

  it('Share does not need it: the share sheet still opens', async () => {
    expect(native.hasShareSheet()).toBe(true);
    await native.shareLinkSheet({ url: URL });
    expect(share).toHaveBeenCalledWith({ message: URL });
  });

  it('a module that is reported present but still fails to import is a failed copy, never a throw', async () => {
    present = true;
    expect(native.offersCopy()).toBe(true);
    await expect(native.copyLink(URL)).resolves.toBe('failed');
  });

  it('the helper has no static import of expo-clipboard', () => {
    const src = readFileSync(resolve(__dirname, '../src/ui/shareLink.native.ts'), 'utf8');
    expect(src).not.toMatch(/^\s*import\b[^;]*from\s+['"]expo-clipboard['"]/m);
    expect(src).not.toMatch(/^\s*import\s+['"]expo-clipboard['"]/m);
    expect(src).toContain("requireOptionalNativeModule('ExpoClipboard')");
  });
});
