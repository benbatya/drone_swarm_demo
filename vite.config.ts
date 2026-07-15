/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Vite + Vitest config. The sim core (src/sim) is pure TS and headless-testable;
// UI panels can be tested under jsdom. Playwright E2E lives in /e2e and runs
// against a built preview server (see e2e/playwright.config.ts).

// GitHub Pages serves this project site under /drone_swarm_demo/, so asset URLs
// must be prefixed with that path. The Pages deploy workflow sets GH_PAGES=1 for
// its build; local dev, `vite preview`, and the Playwright e2e smoke keep base
// '/' so they serve from the root and stay unbroken.
const base = process.env.GH_PAGES ? '/drone_swarm_demo/' : '/'

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    // The deck.gl + MapLibre render stack (plus the bundled Natural Earth
    // basemap GeoJSON) is inherently large; it's a single long-lived SPA so one
    // chunk is acceptable. Raise the warning threshold.
    chunkSizeWarningLimit: 2500,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
