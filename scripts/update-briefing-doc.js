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
 *     --activity-entry "Deployed /share/[shareId] timing fix."
 *
 * All flags are optional — omit any you don't want to update.
 * The script only overwrites the cells you explicitly pass.
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

// ── Doc structure (character indices — stable as long as doc structure doesn't change) ──
// These were mapped by Manus on 2026-05-06. If the doc is restructured, re-run the
// parse_doc.py script in Manus's sandbox to get updated indices.
const INDICES = {
  // Section 1 — staging URL value cell
  stagingUrl: { start: 183, end: 225 },          // "https://goarrive--staging-gurfzjak.web.app\n"

  // Section 2 table cells (value cells only)
  date:               { start: 332, end: 342 },  // "2026-05-05"
  commit:             { start: 352, end: 368 },  // "(Maia fills in)"
  branchPr:           { start: 383, end: 399 },  // "(Maia fills in)"
  deployClass:        { start: 415, end: 466 },  // "Hosting only / Functions / ..."
  productionAffecting:{ start: 490, end: 499 },  // "yes / no"
  stagingUrlConfirmed:{ start: 524, end: 533 },  // "yes / no"
  // credentialsUsed is always Devin — don't overwrite

  // Section 2 free-text paragraphs
  whatChanged:        { start: 591, end: 717 },  // placeholder paragraph
  whatToFocusOn:      { start: 735, end: 843 },  // placeholder paragraph
  whatNotToRetest:    { start: 864, end: 955 },  // placeholder paragraph
  knownGaps:          { start: 983, end: 1084 }, // placeholder paragraph

  // Section 3 table cells
  slackThread:        { start: 1155, end: 1209 }, // "(Maia pastes the Slack link...)"
  keyMessages:        { start: 1235, end: 1401 }, // placeholder paragraph

  // Section 4 activity log — prepend a new row before the existing data row
  // The table starts at 1606; header row ends at 1638; first data row starts at 1639.
  // We insert a new row by inserting text at the start of the first data row.
  activityLogTableStart: 1606,
  activityLogFirstDataRowStart: 1639,
};

// ── Build batchUpdate requests ───────────────────────────────────────────────
function makeReplaceRequest(start, end, newText) {
  // Delete existing content in the range, then insert new text at start.
  // We do delete-then-insert so the indices stay predictable.
  return [
    {
      deleteContentRange: {
        range: { startIndex: start, endIndex: end },
      },
    },
    {
      insertText: {
        location: { index: start },
        text: newText,
      },
    },
  ];
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

  // We must apply requests in reverse index order so earlier deletions don't
  // shift the indices of later operations. Collect all requests first, then sort.
  const requests = [];

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  if (args['staging-url']) {
    requests.push(...makeReplaceRequest(
      INDICES.stagingUrl.start,
      INDICES.stagingUrl.end,
      args['staging-url'] + '\n'
    ));
  }

  if (args['commit']) {
    requests.push(...makeReplaceRequest(
      INDICES.commit.start,
      INDICES.commit.end,
      args['commit'] + '\n'
    ));
  }

  if (args['branch']) {
    requests.push(...makeReplaceRequest(
      INDICES.branchPr.start,
      INDICES.branchPr.end,
      args['branch'] + '\n'
    ));
  }

  if (args['deploy-class']) {
    requests.push(...makeReplaceRequest(
      INDICES.deployClass.start,
      INDICES.deployClass.end,
      args['deploy-class'] + '\n'
    ));
  }

  if (args['production-affecting']) {
    requests.push(...makeReplaceRequest(
      INDICES.productionAffecting.start,
      INDICES.productionAffecting.end,
      args['production-affecting'] + '\n'
    ));
    requests.push(...makeReplaceRequest(
      INDICES.stagingUrlConfirmed.start,
      INDICES.stagingUrlConfirmed.end,
      'yes\n'
    ));
    // Update date too
    requests.push(...makeReplaceRequest(
      INDICES.date.start,
      INDICES.date.end,
      today + '\n'
    ));
  }

  if (args['what-changed']) {
    requests.push(...makeReplaceRequest(
      INDICES.whatChanged.start,
      INDICES.whatChanged.end,
      args['what-changed'] + '\n'
    ));
  }

  if (args['what-to-focus-on']) {
    requests.push(...makeReplaceRequest(
      INDICES.whatToFocusOn.start,
      INDICES.whatToFocusOn.end,
      args['what-to-focus-on'] + '\n'
    ));
  }

  if (args['what-not-to-retest']) {
    requests.push(...makeReplaceRequest(
      INDICES.whatNotToRetest.start,
      INDICES.whatNotToRetest.end,
      args['what-not-to-retest'] + '\n'
    ));
  }

  if (args['known-gaps']) {
    requests.push(...makeReplaceRequest(
      INDICES.knownGaps.start,
      INDICES.knownGaps.end,
      args['known-gaps'] + '\n'
    ));
  }

  if (args['slack-thread']) {
    requests.push(...makeReplaceRequest(
      INDICES.slackThread.start,
      INDICES.slackThread.end,
      args['slack-thread'] + '\n'
    ));
  }

  if (args['key-messages']) {
    requests.push(...makeReplaceRequest(
      INDICES.keyMessages.start,
      INDICES.keyMessages.end,
      args['key-messages'] + '\n'
    ));
  }

  // Activity log: prepend a new row. We insert text at the start of the first
  // data row. Format: "DATE | Maia | ENTRY | COMMIT\n"
  if (args['activity-entry']) {
    const commit = args['commit'] ?? '(hash)';
    const entry = `${today}\tMaia\t${args['activity-entry']}\t${commit}\n`;
    requests.push({
      insertText: {
        location: { index: INDICES.activityLogFirstDataRowStart },
        text: entry,
      },
    });
  }

  if (requests.length === 0) {
    console.log('No valid flags matched. Nothing to update.');
    process.exit(0);
  }

  // Sort requests by descending index so earlier operations don't shift later ones.
  // Each pair is [deleteContentRange, insertText] — we need to keep pairs together
  // and sort pairs by their delete startIndex descending.
  const pairs = [];
  for (let i = 0; i < requests.length; i += 2) {
    if (requests[i + 1]) {
      pairs.push([requests[i], requests[i + 1]]);
    } else {
      pairs.push([requests[i]]);
    }
  }
  pairs.sort((a, b) => {
    const aIdx = a[0].deleteContentRange?.range?.startIndex ?? a[0].insertText?.location?.index ?? 0;
    const bIdx = b[0].deleteContentRange?.range?.startIndex ?? b[0].insertText?.location?.index ?? 0;
    return bIdx - aIdx; // descending
  });
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
