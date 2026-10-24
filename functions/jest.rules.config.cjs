module.exports = {
  testEnvironment: 'node',
  rootDir: '..',
  roots: ['<rootDir>'],
  testMatch: ['<rootDir>/firestore.rules.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/apps/', '<rootDir>/functions/lib/', '<rootDir>/functions/src/'],
  modulePathIgnorePatterns: ['<rootDir>/apps/', '<rootDir>/functions/lib/', '<rootDir>/functions/src/'],
  moduleDirectories: ['node_modules', '<rootDir>/functions/node_modules'],
  haste: { enableSymlinks: false },
  transform: {
    '^.+\\.tsx?$': [require.resolve('ts-jest'), { tsconfig: { module: 'commonjs', esModuleInterop: true, skipLibCheck: true, baseUrl: require('path').resolve(__dirname, '..'), paths: { '@firebase/rules-unit-testing': ['functions/node_modules/@firebase/rules-unit-testing'], 'firebase/*': ['functions/node_modules/firebase/*'] } } }],
  },
};
