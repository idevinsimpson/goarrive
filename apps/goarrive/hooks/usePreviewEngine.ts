/**
 * usePreviewEngine — Media loading protocol for the Build library grid.
 *
 * Controls which tiles are allowed to show animated GIF previews based on:
 *   - Scroll state (scrolling → settling → idle)
 *   - Viewport visibility (FlatList viewability)
 *   - Concurrency budget (hard caps on simultaneous animations)
 *   - Tile priority (standalone > folder > mini-tile)
 *   - Staggered promotion (80ms between promotions)
 *
 * Usage:
 *   const engine = usePreviewEngine();
 *   <FlatList
 *     onScroll={engine.onScroll}
 *     onViewableItemsChanged={engine.onViewableItemsChanged}
 *     viewabilityConfig={engine.viewabilityConfig}
 *     ...
 *   />
 *   // In renderItem:
 *   const shouldAnimate = engine.animatingIds.has(item.id);
 */
import { useRef, useState, useCallback, useEffect } from 'react';
import type { ViewToken, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

// ── Scroll State Machine ────────────────────────────────────────────────────
export type ScrollState = 'scrolling' | 'settling' | 'idle';

// ── Tile Priority (lower = higher priority) ─────────────────────────────────
export type TilePriority = 1 | 2 | 3;

// ── Budget Caps ─────────────────────────────────────────────────────────────
export const BUDGET = {
  maxStandaloneMovements: 4,
  maxFolderCards: 2,
  maxMiniPreviewsPerFolder: 3,
  maxTotalAnimated: 8,
} as const;

// ── Tile Size Thresholds (shortest side in px) ──────────────────────────────
export const SIZE_THRESHOLDS = {
  stillOnly: 72,         // < 72px: never animate
  lowAnimationMax: 120,  // 72–119px: low animation only (one-rep/low)
  standardMin: 120,      // 120–179px: low animation allowed
  fullMin: 180,          // 180px+: standard animation
} as const;

// ── Timing ──────────────────────────────────────────────────────────────────
const SCROLL_SETTLE_MS = 180;   // ms without scroll → settling
const SETTLE_TO_IDLE_MS = 50;   // ms in settling → idle
const STAGGER_INTERVAL_MS = 80; // ms between staggered promotions

// ── Viewability Config (stable ref — never changes) ─────────────────────────
const VIEW_CONFIG = {
  minimumViewTime: 150,
  itemVisiblePercentThreshold: 60,
  waitForInteraction: false,
};

export interface VisibleTileInfo {
  id: string;
  priority: TilePriority; // 1=standalone, 2=folder, 3=mini
}

export interface PreviewEngineResult {
  /** Set of item IDs currently promoted to animated state */
  animatingIds: Set<string>;
  /** Current scroll state */
  scrollState: ScrollState;
  /** Pass to FlatList onScroll */
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Pass to FlatList onViewableItemsChanged */
  onViewableItemsChanged: (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => void;
  /** Stable viewabilityConfig — pass to FlatList */
  viewabilityConfig: typeof VIEW_CONFIG;
  /** Register a tile's priority (call from renderItem) */
  registerTile: (id: string, priority: TilePriority) => void;
}

export function usePreviewEngine(): PreviewEngineResult {
  // ── Scroll state ────────────────────────────────────────────────────────
  const scrollStateRef = useRef<ScrollState>('idle');
  const [scrollState, setScrollState] = useState<ScrollState>('idle');
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Visible items ───────────────────────────────────────────────────────
  const visibleIdsRef = useRef<Set<string>>(new Set());

  // ── Tile registry (id → priority) ─────────────────────────────────────
  const tileRegistryRef = useRef<Map<string, TilePriority>>(new Map());

  // ── Animated set ────────────────────────────────────────────────────────
  const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set());
  const animatingRef = useRef<Set<string>>(new Set());

  // ── Stagger queue ─────────────────────────────────────────────────────
  const staggerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promotionAbortRef = useRef(false);

  // ── Cleanup ─────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      if (staggerTimerRef.current) clearTimeout(staggerTimerRef.current);
    };
  }, []);

  // ── Register tile priority ──────────────────────────────────────────────
  const registerTile = useCallback((id: string, priority: TilePriority) => {
    tileRegistryRef.current.set(id, priority);
  }, []);

  // ── Promotion logic ─────────────────────────────────────────────────────
  const runPromotion = useCallback(() => {
    promotionAbortRef.current = false;

    // Gather visible items sorted by priority
    const candidates: { id: string; priority: TilePriority }[] = [];
    for (const id of visibleIdsRef.current) {
      const priority = tileRegistryRef.current.get(id) ?? 1;
      candidates.push({ id, priority });
    }
    candidates.sort((a, b) => a.priority - b.priority);

    // Apply budget caps
    let standaloneCount = 0;
    let folderCount = 0;
    let totalCount = 0;
    const toPromote: string[] = [];

    for (const { id, priority } of candidates) {
      if (totalCount >= BUDGET.maxTotalAnimated) break;
      if (priority === 1 && standaloneCount >= BUDGET.maxStandaloneMovements) continue;
      if (priority === 2 && folderCount >= BUDGET.maxFolderCards) continue;
      // Priority 3 (mini-tiles) are handled inside WorkoutMosaic, not here

      if (priority === 1) standaloneCount++;
      if (priority === 2) folderCount++;
      totalCount++;
      toPromote.push(id);
    }

    // Stagger promotions
    if (toPromote.length === 0) return;

    const promoteNext = (index: number) => {
      if (promotionAbortRef.current) return;
      if (index >= toPromote.length) return;

      animatingRef.current.add(toPromote[index]);
      setAnimatingIds(new Set(animatingRef.current));

      if (index + 1 < toPromote.length) {
        staggerTimerRef.current = setTimeout(() => promoteNext(index + 1), STAGGER_INTERVAL_MS);
      }
    };

    promoteNext(0);
  }, []);

  // ── Demote all ──────────────────────────────────────────────────────────
  const demoteAll = useCallback(() => {
    promotionAbortRef.current = true;
    if (staggerTimerRef.current) clearTimeout(staggerTimerRef.current);
    animatingRef.current.clear();
    setAnimatingIds(new Set());
  }, []);

  // ── Demote items that left viewport ─────────────────────────────────────
  const demoteInvisible = useCallback(() => {
    let changed = false;
    for (const id of animatingRef.current) {
      if (!visibleIdsRef.current.has(id)) {
        animatingRef.current.delete(id);
        changed = true;
      }
    }
    if (changed) {
      setAnimatingIds(new Set(animatingRef.current));
    }
  }, []);

  // ── Transition to idle → run promotion ──────────────────────────────────
  const transitionToIdle = useCallback(() => {
    scrollStateRef.current = 'idle';
    setScrollState('idle');
    demoteInvisible();
    runPromotion();
  }, [demoteInvisible, runPromotion]);

  // ── Transition to settling ──────────────────────────────────────────────
  const transitionToSettling = useCallback(() => {
    scrollStateRef.current = 'settling';
    setScrollState('settling');
    settleTimerRef.current = setTimeout(transitionToIdle, SETTLE_TO_IDLE_MS);
  }, [transitionToIdle]);

  // ── onScroll handler ────────────────────────────────────────────────────
  const onScroll = useCallback((_e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Enter scrolling state
    if (scrollStateRef.current !== 'scrolling') {
      scrollStateRef.current = 'scrolling';
      setScrollState('scrolling');
      demoteAll();
    }

    // Reset settle timer
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);

    scrollTimerRef.current = setTimeout(transitionToSettling, SCROLL_SETTLE_MS);
  }, [demoteAll, transitionToSettling]);

  // ── onViewableItemsChanged handler ──────────────────────────────────────
  // Stable ref required — FlatList errors if this callback identity changes
  const viewableHandlerRef = useRef(
    (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {},
  );
  viewableHandlerRef.current = (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
    const newVisible = new Set<string>();
    for (const token of info.viewableItems) {
      if (token.isViewable && token.key) {
        newVisible.add(token.key);
      }
    }
    visibleIdsRef.current = newVisible;

    // If idle, demote items that left and re-promote with budget
    if (scrollStateRef.current === 'idle') {
      demoteInvisible();
      runPromotion();
    }
  };

  const onViewableItemsChanged = useCallback(
    (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
      viewableHandlerRef.current(info);
    },
    [],
  );

  return {
    animatingIds,
    scrollState,
    onScroll,
    onViewableItemsChanged,
    viewabilityConfig: VIEW_CONFIG,
    registerTile,
  };
}
