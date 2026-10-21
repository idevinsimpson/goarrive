import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * MF-05. An `image/svg+xml` data URI renders as an empty box in React
 * Native's <Image>, and nothing else on a phone draws one. So outside the
 * modules that build the markup (`qr.ts`, `moveFigure.ts`) and
 * `SvgMarkup.tsx` (the web twin, the one place a data URI meets <Image>), no
 * module a phone can load may use an SVG data-URI producer or spell the
 * prefix. Web-only `*.web.*` files are exempt. Comments are not read.
 *
 * TEMPORARY ALLOWLIST, each removed by its adopter. An entry for a file that
 * no longer offends fails nothing; remove it then.
 */
const ALLOWED_FOR_NOW: Record<string, string> = {
  // MF-05 F-5 (member, W16-10): the invite QR moves to SvgMarkup.
  'src/ui/JoinQrCode.tsx': 'W16-10',
  // (W12-19: the MOVE handoff QR and the station's two QR codes moved to SvgMarkup; they are no longer tolerated.)
};

/** Where the markup is built, and the one web place it becomes a data URI. */
const HOMES = ['src/ui/qr.ts', 'src/ui/moveFigure.ts', 'src/ui/SvgMarkup.tsx'];

const PRODUCERS = new Set(['qrSvgDataUriRaw', 'qrSvgDataUri', 'moveFigureSvgDataUriRaw', 'moveFigureSvgDataUri', 'SVG_DATA_URI_PREFIX']);
const PREFIX = 'data:image/svg+xml';

/** The SVG data-URI producers a module uses, and the prefix if it spells it; comments are ignored. */
export function svgDataUriUses(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && PRODUCERS.has(node.text)) found.add(node.text);
    else if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && node.text.includes(PREFIX))
      found.add(PREFIX);
    else if (ts.isJsxText(node) && node.text.includes(PREFIX)) found.add(PREFIX);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...found].sort();
}

const APP_ROOT = join(__dirname, '..');
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** The modules a phone can load: app/ and src/ .ts(x), minus web-only files and tests. */
function phoneModules(paths: string[]): string[] {
  return paths.filter((f) => /\.tsx?$/.test(f) && !/\.web\.tsx?$/.test(f) && !/\.d\.ts$/.test(f) && !/(^|\/)(tests|__tests__)\//.test(f));
}

const SOURCES = phoneModules(
  ['app', 'src'].flatMap((d) => walk(join(APP_ROOT, d))).map((f) => relative(APP_ROOT, f).split(sep).join('/')),
);
const USERS = SOURCES.filter((f) => !HOMES.includes(f))
  .map((file) => ({ file, uses: svgDataUriUses(file, readFileSync(join(APP_ROOT, file), 'utf8')) }))
  .filter((u) => u.uses.length > 0);

const unexpected = <T extends { file: string }>(users: T[]) => users.filter((u) => !(u.file in ALLOWED_FOR_NOW));

describe('MF-05: no SVG data URI reaches React Native\'s <Image> outside SvgMarkup', () => {
  it('the detector sees every producer and the spelled prefix, and ignores comments', () => {
    const f = 'src/ui/X.tsx';
    expect(svgDataUriUses(f, `const u = qrSvgDataUriRaw(code);`)).toEqual(['qrSvgDataUriRaw']);
    expect(svgDataUriUses(f, `<Image source={{ uri: moveFigureSvgDataUriRaw({ kind, pose }) }} />`)).toEqual(['moveFigureSvgDataUriRaw']);
    expect(svgDataUriUses(f, `import { qrSvgDataUri } from './qr';`)).toEqual(['qrSvgDataUri']);
    expect(svgDataUriUses(f, `const u = \`\${SVG_DATA_URI_PREFIX}\${svg}\`;`)).toEqual(['SVG_DATA_URI_PREFIX']);
    expect(svgDataUriUses(f, `<Image source={{ uri: 'data:image/svg+xml;utf8,' + svg }} />`)).toEqual([PREFIX]);
    expect(svgDataUriUses(f, `<Image source={{ uri: \`data:image/svg+xml;utf8,\${svg}\` }} />`)).toEqual([PREFIX]);
    // Comments, other data URIs and the native renderer are fine.
    expect(svgDataUriUses(f, `// See qrSvgDataUriRaw: data:image/svg+xml\nconst a = 1;`)).toEqual([]);
    expect(svgDataUriUses(f, `<Image source={{ uri: 'data:image/png;base64,AAAA' }} />`)).toEqual([]);
    expect(svgDataUriUses(f, `<SvgMarkup markup={renderQrSvg(code)} testID="x" />`)).toEqual([]);
  });

  it('the scan reads phone modules only (no *.web.*, no tests, no declarations)', () => {
    expect(
      phoneModules(['src/a.tsx', 'src/b.native.tsx', 'src/c.web.tsx', 'src/d.ts', 'src/e.d.ts', 'src/tests/f.ts', 'src/g.json']),
    ).toEqual(['src/a.tsx', 'src/b.native.tsx', 'src/d.ts']);
  });

  it('app/ and src/ have no SVG data URI outside the homes and the ticketed allowlist', () => {
    expect(SOURCES.length).toBeGreaterThan(100);
    expect(unexpected(USERS)).toEqual([]);
  });

  it('a new data-URI <Image> site fails the scan; only the ticketed file is tolerated', () => {
    const fresh = { file: 'src/ui/NewQr.tsx', uses: svgDataUriUses('src/ui/NewQr.tsx', `<Image source={{ uri: qrSvgDataUriRaw(c) }} />`) };
    expect(fresh.uses).toEqual(['qrSvgDataUriRaw']);
    const known = { file: 'src/ui/JoinQrCode.tsx', uses: ['qrSvgDataUriRaw'] };
    expect(unexpected([fresh, known])).toEqual([fresh]);
    expect(Object.keys(ALLOWED_FOR_NOW).sort()).toEqual(['src/ui/JoinQrCode.tsx']);
    // W12-19: the venue and kiosk QRs (MOVE's handoff, the station's join and member codes) are not tolerated any more.
    expect(unexpected([{ file: 'app/move/[goalId].tsx', uses: ['qrSvgDataUriRaw'] }])).toHaveLength(1);
    expect(unexpected([{ file: 'app/station/[goalId].tsx', uses: ['qrSvgDataUriRaw'] }])).toHaveLength(1);
  });

  for (const u of USERS.filter((x) => x.file in ALLOWED_FOR_NOW)) {
    it.todo(`${ALLOWED_FOR_NOW[u.file]}: ${u.file} still passes an SVG data URI (${u.uses.join(', ')}) to <Image>`);
  }
});
