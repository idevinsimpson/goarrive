import type { ComponentType } from 'react';

import type { BoundaryProps, FallbackVariant } from './routeErrorTypes';

/**
 * NATIVE-INTEGRATOR-1 (INT-01). THE WEB BUILD ADDS NO ROUTE BOUNDARY.
 *
 * iOS and Android get src/ui/RouteErrorFallback.native.tsx. Here every route's
 * `ErrorBoundary` export is undefined, so expo-router wraps nothing and a web
 * crash behaves exactly as it always has: react-native-web unmounts to a blank
 * page and a reload recovers (INT-01, "Web").
 */
export type { BoundaryProps, FallbackVariant };

export function nativeErrorBoundary(_variant: FallbackVariant): ComponentType<BoundaryProps> | undefined {
  return undefined;
}
