#!/usr/bin/env node
/**
 * update-briefing-doc.js
 *
 * Updates the GoArrive Manus Smoke Test Briefing doc (Google Doc) from the terminal.
 * Maia runs this after every staging deploy to fill in Sections 1–4 before triggering
 * the Relay smoke test.
 *
 * Auth: Uses the Firebase Admin SDK service account key at .secrets/firebase-service-account.json
 *       The service account (firebase-adminsdk-fbsvc@goarrive.iam.gserviceaccount.com) has
 *       been granted writer access to the doc by Manus/Devin.
 *
 * Field locations are resolved at runtime by heading text and table row labels,
 * so document growth/edits don't break the script (hardcoded character indices
 * from the 2026-05-06 mapping went stale and caused deleteContentRange errors).
 *
 * Usage:
 *   node scripts/update-briefing-doc.js \
 *     --staging-url "https://goarrive--staging-SUFFIX.web.app" \
 *     --commit "abc1234" \
 *     --branch "feat/my-feature" \
 *     --deploy-class "Hosting only" \
 *     --production-affecting "no" \
 *     --what-changed "Fixed X by doing Y. Files touched: Z." \
 *     --what-to-focus-on "Navigate to /route, do X, expect Y." \
 *     --what-not-to-retest "Billing, auth flows." \
 *     --known-gaps "Share link UI trigger not yet wired." \
 *     --slack-thread "https://goarriveworkspace.slack.com/archives/..." \
 *     --key-messages "Summary of the key Slack messages." \
 *     --activity-entry "Deployed /share/[shareId] timing fix."
 *
 * All flags are optional — omit any you don't want to update.
 * The script only overwrites the fields you explicitly pass.
 */

'use strict';

const fs = require('fs');
const path = require('path');
// googleapis lives in functions/node_modules — resolve from there
const { google } = require(require.resolve('googleapis', { paths: [path.resolve(__dirname, '../functions')] }));

const DOC_ID = '1kJtMI7eZUDY84_VHPgvdV2wG89F9cExP7CODJEuSLYI';
const SA_KEY_PATH = path.resolve(__dirname, '../.secrets/firebase-service-account.json');
const DOCS_SCOPE = 'https://www.googleapis.com/auth/documents';

// ── Arg parsing ──────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      result[key] = args[i + 1] ?? '';
      i++;
    }
  }
  return result;
}

// ── Auth ─────────────────────────────────────────────────────────────────────
async function getDocsClient() {
  if (!fs.existsSync(SA_KEY_PATH)) {
    throw new Error(
      `Service account key not found at ${SA_KEY_PATH}.\n` +
      `Ask Devin or Manus to regenerate it from Firebase Console → Project Settings → Service Accounts.`
    );
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: SA_KEY_PATH,
    scopes: [DOCS_SCOPE],
  });
  const authClient = await auth.getClient();
  return google.docs({ version: 'v1', auth: authClient });
}

// ── Structure resolution ─────────────────────────────────────────────────────
function paraText(el) {
  let t = '';
  for (const e of el.paragraph?.elements || []) t += e.textRun?.content || '';
  return t;
}

function cellText(cell) {
  let t = '';
  for (const c of cell.content || []) {
    if (c.paragraph) t += paraText(c);
  }
  return t;
}

function isHeading(el) {
  const style = el.paragraph?.paragraphStyle?.namedStyleType || '';
  return style.startsWith('HEADING') || style === 'TITLE';
}

function findHeadingIdx(content, headingText) {
  const want = headingText.trim().toLowerCase();
  for (let i = 0; i < content.length; i++) {
    const el = content[i];
    if (el.paragraph && isHeading(el) && paraText(el).trim().toLowerCase() === want) {
      return i;
    }
  }
  throw new Error(`Heading not found in doc: "${headingText}"`);
}

// Range of the free-text body under a heading: all paragraphs after the heading
// up to the next heading or table, trimmed of trailing blank paragraphs.
// Range excludes the last paragraph's terminal newline (the API rejects
// deleting a segment's final newline).
function sectionBodyRange(content, headingText) {
  const hIdx = findHeadingIdx(content, headingText);
  let first = null;
  let lastNonEmpty = null;
  for (let i = hIdx + 1; i < content.length; i++) {
    const el = content[i];
    if (el.table || (el.paragraph && isHeading(el))) break;
    if (!el.paragraph) break;
    if (first === null) first = el;
    if (paraText(el).trim() !== '') lastNonEmpty = el;
  }
  if (!first || !lastNonEmpty) {
    throw new Error(`No body paragraphs found under heading "${headingText}"`);
  }
  return { start: first.startIndex, end: lastNonEmpty.endIndex - 1 };
}

// First insertion point under a heading (start of first body paragraph).
function sectionBodyStart(content, headingText) {
  const hIdx = findHeadingIdx(content, headingText);
  const el = content[hIdx + 1];
  if (!el?.paragraph) throw new Error(`No paragraph after heading "${headingText}"`);
  return el.startIndex;
}

// First table after a heading.
function tableAfterHeading(content, headingText) {
  const hIdx = findHeadingIdx(content, headingText);
  for (let i = hIdx + 1; i < content.length; i++) {
    if (content[i].table) return content[i];
    if (content[i].paragraph && isHeading(content[i])) break;
  }
  throw new Error(`No table found under heading "${headingText}"`);
}

