import { readdirSync, readFileSync } from 'node:fs';
import * as nodePath from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * NATIVE-MOTION-1 review N4 — optional bundle-level proof that Metro resolved
 * togetherMotionNative.web.ts for the web and togetherMotionNative.tsx for
 * native. Vitest itself does not apply platform extensions, so this reads real
 * `expo export` output when pointed at it:
 *
 *   npx expo export --platform web --output-dir <web>
 *   npx expo export --platform ios --output-dir <ios>
 *   WSF_WEB_EXPORT_DIR=<web> WSF_NATIVE_EXPORT_DIR=<ios> npx vitest run tests/web-bundle-native-motion.test.ts
 *
 * Without the variables these are skipped (no export in a plain test run).
 */

const NATIVE_ONLY = ['wsf-together-native-layer', 'buildNativeTogetherTimeline', 'glowBands', 'piecesEndMs'];
const STUB_TEXT = 'The native Together motion does not run on the web.';

function bundleText(dir: string, sub: string, ext: string): string {
  const js = nodePath.join(dir, '_expo', 'static', 'js', sub);
  return readdirSync(js)
    .filter((f) => f.endsWith(ext))
    .map((f) => readFileSync(nodePath.join(js, f)).toString('latin1'))
    .join('\n');
}

describe('the export carries the right Together driver for its platform', () => {
  const web = process.env.WSF_WEB_EXPORT_DIR;
  const native = process.env.WSF_NATIVE_EXPORT_DIR;

  it.skipIf(!web)('web export: the stub, the web canvas driver, and none of the native driver', () => {
    const text = bundleText(web!, 'web', '.js');
    for (const needle of NATIVE_ONLY) expect(text.includes(needle), needle).toBe(false);
    expect(text).toContain(STUB_TEXT);
    expect(text).toContain('wsf-together-canvas');
  });

  it.skipIf(!native)('native (iOS/Android) export: the native driver, and not the web stub', () => {
    const sub = readdirSync(nodePath.join(native!, '_expo', 'static', 'js'))[0];
    const text = bundleText(native!, sub, '.hbc');
    for (const needle of NATIVE_ONLY) expect(text.includes(needle), needle).toBe(true);
    expect(text.includes(STUB_TEXT)).toBe(false);
  });
});
