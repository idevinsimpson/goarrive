import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Fragment } from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { isKioskFlag } from '../kioskSession';
import { ACTION_GREEN, NAVY, ON_ACTION, PROGRESS_GREEN, TEXT_MUTED, elevation } from './kit';
import { MEMBER_SHELL_GROUND, MEMBER_SHELL_RULE } from './memberShellMetrics';
import { TabGlyph } from './TabGlyph';

/**
 * THE APP SHELL'S BOTTOM NAVIGATION.
 *
 * WHY THIS EXISTS. Every signed-in surface was a page you arrived at and left
 * by going back. There was no persistent chrome, so the product read as a
 * responsive website rather than an app you are inside. This is the chrome:
 * four destinations, present on every member surface, with the current one
 * always obvious.
 *
 * WHERE IT IS DELIBERATELY ABSENT. The event surfaces — the scanned event,
 * the line, the player, a station or kiosk screen, the public display — are
 * single-purpose and often not the member's own device. A tab bar over the
 * player would put four ways to leave under a person's thumb mid-round, and
 * on a station screen it would offer a room's worth of strangers a way into
 * somebody's account. Signed-out and identity surfaces have no shell either:
 * there is nothing to navigate between until there is an account.
 *
 * THE FOUR DESTINATIONS, AND THE ONE ACTION BETWEEN THEM.
 *
 * Home is the community the member is in right now and what it is doing.
 * Community is the people side — who is moving, and the communities they
 * belong to. Progress is their own recorded movement, private to them. You is
 * identity.
 *
 * MOVE IS NOT A DESTINATION AND IS NOT IN THIS LIST. It is the product's one
 * action, raised into the middle of the bar because a member opens this app to
 * move, and everything else is somewhere they go afterwards. It resolves
 * through /move rather than linking anywhere directly: the bar is on every
 * surface and cannot know which goal a member would be moving toward without
 * two authorized reads, and a control in permanent chrome that guesses is a
 * control that lies.
 *
 * PROGRESS KEEPS THE /activity ROUTE. The destination is renamed, not rebuilt;
 * renaming the route as well would be a redirect and a migration for a label.
 */
/**
 * THE FOUR DESTINATIONS, AND THE NAVIGATOR ROUTE EACH ONE IS.
 *
 * `name` is the route inside the `(tabs)` group, not a URL: the navigator
 * decides which tab is focused, so the bar no longer has to infer it from the
 * pathname. `match` and `href` are kept because they are the honest statement
 * of which addresses belong to which destination — Home covers `/` AND
 * `/community/<id>`, because `/` resolves to the member's community and the
 * detail IS Home — and because tests and callers still read them.
 */
export const MEMBER_TABS = [
  { key: 'home', name: '(home)', label: 'Home', href: '/', match: (p: string) => p === '/' || p.startsWith('/community/') },
  { key: 'community', name: 'community', label: 'Community', href: '/community', match: (p: string) => p === '/community' },
  { key: 'activity', name: 'activity', label: 'Progress', href: '/activity', match: (p: string) => p.startsWith('/activity') },
  { key: 'you', name: 'you', label: 'You', href: '/you', match: (p: string) => p.startsWith('/you') },
] as const;

/** Where the raised control in the middle of the bar goes. */
export const MOVE_HREF = '/move';

/**
 * The surfaces the shell belongs on. Everything else is either an event
 * surface, a public screen, or a step on the way to having an account.
 */
const SHELL_PREFIXES = ['/community', '/activity', '/you'];
/**
 * NOTHING IS AN EXACT-MATCH MEMBER SURFACE ANY MORE.
 *
 * `/move` used to be listed here, which is why the bar was drawn over the MOVE
 * resolver and the raised MOVE control rendered BENEATH the MOVE page — a
 * control offering to take a member where they already were. MOVE is a focused
 * flow now, presented over the tab navigator, and `/contribute`, `/goals`,
 * `/start-community` and `/join` left the prefix list for the same reason:
 * they are flows a member is inside, not destinations they navigate between.
 *
 * The list stays rather than being deleted because `shellAppliesTo` is still
 * the shared statement of which addresses are member destinations, and an
 * empty exact-match list is a fact worth reading rather than an absence.
 */
const SHELL_EXACT: string[] = [];

/**
 * A KIOSK SESSION IS NOT A MEMBER SURFACE, WHATEVER ITS PATH.
 *
 * The comment at the top of this file already says a station or kiosk screen
 * must not wear the shell, because there it "would offer a room's worth of
 * strangers a way into somebody's account". The rule did not hold, because it
 * was written against the PATH alone: the kiosk deliberately rides the
 * ordinary contribution route (`/contribute/<goalId>?kiosk=1`) rather than
 * minting a second bracketed one, so what makes it a kiosk is a query
 * parameter this function never saw. `/contribute` is a member prefix, so the
 * bar rendered — and one tap of You or Progress carried the visitor out of the
 * kiosk session to a member page, still signed in, with no Finish and no idle
 * countdown to end the session. Measured on this exact shell.
 *
 * So the route's parameters are an input now. A caller that has none passes
 * none and gets the old behaviour exactly.
 *
 * THE RULE IS NOT COPIED HERE. `isKioskFlag` in src/kioskSession.ts is the one
 * answer, and the contribution screen asks it the same question about the same
 * URL. An earlier revision of this fix normalised the repeated-parameter case
 * in this file alone, which let the shell and the screen disagree within one
 * journey -- no bar because the shell said kiosk, no Finish because the screen
 * said ordinary.
 */
