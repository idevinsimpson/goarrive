/**
 * offlineQueue — Lightweight offline write queue for Firestore
 *
 * Queues Firestore writes (addDoc / updateDoc) when the device is offline.
 * Automatically retries when connectivity returns.
 * Uses AsyncStorage for persistence across app restarts.
 *
 * This is "offline tolerance" — not a full sync engine.
 * Designed for the workout completion flow where the member may
 * lose connectivity in a gym environment.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from './firebase';
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { Platform } from 'react-native';

const QUEUE_KEY = '@goarrive_offline_queue';

interface QueuedWrite {
  id: string;
  type: 'add' | 'update';
  collectionPath: string;
  docId?: string; // for updates
  data: Record<string, any>;
  createdAt: number;
}

let isProcessing = false;

/**
 * Enqueue a Firestore write. Tries immediately; if it fails, queues for later.
 */
export async function enqueueWrite(
  type: 'add' | 'update',
  collectionPath: string,
  data: Record<string, any>,
  docId?: string,
): Promise<boolean> {
  try {
    await executeWrite(type, collectionPath, data, docId);
    return true; // succeeded immediately
  } catch (err) {
    // Queue for later
    const entry: QueuedWrite = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      collectionPath,
      docId,
      data: serializeData(data),
      createdAt: Date.now(),
    };

    const queue = await getQueue();
    queue.push(entry);
    await saveQueue(queue);
    console.log('[OfflineQueue] Queued write:', entry.id);
    return false; // queued for later
  }
}

/**
 * Process any pending queued writes. Call this when connectivity returns.
 */
export async function processQueue(): Promise<number> {
  if (isProcessing) return 0;
  isProcessing = true;

  try {
    const queue = await getQueue();
    if (queue.length === 0) return 0;

    let processed = 0;
    const remaining: QueuedWrite[] = [];

    for (const entry of queue) {
      try {
        await executeWrite(entry.type, entry.collectionPath, entry.data, entry.docId);
        processed++;
      } catch (err) {
        // Still offline or failed — keep in queue
        remaining.push(entry);
      }
    }

    await saveQueue(remaining);
    console.log(`[OfflineQueue] Processed ${processed}, remaining ${remaining.length}`);
    return processed;
  } finally {
    isProcessing = false;
  }
}

/**
 * Get the current queue size.
 */
export async function getQueueSize(): Promise<number> {
  const queue = await getQueue();
  return queue.length;
}

// ── Internal helpers ──────────────────────────────────────────────────────

async function executeWrite(
  type: 'add' | 'update',
  collectionPath: string,
  data: Record<string, any>,
  docId?: string,
) {
  // Restore serverTimestamp markers
  const restored = restoreTimestamps(data);

  if (type === 'add') {
    await addDoc(collection(db, collectionPath), restored);
  } else if (type === 'update' && docId) {
    await updateDoc(doc(db, collectionPath, docId), restored);
  }
}

function serializeData(data: Record<string, any>): Record<string, any> {
  const serialized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && value._methodName === 'serverTimestamp') {
      serialized[key] = '__SERVER_TIMESTAMP__';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      serialized[key] = serializeData(value);
    } else {
      serialized[key] = value;
    }
  }
  return serialized;
}

function restoreTimestamps(data: Record<string, any>): Record<string, any> {
  const restored: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === '__SERVER_TIMESTAMP__') {
      restored[key] = serverTimestamp();
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      restored[key] = restoreTimestamps(value);
    } else {
      restored[key] = value;
    }
  }
  return restored;
}

async function getQueue(): Promise<QueuedWrite[]> {
  try {
    if (Platform.OS === 'web') {
      const raw = localStorage.getItem(QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    }
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveQueue(queue: QueuedWrite[]): Promise<void> {
  try {
    const json = JSON.stringify(queue);
    if (Platform.OS === 'web') {
      localStorage.setItem(QUEUE_KEY, json);
    } else {
      await AsyncStorage.setItem(QUEUE_KEY, json);
    }
  } catch (err) {
    console.error('[OfflineQueue] Failed to save queue:', err);
  }
}
