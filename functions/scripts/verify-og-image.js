// Local verification for the workout OG image composer.
// Reads a real workout doc (read-only), composes the 1200x1800 image locally,
// and writes it to /tmp for visual inspection. No Storage upload, no writes.
//
// Usage:
//   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase-service-account.json
//   node functions/scripts/verify-og-image.js [workoutId]
//
// Run `npm run build` in functions/ first (uses compiled lib/ogImage.js).

const admin = require('firebase-admin');
const fs = require('fs');
const { composeWorkoutOgImage, collectOgGroups } = require('../lib/ogImage');

admin.initializeApp();

async function pickWorkout(db, workoutId) {
  if (workoutId) {
    const snap = await db.collection('workouts').doc(workoutId).get();
    if (!snap.exists) throw new Error(`Workout ${workoutId} not found`);
    return { id: snap.id, data: snap.data() };
  }
  const snap = await db.collection('workouts').orderBy('updatedAt', 'desc').limit(25).get();
  for (const doc of snap.docs) {
    const data = doc.data();
    const { groups, movementCount } = collectOgGroups(data);
    const hasThumbs = groups.some((g) => g.tiles.some((t) => t.imageUrl));
    if (movementCount >= 3 && hasThumbs) return { id: doc.id, data };
  }
  throw new Error('No suitable workout found in the 25 most recent');
}

(async () => {
  const db = admin.firestore();
  const { id, data } = await pickWorkout(db, process.argv[2]);
  const { groups, movementCount } = collectOgGroups(data);
  console.log(`Workout: ${id} — "${data.name}"`);
  console.log(`Groups: ${groups.map((g) => `${g.label}(${g.tiles.length} tiles)`).join(', ')}`);
  console.log(`Movement count: ${movementCount}`);

  const jpeg = await composeWorkoutOgImage(data);
  const out = `/tmp/og-sample-v3-${id}.jpg`;
  fs.writeFileSync(out, jpeg);
  console.log(`Wrote ${out} (${jpeg.length} bytes)`);
  process.exit(0);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
