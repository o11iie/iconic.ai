import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      /*
       * `server-only` throws on import outside a Server Component, which is
       * exactly what it is for — and which makes server modules untestable
       * under jsdom. Stubbing it here costs nothing, because the guarantee it
       * enforces is enforced at BUILD time by the Next compiler and by the
       * ESLint import restriction, and proved independently by the browser
       * suite's scan of the shipped bundle. None of those are weakened by a
       * test-only alias; without it, the server modules simply go untested.
       */
      'server-only': fileURLToPath(new URL('./src/tests/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
