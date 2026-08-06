import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  LayoutChangeEvent,
  Platform,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { COACH_DISCOVERY_SCENES } from '../../data/coachDiscoveryScenes';
import { DiscoverySceneContent } from './DiscoveryScenes';
import { PresentationControls } from './PresentationControls';
import { ProgressIndicator } from './ProgressIndicator';
import { Scene } from './Scene';
import { trackCoachDiscoveryEvent } from './analytics';
import { discoveryColors } from './tokens';
import { useReducedMotion } from './useReducedMotion';

const TOTAL_SCENES = COACH_DISCOVERY_SCENES.length;

export default function DiscoveryExperience() {
  const params = useLocalSearchParams<{ present?: string | string[] }>();
  const router = useRouter();
  const presentationMode = Array.isArray(params.present) ? params.present[0] === '1' : params.present === '1';
  const reducedMotion = useReducedMotion();
  const scrollY = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<any>(null);
  const activeSceneRef = useRef(1);
  const sceneOffsets = useRef<Record<number, number>>({});
  const trackedMilestones = useRef(new Set<string>());
  const [activeScene, setActiveScene] = useState(1);
  const [viewport, setViewport] = useState({ width: 390, height: 844 });
  const isMobile = viewport.width < 760;
  const currentMeta = COACH_DISCOVERY_SCENES[activeScene - 1] ?? COACH_DISCOVERY_SCENES[0];

  useEffect(() => {
    trackCoachDiscoveryEvent('experience_opened', { presentationMode });
  }, [presentationMode]);

  useEffect(() => {
    const depthKey = `depth-${activeScene}`;
    if (!trackedMilestones.current.has(depthKey)) {
      trackedMilestones.current.add(depthKey);
      trackCoachDiscoveryEvent('scene_depth_reached', {
        scene: activeScene,
        percent: Math.round((activeScene / TOTAL_SCENES) * 100),
      });
    }

    const milestone =
      activeScene === 5
        ? 'platform_section_viewed'
        : activeScene === 19
          ? 'compensation_section_viewed'
          : activeScene === 25
            ? 'final_question_reached'
            : null;
    if (milestone && !trackedMilestones.current.has(milestone)) {
      trackedMilestones.current.add(milestone);
      trackCoachDiscoveryEvent(milestone);
    }
  }, [activeScene]);

  const onRootLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewport({ width, height: Math.max(620, height) });
  }, []);

  const onSceneLayout = useCallback((number: number, y: number) => {
    sceneOffsets.current[number] = y;
  }, []);

  const updateActiveScene = useCallback((offsetY: number) => {
    const focusY = offsetY + viewport.height * 0.46;
    let nextScene = 1;
    for (let scene = 1; scene <= TOTAL_SCENES; scene += 1) {
      const y = sceneOffsets.current[scene];
      if (typeof y === 'number' && y <= focusY) nextScene = scene;
    }
    if (nextScene !== activeSceneRef.current) {
      activeSceneRef.current = nextScene;
      setActiveScene(nextScene);
    }
  }, [viewport.height]);

  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: false,
        listener: (event: any) => updateActiveScene(event.nativeEvent.contentOffset.y),
      }),
    [scrollY, updateActiveScene],
  );

  const scrollToScene = useCallback((number: number) => {
    const safeNumber = Math.max(1, Math.min(TOTAL_SCENES, number));
    if (Platform.OS === 'web') {
      const element = globalThis.document?.getElementById(`coach-discovery-scene-${safeNumber}`);
      if (element) {
        element.scrollIntoView({
          behavior: reducedMotion ? 'auto' : 'smooth',
          block: 'start',
        });
        activeSceneRef.current = safeNumber;
        setActiveScene(safeNumber);
        return;
      }
    }

    const y = sceneOffsets.current[safeNumber];
    if (typeof y === 'number') {
      scrollRef.current?.scrollTo({ y, animated: !reducedMotion });
      activeSceneRef.current = safeNumber;
      setActiveScene(safeNumber);
    }
  }, [reducedMotion]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !presentationMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (['ArrowDown', 'ArrowRight', 'PageDown', ' '].includes(event.key)) {
        event.preventDefault();
        scrollToScene(activeSceneRef.current + 1);
      } else if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(event.key)) {
        event.preventDefault();
        scrollToScene(activeSceneRef.current - 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        scrollToScene(1);
      } else if (event.key === 'End') {
        event.preventDefault();
        scrollToScene(TOTAL_SCENES);
      }
    };
    globalThis.document?.addEventListener('keydown', onKeyDown);
    return () => globalThis.document?.removeEventListener('keydown', onKeyDown);
  }, [presentationMode, scrollToScene]);

  const handleShare = useCallback(async () => {
    const url = Platform.OS === 'web' && globalThis.location
      ? `${globalThis.location.origin}/coach-discovery`
      : 'https://goarrive.fit/coach-discovery';
    try {
      if (Platform.OS === 'web') {
        const nav = globalThis.navigator as any;
        if (typeof nav.share === 'function') {
          await nav.share({ title: 'GoArrive Coach Discovery', url });
          return;
        }
        if (nav.clipboard?.writeText) {
          await nav.clipboard.writeText(url);
          Alert.alert('Link copied', 'The coach discovery link is ready to share.');
          return;
        }
      }
      await Share.share({ title: 'GoArrive Coach Discovery', message: url, url });
    } catch {
      // Dismissed shares are intentionally silent.
    }
  }, []);

  const handleNextStep = useCallback(() => {
    trackCoachDiscoveryEvent('next_step_cta_selected');
    router.push('/coach-apply');
  }, [router]);

  return (
    <View
      {...({ role: 'main' } as any)}
      nativeID="coach-discovery-root"
      onLayout={onRootLayout}
      style={styles.root}
    >
      <WebExperienceStyles />
      <Animated.ScrollView
        {...(Platform.OS === 'web'
          ? ({ tabIndex: 0, role: 'region', 'aria-label': 'GoArrive coach discovery story' } as any)
          : {})}
        ref={scrollRef}
        nativeID="coach-discovery-scroll"
        style={[
          styles.scroll,
          presentationMode && Platform.OS === 'web' && ({ scrollSnapType: 'y proximity' } as any),
        ]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        decelerationRate={presentationMode ? 'fast' : 'normal'}
        onScroll={onScroll}
      >
        {COACH_DISCOVERY_SCENES.map((meta) => (
          <Scene
            key={meta.id}
            meta={meta}
            scrollY={scrollY}
            viewportHeight={viewport.height}
            reducedMotion={reducedMotion}
            presentationMode={presentationMode}
            onSceneLayout={onSceneLayout}
            minHeightMultiplier={sceneHeightMultiplier(meta.number, isMobile)}
          >
            <DiscoverySceneContent meta={meta} isMobile={isMobile} onNextStep={handleNextStep} />
          </Scene>
        ))}
      </Animated.ScrollView>

      <ProgressIndicator current={activeScene} total={TOTAL_SCENES} scene={currentMeta} isMobile={isMobile} />
      <PresentationControls
        presentationMode={presentationMode}
        isMobile={isMobile}
        onBackToTop={() => scrollToScene(1)}
        onShare={handleShare}
      />
    </View>
  );
}

