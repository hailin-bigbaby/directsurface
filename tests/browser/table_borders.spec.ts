import { test, expect } from 'playwright/test'

// Render and interaction contracts execute through the built public package.
declare const tableUnderTest: any

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => 'renderingUnderTest' in window)
  await page.evaluate(() => { (globalThis as any).tableUnderTest = (globalThis as any).renderingUnderTest })
})

for (const dpr of [1, 1.25, 1.5, 2, 3]) {
  for (const dark of [false, true]) {
    test(`Table perimeter survives row states and scrolling at DPR ${dpr}, ${dark ? 'dark' : 'light'}`, async ({ page }, info) => {
      await page.evaluate(() => { document.body.innerHTML = ''; document.body.style.margin = '0' })

      const result = await page.evaluate(({ dpr, dark }) => {
        const { RenderTable, PaintContext, DrawList, FocusManager } = tableUnderTest
        const theme = dark ? tableUnderTest.ImGuiDarkTheme : tableUnderTest.ImGuiLightTheme
        document.body.style.background = dark ? '#222' : '#fff'
        document.body.style.color = dark ? '#fff' : '#222'
        const style = { normalBg: theme.surfaceDataBody, windowBorder: theme.borderWindow, frameRounding: theme.frameRounding }
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(340 * dpr)
        canvas.height = Math.ceil(270 * dpr)
        canvas.style.width = '340px'
        canvas.style.height = '270px'
        canvas.style.display = 'none'
        document.body.append(canvas)
        const ctx = canvas.getContext('2d')!
        ctx.scale(dpr, dpr)
        const context = new PaintContext(ctx, theme)
        const offset = { x: 10.25, y: 10.25 }
        const table = new RenderTable({
          columns: [{ key: 'id', title: 'ID', width: 80, align: 'center', sortable: true }, { key: 'name', title: 'Name', width: 250 }],
          rows: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `Item ${i + 1}` })),
          rowHeight: 26, headerHeight: 28,
        })
        table.offset = offset
        table.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 240 }, false, { theme })
        const failures: string[] = []
        const states: string[] = []
        const paintAndCheck = (state: string) => {
          ctx.clearRect(0, 0, 340, 270)
          table.paint(context, offset)
          states.push(state)
          // A standalone frame is the perimeter oracle, independent of row fills.
          const reference = document.createElement('canvas')
          reference.width = canvas.width
          reference.height = canvas.height
          const ref = reference.getContext('2d')!
          ref.scale(dpr, dpr)
          const dl = new DrawList(new PaintContext(ref, theme))
          dl.fillRect(offset.x, offset.y, 300, 240, style.normalBg, style.frameRounding)
          dl.strokeRect(offset.x, offset.y, 300, 240, style.windowBorder, 1, style.frameRounding)
          if (['striped', 'keyboard focus', 'partial row and column scroll'].includes(state)) {
            const panel = document.createElement('figure')
            panel.style.cssText = 'display:inline-block;margin:8px;vertical-align:top'
            const title = document.createElement('figcaption')
            title.textContent = state
            const image = document.createElement('img')
            image.src = canvas.toDataURL()
            image.style.width = '340px'
            panel.append(title, image)
            document.body.append(panel)
          }
          const scrollY = table.debugState().scrollY
          for (let row = 0; row < 30; row++) {
            const y = offset.y + 28 + row * 26 - scrollY + 13
            if (y < offset.y + 28 || y > offset.y + 215) continue
            // Compare the fully covered device pixels, excluding fractional edge
            // coverage whose blend naturally depends on the underlying surface.
            for (const x of [Math.round(offset.x * dpr), Math.round((offset.x + 300) * dpr) - Math.floor(dpr)]) {
              const actual = Array.from(ctx.getImageData(x, Math.floor(y * dpr), Math.floor(dpr), 1).data)
              const expected = Array.from(ref.getImageData(x, Math.floor(y * dpr), Math.floor(dpr), 1).data)
              if (actual.join() !== expected.join()) failures.push(`${state}: row ${row}, x ${x}: ${actual} != ${expected}`)
            }
          }
        }
        try {
          paintAndCheck('striped')
          table.onPointerMove({ pointerId: 1, type: 'move', position: { x: 40, y: 50 } })
          paintAndCheck('hover odd')
          table.onPointerMove({ pointerId: 1, type: 'move', position: { x: 40, y: 76 } })
          paintAndCheck('hover even')
          const hoveredRow = table.debugState().hoveredRow
          table.setSelectedRows([0, 1, 2])
          paintAndCheck('selected')
          const selectedCount = table.selectedRows.size
          table.onPointerDown({ pointerId: 1, type: 'down', position: { x: 40, y: 50 } })
          FocusManager.instance.handleKeyDownEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
          paintAndCheck('keyboard focus')
          const focusedRow = table.debugState().focusedRow
          const focusVisible = FocusManager.keyboardFocusVisible
          table.sortState = { key: 'id', order: 'desc' }
          paintAndCheck('sorted header')
          table.onWheel({ pointerId: 1, type: 'wheel', position: { x: 40, y: 76 }, deltaX: 1, deltaY: 1 })
          const partial = table.debugState()
          paintAndCheck('partial row and column scroll')
          for (let i = 0; i < 20; i++) table.onWheel({ pointerId: 1, type: 'wheel', position: { x: 40, y: 76 }, deltaX: 1, deltaY: 1 })
          paintAndCheck('scroll end')
          const end = table.debugState()
          table.rows = []
          paintAndCheck('empty')
          table.rows = [{ id: 1, name: 'Single row' }]
          paintAndCheck('single row')
          return { failures, states, partial, end, hoveredRow, selectedCount, focusedRow, focusVisible }
        } finally {
          table.dispose()
          FocusManager.disposeInstance()
        }
      }, { dpr, dark })
      expect(result.hoveredRow).toBe(1)
      expect(result.selectedCount).toBe(3)
      expect(result.focusedRow).toBe(1)
      expect(result.focusVisible).toBe(true)
      expect(result.partial.scrollX).toBeGreaterThan(0)
      expect(result.partial.scrollY % 26).not.toBe(0)
      expect(result.end.scrollY).toBeGreaterThan(result.partial.scrollY)
      expect(result.states).toHaveLength(10)
      expect(result.failures).toEqual([])
      await page.screenshot({ path: info.outputPath('table-borders.png') })
    })
  }
}
