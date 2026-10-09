import { Link, useGlobalSearchParams, useNavigation, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CARD_BORDER, INK_QUIET, NAVY, SURFACE, TEXT_MUTED } from '../../../../../src/ui/kit';
import { ShellNextPage } from '../../../../../src/ui/shellNext/ShellNextPage';
import { recordNav } from '../../../../../src/ui/shellNext/shellNextProbe';

/**
 * Stands for production `/community`. PROTOTYPE ONLY.
 *
 * THE NAVIGATION SPIKE LIVES HERE, because this is where the defect is.
 *
 * Checkpoint 1 measured that opening a community from this list crosses from
 * the Community tab to the Home tab (the detail IS Home — `app/index.tsx`
 * replaces `/` with `/community/<id>`), that react-navigation performs a tab
 * jump, and that on web a tab jump REPLACES the history entry instead of
 * pushing one: `history.length` 2 -> 2, and a browser Back from the detail
 * leaves the app. The Director refused to ship that.
 *
 * "Which navigation produces a real back destination across a tab boundary" is
 * a measurable question, so every available answer is wired up side by side
 * and the spec drives each one in turn, recording the history delta and what
 * Back actually lands on. The winner becomes the list's real control; the
 * whole table is reported, losers included, because "I tried some things" is
 * not evidence and a single passing method proves nothing about the others.
 */
const DETAIL = '/design-target/shell-next/community/detail?groupId=demo-group';

export default function ShellNextCommunity() {
  const router = useRouter();
  const navigation = useNavigation();
  /*
    THE RIG IS AN INSTRUMENT, NOT A PROPOSED SURFACE, so it is behind its own
    parameter and absent from the frames the Director reviews. The first
    revision rendered it unconditionally and it turned up in the Community
    capture, where a reviewer would reasonably have read five debug buttons as
    something being proposed.
  */
  const { spike } = useGlobalSearchParams<{ spike?: string }>();
  const showRig = (Array.isArray(spike) ? spike[0] : spike) === '1';

  return (
    <ShellNextPage id="community" title="Community" lede="Stands in for the real Community list.">
      {/*
        THE REAL CONTROL. It uses whichever method the spike proved, so the
        page a reviewer looks at behaves the way the report claims.
      */}
      <Link
        href={DETAIL}
        push
        style={styles.link}
        testID="wsf-shell-next-community-to-group"
        onPress={() => recordNav('community:open-detail')}
      >
        Open demo-group
      </Link>

      {showRig ? (
      <View style={styles.rig} testID="wsf-shell-next-navrig">
        <Text style={styles.rigTag}>PROTOTYPE INSTRUMENT · NOT A PRODUCT ELEMENT</Text>
        <Text style={styles.rigNote}>
          The same Community-list → detail navigation, by every means the router offers. The spec
          drives each and measures the history delta and what Back lands on.
        </Text>

        {/* 1 — what checkpoint 1 shipped: a plain Link, which defaults to push
            semantics but was measured not to add an entry across tabs. */}
        <Link href={DETAIL} style={styles.method} testID="wsf-shell-next-nav-link-default">
          <Text style={styles.methodText}>1 · Link (default)</Text>
        </Link>

        {/* 2 — Link with `push` forced, so the router is asked for a new entry
            even when the target is already mounted in another tab. */}
        <Link href={DETAIL} push style={styles.method} testID="wsf-shell-next-nav-link-push">
          <Text style={styles.methodText}>2 · Link push</Text>
        </Link>

        <Pressable
          style={styles.method}
          testID="wsf-shell-next-nav-router-push"
          accessibilityRole="button"
          accessibilityLabel="router.push"
          onPress={() => router.push(DETAIL)}
        >
          <Text style={styles.methodText}>3 · router.push</Text>
        </Pressable>

        <Pressable
          style={styles.method}
          testID="wsf-shell-next-nav-router-navigate"
          accessibilityRole="button"
          accessibilityLabel="router.navigate"
          onPress={() => router.navigate(DETAIL)}
        >
          <Text style={styles.methodText}>4 · router.navigate</Text>
        </Pressable>

        {/*
          5 — the navigator's own API rather than the URL layer: ask the PARENT
          (the tab navigator) to move to the Home tab and, within it, to the
          detail screen. If the URL layer is what flattens the entry, this is
          the one that could behave differently.
        */}
        <Pressable
          style={styles.method}
          testID="wsf-shell-next-nav-parent-navigate"
          accessibilityRole="button"
          accessibilityLabel="parent navigate"
          onPress={() => {
            const parent = navigation.getParent();
            (parent as unknown as { navigate: (n: string, p?: object) => void } | undefined)?.navigate(
              '(home)',
              { screen: 'community/detail', params: { groupId: 'demo-group' } },
            );
          }}
        >
          <Text style={styles.methodText}>5 · parent.navigate</Text>
        </Pressable>
      </View>
      ) : null}
    </ShellNextPage>
  );
}

const styles = StyleSheet.create({
  link: { color: NAVY, fontSize: 14, fontWeight: '700', textDecorationLine: 'underline', paddingVertical: 6 },
  rig: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 12,
    padding: 10,
    gap: 6,
  },
  rigTag: { color: INK_QUIET, fontSize: 9.5, fontWeight: '900', letterSpacing: 0.8 },
  rigNote: { color: TEXT_MUTED, fontSize: 11.5, lineHeight: 16 },
  method: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  methodText: { color: NAVY, fontSize: 12.5, fontWeight: '700' },
});
