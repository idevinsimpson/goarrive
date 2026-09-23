import { Stack } from 'expo-router';
import { Text, View } from 'react-native';

import { CREAM, TEXT_MUTED } from '../../../src/ui/kit';
import { shellNextPreviewAllowed } from '../../../src/ui/shellNext/shellNextGate';
import { useReducedMotion } from '../../../src/ui/shellNext/useReducedMotion';

/**
 * THE PROTOTYPE'S OUTER STACK. PROTOTYPE ONLY — no production route is
 * touched by this packet.
 *
 * THIS IS THE SHAPE BEING PROPOSED, IN MINIATURE. The outer container is a
 * Stack; the tab navigator is ONE screen inside it; the MOVE flow is a
 * sibling screen presented OVER that one. That ordering is the whole of the
 * MOVE finding: because the tabs are a single screen in this Stack and the
 * MOVE screen is presented above it, the bottom bar cannot render underneath
 * the MOVE page — not by configuration, but because the bar belongs to a
 * screen that is no longer on top. The shipping build instead lists '/move'
 * in `SHELL_EXACT`, so the bar is explicitly drawn over the MOVE resolver and
 * the raised MOVE control sits beneath the MOVE page.
 *
 * `transparentModal` FOR THE RESOLVER, AND WHY IT IS NOT A SCREENSHOT. A
 * transparent modal does not unmount the screen it covers: the tab the member
 * pressed MOVE from is still mounted, still holding its scroll position and
 * its loaded state, and genuinely visible behind the sheet. Closing it returns
 * to that exact screen rather than re-entering it. Nothing is faked and no
 * background image is captured.
 *
 * THE GATE IS HERE AND NOWHERE ELSE. Every prototype route is a child of this
 * layout, so refusing to render a navigator here makes all of them
 * unreachable in a build without the emulator flag.
 */
export default function ShellNextPrototypeLayout() {
  // Asked once, here, because both presented screens below answer to it.
  const reduced = useReducedMotion();
  if (!shellNextPreviewAllowed()) {
    return (
      <View style={{ flex: 1, backgroundColor: CREAM, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: TEXT_MUTED, fontSize: 14, textAlign: 'center' }}>
          This prototype renders only in an emulator build.
        </Text>
      </View>
    );
  }
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: CREAM } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="move/index"
        options={{
          presentation: 'transparentModal',
          /*
            THE SCENE MUST NOT BE PAINTED. `screenOptions.contentStyle` below
            gives every screen an opaque cream ground, which is right for a
            page and fatal for a sheet: with it, the "context underneath" was
            cream behind the scrim rather than the member's actual tab, and the
            first capture of this frame came out a flat grey rectangle. The
            claim is that the real previous tab stays visible underneath, so
            the sheet's own scene is transparent and the tab paints itself.
          */
          contentStyle: { backgroundColor: 'transparent' },
          // Restrained, native-feeling, and short. A sheet that slides is
          // legible as "this came up over what I was doing"; anything more
          // decorative is motion for its own sake. A member who has asked for
          // reduced motion gets the sheet with none of the travel.
          animation: reduced ? 'none' : 'slide_from_bottom',
        }}
      />
      {/* The player. Already no-tab today, and still no-tab here: it is a
          plain card over everything, with no member chrome of any kind. */}
      <Stack.Screen name="move/player" options={{ animation: reduced ? 'none' : 'slide_from_right' }} />
    </Stack>
  );
}
