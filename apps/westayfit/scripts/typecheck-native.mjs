#!/usr/bin/env node
/**
 * NATIVE-TSC-1. TYPE-CHECK THE APP AS METRO RESOLVES IT ON iOS AND ANDROID.
 *
 * `tsc --noEmit` with the app's own tsconfig resolves every import the way
 * the web build does: `./kv` is `kv.ts`, never `kv.native.ts`. So a file that
 * only the phones run is checked against the web module's types, and a
 * mistake that only exists on a phone type-checks clean. Measured: the default
 * check reported 0 errors while the native resolution had 16, all from two
 * circular type re-exports (a `.native` file importing its own base
 * specifier, which on a phone is itself).
 *
 * This runs tsc once per platform with Metro's suffix order
 * (`moduleSuffixes: [".<platform>", ".native", ""]`) over the files a phone
 * can actually reach:
 *   - git-tracked `app/`, `src/` and `modules/` *.ts / *.tsx (the files on
 *     disk when run outside a git work tree), plus `expo-env.d.ts` and the
 *     generated `.expo/types` when present;
 *   - minus tests, `*.web.*`, the other platform's files,
 *     `src/movement-camera/frozen`, and every file shadowed by a sibling with
 *     a higher-priority suffix (a base `X.ts` beside `X.native.ts` is never
 *     loaded on a phone; neither is `X.native.ts` beside `X.ios.ts` on iOS).
 *
 * It prints tsc's errors with paths relative to the app, and exits non-zero
 * on any error. It is a TypeScript check only: no Swift, Kotlin, Xcode or
 * Gradle compile runs here (docs/westayfit/native/NATIVE-BUILD-READINESS.md).
 *
 * Usage (from apps/westayfit): npm run typecheck:native [-- ios|android]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PLATFORMS = ['ios', 'android'];
const SOURCE_ROOTS = ['app', 'src', 'modules'];
const SOURCE_FILE = /\.(ts|tsx)$/;

/** `src/storage/kv.native.ts` -> { stem: 'src/storage/kv', suffix: 'native', ext: 'ts' } */
export function splitSuffix(file) {
  const m = /^(.*?)(?:\.(ios|android|native|web))?\.(d\.ts|ts|tsx)$/.exec(file);
  if (!m) return null;
  return { stem: m[1], suffix: m[2] ?? '', ext: m[3] };
}

/** Whether a path is a test, a fixture of the frozen camera reference, or otherwise never shipped. */
export function isExcludedPath(file) {
  const p = file.split(sep).join('/');
  return (
    /(^|\/)(tests|__tests__|tests-e2e)\//.test(p) ||
    /\.(test|spec)\.(ts|tsx)$/.test(p) ||
    p.startsWith('src/movement-camera/frozen/')
  );
}

/**
 * The files a `platform` build can reach, from a list of app-relative paths:
 * the suffix order is `.<platform>`, `.native`, then the base file, and a
 * file is dropped when a sibling with an earlier suffix exists. `.web` files
 * and the other platform's files are never reachable.
 */
export function nativeFileList(files, platform) {
  const order = [platform, 'native', ''];
  const candidates = files.filter((f) => SOURCE_FILE.test(f) && !isExcludedPath(f));
  const byStem = new Map();
  for (const f of candidates) {
    const s = splitSuffix(f);
    if (!s) continue;
    if (s.ext === 'd.ts') continue; // declarations are handled below, untouched by suffixes
    if (!order.includes(s.suffix)) continue; // .web, or the other platform
    const key = s.stem;
    const list = byStem.get(key) ?? [];
    list.push({ f, rank: order.indexOf(s.suffix) });
    byStem.set(key, list);
  }
  const out = [];
  for (const list of byStem.values()) {
    const best = Math.min(...list.map((x) => x.rank));
    for (const x of list) if (x.rank === best) out.push(x.f);
  }
  const declarations = candidates.filter((f) => f.endsWith('.d.ts') && !/\.(web|ios|android)\.d\.ts$/.test(f));
  return [...new Set([...out, ...declarations])].sort();
}

