/**
 * KIOSK-GUEST-MOVE-1 — wsfStationGuestContribute, as it will be deployed.
 *
 * Two facts the emulator suite cannot see, pinned in the SOURCE (comments
 * stripped first, as sprint-w8-social-invoker.test.ts explains):
 *
 *   1. It is declared `invoker: 'public'`, like every station callable. A
 *      paired kiosk is a signed-out browser; its authority is the station
 *      secret, checked in the handler. Without the declaration Cloud Run
 *      refuses the kiosk before the handler runs, and `invoker` is a no-op in
 *      the emulator, so only this test would notice.
 *   2. Its handler never reads `request.auth`. A guest move names nobody,
 *      whoever happens to be signed in on the kiosk's browser; the emulator
 *      suite proves the stored row carries no uid, and this proves there is no
 *      code path that could put one there.
 *
 * It invokes no handler and needs no emulator.
 */

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import * as wsf from '../../src/index';

function sourceWithoutComments(): string {
  const src = readFileSync(path.resolve(__dirname, '../../src/index.ts'), 'utf8');
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** The declaration's options object, as written. */
function declaredOptions(name: string): string {
  const m = new RegExp(`export const ${name} = onCall(?:<[^>]*>)?\\(\\s*(\\{[^}]*\\})`, 'm').exec(
    sourceWithoutComments()
  );
  if (m === null) throw new Error(`${name}: could not find its onCall declaration`);
  return m[1]!;
}

/** The whole declaration: from `export const name` to the next top-level export. */
function declaration(name: string): string {
  const src = sourceWithoutComments();
  const start = src.indexOf(`export const ${name} = onCall`);
  if (start < 0) throw new Error(`${name}: not declared`);
  const next = src.indexOf('\nexport ', start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

describe('wsfStationGuestContribute — deployment shape', () => {
  test('it is exported as a callable in us-central1', () => {
    const fn = (wsf as unknown as Record<string, { __endpoint?: { callableTrigger?: unknown } }>)
      .wsfStationGuestContribute;
    expect(fn?.__endpoint?.callableTrigger).toBeDefined();
    expect(declaredOptions('wsfStationGuestContribute')).toMatch(/region\s*:\s*['"]us-central1['"]/);
  });

  test('it is reachable by a signed-out kiosk, as every station callable is', () => {
    const isPublic = (name: string) => /invoker\s*:\s*['"]public['"]/.test(declaredOptions(name));
    expect(isPublic('wsfStationGuestContribute')).toBe(true);
    // The station callables it stands beside, so the comparison is measured.
    for (const station of ['wsfTurnState', 'wsfCallNext', 'wsfCompleteTurn']) expect(isPublic(station)).toBe(true);
    // And the control: a member callable is not.
    expect(isPublic('wsfContribute')).toBe(false);
  });

  test('its handler never reads request.auth, and authorizes by the station credential', () => {
    const body = declaration('wsfStationGuestContribute');
    expect(body).toContain('authorizeStationForTurn(request.data, request.rawRequest');
    expect(body).not.toMatch(/request\s*\.\s*auth\b/);
    expect(body).not.toMatch(/\bauth\s*\?*\.\s*uid\b/);
    expect(body).not.toMatch(/optionalRealUid|requireRealIdentity/);
    // The control: the reader finds request.auth where it is read.
    expect(declaration('wsfContribute')).toMatch(/request\s*\.\s*auth\b/);
  });

  test('its handler writes no wsfContributions row and no member total', () => {
    const body = declaration('wsfStationGuestContribute');
    expect(body).not.toContain('wsfContributions');
    expect(body).not.toContain('wsfGoalMemberTotals');
    expect(body).not.toMatch(/performContribution|memberTotalRef/);
  });
});
