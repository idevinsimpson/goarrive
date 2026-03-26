/**
 * WorkoutCelebration — Post-workout celebration overlay
 *
 * Shows a brief, delightful celebration animation when the member
 * finishes a workout. Follows Savannah Bananas DNA: smooth and
 * memorable finish moments, subtle delight not gimmicks.
 *
 * Uses Animated API for a lightweight confetti-like burst and
 * motivational message before transitioning to the session summary.
 *
 * R3: Added "Skip" button so members can bypass the animation.
 * R7: Reduced confetti dots from 16 → 10 for low-end device perf.
 *
 * Props:
 *   - visible: boolean
 *   - workoutName: string
 *   - onComplete: () => void — called when animation finishes or skip pressed
 */
import React, { useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Platform,
  Dimensions,
} from 'react-native';

const FH =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

/** R7: Reduced from 16 to 10 to prevent frame drops on low-end Android */
const CONFETTI_COUNT = 10;

const CELEBRATION_MESSAGES = [
  'Workout Complete!',
  'You Crushed It!',
  'Strong Finish!',
  'Way To Show Up!',
  'That Was Fire!',
];

const SUB_MESSAGES = [
  'Your coach will be proud.',
  'Consistency builds champions.',
  'Another step closer to your goals.',
  'You showed up — that matters.',
  'Momentum is everything.',
];

interface WorkoutCelebrationProps {
  visible: boolean;
  workoutName?: string;
  onComplete: () => void;
}

/** Simple confetti dot that animates up and fades out */
function ConfettiDot({
  delay,
  startX,
  color,
}: {
  delay: number;
  startX: number;
  color: string;
}) {
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const anim = Animated.sequence([
      Animated.delay(delay),
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -(SCREEN_H * 0.3 + Math.random() * 100),
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.delay(600),
          Animated.timing(opacity, {
            toValue: 0,
            duration: 400,
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(scale, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
    ]);
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <Animated.View
      style={[
        st.confettiDot,
        {
          backgroundColor: color,
          left: startX,
          transform: [{ translateY }, { scale }],
          opacity,
        },
      ]}
    />
  );
}

const CONFETTI_COLORS = ['#F5A623', '#4CAF50', '#2196F3', '#FF5722', '#9C27B0', '#FFD700'];

export default function WorkoutCelebration({
  visible,
  workoutName,
  onComplete,
}: WorkoutCelebrationProps) {
  const fadeIn = useRef(new Animated.Value(0)).current;
  const titleScale = useRef(new Animated.Value(0.5)).current;
  const subOpacity = useRef(new Animated.Value(0)).current;
  const sequenceRef = useRef<Animated.CompositeAnimation | null>(null);

  const mainMsg = useRef(
    CELEBRATION_MESSAGES[Math.floor(Math.random() * CELEBRATION_MESSAGES.length)],
  ).current;
  const subMsg = useRef(
    SUB_MESSAGES[Math.floor(Math.random() * SUB_MESSAGES.length)],
  ).current;

  /** R3: Skip handler — stops animation and immediately completes */
  const handleSkip = useCallback(() => {
    if (sequenceRef.current) {
      sequenceRef.current.stop();
      sequenceRef.current = null;
    }
    onComplete();
  }, [onComplete]);

  useEffect(() => {
    if (!visible) return;

    // Reset
    fadeIn.setValue(0);
    titleScale.setValue(0.5);
    subOpacity.setValue(0);

    const sequence = Animated.sequence([
      // Fade in background
      Animated.timing(fadeIn, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      // Scale up title
      Animated.spring(titleScale, {
        toValue: 1,
        friction: 4,
        tension: 60,
        useNativeDriver: true,
      }),
      // Fade in subtitle
      Animated.timing(subOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
      // Hold for a moment
      Animated.delay(1500),
      // Fade out
      Animated.timing(fadeIn, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),
    ]);

    sequenceRef.current = sequence;

    sequence.start(({ finished }) => {
      if (finished) onComplete();
    });

    return () => {
      sequence.stop();
      sequenceRef.current = null;
    };
  }, [visible]);

  if (!visible) return null;

  // Generate confetti dots (R7: reduced count)
  const confettiDots = Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
    id: i,
    delay: Math.random() * 400,
    startX: Math.random() * SCREEN_W,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  }));

  return (
    <Animated.View style={[st.overlay, { opacity: fadeIn }]}>
      {/* Confetti */}
      <View style={st.confettiContainer}>
        {confettiDots.map((dot) => (
          <ConfettiDot
            key={dot.id}
            delay={dot.delay}
            startX={dot.startX}
            color={dot.color}
          />
        ))}
      </View>

      {/* Main content */}
      <View style={st.content}>
        <Text style={st.emoji}>🎉</Text>
        <Animated.Text
          style={[st.mainMessage, { transform: [{ scale: titleScale }] }]}
        >
          {mainMsg}
        </Animated.Text>
        {workoutName ? (
          <Text style={st.workoutName}>{workoutName}</Text>
        ) : null}
        <Animated.Text style={[st.subMessage, { opacity: subOpacity }]}>
          {subMsg}
        </Animated.Text>
      </View>

      {/* R3: Skip button — always visible so members can move quickly */}
      <Pressable
        style={st.skipBtn}
        onPress={handleSkip}
        accessibilityLabel="Skip celebration"
        accessibilityRole="button"
      >
        <Text style={st.skipText}>Skip</Text>
      </Pressable>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(14, 17, 23, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  confettiContainer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  confettiDot: {
    position: 'absolute',
    bottom: '40%',
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  mainMessage: {
    fontSize: 32,
    fontWeight: '800',
    color: '#F5A623',
    fontFamily: FH,
    textAlign: 'center',
    marginBottom: 8,
  },
  workoutName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FH,
    textAlign: 'center',
    marginBottom: 12,
  },
  subMessage: {
    fontSize: 16,
    color: '#8A95A3',
    fontFamily: FB,
    textAlign: 'center',
    lineHeight: 22,
  },
  skipBtn: {
    position: 'absolute',
    bottom: 48,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#4A5568',
  },
  skipText: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FB,
    letterSpacing: 0.5,
  },
});
