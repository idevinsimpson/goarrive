import React from 'react';
import {
  Image,
  ImageSourcePropType,
  ImageStyle,
  Platform,
  StyleProp,
  StyleSheet,
} from 'react-native';

interface AccessibleImageProps {
  source: ImageSourcePropType;
  webSource: string;
  label: string;
  style: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain';
  eager?: boolean;
}

export function AccessibleImage({
  source,
  webSource,
  label,
  style,
  resizeMode = 'cover',
  eager = false,
}: AccessibleImageProps) {
  if (Platform.OS === 'web') {
    return React.createElement('img', {
      src: webSource,
      alt: label,
      loading: eager ? 'eager' : 'lazy',
      decoding: 'async',
      fetchPriority: eager ? 'high' : 'auto',
      style: {
        ...StyleSheet.flatten(style),
        display: 'block',
        objectFit: resizeMode,
      },
    });
  }

  return (
    <Image
      source={source}
      resizeMode={resizeMode}
      accessibilityRole="image"
      accessibilityLabel={label}
      style={style}
    />
  );
}
