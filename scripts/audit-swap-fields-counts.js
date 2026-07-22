'use strict';

/**
 * audit-swap-fields-counts.js
 *
 * READ-ONLY audit: counts how many workouts + assignments need
 * swap-fields backfill (swapSides/swapMode/swapWindowSec missing from
 * block.movements[] entries for movements where library swapSides==true).
 *
 * Usage: node scripts/audit-swap-fields-counts.js
 */

const admin = require('../functions/node_modules/firebase-admin');
const serviceAccount = require('../.secrets/firebase-service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'goarrive',
});

const db = admin.firestore();

async function buildSwapMap() {
  console.log('[STATUS: fetching movements where swapSides==true]');
  const snap = await db.collection('movements').where('swapSides', '==', true).get();
  const map = {};
  snap.forEach(doc => {
    const d = doc.data();
    map[doc.id] = {
      swapSides: d.swapSides,
      swapMode: d.swapMode ?? 'split',
      swapWindowSec: d.swapWindowSec ?? 5,
    };
  });
  console.log(`  Found ${snap.size} movement(s) with swapSides==true`);
  return map;
}

function scanBlocks(blocks, swapMap) {
  let hasSwapMovement = false;
  let alreadyHasField = 0;
  let missingField = 0;

  if (!Array.isArray(blocks)) return { hasSwapMovement, alreadyHasField, missingField };

  for (const block of blocks) {
    const movements = block.movements || [];
    for (const m of movements) {
      if (!swapMap[m.movementId]) continue;
      hasSwapMovement = true;
      if (m.swapSides !== undefined && m.swapSides !== null) {
        alreadyHasField++;
      } else {
        missingField++;
      }
    }
  }
  return { hasSwapMovement, alreadyHasField, missingField };
}

async function auditWorkouts(swapMap) {
  console.log('[STATUS: scanning workouts collection]');
  const snap = await db.collection('workouts').get();
  let total = snap.size;
  let withSwapMovement = 0;
  let needingBackfill = 0;
  let alreadyHasField = 0;

  snap.forEach(doc => {
    const d = doc.data();
    const result = scanBlocks(d.blocks, swapMap);
    if (result.hasSwapMovement) {
      withSwapMovement++;
      if (result.missingField > 0) needingBackfill++;
      alreadyHasField += result.alreadyHasField;
    }
  });

  console.log(`  workouts scanned: ${total}`);
  console.log(`  workouts containing a swapSides==true movement: ${withSwapMovement}`);
  console.log(`    (a) block entries already have swapSides field: ${alreadyHasField}`);
  console.log(`    (b) workouts missing swapSides on >=1 block entry: ${needingBackfill}`);
  return { total, withSwapMovement, needingBackfill };
}

async function auditAssignments(swapMap) {
  console.log('[STATUS: scanning workout_assignments collection]');
  const snap = await db.collection('workout_assignments').get();
  let total = snap.size;
  let withSwapMovement = 0;
  let needingBackfill = 0;
  let alreadyHasField = 0;

  snap.forEach(doc => {
    const d = doc.data();
    const blocks = d.workoutSnapshot?.blocks || d.blocks;
    const result = scanBlocks(blocks, swapMap);
    if (result.hasSwapMovement) {
      withSwapMovement++;
      if (result.missingField > 0) needingBackfill++;
      alreadyHasField += result.alreadyHasField;
    }
  });

  console.log(`  assignments scanned: ${total}`);
  console.log(`  assignments containing a swapSides==true movement: ${withSwapMovement}`);
  console.log(`    (a) block entries already have swapSides field: ${alreadyHasField}`);
  console.log(`    (b) assignments missing swapSides on >=1 block entry: ${needingBackfill}`);
  return { total, withSwapMovement, needingBackfill };
}

async function main() {
  console.log('[STATUS: starting swap-fields count audit]');

  const swapMap = await buildSwapMap();
  const movementCount = Object.keys(swapMap).length;

  const workouts = await auditWorkouts(swapMap);
  const assignments = await auditAssignments(swapMap);

  console.log('\n========== SWAP-FIELDS AUDIT SUMMARY ==========');
  console.log(`Movements with swapSides==true (library):     ${movementCount}`);
  console.log(`Workouts needing backfill:                    ${workouts.needingBackfill} / ${workouts.withSwapMovement} w/ swap movement (${workouts.total} total)`);
  console.log(`Assignments needing backfill:                 ${assignments.needingBackfill} / ${assignments.withSwapMovement} w/ swap movement (${assignments.total} total)`);
  console.log('================================================\n');

  console.log(`[DONE: audit complete — ${movementCount} swap movements, ${workouts.needingBackfill} workouts need backfill, ${assignments.needingBackfill} assignments need backfill]`);
  process.exit(0);
}

main().catch(err => {
  console.error('[FAILED:', err.message, err.stack);
  process.exit(1);
});
