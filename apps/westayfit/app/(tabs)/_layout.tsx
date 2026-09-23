import { Tabs, useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { useState } from 'react';
import { View } from 'react-native';

import { useWsfAuth } from '../../src/auth';
import { getFirebaseAuth } from '../../src/firebase';
import { wsfTheme } from '../../src/theme';
import { MemberTabBar } from '../../src/ui/MemberTabBar';
import {
  MemberShellActionsProvider,
  useMemberShellActions,
} from '../../src/ui/memberShellActions';
import { MemberTopBar, type MemberMenuItem } from '../../src/ui/MemberTopBar';

/**
 * THE MEMBER SHELL: one persistent top bar, four real tabs, and MOVE as an
 * action rather than a destination.
 *
 * `(tabs)` IS IN PARENTHESES, AND THAT IS THE LOAD-BEARING DETAIL. A route
 * group contributes nothing to the URL, so the files in this directory serve
 * `/`, `/community`, `/community/<id>`, `/activity` and `/you` — the addresses
 * members and links already use, unchanged to the character. Adopting a real
 * tab navigator therefore needed no redirect, no rewrite change and no
 * deep-link migration.
 *
 * THE TOP BAR IS OUTSIDE THE NAVIGATOR, ON PURPOSE. It is rendered here, above
 * `<Tabs>`, so it is mounted once for all four tabs: switching tabs cannot
 * change it, remount it, or move it by a pixel, and no route can give itself a
 * different one. Before this, each route drew its own, which is exactly why
 * Home, Community and Progress carried a navy 22px wordmark, You carried a
 * white 17px one inside a full-bleed navy card, and MOVE carried none.
 *
 * `backBehavior="history"` IS THE BACK-PATH FIX, and it is the router's own
 * documented setting rather than a hand-rolled history mutation. Without it a
 * cross-tab navigation — Community list to the Home-owned community detail —
 * REPLACED the browser history entry instead of pushing one, so Back left the
 * app entirely. All five navigation methods were measured at +0 before and +1
 * after; all six `backBehavior` modes were driven, and every mode that gives a
 * real back destination also makes tab switches cost history entries while
 * every mode that keeps them cheap leaves Back exiting the app. `history` is
 * the smallest documented cost that works. The trade — three tab switches now
 * add two entries where they added one — was measured, reported and accepted.
 */
export default function MemberTabsLayout() {
  /*
    THE SHELL'S ACTION REGISTRY WRAPS THE SHELL, NOT THE OTHER WAY AROUND.

    The bar reads what the focused screen has registered, so the provider has
    to sit ABOVE the component that renders the bar — a component cannot
    consume a context it provides. `ownerUid` empties the registry when the
    account changes, so one person's Champion action can never be offered to
    the next person to sign in on the same device.
  */
  const { user } = useWsfAuth();
  return (
    <MemberShellActionsProvider ownerUid={user?.uid ?? null}>
      <MemberShell />
    </MemberShellActionsProvider>
  );
}

function MemberShell() {
  const router = useRouter();
  /**
   * NO ACCOUNT, NO CHROME.
   *
   * The shell is how a member moves between their own destinations, and there
   * is nothing to move between until there is an account — the signed-out home
   * is a marketing surface, not a tab. The bar used to take `signedIn` and
   * return null; now that it belongs to the navigator it would otherwise
   * render on `/` for a signed-out visitor, which is exactly what
   * `ui-app-shell.spec.ts` caught on the first run of this migration.
   */
  const { user } = useWsfAuth();
  const signedIn = Boolean(user);
  const [menuOpen, setMenuOpen] = useState(false);
  /*
    WHAT THE SCREEN THE MEMBER IS ON HAS ASKED FOR. Today that is exactly one
    thing — a Champion's Manage community, relocated out of Community Home's
    own chrome row — and it is offered ABOVE the utilities, because it belongs
    to the page in front of them while Settings, Build details and Sign out
    belong to the app.
  */
  const routeActions = useMemberShellActions();
  const [signingOut, setSigningOut] = useState(false);

  /**
   * THE MENU HOLDS THE QUIET GLOBAL UTILITIES, AND NOTHING THAT DOES NOT WORK.
   *
   * Sign out used to sit at the bottom of Home AND inside the navy card on
   * You; Build details sat only at the bottom of Home, where a member on
   * another tab could not reach it. Gathering them here is the point of the
   * affordance.
   *
   * No notification bell and no avatar: neither is backed by anything, and a
   * bell with no notification system behind it is a control that lies.
   * No "Switch community" either — there is no real switch to invoke, and a
   * row promising one would be an invention.
   */
  const menu: MemberMenuItem[] = [
    ...routeActions.map(
      (action): MemberMenuItem => ({
        kind: 'action',
        key: action.key,
        label: action.label,
        onPress: action.onPress,
      }),
    ),
    {
      kind: 'link',
      key: 'settings',
      label: 'Settings',
      href: '/settings',
      onNavigate: (href) => router.push(href as never),
    },
    {
      kind: 'link',
      key: 'build',
      label: 'Build details',
      href: '/health',
      onNavigate: (href) => router.push(href as never),
    },
    {
      kind: 'action',
      key: 'signout',
      label: signingOut ? 'Signing out…' : 'Sign out',
      onPress: () => {
        if (signingOut) return;
        setSigningOut(true);
        void signOut(getFirebaseAuth()).finally(() => setSigningOut(false));
      },
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: wsfTheme.colors.background }}>
      {signedIn ? (
        <MemberTopBar
          menu={menu}
          menuOpen={menuOpen}
          onMenuToggle={setMenuOpen}
          onHome={() => router.navigate('/')}
        />
      ) : null}
      <View style={{ flex: 1 }}>
        <Tabs
          backBehavior="history"
          screenOptions={{
            headerShown: false,
            sceneStyle: { backgroundColor: wsfTheme.colors.background },
            // KEEP EVERY VISITED TAB MOUNTED. This is what makes "switching
            // away and back does not throw your page out" true. Named rather
            // than inherited, so a later edit has to argue with a line.
            freezeOnBlur: false,
          }}
          tabBar={(props) =>
            signedIn ? <MemberTabBar {...props} onMove={() => router.push('/move')} /> : null
          }
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
