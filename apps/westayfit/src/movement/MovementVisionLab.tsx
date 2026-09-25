import { useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { CountPanel, LabBanner, LabButton, Row, labStyles } from './LabParts';
import { MovementSession } from './session';

/**
 * THE NATIVE PLACEHOLDER (iOS / Android). Metro serves
 * MovementVisionLab.web.tsx on web; this file is what a native build gets.
 *
 * No native pose adapter exists yet, so this screen says so plainly and
 * offers only the manual count — the same fallback the web lab offers when
 * the camera is refused. NATIVE VERIFIED is not claimed for anything here.
 */
export function MovementVisionLab() {
  const session = useRef<MovementSession | null>(null);
  if (!session.current) {
    session.current = new MovementSession();
    session.current.useManual();
  }
  const [snap, setSnap] = useState(session.current.snapshot);

  return (
    <View style={labStyles.page}>
      <LabBanner />
      <ScrollView contentContainerStyle={labStyles.scroll}>
        <Text style={labStyles.note}>
          Camera counting is browser-only in this proof of concept. A native pose adapter needs a
          development build and has not been built or proven. You can still count by hand.
        </Text>
        <CountPanel snap={snap}>
          <Row>
            <LabButton testID="mv-plus" tone="primary" label="+1 squat" onPress={() => setSnap(session.current!.tap(1))} />
            <LabButton testID="mv-minus" label="−1" onPress={() => setSnap(session.current!.tap(-1))} />
            <LabButton
              testID="mv-reset"
              label="Reset"
              onPress={() => {
                session.current!.reset();
                setSnap(session.current!.useManual());
              }}
            />
          </Row>
        </CountPanel>
      </ScrollView>
    </View>
  );
}
