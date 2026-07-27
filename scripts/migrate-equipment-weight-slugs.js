#!/usr/bin/env node
// One-time migration: make the shared equipment image library weight-agnostic.
//
// For every equipment_images/{slug} folder, compute the weight-stripped slug.
// If it differs: copy default.png (+ thumb.png) to the new slug folder
// (collision: keep whichever new-slug folder already has a default.png, else
// first old folder wins), rewrite ALL references (workouts blocks
// grabEquipmentImageUrl + equipmentInputHistory imageUrl), then delete the
// old-slug folders.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=.secrets/firebase-service-account.json \
//     node scripts/migrate-equipment-weight-slugs.js          # dry run
//     node scripts/migrate-equipment-weight-slugs.js --live   # apply

const admin = require('../functions/node_modules/firebase-admin');

const LIVE = process.argv.includes('--live');

const WEIGHT_UNIT_RE = /^(?:\d+(?:\.\d+)?|lb|lbs|pound|pounds|kg|kgs|kilo|kilos|kilogram|kilograms)$/;
function stripWeightTokens(slug) {
  const tokens = slug.split('-').filter(t => t && !WEIGHT_UNIT_RE.test(t));
  const cleaned = tokens.filter((t, i) =>
    t !== 'and' || (i > 0 && i < tokens.length - 1 && tokens[i - 1] !== 'and'));
  const stripped = cleaned.join('-');
  return stripped || slug;
}

admin.initializeApp({ storageBucket: 'goarrive.firebasestorage.app' });
const bucket = admin.storage().bucket();
const db = admin.firestore();

function storageUrl(path) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media`;
}

async function main() {
  console.log(`=== equipment weight-slug migration (${LIVE ? 'LIVE' : 'DRY RUN'}) ===`);
  const [files] = await bucket.getFiles({ prefix: 'equipment_images/' });
  const filesBySlug = new Map();
  for (const f of files) {
    const rest = f.name.slice('equipment_images/'.length);
    const slug = rest.split('/')[0];
    if (!slug) continue;
    if (!filesBySlug.has(slug)) filesBySlug.set(slug, []);
    filesBySlug.get(slug).push(f.name);
  }
  console.log(`Found ${filesBySlug.size} slug folders`);

  // Plan merges. urlRewrites: oldDefaultUrl -> newDefaultUrl
  const urlRewrites = new Map();
  const foldersToDelete = [];
  const copies = []; // {src, dest}
  const newDefaultOwner = new Map(); // newSlug -> slug providing default.png

  // Pre-seed: new slugs that already exist unchanged with a default keep theirs.
  for (const [slug, names] of filesBySlug) {
    if (stripWeightTokens(slug) === slug && names.includes(`equipment_images/${slug}/default.png`)) {
      newDefaultOwner.set(slug, slug);
    }
  }

  for (const [slug, names] of [...filesBySlug.entries()].sort()) {
    const newSlug = stripWeightTokens(slug);
    if (newSlug === slug) continue;
    const hasDefault = names.includes(`equipment_images/${slug}/default.png`);
    console.log(`MERGE: ${slug} -> ${newSlug} (default.png: ${hasDefault})`);
    if (hasDefault) {
      if (!newDefaultOwner.has(newSlug)) {
        newDefaultOwner.set(newSlug, slug);
        copies.push({ src: `equipment_images/${slug}/default.png`, dest: `equipment_images/${newSlug}/default.png` });
        if (names.includes(`equipment_images/${slug}/thumb.png`)) {
          copies.push({ src: `equipment_images/${slug}/thumb.png`, dest: `equipment_images/${newSlug}/thumb.png` });
        }
      } else {
        console.log(`  collision: ${newSlug} default kept from ${newDefaultOwner.get(newSlug)}`);
      }
      urlRewrites.set(
        storageUrl(`equipment_images/${slug}/default.png`),
        storageUrl(`equipment_images/${newSlug}/default.png`),
      );
    }
    foldersToDelete.push(slug);
  }

  console.log(`Plan: ${copies.length} copies, ${urlRewrites.size} URL rewrites, ${foldersToDelete.length} folder deletions`);

  if (foldersToDelete.length === 0) {
    console.log('Nothing to migrate.');
    return;
  }

  // 1. Copies first
  for (const { src, dest } of copies) {
    console.log(`COPY ${src} -> ${dest}`);
    if (LIVE) await bucket.file(src).copy(bucket.file(dest));
  }

  // 2. Rewrite references BEFORE deleting anything
  let workoutsUpdated = 0, blocksRewritten = 0;
  const workoutsSnap = await db.collection('workouts').get();
  for (const wdoc of workoutsSnap.docs) {
    const blocks = wdoc.data().blocks;
    if (!Array.isArray(blocks)) continue;
    let changed = false;
    const newBlocks = blocks.map(b => {
      if (b && typeof b.grabEquipmentImageUrl === 'string' && urlRewrites.has(b.grabEquipmentImageUrl)) {
        changed = true;
        blocksRewritten++;
        return { ...b, grabEquipmentImageUrl: urlRewrites.get(b.grabEquipmentImageUrl) };
      }
      return b;
    });
    if (changed) {
      workoutsUpdated++;
      console.log(`WORKOUT ${wdoc.id}: rewriting block image URLs`);
      if (LIVE) await wdoc.ref.update({ blocks: newBlocks });
    }
  }
  console.log(`Workouts: ${workoutsUpdated} docs, ${blocksRewritten} blocks rewritten`);

  let historyUpdated = 0;
  const histSnap = await db.collection('equipmentInputHistory').get();
  for (const hdoc of histSnap.docs) {
    const imageUrl = hdoc.data().imageUrl;
    if (typeof imageUrl === 'string' && urlRewrites.has(imageUrl)) {
      historyUpdated++;
      console.log(`HISTORY ${hdoc.id}: rewriting imageUrl`);
      if (LIVE) await hdoc.ref.update({ imageUrl: urlRewrites.get(imageUrl) });
    }
  }
  console.log(`History: ${historyUpdated} docs rewritten`);

  // 3. Only now delete old folders
  for (const slug of foldersToDelete) {
    console.log(`DELETE folder equipment_images/${slug}/`);
    if (LIVE) await bucket.deleteFiles({ prefix: `equipment_images/${slug}/` });
  }

  console.log(`=== done (${LIVE ? 'LIVE' : 'DRY RUN'}): merged ${foldersToDelete.length} folders, rewrote ${blocksRewritten} blocks + ${historyUpdated} history docs ===`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
