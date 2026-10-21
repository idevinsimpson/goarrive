import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * W12-26 (OWNER UI-COPY, 2026-10-21). NO "STAGING" IN THE APP'S OWN STRINGS.
 *
 * The owner ordered every end-user-visible "staging" word out of the native
 * app on iOS, Android and the web, to match the Lovable reference, which has
 * none. This scan reads every module under app/ and src/ (design-target and
 * tests excluded) and finds the word in what could reach a screen: string
 * literals, template literals and JSX text. Comments and identifiers are not
 * copy and are not read; a module specifier (`from './stagingEnv'`) is not
 * copy either.
 *
 * What it finds must be on the allowlist below, by file and REASON, and each
 * reason is checked, not taken on trust:
 *   · 'env-var-name': the literal is an EXPO_PUBLIC_WSF_* variable name;
 *   · 'env-selector': the literal is exactly `staging`, the build selector's
 *     value, in a module with no JSX;
 *   · 'non-ui-module': a .ts module with no JSX and no React import, whose
 *     strings are the refusal messages thrown at boot (src/stagingEnv.ts,
 *     src/firebase.ts). No rendered surface shows them (W12-26 item 4):
 *     app/_layout.tsx:13 imports src/firebase at module scope, whose
 *     module-scope throws (:113, :136 via src/stagingEnv.ts:234, :169) fail
 *     the root layout before anything renders; nothing catches
 *     WsfStagingConfigError (only those two files name it); and a crash
 *     fallback never shows an error's own text
 *     (src/ui/RouteErrorFallback.native.tsx:42, CS-6).
 * Anything else offends, unless it is a KNOWN PENDING occurrence another lane
 * is removing, named by its exact text; one that is gone is reported, not
 * failed, so the composed tree passes once that lane lands.
 *
 * Every remaining internal occurrence is printed, so the PR body can quote
 * them against the exact revision.
 */

const APP_ROOT = join(__dirname, '..');
const WORD = /staging/i;

type Reason = 'env-var-name' | 'env-selector' | 'non-ui-module';
/** Internal-only occurrences, by file and reason; each reason is verified below. (src/firebase.ts holds no literal with the word: identifiers and comments only.) */
const ALLOWED: Array<{ file: string; reason: Reason; note: string }> = [
  { file: 'src/stagingEnv.ts', reason: 'env-var-name', note: 'the EXPO_PUBLIC_WSF_STAGING_* names the resolver reads and names in its refusals' },
  { file: 'src/stagingEnv.ts', reason: 'env-selector', note: "the build selector's value (EXPO_PUBLIC_WSF_ENV=staging)" },
  { file: 'src/stagingEnv.ts', reason: 'non-ui-module', note: 'refusal messages thrown at boot; never rendered (item 4)' },
];
/** Visible occurrences another lane is removing: allowed only while that exact text is there. */
const KNOWN_PENDING: Array<{ file: string; text: string; owner: string }> = [
  // W12-27: none. (member-1's "STAGING SYNTHETIC TEST" on app/goals/new.tsx became 'SYNTHETIC TEST' in 4459a1a1.)
];

export type Occurrence = { line: number; kind: 'string' | 'template' | 'jsx-text'; text: string };
export type Scanned = { found: Occurrence[]; hasJsx: boolean; importsReact: boolean };

