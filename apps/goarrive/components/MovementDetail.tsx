/**
 * MovementDetail — View movement details in a modal
 *
 * Redesigned layout:
 *   - Shrunk video (16:9 instead of 4:5)
 *   - No loop toggle (always loops)
 *   - No "Make Global" button (admin-only, removed from detail)
 *   - Tappable metadata badges → opens edit modal
 *   - Swap-sides toggle + mode selector with inline save
 *   - Fine-tuned playback speed (0.1x increments)
 *
 * Slice 1, Week 2 — Movement Library
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  Modal,
  Image,
  Switch,
  Alert,
} from 'react-native';
import { doc, updateDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Icon } from './Icon';
import MovementVideoControls from './MovementVideoControls';

// ── Types ──────────────────────────────────────────────────────────────────

export interface MovementDetailData {
  id: string;
  name: string;
  category: string;
  muscleGroups: string[];
  equipment: string;
  difficulty: string;
  description: string;
  workSec: number;
  restSec: number;
  countdownSec: number;
  swapSides: boolean;
  swapMode: 'split' | 'duplicate';
  swapWindowSec: number;
  isGlobal: boolean;
  isArchived: boolean;
  coachId?: string;
  tenantId?: string;
  createdAt?: any;
  updatedAt?: any;
  mediaUrl?: string | null;
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  mediaFormat?: 'webp' | null;
  clipDurationSec?: number | null;
  fps?: number | null;
  canvaDesignId?: string | null;
  mirrorSide2?: boolean;
  createdBy?: string | null;
  regression?: string;
  progression?: string;
  contraindications?: string;
  [key: string]: any;
}

interface Props {
  visible: boolean;
  movement: MovementDetailData | null;
  onClose: () => void;
  onEdit: (m: MovementDetailData) => void;
  onArchive: (m: MovementDetailData) => void;
  /** Platform admin only: toggle isGlobal flag */
  onToggleGlobal?: (m: MovementDetailData) => void;
  /** Whether the current user is a platform admin */
  isAdmin?: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────

const FH =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const SWAP_MODES: { value: 'split' | 'duplicate'; label: string; desc: string }[] = [
  { value: 'split', label: 'Split', desc: 'Half time per side' },
  { value: 'duplicate', label: 'Duplicate', desc: 'Full time each side' },
];

// ── Component ──────────────────────────────────────────────────────────────

