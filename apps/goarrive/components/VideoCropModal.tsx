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
 * Uses react-native-gesture-handler + react-native-reanimated.
 *
 * Video sizing: We use the `videoStyle` prop with width/height 100% on web
 * to let the browser natively handle scaling the video to fill the frame.
 * Combined with ResizeMode.COVER (which maps to CSS objectFit: 'cover'),
 * this is reliable on Safari PWA where onReadyForDisplay doesn't fire.
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
  withSpring,
} from 'react-native-reanimated';
import { Icon } from './Icon';

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
  const { width: winWidth } = useWindowDimensions();
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

  // ── Bounds calculation ─────────────────────────────────────────────────
  // With objectFit: cover, the video fills the frame at scale=1.
  // At scale>1, the video overflows and can be panned.
  // Max pan = frameSize * (scale - 1) / 2

  const clampTranslate = (
    tx: number,
    ty: number,
    s: number,
  ): { x: number; y: number } => {
    'worklet';
    const maxX = (frameWidth * (s - 1)) / 2;
    const maxY = (frameHeight * (s - 1)) / 2;
    return {
      x: Math.min(Math.max(tx, -maxX), maxX),
      y: Math.min(Math.max(ty, -maxY), maxY),
    };
  };

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
    })
    .onUpdate((e) => {
      const rawX = savedTranslateX.value + e.translationX;
      const rawY = savedTranslateY.value + e.translationY;
      const clamped = clampTranslate(rawX, rawY, scale.value);
      translateX.value = clamped.x;
      translateY.value = clamped.y;
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

        {/* Crop frame */}
        <View style={s.frameContainer}>
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
  frame: {
    overflow: 'hidden',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.4)',
    backgroundColor: '#000',
  },
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: '#F5A623',
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
