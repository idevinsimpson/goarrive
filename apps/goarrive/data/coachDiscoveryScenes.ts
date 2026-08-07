export type DiscoveryAccent = 'blue' | 'green' | 'gold' | 'neutral';

export type DiscoveryActId =
  | 'calling'
  | 'tension'
  | 'answer'
  | 'member'
  | 'coach'
  | 'opportunity'
  | 'invitation';

export interface DiscoverySceneMeta {
  id: string;
  number: number;
  act: DiscoveryActId;
  actLabel: string;
  headline: string;
  accent: DiscoveryAccent;
}

export const COACH_DISCOVERY_SCENES: DiscoverySceneMeta[] = [
  { id: 'future-calling', number: 1, act: 'calling', actLabel: 'The calling', headline: 'Build the coaching career\nyou were meant for.', accent: 'green' },
  { id: 'why-you-coach', number: 2, act: 'calling', actLabel: 'The calling', headline: 'You became a coach\nto change lives.', accent: 'green' },
  { id: 'forced-choice', number: 3, act: 'tension', actLabel: 'The tension', headline: 'The coaching world\nkeeps forcing a choice.', accent: 'gold' },
  { id: 'never-choose', number: 4, act: 'tension', actLabel: 'The tension', headline: 'What if you\nnever had to choose?', accent: 'blue' },
  { id: 'welcome', number: 5, act: 'answer', actLabel: 'The GoArrive answer', headline: 'Welcome to GoArrive.', accent: 'blue' },
  { id: 'remove-friction', number: 6, act: 'answer', actLabel: 'The GoArrive answer', headline: 'We do not\nreplace coaching.', accent: 'blue' },
  { id: 'more-human', number: 7, act: 'answer', actLabel: 'The GoArrive answer', headline: 'Technology should make\ncoaching more human.', accent: 'green' },
  { id: 'meet-audreya', number: 8, act: 'member', actLabel: 'The member experience', headline: 'Meet Audreya.', accent: 'green' },
  { id: 'member-journey', number: 9, act: 'member', actLabel: 'The member experience', headline: 'From overwhelmed\nto supported.', accent: 'green' },
  { id: 'tailored-plan', number: 10, act: 'member', actLabel: 'The member experience', headline: 'A plan built\naround her life.', accent: 'blue' },
  { id: 'workout-player', number: 11, act: 'member', actLabel: 'The member experience', headline: 'The workout carries\nthe coach with it.', accent: 'blue' },
  { id: 'flexible-accountability', number: 12, act: 'member', actLabel: 'The member experience', headline: 'Present when needed.\nConnected throughout.', accent: 'green' },
  { id: 'feedback-loop', number: 13, act: 'member', actLabel: 'The member experience', headline: 'The workout ends.\nThe coaching does not.', accent: 'green' },
  { id: 'coach-side', number: 14, act: 'coach', actLabel: 'The coach experience', headline: 'Now see it\nfrom your side.', accent: 'blue' },
  { id: 'infrastructure', number: 15, act: 'coach', actLabel: 'The coach experience', headline: 'We carry\nthe infrastructure.', accent: 'blue' },
  { id: 'focus-people', number: 16, act: 'coach', actLabel: 'The coach experience', headline: 'You focus\non people.', accent: 'green' },
  { id: 'coach-launch', number: 17, act: 'coach', actLabel: 'The coach experience', headline: 'You are not handed\na login and left alone.', accent: 'gold' },
  { id: 'culture', number: 18, act: 'coach', actLabel: 'The coach experience', headline: 'How we build\nmatters.', accent: 'gold' },
  { id: 'compensation', number: 19, act: 'opportunity', actLabel: 'The opportunity', headline: 'As your practice grows,\nyour share grows.', accent: 'gold' },
  { id: 'earnings-cap', number: 20, act: 'opportunity', actLabel: 'The opportunity', headline: 'There is a point where\nthe normal split stops.', accent: 'gold' },
  { id: 'growth-pathways', number: 21, act: 'opportunity', actLabel: 'The opportunity', headline: 'Growth is not limited\nto adding more sessions.', accent: 'gold' },
  { id: 'honest-trade', number: 22, act: 'opportunity', actLabel: 'The opportunity', headline: 'The honest trade.', accent: 'neutral' },
  { id: 'five-years', number: 23, act: 'invitation', actLabel: 'The invitation', headline: 'Imagine five years\nfrom now.', accent: 'green' },
  { id: 'fit', number: 24, act: 'invitation', actLabel: 'The invitation', headline: 'This is not\nfor everyone.', accent: 'neutral' },
  { id: 'conversation', number: 25, act: 'invitation', actLabel: 'The invitation', headline: 'What kind of\ncoaching career\nare you trying to build?', accent: 'gold' },
  { id: 'next-step', number: 26, act: 'invitation', actLabel: 'The invitation', headline: 'A simple next step.', accent: 'blue' },
  { id: 'close', number: 27, act: 'invitation', actLabel: 'The invitation', headline: 'Build something\nthat lasts.', accent: 'green' },
];

