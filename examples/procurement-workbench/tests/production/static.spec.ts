import { test, expect } from '@playwright/test'
test('production build starts under a subpath without test globals or external assets', async ({ page }) => {
  const failures: string[] = []; const resources: string[] = []
  page.on('response', response => { resources.push(response.url()); if (response.status() >= 400) failures.push(response.url()) })
  page.on('pageerror', error => failures.push(error.message))
  await page.goto('./')
  await expect(page.locator('#bootstrap')).toBeHidden({ timeout: 30_000 })
  expect(await page.evaluate(() => '__PROCUREMENT__' in window)).toBe(false)
  expect(failures).toEqual([])
  expect(resources.every(url => url.startsWith('http://127.0.0.1:4193/office/'))).toBe(true)
  await page.screenshot({ path: 'test-results/production.png' })
  await page.reload(); await expect(page.locator('#bootstrap')).toBeHidden({ timeout: 30_000 })
})
