'use strict';

/**
 * backfill-swap-fields.js
 *
 * One-time backfill: stamps swapSides/swapMode/swapWindowSec into
 * block.movements[] entries for any workout or assignment doc where the
 * library movement has swapSides==true but the block entry is missing it.
 *
 * Usage (dry run — default, no writes):
 *   node scripts/backfill-swap-fields.js
 *
 * Usage (apply writes):
 *   node scripts/backfill-swap-fields.js --apply
 *
 * Staging dry run first:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 node scripts/backfill-swap-fields.js
 *
 * Run order (per Devin's approval gate):
 *   1. node scripts/backfill-swap-fields.js               # staging dry-run
 *   2. node scripts/backfill-swap-fields.js --apply       # staging apply  [gate: Devin approves]
 *   3. node scripts/backfill-swap-fields.js               # prod dry-run   [gate: Devin approves]
 *   4. node scripts/backfill-swap-fields.js --apply       # prod apply     [gate: Devin approves]
 */

const admin = require('../functions/node_modules/firebase-admin');
const serviceAccount = require('../.secrets/firebase-service-account.json');

const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = 100;

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
      swapSides: true,
      swapMode: d.swapMode ?? 'split',
      swapWindowSec: d.swapWindowSec ?? 5,
    };
  });
  console.log(`  ${snap.size} movement(s) with swapSides==true loaded`);
  return map;
}

function patchBlocks(blocks, swapMap) {
  if (!Array.isArray(blocks)) return { changed: false, blocks, patchCount: 0 };
  let changed = false;
  let patchCount = 0;

  for (const block of blocks) {
    const movements = block.movements;
    if (!Array.isArray(movements)) continue;
    for (const m of movements) {
      const lib = swapMap[m.movementId];
      if (!lib) continue;
      if (m.swapSides !== undefined && m.swapSides !== null) continue;
      m.swapSides = lib.swapSides;
      m.swapMode = m.swapMode ?? lib.swapMode;
      m.swapWindowSec = m.swapWindowSec ?? lib.swapWindowSec;
      changed = true;
      patchCount++;
    }
  }
  return { changed, blocks, patchCount };
}

async function processCollection(collectionName, blocksPath, swapMap, counters) {
  console.log(`\n[STATUS: scanning ${collectionName}]`);
  const snap = await db.collection(collectionName).get();
  counters.scanned += snap.size;

  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    const d = doc.data();
    const rawBlocks = blocksPath === 'workoutSnapshot.blocks'
      ? (d.workoutSnapshot?.blocks ?? d.blocks)
      : d.blocks;

    if (!Array.isArray(rawBlocks)) continue;

    const { changed, blocks, patchCount } = patchBlocks(rawBlocks, swapMap);
    if (!changed) continue;

    counters.patched++;
    counters.movementsTouched += patchCount;

    if (APPLY) {
      const updateField = blocksPath === 'workoutSnapshot.blocks'
        ? { 'workoutSnapshot.blocks': blocks }
        : { blocks };
      batch.update(doc.ref, updateField);
      batchCount++;
      console.log(`  [APPLY] ${collectionName}/${doc.id} — patching ${patchCount} movement entry(ies)`);
    } else {
      console.log(`  [DRY-RUN] ${collectionName}/${doc.id} — would patch ${patchCount} movement entry(ies)`);
    }

    if (batchCount >= BATCH_SIZE) {
      await batch.commit();
      console.log(`  [APPLY] committed batch of ${batchCount}`);
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (APPLY && batchCount > 0) {
    await batch.commit();
    console.log(`  [APPLY] committed final batch of ${batchCount}`);
  }
}

async function main() {
  const mode = APPLY ? 'APPLY (WRITES ENABLED)' : 'DRY-RUN (read-only)';
  console.log(`\n========== backfill-swap-fields — ${mode} ==========\n`);

  const swapMap = await buildSwapMap();

  const counters = {
    workoutsScanned: 0,
    workoutsPatched: 0,
    assignmentsScanned: 0,
    assignmentsPatched: 0,
    movementsTouched: 0,
  };

  const workoutCounters = { scanned: 0, patched: 0, movementsTouched: 0 };
  await processCollection('workouts', 'blocks', swapMap, workoutCounters);
  counters.workoutsScanned = workoutCounters.scanned;
  counters.workoutsPatched = workoutCounters.patched;
  counters.movementsTouched += workoutCounters.movementsTouched;

  const assignmentCounters = { scanned: 0, patched: 0, movementsTouched: 0 };
  await processCollection('workout_assignments', 'workoutSnapshot.blocks', swapMap, assignmentCounters);
  counters.assignmentsScanned = assignmentCounters.scanned;
  counters.assignmentsPatched = assignmentCounters.patched;
  counters.movementsTouched += assignmentCounters.movementsTouched;

  console.log('\n========== BACKFILL SUMMARY ==========');
  console.log(`Mode:                  ${mode}`);
  console.log(`Workouts scanned:      ${counters.workoutsScanned}`);
  console.log(`Workouts patched:      ${counters.workoutsPatched}`);
  console.log(`Assignments scanned:   ${counters.assignmentsScanned}`);
  console.log(`Assignments patched:   ${counters.assignmentsPatched}`);
  console.log(`Movement entries touched: ${counters.movementsTouched}`);
  console.log('=======================================\n');

  if (!APPLY) {
    console.log('Run with --apply to perform writes.');
  }

  console.log(`[DONE: backfill-swap-fields ${mode} — ${counters.workoutsPatched} workouts + ${counters.assignmentsPatched} assignments would be patched]`);
  process.exit(0);
}

main().catch(err => {
  console.error('[FAILED:', err.message, err.stack);
  process.exit(1);
});
