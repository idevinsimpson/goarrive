/**
 * usePlaybackSpeed — Per-movement playback speed with localStorage persistence
 *
 * Provides fine-tuned speed control (0.5x → 2.0x in 0.1x increments).
 * Speed is stored per movement ID in localStorage so it persists across
 * sessions — if a member slows down "Chest Press" to 0.7x, it stays
 * 0.7x every time they see that movement.
 *
 * When the movement changes, speed resets to 1x immediately (preventing
 * bleed), then loads the saved value for the new movement synchronously.
 */
import { useState, useCallback, useRef } from 'react';
import { Platform } from 'react-native';

// 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0
const SPEED_STEPS: number[] = [];
for (let i = 5; i <= 20; i++) {
  SPEED_STEPS.push(Math.round(i * 10) / 100); // 0.50 → 2.00
}
// Fix floating-point: [0.5, 0.6, 0.7, ... 2.0]
const STEPS = SPEED_STEPS.map(s => Math.round(s * 10) / 10);

const STORAGE_KEY = 'goarrive_movement_speeds';
const DEFAULT_SPEED = 1;

/** Read the full speed map from localStorage */
function loadSpeedMap(): Record<string, number> {
  if (Platform.OS !== 'web') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Save a single movement speed to the map */
function saveSpeed(movementId: string, speed: number): void {
  if (Platform.OS !== 'web') return;
  try {
    const map = loadSpeedMap();
    if (speed === DEFAULT_SPEED) {
      delete map[movementId];
    } else {
      map[movementId] = speed;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

/** Check if a saved speed is still a valid step (handles migration from old step set) */
function isValidStep(s: number): boolean {
  return STEPS.some(step => Math.abs(step - s) < 0.001);
}

interface UsePlaybackSpeedReturn {
  speed: number;
  speedLabel: string;
  cycleSpeed: () => void;
  SPEED_STEPS: number[];
}

export function usePlaybackSpeed(movementId: string | undefined): UsePlaybackSpeedReturn {
  const prevMovementId = useRef<string | undefined>(undefined);

  // Compute initial speed synchronously — no useEffect delay.
  // On every render where movementId changes, we read localStorage immediately.
  const getSpeedForMovement = (id: string | undefined): number => {
    if (!id) return DEFAULT_SPEED;
    const map = loadSpeedMap();
    const saved = map[id];
    return saved !== undefined && isValidStep(saved) ? saved : DEFAULT_SPEED;
  };

  // Detect movement change and reset speed synchronously during render
  if (movementId !== prevMovementId.current) {
    prevMovementId.current = movementId;
  }

  // State initialised with the correct speed for the current movement
  const [speed, setSpeed] = useState(() => getSpeedForMovement(movementId));

  // When movementId changes between renders, update speed synchronously
  const lastAppliedId = useRef<string | undefined>(movementId);
  if (movementId !== lastAppliedId.current) {
    lastAppliedId.current = movementId;
    const newSpeed = getSpeedForMovement(movementId);
    if (newSpeed !== speed) {
      setSpeed(newSpeed);
    }
  }

  // Cycle to the next speed step
  const cycleSpeed = useCallback(() => {
    setSpeed(prev => {
      const idx = STEPS.findIndex(s => Math.abs(s - prev) < 0.001);
      const nextIdx = idx >= 0 ? (idx + 1) % STEPS.length : STEPS.indexOf(DEFAULT_SPEED);
      const next = STEPS[nextIdx];
      if (movementId) saveSpeed(movementId, next);
      return next;
    });
  }, [movementId]);

  // Format label: "1x" for 1.0, "0.7x" for 0.7, etc.
  const speedLabel = speed === 1 ? '1x' : `${parseFloat(speed.toFixed(1))}x`;

  return { speed, speedLabel, cycleSpeed, SPEED_STEPS: STEPS };
}
