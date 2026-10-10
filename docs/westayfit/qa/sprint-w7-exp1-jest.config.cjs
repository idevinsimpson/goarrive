/** W7 check 22 / 23: run the scratch re-derivation against an EXP1 worktree's toolchain.
 *  W7_EXP1_WT selects the worktree (default ../wt-exp1 = 8a434dd7; ../wt-exp1b = 3b9963c9). */
const path = require('path');
const WT = path.resolve(__dirname, process.env.W7_EXP1_WT || '../wt-exp1', 'functions-westayfit');
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: WT,
  roots: [WT, __dirname],
  setupFiles: [path.join(WT, 'tests/emulator-isolation.setup.ts')],
  testMatch: [path.join(__dirname, '*.test.ts')],
  moduleNameMapper: { '^@exp1/(.*)$': path.join(WT, 'src/$1') },
  moduleDirectories: ['node_modules', path.join(WT, 'node_modules')],
  testTimeout: 120_000,
  globals: {
    'ts-jest': {
      diagnostics: false,
      tsconfig: { module: 'commonjs', esModuleInterop: true, allowJs: false },
    },
  },
};
