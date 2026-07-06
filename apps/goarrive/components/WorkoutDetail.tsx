/**
 * WorkoutDetail — Workout detail bottom sheet
 *
 * Shows workout info, blocks, metadata badges, and action buttons.
 * Supports: assign to member, edit, archive/restore, duplicate.
 *
 * Props are fully typed via WorkoutDetailData interface.
 * Legacy workouts missing fields are handled gracefully with defaults.
 *
 * Follows GoArrive design system: #0E1117 bg, #F5A623 gold accent,
 * Space Grotesk headings, DM Sans body.
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
  ActivityIndicator,
  Share,
} from 'react-native';
import ModalSheet from './ModalSheet';
import { db, functions } from '../lib/firebase';
import { doc, onSnapshot, updateDoc, addDoc, collection, Timestamp, query, where, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Icon } from './Icon';
import AssignWorkoutModal from './AssignWorkoutModal';
import BatchAssignModal from './BatchAssignModal';
import WorkoutPlayer from './WorkoutPlayer';
import WorkoutPreview from './WorkoutPreview';
import { useAuth } from '../lib/AuthContext';
import { FB, FH } from '../lib/theme';

// ── Share settings types ────────────────────────────────────────────────────
type ShareVisibility = 'restricted' | 'anyone_with_link' | 'anyone_with_link_signin_required';
const VALID_VISIBILITIES: ShareVisibility[] = ['restricted', 'anyone_with_link', 'anyone_with_link_signin_required'];
function normalizeVisibility(v: unknown): ShareVisibility {
  return VALID_VISIBILITIES.includes(v as ShareVisibility) ? (v as ShareVisibility) : 'anyone_with_link';
}

interface ShareSettingsState {
  visibility: ShareVisibility;
  expiresAt: number | null;
  resolvedCount: number;
  lastResolvedAt: number | null;
}

// ── Typed workout data interface (suggestion 9) ─────────────────────────────
export interface WorkoutDetailData {
  id: string;
  name: string;
  description?: string;
  category?: string;
  difficulty?: string;
  estimatedDurationMin?: number | null;
  tags?: string[];
  blocks?: any[];
  coachId?: string;
  tenantId?: string;
  isTemplate?: boolean;
  isShared?: boolean;
  isArchived?: boolean;
  createdAt?: any;
  updatedAt?: any;
}

interface WorkoutDetailProps {
  workout: WorkoutDetailData | null;
  onClose: () => void;
  onEdit?: (workout: WorkoutDetailData) => void;
  onArchive?: (workout: WorkoutDetailData) => void;
  onDuplicate?: (workout: WorkoutDetailData) => void;
}

export default function WorkoutDetail({
  workout,
  onClose,
  onEdit,
  onArchive,
  onDuplicate,
}: WorkoutDetailProps) {
  const { claims, effectiveUid } = useAuth();
  const coachId = effectiveUid || '';
  const tenantId = claims?.tenantId ?? '';

  const [currentWorkout, setCurrentWorkout] = useState<WorkoutDetailData>(workout as WorkoutDetailData);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [showPreStartPreview, setShowPreStartPreview] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [activeShareId, setActiveShareId] = useState<string | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareSettings, setShareSettings] = useState<ShareSettingsState>({
    visibility: 'anyone_with_link',
    expiresAt: null,
    resolvedCount: 0,
    lastResolvedAt: null,
  });
  const [shareSettingsSaving, setShareSettingsSaving] = useState(false);

  useEffect(() => {
    if (!workout?.id) return;
    const unsubscribe = onSnapshot(doc(db, 'workouts', workout.id), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setCurrentWorkout({
          id: snapshot.id,
          name: data.name ?? '',
          description: data.description ?? '',
          category: data.category ?? '',
          difficulty: data.difficulty ?? '',
          estimatedDurationMin: data.estimatedDurationMin ?? null,
          tags: data.tags ?? [],
          blocks: data.blocks ?? [],
          coachId: data.coachId ?? '',
          tenantId: data.tenantId ?? '',
          isTemplate: data.isTemplate ?? false,
          isShared: data.isShared ?? false,
          isArchived: data.isArchived ?? false,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        });
      }
    });
    return () => unsubscribe();
  }, [workout?.id]);

  useEffect(() => {
    if (!workout?.id || !coachId) return;
    const q = query(
      collection(db, 'shareTokens'),
      where('workoutId', '==', workout.id),
      where('createdBy', '==', coachId),
      where('revokedAt', '==', null),
    );
    getDocs(q).then((snap) => {
      if (snap.empty) {
        setActiveShareId(null);
        return;
      }
      const docSnap = snap.docs[0];
      const data = docSnap.data() as Record<string, any>;
      setActiveShareId(docSnap.id);
      setShareSettings({
        visibility: normalizeVisibility(data.visibility),
        expiresAt: data.expiresAt?.toMillis?.() ?? null,
        resolvedCount: data.resolvedCount ?? 0,
        lastResolvedAt: data.lastResolvedAt?.toMillis?.() ?? null,
      });
    }).catch(() => {});
  }, [workout?.id, coachId]);

  function buildShareUrl(shareId: string): string {
    const origin =
      Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://goarrive.fit';
    return `${origin}/share/${shareId}`;
  }

  async function copyShareLinkToClipboard(shareUrl: string) {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(shareUrl);
      if (typeof window !== 'undefined') {
        window.alert('Link copied to clipboard.');
      }
    } else {
      try {
        await Share.share({ message: shareUrl });
      } catch {
        Alert.alert('Share Link', shareUrl);
      }
    }
  }

  // Open the Share Settings modal. If no token exists yet, create one with
  // the default visibility ("anyone with the link") so coaches get a working
  // link in one click — matches the prior 1-click behavior.
  async function handleOpenShareSettings() {
    setShareLoading(true);
    try {
      type CreateResult = {
        shareId: string;
        alreadyExists: boolean;
        visibility?: ShareVisibility;
        expiresAt?: number | null;
        resolvedCount?: number;
        lastResolvedAt?: number | null;
      };
      const createFn = httpsCallable<{ workoutId: string }, CreateResult>(functions, 'createShareToken');
      const result = await createFn({ workoutId: currentWorkout.id });
      const data = result.data;
      setActiveShareId(data.shareId);
      setShareSettings({
        visibility: normalizeVisibility(data.visibility),
        expiresAt: data.expiresAt ?? null,
        resolvedCount: data.resolvedCount ?? 0,
        lastResolvedAt: data.lastResolvedAt ?? null,
      });
      setShareModalOpen(true);
    } catch (err: any) {
      console.error('[WorkoutDetail] Share link error:', err);
      Alert.alert('Error', err?.message || 'Failed to create share link.');
    } finally {
      setShareLoading(false);
    }
  }

  async function saveShareSettings(patch: Partial<Pick<ShareSettingsState, 'visibility' | 'expiresAt'>>) {
    const next = { ...shareSettings, ...patch };
    setShareSettings(next);
    setShareSettingsSaving(true);
    try {
      const updateFn = httpsCallable<
        { workoutId: string; visibility?: ShareVisibility; expiresAt?: number | null },
        { updated: number; shareId?: string }
      >(functions, 'updateShareToken');
      await updateFn({
        workoutId: currentWorkout.id,
        visibility: next.visibility,
        expiresAt: next.expiresAt,
      });
    } catch (err: any) {
      console.error('[WorkoutDetail] Update share settings error:', err);
      Alert.alert('Error', err?.message || 'Failed to update share settings.');
    } finally {
      setShareSettingsSaving(false);
    }
  }

  async function performRevoke() {
    setShareLoading(true);
    try {
      const revokeFn = httpsCallable<{ workoutId: string }, { revoked: number }>(functions, 'revokeShareToken');
      await revokeFn({ workoutId: currentWorkout.id });
      setActiveShareId(null);
      setShareModalOpen(false);
      setShareSettings({
        visibility: 'anyone_with_link',
        expiresAt: null,
        resolvedCount: 0,
        lastResolvedAt: null,
      });
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert('The share link has been revoked.');
      } else {
        Alert.alert('Link Revoked', 'The share link has been revoked.');
      }
    } catch (err: any) {
      console.error('[WorkoutDetail] Revoke error:', err);
      const msg = err?.message || 'Failed to revoke share link.';
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(`Error: ${msg}`);
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setShareLoading(false);
    }
  }

  function handleRevokeLink() {
    // react-native-web's Alert.alert only renders the message — its buttons
    // array is silently dropped. Use window.confirm on web so the destructive
    // action actually requires confirmation.
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const confirmed = window.confirm(
        'Revoke Share Link\n\nAnyone with the current link will no longer be able to access this workout. You can create a new link later.',
      );
      if (confirmed) performRevoke();
      return;
    }
    Alert.alert(
      'Revoke Share Link',
      'Anyone with the current link will no longer be able to access this workout. You can create a new link later.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Revoke', style: 'destructive', onPress: performRevoke },
      ],
    );
  }

  async function handleAssign(
    _workoutId: string,
    workoutName: string,
    scheduledFor: Date,
    memberId: string,
    assignmentNote?: string,
  ) {
    try {
      // Snapshot workout data at assignment time for versioning
      const workoutSnapshot = {
        name: currentWorkout.name ?? '',
        description: currentWorkout.description ?? '',
        category: currentWorkout.category ?? '',
        difficulty: currentWorkout.difficulty ?? '',
        estimatedDurationMin: currentWorkout.estimatedDurationMin ?? null,
        blocks: currentWorkout.blocks ?? [],
        tags: currentWorkout.tags ?? [],
      };
      const trimmedNote = (assignmentNote ?? '').trim().slice(0, 200);
      await addDoc(collection(db, 'workout_assignments'), {
        memberId,
        coachId,
        tenantId,
        workoutId: currentWorkout.id,
        workoutName,
        scheduledFor: Timestamp.fromDate(scheduledFor),
        status: 'scheduled',
        createdAt: Timestamp.now(),
        workoutSnapshot,
        ...(trimmedNote ? { assignmentNote: trimmedNote } : {}),
      });
    } catch (err) {
      console.error('Failed to assign workout:', err);
    }
  }

  const blockCount = currentWorkout.blocks?.length ?? 0;
  const isArchived = currentWorkout.isArchived ?? false;
  const isTemplate = currentWorkout.isTemplate ?? false;
  const isShared = currentWorkout.isShared ?? false;
  const isAdmin = claims?.role === 'platformAdmin' || claims?.admin === true;
  const category = currentWorkout.category ?? '';
  const difficulty = currentWorkout.difficulty ?? '';
  const duration = currentWorkout.estimatedDurationMin;
  const tags = currentWorkout.tags ?? [];

  // Check if this is a legacy workout missing key fields (suggestion 10)
  const isLegacy = !category && !difficulty && !duration;

  return (
    <ModalSheet visible={true} onClose={onClose} maxHeightPct={0.9} sheetBg="#111827" backdropColor="rgba(0,0,0,0.65)" borderRadius={24}>
          {/* Drag handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.iconWrap}>
              <Icon name="workouts" size={20} color="#7DD3FC" />
            </View>
            <View style={styles.headerInfo}>
              <Text style={styles.title} numberOfLines={1}>
                {currentWorkout.name}
              </Text>
              <View style={styles.headerBadgeRow}>
                <Text style={styles.subtitle}>
                  {blockCount} block{blockCount !== 1 ? 's' : ''}
                </Text>
                {isTemplate && (
                  <View style={styles.templateBadge}>
                    <Text style={styles.templateBadgeText}>TEMPLATE</Text>
                  </View>
                )}
                {isShared && (
                  <View style={[styles.templateBadge, { backgroundColor: 'rgba(110,187,122,0.15)', borderColor: 'rgba(110,187,122,0.3)' }]}>
                    <Text style={[styles.templateBadgeText, { color: '#6EBB7A' }]}>SHARED</Text>
                  </View>
                )}
                {isArchived && (
                  <View style={styles.archivedBadge}>
                    <Text style={styles.archivedBadgeText}>ARCHIVED</Text>
                  </View>
                )}
                {isLegacy && (
                  <View style={styles.legacyBadge}>
                    <Text style={styles.legacyBadgeText}>NEEDS UPDATE</Text>
                  </View>
                )}
              </View>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Icon name="close" size={22} color="#8A95A3" />
            </TouchableOpacity>
          </View>

          {/* Scrollable body */}
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Metadata badges row */}
            {(category || difficulty || duration) && (
              <View style={styles.section}>
                <View style={styles.metaBadgeRow}>
                  {category ? (
                    <View style={styles.metaBadge}>
                      <Text style={styles.metaBadgeText}>{category}</Text>
                    </View>
                  ) : null}
                  {difficulty ? (
                    <View style={styles.metaBadge}>
                      <Text style={styles.metaBadgeText}>{difficulty}</Text>
                    </View>
                  ) : null}
                  {duration ? (
                    <View style={styles.metaBadge}>
                      <Text style={styles.metaBadgeText}>{duration} min</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            )}

            {/* Tags */}
            {tags.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Tags</Text>
                <View style={styles.tagRow}>
                  {tags.map((tag, i) => (
                    <View key={i} style={styles.tagChip}>
                      <Text style={styles.tagChipText}>{tag}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Description */}
            {currentWorkout.description ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Description</Text>
                <Text style={styles.descText}>{currentWorkout.description}</Text>
              </View>
            ) : null}

            {/* Legacy notice (suggestion 10) */}
            {isLegacy && (
              <View style={styles.section}>
                <View style={styles.legacyNotice}>
                  <Icon name="info" size={16} color="#F5A623" />
                  <Text style={styles.legacyNoticeText}>
                    This workout was created before the latest update. Tap "Edit"
                    to add category, difficulty, and duration.
                  </Text>
                </View>
              </View>
            )}

            {/* Blocks */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>
                Workout Blocks ({blockCount})
              </Text>
              {blockCount > 0 ? (
                (currentWorkout.blocks ?? []).map((block: any, index: number) => (
                  <View key={index} style={styles.blockCard}>
                    <View style={styles.blockIndex}>
                      <Text style={styles.blockIndexText}>{index + 1}</Text>
                    </View>
                    <View style={styles.blockInfo}>
                      <Text style={styles.blockTitle}>
                        {block.type || 'Block'} {index + 1}
                      </Text>
                      <Text style={styles.blockSub}>
                        {block.movements?.length ?? 0} movement
                        {(block.movements?.length ?? 0) !== 1 ? 's' : ''}
                      </Text>
                    </View>
                  </View>
                ))
              ) : (
                <View style={styles.emptyBlocks}>
                  <Text style={styles.emptyBlocksText}>
                    No blocks added to this workout yet.
                  </Text>
                </View>
              )}
            </View>

            <View style={{ height: 20 }} />
          </ScrollView>

          {/* Footer — Action buttons */}
          <View style={styles.footer}>
            {/* Row 1: Preview + Edit + Archive + Duplicate */}
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => setShowPreStartPreview(true)}
              >
                <Icon name="eye" size={16} color="#FBBF24" />
                <Text style={[styles.actionBtnText, { color: '#FBBF24' }]}>Preview</Text>
              </TouchableOpacity>
              {onEdit && (
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => onEdit(currentWorkout)}
                >
                  <Icon name="edit" size={16} color="#F5A623" />
                  <Text style={styles.actionBtnText}>Edit</Text>
                </TouchableOpacity>
              )}
              {onDuplicate && (
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => onDuplicate(currentWorkout)}
                >
                  <Icon name="document" size={16} color="#7DD3FC" />
                  <Text style={[styles.actionBtnText, { color: '#7DD3FC' }]}>
                    Duplicate
                  </Text>
                </TouchableOpacity>
              )}
              {onArchive && (
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => onArchive(currentWorkout)}
                >
                  <Icon
                    name="archive"
                    size={16}
                    color={isArchived ? '#6EBB7A' : '#8A95A3'}
                  />
                  <Text
                    style={[
                      styles.actionBtnText,
                      { color: isArchived ? '#6EBB7A' : '#8A95A3' },
                    ]}
                  >
                    {isArchived ? 'Restore' : 'Archive'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Share Workout Link — opens Share Settings modal */}
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={handleOpenShareSettings}
                disabled={shareLoading}
              >
                {shareLoading ? (
                  <ActivityIndicator size={16} color="#6EBB7A" />
                ) : (
                  <Icon name="link" size={16} color="#6EBB7A" />
                )}
                <Text style={[styles.actionBtnText, { color: '#6EBB7A' }]}>
                  {activeShareId ? 'Share Settings' : 'Share Workout Link'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Admin: Share to Marketplace toggle */}
            {isAdmin && (
              <TouchableOpacity
                style={[styles.actionBtn, { marginBottom: 8, alignSelf: 'flex-start' }]}
                onPress={() => {
                  const action = isShared ? 'remove from' : 'share to';
                  Alert.alert(
                    isShared ? 'Remove from Marketplace' : 'Share to Marketplace',
                    `Are you sure you want to ${action} the template marketplace?`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: isShared ? 'Remove' : 'Share',
                        style: isShared ? 'destructive' : 'default',
                        onPress: async () => {
                          try {
                            await updateDoc(doc(db, 'workouts', currentWorkout.id), {
                              isShared: !isShared,
                            });
                          } catch (err) {
                            console.error('[WorkoutDetail] Toggle isShared error:', err);
                            Alert.alert('Error', 'Failed to update sharing status.');
                          }
                        },
                      },
                    ],
                  );
                }}
              >
                <Icon
                  name={isShared ? 'close' : 'share'}
                  size={16}
                  color={isShared ? '#EF4444' : '#6EBB7A'}
                />
                <Text
                  style={[
                    styles.actionBtnText,
                    { color: isShared ? '#EF4444' : '#6EBB7A' },
                  ]}
                >
                  {isShared ? 'Remove from Marketplace' : 'Share to Marketplace'}
                </Text>
              </TouchableOpacity>
            )}

            {/* Row 2: Assign buttons */}
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.assignBtn, { flex: 1 }]}
                onPress={() => setShowAssignModal(true)}
              >
                <Icon name="person" size={18} color="#0E1117" />
                <Text style={styles.assignBtnText}>Assign</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.assignBtn, { flex: 1, backgroundColor: '#7DD3FC' }]}
                onPress={() => setShowBatchModal(true)}
              >
                <Icon name="people" size={18} color="#0E1117" />
                <Text style={styles.assignBtnText}>Assign to Multiple</Text>
              </TouchableOpacity>
            </View>
          </View>

      {/* Assign Workout Modal */}
      <AssignWorkoutModal
        visible={showAssignModal}
        memberName=""
        coachId={coachId}
        preselectedWorkoutId={currentWorkout.id}
        preselectedWorkoutName={currentWorkout.name}
        onClose={() => setShowAssignModal(false)}
        onAssign={async (workoutId, workoutName, scheduledFor, memberId) => {
          await handleAssign(workoutId, workoutName, scheduledFor, memberId);
        }}
      />

      {/* Coach Pre-Start Preview — same screen the member sees */}
      <WorkoutPreview
        visible={showPreStartPreview}
        workout={currentWorkout}
        isPreview
        onStart={() => {
          setShowPreStartPreview(false);
          setShowPlayer(true);
        }}
        onClose={() => setShowPreStartPreview(false)}
      />

      {/* Workout Player Preview */}
      <WorkoutPlayer
        visible={showPlayer}
        workout={currentWorkout}
        onClose={() => setShowPlayer(false)}
        onComplete={() => setShowPlayer(false)}
        isPreview
      />

      {/* Batch Assign Modal */}
      <BatchAssignModal
        visible={showBatchModal}
        coachId={coachId}
        workoutId={currentWorkout.id}
        workoutName={currentWorkout.name}
        workoutSnapshot={currentWorkout.blocks ? { blocks: currentWorkout.blocks, name: currentWorkout.name } : undefined}
        onClose={() => setShowBatchModal(false)}
        onDone={() => setShowBatchModal(false)}
      />

      {/* Share Settings Modal */}
      <Modal
        visible={shareModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setShareModalOpen(false)}
      >
        <View style={styles.shareModalOverlay}>
          <View style={styles.shareModalCard}>
            <View style={styles.shareModalHeader}>
              <Text style={styles.shareModalTitle}>Share Settings</Text>
              <TouchableOpacity onPress={() => setShareModalOpen(false)}>
                <Icon name="close" size={20} color="#8A95A3" />
              </TouchableOpacity>
            </View>

            <Text style={styles.shareModalSectionLabel}>Who can view this workout</Text>
            <View style={styles.shareModalOptions}>
              {VISIBILITY_OPTIONS.map((opt) => {
                const active = shareSettings.visibility === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.shareModalOption, active && styles.shareModalOptionActive]}
                    onPress={() => saveShareSettings({ visibility: opt.value })}
                    disabled={shareSettingsSaving}
                  >
                    <View style={[styles.shareModalRadio, active && styles.shareModalRadioActive]}>
                      {active ? <View style={styles.shareModalRadioDot} /> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.shareModalOptionTitle}>{opt.label}</Text>
                      <Text style={styles.shareModalOptionDesc}>{opt.description}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.shareModalSectionLabel}>Link expires</Text>
            <View style={styles.shareModalChipRow}>
              {EXPIRY_PRESETS.map((preset) => {
                const active = sameExpiry(shareSettings.expiresAt, preset.ms);
                return (
                  <TouchableOpacity
                    key={preset.label}
                    style={[styles.shareModalChip, active && styles.shareModalChipActive]}
                    onPress={() =>
                      saveShareSettings({
                        expiresAt: preset.ms === null ? null : Date.now() + preset.ms,
                      })
                    }
                    disabled={shareSettingsSaving}
                  >
                    <Text style={[styles.shareModalChipText, active && styles.shareModalChipTextActive]}>
                      {preset.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {shareSettings.expiresAt ? (
              <Text style={styles.shareModalHint}>
                Expires {new Date(shareSettings.expiresAt).toLocaleString()}
              </Text>
            ) : null}

            <View style={styles.shareModalStatsRow}>
              <Icon name="eye" size={14} color="#8A95A3" />
              <Text style={styles.shareModalStatsText}>
                {shareSettings.resolvedCount === 0
                  ? 'Not opened yet'
                  : `Opened ${shareSettings.resolvedCount} time${shareSettings.resolvedCount === 1 ? '' : 's'}${
                      shareSettings.lastResolvedAt ? ` · Last ${formatRelativeTime(shareSettings.lastResolvedAt)}` : ''
                    }`}
              </Text>
            </View>

            <View style={styles.shareModalButtonRow}>
              <TouchableOpacity
                style={styles.shareModalPrimaryBtn}
                onPress={() => activeShareId && copyShareLinkToClipboard(buildShareUrl(activeShareId))}
                disabled={!activeShareId || shareSettingsSaving}
              >
                <Icon name="link" size={16} color="#0E1117" />
                <Text style={styles.shareModalPrimaryBtnText}>Copy Link</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.shareModalDangerBtn}
                onPress={handleRevokeLink}
                disabled={!activeShareId || shareLoading}
              >
                <Icon name="x-circle" size={16} color="#EF4444" />
                <Text style={styles.shareModalDangerBtnText}>Revoke Link</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ModalSheet>
  );
}

// ── Share Settings constants & helpers ──────────────────────────────────────
const VISIBILITY_OPTIONS: Array<{ value: ShareVisibility; label: string; description: string }> = [
  {
    value: 'anyone_with_link',
    label: 'Anyone with the link',
    description: 'No sign-in needed. Best for previewing or sharing with prospects.',
  },
  {
    value: 'anyone_with_link_signin_required',
    label: 'Anyone with the link, sign-in required',
    description: 'Viewer must create an account or sign in to play.',
  },
  {
    value: 'restricted',
    label: 'Restricted',
    description: 'The share link is disabled. Only your assigned members can play.',
  },
];

const EXPIRY_PRESETS: Array<{ label: string; ms: number | null }> = [
  { label: 'Never', ms: null },
  { label: '1 day', ms: 24 * 60 * 60 * 1000 },
  { label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
];

function sameExpiry(currentExpiresAt: number | null, presetMs: number | null): boolean {
  if (presetMs === null) return currentExpiresAt === null;
  if (currentExpiresAt === null) return false;
  // Within 24h of preset → treat as the same preset (covers existing tokens that were set with this preset).
  return Math.abs(currentExpiresAt - (Date.now() + presetMs)) < 24 * 60 * 60 * 1000;
}

function formatRelativeTime(ms: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(ms).toLocaleDateString();
}

const styles = StyleSheet.create({
  // overlay styles removed — now handled by ModalSheet component
  // sheet styles removed — now handled by ModalSheet component
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
    paddingVertical: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(125,211,252,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerInfo: {
    flex: 1,
    gap: 4,
  },
  headerBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  subtitle: {
    fontSize: 12,
    color: '#4A5568',
    fontFamily: FB,
  },
  templateBadge: {
    backgroundColor: 'rgba(167,139,250,0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.3)',
  },
  templateBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#A78BFA',
    fontFamily: FH,
    letterSpacing: 0.8,
  },
  archivedBadge: {
    backgroundColor: 'rgba(138,149,163,0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(138,149,163,0.3)',
  },
  archivedBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#8A95A3',
    fontFamily: FH,
    letterSpacing: 0.8,
  },
  legacyBadge: {
    backgroundColor: 'rgba(245,166,35,0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
  },
  legacyBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
    letterSpacing: 0.8,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingTop: 4,
  },
  section: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
    gap: 10,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4A5568',
    fontFamily: FB,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metaBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaBadge: {
    backgroundColor: '#1A2035',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  metaBadgeText: {
    fontSize: 12,
    color: '#C0C8D4',
    fontFamily: FB,
    fontWeight: '500',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tagChip: {
    backgroundColor: 'rgba(125,211,252,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.2)',
  },
  tagChipText: {
    fontSize: 11,
    color: '#7DD3FC',
    fontFamily: FB,
  },
  descText: {
    fontSize: 14,
    color: '#C0C8D4',
    fontFamily: FB,
    lineHeight: 20,
  },
  legacyNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(245,166,35,0.06)',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.15)',
  },
  legacyNoticeText: {
    flex: 1,
    fontSize: 13,
    color: '#F5A623',
    fontFamily: FB,
    lineHeight: 18,
  },
  blockCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1117',
    borderRadius: 10,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: '#1E2A3A',
  },
  blockIndex: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(125,211,252,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockIndexText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#7DD3FC',
    fontFamily: FH,
  },
  blockInfo: {
    flex: 1,
    gap: 2,
  },
  blockTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  blockSub: {
    fontSize: 12,
    color: '#4A5568',
    fontFamily: FB,
  },
  emptyBlocks: {
    paddingVertical: 20,
    alignItems: 'center',
    backgroundColor: '#0E1117',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E2A3A',
  },
  emptyBlocksText: {
    fontSize: 13,
    color: '#4A5568',
    fontFamily: FB,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#1E2A3A',
    gap: 10,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FB,
  },
  assignBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5A623',
    borderRadius: 12,
    paddingVertical: 14,
    gap: 8,
  },
  assignBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FH,
  },
  shareModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  shareModalCard: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: '#0E1117',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A3347',
    padding: 20,
    gap: 14,
  },
  shareModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  shareModalTitle: {
    color: '#E6EDF3',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: FH,
  },
  shareModalSectionLabel: {
    color: '#8A95A3',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: FB,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  shareModalOptions: {
    gap: 8,
  },
  shareModalOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A3347',
    backgroundColor: '#161B22',
  },
  shareModalOptionActive: {
    borderColor: '#F5A623',
    backgroundColor: 'rgba(245,166,35,0.06)',
  },
  shareModalRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#2A3347',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  shareModalRadioActive: {
    borderColor: '#F5A623',
  },
  shareModalRadioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F5A623',
  },
  shareModalOptionTitle: {
    color: '#E6EDF3',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FB,
  },
  shareModalOptionDesc: {
    color: '#8A95A3',
    fontSize: 12,
    fontFamily: FB,
    marginTop: 2,
    lineHeight: 16,
  },
  shareModalChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  shareModalChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2A3347',
    backgroundColor: '#161B22',
  },
  shareModalChipActive: {
    borderColor: '#F5A623',
    backgroundColor: 'rgba(245,166,35,0.1)',
  },
  shareModalChipText: {
    color: '#8A95A3',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: FB,
  },
  shareModalChipTextActive: {
    color: '#F5A623',
  },
  shareModalHint: {
    color: '#8A95A3',
    fontSize: 12,
    fontFamily: FB,
  },
  shareModalStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#2A3347',
  },
  shareModalStatsText: {
    color: '#8A95A3',
    fontSize: 12,
    fontFamily: FB,
  },
  shareModalButtonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  shareModalPrimaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F5A623',
    borderRadius: 10,
    paddingVertical: 12,
  },
  shareModalPrimaryBtnText: {
    color: '#0E1117',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FH,
  },
  shareModalDangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EF4444',
    backgroundColor: 'transparent',
  },
  shareModalDangerBtnText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FB,
  },
});
