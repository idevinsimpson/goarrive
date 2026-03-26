/**
 * Jest setup — mock native modules and Firebase
 *
 * R5 DRIFT GUARD:
 * Modules that are not direct dependencies use { virtual: true }
 * so Jest does not attempt to resolve them from node_modules.
 *
 * When adding a new native module to the app:
 *   1. Add its mock here with { virtual: true } if not in package.json
 *   2. Remove { virtual: true } once the module is added to package.json
 *   3. Keep the mock API surface in sync with the actual module exports
 *
 * Current virtual mocks (not in package.json):
 *   - expo-speech
 *   - expo-haptics
 *   - expo-av
 *   - expo-camera
 *   - expo-file-system
 *   - expo-image-picker
 *   - expo-screen-orientation
 *   - @react-native-community/netinfo
 *   - firebase/storage
 *
 * Non-virtual mocks (resolved from node_modules):
 *   - ./lib/firebase (local)
 *   - firebase/firestore
 *
 * Last audited: 2026-03-26
 */

// Mock expo-speech
jest.mock('expo-speech', () => ({
  speak: jest.fn(),
  stop: jest.fn(),
  isSpeakingAsync: jest.fn().mockResolvedValue(false),
}), { virtual: true });

// Mock expo-haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}), { virtual: true });

// Mock expo-av
jest.mock('expo-av', () => ({
  Audio: {
    Sound: { createAsync: jest.fn().mockResolvedValue({ sound: { playAsync: jest.fn(), unloadAsync: jest.fn() } }) },
    setAudioModeAsync: jest.fn(),
  },
  Video: 'Video',
  ResizeMode: { CONTAIN: 'contain', COVER: 'cover' },
}), { virtual: true });

// Mock expo-camera (not a direct dependency)
jest.mock('expo-camera', () => ({
  Camera: { requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }) },
  CameraView: 'CameraView',
}), { virtual: true });

// Mock expo-file-system
jest.mock('expo-file-system', () => ({
  documentDirectory: '/mock/documents/',
  cacheDirectory: '/mock/cache/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false, size: 0 }),
  readDirectoryAsync: jest.fn().mockResolvedValue([]),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  downloadAsync: jest.fn().mockResolvedValue({ uri: '/mock/file.mp4' }),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
}), { virtual: true });

// Mock expo-image-picker
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCameraPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  launchImageLibraryAsync: jest.fn().mockResolvedValue({ canceled: true, assets: [] }),
}), { virtual: true });

// Mock expo-screen-orientation
jest.mock('expo-screen-orientation', () => ({
  lockAsync: jest.fn(),
  unlockAsync: jest.fn(),
  OrientationLock: { DEFAULT: 0, ALL: 1, PORTRAIT: 2, LANDSCAPE: 3 },
  Orientation: { PORTRAIT_UP: 1, LANDSCAPE_LEFT: 3, LANDSCAPE_RIGHT: 4 },
  addOrientationChangeListener: jest.fn(() => ({ remove: jest.fn() })),
}), { virtual: true });

// Mock @react-native-community/netinfo
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
  fetch: jest.fn().mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
    isWifiEnabled: true,
    type: 'wifi',
  }),
}), { virtual: true });

// Note: NativeAnimatedHelper mock not needed with jest-expo preset

// Mock Firebase
jest.mock('./lib/firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'test-uid' } },
  storage: {},
}));

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  orderBy: jest.fn(),
  limit: jest.fn(),
  getDocs: jest.fn().mockResolvedValue({ docs: [], empty: true }),
  getDoc: jest.fn().mockResolvedValue({ exists: () => false, data: () => null }),
  addDoc: jest.fn(),
  updateDoc: jest.fn(),
  deleteDoc: jest.fn(),
  doc: jest.fn(),
  writeBatch: jest.fn(() => ({ set: jest.fn(), commit: jest.fn().mockResolvedValue(undefined) })),
  serverTimestamp: jest.fn(),
  Timestamp: { fromDate: jest.fn((d) => d), now: jest.fn(() => new Date()) },
}));

jest.mock('firebase/storage', () => ({
  ref: jest.fn(),
  uploadBytesResumable: jest.fn(),
  getDownloadURL: jest.fn().mockResolvedValue('https://mock.url/video.mp4'),
}), { virtual: true });
