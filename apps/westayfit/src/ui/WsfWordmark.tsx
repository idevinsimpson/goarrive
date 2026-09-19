import { Image, type ImageStyle, type StyleProp } from 'react-native';

import { wordmarkNavyGreen, wordmarkWhiteGreen } from './brandAssets';

/**
 * The full WE STAY FIT wordmark, from the owner-supplied artwork. `variant`
 * picks the colourway for contrast: navy/green on cream and white surfaces,
 * white/green on navy. Height sets the size; width follows the artwork's
 * own proportions so the letterforms are never stretched.
 */
export function WsfWordmark({
  variant = 'navy',
  height = 22,
  style,
  testID,
}: {
  variant?: 'navy' | 'white';
  height?: number;
  style?: StyleProp<ImageStyle>;
  testID?: string;
}) {
  const asset = variant === 'white' ? wordmarkWhiteGreen : wordmarkNavyGreen;
  const width = Math.round((height * asset.width) / asset.height);
  return (
    <Image
      source={asset.source}
      // Shrinks with its row when the screen (or a 200% text zoom) is
      // narrower than the artwork; `contain` keeps the proportions.
      style={[{ width, height, maxWidth: '100%', flexShrink: 1 }, style]}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel="We Stay Fit"
      testID={testID}
    />
  );
}
