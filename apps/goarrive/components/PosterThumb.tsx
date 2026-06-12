/**
 * PosterThumb — Static poster image with lazy GIF swap on intersection.
 *
 * Renders the static JPEG poster immediately (fast, no 35 MB parallel GIF load).
 * Once the element is visible (web: IntersectionObserver, native: onLayout),
 * swaps to the animated GIF. Falls back to goarrive-icon.png placeholder on
 * any load error or when neither URL is available.
 *
 * Use in place of every <Image source={{ uri: thumbnailUrl }}> in grids/lists.
 * DO NOT use for the full-screen active media slot — Video takes priority there.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, View } from 'react-native';
import type { StyleProp, ImageStyle, ViewStyle } from 'react-native';

const PLACEHOLDER = require('../assets/goarrive-icon.png');

interface PosterThumbProps {
  posterUrl?: string | null;
  gifUrl?: string | null;
  style?: StyleProp<ImageStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
}

export default function PosterThumb({
  posterUrl,
  gifUrl,
  style,
  containerStyle,
  resizeMode = 'cover',
}: PosterThumbProps) {
  const [gifVisible, setGifVisible] = useState(false);
  const [posterError, setPosterError] = useState(false);
  const [gifError, setGifError] = useState(false);
  const containerRef = useRef<View>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Web: IntersectionObserver fires once the element enters the viewport.
  const attachObserver = useCallback((node: View | null) => {
    if (Platform.OS !== 'web' || !node) return;
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!gifUrl) return;
    const el = (node as any)?.['_nativeTag']
      ? undefined
      : (node as unknown as Element);
    const target = el ?? (node as any)?._ref?.current ?? (node as any);
    if (!target || typeof (window as any).IntersectionObserver === 'undefined') {
      // No observer support — just show GIF immediately
      setGifVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setGifVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: '50px' },
    );
    obs.observe(target as Element);
    observerRef.current = obs;
  }, [gifUrl]);

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  // Native: treat onLayout as "on screen" — simpler than scroll tracking.
  const handleLayout = useCallback(() => {
    if (Platform.OS !== 'web' && gifUrl) setGifVisible(true);
  }, [gifUrl]);

  const showGif = gifVisible && !!gifUrl && !gifError;
  const showPoster = !showGif && !!posterUrl && !posterError;
  const showPlaceholder = !showGif && !showPoster;

  return (
    <View
      ref={Platform.OS === 'web' ? (attachObserver as any) : containerRef}
      style={[{ overflow: 'hidden' }, containerStyle ?? (style as any)]}
      onLayout={handleLayout}
    >
      {showGif ? (
        <Image
          source={{ uri: gifUrl! }}
          style={[{ width: '100%', height: '100%' }, style]}
          resizeMode={resizeMode}
          onError={() => setGifError(true)}
        />
      ) : showPoster ? (
        <Image
          source={{ uri: posterUrl! }}
          style={[{ width: '100%', height: '100%' }, style]}
          resizeMode={resizeMode}
          onError={() => setPosterError(true)}
        />
      ) : (
        <Image
          source={PLACEHOLDER}
          style={[{ width: '100%', height: '100%' }, style]}
          resizeMode={resizeMode}
        />
      )}
    </View>
  );
}
