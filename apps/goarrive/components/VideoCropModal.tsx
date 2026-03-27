/**
 * VideoCropModal — Canva-style video reframe/crop within a 4:5 frame
 *
 * After a coach uploads a video, this modal lets them:
 *   - Pan (drag) the video within the 4:5 window
 *   - Pinch-to-zoom to make the subject larger/closer
 *
 * Saves non-destructive transform values (scale, translateX, translateY)
 * that are applied at display time — the original video is never modified.
 *
 * UX Polish:
 *   - Semi-transparent overlay outside the 4:5 frame shows what's cropped out
 *   - Zoom percentage indicator (100%, 150%, etc.)
 *   - Haptic feedback when hitting pan boundaries
 *
 * Uses react-native-gesture-handler + react-native-reanimated.
 */
import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Icon } from './Icon';

// ── Haptic helper (web-safe) ────────────────────────────────────────────────

let Haptics: any = null;
try {
  Haptics = require('expo-haptics');
} catch {
  // expo-haptics not available — no-op
}

function triggerBoundaryHaptic() {
  if (Haptics?.impactAsync) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface CropValues {
  cropScale: number;
  cropTranslateX: number;
  cropTranslateY: number;
}

interface Props {
  visible: boolean;
  videoUri: string;
  /** Initial crop values (e.g. from a previous edit) */
  initialCrop?: CropValues;
  /** Called when the coach taps "Done" */
  onDone: (crop: CropValues) => void;
  /** Called when the coach cancels */
  onCancel: () => void;
}

// ── Constants ──────────────────────────────────────────────────────────────

const FRAME_ASPECT = 4 / 5; // width / height = 0.8
const MIN_SCALE = 1;
const MAX_SCALE = 3;

const FH =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

// ── Component ──────────────────────────────────────────────────────────────

export default function VideoCropModal({
  visible,
  videoUri,
  initialCrop,
  onDone,
  onCancel,
}: Props) {
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  // Frame fills available width minus padding
  const frameWidth = Math.min(winWidth - 32, 500);
  const frameHeight = frameWidth / FRAME_ASPECT;

  // ── Shared values ──────────────────────────────────────────────────────

  const scale = useSharedValue(initialCrop?.cropScale ?? 1);
  const savedScale = useSharedValue(initialCrop?.cropScale ?? 1);

  const translateX = useSharedValue(initialCrop?.cropTranslateX ?? 0);
  const translateY = useSharedValue(initialCrop?.cropTranslateY ?? 0);
  const savedTranslateX = useSharedValue(initialCrop?.cropTranslateX ?? 0);
  const savedTranslateY = useSharedValue(initialCrop?.cropTranslateY ?? 0);

  // Track whether we already fired haptic at current boundary to avoid spamming
  const hitBoundaryX = useSharedValue(false);
  const hitBoundaryY = useSharedValue(false);

  // ── Bounds calculation ─────────────────────────────────────────────────

  const clampTranslate = (
    tx: number,
    ty: number,
    s: number,
  ): { x: number; y: number; clampedX: boolean; clampedY: boolean } => {
    'worklet';
    const maxX = (frameWidth * (s - 1)) / 2;
    const maxY = (frameHeight * (s - 1)) / 2;
    const cx = Math.min(Math.max(tx, -maxX), maxX);
    const cy = Math.min(Math.max(ty, -maxY), maxY);
    return {
      x: cx,
      y: cy,
      clampedX: cx !== tx,
      clampedY: cy !== ty,
    };
  };

  // ── Zoom percentage (derived) ──────────────────────────────────────────

  const zoomPct = useDerivedValue(() => Math.round(scale.value * 100));

  const zoomLabelStyle = useAnimatedStyle(() => ({
    opacity: scale.value > 1.01 ? 1 : 0,
  }));

  // ── Gestures ───────────────────────────────────────────────────────────

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value;
    })
    .onUpdate((e) => {
      scale.value = Math.min(
        Math.max(savedScale.value * e.scale, MIN_SCALE),
        MAX_SCALE,
      );
      // Re-clamp translate at new scale
      const clamped = clampTranslate(translateX.value, translateY.value, scale.value);
      translateX.value = clamped.x;
      translateY.value = clamped.y;
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const panGesture = Gesture.Pan()
    .averageTouches(true)
    .onStart(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      hitBoundaryX.value = false;
      hitBoundaryY.value = false;
    })
    .onUpdate((e) => {
      const rawX = savedTranslateX.value + e.translationX;
      const rawY = savedTranslateY.value + e.translationY;
      const clamped = clampTranslate(rawX, rawY, scale.value);
      translateX.value = clamped.x;
      translateY.value = clamped.y;

      // Haptic feedback when hitting boundary
      if (clamped.clampedX && !hitBoundaryX.value) {
        hitBoundaryX.value = true;
        runOnJS(triggerBoundaryHaptic)();
      } else if (!clamped.clampedX) {
        hitBoundaryX.value = false;
      }

      if (clamped.clampedY && !hitBoundaryY.value) {
        hitBoundaryY.value = true;
        runOnJS(triggerBoundaryHaptic)();
      } else if (!clamped.clampedY) {
        hitBoundaryY.value = false;
      }
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  // Double-tap to reset
  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      scale.value = withSpring(1);
      translateX.value = withSpring(0);
      translateY.value = withSpring(0);
      savedScale.value = 1;
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
    });

  const composedGesture = Gesture.Simultaneous(
    panGesture,
    pinchGesture,
    doubleTapGesture,
  );

  // ── Animated style ─────────────────────────────────────────────────────

  const animatedVideoStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleDone = useCallback(() => {
    onDone({
      cropScale: scale.value,
      cropTranslateX: translateX.value,
      cropTranslateY: translateY.value,
    });
  }, [onDone, scale, translateX, translateY]);

  const handleReset = useCallback(() => {
    scale.value = withSpring(1);
    translateX.value = withSpring(0);
    translateY.value = withSpring(0);
    savedScale.value = 1;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, [scale, translateX, translateY, savedScale, savedTranslateX, savedTranslateY]);

  // ── Overlay geometry ───────────────────────────────────────────────────
  // Semi-transparent overlay outside the 4:5 frame to show what's cropped out
  // We calculate the overlay regions as four rects around the frame

  // The frame is centered horizontally and vertically in the frameContainer area
  // Header + instructions take ~100px, rest button ~50px, so frame area is in between
  // We'll use absolute positioning within frameContainer

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={s.root}>
        {/* Header */}
        <View style={s.header}>
          <Pressable onPress={onCancel} hitSlop={8}>
            <Text style={s.cancelText}>Cancel</Text>
          </Pressable>
          <Text style={s.headerTitle}>Adjust Video</Text>
          <Pressable onPress={handleDone} hitSlop={8}>
            <Text style={s.doneText}>Done</Text>
          </Pressable>
        </View>

        {/* Instructions */}
        <Text style={s.instructions}>
          Drag to reposition. Pinch to zoom in. Double-tap to reset.
        </Text>

        {/* Crop frame area with overlay */}
        <View style={s.frameContainer}>
          {/* Semi-transparent overlay — fills entire area behind */}
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <View style={s.overlayFull} />
          </View>

          {/* The actual crop frame — punches a hole in the overlay */}
          <View
            style={[
              s.frame,
              { width: frameWidth, height: frameHeight },
            ]}
          >
            <GestureDetector gesture={composedGesture}>
              <Animated.View
                style={[
                  {
                    width: frameWidth,
                    height: frameHeight,
                  },
                  animatedVideoStyle,
                ]}
              >
                <Video
                  source={{ uri: videoUri }}
                  resizeMode={ResizeMode.COVER}
                  isLooping
                  shouldPlay
                  isMuted
                  style={{ width: frameWidth, height: frameHeight }}
                  videoStyle={
                    Platform.OS === 'web'
                      ? ({ width: '100%', height: '100%' } as any)
                      : undefined
                  }
                />
              </Animated.View>
            </GestureDetector>

            {/* Zoom percentage indicator */}
            <Animated.View style={[s.zoomBadge, zoomLabelStyle]} pointerEvents="none">
              <ZoomLabel zoomPct={zoomPct} />
            </Animated.View>
          </View>

          {/* Corner indicators */}
          <View style={[s.corner, s.cornerTL, { left: (winWidth - frameWidth) / 2 - 16 }]} />
          <View style={[s.corner, s.cornerTR, { right: (winWidth - frameWidth) / 2 - 16 }]} />
          <View style={[s.corner, s.cornerBL, { left: (winWidth - frameWidth) / 2 - 16 }]} />
          <View style={[s.corner, s.cornerBR, { right: (winWidth - frameWidth) / 2 - 16 }]} />
        </View>

        {/* Reset button */}
        <Pressable style={s.resetBtn} onPress={handleReset}>
          <Icon name="refresh" size={16} color="#F5A623" />
          <Text style={s.resetText}>Reset</Text>
        </Pressable>
      </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

// ── Zoom label sub-component (reads shared value via useAnimatedProps) ────

function ZoomLabel({ zoomPct }: { zoomPct: Animated.SharedValue<number> }) {
  const textStyle = useAnimatedStyle(() => ({
    // We can't animate text content directly, so we use a trick:
    // The parent opacity handles visibility, this just ensures the text is styled
    opacity: 1,
  }));

  // For web, we need to read the value in a derived way
  // Using a simple approach: re-render via useDerivedValue
  const displayPct = useDerivedValue(() => `${zoomPct.value}%`);

  return (
    <Animated.Text style={[s.zoomText, textStyle]}>
      <ReanimatedText text={displayPct} />
    </Animated.Text>
  );
}

// Simple component that displays a shared string value
function ReanimatedText({ text }: { text: Animated.SharedValue<string> }) {
  // On web, useAnimatedProps doesn't work for Text, so we use a workaround
  const animStyle = useAnimatedStyle(() => {
    // This is a hack to force re-render when text changes
    return { opacity: 1 };
  });

  // For simplicity and cross-platform compatibility, use a derived value approach
  // that works on both web and native
  const [displayText, setDisplayText] = React.useState('100%');

  React.useEffect(() => {
    // Set up an interval to read the shared value
    const interval = setInterval(() => {
      try {
        setDisplayText(text.value);
      } catch {
        // Shared value not accessible outside worklet on some platforms
      }
    }, 100);
    return () => clearInterval(interval);
  }, [text]);

  return <Text style={s.zoomTextInner}>{displayText}</Text>;
}

// ── Styles ────────────────────────────────────────────────────────────────

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
  cancelText: {
    fontSize: 15,
    color: '#8A95A3',
    fontFamily: FB,
  },
  doneText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
  },
  instructions: {
    textAlign: 'center',
    color: '#8A95A3',
    fontSize: 13,
    fontFamily: FB,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  frameContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  overlayFull: {
    flex: 1,
    backgroundColor: 'rgba(14, 17, 23, 0.65)',
  },
  frame: {
    overflow: 'hidden',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.4)',
    backgroundColor: '#000',
    // Elevate above the overlay
    zIndex: 2,
  },
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: '#F5A623',
    zIndex: 3,
  },
  cornerTL: {
    top: '50%',
    borderTopWidth: 2,
    borderLeftWidth: 2,
    marginTop: -10,
  },
  cornerTR: {
    top: '50%',
    borderTopWidth: 2,
    borderRightWidth: 2,
    marginTop: -10,
  },
  cornerBL: {
    bottom: '50%',
    borderBottomWidth: 2,
    borderLeftWidth: 2,
    marginBottom: -10,
  },
  cornerBR: {
    bottom: '50%',
    borderBottomWidth: 2,
    borderRightWidth: 2,
    marginBottom: -10,
  },
  zoomBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(14, 17, 23, 0.75)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    zIndex: 10,
  },
  zoomText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
  },
  zoomTextInner: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 16,
    paddingBottom: Platform.select({ ios: 40, default: 16 }),
  },
  resetText: {
    fontSize: 14,
    color: '#F5A623',
    fontFamily: FH,
    fontWeight: '600',
  },
});
