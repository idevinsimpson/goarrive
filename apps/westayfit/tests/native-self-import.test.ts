import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { nativeFileList, splitSuffix, tsconfigFor } from '../scripts/typecheck-native.mjs';

/**
 * NATIVE-TSC-1. A `.native` FILE NEVER IMPORTS ITS OWN BASE SPECIFIER.
 *
 * On iOS and Android Metro resolves `./kv` from `kv.native.ts` to
 * `kv.native.ts` itself, so `import type { DeviceKv } from './kv'` there is a
 * circular alias: every type it names becomes `any`, and the default tsc
 * (web resolution) never sees it. All 16 errors of the first native
 * type-check came from two such re-exports. This guard is static and cheap:
 * no `*.native.ts(x)` under app/, src/ or modules/ may import, re-export or
 * type-query its own base, by any relative spelling. `npm run
 * typecheck:native` is the full check.
 *
 * KNOWN OFFENDERS, owned by other lanes and being split there. Each is
 * listed with its ticket and the module that will hold the shared types.
 * Once a split lands the entry is simply no longer an offender (an entry for
 * a file that no longer offends, or does not exist on this branch, fails
 * nothing), so a candidate that merges the split stays green; remove the
 * entry then.
 */
const KNOWN_OFFENDERS: Record<string, string> = {
  // TODO(ST-TSC-1): W13 moves DeviceKv/KvRead to src/storage/kvTypes.ts.
  'src/storage/kv.native.ts': 'ST-TSC-1',
  // TODO(CAM-TSC-1): W15 moves TestPoseHook to src/movement-camera/testPoseHookType.ts.
  'src/movement-camera/support.native.ts': 'CAM-TSC-1',
};

const APP_ROOT = join(__dirname, '..');

