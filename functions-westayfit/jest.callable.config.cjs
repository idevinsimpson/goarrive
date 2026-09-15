/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  // Enforcement point for emulator isolation — see the setup file.
  setupFiles: ['<rootDir>/tests/emulator-isolation.setup.ts'],
  testMatch: ['<rootDir>/tests/callable/**/*.test.ts'],
  moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
  globals: {
    'ts-jest': {
      diagnostics: false,
      tsconfig: { module: 'commonjs', esModuleInterop: true },
    },
  },
};
