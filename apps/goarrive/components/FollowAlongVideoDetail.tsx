/**
 * FollowAlongVideoDetail — view + lightly edit a Follow-Along Video asset.
 *
 * Mirrors MovementDetail but slimmer — Follow-Alongs only carry name, sound,
 * crop, and a long-form video. Coaches don't need the full muscle-group/
 * regression metadata that movements have.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  Modal,
  TextInput,
  Switch,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Icon } from './Icon';
import MovementVideoControls from './MovementVideoControls';
import { FB, FH } from '../lib/theme';

export interface FollowAlongVideoData {
  id: string;
  name: string;
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  thumbnailImageUrl?: string | null;
  videoDurationSec?: number;
  soundEnabled?: boolean;
  cropScale?: number;
  cropTranslateX?: number;
  cropTranslateY?: number;
  isArchived?: boolean;
  createdAt?: any;
  updatedAt?: any;
  [key: string]: any;
}

interface Props {
  visible: boolean;
  followAlong: FollowAlongVideoData | null;
  onClose: () => void;
  onArchive: (m: FollowAlongVideoData) => void;
  /** Optional breadcrumb label (e.g. "Back to Workout") */
  backLabel?: string;
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function FollowAlongVideoDetail({
  visible,
  followAlong,
  onClose,
  onArchive,
  backLabel,
}: Props) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    if (!followAlong) return;
    setName(followAlong.name ?? '');
    setSoundEnabled(followAlong.soundEnabled ?? true);
  }, [followAlong?.id]);

  if (!followAlong) return null;

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === followAlong.name) return;
    setSavingName(true);
    try {
      await updateDoc(doc(db, 'followAlongVideos', followAlong.id), {
        name: trimmed,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error('[FollowAlongVideoDetail] save name error:', e);
    } finally {
      setSavingName(false);
    }
  };

  const toggleSound = async (next: boolean) => {
    setSoundEnabled(next);
    try {
      await updateDoc(doc(db, 'followAlongVideos', followAlong.id), {
        soundEnabled: next,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error('[FollowAlongVideoDetail] save sound error:', e);
      setSoundEnabled(!next);
    }
  };

  const createdDate = followAlong.createdAt?.seconds
    ? new Date(followAlong.createdAt.seconds * 1000).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
      })
    : null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[s.root, Platform.OS === 'web' && { height: windowHeight }]}>
        {backLabel && (
          <Pressable style={[s.backBreadcrumb, { paddingTop: Math.max(12, insets.top) }]} onPress={onClose}>
            <Icon name="chevron-left" size={16} color="#F5A623" />
            <Text style={s.backBreadcrumbText}>{backLabel}</Text>
          </Pressable>
        )}

        <View style={s.header}>
          <Pressable onPress={onClose} hitSlop={8}>
            <Icon name="close" size={24} color="#8A95A3" />
          </Pressable>
          <Text style={s.headerTitle}>Follow-Along Video</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView style={s.scroll} contentContainerStyle={[s.scrollContent, { paddingBottom: 16 + insets.bottom }]}>
          {/* Name (editable inline) */}
          <View>
            <Text style={s.label}>Name</Text>
            <TextInput
              style={s.nameInput}
              value={name}
              onChangeText={setName}
              onBlur={saveName}
              placeholder="Untitled Follow-Along"
              placeholderTextColor="#4A5568"
              editable={!savingName}
            />
          </View>

          {/* Video player — 16:9 with crop transform */}
          {followAlong.videoUrl ? (
            <View style={s.mediaSection}>
              <MovementVideoControls
                uri={followAlong.videoUrl}
                posterUri={followAlong.thumbnailImageUrl || followAlong.thumbnailUrl || undefined}
                aspectRatio={16 / 9}
                autoPlay={false}
                showControls={true}
                cropScale={followAlong.cropScale ?? 1}
                cropTranslateX={followAlong.cropTranslateX ?? 0}
                cropTranslateY={followAlong.cropTranslateY ?? 0}
              />
            </View>
          ) : null}

          {/* Badges */}
          <View style={s.badgeRow}>
            {typeof followAlong.videoDurationSec === 'number' && (
              <View style={s.badge}>
                <Icon name="clock" size={12} color="#8A95A3" />
                <Text style={s.badgeText}>{fmtDuration(followAlong.videoDurationSec)}</Text>
              </View>
            )}
            {followAlong.isArchived && (
              <View style={[s.badge, s.archivedBadge]}>
                <Text style={[s.badgeText, { color: '#E05252' }]}>Archived</Text>
              </View>
            )}
          </View>

          {/* Sound toggle */}
          <View style={s.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Sound</Text>
              <Text style={s.helpText}>Play original audio during workout (coach voiceover).</Text>
            </View>
            <Switch
              value={soundEnabled}
              onValueChange={toggleSound}
              trackColor={{ false: '#2A3347', true: '#22D3EE' }}
              thumbColor={Platform.OS === 'android' ? '#F0F4F8' : undefined}
            />
          </View>

          {createdDate && (
            <View>
              <Text style={s.metaText}>Created {createdDate}</Text>
            </View>
          )}
        </ScrollView>

        <View style={s.actions}>
          <Pressable
            style={s.archiveBtn}
            onPress={() => onArchive(followAlong)}
          >
            <Icon
              name={followAlong.isArchived ? 'refresh' : 'trash'}
              size={18}
              color="#E05252"
            />
            <Text style={s.archiveText}>
              {followAlong.isArchived ? 'Restore' : 'Archive'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0E1117' },
  backBreadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.select({ ios: 56, web: 12, default: 12 }),
    paddingBottom: 4,
    gap: 4,
  },
  backBreadcrumbText: {
    fontSize: 13, color: '#F5A623', fontFamily: FB, fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.select({ ios: 12, web: 16, default: 16 }),
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2A3347',
  },
  headerTitle: { fontSize: 16, fontWeight: '600', color: '#F0F4F8', fontFamily: FH },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 18 },
  label: {
    fontSize: 12, color: '#8A95A3', fontFamily: FB, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
  },
  helpText: {
    fontSize: 12, color: '#6B7585', fontFamily: FB, marginTop: 4,
  },
  nameInput: {
    backgroundColor: '#1A2035',
    borderWidth: 1, borderColor: '#2A3347', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    color: '#F0F4F8', fontSize: 18, fontFamily: FH, fontWeight: '700',
  },
  mediaSection: {
    borderRadius: 10, overflow: 'hidden', backgroundColor: '#1A2035',
  },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#1A2035',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 8, borderWidth: 1, borderColor: '#2A3347',
  },
  archivedBadge: {
    borderColor: 'rgba(224,82,82,0.3)',
    backgroundColor: 'rgba(224,82,82,0.08)',
  },
  badgeText: { fontSize: 12, color: '#8A95A3', fontFamily: FB },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#1A2035', padding: 12, borderRadius: 10,
    borderWidth: 1, borderColor: '#2A3347',
  },
  metaText: { fontSize: 12, color: '#6B7585', fontFamily: FB },
  actions: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.select({ ios: 24, default: 16 }),
    borderTopWidth: 1,
    borderTopColor: '#2A3347',
  },
  archiveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(224,82,82,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(224,82,82,0.3)',
    paddingVertical: 12,
    borderRadius: 10,
  },
  archiveText: { color: '#E05252', fontSize: 14, fontWeight: '700', fontFamily: FH },
});
