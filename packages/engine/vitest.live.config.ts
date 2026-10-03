import { defineConfig } from 'vitest/config';
// Tests « en conditions réelles » : appellent les vrais services. Lancer avec `pnpm sources:check` (accès Internet requis).
export default defineConfig({
  test: {
    include: ['test-live/**/*.live.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
