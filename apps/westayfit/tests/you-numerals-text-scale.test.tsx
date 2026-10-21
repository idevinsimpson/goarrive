import { act, forwardRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 W16-4 (MF-17). You's two large numerals, the shared
 * position (24 pt) and your exact part (34 pt), broke across lines or clipped
 * a digit at the largest system text sizes. Both now spread the one numeral
 * policy (src/ui/textScale, W12-8): capped, one line, shrinking to fit.
 *
 * The policy module is swapped for a sentinel (values no other module uses)
 * to prove the view spreads the module's props rather than its own, for the
 * real native twin, and for the real web twin, whose empty props leave the
 * DOM as it was. Text is wrapped to read the props it is given. No device.
 */

const SENTINEL = Object.freeze({ maxFontSizeMultiplier: 1.17, numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.42 });
const mode: { policy: 'sentinel' | 'native' | 'web' } = { policy: 'web' };
vi.mock('../src/ui/textScale', async () => {
  const web = await vi.importActual<typeof import('../src/ui/textScale')>('../src/ui/textScale');
  const native = await import('../src/ui/textScale.native');
  return {
    ...web,
    get numeralTextProps() {
      return mode.policy === 'sentinel' ? SENTINEL : mode.policy === 'native' ? native.numeralTextProps : web.numeralTextProps;
    },
  };
});
const textByContent = new Map<string, Record<string, unknown>>();
vi.mock('react-native', async (importOriginal) => {
  const rn = await importOriginal<typeof import('react-native')>();
  const Text = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
    if (typeof props.children === 'string') textByContent.set(props.children, props);
    const Real = rn.Text as unknown as (p: Record<string, unknown>) => ReactNode;
    return <Real ref={ref} {...props} />;
  });
  return { ...rn, Text };
});
vi.mock('../src/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));

const { knownShared } = await import('../src/goalTruth');
const { YouParityView } = await import('../src/ui/YouParityView');
type YouState = import('../src/youParity').YouState;
type YouGoal = import('../src/youParity').YouGoal;

const LEAD: YouGoal = { goalId: 'lead', title: '5,000 squats together', unit: 'squats', target: 5000, communityName: 'Oak Grove Together', yourPart: 1250, shared: knownShared(2410), open: true, periodLabel: 'This week' };
const STATE: YouState = {
  kind: 'member',
  profile: { displayName: 'Alex M.', memberSince: 'September 2026' },
  community: { displayName: 'Oak Grove Together', role: 'member', memberCount: 23 },
  open: [LEAD],
  finished: [],
  partial: false,
  eligible: true,
};
const SHARED = '2,410 ';
const OWN = '1,250 ';
const POLICY_KEYS = ['maxFontSizeMultiplier', 'numberOfLines', 'adjustsFontSizeToFit', 'minimumFontScale'] as const;
const policyOf = (p: Record<string, unknown> | undefined) => Object.fromEntries(POLICY_KEYS.map((k) => [k, p?.[k]]));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  textByContent.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  mode.policy = 'web';
});
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
function render(policy: typeof mode.policy): void {
  mode.policy = policy;
  const actions = { onSettings: vi.fn(), onSignOut: vi.fn(), onSignIn: vi.fn(), onCommunity: vi.fn(), onRetry: vi.fn(), onStartMoving: vi.fn() };
  act(() => root.render(<YouParityView state={STATE} email="alex@example.com" signingOut={false} actions={actions} />));
  expect(textByContent.get(SHARED)).toBeDefined();
  expect(textByContent.get(OWN)).toBeDefined();
}

describe('W16-4 / MF-17: You numerals spread the one numeral policy', () => {
  it("both numerals carry the policy module's own props (a sentinel), and no other text does", () => {
    render('sentinel');
    expect(policyOf(textByContent.get(SHARED))).toEqual(SENTINEL);
    expect(policyOf(textByContent.get(OWN))).toEqual(SENTINEL);
    for (const label of ['SHARED POSITION', 'YOUR EXACT CONFIRMED PART', 'squats']) {
      expect(textByContent.get(label)?.minimumFontScale, label).toBeUndefined();
    }
  });

  it('natively: capped at 1.3x, one line, shrinking to fit down to half size', () => {
    render('native');
    const want = { maxFontSizeMultiplier: 1.3, numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.5 };
    expect(policyOf(textByContent.get(SHARED))).toEqual(want);
    expect(policyOf(textByContent.get(OWN))).toEqual(want);
  });

  it('on the web: no policy props at all, so no numberOfLines and no clamp CSS; the figures read as before', () => {
    render('web');
    const none = { maxFontSizeMultiplier: undefined, numberOfLines: undefined, adjustsFontSizeToFit: undefined, minimumFontScale: undefined };
    expect(policyOf(textByContent.get(SHARED))).toEqual(none);
    expect(policyOf(textByContent.get(OWN))).toEqual(none);
    expect(byId('wsf-you-lead-shared')!.textContent).toBe('2,410 / 5,000 confirmed');
    expect(byId('wsf-you-lead-own')!.textContent).toBe('1,250 squats');
    expect(byId('wsf-you-lead-own')!.getAttribute('aria-label')).toBe('1,250 squats');
  });
});