/** The tsconfig for one platform's check (the app tsconfig, Metro's suffixes, exactly these files). */
export function tsconfigFor(appRoot, platform, files) {
  return {
    extends: join(appRoot, 'tsconfig.json'),
    compilerOptions: {
      moduleSuffixes: [`.${platform}`, '.native', ''],
      noEmit: true,
      typeRoots: [join(appRoot, 'node_modules', '@types')],
    },
    include: [],
    files: files.map((f) => join(appRoot, f)),
  };
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function trackedSources(appRoot) {
  let listed;
  try {
    listed = execFileSync('git', ['ls-files', '-z', '--', ...SOURCE_ROOTS], {
      cwd: appRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\0')
      .filter(Boolean);
  } catch {
    // Not a git work tree (an exported copy): the files on disk instead.
    console.log('typecheck:native: not a git work tree; checking the files on disk');
    listed = SOURCE_ROOTS.filter((d) => existsSync(join(appRoot, d)))
      .flatMap((d) => walk(join(appRoot, d)))
      .filter((f) => !f.split(sep).includes('node_modules'))
      .map((f) => relative(appRoot, f));
  }
  const extra = [];
  if (existsSync(join(appRoot, 'expo-env.d.ts'))) extra.push('expo-env.d.ts');
  const generated = join(appRoot, '.expo', 'types');
  if (existsSync(generated)) {
    for (const f of walk(generated)) if (f.endsWith('.ts')) extra.push(relative(appRoot, f));
  }
  return { listed, extra };
}

/** tsc's output for the whole app can be large; spawnSync's 1 MiB default would cut it off. */
export const TSC_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * One tsc run's verdict from spawnSync's answer. A tsc that did not run (not
 * found, killed for its output size, any spawn error) fails: it is never read
 * as "0 errors".
 */
export function outcomeOf(run, appRoot) {
  if (run.error) {
    const code = run.error.code ?? run.error.name ?? 'error';
    return { errors: [], output: `tsc did not run (${code})`, failed: true };
  }
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
    .split(appRoot + sep)
    .join('')
    .trim();
  const errors = output.split('\n').filter((l) => /error TS\d+:/.test(l));
  return { errors, output, failed: errors.length > 0 || run.status !== 0 };
}

export function checkPlatform(appRoot, platform, spawn = spawnSync) {
  const { listed, extra } = trackedSources(appRoot);
  const files = [...nativeFileList(listed, platform), ...extra];
  const dir = mkdtempSync(join(tmpdir(), `wsf-typecheck-${platform}-`));
  const config = join(dir, 'tsconfig.json');
  let run;
  try {
    writeFileSync(config, JSON.stringify(tsconfigFor(appRoot, platform, files), null, 2));
    const tsc = join(appRoot, 'node_modules', 'typescript', 'bin', 'tsc');
    run = spawn(process.execPath, [tsc, '-p', config, '--pretty', 'false'], {
      cwd: appRoot,
      encoding: 'utf8',
      maxBuffer: TSC_MAX_BUFFER,
    });
  } finally {
    // Only what this run wrote: its one tsconfig and the empty directory around it.
    if (existsSync(config)) unlinkSync(config);
    rmdirSync(dir);
  }
  return { files: files.length, ...outcomeOf(run, appRoot) };
}

function main() {
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const asked = process.argv.slice(2).filter((a) => PLATFORMS.includes(a));
  const platforms = asked.length ? asked : PLATFORMS;
  let failed = false;
  for (const platform of platforms) {
    const r = checkPlatform(appRoot, platform);
    console.log(`typecheck:native ${platform}: ${r.files} files, ${r.errors.length} error(s)`);
    if (r.output) console.log(r.output);
    if (r.failed) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
