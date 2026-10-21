// INT-01: first in this file, so the global error handler is wrapped while
// the route tree loads, before any timer, event or promise callback runs.
// (expo-router evaluates some nested _layout files before this one, in the
// same synchronous pass: src/crashContainment.native.ts.)
import '../src/crashContainment';
import { Stack, useNavigation } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { BackHandler, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { WsfAuthProvider } from '../src/auth';
import { getFirebaseApp } from '../src/firebase';
import { InAppBrowserBanner } from '../src/InAppBrowserBanner';
import { useKioskLaunchGuard } from '../src/kioskLaunchGuard';
import { statusBarStyleFor } from '../src/ui/statusBarPolicy';
import { fireAsyncCrashFaults, injectedRenderFault } from '../src/crashHarness';
import { wsfTheme } from '../src/theme';
import { coldBackHandler } from '../src/ui/coldBack';
import { isMoveSheetRoute, isOverMemberTabs } from '../src/ui/moveSheetRoute';
import { nativeErrorBoundary } from '../src/ui/RouteErrorFallback';
import { useReducedMotion } from '../src/ui/useReducedMotion';

/**
 * INT-01. THE LAST-RESORT BOUNDARY. A throw anywhere in the shell that no
 * route boundary below catches (the banners, the providers, the stack
 * itself) renders this in place of the whole layout. It needs no provider:
 * the safe-area and auth providers it would sit under are what just failed.
 * Native only; web keeps its own behaviour (src/ui/RouteErrorFallback.tsx).
 */
export const ErrorBoundary = nativeErrorBoundary('root');

export default function RootLayout() {
  const navigation = useNavigation();
  useEffect(() => {
    getFirebaseApp();
    // A test build's injected timer / rejection faults (src/crashHarness.ts).
    fireAsyncCrashFaults();
    // INT-28 (W12-14): Android Back from a lone cold-link route goes Home
    // (src/ui/coldBack.ts). Registered here, once. expo-router's navigation
    // container registers its own Back listener a commit EARLIER (it renders
    // nothing until the initial URL and the safe-area insets have arrived),
    // and Android calls the newest listener first, so this one is called
    // BEFORE React Navigation's Back. That is safe: it consumes the press only
    // when the root stack is one lone allowlisted route, which React
    // Navigation cannot pop; with anything under it, it passes and React
    // Navigation goes back. A screen's own handler registered through
    // expo-router's useFocusEffect (INT-19 on the contribution screen)
    // registers later still, so it runs first.
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', coldBackHandler(navigation as never));
    return () => sub.remove();
  }, []);

  return (
    /* The shell's bottom bar reads the real safe-area inset rather than
       guessing at a phone's home indicator, so the provider is above it. */
    <SafeAreaProvider>
      <WsfAuthProvider>
        {/* INT-09: the default for cream screens. A navy screen sets light
            icons while it is focused (src/ui/useScreenTopInset ScreenStatusBar;
            the policy is src/ui/statusBarPolicy.ts). Nothing on web. */}
        <StatusBar style={statusBarStyleFor('cream')} />
        <KioskLaunchGuard />
        <AppShell />
      </WsfAuthProvider>
    </SafeAreaProvider>
  );
}

/**
 * THE SHELL'S OUTER STACK.
 *
 * WHAT CHANGED, AND WHY IT IS STRUCTURAL. This layout used to render banners,
 * a flat `Stack`, and `MemberTabBar` beneath it — chrome painted over whatever
 * screen happened to be showing. The member shell is a real tab navigator now,
 * and it is ONE SCREEN in this stack (`(tabs)`), with the focused flows
 * presented ABOVE it.
 *
 * That ordering is the whole of the MOVE finding. Because the tabs are a
 * single screen here and MOVE is presented above them, the bottom bar cannot
 * render underneath the MOVE page — not by configuration, but because the bar
 * belongs to a screen that is no longer on top. Before this, `/move` was
 * listed in `SHELL_EXACT`, so the bar was explicitly drawn over the resolver
 * and the raised MOVE control sat beneath the MOVE page.
 *
 * `transparentModal` FOR THE RESOLVER, AND WHY IT IS NOT A SCREENSHOT. A
 * transparent modal does not unmount the screen it covers: the tab the member
 * pressed MOVE from is still mounted, still holding its scroll position and
 * loaded state, and genuinely visible behind the sheet. Closing it returns to
 * that exact screen rather than re-entering it. Nothing is faked and no
 * background image is captured.
 *
 * `contentStyle: { backgroundColor: 'transparent' }` ON THAT SCREEN IS NOT
 * OPTIONAL. The default ground below gives every screen an opaque cream
 * surface, which is right for a page and fatal for a sheet: with it, the
 * "context underneath" is cream behind a scrim — a flat grey rectangle — and a
 * test that only checks the covered screen is still ATTACHED passes anyway.
 * That is exactly how the prototype's first capture of this frame came out
 * wrong.
 *
 * THE MEMBER BAR IS NO LONGER RENDERED HERE. It belongs to the tab navigator,
 * so every route outside `(tabs)` — the focused flows, the event surfaces, the
 * kiosk, the identity screens — is barless because of where it sits in the
 * tree, not because a predicate said so.
 */
/**
 * ST-05 (W12-1, ESC-2). A phone the OS killed mid kiosk session relaunches to
 * that kiosk's start screen, not member Home signed in as the visitor. The
 * guard runs here, once, inside the auth provider, in a component of its own
 * that draws nothing (#641 RV10-641-1): its pathname and auth subscriptions
 * re-render only this, never the root Stack below. While it decides, the
 * member tabs hold back (app/(tabs)/_layout.tsx, useKioskLaunchHolding); the
 * Stack itself stays mounted, because the replace needs it. Nothing on web.
 */
function KioskLaunchGuard() {
  useKioskLaunchGuard();
  return null;
}

function AppShell() {
  // Asked once, here, because both presented screens below answer to it.
  const reduced = useReducedMotion();
  // A test build's root-shell fault (src/crashHarness.ts); inert otherwise.
  injectedRenderFault('root-shell');
  return (
    <View style={{ flex: 1, backgroundColor: wsfTheme.colors.background }}>
      <InAppBrowserBanner />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: wsfTheme.colors.background },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="move/index"
            options={{
              presentation: 'transparentModal',
              contentStyle: { backgroundColor: 'transparent' },
              // MO-02. Presented without the stack's travel: its slide moved
              // the whole screen, the scrim with it as one dark block. The
              // sheet moves itself instead (src/ui/sheetMotionNative.tsx): the
              // scrim fades in place, the panel rises 28 pt over 240 ms and
              // leaves in 180 ms, and a member who asked for reduced motion
              // gets none of the travel. The web ignores this option and plays
              // the same motion in CSS (src/ui/sheetMotion.ts).
              animation: 'none',
            }}
          />
          {/*
            APP-FEEL-PARITY-1. MOVE'S CONTRIBUTION STEPS ARE THE SAME SHEET.

            With one open goal the resolver above replaces itself with that
            goal's flow, and a chooser row opens it too. That flow used to be
            an ordinary opaque page, so the moment MOVE found the goal the tab
            behind went `display: none` and the member was on a new page --
            the owner's "MOVE feels like a new page" (Director #365
            `5834082617` §A.1). The sheet was only the resolver's second of
            working.

            So the flow is presented the way the resolver is -- a transparent
            modal over the tab, which stays mounted and painted -- exactly
            when it is MOVE's flow over the member's tabs: move mode, not a
            kiosk, with the tabs or the MOVE sheet directly beneath. Anything
            else keeps the page it has always been: "Already moved?" from
            Home, Goal Setup's receipt, an event screen's hand-off, the kiosk,
            and a cold or deep link with nothing beneath it. The screen asks
            the same question (`isMoveSheetRoute`) and draws a sheet or a page
            to match.
          */}
          <Stack.Screen
            name="contribute/[goalId]"
            options={({ route, navigation }) =>
              isMoveSheetRoute(route, navigation.getState())
                ? {
                    presentation: 'transparentModal',
                    contentStyle: { backgroundColor: 'transparent' },
                    // 3b (MO-02): no stack travel; the sheet fades and rises
                    // itself on iOS and Android (SheetScrim/SheetPanel in the
                    // route), and reduced motion gets none. The web ignores
                    // this and plays its CSS (src/ui/sheetMotion.ts).
                    animation: 'none',
                  }
                : {}
            }
          />
          {/*
            APP-FEEL-PARITY-1 CHECKPOINT 3. SETTINGS COMES IN FROM THE SIDE.

            The owner: "Settings should enter from the side" (Director #365
            `5834082617`). It was pushed as an ordinary opaque page. Opened
            over the member's tabs -- from the top bar's menu or You's row --
            it is now presented like the reference's utility panels: a
            transparent modal, so the tab stays mounted and dimmed behind a
            panel from the right (app/settings.tsx draws it). A cold or deep
            link keeps the page.
          */}
          <Stack.Screen
            name="settings"
            options={({ route, navigation }) =>
              isOverMemberTabs(route, navigation.getState())
                ? {
                    presentation: 'transparentModal',
                    contentStyle: { backgroundColor: 'transparent' },
                    animation: reduced ? 'none' : 'slide_from_right',
                  }
                : {}
            }
          />
        </Stack>
    </View>
  );
}
