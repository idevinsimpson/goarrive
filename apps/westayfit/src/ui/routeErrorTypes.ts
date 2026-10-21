/** NATIVE-INTEGRATOR-1 (INT-01). Shared by RouteErrorFallback.native.tsx and its web stub. */
export type FallbackVariant = 'root' | 'shell' | 'homeTab' | 'tab' | 'screen' | 'contribute';

/** What expo-router passes a route's `ErrorBoundary` export (its views/Try.js). */
export type BoundaryProps = { error: Error; retry: () => Promise<void> };
