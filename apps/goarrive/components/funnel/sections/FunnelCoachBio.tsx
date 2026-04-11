/**
 * FunnelCoachBio — canonical coach profile section matching jv.goarrive.fit
 *
 * Horizontal layout: 56px avatar with green border + name/bio/stars.
 * Shared by builder preview and public funnel page.
 */
import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Icon } from '../../Icon';

const GREEN_20 = 'rgba(123,160,91,0.20)';
const STAR = '#F5A623';

interface Props {
  coachName: string;
  bio: string;
  photoUrl: string;
}

export function FunnelCoachBio({ coachName, bio, photoUrl }: Props) {
  const initials = coachName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <View style={s.wrap}>
      <View style={s.divider} />

      <View style={s.row}>
        {/* Avatar */}
        <View style={s.avatarBorder}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={s.avatar} />
          ) : (
            <View style={[s.avatar, s.avatarPlaceholder]}>
              <Text style={s.initials}>{initials || 'C'}</Text>
            </View>
          )}
        </View>

        {/* Info */}
        <View style={s.info}>
          <Text style={s.name}>{coachName || 'Coach Name'}</Text>
          <Text style={s.bio}>{bio}</Text>
          <View style={s.stars}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Icon key={i} name="star" size={14} color={STAR} />
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    paddingHorizontal: 20,
    paddingTop: 48,
    paddingBottom: 32,
    position: 'relative',
  },
  divider: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    height: 1,
    backgroundColor: '#2A2E3A',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  avatarBorder: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: GREEN_20,
    overflow: 'hidden',
    flexShrink: 0,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#12141C',
  },
  initials: {
    fontSize: 22,
    fontWeight: '700',
    color: '#7BA05B',
  },
  info: { flex: 1 },
  name: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E8EAF0',
    marginBottom: 4,
  },
  bio: {
    fontSize: 12,
    color: '#7A7F94',
    lineHeight: 18,
    marginBottom: 8,
  },
  stars: {
    flexDirection: 'row',
    gap: 2,
  },
});
