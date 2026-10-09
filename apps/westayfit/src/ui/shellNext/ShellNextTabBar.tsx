import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Fragment } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ACTION_GREEN, CARD_BORDER, CREAM, NAVY, ON_ACTION, PROGRESS_GREEN, TEXT_MUTED, elevation } from '../kit';
import { TabGlyph } from '../TabGlyph';
import { recordNav, recordPress } from './shellNextProbe';

/**
 * THE PROPOSED BOTTOM BAR. PROTOTYPE ONLY.
 *
 * It is a react-navigation `tabBar`, not a view drawn over a Stack, and that
 * is the substantive change. The shipping `MemberTabBar` lives in the ROOT
 * layout above a flat Stack and moves between destinations with
 * `router.replace(tab.href)`. Two of the owner's findings fall directly out of
 * that one line:
 *
 *   RELOAD ON RESELECT. `replace` is called unconditionally, including when
 *   the pressed tab is the one already showing. Replacing a route with itself
 *   tears the screen down and builds it again, so the page reloads, the scroll
 *   position is lost and every read on that screen runs a second time. The
 *   member tapped the icon for the page they were already looking at and the
 *   app threw the page away.
 *
 *   NOTHING SURVIVES A TAB SWITCH EITHER. A flat Stack holds one screen. Going
 *   Home -> Community -> Home unmounts Home, mounts Community, unmounts
 *   Community and mounts a brand-new Home, which is why coming back shows a
 *   skeleton rather than the page the member left.
 *
 * A real tab navigator fixes both at the root: each tab is its own screen,
 * kept mounted once visited, and the press handler below simply does not
 * navigate when the pressed tab is already focused.
 *
 * WHAT THIS BAR DOES *NOT* DO ON A SECOND TAP. It does not scroll to top and
 * it does not refresh. react-navigation's default `tabPress` behaviour pops
 * the focused tab's stack to its root, which is a navigation, so the default
 * is suppressed rather than inherited: the contract for this packet is that
 * the active tab is a NO-OP that preserves scroll position and loaded state.
 *
 * MOVE IS NOT ONE OF THE ROUTES IN THIS LIST. It is an action, raised into the
 * middle, and it is handed in as `onMove` rather than being a tab screen —
 * which is what makes it structurally incapable of ever rendering a selected
 * state. `hideMove` blanks it for the surfaces where the member is already in
 * the MOVE flow.
 */

const TABS: { name: string; key: 'home' | 'community' | 'activity' | 'you'; label: string }[] = [
  // The Home tab is a route GROUP, so its navigator route name is the
  // group's own name. The URL it serves is still bare '/'.
  { name: '(home)', key: 'home', label: 'Home' },
  { name: 'community', key: 'community', label: 'Community' },
  { name: 'activity', key: 'activity', label: 'Progress' },
  { name: 'you', key: 'you', label: 'You' },
];

export function ShellNextTabBar({
  state,
  navigation,
  insets,
  onMove,
}: BottomTabBarProps & { onMove: () => void }) {
  return (
    <View
      style={[styles.bar, { paddingBottom: 10 + insets.bottom }]}
      testID="wsf-shell-next-tabs"
      accessibilityRole={Platform.OS === 'web' ? ('navigation' as 'none') : undefined}
      accessibilityLabel="Main"
    >
      {TABS.map((tab, index) => {
        const routeIndex = state.routes.findIndex((r) => r.name === tab.name);
        const route = state.routes[routeIndex];
        const focused = state.index === routeIndex;
        return (
          <Fragment key={tab.key}>
            <Pressable
              onPress={() => {
                recordPress(tab.key);
                /**
                 * THE NO-OP, STATED ONCE AND EARLY. Pressing the tab you are
                 * on does nothing at all: no navigation, no event emitted, no
                 * pop-to-top. Everything below this line is skipped, so there
                 * is no path by which a second tap can reach the router.
                 */
                if (focused) return;
                /**
                 * `navigate`, not `push` and not `replace`. Within a tab
                 * navigator `navigate` moves focus to a sibling tab that is
                 * already mounted; it does not stack an entry, which is what
                 * keeps the back button pointing at where the member actually
                 * came from rather than at a trail of tab presses.
                 */
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route?.key,
                  canPreventDefault: true,
                });
                if (event.defaultPrevented) return;
                recordNav(tab.name);
                navigation.navigate(route?.name ?? tab.name);
              }}
              style={styles.tab}
              testID={`wsf-shell-next-tab-${tab.key}`}
              accessibilityRole="link"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={focused ? `${tab.label}, current` : tab.label}
              // React Native Web renders `dataSet` as data-* attributes; a
              // bare `data-current` prop is dropped on a Pressable.
              dataSet={{ current: focused ? 'true' : 'false' }}
            >
              {/* Active is said three ways — a filled pill, navy rather than
                  muted, and a heavier label — so it survives greyscale and
                  colour-blindness. Unchanged from the shipping bar on purpose:
                  the selected treatment is not what the owner reported. */}
              <View style={[styles.glyphWrap, focused ? styles.glyphWrapActive : null]}>
                <TabGlyph name={tab.key} color={focused ? NAVY : TEXT_MUTED} />
              </View>
              <Text style={[styles.label, focused ? styles.labelActive : null]}>{tab.label}</Text>
            </Pressable>

            {index === 1 ? (
              <View style={styles.moveSlot}>
                <Pressable
                  onPress={() => {
                    recordPress('move');
                    recordNav('move');
                    onMove();
                  }}
                  style={styles.move}
                  testID="wsf-shell-next-tab-move"
                  accessibilityRole="button"
                  accessibilityLabel="Move: record what you did"
                >
                  <Text style={styles.moveText}>MOVE</Text>
                </Pressable>
              </View>
            ) : null}
          </Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: CARD_BORDER,
    backgroundColor: CREAM,
    paddingTop: 6,
    paddingHorizontal: 4,
  },
  tab: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 6, minHeight: 48, justifyContent: 'center' },
  glyphWrap: {
    width: 46,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  glyphWrapActive: { backgroundColor: PROGRESS_GREEN },
  label: { fontSize: 12, lineHeight: 16, color: TEXT_MUTED, fontWeight: '600' },
  labelActive: { color: NAVY, fontWeight: '700' },
  move: {
    marginTop: -24,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: ACTION_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 5,
    borderColor: CREAM,
    ...elevation.action,
  },
  moveText: { color: ON_ACTION, fontSize: 11, lineHeight: 14, fontWeight: '900', letterSpacing: 0.5 },
  moveSlot: { width: 72, alignItems: 'center' },
});
