import { useContext } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

/**
 * NATIVE-MEMBER-1 W16-9 (MF-09). THE SAFE-AREA EDGES A BOTTOM SHEET CLEARS, ON A
 * PHONE: the nearest SafeAreaProvider's top and bottom. Read through the
 * context, not the throwing hook, so a screen rendered with no provider gets
 * 0 instead of an exception (the integrator's NB-4 pattern).
 */
// Declared here, not imported from './sheetInsets': on a phone that specifier
// resolves to this file itself (NATIVE-TSC-1, tests/native-self-import.test.ts).
export type SheetInsets = { top: number; bottom: number };

export function useSheetInsets(): SheetInsets {
  const insets = useContext(SafeAreaInsetsContext);
  return { top: insets?.top ?? 0, bottom: insets?.bottom ?? 0 };
}
