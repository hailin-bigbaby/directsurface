import { expect, test } from 'playwright/test'

declare const layoutUnderTest: typeof import('../../src/index')

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => 'renderingUnderTest' in window)
  await page.evaluate(() => { (globalThis as any).layoutUnderTest = (globalThis as any).renderingUnderTest })
})

for (const dpr of [1, 2]) {
  test(`speculative text measurements preserve pixels and fixed-width grid rows do not overlap at DPR ${dpr}`, async ({ page }, info) => {
    await page.evaluate(() => { document.body.style.cssText = 'background:white;margin:20px' })
    const result = await page.evaluate(dpr => {
      const { RenderText, RenderParagraph, RenderUniformGrid, PaintContext, ImGuiLightTheme } = layoutUnderTest
      const bounds = (width: number) => ({ minWidth: 0, maxWidth: width, minHeight: 0, maxHeight: Infinity })
      const canvas = document.createElement('canvas')
      canvas.width = 440 * dpr; canvas.height = 400 * dpr
      canvas.style.width = '440px'; canvas.style.height = '400px'
      document.body.append(canvas)
      const ctx = canvas.getContext('2d')!; ctx.scale(dpr, dpr)
      const context = new PaintContext(ctx, ImGuiLightTheme)
      const subjects = [new RenderText('A title that remains ellipsized', { overflow: 'ellipsis' }),
        new RenderParagraph('Predicting a wider layout must not change these narrow lines.')]
      const unchanged = subjects.map((subject, index) => {
        const offset = { x: 10, y: 10 + index * 60 }
        subject.layout(bounds(100), false, { theme: ImGuiLightTheme })
        ctx.clearRect(0, 0, 440, 400); subject.paint(context, offset)
        const before = canvas.toDataURL()
        subject.measure(bounds(400))
        ctx.clearRect(0, 0, 440, 400); subject.paint(context, offset)
        return before === canvas.toDataURL()
      })
      ctx.clearRect(0, 0, 440, 400)
      subjects[0]!.paint(context, { x: 10, y: 10 }); subjects[1]!.paint(context, { x: 10, y: 70 })
      const grid = new RenderUniformGrid({ columns: 1, rowGap: 0, columnGap: 0 })
      const paragraph = new RenderParagraph('This paragraph has a fixed narrow width and needs its full natural height.')
      paragraph.width = 80
      const next = new RenderText('Next row')
      grid.addChild(paragraph); grid.addChild(next)
      grid.layout(bounds(200), false, { theme: ImGuiLightTheme })
      grid.paint(context, { x: 230, y: 10 })
      const separated = next.offset.y >= paragraph.offset.y + paragraph.size.height
      subjects.forEach(subject => subject.dispose()); grid.dispose()
      return { unchanged, separated }
    }, dpr)
    expect(result).toEqual({ unchanged: [true, true], separated: true })
    await page.screenshot({ path: info.outputPath('layout-measurement.png') })
  })
}

test('a measured breakpoint preserves a natively focused sidebar button and its owned popup', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 400 })
  await page.evaluate(() => { document.body.style.margin = '0' })
  const result = await page.evaluate(() => {
    const { RuntimeHost, RenderAdaptiveSidebarPanel, RenderButton, RenderText, PopupManager, FocusManager, ImGuiLightTheme } = layoutUnderTest
    const canvas = document.createElement('canvas'); document.body.append(canvas)
    const host = new RuntimeHost({ canvas, getViewportSize: () => ({ width: 1000, height: 300 }) })
    host.setTheme(ImGuiLightTheme)
    let clicked = 0, closed = 0
    const sidebar = new RenderButton({ label: 'Sidebar action', onClick: () => clicked++ })
    const panel = new RenderAdaptiveSidebarPanel({ sidebar, collapsedSidebar: new RenderButton({ label: 'Compact' }), content: new RenderText('Content') })
    try {
      host.addRoot(panel)
      const roots = new Set([panel])
      host.registerLayer({ layer: 'main', paint: ({ context }) => host.paintRoots(context),
        shouldPaint: () => host.isLayerDirty('main') || host.hasDirtyPaintForRoots(roots), dirtyRect: () => host.getDirtyPaintRectForRoots(roots) })
      host.renderFrame()
      const point = { x: sidebar.globalOffset.x + sidebar.size.width / 2, y: sidebar.globalOffset.y + sidebar.size.height / 2 }
      for (const type of ['mousedown', 'mouseup']) canvas.dispatchEvent(new MouseEvent(type, {
        bubbles: true, button: 0, buttons: type === 'mousedown' ? 1 : 0, clientX: point.x, clientY: point.y,
      }))
      const popup = { hitTest: () => false, close: () => closed++ }
      PopupManager.instance.open(popup, { owner: sidebar, interactionMode: 'passive' })
      const focusedBefore = FocusManager.instance.current === sidebar
      panel.measure({ minWidth: 0, maxWidth: 400, minHeight: 0, maxHeight: 300 })
      host.renderFrame()
      return { clicked, focusedBefore, focusedAfter: FocusManager.instance.current === sidebar,
        expanded: panel.resolvedMode === 'expanded', popupOpen: PopupManager.instance.stack.includes(popup), closed }
    } finally { host.dispose(); panel.dispose() }
  })
  expect(result).toEqual({ clicked: 1, focusedBefore: true, focusedAfter: true, expanded: true, popupOpen: true, closed: 0 })
})
