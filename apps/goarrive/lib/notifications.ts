/**
 * notifications.ts — Expo push notification registration & token management
 *
 * Registers for push notifications, stores the Expo push token in Firestore
 * under users/{uid}/fcmTokens/{tokenId}, and provides a listener hook.
 *
 * Usage:
 *   import { registerForPushNotifications } from '../lib/notifications';
 *   await registerForPushNotifications(uid);
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { db } from './firebase';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_STORAGE_KEY = 'goarrive_push_token';
const TOKEN_REFRESH_KEY = 'goarrive_push_token_refreshed_at';
const TOKEN_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Configure how notifications appear when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Register for push notifications and store the token in Firestore.
 * Returns the Expo push token string, or null if registration fails.
 */
export async function registerForPushNotifications(
  uid: string,
): Promise<string | null> {
  // Push notifications only work on physical devices
  if (!Device.isDevice) {
    console.log('[Notifications] Must use physical device for push notifications');
    return null;
  }

  // Check existing permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  // Request permissions if not already granted
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[Notifications] Permission not granted');
    return null;
  }

  try {
    // Get the Expo push token
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: projectId || undefined,
    });

    const token = tokenData.data;

    // Store token in Firestore under users/{uid}/fcmTokens/{sanitized-token}
    const tokenId = token.replace(/[^a-zA-Z0-9]/g, '_');
    await setDoc(
      doc(db, 'users', uid, 'fcmTokens', tokenId),
      {
        token,
        platform: Platform.OS,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    // Android-specific notification channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'GoArrive',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#F5A623',
      });
    }

    // Store token locally for refresh comparison
    await AsyncStorage.setItem(TOKEN_STORAGE_KEY, token);
    await AsyncStorage.setItem(TOKEN_REFRESH_KEY, Date.now().toString());

    console.log('[Notifications] Registered push token:', token);
    return token;
  } catch (error) {
    console.error('[Notifications] Registration error:', error);
    return null;
  }
}

/**
 * Refresh the push token if it's older than TOKEN_REFRESH_INTERVAL_MS.
 * Should be called on app foreground / auth state change.
 */
export async function refreshPushTokenIfNeeded(
  uid: string,
): Promise<void> {
  try {
    const lastRefreshed = await AsyncStorage.getItem(TOKEN_REFRESH_KEY);
    if (lastRefreshed) {
      const elapsed = Date.now() - parseInt(lastRefreshed, 10);
      if (elapsed < TOKEN_REFRESH_INTERVAL_MS) return; // Still fresh
    }

    // Re-register to get a potentially new token
    const newToken = await registerForPushNotifications(uid);
    if (!newToken) return;

    // Check if token changed
    const oldToken = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
    if (oldToken && oldToken !== newToken) {
      console.log('[Notifications] Token rotated, updating Firestore');
      // Also update the top-level pushToken field on the user doc
      try {
        await updateDoc(doc(db, 'users', uid), {
          pushToken: newToken,
          pushTokenUpdatedAt: serverTimestamp(),
        });
      } catch (err) {
        console.warn('[Notifications] Failed to update user pushToken:', err);
      }
    }
  } catch (err) {
    console.warn('[Notifications] Token refresh check failed:', err);
  }
}

/**
 * Add a listener for incoming notifications (foreground).
 * Returns a subscription that should be removed on unmount.
 */
export function addNotificationReceivedListener(
  callback: (notification: Notifications.Notification) => void,
) {
  return Notifications.addNotificationReceivedListener(callback);
}

/**
 * Add a listener for notification taps (background → app open).
 * Returns a subscription that should be removed on unmount.
 */
export function addNotificationResponseListener(
  callback: (response: Notifications.NotificationResponse) => void,
) {
  return Notifications.addNotificationResponseReceivedListener(callback);
}
