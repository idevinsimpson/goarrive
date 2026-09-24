/** @type {import('jest').Config} */
// Expo prize-drawing lane (docs/westayfit/expo-prize). A separate config
// because jest.callable.config.cjs matches tests/callable/** only; this one
// matches tests/expo-prize/** and is otherwise identical, including the
// emulator-isolation enforcement point.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  setupFiles: ['<rootDir>/tests/emulator-isolation.setup.ts'],
  testMatch: ['<rootDir>/tests/expo-prize/**/*.test.ts'],
  moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
  testTimeout: 60_000,
  globals: {
    'ts-jest': {
      diagnostics: false,
      tsconfig: { module: 'commonjs', esModuleInterop: true },
    },
  },
};
