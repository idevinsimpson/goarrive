// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * NATIVE-INTEGRATOR-1 (INT-02). NO ROLE VALUE ANDROID WILL THROW ON.
 *
 * Android parses `accessibilityRole` with `AccessibilityRole.fromValue`
 * (react-native/ReactAndroid/.../ReactAccessibilityDelegate.java), a closed
 * enum that THROWS `IllegalArgumentException` for any other string. On the new
 * architecture the mounting layer rethrows and the Expo host crashes the
 * process: Progress died that way whenever its list was partial
 * (`accessibilityRole={'status' as never}`). `role` goes through the separate
 * `Role.fromValue`, which returns null for an unknown value instead, so `role`
 * values cannot crash; they are still checked here against that enum so a typo
 * does not silently drop the semantics.
 *
 * The accepted sets are read from the installed react-native's Java source, so
 * an upgrade that changes either enum changes this test with it.
 *
 * What counts as a role value:
 *   - every `accessibilityRole` JSX attribute and every `accessibilityRole:`
 *     object property (the HEADING_1 style spreads), anywhere in app/ and src/;
 *   - every `role` JSX attribute with a literal value, and every `role:`
 *     property of an object spread straight into JSX (`{...({ role: 'dialog' })}`).
 *     A `role={m.role}` on a custom component is data (a community role), not
 *     an accessibility prop, and is not read.
 * A branch guarded by `Platform.OS === 'web'` (or the web key of
 * `Platform.select`) is web-only and is not checked. `*.web.ts(x)` files never
 * ship to a phone and are skipped. An `accessibilityRole` value the scan cannot
 * resolve to literals fails: it has to be made checkable.
 */

const APP_ROOT = join(__dirname, '..');
const DELEGATE = join(
  APP_ROOT,
  'node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/ReactAccessibilityDelegate.java',
);

function javaEnum(source: string, name: string): Set<string> {
  const m = new RegExp(`public enum ${name} \\{([\\s\\S]*?);`).exec(source);
  if (!m) throw new Error(`enum ${name} not found in ReactAccessibilityDelegate.java`);
  return new Set(
    m[1]!
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter((v) => /^[a-z]+$/.test(v)),
  );
}

const JAVA = readFileSync(DELEGATE, 'utf8');
const ANDROID_ACCESSIBILITY_ROLES = javaEnum(JAVA, 'AccessibilityRole');
const ANDROID_ROLES = javaEnum(JAVA, 'Role');

type Finding = { file: string; line: number; prop: 'accessibilityRole' | 'role'; problem: string };
type Site = { file: string; line: number; prop: 'accessibilityRole' | 'role'; values: string[] };

const UNRESOLVED = Symbol('unresolved');
type Resolved = string[] | typeof UNRESOLVED;

function isPlatformOs(e: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(e) &&
    e.name.text === 'OS' &&
    ts.isIdentifier(e.expression) &&
    e.expression.text === 'Platform'
  );
}
function isWebLiteral(e: ts.Expression): boolean {
  return ts.isStringLiteral(e) && e.text === 'web';
}
/** 'web-true' when the condition holds only on web, 'web-false' when only off web. */
function webGuard(cond: ts.Expression): 'web-true' | 'web-false' | null {
  let c = cond;
  while (ts.isParenthesizedExpression(c)) c = c.expression;
  if (!ts.isBinaryExpression(c)) return null;
  const op = c.operatorToken.kind;
  const eq = op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken;
  const ne = op === ts.SyntaxKind.ExclamationEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken;
  if (!eq && !ne) return null;
  const pair =
    (isPlatformOs(c.left) && isWebLiteral(c.right)) || (isPlatformOs(c.right) && isWebLiteral(c.left));
  if (!pair) return null;
  return eq ? 'web-true' : 'web-false';
}

