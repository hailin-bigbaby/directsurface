import { test, expect } from 'playwright/test'

// Render and interaction contracts execute through the built public package.
declare const gridUnderTest: any

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => 'renderingUnderTest' in window)
  await page.evaluate(() => { (globalThis as any).gridUnderTest = (globalThis as any).renderingUnderTest })
})

for (const dpr of [1, 1.25, 1.5, 2, 3]) for (const dark of [false, true]) {
  test(`DataGrid frame with frozen columns, merges, auto heights and editing at DPR ${dpr}, ${dark ? 'dark' : 'light'}`, async ({ page }, info) => {
    await page.evaluate(() => { document.body.innerHTML = ''; document.body.style.margin = '0' })

    const result = await page.evaluate(({ dpr, dark }) => {
      const { RenderDataGrid, PaintContext, DrawList, FocusManager, InputComposer, PopupManager } = gridUnderTest
      const theme = dark ? gridUnderTest.ImGuiDarkTheme : gridUnderTest.ImGuiLightTheme
      const tokens = { windowBg: theme.surfaceDataBody, windowBorder: theme.borderWindow, frameRounding: theme.frameRounding }
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(450 * dpr)
      canvas.height = Math.ceil(330 * dpr)
      canvas.style.display = 'none'
      document.body.append(canvas)
      const ctx = canvas.getContext('2d')!
      ctx.scale(dpr, dpr)
      const context = new PaintContext(ctx, theme)
      const offset = { x: 10.25, y: 10.25 }
      const grid = new RenderDataGrid({
        columns: [
          { key: 'group', title: 'Group', type: 'text', width: 70, pinned: 'left', mergeRows: true },
          { key: 'text', title: 'Description', type: 'text', width: 130, autoRowHeight: true, filterable: true },
          { key: 'extra', title: 'Other', type: 'text', width: 280 },
          { key: 'id', title: 'ID', type: 'number', width: 60, pinned: 'right' },
        ],
        rows: Array.from({ length: 24 }, (_, id) => ({ id, group: `G${Math.floor(id / 4)}`, text: id % 3 === 0 ? 'Several lines of wrapping content in this row' : 'Short', extra: 'Details' })),
        rowHeight: 26, headerHeight: 28, editable: true, filterRowVisible: true,
        summary: [{ key: 'id', aggregate: 'sum' }],
        validateCell: ({ value }) => value === 'invalid' ? 'Rejected' : true,
      })
      grid.offset = offset
      const layout = () => grid.layout({ minWidth: 0, maxWidth: 420, minHeight: 0, maxHeight: 300 }, false, { theme })
      layout()
      const reference = document.createElement('canvas')
      reference.width = canvas.width
      reference.height = canvas.height
      const ref = reference.getContext('2d')!
      ref.scale(dpr, dpr)
      const dl = new DrawList(new PaintContext(ref, theme))
      dl.fillRect(offset.x, offset.y, 420, 300, tokens.windowBg, tokens.frameRounding)
      dl.strokeRect(offset.x, offset.y, 420, 300, tokens.windowBorder, 1, tokens.frameRounding)
      const failures: string[] = []
      const states: string[] = []
      const paint = (state: string) => {
        ctx.clearRect(0, 0, 450, 330)
        grid.paint(context, offset)
        states.push(state)
        for (let y = offset.y + 12; y < offset.y + 288; y += 7) {
          for (const x of [Math.round(offset.x * dpr), Math.round((offset.x + 420) * dpr) - Math.floor(dpr)]) {
            const actual = Array.from(ctx.getImageData(x, Math.floor(y * dpr), Math.floor(dpr), 1).data)
            const expected = Array.from(ref.getImageData(x, Math.floor(y * dpr), Math.floor(dpr), 1).data)
            if (actual.join() !== expected.join()) failures.push(`${state}: ${x},${y}: ${actual} != ${expected}`)
          }
        }
        if (['striped and merged', 'editing error', 'scrolled'].includes(state)) {
          const panel = document.createElement('figure')
          panel.style.cssText = 'display:inline-block;margin:4px;vertical-align:top'
          const title = document.createElement('figcaption')
          title.textContent = state
          const image = document.createElement('img')
          image.src = canvas.toDataURL()
          image.style.width = '450px'
          panel.append(title, image)
          document.body.append(panel)
        }
      }
      try {
        paint('striped and merged')
        const heights = [0, 1, 2, 3].map(i => grid.viewport.rowHeightAt(i))
        const hoverY = offset.y + grid.viewport.headerSectionHeight + grid.viewport.rowOffset(1) + 5
        grid.onPointerMove({ pointerId: 1, type: 'move', position: { x: offset.x + 100, y: hoverY } })
        paint('hover')
        const hovered = grid.interaction.hoveredItemIndex
        grid.setSelectedRows([0, 1, 2])
        paint('selected')
        grid.selectCell(1, 'text')
        grid.focusIn()
        paint('focus')
        const edited = grid.beginEdit(1, 'text')
        paint('editing')
        grid.structureEditing.commitVisibleCell(1, 1, 'invalid')
        paint('editing error')
        const error = grid.structureEditing.cellErrorForSource(1, 'text')
        grid.cancelEdit()
        grid.viewport.setScrollX(grid.visibleColumns, 90)
        grid.viewport.setScrollY(grid.dataModel.visibleItems().length, 100)
        grid.markNeedsPaint()
        paint('scrolled')
        const scrolled = { x: grid.viewport.scrollX, y: grid.viewport.scrollY }
        const afterHeights = [0, 1, 2, 3].map(i => grid.viewport.rowHeightAt(i))
        grid.viewport.setScrollY(grid.dataModel.visibleItems().length, 100000)
        paint('scroll end')
        grid.disabled = true
        paint('disabled')
        grid.disabled = false
        grid.dataState = 'loading'
        paint('loading')
        grid.dataState = 'error'
        paint('error')
        grid.dataState = 'ready'
        grid.rows = []
        layout()
        paint('empty')
        return { failures, states, heights, afterHeights, hovered, edited, error: !!error, scrolled }
      } finally {
        grid.dispose()
        PopupManager.disposeInstance()
        FocusManager.disposeInstance()
        InputComposer.disposeInstance()
      }
    }, { dpr, dark })
    expect(result.heights[0]).toBeGreaterThan(result.heights[1]!)
    expect(result.afterHeights).toEqual(result.heights)
    expect(result.hovered).toBe(1)
    expect(result.edited).toBe(true)
    expect(result.error).toBe(true)
    expect(result.scrolled).toEqual({ x: 90, y: 100 })
    expect(result.states).toHaveLength(12)
    expect(result.failures).toEqual([])
    await page.screenshot({ path: info.outputPath('data-grid-borders.png'), fullPage: true })
  })
}

