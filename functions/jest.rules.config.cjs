'use strict';

/**
 * Jest config for the Firestore security-rules regression suite.
 *
 * The suite lives at the repo root (../firestore.rules.test.ts) because it
 * reads ../firestore.rules, but its dependencies (jest, ts-jest,
 * @firebase/rules-unit-testing, firebase) are installed in functions/.
 * That split is why every path below is anchored explicitly:
 *
 *  - rootDir is the repo root so <rootDir>/firestore.rules.test.ts resolves.
 *  - moduleDirectories / the transformer are pinned to functions/node_modules
 *    via __dirname, because the repo root has no node_modules of its own.
 *  - apps/ is excluded from the module map so jest-haste-map does not crawl
 *    the Expo trees (slow, and a source of haste naming collisions).
 *
 * Run it through the emulator:
 *   npm run test:rules:emulator
 */

const path = require('path');

const FUNCTIONS_NODE_MODULES = path.join(__dirname, 'node_modules');

module.exports = {
  testEnvironment: 'node',
  rootDir: '..',
  roots: ['<rootDir>'],
  testMatch: ['<rootDir>/firestore.rules.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/apps/'],
  // Keep the Expo apps out of the haste map. functions/ must NOT be listed
  // here: ignoring it makes jest unable to resolve its own node_modules.
  modulePathIgnorePatterns: ['<rootDir>/apps/'],
  moduleDirectories: ['node_modules', FUNCTIONS_NODE_MODULES],
  haste: { enableSymlinks: false },
  transform: {
    '^.+\\.tsx?$': [
      require.resolve('ts-jest'),
      {
        diagnostics: false,
        tsconfig: {
          module: 'commonjs',
          esModuleInterop: true,
          skipLibCheck: true,
        },
      },
    ],
  },
};
