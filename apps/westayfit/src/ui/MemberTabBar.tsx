import { usePathname, useRouter } from 'expo-router';
import { Fragment } from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ACTION_GREEN, CARD_BORDER, CREAM, NAVY, ON_ACTION, PROGRESS_GREEN, TEXT_MUTED, elevation } from './kit';
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
 * WHO IS HERE BELONGS TO COMMUNITY, NOT TO HOME, even though it lives under a
 * community's path. The split above is by WHAT A DESTINATION IS, not by URL
 * shape: Home is the community a member is in and what it is doing;
 * Community is "the people side — the communities they belong to". A member
 * reaches `/community/<id>/members` from the Community tab, so lighting Home
 * while they are there tells them they are somewhere they are not.
 *
 * Matched on the route's last segment rather than the whole path, because the
 * community id sits in the middle and may be anything.
 */
const IS_MEMBERS_ROUTE = (p: string) => /^\/community\/[^/]+\/members\/?$/.test(p);

export const MEMBER_TABS = [
  {
    key: 'home',
    label: 'Home',
    href: '/',
    match: (p: string) => p === '/' || (p.startsWith('/community/') && !IS_MEMBERS_ROUTE(p)),
  },
  {
    key: 'community',
    label: 'Community',
    href: '/community',
    match: (p: string) => p === '/community' || IS_MEMBERS_ROUTE(p),
  },
  { key: 'activity', label: 'Progress', href: '/activity', match: (p: string) => p.startsWith('/activity') },
  { key: 'you', label: 'You', href: '/you', match: (p: string) => p.startsWith('/you') },
] as const;

/** Where the raised control in the middle of the bar goes. */
export const MOVE_HREF = '/move';

/**
 * The surfaces the shell belongs on. Everything else is either an event
 * surface, a public screen, or a step on the way to having an account.
 */
const SHELL_PREFIXES = ['/community', '/contribute', '/goals', '/activity', '/you', '/start-community', '/join'];
/**
 * `/move` EXACTLY, AND NEVER `/move/<goalId>`.
 *
 * The resolver at /move is a member surface and wears the shell. The player at
 * /move/<goalId> is an event surface and must not: a tab bar over the player
 * puts four ways to leave under a person's thumb in the middle of a round.
 * Adding '/move' to the prefix list would have covered both, which is why it
 * is an exact match instead.
 */
const SHELL_EXACT = ['/move'];
export function shellAppliesTo(pathname: string): boolean {
  if (pathname === '/') return true;
  if (SHELL_EXACT.includes(pathname)) return true;
  return SHELL_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function MemberTabBar({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const { width } = useWindowDimensions();
  // SAFE AREA, FROM THE PLATFORM RATHER THAN A GUESS. The previous version
  // hard-coded 20px of bottom padding for "a modern phone", which is wrong on
  // every device that is not that phone. `react-native-safe-area-context` is
  // already a dependency and reports the real inset (0 in a browser).
  const insets = useSafeAreaInsets();
  /**
   * AT 200% TEXT ZOOM THE FOUR DESTINATIONS WRAP INSTEAD OF CLIPPING.
   *
   * At ~195px of usable width each tab gets about 48px, and "Community" does
   * not fit in 48px at any weight — it is one word, so it cannot wrap inside
   * its own tab. The first version of this bar simply overflowed the right
   * edge, which the 195px accessibility check caught. Below 260px the bar
   * becomes two rows of two: all four destinations stay reachable and nothing
   * runs off the screen.
   */
  const narrow = width < 260;
  if (!signedIn || !shellAppliesTo(pathname)) return null;
  return (
    <View
      style={[styles.bar, { paddingBottom: 10 + insets.bottom }, narrow ? styles.barWrapped : null]}
      testID="wsf-member-tabs"
      accessibilityRole={Platform.OS === 'web' ? ('navigation' as 'none') : undefined}
      accessibilityLabel="Main"
    >
      {MEMBER_TABS.map((tab, index) => {
        const active = tab.match(pathname);
        return (
          <Fragment key={tab.key}>
          <Pressable
            // `replace`, not `push`: a tab bar that stacks history gives the
            // back button a trail of tab presses instead of the way home.
            onPress={() => router.replace(tab.href)}
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
              destination survives greyscale and colour-blindness — the 3px
              rule this replaces carried it in colour alone.
            */}
            <View style={[styles.glyphWrap, active ? styles.glyphWrapActive : null]}>
              <TabGlyph name={tab.key} color={active ? NAVY : TEXT_MUTED} />
            </View>
            <Text style={[styles.label, active ? styles.labelActive : null]}>{tab.label}</Text>
          </Pressable>
          {/*
            The raised control's slot. Without it the circle overlapped the
            destinations either side of the middle, because four tabs spread
            evenly leave a gap narrower than the control. An empty View of the
            control's width holds the space open and keeps the four tabs
            evenly weighted.
          */}
          {!narrow && index === 1 ? (
            <View style={styles.moveSlot}>
              <Pressable
                onPress={() => router.replace(MOVE_HREF)}
                style={styles.move}
                testID="wsf-member-tab-move"
                accessibilityRole="link"
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
  bar: {
    position: 'relative',
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: CARD_BORDER,
    backgroundColor: CREAM,
    paddingTop: 6,
    paddingHorizontal: 4,
  },
  barWrapped: { flexWrap: 'wrap' },
  tab: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 6, minHeight: 48, justifyContent: 'center' },
  // Two rows of two. `flexBasis` rather than `width` so the row still
  // distributes the leftover pixel instead of overflowing by it.
  tabHalf: { flexBasis: '50%', flexGrow: 0, flexShrink: 0 },
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
    borderColor: CREAM,
    ...elevation.action,
  },
  moveText: { color: ON_ACTION, fontSize: 11, lineHeight: 14, fontWeight: '900', letterSpacing: 0.5 },
  moveSlot: { width: 72, alignItems: 'center' },
});