/** The specifiers in `text` (of app-relative `file`) that resolve to the file's own base or to itself. */
export function selfImports(file: string, text: string): string[] {
  const parts = splitSuffix(file) as { stem: string; suffix: string } | null;
  if (!parts || parts.suffix !== 'native') return [];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const specifiers: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      specifiers.push(node.argument.literal.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
      specifiers.push(node.moduleReference.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const own = parts.stem;
  const dir = posix.dirname(file.split(sep).join('/'));
  return specifiers.filter((spec) => {
    if (!spec.startsWith('.')) return false;
    const target = posix.normalize(posix.join(dir, spec)).replace(/\.(tsx?|jsx?|mjs)$/, '');
    return target === own || target === `${own}.native`;
  });
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

const NATIVE_FILES = ['app', 'src', 'modules']
  .filter((d) => {
    try {
      return statSync(join(APP_ROOT, d)).isDirectory();
    } catch {
      return false;
    }
  })
  .flatMap((d) => walk(join(APP_ROOT, d)))
  .map((f) => relative(APP_ROOT, f).split(sep).join('/'))
  .filter((f) => /\.native\.tsx?$/.test(f));

/** Offenders that are not on the ticketed list: these fail the guard. */
function unexpectedOffenders<T extends { file: string }>(offenders: T[]): T[] {
  return offenders.filter((o) => !(o.file in KNOWN_OFFENDERS));
}

const OFFENDERS = NATIVE_FILES.map((f) => ({ file: f, specs: selfImports(f, readFileSync(join(APP_ROOT, f), 'utf8')) })).filter(
  (o) => o.specs.length > 0,
);

describe('NATIVE-TSC-1: no .native file imports its own base specifier', () => {
  it('the detector finds every spelling of a self-import, and nothing else', () => {
    const file = 'src/storage/kv.native.ts';
    const found = (text: string) => selfImports(file, text);
    expect(found(`import type { DeviceKv } from './kv';`)).toEqual(['./kv']);
    expect(found(`export type { DeviceKv, KvRead } from './kv';`)).toEqual(['./kv']);
    expect(found(`import { deviceKv } from './kv';`)).toEqual(['./kv']);
    expect(found(`import * as base from './kv.ts';`)).toEqual(['./kv.ts']);
    expect(found(`import type { A } from '../storage/kv';`)).toEqual(['../storage/kv']);
    expect(found(`type A = import('./kv').DeviceKv;`)).toEqual(['./kv']);
    expect(found(`const m = require('./kv');`)).toEqual(['./kv']);
    expect(found(`void import('./kv');`)).toEqual(['./kv']);
    expect(found(`export * from './kv.native';`)).toEqual(['./kv.native']);
    // The fix, and everything else, is fine.
    expect(found(`import type { DeviceKv, KvRead } from './kvTypes';`)).toEqual([]);
    expect(found(`import AsyncStorage from '@react-native-async-storage/async-storage';`)).toEqual([]);
    expect(found(`import { x } from './kv/index';`)).toEqual([]);
    expect(found(`import { x } from '../kv';`)).toEqual([]);
    // Only .native files are judged: a base file importing a sibling is ordinary.
    expect(selfImports('src/storage/kv.ts', `import type { A } from './kv';`)).toEqual([]);
    expect(selfImports('src/ui/Thing.native.tsx', `import { Thing } from './Thing';`)).toEqual(['./Thing']);
  });

  it('app/, src/ and modules/ have no self-importing .native file beyond the known, ticketed offenders', () => {
    // Not vacuous: the scan really read this branch's native files.
    expect(NATIVE_FILES.length).toBeGreaterThan(5);
    expect(unexpectedOffenders(OFFENDERS)).toEqual([]);
  });

  it('a new self-importing .native file fails the guard; only the ticketed two are tolerated', () => {
    const fresh = { file: 'src/ui/Pane.native.tsx', specs: ['./Pane'] };
    const known = { file: 'src/storage/kv.native.ts', specs: ['./kv'] };
    const camera = { file: 'src/movement-camera/support.native.ts', specs: ['./support'] };
    expect(unexpectedOffenders([fresh, known, camera])).toEqual([fresh]);
    expect(Object.values(KNOWN_OFFENDERS).sort()).toEqual(['CAM-TSC-1', 'ST-TSC-1']);
  });

  for (const o of OFFENDERS.filter((x) => x.file in KNOWN_OFFENDERS)) {
    it.todo(`${KNOWN_OFFENDERS[o.file]}: ${o.file} still imports ${o.specs.join(', ')} (its lane is splitting the shared types out)`);
  }
});

describe('NATIVE-TSC-1: the native type-check script picks the files a phone can reach', () => {
  const FILES = [
    'src/storage/kv.ts',
    'src/storage/kv.native.ts',
    'src/storage/kvTypes.ts',
    'src/ui/Pane.tsx',
    'src/ui/Pane.ios.tsx',
    'src/ui/Pane.native.tsx',
    'src/ui/Media.web.tsx',
    'src/ui/Media.tsx',
    'src/ui/Only.android.ts',
    'src/types.d.ts',
    'src/movement-camera/frozen/reference.ts',
    'src/thing.test.ts',
    'app/(tabs)/index.tsx',
    'modules/wsf-pose-camera/index.ts',
    'tests/foo.test.ts',
    'tests/helpers/setup.ts',
    'src/readme.md',
  ];

  it('iOS: .ios over .native over the base; no .web, no android, no tests, no frozen reference', () => {
    expect(nativeFileList(FILES, 'ios')).toEqual([
      'app/(tabs)/index.tsx',
      'modules/wsf-pose-camera/index.ts',
      'src/storage/kv.native.ts',
      'src/storage/kvTypes.ts',
      'src/types.d.ts',
      'src/ui/Media.tsx',
      'src/ui/Pane.ios.tsx',
    ]);
  });

  it('Android: .android over .native over the base', () => {
    expect(nativeFileList(FILES, 'android')).toEqual([
      'app/(tabs)/index.tsx',
      'modules/wsf-pose-camera/index.ts',
      'src/storage/kv.native.ts',
      'src/storage/kvTypes.ts',
      'src/types.d.ts',
      'src/ui/Media.tsx',
      'src/ui/Only.android.ts',
      'src/ui/Pane.native.tsx',
    ]);
  });

  it('the temporary tsconfig extends the app\'s, with Metro\'s suffix order, the app\'s @types, no emit, and exactly the listed files', () => {
    const cfg = tsconfigFor('/app', 'ios', ['src/a.ts']);
    expect(cfg).toEqual({
      extends: join('/app', 'tsconfig.json'),
      compilerOptions: { moduleSuffixes: ['.ios', '.native', ''], noEmit: true, typeRoots: [join('/app', 'node_modules', '@types')] },
      include: [],
      files: [join('/app', 'src/a.ts')],
    });
    expect(tsconfigFor('/app', 'android', []).compilerOptions.moduleSuffixes).toEqual(['.android', '.native', '']);
  });

  it('package.json runs it as typecheck:native', () => {
    const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['typecheck:native']).toBe('node scripts/typecheck-native.mjs');
    expect(dirname(join(APP_ROOT, 'scripts/typecheck-native.mjs'))).toBe(join(APP_ROOT, 'scripts'));
  });
});
