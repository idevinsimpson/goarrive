/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  // Enforcement point for emulator isolation — see the setup file.
  setupFiles: ['<rootDir>/tests/emulator-isolation.setup.ts'],
  testMatch: ['<rootDir>/tests/callable/**/*.test.ts'],
  moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
  // Multi-step callable cases (seed a community, several callables, replay)
  // already carry a 30 s ceiling where they set one; the same ceiling for the
  // rest, so a 4-core sandbox running 18 suites in parallel does not turn a
  // slow emulator round trip into a failure. A real hang still fails.
  testTimeout: 30_000,
  globals: {
    'ts-jest': {
      diagnostics: false,
      tsconfig: { module: 'commonjs', esModuleInterop: true },
    },
  },
};
