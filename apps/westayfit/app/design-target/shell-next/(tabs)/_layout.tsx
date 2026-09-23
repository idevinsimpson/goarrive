import { Tabs, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { CREAM } from '../../../../src/ui/kit';
import { ShellNextTabBar } from '../../../../src/ui/shellNext/ShellNextTabBar';
import { ShellNextTopBar, type ShellNextMenuItem } from '../../../../src/ui/shellNext/ShellNextTopBar';
import { recordNav } from '../../../../src/ui/shellNext/shellNextProbe';

/** The prototype's route prefix. Strip it and every URL below is the
 *  production URL it stands for, unchanged. */
const P = '/design-target/shell-next';

/**
 * THE TAB GROUP. PROTOTYPE ONLY.
 *
 * `(tabs)` IS IN PARENTHESES, AND THAT IS THE LOAD-BEARING DETAIL. An Expo
 * Router group segment does not appear in the URL. So the four files in this
 * directory serve:
 *
 *   (tabs)/index.tsx             -> /design-target/shell-next
 *   (tabs)/community/index.tsx   -> /design-target/shell-next/community
 *   (tabs)/community/[groupId]   -> /design-target/shell-next/community/<id>
 *   (tabs)/activity.tsx          -> /design-target/shell-next/activity
 *   (tabs)/you.tsx               -> /design-target/shell-next/you
 *
 * which is, prefix removed, exactly `/`, `/community`, `/community/<id>`,
 * `/activity` and `/you` — today's visible URLs, to the character. Adopting a
 * real tab navigator in production therefore does NOT require a redirect, a
 * URL change or a deep-link migration. The route FILES move into a group
 * directory; the addresses members and links use do not move at all. That
 * claim is the one this prototype exists to make checkable, and the e2e spec
 * asserts each address directly rather than taking it on trust.
 *
 * THE TOP BAR IS OUTSIDE THE NAVIGATOR, ON PURPOSE. It is rendered here,
 * above `<Tabs>`, so it is mounted once for all four tabs. Switching tabs
 * changes what is below it and cannot touch it — no remount, no reflow, and
 * no way for a route to give itself a different header. In the shipping build
 * each route draws its own, which is precisely why Home, Community and
 * Progress carry a navy 22px wordmark, You carries a white 17px one inside a
 * full-bleed navy card, and MOVE carries none.
 */
export default function ShellNextTabsLayout() {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  /**
   * THE MENU'S CONTENTS ARE WHAT ACTUALLY WORKS TODAY, AND NOTHING ELSE.
   *
   * Sign out and Build details are real: both exist in the shipping build, and
   * both are currently reachable only from the bottom of Home — Sign out also
   * from inside the navy card on You. A member on Progress can reach neither.
   * Gathering them here is the point of the affordance.
   *
   * Settings is an INTEGRATION SLOT, not a control. W8 owns the real
   * /settings route; until it lands there is nothing to navigate to, so this
   * renders as a labelled placeholder that cannot be pressed. A greyed row
   * that does nothing when tapped would be a dead control; a row that is
   * plainly not a control is not.
   *
   * Switch community is absent entirely. There is no real multi-community
   * switch to invoke, and the brief is explicit that it appears only when it
   * is real. An empty menu row promising one would be exactly the invention
   * this sprint forbids.
   */
  const menu: ShellNextMenuItem[] = [
    {
      kind: 'slot',
      key: 'settings',
      label: 'Settings',
      awaiting: 'Integration slot — wires to W8’s /settings when that route lands.',
    },
    {
      kind: 'link',
      key: 'build',
      label: 'Build details',
      href: `${P}/you`,
      onNavigate: (href) => {
        recordNav('menu:build-details');
        router.push(href);
      },
    },
    {
      kind: 'action',
      key: 'signout',
      label: 'Sign out',
      onPress: () => {
        // The prototype does not sign anybody out. It records the press so the
        // menu's shape is reviewable without touching the auth session.
        recordNav('menu:sign-out');
      },
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: CREAM }}>
      <ShellNextTopBar
        menu={menu}
        menuOpen={menuOpen}
        onMenuToggle={setMenuOpen}
        onHome={() => {
          recordNav('wordmark:home');
          router.navigate(P);
        }}
      />
      <View style={{ flex: 1 }}>
        <Tabs
          screenOptions={{
            headerShown: false,
            // The navigator's own bar is replaced wholesale; `tabBar` below is
            // the only bar rendered.
            sceneStyle: { backgroundColor: CREAM },
            // KEEP EVERY VISITED TAB MOUNTED. This is the setting that makes
            // "switching away and back does not throw your page out" true.
            // react-navigation defaults to keeping them; naming it here means
            // a later edit has to argue with a line rather than silently
            // inherit a different default.
            freezeOnBlur: false,
          }}
          tabBar={(props) => (
            <ShellNextTabBar
              {...props}
              onMove={() => {
                // `push`, not `navigate`: the MOVE flow is a focused thing
                // that opens OVER the member's context and closes back onto
                // it. That is a stack entry, and it is the one place in this
                // shell where a stack entry is correct.
                router.push(`${P}/move`);
              }}
            />
          )}
        >
          <Tabs.Screen name="(home)" />
          <Tabs.Screen name="community" />
          <Tabs.Screen name="activity" />
          <Tabs.Screen name="you" />
        </Tabs>
      </View>
    </View>
  );
}
