import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/production', workers: 1, timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:4193/office/', viewport: { width: 1440, height: 960 } },
  webServer: { command: 'node tests/serve_build.mjs', url: 'http://127.0.0.1:4193/office/', reuseExistingServer: false },
})
