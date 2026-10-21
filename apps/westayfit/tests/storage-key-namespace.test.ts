import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootNative, createFakeAsyncStorage, type FakeAsyncStorage } from './nativeStorageHarness';

/**
 * ST-07 hardening. The storage boundary lists keys only inside the app's own
 * namespace ('wsf.'), so no caller can enumerate — and then remove — Firebase
 * Auth's `firebase:*` session keys, which share the same storage. And nothing
 * in the app wipes storage wholesale.
 */

const FIREBASE_KEYS = [
  'firebase:authUser:AIzaFake:[DEFAULT]',
  'firebase:persistence:AIzaFake:[DEFAULT]',
  'firebase:host:wsf-fake.firebaseapp.com',
];
const APP_KEYS = ['wsf.currentCommunity.uid-a', 'wsf.moveCamera.v1'];
const PREFIXES = ['', 'f', 'fire', 'firebase:', 'firebase:authUser:', 'w', 'wsf', 'wsf.', 'wsf.currentCommunity.'];

let disk: FakeAsyncStorage;

beforeEach(() => {
  disk = createFakeAsyncStorage();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  for (const m of ['@react-native-async-storage/async-storage', '../src/storage/kv', '../src/storage/sessionKv', '../src/storage/syncRead', '../src/firebase', 'firebase/auth']) {
    vi.doUnmock(m);
  }
  vi.resetModules();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('keysWithPrefix never lists Firebase Auth’s keys (native)', () => {
  it('for any prefix, including the empty one; app keys still list under wsf.', async () => {
    for (const k of [...FIREBASE_KEYS, ...APP_KEYS]) disk.map.set(k, 'x');
    bootNative(disk);
    const { deviceKv } = await import('../src/storage/kv');
    const { sessionKv } = await import('../src/storage/sessionKv');
    for (const prefix of PREFIXES) {
      for (const kv of [deviceKv, sessionKv]) {
        const keys = await kv.keysWithPrefix(prefix);
        expect(keys.filter((k) => k.startsWith('firebase:')), prefix).toEqual([]);
        if (!prefix.startsWith('wsf.')) expect(keys, prefix).toEqual([]);
      }
    }
    expect((await deviceKv.keysWithPrefix('wsf.')).sort()).toEqual([...APP_KEYS].sort());
    expect(await deviceKv.keysWithPrefix('wsf.currentCommunity.')).toEqual(['wsf.currentCommunity.uid-a']);
  });
});

describe('keysWithPrefix never lists keys outside the namespace (web)', () => {
  it('localStorage and sessionStorage alike', async () => {
    for (const k of [...FIREBASE_KEYS, ...APP_KEYS]) {
      window.localStorage.setItem(k, 'x');
      window.sessionStorage.setItem(k, 'x');
    }
    const { deviceKv } = await import('../src/storage/kv');
    const { sessionKv } = await import('../src/storage/sessionKv');
    for (const prefix of PREFIXES) {
      for (const kv of [deviceKv, sessionKv]) {
        const keys = await kv.keysWithPrefix(prefix);
        expect(keys.filter((k) => k.startsWith('firebase:')), prefix).toEqual([]);
        if (!prefix.startsWith('wsf.')) expect(keys, prefix).toEqual([]);
      }
    }
    expect((await deviceKv.keysWithPrefix('wsf.')).sort()).toEqual([...APP_KEYS].sort());
  });
});

describe('nothing in the app wipes or enumerates storage wholesale', () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return name === 'node_modules' || name === 'frozen' ? [] : sourceFiles(full);
      return /\.(ts|tsx)$/.test(name) ? [full] : [];
    });
  }
  const files = [...sourceFiles(path.resolve('app')), ...sourceFiles(path.resolve('src'))];

  it('no AsyncStorage.clear or multiRemove anywhere; getAllKeys only behind the namespace guard in kv.native.ts', () => {
    expect(files.length).toBeGreaterThan(50);
    for (const file of files) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(code, file).not.toMatch(/AsyncStorage\s*\.\s*clear\s*\(/);
      expect(code, file).not.toMatch(/\bmultiRemove\s*\(/);
      if (!file.endsWith(path.join('src', 'storage', 'kv.native.ts'))) {
        expect(code, file).not.toMatch(/\bgetAllKeys\s*\(/);
      }
    }
  });
});
