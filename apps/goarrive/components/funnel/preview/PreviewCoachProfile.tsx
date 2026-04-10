import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';

interface Props {
  coachName: string;
  bio: string;
  photoUrl: string;
}

export function PreviewCoachProfile({ coachName, bio, photoUrl }: Props) {
  const initials = coachName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <View style={s.wrap}>
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={s.photo} />
      ) : (
        <View style={[s.photo, s.placeholder]}>
          <Text style={s.initials}>{initials || 'C'}</Text>
        </View>
      )}
      <Text style={s.name}>{coachName || 'Coach Name'}</Text>
      <Text style={s.bio}>{bio}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  photo: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#E5E7EB', marginBottom: 12 },
  placeholder: { justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5A623' },
  initials: { fontSize: 28, fontWeight: '700', color: '#FFF' },
  name: { fontSize: 16, fontWeight: '700', color: '#1A1A2E', marginBottom: 8 },
  bio: { fontSize: 13, color: '#4B5563', lineHeight: 19, textAlign: 'center' },
});
