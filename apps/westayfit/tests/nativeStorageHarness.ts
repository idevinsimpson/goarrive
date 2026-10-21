/**
 * NATIVE-STATE-1 test harness: the phone's storage, simulated.
 *
 * `createFakeAsyncStorage` is an in-memory AsyncStorage (the four calls
 * src/storage/kv.native.ts makes) over a Map that outlives everything else in
 * a test — it is the "disk". Writes can be held (to prove ordering) or made to
 * fail (to prove honesty about durability).
 *
 * `bootNative` simulates a process start: it throws away every module
 * instance (`vi.resetModules`) and points the storage boundaries at their
 * NATIVE implementations — the real kv.native.ts over the fake AsyncStorage,
 * the real sessionKv.native.ts and syncRead.native.ts — so the modules under
 * test start with fresh in-memory state over the same backing Map. Calling it
 * again is "the app was terminated and reopened".
 *
 * Nothing here runs on a device. It proves the logic over the native
 * implementations, not AsyncStorage itself.
 */
import { vi } from 'vitest';

export type FakeAsyncStorage = {
  /** The "disk". Survives every simulated relaunch. */
  map: Map<string, string>;
  /** When true, setItem / removeItem reject (disk full, storage refused); failReads: getItem / getAllKeys reject. */
  state: { failWrites: boolean; failReads: boolean };
  /** Hold every write until the returned release() is called (FIFO). */
  hold(): () => void;
  /** Hold every read until the returned release() is called (FIFO). */
  holdReads(): () => void;
  api: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
    getAllKeys(): Promise<string[]>;
  };
};

export function createFakeAsyncStorage(map: Map<string, string> = new Map()): FakeAsyncStorage {
  let held: Array<() => void> | null = null;
  let heldReads: Array<() => void> | null = null;
  const state = { failWrites: false, failReads: false };
  const gate = () => (held ? new Promise<void>((resolve) => held!.push(resolve)) : Promise.resolve());
  const readGate = () =>
    heldReads ? new Promise<void>((resolve) => heldReads!.push(resolve)) : Promise.resolve();
  return {
    map,
    state,
    hold() {
      held = [];
      return () => {
        const queue = held ?? [];
        held = null;
        for (const release of queue) release();
      };
    },
    holdReads() {
      heldReads = [];
      return () => {
        const queue = heldReads ?? [];
        heldReads = null;
        for (const release of queue) release();
      };
    },
    api: {
      async getItem(key) {
        await readGate();
        if (state.failReads) throw new Error('storage unreadable');
        return map.has(key) ? (map.get(key) as string) : null;
      },
      async setItem(key, value) {
        await gate();
        if (state.failWrites) throw new Error('storage refused');
        map.set(key, value);
      },
      async removeItem(key) {
        await gate();
        if (state.failWrites) throw new Error('storage refused');
        map.delete(key);
      },
      async getAllKeys() {
        await readGate();
        if (state.failReads) throw new Error('storage unreadable');
        return [...map.keys()];
      },
    },
  };
}

/** A fresh "process" over the same disk. Import the modules under test after it. */
export function bootNative(storage: FakeAsyncStorage): void {
  vi.resetModules();
  vi.doMock('@react-native-async-storage/async-storage', () => ({ default: storage.api }));
  vi.doMock('../src/storage/kv', async () => await import('../src/storage/kv.native'));
  vi.doMock('../src/storage/sessionKv', async () => await import('../src/storage/sessionKv.native'));
  vi.doMock('../src/storage/syncRead', async () => await import('../src/storage/syncRead.native'));
}

/** Let queued promise work (and zero-delay timers) run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
}
