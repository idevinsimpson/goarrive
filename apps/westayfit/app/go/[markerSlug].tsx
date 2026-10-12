import { useLocalSearchParams } from 'expo-router';

import { getFirebaseFunctions } from '../../src/firebase';
import { firebaseMarkerResolver, normalizeMarkerSlug } from '../../src/markerEntry';
import { MarkerEntryScreen } from '../../src/ui/MarkerEntryScreen';

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
