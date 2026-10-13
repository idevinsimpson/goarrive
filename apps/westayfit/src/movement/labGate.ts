/**
 * THE LAB'S GATE — the same flag every design-target route uses.
 *
 * The movement lab renders only in a build made with
 * EXPO_PUBLIC_WSF_USE_EMULATORS on: the emulator/capture build, which
 * scripts/westayfit/build-staging.sh refuses to ship. A staging or production
 * artifact therefore serves a notice at this route, never the camera.
 *
 * It reads the flag itself rather than importing another lane's gate helper,
 * so this packet touches no file it does not own. The rule is identical to
 * app/design-target/home.tsx and src/ui/shellNext/shellNextGate.ts.
 */
export function movementLabAllowed(raw: string | undefined = process.env.EXPO_PUBLIC_WSF_USE_EMULATORS): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true';
}
