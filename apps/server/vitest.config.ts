import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    alias: {
      '@cane/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  // DB test files share one Postgres (roles are cluster-wide), so files run one at a time.
  test: { include: ['test/**/*.test.ts'], exclude: ['**/node_modules/**', 'test/integration/**'], fileParallelism: false },
});
