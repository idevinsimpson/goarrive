import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * ST-TSC-1. Under Metro's native resolution (module suffixes `.ios` /
 * `.android`, `.native`, ``), a `*.native.ts` file that imports from its own
 * base specifier — `kv.native.ts` importing from './kv' — is importing ITSELF.
 * For types that is a circular alias and the file stops being type-checked
 * against the contract; for values it is a self-import. Runtime-shared types
 * live in a module with no platform sibling (src/storage/kvTypes.ts) instead.
 *
 * Static on purpose: the default `tsc` resolves './kv' to kv.ts and cannot see
 * this.
 */
const STORAGE = path.resolve('src/storage');

function selfImports(file: string): string[] {
  const base = file.replace(/\.native\.tsx?$/, '');
  // Code only: a comment may NAME the forbidden specifier (to explain why it
  // is not used) without importing it.
  const src = readFileSync(path.join(STORAGE, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const spec = `\\./${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
  const patterns = [
    new RegExp(`\\bfrom\\s+['"]${spec}['"]`, 'g'),
    new RegExp(`\\bimport\\s*\\(\\s*['"]${spec}['"]\\s*\\)`, 'g'),
    new RegExp(`\\brequire\\s*\\(\\s*['"]${spec}['"]\\s*\\)`, 'g'),
    new RegExp(`^\\s*import\\s+['"]${spec}['"]`, 'gm'),
  ];
  return patterns.flatMap((re) => src.match(re) ?? []);
}

describe('ST-TSC-1: no native storage module imports from its own base specifier', () => {
  const natives = readdirSync(STORAGE).filter((f) => /\.native\.tsx?$/.test(f));

  it('finds the native storage modules', () => {
    expect(natives).toEqual(expect.arrayContaining(['kv.native.ts', 'sessionKv.native.ts', 'syncRead.native.ts']));
  });

  for (const file of ['kv.native.ts', 'sessionKv.native.ts', 'syncRead.native.ts']) {
    it(`${file} does not import (type or value) from './${file.replace(/\.native\.ts$/, '')}'`, () => {
      expect(selfImports(file)).toEqual([]);
    });
  }

  it('every native storage module, including any added later, passes the same rule', () => {
    for (const file of natives) expect(selfImports(file), file).toEqual([]);
  });

  it('the contract has no platform sibling, and both kv modules re-export it from there', () => {
    expect(readdirSync(STORAGE).filter((f) => f.startsWith('kvTypes.'))).toEqual(['kvTypes.ts']);
    for (const file of ['kv.ts', 'kv.native.ts']) {
      expect(readFileSync(path.join(STORAGE, file), 'utf8')).toContain("export type { DeviceKv, KvRead } from './kvTypes';");
    }
  });
});
