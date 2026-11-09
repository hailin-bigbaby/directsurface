import { test, expect } from '@playwright/test'

test('saving keeps order content stable while preventing edits and duplicate writes', async ({ page }, info) => {
  await page.goto(`/?namespace=save-stability-${Date.now()}`)
  await expect.poll(() => page.evaluate(() => !!(window as any).__PROCUREMENT__)).toBe(true)
  const before = await page.evaluate(() => {
    const t = (window as any).__PROCUREMENT__, app = t.app, view = t.documents.get(app.activeId)
    const repository = app.repository, save = repository.saveDraft.bind(repository)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const probe = { calls: 0, release, read: () => {
      const canvas = document.querySelector('canvas')!, r = view.supplier.paintBounds
      return Array.from(canvas.getContext('2d')!.getImageData(r.x + 6, r.y + 6, 150, 16).data)
    } }
    repository.saveDraft = async (...args: any[]) => { probe.calls++; await gate; return save(...args) }
    ;(window as any).saveProbe = probe
    return probe.read()
  })
  const click = async (id: string) => {
    const r = await page.evaluate(id => {
      const t = (window as any).__PROCUREMENT__, r = t.commandToolbar.itemRect(id), o = t.commandToolbar.globalOffset
      return { x: r.x + o.x + r.width / 2, y: r.y + o.y + r.height / 2 }
    }, id)
    await page.mouse.click(r.x, r.y)
  }
  await click('order.save')
  await expect.poll(() => page.evaluate(() => !!(window as any).__PROCUREMENT__.app.active.pending)).toBe(true)
  for (let i = 0; i < 8; i++) {
    const pixels = await page.evaluate(() => new Promise<number[]>(resolve => requestAnimationFrame(() => resolve((window as any).saveProbe.read()))))
    expect(pixels).toEqual(before)
  }
  const state = await page.evaluate(() => {
    const t = (window as any).__PROCUREMENT__, v = t.documents.get(t.app.activeId)
    return { readonly: v.supplier.readonly, disabled: v.supplier.disabled, canEdit: v.grid.beginEdit(0, 'quantity'), rect: v.supplier.paintBounds }
  })
  expect(state).toMatchObject({ readonly: true, disabled: false, canEdit: false })
  await page.mouse.click(state.rect.x + 30, state.rect.y + 14)
  expect(await page.evaluate(() => (window as any).__PROCUREMENT__.popupOpen())).toBe(false)
  await click('order.save')
  expect(await page.evaluate(() => (window as any).saveProbe.calls)).toBe(1)
  await page.screenshot({ path: info.outputPath('saving-stable-content.png') })
  await page.evaluate(() => (window as any).saveProbe.release())
  await expect.poll(() => page.evaluate(() => (window as any).__PROCUREMENT__.app.active.pending)).toBeNull()
  await expect.poll(() => page.evaluate(() => (window as any).__PROCUREMENT__.commands.evaluate('order.save').executing)).toBe(false)
  await click('order.submit')
  await expect.poll(() => page.evaluate(() => (window as any).__PROCUREMENT__.overlay.activeModal?.title)).toBe('提交审批')
  // Inspect the settled dialog, not a translucent opening-animation frame.
  await page.waitForTimeout(250)
  await page.screenshot({ path: info.outputPath('submit-confirmation.png') })
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => (window as any).__PROCUREMENT__.app.active.record.status)).toBe('draft')
})
