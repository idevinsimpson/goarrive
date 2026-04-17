/**
 * ModalSheet — shared bottom-sheet modal for mobile-web-safe scrolling.
 *
 * ROOT CAUSE this solves:
 * On mobile Safari/Chrome, React Native Web's <Modal> uses a position:fixed
 * container that extends behind the browser toolbar. Percentage-based heights
 * and justifyContent:'flex-end' cause the bottom of the sheet to sit behind
 * the toolbar, making footer buttons and bottom content unreachable.
 *
 * On mobile Safari, `window.innerHeight` does NOT shrink when the soft
 * keyboard opens — only `window.visualViewport.height` does. Without
 * tracking the visual viewport, the sheet (and any focused TextInput) sits
 * behind the keyboard.
 *
 * FIX: On web, the inner layout container tracks `window.visualViewport`
 * (height + offsetTop). When the keyboard opens, the inner shrinks and the
 * sheet's flex-end positioning keeps it pinned above the keyboard. A
 * focusin listener also calls scrollIntoView on the focused input so it
 * stays visible inside the sheet's ScrollView.
 *
 * USAGE:
 *   <ModalSheet visible={vis} onClose={close} maxHeightPct={0.9}>
 *     <View style={header}>…</View>
 *     <ScrollView style={{ flex: 1 }}>…</ScrollView>
 *     <View style={footer}>…</View>
 *   </ModalSheet>
 *
 * DO NOT replace this with inline Modal+overlay+sheet — that reintroduces the
 * browser-chrome regression. If you need a different modal style (centered
 * dialog, full-screen, pageSheet), use <Modal> directly.
 */
import React from 'react';
import {
  Modal,
  View,
  Pressable,
  Platform,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface ModalSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Fraction of visible viewport height (0–1). Default 0.9 */
  maxHeightPct?: number;
  animationType?: 'slide' | 'fade' | 'none';
  /** Sheet background color. Default '#0E1117' */
  sheetBg?: string;
  /** Backdrop opacity color. Default 'rgba(0,0,0,0.85)' */
  backdropColor?: string;
  /** Border radius for top corners. Default 20 */
  borderRadius?: number;
  /** Whether tapping backdrop dismisses. Default false */
  dismissOnBackdrop?: boolean;
}

/**
 * Tracks window.visualViewport on web so the sheet shrinks above the soft
 * keyboard. Falls back to useWindowDimensions when unavailable.
 */
function useVisibleViewport(visible: boolean, fallbackHeight: number) {
  const [viewport, setViewport] = React.useState({
    height: fallbackHeight,
    offsetTop: 0,
  });

  React.useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) {
      setViewport({ height: fallbackHeight, offsetTop: 0 });
      return;
    }
    const update = () => {
      setViewport({ height: vv.height, offsetTop: vv.offsetTop });
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [visible, fallbackHeight]);

  return viewport;
}

export default function ModalSheet({
  visible,
  onClose,
  children,
  maxHeightPct = 0.9,
  animationType = 'slide',
  sheetBg = '#0E1117',
  backdropColor = 'rgba(0,0,0,0.85)',
  borderRadius = 20,
  dismissOnBackdrop = false,
}: ModalSheetProps) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const viewport = useVisibleViewport(visible, windowHeight);

  // On web, scroll the focused input into the visible sheet when the
  // keyboard opens. iOS Safari's default scroll-into-view fails inside
  // position:fixed containers, so we do it explicitly after the visual
  // viewport has resized.
  React.useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    if (typeof document === 'undefined') return;
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      const isEditable =
        tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
      if (!isEditable) return;
      // Wait for the keyboard to open and visualViewport to resize.
      window.setTimeout(() => {
        try {
          target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } catch {
          // Older browsers — fall back to no-op scroll.
        }
      }, 250);
    };
    document.addEventListener('focusin', handleFocusIn);
    return () => document.removeEventListener('focusin', handleFocusIn);
  }, [visible]);

  // Visible viewport on web tracks the keyboard; on native we fill the modal.
  const innerStyle =
    Platform.OS === 'web'
      ? {
          position: 'absolute' as const,
          left: 0,
          right: 0,
          top: viewport.offsetTop,
          height: viewport.height,
        }
      : null;

  const sheetMaxHeight =
    Platform.OS === 'web'
      ? viewport.height * maxHeightPct
      : windowHeight * maxHeightPct;

  return (
    <Modal
      visible={visible}
      animationType={animationType}
      transparent
      onRequestClose={onClose}
    >
      {/* Full-bleed dark backdrop */}
      <Pressable
        style={[styles.backdrop, { backgroundColor: backdropColor }]}
        onPress={dismissOnBackdrop ? onClose : undefined}
      >
        {/*
         * On web: position absolutely against the visual viewport so the
         * sheet stays above the soft keyboard.
         * On native: flex:1 fills the modal (no browser chrome / keyboard
         * positioning issue — RN handles keyboard avoidance natively).
         */}
        <View style={[styles.inner, innerStyle]}>
          <View
            style={[
              styles.sheet,
              {
                maxHeight: sheetMaxHeight,
                backgroundColor: sheetBg,
                borderTopLeftRadius: borderRadius,
                borderTopRightRadius: borderRadius,
                paddingBottom: insets.bottom,
              },
            ]}
            /* Capture touches so they don't propagate to backdrop dismiss */
            onStartShouldSetResponder={() => true}
          >
            {children}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
  },
  inner: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    flex: 1,
    overflow: 'hidden',
  },
});
