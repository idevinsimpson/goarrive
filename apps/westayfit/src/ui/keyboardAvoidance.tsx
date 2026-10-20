import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { Keyboard, Platform, View, type KeyboardEvent, type LayoutChangeEvent, type ViewProps } from 'react-native';

/**
 * NATIVE-INTEGRATOR-1 (INT-06). THE FOCUSED FIELD STAYS ABOVE THE KEYBOARD.
 *
 * Nothing in the app avoided the software keyboard. On Fabric iOS a
 * ScrollView's `automaticallyAdjustKeyboardInsets` defaults to NO, so a form
 * that fit its frame could not scroll at all with the keyboard up: Sign up's
 * Password, its Show toggle, the 8-character hint and Create account sat under
 * it. Android's SDK 54 edge-to-edge window no longer resizes for the IME
 * either.
 *
 *   iOS     `KEYBOARD_SCROLL_PROPS` turns on `automaticallyAdjustKeyboardInsets`:
 *           the scroll view insets its content by the keyboard and scrolls the
 *           focused input into view (RCTScrollViewComponentView
 *           `_keyboardWillChangeFrame`). Spread onto a form's ScrollView.
 *   Android `KeyboardInsetView` replaces the View that frames a form's
 *           ScrollView and pads its bottom by how far the IME overlaps it
 *           (measured in the window, so a staging strip above or a tab bar
 *           below is accounted for). The ScrollView shrinks, and Android's
 *           ScrollView scrolls its focused child into view on the resize.
 *   web     Both are inert: the props object is empty and `KeyboardInsetView`
 *           is a plain View, so the DOM is exactly what it was. Mobile browsers
 *           already pan the focused input into view.
 */

export function keyboardScrollProps(platform: string = Platform.OS): { automaticallyAdjustKeyboardInsets?: boolean } {
  return platform === 'ios' ? { automaticallyAdjustKeyboardInsets: true } : {};
}

export const KEYBOARD_SCROLL_PROPS = keyboardScrollProps();

/** How far an IME whose top edge is at `imeTop` covers a frame, in window points. */
export function imeOverlap(frame: { y: number; height: number }, imeTop: number): number {
  return Math.max(0, Math.round(frame.y + frame.height - imeTop));
}

/**
 * Android: a View that pads its bottom by the IME overlap while the keyboard is
 * up. Exported for tests; screens use `KeyboardInsetView`.
 */
export function AndroidKeyboardInsetView({ style, onLayout, children, ...rest }: ViewProps) {
  const ref = useRef<View>(null);
  const imeTop = useRef<number | null>(null);
  const [inset, setInset] = useState(0);
  const measure = useCallback(() => {
    const top = imeTop.current;
    if (top === null) {
      setInset(0);
      return;
    }
    ref.current?.measureInWindow((_x, y, _w, height) => {
      // The keyboard may have gone while this was measured.
      if (imeTop.current !== null) setInset(imeOverlap({ y, height }, imeTop.current));
    });
  }, []);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e: KeyboardEvent) => {
      imeTop.current = e.endCoordinates.screenY;
      measure();
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      imeTop.current = null;
      setInset(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [measure]);
  return (
    <View
      {...rest}
      ref={ref}
      style={[style, inset > 0 ? { paddingBottom: inset } : null]}
      onLayout={(e: LayoutChangeEvent) => {
        onLayout?.(e);
        // The frame moved with the keyboard up (a window that does resize, a
        // rotation): measure again, so the padding never doubles a resize.
        if (imeTop.current !== null) measure();
      }}
    >
      {children}
    </View>
  );
}

/**
 * NATIVE-INTEGRATOR-1 (INT-07). THE SOFTWARE KEYBOARD'S HEIGHT, for a
 * bottom-anchored sheet that has to rise above it (the MOVE count entry).
 * iOS reports it as the keyboard starts to move, Android once the IME is up;
 * 0 while it is down, and always 0 on web (react-native-web has no keyboard
 * events), so nothing on web changes.
 */
export function useKeyboardHeight(platform: string = Platform.OS): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (platform === 'web') return undefined;
    const ios = platform === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e: KeyboardEvent) =>
      setHeight(Math.max(0, e.endCoordinates.height)),
    );
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [platform]);
  return height;
}

/**
 * The bottom padding that keeps a bottom-anchored sheet's content above the
 * keyboard. iOS's keyboard height already includes the home-indicator inset;
 * Android's IME height excludes the navigation bar, which `safeBottom` covers.
 * With the keyboard down (and on web) it is the panel's usual `safeBottom + gap`.
 */
export function sheetBottomPadding(safeBottom: number, keyboard: number, platform: string = Platform.OS, gap = 8): number {
  if (keyboard <= 0 || platform === 'web') return safeBottom + gap;
  if (platform === 'ios') return Math.max(safeBottom, keyboard) + gap;
  return safeBottom + keyboard + gap;
}

/**
 * A drag in the sheet puts the keyboard away so Review comes into view:
 * interactively on iOS, on drag on Android. Nothing on web.
 */
export function keyboardDismissProps(platform: string = Platform.OS): { keyboardDismissMode?: 'interactive' | 'on-drag' } {
  if (platform === 'ios') return { keyboardDismissMode: 'interactive' };
  if (platform === 'android') return { keyboardDismissMode: 'on-drag' };
  return {};
}

export const SHEET_DISMISS_PROPS = keyboardDismissProps();

/** The frame around a form's ScrollView: keyboard-aware on Android, a plain View elsewhere. */
export const KeyboardInsetView: ComponentType<ViewProps> =
  Platform.OS === 'android' ? AndroidKeyboardInsetView : View;
