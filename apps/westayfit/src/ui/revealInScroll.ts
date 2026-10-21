import type { ScrollView, View } from 'react-native';

/**
 * NATIVE-MEMBER-1 W16-8 (MF-12). BRING AN ANCHOR TO THE TOP OF ITS SCROLL VIEW.
 *
 * `measureLayout` needs the scroll content's HOST INSTANCE. React Native's
 * node-handle getter (getInnerViewNode) returns a number, which the new
 * architecture (Fabric) cannot measure against: the call fails silently and
 * the form never scrolls to its first error. `getInnerViewRef()` returns the
 * host instance on both architectures, and on the web react-native-web
 * returns the same element from both, so the web is unchanged.
 */
/**
 * React Native 0.81 has `getInnerViewRef` at runtime (ScrollView.js) and in
 * its Flow types, but not in its `.d.ts`; this is the shape relied on.
 */
export type ScrollWithInnerViewRef = {
  getInnerViewRef?: () => unknown;
  scrollTo: ScrollView['scrollTo'];
};

export function revealInScroll(
  scroll: ScrollWithInnerViewRef,
  anchor: Pick<View, 'measureLayout'>,
  offset = 12,
): void {
  const content = scroll.getInnerViewRef?.();
  if (!content) return;
  anchor.measureLayout(
    content as never,
    (_x, y) => scroll.scrollTo({ y: Math.max(0, y - offset), animated: true }),
    () => {},
  );
}
