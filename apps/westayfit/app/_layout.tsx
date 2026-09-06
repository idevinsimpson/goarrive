import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';

import { WsfAuthProvider } from '../src/auth';
import { getFirebaseApp } from '../src/firebase';
import { InAppBrowserBanner } from '../src/InAppBrowserBanner';
import { wsfTheme } from '../src/theme';

export default function RootLayout() {
  useEffect(() => {
    getFirebaseApp();
  }, []);

  return (
    <WsfAuthProvider>
      <StatusBar style="dark" />
      <View style={{ flex: 1, backgroundColor: wsfTheme.colors.background }}>
        <InAppBrowserBanner />
        <View style={{ flex: 1 }}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: wsfTheme.colors.background },
            }}
          />
        </View>
      </View>
    </WsfAuthProvider>
  );
}
