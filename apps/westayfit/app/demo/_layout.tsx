import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { DemoBanner } from '../../src/DemoBanner';
import { initDemoState } from '../../src/demoState';
import { wsfTheme } from '../../src/theme';

// Nested layout for the /demo group. The persistent banner sits above the
// screen stack so it is visible on every demo route without being repeated in
// each screen's markup.
export default function DemoLayout() {
  useEffect(() => {
    initDemoState();
  }, []);

  return (
    <View style={styles.root}>
      <DemoBanner />
      <View style={styles.stackContainer}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: wsfTheme.colors.background },
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: wsfTheme.colors.background,
  },
  stackContainer: {
    flex: 1,
  },
});
