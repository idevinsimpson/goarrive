#!/usr/bin/env node
// One-time migration: create 256px thumb.png for every existing
// equipment_images/{slug}/default.png that lacks one.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=.secrets/firebase-service-account.json \
//     node scripts/migrate-equipment-thumbs.js          # dry run
//     node scripts/migrate-equipment-thumbs.js --live   # apply

const admin = require('../functions/node_modules/firebase-admin');
const sharp = require('../functions/node_modules/sharp');

const LIVE = process.argv.includes('--live');

admin.initializeApp({ storageBucket: 'goarrive.firebasestorage.app' });
const bucket = admin.storage().bucket();

async function main() {
  console.log(`=== equipment thumbs migration (${LIVE ? 'LIVE' : 'DRY RUN'}) ===`);
  const [files] = await bucket.getFiles({ prefix: 'equipment_images/' });
  const names = new Set(files.map(f => f.name));
  const defaults = [...names].filter(n => n.endsWith('/default.png'));
  let created = 0, skipped = 0;
  for (const name of defaults.sort()) {
    const thumbName = name.replace(/default\.png$/, 'thumb.png');
    if (names.has(thumbName)) { skipped++; continue; }
    console.log(`THUMB ${thumbName}`);
    if (LIVE) {
      const [buf] = await bucket.file(name).download();
      const thumbBuf = await sharp(buf).resize(256, 256, { fit: 'inside' }).png().toBuffer();
      await bucket.file(thumbName).save(thumbBuf, { contentType: 'image/png' });
    }
    created++;
  }
  console.log(`=== done (${LIVE ? 'LIVE' : 'DRY RUN'}): ${defaults.length} defaults, ${created} thumbs ${LIVE ? 'created' : 'to create'}, ${skipped} already existed ===`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
