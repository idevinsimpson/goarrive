import { act, useCallback, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Image, StyleSheet } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * MF-05 (W14-3) — the drawn movement guide on /move/<goalId> and in a queued
 * turn is visible on a phone. FollowAlongCard draws both figures (the pose, and
 * with reduced motion the second pose beside it) through SvgMarkup instead of
 * an <Image> fed an SVG data URI, which React Native renders as an empty box.
 *
 * Vitest does not apply platform extensions, so `./SvgMarkup` is routed here
 * the way Metro resolves it: the native twin (SvgMarkup.native.tsx, drawing
 * with react-native-svg, mocked at its boundary as in svg-markup-native) on
 * iOS and Android, the web twin (today's <Image>) on the web. Every SvgMarkup
 * call is recorded. The real session hook and the real card are rendered.
 */

const ctl = vi.hoisted(() => ({
  os: 'ios' as 'ios' | 'android' | 'web',
  reduced: false,
  calls: [] as Array<Record<string, unknown>>,
}));

vi.mock('react-native-svg', () => ({
  SvgXml: ({ xml, width, height }: { xml: string; width: string; height: string }) => (
    <svg data-testid="svg-xml" data-xml={xml} data-width={width} data-height={height} />
  ),
}));

vi.mock('../src/ui/SvgMarkup', async () => {
  const web = (await vi.importActual('../src/ui/SvgMarkup')) as typeof import('../src/ui/SvgMarkup');
  const native = await import('../src/ui/SvgMarkup.native');
  return {
    SvgMarkup: (props: ComponentProps<typeof web.SvgMarkup>) => {
      ctl.calls.push({ ...props });
      return ctl.os === 'web' ? <web.SvgMarkup {...props} /> : <native.SvgMarkup {...props} />;
    },
  };
});

vi.mock('../src/ui/useReducedMotion', () => ({ useReducedMotion: () => ctl.reduced }));
// The demo-clip slot is not under test (the catalog is empty, so the card never renders it).
vi.mock('../src/ui/MovementDemoMedia', () => ({ MovementDemoMedia: () => null }));

import { useFollowAlongSession } from '../src/followAlongSession';
import { FollowAlongCard } from '../src/ui/FollowAlongCard';
import { moveFigureLabel, moveFigureSvg, moveFigureSvgDataUriRaw, type MovePose } from '../src/ui/moveFigure';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The figure's sizes as they stand in FollowAlongCard.tsx, as literals (the web references below). */
const FIGURE = StyleSheet.create({ light: { width: 200, height: 240 }, venue: { width: 160, height: 192 } });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  ctl.os = 'ios';
  ctl.reduced = false;
  ctl.calls = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function Host({ tone = 'light' }: { tone?: 'light' | 'venue' }) {
  const [roundId, setRoundId] = useState<string | null>(null);
  const onRoundStart = useCallback(() => setRoundId((prev) => prev ?? 'round-1'), []);
  const onRoundReset = useCallback(() => setRoundId(null), []);
  const session = useFollowAlongSession({ unit: 'squats', roundId, onRoundStart, onRoundReset });
  return <FollowAlongCard session={session} testIDPrefix="fa" finishedAction={null} tone={tone} />;
}
const show = (tone: 'light' | 'venue' = 'light') => act(() => root.render(<Host tone={tone} />));
const el = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

/** What the card drew for one figure, by testID. */
function figure(testID: string) {
  const box = el(testID)!;
  const svg = box.querySelector('[data-testid="svg-xml"]') as HTMLElement | null;
  return { box, xml: svg?.getAttribute('data-xml') ?? null };
}
const expected = (pose: MovePose, accent: boolean) => moveFigureSvg({ kind: 'squat', pose, accent });

describe('on iOS and Android the drawn guide is drawn, not an empty <Image>', () => {
  for (const os of ['ios', 'android'] as const) {
    it(`${os}, reduced motion: two figures, each the RAW markup with its label and testID`, () => {
      ctl.os = os;
      ctl.reduced = true;
      show();
      const start = figure('fa-figure-image');
      const end = figure('fa-reduced-motion');
      // Navy on cream for the pose; the second pose takes the other ink (as before).
      expect(start.xml).toBe(expected('start', false));
      expect(end.xml).toBe(expected('end', true));
      expect(start.box.getAttribute('role')).toBe('img');
      expect(start.box.getAttribute('aria-label')).toBe(moveFigureLabel('squat', 'start'));
      expect(end.box.getAttribute('aria-label')).toBe(moveFigureLabel('squat', 'end'));
      // The path that renders blank on a phone is gone from the card.
      expect(container.innerHTML).not.toContain('data:image/svg+xml');
      expect(container.querySelector('img')).toBeNull();
      expect(ctl.calls.map((c) => c.testID)).toEqual(['fa-figure-image', 'fa-reduced-motion']);
    });
  }

  it('without reduced motion: one figure', () => {
    show();
    expect(figure('fa-figure-image').xml).toBe(expected('start', false));
    expect(el('fa-reduced-motion')).toBeNull();
  });

  it('a venue screen: the pose in the brand’s green, the second pose in navy (as before)', () => {
    ctl.reduced = true;
    show('venue');
    expect(figure('fa-figure-image').xml).toBe(expected('start', true));
    expect(figure('fa-reduced-motion').xml).toBe(expected('end', false));
  });
});

describe('the web keeps today’s <Image>', () => {
  for (const tone of ['light', 'venue'] as const) {
    it(`${tone}: each figure is exactly the <Image> it was — same RAW data URI, style, contain, label and testID`, () => {
      ctl.os = 'web';
      ctl.reduced = true;
      show(tone);
      const venue = tone === 'venue';
      const before: Array<{ testID: string; pose: MovePose; accent: boolean }> = [
        { testID: 'fa-figure-image', pose: 'start', accent: venue },
        { testID: 'fa-reduced-motion', pose: 'end', accent: !venue },
      ];
      expect(ctl.calls).toHaveLength(2);
      for (const [i, f] of before.entries()) {
        // The card handed SvgMarkup this figure's RAW markup and label.
        expect(ctl.calls[i]).toMatchObject({
          markup: moveFigureSvg({ kind: 'squat', pose: f.pose, accent: f.accent }),
          accessibilityLabel: moveFigureLabel('squat', f.pose),
          testID: f.testID,
        });
        // Today's element, from literal values (FollowAlongCard.tsx styles.figure
        // and styles.figureVenue), not from the style the card passes (RV11-634-N1).
        const reference = document.createElement('div');
        const refRoot = createRoot(reference);
        act(() =>
          refRoot.render(
            <Image
              source={{ uri: moveFigureSvgDataUriRaw({ kind: 'squat', pose: f.pose, accent: f.accent }) }}
              style={venue ? FIGURE.venue : FIGURE.light}
              resizeMode="contain"
              accessibilityLabel={moveFigureLabel('squat', f.pose)}
              testID={f.testID}
            />,
          ),
        );
        expect(el(f.testID)!.outerHTML).toBe(reference.firstElementChild!.outerHTML);
        act(() => refRoot.unmount());
      }
      expect(container.querySelector('[data-testid="svg-xml"]')).toBeNull();
    });
  }
});
