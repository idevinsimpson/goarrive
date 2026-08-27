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
