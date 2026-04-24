/**
 * MemberDetail — Member Hub bottom sheet
 *
 * Tapping a member opens this full-featured hub. The top section shows the
 * member's name, contact info, and quick-action buttons. Below that is a grid
 * of action tiles — some live now, others marked "Coming Soon" for future
 * features described in the GoArrive blueprint.
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { db } from '../lib/firebase';
import { doc, onSnapshot, collection, query, where, addDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Icon } from './Icon';
import { router } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { formatTime } from '../lib/schedulingTypes';
import AssignWorkoutModal from './AssignWorkoutModal';
import CoachReviewQueue from './CoachReviewQueue';
import WorkoutAnalytics from './WorkoutAnalytics';
import WorkoutLogReview from './WorkoutLogReview';
import MemberWorkoutHistory from './MemberWorkoutHistory';
import ScheduleModal from './ScheduleModal';
import { BG, CARD, CARD2, BORDER, MUTED, GOLD, GREEN, BLUE, RED, FG, FH, FB } from '../lib/theme';

interface MemberDetailProps {
  member: any;
  onClose: () => void;
  onEdit: (member: any) => void;
  onArchive: (member: any) => void;
}

interface HubTile {
  icon: string;
  label: string;
  sublabel?: string;
  color: string;
  bgColor: string;
  live: boolean;
  onPress?: () => void;
}

export default function MemberDetail({
  member,
  onClose,
  onEdit,
  onArchive,
}: MemberDetailProps) {
  const { user: authUser, claims } = useAuth();
  const coachId = claims?.coachId ?? authUser?.uid ?? '';
  const [currentMember, setCurrentMember] = useState(member);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [existingSlots, setExistingSlots] = useState<any[]>([]);

  // Workouts tile — assign workout modal
  const [showAssignWorkout, setShowAssignWorkout] = useState(false);
  const [showReviewQueue, setShowReviewQueue] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showLogReview, setShowLogReview] = useState(false);
  const [showWorkoutHistory, setShowWorkoutHistory] = useState(false);
  // Item 7: Session notes per instance
  const [instanceNotes, setInstanceNotes] = useState<Record<string, string>>({});
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');

  // Invite / password reset modal state
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ link: string; email: string; authCreated: boolean } | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);

  // ── Load member data ──────────────────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'members', member.id), (snapshot) => {
      if (snapshot.exists()) {
        setCurrentMember({ id: snapshot.id, ...snapshot.data() });
      }
    });
    return () => unsubscribe();
  }, [member.id]);

  // Load existing slots for this member
  useEffect(() => {
    if (!member.id) return;
    const q = query(
      collection(db, 'recurring_slots'),
      where('memberId', '==', member.id),
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      setExistingSlots(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsubscribe();
  }, [member.id]);

  const initials = currentMember.name
    ? currentMember.name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w: string) => w[0]?.toUpperCase() ?? '')
        .join('')
    : '?';

  function navigateToPlan() {
    onClose();
    router.push(`/(app)/member-plan/${currentMember.id}` as any);
  }

  async function handleSendInvite() {
    if (inviteLoading) return;
    setInviteError(null);
    setInviteCopied(false);

    if (!currentMember?.email || !String(currentMember.email).trim()) {
      const msg = 'This member has no email on file. Add one before sending an invite.';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('No email on file', msg);
      return;
    }

    setInviteLoading(true);
    try {
      const functions = getFunctions();
      const callable = httpsCallable(functions, 'sendMemberInvite');
      const resp = await callable({ memberId: currentMember.id });
      const data = (resp.data ?? {}) as { resetLink?: string; email?: string; authCreated?: boolean };
      if (!data.resetLink) {
        throw new Error('No link returned from server');
      }
      setInviteResult({
        link: data.resetLink,
        email: data.email ?? currentMember.email,
        authCreated: !!data.authCreated,
      });
    } catch (err: any) {
      console.error('[sendMemberInvite] failed', err);
      setInviteError(err?.message || 'Failed to create invite link. Please try again.');
    } finally {
      setInviteLoading(false);
    }
  }

  async function copyInviteLink() {
    if (!inviteResult?.link) return;
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(inviteResult.link);
      }
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    } catch (err) {
      console.warn('[copyInviteLink] clipboard unavailable', err);
    }
  }

  const activeSlots = existingSlots.filter(s => s.status === 'active' || s.status === 'paused');
  const scheduleSubLabel = activeSlots.length > 0
    ? `${activeSlots.length} active slot${activeSlots.length !== 1 ? 's' : ''}`
    : 'Assign recurring time';

  const tiles: HubTile[] = [
    {
      icon: 'document',
      label: 'Plan & Intake',
      sublabel: 'View & edit fitness plan',
      color: GOLD,
      bgColor: 'rgba(245,166,35,0.1)',
      live: true,
      onPress: navigateToPlan,
    },
    {
      icon: 'fitness',
      label: 'Workouts',
      sublabel: 'Assign workout',
      color: GREEN,
      bgColor: 'rgba(110,187,122,0.1)',
      live: true,
      onPress: () => setShowAssignWorkout(true),
    },
    {
      icon: 'activity',
      label: 'Workout Stats',
      sublabel: 'Completion & trends',
      color: BLUE,
      bgColor: 'rgba(125,211,252,0.1)',
      live: true,
      onPress: () => setShowAnalytics(true),
    },
    {
      icon: 'calendar',
      label: 'Schedule',
      sublabel: scheduleSubLabel,
      color: '#A78BFA',
      bgColor: 'rgba(167,139,250,0.1)',
      live: true,
      onPress: () => setShowScheduleModal(true),
    },
    {
      icon: 'mail',
      label: 'Messages',
      sublabel: 'Direct communication',
      color: BLUE,
      bgColor: 'rgba(125,211,252,0.1)',
      live: false,
    },
    {
      icon: 'play-circle',
      label: 'Check-in Call',
      sublabel: 'Start Zoom session',
      color: GREEN,
      bgColor: 'rgba(110,187,122,0.1)',
      live: false,
    },
    {
      icon: 'trending-up',
      label: 'Measurements',
      sublabel: 'Progress & photos',
      color: GOLD,
      bgColor: 'rgba(245,166,35,0.1)',
      live: false,
    },
    {
      icon: 'edit',
      label: 'Coach Notes',
      sublabel: 'Check-in call notes',
      color: '#F472B6',
      bgColor: 'rgba(244,114,182,0.1)',
      live: false,
    },
    {
      icon: 'person',
      label: 'Referrals',
      sublabel: 'Members they referred',
      color: GOLD,
      bgColor: 'rgba(245,166,35,0.1)',
      live: false,
    },
    {
      icon: 'share',
      label: 'Coach Videos',
      sublabel: 'Social content for member',
      color: '#F472B6',
      bgColor: 'rgba(244,114,182,0.1)',
      live: false,
    },
    {
      icon: 'document',
      label: 'Journal',
      sublabel: 'Entries & comments',
      color: GREEN,
      bgColor: 'rgba(110,187,122,0.1)',
      live: true,
      onPress: () => setShowReviewQueue(true),
    },
    {
      icon: 'checkmark-circle',
      label: 'Review Logs',
      sublabel: 'Review & react to logs',
      color: '#A78BFA',
      bgColor: 'rgba(167,139,250,0.1)',
      live: true,
      onPress: () => setShowLogReview(true),
    },
    {
      icon: 'time',
      label: 'Workout History',
      sublabel: 'Past workouts & trends',
      color: BLUE,
      bgColor: 'rgba(125,211,252,0.1)',
      live: true,
      onPress: () => setShowWorkoutHistory(true),
    },
    {
      icon: 'lock',
      label: currentMember.hasAccount ? 'Password Reset' : 'Send Invite',
      sublabel: currentMember.hasAccount ? 'Send reset link' : 'Create login link',
      color: GOLD,
      bgColor: 'rgba(245,166,35,0.1)',
      live: true,
      onPress: handleSendInvite,
    },
  ];


  return (
    <>
    <Modal visible={true} animationType="slide" transparent={true}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          {/* Drag handle */}
          <View style={s.handle} />

          {/* Header */}
          <View style={s.header}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{initials}</Text>
            </View>
            <View style={s.headerInfo}>
              <Text style={s.name} numberOfLines={1}>
                {currentMember.name}
              </Text>
              <View style={s.headerMeta}>
                {currentMember.isArchived && (
                  <View style={s.archivedBadge}>
                    <Text style={s.archivedBadgeText}>Archived</Text>
                  </View>
                )}
                {currentMember.email ? (
                  <Text style={s.metaText} numberOfLines={1}>{currentMember.email}</Text>
                ) : currentMember.phone ? (
                  <Text style={s.metaText} numberOfLines={1}>{currentMember.phone}</Text>
                ) : null}
              </View>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Icon name="x" size={22} color={MUTED} />
            </TouchableOpacity>
          </View>

          {/* Quick actions row */}
          <View style={s.quickActions}>
            <TouchableOpacity
              style={s.qaBtn}
              onPress={() => onEdit(currentMember)}
            >
              <Icon name="edit" size={16} color={GOLD} />
              <Text style={s.qaBtnText}>Edit Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.qaBtn, currentMember.isArchived && s.qaBtnRestore]}
              onPress={() => onArchive(currentMember)}
            >
              <Icon
                name={currentMember.isArchived ? 'refresh' : 'archive'}
                size={16}
                color={currentMember.isArchived ? GREEN : RED}
              />
              <Text style={[s.qaBtnText, { color: currentMember.isArchived ? GREEN : RED }]}>
                {currentMember.isArchived ? 'Restore' : 'Archive'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Hub grid */}
          <ScrollView
            style={s.body}
            contentContainerStyle={s.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={s.sectionLabel}>MEMBER HUB</Text>
            <View style={s.grid}>
              {tiles.map((tile) => (
                <TouchableOpacity
                  key={tile.label}
                  style={[s.tile, { backgroundColor: tile.bgColor, borderColor: tile.live ? tile.color + '40' : BORDER }]}
                  onPress={tile.live && tile.onPress ? tile.onPress : undefined}
                  activeOpacity={tile.live ? 0.7 : 1}
                >
                  <View style={[s.tileIcon, { backgroundColor: tile.bgColor }]}>
                    <Icon name={tile.icon as any} size={20} color={tile.live ? tile.color : MUTED} />
                  </View>
                  <Text style={[s.tileLabel, { color: tile.live ? '#F0F4F8' : MUTED }]} numberOfLines={1}>
                    {tile.label}
                  </Text>
                  {tile.sublabel ? (
                    <Text style={s.tileSublabel} numberOfLines={1}>{tile.sublabel}</Text>
                  ) : null}
                  {!tile.live && (
                    <View style={s.comingSoonBadge}>
                      <Text style={s.comingSoonText}>Soon</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ height: 20 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>

      <ScheduleModal
        visible={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
        memberId={member.id}
        memberName={currentMember.name || ''}
        coachId={coachId}
        existingSlots={existingSlots}
        onNavigateToPlan={() => {
          setShowScheduleModal(false);
          onClose();
          router.push(`/(app)/member-plan/${currentMember.id}` as any);
        }}
      />

      <AssignWorkoutModal
        visible={showAssignWorkout}
        memberName={currentMember.firstName ? `${currentMember.firstName} ${currentMember.lastName ?? ''}`.trim() : currentMember.email ?? ''}
        coachId={coachId}
        preselectedWorkoutId=""
        preselectedWorkoutName=""
        onClose={() => setShowAssignWorkout(false)}
        onAssign={async (workoutId, workoutName, scheduledFor, memberId) => {
          try {
            const { Timestamp, getDoc } = await import('firebase/firestore');
            // Suggestion 7: Snapshot workout data at assignment time for versioning
            let workoutSnapshot: Record<string, any> | null = null;
            try {
              const workoutRef = doc(db, 'workouts', workoutId);
              const workoutDoc = await getDoc(workoutRef);
              if (workoutDoc.exists()) {
                const wd = workoutDoc.data();
                workoutSnapshot = {
                  name: wd.name ?? '',
                  description: wd.description ?? '',
                  category: wd.category ?? '',
                  difficulty: wd.difficulty ?? '',
                  estimatedDurationMin: wd.estimatedDurationMin ?? null,
                  blocks: wd.blocks ?? [],
                  tags: wd.tags ?? [],
                };
              }
            } catch (snapErr) {
              console.warn('Could not snapshot workout for versioning:', snapErr);
            }
            await addDoc(collection(db, 'workout_assignments'), {
              memberId: memberId || currentMember.id,
              coachId,
              tenantId: claims?.tenantId ?? '',
              workoutId,
              workoutName,
              scheduledFor: Timestamp.fromDate(scheduledFor),
              status: 'scheduled',
              createdAt: Timestamp.now(),
              ...(workoutSnapshot ? { workoutSnapshot } : {}),
            });
          } catch (err) {
            console.error('Failed to assign workout:', err);
          }
          setShowAssignWorkout(false);
        }}
      />
      <CoachReviewQueue
        visible={showReviewQueue}
        coachId={claims?.coachId || authUser?.uid || ''}
        onClose={() => setShowReviewQueue(false)}
      />
      <WorkoutAnalytics
        visible={showAnalytics}
        memberId={member.id}
        memberName={member.name || member.displayName || 'Member'}
        coachId={claims?.coachId || authUser?.uid || ''}
        onClose={() => setShowAnalytics(false)}
      />
      <WorkoutLogReview
        visible={showLogReview}
        coachId={claims?.coachId || authUser?.uid || ''}
        onClose={() => setShowLogReview(false)}
      />
      <MemberWorkoutHistory
        visible={showWorkoutHistory}
        memberId={member.id}
        memberName={member.name || member.displayName || 'Member'}
        onClose={() => setShowWorkoutHistory(false)}
      />

      {/* Invite / reset-link modal */}
      <Modal
        visible={inviteLoading || !!inviteResult || !!inviteError}
        animationType="fade"
        transparent
        onRequestClose={() => { setInviteResult(null); setInviteError(null); }}
      >
        <View style={inviteStyles.overlay}>
          <View style={inviteStyles.sheet}>
            {inviteLoading ? (
              <View style={{ alignItems: 'center', paddingVertical: 16 }}>
                <ActivityIndicator size="large" color={GOLD} />
                <Text style={inviteStyles.loadingText}>Creating invite link…</Text>
              </View>
            ) : inviteError ? (
              <>
                <Text style={inviteStyles.title}>Couldn&apos;t create invite</Text>
                <Text style={inviteStyles.body}>{inviteError}</Text>
                <TouchableOpacity
                  style={[inviteStyles.cta, inviteStyles.ctaSecondary]}
                  onPress={() => setInviteError(null)}
                >
                  <Text style={inviteStyles.ctaTextSecondary}>Close</Text>
                </TouchableOpacity>
              </>
            ) : inviteResult ? (
              <>
                <Text style={inviteStyles.title}>
                  {inviteResult.authCreated ? 'Invite link ready' : 'Password reset link ready'}
                </Text>
                <Text style={inviteStyles.body}>
                  {inviteResult.authCreated
                    ? `We created an account for ${inviteResult.email}. Send them this link so they can set a password and log in.`
                    : `Send ${inviteResult.email} this link so they can reset their password and log in.`}
                </Text>
                <View style={inviteStyles.linkBox}>
                  <Text style={inviteStyles.linkText} numberOfLines={3}>
                    {inviteResult.link}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[inviteStyles.cta, inviteCopied && inviteStyles.ctaCopied]}
                  onPress={copyInviteLink}
                >
                  <Text style={inviteStyles.ctaText}>
                    {inviteCopied ? 'Copied!' : 'Copy link'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[inviteStyles.cta, inviteStyles.ctaSecondary]}
                  onPress={() => { setInviteResult(null); setInviteCopied(false); }}
                >
                  <Text style={inviteStyles.ctaTextSecondary}>Done</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

const inviteStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 22,
    gap: 12,
  },
  loadingText: {
    marginTop: 12,
    color: MUTED,
    fontFamily: FB,
    fontSize: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: FG,
    fontFamily: FH,
  },
  body: {
    fontSize: 14,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 20,
  },
  linkBox: {
    backgroundColor: CARD2,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  linkText: {
    fontSize: 12,
    color: FG,
    fontFamily: FB,
  },
  cta: {
    backgroundColor: GOLD,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  ctaCopied: {
    backgroundColor: GREEN,
  },
  ctaText: {
    fontSize: 14,
    fontWeight: '700',
    color: BG,
    fontFamily: FH,
  },
  ctaSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: BORDER,
  },
  ctaTextSecondary: {
    fontSize: 14,
    fontWeight: '600',
    color: FG,
    fontFamily: FH,
  },
});

// ── Main Styles ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: CARD,
    borderTopLeftRadius: 24,
    overflow: "hidden" as const,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    borderWidth: 1,
    borderColor: BORDER,
    borderBottomWidth: 0,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#2A3347',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderWidth: 1.5,
    borderColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 17,
    fontWeight: '700',
    color: GOLD,
    fontFamily: FH,
  },
  headerInfo: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  headerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  metaText: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
  },
  archivedBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(74,85,104,0.3)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  archivedBadgeText: {
    fontSize: 11,
    color: MUTED,
    fontFamily: FB,
    fontWeight: '600',
  },
  quickActions: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  qaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.25)',
  },
  qaBtnRestore: {
    backgroundColor: 'rgba(110,187,122,0.08)',
    borderColor: 'rgba(110,187,122,0.25)',
  },
  qaBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: GOLD,
    fontFamily: FB,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: MUTED,
    letterSpacing: 1.5,
    fontFamily: FH,
    marginBottom: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tile: {
    width: '47%',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    gap: 6,
    position: 'relative',
  },
  tileIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  tileLabel: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FH,
  },
  tileSublabel: {
    fontSize: 11,
    color: MUTED,
    fontFamily: FB,
  },
  comingSoonBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(42,51,71,0.9)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: BORDER,
  },
  comingSoonText: {
    fontSize: 9,
    fontWeight: '700',
    color: MUTED,
    fontFamily: FB,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

});
