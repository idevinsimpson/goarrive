/**
 * THE MEDIA SLOT'S DEMONSTRATION — native.
 *
 * Native has no video dependency in this app, and adding one is a separate,
 * device-proven piece of work. So on native this is compile-safe and honest:
 * the approved POSTER, still, and the drawn movement guide if the poster
 * cannot load. The web build replaces this file with MovementDemoMedia.web.tsx,
 * which is where the looping clip lives.
 *
 * Like the web version, it takes NO callback from the round. Nothing the media
 * does can reach the clock, the attempt or a contribution.
 */
import { useState, type ReactNode } from 'react';
import { Image, View, type ImageStyle, type StyleProp } from 'react-native';

import type { DemoPlayback } from '../movementDemoMedia';

export type MovementDemoMediaProps = {
  posterUri: string;
  clipUri: string;
  /** What the poster and clip show, for the accessibility label. */
  label: string;
  /** What the round asks of the media. The media never answers back. */
  playback: DemoPlayback;
  reducedMotion: boolean;
  imageStyle: StyleProp<ImageStyle>;
  /** The drawn movement guide, for when nothing else can be shown. */
  fallback: ReactNode;
  testIDPrefix: string;
};

export function MovementDemoMedia(props: MovementDemoMediaProps) {
  const [posterFailed, setPosterFailed] = useState(false);
  const id = (s: string) => `${props.testIDPrefix}-${s}`;
  return (
    <View testID={id('demo')} {...({ dataSet: { 'demo-state': 'static' } } as Record<string, unknown>)}>
      {posterFailed ? (
        props.fallback
      ) : (
        <Image
          source={{ uri: props.posterUri }}
          style={props.imageStyle}
          resizeMode="contain"
          accessibilityLabel={props.label}
          onError={() => setPosterFailed(true)}
          testID={id('poster')}
        />
      )}
    </View>
  );
}
