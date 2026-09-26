#!/usr/bin/env node
/**
 * Scan retained evidence for credential-shaped content WITHOUT disclosing it.
 *
 * The obvious implementation is `grep -R -nE '<secret patterns>' evidence/`,
 * and it is exactly wrong: grep's job is to print the matching line, so a
 * scanner that finds a leaked token publishes it into the workflow log — a log
 * that, on a public repository, is world-readable. The scan is supposed to
 * prevent disclosure, not perform it.
 *
 * So findings here are redacted by construction. A finding reports the file,
 * the line number and the rule that matched. The matched text is never read
 * into the output, never interpolated into a message, and never thrown.
 *
 * Failing closed is the other half. An unreadable file, a decode error or a
 * scanner exception must fail the run: "I could not look" and "I looked and
 * found nothing" are different facts, and only one of them clears an upload.
 *
 * Exit 0 = scanned everything, no findings, safe to upload.
 * Exit 1 = findings, or the scan could not complete.
 */
import fs from 'node:fs';
import path from 'node:path';

const RULES = [
  { name: 'google-api-key', re: /AIza[0-9A-Za-z_-]{20,}/ },
  { name: 'private-key-block', re: /BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY/ },
  // \\?" so an escaped copy embedded inside another JSON document still
  // matches: a captured response body is stored exactly that way.
  { name: 'service-account-json', re: /\\?"private_key(?:_id)?\\?"\s*:/ },
  { name: 'google-oauth-access-token', re: /\bya29\.[0-9A-Za-z_-]{10,}/ },
  { name: 'google-oauth-refresh-token', re: /\b1\/\/[0-9A-Za-z_-]{20,}/ },
  { name: 'gha-credentials-file', re: /gha-creds-[0-9a-f]+\.json/ },
  { name: 'email-action-link', re: /[?&](?:oobCode|token|idToken|refreshToken)=[^&\s"']+/ },
  { name: 'firebase-custom-token', re: /\beyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}/ },
  { name: 'bearer-header', re: /authorization"?\s*[:=]\s*"?Bearer\s+\S+/i },
  // Browser Use Cloud API keys (`bu_…`). Environment-variable references or placeholders do not match.
  { name: 'browser-use-api-key', re: /\bbu_[A-Za-z0-9_-]{20,}/ },
];

const TEXTLIKE = new Set(['.json', '.txt', '.log', '.md', '.html', '.htm', '.xml', '.csv', '.yml', '.yaml', '.har', '.zip.txt']);
const BINARYLIKE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf', '.zip', '.webm', '.mp4']);

const root = process.argv[2];
if (!root) {
  console.error('usage: scan-evidence.mjs <evidence-dir>');
  process.exit(1);
}

const findings = [];
const errors = [];
const unscannable = [];
let filesScanned = 0;
let bytesScanned = 0;

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    // Cannot enumerate: that is a scan failure, not an empty directory.
    errors.push(`unreadable directory ${path.relative(root, dir) || '.'}: ${e.code || 'error'}`);
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!entry.isFile()) continue;
    scanFile(full);
  }
}

function scanFile(full) {
  const rel = path.relative(root, full);
  const ext = path.extname(full).toLowerCase();
  let buf;
  try {
    buf = fs.readFileSync(full);
  } catch (e) {
    errors.push(`unreadable file ${rel}: ${e.code || 'error'}`);
    return;
  }
  filesScanned += 1;
  bytesScanned += buf.length;

  // A binary artifact is not proof of safety — a screenshot can show a token on
  // screen and a trace can embed request headers. Pattern scanning cannot read
  // either, so these are reported as UNSCANNABLE rather than passed.
  if (BINARYLIKE.has(ext)) {
    unscannable.push(rel);
    return;
  }
  if (ext && !TEXTLIKE.has(ext)) {
    unscannable.push(rel);
    return;
  }

  let text;
  try {
    text = buf.toString('utf8');
  } catch (e) {
    errors.push(`undecodable file ${rel}`);
    return;
  }
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    for (const rule of RULES) {
      if (rule.re.test(lines[i])) {
        // file + line + rule name only. The matched text is deliberately
        // never captured, stored or printed.
        findings.push({ file: rel, line: i + 1, rule: rule.name });
      }
    }
  }
}

let stat;
try {
  stat = fs.statSync(root);
} catch (e) {
  console.error(`EVIDENCE_SCAN=error (evidence directory not readable: ${e.code || 'error'})`);
  process.exit(1);
}
if (!stat.isDirectory()) {
  console.error('EVIDENCE_SCAN=error (evidence path is not a directory)');
  process.exit(1);
}

try {
  walk(root);
} catch (e) {
  // Any unexpected scanner fault fails the run rather than reporting clean.
  console.error(`EVIDENCE_SCAN=error (scanner fault: ${e.code || e.name || 'error'})`);
  process.exit(1);
}

console.log(`EVIDENCE_SCAN_FILES=${filesScanned}`);
console.log(`EVIDENCE_SCAN_BYTES=${bytesScanned}`);
for (const rel of unscannable) console.log(`EVIDENCE_UNSCANNABLE=${rel}`);

if (errors.length) {
  for (const e of errors) console.error(`::error::evidence scan could not complete: ${e}`);
  console.error('EVIDENCE_SCAN=error');
  process.exit(1);
}
if (findings.length) {
  for (const f of findings) {
    console.error(`::error file=${f.file},line=${f.line}::credential-shaped content matched rule ${f.rule} (value withheld)`);
  }
  console.error(`EVIDENCE_SCAN=findings (${findings.length})`);
  process.exit(1);
}
if (filesScanned === 0) {
  console.error('EVIDENCE_SCAN=error (no files scanned — evidence is unexpectedly empty)');
  process.exit(1);
}
console.log('EVIDENCE_SCAN=clean');
