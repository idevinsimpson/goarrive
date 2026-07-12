// Backfills primaryMuscles / secondaryMuscles on existing movement docs by
// re-classifying each movement with the same GPT-4.1-mini prompt used by the
// analyzeMovement callable (vision on the movement GIF when available, text
// fallback on name/metadata otherwise). muscleGroups stays the union.
//
// DRY RUN ONLY — this script prints proposed changes and never writes to
// Firestore. The live write run is gated on Devin's explicit approval.
//
// Usage:
//   export GOOGLE_APPLICATION_CREDENTIALS=.secrets/firebase-service-account.json
//   export OPENAI_API_KEY=sk-...
//   node functions/scripts/backfill-primary-muscles.js [--limit N] [movementId ...]

const admin = require('firebase-admin');

admin.initializeApp({ storageBucket: 'goarrive.firebasestorage.app' });

const MUSCLE_VALUES = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core', 'Full Body'];

const args = process.argv.slice(2);
let limit = Infinity;
const onlyIds = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit') limit = parseInt(args[++i], 10) || Infinity;
  else onlyIds.push(args[i]);
}

const apiKey = (process.env.OPENAI_API_KEY || '').trim();
if (!apiKey) {
  console.error('OPENAI_API_KEY env var is required');
  process.exit(1);
}

function buildPrompt(hasImage) {
  return `You are a fitness movement analysis expert. ${hasImage
    ? 'You will be shown an animated GIF of a fitness/exercise movement.'
    : 'You will be given the name and metadata of a fitness/exercise movement.'} Classify its muscle involvement and return a JSON object with:

- "primaryMuscles": string[] — the 1-3 muscle groups doing the main work (more than 3 only if the movement is truly full-body/dynamic), from: ${MUSCLE_VALUES.map((m) => `"${m}"`).join(', ')}
- "secondaryMuscles": string[] — muscle groups assisting or stabilizing (same allowed values, no overlap with primaryMuscles)

Return ONLY valid JSON, no markdown, no explanation.`;
}

async function classify(movement) {
  const gifUrl = movement.thumbnailUrl && /\.gif/i.test(movement.thumbnailUrl) ? movement.thumbnailUrl : null;
  const meta = `Movement name: "${movement.name}". Category: ${movement.category || 'unknown'}. Equipment: ${movement.equipment || 'unknown'}. Existing muscle groups tagged: ${(movement.muscleGroups || []).join(', ') || 'none'}.`;
  const userContent = gifUrl
    ? [
        { type: 'image_url', image_url: { url: gifUrl, detail: 'high' } },
        { type: 'text', text: `${meta}\nClassify the primary and secondary muscles and return the JSON.` },
      ]
    : `${meta}\nClassify the primary and secondary muscles and return the JSON.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: buildPrompt(!!gifUrl) },
        { role: 'user', content: userContent },
      ],
      max_tokens: 200,
      temperature: 0.2,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const result = await response.json();
  let jsonStr = (result.choices?.[0]?.message?.content || '').trim();
  if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  const parsed = JSON.parse(jsonStr);
  const valid = (arr) => (Array.isArray(arr) ? arr.filter((m) => MUSCLE_VALUES.includes(m)) : []);
  const primary = valid(parsed.primaryMuscles);
  const secondary = valid(parsed.secondaryMuscles).filter((m) => !primary.includes(m));
  return { primary, secondary };
}

(async () => {
  const db = admin.firestore();
  let docs;
  if (onlyIds.length > 0) {
    docs = (await Promise.all(onlyIds.map((id) => db.collection('movements').doc(id).get()))).filter((d) => d.exists);
  } else {
    docs = (await db.collection('movements').get()).docs;
  }

  console.log(`DRY RUN — no writes will be made. Movements fetched: ${docs.length}`);

  let proposed = 0, skipped = 0, failed = 0, processed = 0;
  for (const doc of docs) {
    if (processed >= limit) break;
    const m = doc.data();
    if (m.isArchived) { skipped++; continue; }
    if (Array.isArray(m.primaryMuscles) && m.primaryMuscles.length > 0) { skipped++; continue; }
    processed++;
    try {
      const { primary, secondary } = await classify(m);
      const union = Array.from(new Set([...(m.muscleGroups || []), ...primary, ...secondary]));
      proposed++;
      console.log(`[PROPOSE] ${doc.id} "${m.name}"`);
      console.log(`  existing muscleGroups: [${(m.muscleGroups || []).join(', ')}]`);
      console.log(`  primaryMuscles:   [${primary.join(', ')}]`);
      console.log(`  secondaryMuscles: [${secondary.join(', ')}]`);
      console.log(`  muscleGroups (new union): [${union.join(', ')}]`);
    } catch (err) {
      failed++;
      console.error(`[FAILED] ${doc.id} "${m.name}" — ${err.message}`);
    }
  }
  console.log(`\nDRY RUN complete. proposed=${proposed} skipped=${skipped} failed=${failed}`);
  console.log('No Firestore writes were made. Live run is gated on explicit approval.');
  process.exit(0);
})().catch((err) => { console.error('FATAL:', err); process.exit(1); });
