/**
 * EditableSection — subtle tap-to-edit wrapper for builder mode.
 *
 * At rest: zero visible chrome. The section looks exactly like the real page.
 * On hover/focus: a faint border and tiny pencil icon appear.
 * The actual page design stays visually primary at all times.
 */
import React, { useRef, useState } from 'react';
import { Pressable, View, Animated, StyleSheet } from 'react-native';
import { Icon } from '../Icon';

interface Props {
  onEdit: () => void;
  children: React.ReactNode;
}

export function EditableSection({ onEdit, children }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const [hovered, setHovered] = useState(false);

  function handlePressIn() {
    Animated.spring(scale, {
      toValue: 0.985,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }

  function handlePressOut() {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }

  return (
    <Pressable
      onPress={onEdit}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel="Tap to edit this section"
    >
      <Animated.View
        style={[
          s.wrap,
          hovered && s.hovered,
          { transform: [{ scale }] },
        ]}
      >
        {children}
        {/* Tiny pencil — only visible on hover */}
        {hovered && (
          <View style={s.pencil}>
            <Icon name="edit-2" size={12} color="rgba(255,255,255,0.6)" />
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: {
    position: 'relative',
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 4,
  },
  hovered: {
    borderColor: 'rgba(123,160,91,0.25)',
  },
  pencil: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
