/**
 * useNetworkStatus — Connectivity detection + offline queue auto-flush
 *
 * Detects online/offline state across web and native platforms.
 * Automatically flushes the offline write queue when connectivity returns.
 *
 * Uses:
 *   - Web: navigator.onLine + online/offline events
 *   - Native: @react-native-community/netinfo (optional, graceful fallback)
 *
 * Returns { isOffline, queueSize } for UI indicators.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import { processQueue, getQueueSize } from '../lib/offlineQueue';

export function useNetworkStatus() {
  const [isOffline, setIsOffline] = useState(false);
  const [queueSize, setQueueSize] = useState(0);
  const wasOfflineRef = useRef(false);

  // ── Connectivity detection ────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS === 'web') {
      const update = () => {
        const offline = !navigator.onLine;
        setIsOffline(offline);
        if (wasOfflineRef.current && !offline) {
          // Just came back online — flush queue
          flushQueue();
        }
        wasOfflineRef.current = offline;
      };
      update();
      window.addEventListener('online', update);
      window.addEventListener('offline', update);
      return () => {
        window.removeEventListener('online', update);
        window.removeEventListener('offline', update);
      };
    } else {
      // Native: try @react-native-community/netinfo
      try {
        const NetInfo = require('@react-native-community/netinfo');
        const unsub = NetInfo.addEventListener((state: any) => {
          const offline = !(state.isConnected ?? true);
          setIsOffline(offline);
          if (wasOfflineRef.current && !offline) {
            flushQueue();
          }
          wasOfflineRef.current = offline;
        });
        return () => unsub();
      } catch {
        // NetInfo not installed — assume online
        setIsOffline(false);
      }
    }
  }, []);

  // ── Flush queue on mount (catch writes from previous sessions) ────
  useEffect(() => {
    flushQueue();
  }, []);

  // ── Queue flush helper ────────────────────────────────────────────
  const flushQueue = useCallback(async () => {
    try {
      const processed = await processQueue();
      if (processed > 0) {
        console.log(`[useNetworkStatus] Flushed ${processed} queued writes`);
      }
      const remaining = await getQueueSize();
      setQueueSize(remaining);
    } catch (err) {
      console.warn('[useNetworkStatus] Queue flush error:', err);
    }
  }, []);

  // ── Periodic queue size check (every 30s when offline) ────────────
  useEffect(() => {
    if (!isOffline) return;
    const interval = setInterval(async () => {
      try {
        const size = await getQueueSize();
        setQueueSize(size);
      } catch { /* ignore */ }
    }, 30_000);
    return () => clearInterval(interval);
  }, [isOffline]);

  return { isOffline, queueSize, flushQueue };
}
