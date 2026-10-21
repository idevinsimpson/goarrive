import type { StyleProp, ViewStyle } from 'react-native';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import type { SvgMarkupProps } from './svgMarkupTypes';

export type { SvgMarkupProps } from './svgMarkupTypes';

/**
 * MF-05 (iOS and Android). React Native's `<Image>` cannot decode an
 * `image/svg+xml` data URI: the invite QR and the drawn movement guide render
 * as an empty box. This draws the same RAW markup with react-native-svg
 * (declared in 5a968141), filling the box the caller's style gives it, so a
 * call site keeps its style, label and testID when it moves here.
 *
 * The wrapper is the one accessible element: a picture with the caller's
 * label, as `<Image accessibilityLabel>` was. The SVG's own `role="img"` and
 * the markup's width and height are superseded by the box (`100%`); its
 * viewBox keeps the drawing's proportions (`xMidYMid meet`, like `contain`).
 */
const CLIP: ViewStyle = { overflow: 'hidden' };

export function SvgMarkup({ markup, style, accessibilityLabel, testID }: SvgMarkupProps) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      // A box style (SvgMarkupStyle has no image-only keys); the drawing never spills past it.
      style={[CLIP, style as StyleProp<ViewStyle>]}
    >
      <SvgXml xml={markup} width="100%" height="100%" />
    </View>
  );
}
