import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';

import { useWsfAuth, WsfAuthProvider } from '../src/auth';
import { getFirebaseApp } from '../src/firebase';
import { InAppBrowserBanner } from '../src/InAppBrowserBanner';
import { StagingBanner } from '../src/StagingBanner';
import { wsfTheme } from '../src/theme';
import { MemberTabBar } from '../src/ui/MemberTabBar';

export default function RootLayout() {
  useEffect(() => {
    getFirebaseApp();
  }, []);

  return (
    <WsfAuthProvider>
      <StatusBar style="dark" />
      <AppShell />
    </WsfAuthProvider>
  );
}

/**
 * THE SHELL. Banners, the screen, then the persistent navigation — in that
 * order, so the bar is the last thing in the column and sits at the bottom of
 * the viewport rather than floating over the screen's own content. It renders
 * INSIDE the auth provider because it needs to know whether there is an
 * account yet; the provider cannot be below it.
 */
function AppShell() {
  const { user } = useWsfAuth();
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
        />
      </View>
      <MemberTabBar signedIn={Boolean(user)} />
    </View>
  );
}
