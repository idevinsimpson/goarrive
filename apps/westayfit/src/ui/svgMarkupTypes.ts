import type { ImageStyle, StyleProp } from 'react-native';

/**
 * MF-05. What `SvgMarkup` takes on every platform: RAW SVG markup (never a
 * data URI, never percent-encoded) and the props today's `<Image>` call sites
 * already pass. Its own module so the native twin can share the type without
 * importing its own base specifier (NATIVE-TSC-1).
 */
export type SvgMarkupProps = {
  /** The SVG document as markup, exactly as `renderQrSvg` / `moveFigureSvg` return it. */
  markup: string;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
  testID?: string;
};
