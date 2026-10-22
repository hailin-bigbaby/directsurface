import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests', testIgnore: '**/production/**', workers: 1, timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:4192', viewport: { width: 1440, height: 960 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- --mode test --port 4192',
    url: 'http://127.0.0.1:4192', reuseExistingServer: false, timeout: 120_000,
  },
})
