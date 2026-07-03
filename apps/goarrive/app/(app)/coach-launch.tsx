/**
 * Coach Launch — Phase 1 guided onboarding journey (shell)
 *
 * Route: /(app)/coach-launch  (coach & platformAdmin only — hidden from tab bar)
 *
 * Purpose:
 *   In-app guided path introducing a new coach to the GoArrive vision, culture,
 *   member experience, coach workflow, standards, apprenticeship, setup, and
 *   the final Coach Agreement acknowledgment.
 *
 * Progress storage:
 *   coach_launch/{coachId} — see CoachLaunchDoc below.
 *
 * External URL:
 *   Agreement link is read from EXPO_PUBLIC_COACH_AGREEMENT_URL. If unset, the
 *   Agreement module's CTA is disabled with a helper note.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import { Icon } from '../../components/Icon';
import { BG, BLUE, BORDER, CARD, FB, FG, FH, GOLD, GREEN, MUTED } from '../../lib/theme';
import {
  COACH_AGREEMENT_SECTIONS,
  COACH_AGREEMENT_SOURCE_URL,
  COACH_AGREEMENT_TITLE,
  COACH_AGREEMENT_VERSION,
} from '../../constants/coachAgreement';
import { CoachAgreementSignaturePad } from '../../components/CoachAgreementSignaturePad';

// ── Modules (order matters — this is the journey sequence) ─────────────────────

type ModuleId =
  | 'welcome'
  | 'vision'
  | 'culture'
  | 'memberExperience'
  | 'coachExperience'
  | 'howWeCoach'
  | 'moneyGrowth'
  | 'apprenticeshipPath'
  | 'setupChecklist'
  | 'agreement'
  | 'launchCelebration';

interface ModuleDef {
  id: ModuleId;
  number: number;
  title: string;
  description: string;
  estimatedTime: string;
  intro: string;
}

const MODULES: ModuleDef[] = [
  {
    id: 'welcome',
    number: 1,
    title: 'Welcome',
    description: 'Begin the journey and understand what Coach Launch is.',
    estimatedTime: '2–3 min',
    intro: 'Coach Launch is your guided path into the GoArrive coaching culture, systems, standards, and launch process. Move through each module at your own pace — everything you learn here shapes the way you coach members inside G➲A.',
  },
  {
    id: 'vision',
    number: 2,
    title: 'Vision',
    description: 'See why G➲A exists and what we\'re building together.',
    estimatedTime: '3–5 min',
    intro: 'GoArrive exists to make personalized, technology-enabled fitness coaching accessible, warm, and effective — for members who want more than a workout, and for coaches who want a real career built on care.',
  },
  {
    id: 'culture',
    number: 3,
    title: 'Culture',
    description: 'Learn the standards that shape our support-driven coaching culture.',
    estimatedTime: '3–5 min',
    intro: 'Our culture is built on four pillars: Show Up, People Over Ego, Create Moments, and Traction. These shape how you interact with members, teammates, and yourself.',
  },
  {
    id: 'memberExperience',
    number: 4,
    title: 'The Member Experience',
    description: 'Walk through what members experience from plan to progress.',
    estimatedTime: '3–5 min',
    intro: 'Members experience GoArrive as a personalized plan, coached workouts, reflection, and coach acknowledgment. Understanding their side of the loop makes you a sharper coach.',
  },
  {
    id: 'coachExperience',
    number: 5,
    title: 'The Coach Experience',
    description: 'See how coaches use the dashboard, tools, and workflows.',
    estimatedTime: '3–5 min',
    intro: 'Your Command Center is where you build workouts, manage members, review activity, and respond. Later modules dive deeper — this is the map.',
  },
  {
    id: 'howWeCoach',
    number: 6,
    title: 'How We Coach',
    description: 'Practice the posture, communication, and care expected inside G➲A.',
    estimatedTime: '4–6 min',
    intro: 'How we coach matters as much as what we coach. Presence, timeliness of acknowledgment, and warmth are the standards. Every member should feel seen.',
  },
  {
    id: 'moneyGrowth',
    number: 7,
    title: 'Money + Growth',
    description: 'Understand progressive compensation, member engagement, and growth-based earnings at a high level.',
    estimatedTime: '4–6 min',
    intro: 'Compensation grows as your engagement and roster grow. This module gives you the high-level picture — the Coach Agreement and Billing dashboard hold the exact numbers.',
  },
  {
    id: 'apprenticeshipPath',
    number: 8,
    title: 'Apprenticeship Path',
    description: 'See the path from modeling to assisting, watching, and launching.',
    estimatedTime: '3–5 min',
    intro: 'Your apprenticeship path moves through modeling, assisting, watching, and launching. Each stage builds skill, confidence, and member readiness.',
  },
  {
    id: 'setupChecklist',
    number: 9,
    title: 'Setup Checklist',
    description: 'Review the practical steps needed before launch.',
    estimatedTime: '3–5 min',
    intro: 'Before you launch, make sure your profile, availability, first movements, and first workout are in place. The dashboard\'s Getting Started card tracks the practical setup steps in real time.',
  },
  {
    id: 'agreement',
    number: 10,
    title: 'Agreement',
    description: 'Review and sign the final Coach Agreement.',
    estimatedTime: '5–10 min',
    intro: 'Everything you\'ve walked through in Coach Launch is summarized in the Coach Agreement. This final step protects members, coaches, and GoArrive by putting our shared expectations in writing.',
  },
  {
    id: 'launchCelebration',
    number: 11,
    title: 'Launch Celebration',
    description: 'Celebrate completion and return to the dashboard.',
    estimatedTime: '1 min',
    intro: 'Welcome to the team.',
  },
];

const CULTURE_PILLARS = ['Show Up', 'People Over Ego', 'Create Moments', 'Traction'];

interface PillarDetail {
  name: string;
  definition: string;
  looksLike: string[];
}

const CULTURE_PILLAR_DETAILS: PillarDetail[] = [
  {
    name: 'Show Up',
    definition: 'We are present, prepared, and consistent.',
    looksLike: [
      'Arriving ready before the session starts',
      'Following through on what you said you would do',
      'Checking in when a member starts drifting',
      'Taking ownership instead of making excuses',
    ],
  },
  {
    name: 'People Over Ego',
    definition:
      'We protect the member, the team, and the mission above personal pride.',
    looksLike: [
      'Referring a member to another coach when it serves them better',
      'Receiving feedback without defensiveness',
      'Speaking with honor about fellow coaches',
      'Choosing what helps the member, not what makes you look best',
    ],
  },
  {
    name: 'Create Moments',
    definition:
      'We look for small ways to make people feel seen, known, and encouraged.',
    looksLike: [
      "Celebrating a member's win",
      'Sending a thoughtful follow-up',
      'Remembering what matters to someone',
      'Turning a normal check-in into a meaningful encouragement',
    ],
  },
  {
    name: 'Traction',
    definition:
      'We turn vision into movement through simple, consistent action.',
    looksLike: [
      'Keeping the next step clear',
      'Helping members build momentum',
      'Improving one thing at a time',
      'Choosing progress over perfection',
    ],
  },
];

type ScenarioLetter = 'A' | 'B' | 'C' | 'D';

interface CultureScenario {
  key: 'memberSlipping' | 'coachFit';
  responseField: 'cultureScenarioMemberSlipping' | 'cultureScenarioCoachFit';
  eyebrow: string;
  title: string;
  prompt: string;
  options: { letter: ScenarioLetter; text: string }[];
  correct: ScenarioLetter;
  correctFeedback: string;
}

const CULTURE_SCENARIOS: CultureScenario[] = [
  {
    key: 'memberSlipping',
    responseField: 'cultureScenarioMemberSlipping',
    eyebrow: 'SCENARIO 1',
    title: 'A member starts slipping.',
    prompt:
      'A member has missed several workouts and seems discouraged. What response best reflects the G➲A culture?',
    options: [
      { letter: 'A', text: 'Wait for them to reach out when they are ready.' },
      {
        letter: 'B',
        text: 'Send a harsh message so they know they need to be more disciplined.',
      },
      {
        letter: 'C',
        text: 'Check in with care, help them reset, and make the next step simple.',
      },
      {
        letter: 'D',
        text: 'Remove them from the plan until they prove they are serious.',
      },
    ],
    correct: 'C',
    correctFeedback:
      'That is the G➲A way. Accountability should feel supportive, not shame-driven. We help members reset with care, clarity, and a next step they can actually take.',
  },
  {
    key: 'coachFit',
    responseField: 'cultureScenarioCoachFit',
    eyebrow: 'SCENARIO 2',
    title: 'Another coach is a better fit.',
    prompt:
      'You meet a potential member, but you realize another GoArrive coach may be a better fit for their goals. What response best reflects the G➲A culture?',
    options: [
      {
        letter: 'A',
        text: 'Keep the member because you found them first.',
      },
      {
        letter: 'B',
        text: 'Connect them with the better-fit coach and trust that collaboration strengthens the whole community.',
      },
      {
        letter: 'C',
        text: 'Avoid telling them so they do not get confused.',
      },
      {
        letter: 'D',
        text: 'Tell the other coach only after the member signs up.',
      },
    ],
    correct: 'B',
    correctFeedback:
      'That is People Over Ego. Inside GoArrive, coaches are stakeholders in a shared mission. When the member wins, the culture wins.',
  },
];

const VISION_EXCITEMENT_OPTIONS = [
  'Helping members build lasting consistency',
  'Growing inside a support-driven coaching culture',
  'Using better systems to coach with more clarity',
  'Building long-term growth-based earnings',
  'Being part of something early and meaningful',
];

// ── Member Experience content ─────────────────────────────────────────────────

interface MemberJourneyStep {
  title: string;
  body: string;
  coachFocus: string;
}

const MEMBER_JOURNEY_STEPS: MemberJourneyStep[] = [
  {
    title: 'A member is looking for help.',
    body:
      'They may feel stuck, inconsistent, overwhelmed, or unsure where to start. Your first opportunity is to listen well and build trust.',
    coachFocus:
      'Ask good questions. Listen before prescribing. Help them feel seen.',
  },
  {
    title: 'They share their story.',
    body:
      'The intake helps us understand goals, schedule, health history, barriers, motivation, and lifestyle. This gives the coach context before building a plan.',
    coachFocus:
      'Look for patterns, constraints, and what matters most to the member.',
  },
  {
    title: 'They receive a tailored path.',
    body:
      'The coach uses the intake and plan-building process to create a personalized path that moves the member from confusion to clarity.',
    coachFocus:
      'Make the plan feel specific, understandable, and connected to the member\u2019s goals.',
  },
  {
    title: 'They choose to begin.',
    body:
      'After the plan is presented, the member accepts, chooses their payment option, and steps into the program.',
    coachFocus:
      'Be clear, calm, and confident. This should feel like a professional start, not a sales handoff.',
  },
  {
    title: 'They get rhythm.',
    body:
      'Recurring sessions create structure. The member should know when they are showing up, what to expect, and how to stay consistent.',
    coachFocus:
      'Protect clarity. Reduce confusion. Make the next step obvious.',
  },
  {
    title: 'They show up and move.',
    body:
      'Sessions happen online through the GoArrive system. Depending on the plan phase, the coach may be present for the full session, part of the session, or reviewing afterward.',
    coachFocus:
      'Coach for safety, form, confidence, and consistency.',
  },
  {
    title: 'They receive support beyond the session.',
    body:
      'Session recordings and feedback help the coach review form, reinforce progress, and give targeted support when needed.',
    coachFocus:
      'Use feedback to build confidence, not shame. Be specific, timely, and encouraging.',
  },
  {
    title: 'They reflect and adjust.',
    body:
      'Regular check-ins help the member review progress, identify barriers, adjust the plan, and keep momentum.',
    coachFocus:
      'Celebrate wins, address friction, and reset the next step.',
  },
  {
    title: 'They grow in confidence.',
    body:
      'The goal is not dependence forever. The goal is to help members build lasting habits, confidence, and self-reliance with the right level of support.',
    coachFocus:
      'Equip the member to own their progress while still feeling supported.',
  },
];

interface MemberNeed {
  title: string;
  body: string;
}

const MEMBER_NEEDS: MemberNeed[] = [
  { title: 'Clarity', body: 'Members need to know what to do next.' },
  {
    title: 'Care',
    body: 'Members need to know their coach sees them as a person, not a plan.',
  },
  {
    title: 'Accountability',
    body: 'Members need supportive follow-through when consistency slips.',
  },
  {
    title: 'Confidence',
    body: 'Members need to feel capable of building long-term habits.',
  },
];

interface MemberScenario {
  eyebrow: string;
  title: string;
  prompt: string;
  options: { letter: ScenarioLetter; text: string }[];
  correct: ScenarioLetter;
  correctFeedback: string;
  wrongFeedback: string;
}

// ── Coach Experience content ──────────────────────────────────────────────────

interface CommandCenterArea {
  title: string;
  body: string;
  coachFocus: string;
}

const COMMAND_CENTER_AREAS: CommandCenterArea[] = [
  {
    title: 'Start with what needs attention.',
    body:
      'The Command Center gives you a home base for your coaching day. It should help you see progress, next steps, member activity, and where to go next.',
    coachFocus:
      'Open with purpose. Look for what needs attention before jumping into tasks.',
  },
  {
    title: 'Know who you serve.',
    body:
      'The Members area gives you access to your roster and each member\u2019s details. This is where you stay connected to the people behind the plans.',
    coachFocus:
      'Treat each member profile like a relationship hub, not a database row.',
  },
  {
    title: 'Turn the intake into a path.',
    body:
      'The plan-building workflow helps translate a member\u2019s goals, schedule, motivation, and constraints into a clear coaching path.',
    coachFocus:
      'Build plans that feel specific, realistic, and connected to the member\u2019s why.',
  },
  {
    title: 'Create the work they will actually do.',
    body:
      'The Build area is where workouts, movements, and coaching resources come together. This is where structure becomes action.',
    coachFocus:
      'Keep the workout clear, safe, and easy for the member to follow.',
  },
  {
    title: 'Create rhythm.',
    body:
      'Scheduling helps members know when to show up and helps coaches protect consistency.',
    coachFocus:
      'Use scheduling to reduce confusion and build momentum.',
  },
  {
    title: 'Coach beyond the live moment.',
    body:
      'Sessions and recordings help you support form, consistency, and follow-through. The recording is not just a file. It is a chance to review, encourage, and improve.',
    coachFocus:
      'Use recordings for targeted feedback, not nitpicking.',
  },
  {
    title: 'Stay operationally ready.',
    body:
      'Your account setup, connected tools, and profile details help keep the coaching experience smooth.',
    coachFocus:
      'Keep your setup clean so members experience confidence, not friction.',
  },
  {
    title: 'Understand the business side.',
    body:
      'Billing and growth tools help coaches understand member engagement, earnings progress, and the financial side of coaching inside GoArrive.',
    coachFocus:
      'See money as stewardship of growth, not the center of the mission.',
  },
];

const COMMAND_CENTER_AREA_LABELS = [
  'Dashboard / Command Center',
  'Members',
  'Plan Builder',
  'Build',
  'Scheduling',
  'Sessions + Recordings',
  'Account + Setup',
  'Billing + Growth',
];

interface CoachRhythmStep {
  name: string;
  body: string;
}

const COACH_RHYTHM: CoachRhythmStep[] = [
  {
    name: 'Review',
    body:
      'Look at who needs attention, what is coming up, and where members may be slipping.',
  },
  {
    name: 'Prepare',
    body:
      'Check plans, workouts, sessions, and notes before the member experience begins.',
  },
  {
    name: 'Coach',
    body: 'Show up with presence, clarity, and care.',
  },
  {
    name: 'Respond',
    body:
      'Use feedback, check-ins, and adjustments to help the member take the next step.',
  },
];

const COACH_EXPERIENCE_HELPFUL_OPTIONS = [
  'Command Center visibility',
  'Member relationship hub',
  'Plan Builder',
  'Build tools',
  'Scheduling',
  'Sessions and recordings',
  'Feedback and check-ins',
  'Billing and growth visibility',
];

// ── How We Coach content ──────────────────────────────────────────────────────

interface CoachingPosture {
  name: string;
  definition: string;
  soundsLike: string;
}

const COACHING_POSTURES: CoachingPosture[] = [
  {
    name: 'Be Present',
    definition:
      'Show up prepared, focused, and ready to serve the member in front of you.',
    soundsLike:
      '\u201CGood to see you. I looked over your check-in and I want to start with what you mentioned about your knee feeling tight.\u201D',
  },
  {
    name: 'Be Clear',
    definition: 'Make the next step simple and understandable.',
    soundsLike:
      '\u201CToday we\u2019re keeping the focus on control and range of motion. Don\u2019t chase speed here.\u201D',
  },
  {
    name: 'Be Safe',
    definition:
      'Prioritize movement quality, appropriate progressions, and risk reduction.',
    soundsLike:
      '\u201CLet\u2019s adjust that setup before we add weight. I want this to feel strong, not forced.\u201D',
  },
  {
    name: 'Be Personal',
    definition: 'Coach the person, not just the workout.',
    soundsLike:
      '\u201CGiven your travel this week, let\u2019s simplify the plan and protect consistency.\u201D',
  },
  {
    name: 'Be Responsive',
    definition:
      'Use feedback, check-ins, and observation to adjust the plan.',
    soundsLike:
      '\u201CThat pattern has shown up twice now, so I\u2019m going to adjust next week\u2019s work and give you a quick cue to focus on.\u201D',
  },
];

const COACHING_POSTURE_OPTIONS = [
  'Present',
  'Clear',
  'Safe',
  'Personal',
  'Responsive',
];

interface CoachingLoopStep {
  name: string;
  body: string;
}

const COACHING_LOOP: CoachingLoopStep[] = [
  {
    name: 'Notice',
    body:
      'Pay attention to what the member is saying, doing, and avoiding.',
  },
  {
    name: 'Clarify',
    body:
      'Ask questions and make sure you understand what is really happening.',
  },
  {
    name: 'Coach',
    body:
      'Give the right cue, plan adjustment, encouragement, or correction.',
  },
  {
    name: 'Follow Through',
    body:
      'Check back in, review progress, and keep the next step clear.',
  },
];

interface CoachingExample {
  situation: string;
  weak: string;
  goa: string;
}

const COACHING_EXAMPLES: CoachingExample[] = [
  {
    situation: 'Member is late to a session.',
    weak: '\u201CYou\u2019re late again.\u201D',
    goa:
      '\u201CGlad you made it. Let\u2019s make the most of the time we have today, and then we\u2019ll look at what\u2019s making this time hard to protect.\u201D',
  },
  {
    situation: 'Member\u2019s form looks unsafe.',
    weak: '\u201CKeep going.\u201D',
    goa:
      '\u201CPause right there. Let\u2019s clean this up first. I\u2019d rather protect your body and build it right.\u201D',
  },
  {
    situation: 'Member feels discouraged.',
    weak: '\u201CYou just need to be more disciplined.\u201D',
    goa:
      '\u201CI hear you. Let\u2019s zoom out, find the friction point, and make the next step smaller and clearer.\u201D',
  },
  {
    situation: 'Member is progressing well.',
    weak: '\u201CNice.\u201D',
    goa:
      '\u201CThat was solid. Your control was better today, especially on the way down. That\u2019s progress.\u201D',
  },
];

const HOW_WE_COACH_SCENARIO_UNSAFE: MemberScenario = {
  eyebrow: 'SCENARIO 1',
  title: 'A member\u2019s form breaks down.',
  prompt:
    'During a session, a member starts moving in a way that looks unsafe. What response best reflects how we coach inside G\u27B2A?',
  options: [
    {
      letter: 'A',
      text: 'Let them finish the set so they do not feel interrupted.',
    },
    {
      letter: 'B',
      text:
        'Stop them, adjust the movement, explain the cue clearly, and protect safety before intensity.',
    },
    {
      letter: 'C',
      text: 'Tell them they are doing it wrong and need to focus harder.',
    },
    {
      letter: 'D',
      text: 'Skip the movement permanently without explaining why.',
    },
  ],
  correct: 'B',
  correctFeedback:
    'That is the G\u27B2A way. Safety comes before intensity. A strong coach corrects clearly without embarrassing the member.',
  wrongFeedback:
    'Close, but remember the priority: protect the member, keep the cue clear, and help them feel coached rather than criticized.',
};

const HOW_WE_COACH_SCENARIO_MISSED: MemberScenario = {
  eyebrow: 'SCENARIO 2',
  title: 'A member is discouraged after missing workouts.',
  prompt:
    'A member says, \u201CI blew it this week. I missed everything.\u201D What response best reflects how we coach inside G\u27B2A?',
  options: [
    {
      letter: 'A',
      text: '\u201CYeah, that was not good. You need to take this more seriously.\u201D',
    },
    { letter: 'B', text: '\u201CNo worries, it does not matter.\u201D' },
    {
      letter: 'C',
      text:
        '\u201CThanks for being honest. Let\u2019s reset without shame and choose the next step you can actually do today.\u201D',
    },
    {
      letter: 'D',
      text:
        '\u201CWe should probably pause until you are more motivated.\u201D',
    },
  ],
  correct: 'C',
  correctFeedback:
    'That is the G\u27B2A way. Accountability should not create shame. We help members tell the truth, reset, and move forward.',
  wrongFeedback:
    'Close, but think about care and accountability together. We do not ignore the miss, and we do not bury the member in shame.',
};

interface GrowthPrinciple {
  name: string;
  definition: string;
  body: string;
}

const GROWTH_PRINCIPLES: GrowthPrinciple[] = [
  {
    name: 'Member Engagement',
    definition:
      'Growth starts with serving members well and helping them stay consistent.',
    body:
      'The strongest growth comes from trust, outcomes, communication, and care \u2014 not pressure.',
  },
  {
    name: 'Progressive Compensation',
    definition:
      'As active member count grows, the coach share increases.',
    body:
      'The model is designed to reward coaches as they grow their member base and continue serving with excellence.',
  },
  {
    name: 'Collaboration',
    definition:
      'GoArrive rewards coaches who connect members to the right coach and support fellow coaches.',
    body: 'A support-driven coaching culture means the best fit wins.',
  },
  {
    name: 'Long-Term Contribution',
    definition:
      'Coaches who recruit, mentor, and build well can participate in broader growth opportunities.',
    body:
      'Profit sharing is designed to recognize the value of helping grow the coaching community.',
  },
];

interface CompensationTier {
  title: string;
  range: string;
  split: string;
  body: string;
}

const PROGRESSIVE_TIERS: CompensationTier[] = [
  {
    title: 'Tier 1',
    range: '1\u20133 active members',
    split: '60% coach / 40% G\u27B2A',
    body:
      'This is the starting tier as a coach begins serving active members inside GoArrive.',
  },
  {
    title: 'Tier 2',
    range: '4\u20136 active members',
    split: '65% coach / 35% G\u27B2A',
    body:
      'This tier reflects growth in member engagement and active coaching responsibility.',
  },
  {
    title: 'Tier 3',
    range: '7+ active members',
    split: '70% coach / 30% G\u27B2A',
    body: 'This tier rewards continued growth and sustained member service.',
  },
];

interface SimpleCard {
  title: string;
  body: string;
}

const EARNINGS_CAP_CARDS: SimpleCard[] = [
  {
    title: 'First-year member revenue',
    body:
      'The cap is tied to revenue from members in their first year with GoArrive.',
  },
  {
    title: 'Annual reset',
    body: 'The cap resets each year on January 1.',
  },
  {
    title: 'Prorated starts',
    body:
      'If a coach starts mid-year, the annual cap is prorated based on the remaining months.',
  },
];

interface GrowthPathway {
  title: string;
  body: string;
  rule?: string;
}

const GROWTH_PATHWAYS: GrowthPathway[] = [
  {
    title: 'Serve members well',
    body:
      'Strong member engagement creates trust, retention, and opportunities for growth.',
  },
  {
    title: 'Invite new members',
    body:
      'Members who love the experience may invite others into the community. The member referral reward creates a clear structure for celebrating that growth.',
  },
  {
    title: 'Connect the right fit',
    body:
      'When another coach is a better fit for a new member, the inter-coach referral program supports collaboration and shared success.',
    rule:
      'Eligible inter-coach member referrals are 7% of net revenue for the first year, when recorded in advance and subject to the formal program terms.',
  },
  {
    title: 'Recruit and mentor coaches',
    body:
      'Coaches who help grow the coaching community can participate in profit sharing from direct and secondary recruits, subject to caps and eligibility.',
    rule:
      'Direct recruits can generate 5% profit share, and secondary recruits can generate 3% profit share, subject to the recruited coach\u2019s earnings cap and formal program terms.',
  },
];

const MONEY_GROWTH_CLARITY_POINTS: string[] = [
  'This is a high-level education module.',
  'This is not a live earnings calculator.',
  'This is not a guarantee of income.',
  'Final terms are governed by the Coach Agreement.',
  'GoArrive may adjust program terms with proper notice.',
  'Coaches should review the final agreement carefully before signing.',
];

const MONEY_GROWTH_INTEREST_OPTIONS = [
  'Progressive compensation',
  'Earnings cap',
  'Member referral reward',
  'Inter-coach referrals',
  'Profit sharing',
  'Tracking and transparency',
  'Member engagement strategy',
];

const MONEY_GROWTH_SCENARIO_TIER: MemberScenario = {
  eyebrow: 'SCENARIO 1',
  title: 'You reach a new member-count tier.',
  prompt:
    'A coach grows from 3 active members to 4 active members. What should they understand about the progressive compensation model?',
  options: [
    {
      letter: 'A',
      text:
        'Their coach share may increase according to the tier structure and current GoArrive records.',
    },
    {
      letter: 'B',
      text:
        'Their pay is automatically guaranteed forever at the higher tier no matter what happens.',
    },
    {
      letter: 'C',
      text:
        'The tier change means they no longer need to follow GoArrive standards.',
    },
    {
      letter: 'D',
      text:
        'The tier change creates a custom split they can negotiate per member.',
    },
  ],
  correct: 'A',
  correctFeedback:
    'That is the G\u27B2A way. Progressive compensation rewards growth, but tier movement is still based on active member count, current records, and the formal program terms.',
  wrongFeedback:
    'Close, but keep the structure clear. Tier movement is based on active member count and GoArrive records, not custom exceptions or guarantees.',
};

const MONEY_GROWTH_SCENARIO_REFERRAL: MemberScenario = {
  eyebrow: 'SCENARIO 2',
  title: 'Another coach is the better fit.',
  prompt:
    'You meet a prospective member, but another GoArrive coach is clearly a better fit. What response best reflects the money and culture model together?',
  options: [
    {
      letter: 'A',
      text: 'Keep the member no matter what because you found them first.',
    },
    {
      letter: 'B',
      text:
        'Connect the member to the better-fit coach and make sure the referral is recorded in advance if eligible.',
    },
    {
      letter: 'C',
      text:
        'Wait until after the member signs up, then mention the referral later.',
    },
    {
      letter: 'D',
      text: 'Avoid collaboration because it reduces your opportunity.',
    },
  ],
  correct: 'B',
  correctFeedback:
    'That is the G\u27B2A way. The right-fit coach serves the member best, and the inter-coach referral structure supports collaboration when properly recorded and eligible.',
  wrongFeedback:
    'Close, but remember: GoArrive is building a support-driven coaching culture. Collaboration matters, and eligible referrals need to be recorded in advance.',
};

const COACH_EXPERIENCE_SCENARIO: MemberScenario = {
  eyebrow: 'SCENARIO',
  title: 'Your coaching day feels scattered.',
  prompt:
    'You open the app and have several things competing for your attention: a member missed a workout, another member has a session later today, and you still need to review a plan. What response best reflects the GoArrive Coach Experience?',
  options: [
    { letter: 'A', text: 'Jump into whichever task feels easiest first.' },
    { letter: 'B', text: 'Ignore the app and handle things from memory.' },
    {
      letter: 'C',
      text:
        'Use the Command Center to identify what needs attention, prepare for the next session, and take the next clear step.',
    },
    {
      letter: 'D',
      text: 'Wait until the end of the day and try to handle everything at once.',
    },
  ],
  correct: 'C',
  correctFeedback:
    'That is the G\u27B2A way. The Command Center exists to reduce scattered effort and help you coach with clarity, preparation, and timely follow-through.',
  wrongFeedback:
    'Close, but remember the goal: the app should help you reduce friction, see what matters, and take the next clear step.',
};

const MEMBER_EXPERIENCE_SCENARIO: MemberScenario = {
  eyebrow: 'SCENARIO',
  title: 'A member feels overwhelmed.',
  prompt:
    'A new member completes intake and says, \u201CI know I need this, but I\u2019m nervous I won\u2019t be able to keep up.\u201D What response best reflects the GoArrive member experience?',
  options: [
    { letter: 'A', text: '\u201CYou\u2019ll be fine. Just follow the plan.\u201D' },
    {
      letter: 'B',
      text: '\u201CThis is hard for everyone, so you\u2019ll need to push through.\u201D',
    },
    {
      letter: 'C',
      text: '\u201CThat makes sense. We\u2019ll start where you are, keep the next step clear, and build confidence one session at a time.\u201D',
    },
    { letter: 'D', text: '\u201CMaybe wait until you feel more ready.\u201D' },
  ],
  correct: 'C',
  correctFeedback:
    'That is the G\u27B2A way. We do not minimize the member\u2019s concern, and we do not add pressure. We bring clarity, care, and confidence to the next step.',
  wrongFeedback:
    'Close, but think about what the member needs in that moment: clarity, care, and confidence. Let them feel supported while still helping them move forward.',
};

// ── Apprenticeship Path content ────────────────────────────────────────────────

const APPRENTICESHIP_OVERVIEW_CARDS: SimpleCard[] = [
  {
    title: 'Timeline',
    body:
      'The apprenticeship is designed to run for three months or 60 hours of apprenticeship activity, whichever comes first, unless adjusted by GoArrive in writing.',
  },
  {
    title: 'Mentorship',
    body:
      'Each Apprentice Coach is paired with a Coach Mentor who helps model the standard, provide feedback, and support launch readiness.',
  },
  {
    title: 'Flexible readiness',
    body:
      'Progression is based on demonstrated skill, systems understanding, professionalism, and readiness to serve members well.',
  },
];

interface LadderPhase {
  title: string;
  shortDefinition: string;
  body: string;
  apprenticeFocus: string;
  readinessLooksLike: string;
}

const APPRENTICESHIP_LADDER_PHASES: LadderPhase[] = [
  {
    title: 'Modeling',
    shortDefinition: 'Watch the standard.',
    body:
      'The Coach Mentor demonstrates effective coaching, member interaction, session management, communication, and use of the GoArrive system.',
    apprenticeFocus:
      'Observe carefully. Ask good questions. Notice how the coach leads the member, not just the workout.',
    readinessLooksLike:
      'You can explain what you observed and identify why the coach made key decisions.',
  },
  {
    title: 'Assisting',
    shortDefinition: 'Support the session.',
    body:
      'The Apprentice Coach begins supporting sessions under supervision, gradually taking on more responsibility while the Coach Mentor remains actively involved.',
    apprenticeFocus:
      'Practice small pieces of the coaching experience: setup, cues, check-ins, communication, and follow-through.',
    readinessLooksLike:
      'You can contribute without creating confusion and you respond well to mentor feedback.',
  },
  {
    title: 'Watching',
    shortDefinition: 'Lead while being observed.',
    body:
      'The Apprentice Coach leads sessions while the Coach Mentor watches, evaluates, and gives constructive feedback.',
    apprenticeFocus:
      'Lead with clarity, safety, care, and confidence while staying open to correction.',
    readinessLooksLike:
      'You can guide a member through a session, make appropriate adjustments, communicate clearly, and receive feedback without defensiveness.',
  },
  {
    title: 'Launching',
    shortDefinition: 'Step into independent coaching with support.',
    body:
      'Once the Apprentice Coach demonstrates readiness, they are cleared to coach members independently while continued support remains available.',
    apprenticeFocus:
      'Serve members well, keep growing, and stay connected to the support-driven coaching culture.',
    readinessLooksLike:
      'You can coach responsibly, use the system, communicate professionally, and uphold GoArrive standards.',
  },
];

const APPRENTICESHIP_READINESS_SIGNALS: SimpleCard[] = [
  {
    title: 'Skill',
    body: 'You can coach movement safely and clearly.',
  },
  {
    title: 'Presence',
    body: 'You show up prepared, focused, and professional.',
  },
  {
    title: 'Communication',
    body:
      'You communicate promptly, respectfully, and clearly with members and coaches.',
  },
  {
    title: 'Systems',
    body:
      'You understand the GoArrive tools and workflows needed to serve members well.',
  },
  {
    title: 'Adaptability',
    body:
      'You can adjust coaching based on member needs, feedback, and real-life constraints.',
  },
  {
    title: 'Humility',
    body: 'You can receive feedback and keep improving.',
  },
];

const APPRENTICESHIP_MENTOR_CARDS: SimpleCard[] = [
  {
    title: 'Watch actively',
    body: 'Do not just observe what happens. Notice why it happens.',
  },
  {
    title: 'Ask thoughtful questions',
    body: 'Bring curiosity, not assumptions.',
  },
  {
    title: 'Practice with humility',
    body: 'Treat feedback as an opportunity to grow, not a threat.',
  },
  {
    title: 'Own your next step',
    body:
      'After feedback, identify one thing to improve and act on it.',
  },
];

const APPRENTICESHIP_EXCITEMENT_OPTIONS = [
  'Modeling',
  'Assisting',
  'Watching',
  'Launching',
];

const APPRENTICESHIP_SCENARIO_FEEDBACK: MemberScenario = {
  eyebrow: 'SCENARIO 1',
  title: 'You receive corrective feedback.',
  prompt:
    'Your Coach Mentor gives you feedback that your coaching cues were too complicated during a session. What response best reflects the G\u27B2A apprenticeship posture?',
  options: [
    {
      letter: 'A',
      text: 'Defend yourself and explain why the member should have understood.',
    },
    {
      letter: 'B',
      text: 'Ignore the feedback because your style is your style.',
    },
    {
      letter: 'C',
      text:
        'Thank the mentor, ask what would make the cue clearer, and practice simplifying your next cue.',
    },
    {
      letter: 'D',
      text: 'Stop coaching because feedback means you are not ready.',
    },
  ],
  correct: 'C',
  correctFeedback:
    'That is the G\u27B2A way. Apprenticeship works when feedback becomes growth. The goal is not perfection; the goal is humble improvement.',
  wrongFeedback:
    'Close, but remember the apprenticeship posture: receive feedback, clarify the next step, and practice with humility.',
};

const APPRENTICESHIP_SCENARIO_LAUNCH_READINESS: MemberScenario = {
  eyebrow: 'SCENARIO 2',
  title: 'You want to launch quickly.',
  prompt:
    'You are excited and want to start coaching members independently as soon as possible, but your Coach Mentor says you still need more supervised practice. What response best reflects the GoArrive launch path?',
  options: [
    {
      letter: 'A',
      text: 'Push to launch anyway because confidence matters more than readiness.',
    },
    {
      letter: 'B',
      text:
        'Trust the process, ask what readiness signals need to improve, and keep practicing.',
    },
    {
      letter: 'C',
      text: 'Stop participating until someone clears you.',
    },
    {
      letter: 'D',
      text: 'Try to coach members outside the system to prove you are ready.',
    },
  ],
  correct: 'B',
  correctFeedback:
    'That is the G\u27B2A way. Launch is based on readiness, not impatience. The goal is to protect the member, the coach, and the GoArrive standard.',
  wrongFeedback:
    'Close, but launch readiness matters. The apprenticeship path exists to help coaches grow safely and confidently before independent coaching.',
};

// ── Setup Checklist content ────────────────────────────────────────────────────

interface SetupCategory {
  title: string;
  body: string;
  examples: string[];
  coachFocus: string;
}

const SETUP_CATEGORIES: SetupCategory[] = [
  {
    title: 'Profile + Identity',
    body:
      'Your profile helps members and the GoArrive team know who you are, how to contact you, and how to represent you clearly inside the system.',
    examples: [
      'Display name',
      'Email',
      'Phone',
      'Profile photo',
      'Coach bio, if applicable',
    ],
    coachFocus: 'Make your presence feel professional and trustworthy.',
  },
  {
    title: 'Certifications + Qualifications',
    body:
      'GoArrive needs coaches to maintain appropriate certifications and continue growing professionally.',
    examples: [
      'Current fitness coaching certification',
      'CPR/AED if required',
      'Specialty credentials, if applicable',
      'Any documentation GoArrive requests',
    ],
    coachFocus: 'Keep your qualifications current and easy to verify.',
  },
  {
    title: 'Connected Tools',
    body: 'Your connected tools help the coaching experience run smoothly.',
    examples: [
      'Stripe Connect / payout readiness',
      'Zoom connection or approved session access',
      'Google Calendar connection, if used',
      'Device, camera, mic, and stable internet',
    ],
    coachFocus: 'Test the tools before the member is depending on them.',
  },
  {
    title: 'Coaching Resources',
    body:
      'Before launch, coaches should understand how to use the core resources needed to serve members well.',
    examples: [
      'Movement Library',
      'Workout Builder',
      'Plan Builder',
      'Member notes and details',
      'Session recordings and feedback tools',
    ],
    coachFocus: 'Know where to go before you need it live.',
  },
  {
    title: 'First Member Readiness',
    body:
      'A coach should be ready to guide a member from intake to plan, scheduling, sessions, feedback, and check-ins.',
    examples: [
      'Understand the intake flow',
      'Build or review a member plan',
      'Know how scheduling works',
      'Know how to follow up after sessions',
      'Know when to ask for help',
    ],
    coachFocus: 'Make the first member experience feel calm, clear, and cared for.',
  },
];

interface SetupChecklistItem {
  id: string;
  text: string;
}

const SETUP_CHECKLIST_ITEMS: SetupChecklistItem[] = [
  {
    id: 'profile',
    text: 'I understand where to complete or update my coach profile.',
  },
  {
    id: 'certifications',
    text:
      'I understand what certifications or qualifications GoArrive may need from me.',
  },
  {
    id: 'stripe',
    text:
      'I understand that Stripe Connect / payout readiness must be completed in the proper app area before payments can work.',
  },
  {
    id: 'zoom',
    text:
      'I understand that Zoom/session access must be tested before serving members.',
  },
  {
    id: 'calendar',
    text:
      'I understand that calendar and scheduling setup should be reviewed before member sessions begin.',
  },
  {
    id: 'coachingTools',
    text:
      'I understand where to find core coaching tools like Plan Builder, Build tools, and member details.',
  },
  {
    id: 'firstMember',
    text:
      'I understand that my first member experience should feel clear, professional, and supported.',
  },
  {
    id: 'agreement',
    text: 'I understand that the final Coach Agreement is still required before launch.',
  },
];

const SETUP_CLARITY_POINTS: string[] = [
  'This checklist helps you understand launch readiness.',
  'This checklist does not verify live setup status.',
  'This checklist does not connect Stripe, Zoom, or calendar tools.',
  'This checklist does not upload certifications.',
  'This checklist does not replace approval from GoArrive or your Coach Mentor.',
  'This checklist does not replace the Coach Agreement.',
];

const SETUP_CONFIDENCE_OPTIONS = [
  'Profile + identity',
  'Certifications + qualifications',
  'Connected tools',
  'Coaching resources',
  'First member readiness',
  'I am still getting oriented',
];

const SETUP_SCENARIO_UNTESTED_TOOL: MemberScenario = {
  eyebrow: 'SCENARIO',
  title: 'You are almost ready, but one tool is not tested.',
  prompt:
    'You feel ready to start coaching, but you have not tested your Zoom/session access or reviewed the scheduling flow yet. What response best reflects GoArrive launch readiness?',
  options: [
    {
      letter: 'A',
      text: 'Launch anyway because you can figure it out during the first session.',
    },
    {
      letter: 'B',
      text: 'Delay everything indefinitely until you feel completely perfect.',
    },
    {
      letter: 'C',
      text:
        'Test the tool, review the flow, ask for help if needed, and protect the member experience before launch.',
    },
    {
      letter: 'D',
      text: 'Tell the member to handle the technical setup themselves.',
    },
  ],
  correct: 'C',
  correctFeedback:
    'That is the G\u27B2A way. Launch readiness protects the member experience. A prepared coach reduces friction, builds trust, and knows when to ask for support.',
  wrongFeedback:
    'Close, but remember the goal: we do not need perfection, and we do not wing it with members. We prepare, test, ask for help, and protect the experience.',
};

// ── Firestore doc shape ────────────────────────────────────────────────────────

interface CoachLaunchDoc {
  coachId: string;
  completedModuleIds: ModuleId[];
  currentModuleId: ModuleId;
  responses: {
    welcomeCommitmentAccepted?: boolean;
    visionConnection?: string;
    visionExcitement?: string;
    naturalCulturePillar?: string;
    growthCulturePillar?: string;
    memberFeelingGoal?: string;
    cultureScenarioMemberSlipping?: string;
    cultureScenarioCoachFit?: string;
    memberFirstInteractionGoal?: string;
    memberExperienceScenarioOverwhelmed?: string;
    coachExperienceMostHelpful?: string;
    coachCommandCenterHabit?: string;
    coachExperienceScenarioScattered?: string;
    coachingPostureGoal?: string;
    coachingCommunicationHabit?: string;
    howWeCoachScenarioUnsafeForm?: string;
    howWeCoachScenarioMissedWorkouts?: string;
    moneyGrowthInterest?: string;
    moneyGrowthQuestion?: string;
    moneyGrowthScenarioTier?: string;
    moneyGrowthScenarioReferral?: string;
    apprenticeshipExcitementPhase?: string;
    apprenticeshipGrowthArea?: string;
    apprenticeshipScenarioFeedback?: string;
    apprenticeshipScenarioLaunchReadiness?: string;
    setupReadinessAcknowledgedItems?: string[];
    setupConfidenceArea?: string;
    setupHelpArea?: string;
    setupScenarioUntestedTool?: string;
    agreementOpened?: boolean;
    agreementOpenedAt?: any;
    agreementCoachLaunchNotReplacement?: boolean;
    agreementSignatureRequired?: boolean;
    agreementOpenedAcknowledged?: boolean;
    // Phase 10B — in-app Coach Agreement signing
    agreementReviewedSectionIds?: string[];
    agreementTermsAccepted?: boolean;
    agreementElectronicConsentAccepted?: boolean;
    agreementElectronicConsentAcceptedAt?: any;
    agreementCoachFirstName?: string;
    agreementCoachLastName?: string;
    agreementSignedVersion?: string;
    agreementSignedAt?: any;
  };
  startedAt?: any;
  updatedAt?: any;
  completedAt?: any;
}

function emptyDoc(coachId: string): CoachLaunchDoc {
  return {
    coachId,
    completedModuleIds: [],
    currentModuleId: 'welcome',
    responses: {},
  };
}

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function CoachLaunchScreen() {
  const insets = useSafeAreaInsets();
  const { user, claims, effectiveUid } = useAuth();
  const coachId = effectiveUid || claims?.coachId || user?.uid || '';
  const isAdmin =
    claims?.role === 'platformAdmin' ||
    claims?.role === 'platform_admin' ||
    claims?.admin === true;
  // Signature legally must be made by the actual coach account owner —
  // admin impersonation is not allowed to sign on their behalf. This is
  // also enforced by Firestore rules (coach_agreements/{coachId}: create
  // requires request.auth.uid == coachId), but the UI blocks it earlier
  // for a clean disabled state.
  const isSigningAsSelf = !!user?.uid && user.uid === coachId;

  const [progress, setProgress] = useState<CoachLaunchDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeModuleId, setActiveModuleId] = useState<ModuleId | null>(null);
  const [pendingScrollTarget, setPendingScrollTarget] =
    useState<ModuleId | null>(null);
  const [justCompletedId, setJustCompletedId] = useState<ModuleId | null>(null);

  // Scroll refs for post-completion auto-scroll to next incomplete module
  const scrollRef = useRef<ScrollView>(null);
  const moduleListYRef = useRef<number | null>(null);
  const moduleCardYsRef = useRef<Record<string, number>>({});

  // Local response drafts (persisted on Complete Module)
  const [welcomeAcceptedDraft, setWelcomeAcceptedDraft] = useState(false);
  const [visionDraft, setVisionDraft] = useState('');
  const [visionExcitementDraft, setVisionExcitementDraft] = useState('');
  const [naturalPillarDraft, setNaturalPillarDraft] = useState('');
  const [growthPillarDraft, setGrowthPillarDraft] = useState('');
  const [memberFeelingGoalDraft, setMemberFeelingGoalDraft] = useState('');
  const [scenarioSlippingDraft, setScenarioSlippingDraft] = useState('');
  const [scenarioCoachFitDraft, setScenarioCoachFitDraft] = useState('');
  const [memberFirstInteractionGoalDraft, setMemberFirstInteractionGoalDraft] =
    useState('');
  const [memberExperienceScenarioDraft, setMemberExperienceScenarioDraft] =
    useState('');
  const [coachExperienceMostHelpfulDraft, setCoachExperienceMostHelpfulDraft] =
    useState('');
  const [coachCommandCenterHabitDraft, setCoachCommandCenterHabitDraft] =
    useState('');
  const [coachExperienceScenarioDraft, setCoachExperienceScenarioDraft] =
    useState('');
  const [coachingPostureGoalDraft, setCoachingPostureGoalDraft] = useState('');
  const [coachingCommunicationHabitDraft, setCoachingCommunicationHabitDraft] =
    useState('');
  const [howWeCoachScenarioUnsafeDraft, setHowWeCoachScenarioUnsafeDraft] =
    useState('');
  const [howWeCoachScenarioMissedDraft, setHowWeCoachScenarioMissedDraft] =
    useState('');
  const [moneyGrowthInterestDraft, setMoneyGrowthInterestDraft] = useState('');
  const [moneyGrowthQuestionDraft, setMoneyGrowthQuestionDraft] = useState('');
  const [moneyGrowthScenarioTierDraft, setMoneyGrowthScenarioTierDraft] =
    useState('');
  const [moneyGrowthScenarioReferralDraft, setMoneyGrowthScenarioReferralDraft] =
    useState('');
  const [
    apprenticeshipExcitementPhaseDraft,
    setApprenticeshipExcitementPhaseDraft,
  ] = useState('');
  const [apprenticeshipGrowthAreaDraft, setApprenticeshipGrowthAreaDraft] =
    useState('');
  const [
    apprenticeshipScenarioFeedbackDraft,
    setApprenticeshipScenarioFeedbackDraft,
  ] = useState('');
  const [
    apprenticeshipScenarioLaunchReadinessDraft,
    setApprenticeshipScenarioLaunchReadinessDraft,
  ] = useState('');
  const [setupChecklistDraft, setSetupChecklistDraft] = useState<string[]>([]);
  const [setupConfidenceAreaDraft, setSetupConfidenceAreaDraft] = useState('');
  const [setupHelpAreaDraft, setSetupHelpAreaDraft] = useState('');
  const [
    setupScenarioUntestedToolDraft,
    setSetupScenarioUntestedToolDraft,
  ] = useState('');
  const [agreementOpenedDraft, setAgreementOpenedDraft] = useState(false);
  const [
    agreementNotReplacementDraft,
    setAgreementNotReplacementDraft,
  ] = useState(false);
  const [
    agreementSignatureRequiredDraft,
    setAgreementSignatureRequiredDraft,
  ] = useState(false);
  const [
    agreementOpenedAcknowledgedDraft,
    setAgreementOpenedAcknowledgedDraft,
  ] = useState(false);

  // ── Phase 10B — in-app Coach Agreement signing drafts ────────────────────────
  const [
    agreementReviewedSectionIdsDraft,
    setAgreementReviewedSectionIdsDraft,
  ] = useState<string[]>([]);
  const [agreementTermsAcceptedDraft, setAgreementTermsAcceptedDraft] =
    useState(false);
  const [
    agreementElectronicConsentDraft,
    setAgreementElectronicConsentDraft,
  ] = useState(false);
  const [agreementFirstNameDraft, setAgreementFirstNameDraft] = useState('');
  const [agreementLastNameDraft, setAgreementLastNameDraft] = useState('');
  const [agreementSignatureDraft, setAgreementSignatureDraft] = useState('');
  const [agreementExpandedSectionId, setAgreementExpandedSectionId] =
    useState<string | null>(null);
  const [agreementSubmitting, setAgreementSubmitting] = useState(false);
  const [agreementSubmitError, setAgreementSubmitError] = useState<
    string | null
  >(null);
  const [signedAgreement, setSignedAgreement] = useState<{
    coachId: string;
    coachFirstName?: string;
    coachLastName?: string;
    typedName?: string;
    agreementVersion?: string;
    agreementTitle?: string;
    signedAt?: any;
    clientSignedDate?: string;
    reviewedSectionIds?: string[];
    signatureDataUrl?: string;
    status?: string;
  } | null>(null);

  const agreementUrl = (process.env.EXPO_PUBLIC_COACH_AGREEMENT_URL || '').trim();

  // Prefill first + last name from Firebase Auth displayName once, only if empty.
  const nameSeededRef = useRef(false);
  useEffect(() => {
    if (nameSeededRef.current) return;
    const displayName = (user?.displayName || '').trim();
    if (!displayName) return;
    if (!agreementFirstNameDraft && !agreementLastNameDraft) {
      const parts = displayName.split(/\s+/);
      const first = parts[0] || '';
      const last = parts.slice(1).join(' ') || '';
      if (first) setAgreementFirstNameDraft(first);
      if (last) setAgreementLastNameDraft(last);
      nameSeededRef.current = true;
    }
  }, [user?.displayName, agreementFirstNameDraft, agreementLastNameDraft]);

  // Load progress on mount
  useEffect(() => {
    if (!coachId) return;
    (async () => {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, 'coach_launch', coachId));
        if (snap.exists()) {
          const data = snap.data() as CoachLaunchDoc;
          setProgress({
            coachId,
            completedModuleIds: data.completedModuleIds ?? [],
            currentModuleId: data.currentModuleId ?? 'welcome',
            responses: data.responses ?? {},
            startedAt: data.startedAt,
            updatedAt: data.updatedAt,
            completedAt: data.completedAt,
          });
          setWelcomeAcceptedDraft(!!data.responses?.welcomeCommitmentAccepted);
          setVisionDraft(data.responses?.visionConnection ?? '');
          setVisionExcitementDraft(data.responses?.visionExcitement ?? '');
          setNaturalPillarDraft(data.responses?.naturalCulturePillar ?? '');
          setGrowthPillarDraft(data.responses?.growthCulturePillar ?? '');
          setMemberFeelingGoalDraft(data.responses?.memberFeelingGoal ?? '');
          setScenarioSlippingDraft(
            data.responses?.cultureScenarioMemberSlipping ?? ''
          );
          setScenarioCoachFitDraft(
            data.responses?.cultureScenarioCoachFit ?? ''
          );
          setMemberFirstInteractionGoalDraft(
            data.responses?.memberFirstInteractionGoal ?? ''
          );
          setMemberExperienceScenarioDraft(
            data.responses?.memberExperienceScenarioOverwhelmed ?? ''
          );
          setCoachExperienceMostHelpfulDraft(
            data.responses?.coachExperienceMostHelpful ?? ''
          );
          setCoachCommandCenterHabitDraft(
            data.responses?.coachCommandCenterHabit ?? ''
          );
          setCoachExperienceScenarioDraft(
            data.responses?.coachExperienceScenarioScattered ?? ''
          );
          setCoachingPostureGoalDraft(
            data.responses?.coachingPostureGoal ?? ''
          );
          setCoachingCommunicationHabitDraft(
            data.responses?.coachingCommunicationHabit ?? ''
          );
          setHowWeCoachScenarioUnsafeDraft(
            data.responses?.howWeCoachScenarioUnsafeForm ?? ''
          );
          setHowWeCoachScenarioMissedDraft(
            data.responses?.howWeCoachScenarioMissedWorkouts ?? ''
          );
          setMoneyGrowthInterestDraft(
            data.responses?.moneyGrowthInterest ?? ''
          );
          setMoneyGrowthQuestionDraft(
            data.responses?.moneyGrowthQuestion ?? ''
          );
          setMoneyGrowthScenarioTierDraft(
            data.responses?.moneyGrowthScenarioTier ?? ''
          );
          setMoneyGrowthScenarioReferralDraft(
            data.responses?.moneyGrowthScenarioReferral ?? ''
          );
          setApprenticeshipExcitementPhaseDraft(
            data.responses?.apprenticeshipExcitementPhase ?? ''
          );
          setApprenticeshipGrowthAreaDraft(
            data.responses?.apprenticeshipGrowthArea ?? ''
          );
          setApprenticeshipScenarioFeedbackDraft(
            data.responses?.apprenticeshipScenarioFeedback ?? ''
          );
          setApprenticeshipScenarioLaunchReadinessDraft(
            data.responses?.apprenticeshipScenarioLaunchReadiness ?? ''
          );
          setSetupChecklistDraft(
            Array.isArray(data.responses?.setupReadinessAcknowledgedItems)
              ? data.responses!.setupReadinessAcknowledgedItems!
              : []
          );
          setSetupConfidenceAreaDraft(
            data.responses?.setupConfidenceArea ?? ''
          );
          setSetupHelpAreaDraft(data.responses?.setupHelpArea ?? '');
          setSetupScenarioUntestedToolDraft(
            data.responses?.setupScenarioUntestedTool ?? ''
          );
          setAgreementOpenedDraft(!!data.responses?.agreementOpened);
          setAgreementNotReplacementDraft(
            !!data.responses?.agreementCoachLaunchNotReplacement
          );
          setAgreementSignatureRequiredDraft(
            !!data.responses?.agreementSignatureRequired
          );
          setAgreementOpenedAcknowledgedDraft(
            !!data.responses?.agreementOpenedAcknowledged
          );
          // Phase 10B drafts
          setAgreementReviewedSectionIdsDraft(
            Array.isArray(data.responses?.agreementReviewedSectionIds)
              ? data.responses!.agreementReviewedSectionIds!
              : []
          );
          setAgreementTermsAcceptedDraft(
            !!data.responses?.agreementTermsAccepted
          );
          setAgreementElectronicConsentDraft(
            !!data.responses?.agreementElectronicConsentAccepted
          );
          if (data.responses?.agreementCoachFirstName) {
            setAgreementFirstNameDraft(
              data.responses.agreementCoachFirstName
            );
            nameSeededRef.current = true;
          }
          if (data.responses?.agreementCoachLastName) {
            setAgreementLastNameDraft(data.responses.agreementCoachLastName);
            nameSeededRef.current = true;
          }
        } else {
          setProgress(emptyDoc(coachId));
        }
      } catch (err) {
        console.error('[CoachLaunch] load error:', err);
        setProgress(emptyDoc(coachId));
      } finally {
        setLoading(false);
      }

      // Load signed Coach Agreement (if any) — independent of coach_launch doc.
      try {
        const signedSnap = await getDoc(doc(db, 'coach_agreements', coachId));
        if (signedSnap.exists()) {
          setSignedAgreement(signedSnap.data() as any);
        }
      } catch (err) {
        // A missing doc is expected before signing; anything else we just log.
        console.warn('[CoachLaunch] signed agreement load error:', err);
      }
    })();
  }, [coachId]);

  const completed = progress?.completedModuleIds ?? [];
  const pct = Math.round((completed.length / MODULES.length) * 100);
  const allDone = completed.length === MODULES.length;

  // First not-yet-completed module (for "Continue")
  const nextIncomplete = useMemo<ModuleDef | null>(() => {
    for (const m of MODULES) {
      if (!completed.includes(m.id)) return m;
    }
    return null;
  }, [completed]);

  function isUnlocked(moduleId: ModuleId): boolean {
    if (isAdmin) return true;
    if (completed.includes(moduleId)) return true;
    const idx = MODULES.findIndex((m) => m.id === moduleId);
    if (idx === 0) return true;
    const prev = MODULES[idx - 1];
    return completed.includes(prev.id);
  }

  function statusFor(moduleId: ModuleId): 'complete' | 'ready' | 'locked' {
    if (completed.includes(moduleId)) return 'complete';
    if (isUnlocked(moduleId)) return 'ready';
    return 'locked';
  }

  const save = useCallback(
    async (patch: Partial<CoachLaunchDoc>) => {
      if (!coachId || !progress) return;
      setSaving(true);
      try {
        const merged: CoachLaunchDoc = {
          ...progress,
          ...patch,
          responses: { ...progress.responses, ...(patch.responses ?? {}) },
          coachId,
        };
        const writePayload: any = {
          coachId,
          completedModuleIds: merged.completedModuleIds,
          currentModuleId: merged.currentModuleId,
          responses: merged.responses,
          updatedAt: serverTimestamp(),
        };
        if (!progress.startedAt) writePayload.startedAt = serverTimestamp();
        if (merged.completedModuleIds.length === MODULES.length && !progress.completedAt) {
          writePayload.completedAt = serverTimestamp();
        }
        await setDoc(doc(db, 'coach_launch', coachId), writePayload, { merge: true });
        setProgress(merged);
      } catch (err) {
        console.error('[CoachLaunch] save error:', err);
      } finally {
        setSaving(false);
      }
    },
    [coachId, progress]
  );

  async function completeModule(moduleId: ModuleId) {
    if (!progress) return;
    const alreadyComplete = completed.includes(moduleId);

    // Collect module-specific responses
    const nextResponses = { ...progress.responses };
    if (moduleId === 'welcome') {
      nextResponses.welcomeCommitmentAccepted = welcomeAcceptedDraft;
    }
    if (moduleId === 'vision') {
      nextResponses.visionConnection = visionDraft.trim();
      if (visionExcitementDraft) nextResponses.visionExcitement = visionExcitementDraft;
    }
    if (moduleId === 'culture') {
      if (naturalPillarDraft) nextResponses.naturalCulturePillar = naturalPillarDraft;
      if (growthPillarDraft) nextResponses.growthCulturePillar = growthPillarDraft;
      if (memberFeelingGoalDraft.trim()) {
        nextResponses.memberFeelingGoal = memberFeelingGoalDraft.trim();
      }
      if (scenarioSlippingDraft) {
        nextResponses.cultureScenarioMemberSlipping = scenarioSlippingDraft;
      }
      if (scenarioCoachFitDraft) {
        nextResponses.cultureScenarioCoachFit = scenarioCoachFitDraft;
      }
    }
    if (moduleId === 'memberExperience') {
      if (memberFirstInteractionGoalDraft.trim()) {
        nextResponses.memberFirstInteractionGoal =
          memberFirstInteractionGoalDraft.trim();
      }
      if (memberExperienceScenarioDraft) {
        nextResponses.memberExperienceScenarioOverwhelmed =
          memberExperienceScenarioDraft;
      }
    }
    if (moduleId === 'coachExperience') {
      if (coachExperienceMostHelpfulDraft) {
        nextResponses.coachExperienceMostHelpful =
          coachExperienceMostHelpfulDraft;
      }
      if (coachCommandCenterHabitDraft.trim()) {
        nextResponses.coachCommandCenterHabit =
          coachCommandCenterHabitDraft.trim();
      }
      if (coachExperienceScenarioDraft) {
        nextResponses.coachExperienceScenarioScattered =
          coachExperienceScenarioDraft;
      }
    }
    if (moduleId === 'howWeCoach') {
      if (coachingPostureGoalDraft) {
        nextResponses.coachingPostureGoal = coachingPostureGoalDraft;
      }
      if (coachingCommunicationHabitDraft.trim()) {
        nextResponses.coachingCommunicationHabit =
          coachingCommunicationHabitDraft.trim();
      }
      if (howWeCoachScenarioUnsafeDraft) {
        nextResponses.howWeCoachScenarioUnsafeForm =
          howWeCoachScenarioUnsafeDraft;
      }
      if (howWeCoachScenarioMissedDraft) {
        nextResponses.howWeCoachScenarioMissedWorkouts =
          howWeCoachScenarioMissedDraft;
      }
    }
    if (moduleId === 'moneyGrowth') {
      if (moneyGrowthInterestDraft) {
        nextResponses.moneyGrowthInterest = moneyGrowthInterestDraft;
      }
      if (moneyGrowthQuestionDraft.trim()) {
        nextResponses.moneyGrowthQuestion = moneyGrowthQuestionDraft.trim();
      }
      if (moneyGrowthScenarioTierDraft) {
        nextResponses.moneyGrowthScenarioTier = moneyGrowthScenarioTierDraft;
      }
      if (moneyGrowthScenarioReferralDraft) {
        nextResponses.moneyGrowthScenarioReferral =
          moneyGrowthScenarioReferralDraft;
      }
    }
    if (moduleId === 'apprenticeshipPath') {
      if (apprenticeshipExcitementPhaseDraft) {
        nextResponses.apprenticeshipExcitementPhase =
          apprenticeshipExcitementPhaseDraft;
      }
      if (apprenticeshipGrowthAreaDraft.trim()) {
        nextResponses.apprenticeshipGrowthArea =
          apprenticeshipGrowthAreaDraft.trim();
      }
      if (apprenticeshipScenarioFeedbackDraft) {
        nextResponses.apprenticeshipScenarioFeedback =
          apprenticeshipScenarioFeedbackDraft;
      }
      if (apprenticeshipScenarioLaunchReadinessDraft) {
        nextResponses.apprenticeshipScenarioLaunchReadiness =
          apprenticeshipScenarioLaunchReadinessDraft;
      }
    }
    if (moduleId === 'setupChecklist') {
      if (setupChecklistDraft.length > 0) {
        nextResponses.setupReadinessAcknowledgedItems = setupChecklistDraft;
      }
      if (setupConfidenceAreaDraft) {
        nextResponses.setupConfidenceArea = setupConfidenceAreaDraft;
      }
      if (setupHelpAreaDraft.trim()) {
        nextResponses.setupHelpArea = setupHelpAreaDraft.trim();
      }
      if (setupScenarioUntestedToolDraft) {
        nextResponses.setupScenarioUntestedTool =
          setupScenarioUntestedToolDraft;
      }
    }
    if (moduleId === 'agreement') {
      // Phase 10B — persist review + signing intent state onto coach_launch.
      // The actual signature record lives in coach_agreements/{coachId}.
      nextResponses.agreementReviewedSectionIds =
        agreementReviewedSectionIdsDraft;
      nextResponses.agreementTermsAccepted = agreementTermsAcceptedDraft;
      nextResponses.agreementElectronicConsentAccepted =
        agreementElectronicConsentDraft;
      if (agreementFirstNameDraft.trim()) {
        nextResponses.agreementCoachFirstName =
          agreementFirstNameDraft.trim();
      }
      if (agreementLastNameDraft.trim()) {
        nextResponses.agreementCoachLastName = agreementLastNameDraft.trim();
      }
      nextResponses.agreementSignedVersion = COACH_AGREEMENT_VERSION;
    }

    const nextCompleted = alreadyComplete ? completed : [...completed, moduleId];
    // Point currentModuleId at the next un-completed module (or same if this was the last)
    const nextCurrent =
      MODULES.find((m) => !nextCompleted.includes(m.id))?.id ?? moduleId;

    await save({
      completedModuleIds: nextCompleted,
      currentModuleId: nextCurrent,
      responses: nextResponses,
    });
    // Scroll back to the module the coach just completed so they see the
    // "Complete" transition land. Also mark it as just-completed so the
    // check circle animates in with a satisfying pop.
    setJustCompletedId(moduleId);
    setPendingScrollTarget(moduleId);
    setActiveModuleId(null);
  }

  // ── Phase 10B — Coach Agreement submit ──────────────────────────────────────
  async function submitCoachAgreement() {
    if (!coachId || !progress) return;
    if (signedAgreement) return; // already signed — client-immutable
    if (!isSigningAsSelf) {
      // Admin impersonation cannot sign — legal signature must come from
      // the actual coach account owner. Firestore rules also enforce
      // this at the create layer.
      setAgreementSubmitError(
        'Agreement must be signed by the coach account owner. Exit ' +
          'impersonation and have the coach sign from their own account.'
      );
      return;
    }
    const first = agreementFirstNameDraft.trim();
    const last = agreementLastNameDraft.trim();
    const allReviewed = COACH_AGREEMENT_SECTIONS.every((sec) =>
      agreementReviewedSectionIdsDraft.includes(sec.id)
    );
    if (
      !allReviewed ||
      !agreementTermsAcceptedDraft ||
      !agreementElectronicConsentDraft ||
      !first ||
      !last ||
      !agreementSignatureDraft
    ) {
      return;
    }
    setAgreementSubmitting(true);
    setAgreementSubmitError(null);
    try {
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, '0');
      const d = String(today.getDate()).padStart(2, '0');
      const clientSignedDate = `${y}-${m}-${d}`;
      const payload: any = {
        coachId,
        coachEmail: user?.email || '',
        coachFirstName: first,
        coachLastName: last,
        typedName: `${first} ${last}`.trim(),
        agreementType: 'coach-program-terms',
        agreementTitle: COACH_AGREEMENT_TITLE,
        agreementVersion: COACH_AGREEMENT_VERSION,
        reviewedSectionIds: [...agreementReviewedSectionIdsDraft],
        termsAccepted: true,
        electronicConsentAccepted: true,
        electronicConsentAcceptedAt: serverTimestamp(),
        signatureDataUrl: agreementSignatureDraft,
        signedAt: serverTimestamp(),
        clientSignedDate,
        status: 'signed',
        sourceUrl: COACH_AGREEMENT_SOURCE_URL,
      };
      await setDoc(doc(db, 'coach_agreements', coachId), payload);
      setSignedAgreement({
        ...payload,
        signedAt: today,
        electronicConsentAcceptedAt: today,
      });
      // Persist Coach Launch response + mark module complete + unlock next.
      const nextResponses = { ...progress.responses };
      nextResponses.agreementReviewedSectionIds = [
        ...agreementReviewedSectionIdsDraft,
      ];
      nextResponses.agreementTermsAccepted = true;
      nextResponses.agreementElectronicConsentAccepted = true;
      nextResponses.agreementCoachFirstName = first;
      nextResponses.agreementCoachLastName = last;
      nextResponses.agreementSignedVersion = COACH_AGREEMENT_VERSION;
      nextResponses.agreementSignedAt = serverTimestamp();
      const alreadyComplete = completed.includes('agreement');
      const nextCompleted = alreadyComplete
        ? completed
        : [...completed, 'agreement' as ModuleId];
      const nextCurrent =
        MODULES.find((mm) => !nextCompleted.includes(mm.id))?.id ??
        'agreement';
      await save({
        completedModuleIds: nextCompleted,
        currentModuleId: nextCurrent,
        responses: nextResponses,
      });
    } catch (err: any) {
      console.error('[CoachLaunch] agreement submit error:', err);
      setAgreementSubmitError(
        err?.message ||
          'Something went wrong saving your signed agreement. Please try again.'
      );
    } finally {
      setAgreementSubmitting(false);
    }
  }

  // Clear the just-completed highlight after the animation has had time to play.
  useEffect(() => {
    if (!justCompletedId) return;
    const t = setTimeout(() => setJustCompletedId(null), 2400);
    return () => clearTimeout(t);
  }, [justCompletedId]);

  // When opening a module, snap to the top so the hero is visible.
  useEffect(() => {
    if (!activeModuleId) return;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [activeModuleId]);

  // After returning to the list with a pending scroll target, wait for
  // layout to settle then scroll the next-incomplete module into view.
  useEffect(() => {
    if (activeModuleId || !pendingScrollTarget) return;
    let cancelled = false;
    let retries = 6;
    const attempt = () => {
      if (cancelled) return;
      const listY = moduleListYRef.current;
      const cardY = moduleCardYsRef.current[pendingScrollTarget];
      if (listY != null && cardY != null && scrollRef.current) {
        const targetY = Math.max(0, listY + cardY - 12);
        scrollRef.current.scrollTo({ y: targetY, animated: true });
        setPendingScrollTarget(null);
        return;
      }
      if (retries-- > 0) {
        setTimeout(attempt, 60);
      } else {
        setPendingScrollTarget(null);
      }
    };
    const t = setTimeout(attempt, 60);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [activeModuleId, pendingScrollTarget]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={s.container}>
        <ActivityIndicator color={GOLD} style={{ marginTop: 80 }} />
      </View>
    );
  }

  const activeModule = activeModuleId ? MODULES.find((m) => m.id === activeModuleId) : null;

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={[s.header, { paddingTop: Math.max(Platform.OS === 'web' ? 12 : 56, insets.top) }]}>
        <Pressable
          onPress={() => (activeModule ? setActiveModuleId(null) : router.back())}
          style={s.backBtn}
          hitSlop={10}
        >
          <Text style={s.backText}>{'‹ Back'}</Text>
        </Pressable>
        <Text style={s.headerTitle}>Coach Launch</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {activeModule ? (
          <ModuleDetail
            module={activeModule}
            isComplete={completed.includes(activeModule.id)}
            saving={saving}
            welcomeAcceptedDraft={welcomeAcceptedDraft}
            setWelcomeAcceptedDraft={setWelcomeAcceptedDraft}
            visionDraft={visionDraft}
            setVisionDraft={setVisionDraft}
            visionExcitementDraft={visionExcitementDraft}
            setVisionExcitementDraft={setVisionExcitementDraft}
            naturalPillarDraft={naturalPillarDraft}
            setNaturalPillarDraft={setNaturalPillarDraft}
            growthPillarDraft={growthPillarDraft}
            setGrowthPillarDraft={setGrowthPillarDraft}
            memberFeelingGoalDraft={memberFeelingGoalDraft}
            setMemberFeelingGoalDraft={setMemberFeelingGoalDraft}
            scenarioSlippingDraft={scenarioSlippingDraft}
            setScenarioSlippingDraft={setScenarioSlippingDraft}
            scenarioCoachFitDraft={scenarioCoachFitDraft}
            setScenarioCoachFitDraft={setScenarioCoachFitDraft}
            memberFirstInteractionGoalDraft={memberFirstInteractionGoalDraft}
            setMemberFirstInteractionGoalDraft={setMemberFirstInteractionGoalDraft}
            memberExperienceScenarioDraft={memberExperienceScenarioDraft}
            setMemberExperienceScenarioDraft={setMemberExperienceScenarioDraft}
            coachExperienceMostHelpfulDraft={coachExperienceMostHelpfulDraft}
            setCoachExperienceMostHelpfulDraft={setCoachExperienceMostHelpfulDraft}
            coachCommandCenterHabitDraft={coachCommandCenterHabitDraft}
            setCoachCommandCenterHabitDraft={setCoachCommandCenterHabitDraft}
            coachExperienceScenarioDraft={coachExperienceScenarioDraft}
            setCoachExperienceScenarioDraft={setCoachExperienceScenarioDraft}
            coachingPostureGoalDraft={coachingPostureGoalDraft}
            setCoachingPostureGoalDraft={setCoachingPostureGoalDraft}
            coachingCommunicationHabitDraft={coachingCommunicationHabitDraft}
            setCoachingCommunicationHabitDraft={setCoachingCommunicationHabitDraft}
            howWeCoachScenarioUnsafeDraft={howWeCoachScenarioUnsafeDraft}
            setHowWeCoachScenarioUnsafeDraft={setHowWeCoachScenarioUnsafeDraft}
            howWeCoachScenarioMissedDraft={howWeCoachScenarioMissedDraft}
            setHowWeCoachScenarioMissedDraft={setHowWeCoachScenarioMissedDraft}
            moneyGrowthInterestDraft={moneyGrowthInterestDraft}
            setMoneyGrowthInterestDraft={setMoneyGrowthInterestDraft}
            moneyGrowthQuestionDraft={moneyGrowthQuestionDraft}
            setMoneyGrowthQuestionDraft={setMoneyGrowthQuestionDraft}
            moneyGrowthScenarioTierDraft={moneyGrowthScenarioTierDraft}
            setMoneyGrowthScenarioTierDraft={setMoneyGrowthScenarioTierDraft}
            moneyGrowthScenarioReferralDraft={moneyGrowthScenarioReferralDraft}
            setMoneyGrowthScenarioReferralDraft={setMoneyGrowthScenarioReferralDraft}
            apprenticeshipExcitementPhaseDraft={apprenticeshipExcitementPhaseDraft}
            setApprenticeshipExcitementPhaseDraft={setApprenticeshipExcitementPhaseDraft}
            apprenticeshipGrowthAreaDraft={apprenticeshipGrowthAreaDraft}
            setApprenticeshipGrowthAreaDraft={setApprenticeshipGrowthAreaDraft}
            apprenticeshipScenarioFeedbackDraft={apprenticeshipScenarioFeedbackDraft}
            setApprenticeshipScenarioFeedbackDraft={setApprenticeshipScenarioFeedbackDraft}
            apprenticeshipScenarioLaunchReadinessDraft={apprenticeshipScenarioLaunchReadinessDraft}
            setApprenticeshipScenarioLaunchReadinessDraft={setApprenticeshipScenarioLaunchReadinessDraft}
            setupChecklistDraft={setupChecklistDraft}
            setSetupChecklistDraft={setSetupChecklistDraft}
            setupConfidenceAreaDraft={setupConfidenceAreaDraft}
            setSetupConfidenceAreaDraft={setSetupConfidenceAreaDraft}
            setupHelpAreaDraft={setupHelpAreaDraft}
            setSetupHelpAreaDraft={setSetupHelpAreaDraft}
            setupScenarioUntestedToolDraft={setupScenarioUntestedToolDraft}
            setSetupScenarioUntestedToolDraft={setSetupScenarioUntestedToolDraft}
            agreementUrl={agreementUrl}
            agreementOpenedDraft={agreementOpenedDraft}
            setAgreementOpenedDraft={setAgreementOpenedDraft}
            agreementNotReplacementDraft={agreementNotReplacementDraft}
            setAgreementNotReplacementDraft={setAgreementNotReplacementDraft}
            agreementSignatureRequiredDraft={agreementSignatureRequiredDraft}
            setAgreementSignatureRequiredDraft={setAgreementSignatureRequiredDraft}
            agreementOpenedAcknowledgedDraft={agreementOpenedAcknowledgedDraft}
            setAgreementOpenedAcknowledgedDraft={setAgreementOpenedAcknowledgedDraft}
            onAgreementOpened={() => {
              setAgreementOpenedDraft(true);
              save({
                responses: {
                  agreementOpened: true,
                  agreementOpenedAt: serverTimestamp(),
                },
              });
            }}
            agreementReviewedSectionIdsDraft={
              agreementReviewedSectionIdsDraft
            }
            setAgreementReviewedSectionIdsDraft={
              setAgreementReviewedSectionIdsDraft
            }
            agreementTermsAcceptedDraft={agreementTermsAcceptedDraft}
            setAgreementTermsAcceptedDraft={setAgreementTermsAcceptedDraft}
            agreementElectronicConsentDraft={agreementElectronicConsentDraft}
            setAgreementElectronicConsentDraft={
              setAgreementElectronicConsentDraft
            }
            agreementFirstNameDraft={agreementFirstNameDraft}
            setAgreementFirstNameDraft={setAgreementFirstNameDraft}
            agreementLastNameDraft={agreementLastNameDraft}
            setAgreementLastNameDraft={setAgreementLastNameDraft}
            agreementSignatureDraft={agreementSignatureDraft}
            setAgreementSignatureDraft={setAgreementSignatureDraft}
            agreementExpandedSectionId={agreementExpandedSectionId}
            setAgreementExpandedSectionId={setAgreementExpandedSectionId}
            agreementSubmitting={agreementSubmitting}
            agreementSubmitError={agreementSubmitError}
            signedAgreement={signedAgreement}
            onSubmitAgreement={submitCoachAgreement}
            isSigningAsSelf={isSigningAsSelf}
            onComplete={() => completeModule(activeModule.id)}
            onBack={() => setActiveModuleId(null)}
            onFinish={() => router.replace('/(app)/dashboard' as any)}
            scrollRef={scrollRef}
          />
        ) : (
          <LaunchIndex
            pct={pct}
            completedCount={completed.length}
            totalCount={MODULES.length}
            allDone={allDone}
            nextIncomplete={nextIncomplete}
            statusFor={statusFor}
            isUnlocked={isUnlocked}
            justCompletedId={justCompletedId}
            onOpenModule={(id) => setActiveModuleId(id)}
            onListLayout={(y) => {
              moduleListYRef.current = y;
            }}
            onCardLayout={(id, y) => {
              moduleCardYsRef.current[id] = y;
            }}
          />
        )}
      </ScrollView>
    </View>
  );
}

// ── Launch index (module list) ─────────────────────────────────────────────────

interface LaunchIndexProps {
  pct: number;
  completedCount: number;
  totalCount: number;
  allDone: boolean;
  nextIncomplete: ModuleDef | null;
  statusFor: (id: ModuleId) => 'complete' | 'ready' | 'locked';
  isUnlocked: (id: ModuleId) => boolean;
  justCompletedId: ModuleId | null;
  onOpenModule: (id: ModuleId) => void;
  onListLayout: (y: number) => void;
  onCardLayout: (id: ModuleId, y: number) => void;
}

function LaunchIndex({
  pct,
  completedCount,
  totalCount,
  allDone,
  nextIncomplete,
  statusFor,
  isUnlocked,
  justCompletedId,
  onOpenModule,
  onListLayout,
  onCardLayout,
}: LaunchIndexProps) {
  return (
    <>
      {/* Intro */}
      <View style={s.intro}>
        <Text style={s.introSuper}>YOUR GUIDED JOURNEY</Text>
        <Text style={s.introHeading}>Coach Launch</Text>
        <Text style={s.introBody}>
          Your path into the G➲A coaching culture, systems, standards, and launch process.
        </Text>
      </View>

      {/* Progress card */}
      <View style={s.progressCard}>
        <View style={s.progressTopRow}>
          <View>
            <Text style={s.progressLabel}>PROGRESS</Text>
            <Text style={s.progressValue}>{pct}%</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.progressLabel}>MODULES</Text>
            <Text style={s.progressValue}>
              {completedCount}/{totalCount}
            </Text>
          </View>
        </View>
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: `${pct}%` as any }]} />
        </View>

        {allDone ? (
          <View style={s.currentStep}>
            <Icon name="check-circle" size={16} color={GREEN} />
            <Text style={[s.currentStepText, { color: GREEN }]}>Launch complete.</Text>
          </View>
        ) : nextIncomplete ? (
          <View style={s.currentStep}>
            <Icon name="play" size={16} color={GOLD} />
            <Text style={s.currentStepText}>
              Next up: <Text style={{ color: FG, fontWeight: '700' }}>{nextIncomplete.title}</Text>
            </Text>
          </View>
        ) : null}

        {nextIncomplete && (
          <Pressable
            style={s.continueBtn}
            onPress={() => onOpenModule(nextIncomplete.id)}
          >
            <Text style={s.continueBtnText}>
              {completedCount === 0 ? 'Start Launch' : 'Continue Launch'}
            </Text>
            <Icon name="chevron-right" size={16} color="#0E1117" />
          </Pressable>
        )}
      </View>

      {/* Module list */}
      <View
        style={s.moduleList}
        onLayout={(e) => onListLayout(e.nativeEvent.layout.y)}
      >
        {MODULES.map((m) => {
          const status = statusFor(m.id);
          const unlocked = isUnlocked(m.id);
          const isComplete = status === 'complete';
          return (
            <Pressable
              key={m.id}
              onPress={() => unlocked && onOpenModule(m.id)}
              disabled={!unlocked}
              onLayout={(e) => onCardLayout(m.id, e.nativeEvent.layout.y)}
              style={({ pressed }) => [
                s.moduleCard,
                pressed && unlocked && s.moduleCardPressed,
                !unlocked && s.moduleCardLocked,
                isComplete && s.moduleCardComplete,
              ]}
            >
              <View style={s.moduleNumberWrap}>
                {isComplete ? (
                  <AnimatedCheckCircle animate={justCompletedId === m.id} />
                ) : (
                  <Text
                    style={[
                      s.moduleNumber,
                      status === 'locked' && { color: MUTED },
                    ]}
                  >
                    {String(m.number).padStart(2, '0')}
                  </Text>
                )}
              </View>

              <View style={s.moduleBody}>
                <Text
                  style={[
                    s.moduleTitle,
                    status === 'locked' && { color: MUTED },
                    isComplete && { color: GREEN },
                  ]}
                >
                  {m.title}
                </Text>
                <Text
                  style={s.moduleDesc}
                  numberOfLines={2}
                >
                  {m.description}
                </Text>
                <Text style={s.moduleMeta}>{m.estimatedTime}</Text>
              </View>

              <View style={s.moduleRight}>
                <StatusBadge status={status} />
              </View>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

function AnimatedCheckCircle({ animate }: { animate: boolean }) {
  const scale = useRef(new Animated.Value(animate ? 0.4 : 1)).current;
  useEffect(() => {
    if (!animate) return;
    Animated.spring(scale, {
      toValue: 1,
      friction: 4,
      tension: 140,
      useNativeDriver: true,
    }).start();
  }, [animate, scale]);
  return (
    <Animated.View style={[s.moduleCheckCircle, { transform: [{ scale }] }]}>
      <Icon name="check" size={14} color="#0E1117" />
    </Animated.View>
  );
}

function StatusBadge({ status }: { status: 'complete' | 'ready' | 'locked' }) {
  if (status === 'complete') {
    return (
      <View style={[s.badge, { backgroundColor: 'rgba(110,187,122,0.12)', borderColor: 'rgba(110,187,122,0.4)' }]}>
        <Icon name="check" size={11} color={GREEN} />
        <Text style={[s.badgeText, { color: GREEN }]}>Complete</Text>
      </View>
    );
  }
  if (status === 'ready') {
    return (
      <View style={[s.badge, { backgroundColor: 'rgba(245,166,35,0.10)', borderColor: 'rgba(245,166,35,0.35)' }]}>
        <Text style={[s.badgeText, { color: GOLD }]}>Ready</Text>
      </View>
    );
  }
  return (
    <View style={[s.badge, { backgroundColor: 'rgba(138,149,163,0.08)', borderColor: 'rgba(138,149,163,0.25)' }]}>
      <Icon name="lock" size={11} color={MUTED} />
      <Text style={[s.badgeText, { color: MUTED }]}>Locked</Text>
    </View>
  );
}

// ── Module detail view ────────────────────────────────────────────────────────

interface ModuleDetailProps {
  module: ModuleDef;
  isComplete: boolean;
  saving: boolean;
  welcomeAcceptedDraft: boolean;
  setWelcomeAcceptedDraft: (v: boolean) => void;
  visionDraft: string;
  setVisionDraft: (v: string) => void;
  visionExcitementDraft: string;
  setVisionExcitementDraft: (v: string) => void;
  naturalPillarDraft: string;
  setNaturalPillarDraft: (v: string) => void;
  growthPillarDraft: string;
  setGrowthPillarDraft: (v: string) => void;
  memberFeelingGoalDraft: string;
  setMemberFeelingGoalDraft: (v: string) => void;
  scenarioSlippingDraft: string;
  setScenarioSlippingDraft: (v: string) => void;
  scenarioCoachFitDraft: string;
  setScenarioCoachFitDraft: (v: string) => void;
  memberFirstInteractionGoalDraft: string;
  setMemberFirstInteractionGoalDraft: (v: string) => void;
  memberExperienceScenarioDraft: string;
  setMemberExperienceScenarioDraft: (v: string) => void;
  coachExperienceMostHelpfulDraft: string;
  setCoachExperienceMostHelpfulDraft: (v: string) => void;
  coachCommandCenterHabitDraft: string;
  setCoachCommandCenterHabitDraft: (v: string) => void;
  coachExperienceScenarioDraft: string;
  setCoachExperienceScenarioDraft: (v: string) => void;
  coachingPostureGoalDraft: string;
  setCoachingPostureGoalDraft: (v: string) => void;
  coachingCommunicationHabitDraft: string;
  setCoachingCommunicationHabitDraft: (v: string) => void;
  howWeCoachScenarioUnsafeDraft: string;
  setHowWeCoachScenarioUnsafeDraft: (v: string) => void;
  howWeCoachScenarioMissedDraft: string;
  setHowWeCoachScenarioMissedDraft: (v: string) => void;
  moneyGrowthInterestDraft: string;
  setMoneyGrowthInterestDraft: (v: string) => void;
  moneyGrowthQuestionDraft: string;
  setMoneyGrowthQuestionDraft: (v: string) => void;
  moneyGrowthScenarioTierDraft: string;
  setMoneyGrowthScenarioTierDraft: (v: string) => void;
  moneyGrowthScenarioReferralDraft: string;
  setMoneyGrowthScenarioReferralDraft: (v: string) => void;
  apprenticeshipExcitementPhaseDraft: string;
  setApprenticeshipExcitementPhaseDraft: (v: string) => void;
  apprenticeshipGrowthAreaDraft: string;
  setApprenticeshipGrowthAreaDraft: (v: string) => void;
  apprenticeshipScenarioFeedbackDraft: string;
  setApprenticeshipScenarioFeedbackDraft: (v: string) => void;
  apprenticeshipScenarioLaunchReadinessDraft: string;
  setApprenticeshipScenarioLaunchReadinessDraft: (v: string) => void;
  setupChecklistDraft: string[];
  setSetupChecklistDraft: React.Dispatch<React.SetStateAction<string[]>>;
  setupConfidenceAreaDraft: string;
  setSetupConfidenceAreaDraft: (v: string) => void;
  setupHelpAreaDraft: string;
  setSetupHelpAreaDraft: (v: string) => void;
  setupScenarioUntestedToolDraft: string;
  setSetupScenarioUntestedToolDraft: (v: string) => void;
  agreementUrl: string;
  agreementOpenedDraft: boolean;
  setAgreementOpenedDraft: (v: boolean) => void;
  agreementNotReplacementDraft: boolean;
  setAgreementNotReplacementDraft: (v: boolean) => void;
  agreementSignatureRequiredDraft: boolean;
  setAgreementSignatureRequiredDraft: (v: boolean) => void;
  agreementOpenedAcknowledgedDraft: boolean;
  setAgreementOpenedAcknowledgedDraft: (v: boolean) => void;
  onAgreementOpened: () => void;
  // Phase 10B — in-app Coach Agreement signing
  agreementReviewedSectionIdsDraft: string[];
  setAgreementReviewedSectionIdsDraft: React.Dispatch<
    React.SetStateAction<string[]>
  >;
  agreementTermsAcceptedDraft: boolean;
  setAgreementTermsAcceptedDraft: (v: boolean) => void;
  agreementElectronicConsentDraft: boolean;
  setAgreementElectronicConsentDraft: (v: boolean) => void;
  agreementFirstNameDraft: string;
  setAgreementFirstNameDraft: (v: string) => void;
  agreementLastNameDraft: string;
  setAgreementLastNameDraft: (v: string) => void;
  agreementSignatureDraft: string;
  setAgreementSignatureDraft: (v: string) => void;
  agreementExpandedSectionId: string | null;
  setAgreementExpandedSectionId: (v: string | null) => void;
  agreementSubmitting: boolean;
  agreementSubmitError: string | null;
  signedAgreement: {
    coachFirstName?: string;
    coachLastName?: string;
    typedName?: string;
    agreementVersion?: string;
    agreementTitle?: string;
    signedAt?: any;
    clientSignedDate?: string;
    reviewedSectionIds?: string[];
    signatureDataUrl?: string;
    status?: string;
  } | null;
  onSubmitAgreement: () => void;
  isSigningAsSelf: boolean;
  onComplete: () => void;
  onBack: () => void;
  onFinish: () => void;
  scrollRef: React.RefObject<ScrollView | null>;
}

function ModuleDetail({
  module,
  isComplete,
  saving,
  welcomeAcceptedDraft,
  setWelcomeAcceptedDraft,
  visionDraft,
  setVisionDraft,
  visionExcitementDraft,
  setVisionExcitementDraft,
  naturalPillarDraft,
  setNaturalPillarDraft,
  growthPillarDraft,
  setGrowthPillarDraft,
  memberFeelingGoalDraft,
  setMemberFeelingGoalDraft,
  scenarioSlippingDraft,
  setScenarioSlippingDraft,
  scenarioCoachFitDraft,
  setScenarioCoachFitDraft,
  memberFirstInteractionGoalDraft,
  setMemberFirstInteractionGoalDraft,
  memberExperienceScenarioDraft,
  setMemberExperienceScenarioDraft,
  coachExperienceMostHelpfulDraft,
  setCoachExperienceMostHelpfulDraft,
  coachCommandCenterHabitDraft,
  setCoachCommandCenterHabitDraft,
  coachExperienceScenarioDraft,
  setCoachExperienceScenarioDraft,
  coachingPostureGoalDraft,
  setCoachingPostureGoalDraft,
  coachingCommunicationHabitDraft,
  setCoachingCommunicationHabitDraft,
  howWeCoachScenarioUnsafeDraft,
  setHowWeCoachScenarioUnsafeDraft,
  howWeCoachScenarioMissedDraft,
  setHowWeCoachScenarioMissedDraft,
  moneyGrowthInterestDraft,
  setMoneyGrowthInterestDraft,
  moneyGrowthQuestionDraft,
  setMoneyGrowthQuestionDraft,
  moneyGrowthScenarioTierDraft,
  setMoneyGrowthScenarioTierDraft,
  moneyGrowthScenarioReferralDraft,
  setMoneyGrowthScenarioReferralDraft,
  apprenticeshipExcitementPhaseDraft,
  setApprenticeshipExcitementPhaseDraft,
  apprenticeshipGrowthAreaDraft,
  setApprenticeshipGrowthAreaDraft,
  apprenticeshipScenarioFeedbackDraft,
  setApprenticeshipScenarioFeedbackDraft,
  apprenticeshipScenarioLaunchReadinessDraft,
  setApprenticeshipScenarioLaunchReadinessDraft,
  setupChecklistDraft,
  setSetupChecklistDraft,
  setupConfidenceAreaDraft,
  setSetupConfidenceAreaDraft,
  setupHelpAreaDraft,
  setSetupHelpAreaDraft,
  setupScenarioUntestedToolDraft,
  setSetupScenarioUntestedToolDraft,
  agreementUrl,
  agreementOpenedDraft,
  setAgreementOpenedDraft,
  agreementNotReplacementDraft,
  setAgreementNotReplacementDraft,
  agreementSignatureRequiredDraft,
  setAgreementSignatureRequiredDraft,
  agreementOpenedAcknowledgedDraft,
  setAgreementOpenedAcknowledgedDraft,
  onAgreementOpened,
  agreementReviewedSectionIdsDraft,
  setAgreementReviewedSectionIdsDraft,
  agreementTermsAcceptedDraft,
  setAgreementTermsAcceptedDraft,
  agreementElectronicConsentDraft,
  setAgreementElectronicConsentDraft,
  agreementFirstNameDraft,
  setAgreementFirstNameDraft,
  agreementLastNameDraft,
  setAgreementLastNameDraft,
  agreementSignatureDraft,
  setAgreementSignatureDraft,
  agreementExpandedSectionId,
  setAgreementExpandedSectionId,
  agreementSubmitting,
  agreementSubmitError,
  signedAgreement,
  onSubmitAgreement,
  isSigningAsSelf,
  onComplete,
  onBack,
  onFinish,
  scrollRef,
}: ModuleDetailProps) {
  const signedAgreementSigned =
    !!signedAgreement && signedAgreement.status === 'signed';
  // Launch Celebration is its own layout
  if (module.id === 'launchCelebration') {
    return (
      <View style={s.celebrateCard}>
        <View style={s.celebrateBadge}>
          <Icon name="star-filled" size={32} color={GOLD} />
        </View>
        <Text style={s.celebrateHeading}>Welcome to the team.</Text>
        <Text style={s.celebrateBody}>
          You've completed the first pass through Coach Launch. Your next step is to keep
          building skill, confidence, and member readiness through apprenticeship and
          ongoing support.
        </Text>
        {!isComplete && (
          <Pressable
            style={[s.primaryBtn, saving && s.btnDisabled]}
            onPress={onComplete}
            disabled={saving}
          >
            <Text style={s.primaryBtnText}>
              {saving ? 'Saving…' : 'Mark Complete'}
            </Text>
          </Pressable>
        )}
        <Pressable style={[s.primaryBtn, { marginTop: 10 }]} onPress={onFinish}>
          <Text style={s.primaryBtnText}>Go to Coach Dashboard</Text>
        </Pressable>
      </View>
    );
  }

  const canComplete = (() => {
    if (module.id === 'welcome') return welcomeAcceptedDraft === true;
    if (module.id === 'vision') {
      return visionDraft.trim().length > 0 && !!visionExcitementDraft;
    }
    if (module.id === 'culture') {
      return (
        !!naturalPillarDraft &&
        !!growthPillarDraft &&
        memberFeelingGoalDraft.trim().length > 0 &&
        scenarioSlippingDraft === 'C' &&
        scenarioCoachFitDraft === 'B'
      );
    }
    if (module.id === 'memberExperience') {
      return (
        memberFirstInteractionGoalDraft.trim().length > 0 &&
        memberExperienceScenarioDraft === 'C'
      );
    }
    if (module.id === 'coachExperience') {
      return (
        !!coachExperienceMostHelpfulDraft &&
        coachCommandCenterHabitDraft.trim().length > 0 &&
        coachExperienceScenarioDraft === 'C'
      );
    }
    if (module.id === 'howWeCoach') {
      return (
        !!coachingPostureGoalDraft &&
        coachingCommunicationHabitDraft.trim().length > 0 &&
        howWeCoachScenarioUnsafeDraft === 'B' &&
        howWeCoachScenarioMissedDraft === 'C'
      );
    }
    if (module.id === 'moneyGrowth') {
      return (
        !!moneyGrowthInterestDraft &&
        moneyGrowthQuestionDraft.trim().length > 0 &&
        moneyGrowthScenarioTierDraft === 'A' &&
        moneyGrowthScenarioReferralDraft === 'B'
      );
    }
    if (module.id === 'apprenticeshipPath') {
      return (
        !!apprenticeshipExcitementPhaseDraft &&
        apprenticeshipGrowthAreaDraft.trim().length > 0 &&
        apprenticeshipScenarioFeedbackDraft === 'C' &&
        apprenticeshipScenarioLaunchReadinessDraft === 'B'
      );
    }
    if (module.id === 'setupChecklist') {
      const allChecked = SETUP_CHECKLIST_ITEMS.every((item) =>
        setupChecklistDraft.includes(item.id)
      );
      return (
        allChecked &&
        !!setupConfidenceAreaDraft &&
        setupHelpAreaDraft.trim().length > 0 &&
        setupScenarioUntestedToolDraft === 'C'
      );
    }
    if (module.id === 'agreement') {
      // Complete requires a written signed agreement record.
      return signedAgreementSigned === true;
    }
    return true;
  })();

  return (
    <View style={s.detailWrap}>
      <View style={s.detailHeader}>
        <Text style={s.detailNumber}>MODULE {String(module.number).padStart(2, '0')}</Text>
        <Text style={s.detailTitle}>{module.title}</Text>
        <Text style={s.detailMeta}>{module.estimatedTime}</Text>
      </View>

      <View style={s.detailBody}>
        <Text style={s.detailIntro}>{module.intro}</Text>

        {/* Welcome — personal welcome + commitment */}
        {module.id === 'welcome' && (
          <>
            <View style={s.heroCard}>
              <Text style={s.heroEyebrow}>A NOTE FROM DEVIN</Text>
              <Text style={s.heroHeading}>Welcome to G➲A.</Text>
              <Text style={s.heroBody}>
                I'm glad you're here. Coach Launch is my way of walking you into
                GoArrive personally — the way I'd sit with a coach at a coffee
                shop the week before their first member session. Take your time,
                read carefully, and let each module actually land.
              </Text>
              <Text style={s.heroBody}>
                You're not filling out paperwork. You're stepping into a
                coaching culture. What you build here shapes the way real
                members experience their bodies, their consistency, and their
                confidence for years to come.
              </Text>
              <Text style={s.heroSignoff}>— Devin</Text>
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>What Coach Launch is</Text>
              <Text style={s.sectionBody}>
                Coach Launch is a short, guided path — not a form, not a legal
                checklist. It introduces the vision behind GoArrive, the culture
                we hold each other to, the way members experience the app, and
                the tools you'll use every day as a coach.
              </Text>
              <Text style={s.sectionBody}>
                Each module is small on purpose. Move through them in order.
                Your progress saves automatically.
              </Text>
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>What you'll walk through</Text>
              <View style={s.previewList}>
                {MODULES.slice(1).map((m) => (
                  <View key={m.id} style={s.previewRow}>
                    <Text style={s.previewNumber}>
                      {String(m.number).padStart(2, '0')}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.previewTitle}>{m.title}</Text>
                      <Text style={s.previewDesc}>{m.description}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>

            <Pressable
              style={s.commitmentCard}
              onPress={() => setWelcomeAcceptedDraft(!welcomeAcceptedDraft)}
            >
              <View
                style={[
                  s.checkbox,
                  welcomeAcceptedDraft && s.checkboxChecked,
                ]}
              >
                {welcomeAcceptedDraft && (
                  <Icon name="check" size={14} color="#0E1117" />
                )}
              </View>
              <Text style={s.commitmentText}>
                I'm ready to walk through Coach Launch with focus, humility, and
                a willingness to grow.
              </Text>
            </Pressable>
          </>
        )}

        {/* Vision — hero, story, free-text, excitement picker */}
        {module.id === 'vision' && (
          <>
            <View style={s.heroCard}>
              <Text style={s.heroEyebrow}>THE VISION</Text>
              <Text style={s.heroHeading}>
                We're building the future of fitness coaching.
              </Text>
              <Text style={s.heroBody}>
                Personalized. Technology-enabled. Warm. Built around real
                humans, not templates.
              </Text>
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>The problem</Text>
              <Text style={s.sectionBody}>
                Most fitness experiences fail members quietly. Cookie-cutter
                programs, disconnected apps, and transactional check-ins leave
                people alone with their bodies and their goals. Coaches who
                genuinely care get buried under admin work, scattered tools, and
                unclear compensation. Both sides deserve better.
              </Text>
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>What we're building</Text>
              <Text style={s.sectionBody}>
                GoArrive is one home for coach and member — personalized plans,
                block-based workouts, guided playback, reflection, and
                acknowledgment, all tied together by a coaching culture we
                actively protect. The technology carries the weight so the
                relationship can breathe.
              </Text>
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>Why coaches matter here</Text>
              <Text style={s.sectionBody}>
                Software doesn't change lives. Coaches do. Our job is to give
                you the systems, the support, and the growth-based earnings to
                make coaching a real long-term career — while you give members
                the presence, care, and consistency that changes how they see
                themselves.
              </Text>
            </View>

            <View style={s.responseBlock}>
              <Text style={s.responseLabel}>
                What part of the GoArrive vision connects with you most?
              </Text>
              <TextInput
                value={visionDraft}
                onChangeText={setVisionDraft}
                placeholder="Share a few sentences…"
                placeholderTextColor="#4A5568"
                multiline
                style={s.textArea}
              />
            </View>

            <View style={s.responseBlock}>
              <Text style={s.responseLabel}>
                When you think about becoming a GoArrive coach, what excites you
                most?
              </Text>
              <View style={s.optionList}>
                {VISION_EXCITEMENT_OPTIONS.map((opt) => {
                  const selected = visionExcitementDraft === opt;
                  return (
                    <Pressable
                      key={opt}
                      onPress={() => setVisionExcitementDraft(opt)}
                      style={[
                        s.optionRow,
                        selected && s.optionRowSelected,
                      ]}
                    >
                      <View
                        style={[
                          s.radio,
                          selected && s.radioSelected,
                        ]}
                      >
                        {selected && <View style={s.radioDot} />}
                      </View>
                      <Text
                        style={[
                          s.optionText,
                          selected && s.optionTextSelected,
                        ]}
                      >
                        {opt}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </>
        )}

        {/* Culture — hero, pillars, reflection, scenarios */}
        {module.id === 'culture' && (
          <>
            <View style={s.heroCard}>
              <Text style={s.heroEyebrow}>CULTURE</Text>
              <Text style={s.heroHeading}>
                Culture is how we coach when nobody is watching.
              </Text>
              <Text style={s.heroBody}>
                At G➲A, culture is not a poster. It is the way we show up for
                members, support fellow coaches, communicate under pressure,
                and protect the trust people place in us.
              </Text>
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>Before every tool, this.</Text>
              <Text style={s.sectionBody}>
                Before a coach learns every tool, workflow, or agreement, they
                need to understand the kind of community they are stepping
                into.
              </Text>
              <Text style={s.sectionBody}>
                GoArrive is building a support-driven coaching culture. That
                means we care about skill, but we also care about presence. We
                care about growth, but not at the expense of people. We care
                about excellence, but we do not confuse excellence with ego.
              </Text>
              <Text style={s.sectionBody}>
                These four pillars help shape how we lead:
              </Text>
            </View>

            <View style={{ gap: 10 }}>
              {CULTURE_PILLAR_DETAILS.map((p, i) => (
                <View key={p.name} style={s.pillarDetailCard}>
                  <View style={s.pillarDetailHeader}>
                    <Text style={s.pillarDetailNumber}>
                      {String(i + 1).padStart(2, '0')}
                    </Text>
                    <Text style={s.pillarDetailTitle}>{p.name}</Text>
                  </View>
                  <Text style={s.pillarDetailDef}>{p.definition}</Text>
                  <Text style={s.pillarDetailLabel}>WHAT IT LOOKS LIKE</Text>
                  {p.looksLike.map((item) => (
                    <View key={item} style={s.pillarBulletRow}>
                      <View style={s.pillarBulletDot} />
                      <Text style={s.pillarBulletText}>{item}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>

            <View style={s.responseBlock}>
              <Text style={s.responseLabel}>
                Which culture pillar feels most natural to you right now?
              </Text>
              <PillarPicker
                value={naturalPillarDraft}
                onChange={setNaturalPillarDraft}
              />
            </View>
            <View style={s.responseBlock}>
              <Text style={s.responseLabel}>
                Which culture pillar do you want to grow in most?
              </Text>
              <PillarPicker
                value={growthPillarDraft}
                onChange={setGrowthPillarDraft}
              />
            </View>

            <View style={s.responseBlock}>
              <Text style={s.responseLabel}>
                What is one way you want members to feel after interacting with
                you as their coach?
              </Text>
              <TextInput
                value={memberFeelingGoalDraft}
                onChangeText={setMemberFeelingGoalDraft}
                placeholder="A short reflection…"
                placeholderTextColor="#4A5568"
                multiline
                style={s.textArea}
              />
            </View>

            {CULTURE_SCENARIOS.map((scn) => {
              const selected =
                scn.key === 'memberSlipping'
                  ? scenarioSlippingDraft
                  : scenarioCoachFitDraft;
              const setSelected =
                scn.key === 'memberSlipping'
                  ? setScenarioSlippingDraft
                  : setScenarioCoachFitDraft;
              const isCorrect = selected === scn.correct;
              const isWrong = !!selected && !isCorrect;
              return (
                <View key={scn.key} style={s.responseBlock}>
                  <Text style={s.scenarioEyebrow}>{scn.eyebrow}</Text>
                  <Text style={s.responseLabel}>{scn.title}</Text>
                  <Text style={s.sectionBody}>{scn.prompt}</Text>
                  <View style={s.optionList}>
                    {scn.options.map((opt) => {
                      const picked = selected === opt.letter;
                      return (
                        <Pressable
                          key={opt.letter}
                          onPress={() => setSelected(opt.letter)}
                          style={[
                            s.optionRow,
                            picked && s.optionRowSelected,
                          ]}
                        >
                          <View
                            style={[
                              s.radio,
                              picked && s.radioSelected,
                            ]}
                          >
                            {picked && <View style={s.radioDot} />}
                          </View>
                          <Text style={s.scenarioLetter}>{opt.letter}.</Text>
                          <Text
                            style={[
                              s.optionText,
                              picked && s.optionTextSelected,
                            ]}
                          >
                            {opt.text}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {isCorrect && (
                    <View style={s.scenarioFeedbackCorrect}>
                      <Icon name="check-circle" size={16} color={GREEN} />
                      <Text style={s.scenarioFeedbackCorrectText}>
                        {scn.correctFeedback}
                      </Text>
                    </View>
                  )}
                  {isWrong && (
                    <View style={s.scenarioFeedbackTryAgain}>
                      <Text style={s.scenarioFeedbackTryAgainText}>
                        Not quite. Take another look — the answer that reflects
                        our culture leads with care for the member and honor
                        for the team. Try again.
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </>
        )}

        {/* Agreement — final acknowledgment: hero, recap, coverage cards, link CTA, clarity, checkboxes */}
        {module.id === 'agreement' && (
          <AgreementModule
            reviewedIds={agreementReviewedSectionIdsDraft}
            setReviewedIds={setAgreementReviewedSectionIdsDraft}
            termsAccepted={agreementTermsAcceptedDraft}
            setTermsAccepted={setAgreementTermsAcceptedDraft}
            electronicConsent={agreementElectronicConsentDraft}
            setElectronicConsent={setAgreementElectronicConsentDraft}
            firstName={agreementFirstNameDraft}
            setFirstName={setAgreementFirstNameDraft}
            lastName={agreementLastNameDraft}
            setLastName={setAgreementLastNameDraft}
            signatureDataUrl={agreementSignatureDraft}
            setSignatureDataUrl={setAgreementSignatureDraft}
            expandedSectionId={agreementExpandedSectionId}
            setExpandedSectionId={setAgreementExpandedSectionId}
            submitting={agreementSubmitting}
            submitError={agreementSubmitError}
            signedAgreement={signedAgreement}
            onSubmit={onSubmitAgreement}
            isSigningAsSelf={isSigningAsSelf}
            scrollRef={scrollRef}
          />
        )}

        {/* Member Experience — hero, journey timeline, needs cards, reflection, scenario */}
        {module.id === 'memberExperience' && (
          <>
            <View style={s.heroCard}>
              <Text style={s.heroEyebrow}>THE MEMBER EXPERIENCE</Text>
              <Text style={s.heroHeading}>
                See the journey through the member{'\u2019'}s eyes.
              </Text>
              <Text style={s.heroBody}>
                A great GoArrive coach does not just understand the tools. They
                understand what the member is feeling at each step —
                uncertainty, hope, friction, momentum, and the need for steady
                support.
              </Text>
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>Before coach workflows, this.</Text>
              <Text style={s.sectionBody}>
                Before we talk more about coach workflows, we need to look at
                the member experience.
              </Text>
              <Text style={s.sectionBody}>
                Members come to G➲A looking for more than random workouts. They
                are looking for clarity, structure, accountability, and a coach
                who helps them keep going when life gets busy.
              </Text>
              <Text style={s.sectionBody}>
                The better you understand the member journey, the better you
                can serve them with care and confidence.
              </Text>
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>The member journey.</Text>
              <Text style={s.sectionBody}>
                The path a member travels from first interest to long-term
                self-reliance.
              </Text>
            </View>

            <View style={s.timeline}>
              {MEMBER_JOURNEY_STEPS.map((step, i) => {
                const isLast = i === MEMBER_JOURNEY_STEPS.length - 1;
                return (
                  <View key={step.title} style={s.timelineRow}>
                    <View style={s.timelineLeft}>
                      <View style={s.timelineDot}>
                        <Text style={s.timelineDotNumber}>
                          {String(i + 1).padStart(2, '0')}
                        </Text>
                      </View>
                      {!isLast && <View style={s.timelineConnector} />}
                    </View>
                    <View style={s.timelineCard}>
                      <Text style={s.timelineStepEyebrow}>
                        STEP {String(i + 1).padStart(2, '0')}
                      </Text>
                      <Text style={s.timelineStepTitle}>{step.title}</Text>
                      <Text style={s.timelineStepBody}>{step.body}</Text>
                      <View style={s.coachFocusBox}>
                        <Text style={s.coachFocusLabel}>COACH FOCUS</Text>
                        <Text style={s.coachFocusText}>{step.coachFocus}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>
                What the member needs from the coach.
              </Text>
              <Text style={s.sectionBody}>
                Four things every member is quietly asking for.
              </Text>
            </View>

            <View style={{ gap: 10 }}>
              {MEMBER_NEEDS.map((n) => (
                <View key={n.title} style={s.needsCard}>
                  <Text style={s.needsTitle}>{n.title}</Text>
                  <Text style={s.needsBody}>{n.body}</Text>
                </View>
              ))}
            </View>

            <View style={s.responseBlock}>
              <Text style={s.responseLabel}>
                When a member is new and unsure, what do you want them to feel
                after their first interaction with you?
              </Text>
              <TextInput
                value={memberFirstInteractionGoalDraft}
                onChangeText={setMemberFirstInteractionGoalDraft}
                placeholder="A short reflection…"
                placeholderTextColor="#4A5568"
                multiline
                style={s.textArea}
              />
            </View>

            <View style={s.responseBlock}>
              <Text style={s.scenarioEyebrow}>
                {MEMBER_EXPERIENCE_SCENARIO.eyebrow}
              </Text>
              <Text style={s.responseLabel}>
                {MEMBER_EXPERIENCE_SCENARIO.title}
              </Text>
              <Text style={s.sectionBody}>
                {MEMBER_EXPERIENCE_SCENARIO.prompt}
              </Text>
              <View style={s.optionList}>
                {MEMBER_EXPERIENCE_SCENARIO.options.map((opt) => {
                  const picked =
                    memberExperienceScenarioDraft === opt.letter;
                  return (
                    <Pressable
                      key={opt.letter}
                      onPress={() =>
                        setMemberExperienceScenarioDraft(opt.letter)
                      }
                      style={[s.optionRow, picked && s.optionRowSelected]}
                    >
                      <View style={[s.radio, picked && s.radioSelected]}>
                        {picked && <View style={s.radioDot} />}
                      </View>
                      <Text style={s.scenarioLetter}>{opt.letter}.</Text>
                      <Text
                        style={[
                          s.optionText,
                          picked && s.optionTextSelected,
                        ]}
                      >
                        {opt.text}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {memberExperienceScenarioDraft ===
                MEMBER_EXPERIENCE_SCENARIO.correct && (
                <View style={s.scenarioFeedbackCorrect}>
                  <Icon name="check-circle" size={16} color={GREEN} />
                  <Text style={s.scenarioFeedbackCorrectText}>
                    {MEMBER_EXPERIENCE_SCENARIO.correctFeedback}
                  </Text>
                </View>
              )}
              {!!memberExperienceScenarioDraft &&
                memberExperienceScenarioDraft !==
                  MEMBER_EXPERIENCE_SCENARIO.correct && (
                  <View style={s.scenarioFeedbackTryAgain}>
                    <Text style={s.scenarioFeedbackTryAgainText}>
                      {MEMBER_EXPERIENCE_SCENARIO.wrongFeedback}
                    </Text>
                  </View>
                )}
            </View>
          </>
        )}

        {/* Coach Experience — Command Center tour, coach rhythm, reflection, scenario */}
        {module.id === 'coachExperience' && (
          <>
            <View style={s.heroCard}>
              <Text style={s.heroEyebrow}>THE COACH EXPERIENCE</Text>
              <Text style={s.heroHeading}>
                Your Command Center for coaching well.
              </Text>
              <Text style={s.heroBody}>
                GoArrive is designed to reduce scattered tools and help you see
                what matters: who you serve, what they need next, and how to
                keep them moving with clarity and care.
              </Text>
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>
                A strong coach needs a clear operating system.
              </Text>
              <Text style={s.sectionBody}>
                A strong coach does not need more chaos. A strong coach needs a
                clear operating system.
              </Text>
              <Text style={s.sectionBody}>
                The Coach Experience inside G➲A brings your member management,
                plan building, scheduling, movement resources, workout creation,
                feedback, and growth tools into one connected environment.
              </Text>
              <Text style={s.sectionBody}>
                The goal is not to make you stare at software all day. The goal
                is to help you coach with more focus, more consistency, and less
                friction.
              </Text>
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>Command Center tour.</Text>
              <Text style={s.sectionBody}>
                Eight areas of the Command Center and what each one is for.
              </Text>
            </View>

            <View style={{ gap: 10 }}>
              {COMMAND_CENTER_AREAS.map((area, i) => (
                <View key={COMMAND_CENTER_AREA_LABELS[i]} style={s.tourCard}>
                  <View style={s.tourCardHeader}>
                    <Text style={s.tourCardNumber}>
                      {String(i + 1).padStart(2, '0')}
                    </Text>
                    <Text style={s.tourCardArea}>
                      {COMMAND_CENTER_AREA_LABELS[i]}
                    </Text>
                  </View>
                  <Text style={s.tourCardTitle}>{area.title}</Text>
                  <Text style={s.tourCardBody}>{area.body}</Text>
                  <View style={s.coachFocusBox}>
                    <Text style={s.coachFocusLabel}>COACH FOCUS</Text>
                    <Text style={s.coachFocusText}>{area.coachFocus}</Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>
                A simple rhythm for coaching inside G➲A.
              </Text>
              <Text style={s.sectionBody}>
                Four moves you make on repeat.
              </Text>
            </View>

            <View style={s.rhythmGrid}>
              {COACH_RHYTHM.map((r, i) => (
                <View key={r.name} style={s.rhythmCard}>
                  <Text style={s.rhythmCardNumber}>
                    {String(i + 1).padStart(2, '0')}
                  </Text>
                  <Text style={s.rhythmCardName}>{r.name}</Text>
                  <Text style={s.rhythmCardBody}>{r.body}</Text>
                </View>
              ))}
            </View>

            <View style={s.responseBlock}>
              <Text style={s.responseLabel}>
                Which part of the Coach Experience do you think will help you
                serve members most effectively?
              </Text>
              <View style={s.optionList}>
                {COACH_EXPERIENCE_HELPFUL_OPTIONS.map((opt) => {
                  const picked = coachExperienceMostHelpfulDraft === opt;
                  return (
                    <Pressable
                      key={opt}
                      onPress={() => setCoachExperienceMostHelpfulDraft(opt)}
                      style={[s.optionRow, picked && s.optionRowSelected]}
                    >
                      <View style={[s.radio, picked && s.radioSelected]}>
                        {picked && <View style={s.radioDot} />}
                      </View>
                      <Text
                        style={[
                          s.optionText,
                          picked && s.optionTextSelected,
                        ]}
                      >
                        {opt}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={s.responseBlock}>
              <Text style={s.responseLabel}>
                What is one habit you want to build as you start using the
                GoArrive Command Center?
              </Text>
              <TextInput
                value={coachCommandCenterHabitDraft}
                onChangeText={setCoachCommandCenterHabitDraft}
                placeholder="A short reflection…"
                placeholderTextColor="#4A5568"
                multiline
                style={s.textArea}
              />
            </View>

            <View style={s.responseBlock}>
              <Text style={s.scenarioEyebrow}>
                {COACH_EXPERIENCE_SCENARIO.eyebrow}
              </Text>
              <Text style={s.responseLabel}>
                {COACH_EXPERIENCE_SCENARIO.title}
              </Text>
              <Text style={s.sectionBody}>
                {COACH_EXPERIENCE_SCENARIO.prompt}
              </Text>
              <View style={s.optionList}>
                {COACH_EXPERIENCE_SCENARIO.options.map((opt) => {
                  const picked = coachExperienceScenarioDraft === opt.letter;
                  return (
                    <Pressable
                      key={opt.letter}
                      onPress={() => setCoachExperienceScenarioDraft(opt.letter)}
                      style={[s.optionRow, picked && s.optionRowSelected]}
                    >
                      <View style={[s.radio, picked && s.radioSelected]}>
                        {picked && <View style={s.radioDot} />}
                      </View>
                      <Text style={s.scenarioLetter}>{opt.letter}.</Text>
                      <Text
                        style={[
                          s.optionText,
                          picked && s.optionTextSelected,
                        ]}
                      >
                        {opt.text}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {coachExperienceScenarioDraft ===
                COACH_EXPERIENCE_SCENARIO.correct && (
                <View style={s.scenarioFeedbackCorrect}>
                  <Icon name="check-circle" size={16} color={GREEN} />
                  <Text style={s.scenarioFeedbackCorrectText}>
                    {COACH_EXPERIENCE_SCENARIO.correctFeedback}
                  </Text>
                </View>
              )}
              {!!coachExperienceScenarioDraft &&
                coachExperienceScenarioDraft !==
                  COACH_EXPERIENCE_SCENARIO.correct && (
                  <View style={s.scenarioFeedbackTryAgain}>
                    <Text style={s.scenarioFeedbackTryAgainText}>
                      {COACH_EXPERIENCE_SCENARIO.wrongFeedback}
                    </Text>
                  </View>
                )}
            </View>
          </>
        )}

        {/* How We Coach — posture, coaching loop, examples, reflection, 2 scenarios */}
        {module.id === 'howWeCoach' && (
          <>
            <View style={s.heroCard}>
              <Text style={s.heroEyebrow}>HOW WE COACH</Text>
              <Text style={s.heroHeading}>
                Coaching is a posture, not a script.
              </Text>
              <Text style={s.heroBody}>
                Inside G➲A, how you show up matters as much as what you
                program. Members do not just remember the workout. They
                remember how you made them feel while they did it.
              </Text>
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>
                Coaching, defined by how it feels.
              </Text>
              <Text style={s.sectionBody}>
                A great coach knows the movement. A GoArrive coach also knows
                the moment — when to push, when to protect, when to slow down,
                and when to celebrate. This module is about that posture.
              </Text>
              <Text style={s.sectionBody}>
                These five postures shape every conversation, cue, plan
                adjustment, and message you send.
              </Text>
            </View>

            <View style={{ gap: 10 }}>
              {COACHING_POSTURES.map((p, i) => (
                <View key={p.name} style={s.postureCard}>
                  <Text style={s.postureCardNumber}>
                    {String(i + 1).padStart(2, '0')}
                  </Text>
                  <Text style={s.postureCardName}>{p.name}</Text>
                  <Text style={s.postureDefinition}>{p.definition}</Text>
                  <View style={s.soundsLikeBox}>
                    <Text style={s.soundsLikeLabel}>WHAT IT SOUNDS LIKE</Text>
                    <Text style={s.soundsLikeQuote}>{p.soundsLike}</Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>
                The coaching loop.
              </Text>
              <Text style={s.sectionBody}>
                Every session, message, and check-in inside G➲A follows the
                same four-step loop.
              </Text>
            </View>

            <View style={s.rhythmGrid}>
              {COACHING_LOOP.map((step, i) => (
                <View key={step.name} style={s.rhythmCard}>
                  <Text style={s.rhythmCardNumber}>
                    {String(i + 1).padStart(2, '0')}
                  </Text>
                  <Text style={s.rhythmCardName}>{step.name}</Text>
                  <Text style={s.rhythmCardBody}>{step.body}</Text>
                </View>
              ))}
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>
                What strong coaching looks like.
              </Text>
              <Text style={s.sectionBody}>
                Four everyday situations, and how a G➲A coach responds
                differently than the average.
              </Text>
            </View>

            <View style={{ gap: 10 }}>
              {COACHING_EXAMPLES.map((ex, i) => (
                <View key={ex.situation} style={s.exampleCard}>
                  <Text style={s.exampleNumber}>
                    {String(i + 1).padStart(2, '0')}
                  </Text>
                  <Text style={s.exampleSituation}>{ex.situation}</Text>
                  <View style={s.exampleWeakBox}>
                    <Text style={s.exampleWeakLabel}>WEAK RESPONSE</Text>
                    <Text style={s.exampleWeakText}>{ex.weak}</Text>
                  </View>
                  <View style={s.exampleGoaBox}>
                    <Text style={s.exampleGoaLabel}>G➲A RESPONSE</Text>
                    <Text style={s.exampleGoaText}>{ex.goa}</Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={s.responseBlock}>
              <Text style={s.responseLabel}>
                Which coaching posture do you most want to strengthen as a
                GoArrive coach?
              </Text>
              <View style={s.optionList}>
                {COACHING_POSTURE_OPTIONS.map((opt) => {
                  const picked = coachingPostureGoalDraft === opt;
                  return (
                    <Pressable
                      key={opt}
                      onPress={() => setCoachingPostureGoalDraft(opt)}
                      style={[s.optionRow, picked && s.optionRowSelected]}
                    >
                      <View style={[s.radio, picked && s.radioSelected]}>
                        {picked && <View style={s.radioDot} />}
                      </View>
                      <Text
                        style={[
                          s.optionText,
                          picked && s.optionTextSelected,
                        ]}
                      >
                        {opt}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={s.responseBlock}>
              <Text style={s.responseLabel}>
                What is one communication habit you want to build with your
                members?
              </Text>
              <TextInput
                value={coachingCommunicationHabitDraft}
                onChangeText={setCoachingCommunicationHabitDraft}
                placeholder="A short reflection…"
                placeholderTextColor="#4A5568"
                multiline
                style={s.textArea}
              />
            </View>

            <View style={s.responseBlock}>
              <Text style={s.scenarioEyebrow}>
                {HOW_WE_COACH_SCENARIO_UNSAFE.eyebrow}
              </Text>
              <Text style={s.responseLabel}>
                {HOW_WE_COACH_SCENARIO_UNSAFE.title}
              </Text>
              <Text style={s.sectionBody}>
                {HOW_WE_COACH_SCENARIO_UNSAFE.prompt}
              </Text>
              <View style={s.optionList}>
                {HOW_WE_COACH_SCENARIO_UNSAFE.options.map((opt) => {
                  const picked = howWeCoachScenarioUnsafeDraft === opt.letter;
                  return (
                    <Pressable
                      key={opt.letter}
                      onPress={() => setHowWeCoachScenarioUnsafeDraft(opt.letter)}
                      style={[s.optionRow, picked && s.optionRowSelected]}
                    >
                      <View style={[s.radio, picked && s.radioSelected]}>
                        {picked && <View style={s.radioDot} />}
                      </View>
                      <Text style={s.scenarioLetter}>{opt.letter}.</Text>
                      <Text
                        style={[
                          s.optionText,
                          picked && s.optionTextSelected,
                        ]}
                      >
                        {opt.text}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {howWeCoachScenarioUnsafeDraft ===
                HOW_WE_COACH_SCENARIO_UNSAFE.correct && (
                <View style={s.scenarioFeedbackCorrect}>
                  <Icon name="check-circle" size={16} color={GREEN} />
                  <Text style={s.scenarioFeedbackCorrectText}>
                    {HOW_WE_COACH_SCENARIO_UNSAFE.correctFeedback}
                  </Text>
                </View>
              )}
              {!!howWeCoachScenarioUnsafeDraft &&
                howWeCoachScenarioUnsafeDraft !==
                  HOW_WE_COACH_SCENARIO_UNSAFE.correct && (
                  <View style={s.scenarioFeedbackTryAgain}>
                    <Text style={s.scenarioFeedbackTryAgainText}>
                      {HOW_WE_COACH_SCENARIO_UNSAFE.wrongFeedback}
                    </Text>
                  </View>
                )}
            </View>

            <View style={s.responseBlock}>
              <Text style={s.scenarioEyebrow}>
                {HOW_WE_COACH_SCENARIO_MISSED.eyebrow}
              </Text>
              <Text style={s.responseLabel}>
                {HOW_WE_COACH_SCENARIO_MISSED.title}
              </Text>
              <Text style={s.sectionBody}>
                {HOW_WE_COACH_SCENARIO_MISSED.prompt}
              </Text>
              <View style={s.optionList}>
                {HOW_WE_COACH_SCENARIO_MISSED.options.map((opt) => {
                  const picked = howWeCoachScenarioMissedDraft === opt.letter;
                  return (
                    <Pressable
                      key={opt.letter}
                      onPress={() => setHowWeCoachScenarioMissedDraft(opt.letter)}
                      style={[s.optionRow, picked && s.optionRowSelected]}
                    >
                      <View style={[s.radio, picked && s.radioSelected]}>
                        {picked && <View style={s.radioDot} />}
                      </View>
                      <Text style={s.scenarioLetter}>{opt.letter}.</Text>
                      <Text
                        style={[
                          s.optionText,
                          picked && s.optionTextSelected,
                        ]}
                      >
                        {opt.text}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {howWeCoachScenarioMissedDraft ===
                HOW_WE_COACH_SCENARIO_MISSED.correct && (
                <View style={s.scenarioFeedbackCorrect}>
                  <Icon name="check-circle" size={16} color={GREEN} />
                  <Text style={s.scenarioFeedbackCorrectText}>
                    {HOW_WE_COACH_SCENARIO_MISSED.correctFeedback}
                  </Text>
                </View>
              )}
              {!!howWeCoachScenarioMissedDraft &&
                howWeCoachScenarioMissedDraft !==
                  HOW_WE_COACH_SCENARIO_MISSED.correct && (
                  <View style={s.scenarioFeedbackTryAgain}>
                    <Text style={s.scenarioFeedbackTryAgainText}>
                      {HOW_WE_COACH_SCENARIO_MISSED.wrongFeedback}
                    </Text>
                  </View>
                )}
            </View>
          </>
        )}

        {/* Money + Growth — education only: principles, tiers, cap, pathways, reflection, 2 scenarios */}
        {module.id === 'moneyGrowth' && (
          <>
            <View style={s.heroCard}>
              <Text style={s.heroEyebrow}>MONEY + GROWTH</Text>
              <Text style={s.heroHeading}>
                Growth should be clear, shared, and trackable.
              </Text>
              <Text style={s.heroBody}>
                Inside GoArrive, the money model is designed to reward member
                engagement, coaching growth, collaboration, and long-term
                contribution — while keeping the mission bigger than the money.
              </Text>
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>
                Coaches are stakeholders in G➲A's success.
              </Text>
              <Text style={s.sectionBody}>
                That means growth should not feel mysterious. You should
                understand how member count affects your progressive
                compensation, how the earnings cap rewards momentum, how
                referrals support collaboration, and how profit sharing creates
                opportunity for coaches who help build the coaching community.
              </Text>
              <Text style={s.sectionBody}>
                This module is not a live earnings calculator or a guarantee of
                income. It is a high-level guide to help you understand the
                structure before you review the formal agreement.
              </Text>
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>Growth principles.</Text>
              <Text style={s.sectionBody}>
                Four ideas that shape how the money model works.
              </Text>
            </View>

            <View style={{ gap: 10 }}>
              {GROWTH_PRINCIPLES.map((p, i) => (
                <View key={p.name} style={s.principleCard}>
                  <Text style={s.principleNumber}>
                    {String(i + 1).padStart(2, '0')}
                  </Text>
                  <Text style={s.principleName}>{p.name}</Text>
                  <Text style={s.principleDefinition}>{p.definition}</Text>
                  <Text style={s.principleBody}>{p.body}</Text>
                </View>
              ))}
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>
                Progressive compensation tiers.
              </Text>
              <Text style={s.sectionBody}>
                As your active member count grows, the coach share grows with
                it.
              </Text>
            </View>

            <View style={{ gap: 10 }}>
              {PROGRESSIVE_TIERS.map((t) => (
                <View key={t.title} style={s.tierCard}>
                  <Text style={s.tierCardTitle}>{t.title}</Text>
                  <Text style={s.tierCardRange}>{t.range}</Text>
                  <View style={s.tierSplitBox}>
                    <Text style={s.tierSplitLabel}>SPLIT</Text>
                    <Text style={s.tierSplitValue}>{t.split}</Text>
                  </View>
                  <Text style={s.tierCardBody}>{t.body}</Text>
                </View>
              ))}
            </View>

            <View style={s.fineNoteBox}>
              <Text style={s.fineNoteText}>
                Tier movement is based on active member count as reflected in
                GoArrive records. Tier changes apply according to the formal
                program terms and current system records.
              </Text>
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>
                The earnings cap rewards momentum.
              </Text>
              <Text style={s.sectionBody}>
                The earnings cap is a yearly threshold tied to first-year member
                revenue. Once a coach reaches the annual cap, the coach can
                retain 100% of additional eligible first-year member revenue for
                the applicable period, minus the monthly admin technology fee
                and subject to the formal program terms.
              </Text>
            </View>

            <View style={{ gap: 10 }}>
              {EARNINGS_CAP_CARDS.map((c) => (
                <View key={c.title} style={s.capCard}>
                  <Text style={s.capCardTitle}>{c.title}</Text>
                  <Text style={s.capCardBody}>{c.body}</Text>
                </View>
              ))}
            </View>

            <View style={s.fineNoteBox}>
              <Text style={s.fineNoteText}>
                Referral obligations and program rules can still apply after the
                cap is reached, as described in the formal agreement.
              </Text>
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>
                Ways growth can happen inside G➲A.
              </Text>
              <Text style={s.sectionBody}>
                Four pathways that shape long-term growth.
              </Text>
            </View>

            <View style={{ gap: 10 }}>
              {GROWTH_PATHWAYS.map((p, i) => (
                <View key={p.title} style={s.pathwayCard}>
                  <Text style={s.pathwayNumber}>
                    {String(i + 1).padStart(2, '0')}
                  </Text>
                  <Text style={s.pathwayTitle}>{p.title}</Text>
                  <Text style={s.pathwayBody}>{p.body}</Text>
                  {p.rule && (
                    <View style={s.pathwayRuleBox}>
                      <Text style={s.pathwayRuleLabel}>KEY RULE</Text>
                      <Text style={s.pathwayRuleText}>{p.rule}</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>
                What this module is — and is not.
              </Text>
              <Text style={s.sectionBody}>
                A quick clarity check before you keep going.
              </Text>
            </View>

            <View style={s.clarityCard}>
              {MONEY_GROWTH_CLARITY_POINTS.map((point) => (
                <View key={point} style={s.clarityRow}>
                  <Text style={s.clarityBullet}>•</Text>
                  <Text style={s.clarityText}>{point}</Text>
                </View>
              ))}
            </View>

            <View style={s.responseBlock}>
              <Text style={s.responseLabel}>
                Which part of the GoArrive growth model are you most interested
                in learning more about?
              </Text>
              <View style={s.optionList}>
                {MONEY_GROWTH_INTEREST_OPTIONS.map((opt) => {
                  const picked = moneyGrowthInterestDraft === opt;
                  return (
                    <Pressable
                      key={opt}
                      onPress={() => setMoneyGrowthInterestDraft(opt)}
                      style={[s.optionRow, picked && s.optionRowSelected]}
                    >
                      <View style={[s.radio, picked && s.radioSelected]}>
                        {picked && <View style={s.radioDot} />}
                      </View>
                      <Text
                        style={[
                          s.optionText,
                          picked && s.optionTextSelected,
                        ]}
                      >
                        {opt}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={s.responseBlock}>
              <Text style={s.responseLabel}>
                What is one question you still have about money, growth, or
                compensation?
              </Text>
              <TextInput
                value={moneyGrowthQuestionDraft}
                onChangeText={setMoneyGrowthQuestionDraft}
                placeholder="A short reflection…"
                placeholderTextColor="#4A5568"
                multiline
                style={s.textArea}
              />
            </View>

            <View style={s.responseBlock}>
              <Text style={s.scenarioEyebrow}>
                {MONEY_GROWTH_SCENARIO_TIER.eyebrow}
              </Text>
              <Text style={s.responseLabel}>
                {MONEY_GROWTH_SCENARIO_TIER.title}
              </Text>
              <Text style={s.sectionBody}>
                {MONEY_GROWTH_SCENARIO_TIER.prompt}
              </Text>
              <View style={s.optionList}>
                {MONEY_GROWTH_SCENARIO_TIER.options.map((opt) => {
                  const picked = moneyGrowthScenarioTierDraft === opt.letter;
                  return (
                    <Pressable
                      key={opt.letter}
                      onPress={() => setMoneyGrowthScenarioTierDraft(opt.letter)}
                      style={[s.optionRow, picked && s.optionRowSelected]}
                    >
                      <View style={[s.radio, picked && s.radioSelected]}>
                        {picked && <View style={s.radioDot} />}
                      </View>
                      <Text style={s.scenarioLetter}>{opt.letter}.</Text>
                      <Text
                        style={[
                          s.optionText,
                          picked && s.optionTextSelected,
                        ]}
                      >
                        {opt.text}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {moneyGrowthScenarioTierDraft ===
                MONEY_GROWTH_SCENARIO_TIER.correct && (
                <View style={s.scenarioFeedbackCorrect}>
                  <Icon name="check-circle" size={16} color={GREEN} />
                  <Text style={s.scenarioFeedbackCorrectText}>
                    {MONEY_GROWTH_SCENARIO_TIER.correctFeedback}
                  </Text>
                </View>
              )}
              {!!moneyGrowthScenarioTierDraft &&
                moneyGrowthScenarioTierDraft !==
                  MONEY_GROWTH_SCENARIO_TIER.correct && (
                  <View style={s.scenarioFeedbackTryAgain}>
                    <Text style={s.scenarioFeedbackTryAgainText}>
                      {MONEY_GROWTH_SCENARIO_TIER.wrongFeedback}
                    </Text>
                  </View>
                )}
            </View>

            <View style={s.responseBlock}>
              <Text style={s.scenarioEyebrow}>
                {MONEY_GROWTH_SCENARIO_REFERRAL.eyebrow}
              </Text>
              <Text style={s.responseLabel}>
                {MONEY_GROWTH_SCENARIO_REFERRAL.title}
              </Text>
              <Text style={s.sectionBody}>
                {MONEY_GROWTH_SCENARIO_REFERRAL.prompt}
              </Text>
              <View style={s.optionList}>
                {MONEY_GROWTH_SCENARIO_REFERRAL.options.map((opt) => {
                  const picked =
                    moneyGrowthScenarioReferralDraft === opt.letter;
                  return (
                    <Pressable
                      key={opt.letter}
                      onPress={() =>
                        setMoneyGrowthScenarioReferralDraft(opt.letter)
                      }
                      style={[s.optionRow, picked && s.optionRowSelected]}
                    >
                      <View style={[s.radio, picked && s.radioSelected]}>
                        {picked && <View style={s.radioDot} />}
                      </View>
                      <Text style={s.scenarioLetter}>{opt.letter}.</Text>
                      <Text
                        style={[
                          s.optionText,
                          picked && s.optionTextSelected,
                        ]}
                      >
                        {opt.text}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {moneyGrowthScenarioReferralDraft ===
                MONEY_GROWTH_SCENARIO_REFERRAL.correct && (
                <View style={s.scenarioFeedbackCorrect}>
                  <Icon name="check-circle" size={16} color={GREEN} />
                  <Text style={s.scenarioFeedbackCorrectText}>
                    {MONEY_GROWTH_SCENARIO_REFERRAL.correctFeedback}
                  </Text>
                </View>
              )}
              {!!moneyGrowthScenarioReferralDraft &&
                moneyGrowthScenarioReferralDraft !==
                  MONEY_GROWTH_SCENARIO_REFERRAL.correct && (
                  <View style={s.scenarioFeedbackTryAgain}>
                    <Text style={s.scenarioFeedbackTryAgainText}>
                      {MONEY_GROWTH_SCENARIO_REFERRAL.wrongFeedback}
                    </Text>
                  </View>
                )}
            </View>
          </>
        )}

        {/* Apprenticeship Path — education only: launch ladder, readiness, mentor cards, reflection, 2 scenarios */}
        {module.id === 'apprenticeshipPath' && (
          <>
            <View style={s.heroCard}>
              <Text style={s.heroEyebrow}>APPRENTICESHIP PATH</Text>
              <Text style={s.heroHeading}>From learning to launching.</Text>
              <Text style={s.heroBody}>
                The G➲A apprenticeship path is designed to help a coach grow
                in confidence, skill, systems mastery, and member readiness
                before stepping fully into independent coaching.
              </Text>
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>
                Coach Launch gives you the foundation. Apprenticeship helps you
                turn that foundation into practice.
              </Text>
              <Text style={s.sectionBody}>
                Inside GoArrive, new coaches are not expected to figure
                everything out alone. The apprenticeship path gives you
                mentorship, exposure to real coaching rhythms, and a clear
                progression from observing to leading.
              </Text>
              <Text style={s.sectionBody}>
                The goal is not speed for speed’s sake. The goal is readiness.
              </Text>
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>Apprenticeship overview.</Text>
              <Text style={s.sectionBody}>
                Three things to know before you start.
              </Text>
            </View>

            <View style={{ gap: 10 }}>
              {APPRENTICESHIP_OVERVIEW_CARDS.map((c) => (
                <View key={c.title} style={s.capCard}>
                  <Text style={s.capCardTitle}>{c.title}</Text>
                  <Text style={s.capCardBody}>{c.body}</Text>
                </View>
              ))}
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>The four-phase launch ladder.</Text>
              <Text style={s.sectionBody}>
                Each phase builds on the last. Readiness — not speed — moves
                you up the ladder.
              </Text>
            </View>

            <View style={{ gap: 0 }}>
              {APPRENTICESHIP_LADDER_PHASES.map((p, i) => (
                <View key={p.title}>
                  <View style={s.ladderPhaseCard}>
                    <View style={s.ladderPhaseHeader}>
                      <View style={s.ladderPhaseBadge}>
                        <Text style={s.ladderPhaseBadgeText}>
                          {String(i + 1).padStart(2, '0')}
                        </Text>
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={s.ladderPhaseTitle}>{p.title}</Text>
                        <Text style={s.ladderPhaseShortDef}>
                          {p.shortDefinition}
                        </Text>
                      </View>
                    </View>
                    <Text style={s.ladderPhaseBody}>{p.body}</Text>
                    <View style={s.ladderSubBox}>
                      <Text style={s.ladderSubLabel}>APPRENTICE FOCUS</Text>
                      <Text style={s.ladderSubText}>{p.apprenticeFocus}</Text>
                    </View>
                    <View style={s.ladderReadinessBox}>
                      <Text style={s.ladderReadinessLabel}>
                        WHAT READINESS LOOKS LIKE
                      </Text>
                      <Text style={s.ladderReadinessText}>
                        {p.readinessLooksLike}
                      </Text>
                    </View>
                  </View>
                  {i < APPRENTICESHIP_LADDER_PHASES.length - 1 && (
                    <View style={s.ladderConnector} />
                  )}
                </View>
              ))}
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>
                What launch readiness is built on.
              </Text>
              <Text style={s.sectionBody}>
                Six signals mentors watch for as you grow.
              </Text>
            </View>

            <View style={{ gap: 10 }}>
              {APPRENTICESHIP_READINESS_SIGNALS.map((r) => (
                <View key={r.title} style={s.readinessCard}>
                  <Text style={s.readinessCardTitle}>{r.title}</Text>
                  <Text style={s.readinessCardBody}>{r.body}</Text>
                </View>
              ))}
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>
                How to get the most from your Coach Mentor.
              </Text>
              <Text style={s.sectionBody}>
                Four habits that turn mentorship into growth.
              </Text>
            </View>

            <View style={{ gap: 10 }}>
              {APPRENTICESHIP_MENTOR_CARDS.map((m) => (
                <View key={m.title} style={s.capCard}>
                  <Text style={s.capCardTitle}>{m.title}</Text>
                  <Text style={s.capCardBody}>{m.body}</Text>
                </View>
              ))}
            </View>

            <View style={s.responseBlock}>
              <Text style={s.responseLabel}>
                Which apprenticeship phase are you most excited about?
              </Text>
              <View style={s.optionList}>
                {APPRENTICESHIP_EXCITEMENT_OPTIONS.map((opt) => {
                  const picked = apprenticeshipExcitementPhaseDraft === opt;
                  return (
                    <Pressable
                      key={opt}
                      onPress={() => setApprenticeshipExcitementPhaseDraft(opt)}
                      style={[s.optionRow, picked && s.optionRowSelected]}
                    >
                      <View style={[s.radio, picked && s.radioSelected]}>
                        {picked && <View style={s.radioDot} />}
                      </View>
                      <Text
                        style={[
                          s.optionText,
                          picked && s.optionTextSelected,
                        ]}
                      >
                        {opt}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={s.responseBlock}>
              <Text style={s.responseLabel}>
                What is one area you want your Coach Mentor to help you grow
                in?
              </Text>
              <TextInput
                value={apprenticeshipGrowthAreaDraft}
                onChangeText={setApprenticeshipGrowthAreaDraft}
                placeholder="A short reflection…"
                placeholderTextColor="#4A5568"
                multiline
                style={s.textArea}
              />
            </View>

            <View style={s.responseBlock}>
              <Text style={s.scenarioEyebrow}>
                {APPRENTICESHIP_SCENARIO_FEEDBACK.eyebrow}
              </Text>
              <Text style={s.responseLabel}>
                {APPRENTICESHIP_SCENARIO_FEEDBACK.title}
              </Text>
              <Text style={s.sectionBody}>
                {APPRENTICESHIP_SCENARIO_FEEDBACK.prompt}
              </Text>
              <View style={s.optionList}>
                {APPRENTICESHIP_SCENARIO_FEEDBACK.options.map((opt) => {
                  const picked =
                    apprenticeshipScenarioFeedbackDraft === opt.letter;
                  return (
                    <Pressable
                      key={opt.letter}
                      onPress={() =>
                        setApprenticeshipScenarioFeedbackDraft(opt.letter)
                      }
                      style={[s.optionRow, picked && s.optionRowSelected]}
                    >
                      <View style={[s.radio, picked && s.radioSelected]}>
                        {picked && <View style={s.radioDot} />}
                      </View>
                      <Text style={s.scenarioLetter}>{opt.letter}.</Text>
                      <Text
                        style={[
                          s.optionText,
                          picked && s.optionTextSelected,
                        ]}
                      >
                        {opt.text}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {apprenticeshipScenarioFeedbackDraft ===
                APPRENTICESHIP_SCENARIO_FEEDBACK.correct && (
                <View style={s.scenarioFeedbackCorrect}>
                  <Icon name="check-circle" size={16} color={GREEN} />
                  <Text style={s.scenarioFeedbackCorrectText}>
                    {APPRENTICESHIP_SCENARIO_FEEDBACK.correctFeedback}
                  </Text>
                </View>
              )}
              {!!apprenticeshipScenarioFeedbackDraft &&
                apprenticeshipScenarioFeedbackDraft !==
                  APPRENTICESHIP_SCENARIO_FEEDBACK.correct && (
                  <View style={s.scenarioFeedbackTryAgain}>
                    <Text style={s.scenarioFeedbackTryAgainText}>
                      {APPRENTICESHIP_SCENARIO_FEEDBACK.wrongFeedback}
                    </Text>
                  </View>
                )}
            </View>

            <View style={s.responseBlock}>
              <Text style={s.scenarioEyebrow}>
                {APPRENTICESHIP_SCENARIO_LAUNCH_READINESS.eyebrow}
              </Text>
              <Text style={s.responseLabel}>
                {APPRENTICESHIP_SCENARIO_LAUNCH_READINESS.title}
              </Text>
              <Text style={s.sectionBody}>
                {APPRENTICESHIP_SCENARIO_LAUNCH_READINESS.prompt}
              </Text>
              <View style={s.optionList}>
                {APPRENTICESHIP_SCENARIO_LAUNCH_READINESS.options.map((opt) => {
                  const picked =
                    apprenticeshipScenarioLaunchReadinessDraft === opt.letter;
                  return (
                    <Pressable
                      key={opt.letter}
                      onPress={() =>
                        setApprenticeshipScenarioLaunchReadinessDraft(opt.letter)
                      }
                      style={[s.optionRow, picked && s.optionRowSelected]}
                    >
                      <View style={[s.radio, picked && s.radioSelected]}>
                        {picked && <View style={s.radioDot} />}
                      </View>
                      <Text style={s.scenarioLetter}>{opt.letter}.</Text>
                      <Text
                        style={[
                          s.optionText,
                          picked && s.optionTextSelected,
                        ]}
                      >
                        {opt.text}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {apprenticeshipScenarioLaunchReadinessDraft ===
                APPRENTICESHIP_SCENARIO_LAUNCH_READINESS.correct && (
                <View style={s.scenarioFeedbackCorrect}>
                  <Icon name="check-circle" size={16} color={GREEN} />
                  <Text style={s.scenarioFeedbackCorrectText}>
                    {APPRENTICESHIP_SCENARIO_LAUNCH_READINESS.correctFeedback}
                  </Text>
                </View>
              )}
              {!!apprenticeshipScenarioLaunchReadinessDraft &&
                apprenticeshipScenarioLaunchReadinessDraft !==
                  APPRENTICESHIP_SCENARIO_LAUNCH_READINESS.correct && (
                  <View style={s.scenarioFeedbackTryAgain}>
                    <Text style={s.scenarioFeedbackTryAgainText}>
                      {APPRENTICESHIP_SCENARIO_LAUNCH_READINESS.wrongFeedback}
                    </Text>
                  </View>
                )}
            </View>
          </>
        )}

        {/* Setup Checklist — education + self-review only: categories, 8-item checklist, clarity, reflection, 1 scenario */}
        {module.id === 'setupChecklist' && (
          <>
            <View style={s.heroCard}>
              <Text style={s.heroEyebrow}>SETUP CHECKLIST</Text>
              <Text style={s.heroHeading}>Get practically ready to launch.</Text>
              <Text style={s.heroBody}>
                Coach Launch helps you understand the mission and standard.
                Setup readiness helps make sure your profile, tools, systems,
                and first coaching workflows are prepared before you begin
                serving members inside G➲A.
              </Text>
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>
                A great launch is not just about excitement. It is about
                reducing friction.
              </Text>
              <Text style={s.sectionBody}>
                When your setup is clean, members experience confidence.
                Sessions run smoother. Communication is clearer. Payments are
                less confusing. Your Coach Mentor and GoArrive team can support
                you more effectively.
              </Text>
              <Text style={s.sectionBody}>
                This checklist is a readiness map. It does not replace the
                actual setup screens, approvals, or agreement. It helps you
                understand what needs to be completed before launch.
              </Text>
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>Readiness categories.</Text>
              <Text style={s.sectionBody}>
                Five areas to bring into shape before launch.
              </Text>
            </View>

            <View style={{ gap: 10 }}>
              {SETUP_CATEGORIES.map((c, i) => (
                <View key={c.title} style={s.setupCategoryCard}>
                  <Text style={s.setupCategoryNumber}>
                    {String(i + 1).padStart(2, '0')}
                  </Text>
                  <Text style={s.setupCategoryTitle}>{c.title}</Text>
                  <Text style={s.setupCategoryBody}>{c.body}</Text>
                  <View style={s.setupCategoryExamplesBox}>
                    <Text style={s.setupCategoryExamplesLabel}>EXAMPLES</Text>
                    {c.examples.map((ex) => (
                      <View key={ex} style={s.setupCategoryExampleRow}>
                        <Text style={s.setupCategoryExampleBullet}>•</Text>
                        <Text style={s.setupCategoryExampleText}>{ex}</Text>
                      </View>
                    ))}
                  </View>
                  <View style={s.setupCategoryFocusBox}>
                    <Text style={s.setupCategoryFocusLabel}>COACH FOCUS</Text>
                    <Text style={s.setupCategoryFocusText}>{c.coachFocus}</Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>Launch readiness self-review.</Text>
              <Text style={s.sectionBody}>
                These are Coach Launch self-review checkboxes only. They do not
                verify live setup status.
              </Text>
            </View>

            <View style={s.checklistCard}>
              {SETUP_CHECKLIST_ITEMS.map((item) => {
                const checked = setupChecklistDraft.includes(item.id);
                return (
                  <Pressable
                    key={item.id}
                    onPress={() =>
                      setSetupChecklistDraft((prev) =>
                        prev.includes(item.id)
                          ? prev.filter((id) => id !== item.id)
                          : [...prev, item.id]
                      )
                    }
                    style={[
                      s.checklistRow,
                      checked && s.checklistRowChecked,
                    ]}
                  >
                    <View
                      style={[
                        s.checklistBox,
                        checked && s.checklistBoxChecked,
                      ]}
                    >
                      {checked && (
                        <Icon name="check" size={12} color={GREEN} />
                      )}
                    </View>
                    <Text
                      style={[
                        s.checklistText,
                        checked && s.checklistTextChecked,
                      ]}
                    >
                      {item.text}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>
                What this checklist does — and does not do.
              </Text>
              <Text style={s.sectionBody}>
                A quick clarity check before you keep going.
              </Text>
            </View>

            <View style={s.clarityCard}>
              {SETUP_CLARITY_POINTS.map((point) => (
                <View key={point} style={s.clarityRow}>
                  <Text style={s.clarityBullet}>•</Text>
                  <Text style={s.clarityText}>{point}</Text>
                </View>
              ))}
            </View>

            <View style={s.responseBlock}>
              <Text style={s.responseLabel}>
                Which setup area do you feel most confident about right now?
              </Text>
              <View style={s.optionList}>
                {SETUP_CONFIDENCE_OPTIONS.map((opt) => {
                  const picked = setupConfidenceAreaDraft === opt;
                  return (
                    <Pressable
                      key={opt}
                      onPress={() => setSetupConfidenceAreaDraft(opt)}
                      style={[s.optionRow, picked && s.optionRowSelected]}
                    >
                      <View style={[s.radio, picked && s.radioSelected]}>
                        {picked && <View style={s.radioDot} />}
                      </View>
                      <Text
                        style={[
                          s.optionText,
                          picked && s.optionTextSelected,
                        ]}
                      >
                        {opt}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={s.responseBlock}>
              <Text style={s.responseLabel}>
                What is one setup area you want help with before launch?
              </Text>
              <TextInput
                value={setupHelpAreaDraft}
                onChangeText={setSetupHelpAreaDraft}
                placeholder="A short reflection…"
                placeholderTextColor="#4A5568"
                multiline
                style={s.textArea}
              />
            </View>

            <View style={s.responseBlock}>
              <Text style={s.scenarioEyebrow}>
                {SETUP_SCENARIO_UNTESTED_TOOL.eyebrow}
              </Text>
              <Text style={s.responseLabel}>
                {SETUP_SCENARIO_UNTESTED_TOOL.title}
              </Text>
              <Text style={s.sectionBody}>
                {SETUP_SCENARIO_UNTESTED_TOOL.prompt}
              </Text>
              <View style={s.optionList}>
                {SETUP_SCENARIO_UNTESTED_TOOL.options.map((opt) => {
                  const picked = setupScenarioUntestedToolDraft === opt.letter;
                  return (
                    <Pressable
                      key={opt.letter}
                      onPress={() =>
                        setSetupScenarioUntestedToolDraft(opt.letter)
                      }
                      style={[s.optionRow, picked && s.optionRowSelected]}
                    >
                      <View style={[s.radio, picked && s.radioSelected]}>
                        {picked && <View style={s.radioDot} />}
                      </View>
                      <Text style={s.scenarioLetter}>{opt.letter}.</Text>
                      <Text
                        style={[
                          s.optionText,
                          picked && s.optionTextSelected,
                        ]}
                      >
                        {opt.text}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {setupScenarioUntestedToolDraft ===
                SETUP_SCENARIO_UNTESTED_TOOL.correct && (
                <View style={s.scenarioFeedbackCorrect}>
                  <Icon name="check-circle" size={16} color={GREEN} />
                  <Text style={s.scenarioFeedbackCorrectText}>
                    {SETUP_SCENARIO_UNTESTED_TOOL.correctFeedback}
                  </Text>
                </View>
              )}
              {!!setupScenarioUntestedToolDraft &&
                setupScenarioUntestedToolDraft !==
                  SETUP_SCENARIO_UNTESTED_TOOL.correct && (
                  <View style={s.scenarioFeedbackTryAgain}>
                    <Text style={s.scenarioFeedbackTryAgainText}>
                      {SETUP_SCENARIO_UNTESTED_TOOL.wrongFeedback}
                    </Text>
                  </View>
                )}
            </View>
          </>
        )}
      </View>

      {/* Actions — Agreement owns its own submit; hide the generic complete button. */}
      {module.id === 'agreement' ? (
        <View style={s.actionsRow}>
          <Pressable style={[s.secondaryBtn, { flex: 1 }]} onPress={onBack}>
            <Text style={s.secondaryBtnText}>Back to Coach Launch</Text>
          </Pressable>
        </View>
      ) : (
        <View style={s.actionsRow}>
          <Pressable style={s.secondaryBtn} onPress={onBack}>
            <Text style={s.secondaryBtnText}>Back to Coach Launch</Text>
          </Pressable>
          <Pressable
            style={[
              s.primaryBtn,
              { flex: 1 },
              (!canComplete || saving) && s.btnDisabled,
            ]}
            onPress={onComplete}
            disabled={!canComplete || saving}
          >
            <Text style={s.primaryBtnText}>
              {saving
                ? 'Saving…'
                : isComplete
                ? 'Mark Complete Again'
                : 'Complete Module'}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ── Phase 10B — In-app Coach Agreement signing UI ────────────────────────────

interface AgreementModuleProps {
  reviewedIds: string[];
  setReviewedIds: React.Dispatch<React.SetStateAction<string[]>>;
  termsAccepted: boolean;
  setTermsAccepted: (v: boolean) => void;
  electronicConsent: boolean;
  setElectronicConsent: (v: boolean) => void;
  firstName: string;
  setFirstName: (v: string) => void;
  lastName: string;
  setLastName: (v: string) => void;
  signatureDataUrl: string;
  setSignatureDataUrl: (v: string) => void;
  expandedSectionId: string | null;
  setExpandedSectionId: (v: string | null) => void;
  submitting: boolean;
  submitError: string | null;
  signedAgreement: {
    coachFirstName?: string;
    coachLastName?: string;
    typedName?: string;
    agreementVersion?: string;
    agreementTitle?: string;
    signedAt?: any;
    clientSignedDate?: string;
    reviewedSectionIds?: string[];
    signatureDataUrl?: string;
    status?: string;
  } | null;
  onSubmit: () => void;
  isSigningAsSelf: boolean;
  scrollRef: React.RefObject<ScrollView | null>;
}

function AgreementModule({
  reviewedIds,
  setReviewedIds,
  termsAccepted,
  setTermsAccepted,
  electronicConsent,
  setElectronicConsent,
  firstName,
  setFirstName,
  lastName,
  setLastName,
  signatureDataUrl,
  setSignatureDataUrl,
  expandedSectionId,
  setExpandedSectionId,
  submitting,
  submitError,
  signedAgreement,
  onSubmit,
  isSigningAsSelf,
  scrollRef,
}: AgreementModuleProps) {
  const accordionYRef = useRef<number | null>(null);
  const cardYsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!expandedSectionId) return;
    let cancelled = false;
    let retries = 6;
    const attempt = () => {
      if (cancelled) return;
      const accordionY = accordionYRef.current;
      const cardY = cardYsRef.current[expandedSectionId];
      if (accordionY != null && cardY != null && scrollRef.current) {
        const targetY = Math.max(0, accordionY + cardY - 12);
        scrollRef.current.scrollTo({ y: targetY, animated: true });
        return;
      }
      if (retries-- > 0) setTimeout(attempt, 40);
    };
    const t = setTimeout(attempt, 40);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [expandedSectionId, scrollRef]);

  const alreadySigned =
    !!signedAgreement && signedAgreement.status === 'signed';

  if (alreadySigned) {
    const signedName =
      signedAgreement.typedName ||
      [signedAgreement.coachFirstName, signedAgreement.coachLastName]
        .filter(Boolean)
        .join(' ');
    const signedDate =
      signedAgreement.clientSignedDate ||
      formatSignedAt(signedAgreement.signedAt);
    return (
      <>
        <View style={s.heroCard}>
          <Text style={s.heroEyebrow}>AGREEMENT</Text>
          <Text style={s.heroHeading}>Coach Agreement signed.</Text>
          <Text style={s.heroBody}>
            Your signed record is stored on file. You are ready to move into
            Launch Celebration.
          </Text>
        </View>
        <View style={s.signedBadge}>
          <View style={s.signedBadgeIconWrap}>
            <Icon name="check-circle" size={22} color={GREEN} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.signedBadgeLabel}>SIGNED</Text>
            <Text style={s.signedBadgeName}>{signedName || 'Coach'}</Text>
            {signedDate ? (
              <Text style={s.signedBadgeMeta}>On {signedDate}</Text>
            ) : null}
            <Text style={s.signedBadgeMeta}>
              {signedAgreement.agreementTitle || COACH_AGREEMENT_TITLE}
            </Text>
            <Text style={s.signedBadgeMeta}>
              Version: {signedAgreement.agreementVersion ||
                COACH_AGREEMENT_VERSION}
            </Text>
          </View>
        </View>
        {signedAgreement.signatureDataUrl && Platform.OS === 'web' ? (
          <View style={s.signedSignatureWrap}>
            <Text style={s.signedSignatureLabel}>Signature</Text>
            <View style={s.signedSignatureFrame}>
              {React.createElement('img', {
                src: signedAgreement.signatureDataUrl,
                alt: 'Signed signature',
                style: {
                  display: 'block',
                  width: '100%',
                  maxHeight: 180,
                  objectFit: 'contain',
                  backgroundColor: '#ffffff',
                  // Invert renders dark strokes as white on a black
                  // background — matches the app's dark theme. Underlying
                  // PNG data is unchanged.
                  filter: 'invert(1)',
                },
              })}
            </View>
          </View>
        ) : null}

        {/* Read-only agreement text so the coach can review what they
            signed after the fact. Same accordion pattern as the signing
            flow, minus the review checkboxes. */}
        <View style={s.sectionBlock}>
          <Text style={s.sectionHeading}>Review what you signed</Text>
          <Text style={s.sectionBody}>
            Your signed copy of the {COACH_AGREEMENT_TITLE} is below in{' '}
            {COACH_AGREEMENT_SECTIONS.length} sections. Tap any section
            to read it. This record is retained by GoArrive.
          </Text>
        </View>
        <View
          style={s.agreementAccordion}
          onLayout={(e) => {
            accordionYRef.current = e.nativeEvent.layout.y;
          }}
        >
          {COACH_AGREEMENT_SECTIONS.map((section) => {
            const isOpen = expandedSectionId === section.id;
            return (
              <View
                key={section.id}
                style={s.agreementAccordionCard}
                onLayout={(e) => {
                  cardYsRef.current[section.id] = e.nativeEvent.layout.y;
                }}
              >
                <Pressable
                  style={s.agreementAccordionHeader}
                  onPress={() =>
                    setExpandedSectionId(isOpen ? null : section.id)
                  }
                >
                  <View style={s.agreementSectionNumBox}>
                    <Text style={s.agreementSectionNumText}>
                      {String(section.number).padStart(2, '0')}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.agreementSectionTitle}>
                      {section.title}
                    </Text>
                    <Text style={s.agreementSectionSummary}>
                      {section.summary}
                    </Text>
                  </View>
                  <View style={s.agreementAccordionRight}>
                    <Text style={s.agreementAccordionChevron}>
                      {isOpen ? '−' : '+'}
                    </Text>
                  </View>
                </Pressable>

                {isOpen ? (
                  <View style={s.agreementAccordionBody}>
                    {section.body.map((para, i) => (
                      <Text key={i} style={s.agreementBodyText}>
                        {para}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>

        <View style={s.clarityCard}>
          <Text style={s.clarityHeading}>What happens next</Text>
          <View style={s.clarityRow}>
            <Text style={s.clarityBullet}>•</Text>
            <Text style={s.clarityText}>
              This signed record is retained by GoArrive.
            </Text>
          </View>
          <View style={s.clarityRow}>
            <Text style={s.clarityBullet}>•</Text>
            <Text style={s.clarityText}>
              Return to Coach Launch to continue to Launch Celebration.
            </Text>
          </View>
        </View>
      </>
    );
  }

  if (!isSigningAsSelf) {
    // Admin impersonation cannot sign. Show a clear disabled state and
    // route them out of the signing flow. Firestore rules also enforce
    // this at the create layer.
    return (
      <>
        <View style={s.heroCard}>
          <Text style={s.heroEyebrow}>AGREEMENT</Text>
          <Text style={s.heroHeading}>
            Signing must be done by the coach.
          </Text>
          <Text style={s.heroBody}>
            You are viewing this Coach Launch flow as a platform admin.
            The Coach Agreement is a legal signature and must be signed
            by the coach account owner from their own account.
          </Text>
        </View>
        <View style={s.impersonationBlockCard}>
          <View style={s.impersonationBlockIconWrap}>
            <Icon name="lock" size={22} color={GOLD} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.impersonationBlockTitle}>
              Signing disabled during impersonation
            </Text>
            <Text style={s.impersonationBlockBody}>
              Agreement must be signed by the coach account owner. Exit
              impersonation and have the coach sign from their own
              account. As a platform admin you may still view a signed
              agreement once it exists.
            </Text>
          </View>
        </View>
        <View style={s.clarityCard}>
          <Text style={s.clarityHeading}>What to do</Text>
          <View style={s.clarityRow}>
            <Text style={s.clarityBullet}>•</Text>
            <Text style={s.clarityText}>
              Exit impersonation from the admin console.
            </Text>
          </View>
          <View style={s.clarityRow}>
            <Text style={s.clarityBullet}>•</Text>
            <Text style={s.clarityText}>
              Ask the coach to open Coach Launch → Coach Agreement and
              sign from their own account.
            </Text>
          </View>
          <View style={s.clarityRow}>
            <Text style={s.clarityBullet}>•</Text>
            <Text style={s.clarityText}>
              Return here after the coach signs to review the record.
            </Text>
          </View>
        </View>
      </>
    );
  }

  const canSubmit =
    !submitting &&
    reviewedIds.length === COACH_AGREEMENT_SECTIONS.length &&
    termsAccepted &&
    electronicConsent &&
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    signatureDataUrl.length > 0;

  const todayPretty = (() => {
    const now = new Date();
    return now.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  })();

  return (
    <>
      <View style={s.heroCard}>
        <Text style={s.heroEyebrow}>AGREEMENT</Text>
        <Text style={s.heroHeading}>
          Review and sign the Coach Agreement.
        </Text>
        <Text style={s.heroBody}>
          You have walked through the vision, culture, member experience,
          coach experience, coaching standards, growth model, apprenticeship
          path, and setup readiness. This is the formal step that puts the
          shared expectations in writing.
        </Text>
      </View>

      <View style={s.sectionBlock}>
        <Text style={s.sectionHeading}>{COACH_AGREEMENT_TITLE}</Text>
        <Text style={s.sectionBody}>
          The full agreement is below in {COACH_AGREEMENT_SECTIONS.length}
          {' '}sections. Open each section, review it, then check{' '}
          <Text style={{ fontWeight: '700', color: FG }}>
            &ldquo;I have reviewed this section&rdquo;
          </Text>{' '}
          before continuing.
        </Text>
        <Text style={s.helperText}>
          Version: {COACH_AGREEMENT_VERSION}
        </Text>
      </View>

      <View
        style={s.agreementAccordion}
        onLayout={(e) => {
          accordionYRef.current = e.nativeEvent.layout.y;
        }}
      >
        {COACH_AGREEMENT_SECTIONS.map((section) => {
          const isReviewed = reviewedIds.includes(section.id);
          const isOpen = expandedSectionId === section.id;
          return (
            <View
              key={section.id}
              style={[
                s.agreementAccordionCard,
                isReviewed && s.agreementAccordionCardReviewed,
              ]}
              onLayout={(e) => {
                cardYsRef.current[section.id] = e.nativeEvent.layout.y;
              }}
            >
              <Pressable
                style={s.agreementAccordionHeader}
                onPress={() =>
                  setExpandedSectionId(isOpen ? null : section.id)
                }
              >
                <View style={s.agreementSectionNumBox}>
                  <Text style={s.agreementSectionNumText}>
                    {String(section.number).padStart(2, '0')}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.agreementSectionTitle}>{section.title}</Text>
                  <Text style={s.agreementSectionSummary}>
                    {section.summary}
                  </Text>
                </View>
                <View style={s.agreementAccordionRight}>
                  {isReviewed ? (
                    <Icon name="check-circle" size={20} color={GREEN} />
                  ) : (
                    <Text style={s.agreementAccordionChevron}>
                      {isOpen ? '−' : '+'}
                    </Text>
                  )}
                </View>
              </Pressable>

              {isOpen ? (
                <View style={s.agreementAccordionBody}>
                  {section.body.map((para, i) => (
                    <Text key={i} style={s.agreementBodyText}>
                      {para}
                    </Text>
                  ))}
                  <Pressable
                    onPress={() =>
                      setReviewedIds((prev) => {
                        const has = prev.includes(section.id);
                        if (has) return prev.filter((id) => id !== section.id);
                        return [...prev, section.id];
                      })
                    }
                    style={[
                      s.checklistRow,
                      isReviewed && s.checklistRowChecked,
                      { marginTop: 12, marginBottom: 4 },
                    ]}
                  >
                    <View
                      style={[
                        s.checklistBox,
                        isReviewed && s.checklistBoxChecked,
                      ]}
                    >
                      {isReviewed && (
                        <Icon name="check" size={14} color={BG} />
                      )}
                    </View>
                    <Text
                      style={[
                        s.checklistText,
                        isReviewed && s.checklistTextChecked,
                      ]}
                    >
                      I have reviewed this section.
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      <View style={s.sectionBlock}>
        <Text style={s.sectionHeading}>Terms of the agreement</Text>
        <Text style={s.sectionBody}>
          Confirm your agreement with the terms above.
        </Text>
      </View>

      <Pressable
        onPress={() => setTermsAccepted(!termsAccepted)}
        style={[
          s.checklistRow,
          termsAccepted && s.checklistRowChecked,
        ]}
      >
        <View
          style={[s.checklistBox, termsAccepted && s.checklistBoxChecked]}
        >
          {termsAccepted && <Icon name="check" size={14} color={BG} />}
        </View>
        <Text
          style={[
            s.checklistText,
            termsAccepted && s.checklistTextChecked,
          ]}
        >
          I have read and agree to the {COACH_AGREEMENT_TITLE}, including all
          {' '}{COACH_AGREEMENT_SECTIONS.length} sections above.
        </Text>
      </Pressable>

      <View style={s.sectionBlock}>
        <Text style={s.sectionHeading}>Electronic signature consent</Text>
        <Text style={s.sectionBody}>
          You are signing electronically. This has the same legal effect as a
          paper signature.
        </Text>
      </View>

      <Pressable
        onPress={() => setElectronicConsent(!electronicConsent)}
        style={[
          s.checklistRow,
          electronicConsent && s.checklistRowChecked,
        ]}
      >
        <View
          style={[
            s.checklistBox,
            electronicConsent && s.checklistBoxChecked,
          ]}
        >
          {electronicConsent && <Icon name="check" size={14} color={BG} />}
        </View>
        <Text
          style={[
            s.checklistText,
            electronicConsent && s.checklistTextChecked,
          ]}
        >
          I consent to sign this agreement electronically and understand my
          electronic signature is binding.
        </Text>
      </Pressable>

      <View style={s.sectionBlock}>
        <Text style={s.sectionHeading}>Today&rsquo;s date</Text>
        <View style={s.agreementDateRow}>
          <Icon name="calendar" size={16} color={MUTED} />
          <Text style={s.agreementDateText}>{todayPretty}</Text>
        </View>
      </View>

      <View style={s.sectionBlock}>
        <Text style={s.sectionHeading}>Your name</Text>
        <Text style={s.sectionBody}>
          Enter your legal first and last name exactly as they should appear
          on the signed record.
        </Text>
      </View>

      <View style={s.agreementNameRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.agreementInputLabel}>First name</Text>
          <TextInput
            value={firstName}
            onChangeText={setFirstName}
            placeholder="First name"
            placeholderTextColor="#4A5568"
            style={s.agreementInput}
            autoCapitalize="words"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.agreementInputLabel}>Last name</Text>
          <TextInput
            value={lastName}
            onChangeText={setLastName}
            placeholder="Last name"
            placeholderTextColor="#4A5568"
            style={s.agreementInput}
            autoCapitalize="words"
          />
        </View>
      </View>

      <View style={s.sectionBlock}>
        <Text style={s.sectionHeading}>Signature</Text>
        <Text style={s.sectionBody}>
          Draw your signature in the box below using your finger, stylus, or
          mouse. Tap Clear to try again.
        </Text>
      </View>

      <CoachAgreementSignaturePad
        value={signatureDataUrl}
        onChange={setSignatureDataUrl}
        disabled={submitting}
      />

      {submitError ? (
        <View style={s.agreementError}>
          <Icon name="alert-circle" size={16} color="#F87171" />
          <Text style={s.agreementErrorText}>{submitError}</Text>
        </View>
      ) : null}

      <Pressable
        style={[
          s.primaryBtn,
          { marginTop: 14 },
          (!canSubmit || submitting) && s.btnDisabled,
        ]}
        onPress={onSubmit}
        disabled={!canSubmit || submitting}
      >
        <Text style={s.primaryBtnText}>
          {submitting ? 'Submitting…' : 'Sign Coach Agreement'}
        </Text>
      </Pressable>

      {!canSubmit && !submitting ? (
        <Text style={s.helperText}>
          Review every section, agree to the terms, consent to electronic
          signing, enter your first and last name, and draw your signature to
          submit.
        </Text>
      ) : null}
    </>
  );
}

function formatSignedAt(signedAt: any): string {
  try {
    if (!signedAt) return '';
    // Firestore Timestamp
    if (typeof signedAt?.toDate === 'function') {
      return signedAt.toDate().toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
    if (signedAt instanceof Date) {
      return signedAt.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
    return '';
  } catch {
    return '';
  }
}

function PillarPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={s.pillarWrap}>
      {CULTURE_PILLARS.map((p) => {
        const selected = value === p;
        return (
          <Pressable
            key={p}
            onPress={() => onChange(p)}
            style={[s.pillarChip, selected && s.pillarChipSelected]}
          >
            <Text style={[s.pillarChipText, selected && s.pillarChipTextSelected]}>
              {p}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: BG,
  },
  backBtn: { width: 70 },
  backText: { color: '#5B9BD5', fontSize: 15, fontFamily: FB },
  headerTitle: { color: FG, fontSize: 18, fontWeight: '700', fontFamily: FH },

  scrollContent: { padding: 16, paddingBottom: 100, gap: 14 },

  // Intro block
  intro: { marginBottom: 4 },
  introSuper: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7DD3FC',
    fontFamily: FB,
    letterSpacing: 2,
    marginBottom: 8,
  },
  introHeading: {
    fontSize: 28,
    fontWeight: '800',
    color: FG,
    fontFamily: FH,
    marginBottom: 8,
  },
  introBody: {
    fontSize: 14,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 20,
  },

  // Progress card
  progressCard: {
    backgroundColor: '#131A27',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    gap: 12,
  },
  progressTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabel: {
    fontSize: 10,
    letterSpacing: 1.5,
    color: MUTED,
    fontFamily: FB,
    fontWeight: '700',
    marginBottom: 4,
  },
  progressValue: {
    fontSize: 22,
    fontWeight: '800',
    color: FG,
    fontFamily: FH,
  },
  progressTrack: {
    height: 6,
    backgroundColor: '#1E2A3A',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: GOLD,
    borderRadius: 3,
  },
  currentStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  currentStepText: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
  },
  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingVertical: 13,
    marginTop: 4,
  },
  continueBtnText: {
    color: '#0E1117',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: FH,
  },

  // Module list
  moduleList: { gap: 10, marginTop: 6 },
  moduleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  moduleCardPressed: {
    backgroundColor: '#151E2E',
  },
  moduleCardLocked: {
    opacity: 0.55,
  },
  moduleCardComplete: {
    borderColor: 'rgba(110,187,122,0.40)',
    backgroundColor: 'rgba(110,187,122,0.06)',
  },
  moduleCheckCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleNumberWrap: {
    width: 34,
    alignItems: 'center',
  },
  moduleNumber: {
    fontSize: 18,
    fontWeight: '800',
    color: GOLD,
    fontFamily: FH,
    letterSpacing: 0.5,
  },
  moduleBody: {
    flex: 1,
    gap: 3,
  },
  moduleTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: FG,
    fontFamily: FH,
  },
  moduleDesc: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 16,
  },
  moduleMeta: {
    fontSize: 11,
    color: '#4A5568',
    fontFamily: FB,
    marginTop: 2,
  },
  moduleRight: {
    alignItems: 'flex-end',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FB,
    letterSpacing: 0.4,
  },

  // Detail view
  detailWrap: { gap: 16 },
  detailHeader: {
    gap: 6,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  detailNumber: {
    fontSize: 11,
    fontWeight: '700',
    color: GOLD,
    fontFamily: FB,
    letterSpacing: 1.5,
  },
  detailTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: FG,
    fontFamily: FH,
  },
  detailMeta: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
  },
  detailBody: {
    gap: 16,
  },
  detailIntro: {
    fontSize: 15,
    color: FG,
    fontFamily: FB,
    lineHeight: 22,
  },
  responseBlock: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  responseLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: FG,
    fontFamily: FH,
  },
  responseBody: {
    fontSize: 14,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 20,
  },
  textArea: {
    backgroundColor: '#0E1421',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    padding: 12,
    minHeight: 100,
    color: FG,
    fontFamily: FB,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  placeholderBlock: {
    backgroundColor: 'rgba(245,166,35,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.18)',
    borderRadius: 12,
    padding: 14,
  },
  placeholderText: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 18,
  },
  helperText: {
    marginTop: 8,
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
    fontStyle: 'italic',
  },

  // Hero card (Welcome + Vision)
  heroCard: {
    backgroundColor: '#131A27',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.30)',
    borderRadius: 16,
    padding: 18,
    gap: 10,
  },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: GOLD,
    fontFamily: FB,
  },
  heroHeading: {
    fontSize: 22,
    fontWeight: '800',
    color: FG,
    fontFamily: FH,
    lineHeight: 28,
  },
  heroBody: {
    fontSize: 14,
    color: FG,
    fontFamily: FB,
    lineHeight: 21,
  },
  heroSignoff: {
    fontSize: 13,
    color: GOLD,
    fontFamily: FH,
    fontWeight: '700',
    marginTop: 4,
  },

  // Section block (Welcome + Vision structured sections)
  sectionBlock: {
    gap: 8,
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: '800',
    color: FG,
    fontFamily: FH,
  },
  sectionBody: {
    fontSize: 14,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 21,
  },

  // Welcome — preview list of upcoming modules
  previewList: {
    gap: 8,
    marginTop: 4,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  previewNumber: {
    fontSize: 13,
    fontWeight: '800',
    color: GOLD,
    fontFamily: FH,
    width: 22,
    marginTop: 1,
  },
  previewTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: FG,
    fontFamily: FH,
  },
  previewDesc: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 16,
    marginTop: 2,
  },

  // Welcome — commitment checkbox
  commitmentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(245,166,35,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.30)',
    borderRadius: 14,
    padding: 14,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: BORDER,
    backgroundColor: '#0E1421',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  commitmentText: {
    flex: 1,
    fontSize: 13,
    color: FG,
    fontFamily: FB,
    lineHeight: 19,
    fontWeight: '600',
  },

  // Vision — radio option list
  optionList: {
    gap: 8,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0E1421',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  optionRowSelected: {
    borderColor: GOLD,
    backgroundColor: 'rgba(245,166,35,0.08)',
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: GOLD,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: GOLD,
  },
  optionText: {
    flex: 1,
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 18,
  },
  optionTextSelected: {
    color: FG,
    fontWeight: '600',
  },

  // Culture — pillar detail cards
  pillarDetailCard: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  pillarDetailHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
  },
  pillarDetailNumber: {
    fontSize: 13,
    fontWeight: '800',
    color: GOLD,
    fontFamily: FH,
    letterSpacing: 0.5,
  },
  pillarDetailTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: FG,
    fontFamily: FH,
  },
  pillarDetailDef: {
    fontSize: 14,
    color: FG,
    fontFamily: FB,
    lineHeight: 20,
  },
  pillarDetailLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: MUTED,
    fontFamily: FB,
    marginTop: 4,
  },
  pillarBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  pillarBulletDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: GOLD,
    marginTop: 8,
  },
  pillarBulletText: {
    flex: 1,
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 19,
  },

  // Culture — scenarios
  scenarioEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: GOLD,
    fontFamily: FB,
  },
  scenarioLetter: {
    fontSize: 13,
    fontWeight: '800',
    color: GOLD,
    fontFamily: FH,
    width: 18,
  },
  scenarioFeedbackCorrect: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(110,187,122,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(110,187,122,0.35)',
    borderRadius: 12,
    padding: 12,
  },
  scenarioFeedbackCorrectText: {
    flex: 1,
    fontSize: 13,
    color: GREEN,
    fontFamily: FB,
    lineHeight: 18,
    fontWeight: '600',
  },
  scenarioFeedbackTryAgain: {
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.30)',
    borderRadius: 12,
    padding: 12,
  },
  scenarioFeedbackTryAgainText: {
    fontSize: 13,
    color: GOLD,
    fontFamily: FB,
    lineHeight: 18,
    fontWeight: '600',
  },

  // Pillar chips
  pillarWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pillarChip: {
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#0E1421',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pillarChipSelected: {
    borderColor: GOLD,
    backgroundColor: 'rgba(245,166,35,0.10)',
  },
  pillarChipText: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    fontWeight: '600',
  },
  pillarChipTextSelected: {
    color: GOLD,
    fontWeight: '700',
  },

  // Actions
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  primaryBtnText: {
    color: '#0E1117',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: FH,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: 'transparent',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  secondaryBtnText: {
    color: MUTED,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FB,
  },
  btnDisabled: {
    opacity: 0.5,
  },

  // Launch Celebration
  celebrateCard: {
    backgroundColor: '#131A27',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.35)',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 14,
    marginTop: 12,
  },
  celebrateBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  celebrateHeading: {
    fontSize: 24,
    fontWeight: '800',
    color: FG,
    fontFamily: FH,
    textAlign: 'center',
  },
  celebrateBody: {
    fontSize: 14,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 20,
    textAlign: 'center',
  },

  // Member Experience — journey timeline
  timeline: {
    gap: 0,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
  },
  timelineLeft: {
    width: 36,
    alignItems: 'center',
  },
  timelineDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(245,166,35,0.55)',
    backgroundColor: 'rgba(245,166,35,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineDotNumber: {
    fontSize: 12,
    fontWeight: '800',
    color: GOLD,
    fontFamily: FH,
  },
  timelineConnector: {
    flex: 1,
    width: 2,
    backgroundColor: 'rgba(245,166,35,0.20)',
    marginTop: 4,
    marginBottom: 4,
  },
  timelineCard: {
    flex: 1,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 14,
    gap: 6,
    marginBottom: 12,
  },
  timelineStepEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: GOLD,
    fontFamily: FB,
  },
  timelineStepTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: FG,
    fontFamily: FH,
    lineHeight: 21,
  },
  timelineStepBody: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 19,
  },
  coachFocusBox: {
    marginTop: 6,
    backgroundColor: 'rgba(245,166,35,0.06)',
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(245,166,35,0.55)',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 3,
  },
  coachFocusLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: GOLD,
    fontFamily: FB,
  },
  coachFocusText: {
    fontSize: 13,
    color: FG,
    fontFamily: FB,
    lineHeight: 18,
    fontWeight: '500',
  },

  // Member Experience — needs cards
  needsCard: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  needsTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: GOLD,
    fontFamily: FH,
  },
  needsBody: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 19,
  },

  // Coach Experience — command center tour cards
  tourCard: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  tourCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tourCardNumber: {
    fontSize: 12,
    fontWeight: '800',
    color: GOLD,
    fontFamily: FH,
    letterSpacing: 0.5,
  },
  tourCardArea: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: GOLD,
    fontFamily: FB,
    textTransform: 'uppercase',
  },
  tourCardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: FG,
    fontFamily: FH,
    lineHeight: 21,
  },
  tourCardBody: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 19,
  },

  // Coach Experience — coach rhythm cards
  rhythmGrid: {
    gap: 10,
  },
  rhythmCard: {
    backgroundColor: 'rgba(245,166,35,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.30)',
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  rhythmCardNumber: {
    fontSize: 11,
    fontWeight: '800',
    color: GOLD,
    fontFamily: FH,
    letterSpacing: 0.5,
  },
  rhythmCardName: {
    fontSize: 16,
    fontWeight: '800',
    color: FG,
    fontFamily: FH,
  },
  rhythmCardBody: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 19,
  },

  // How We Coach — posture cards
  postureCard: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  postureCardNumber: {
    fontSize: 11,
    fontWeight: '800',
    color: GOLD,
    fontFamily: FH,
    letterSpacing: 0.5,
  },
  postureCardName: {
    fontSize: 16,
    fontWeight: '800',
    color: FG,
    fontFamily: FH,
    lineHeight: 21,
  },
  postureDefinition: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 19,
  },
  soundsLikeBox: {
    marginTop: 6,
    backgroundColor: 'rgba(74,144,226,0.06)',
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(74,144,226,0.55)',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 3,
  },
  soundsLikeLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: BLUE,
    fontFamily: FB,
  },
  soundsLikeQuote: {
    fontSize: 13,
    color: FG,
    fontFamily: FB,
    lineHeight: 18,
    fontStyle: 'italic',
  },

  // How We Coach — practical example cards
  exampleCard: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  exampleNumber: {
    fontSize: 11,
    fontWeight: '800',
    color: GOLD,
    fontFamily: FH,
    letterSpacing: 0.5,
  },
  exampleSituation: {
    fontSize: 15,
    fontWeight: '700',
    color: FG,
    fontFamily: FH,
    lineHeight: 20,
  },
  exampleWeakBox: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(255,255,255,0.25)',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 3,
  },
  exampleWeakLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: MUTED,
    fontFamily: FB,
  },
  exampleWeakText: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  exampleGoaBox: {
    backgroundColor: 'rgba(126,211,33,0.06)',
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(126,211,33,0.55)',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 3,
  },
  exampleGoaLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: GREEN,
    fontFamily: FB,
  },
  exampleGoaText: {
    fontSize: 13,
    color: FG,
    fontFamily: FB,
    lineHeight: 18,
    fontWeight: '500',
  },

  // Money + Growth — principle cards
  principleCard: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 14,
    gap: 4,
  },
  principleNumber: {
    fontSize: 11,
    fontWeight: '800',
    color: GOLD,
    fontFamily: FH,
    letterSpacing: 0.5,
  },
  principleName: {
    fontSize: 16,
    fontWeight: '800',
    color: FG,
    fontFamily: FH,
    lineHeight: 21,
  },
  principleDefinition: {
    fontSize: 13,
    color: FG,
    fontFamily: FB,
    lineHeight: 19,
    fontWeight: '500',
  },
  principleBody: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 19,
  },

  // Money + Growth — progressive compensation tier cards
  tierCard: {
    backgroundColor: 'rgba(245,166,35,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.30)',
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  tierCardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: GOLD,
    fontFamily: FH,
    letterSpacing: 0.5,
  },
  tierCardRange: {
    fontSize: 14,
    color: FG,
    fontFamily: FB,
    fontWeight: '600',
  },
  tierSplitBox: {
    backgroundColor: 'rgba(126,211,33,0.06)',
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(126,211,33,0.55)',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 2,
  },
  tierSplitLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: GREEN,
    fontFamily: FB,
  },
  tierSplitValue: {
    fontSize: 14,
    color: FG,
    fontFamily: FB,
    fontWeight: '700',
  },
  tierCardBody: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 19,
  },

  // Money + Growth — earnings cap sub cards
  capCard: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  capCardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: GOLD,
    fontFamily: FH,
  },
  capCardBody: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 19,
  },

  // Money + Growth — fine-print note box
  fineNoteBox: {
    marginTop: 4,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  fineNoteText: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 17,
    fontStyle: 'italic',
  },

  // Money + Growth — pathway cards
  pathwayCard: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  pathwayNumber: {
    fontSize: 11,
    fontWeight: '800',
    color: GOLD,
    fontFamily: FH,
    letterSpacing: 0.5,
  },
  pathwayTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: FG,
    fontFamily: FH,
    lineHeight: 21,
  },
  pathwayBody: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 19,
  },
  pathwayRuleBox: {
    marginTop: 6,
    backgroundColor: 'rgba(74,144,226,0.06)',
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(74,144,226,0.55)',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 3,
  },
  pathwayRuleLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: BLUE,
    fontFamily: FB,
  },
  pathwayRuleText: {
    fontSize: 13,
    color: FG,
    fontFamily: FB,
    lineHeight: 18,
    fontWeight: '500',
  },

  // Money + Growth — clarity card
  clarityCard: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  clarityRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  clarityBullet: {
    fontSize: 14,
    color: GOLD,
    fontFamily: FB,
    lineHeight: 19,
    fontWeight: '700',
  },
  clarityText: {
    flex: 1,
    fontSize: 13,
    color: FG,
    fontFamily: FB,
    lineHeight: 19,
  },

  // Apprenticeship Path — launch ladder phase cards
  ladderPhaseCard: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderLeftWidth: 3,
    borderLeftColor: GOLD,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  ladderPhaseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ladderPhaseBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(245,166,35,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ladderPhaseBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    color: GOLD,
    fontFamily: FH,
    letterSpacing: 0.5,
  },
  ladderPhaseTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: FG,
    fontFamily: FH,
    lineHeight: 22,
  },
  ladderPhaseShortDef: {
    fontSize: 13,
    color: GOLD,
    fontFamily: FB,
    fontWeight: '600',
    fontStyle: 'italic',
  },
  ladderPhaseBody: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 19,
  },
  ladderSubBox: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 3,
  },
  ladderSubLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: MUTED,
    fontFamily: FB,
  },
  ladderSubText: {
    fontSize: 13,
    color: FG,
    fontFamily: FB,
    lineHeight: 18,
  },
  ladderReadinessBox: {
    backgroundColor: 'rgba(110,187,122,0.06)',
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(110,187,122,0.55)',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 3,
  },
  ladderReadinessLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: GREEN,
    fontFamily: FB,
  },
  ladderReadinessText: {
    fontSize: 13,
    color: FG,
    fontFamily: FB,
    lineHeight: 18,
    fontWeight: '500',
  },
  ladderConnector: {
    width: 2,
    height: 18,
    backgroundColor: 'rgba(245,166,35,0.4)',
    marginLeft: 30,
  },

  // Apprenticeship Path — readiness signal cards
  readinessCard: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderTopWidth: 2,
    borderTopColor: 'rgba(74,144,226,0.55)',
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  readinessCardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: BLUE,
    fontFamily: FH,
  },
  readinessCardBody: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 19,
  },

  // Setup Checklist — readiness category cards
  setupCategoryCard: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  setupCategoryNumber: {
    fontSize: 11,
    fontWeight: '800',
    color: GOLD,
    fontFamily: FH,
    letterSpacing: 0.5,
  },
  setupCategoryTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: FG,
    fontFamily: FH,
    lineHeight: 21,
  },
  setupCategoryBody: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 19,
  },
  setupCategoryExamplesBox: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 4,
  },
  setupCategoryExamplesLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: MUTED,
    fontFamily: FB,
    marginBottom: 2,
  },
  setupCategoryExampleRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-start',
  },
  setupCategoryExampleBullet: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 18,
  },
  setupCategoryExampleText: {
    flex: 1,
    fontSize: 13,
    color: FG,
    fontFamily: FB,
    lineHeight: 18,
  },
  setupCategoryFocusBox: {
    backgroundColor: 'rgba(74,144,226,0.06)',
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(74,144,226,0.55)',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 3,
  },
  setupCategoryFocusLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: BLUE,
    fontFamily: FB,
  },
  setupCategoryFocusText: {
    fontSize: 13,
    color: FG,
    fontFamily: FB,
    lineHeight: 18,
    fontWeight: '500',
  },

  // Setup Checklist — 8-item self-review checklist
  checklistCard: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 6,
    gap: 2,
  },
  checklistRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  checklistRowChecked: {
    backgroundColor: 'rgba(110,187,122,0.06)',
  },
  checklistBox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: BORDER,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checklistBoxChecked: {
    borderColor: GREEN,
    backgroundColor: 'rgba(110,187,122,0.14)',
  },
  checklistText: {
    flex: 1,
    fontSize: 13,
    color: FG,
    fontFamily: FB,
    lineHeight: 19,
  },
  checklistTextChecked: {
    color: FG,
    fontWeight: '500',
  },
  recapList: {
    marginTop: 12,
    marginBottom: 12,
    gap: 10,
  },
  recapRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
  },
  recapNumBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recapNumText: {
    fontSize: 12,
    color: GOLD,
    fontFamily: FH,
    letterSpacing: 0.6,
  },
  recapBody: {
    flex: 1,
  },
  recapTitle: {
    fontSize: 15,
    color: FG,
    fontFamily: FH,
    marginBottom: 4,
  },
  recapText: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 19,
  },
  coverageGrid: {
    marginTop: 12,
    marginBottom: 12,
    gap: 10,
  },
  coverageCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
  },
  coverageTitle: {
    fontSize: 15,
    color: FG,
    fontFamily: FH,
    marginBottom: 6,
  },
  coverageBody: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 19,
  },
  clarityHeading: {
    fontSize: 15,
    color: FG,
    fontFamily: FH,
    marginBottom: 10,
  },
  agreementOpenedNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(110,187,122,0.35)',
    backgroundColor: 'rgba(110,187,122,0.08)',
  },
  agreementOpenedText: {
    flex: 1,
    fontSize: 13,
    color: FG,
    fontFamily: FB,
    lineHeight: 19,
  },

  // ── Phase 10B — In-app Coach Agreement signing ─────────────────────────────
  agreementAccordion: {
    marginTop: 6,
    gap: 8,
  },
  agreementAccordionCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    overflow: 'hidden',
  },
  agreementAccordionCardReviewed: {
    borderColor: 'rgba(110,187,122,0.45)',
    backgroundColor: 'rgba(110,187,122,0.06)',
  },
  agreementAccordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  agreementSectionNumBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agreementSectionNumText: {
    fontSize: 12,
    color: GOLD,
    fontFamily: FH,
    letterSpacing: 0.6,
  },
  agreementSectionTitle: {
    fontSize: 14,
    color: FG,
    fontFamily: FH,
    marginBottom: 2,
  },
  agreementSectionSummary: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 17,
  },
  agreementAccordionRight: {
    width: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agreementAccordionChevron: {
    fontSize: 22,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 22,
  },
  agreementAccordionBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    gap: 8,
  },
  agreementBodyText: {
    fontSize: 13,
    color: FG,
    fontFamily: FB,
    lineHeight: 20,
  },
  agreementDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
  },
  agreementDateText: {
    fontSize: 14,
    color: FG,
    fontFamily: FB,
  },
  agreementNameRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  agreementInputLabel: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  agreementInput: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    backgroundColor: CARD,
    color: FG,
    fontFamily: FB,
    fontSize: 15,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  agreementError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.35)',
    backgroundColor: 'rgba(248,113,113,0.08)',
  },
  agreementErrorText: {
    flex: 1,
    color: '#F87171',
    fontSize: 13,
    fontFamily: FB,
    lineHeight: 18,
  },
  signedBadge: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(110,187,122,0.4)',
    backgroundColor: 'rgba(110,187,122,0.08)',
    marginTop: 8,
    marginBottom: 8,
    alignItems: 'flex-start',
  },
  impersonationBlockCard: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.5)',
    backgroundColor: 'rgba(212,175,55,0.08)',
    marginTop: 8,
    marginBottom: 8,
    alignItems: 'flex-start',
  },
  impersonationBlockIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(212,175,55,0.16)',
  },
  impersonationBlockTitle: {
    fontSize: 15,
    fontFamily: FH,
    color: FG,
    marginBottom: 4,
  },
  impersonationBlockBody: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 19,
  },
  signedBadgeIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(110,187,122,0.14)',
  },
  signedBadgeLabel: {
    fontSize: 10,
    letterSpacing: 1.5,
    fontFamily: FB,
    fontWeight: '700',
    color: GREEN,
    marginBottom: 2,
  },
  signedBadgeName: {
    fontSize: 16,
    color: FG,
    fontFamily: FH,
    marginBottom: 4,
  },
  signedBadgeMeta: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 17,
  },
  signedSignatureWrap: {
    marginTop: 4,
    marginBottom: 8,
    gap: 6,
  },
  signedSignatureFrame: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  signedSignatureLabel: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
    letterSpacing: 0.5,
  },
});
