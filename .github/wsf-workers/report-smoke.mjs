#!/usr/bin/env node
/** Read only safe summary fields. Never publish transcripts/tool output. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function summarize(text, expected) {
  let records;
  try { const j = JSON.parse(text); records = Array.isArray(j) ? j : [j]; }
  catch { records = text.trim().split('\n').map((line) => JSON.parse(line)); }
  const result = records.filter((x) => x?.type === 'result').at(-1);
  if (!result || result.is_error === true || result.subtype !== 'success') throw new Error('No successful runtime result.');
  if (String(result.result).trim() !== 'WSF_PROFILE_SMOKE_OK') throw new Error('Smoke response does not match.');
  const models = Object.keys(result.modelUsage ?? {});
  if (!models.length || models.some((m) => !/^claude-(sonnet|opus)-[A-Za-z0-9-]+$/.test(m))) throw new Error('Observed model is unavailable or unrecognized.');
  if (models.some((m) => m !== expected && !m.startsWith(expected + '-'))) throw new Error('Observed model differs from the requested pin.');
  return { observedModels: models, modelMatch: true,
    effortEvidence: 'configured at launch; not attested by modelUsage',
    ultracodeEvidence: 'configured at launch; not attested by modelUsage' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const r = summarize(fs.readFileSync(process.argv[2], 'utf8'), process.argv[3]);
    const safe = JSON.stringify(r, null, 2);
    console.log(safe);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\nRuntime smoke (not a worker cutover):\n\n\`\`\`json\n${safe}\n\`\`\`\n`);
  } catch { console.error('WSF_SMOKE_UNVERIFIED: inspect the private runtime result; no transcript emitted.'); process.exitCode = 1; }
}
