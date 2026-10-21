import type { ReactElement, ReactNode } from 'react';
import { View } from 'react-native';

/**
 * NATIVE-INTEGRATOR-1 (INT-10). THE FRAME AROUND THE ROOT STACK, ON WEB.
 *
 * Exactly the plain View the stack always sat in, and no per-screen layout:
 * on web the staging strip is the page's first row under the browser's own
 * chrome and stays visible over every presented screen, so nothing here
 * changes. iOS and Android get src/stagingShell.native.tsx.
 */
export function StagingStackFrame({ children }: { children: ReactNode }) {
  return <View style={{ flex: 1 }}>{children}</View>;
}

type ScreenLayout = (props: { options?: { presentation?: string }; children: ReactElement }) => ReactElement;

export const stagingScreenLayout: ScreenLayout | undefined = undefined;
