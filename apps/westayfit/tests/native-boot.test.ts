import { afterEach, describe, expect, it, vi } from 'vitest';

import { selectEmulatorHost, selectProjectId } from '../src/firebase';
import { currentWebHostname } from '../src/platformHost';
import { nativeTargetProblem } from '../src/stagingEnv';
import { deviceKv } from '../src/storage/kv';

describe('NATIVE-BOOT-1: module load without a browser location', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns undefined when window exists but has no location (React Native)', () => {
    // React Native aliases window to the global object and defines no location.
    vi.stubGlobal('window', {});
    expect(currentWebHostname()).toBeUndefined();
  });

  it('returns the hostname in a browser', () => {
    expect(currentWebHostname()).toBe(window.location.hostname);
  });
});

describe('NATIVE-BOOT-1: a phone build must name its backend', () => {
  it('refuses a native build with no selector', () => {
    expect(nativeTargetProblem({ isNative: true, envName: undefined, emulated: false })).toMatch(/must name its backend/);
    expect(nativeTargetProblem({ isNative: true, envName: '', emulated: false })).toMatch(/not set/);
    expect(nativeTargetProblem({ isNative: true, envName: 'Staging', emulated: false })).toMatch(/"Staging"/);
  });

  it('accepts explicit production, explicit staging, or the dev emulator', () => {
    expect(nativeTargetProblem({ isNative: true, envName: 'production', emulated: false })).toBeNull();
    expect(nativeTargetProblem({ isNative: true, envName: 'staging', emulated: false })).toBeNull();
    expect(nativeTargetProblem({ isNative: true, envName: undefined, emulated: true })).toBeNull();
  });

  it('leaves the established web production build unchanged', () => {
    expect(nativeTargetProblem({ isNative: false, envName: undefined, emulated: false })).toBeNull();
  });
});

describe('NATIVE-BOOT-1: emulator selection on native development builds', () => {
  it('selects the emulator project only with the flag', () => {
    expect(selectProjectId({ flagRaw: '1', hasWindow: true, hostname: undefined, nativeDev: true })).toBe('demo-wsf-local');
    expect(selectProjectId({ flagRaw: undefined, hasWindow: true, hostname: undefined, nativeDev: true })).toBe('goarrive');
    // Without nativeDev, a non-loopback / absent hostname never selects the emulator.
    expect(selectProjectId({ flagRaw: '1', hasWindow: true, hostname: undefined })).toBe('goarrive');
  });

  it('accepts only loopback and private-network emulator hosts on native', () => {
    expect(selectEmulatorHost(undefined, true)).toBe('127.0.0.1');
    expect(selectEmulatorHost('10.0.2.2', true)).toBe('10.0.2.2');
    expect(selectEmulatorHost('192.168.1.20', true)).toBe('192.168.1.20');
    expect(selectEmulatorHost('172.20.0.5', true)).toBe('172.20.0.5');
    expect(() => selectEmulatorHost('8.8.8.8', true)).toThrow(/private-network/);
    expect(() => selectEmulatorHost('example.com', true)).toThrow(/private-network/);
    // Web ignores the variable entirely.
    expect(selectEmulatorHost('192.168.1.20', false)).toBe('127.0.0.1');
  });
});

describe('NATIVE-BOOT-1: device storage boundary (web implementation)', () => {
  it('round-trips, reports write success, lists by prefix and removes', async () => {
    window.localStorage.clear();
    expect(await deviceKv.setItem('wsf.t.a', '1')).toBe(true);
    expect(await deviceKv.setItem('wsf.t.b', '2')).toBe(true);
    expect(await deviceKv.setItem('other', '3')).toBe(true);
    expect(await deviceKv.getItem('wsf.t.a')).toBe('1');
    expect((await deviceKv.keysWithPrefix('wsf.t.')).sort()).toEqual(['wsf.t.a', 'wsf.t.b']);
    expect(await deviceKv.removeItem('wsf.t.a')).toBe(true);
    expect(await deviceKv.getItem('wsf.t.a')).toBeNull();
  });

  it('reports a failed write as false rather than claiming it saved', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(await deviceKv.setItem('wsf.t.c', 'x')).toBe(false);
    spy.mockRestore();
  });
});

describe('NATIVE-BOOT-1: root-layout banner does not read location on native', () => {
  it('guards the effect on Platform.OS and a real location', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(process.cwd(), 'src/InAppBrowserBanner.tsx'), 'utf8');
    expect(src).toMatch(/Platform\.OS !== 'web' \|\| typeof window === 'undefined' \|\| !window\.location/);
  });
});
