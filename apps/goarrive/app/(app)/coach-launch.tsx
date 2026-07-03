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
  Linking,
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
import { BG, BORDER, CARD, FB, FG, FH, GOLD, GREEN, MUTED } from '../../lib/theme';

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

  const [progress, setProgress] = useState<CoachLaunchDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeModuleId, setActiveModuleId] = useState<ModuleId | null>(null);
  const [pendingScrollTarget, setPendingScrollTarget] =
    useState<ModuleId | null>(null);

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

  const agreementUrl = (process.env.EXPO_PUBLIC_COACH_AGREEMENT_URL || '').trim();

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
        } else {
          setProgress(emptyDoc(coachId));
        }
      } catch (err) {
        console.error('[CoachLaunch] load error:', err);
        setProgress(emptyDoc(coachId));
      } finally {
        setLoading(false);
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

    const nextCompleted = alreadyComplete ? completed : [...completed, moduleId];
    // Point currentModuleId at the next un-completed module (or same if this was the last)
    const nextCurrent =
      MODULES.find((m) => !nextCompleted.includes(m.id))?.id ?? moduleId;

    await save({
      completedModuleIds: nextCompleted,
      currentModuleId: nextCurrent,
      responses: nextResponses,
    });
    // Only auto-scroll if there's a next module different from the one we
    // just completed. When the final module is completed, nextCurrent === moduleId,
    // and the list will show the celebration state — no scroll needed.
    if (nextCurrent !== moduleId) {
      setPendingScrollTarget(nextCurrent);
    }
    setActiveModuleId(null);
  }

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
            agreementUrl={agreementUrl}
            onComplete={() => completeModule(activeModule.id)}
            onBack={() => setActiveModuleId(null)}
            onFinish={() => router.replace('/(app)/dashboard' as any)}
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
                  <View style={s.moduleCheckCircle}>
                    <Icon name="check" size={14} color="#0E1117" />
                  </View>
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
  agreementUrl: string;
  onComplete: () => void;
  onBack: () => void;
  onFinish: () => void;
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
  agreementUrl,
  onComplete,
  onBack,
  onFinish,
}: ModuleDetailProps) {
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

        {/* Agreement — external link */}
        {module.id === 'agreement' && (
          <View style={s.responseBlock}>
            <Text style={s.responseBody}>
              Everything you've walked through in Coach Launch is summarized in the Coach
              Agreement. This final step protects members, coaches, and GoArrive by putting
              our shared expectations in writing.
            </Text>
            {agreementUrl ? (
              <Pressable
                style={s.primaryBtn}
                onPress={() => Linking.openURL(agreementUrl)}
              >
                <Text style={s.primaryBtnText}>Review + Sign Coach Agreement</Text>
              </Pressable>
            ) : (
              <View>
                <View style={[s.primaryBtn, s.btnDisabled]}>
                  <Text style={s.primaryBtnText}>Review + Sign Coach Agreement</Text>
                </View>
                <Text style={s.helperText}>Agreement link not configured yet.</Text>
              </View>
            )}
          </View>
        )}

        {/* Placeholder body for modules without dedicated content yet */}
        {['memberExperience', 'coachExperience', 'howWeCoach', 'moneyGrowth', 'apprenticeshipPath', 'setupChecklist'].includes(module.id) && (
          <View style={s.placeholderBlock}>
            <Text style={s.placeholderText}>
              Deeper content for this module is coming soon. For now, read the intro above,
              then mark the module complete to keep moving.
            </Text>
          </View>
        )}
      </View>

      {/* Actions */}
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
    </View>
  );
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
});