export type ShellRouteParams = { kiosk?: unknown };

/**
 * WHAT THIS PREDICATE IS FOR NOW.
 *
 * The bar is rendered by the tab navigator, so a route outside the `(tabs)`
 * group structurally cannot have one — no predicate decides it any more. That
 * makes this DEFENCE IN DEPTH rather than the only guard, and it is kept
 * deliberately: it is the shared statement of which addresses are member
 * destinations, the kiosk rule it carries was hardened in response to a real
 * measured exposure, and deleting a predicate another lane hardened is not a
 * cleanup. Its tests are unchanged.
 */
export function shellAppliesTo(pathname: string, params?: ShellRouteParams): boolean {
  if (isKioskFlag(params?.kiosk)) return false;
  if (pathname === '/') return true;
  if (SHELL_EXACT.includes(pathname)) return true;
  return SHELL_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * THE BAR IS A react-navigation `tabBar` NOW, NOT A VIEW OVER A FLAT STACK.
 *
 * That is the substantive change, and two of the owner's findings fall
 * directly out of the line it replaces. The bar used to live in the ROOT
 * layout above a flat Stack and move between destinations with
 * `router.replace(tab.href)`:
 *
 *   RELOAD ON RESELECT. `replace` was called unconditionally, including when
 *   the pressed tab was already showing. Replacing a route with itself tears
 *   the screen down and builds it again, so the page reloaded, the scroll
 *   position was lost and every read on that screen ran a second time. The
 *   member tapped the icon for the page they were already looking at and the
 *   app threw the page away.
 *
 *   NOTHING SURVIVED A TAB SWITCH EITHER. A flat Stack holds one screen, so
 *   Home -> Community -> Home unmounted Home, mounted Community, unmounted
 *   Community and mounted a brand-new Home — which is why coming back showed a
 *   skeleton rather than the page the member left.
 *
 * A real tab navigator fixes both at the root: each tab is its own screen,
 * kept mounted once visited, and the handler below simply does not navigate
 * when the pressed tab is already focused.
 *
 * WHAT A SECOND TAP DOES NOT DO. It does not scroll to top and it does not
 * refresh. react-navigation's default `tabPress` pops the focused tab's stack
 * to its root, which is a navigation, so the default is suppressed rather than
 * inherited: the active tab is a NO-OP that preserves scroll and loaded state.
 *
 * MOVE IS NOT ONE OF THE ROUTES IN THIS LIST. It is handed in as `onMove`
 * rather than being a tab screen, which is what makes it structurally
 * incapable of ever rendering a selected state.
 */
export function MemberTabBar({ state, navigation, insets, onMove }: BottomTabBarProps & { onMove: () => void }) {
  const { width } = useWindowDimensions();
  /**
   * AT 200% TEXT ZOOM THE FOUR DESTINATIONS WRAP INSTEAD OF CLIPPING.
   *
   * At ~195px of usable width each tab gets about 48px, and "Community" does
   * not fit in 48px at any weight — it is one word, so it cannot wrap inside
   * its own tab. Below 260px the bar becomes two rows of two: all four
   * destinations stay reachable and nothing runs off the screen.
   */
  const narrow = width < 260;
  return (
    <View
      style={[styles.bar, { paddingBottom: 10 + insets.bottom }, narrow ? styles.barWrapped : null]}
      testID="wsf-member-tabs"
      accessibilityRole={Platform.OS === 'web' ? ('navigation' as 'none') : undefined}
      accessibilityLabel="Main"
    >
      {MEMBER_TABS.map((tab, index) => {
        const routeIndex = state.routes.findIndex((r) => r.name === tab.name);
        const route = state.routes[routeIndex];
        const active = state.index === routeIndex;
        const select = () => {
          /**
           * THE NO-OP, STATED ONCE AND EARLY. Pressing the tab you are on
           * does nothing at all: no navigation, no event emitted, no
           * pop-to-top. Everything below is skipped, so there is no path
           * by which a second tap can reach the router.
           */
          if (active) return;
          const event = navigation.emit({
            type: 'tabPress',
            target: route?.key,
            canPreventDefault: true,
          });
          if (event.defaultPrevented) return;
          /**
           * `navigate`, not `push` and not `replace`. Within a tab
           * navigator `navigate` moves focus to a sibling that is already
           * mounted; it does not stack an entry of its own.
           */
          navigation.navigate(route?.name ?? tab.name);
        };
        return (
          <Fragment key={tab.key}>
          <Pressable
            onPress={select}
            {...enterSelects(select)}
            style={[styles.tab, narrow ? styles.tabHalf : null]}
            testID={`wsf-member-tab-${tab.key}`}
            accessibilityRole="link"
            // The current destination is named as current for a screen
            // reader, not only coloured for a sighted one.
            accessibilityState={{ selected: active }}
            accessibilityLabel={active ? `${tab.label}, current` : tab.label}
            // React Native Web renders `dataSet` as data-* attributes; a bare
            // `data-current` prop is dropped on a Pressable, which is how the
            // first version of this shipped an attribute the tests could not
            // see and a reviewer would have taken on trust.
            dataSet={{ current: active ? 'true' : 'false' }}
          >
            {/*
              ACTIVE IS SAID THREE WAYS: a filled pill behind the glyph, the
              glyph and label in navy rather than muted, and the label at a
              heavier weight. Shape and weight both carry it, so the current
              destination survives greyscale and colour-blindness.
            */}
            <View style={[styles.glyphWrap, active ? styles.glyphWrapActive : null]}>
              <TabGlyph name={tab.key} color={active ? NAVY : TEXT_MUTED} />
            </View>
            <Text style={[styles.label, active ? styles.labelActive : null]}>{tab.label}</Text>
          </Pressable>
          {/*
            The raised control's slot. Without it the circle overlapped the
            destinations either side of the middle, because four tabs spread
            evenly leave a gap narrower than the control.
          */}
          {!narrow && index === 1 ? (
            <View style={styles.moveSlot}>
              <Pressable
                onPress={onMove}
                style={styles.move}
                testID="wsf-member-tab-move"
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

/**
 * ENTER SELECTS A TAB, AS IT FOLLOWS A LINK.
 *
 * Each destination is a link-roled Pressable with no href, and
 * react-native-web leaves Enter on a link to the browser -- which has nothing
 * to follow. Measured on the base: a keyboard member could focus Home,
 * Community, Progress or You and not open any of them, with Enter or Space
 * (WCAG 2.1.1). Enter now does what a press does. Space stays a link's no-op,
 * and the no-op on the current tab is `select`'s own.
 */
type KeyLike = { key?: string; repeat?: boolean; nativeEvent?: { key?: string; repeat?: boolean } };
function enterSelects(select: () => void): Record<string, unknown> {
  return {
    onKeyDown: (e: KeyLike) => {
      const key = e.key ?? e.nativeEvent?.key;
      const repeat = e.repeat ?? e.nativeEvent?.repeat;
      if (key === 'Enter' && !repeat) select();
    },
  };
}

/**
 * WHAT THE BAR ACTUALLY COVERS, so a screen can keep its controls out from
 * under it.
 *
 * The bar is persistent chrome rendered above the screen, so a screen that
 * ends its content at its own padding puts the last control UNDERNEATH it.
 * "The label is still visible" is not the test -- the whole touch target has
 * to be reachable. These are the two numbers that decide it:
 *
 *   BAR_BODY      paddingTop 6 + the tab's 48 minimum + the 10 above the
 *                 safe-area inset the bar adds itself.
 *   MOVE_OVERHANG the raised action's marginTop of -24, which is how far it
 *                 rises ABOVE the bar's top edge and occludes the screen.
 *
 * The caller adds the live safe-area inset; it is not baked in here because
 * it is a property of the device, not of the bar.
 */
export const MEMBER_TAB_BAR_BODY = 6 + 48 + 10;
export const MEMBER_TAB_MOVE_OVERHANG = 24;

const styles = StyleSheet.create({
  /* The frozen reference's bar (Lovable `d4f60624`, measured): 75 tall with
     its rule, on the page's warm white; each glyph centred 33 under the rule
     and each label's cap top 50 under it (Director #506 `5845751705`). */
  bar: {
    position: 'relative',
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: MEMBER_SHELL_RULE,
    backgroundColor: MEMBER_SHELL_GROUND,
    paddingTop: 6,
    paddingHorizontal: 4,
    // The reference's soft lift: the page darkens ~9 levels over the 14 px
    // above the rule.
    shadowColor: '#0B1F35',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -4 },
  },
  barWrapped: { flexWrap: 'wrap' },
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingTop: 14, paddingBottom: 4, minHeight: 48, justifyContent: 'center' },
  // Two rows of two. `flexBasis` rather than `width` so the row still
  // distributes the leftover pixel instead of overflowing by it.
  tabHalf: { flexBasis: '50%', flexGrow: 0, flexShrink: 0 },
  glyphWrap: {
    width: 32,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  glyphWrapActive: { backgroundColor: PROGRESS_GREEN },
  label: { fontSize: 11, lineHeight: 14, color: TEXT_MUTED, fontWeight: '600' },
  labelActive: { color: NAVY, fontWeight: '700' },
  move: {
    // Raised ABOVE the bar's top edge, which is what makes it read as the
    // product's one action rather than a fifth destination.
    marginTop: -24,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: ACTION_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    // The ring is the bar's own ground, so the control reads as sitting in
    // front of the bar rather than punched through it.
    borderWidth: 5,
    borderColor: MEMBER_SHELL_GROUND,
    ...elevation.action,
  },
  moveText: { color: ON_ACTION, fontSize: 11, lineHeight: 14, fontWeight: '900', letterSpacing: 0.5 },
  moveSlot: { width: 72, alignItems: 'center' },
});
