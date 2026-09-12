import { describe, expect, it } from 'vitest';

import { selectProjectId } from '../src/firebase';

// E4-A1-R4: the projectId baked into firebaseConfig may switch to the
// emulator namespace ONLY when the build flag is on AND the page is served
// from a real loopback browser host. Every other input keeps production.
// The selector is pure, so the SSR branch (no window) is asserted with an
// explicit input rather than by mutating jsdom globals.
describe('selectProjectId (emulator project id gate)', () => {
  it('(a) no flag, loopback host -> goarrive', () => {
    expect(
      selectProjectId({ flagRaw: undefined, hasWindow: true, hostname: 'localhost' })
    ).toBe('goarrive');
  });

  it("(b) flag '1', localhost -> goarrive-test", () => {
    expect(
      selectProjectId({ flagRaw: '1', hasWindow: true, hostname: 'localhost' })
    ).toBe('goarrive-test');
  });

  it("(c) flag '1', 127.0.0.1 -> goarrive-test", () => {
    expect(
      selectProjectId({ flagRaw: '1', hasWindow: true, hostname: '127.0.0.1' })
    ).toBe('goarrive-test');
  });

  it("(d) flag 'true', localhost -> goarrive-test", () => {
    expect(
      selectProjectId({ flagRaw: 'true', hasWindow: true, hostname: 'localhost' })
    ).toBe('goarrive-test');
  });

  it("(e) flag '1', hosted origin -> goarrive (second guard holds)", () => {
    expect(
      selectProjectId({ flagRaw: '1', hasWindow: true, hostname: 'goarrive.web.app' })
    ).toBe('goarrive');
    expect(
      selectProjectId({
        flagRaw: '1',
        hasWindow: true,
        hostname: 'westayfit-app--staging-x4m0iwln.web.app',
      })
    ).toBe('goarrive');
  });

  it("(f) flag '1', no window (SSR / static prerender) -> goarrive", () => {
    expect(
      selectProjectId({ flagRaw: '1', hasWindow: false, hostname: undefined })
    ).toBe('goarrive');
  });

  it("(g) flag '0', localhost -> goarrive", () => {
    expect(
      selectProjectId({ flagRaw: '0', hasWindow: true, hostname: 'localhost' })
    ).toBe('goarrive');
  });

  it("(h) flag 'true ' with whitespace, localhost -> goarrive-test (trim)", () => {
    expect(
      selectProjectId({ flagRaw: 'true ', hasWindow: true, hostname: 'localhost' })
    ).toBe('goarrive-test');
  });

  it("(i) flag '1', window present but hostname unknown -> goarrive", () => {
    expect(
      selectProjectId({ flagRaw: '1', hasWindow: true, hostname: undefined })
    ).toBe('goarrive');
  });
});
