/**
 * Coach Setup — 6-module practical post-agreement onboarding guide.
 *
 * Route: /(app)/coach-setup  (coach & platformAdmin only — hidden from tab bar)
 *
 * Purpose:
 *   Walks a new coach through the operational setup steps after signing the
 *   Coach Agreement: identity, Stripe, Zoom, @goa.fit email, certification,
 *   and first-member readiness.
 *
 * Progress storage:
 *   coach_setup/{coachId} — see CoachSetupDoc below.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
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
  updateDoc,
} from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getAuth, updateProfile } from 'firebase/auth';
import * as ImagePicker from 'expo-image-picker';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import { Icon } from '../../components/Icon';
import { BG, BLUE, BORDER, CARD, FB, FG, FH, GOLD, GREEN, MUTED } from '../../lib/theme';
import ConfettiBurst from '../../components/ConfettiBurst';

// ── Module definitions ─────────────────────────────────────────────────────────

type ModuleId =
  | 'identity'
  | 'connectStripe'
  | 'zoomSetup'
  | 'goaEmail'
  | 'certification'
  | 'firstMember'
  | 'launchCelebration';

interface ModuleDef {
  id: ModuleId;
  number: number;
  title: string;
  description: string;
  estimatedTime: string;
}

const MODULES: ModuleDef[] = [
  {
    id: 'identity',
    number: 1,
    title: 'Your Identity',
    description: 'Set up how members and the platform will see you.',
    estimatedTime: '3–5 min',
  },
  {
    id: 'connectStripe',
    number: 2,
    title: 'Connect Stripe',
    description: 'Required before you can receive payments from members.',
    estimatedTime: '5–10 min',
  },
  {
    id: 'zoomSetup',
    number: 3,
    title: 'Your Zoom Setup',
    description: 'How live coaching sessions work inside GoArrive.',
    estimatedTime: '3–5 min',
  },
  {
    id: 'goaEmail',
    number: 4,
    title: 'Your GoArrive Email',
    description: 'Set up your official @goa.fit email so members hear from you as part of the team.',
    estimatedTime: '5 min',
  },
  {
    id: 'certification',
    number: 5,
    title: 'Certification',
    description: 'GoArrive coaches are expected to maintain a recognized fitness certification.',
    estimatedTime: '5 min',
  },
  {
    id: 'firstMember',
    number: 6,
    title: 'Your First Member',
    description: 'A quick walkthrough of the GoArrive coaching loop before your first session.',
    estimatedTime: '5 min',
  },
  {
    id: 'launchCelebration',
    number: 7,
    title: 'You Are Set Up',
    description: 'Ready to serve your first member.',
    estimatedTime: '1 min',
  },
];

// ── Firestore doc shape ────────────────────────────────────────────────────────

interface CoachSetupDoc {
  coachId: string;
  completedModules: ModuleId[];
  currentModuleId: ModuleId;
  startedAt?: any;
  updatedAt?: any;
  completedAt?: any;
  profilePhotoUploaded?: boolean;
  logoUploaded?: boolean;
  certificationUploaded?: boolean;
  coachCertEnrolled?: boolean;
  goaEmail?: string;
}

function emptyDoc(coachId: string): CoachSetupDoc {
  return {
    coachId,
    completedModules: [],
    currentModuleId: 'identity',
  };
}

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function CoachSetupScreen() {
  const { user, claims, effectiveUid } = useAuth();
  const role = claims?.role ?? '';
  const isAllowed = role === 'coach' || role === 'platformAdmin' || claims?.admin === true;

  if (!isAllowed) {
    router.replace('/(app)/dashboard' as any);
    return null;
  }

  return <CoachSetupScreenInner />;
}

function CoachSetupScreenInner() {
  const insets = useSafeAreaInsets();
  const { user, claims, effectiveUid } = useAuth();
  const coachId = effectiveUid || claims?.coachId || user?.uid || '';

  const [progress, setProgress] = useState<CoachSetupDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeModuleId, setActiveModuleId] = useState<ModuleId | null>(null);
  const [pendingScrollTarget, setPendingScrollTarget] = useState<ModuleId | null>(null);
  const [justCompletedId, setJustCompletedId] = useState<ModuleId | null>(null);

  // coaches/{coachId} data for identity + stripe status
  const [photoURL, setPhotoURL] = useState('');
  const [logoURL, setLogoURL] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [stripeAccountId, setStripeAccountId] = useState('');
  const [certificationURL, setCertificationURL] = useState('');

  // Drafts
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [bioDraft, setBioDraft] = useState('');
  const [goaEmailDraft, setGoaEmailDraft] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCert, setUploadingCert] = useState(false);
  const [coachCertEnrolled, setCoachCertEnrolled] = useState(false);
  const [enrollingCert, setEnrollingCert] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const moduleListYRef = useRef<number | null>(null);
  const moduleCardYsRef = useRef<Record<string, number>>({});

  // Load progress + coach doc on mount
  useEffect(() => {
    if (!coachId) return;
    (async () => {
      setLoading(true);
      try {
        const [setupSnap, coachSnap] = await Promise.all([
          getDoc(doc(db, 'coach_setup', coachId)),
          getDoc(doc(db, 'coaches', coachId)),
        ]);

        if (setupSnap.exists()) {
          const data = setupSnap.data() as CoachSetupDoc;
          setProgress({
            coachId,
            completedModules: data.completedModules ?? [],
            currentModuleId: data.currentModuleId ?? 'identity',
            startedAt: data.startedAt,
            updatedAt: data.updatedAt,
            completedAt: data.completedAt,
            profilePhotoUploaded: data.profilePhotoUploaded,
            logoUploaded: data.logoUploaded,
            certificationUploaded: data.certificationUploaded,
            coachCertEnrolled: data.coachCertEnrolled,
            goaEmail: data.goaEmail,
          });
          if (data.goaEmail) setGoaEmailDraft(data.goaEmail);
          if (data.coachCertEnrolled) setCoachCertEnrolled(true);
        } else {
          setProgress(emptyDoc(coachId));
        }

        if (coachSnap.exists()) {
          const d = coachSnap.data() as any;
          setPhotoURL(d.photoURL ?? '');
          setLogoURL(d.logoURL ?? '');
          setDisplayName(d.name ?? d.displayName ?? '');
          setDisplayNameDraft(d.name ?? d.displayName ?? '');
          setBioDraft(d.bio ?? '');
          setStripeAccountId(d.stripeAccountId ?? '');
          setCertificationURL(d.certificationURL ?? '');
        }
      } catch (err) {
        console.error('[CoachSetup] load error:', err);
        setProgress(emptyDoc(coachId));
      } finally {
        setLoading(false);
      }
    })();
  }, [coachId]);

  const completed: ModuleId[] = progress?.completedModules ?? [];
  const pct = Math.round((completed.filter(id => id !== 'launchCelebration').length / 6) * 100);
  const allDone = completed.includes('launchCelebration');
  const nextIncomplete = MODULES.find((m) => !completed.includes(m.id)) ?? null;

  // All content modules always unlocked; celebration unlocks after all 6 done
  function isUnlocked(id: ModuleId): boolean {
    if (id === 'launchCelebration') {
      const contentIds: ModuleId[] = ['identity', 'connectStripe', 'zoomSetup', 'goaEmail', 'certification', 'firstMember'];
      return contentIds.every((cid) => completed.includes(cid));
    }
    return true;
  }

  function statusFor(id: ModuleId): 'complete' | 'ready' | 'locked' {
    if (completed.includes(id)) return 'complete';
    if (isUnlocked(id)) return 'ready';
    return 'locked';
  }

  const save = useCallback(
    async (patch: Partial<CoachSetupDoc>) => {
      if (!coachId || !progress) return;
      setSaving(true);
      try {
        const merged: CoachSetupDoc = { ...progress, ...patch, coachId };
        const writePayload: any = {
          coachId,
          completedModules: merged.completedModules,
          currentModuleId: merged.currentModuleId,
          updatedAt: serverTimestamp(),
        };
        if (merged.profilePhotoUploaded != null) writePayload.profilePhotoUploaded = merged.profilePhotoUploaded;
        if (merged.logoUploaded != null) writePayload.logoUploaded = merged.logoUploaded;
        if (merged.certificationUploaded != null) writePayload.certificationUploaded = merged.certificationUploaded;
        if (merged.coachCertEnrolled != null) writePayload.coachCertEnrolled = merged.coachCertEnrolled;
        if (merged.goaEmail != null) writePayload.goaEmail = merged.goaEmail;
        if (!progress.startedAt) writePayload.startedAt = serverTimestamp();
        const contentIds: ModuleId[] = ['identity', 'connectStripe', 'zoomSetup', 'goaEmail', 'certification', 'firstMember', 'launchCelebration'];
        if (contentIds.every((id) => merged.completedModules.includes(id)) && !progress.completedAt) {
          writePayload.completedAt = serverTimestamp();
        }
        await setDoc(doc(db, 'coach_setup', coachId), writePayload, { merge: true });
        setProgress(merged);
      } catch (err) {
        console.error('[CoachSetup] save error:', err);
      } finally {
        setSaving(false);
      }
    },
    [coachId, progress]
  );

  async function completeModule(moduleId: ModuleId) {
    if (!progress) return;
    const alreadyComplete = completed.includes(moduleId);
    const nextCompleted = alreadyComplete ? completed : [...completed, moduleId];
    const nextCurrent =
      MODULES.find((m) => !nextCompleted.includes(m.id))?.id ?? moduleId;

    const patch: Partial<CoachSetupDoc> = {
      completedModules: nextCompleted,
      currentModuleId: nextCurrent,
    };
    if (moduleId === 'goaEmail' && goaEmailDraft.trim()) {
      patch.goaEmail = goaEmailDraft.trim();
    }

    await save(patch);
    setJustCompletedId(moduleId);
    setPendingScrollTarget(moduleId);
    setActiveModuleId(null);
  }

  // Photo upload handlers
  async function handlePickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    const uri = result.assets[0].uri;
    setPhotoURL(uri); // show local preview immediately
    setUploadingPhoto(true);
    try {
      const resp = await fetch(uri);
      const blob = await resp.blob();
      const storage = getStorage();
      const storageRef = ref(storage, `coaches/${coachId}/photo/${Date.now()}.jpg`);
      await uploadBytes(storageRef, blob);
      const downloadURL = await getDownloadURL(storageRef);
      const auth = getAuth();
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, { photoURL: downloadURL });
      }
      await updateDoc(doc(db, 'coaches', coachId), { photoURL: downloadURL });
      setPhotoURL(downloadURL);
      await save({ profilePhotoUploaded: true });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to upload photo.');
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handlePickLogo() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    const uri = result.assets[0].uri;
    setLogoURL(uri); // show local preview immediately
    setUploadingLogo(true);
    try {
      const resp = await fetch(uri);
      const blob = await resp.blob();
      const storage = getStorage();
      const storageRef = ref(storage, `coaches/${coachId}/logo/${Date.now()}.jpg`);
      await uploadBytes(storageRef, blob);
      const downloadURL = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'coaches', coachId), { logoURL: downloadURL });
      setLogoURL(downloadURL);
      await save({ logoUploaded: true });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to upload logo.');
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleSaveDisplayName() {
    const trimmed = displayNameDraft.trim();
    if (!trimmed || trimmed === displayName) return;
    try {
      await updateDoc(doc(db, 'coaches', coachId), { name: trimmed });
      setDisplayName(trimmed);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save name.');
    }
  }

  async function handleSaveBio() {
    const trimmed = bioDraft.trim();
    try {
      await updateDoc(doc(db, 'coaches', coachId), { bio: trimmed });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save bio.');
    }
  }

  async function handlePickCert() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsEditing: false,
      quality: 0.9,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setUploadingCert(true);
    try {
      const uri = result.assets[0].uri;
      const resp = await fetch(uri);
      const blob = await resp.blob();
      const ext = uri.split('.').pop()?.toLowerCase() ?? 'jpg';
      const storage = getStorage();
      const storageRef = ref(storage, `coaches/${coachId}/certification/${Date.now()}.${ext}`);
      await uploadBytes(storageRef, blob);
      const downloadURL = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'coaches', coachId), { certificationURL: downloadURL });
      setCertificationURL(downloadURL);
      await save({ certificationUploaded: true });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to upload certification.');
    } finally {
      setUploadingCert(false);
    }
  }

  async function handleEnrollCert() {
    if (!coachId || coachCertEnrolled) return;
    setEnrollingCert(true);
    try {
      await save({ coachCertEnrolled: true });
      setCoachCertEnrolled(true);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to enroll.');
    } finally {
      setEnrollingCert(false);
    }
  }

  // Clear just-completed highlight after animation
  useEffect(() => {
    if (!justCompletedId) return;
    const t = setTimeout(() => setJustCompletedId(null), 2400);
    return () => clearTimeout(t);
  }, [justCompletedId]);

  // Snap to top when opening a module
  useEffect(() => {
    if (!activeModuleId) return;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [activeModuleId]);

  // Scroll to module after completing
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
        <Text style={s.headerTitle}>Coach Setup</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[s.scrollContent, { paddingBottom: 140 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {activeModule ? (
          <ModuleDetail
            module={activeModule}
            isComplete={completed.includes(activeModule.id)}
            saving={saving}
            photoURL={photoURL}
            logoURL={logoURL}
            displayNameDraft={displayNameDraft}
            setDisplayNameDraft={setDisplayNameDraft}
            bioDraft={bioDraft}
            setBioDraft={setBioDraft}
            uploadingPhoto={uploadingPhoto}
            uploadingLogo={uploadingLogo}
            uploadingCert={uploadingCert}
            profilePhotoUploaded={!!progress?.profilePhotoUploaded || !!photoURL}
            certificationURL={certificationURL}
            stripeAccountId={stripeAccountId}
            goaEmailDraft={goaEmailDraft}
            setGoaEmailDraft={setGoaEmailDraft}
            coachCertEnrolled={coachCertEnrolled}
            enrollingCert={enrollingCert}
            onPickPhoto={handlePickPhoto}
            onPickLogo={handlePickLogo}
            onPickCert={handlePickCert}
            onEnrollCert={handleEnrollCert}
            onSaveDisplayName={handleSaveDisplayName}
            onSaveBio={handleSaveBio}
            onComplete={() => completeModule(activeModule.id)}
            onSkipStripe={() => completeModule('connectStripe')}
            onBack={() => setActiveModuleId(null)}
            onFinish={() => router.replace('/(app)/dashboard' as any)}
          />
        ) : (
          <SetupIndex
            pct={pct}
            completedCount={completed.filter((id) => id !== 'launchCelebration').length}
            totalCount={6}
            allDone={allDone}
            nextIncomplete={nextIncomplete}
            statusFor={statusFor}
            isUnlocked={isUnlocked}
            justCompletedId={justCompletedId}
            onOpenModule={(id) => setActiveModuleId(id)}
            onListLayout={(y) => { moduleListYRef.current = y; }}
            onCardLayout={(id, y) => { moduleCardYsRef.current[id] = y; }}
          />
        )}
      </ScrollView>
    </View>
  );
}

// ── Setup index (module list) ──────────────────────────────────────────────────

interface SetupIndexProps {
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

function SetupIndex({
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
}: SetupIndexProps) {
  return (
    <>
      <View style={s.intro}>
        <Text style={s.introSuper}>PRACTICAL SETUP</Text>
        <Text style={s.introHeading}>Coach Setup</Text>
        <Text style={s.introBody}>
          Your operational checklist after signing the Coach Agreement. Complete each module to get your tools, profile, and presence ready for your first member.
        </Text>
      </View>

      <View style={s.progressCard}>
        <View style={s.progressTopRow}>
          <View>
            <Text style={s.progressLabel}>PROGRESS</Text>
            <Text style={s.progressValue}>{pct}%</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.progressLabel}>MODULES</Text>
            <Text style={s.progressValue}>{completedCount}/{totalCount}</Text>
          </View>
        </View>
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: `${pct}%` as any }]} />
        </View>

        {allDone ? (
          <View style={s.currentStep}>
            <Icon name="check-circle" size={16} color={GREEN} />
            <Text style={[s.currentStepText, { color: GREEN }]}>Setup complete.</Text>
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
              {completedCount === 0 ? 'Start Setup' : 'Continue Setup'}
            </Text>
            <Icon name="chevron-right" size={16} color="#0E1117" />
          </Pressable>
        )}
      </View>

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
                  <Text style={[s.moduleNumber, status === 'locked' && { color: MUTED }]}>
                    {String(m.number).padStart(2, '0')}
                  </Text>
                )}
              </View>

              <View style={s.moduleBody}>
                <Text style={[s.moduleTitle, status === 'locked' && { color: MUTED }, isComplete && { color: GREEN }]}>
                  {m.title}
                </Text>
                <Text style={s.moduleDesc} numberOfLines={2}>{m.description}</Text>
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

// ── Module detail view ─────────────────────────────────────────────────────────

interface ModuleDetailProps {
  module: ModuleDef;
  isComplete: boolean;
  saving: boolean;
  photoURL: string;
  logoURL: string;
  displayNameDraft: string;
  setDisplayNameDraft: (v: string) => void;
  bioDraft: string;
  setBioDraft: (v: string) => void;
  uploadingPhoto: boolean;
  uploadingLogo: boolean;
  uploadingCert: boolean;
  profilePhotoUploaded: boolean;
  certificationURL: string;
  stripeAccountId: string;
  goaEmailDraft: string;
  setGoaEmailDraft: (v: string) => void;
  onPickPhoto: () => void;
  onPickLogo: () => void;
  coachCertEnrolled: boolean;
  enrollingCert: boolean;
  onPickCert: () => void;
  onEnrollCert: () => void;
  onSaveDisplayName: () => void;
  onSaveBio: () => void;
  onComplete: () => void;
  onSkipStripe: () => void;
  onBack: () => void;
  onFinish: () => void;
}

function ModuleDetail({
  module,
  isComplete,
  saving,
  photoURL,
  logoURL,
  displayNameDraft,
  setDisplayNameDraft,
  bioDraft,
  setBioDraft,
  uploadingPhoto,
  uploadingLogo,
  uploadingCert,
  profilePhotoUploaded,
  certificationURL,
  stripeAccountId,
  coachCertEnrolled,
  enrollingCert,
  goaEmailDraft,
  setGoaEmailDraft,
  onPickPhoto,
  onPickLogo,
  onPickCert,
  onEnrollCert,
  onSaveDisplayName,
  onSaveBio,
  onComplete,
  onSkipStripe,
  onBack,
  onFinish,
}: ModuleDetailProps) {
  const [confettiVisible, setConfettiVisible] = useState(false);

  useEffect(() => {
    if (module.id === 'launchCelebration') setConfettiVisible(true);
  }, [module.id]);

  // Celebration module
  if (module.id === 'launchCelebration') {
    return (
      <View>
        <View style={s.celebrateCard}>
          <View style={s.celebrateBadge}>
            <Icon name="star-filled" size={32} color={GOLD} />
          </View>
          <Text style={s.celebrateHeading}>You Are Set Up.</Text>
          <Text style={s.celebrateBody}>
            Your profile is live, your tools are connected, and you are ready to serve your first member. Let us go.
          </Text>
          {!isComplete && (
            <Pressable
              style={[s.primaryBtn, saving && s.btnDisabled]}
              onPress={() => {
                setConfettiVisible(true);
                onComplete();
              }}
              disabled={saving}
            >
              <Text style={s.primaryBtnText}>{saving ? 'Saving…' : 'Mark Complete'}</Text>
            </Pressable>
          )}
          <Pressable style={[s.primaryBtn, { marginTop: 10 }]} onPress={onFinish}>
            <Text style={s.primaryBtnText}>Go to Dashboard</Text>
          </Pressable>
        </View>
        {confettiVisible && <ConfettiBurst onDone={() => setConfettiVisible(false)} />}
      </View>
    );
  }

  // canComplete logic per module
  const canComplete = (() => {
    if (module.id === 'identity') return profilePhotoUploaded;
    if (module.id === 'connectStripe') return !!stripeAccountId;
    return true; // zoomSetup, goaEmail, certification, firstMember are manual
  })();

  return (
    <View style={s.detailWrap}>
      <View style={s.detailHeader}>
        <Text style={s.detailNumber}>MODULE {String(module.number).padStart(2, '0')}</Text>
        <Text style={s.detailTitle}>{module.title}</Text>
        <Text style={s.detailMeta}>{module.estimatedTime}</Text>
      </View>

      <View style={s.detailBody}>

        {/* ── Module 1: Your Identity ─────────────────────────────────────── */}
        {module.id === 'identity' && (
          <>
            <Text style={s.sectionIntro}>
              Your profile is what members and the GoArrive team see first. A clear photo, name, and brief bio build trust before a session even begins.
            </Text>

            {/* Profile Photo */}
            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>Profile Photo</Text>
              <Text style={s.sectionBody}>
                Required to complete this module. Your photo appears in member-facing views throughout the app.
              </Text>
              <View style={s.photoRow}>
                <View style={{ position: 'relative' }}>
                  {photoURL ? (
                    <Image source={{ uri: photoURL }} style={s.photoPreview} />
                  ) : (
                    <View style={s.photoPlaceholder}>
                      <Icon name="user" size={32} color={MUTED} />
                    </View>
                  )}
                  {uploadingPhoto && (
                    <View style={s.photoUploadOverlay}>
                      <ActivityIndicator size="small" color="#fff" />
                    </View>
                  )}
                </View>
                <View style={{ flex: 1, gap: 8 }}>
                  <Pressable
                    style={[s.uploadBtn, uploadingPhoto && s.btnDisabled]}
                    onPress={onPickPhoto}
                    disabled={uploadingPhoto}
                  >
                    {uploadingPhoto ? (
                      <ActivityIndicator size="small" color={GOLD} />
                    ) : (
                      <>
                        <Icon name="upload" size={14} color={GOLD} />
                        <Text style={s.uploadBtnText}>{photoURL ? 'Replace Photo' : 'Upload Photo'}</Text>
                      </>
                    )}
                  </Pressable>
                  {photoURL && (
                    <View style={s.successRow}>
                      <Icon name="check-circle" size={14} color={GREEN} />
                      <Text style={s.successText}>Photo uploaded</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>

            {/* Logo */}
            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>Logo (Optional)</Text>
              <Text style={s.sectionBody}>
                Upload a personal or brand logo. Displayed in some coach-facing contexts.
              </Text>
              <View style={s.photoRow}>
                <View style={{ position: 'relative' }}>
                  {logoURL ? (
                    <Image source={{ uri: logoURL }} style={[s.photoPreview, { borderRadius: 8 }]} />
                  ) : (
                    <View style={[s.photoPlaceholder, { borderRadius: 8 }]}>
                      <Icon name="image" size={28} color={MUTED} />
                    </View>
                  )}
                  {uploadingLogo && (
                    <View style={[s.photoUploadOverlay, { borderRadius: 8 }]}>
                      <ActivityIndicator size="small" color="#fff" />
                    </View>
                  )}
                </View>
                <View style={{ flex: 1, gap: 8 }}>
                  <Pressable
                    style={[s.uploadBtn, uploadingLogo && s.btnDisabled]}
                    onPress={onPickLogo}
                    disabled={uploadingLogo}
                  >
                    {uploadingLogo ? (
                      <ActivityIndicator size="small" color={GOLD} />
                    ) : (
                      <>
                        <Icon name="upload" size={14} color={GOLD} />
                        <Text style={s.uploadBtnText}>{logoURL ? 'Replace Logo' : 'Upload Logo'}</Text>
                      </>
                    )}
                  </Pressable>
                  {logoURL && (
                    <View style={s.successRow}>
                      <Icon name="check-circle" size={14} color={GREEN} />
                      <Text style={s.successText}>Logo uploaded</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>

            {/* Display Name */}
            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>Display Name</Text>
              <Text style={s.sectionBody}>This is how your name appears to members.</Text>
              <TextInput
                style={s.textInput}
                value={displayNameDraft}
                onChangeText={setDisplayNameDraft}
                onBlur={onSaveDisplayName}
                placeholder="Your name"
                placeholderTextColor={MUTED}
                autoCapitalize="words"
              />
            </View>

            {/* Bio */}
            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>Coach Bio (Optional)</Text>
              <Text style={s.sectionBody}>A short bio helps members understand your background. 250 characters max.</Text>
              <TextInput
                style={[s.textInput, s.textArea]}
                value={bioDraft}
                onChangeText={(v) => setBioDraft(v.slice(0, 250))}
                onBlur={onSaveBio}
                placeholder="Tell members about your coaching background and approach…"
                placeholderTextColor={MUTED}
                multiline
                numberOfLines={4}
              />
              <Text style={s.charCount}>{bioDraft.length}/250</Text>
            </View>

            <View style={s.requirementNote}>
              <Icon name="info" size={14} color={BLUE} />
              <Text style={s.requirementNoteText}>
                Profile photo is required to mark this module complete. Logo, name edits, and bio are optional but encouraged.
              </Text>
            </View>
          </>
        )}

        {/* ── Module 2: Connect Stripe ────────────────────────────────────── */}
        {module.id === 'connectStripe' && (
          <>
            <Text style={s.sectionIntro}>
              Stripe Connect is how you receive payments from members. It takes 5–10 minutes to set up and must be completed before members can pay you through the app.
            </Text>

            {/* Status chip */}
            <View style={[
              s.statusChip,
              stripeAccountId ? s.statusChipConnected : s.statusChipPending,
            ]}>
              <Icon
                name={stripeAccountId ? 'check-circle' : 'clock'}
                size={16}
                color={stripeAccountId ? GREEN : GOLD}
              />
              <Text style={[s.statusChipText, { color: stripeAccountId ? GREEN : GOLD }]}>
                {stripeAccountId ? 'Stripe Connected' : 'Not yet connected'}
              </Text>
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>How to connect Stripe</Text>
              {[
                'Go to the Billing tab in the app (or tap the button below)',
                'Tap "Connect Stripe" — this opens Stripe\'s secure onboarding',
                'Enter your business details, SSN last 4, and bank account for payouts',
                'Return to the app — your status will update to "Connected"',
                'Payments from members will deposit on the 5th business day of each month',
              ].map((step, i) => (
                <View key={i} style={s.stepRow}>
                  <View style={s.stepNumBox}>
                    <Text style={s.stepNum}>{i + 1}</Text>
                  </View>
                  <Text style={s.stepText}>{step}</Text>
                </View>
              ))}
            </View>

            <Pressable
              style={s.secondaryBtn}
              onPress={() => router.push('/(app)/billing' as any)}
            >
              <Icon name="external-link" size={14} color={BLUE} />
              <Text style={s.secondaryBtnText}>Go to Billing Tab</Text>
            </Pressable>
          </>
        )}

        {/* ── Module 3: Zoom Setup ────────────────────────────────────────── */}
        {module.id === 'zoomSetup' && (
          <>
            <Text style={s.sectionIntro}>
              You do not need to create a Zoom account or meeting link. GoArrive handles this for you.
            </Text>

            <View style={s.infoCard}>
              <Icon name="check-circle" size={20} color={GREEN} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.infoCardTitle}>Zoom is set up by GoArrive</Text>
                <Text style={s.infoCardBody}>
                  Nothing to install or connect on your end. The platform provisions your coaching room automatically.
                </Text>
              </View>
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>How it works</Text>
              {[
                'GoArrive provisions your coaching Zoom room — you do NOT need to create one yourself',
                'When a member books a session, the platform creates the Zoom meeting link automatically',
                'You will receive the meeting link in your dashboard under Scheduling before each session',
              ].map((item, i) => (
                <View key={i} style={s.bulletRow}>
                  <Text style={s.bulletDot}>•</Text>
                  <Text style={s.bulletText}>{item}</Text>
                </View>
              ))}
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>What you need to do</Text>
              {[
                'Ensure you have the Zoom app installed on your device (desktop or mobile)',
                'Test your camera and microphone before your first session',
                'For your first session: join 5 minutes early to verify your setup',
              ].map((item, i) => (
                <View key={i} style={s.bulletRow}>
                  <Text style={s.bulletDot}>•</Text>
                  <Text style={s.bulletText}>{item}</Text>
                </View>
              ))}
            </View>

            <View style={s.tipCard}>
              <Text style={s.tipLabel}>FIRST SESSION TIP</Text>
              <Text style={s.tipBody}>
                Join 5 minutes early to test your setup. A prepared coach signals professionalism before a word is spoken.
              </Text>
            </View>
          </>
        )}

        {/* ── Module 4: GoArrive Email ────────────────────────────────────── */}
        {module.id === 'goaEmail' && (
          <>
            <Text style={s.sectionIntro}>
              Your official @goa.fit email address is your professional line to members. It runs on Google Workspace and connects to your existing Google apps.
            </Text>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>Getting set up</Text>
              {[
                'Check your inbox at the email address you used to sign up — you should have received a setup invitation from GoArrive',
                'If you have not received it, contact devin.simpson@goa.fit to have your @goa.fit mailbox provisioned',
                'Once provisioned, access your email at mail.google.com (it uses Google Workspace)',
                'iPhone: Settings > Mail > Add Account > Google. Android: Gmail app > Add Account',
                'Set it as your reply-from address when emailing members about GoArrive',
              ].map((step, i) => (
                <View key={i} style={s.stepRow}>
                  <View style={s.stepNumBox}>
                    <Text style={s.stepNum}>{i + 1}</Text>
                  </View>
                  <Text style={s.stepText}>{step}</Text>
                </View>
              ))}
            </View>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>Your @goa.fit address (optional)</Text>
              <Text style={s.sectionBody}>Once you have it, record it here for reference.</Text>
              <TextInput
                style={s.textInput}
                value={goaEmailDraft}
                onChangeText={setGoaEmailDraft}
                placeholder="yourname@goa.fit"
                placeholderTextColor={MUTED}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
          </>
        )}

        {/* ── Module 5: Certification ─────────────────────────────────────── */}
        {module.id === 'certification' && (
          <>
            <Text style={s.sectionIntro}>
              GoArrive coaches maintain a recognized coaching credential. If you already hold a certification, upload it below. If not, enroll in the GoArrive Certified Coach program.
            </Text>

            {/* GoArrive Certified Coach hero card */}
            <View style={s.certHeroCard}>
              <View style={s.certBadgeRow}>
                <View style={s.certBadge}>
                  <Text style={s.certBadgeText}>GCC</Text>
                </View>
                <View style={s.certBadgeLabels}>
                  <Text style={s.certProgramLabel}>GOARRIVE CERTIFIED COACH</Text>
                  <Text style={s.certBadgeSub}>Level 1 · Self-Paced</Text>
                </View>
              </View>

              <View style={s.certFeatureList}>
                {[
                  '5 foundational coaching modules',
                  'Move at your own pace — no deadlines',
                  'Practical skills, not just theory',
                  'Official GCC credential upon completion',
                ].map((feature, i) => (
                  <View key={i} style={s.certFeatureRow}>
                    <Icon name="check-circle" size={14} color={GOLD} />
                    <Text style={s.certFeatureText}>{feature}</Text>
                  </View>
                ))}
              </View>

              {coachCertEnrolled ? (
                <>
                  <View style={s.certEnrolledBadge}>
                    <Icon name="check-circle" size={13} color={GREEN} />
                    <Text style={s.certEnrolledText}>Enrolled in GCC</Text>
                  </View>
                  <View style={s.certNextStepCard}>
                    <Text style={s.certNextStepLabel}>YOUR NEXT STEP</Text>
                    <Text style={s.certNextStepTitle}>Module 1: Coaching Foundations</Text>
                    <Text style={s.certNextStepBody}>
                      Understand the GoArrive coaching philosophy, learn the member journey, and establish your coaching identity.
                    </Text>
                    <View style={s.certStartRow}>
                      <Icon name="clock" size={12} color={MUTED} />
                      <Text style={s.certStartTime}>~45 min · Available now</Text>
                    </View>
                  </View>
                </>
              ) : (
                <Pressable
                  style={[s.certEnrollBtn, enrollingCert && s.btnDisabled]}
                  onPress={onEnrollCert}
                  disabled={enrollingCert}
                >
                  {enrollingCert ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <>
                      <Text style={s.certEnrollBtnText}>Enroll in GCC</Text>
                      <Icon name="arrow-right" size={14} color="#000" />
                    </>
                  )}
                </Pressable>
              )}
            </View>

            {/* Upload existing cert */}
            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>Already certified? Upload it</Text>
              <Text style={s.sectionBody}>
                Upload your current certification document or image.
              </Text>

              {certificationURL ? (
                <View style={s.certUploadedCard}>
                  <Icon name="file" size={20} color={GREEN} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.certUploadedTitle}>Certification uploaded</Text>
                    <Text style={s.certUploadedSub}>Tap below to replace</Text>
                  </View>
                  <Pressable
                    style={[s.uploadBtn, uploadingCert && s.btnDisabled]}
                    onPress={onPickCert}
                    disabled={uploadingCert}
                  >
                    {uploadingCert ? (
                      <ActivityIndicator size="small" color={GOLD} />
                    ) : (
                      <Text style={s.uploadBtnText}>Replace</Text>
                    )}
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  style={[s.uploadBtn, uploadingCert && s.btnDisabled]}
                  onPress={onPickCert}
                  disabled={uploadingCert}
                >
                  {uploadingCert ? (
                    <ActivityIndicator size="small" color={GOLD} />
                  ) : (
                    <>
                      <Icon name="upload" size={14} color={GOLD} />
                      <Text style={s.uploadBtnText}>Upload Certification</Text>
                    </>
                  )}
                </Pressable>
              )}
            </View>
          </>
        )}

        {/* ── Module 6: First Member ──────────────────────────────────────── */}
        {module.id === 'firstMember' && (
          <>
            <Text style={s.sectionIntro}>
              Before your first session, walk through what your member will experience. Understanding their journey makes you a sharper coach from session one.
            </Text>

            <View style={s.sectionBlock}>
              <Text style={s.sectionHeading}>The four steps your first member will experience</Text>
              {[
                {
                  title: 'Intake',
                  body: 'Member fills out a simple intake form covering their goals, experience, and any limitations. You review it in the Members tab.',
                },
                {
                  title: 'Plan Build',
                  body: 'Using what you learned in the intake, build their first plan in the Build tab. Keep it simple for session one.',
                },
                {
                  title: 'Session',
                  body: 'Show up on Zoom 5 minutes early. Lead with connection before correction. Ask, listen, adapt.',
                },
                {
                  title: 'Follow-Up',
                  body: 'After the session, leave a short note or Loom video in their member profile. This is what makes GoArrive different.',
                },
              ].map((step, i) => (
                <View key={i} style={s.memberStepCard}>
                  <View style={s.memberStepHeader}>
                    <View style={s.memberStepBadge}>
                      <Text style={s.memberStepBadgeText}>{i + 1}</Text>
                    </View>
                    <Text style={s.memberStepTitle}>{step.title}</Text>
                  </View>
                  <Text style={s.memberStepBody}>{step.body}</Text>
                </View>
              ))}
            </View>

            <View style={s.quoteCard}>
              <Text style={s.quoteText}>
                "Your first member does not need a perfect plan. They need to feel seen, supported, and like they made the right choice. That is what GoArrive is built for."
              </Text>
            </View>
          </>
        )}

      </View>

      {/* Footer actions */}
      <View style={s.footer}>
        {isComplete ? (
          <View style={s.completedBanner}>
            <Icon name="check-circle" size={16} color={GREEN} />
            <Text style={s.completedBannerText}>Module complete</Text>
          </View>
        ) : (
          <>
            {module.id === 'identity' && (
              <Pressable
                style={[s.primaryBtn, (!canComplete || saving) && s.btnDisabled]}
                onPress={onComplete}
                disabled={!canComplete || saving}
              >
                <Text style={s.primaryBtnText}>
                  {saving ? 'Saving…' : canComplete ? 'Mark Complete' : 'Upload a profile photo to continue'}
                </Text>
              </Pressable>
            )}
            {module.id === 'connectStripe' && (
              <>
                <Pressable
                  style={[s.primaryBtn, (!canComplete || saving) && s.btnDisabled]}
                  onPress={onComplete}
                  disabled={!canComplete || saving}
                >
                  <Text style={s.primaryBtnText}>
                    {saving ? 'Saving…' : canComplete ? 'Mark Complete' : 'Connect Stripe to continue'}
                  </Text>
                </Pressable>
                {!canComplete && (
                  <Pressable style={s.skipBtn} onPress={onSkipStripe} disabled={saving}>
                    <Text style={s.skipBtnText}>I'll do this later</Text>
                  </Pressable>
                )}
              </>
            )}
            {module.id !== 'identity' && module.id !== 'connectStripe' && (
              <Pressable
                style={[s.primaryBtn, saving && s.btnDisabled]}
                onPress={onComplete}
                disabled={saving}
              >
                <Text style={s.primaryBtnText}>
                  {saving ? 'Saving…' : module.id === 'zoomSetup' ? 'Got it, I\'m ready' : module.id === 'goaEmail' ? 'Email is set up' : module.id === 'certification' ? 'Got it' : 'I am ready'}
                </Text>
              </Pressable>
            )}
          </>
        )}
      </View>
    </View>
  );
}

