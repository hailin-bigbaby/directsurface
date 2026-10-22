import { expect, test } from 'playwright/test'

declare const renderingUnderTest: typeof import('../../src/index')

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => 'renderingUnderTest' in window)
})

test('the public Inspector retains expansion while diagnostics update', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { RenderLayoutInspectorView } = renderingUnderTest
    const view = new RenderLayoutInspectorView()
    const selected = { debugId: 1, typeName: 'RenderTextBox', visible: true, offset: { x: 0, y: 0 }, globalOffset: { x: 0, y: 0 }, size: { width: 100, height: 30 }, needsLayout: false, needsPaint: false }
    const state = { enabled: true, overlayVisible: false, hoverPathLength: 1, selectedPathLength: 1, selectedPathIndex: 0, selectedPathInfo: [selected], hoverPathInfo: [], selected }
    try {
      view.setInspectorState(state)
      const inspector = view.debugObjectInspector()
      inspector.expandNode('layoutInspector.selected.selected')
      const before = inspector.debugState().expandedKeys
      view.setInspectorState({ ...state, hoverPathLength: 5 })
      return { before, after: inspector.debugState().expandedKeys, hover: (inspector.value as any).overlay.hoverPathLength }
    } finally { view.dispose() }
  })
  expect(result.after).toEqual(result.before)
  expect(result.hover).toBe(5)
})

test('independent transient paint is clipped by the public scroll viewport', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { RenderText, RenderStackPanel, RenderScrollViewer, PaintContext } = renderingUnderTest
    class TransientText extends RenderText {
      override performTransientPaint(context: InstanceType<typeof PaintContext>, offset: { x: number; y: number }) {
        context.ctx.fillStyle = '#ff0000'
        context.ctx.fillRect(offset.x, offset.y, 80, 80)
      }
    }
    const body = new RenderStackPanel({ orientation: 'vertical', spacing: 0 })
    const spacer = new RenderText(''); spacer.height = 10
    const child = new TransientText(''); child.height = 80
    body.addChild(spacer); body.addChild(child)
    const scroll = new RenderScrollViewer({ child: body })
    scroll.layout({ minWidth: 100, maxWidth: 100, minHeight: 40, maxHeight: 40 })
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 100
    const ctx = canvas.getContext('2d')!
    try {
      child.paintTransient(new PaintContext(ctx), child.globalOffset)
      return { inside: Array.from(ctx.getImageData(20, 20, 1, 1).data), outside: Array.from(ctx.getImageData(20, 70, 1, 1).data) }
    } finally { scroll.dispose() }
  })
  expect(result.inside).toEqual([255, 0, 0, 255])
  expect(result.outside).toEqual([0, 0, 0, 0])
})
