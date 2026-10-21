/**
 * THE MOVE CAMERA SETTINGS, KEPT ON THIS DEVICE.
 *
 * Camera rep counter and Show stick figure are preferences about this phone's
 * camera, not facts about the member, so they stay on the device and are never
 * written to Firestore. Default ON/ON; a missing, unreadable or malformed save
 * reads as the default (moveCameraSettingsOf).
 *
 * WHERE. The device store (src/storage/kv.ts), under the same key as before:
 *   - WEB: localStorage, read synchronously on first use exactly as before.
 *   - iOS / ANDROID: AsyncStorage. This used to be held for the running
 *     session only; it is now a persisted device preference, read at launch.
 *     Until that read has answered the settings READ as the defaults but are
 *     reported NOT LOADED (`useMoveCameraSettingsLoaded`), so nothing that
 *     acts on them — opening the camera — runs on a guess. A toggle pressed
 *     in that moment is kept and applied on top of the stored value, rather
 *     than overwriting the other setting with its default.
 *
 * A device that refuses storage (private mode, quota) still keeps the choice
 * for this session.
 */
import { useSyncExternalStore } from 'react';

import { deviceKv } from '../storage/kv';
import { createKeyMirror } from '../storage/mirror';
import { HAS_SYNC_STORAGE, readDeviceSync } from '../storage/syncRead';
import { DEFAULT_MOVE_CAMERA_SETTINGS, moveCameraSettingsOf, type MoveCameraSettings } from './flow';

export const MOVE_CAMERA_SETTINGS_KEY = 'wsf.moveCamera.v1';

const store = createKeyMirror(deviceKv, readDeviceSync);

let memory: MoveCameraSettings | null = null;
let loaded = HAS_SYNC_STORAGE;
// Toggles pressed before the native read answered, applied on top of it.
let earlyPatch: Partial<MoveCameraSettings> | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of [...listeners]) l();
};

function storedSettings(): MoveCameraSettings {
  let raw: unknown;
  try {
    const s = store.read(MOVE_CAMERA_SETTINGS_KEY);
    raw = s ? JSON.parse(s) : undefined;
  } catch {
    raw = undefined;
  }
  return moveCameraSettingsOf(raw);
}

function persist(next: MoveCameraSettings): Promise<boolean> {
  return store.write(MOVE_CAMERA_SETTINGS_KEY, JSON.stringify(next));
}

const hydrated: Promise<void> = HAS_SYNC_STORAGE
  ? Promise.resolve()
  : store
      .load(MOVE_CAMERA_SETTINGS_KEY)
      .catch(() => undefined)
      .then(() => {
        const stored = storedSettings();
        if (earlyPatch) {
          memory = moveCameraSettingsOf({ ...stored, ...earlyPatch });
          earlyPatch = null;
          // Only on top of a choice that was actually read: if the device
          // could not be read, the defaults under this toggle are a guess, and
          // writing them would overwrite the stored choice nobody saw. The
          // toggle still holds for this session.
          if (!store.unreadable(MOVE_CAMERA_SETTINGS_KEY)) void persist(memory);
        } else {
          memory = stored;
        }
        loaded = true;
        notify();
      });

/** Resolves once the stored preference has been read. Immediate on web. */
export function moveCameraSettingsReady(): Promise<void> {
  return hydrated;
}

export function moveCameraSettingsLoaded(): boolean {
  return loaded;
}

export function readMoveCameraSettings(): MoveCameraSettings {
  if (memory) return memory;
  // Native, before the read: the defaults, NOT cached, so the stored value
  // replaces them the moment it arrives.
  if (!loaded) return DEFAULT_MOVE_CAMERA_SETTINGS;
  memory = storedSettings();
  return memory;
}

export function writeMoveCameraSettings(patch: Partial<MoveCameraSettings>): MoveCameraSettings {
  if (!loaded) {
    earlyPatch = { ...earlyPatch, ...patch };
    memory = moveCameraSettingsOf({ ...DEFAULT_MOVE_CAMERA_SETTINGS, ...earlyPatch });
    notify();
    return memory;
  }
  const next = moveCameraSettingsOf({ ...readMoveCameraSettings(), ...patch });
  memory = next;
  // Storage refused (private mode, quota): the choice still holds for this session.
  void persist(next);
  notify();
  return next;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

// The static export prerenders with no storage, so hydration must start from
// the defaults too; the stored value takes over on the next render.
const serverSnapshot = (): MoveCameraSettings => DEFAULT_MOVE_CAMERA_SETTINGS;

export function useMoveCameraSettings(): MoveCameraSettings {
  return useSyncExternalStore(subscribe, readMoveCameraSettings, serverSnapshot);
}

/**
 * Whether the settings on screen are the member's stored choice yet. Always
 * true on web. Anything that ACTS on a setting (opening the camera) waits for
 * this rather than acting on the defaults.
 */
export function useMoveCameraSettingsLoaded(): boolean {
  return useSyncExternalStore(subscribe, moveCameraSettingsLoaded, () => true);
}

/** Tests only: forget the cached value so the next read goes to storage. */
export function __resetMoveCameraSettingsCache(): void {
  memory = null;
}
