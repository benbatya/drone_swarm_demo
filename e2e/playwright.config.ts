import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'node:path'

// Repo root (this config lives in e2e/); webServer runs npm from here.
const rootDir = resolve(import.meta.dirname, '..')

// Boots the built app via `vite preview` and drives it in headless chromium.
// M0 asserts the SPA mounts and the map renders with zero console errors;
// M1 extends this to poll window.__SIM__ for >=1000 frames.
export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Ensure WebGL works in headless CI for deck.gl / MapLibre.
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    cwd: rootDir,
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
