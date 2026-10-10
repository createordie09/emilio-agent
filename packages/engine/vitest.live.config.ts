import { defineConfig } from 'vitest/config';
// Tests « en conditions réelles » : appellent les vrais services. Lancer avec `pnpm sources:check` (accès Internet requis).
export default defineConfig({
  test: {
    include: ['test-live/**/*.live.ts'],
    // La calibration dure plusieurs minutes (mission réelle) : sa durée est fixée dans le test.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
