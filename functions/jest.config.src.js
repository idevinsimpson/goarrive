/**
 * Jest config for src/__tests__/*.test.ts (Cloud Function unit tests).
 *
 * The package.json "jest" block is dedicated to firestore.rules.test.ts and
 * uses an explicit testMatch that skips everything else. This config exists
 * solely so `npm run test:src` can pick up the src tests without disturbing
 * the rules-test config.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  testMatch: ['<rootDir>/src/**/__tests__/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/lib/'],
  // ts-jest type-checking the full Cloud Function source pulls in firebase-admin
  // types and pushes peak memory above the default jest worker limit. Run
  // serially to keep the suite stable.
  maxWorkers: 1,
};
