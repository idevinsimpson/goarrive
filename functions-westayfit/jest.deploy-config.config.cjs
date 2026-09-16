/** @type {import('jest').Config} */
// Deployment-configuration tests only: they read the __endpoint metadata the
// Firebase CLI discovers and never invoke a handler, so unlike the callable and
// rules suites they need no emulator and load no emulator-isolation setup.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  testMatch: ['<rootDir>/tests/deploy-config/**/*.test.ts'],
  moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
  globals: {
    'ts-jest': {
      diagnostics: false,
      tsconfig: { module: 'commonjs', esModuleInterop: true },
    },
  },
};
