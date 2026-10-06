/**
 * THE MOVE CAMERA SETTINGS, KEPT ON THIS DEVICE.
 *
 * Camera rep counter and Show stick figure are preferences about this phone's
 * camera, not facts about the member, so they stay on the device (web:
 * localStorage) and are never written to Firestore. Default ON/ON; a missing,
 * unreadable or malformed save reads as the default (moveCameraSettingsOf).
 * Native has no storage dependency in this app, so it holds the value for the
 * running session only — and native never opens the camera anyway.
 */
import { useSyncExternalStore } from 'react';

import { DEFAULT_MOVE_CAMERA_SETTINGS, moveCameraSettingsOf, type MoveCameraSettings } from './flow';

export const MOVE_CAMERA_SETTINGS_KEY = 'wsf.moveCamera.v1';

function store(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

let memory: MoveCameraSettings | null = null;
const listeners = new Set<() => void>();

export function readMoveCameraSettings(): MoveCameraSettings {
  if (memory) return memory;
  let raw: unknown;
  try {
    const s = store()?.getItem(MOVE_CAMERA_SETTINGS_KEY);
    raw = s ? JSON.parse(s) : undefined;
  } catch {
    raw = undefined;
  }
  memory = moveCameraSettingsOf(raw);
  return memory;
}

export function writeMoveCameraSettings(patch: Partial<MoveCameraSettings>): MoveCameraSettings {
  const next = moveCameraSettingsOf({ ...readMoveCameraSettings(), ...patch });
  memory = next;
  try {
    store()?.setItem(MOVE_CAMERA_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // Storage refused (private mode, quota): the choice still holds for this session.
  }
  for (const l of listeners) l();
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

/** Tests only: forget the cached value so the next read goes to storage. */
export function __resetMoveCameraSettingsCache(): void {
  memory = null;
}
