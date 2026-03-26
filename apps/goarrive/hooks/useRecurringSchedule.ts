/**
 * useRecurringSchedule — Manages recurring workout schedule state and date generation
 *
 * Extracted from AssignWorkoutModal to keep the component focused on UI flow.
 * Handles day-of-week selection, week count, and generates all assignment dates.
 */
import { useState, useCallback, useMemo } from 'react';

export interface RecurringScheduleState {
  isRecurring: boolean;
  recurringDays: number[];   // 0=Mon..6=Sun
  recurringWeeks: number;
  toggleRecurring: () => void;
  setRecurringWeeks: (w: number) => void;
  toggleDay: (dayIdx: number) => void;
  reset: () => void;
  /** Generate all assignment dates from a starting date */
  generateDates: (startDate: Date) => Date[];
}

export function useRecurringSchedule(): RecurringScheduleState {
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringWeeks, setRecurringWeeks] = useState(4);
  const [recurringDays, setRecurringDays] = useState<number[]>([]);

  const toggleRecurring = useCallback(() => {
    setIsRecurring((prev) => !prev);
  }, []);

  const toggleDay = useCallback((dayIdx: number) => {
    setRecurringDays((prev) =>
      prev.includes(dayIdx)
        ? prev.filter((d) => d !== dayIdx)
        : [...prev, dayIdx].sort(),
    );
  }, []);

  const reset = useCallback(() => {
    setIsRecurring(false);
    setRecurringWeeks(4);
    setRecurringDays([]);
  }, []);

  const generateDates = useCallback(
    (startDate: Date): Date[] => {
      if (!isRecurring || recurringDays.length === 0) return [startDate];

      const dates: Date[] = [];
      for (let week = 0; week < recurringWeeks; week++) {
        for (const dayIdx of recurringDays) {
          const d = new Date(startDate);
          // dayIdx: 0=Mon..6=Sun → JS: Mon=1..Sun=0
          const currentJsDay = d.getDay();
          const targetJsDay = dayIdx === 6 ? 0 : dayIdx + 1;
          let diff = targetJsDay - currentJsDay;
          if (diff < 0) diff += 7;
          d.setDate(d.getDate() + diff + week * 7);
          d.setHours(0, 0, 0, 0);
          dates.push(d);
        }
      }
      return dates;
    },
    [isRecurring, recurringDays, recurringWeeks],
  );

  return {
    isRecurring,
    recurringDays,
    recurringWeeks,
    toggleRecurring,
    setRecurringWeeks,
    toggleDay,
    reset,
    generateDates,
  };
}
