/**
 * THE SAME GATE THE OTHER design-target ROUTES ALREADY USE.
 *
 * The prototype renders only in a build that carries
 * EXPO_PUBLIC_WSF_USE_EMULATORS, which is the emulator/capture build and never
 * staging or production. Written once here rather than copied into each of the
 * prototype's route files, because a gate that exists in eight copies is a
 * gate that will one day be seven.
 */
export function shellNextPreviewAllowed(): boolean {
  const raw = process.env.EXPO_PUBLIC_WSF_USE_EMULATORS;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true';
}
