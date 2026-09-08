// In-session shared state for the /demo experience.
//
// Scope: same browser only. Uses localStorage + the storage event so a display
// tab and a kiosk tab in the same browser stay in sync. This is NOT cross-device
// live sync — a second phone or laptop shows its own independent state.
//
// The initial state is intentionally fixed to 980 / 1,000 squats so a single
// +20 simulation reaches the milestone once per reset. Reset returns to 980 /
// 1,000 so the demo is replayable in front of an audience.

import { useSyncExternalStore } from 'react';

export type SquatState = {
  current: number;
  goal: number;
};

export type DemoState = {
  squats: SquatState;
  milestoneCelebrated: boolean;
  updatedAt: number;
};

export const DEMO_STORAGE_KEY = 'wsf-demo-state-v1';

export const INITIAL_DEMO_STATE: DemoState = {
  squats: { current: 980, goal: 1000 },
  milestoneCelebrated: false,
  updatedAt: 0,
};

function cloneInitial(): DemoState {
  return {
    squats: { ...INITIAL_DEMO_STATE.squats },
    milestoneCelebrated: false,
    updatedAt: 0,
  };
}

let state: DemoState = cloneInitial();
let storageListenerAttached = false;
const listeners = new Set<() => void>();

function readFromStorage(): DemoState {
  if (typeof window === 'undefined') return cloneInitial();
  try {
    const raw = window.localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return cloneInitial();
    const parsed = JSON.parse(raw) as Partial<DemoState>;
    return {
      squats: {
        current:
          typeof parsed.squats?.current === 'number'
            ? parsed.squats.current
            : INITIAL_DEMO_STATE.squats.current,
        goal:
          typeof parsed.squats?.goal === 'number'
            ? parsed.squats.goal
            : INITIAL_DEMO_STATE.squats.goal,
      },
      milestoneCelebrated: !!parsed.milestoneCelebrated,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    return cloneInitial();
  }
}

function writeToStorage(next: DemoState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage may be unavailable (private mode, quota) — the in-memory copy
    // still works for a single-tab demo, so we silently continue.
  }
}

function commit(next: DemoState) {
  state = next;
  writeToStorage(next);
  listeners.forEach((l) => l());
}

function ensureStorageListener() {
  if (storageListenerAttached || typeof window === 'undefined') return;
  window.addEventListener('storage', (event) => {
    if (event.key !== DEMO_STORAGE_KEY) return;
    const incoming = readFromStorage();
    state = incoming;
    listeners.forEach((l) => l());
  });
  storageListenerAttached = true;
}

export function initDemoState() {
  state = readFromStorage();
  ensureStorageListener();
}

export function getDemoState(): DemoState {
  return state;
}

export function subscribe(fn: () => void): () => void {
  ensureStorageListener();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export type AddSquatsResult = {
  previousTotal: number;
  newTotal: number;
  addedCount: number;
  crossedMilestone: boolean;
};

export function addSquats(count: number): AddSquatsResult {
  const safeCount = Math.max(0, Math.floor(count));
  const prev = state.squats.current;
  const goal = state.squats.goal;
  const next = Math.min(goal, prev + safeCount);
  const crossedMilestone = prev < goal && next >= goal && !state.milestoneCelebrated;
  commit({
    squats: { ...state.squats, current: next },
    milestoneCelebrated: state.milestoneCelebrated || next >= goal,
    updatedAt: Date.now(),
  });
  return {
    previousTotal: prev,
    newTotal: next,
    addedCount: next - prev,
    crossedMilestone,
  };
}

export function resetDemo() {
  commit(cloneInitial());
}

// React hook — uses useSyncExternalStore so any component re-renders when the
// module store or another tab updates the state.
export function useDemoState(): DemoState {
  return useSyncExternalStore(
    (cb) => subscribe(cb),
    () => state,
    () => INITIAL_DEMO_STATE
  );
}
