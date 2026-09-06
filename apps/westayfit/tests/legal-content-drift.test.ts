import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WSF_PRIVACY_MARKDOWN, WSF_TERMS_MARKDOWN } from '../src/legalContent';

/**
 * legalContent.ts is a hand-typed mirror of apps/westayfit/legal/*.md — Metro's
 * web build has no .md loader, so the accordion imports strings from a .ts
 * file instead of the source of truth. That works as long as the two stay in
 * sync; if they drift, the app shows one version and the repo diff shows
 * another. Fail the build when they diverge so the next update touches both.
 */

const legalDir = resolve(__dirname, '..', 'legal');

function readMd(file: string): string {
  return readFileSync(resolve(legalDir, file), 'utf-8');
}

describe('legalContent mirrors legal/*.md', () => {
  it('WSF_TERMS_MARKDOWN matches legal/terms.md byte-for-byte', () => {
    expect(WSF_TERMS_MARKDOWN).toBe(readMd('terms.md'));
  });

  it('WSF_PRIVACY_MARKDOWN matches legal/privacy.md byte-for-byte', () => {
    expect(WSF_PRIVACY_MARKDOWN).toBe(readMd('privacy.md'));
  });
});