/** Every string a role expression can evaluate to off web, or UNRESOLVED. */
function resolve(e: ts.Expression | undefined): Resolved {
  if (!e) return UNRESOLVED;
  if (
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isSatisfiesExpression(e) ||
    ts.isTypeAssertionExpression(e)
  ) {
    return resolve(e.expression);
  }
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
  if (e.kind === ts.SyntaxKind.NullKeyword) return [];
  if (ts.isIdentifier(e) && e.text === 'undefined') return [];
  if (ts.isConditionalExpression(e)) {
    const guard = webGuard(e.condition);
    if (guard === 'web-true') return resolve(e.whenFalse);
    if (guard === 'web-false') return resolve(e.whenTrue);
    const a = resolve(e.whenTrue);
    const b = resolve(e.whenFalse);
    if (a === UNRESOLVED || b === UNRESOLVED) return UNRESOLVED;
    return [...a, ...b];
  }
  if (
    ts.isCallExpression(e) &&
    ts.isPropertyAccessExpression(e.expression) &&
    e.expression.name.text === 'select' &&
    ts.isIdentifier(e.expression.expression) &&
    e.expression.expression.text === 'Platform' &&
    e.arguments[0] &&
    ts.isObjectLiteralExpression(e.arguments[0])
  ) {
    const out: string[] = [];
    for (const p of e.arguments[0].properties) {
      if (!ts.isPropertyAssignment(p)) return UNRESOLVED;
      const key = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
      if (key === 'web') continue;
      const v = resolve(p.initializer);
      if (v === UNRESOLVED) return UNRESOLVED;
      out.push(...v);
    }
    return out;
  }
  return UNRESOLVED;
}

function propName(name: ts.PropertyName | ts.JsxAttributeName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  // A computed key written as a literal: `{ ['accessibilityRole']: … }` (#641 CS-3).
  if (
    ts.isComputedPropertyName(name) &&
    (ts.isStringLiteral(name.expression) || ts.isNoSubstitutionTemplateLiteral(name.expression))
  ) {
    return name.expression.text;
  }
  return null;
}

