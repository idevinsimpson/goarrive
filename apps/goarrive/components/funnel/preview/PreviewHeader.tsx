import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';

interface Props {
  coachName: string;
  photoUrl: string;
}

export function PreviewHeader({ coachName, photoUrl }: Props) {
  const initials = coachName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <View style={s.wrap}>
      <View style={s.left}>
        <Text style={s.logo}>G➲A</Text>
      </View>
      <View style={s.right}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={s.avatar} />
        ) : (
          <View style={[s.avatar, s.avatarPlaceholder]}>
            <Text style={s.initials}>{initials || 'C'}</Text>
          </View>
        )}
        <View>
          <Text style={s.label}>Your Coach</Text>
          <Text style={s.name}>{coachName || 'Coach Name'}</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  left: { flexDirection: 'row', alignItems: 'center' },
  logo: { fontSize: 18, fontWeight: '800', color: '#1A1A2E' },
  right: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#E5E7EB' },
  avatarPlaceholder: { justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5A623' },
  initials: { fontSize: 14, fontWeight: '700', color: '#FFF' },
  label: { fontSize: 10, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5 },
  name: { fontSize: 13, fontWeight: '700', color: '#1A1A2E' },
});
