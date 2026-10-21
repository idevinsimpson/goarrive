import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * W12-13 (INT-08 preparation, ST-01). A phone has no page address: a release
 * build has no `window.location` (reading it threw at module load once), and
 * a development build's is the Metro server on the developer's machine. So no
 * module a phone can load reads it, outside the places that decide the
 * platform first. The origin goes through `currentOrigin` (src/ui/kioskLink),
 * whose phone twin reads the build's configured origin.
 *
 * WHAT IS READ: `window.location`, `globalThis.location` and `self.location`,
 * as a property or under a string key, through a cast or parentheses, also
 * when the global is itself reached through another object
 * (`globalObject.window.location`, `g['window'].location`; RV16-641-5), and a
 * bare `location.<x>` where no local `location` is declared. Comments are not
 * read.
 *
 * WHAT A PHONE CANNOT LOAD: `*.web.*` files, and a base file that has a phone
 * twin (`X.native.*`, or both `X.ios.*` and `X.android.*`): Metro picks the
 * twin there.
 *
 * ALLOWED, each with its reason; an entry that no longer reads it fails
 * nothing, and is removed then.
 */
const ALLOWED: Record<string, string> = {
  // RV16-641-5: the INT-01 crash harness performs ST-01's read on purpose, only while its site is armed (staging only).
  'src/crashHarness.native.ts': 'INT-01 harness: the deliberate ST-01 read, armed only',
  // The hostname helper: it reads a location only where one exists, and says the platform must be decided with Platform.OS.
  'src/platformHost.ts': 'platform-checked',
  // The in-app-browser banner returns before reading it unless Platform.OS is 'web'.
  'src/InAppBrowserBanner.tsx': 'web-gated',
  // The member lane's community page builds its own share origin until W16 delegates it to currentOrigin.
  'app/(tabs)/(home)/community/[groupId]/index.tsx': 'W16 (delegates to currentOrigin)',
};

const APP_ROOT = join(__dirname, '..');
const GLOBALS = new Set(['window', 'globalThis', 'self']);

function strip(e: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e) || ts.isSatisfiesExpression(e)
    ? strip(e.expression)
    : e;
}

