import { defineConfig } from 'playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  testMatch: ['focus_inspector.spec.ts', 'framework_regressions.spec.ts', 'devtools.spec.ts', 'tree_scrolling.spec.ts', 'charts.spec.ts', 'layout_contracts.spec.ts', 'dock_workbench.spec.ts', 'table_borders.spec.ts', 'data_grid_borders.spec.ts', 'component_borders.spec.ts'],
  outputDir: './.runtime/rendering-tests',
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4176', browserName: 'chromium', viewport: { width: 900, height: 650 } },
  webServer: { command: 'node tests/browser/serve_framework.mjs', url: 'http://127.0.0.1:4176', reuseExistingServer: false },
})
