/**
 * selectDerivative — Choose the best movement preview asset for the context
 *
 * Given a movement's derivative URLs and a display context, returns the
 * optimal URL for that situation. Prioritizes speed for tiny thumbnails
 * and quality for larger views.
 *
 * Display contexts (from smallest to largest):
 *   - 'folder-thumb'  → tiny preview inside a folder icon (24–48px)
 *   - 'grid-card'     → standard movement card in a grid (~120–240px)
 *   - 'detail'        → movement detail view (full width)
 *   - 'player'        → workout player (full screen)
 */

export type DisplayContext = 'folder-thumb' | 'grid-card' | 'detail' | 'player';

export interface MovementDerivatives {
  videoUrl?: string;
  /** High-quality GIF (240×300) — also stored as thumbnailUrl for backwards compat */
  thumbnailUrl?: string;
  /** First-frame JPEG (240×300) */
  thumbnailImageUrl?: string;
  /** Low-quality GIF (120×150) */
  gifLowUrl?: string;
  /** One-rep loop GIF (120×150, single rep) */
  gifLoopUrl?: string;
}

/**
 * Estimate current network quality from the Navigator API.
 * Returns 'slow' for 2G/3G/slow-4G, 'fast' otherwise.
 */
function getNetworkSpeed(): 'fast' | 'slow' {
  try {
    const conn = (navigator as any).connection;
    if (!conn) return 'fast';
    const effectiveType = conn.effectiveType;
    if (effectiveType === '2g' || effectiveType === 'slow-2g' || effectiveType === '3g') {
      return 'slow';
    }
    if (conn.downlink && conn.downlink < 1.5) return 'slow';
    return 'fast';
  } catch {
    return 'fast';
  }
}

/**
 * Select the best derivative URL for a given display context.
 *
 * Priority logic:
 *   - folder-thumb: gifLoopUrl > gifLowUrl > thumbnailImageUrl > thumbnailUrl
 *   - grid-card:    gifLowUrl (slow) or thumbnailUrl (fast) > thumbnailImageUrl
 *   - detail:       thumbnailUrl > videoUrl
 *   - player:       videoUrl > thumbnailUrl
 *
 * @param derivatives  Movement's derivative URLs
 * @param context      Display context
 * @param animated     Whether to prefer animated (GIF) over static (image).
 *                     Defaults to true for folder-thumb and grid-card.
 * @returns Best URL, or empty string if no derivatives available
 */
export function selectDerivative(
  derivatives: MovementDerivatives,
  context: DisplayContext,
  animated?: boolean,
): string {
  const speed = getNetworkSpeed();
  const wantAnimated = animated ?? (context === 'folder-thumb' || context === 'grid-card');

  switch (context) {
    case 'folder-thumb': {
      // Smallest possible animated preview
      if (wantAnimated) {
        return (
          derivatives.gifLoopUrl ||
          derivatives.gifLowUrl ||
          derivatives.thumbnailUrl ||
          derivatives.thumbnailImageUrl ||
          ''
        );
      }
      return derivatives.thumbnailImageUrl || derivatives.thumbnailUrl || '';
    }

    case 'grid-card': {
      if (!wantAnimated) {
        return derivatives.thumbnailImageUrl || derivatives.thumbnailUrl || '';
      }
      if (speed === 'slow') {
        return (
          derivatives.gifLowUrl ||
          derivatives.gifLoopUrl ||
          derivatives.thumbnailImageUrl ||
          derivatives.thumbnailUrl ||
          ''
        );
      }
      // Fast network — use high-quality GIF
      return (
        derivatives.thumbnailUrl ||
        derivatives.gifLowUrl ||
        derivatives.thumbnailImageUrl ||
        ''
      );
    }

    case 'detail':
      return derivatives.thumbnailUrl || derivatives.videoUrl || '';

    case 'player':
      return derivatives.videoUrl || derivatives.thumbnailUrl || '';

    default:
      return derivatives.thumbnailUrl || derivatives.thumbnailImageUrl || '';
  }
}
