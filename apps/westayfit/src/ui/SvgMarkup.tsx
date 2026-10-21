import { Image } from 'react-native';

import { SVG_DATA_URI_PREFIX } from './qr';
import type { SvgMarkupProps } from './svgMarkupTypes';

export type { SvgMarkupProps } from './svgMarkupTypes';

/**
 * MF-05 (web). Raw SVG markup as a picture, exactly as the call sites render
 * it today: react-native-web's `<Image>` with the RAW data URI (it
 * percent-encodes inline SVG itself; see `qrSvgDataUriRaw`), `contain`, and
 * the caller's style, label and testID.
 *
 * The native twin (`SvgMarkup.native.tsx`) draws the markup with
 * react-native-svg instead, because React Native's `<Image>` cannot decode an
 * SVG data URI and renders nothing. Call sites move here with their own lanes
 * (JoinQrCode: member; FollowAlongCard: motion); this module changes none.
 */
export function SvgMarkup({ markup, style, accessibilityLabel, testID }: SvgMarkupProps) {
  return (
    <Image
      source={{ uri: `${SVG_DATA_URI_PREFIX}${markup}` }}
      style={style}
      resizeMode="contain"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    />
  );
}
