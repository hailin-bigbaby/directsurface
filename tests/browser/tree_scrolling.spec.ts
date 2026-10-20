import { expect, test } from 'playwright/test'

declare const treeUnderTest: typeof import('../../src/index')

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => 'renderingUnderTest' in window)
  await page.evaluate(() => {
    const api = (globalThis as any).renderingUnderTest
    ;(globalThis as any).treeUnderTest = api
  })
})

for (const dpr of [1, 2]) {
  test(`TreeView owns automatic two-axis scrolling at DPR ${dpr}`, async ({ page }, testInfo) => {
    await page.evaluate(() => { document.body.style.cssText = 'margin:20px;background:white' })
    const result = await page.evaluate(dpr => {
      const { RenderTreeView, RuntimeHost, DrawList } = treeUnderTest
      const canvas = document.createElement('canvas')
      document.body.append(canvas)
      let root: import('../../src/widgets/tree').TreeNode = { key: '12', label: 'Complete leaf content '.repeat(4) + 'END' }
      for (let depth = 11; depth >= 0; depth--) root = { key: String(depth), label: `RenderNode #${depth}`, children: [root] }
      const tree = new RenderTreeView({ roots: [root] })
      const host = new RuntimeHost({ canvas, dpr, getViewportSize: () => ({ width: 260, height: 240 }) })
      const calls: Array<{ text: string; x: number }> = []
      const original = DrawList.prototype.fillText
      DrawList.prototype.fillText = function(...args) {
        calls.push({ text: args[0], x: args[1] })
        return original.apply(this, args)
      }
      const mouse = (type: string, x: number, y: number) => {
        const rect = canvas.getBoundingClientRect()
        canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'mouseup' ? 0 : 1,
          clientX: rect.left + x, clientY: rect.top + y }))
      }
      try {
        host.addRoot(tree)
        const roots = new Set([tree])
        host.registerLayer({ layer: 'main', paint: ({ context }) => host.paintRoots(context, root => root === tree),
          shouldPaint: () => host.isLayerDirty('main') || host.hasDirtyPaintForRoots(roots),
          dirtyRect: () => host.getDirtyPaintRectForRoots(roots),
        })
        host.renderFrame()
        const initial = tree.debugState()
        for (let depth = 0; depth < 12; depth++) {
          tree.expandedKeys = Array.from({ length: depth + 1 }, (_, i) => String(i))
          host.renderFrame()
        }
        const expanded = tree.debugState()
        tree.selectedKey = '12'
        host.renderFrame()
        const revealed = tree.debugState()
        const y = (revealed.viewportHeight + tree.size.height) / 2
        // Jump to the right end of the horizontal track through real input routing.
        mouse('mousedown', revealed.viewportWidth - 3, y)
        mouse('mouseup', revealed.viewportWidth - 3, y)
        host.renderFrame()
        const atEnd = tree.debugState()
        calls.length = 0
        host.markAllLayersDirty()
        host.renderFrame()
        const fullText = calls.find(call => call.text.endsWith('END'))
        const bottomTarget = tree.nodeAtPosition({ x: 15, y })
        const rect = canvas.getBoundingClientRect()
        canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: rect.left + 30, clientY: rect.top + 30, deltaX: -80, deltaY: 0 }))
        host.renderFrame()
        const wheelX = tree.debugState().scrollX
        // Move the thumb to the left, then cancel/finish through the native route.
        const scrollRatio = wheelX / (atEnd.totalContentW - atEnd.viewportWidth)
        const thumbX = Math.max(8, Math.min(atEnd.viewportWidth - 8, scrollRatio * atEnd.viewportWidth))
        mouse('mousedown', thumbX, y)
        mouse('mousemove', 8, y)
        mouse('mouseup', 8, y)
        host.renderFrame()
        const draggedX = tree.debugState().scrollX
        tree.collapseAll()
        host.renderFrame()
        const collapsed = tree.debugState()
        tree.expandAll()
        tree.selectedKey = '12'
        tree.revealSelectedKey()
        host.renderFrame()
        const finalAligned = tree.debugState().scrollX < atEnd.scrollX
        const beforeFull = canvas.toDataURL()
        host.markAllLayersDirty()
        host.renderFrame()
        const repaintMatches = beforeFull === canvas.toDataURL()
        return {
          finalAligned, repaintMatches,
          initial: initial.showHBar, expanded: expanded.showHBar && expanded.showVBar,
          revealed: revealed.scrollX > 0 && revealed.scrollY > 0,
          atEnd: Math.abs(atEnd.scrollX - (atEnd.totalContentW - atEnd.viewportWidth)) < 1,
          fullText: !!fullText, textShifted: !!fullText && fullText.x < 0,
          bottomTarget: bottomTarget?.key ?? null, wheelMoved: wheelX < atEnd.scrollX, dragged: draggedX < wheelX,
          collapsed: { x: collapsed.scrollX, y: collapsed.scrollY, h: collapsed.showHBar, v: collapsed.showVBar },
          targetsInside: atEnd.visibleNodes.every(node => node.rect.y + node.rect.height <= atEnd.viewportHeight),
        }
      } finally { DrawList.prototype.fillText = original; host.dispose(); tree.dispose() }
    }, dpr)
    expect(result).toEqual({ finalAligned: true, repaintMatches: true, initial: false, expanded: true, revealed: true, atEnd: true, fullText: true,
      textShifted: true, bottomTarget: null, wheelMoved: true, dragged: true, collapsed: { x: 0, y: 0, h: false, v: false }, targetsInside: true })
    await page.screenshot({ path: testInfo.outputPath('tree-auto-scroll.png'), fullPage: true })
  })
}
