import { useLocalSearchParams } from 'expo-router';

import { getFirebaseFunctions } from '../../src/firebase';
import { firebaseMarkerResolver, normalizeMarkerSlug } from '../../src/markerEntry';
import { MarkerEntryScreen } from '../../src/ui/MarkerEntryScreen';
import { nativeErrorBoundary } from '../../src/ui/RouteErrorFallback';

/*
  NATIVE-MEMBER-1 W16-13 (INT-01 CS-4). On a phone a render error here shows
  the contained screen fallback (Try again remounts the route, Go to Home is
  the way out; src/ui/RouteErrorFallback.native.tsx) instead of ending the
  process. The web module returns undefined, so the web gets no boundary and
  nothing changes there.
*/
export const ErrorBoundary = nativeErrorBoundary('screen');

const resolver = firebaseMarkerResolver(getFirebaseFunctions);

/**
 * `/go/<markerSlug>` — the address a reusable printed WE STAY FIT QR carries
 * (EVERGREEN-MARKER-ENTRY-1). The slug is validated here and nowhere becomes a
 * path of its own; the server decides what it opens.
 */
export default function MarkerEntryRoute() {
  const params = useLocalSearchParams<{ markerSlug: string }>();
  const slug = normalizeMarkerSlug(params.markerSlug);
  return <MarkerEntryScreen slug={slug} resolver={resolver} />;
}
