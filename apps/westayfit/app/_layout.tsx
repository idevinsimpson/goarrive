import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { WsfAuthProvider } from '../src/auth';
import { getFirebaseApp } from '../src/firebase';
import { InAppBrowserBanner } from '../src/InAppBrowserBanner';
import { StagingBanner } from '../src/StagingBanner';
import { wsfTheme } from '../src/theme';
import { useReducedMotion } from '../src/ui/useReducedMotion';

export default function RootLayout() {
  useEffect(() => {
    getFirebaseApp();
  }, []);

  return (
    /* The shell's bottom bar reads the real safe-area inset rather than
       guessing at a phone's home indicator, so the provider is above it. */
    <SafeAreaProvider>
      <WsfAuthProvider>
        <StatusBar style="dark" />
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
function AppShell() {
  // Asked once, here, because both presented screens below answer to it.
  const reduced = useReducedMotion();
  return (
    <View style={{ flex: 1, backgroundColor: wsfTheme.colors.background }}>
      <StagingBanner />
      <InAppBrowserBanner />
      <View style={{ flex: 1 }}>
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
              // Restrained, native-feeling and short. A sheet that slides is
              // legible as "this came up over what I was doing"; anything more
              // decorative is motion for its own sake. A member who has asked
              // for reduced motion gets the sheet with none of the travel.
              animation: reduced ? 'none' : 'slide_from_bottom',
            }}
          />
        </Stack>
      </View>
    </View>
  );
}
