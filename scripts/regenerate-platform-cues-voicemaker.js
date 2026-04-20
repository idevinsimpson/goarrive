#!/usr/bin/env node
/**
 * One-time + idempotent: regenerate workout-player static platform cues using
 * Voicemaker (ai3-Aria, friendly effect). Each cue is rendered as its own MP3
 * and uploaded to Firebase Storage at the new provider-namespaced path:
 *
 *   voice_cache/platform/voicemaker-ai3-aria-friendly-{key}.mp3
 *
 * Re-running is cheap: each cue is skipped if the Storage object already
 * exists. Force regen by passing --force or by deleting the object.
 *
 * Why a script and not a Cloud Function:
 *   • Static platform cues never change at runtime — they're a fixed phrase
 *     library. Pre-generating once and serving as static URLs avoids any
 *     per-session Voicemaker quota and avoids a cold-start hit on the very
 *     first user transition.
 *   • Bypasses the need for VOICEMAKER_API_KEY to live in Firebase Functions
 *     secrets just to seed the cache. The script reads the key from the
 *     VOICEMAKER_API_KEY env var when run.
 *
 * Usage (from repo root):
 *   VOICEMAKER_API_KEY=... node scripts/regenerate-platform-cues-voicemaker.js
 *   (add --force to overwrite existing objects)
 *
 * After running, the new URLs are also printed so you can confirm the CUES
 * map in apps/goarrive/hooks/useWorkoutTTS.ts points at them.
 */

// firebase-admin is installed under functions/node_modules; the script requires
// it from there so it can run from any cwd without an extra install.
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
const sa = require(path.join(__dirname, '..', '.secrets', 'firebase-service-account.json'));

admin.initializeApp({
  credential: admin.credential.cert(sa),
  storageBucket: 'goarrive.firebasestorage.app',
});
const bucket = admin.storage().bucket();

const VM_KEY = (process.env.VOICEMAKER_API_KEY || '').trim();
if (!VM_KEY) {
  console.error('VOICEMAKER_API_KEY env var is required.');
  process.exit(1);
}

const FORCE = process.argv.includes('--force');

const PROVIDER_SLUG = 'voicemaker-ai3-aria-friendly';

// Cue text definitions. The keys match the CueKey enum in useWorkoutTTS so
// the player can swap to the new URLs without changing its enqueue logic.
//
// Break tags are passed through to Voicemaker as SSML pauses; the timings
// here match the values Devin tested. Adjust these (not the player timer
// logic) if a cue feels too fast/slow.
//
// Countdown cues end at the "1" beat — the player still enqueues a separate
// terminus cue (`go` / `rest` / `switch_sides`) right after. Keeping that
// two-clip pattern preserves the existing special-block-suppression logic
// (no terminus cue if next is a special block).
const CUES = [
  { key: 'countdown_3',           text: '<break time="200ms"/>3<break time="700ms"/>2<break time="700ms"/>1<break time="400ms"/>' },
  { key: 'countdown_3_rest',      text: '<break time="200ms"/>3<break time="700ms"/>2<break time="700ms"/>1<break time="400ms"/>' },
  { key: 'countdown_4',           text: '<break time="200ms"/>4<break time="700ms"/>3<break time="700ms"/>2<break time="700ms"/>1<break time="400ms"/>' },
  { key: 'countdown_5',           text: '<break time="200ms"/>5<break time="700ms"/>4<break time="700ms"/>3<break time="700ms"/>2<break time="700ms"/>1<break time="400ms"/>' },
  { key: 'countdown_10',          text: '<break time="200ms"/>10<break time="600ms"/>9<break time="600ms"/>8<break time="600ms"/>7<break time="600ms"/>6<break time="600ms"/>5<break time="600ms"/>4<break time="600ms"/>3<break time="600ms"/>2<break time="600ms"/>1<break time="400ms"/>' },
  { key: 'five_seconds',          text: 'Five seconds.' },
  { key: 'ten_seconds',           text: 'Ten seconds.' },
  { key: 'go',                    text: 'Go.' },
  { key: 'begin',                 text: 'Begin.' },
  { key: 'rest',                  text: 'Rest.' },
  { key: 'rest_now',              text: 'Rest now.' },
  { key: 'halfway',               text: "That's halfway." },
  { key: 'workout_complete',      text: 'Your GoArrive workout is complete. Great job.' },
  { key: 'workout_complete_long', text: "Your GoArrive workout is complete. Great job — that's a wrap." },
  { key: 'workout_starting',      text: 'Workout starting.' },
  { key: 'start_now',             text: 'Start now.' },
  { key: 'next_up',               text: 'Next up.' },
  { key: 'get_ready',             text: 'Get ready.' },
  { key: 'switch_sides',          text: 'Swap sides.' },
  { key: 'other_side',            text: 'Other side.' },
  { key: 'water_break',           text: 'Grab some water.' },
  { key: 'warm_up',               text: 'Warm up.' },
  { key: 'cool_down',             text: 'Cool down.' },
  { key: 'stretch',               text: 'Stretch.' },
  { key: 'shake_it_out',          text: 'Shake it out.' },
  { key: 'lets_get_started',      text: "Let's get started." },
  { key: 'lets_go',               text: "Let's go." },
  { key: 'breathe',               text: 'Breathe.' },
  { key: 'take_a_breath',         text: 'Take a breath.' },
  { key: 'you_got_this',          text: "You've got this." },
  { key: 'keep_pushing',          text: 'Keep pushing.' },
  { key: 'almost_there',          text: 'Almost there.' },
  { key: 'last_round',            text: 'Last round.' },
  { key: 'last_set',              text: 'Last set.' },
  { key: 'final_rep',             text: 'Final rep.' },
  { key: 'one_more',              text: 'One more.' },
  { key: 'push_through',          text: 'Push through.' },
  { key: 'dig_deep',              text: 'Dig deep.' },
  { key: 'dont_stop',             text: "Don't stop." },
  { key: 'stay_strong',           text: 'Stay strong.' },
];

