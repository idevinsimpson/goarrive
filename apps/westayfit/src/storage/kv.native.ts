/**
 * Device key-value storage boundary (iOS and Android).
 *
 * Same contract as `kv.ts`, backed by AsyncStorage, which persists across
 * process termination. Failures resolve to null / false / [] rather than
 * throwing, so a caller can tell "not saved" apart from "saved" — and
 * `readItem` resolves `{ ok: false }`, so "unreadable" is not mistaken for
 * "nothing stored".
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { DeviceKv } from './kvTypes';

// From the suffix-free contract module, never from './kv': on a phone './kv'
// IS this file, and the alias would be circular (src/storage/kvTypes.ts).
export type { DeviceKv, KvRead } from './kvTypes';

export const deviceKv: DeviceKv = {
  async getItem(key) {
    try {
      return await AsyncStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async readItem(key) {
    try {
      return { ok: true, value: await AsyncStorage.getItem(key) };
    } catch {
      return { ok: false };
    }
  },
  async setItem(key, value) {
    try {
      await AsyncStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  async removeItem(key) {
    try {
      await AsyncStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },
  async keysWithPrefix(prefix) {
    try {
      const keys = await AsyncStorage.getAllKeys();
      return keys.filter((k) => k.startsWith(prefix));
    } catch {
      return [];
    }
  },
};