// ── StyleSheet ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

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
  backText: { color: BLUE, fontSize: 15, fontFamily: FB },
  headerTitle: { color: FG, fontSize: 18, fontWeight: '700', fontFamily: FH },

  scrollContent: { padding: 16, gap: 14 },

  // Intro
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
  moduleCardPressed: { backgroundColor: '#151E2E' },
  moduleCardLocked: { opacity: 0.55 },
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
  moduleNumberWrap: { width: 34, alignItems: 'center' },
  moduleNumber: {
    fontSize: 18,
    fontWeight: '800',
    color: GOLD,
    fontFamily: FH,
    letterSpacing: 0.5,
  },
  moduleBody: { flex: 1, gap: 3 },
  moduleTitle: { fontSize: 15, fontWeight: '700', color: FG, fontFamily: FH },
  moduleDesc: { fontSize: 12, color: MUTED, fontFamily: FB, lineHeight: 16 },
  moduleMeta: { fontSize: 11, color: '#4A5568', fontFamily: FB, marginTop: 2 },
  moduleRight: { alignItems: 'flex-end' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 11, fontWeight: '700', fontFamily: FB, letterSpacing: 0.4 },

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
    letterSpacing: 1.8,
  },
  detailTitle: { fontSize: 26, fontWeight: '800', color: FG, fontFamily: FH },
  detailMeta: { fontSize: 12, color: MUTED, fontFamily: FB },
  detailBody: { gap: 16 },

  sectionIntro: {
    fontSize: 15,
    color: FG,
    fontFamily: FB,
    lineHeight: 22,
  },
  sectionBlock: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  sectionHeading: {
    fontSize: 15,
    fontWeight: '700',
    color: FG,
    fontFamily: FH,
  },
  sectionBody: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 19,
  },

  // Photo upload
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  photoPreview: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    borderColor: BORDER,
  },
  photoPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1A2233',
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoUploadOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(245,166,35,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.35)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  uploadBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: GOLD,
    fontFamily: FH,
  },
  successRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  successText: {
    fontSize: 12,
    color: GREEN,
    fontFamily: FB,
  },

  // Text input
  textInput: {
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: FG,
    fontFamily: FB,
  },
  textArea: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: 11,
    color: MUTED,
    fontFamily: FB,
    textAlign: 'right',
  },

  requirementNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    backgroundColor: 'rgba(91,155,213,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(91,155,213,0.25)',
    borderRadius: 10,
  },
  requirementNoteText: {
    flex: 1,
    fontSize: 12,
    color: FG,
    fontFamily: FB,
    lineHeight: 18,
  },

  // Status chip (Stripe)
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  statusChipConnected: {
    backgroundColor: 'rgba(110,187,122,0.10)',
    borderColor: 'rgba(110,187,122,0.35)',
  },
  statusChipPending: {
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderColor: 'rgba(245,166,35,0.30)',
  },
  statusChipText: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FH,
  },

  // Numbered step rows (Stripe, Email)
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  stepNumBox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.40)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepNum: {
    fontSize: 11,
    fontWeight: '800',
    color: GOLD,
    fontFamily: FH,
  },
  stepText: {
    flex: 1,
    fontSize: 13,
    color: FG,
    fontFamily: FB,
    lineHeight: 19,
  },

  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(91,155,213,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(91,155,213,0.30)',
    borderRadius: 12,
    paddingVertical: 12,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: BLUE,
    fontFamily: FH,
  },

  // Info card (Zoom)
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: 'rgba(110,187,122,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(110,187,122,0.30)',
    borderRadius: 12,
    padding: 14,
  },
  infoCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: GREEN,
    fontFamily: FH,
    marginBottom: 2,
  },
  infoCardBody: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 18,
  },

  // Bullet rows (Zoom)
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  bulletDot: {
    fontSize: 16,
    color: GOLD,
    fontFamily: FB,
    lineHeight: 20,
    flexShrink: 0,
  },
  bulletText: {
    flex: 1,
    fontSize: 13,
    color: FG,
    fontFamily: FB,
    lineHeight: 19,
  },

  // Tip card (Zoom)
  tipCard: {
    backgroundColor: 'rgba(245,166,35,0.06)',
    borderLeftWidth: 3,
    borderLeftColor: GOLD,
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  tipLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: GOLD,
    fontFamily: FB,
  },
  tipBody: {
    fontSize: 13,
    color: FG,
    fontFamily: FB,
    lineHeight: 19,
  },

  // URL card (Certification)
  urlCard: {
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  urlLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: MUTED,
    fontFamily: FB,
  },
  urlText: {
    fontSize: 14,
    color: FG,
    fontFamily: FH,
  },

  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoRowText: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
    flex: 1,
  },

  // Cert uploaded card
  certUploadedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(110,187,122,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(110,187,122,0.30)',
    borderRadius: 10,
    padding: 12,
  },
  certUploadedTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: GREEN,
    fontFamily: FH,
  },
  certUploadedSub: {
    fontSize: 11,
    color: MUTED,
    fontFamily: FB,
  },

  // GoArrive Certified Coach hero
  certHeroCard: {
    backgroundColor: 'rgba(245,166,35,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.28)',
    borderRadius: 14,
    padding: 16,
    gap: 14,
  },
  certBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  certBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  certBadgeText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#000',
    fontFamily: FH,
    letterSpacing: 1,
  },
  certBadgeLabels: {
    flex: 1,
    gap: 3,
  },
  certProgramLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: GOLD,
    fontFamily: FB,
  },
  certBadgeSub: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
  },
  certFeatureList: {
    gap: 9,
  },
  certFeatureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  certFeatureText: {
    fontSize: 13,
    color: FG,
    fontFamily: FB,
    flex: 1,
  },
  certEnrollBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GOLD,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 20,
    gap: 8,
  },
  certEnrollBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000',
    fontFamily: FH,
  },
  certEnrolledBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(110,187,122,0.10)',
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  certEnrolledText: {
    fontSize: 12,
    fontWeight: '600',
    color: GREEN,
    fontFamily: FB,
  },
  certNextStepCard: {
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    padding: 12,
    gap: 5,
  },
  certNextStepLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: GOLD,
    fontFamily: FB,
  },
  certNextStepTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: FG,
    fontFamily: FH,
  },
  certNextStepBody: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 18,
  },
  certStartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  certStartTime: {
    fontSize: 11,
    color: MUTED,
    fontFamily: FB,
  },

  // First member step cards
  memberStepCard: {
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  memberStepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  memberStepBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(245,166,35,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberStepBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    color: GOLD,
    fontFamily: FH,
  },
  memberStepTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: FG,
    fontFamily: FH,
  },
  memberStepBody: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 19,
  },

  // Quote card (First Member)
  quoteCard: {
    backgroundColor: 'rgba(245,166,35,0.06)',
    borderLeftWidth: 3,
    borderLeftColor: GOLD,
    borderRadius: 12,
    padding: 16,
  },
  quoteText: {
    fontSize: 14,
    color: FG,
    fontFamily: FB,
    lineHeight: 22,
    fontStyle: 'italic',
  },

  // Celebration
  celebrateCard: {
    backgroundColor: '#16130B',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.6)',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 16,
    marginTop: 24,
  },
  celebrateBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(245,166,35,0.14)',
    borderWidth: 2,
    borderColor: 'rgba(245,166,35,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  celebrateHeading: {
    fontSize: 26,
    fontWeight: '800',
    color: GOLD,
    fontFamily: FH,
    textAlign: 'center',
  },
  celebrateBody: {
    fontSize: 15,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 22,
    textAlign: 'center',
  },

  // Footer buttons
  footer: { gap: 10, marginTop: 8 },
  primaryBtn: {
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#0E1117',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: FH,
  },
  btnDisabled: { opacity: 0.5 },
  skipBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  skipBtnText: {
    fontSize: 14,
    color: MUTED,
    fontFamily: FB,
  },
  completedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(110,187,122,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(110,187,122,0.30)',
  },
  completedBannerText: {
    fontSize: 14,
    fontWeight: '700',
    color: GREEN,
    fontFamily: FH,
  },
});
