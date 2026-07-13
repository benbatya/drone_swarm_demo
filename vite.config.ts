/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Vite + Vitest config. The sim core (src/sim) is pure TS and headless-testable;
// UI panels can be tested under jsdom. Playwright E2E lives in /e2e and runs
// against a built preview server (see e2e/playwright.config.ts).
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
