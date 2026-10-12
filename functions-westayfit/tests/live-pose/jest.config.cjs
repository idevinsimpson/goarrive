/** @type {import('jest').Config} */
// KIOSK-LIVE-POSE-2. The live-pose suites need the Realtime Database emulator
// as well as Firestore and Auth, so they run under their own config and are
// not matched by test:callable or test:rules (whose runs start no database
// emulator). Run from functions-westayfit:
//   npx jest --config tests/live-pose/jest.config.cjs
// inside `firebase emulators:exec --only firestore,auth,database`.
const path = require('path');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: path.resolve(__dirname, '..', '..'),
  // The shared isolation check first, then the database one.
  setupFiles: [
    '<rootDir>/tests/emulator-isolation.setup.ts',
    '<rootDir>/tests/live-pose/live-pose-isolation.setup.ts',
  ],
  testMatch: ['<rootDir>/tests/live-pose/**/*.test.ts'],
  moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
  testTimeout: 30_000,
  globals: {
    'ts-jest': {
      diagnostics: false,
      tsconfig: { module: 'commonjs', esModuleInterop: true },
    },
  },
};
