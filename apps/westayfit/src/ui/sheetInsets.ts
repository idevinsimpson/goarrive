/**
 * NATIVE-MEMBER-1 W16-9 (MF-09). THE SAFE-AREA EDGES A BOTTOM SHEET CLEARS, ON WEB.
 *
 * The browser owns the edges, so a web sheet clears nothing: always 0, and
 * react-native-safe-area-context never ships in (or loads for) the web build.
 * iOS and Android get src/ui/sheetInsets.native.ts. Same convention as
 * src/ui/useScreenTopInset.ts and src/ui/keyboardAvoidance.tsx.
 */
export type SheetInsets = { top: number; bottom: number };

const NONE: SheetInsets = { top: 0, bottom: 0 };

export function useSheetInsets(): SheetInsets {
  return NONE;
}
