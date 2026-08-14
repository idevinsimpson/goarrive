import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [{ find: /^react-native$/, replacement: 'react-native-web' }],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './test-setup.ts',
  },
});
