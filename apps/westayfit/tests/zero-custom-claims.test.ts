import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const WSF_PATHS = [
  'apps/westayfit',
  'functions-westayfit',
  'scripts/westayfit',
];

const FORBIDDEN = 'setCustomUserClaims';

const GUARD_EXCLUDE = [
  ':(exclude)apps/westayfit/tests/zero-custom-claims.test.ts',
  ':(exclude)docs/westayfit/**',
];

function greppedHits(): string[] {
  const args = [
    '-C',
    REPO_ROOT,
    'grep',
    '-nHI',
    '--fixed-strings',
    FORBIDDEN,
    '--',
    ...WSF_PATHS.filter((p) => existsSync(path.join(REPO_ROOT, p))),
    ...GUARD_EXCLUDE,
  ];

  try {
    const out = execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    return out.split('\n').filter(Boolean);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'status' in err) {
      const status = (err as { status: number | null }).status;
      if (status === 1) return [];
    }
    throw err;
  }
}

describe('WSF zero-custom-claims invariant', () => {
  it('never calls setCustomUserClaims in any WSF-owned path', () => {
    const hits = greppedHits();
    if (hits.length > 0) {
      const message = [
        `ARCHITECTURE.md invariant (f) violated: found ${hits.length} occurrence(s) of "${FORBIDDEN}" in WSF paths.`,
        '',
        'Any WSF claim would be silently clobbered by 7 of the 8 GoArrive claims writers.',
        'See docs/westayfit/ARCHITECTURE.md and DECISIONS.md.',
        '',
        'Offending lines:',
        ...hits,
      ].join('\n');
      throw new Error(message);
    }
    expect(hits).toEqual([]);
  });
});
