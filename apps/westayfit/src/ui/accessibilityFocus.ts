import { AccessibilityInfo, findNodeHandle, InteractionManager, Platform } from 'react-native';

/**
 * INT-17 (W12-9) — moving the screen reader's focus to a view, on iOS and
 * Android. Imported only by the native twins (focusReturn.native.ts,
 * stepHeadingFocus.native.ts), so the web build never carries it.
 *
 * The focus is moved once the navigation that revealed the view has finished
 * (`InteractionManager.runAfterInteractions`), and on iOS about 400 ms after
 * that, because VoiceOver otherwise lands on the view and is then pulled to
 * the first element of the screen it has just finished presenting. A view no
 * longer mounted by then is skipped. The returned function cancels whatever
 * is still pending, and leaves no timer behind.
 */
export const IOS_FOCUS_DELAY_MS = 400;

export type FocusableRef = { readonly current: unknown };

export function focusAccessibilitySoon(ref: FocusableRef): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const focus = () => {
    timer = null;
    if (cancelled) return;
    const node = ref.current ? findNodeHandle(ref.current as Parameters<typeof findNodeHandle>[0]) : null;
    if (node == null) return;
    AccessibilityInfo.setAccessibilityFocus(node);
  };
  const task = InteractionManager.runAfterInteractions(() => {
    if (cancelled) return;
    if (Platform.OS === 'ios') timer = setTimeout(focus, IOS_FOCUS_DELAY_MS);
    else focus();
  });
  return () => {
    cancelled = true;
    task?.cancel?.();
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
}
