// Brand artwork is owner-supplied. The originals are byte-for-byte copies of
// the uploads; the derived files are produced by one documented script whose
// manifest records the checksum of every input and output. These tests make
// an undocumented edit to either set fail: change a PNG and the manifest no
// longer matches; change the manifest and the originals inventory no longer
// matches.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const BRAND = path.resolve(__dirname, '../assets/brand');

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

type Manifest = {
  generator: string;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
};

type Inventory = {
  files: Array<{ sha256: string; repository_path: string }>;
};

const manifest = JSON.parse(
  readFileSync(path.join(BRAND, 'derived/MANIFEST.json'), 'utf8')
) as Manifest;
const inventory = JSON.parse(
  readFileSync(path.join(BRAND, 'originals/SHA256SUMS.json'), 'utf8')
) as Inventory;

describe('brand originals', () => {
  it('are the files the owner supplied, byte for byte', () => {
    expect(inventory.files.length).toBeGreaterThanOrEqual(4);
    for (const f of inventory.files) {
      const abs = path.resolve(__dirname, '../../..', f.repository_path);
      expect(sha256(abs), f.repository_path).toBe(f.sha256);
    }
  });
});

describe('brand derived files', () => {
  it('were generated from those exact originals', () => {
    expect(Object.keys(manifest.inputs).length).toBeGreaterThanOrEqual(2);
    for (const [name, sum] of Object.entries(manifest.inputs)) {
      expect(sha256(path.join(BRAND, 'originals', name)), name).toBe(sum);
      // Each input the generator read is one of the owner's originals.
      expect(inventory.files.some((f) => f.sha256 === sum), name).toBe(true);
    }
  });

  it('match the manifest the generator wrote', () => {
    const expected = [
      'wordmark-navy-green.png',
      'wordmark-white-green.png',
      'monogram-silhouette.png',
      'monogram-fill-green.png',
      'monogram-unfilled-navy.png',
      'monogram-unfilled-white.png',
      'living-we-calibration.json',
    ];
    for (const name of expected) {
      expect(manifest.outputs[name], name).toBeDefined();
      expect(sha256(path.join(BRAND, 'derived', name)), name).toBe(manifest.outputs[name]);
    }
  });

  it('name the script that produced them', () => {
    expect(manifest.generator).toBe('scripts/westayfit/brand/derive-brand-assets.py');
  });
});