/** Every literal in `text` that holds the word, with what the module is. */
export function scanSource(file: string, text: string): Scanned {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Occurrence[] = [];
  let hasJsx = false;
  let importsReact = false;
  const isSpecifier = (node: ts.Node) =>
    (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) ||
    (ts.isCallExpression(node.parent) &&
      node.parent.arguments[0] === node &&
      (node.parent.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.parent.expression) && node.parent.expression.text === 'require')));
  const at = (node: ts.Node, kind: Occurrence['kind'], raw: string) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
    found.push({ line: line + 1, kind, text: raw.replace(/\s+/g, ' ').trim().slice(0, 90) });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) hasJsx = true;
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === 'react') importsReact = true;
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !isSpecifier(node)) {
      if (WORD.test(node.text)) at(node, 'string', node.text);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (WORD.test(node.text)) at(node, 'template', node.text);
    } else if (ts.isJsxText(node)) {
      if (WORD.test(node.text)) at(node, 'jsx-text', node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { found, hasJsx, importsReact };
}

/** Whether `reason` genuinely covers this occurrence of this module. */
export function reasonHolds(reason: Reason, file: string, o: Occurrence, m: Scanned): boolean {
  switch (reason) {
    case 'env-var-name':
      return /^EXPO_PUBLIC_WSF_[A-Z0-9_]+$/.test(o.text);
    case 'env-selector':
      return o.text === 'staging' && !m.hasJsx;
    case 'non-ui-module':
      return file.endsWith('.ts') && !m.hasJsx && !m.importsReact && o.kind !== 'jsx-text';
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'design-target' || entry === 'tests' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const SOURCES = ['app', 'src']
  .flatMap((d) => walk(join(APP_ROOT, d)))
  .map((f) => relative(APP_ROOT, f).split(sep).join('/'))
  .filter((f) => /\.tsx?$/.test(f) && !/\.d\.ts$/.test(f))
  .sort();

type Classified = { file: string; o: Occurrence; reason: Reason | 'PENDING' | null; note: string };
function classify(): Classified[] {
  const out: Classified[] = [];
  for (const file of SOURCES) {
    const m = scanSource(file, readFileSync(join(APP_ROOT, file), 'utf8'));
    for (const o of m.found) {
      const entry = ALLOWED.find((a) => a.file === file && reasonHolds(a.reason, file, o, m));
      if (entry) {
        out.push({ file, o, reason: entry.reason, note: entry.note });
        continue;
      }
      const pending = KNOWN_PENDING.find((p) => p.file === file && o.text.includes(p.text));
      out.push({ file, o, reason: pending ? 'PENDING' : null, note: pending?.owner ?? '' });
    }
  }
  return out;
}

describe('W12-26: the scan itself', () => {
  const f = 'app/x.tsx';
  it('reads string literals, template literals and JSX text; not comments, identifiers or module specifiers', () => {
    expect(scanSource(f, '<Text>Staging data here</Text>;').found).toMatchObject([{ kind: 'jsx-text', line: 1 }]);
    expect(scanSource(f, "const t = 'STAGING - TEST DATA';").found).toMatchObject([{ kind: 'string', text: 'STAGING - TEST DATA' }]);
    expect(scanSource(f, 'const t = `Set EXPO_PUBLIC_WSF_ENV=staging ${x} now`;').found).toMatchObject([{ kind: 'template' }]);
    expect(scanSource(f, '<View testID="wsf-staging-banner" />;').found).toMatchObject([{ kind: 'string', text: 'wsf-staging-banner' }]);
    expect(scanSource(f, "// staging\n/* staging */\nconst stagingConfig = wsfIsStaging;\nimport { a } from './stagingEnv';\nexport { b } from './stagingShell';\nconst c = require('./stagingStrip');").found).toEqual([]);
  });

  it('a reason is checked against the occurrence, not taken on trust', () => {
    const ui: Scanned = { found: [], hasJsx: true, importsReact: true };
    const plain: Scanned = { found: [], hasJsx: false, importsReact: false };
    const jsx: Occurrence = { line: 1, kind: 'jsx-text', text: 'Staging test data' };
    const name: Occurrence = { line: 1, kind: 'string', text: 'EXPO_PUBLIC_WSF_STAGING_API_KEY' };
    const selector: Occurrence = { line: 1, kind: 'string', text: 'staging' };
    const message: Occurrence = { line: 1, kind: 'template', text: 'WSF STAGING CONFIGURATION REFUSED' };
    expect(reasonHolds('env-var-name', 'app/x.tsx', name, ui)).toBe(true);
    expect(reasonHolds('env-var-name', 'app/x.tsx', jsx, ui)).toBe(false);
    expect(reasonHolds('env-selector', 'src/x.ts', selector, plain)).toBe(true);
    expect(reasonHolds('env-selector', 'app/x.tsx', selector, ui)).toBe(false);
    expect(reasonHolds('non-ui-module', 'src/x.ts', message, plain)).toBe(true);
    expect(reasonHolds('non-ui-module', 'app/x.tsx', jsx, ui)).toBe(false);
    expect(reasonHolds('non-ui-module', 'src/x.tsx', message, { ...plain, hasJsx: true })).toBe(false);
    expect(reasonHolds('non-ui-module', 'src/x.ts', message, { ...plain, importsReact: true })).toBe(false);
  });
});

describe('W12-26: no end-user-visible "staging" copy in app/ or src/', () => {
  const all = classify();

  it('scans the app (more than 100 modules, design-target and tests excluded)', () => {
    expect(SOURCES.length).toBeGreaterThan(100);
    expect(SOURCES.some((f) => f.includes('design-target') || /(^|\/)tests\//.test(f))).toBe(false);
  });

  it('every occurrence is internal-only, by a verified reason, or a known pending removal by another lane', () => {
    const internal = all.filter((c) => c.reason !== null && c.reason !== 'PENDING');
    const pending = all.filter((c) => c.reason === 'PENDING');
    const visible = all.filter((c) => c.reason === null);
    // Printed for the PR body: the remaining internal-only occurrences, against the exact revision.
    console.log(
      ['W12-26 internal-only "staging" occurrences (file:line [reason] text):', ...internal.map((c) => `  ${c.file}:${c.o.line} [${c.reason}] ${c.o.text}`)].join('\n'),
    );
    if (pending.length) console.log(['W12-26 KNOWN PENDING (another lane removes these):', ...pending.map((c) => `  ${c.file}:${c.o.line} ${c.o.text} -- ${c.note}`)].join('\n'));
    expect(visible.map((c) => `${c.file}:${c.o.line} [${c.o.kind}] ${c.o.text}`)).toEqual([]);
  });

  it('every allowlist entry still covers something, and a pending removal that has landed is reported', () => {
    const unused = ALLOWED.filter((a) => !all.some((c) => c.file === a.file && c.reason === a.reason));
    // An entry that covers nothing any more is stale, and is removed then.
    expect(unused).toEqual([]);
    for (const p of KNOWN_PENDING) {
      if (!all.some((c) => c.reason === 'PENDING' && c.file === p.file && c.o.text.includes(p.text))) {
        console.log(`W12-26: KNOWN PENDING landed (remove the entry): ${p.file} "${p.text}"`);
      }
    }
  });
});
