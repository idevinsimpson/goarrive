module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src/__tests__'],
  testMatch: ['**/*.test.ts'],
  haste: { enableSymlinks: false },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: { module: 'commonjs', esModuleInterop: true, skipLibCheck: true },
      diagnostics: false,
    }],
  },
};
