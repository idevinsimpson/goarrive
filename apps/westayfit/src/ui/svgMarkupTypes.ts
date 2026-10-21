import type { ImageStyle, StyleProp } from 'react-native';

/**
 * The box the picture fills: an image style without the keys only an
 * <Image> understands (RV10-641-3). On a phone the markup is drawn in a View,
 * which would silently drop them, so they are not offered at all.
 */
export type SvgMarkupStyle = Omit<ImageStyle, 'tintColor' | 'resizeMode' | 'objectFit' | 'overlayColor'>;

/**
 * MF-05. What `SvgMarkup` takes on every platform: RAW SVG markup (never a
 * data URI, never percent-encoded) and the props today's `<Image>` call sites
 * already pass. Its own module so the native twin can share the type without
 * importing its own base specifier (NATIVE-TSC-1).
 */
export type SvgMarkupProps = {
  /** The SVG document as markup, exactly as `renderQrSvg` / `moveFigureSvg` return it. */
  markup: string;
  style?: StyleProp<SvgMarkupStyle>;
  accessibilityLabel?: string;
  testID?: string;
};
