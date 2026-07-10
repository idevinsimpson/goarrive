/**
 * One-off: create a DRAFT platform_releases doc describing Phase 1, render the
 * Monday digest with the real template code, and send it via Resend ONLY to
 * devin.simpson@goa.fit with a [TEST] subject prefix. Leaves nothing queued.
 *
 * Run from repo root:
 *   node scripts/test-digest-send-devin.js
 */
const path = require('path');
const admin = require(path.join(__dirname, '../functions/node_modules/firebase-admin'));
const { GoogleAuth } = require(path.join(__dirname, '../functions/node_modules/google-auth-library'));
const { whatsNewDigestEmail } = require(path.join(__dirname, '../functions/lib/templates.js'));

const SA_KEY = path.join(__dirname, '../.secrets/firebase-service-account.json');
const RECIPIENT = 'devin.simpson@goa.fit';
const FROM = 'GoArrive <updates@goarrive.fit>';

async function getEmailApiKey() {
  const auth = new GoogleAuth({
    keyFile: SA_KEY,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const projectId = await auth.getProjectId();
  const url = `https://secretmanager.googleapis.com/v1/projects/${projectId}/secrets/EMAIL_API_KEY/versions/latest:access`;
  const res = await client.request({ url });
  return Buffer.from(res.data.payload.data, 'base64').toString('utf8').trim();
}

async function main() {
  admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
  const db = admin.firestore();

  const release = {
    title: 'You can now share ideas straight from your dashboard',
    bodyMarkdown:
      'We just shipped a direct line from you to the GoArrive team. There is a new **Share Feedback** button on your Account page, and the moment you send something in, you get an instant confirmation email so you know it landed.\n\nWhy it matters: your recommendations shape what we build. The coaches using GoArrive every day see things we do not — now there is a two-tap way to tell us.',
    features: [
      {
        name: 'Share Feedback from your Account page',
        blurb:
          'Open Account, tap Share Feedback, pick a category (idea, improvement, or bug), and tell us what you want to see. You will get a confirmation email right away.',
        deepLink: 'https://goarrive.fit/feedback',
      },
    ],
    status: 'draft',
    createdAt: admin.firestore.Timestamp.now(),
    createdBy: 'maia-test-digest-script',
  };

  const docRef = await db.collection('platform_releases').add(release);
  console.log('Created platform_releases doc (status=draft):', docRef.id);

  const rendered = whatsNewDigestEmail('Devin Simpson', [
    { title: release.title, bodyMarkdown: release.bodyMarkdown, features: release.features },
  ], 'https://goarrive.fit');

  const apiKey = await getEmailApiKey();
  console.log('EMAIL_API_KEY retrieved from Secret Manager');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [RECIPIENT],
      subject: `[TEST] ${rendered.subject}`,
      html: rendered.htmlBody,
      text: rendered.body,
      reply_to: ['devin.simpson@goa.fit'],
    }),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    console.error(`RESEND SEND FAILED: HTTP ${res.status} — ${bodyText}`);
    process.exitCode = 1;
  } else {
    console.log(`RESEND SEND OK: ${bodyText}`);
  }

  const queued = await db.collection('platform_releases').where('status', '==', 'queued').get();
  console.log(`Queued platform_releases after run: ${queued.size} (must be 0)`);
  queued.docs.forEach((d) => console.log('  QUEUED DOC STILL PRESENT:', d.id, d.data().title));
}

main().catch((err) => {
  console.error('FAILED:', err.message || err);
  process.exit(1);
});
