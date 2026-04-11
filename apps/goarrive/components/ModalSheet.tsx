/**
 * ModalSheet — shared bottom-sheet modal for mobile-web-safe scrolling.
 *
 * ROOT CAUSE this solves:
 * On mobile Safari/Chrome, React Native Web's <Modal> uses a position:fixed
 * container that extends behind the browser toolbar. Percentage-based heights
 * and justifyContent:'flex-end' cause the bottom of the sheet to sit behind
 * the toolbar, making footer buttons and bottom content unreachable.
 *
 * FIX: On web, the inner layout container is constrained to window.innerHeight
 * (via useWindowDimensions) so flex-end positioning keeps the sheet within the
 * visible viewport. Safe-area bottom padding is added for the home indicator.
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
         * On web: constrain to window.innerHeight so flex-end positions
         * the sheet above browser chrome instead of behind it.
         * On native: flex:1 fills the modal (no browser chrome issue).
         */}
        <View
          style={[
            styles.inner,
            Platform.OS === 'web' ? { height: windowHeight } : null,
          ]}
        >
          <View
            style={[
              styles.sheet,
              {
                maxHeight: windowHeight * maxHeightPct,
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
