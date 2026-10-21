import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { act, forwardRef, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Dimensions, Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 W16-18 (MF-08 criteria 2 and 3).
 *
 * Criterion 3: on a phone, "Open station screen" and "Open combined screen"
 * (Community Home's Manage sheet) turn THIS phone into the venue screen. A
 * screen reader now says so: a label naming the goal and the phone, and the
 * hint "Turns this phone into the venue screen". The visible label, the
 * route and the web are unchanged.
 *
 * Criterion 2: a Champion who opens the station, combined or display screen
 * is still signed in to the same account afterwards. Those routes never sign
 * anybody out: a static scan holds them to it (no signOut from firebase/auth,
 * no kioskSignOutGuard, no signOutReset, and no signOut call).
 *
 * The route is rendered whole (react-native-web, jsdom) as the community's
 * founding Champion, with the sheet opened through the shell action it
 * registers; ButtonLink records the props it is given. No device.
 */

const APP_ROOT = join(__dirname, '..');

// The props each ButtonLink is given, by testID.
const linkProps = new Map<string, Record<string, unknown>>();
vi.mock('../src/ui/ButtonLink', () => ({
  ButtonLink: (props: Record<string, unknown>) => {
    linkProps.set(props.testID as string, props);
    return (
      <a href={props.href as string} data-testid={props.testID as string}>
        {props.label as string}
      </a>
    );
  },
}));
// The props each Pressable is given, by testID (for the ButtonLink unit below).
const pressProps = new Map<string, Record<string, unknown>>();
vi.mock('react-native', async (importOriginal) => {
  const rn = await importOriginal<typeof import('react-native')>();
  const Pressable = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
    if (typeof props.testID === 'string') pressProps.set(props.testID, props);
    const Real = rn.Pressable as unknown as (p: Record<string, unknown>) => ReactNode;
    return <Real ref={ref} {...props} />;
  });
  return { ...rn, Pressable };
});
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), navigate: vi.fn() };
vi.mock('expo-router', () => ({
  Link: ({ children }: { href: string; children: ReactNode }) => children,
  useLocalSearchParams: () => ({ groupId: 'oak' }),
  useRouter: () => router,
  router,
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(() => cb(), [cb]);
  },
}));
vi.mock('react-native-safe-area-context', async () => {
  const { createContext } = await import('react');
  return {
    SafeAreaInsetsContext: createContext(null),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
vi.mock('../src/ui/LivingWeProgress', () => ({ LivingWeProgress: () => null }));
vi.mock('../src/ui/useReducedMotion', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useReducedMotion: () => true,
  useReducedMotionPreference: () => ({ reduced: true, known: true, failed: false }),
}));
const shell: { action: null | { onPress: () => void } } = { action: null };
vi.mock('../src/ui/memberShellActions', () => ({
  useMemberShellAction: (action: null | { onPress: () => void }) => {
    shell.action = action;
  },
}));
const getDoc = vi.fn();
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => `${col}/${id}`,
  getDoc: (path: string) => getDoc(path),
}));
const internal = () => Promise.reject(Object.assign(new Error('internal'), { code: 'functions/internal' }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => () => (name === 'wsfCreateCombinedGoal' ? Promise.resolve({ data: { setupId: 'cs1' } }) : internal()),
}));
vi.mock('../src/firebase', () => ({ getFirebaseFirestore: () => ({}), getFirebaseFunctions: () => ({}) }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
const AUTH = { ready: true, user: { uid: 'u1', email: 'champ@example.com', displayName: 'Champ' } };
vi.mock('../src/auth', () => ({ useWsfAuth: () => AUTH }));
vi.mock('../src/currentCommunity', () => ({ rememberCurrentCommunity: vi.fn(), resolveCurrentCommunity: () => null }));
const DAY = 86_400_000;
const NOW = Date.now();
const goalOf = (goalId: string, title: string, unit: string) => ({
  goalId,
  title,
  target: 5000,
  unit,
  status: 'active',
  startsAt: new Date(NOW - DAY).toISOString(),
  endsAt: new Date(NOW + 20 * DAY).toISOString(),
  aggregateDisplayAuthorized: false,
  reachedAt: null,
});
const GOALS = [goalOf('g1', 'Autumn squats', 'squats'), goalOf('g2', 'Winter lunges', 'lunges')];
vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  forgetCommunity: vi.fn(),
  peekMyCommunities: () => undefined,
  readGoals: () => Promise.resolve({ goals: GOALS }),
  readMyCommunities: () =>
    Promise.resolve({ items: [{ groupId: 'oak', displayName: 'Oak Grove Together', memberCount: 3, isSample: false, activeChallenge: null }] }),
  readOwnCredit: () => Promise.reject(new Error('offline')),
}));

