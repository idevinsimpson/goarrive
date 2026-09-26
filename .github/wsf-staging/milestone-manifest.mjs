#!/usr/bin/env node
/**
 * Validate a staging milestone manifest, schema v1
 * (docs/westayfit/ops/OWNER_TEST_CARD_AND_SMOKE_CONTRACT.md).
 *
 * The manifest is frozen before deployment and is the single input to both the
 * changed-journey smoke and the owner test card, so it is validated strictly:
 * an unknown key is refused rather than ignored, because a misspelt
 * `knownExclusion` that is silently dropped would make the card say "nothing
 * excluded" when something was.
 *
 * Exit 0 = MANIFEST=valid. Exit 1 = MANIFEST=invalid, one line per problem.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TOP = ['schemaVersion', 'milestone', 'productSha', 'previousKnownGoodSha', 'journeys'];
const JOURNEY = ['id', 'entry', 'setup', 'actions', 'expected', 'knownExclusions'];
const SHA = /^[0-9a-f]{40}$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.trim() !== '' && v === v.trim() && !/[\r\n]/.test(v);

function keys(obj, allowed, where, errors) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) errors.push(`${where}: unknown key ${JSON.stringify(k)}`);
  for (const k of allowed) if (!Object.hasOwn(obj, k)) errors.push(`${where}: missing ${k}`);
}
function strings(v, where, errors, { min }) {
  if (!Array.isArray(v)) { errors.push(`${where} must be an array`); return; }
  if (v.length < min) errors.push(`${where} must have at least ${min} entr${min === 1 ? 'y' : 'ies'}`);
  v.forEach((s, i) => { if (!text(s)) errors.push(`${where}[${i}] must be a non-empty single-line string`); });
}

/** Returns a list of problems; empty means valid. */
export function validateManifest(m) {
  const errors = [];
  if (!isObject(m)) return ['the manifest must be a JSON object'];
  keys(m, TOP, 'manifest', errors);
  if (Object.hasOwn(m, 'schemaVersion') && m.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (Object.hasOwn(m, 'milestone') && !(text(m.milestone) && /^[A-Z0-9][A-Z0-9-]*$/.test(m.milestone))) {
    errors.push('milestone must be an upper-case identifier such as COMMUNITY-SETTINGS-PARITY-1');
  }
  for (const k of ['productSha', 'previousKnownGoodSha']) {
    if (Object.hasOwn(m, k) && !(typeof m[k] === 'string' && SHA.test(m[k]))) errors.push(`${k} must be a full 40-character lowercase commit SHA`);
  }
  if (SHA.test(m.productSha || '') && m.productSha === m.previousKnownGoodSha) {
    errors.push('productSha and previousKnownGoodSha are the same commit: a rollback target must be a different, already-served SHA');
  }
  if (Object.hasOwn(m, 'journeys')) {
    if (!Array.isArray(m.journeys) || m.journeys.length === 0) errors.push('journeys must be a non-empty array');
    else {
      const seen = new Set();
      m.journeys.forEach((j, i) => {
        const where = `journeys[${i}]`;
        if (!isObject(j)) { errors.push(`${where} must be an object`); return; }
        keys(j, JOURNEY, where, errors);
        if (Object.hasOwn(j, 'id')) {
          if (!(typeof j.id === 'string' && /^[a-z][A-Za-z0-9-]*$/.test(j.id))) errors.push(`${where}.id must start with a lower-case letter and contain only letters, digits and hyphens`);
          else if (seen.has(j.id)) errors.push(`${where}.id ${JSON.stringify(j.id)} is a duplicate`);
          else seen.add(j.id);
        }
        if (Object.hasOwn(j, 'entry') && !(text(j.entry) && j.entry.startsWith('/') && !j.entry.startsWith('//') && !/\s/.test(j.entry))) {
          errors.push(`${where}.entry must be an app path starting with / (not a URL)`);
        }
        if (Object.hasOwn(j, 'setup') && !text(j.setup)) errors.push(`${where}.setup must be a non-empty single-line string`);
        if (Object.hasOwn(j, 'actions')) strings(j.actions, `${where}.actions`, errors, { min: 1 });
        if (Object.hasOwn(j, 'expected')) strings(j.expected, `${where}.expected`, errors, { min: 1 });
        if (Object.hasOwn(j, 'knownExclusions')) strings(j.knownExclusions, `${where}.knownExclusions`, errors, { min: 0 });
      });
    }
  }
  return errors;
}

/** Read and validate, or throw with every problem listed. */
export function loadManifest(file) {
  let m;
  try { m = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('the manifest is missing or is not JSON'); }
  const errors = validateManifest(m);
  if (errors.length) throw new Error(errors.join('\n'));
  return m;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const file = process.argv[2];
  if (!file) { console.error('usage: milestone-manifest.mjs <manifest.json>'); process.exit(1); }
  try {
    const m = loadManifest(file);
    console.log(`MANIFEST=valid ${m.milestone} (${m.journeys.length} journey${m.journeys.length === 1 ? '' : 's'})`);
  } catch (e) {
    for (const line of e.message.split('\n')) console.error(`::error::${line}`);
    console.error('MANIFEST=invalid');
    process.exit(1);
  }
}
