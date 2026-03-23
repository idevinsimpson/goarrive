/**
 * MemberDetail — Member Hub bottom sheet
 *
 * Tapping a member opens this full-featured hub. The top section shows the
 * member's name, contact info, and quick-action buttons. Below that is a grid
 * of action tiles — some live now, others marked "Coming Soon" for future
 * features described in the GoArrive blueprint.
 *
 * Live actions:
 *   - View Plan / Intake (navigates to member-plan page)
 *   - Edit Profile (opens MemberForm)
 *   - Archive / Restore
 *
 * Coming Soon tiles (future blueprint features):
 *   - Workouts & Playlist
 *   - Sessions & Stats
 *   - Schedule (Calendly)
 *   - Messages
 *   - Check-in Call
 *   - Measurements & Photos
 *   - Coach Notes
 *   - Referrals
 *   - Coach Videos
 *   - Journal
 *   - Send Password Reset
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';
import { db } from '../lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { Icon } from './Icon';
import { router } from 'expo-router';

const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const BG = '#0E1117';
const CARD = '#111827';
const CARD2 = '#151B28';
const BORDER = '#1E2A3A';
const MUTED = '#8A95A3';
const GOLD = '#F5A623';
const GREEN = '#6EBB7A';
const BLUE = '#7DD3FC';
const RED = '#E05252';

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
  const [currentMember, setCurrentMember] = useState(member);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'members', member.id), (snapshot) => {
      if (snapshot.exists()) {
        setCurrentMember({ id: snapshot.id, ...snapshot.data() });
      }
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
      sublabel: 'Playlist & rotation',
      color: GREEN,
      bgColor: 'rgba(110,187,122,0.1)',
      live: false,
    },
    {
      icon: 'activity',
      label: 'Sessions & Stats',
      sublabel: 'Past & upcoming sessions',
      color: BLUE,
      bgColor: 'rgba(125,211,252,0.1)',
      live: false,
    },
    {
      icon: 'calendar',
      label: 'Schedule',
      sublabel: 'Book via Calendly',
      color: '#A78BFA',
      bgColor: 'rgba(167,139,250,0.1)',
      live: false,
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
      live: false,
    },
    {
      icon: 'lock',
      label: 'Password Reset',
      sublabel: 'Send reset link',
      color: MUTED,
      bgColor: 'rgba(138,149,163,0.1)',
      live: false,
    },
  ];

  return (
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
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: CARD,
    borderTopLeftRadius: 24,
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
