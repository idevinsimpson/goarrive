module.exports = {
  testEnvironment: 'node',
  rootDir: '..',
  roots: ['<rootDir>'],
  testMatch: ['<rootDir>/firestore.rules.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/apps/', '<rootDir>/functions/lib/', '<rootDir>/functions/src/'],
  modulePathIgnorePatterns: ['<rootDir>/apps/', '<rootDir>/functions/'],
  haste: { enableSymlinks: false },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs', esModuleInterop: true, skipLibCheck: true } }],
  },
};
