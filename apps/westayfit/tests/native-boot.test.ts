import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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

describe('NATIVE-BOOT-1: module-load wiring of src/firebase.ts on native', () => {
  const ENV_KEYS = ['EXPO_PUBLIC_WSF_ENV', 'EXPO_PUBLIC_WSF_USE_EMULATORS', 'EXPO_PUBLIC_WSF_EMULATOR_HOST'];
  const saved: Record<string, string | undefined> = {};

  async function loadAs(os: string, dev: boolean, env: Record<string, string | undefined>) {
    vi.resetModules();
    vi.doMock('react-native', () => ({ Platform: { OS: os } }));
    vi.stubGlobal('__DEV__', dev);
    for (const k of ENV_KEYS) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    return import('../src/firebase');
  }

  beforeAll(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
  });
  afterEach(() => {
    vi.doUnmock('react-native');
    vi.unstubAllGlobals();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.resetModules();
  });

  it('refuses an iOS release build with no backend named', async () => {
    await expect(loadAs('ios', false, {})).rejects.toThrow(/must name its backend/);
  });

  it('refuses an Android release build that only carries the emulator flag', async () => {
    await expect(loadAs('android', false, { EXPO_PUBLIC_WSF_USE_EMULATORS: '1' })).rejects.toThrow(/must name its backend/);
  });

  it('never selects the emulator in a native release build, even with the flag and a loopback page', async () => {
    const m = await loadAs('ios', false, { EXPO_PUBLIC_WSF_ENV: 'production', EXPO_PUBLIC_WSF_USE_EMULATORS: '1' });
    expect(m.wsfUsingEmulators).toBe(false);
    expect(m.wsfFirebaseProjectId).toBe('goarrive');
  });

  it('uses the emulator only in a native development build with the flag', async () => {
    const m = await loadAs('android', true, { EXPO_PUBLIC_WSF_USE_EMULATORS: '1', EXPO_PUBLIC_WSF_EMULATOR_HOST: '10.0.2.2' });
    expect(m.wsfUsingEmulators).toBe(true);
    expect(m.wsfFirebaseProjectId).toBe('demo-wsf-local');
    expect(m.wsfEmulatorTargets.host).toBe('10.0.2.2');
  });

  it('refuses a public emulator host in a native development build', async () => {
    await expect(
      loadAs('ios', true, { EXPO_PUBLIC_WSF_USE_EMULATORS: '1', EXPO_PUBLIC_WSF_EMULATOR_HOST: '8.8.8.8' })
    ).rejects.toThrow(/private-network/);
  });
});

describe('NATIVE-BOOT-1: native storage boundary over AsyncStorage', () => {
  afterEach(() => {
    vi.doUnmock('@react-native-async-storage/async-storage');
    vi.resetModules();
  });

  it('round-trips and reports failures as false/null/[] instead of throwing', async () => {
    const store = new Map<string, string>();
    let fail = false;
    vi.resetModules();
    vi.doMock('@react-native-async-storage/async-storage', () => ({
      default: {
        getItem: async (k: string) => {
          if (fail) throw new Error('io');
          return store.get(k) ?? null;
        },
        setItem: async (k: string, v: string) => {
          if (fail) throw new Error('io');
          store.set(k, v);
        },
        removeItem: async (k: string) => {
          if (fail) throw new Error('io');
          store.delete(k);
        },
        getAllKeys: async () => {
          if (fail) throw new Error('io');
          return [...store.keys()];
        },
      },
    }));
    const { deviceKv } = await import('../src/storage/kv.native');
    expect(await deviceKv.setItem('wsf.n.a', '1')).toBe(true);
    expect(await deviceKv.getItem('wsf.n.a')).toBe('1');
    expect(await deviceKv.keysWithPrefix('wsf.n.')).toEqual(['wsf.n.a']);
    expect(await deviceKv.removeItem('wsf.n.a')).toBe(true);
    fail = true;
    expect(await deviceKv.setItem('wsf.n.b', '2')).toBe(false);
    expect(await deviceKv.getItem('wsf.n.b')).toBeNull();
    expect(await deviceKv.removeItem('wsf.n.b')).toBe(false);
    expect(await deviceKv.keysWithPrefix('wsf.n.')).toEqual([]);
  });
});