// Value-cell (column 1) text range for the row whose label cell (column 0)
// matches `label`. Excludes the cell's terminal newline.
function cellValueRange(tableEl, label) {
  const want = label.trim().toLowerCase();
  for (const row of tableEl.table.tableRows) {
    const cells = row.tableCells || [];
    if (cells.length < 2) continue;
    if (cellText(cells[0]).trim().toLowerCase() === want) {
      const paras = cells[1].content.filter((c) => c.paragraph);
      if (!paras.length) throw new Error(`Value cell for "${label}" has no paragraphs`);
      return { start: paras[0].startIndex, end: paras[paras.length - 1].endIndex - 1 };
    }
  }
  throw new Error(`Table row not found: "${label}"`);
}

// ── Build batchUpdate requests ───────────────────────────────────────────────
function makeReplaceRequest(range, newText) {
  const reqs = [];
  if (range.end > range.start) {
    reqs.push({ deleteContentRange: { range: { startIndex: range.start, endIndex: range.end } } });
  }
  reqs.push({ insertText: { location: { index: range.start }, text: newText } });
  return reqs;
}

function requestIndex(pair) {
  const r = pair[0];
  return r.deleteContentRange?.range?.startIndex ?? r.insertText?.location?.index ?? 0;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();

  if (Object.keys(args).length === 0) {
    console.log('No arguments provided. Nothing to update.');
    console.log('Run with --help to see usage.');
    process.exit(0);
  }

  if ('help' in args) {
    console.log(`
Usage: node scripts/update-briefing-doc.js [flags]

Flags (all optional — only provided flags are updated):
  --staging-url         Full staging URL including suffix
  --commit              Git commit hash (short or full)
  --branch              Branch / PR name
  --deploy-class        "Hosting only" | "Functions" | "Firestore rules" | "mixed"
  --production-affecting "yes" or "no"
  --what-changed        2–5 sentence description of what was shipped
  --what-to-focus-on    Exact test steps for Manus (route, action, expected outcome)
  --what-not-to-retest  Stable routes to skip
  --known-gaps          Anything that can't be tested yet and why
  --slack-thread        Full Slack thread permalink URL
  --key-messages        Summary of 3–5 key Slack messages
  --activity-entry      One-line entry for Section 4 activity log (prepended)
`);
    process.exit(0);
  }

  console.log('🔐 Authenticating with service account...');
  const docs = await getDocsClient();

  console.log('📖 Reading current doc structure...');
  const doc = await docs.documents.get({ documentId: DOC_ID });
  const content = doc.data.body.content;

  const deploySummaryTable = tableAfterHeading(content, '2. Latest Deploy Summary');
  const slackContextTable = tableAfterHeading(content, '3. Slack Thread Context');

  const pairs = [];
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  if (args['staging-url']) {
    pairs.push(makeReplaceRequest(sectionBodyRange(content, '1. Current Staging URL'), args['staging-url']));
  }
  if (args['commit']) {
    pairs.push(makeReplaceRequest(cellValueRange(deploySummaryTable, 'Commit'), args['commit']));
  }
  if (args['branch']) {
    pairs.push(makeReplaceRequest(cellValueRange(deploySummaryTable, 'Branch / PR'), args['branch']));
  }
  if (args['deploy-class']) {
    pairs.push(makeReplaceRequest(cellValueRange(deploySummaryTable, 'Deploy class'), args['deploy-class']));
  }
  if (args['production-affecting']) {
    pairs.push(makeReplaceRequest(cellValueRange(deploySummaryTable, 'Production-affecting'), args['production-affecting']));
    pairs.push(makeReplaceRequest(cellValueRange(deploySummaryTable, 'Staging URL confirmed'), 'yes'));
    pairs.push(makeReplaceRequest(cellValueRange(deploySummaryTable, 'Date'), today));
  }
  if (args['what-changed']) {
    pairs.push(makeReplaceRequest(sectionBodyRange(content, 'What changed'), args['what-changed']));
  }
  if (args['what-to-focus-on']) {
    pairs.push(makeReplaceRequest(sectionBodyRange(content, 'What to focus on'), args['what-to-focus-on']));
  }
  if (args['what-not-to-retest']) {
    pairs.push(makeReplaceRequest(sectionBodyRange(content, 'What NOT to re-test'), args['what-not-to-retest']));
  }
  if (args['known-gaps']) {
    pairs.push(makeReplaceRequest(sectionBodyRange(content, 'Known gaps / blocked flows'), args['known-gaps']));
  }
  if (args['slack-thread']) {
    pairs.push(makeReplaceRequest(cellValueRange(slackContextTable, 'Thread permalink'), args['slack-thread']));
  }
  if (args['key-messages']) {
    pairs.push(makeReplaceRequest(sectionBodyRange(content, 'Key messages (summary)'), args['key-messages']));
  }

  // Activity log: prepend a new line at the top of Section 4's body.
  if (args['activity-entry']) {
    const commit = args['commit'] ? ` (commit ${args['commit']})` : '';
    const entry = `${today} — ${args['activity-entry']}${commit}\n`;
    const insertAt = sectionBodyStart(content, '4. Recent Activity Log');
    pairs.push([{ insertText: { location: { index: insertAt }, text: entry } }]);
  }

  if (pairs.length === 0) {
    console.log('No valid flags matched. Nothing to update.');
    process.exit(0);
  }

  // Apply in descending index order so earlier edits don't shift later ranges.
  pairs.sort((a, b) => requestIndex(b) - requestIndex(a));
  const sortedRequests = pairs.flat();

  console.log(`📝 Sending ${sortedRequests.length} update request(s) to Google Docs API...`);

  await docs.documents.batchUpdate({
    documentId: DOC_ID,
    requestBody: { requests: sortedRequests },
  });

  console.log('✅ Briefing doc updated successfully.');
  console.log(`   View: https://docs.google.com/document/d/${DOC_ID}/edit`);
}

main().catch((err) => {
  console.error('❌ Failed to update briefing doc:', err.message);
  process.exit(1);
});