async function generateAndUpload({ key, text }) {
  const path = `voice_cache/platform/${PROVIDER_SLUG}-${key}.mp3`;
  const file = bucket.file(path);

  if (!FORCE) {
    const [exists] = await file.exists();
    if (exists) {
      const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media`;
      return { key, status: 'cached', path, url };
    }
  }

  const vmResp = await fetch('https://developer.voicemaker.in/api/v1/voice/convert', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VM_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      Engine: 'neural',
      VoiceId: 'ai3-Aria',
      LanguageCode: 'en-US',
      Text: text,
      OutputFormat: 'mp3',
      SampleRate: '48000',
      Effect: 'friendly',
      MasterVolume: '0',
      MasterSpeed: '0',
      MasterPitch: '0',
      FileStore: 24,
      ResponseType: 'file',
    }),
  });

  if (!vmResp.ok) {
    const body = (await vmResp.text()).slice(0, 300);
    throw new Error(`voicemaker ${vmResp.status}: ${body}`);
  }

  const vmJson = await vmResp.json();
  if (!vmJson.success || !vmJson.path) {
    throw new Error(`voicemaker bad response: ${JSON.stringify(vmJson).slice(0, 300)}`);
  }

  const dlResp = await fetch(vmJson.path);
  if (!dlResp.ok) {
    throw new Error(`download ${dlResp.status} for ${vmJson.path}`);
  }
  const buf = Buffer.from(await dlResp.arrayBuffer());

  await file.save(buf, { contentType: 'audio/mpeg' });
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media`;
  return { key, status: 'uploaded', path, url, bytes: buf.length, usedChars: vmJson.usedChars, remainChars: vmJson.remainChars };
}

(async () => {
  console.log(`Generating ${CUES.length} platform cues with Voicemaker (${PROVIDER_SLUG})…`);
  const results = [];
  for (const cue of CUES) {
    try {
      const r = await generateAndUpload(cue);
      results.push(r);
      console.log(`  [${r.status}] ${r.key} → ${r.path}${r.bytes ? ` (${r.bytes}B, used=${r.usedChars}, rem=${r.remainChars})` : ''}`);
    } catch (err) {
      console.error(`  [FAILED] ${cue.key}: ${err.message}`);
      results.push({ key: cue.key, status: 'failed', error: err.message });
    }
  }
  const failed = results.filter((r) => r.status === 'failed');
  console.log('');
  console.log(`Done. uploaded=${results.filter((r) => r.status === 'uploaded').length} cached=${results.filter((r) => r.status === 'cached').length} failed=${failed.length}`);
  if (failed.length) process.exit(2);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
