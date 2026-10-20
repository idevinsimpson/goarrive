import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { decideKioskStart, noteKioskHandoff } from '../src/kioskSignOutGuard';
import { linkAvailabilityCopy } from '../src/ui/linkAvailabilityCopy';

/**
 * NATIVE-MEMBER-1 F-4: MF-06 (copy that can never be true in the app; the
 * relative "Open …" actions outside the URL branches) and MF-08's interim
 * (no "Open kiosk" in the app; the kiosk start screen asks before signing a
 * phone's owner out).
 */

// What the web build rendered at c704b25a, byte for byte (JSX whitespace
// collapsed, `&apos;` as an ASCII apostrophe).
const WEB_AT_BASE = {
  kioskUnavailable: 'The kiosk link isn’t ready yet. Reload the page to try again.',
  stationUnavailable: 'The station link isn’t ready yet. Reload the page to try again.',
  combinedUnavailable: 'The combined link isn’t ready yet. Reload the page to try again.',
  inviteUnavailable: "Your invite link isn't ready yet. Reload the page to try again.",
  qrUnavailable:
    "This community's invite link is not ready yet, so there is nothing to encode. Close this and open it again.",
  kioskGoalsFailed:
    "This community's goals could not be loaded, so there is no kiosk address to give you. Close this and open it again.",
  kioskCopyFailed: 'Copy didn’t work on this device. Open the kiosk here, or type this address on the screen: ',
};
const NEVER_TRUE_IN_APP = [/reload the page/i, /close this and open it again/i];

describe('linkAvailabilityCopy (MF-06)', () => {
  it('web copy is unchanged, and the web still offers Open kiosk', () => {
    const web = linkAvailabilityCopy('web');
    expect(web).toEqual({ offersOpenKiosk: true, ...WEB_AT_BASE });
  });

  it.each(['ios', 'android'])('%s never says "Reload the page" or "Close this and open it again"', (os) => {
    const app = linkAvailabilityCopy(os);
    for (const [key, value] of Object.entries(app)) {
      if (typeof value !== 'string') continue;
      for (const claim of NEVER_TRUE_IN_APP) expect(value, key).not.toMatch(claim);
      // Every app sentence is its own, never the web's.
      expect(value, key).not.toBe(WEB_AT_BASE[key as keyof typeof WEB_AT_BASE]);
    }
    // MF-08 interim: no in-app kiosk.
    expect(app.offersOpenKiosk).toBe(false);
    // Nothing in-app tells the Champion to open the kiosk here.
    expect(app.kioskCopyFailed).not.toMatch(/open the kiosk/i);
  });

  it('the app copy says what is true there', () => {
    const app = linkAvailabilityCopy('ios');
    expect(app.kioskUnavailable).toMatch(/isn’t available in the app yet/);
    expect(app.stationUnavailable).toMatch(/isn’t available in the app yet/);
    expect(app.inviteUnavailable).toMatch(/isn’t available in the app yet/);
    expect(app.qrUnavailable).toMatch(/isn’t available in the app yet/);
    // The combined screen's Open stays on screen in the app, so it points there.
    expect(app.combinedUnavailable).toMatch(/Open the combined screen here/);
  });
});

describe('community detail uses it, and the relative Open actions are outside the URL branches', () => {
  const src = readFileSync(resolve(__dirname, '../app/(tabs)/(home)/community/[groupId]/index.tsx'), 'utf8');

  it('no never-true sentence is left inline in the route', () => {
    for (const claim of NEVER_TRUE_IN_APP) expect(src).not.toMatch(claim);
    expect(src).toContain('const LINK_COPY = linkAvailabilityCopy(Platform.OS);');
    for (const key of ['kioskUnavailable', 'stationUnavailable', 'combinedUnavailable', 'inviteUnavailable', 'qrUnavailable', 'kioskGoalsFailed', 'kioskCopyFailed']) {
      expect(src, key).toContain(`{LINK_COPY.${key}}`);
    }
  });

  it('Open kiosk is offered only where LINK_COPY says so', () => {
    const at = src.indexOf('label="Open kiosk"');
    const gate = src.lastIndexOf('{LINK_COPY.offersOpenKiosk ? (', at);
    expect(gate).toBeGreaterThan(0);
    expect(src.slice(gate, at)).not.toContain(')}');
  });

  it('Open station screen renders whether or not the station URL exists', () => {
    const open = src.indexOf('label="Open station screen"');
    const block = src.slice(src.lastIndexOf('<View', open), open);
    expect(block).toContain('dataSet={{ stationUrl: stationUrlFor(goal.goalId) ?? \'\' }}');
    // The only URL conditional around the station actions comes after Open.
    const blockStart = src.lastIndexOf('testID={`wsf-kiosk-stations-intro-', open);
    expect(src.slice(blockStart, open)).not.toContain('stationUrlFor(goal.goalId) ? (');
    expect(src.indexOf('{stationUrlFor(goal.goalId) ? (', open)).toBeGreaterThan(open);
  });

  it('Open combined screen renders whether or not the combined URL exists', () => {
    const open = src.indexOf('label="Open combined screen"');
    const blockStart = src.lastIndexOf('testID="wsf-combined-created"', open);
    expect(blockStart).toBeGreaterThan(0);
    expect(src.slice(blockStart, open)).not.toContain('{combinedUrl ? (');
    expect(src.indexOf('{combinedUrl ? (', open)).toBeGreaterThan(open);
  });
});

describe('kioskSignOutGuard (MF-08 interim)', () => {
  beforeEach(() => {
    decideKioskStart('web', false); // spend any note a previous test left
  });

  it('the web signs out whoever is attached, as before', () => {
    expect(decideKioskStart('web', true)).toBe('signOut');
    expect(decideKioskStart('web', false)).toBe('none');
  });

  it("the app asks before signing out an account that did not come through this kiosk", () => {
    expect(decideKioskStart('ios', true)).toBe('ask');
    expect(decideKioskStart('android', true)).toBe('ask');
    expect(decideKioskStart('ios', false)).toBe('none');
  });

  it("a visitor who came through this kiosk's hand-off is signed out without asking, once", () => {
    noteKioskHandoff();
    expect(decideKioskStart('ios', true)).toBe('signOut');
    // The note is spent: the next account to arrive is asked.
    expect(decideKioskStart('ios', true)).toBe('ask');
  });

  it('arriving signed out spends the note too', () => {
    noteKioskHandoff();
    expect(decideKioskStart('android', false)).toBe('none');
    expect(decideKioskStart('android', true)).toBe('ask');
  });
});
