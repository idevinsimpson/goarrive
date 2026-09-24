/** W7 check 22: run the scratch re-derivation against the EXP1 worktree's toolchain. */
const path = require('path');
const WT = path.resolve(__dirname, '../wt-exp1/functions-westayfit');
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: WT,
  roots: [WT, __dirname],
  setupFiles: [path.join(WT, 'tests/emulator-isolation.setup.ts')],
  testMatch: [path.join(__dirname, '*.test.ts')],
  moduleDirectories: ['node_modules', path.join(WT, 'node_modules')],
  testTimeout: 120_000,
  globals: {
    'ts-jest': {
      diagnostics: false,
      tsconfig: { module: 'commonjs', esModuleInterop: true, allowJs: false },
    },
  },
};
