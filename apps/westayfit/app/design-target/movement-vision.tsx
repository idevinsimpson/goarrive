import { Text, View } from 'react-native';

import { movementLabAllowed } from '../../src/movement/labGate';
import { MovementVisionLab } from '../../src/movement/MovementVisionLab';

/**
 * MOVEMENT-VISION-1 — A DEV-ONLY CAMERA TEST INSTRUMENT. NOT A MEMBER SURFACE.
 *
 * Hidden: not linked from the shell, the tab bar or any screen, and gated on
 * EXPO_PUBLIC_WSF_USE_EMULATORS (see src/movement/labGate.ts), so a staging or
 * production build serves the notice below and never opens a camera.
 *
 * Nothing here writes to Firebase. The count lives in memory on this screen.
 */
export default function MovementVisionRoute() {
  if (!movementLabAllowed()) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <Text style={{ fontSize: 16, lineHeight: 22 }}>
          The movement lab is not part of this build.
        </Text>
      </View>
    );
  }
  return <MovementVisionLab />;
}
