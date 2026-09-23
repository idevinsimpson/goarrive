import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CARD_BORDER, CREAM, HAIRLINE, INK_QUIET, NAVY, TEXT_MUTED } from './kit';
import { MEMBER_TOP_BAR_BODY } from './memberShellMetrics';
import { WsfWordmark } from './WsfWordmark';

/**
 * THE PERSISTENT MEMBER TOP BAR.
 *
 * ONE BAR, RENDERED ONCE, ABOVE THE TAB NAVIGATOR. That placement is the whole
 * point and is not an implementation detail: because the bar lives in the
 * layout that CONTAINS the tabs rather than inside each tab, switching tabs
 * cannot change it, cannot remount it, and cannot move it by a pixel. The
 * current build gives each route its own header, which is exactly why Home,
 * Community, Progress and You each have a different one.
 *
 * WHAT IS IN IT, AND WHAT IS DELIBERATELY NOT.
 *
 * The wordmark, left, from the owner's artwork via the shipping `WsfWordmark`
 * component at one height on every tab. It is not redrawn here and its
 * colourway does not change per route: navy on cream, always. The current
 * build renders it navy at 22 on three tabs, white at 17 inside a full-bleed
 * navy identity card on You, and not at all on MOVE.
 *
 * A menu, right. One affordance, holding the quiet global utilities that are
 * currently scattered: Sign out sits at the bottom of Home AND inside the navy
 * card on You; Build details sits only at the bottom of Home, where a member
 * on another tab cannot reach it.
 *
 * NO NOTIFICATION BELL AND NO AVATAR. Neither is backed by anything. A bell
 * with no notification system behind it is a control that lies, and an avatar
 * implies a photo the product does not collect and has said it will not.
 *
 * NO PAGE TITLE. The route's title belongs below the bar, in content, at the
 * same first-content spacing on every tab — see `ShellNextPage`. A title
 * inside the bar would make the bar's content route-dependent again, which is
 * the thing being fixed.
 */
export type MemberMenuItem =
  | { kind: 'action'; key: string; label: string; onPress: () => void }
  | { kind: 'link'; key: string; label: string; href: string; onNavigate: (href: string) => void }
  /**
   * AN INTEGRATION SLOT IS NOT A DEAD CONTROL. It is rendered, so the menu's
   * shape is reviewable now, and it is explicitly not pressable, so nobody can
   * tap a promise. It names the lane that owns the destination, which is how a
   * reviewer can tell a placeholder from an oversight.
   */
  | { kind: 'slot'; key: string; label: string; awaiting: string };

export function MemberTopBar({
  onHome,
  menu,
  menuOpen,
  onMenuToggle,
}: {
  onHome: () => void;
  menu: MemberMenuItem[];
  menuOpen: boolean;
  onMenuToggle: (next: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      // `zIndex` so the open menu sheet lies over the page body rather than
      // being clipped behind the tab navigator's own surface.
      style={[styles.wrap, { paddingTop: insets.top, zIndex: 20 }]}
      testID="wsf-member-topbar"
    >
      <View
        style={styles.bar}
        accessibilityRole={Platform.OS === 'web' ? ('navigation' as 'none') : undefined}
        accessibilityLabel="We Stay Fit"
      >
        {/* The wordmark goes Home, on every tab, exactly as it already does on
            Community, Progress and You today — and, unlike today, on Home too,
            where it is currently a bare image. On Home it is a no-op by
            design: you are already there, and a control that reloads the page
            you are on is the defect this packet exists to remove. */}
        <Pressable
          onPress={onHome}
          style={styles.wordmarkTap}
          accessibilityRole="link"
          accessibilityLabel="We Stay Fit, go Home"
          testID="wsf-member-topbar-wordmark-home"
        >
          <WsfWordmark variant="navy" height={22} testID="wsf-member-topbar-wordmark" />
        </Pressable>

        <Pressable
          onPress={() => onMenuToggle(!menuOpen)}
          style={styles.menuTap}
          accessibilityRole="button"
          accessibilityLabel={menuOpen ? 'Close menu' : 'Menu'}
          accessibilityState={{ expanded: menuOpen }}
          testID="wsf-member-topbar-menu-button"
        >
          {/* Three rules, drawn rather than typed, so the glyph does not depend
              on a font shipping a hamburger and does not resize with text
              zoom in a way that breaks the bar's fixed height. */}
          <View style={styles.burger}>
            <View style={styles.burgerRule} />
            <View style={styles.burgerRule} />
            <View style={styles.burgerRule} />
          </View>
        </Pressable>
      </View>

      {menuOpen ? (
        <View style={styles.sheet} testID="wsf-member-topbar-menu">
          {menu.map((item) => {
            if (item.kind === 'slot') {
              return (
                <View key={item.key} style={styles.slotRow} testID={`wsf-member-topbar-menu-slot-${item.key}`}>
                  <Text style={styles.slotLabel}>{item.label}</Text>
                  <Text style={styles.slotNote}>{item.awaiting}</Text>
                </View>
              );
            }
            const onPress = item.kind === 'link' ? () => item.onNavigate(item.href) : item.onPress;
            return (
              <Pressable
                key={item.key}
                onPress={() => {
                  onMenuToggle(false);
                  onPress();
                }}
                style={styles.menuRow}
                accessibilityRole={item.kind === 'link' ? 'link' : 'button'}
                accessibilityLabel={item.label}
                testID={`wsf-member-topbar-menu-${item.key}`}
              >
                <Text style={styles.menuLabel}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: CREAM },
  bar: {
    height: MEMBER_TOP_BAR_BODY,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  // 44 is the minimum target; the bar is 52, so both controls are centred in
  // it with 4 to spare and the bar's height does not depend on either.
  wordmarkTap: { minHeight: 44, justifyContent: 'center', paddingRight: 8 },
  menuTap: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  burger: { width: 20, gap: 4 },
  burgerRule: { height: 2, borderRadius: 1, backgroundColor: NAVY },
  sheet: {
    position: 'absolute',
    top: MEMBER_TOP_BAR_BODY,
    right: 8,
    minWidth: 208,
    backgroundColor: CREAM,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 14,
    paddingVertical: 4,
    // A quiet lift, so the sheet reads as sitting over the page rather than
    // being part of it. Not `elevation.hero` — this is a utility menu.
    shadowColor: '#0B1F35',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  menuRow: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14 },
  menuLabel: { color: NAVY, fontSize: 15, fontWeight: '600' },
  slotRow: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 6, gap: 1 },
  slotLabel: { color: TEXT_MUTED, fontSize: 15, fontWeight: '600' },
  slotNote: { color: INK_QUIET, fontSize: 11.5, lineHeight: 15 },
});
