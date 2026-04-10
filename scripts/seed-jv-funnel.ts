/**
 * One-time seed script: populate JV Moore's funnel landing page fields.
 *
 * Usage:
 *   npx ts-node scripts/seed-jv-funnel.ts
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS or firebase-admin default credentials.
 */
import * as admin from 'firebase-admin';

admin.initializeApp();
const db = admin.firestore();

const JV_UID = 'yMimJ1OSOoN8znLGwvyrkA2IqSi1';

async function main() {
  await db.collection('users').doc(JV_UID).update({
    funnelSubdomain: 'jv',
    funnelHeadline: 'Your Fitness Plan,\nBuilt Just for You',
    funnelSubheadline:
      'Stop guessing. Get a personalized plan designed around your goals, your schedule, and your life — with a real coach in your corner every step of the way.',
    funnelBullets: [
      'Custom workouts built for your body and goals',
      '1-on-1 coaching and real accountability',
      'Guided video workouts you can follow anywhere',
      'A plan that adapts as you progress',
    ],
    funnelBio:
      'Certified fitness coach helping people build sustainable strength, confidence, and lasting results through personalized coaching.',
    funnelPhotoUrl:
      'https://d2xsxph8kpxj0f.cloudfront.net/310519663423401921/VjRBaaF5CqDJgP8x44n2fT/jv-moore-headshot_0b68dc55.png',
    funnelOgImageUrl:
      'https://files.manuscdn.com/user_upload_by_module/session_file/310519663423401921/ZEWIWpHDQbXzclAY.jpg',
  });

  console.log('Done — JV funnel fields seeded.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
