/**
 * usePlaybackSpeed — Per-movement playback speed with localStorage persistence
 *
 * Provides fine-tuned speed control (0.5x → 2.0x in 0.25 increments).
 * Speed is stored per movement ID in localStorage so it persists across
 * sessions — if a member slows down "Chest Press" to 0.75x, it stays
 * 0.75x every time they see that movement.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Platform } from 'react-native';

const SPEED_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];
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

interface UsePlaybackSpeedReturn {
  speed: number;
  speedLabel: string;
  cycleSpeed: () => void;
  SPEED_STEPS: number[];
}

export function usePlaybackSpeed(movementId: string | undefined): UsePlaybackSpeedReturn {
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const prevMovementId = useRef<string | undefined>(undefined);

  // Load persisted speed when movement changes
  useEffect(() => {
    if (!movementId || movementId === prevMovementId.current) return;
    prevMovementId.current = movementId;
    const map = loadSpeedMap();
    const saved = map[movementId];
    setSpeed(saved && SPEED_STEPS.includes(saved) ? saved : DEFAULT_SPEED);
  }, [movementId]);

  // Cycle through speed steps
  const cycleSpeed = useCallback(() => {
    setSpeed(prev => {
      const idx = SPEED_STEPS.indexOf(prev);
      const nextIdx = (idx + 1) % SPEED_STEPS.length;
      const next = SPEED_STEPS[nextIdx];
      if (movementId) saveSpeed(movementId, next);
      return next;
    });
  }, [movementId]);

  const speedLabel = speed === 1 ? '1x' : `${speed}x`;

  return { speed, speedLabel, cycleSpeed, SPEED_STEPS };
}
