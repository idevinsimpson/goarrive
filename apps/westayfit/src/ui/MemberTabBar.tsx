import { usePathname, useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CARD_BORDER, CREAM, NAVY, PROGRESS_GREEN, TEXT_MUTED } from './kit';
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
 * THE FOUR. Home is the community the member is in right now and what it is
 * doing. Activity is their own recorded movement. Community is the people
 * side — who is moving, and the communities they belong to. You is identity.
 */
export const MEMBER_TABS = [
  { key: 'home', label: 'Home', href: '/', match: (p: string) => p === '/' || p.startsWith('/community/') },
  { key: 'activity', label: 'Activity', href: '/activity', match: (p: string) => p.startsWith('/activity') },
  { key: 'community', label: 'Community', href: '/community', match: (p: string) => p === '/community' },
  { key: 'you', label: 'You', href: '/you', match: (p: string) => p.startsWith('/you') },
] as const;

/**
 * The surfaces the shell belongs on. Everything else is either an event
 * surface, a public screen, or a step on the way to having an account.
 */
const SHELL_PREFIXES = ['/community', '/contribute', '/goals', '/activity', '/you', '/start-community', '/join'];
export function shellAppliesTo(pathname: string): boolean {
  if (pathname === '/') return true;
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
      {MEMBER_TABS.map((tab) => {
        const active = tab.match(pathname);
        return (
          <Pressable
            key={tab.key}
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
              {/* Active sits on the green pill, so it stays navy. Inactive sits
                  on the navy ground, where TEXT_MUTED was all but invisible. */}
              <TabGlyph name={tab.key} color={active ? NAVY : '#8FA3BF'} />
            </View>
            <Text style={[styles.label, active ? styles.labelActive : null]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    // PAGE 1. The member surfaces have a navy ground now, and a cream bar
    // under them read as a different application bolted to the bottom of the
    // screen. The bar takes the deepest navy, so it sits UNDER the page
    // rather than beside it, and the active tab keeps the green pill that
    // already carried the state.
    borderTopColor: 'rgba(255,255,255,0.09)',
    backgroundColor: '#050F1E',
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
  label: { fontSize: 12, lineHeight: 16, color: '#8FA3BF', fontWeight: '600' },
  labelActive: { color: '#FFFFFF', fontWeight: '700' },
});
