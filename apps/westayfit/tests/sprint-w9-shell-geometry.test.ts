import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SHELL_COLUMN_MAX,
  SHELL_FIRST_CONTENT,
  SHELL_PAGE_GUTTER,
  SHELL_TOP_BAR_BODY,
} from '../src/ui/shellNext/shellNextMetrics';

/**
 * W9 — THE GEOMETRY CONTRACT, AND THE SHIPPING SHELL'S RULES IT IS MEASURED
 * AGAINST.
 *
 * PROPOSED / NOT ACCEPTED. Unit checks on the prototype's constants and on the
 * shipping shell's own source. Nothing here changes production behaviour.
 *
 * WHY HALF OF THIS READS SOURCE INSTEAD OF IMPORTING IT. `src/ui/MemberTabBar`
 * imports expo-router, whose published source is untranspiled TSX, and the
 * repository's vitest config does not inline it. That config is not in this
 * packet's reservation, so rather than widen it, the two checks that concern
 * the shipping bar read the file. They are structural claims — "this module
 * imports that constant rather than retyping its value", "this list still
 * contains '/move'" — which is exactly what source text can carry honestly.
 * The e2e suite exercises the same coupling at runtime on the built artifact.
 */

const SRC = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('the top bar is one number, and it is a real touch target', () => {
  it('is tall enough for a 44pt control', () => {
    expect(SHELL_TOP_BAR_BODY).toBeGreaterThanOrEqual(44);
  });

  it('is compact enough to read as app chrome rather than a web header', () => {
    expect(SHELL_TOP_BAR_BODY).toBeLessThanOrEqual(64);
  });

  it('starts page content close under itself, and there is only one such inset', () => {
    // The value matters less than the fact that there is exactly one of it:
    // that is what stops the page title moving when a member switches tabs.
    expect(SHELL_FIRST_CONTENT).toBeGreaterThan(0);
    expect(SHELL_FIRST_CONTENT).toBeLessThan(SHELL_TOP_BAR_BODY);
  });

  it('keeps the reading column wider than the phone, so it never binds at 390', () => {
    // 390 minus two gutters is 354. The column exists for a tablet or a
    // desktop browser and must not affect evidence captured on a phone.
    expect(390 - 2 * SHELL_PAGE_GUTTER).toBeLessThan(SHELL_COLUMN_MAX);
  });
});

describe('the proposed shell reuses the shipping bottom-bar footprint', () => {
  it('imports the two numbers rather than retyping them', () => {
    /*
      THE FAILURE MODE THIS EXISTS FOR is somebody replacing the import with
      the literals, which works, typechecks, and makes every capture taken
      from the prototype quietly wrong the next time the real bar changes.
    */
    const src = SRC('src/ui/shellNext/shellNextBottomInset.ts');
    expect(src).toMatch(/import\s*\{[^}]*MEMBER_TAB_BAR_BODY[^}]*\}\s*from\s*'\.\.\/MemberTabBar'/);
    expect(src).toMatch(/MEMBER_TAB_MOVE_OVERHANG/);
    expect(src).toMatch(/SHELL_BOTTOM_BAR_BODY\s*=\s*MEMBER_TAB_BAR_BODY/);
    expect(src).toMatch(/SHELL_MOVE_OVERHANG\s*=\s*MEMBER_TAB_MOVE_OVERHANG/);
    // No bare numeric assignment to either of the two exported footprints.
    expect(src).not.toMatch(/SHELL_BOTTOM_BAR_BODY\s*=\s*\d/);
    expect(src).not.toMatch(/SHELL_MOVE_OVERHANG\s*=\s*\d/);
  });

  it('reserves room for the raised action as well as the bar body', () => {
    // A page that reserves only the bar's body puts its last control under the
    // MOVE circle, which rises above the bar's top edge.
    const src = SRC('src/ui/shellNext/shellNextBottomInset.ts');
    expect(src).toMatch(/SHELL_BOTTOM_INSET\s*=\s*SHELL_BOTTOM_BAR_BODY\s*\+\s*SHELL_MOVE_OVERHANG/);
  });
});

describe('the shipping shell, for the record this proposal is measured against', () => {
  const bar = SRC('src/ui/MemberTabBar.tsx');
  const home = SRC('app/index.tsx');

  it('has no MOVE destination, because MOVE is an action', () => {
    // Already true today. The proposal keeps it true STRUCTURALLY, by giving
    // MOVE no route in the tab navigator at all rather than by suppressing a
    // selected state.
    const tabs = [...bar.matchAll(/\{\s*key:\s*'(\w+)'/g)].map((m) => m[1]);
    expect(tabs).toEqual(['home', 'community', 'activity', 'you']);
    expect(tabs).not.toContain('move');
  });

  it('puts the shell on /move today, which is the finding', () => {
    /*
      THE OWNER'S REPORT, AS A CHECK ON THE SHIPPING CODE. `/move` wears the
      member shell, so the raised MOVE control renders beneath the MOVE page —
      a control offering to take a member where they already are.
    */
    expect(bar).toMatch(/const SHELL_EXACT = \['\/move'\]/);
  });

  it('replaces the active tab unconditionally, which is the reload on reselect', () => {
    // The single line behind "tapping the already-selected bottom icon
    // reloads that page": no guard on the pressed tab being the current one.
    expect(bar).toMatch(/onPress=\{\(\) => router\.replace\(tab\.href\)\}/);
  });

  it('treats the community detail as Home, which decides where it lives under tabs', () => {
    /*
      THIS IS WHY THE PROTOTYPE PUTS `/community/<id>` IN THE HOME TAB.
      `app/index.tsx` resolves the member's community and replaces `/` with
      `/community/<id>`, so Home's own match has to cover the detail — and
      under a tab navigator the detail has to live in the Home tab, or Home's
      own redirect lands the member in a tab they did not press.
    */
    expect(home).toMatch(/router\.replace\(`\/community\/\$\{openable\}`\)/);
    expect(bar).toMatch(/p === '\/' \|\| p\.startsWith\('\/community\/'\)/);
  });

  it('keeps the shell off the shared-device surfaces', () => {
    // Unchanged by this packet, and named here so the proposal cannot be read
    // as relaxing it. The kiosk rule is a query flag, not a path.
    const prefixes = /const SHELL_PREFIXES = \[(.*?)\]/s.exec(bar)![1];
    for (const never of ['/kiosk', '/display', '/station', '/event', '/queue']) {
      expect(prefixes, `${never} must not be a shell prefix`).not.toContain(`'${never}'`);
    }
    expect(bar).toMatch(/if \(isKioskFlag\(params\?\.kiosk\)\) return false;/);
  });
});
