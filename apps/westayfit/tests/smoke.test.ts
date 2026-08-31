import { describe, expect, it } from 'vitest';

import { WSF_BUILD_STAMP } from '../src/buildStamp';
import { getFirebaseApp, wsfFirebaseProjectId } from '../src/firebase';
import { wsfTheme } from '../src/theme';

describe('WSF smoke', () => {
  it('build stamp exposes appName and version', () => {
    expect(WSF_BUILD_STAMP.appName).toBe('We Stay Fit');
    expect(WSF_BUILD_STAMP.version).toBe('0.1.0');
  });

  it('firebase app initializes with the shared goarrive project id', () => {
    expect(wsfFirebaseProjectId).toBe('goarrive');
    const app = getFirebaseApp();
    expect(app.name).toBe('westayfit');
    expect(app.options.projectId).toBe('goarrive');
  });

  // Regression guard: the M-U1 shell shipped an INVENTED apiKey/appId/senderId
  // that pointed at no real project. It went unnoticed because the only
  // assertion was on projectId — the one field that happened to be correct —
  // and because the auth flag was OFF, so nothing ever called Firebase. With
  // the flag ON these values are load-bearing: a wrong key fails every signin
  // with auth/api-key-not-valid. Assert the identifiers that actually identify.
  it('firebase config is the real goarrive registration, not a placeholder', () => {
    const { apiKey, appId, messagingSenderId, authDomain, storageBucket } =
      getFirebaseApp().options;

    // Per-project values: these belong to `goarrive` and are shared with the
    // GoArrive app by construction (see apps/goarrive/lib/firebase.ts).
    expect(messagingSenderId).toBe('413741232388');
    expect(apiKey).toBe('AIzaSyBgLIP0uvGJ98fde3aZthZjILTg6unkkX0');
    expect(authDomain).toBe('goarrive.firebaseapp.com');
    expect(storageBucket).toBe('goarrive.firebasestorage.app');

    // A real Firebase web appId is `1:<senderId>:web:<hex>`. A slug in the
    // final segment (e.g. `...:web:westayfit-app`) means someone typed it.
    expect(appId).toMatch(/^1:\d+:web:[0-9a-f]+$/);
    expect(appId?.split(':')[1]).toBe(messagingSenderId);

    // ...and it must be WSF's own registration, not GoArrive's app.
    expect(appId).toBe('1:413741232388:web:30f3490b0a3b220dd42051');
  });

  it('reusing getFirebaseApp returns the same instance', () => {
    const a = getFirebaseApp();
    const b = getFirebaseApp();
    expect(a).toBe(b);
  });

  it('theme exposes brand colors', () => {
    expect(wsfTheme.colors.primary).toBe('#0B1F3A');
    expect(wsfTheme.colors.accent).toBe('#E8B547');
    expect(wsfTheme.colors.background).toBe('#F7F5F0');
  });
});
