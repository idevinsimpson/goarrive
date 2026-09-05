#!/usr/bin/env node
/**
 * Seed one FitLife community, one active challenge, and its moves from a JSON
 * file. Sibling to `backfill-joincode.mjs`: dry-run by default, `--apply` to
 * write, honours `FIRESTORE_EMULATOR_HOST`. Prints the ids and the join URL on
 * success.
 *
 * The point of a file-driven seed is that the script has no product data
 * baked into it. Every value the emcee sees on Expo morning — the community
 * name, the challenge title, the goal target (or its deliberate absence), the
 * moves themselves — comes from the sample file at
 * `scripts/westayfit/seed/fitlife.sample.json`, or another file passed via
 * `--file`. `goalTarget: null` is a first-class product decision (spec §5.5,
 * "the shared number is the number of taps, not a target"); the script has
 * no fallback for it.
 *
 *   # Dry-run against the emulator suite:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *     node scripts/westayfit/seed-fitlife.mjs
 *
 *   # Actually write:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *     node scripts/westayfit/seed-fitlife.mjs --apply
 *
 *   # Real event data:
 *   node scripts/westayfit/seed-fitlife.mjs \
 *     --file scripts/westayfit/seed/fitlife-2026.json --apply
 *
 * By default a run that would overwrite any id refuses and exits non-zero.
 * Pass `--force` to intentionally overwrite. Use with care: a stray --force on
 * event morning could reset the counter shards' effective view (the shards
 * themselves are separate docs, but a challenge overwrite is not idempotent
 * for anything that has already been read).
 */

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const fileFlagIndex = args.indexOf('--file');
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = resolvePath(HERE, 'seed/fitlife.sample.json');
const FILE = fileFlagIndex >= 0 ? args[fileFlagIndex + 1] : DEFAULT_FILE;
const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'goarrive';

function mintJoinCode() {
  return randomBytes(16).toString('base64url');
}

function initAdmin() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    initializeApp({
      credential: cert(JSON.parse(readFileSync(credPath, 'utf8'))),
      projectId: PROJECT_ID,
    });
  } else {
    initializeApp({ projectId: PROJECT_ID });
  }
}

// The join URL is what gets printed on a QR. Emulator runs point at the
// hosting emulator's loopback; a production run has no reliable ambient way
// to know the host, so it defaults to the production origin and can be
// overridden with WSF_SEED_JOIN_URL_BASE.
function joinUrlBase() {
  const override = process.env.WSF_SEED_JOIN_URL_BASE;
  if (override) return override.replace(/\/+$/, '');
  if (process.env.FIRESTORE_EMULATOR_HOST) return 'http://127.0.0.1:5000';
  return 'https://westayfit-app.web.app';
}

function requireString(v, field) {
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new Error(`seed: ${field} must be a non-empty string`);
  }
  return v;
}

function requireGoalTarget(v) {
  if (v === null) return null;
  if (typeof v === 'number' && Number.isFinite(v) && v > 0 && Number.isInteger(v)) return v;
  throw new Error('seed: challenge.goalTarget must be null or a positive integer');
}

function loadSeed(file) {
  const raw = readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw);

  const community = parsed.community ?? {};
  const challenge = parsed.challenge ?? {};
  const moves = Array.isArray(parsed.moves) ? parsed.moves : [];

  const communityId = requireString(community.id, 'community.id');
  const communityDoc = {
    displayName: requireString(community.displayName, 'community.displayName'),
    groupType: community.groupType === 'familyFriends' ? 'familyFriends' : 'custom',
    joinPolicy: community.joinPolicy === 'public' ? 'public' : 'private',
    joinCode:
      typeof community.joinCode === 'string' && community.joinCode.length >= 16
        ? community.joinCode
        : mintJoinCode(),
    createdByUserId: 'seed-fitlife',
    lifecycleStatus: 'active',
    isSample: community.isSample === true,
  };

  const challengeId = requireString(challenge.id, 'challenge.id');
  const challengeDoc = {
    groupId: communityId,
    title: requireString(challenge.title, 'challenge.title'),
    status: challenge.status === 'draft' || challenge.status === 'completed' ? challenge.status : 'active',
    goalTarget: requireGoalTarget(challenge.goalTarget === undefined ? null : challenge.goalTarget),
  };

  const moveDocs = moves.map((m, i) => {
    const id = requireString(m.id, `moves[${i}].id`);
    const doc = {
      challengeId,
      title: requireString(m.title, `moves[${i}].title`),
      instructions: typeof m.instructions === 'string' ? m.instructions : '',
      sequence:
        typeof m.sequence === 'number' && Number.isInteger(m.sequence) ? m.sequence : i + 1,
      dayNumber: typeof m.dayNumber === 'number' ? m.dayNumber : null,
    };
    if (typeof m.locationLabel === 'string' && m.locationLabel.length > 0) {
      doc.locationLabel = m.locationLabel;
    }
    if (m.requiresCode === true) {
      doc.requiresCode = true;
      doc.checkInCode = requireString(m.checkInCode, `moves[${i}].checkInCode (required when requiresCode:true)`);
    }
    return { id, doc };
  });

  return { communityId, communityDoc, challengeId, challengeDoc, moveDocs };
}

async function assertOpenId(ref, kind) {
  const snap = await ref.get();
  if (snap.exists && !FORCE) {
    throw new Error(
      `seed: ${kind} at ${ref.path} already exists. Pass --force to overwrite.`
    );
  }
}

async function main() {
  const seed = loadSeed(FILE);
  console.log(`project: ${PROJECT_ID}`);
  console.log(`seed file: ${FILE}`);
  console.log(`community id: ${seed.communityId}`);
  console.log(`challenge id: ${seed.challengeId}`);
  console.log(`moves: ${seed.moveDocs.length}`);
  console.log(`goalTarget: ${seed.challengeDoc.goalTarget === null ? 'null (untargeted)' : seed.challengeDoc.goalTarget}`);
  const joinUrl = `${joinUrlBase()}/join/${encodeURIComponent(seed.communityDoc.joinCode)}`;
  console.log(`join URL: ${joinUrl}`);

  initAdmin();
  const db = getFirestore();

  const communityRef = db.doc(`wsfCommunityGroups/${seed.communityId}`);
  const challengeRef = db.doc(`wsfChallenges/${seed.challengeId}`);
  const moveRefs = seed.moveDocs.map(({ id }) => db.doc(`wsfChallengeMoves/${id}`));

  await assertOpenId(communityRef, 'community');
  await assertOpenId(challengeRef, 'challenge');
  for (let i = 0; i < moveRefs.length; i++) {
    await assertOpenId(moveRefs[i], `move[${i}]`);
  }

  if (!APPLY) {
    console.log('\n--- DRY RUN (pass --apply to write) ---');
    console.log(`would set wsfCommunityGroups/${seed.communityId}`);
    console.log(`would set wsfChallenges/${seed.challengeId}`);
    for (const { id } of seed.moveDocs) {
      console.log(`would set wsfChallengeMoves/${id}`);
    }
    return;
  }

  const batch = db.batch();
  batch.set(
    communityRef,
    {
      ...seed.communityDoc,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: false }
  );
  batch.set(
    challengeRef,
    {
      ...seed.challengeDoc,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: false }
  );
  for (let i = 0; i < seed.moveDocs.length; i++) {
    const { doc } = seed.moveDocs[i];
    batch.set(
      moveRefs[i],
      {
        ...doc,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: false }
    );
  }
  await batch.commit();
  console.log('seed applied.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