for (const dpr of [1, 1.25, 2]) test(`merged DataGrid gridlines survive clipped variable rows at DPR ${dpr}`, async ({ page }) => {
  await page.evaluate(() => { document.body.innerHTML = ''; document.body.style.margin = '0' })

  const result = await page.evaluate(dpr => {
    const { RenderDataGrid, PaintContext, ImGuiLightTheme, FocusManager, InputComposer, PopupManager } = gridUnderTest
    const red = { r: 240, g: 0, b: 0, a: 1 }
    const white = { r: 255, g: 255, b: 255, a: 1 }
    const theme = { ...ImGuiLightTheme, borderData: red, surfaceDataBody: white, surfaceCanvas: white }
    const canvas = document.createElement('canvas')
    canvas.width = 400 * dpr
    canvas.height = 300 * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    const grid = new RenderDataGrid({ columns: [
      { key: 'group', title: 'Group', type: 'text', width: 80, mergeRows: true },
      { key: 'text', title: 'Text', type: 'text', width: 220, autoRowHeight: true },
    ], rows: Array.from({ length: 12 }, (_, i) => ({ group: i < 3 ? 'Merged' : String(i), text: i === 1 ? 'one\ntwo\nthree' : 'Short' })),
    rowHeight: 26, headerHeight: 28 })
    grid.layout({ minWidth: 0, maxWidth: 320, minHeight: 0, maxHeight: 240 }, false, { theme })
    const context = new PaintContext(ctx, theme)
    const pixel = (x: number, y: number) => Array.from(ctx.getImageData(Math.round(x * dpr), Math.floor(y * dpr), 1, 1).data)
    const samples: { gap: number[]; line: number[]; end: number[] }[] = []
    try {
      for (const scroll of [0, 11, grid.viewport.rowOffset(1) + 3]) {
        grid.viewport.setScrollY(12, scroll)
        ctx.clearRect(0, 0, 400, 300)
        grid.paint(context, { x: 0, y: 0 })
        const boundary = 28 + grid.viewport.rowOffset(2) - grid.viewport.scrollY
        const end = 28 + grid.viewport.rowOffset(3) - grid.viewport.scrollY
        samples.push({ gap: pixel(60, boundary), line: pixel(150, boundary), end: pixel(60, end) })
      }
      grid.viewport.setScrollY(12, 0)
      grid.selectCell(1, 'text', { scroll: false })
      grid.focusIn()
      ctx.clearRect(0, 0, 400, 300)
      grid.paint(context, { x: 0, y: 0 })
      const focusGap = pixel(60, 28 + grid.viewport.rowOffset(1) + 1)
      return { samples, focusGap }
    } finally {
      grid.dispose()
      PopupManager.disposeInstance()
      FocusManager.disposeInstance()
      InputComposer.disposeInstance()
    }
  }, dpr)
  expect(result.focusGap.slice(0, 3)).toEqual([255, 255, 255])
  for (const sample of result.samples) {
    expect(sample.gap.slice(0, 3)).toEqual([255, 255, 255])
    // A 0.5 CSS-pixel line is partially covered at DPR 1 / 1.25.
    for (const line of [sample.line, sample.end]) {
      expect(line[0]! - line[1]!).toBeGreaterThan(70)
      expect(line[1]).toBe(line[2])
    }
  }
})