const { default: CommunityPage } = await import('../app/(tabs)/(home)/community/[groupId]/index');

const snap = (data: Record<string, unknown> | null) => ({ exists: () => data !== null, data: () => data ?? undefined });
const CHAMPION = snap({ role: 'foundingChampion', membershipStatus: 'active', userId: 'u1' });
const GROUP = snap({ displayName: 'Oak Grove Together', groupType: 'custom', joinPolicy: 'private', joinCode: 'k'.repeat(22), isSample: false });
const HINT = 'Turns this phone into the venue screen';

const OS = Platform.OS;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  getDoc.mockReset();
  getDoc.mockImplementation(async (path: string) => (path.startsWith('wsfMemberships/') ? CHAMPION : GROUP));
  shell.action = null;
  linkProps.clear();
  pressProps.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(Dimensions, 'get').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  (Platform as { OS: string }).OS = OS;
  vi.restoreAllMocks();
});

/** The sheet is a Modal: react-native-web portals it to document.body. */
const byId = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await act(async () => undefined);
};
async function openSheet(platform: string): Promise<void> {
  (Platform as { OS: string }).OS = platform;
  act(() => root.render(<CommunityPage />));
  await settle();
  expect(shell.action, 'the Champion registers Manage community').not.toBeNull();
  act(() => shell.action!.onPress());
  await settle();
  expect(byId('wsf-community-manage-panel')).not.toBeNull();
}
function type(id: string, value: string): void {
  const el = byId(id) as HTMLInputElement;
  expect(el, `${id} is on screen`).not.toBeNull();
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function click(id: string): Promise<void> {
  const el = byId(id);
  expect(el, `${id} is on screen`).not.toBeNull();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
}
/** A local "YYYY-MM-DDTHH:mm", the shape both DateTimeField forms take. */
function local(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** Starts a combined goal from the sheet; the Open combined screen action appears. */
async function startCombined(): Promise<void> {
  await click('wsf-kiosk-mode-combined');
  type('wsf-combined-title', 'Autumn together');
  type('wsf-combined-unit', 'movements');
  type('wsf-combined-target', '400');
  // The combined period holds both activities' own periods (each must lie inside it).
  type('wsf-combined-start', local(NOW - 2 * DAY));
  type('wsf-combined-end', local(NOW + 30 * DAY));
  await settle();
  await click('wsf-combined-pick-g1');
  await click('wsf-combined-pick-g2');
  await click('wsf-combined-submit');
  expect(byId('wsf-combined-created'), 'the combined goal is ready').not.toBeNull();
}

describe('W16-18 / MF-08 criterion 3: the venue-screen actions say what they do, on a phone', () => {
  it.each(['ios', 'android'])('%s: Open station screen carries the label and hint; its visible label and route are unchanged', async (platform) => {
    await openSheet(platform);
    for (const goal of GOALS) {
      const props = linkProps.get(`wsf-kiosk-stations-open-${goal.goalId}`);
      expect(props, `the station action for ${goal.goalId}`).toBeDefined();
      expect(props!.label).toBe('Open station screen');
      expect(props!.href).toBe(`/station/${goal.goalId}`);
      expect(props!.accessibilityLabel).toBe(`${goal.title}: open the station screen on this phone`);
      expect(props!.accessibilityHint).toBe(HINT);
    }
  });

  it.each(['ios', 'android'])('%s: Open combined screen carries the label and hint; its visible label and route are unchanged', async (platform) => {
    await openSheet(platform);
    await startCombined();
    const props = linkProps.get('wsf-combined-open');
    expect(props, 'the combined action').toBeDefined();
    expect(props!.label).toBe('Open combined screen');
    expect(props!.href).toBe('/combined/cs1');
    expect(props!.accessibilityLabel).toBe('Autumn together: open the combined screen on this phone');
    expect(props!.accessibilityHint).toBe(HINT);
  });

  it('web: both actions as before (the same labels and routes, no label or hint added)', async () => {
    await openSheet('web');
    const station = linkProps.get('wsf-kiosk-stations-open-g1')!;
    expect(station.label).toBe('Open station screen');
    expect(station.href).toBe('/station/g1');
    expect(station).not.toHaveProperty('accessibilityLabel');
    expect(station).not.toHaveProperty('accessibilityHint');
    await startCombined();
    const combined = linkProps.get('wsf-combined-open')!;
    expect(combined.label).toBe('Open combined screen');
    expect(combined.href).toBe('/combined/cs1');
    expect(combined).not.toHaveProperty('accessibilityLabel');
    expect(combined).not.toHaveProperty('accessibilityHint');
  });

  it('ButtonLink hands the hint to the element a screen reader reads (and nothing when none is given)', async () => {
    const { ButtonLink } = await vi.importActual<typeof import('../src/ui/ButtonLink')>('../src/ui/ButtonLink');
    act(() =>
      root.render(
        <>
          <ButtonLink href="/station/g1" label="Open station screen" style={{}} textStyle={{}} testID="bl-hint" accessibilityLabel="L" accessibilityHint={HINT} />
          <ButtonLink href="/station/g1" label="Open station screen" style={{}} textStyle={{}} testID="bl-plain" />
        </>,
      ),
    );
    expect(pressProps.get('bl-hint')!.accessibilityHint).toBe(HINT);
    expect(pressProps.get('bl-hint')!.accessibilityLabel).toBe('L');
    expect(pressProps.get('bl-plain')!.accessibilityHint).toBeUndefined();
  });
});

describe('W16-18 / MF-08 criterion 2: the venue routes never sign anybody out', () => {
  const VENUE_DIRS = ['app/station', 'app/combined', 'app/display'];
  const files = VENUE_DIRS.flatMap((dir) => {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const name of readdirSync(join(APP_ROOT, d))) {
        const rel = `${d}/${name}`;
        if (statSync(join(APP_ROOT, rel)).isDirectory()) walk(rel);
        else if (/\.(t|j)sx?$/.test(name)) out.push(rel);
      }
    };
    walk(dir);
    return out;
  });
  /** Each import's module and named bindings, and whether the file calls signOut. */
  function signOutUses(text: string): string[] {
    const found: string[] = [];
    for (const m of text.matchAll(/import\s+([^;]*?)\s+from\s+['"]([^'"]+)['"]/gs)) {
      const [, bindings, from] = m;
      if (/kioskSignOutGuard|signOutReset/.test(from!)) found.push(`imports ${from}`);
      if (from === 'firebase/auth' && /\bsignOut\b/.test(bindings!)) found.push('imports signOut from firebase/auth');
    }
    if (/\bsignOut\s*\(/.test(text)) found.push('calls signOut');
    return found;
  }

  it('the scan reads each form it refuses', () => {
    expect(signOutUses("import { signOut } from 'firebase/auth';")).toEqual(['imports signOut from firebase/auth']);
    expect(signOutUses("import { decideKioskStart } from '../../src/kioskSignOutGuard';")).toEqual(['imports ../../src/kioskSignOutGuard']);
    expect(signOutUses("import { signOutToSignedOutHome } from '../../src/ui/signOutReset';")).toEqual(['imports ../../src/ui/signOutReset']);
    expect(signOutUses('void signOut(auth);')).toEqual(['calls signOut']);
    expect(signOutUses("import { getAuth } from 'firebase/auth';")).toEqual([]);
  });

  it('app/station, app/combined and app/display: no sign-out at all', () => {
    expect(files).toEqual(expect.arrayContaining(['app/station/[goalId].tsx', 'app/combined/[setupId].tsx', 'app/display/[goalId].tsx']));
    for (const file of files) {
      expect(signOutUses(readFileSync(join(APP_ROOT, file), 'utf8')), relative(APP_ROOT, join(APP_ROOT, file))).toEqual([]);
    }
  });
});
