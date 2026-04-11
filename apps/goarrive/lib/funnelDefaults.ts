/**
 * Default content for coach funnel pages.
 * Every field is pre-filled so the page looks usable immediately.
 */

export interface Testimonial {
  name: string;
  text: string;
}

export interface FunnelData {
  funnelSubdomain: string;
  funnelHeadline: string;
  funnelSubheadline: string;
  funnelBullets: string[];
  funnelBio: string;
  funnelPhotoUrl: string;
  funnelHeroVideoLink: string;
  funnelOgImageUrl: string;
  funnelTestimonials: Testimonial[];
}

export const FUNNEL_DEFAULTS: Omit<FunnelData, 'funnelSubdomain'> = {
  funnelHeadline: 'Your Fitness Plan, Built Just for You',
  funnelSubheadline:
    'Stop guessing and start training with a plan designed around your goals, schedule, and experience level. Your coach is with you every step of the way.',
  funnelBullets: [
    'Custom workouts built for you',
    'Direct access to your personal coach',
    'Video-guided exercises with proper form',
    'Progress tracking that adapts to you',
  ],
  funnelBio:
    "I'm a certified fitness coach passionate about helping people build sustainable habits and real strength. Whether you're just starting out or looking to level up, I'll create a plan that fits your life.",
  funnelPhotoUrl: '',
  funnelHeroVideoLink: '',
  funnelOgImageUrl: '',
  funnelTestimonials: [
    {
      name: 'Sarah M.',
      text: 'I never thought I could stick with a program, but having a real coach made all the difference. Down 15 lbs and feeling amazing!',
    },
    {
      name: 'James R.',
      text: 'The personalized workouts are incredible. Every session is exactly what I need.',
    },
    {
      name: 'Maria L.',
      text: 'Best investment I\'ve made in myself. My coach keeps me accountable and the results speak for themselves.',
    },
  ],
};

/** Merge Firestore data with defaults — Firestore values win when non-empty. */
export function mergeFunnelData(
  firestore: Record<string, any> | undefined,
): FunnelData {
  if (!firestore) {
    return { funnelSubdomain: '', ...FUNNEL_DEFAULTS };
  }
  return {
    funnelSubdomain: firestore.funnelSubdomain || '',
    funnelHeadline: firestore.funnelHeadline || FUNNEL_DEFAULTS.funnelHeadline,
    funnelSubheadline:
      firestore.funnelSubheadline || FUNNEL_DEFAULTS.funnelSubheadline,
    funnelBullets:
      firestore.funnelBullets?.length > 0
        ? firestore.funnelBullets
        : FUNNEL_DEFAULTS.funnelBullets,
    funnelBio: firestore.funnelBio || FUNNEL_DEFAULTS.funnelBio,
    funnelPhotoUrl: firestore.funnelPhotoUrl || '',
    funnelHeroVideoLink: firestore.funnelHeroVideoLink || '',
    funnelOgImageUrl: firestore.funnelOgImageUrl || '',
    funnelTestimonials:
      firestore.funnelTestimonials?.length > 0
        ? firestore.funnelTestimonials
        : FUNNEL_DEFAULTS.funnelTestimonials,
  };
}