export default function MovementDetail({
  visible,
  movement,
  onClose,
  onEdit,
  onArchive,
  onToggleGlobal,
  isAdmin = false,
}: Props) {
  // Coach name lookup
  const [coachName, setCoachName] = useState<string | null>(null);

  useEffect(() => {
    if (!movement) { setCoachName(null); return; }
    const coachUid = movement.coachId || movement.createdBy;
    if (!coachUid) { setCoachName(null); return; }
    let cancelled = false;
    (async () => {
      try {
        // Try coaches collection first
        const coachSnap = await getDoc(doc(db, 'coaches', coachUid));
        if (!cancelled && coachSnap.exists()) {
          const d = coachSnap.data();
          const name = d.displayName || d.name || [d.firstName, d.lastName].filter(Boolean).join(' ');
          if (name) { setCoachName(name); return; }
        }
        // Fallback: users collection
        const userSnap = await getDoc(doc(db, 'users', coachUid));
        if (!cancelled && userSnap.exists()) {
          const d = userSnap.data();
          const name = d.displayName || d.name || [d.firstName, d.lastName].filter(Boolean).join(' ');
          if (name) { setCoachName(name); return; }
        }
        if (!cancelled) setCoachName(null);
      } catch (err) {
        console.warn('[MovementDetail] Coach lookup error:', err);
        if (!cancelled) setCoachName(null);
      }
    })();
    return () => { cancelled = true; };
  }, [movement?.id, movement?.coachId, movement?.createdBy]);

  if (!movement) return null;

  const createdDate = movement.createdAt?.seconds
    ? new Date(movement.createdAt.seconds * 1000).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={s.root}>
        {/* Header */}
        <View style={s.header}>
          <Pressable onPress={onClose} hitSlop={8}>
            <Icon name="close" size={24} color="#8A95A3" />
          </Pressable>
          <Text style={s.headerTitle}>Movement Details</Text>
          <Pressable onPress={() => onEdit(movement)} hitSlop={8}>
            <Icon name="edit" size={20} color="#F5A623" />
          </Pressable>
        </View>

        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
          {/* Name */}
          <Text style={s.name}>{movement.name}</Text>

          {/* Video / Thumbnail — shrunk to 16:9 */}
          {(movement.videoUrl || movement.thumbnailUrl || movement.mediaUrl) ? (
            <View style={s.mediaSection}>
              {movement.videoUrl ? (
                <MovementVideoControls
                  uri={movement.videoUrl}
                  posterUri={movement.thumbnailUrl || undefined}
                  aspectRatio={16 / 9}
                  autoPlay={true}
                  showControls={true}
                  cropScale={movement.cropScale ?? 1}
                  cropTranslateX={movement.cropTranslateX ?? 0}
                  cropTranslateY={movement.cropTranslateY ?? 0}
                />
              ) : (movement.thumbnailUrl || movement.mediaUrl) ? (
                <Image
                  source={{ uri: movement.thumbnailUrl || movement.mediaUrl || '' }}
                  style={s.mediaThumbnail}
                  resizeMode="cover"
                />
              ) : null}
            </View>
          ) : null}

          {/* Tappable Badges — tap to open full edit */}
          <Pressable onPress={() => onEdit(movement)}>
            <View style={s.badgeRow}>
              {movement.category ? (
                <View style={s.badge}>
                  <Text style={s.badgeText}>{movement.category}</Text>
                  <Icon name="edit" size={10} color="#4A5568" />
                </View>
              ) : null}
              {movement.equipment ? (
                <View style={s.badge}>
                  <Text style={s.badgeText}>{movement.equipment}</Text>
                  <Icon name="edit" size={10} color="#4A5568" />
                </View>
              ) : null}
              {movement.difficulty ? (
                <View style={s.badge}>
                  <Text style={s.badgeText}>{movement.difficulty}</Text>
                  <Icon name="edit" size={10} color="#4A5568" />
                </View>
              ) : null}
              {movement.isArchived && (
                <View style={[s.badge, s.archivedBadge]}>
                  <Text style={[s.badgeText, { color: '#E05252' }]}>Archived</Text>
                </View>
              )}
              {movement.isGlobal && (
                <View style={[s.badge, s.globalBadge]}>
                  <Text style={[s.badgeText, { color: '#F5A623' }]}>Global</Text>
                </View>
              )}
            </View>
            <Text style={s.editHint}>Tap badges to edit metadata</Text>
          </Pressable>

          {/* Muscle Groups */}
          {movement.muscleGroups.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>Muscle Groups</Text>
              <View style={s.chipRow}>
                {movement.muscleGroups.map((mg) => (
                  <View key={mg} style={s.chip}>
                    <Text style={s.chipText}>{mg}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Description */}
          {movement.description ? (
            <View style={s.section}>
              <Text style={s.sectionLabel}>Description</Text>
              <Text style={s.bodyText}>{movement.description}</Text>
            </View>
          ) : null}

          {/* Regression / Progression */}
          {(movement.regression || movement.progression) ? (
            <View style={s.section}>
              <Text style={s.sectionLabel}>Alternatives</Text>
              {movement.regression ? (
                <View style={s.altRow}>
                  <Text style={s.altLabel}>Regression:</Text>
                  <Text style={s.altValue}>{movement.regression}</Text>
                </View>
              ) : null}
              {movement.progression ? (
                <View style={s.altRow}>
                  <Text style={s.altLabel}>Progression:</Text>
                  <Text style={s.altValue}>{movement.progression}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Contraindications */}
          {movement.contraindications ? (
            <View style={s.section}>
              <Text style={[s.sectionLabel, { color: '#EF4444' }]}>Contraindications</Text>
              <Text style={[s.bodyText, { color: '#F0A0A0' }]}>
                {movement.contraindications}
              </Text>
            </View>
          ) : null}

          {/* Created info */}
          {createdDate && (
            <View style={s.section}>
              <Text style={s.metaText}>
                Created {createdDate}
                {movement.isGlobal
                  ? ' · Global Library'
                  : coachName
                  ? ` · ${coachName}`
                  : ' · Coach Private'}
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Action buttons — Edit + Archive only */}
        <View style={s.actions}>
          <Pressable
            style={s.editBtn}
            onPress={() => onEdit(movement)}
          >
            <Icon name="edit" size={18} color="#F5A623" />
            <Text style={s.editText}>Edit</Text>
          </Pressable>
          <Pressable
            style={s.archiveBtn}
            onPress={() => onArchive(movement)}
          >
            <Icon
              name={movement.isArchived ? 'refresh' : 'trash'}
              size={18}
              color="#E05252"
            />
            <Text style={s.archiveText}>
              {movement.isArchived ? 'Restore' : 'Archive'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E1117',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.select({ ios: 56, web: 16, default: 16 }),
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2A3347',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  mediaSection: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#1A2035',
  },
  mediaThumbnail: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 10,
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1A2035',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  archivedBadge: {
    borderColor: 'rgba(224,82,82,0.3)',
    backgroundColor: 'rgba(224,82,82,0.08)',
  },
  globalBadge: {
    borderColor: 'rgba(245,166,35,0.3)',
    backgroundColor: 'rgba(245,166,35,0.08)',
  },
  badgeText: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
  },
  editHint: {
    fontSize: 11,
    color: '#4A5568',
    fontFamily: FB,
    marginTop: 4,
  },
  section: {
    gap: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FH,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    backgroundColor: 'rgba(245,166,35,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  chipText: {
    fontSize: 12,
    color: '#F5A623',
    fontFamily: FB,
  },
  bodyText: {
    fontSize: 14,
    color: '#C0C8D4',
    fontFamily: FB,
    lineHeight: 20,
  },
  altRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-start',
    marginTop: 2,
  },
  altLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FB,
  },
  altValue: {
    fontSize: 13,
    color: '#C0C8D4',
    fontFamily: FB,
    flex: 1,
  },
  timerRow: {
    flexDirection: 'row',
    gap: 16,
  },
  timerItem: {
    alignItems: 'center',
    gap: 2,
  },
  timerValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  timerLabel: {
    fontSize: 11,
    color: '#8A95A3',
    fontFamily: FB,
  },
  // ── Swap Sides ──
  swapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  swapLabel: {
    fontSize: 14,
    color: '#C0C8D4',
    fontFamily: FB,
  },
  swapModeRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  swapModeBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#2A3347',
    alignItems: 'center',
    gap: 2,
  },
  swapModeBtnActive: {
    borderColor: 'rgba(245,166,35,0.3)',
    backgroundColor: 'rgba(245,166,35,0.08)',
  },
  swapModeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FH,
  },
  swapModeBtnTextActive: {
    color: '#F5A623',
  },
  swapModeDesc: {
    fontSize: 10,
    color: '#4A5568',
    fontFamily: FB,
  },
  saveSwapBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
    marginTop: 4,
  },
  saveSwapBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FB,
  },
  metaText: {
    fontSize: 12,
    color: '#4A5568',
    fontFamily: FB,
  },
  // ── Actions ──
  actions: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#2A3347',
  },
  editBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(245,166,35,0.1)',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.2)',
  },
  editText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FB,
  },
  archiveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(224,82,82,0.08)',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(224,82,82,0.2)',
  },
  archiveText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E05252',
    fontFamily: FB,
  },
});
