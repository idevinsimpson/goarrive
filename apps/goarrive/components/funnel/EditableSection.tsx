import React, { useRef } from 'react';
import { Pressable, View, Text, Animated, StyleSheet } from 'react-native';
import { Icon } from '../Icon';

interface Props {
  label: string;
  onEdit: () => void;
  children: React.ReactNode;
}

export function EditableSection({ label, onEdit, children }: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  function handlePressIn() {
    Animated.spring(scale, { toValue: 0.98, useNativeDriver: true }).start();
  }

  function handlePressOut() {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();
  }

  return (
    <Pressable
      onPress={onEdit}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${label}`}
    >
      <Animated.View style={[s.wrap, { transform: [{ scale }] }]}>
        {children}
        <View style={s.badge}>
          <Icon name="edit-2" size={12} color="#F5A623" />
          <Text style={s.badgeText}>{label}</Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(245,166,35,0.35)',
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(245,166,35,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#F5A623',
    letterSpacing: 0.3,
  },
});
