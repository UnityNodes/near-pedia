import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    // node, not jsdom: every test here exercises server-side code, and jsdom
    // makes Vite externalise node builtins for "browser compatibility" - which
    // is how NODE_ENV=production leaking in from a sourced .env.production
    // turned crypto's timingSafeEqual into undefined and failed 2 tests. No
    // test renders a component; add `// @vitest-environment jsdom` to any that
    // ever does.
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/.claude/**', '**/dist/**'],
    env: {
      DB_PATH: ':memory:',
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
