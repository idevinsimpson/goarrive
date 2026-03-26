/**
 * Jest setup — mock native modules and Firebase
 */

// Mock expo-speech
jest.mock('expo-speech', () => ({
  speak: jest.fn(),
  stop: jest.fn(),
  isSpeakingAsync: jest.fn().mockResolvedValue(false),
}));

// Mock expo-haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// Mock expo-av
jest.mock('expo-av', () => ({
  Audio: {
    Sound: { createAsync: jest.fn().mockResolvedValue({ sound: { playAsync: jest.fn(), unloadAsync: jest.fn() } }) },
    setAudioModeAsync: jest.fn(),
  },
  Video: 'Video',
  ResizeMode: { CONTAIN: 'contain', COVER: 'cover' },
}));

// Mock expo-camera
jest.mock('expo-camera', () => ({
  Camera: { requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }) },
  CameraView: 'CameraView',
}));

// Mock Firebase
jest.mock('./lib/firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'test-uid' } },
}));

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  orderBy: jest.fn(),
  getDocs: jest.fn().mockResolvedValue({ docs: [], empty: true }),
  addDoc: jest.fn(),
  updateDoc: jest.fn(),
  doc: jest.fn(),
  serverTimestamp: jest.fn(),
  Timestamp: { fromDate: jest.fn((d) => d) },
}));
