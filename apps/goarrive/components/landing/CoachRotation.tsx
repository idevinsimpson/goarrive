/**
 * CoachRotation — auto-rotating coach showcase for the marketing homepage.
 *
 * Slides one coach at a time, ~9 seconds per slide (long enough to read the
 * quote). Cross-fades when the user prefers reduced motion. Pauses on hover
 * (web). Tappable dots jump to a specific coach.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  Pressable,
  StyleSheet,
  Platform,
  Animated,
  Easing,
  ImageSourcePropType,
} from 'react-native';

const SLIDE_MS = 9000;
const TRANSITION_MS = 500;

type Coach = {
  name: string;
  photo: ImageSourcePropType;
  quote: string;
};

const COACHES: Coach[] = [
  {
    name: 'Justin Edwards',
    photo: require('../../assets/coaches/justin-edwards.jpg'),
    quote: 'The work doesn\u2019t care how you feel \u2014 show up anyway and the feelings catch up.',
  },
  {
    name: 'Devin Simpson',
    photo: require('../../assets/coaches/devin-simpson.jpg'),
    quote: 'I built GoArrive because everyone deserves a coach who actually knows their name.',
  },
  {
    name: 'JV Moore',
    photo: require('../../assets/coaches/jv-moore.jpg'),
    quote: 'Discipline is just keeping the promise you made to yourself yesterday.',
  },
  {
    name: 'Jeremy Womack',
    photo: require('../../assets/coaches/jeremy-womack.jpg'),
    quote: 'Strong body, sharper mind. We train both \u2014 every session.',
  },
];

const C = {
  text:     '#E8EAF0',
  textSoft: '#9BA3B8',
  muted:    '#6B7280',
  gold:     '#F5A623',
  goldGlow: 'rgba(245,166,35,0.30)',
  dotOff:   'rgba(155,163,184,0.30)',
};

const FONT_H = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_B = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduce(mq.matches);
    const listener = (e: MediaQueryListEvent) => setReduce(e.matches);
    mq.addEventListener?.('change', listener);
    return () => mq.removeEventListener?.('change', listener);
  }, []);
  return reduce;
}

export default function CoachRotation({ isMobile }: { isMobile: boolean }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduceMotion = usePrefersReducedMotion();

  // Warm the browser cache for every coach photo on mount so the first
  // slide doesn't flash a blank ring while the JPG fetches. Pure browser
  // API — react-native-web 0.21 does not expose Image.resolveAssetSource,
  // so we read the bundled asset's .uri directly instead.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    COACHES.forEach((c) => {
      const uri = (c.photo as { uri?: string } | number)?.['uri' as never] as
        | string
        | undefined;
      if (typeof uri === 'string') {
        const img = new window.Image();
        img.src = uri;
      }
    });
  }, []);

  const opacity = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;

  const goTo = useMemo(
    () => (next: number) => {
      const target = (next + COACHES.length) % COACHES.length;
      if (target === index) return;
      const distance = isMobile ? 40 : 60;
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: TRANSITION_MS / 2,
          easing: Easing.out(Easing.quad),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(translateX, {
          toValue: -distance,
          duration: TRANSITION_MS / 2,
          easing: Easing.out(Easing.quad),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]).start(() => {
        setIndex(target);
        translateX.setValue(distance);
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 1,
            duration: TRANSITION_MS / 2,
            easing: Easing.out(Easing.quad),
            useNativeDriver: Platform.OS !== 'web',
          }),
          Animated.timing(translateX, {
            toValue: 0,
            duration: TRANSITION_MS / 2,
            easing: Easing.out(Easing.quad),
            useNativeDriver: Platform.OS !== 'web',
          }),
        ]).start();
      });
    },
    [index, isMobile, opacity, translateX],
  );

  useEffect(() => {
    if (paused) return;
    const id = setTimeout(() => goTo(index + 1), SLIDE_MS);
    return () => clearTimeout(id);
  }, [index, paused, goTo]);

  const photoSize = isMobile ? 140 : 180;
  const coach = COACHES[index];

  // prefers-reduced-motion: skip the slide, just swap (opacity stays at 1).
  const animatedStyle = reduceMotion
    ? null
    : { opacity, transform: [{ translateX }] };

  const hoverProps = Platform.OS === 'web'
    ? ({
        onMouseEnter: () => setPaused(true),
        onMouseLeave: () => setPaused(false),
      } as any)
    : {};

  return (
    <View style={styles.wrap} {...hoverProps}>
      <View style={[styles.stage, { minHeight: isMobile ? 320 : 360 }]}>
        <Animated.View style={[styles.slide, animatedStyle]}>
          <View
            style={[
              styles.photoRing,
              {
                width: photoSize + 12,
                height: photoSize + 12,
                borderRadius: (photoSize + 12) / 2,
              },
            ]}
          >
            <Image
              source={coach.photo}
              style={{
                width: photoSize,
                height: photoSize,
                borderRadius: photoSize / 2,
              }}
              accessibilityLabel={`${coach.name}, GoArrive coach`}
            />
          </View>
          <Text style={[styles.name, isMobile && { fontSize: 20 }]}>{coach.name}</Text>
          <Text style={[styles.quote, isMobile && { fontSize: 15, lineHeight: 24 }]}>
            &ldquo;{coach.quote}&rdquo;
          </Text>
        </Animated.View>
      </View>

      <View style={styles.dots}>
        {COACHES.map((c, i) => (
          <Pressable
            key={c.name}
            onPress={() => goTo(i)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Show coach ${c.name}`}
          >
            <View
              style={[
                styles.dot,
                i === index && styles.dotActive,
              ]}
            />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 56,
    paddingBottom: 24,
  },
  stage: {
    width: '100%',
    maxWidth: 560,
    alignItems: 'center',
    justifyContent: 'flex-start',
    overflow: 'hidden',
  },
  slide: {
    alignItems: 'center',
    width: '100%',
  },
  photoRing: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderWidth: 2,
    borderColor: 'rgba(245,166,35,0.55)',
    marginBottom: 18,
    ...(Platform.OS === 'web'
      ? ({ boxShadow: `0 0 28px ${C.goldGlow}` } as any)
      : {}),
  },
  name: {
    fontSize: 22,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    textAlign: 'center',
    marginBottom: 10,
    letterSpacing: -0.2,
  },
  quote: {
    fontSize: 16,
    color: C.textSoft,
    fontFamily: FONT_B,
    fontStyle: 'italic',
    textAlign: 'center',
    lineHeight: 26,
    maxWidth: 460,
  },
  dots: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 28,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.dotOff,
    ...(Platform.OS === 'web'
      ? ({ transition: 'background-color 0.2s ease, transform 0.2s ease' } as any)
      : {}),
  },
  dotActive: {
    backgroundColor: C.gold,
    transform: [{ scale: 1.25 }],
  },
});
