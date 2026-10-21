import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootNative, createFakeAsyncStorage, flush, type FakeAsyncStorage } from './nativeStorageHarness';

/**
 * W13-3 (ST-04): the device question may say the answer is remembered only
 * when it can be. Native cases run over the native storage implementations
 * (tests/nativeStorageHarness.ts); not a device run.
 */

let disk: FakeAsyncStorage;

async function launch() {
  bootNative(disk);
  return import('../src/deviceMode');
}

beforeEach(() => {
  disk = createFakeAsyncStorage();
  window.localStorage.clear();
});

afterEach(() => {
  for (const m of [
    '@react-native-async-storage/async-storage',
    '../src/storage/kv',
    '../src/storage/sessionKv',
    '../src/storage/syncRead',
    '../src/firebase',
    'firebase/auth',
  ]) {
    vi.doUnmock(m);
  }
  vi.resetModules();
});

describe('deviceModeMayBeRemembered (native)', () => {
  it('true when the answer was kept', async () => {
    const dm = await launch();
    await dm.deviceModeReady();
    expect(await dm.saveDeviceMode('personal')).toBe(true);
    await flush();
    expect(dm.deviceModeMayBeRemembered()).toBe(true);
  });

  it('false after the device refused the save; true again once a save is kept', async () => {
    const dm = await launch();
    await dm.deviceModeReady();
    disk.state.failWrites = true;
    expect(await dm.saveDeviceMode('shared')).toBe(false);
    await flush();
    expect(dm.deviceModeMayBeRemembered()).toBe(false);
    disk.state.failWrites = false;
    expect(await dm.saveDeviceMode('shared')).toBe(true);
    await flush();
    expect(dm.deviceModeMayBeRemembered()).toBe(true);
  });

  it('false while the stored answer cannot be read', async () => {
    disk.map.set('wsf.deviceMode', 'shared');
    disk.state.failReads = true;
    const dm = await launch();
    await dm.deviceModeReady();
    expect(dm.deviceModeMayBeRemembered()).toBe(false);
  });

  it('subscribers hear a refused save once it is known, and the recovery; not after unsubscribing', async () => {
    const dm = await launch();
    await dm.deviceModeReady();
    // What the predicate said at each notification.
    const seen: boolean[] = [];
    const unsubscribe = dm.subscribeDeviceModeMayBeRemembered(() => seen.push(dm.deviceModeMayBeRemembered()));
    disk.state.failWrites = true;
    await dm.saveDeviceMode('shared');
    await flush();
    // Notified AFTER the refusal was known (the write's own notice comes earlier, while it still read true).
    expect(seen).toContain(false);
    disk.state.failWrites = false;
    seen.length = 0;
    await dm.saveDeviceMode('shared');
    await flush();
    expect(seen[seen.length - 1]).toBe(true);
    unsubscribe();
    seen.length = 0;
    disk.state.failWrites = true; // a flip after unsubscribing must not reach the listener
    await dm.saveDeviceMode('personal');
    await flush();
    disk.state.failWrites = false;
    expect(seen).toEqual([]);
    expect(dm.deviceModeMayBeRemembered()).toBe(false);
  });
});

describe('deviceModeMayBeRemembered (web)', () => {
  it('is always true, even when the browser refuses the save', async () => {
    vi.resetModules();
    const dm = await import('../src/deviceMode');
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    try {
      expect(await dm.saveDeviceMode('shared')).toBe(false);
    } finally {
      spy.mockRestore();
    }
    await flush();
    expect(dm.deviceModeMayBeRemembered()).toBe(true);
    window.localStorage.clear();
  });
});
