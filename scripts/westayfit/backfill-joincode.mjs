#!/usr/bin/env node
/**
 * Backfill `joinCode` on every `wsfCommunityGroups` document that does not yet
 * have one. E2 minted a fresh code on every new group starting at the salvage
 * commit, so this script only has to touch legacy rows.
 *
 * Deliberately does NOT change `joinPolicy` — no existing group becomes
 * public. Codes are still minted for private and inviteOnly groups so the
 * data shape is uniform; the join callables reject non-public codes with the
 * same generic not-found as an unknown one (see §3.3 oracle test), so a
 * populated code on a private group leaks nothing.
 *
 * Idempotent: rows that already carry a `joinCode` are left alone.
 *
 * DRY RUN by default. Pass --commit to actually write.
 *
 *   # Local emulator:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *     node scripts/westayfit/backfill-joincode.mjs --commit
 *
 *   # Prod (needs a Firebase Admin credential — SA key or gcloud ADC):
 *   GOOGLE_APPLICATION_CREDENTIALS=... \
 *     node scripts/westayfit/backfill-joincode.mjs --commit
 */

import { randomBytes } from 'node:crypto';

import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const COMMIT = process.argv.includes('--commit');
const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'goarrive';

/**
 * Match the callable's `mintJoinCode` byte-for-byte: 16 random bytes of
 * base64url. Two independent minters means a code space collision remains
 * astronomically unlikely.
 */
function mintJoinCode() {
  return randomBytes(16).toString('base64url');
}

function initAdmin() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    const { readFileSync } = require('node:fs');
    initializeApp({ credential: cert(JSON.parse(readFileSync(credPath, 'utf8'))), projectId: PROJECT_ID });
  } else {
    // Emulator mode or ADC. Admin SDK auto-detects FIRESTORE_EMULATOR_HOST.
    initializeApp({ projectId: PROJECT_ID });
  }
}

async function main() {
  initAdmin();
  const db = getFirestore();
  const snap = await db.collection('wsfCommunityGroups').get();

  let missing = 0;
  let alreadyCoded = 0;
  const updates = [];
  for (const doc of snap.docs) {
    if (typeof doc.get('joinCode') === 'string' && doc.get('joinCode').length >= 16) {
      alreadyCoded += 1;
      continue;
    }
    missing += 1;
    updates.push({ id: doc.id, code: mintJoinCode() });
  }

  console.log(`project: ${PROJECT_ID}`);
  console.log(`groups scanned: ${snap.size}`);
  console.log(`already coded: ${alreadyCoded}`);
  console.log(`missing joinCode: ${missing}`);

  if (!missing) {
    console.log('nothing to backfill.');
    return;
  }

  if (!COMMIT) {
    console.log('\n--- DRY RUN (pass --commit to write) ---');
    for (const u of updates) console.log(`would set wsfCommunityGroups/${u.id}.joinCode = ${u.code.slice(0, 6)}…`);
    return;
  }

  // Batched writes: 400 per batch, well under the 500 hard cap so the last
  // batch has room to grow if a `updatedAt` clock write is added later.
  const BATCH = 400;
  for (let i = 0; i < updates.length; i += BATCH) {
    const slice = updates.slice(i, i + BATCH);
    const batch = db.batch();
    for (const u of slice) {
      batch.update(db.collection('wsfCommunityGroups').doc(u.id), { joinCode: u.code });
    }
    await batch.commit();
    console.log(`committed ${Math.min(i + BATCH, updates.length)}/${updates.length}`);
  }
  console.log('backfill done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