export const MEMBER_JOURNEY_STEPS = [
  'Interest',
  'Intake',
  'Tailored plan',
  'Payment',
  'Schedule',
  'Guided workout',
  'Zoom accountability',
  'Glow / Grow reflection',
  'Coach review',
  'Check-in',
  'Growth',
] as const;

export const SYSTEM_NODES = [
  'Coach',
  'Member',
  'Plan',
  'Workout',
  'Zoom',
  'Review',
  'Growth',
] as const;

export const INFRASTRUCTURE_ITEMS = [
  'Technology',
  'Zoom accounts',
  'Concurrent-session capacity',
  'Session recording',
  'Video storage',
  'Billing + subscriptions',
  'Scheduling',
  'Security',
  'Contracts',
  'Coach onboarding',
  'Product development',
  'Administrative systems',
] as const;

export const COACH_LAUNCH_MODULES = [
  'Welcome',
  'Vision',
  'Culture',
  'The Member Experience',
  'The Coach Experience',
  'How We Coach',
  'Money + Growth',
  'Apprenticeship Path',
  'Setup Checklist',
  'Agreement',
  'Launch Celebration',
] as const;

export const CULTURE_PILLARS = [
  {
    name: 'Show Up',
    definition: 'We are present, prepared, and consistent.',
  },
  {
    name: 'People Over Ego',
    definition: 'We protect the member, the team, and the mission above personal pride.',
  },
  {
    name: 'Create Moments',
    definition: 'We look for small ways to make people feel seen, known, and encouraged.',
  },
  {
    name: 'Traction',
    definition: 'We turn vision into movement through simple, consistent action.',
  },
] as const;

export const COMPENSATION_TIERS = [
  { range: '1–3 active members', coachShare: 60, goArriveShare: 40 },
  { range: '4–6 active members', coachShare: 65, goArriveShare: 35 },
  { range: '7+ active members', coachShare: 70, goArriveShare: 30 },
] as const;

export const EARNINGS_CAP_FACTS = [
  'New Business means revenue from a member during that member’s first year with GoArrive.',
  'The annual cap is set each calendar year, prorated for mid-year starts, and resets January 1.',
  'After the cap, the coach retains 100% of additional New Business revenue for the rest of that calendar year and through the rest of each affected member’s first year, minus the monthly admin technology fee.',
  'Referral shares and member referral reward obligations can still apply after the cap.',
] as const;

export const GROWTH_PATHWAYS = [
  {
    title: 'Serve members well',
    detail: 'Progressive compensation grows with active member engagement.',
    label: 'LIVE',
  },
  {
    title: 'Connect the right fit',
    detail: '7% of the receiving coach’s net revenue for the first year when an eligible inter-coach referral is recorded in GoArrive before that member engages the receiving coach.',
    label: 'CURRENT TERMS',
  },
  {
    title: 'Recruit and mentor',
    detail: '5% of net profits from direct recruits and 3% from secondary recruits, subject to caps and eligibility.',
    label: 'CURRENT TERMS',
  },
  {
    title: 'Develop leaders',
    detail: 'Planned Team Builder opportunity: up to 10 additional percentage points, subject to a future agreement, approval, and performance. It is not live or part of the current Program Terms.',
    label: 'PLANNED · NOT IN CURRENT TERMS',
  },
] as const;

export const PROGRAM_TERMS_NOTE =
  'High-level education only. Current GoArrive Program Terms govern eligibility, definitions, timing, calculations, and payment.';

export const REQUIRED_PRODUCT_SCREENSHOTS = [
  'Coach Command Center',
  'Plan Builder',
  'Member-facing plan',
  'Build + Movement Library',
  'Workout Player',
  'Member workouts',
  'Zoom / live-session experience',
  'Coach Review Queue',
  'Glow / Grow reflection',
  'Scheduling',
  'Billing',
  'Coach Launch',
  'Agreement screen',
] as const;