/** Each place `text` reads the page's location, as `line:column`. */
export function locationReads(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  // A file that declares its own `location` (a parameter, a const) is not reading the global through a bare name.
  let declaresLocation = false;
  const scanDecls = (node: ts.Node) => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) && ts.isIdentifier(node.name) && node.name.text === 'location') declaresLocation = true;
    ts.forEachChild(node, scanDecls);
  };
  scanDecls(sf);
  const found: string[] = [];
  const at = (node: ts.Node) => {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart());
    found.push(`${line + 1}:${character + 1}`);
  };
  const isGlobal = (e: ts.Expression) => {
    const x = strip(e);
    if (ts.isIdentifier(x)) return GLOBALS.has(x.text);
    // RV16-641-5: the global reached through another object (`globalObject.window`, `g['window']`).
    if (ts.isPropertyAccessExpression(x)) return GLOBALS.has(x.name.text);
    if (ts.isElementAccessExpression(x) && ts.isStringLiteralLike(x.argumentExpression)) return GLOBALS.has(x.argumentExpression.text);
    return false;
  };
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'location' && isGlobal(node.expression)) at(node);
    else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'location' && isGlobal(node.expression)) at(node);
    else if (!declaresLocation && ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'location') at(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Whether a phone can load this module: not web-only, not a test or declaration, and not a base file with a phone twin. */
export function phoneLoads(file: string, exists: (f: string) => boolean): boolean {
  if (!/\.tsx?$/.test(file) || /\.d\.ts$/.test(file) || /\.web\.tsx?$/.test(file) || /(^|\/)(tests|__tests__)\//.test(file)) return false;
  if (/\.(native|ios|android)\.tsx?$/.test(file)) return true;
  const base = file.replace(/\.tsx?$/, '');
  const twin = (suffix: string) => ['.ts', '.tsx'].some((ext) => exists(`${base}.${suffix}${ext}`));
  return !(twin('native') || (twin('ios') && twin('android')));
}

const exists = (f: string) => existsSync(join(APP_ROOT, f));
const SOURCES = ['app', 'src']
  .flatMap((d) => walk(join(APP_ROOT, d)))
  .map((f) => relative(APP_ROOT, f).split(sep).join('/'))
  .filter((f) => phoneLoads(f, exists));
const READERS = SOURCES.map((file) => ({ file, at: locationReads(file, readFileSync(join(APP_ROOT, file), 'utf8')) })).filter((r) => r.at.length > 0);

describe('W12-13: no module a phone loads reads window.location', () => {
  it('the detector sees every form, and ignores comments, strings and a local `location`', () => {
    const f = 'src/x.ts';
    expect(locationReads(f, 'const o = window.location.origin;')).toEqual(['1:11']);
    expect(locationReads(f, 'const o = window.location?.origin ?? null;')).toHaveLength(1);
    expect(locationReads(f, "const o = window['location'].href;")).toHaveLength(1);
    expect(locationReads(f, 'const l = (window as { location?: unknown }).location;')).toHaveLength(1);
    expect(locationReads(f, 'const o = globalThis.location.origin;')).toHaveLength(1);
    expect(locationReads(f, 'const s = location.search;')).toHaveLength(1);
    expect(locationReads(f, '// window.location.origin\nconst s = "window.location";')).toEqual([]);
    expect(locationReads(f, 'function f(location: { href: string }) { return location.href; }')).toEqual([]);
    expect(locationReads(f, 'const o = props.location.origin;')).toEqual([]);
    // RV16-641-5: the global reached through another object.
    expect(locationReads(f, 'const o = (globalObject.window as { location: { origin: unknown } }).location.origin;')).toHaveLength(1);
    expect(locationReads(f, 'const o = global.window.location.href;')).toHaveLength(1);
    expect(locationReads(f, "const o = g['window'].location.href;")).toHaveLength(1);
    expect(locationReads(f, "const o = g.globalThis['location'];")).toHaveLength(1);
    expect(locationReads(f, 'const o = props.windowed.location.origin;')).toEqual([]);
  });

  it('a phone loads native twins and plain modules, never web-only files or a base file with a phone twin', () => {
    const files = new Set(['src/a.ts', 'src/a.native.ts', 'src/b.tsx', 'src/b.ios.tsx', 'src/b.android.tsx', 'src/c.ts', 'src/c.ios.ts']);
    const has = (f: string) => files.has(f);
    expect(['src/a.ts', 'src/a.native.ts', 'src/b.tsx', 'src/b.ios.tsx', 'src/c.ts', 'src/c.ios.ts', 'src/d.web.tsx', 'src/e.d.ts', 'tests/f.ts'].filter((f) => phoneLoads(f, has))).toEqual([
      'src/a.native.ts',
      'src/b.ios.tsx',
      'src/c.ts',
      'src/c.ios.ts',
    ]);
  });

  it('app/ and src/ read it only in the allowed places', () => {
    expect(SOURCES.length).toBeGreaterThan(100);
    expect(READERS.filter((r) => !(r.file in ALLOWED))).toEqual([]);
  });

  it('RV16-641-5: the crash harness\'s deliberate read is seen (and allowed by name), so the scan covers that form', () => {
    expect(SOURCES).toContain('src/crashHarness.native.ts');
    expect(READERS.find((r) => r.file === 'src/crashHarness.native.ts')?.at).toHaveLength(1);
  });

  it('the origin helpers are where they should be: the web twin reads the page, the phone twin never does', () => {
    expect(SOURCES).not.toContain('src/ui/currentOrigin.ts');
    expect(SOURCES).toContain('src/ui/currentOrigin.native.ts');
    expect(locationReads('src/ui/currentOrigin.ts', readFileSync(join(APP_ROOT, 'src/ui/currentOrigin.ts'), 'utf8'))).toHaveLength(1);
    for (const file of ['src/ui/currentOrigin.native.ts', 'src/publicOrigin.ts', 'src/publicHost.ts', 'src/ui/kioskLink.ts', 'app/move/[goalId].tsx', 'app/station/[goalId].tsx']) {
      expect(locationReads(file, readFileSync(join(APP_ROOT, file), 'utf8')), file).toEqual([]);
    }
  });

  for (const r of READERS.filter((x) => x.file in ALLOWED && ALLOWED[x.file]!.startsWith('W16'))) {
    it.todo(`${ALLOWED[r.file]}: ${r.file} still reads window.location (${r.at.join(', ')})`);
  }
});
