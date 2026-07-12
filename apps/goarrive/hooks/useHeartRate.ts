/**
 * useHeartRate — live heart-rate via Web Bluetooth (web platform only)
 *
 * Connects to the standard heart_rate GATT service (0x180D) and parses
 * heart_rate_measurement (0x2A37) notifications. On unsupported platforms
 * or browsers, `supported` is false and connect() is a no-op.
 *
 * Session stats accumulate avg/max/min plus a downsampled time series
 * (5-second buckets, capped) suitable for persisting on a workout log.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

export type HeartRateStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface HeartRateSeriesPoint {
  /** Seconds since session start (5s bucket boundary) */
  t: number;
  /** Average bpm within the bucket, rounded */
  hr: number;
}

export interface HeartRateSessionStats {
  avgHR: number;
  maxHR: number;
  minHR: number;
  sampleCount: number;
  series: HeartRateSeriesPoint[];
}

const BUCKET_SECONDS = 5;
// ~2h of 5s buckets — keeps the persisted series far under Firestore's 1MB doc cap.
const MAX_SERIES_POINTS = 1440;

export function isWebBluetoothAvailable(): boolean {
  return (
    Platform.OS === 'web'
    && typeof navigator !== 'undefined'
    && !!(navigator as any).bluetooth
  );
}

/** Parse a heart_rate_measurement characteristic value per the BT spec. */
export function parseHeartRateMeasurement(value: DataView): number {
  const flags = value.getUint8(0);
  // Bit 0: 0 = uint8 bpm at offset 1, 1 = uint16 (little-endian) at offset 1.
  return (flags & 0x01) ? value.getUint16(1, true) : value.getUint8(1);
}

export function useHeartRate() {
  const supported = isWebBluetoothAvailable();

  const [status, setStatus] = useState<HeartRateStatus>('idle');
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [bpm, setBpm] = useState<number | null>(null);

  const deviceRef = useRef<any>(null);
  const characteristicRef = useRef<any>(null);

  // Session accumulators (refs — bpm state updates already trigger renders).
  const statsRef = useRef({
    sum: 0,
    count: 0,
    max: 0,
    min: Infinity,
    startedAt: 0,
    series: [] as HeartRateSeriesPoint[],
    bucketT: -1,
    bucketSum: 0,
    bucketCount: 0,
  });

  const flushBucket = useCallback(() => {
    const s = statsRef.current;
    if (s.bucketCount > 0 && s.series.length < MAX_SERIES_POINTS) {
      s.series.push({ t: s.bucketT, hr: Math.round(s.bucketSum / s.bucketCount) });
    }
    s.bucketSum = 0;
    s.bucketCount = 0;
  }, []);

  const recordSample = useCallback((hr: number) => {
    if (!hr || hr < 25 || hr > 250) return; // discard sensor glitches
    const s = statsRef.current;
    if (s.startedAt === 0) s.startedAt = Date.now();
    s.sum += hr;
    s.count += 1;
    if (hr > s.max) s.max = hr;
    if (hr < s.min) s.min = hr;

    const elapsedSec = (Date.now() - s.startedAt) / 1000;
    const bucketT = Math.floor(elapsedSec / BUCKET_SECONDS) * BUCKET_SECONDS;
    if (bucketT !== s.bucketT) {
      flushBucket();
      s.bucketT = bucketT;
    }
    s.bucketSum += hr;
    s.bucketCount += 1;
  }, [flushBucket]);

  const handleNotification = useCallback((event: any) => {
    const value: DataView | undefined = event?.target?.value;
    if (!value || value.byteLength < 2) return;
    try {
      const hr = parseHeartRateMeasurement(value);
      setBpm(hr);
      recordSample(hr);
    } catch {
      // malformed packet — skip
    }
  }, [recordSample]);

  const handleDisconnected = useCallback(() => {
    characteristicRef.current = null;
    setStatus('disconnected');
    setBpm(null);
  }, []);

  const connect = useCallback(async () => {
    if (!supported) return;
    setStatus('connecting');
    try {
      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [{ services: ['heart_rate'] }],
      });
      deviceRef.current = device;
      device.addEventListener('gattserverdisconnected', handleDisconnected);

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService('heart_rate');
      const characteristic = await service.getCharacteristic('heart_rate_measurement');
      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', handleNotification);
      characteristicRef.current = characteristic;

      setDeviceName(device.name || 'Heart rate monitor');
      setStatus('connected');
    } catch (err: any) {
      // User cancelled the chooser — back to idle, not an error state.
      if (err?.name === 'NotFoundError') {
        setStatus('idle');
      } else {
        console.warn('[useHeartRate] connect failed:', err);
        setStatus('error');
      }
    }
  }, [supported, handleDisconnected, handleNotification]);

  const disconnect = useCallback(() => {
    const characteristic = characteristicRef.current;
    if (characteristic) {
      characteristic.removeEventListener('characteristicvaluechanged', handleNotification);
      characteristic.stopNotifications?.().catch(() => {});
      characteristicRef.current = null;
    }
    const device = deviceRef.current;
    if (device) {
      device.removeEventListener('gattserverdisconnected', handleDisconnected);
      if (device.gatt?.connected) {
        try { device.gatt.disconnect(); } catch { /* best-effort */ }
      }
      deviceRef.current = null;
    }
    setStatus('idle');
    setBpm(null);
  }, [handleNotification, handleDisconnected]);

  // Tear down the GATT connection on unmount so the strap isn't held open.
  useEffect(() => {
    return () => {
      const characteristic = characteristicRef.current;
      if (characteristic) {
        characteristic.removeEventListener('characteristicvaluechanged', handleNotification);
        characteristic.stopNotifications?.().catch(() => {});
      }
      const device = deviceRef.current;
      if (device) {
        device.removeEventListener('gattserverdisconnected', handleDisconnected);
        if (device.gatt?.connected) {
          try { device.gatt.disconnect(); } catch { /* best-effort */ }
        }
      }
    };
  }, [handleNotification, handleDisconnected]);

  // Derived each render — cheap, and bpm state changes keep it fresh.
  const s = statsRef.current;
  const sessionStats: HeartRateSessionStats | null = s.count > 0
    ? {
        avgHR: Math.round(s.sum / s.count),
        maxHR: s.max,
        minHR: s.min === Infinity ? 0 : s.min,
        sampleCount: s.count,
        series: s.bucketCount > 0 && s.series.length < MAX_SERIES_POINTS
          ? [...s.series, { t: s.bucketT, hr: Math.round(s.bucketSum / s.bucketCount) }]
          : s.series,
      }
    : null;

  return { supported, status, deviceName, bpm, connect, disconnect, sessionStats };
}