/** `const name = <initializer>` declarations in a file, for shorthand properties. */
function constInitializers(sf: ts.SourceFile): Map<string, ts.Expression> {
  const out = new Map<string, ts.Expression>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      out.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** True when this object literal is spread straight into a JSX element. */
function spreadIntoJsx(node: ts.ObjectLiteralExpression): boolean {
  let p: ts.Node = node.parent;
  while (
    ts.isParenthesizedExpression(p) ||
    ts.isAsExpression(p) ||
    ts.isSatisfiesExpression(p) ||
    ts.isTypeAssertionExpression(p)
  ) {
    p = p.parent;
  }
  return ts.isJsxSpreadAttribute(p);
}

function scanSource(file: string, text: string): { sites: Site[]; findings: Finding[] } {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const sites: Site[] = [];
  const findings: Finding[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const consts = constInitializers(sf);

  const check = (node: ts.Node, prop: 'accessibilityRole' | 'role', values: Resolved, strict: boolean) => {
    const line = lineOf(node);
    if (values === UNRESOLVED) {
      if (strict) findings.push({ file, line, prop, problem: 'value cannot be resolved to string literals' });
      return;
    }
    sites.push({ file, line, prop, values });
    const allowed = prop === 'accessibilityRole' ? ANDROID_ACCESSIBILITY_ROLES : ANDROID_ROLES;
    for (const v of values) {
      if (!allowed.has(v.toLowerCase())) {
        findings.push({ file, line, prop, problem: `"${v}" is not in Android's ${prop === 'accessibilityRole' ? 'AccessibilityRole' : 'Role'} enum` });
      }
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node)) {
      const name = propName(node.name);
      if (name === 'accessibilityRole' || name === 'role') {
        const init = node.initializer;
        const values: Resolved = !init
          ? UNRESOLVED
          : ts.isStringLiteral(init)
            ? [init.text]
            : ts.isJsxExpression(init)
              ? resolve(init.expression)
              : UNRESOLVED;
        // `role={someVariable}` is data on a custom component; only literals are role values.
        check(node, name, values, name === 'accessibilityRole');
      }
    } else if (ts.isPropertyAssignment(node) && ts.isObjectLiteralExpression(node.parent)) {
      const name = propName(node.name);
      if (name === 'accessibilityRole') check(node, name, resolve(node.initializer), true);
      else if (name === 'role' && spreadIntoJsx(node.parent)) check(node, name, resolve(node.initializer), false);
    } else if (ts.isShorthandPropertyAssignment(node) && ts.isObjectLiteralExpression(node.parent)) {
      // `{ accessibilityRole }`: the value is whatever that name holds. A const
      // in this file is resolved; anything else cannot be checked, so it fails (#641 CS-3).
      const name = node.name.text;
      const init = consts.get(name);
      const values: Resolved = init ? resolve(init) : UNRESOLVED;
      if (name === 'accessibilityRole') check(node, name, values, true);
      else if (name === 'role' && spreadIntoJsx(node.parent)) check(node, name, values, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { sites, findings };
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.web\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const FILES = [...walk(join(APP_ROOT, 'app')), ...walk(join(APP_ROOT, 'src'))];

let scanned: { sites: Site[]; findings: Finding[] } | null = null;
/** Every file in app/ and src/, scanned once per run. */
function scanAll(): { sites: Site[]; findings: Finding[] } {
  if (scanned) return scanned;
  const sites: Site[] = [];
  const findings: Finding[] = [];
  for (const full of FILES) {
    const r = scanSource(relative(APP_ROOT, full), readFileSync(full, 'utf8'));
    sites.push(...r.sites);
    findings.push(...r.findings);
  }
  scanned = { sites, findings };
  return scanned;
}

// Parsing ~190 files takes a few seconds on a loaded machine.
const SCAN_TIMEOUT = 60_000;

describe('INT-02: accessibility roles Android accepts', () => {
  it('reads both enums from the installed react-native', () => {
    // Spot values, so a parse that silently found nothing cannot pass.
    for (const v of ['button', 'header', 'link', 'alert', 'radiogroup', 'checkbox', 'switch', 'image']) {
      expect(ANDROID_ACCESSIBILITY_ROLES.has(v)).toBe(true);
    }
    // The two values that crashed (or would crash) Android are not in it.
    expect(ANDROID_ACCESSIBILITY_ROLES.has('status')).toBe(false);
    expect(ANDROID_ACCESSIBILITY_ROLES.has('group')).toBe(false);
    // TypeScript's AccessibilityRole union lists 'tabbar', Android's enum does not.
    expect(ANDROID_ACCESSIBILITY_ROLES.has('tabbar')).toBe(false);
    for (const v of ['status', 'group', 'dialog', 'heading', 'region', 'img']) expect(ANDROID_ROLES.has(v)).toBe(true);
  });

  it('app/ and src/ carry no role value outside those enums (web-guarded branches excepted)', () => {
    const { sites, findings } = scanAll();
    // Not vacuous: the scan really saw the codebase's roles.
    expect(sites.filter((s) => s.prop === 'accessibilityRole').length).toBeGreaterThan(150);
    expect(sites.filter((s) => s.prop === 'role').length).toBeGreaterThan(10);
    expect(findings).toEqual([]);
  }, SCAN_TIMEOUT);

  it('the Progress partial note and the movement group use `role`, and still say status and group', () => {
    const { sites } = scanAll();
    const at = (file: string) => sites.filter((s) => s.file === file);
    expect(at('src/ui/ProgressParityView.tsx')).toContainEqual(
      expect.objectContaining({ prop: 'role', values: ['status'] }),
    );
    expect(at('src/ui/MovementPicker.tsx')).toContainEqual(
      expect.objectContaining({ prop: 'role', values: ['radiogroup', 'group'] }),
    );
  }, SCAN_TIMEOUT);

  describe('mutation checks: the scan flags what crashed', () => {
    it('flags the original Progress partial (`accessibilityRole={\'status\' as never}`)', () => {
      const file = 'src/ui/ProgressParityView.tsx';
      const text = readFileSync(join(APP_ROOT, file), 'utf8');
      const fixed = 'testID="wsf-activity-partial"\n      role="status"';
      expect(text).toContain(fixed);
      const mutated = text.replace(fixed, 'testID="wsf-activity-partial"\n      accessibilityRole={\'status\' as never}');
      const { findings } = scanSource(file, mutated);
      expect(findings).toEqual([
        expect.objectContaining({ file, prop: 'accessibilityRole', problem: expect.stringContaining('"status"') }),
      ]);
    });

    it('flags the original MovementPicker multi-mode group', () => {
      const file = 'src/ui/MovementPicker.tsx';
      const text = readFileSync(join(APP_ROOT, file), 'utf8');
      const mutated = text.replace(
        "role={single ? 'radiogroup' : 'group'}",
        "accessibilityRole={(single ? 'radiogroup' : 'group') as never}",
      );
      expect(mutated).not.toBe(text);
      const { findings } = scanSource(file, mutated);
      expect(findings).toEqual([expect.objectContaining({ file, problem: expect.stringContaining('"group"') })]);
    });

    it('honours only a web guard, Platform.select web keys, and nothing else', () => {
      const scan = (src: string) => scanSource('x.tsx', src).findings.map((f) => f.problem);
      expect(scan(`<View accessibilityRole={Platform.OS === 'web' ? ('navigation' as 'none') : undefined} />`)).toEqual([]);
      expect(scan(`<View accessibilityRole={Platform.OS !== 'web' ? undefined : 'navigation'} />`)).toEqual([]);
      expect(scan(`<View accessibilityRole={Platform.select({ web: 'navigation', default: 'none' })} />`)).toEqual([]);
      // A guard on any other platform does not make a value web-only.
      expect(scan(`<View accessibilityRole={Platform.OS === 'ios' ? 'navigation' : undefined} />`)).toHaveLength(1);
      expect(scan(`<View accessibilityRole={Platform.select({ ios: 'tabbar', web: 'tablist' })} />`)).toHaveLength(1);
      expect(scan(`<View accessibilityRole="tabbar" />`)).toHaveLength(1);
      expect(scan(`const H = { accessibilityRole: 'status' } as Record<string, unknown>;`)).toHaveLength(1);
      expect(scan(`<View {...({ role: 'stauts' } as Record<string, unknown>)} />`)).toHaveLength(1);
      // An unresolvable accessibilityRole fails; a data `role` on a custom component does not.
      expect(scan(`<View accessibilityRole={pickRole()} />`)).toEqual(['value cannot be resolved to string literals']);
      expect(scan(`<InitialsAvatar role={m.role} />`)).toEqual([]);
      // Community roles held in data objects are not accessibility props.
      expect(scan(`const m = { role: 'foundingChampion' };`)).toEqual([]);
    });

    it('catches a shorthand or a computed accessibilityRole key too (#641 CS-3)', () => {
      const scan = (src: string) => scanSource('x.tsx', src).findings.map((f) => f.problem);
      // Shorthand: a const in the file is resolved and checked.
      expect(scan(`const accessibilityRole = 'status'; const v = <View {...{ accessibilityRole }} />;`)).toEqual([
        '"status" is not in Android\'s AccessibilityRole enum',
      ]);
      expect(scan(`const accessibilityRole = 'button'; const v = <View {...{ accessibilityRole }} />;`)).toEqual([]);
      // Shorthand of anything else (a parameter, a let) cannot be checked: it fails.
      expect(scan(`function F({ accessibilityRole }: P) { return <View {...{ accessibilityRole }} />; }`)).toEqual([
        'value cannot be resolved to string literals',
      ]);
      // Shorthand `role` spread into an element is checked against the Role enum.
      expect(scan(`const role = 'stauts'; const v = <View {...{ role }} />;`)).toHaveLength(1);
      // Computed keys written as literals.
      expect(scan(`const v = <View {...({ ['accessibilityRole']: 'status' } as object)} />;`)).toHaveLength(1);
      expect(scan('const v = <View {...({ [`accessibilityRole`]: \'status\' } as object)} />;')).toHaveLength(1);
      expect(scan(`const v = <View {...({ ['accessibilityRole']: 'button' } as object)} />;`)).toEqual([]);
      expect(scan(`const v = <View {...({ ['role']: 'stauts' } as object)} />;`)).toHaveLength(1);
    });
  });
});