function sceneHeightMultiplier(scene: number, isMobile: boolean) {
  if (scene === 9) return isMobile ? 3.7 : 1.55;
  if (scene === 17) return isMobile ? 1.8 : 1.45;
  if ([15, 18, 20, 21, 24].includes(scene)) return isMobile ? 1.45 : 1.15;
  if ([10, 11, 14, 19].includes(scene)) return isMobile ? 1.25 : 1.05;
  return 1;
}

function WebExperienceStyles() {
  if (Platform.OS !== 'web') return null;
  return React.createElement('style', {
    dangerouslySetInnerHTML: {
      __html: `
        @font-face {
          font-family: 'Space Grotesk';
          src: url('/fonts/space-grotesk-latin-500-700.woff2') format('woff2');
          font-style: normal;
          font-weight: 500 700;
          font-display: swap;
        }
        @font-face {
          font-family: 'DM Sans';
          src: url('/fonts/dm-sans-latin-400-700.woff2') format('woff2');
          font-style: normal;
          font-weight: 400 700;
          font-display: swap;
        }
        html, body { background: #080B12; overscroll-behavior-y: none; }
        #coach-discovery-root, #coach-discovery-scroll { height: 100dvh; background: #080B12; }
        #coach-discovery-scroll { scrollbar-width: none; }
        #coach-discovery-scroll::-webkit-scrollbar { display: none; }
        #coach-discovery-scroll:focus-visible { outline: 2px solid #5B9BD5; outline-offset: -4px; }
        @media (prefers-reduced-motion: reduce) {
          #coach-discovery-scroll { scroll-behavior: auto !important; }
        }
        @media print {
          html, body, #coach-discovery-root, #coach-discovery-scroll { height: auto !important; overflow: visible !important; background: #080B12 !important; }
          [id^="coach-discovery-scene-"] { min-height: 844px !important; break-after: page; page-break-after: always; }
          button { display: none !important; }
          @page { size: 390px 844px; margin: 0; }
        }
      `,
    },
  });
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: discoveryColors.background,
  },
  scroll: {
    flex: 1,
    backgroundColor: discoveryColors.background,
  },
  scrollContent: {
    backgroundColor: discoveryColors.background,
  },
});
