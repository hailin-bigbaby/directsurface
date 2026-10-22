import { test, expect } from 'playwright/test'

// Render and interaction contracts execute through the built public package.
declare const bordersUnderTest: any

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => 'renderingUnderTest' in window)
  await page.evaluate(() => { (globalThis as any).bordersUnderTest = (globalThis as any).renderingUnderTest })
})

for (const dpr of [1, 1.25, 2, 3]) for (const dark of [false, true]) {
  test(`component frame ownership at DPR ${dpr}, ${dark ? 'dark' : 'light'}`, async ({ page }, info) => {
    await page.evaluate(() => { document.body.innerHTML = ''; document.body.style.margin = '0' })

    const result = await page.evaluate(({ dpr, dark }) => {
      const a = bordersUnderTest
      const theme = dark ? a.ImGuiDarkTheme : a.ImGuiLightTheme
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(600 * dpr); canvas.height = Math.ceil(300 * dpr)
      const ctx = canvas.getContext('2d')!
      ctx.scale(dpr, dpr)
      const context = new a.PaintContext(ctx, theme)
      const offset = { x: 20, y: 20 }
      const failures: string[] = [], checked: string[] = []
      const pixel = (c: CanvasRenderingContext2D, x: number, y: number) => Array.from(c.getImageData(x, y, 1, 1).data).join()
      function layout(widget: any, w = 260, h = 180) {
        widget.offset = offset
        widget.layout({ minWidth: w, maxWidth: w, minHeight: h, maxHeight: h }, false, { theme })
      }
      function check(name: string, paint: () => void, width: number, height: number, bg: any, border: any, radius: number, borderWidth = 1) {
        ctx.clearRect(0, 0, 600, 300); paint(); checked.push(name)
        const reference = document.createElement('canvas'); reference.width = canvas.width; reference.height = canvas.height
        const r = reference.getContext('2d')!; r.scale(dpr, dpr)
        const dl = new a.DrawList(new a.PaintContext(r, theme))
        dl.fillRect(20, 20, width, height, bg, radius)
        dl.strokeRect(20, 20, width, height, border, borderWidth, radius)
        const inset = Math.max(radius + 2, 8)
        const points: Array<[number, number]> = []
        for (let y = 20 + inset; y < 20 + height - inset; y += 9) {
          points.push([Math.round(20 * dpr), Math.floor(y * dpr)], [Math.round((20 + width) * dpr) - 1, Math.floor(y * dpr)])
        }
        for (let x = 20 + inset; x < 20 + width - inset; x += 17) {
          points.push([Math.floor(x * dpr), Math.round(20 * dpr)], [Math.floor(x * dpr), Math.round((20 + height) * dpr) - 1])
        }
        for (const [x, y] of points) if (pixel(ctx, x, y) !== pixel(r, x, y)) failures.push(`${name} at ${x},${y}: ${pixel(ctx, x, y)} != ${pixel(r, x, y)}`)
        if (['tree scrolled', 'property selected', 'border child'].includes(name)) {
          const panel = document.createElement('figure'); panel.style.cssText = 'display:inline-block;margin:4px;vertical-align:top'
          const title = document.createElement('figcaption'); title.textContent = name
          const img = document.createElement('img'); img.src = canvas.toDataURL(); img.style.width = '600px'
          panel.append(title, img); document.body.append(panel)
        }
      }
      const gridStyle = { windowBg: theme.surfaceDataBody, windowBorder: theme.borderWindow, frameRounding: theme.frameRounding }
      const tree = new a.RenderTreeGrid({ columns: [
        { key: 'name', title: 'Name', type: 'text', width: 80, pinned: 'left' },
        { key: 'value', title: 'Value', type: 'text', width: 180 },
        { key: 'tail', title: 'Tail', type: 'text', width: 60, pinned: 'right' },
      ], roots: Array.from({ length: 20 }, (_, i) => ({ key: String(i), row: { name: `N${i}`, value: 'Value', tail: 'T' } })), treeColumnKey: 'name', rowHeight: 26, headerHeight: 28, editable: true })
      layout(tree)
      const paintTree = () => check('tree striped', () => tree.paint(context, offset), 260, 180, gridStyle.windowBg, gridStyle.windowBorder, gridStyle.frameRounding)
      paintTree()
      tree.onPointerMove({ pointerId: 1, type: 'move', position: { x: 40, y: 85 } }); paintTree()
      tree.onPointerDown({ pointerId: 1, type: 'down', position: { x: 40, y: 85 } }); paintTree()
      const treeEditing = tree.beginEdit(1, 'value')
      check('tree editing', () => tree.paint(context, offset), 260, 180, gridStyle.windowBg, gridStyle.windowBorder, gridStyle.frameRounding)
      tree.cancelEdit()
      tree._viewport.setScrollX(tree.columns, 40); tree._viewport.setScrollY(20, 60)
      check('tree scrolled', () => tree.paint(context, offset), 260, 180, gridStyle.windowBg, gridStyle.windowBorder, gridStyle.frameRounding)
      tree.dispose()
      const items = Array.from({ length: 20 }, (_, i) => ({ key: String(i), label: `Item ${i}` }))
      const list = new a.RenderListView({ items }); layout(list)
      const ls = { panelBg: theme.surfacePanel, panelBorder: theme.borderPanel, borderRadius: theme.frameRounding }
      for (const state of ['normal', 'hover', 'selected', 'scroll', 'disabled']) {
        if (state === 'hover') list.onPointerMove({ pointerId: 1, type: 'move', position: { x: 40, y: 60 } })
        if (state === 'selected') list.selectedItem = items[0]
        if (state === 'scroll') list.onWheel({ pointerId: 1, type: 'wheel', position: { x: 40, y: 60 }, deltaY: 1, deltaX: 0 })
        if (state === 'disabled') list.disabled = true
        check(`list ${state}`, () => list.paint(context, offset), 260, 180, ls.panelBg, ls.panelBorder, ls.borderRadius)
      }
      list.dispose()
      const property = new a.RenderPropertyGrid({ rows: Array.from({ length: 12 }, (_, i) => ({ id: String(i), group: 'Group', name: `P${i}`, value: String(i), editable: true })), showDescriptionPanel: true, nameColumnWidth: 100 })
      layout(property)
      property.selectedRowId = '1'
      check('property selected', () => property.paint(context, offset), 260, 180, theme.surfacePanel, theme.borderPanel, 0)
      property.onWheel({ pointerId: 1, type: 'wheel', position: { x: 40, y: 60 }, deltaY: 1, deltaX: 0 })
      check('property scrolled', () => property.paint(context, offset), 260, 180, theme.surfacePanel, theme.borderPanel, 0)
      property.dispose()
      class Solid extends a.RenderBox {
        visitChildren() {}
        performLayout(c: any) { this.size = { width: c.maxWidth, height: c.maxHeight } }
        performPaint(c: any, o: any) { new a.DrawList(c).fillRect(o.x, o.y, this.size.width, this.size.height, theme.accentPrimary) }
      }
      const border = new a.RenderBorder({ child: new Solid(), padding: 0, background: theme.surfacePanel, borderColor: theme.borderPanel, borderWidth: 2, cornerRadius: 8 })
      layout(border)
      check('border child', () => border.paint(context, offset), 260, 180, theme.surfacePanel, theme.borderPanel, 8, 2)
      border.dispose()
      const ps = { trackBg: theme.surfaceControl, trackBorder: theme.borderControl }
      const progress = new a.RenderProgressBar({ value: 0, height: 20 }); layout(progress, 240, 20)
      for (const value of [0, .5, 1, -1]) {
        progress.value = value
        for (const phase of value < 0 ? [0, .3, .6, 1] : [0]) {
          progress._animOffset = phase
          check(`progress ${value}/${phase}`, () => progress.paint(context, offset), 240, 20, ps.trackBg, ps.trackBorder, 10)
        }
      }
      progress.dispose()
      const modal = new a.RenderLoadingModal({ progress: .5 })
      check('modal progress', () => modal._paintProgress(context, 20, 20, 240, 20), 240, 20, ps.trackBg, ps.trackBorder, 10)
      modal.dispose()
      return { failures: failures.slice(0, 20), checked, treeEditing }
    }, { dpr, dark })
    expect(result.treeEditing).toBe(true)
    expect(result.checked.length).toBeGreaterThanOrEqual(20)
    expect(result.failures).toEqual([])
    await page.screenshot({ path: info.outputPath('component-frames.png'), fullPage: true })
  })
}

for (const dpr of [1, 1.25, 2]) test(`Markdown shared edges and PropertyGrid names have consistent separators at DPR ${dpr}`, async ({ page }) => {
  await page.evaluate(() => { document.body.innerHTML = ''; document.body.style.margin = '0' });
  const result = await page.evaluate(dpr => {
    const a = bordersUnderTest, white = { r: 255, g: 255, b: 255, a: 1 }, red = { r: 240, g: 0, b: 0, a: 1 }
    const theme = { ...a.ImGuiLightTheme, borderData: red, borderSubtle: red, surfacePanel: white, surfaceControl: white, surfaceDataBody: white }
    const canvas = document.createElement('canvas'); canvas.width = 700; canvas.height = 500
    const ctx = canvas.getContext('2d')!; ctx.scale(dpr, dpr)
    const context = new a.PaintContext(ctx, theme)
    const md = new a.RenderMarkdownViewer({ markdown: '| A | B |\n|---|---|\n| x | y |\n| z | w |', padding: 0, appearance: 'embedded' })
    md.layout({ minWidth: 260, maxWidth: 260, minHeight: 180, maxHeight: 180 }, false, { theme })
    md.paint(context, { x: 20, y: 20 })
    const block = md._layoutBlocks.find((b: any) => b.table), table = block.table
    const row = table.rows[1], left = 20 + block.x, edge = left + table.columns[0], cy = 20 + row.y + row.height / 2
    const coverage = (x: number, y: number, vertical: boolean) => {
      let total = 0
      for (let k = -3; k <= 3; k++) {
        const p = ctx.getImageData(Math.floor(x * dpr) + (vertical ? k : 0), Math.floor(y * dpr) + (vertical ? 0 : k), 1, 1).data
        total += (p[0]! - p[1]!) / 240
      }
      return total
    }
    const outer = coverage(left, cy, true), shared = coverage(edge, cy, true)
    // The right and bottom perimeter must remain visible after clipping.
    const right = coverage(left + table.contentWidth, cy, true)
    const bottom = coverage(left + 30, 20 + table.rows.at(-1).y + table.rows.at(-1).height, false)
    md.dispose()
    const wide = new a.RenderMarkdownViewer({ markdown: '| A | B | C | D |\n|---|---|---|---|\n| | | | |', padding: 0, appearance: 'embedded' })
    wide.layout({ minWidth: 160, maxWidth: 160, minHeight: 180, maxHeight: 180 }, false, { theme })
    const wideBlock = wide._layoutBlocks.find((b: any) => b.table)
    const overflow = wideBlock.table.contentWidth > wideBlock.table.viewportWidth
    wideBlock.table.scrollX = 25
    ctx.clearRect(0, 0, 350, 250)
    wide.paint(context, { x: 20, y: 20 })
    const scrolledEdge = Array.from(ctx.getImageData(Math.round(20 * dpr), Math.floor((20 + wideBlock.table.rows[1].y + 12) * dpr), 1, 1).data)
    wide.dispose()
    ctx.clearRect(0, 0, 350, 250)
    const property = new a.RenderPropertyGrid({ rows: [{ group: 'G', name: 'A', value: '1' }, { group: 'G', name: 'B', value: '2' }], showDescriptionPanel: false, rowHeight: 26, groupHeight: 24, nameColumnWidth: 100 })
    property.layout({ minWidth: 260, maxWidth: 260, minHeight: 180, maxHeight: 180 }, false, { theme })
    property.paint(context, { x: 20, y: 20 })
    const nameLine = coverage(60, 70, false), valueLine = coverage(180, 70, false)
    property.dispose()
    return { outer, shared, right, bottom, nameLine, valueLine, overflow, scrolledEdge }
  }, dpr)
  expect(result.overflow).toBe(true)
  expect(result.scrolledEdge.slice(0, 3)).toEqual([255, 255, 255])
  expect(result.outer).toBeGreaterThan(.3)
  expect(result.shared).toBeCloseTo(result.outer, 1)
  expect(result.right).toBeCloseTo(result.outer, 1)
  expect(result.bottom).toBeCloseTo(result.outer, 1)
  expect(result.nameLine).toBeGreaterThan(.5)
  expect(result.nameLine).toBeCloseTo(result.valueLine, 1)
})

test('TreeGrid clipped state outlines do not bleed into the next column', async ({ page }) => {
  await page.evaluate(() => { document.body.innerHTML = ''; document.body.style.margin = '0' })

  const result = await page.evaluate(() => {
    const a = bordersUnderTest
    const theme = a.ImGuiLightTheme
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 400
    const ctx = canvas.getContext('2d')!; ctx.scale(2, 2)
    const context = new a.PaintContext(ctx, theme)
    let outline = false
    const grid = new a.RenderTreeGrid({
      columns: [
        { key: 'name', title: 'Name', type: 'text', width: 70, pinned: 'left' },
        { key: 'code', title: 'Code', type: 'text', width: 100 },
        { key: 'more', title: 'More', type: 'text', width: 200 },
        { key: 'tail', title: 'Tail', type: 'text', width: 60, pinned: 'right' },
      ], roots: [{ key: 'a', row: { name: 'A', code: '', more: '', tail: 'D' } }],
      treeColumnKey: 'name', rowHeight: 26, headerHeight: 28,
      resolveCellStyle: ({ column }: any) => outline && column.key === 'code' ? { borderColor: { r: 255, g: 0, b: 0, a: 1 } } : {},
    })
    grid.layout({ minWidth: 260, maxWidth: 260, minHeight: 160, maxHeight: 160 }, false, { theme })
    const checks = []
    try {
      for (const visible of [.5, 1.5, 2.25, 3.5]) {
        grid._viewport.setScrollX(grid.columns, 100 - visible)
        const sample = () => {
          ctx.clearRect(0, 0, 300, 200)
          grid.paint(context, { x: 20, y: 20 })
          return Array.from(ctx.getImageData(Math.round((90 + visible) * 2), 120, 6, 2).data)
        }
        outline = false; const plain = sample()
        outline = true; const styled = sample()
        checks.push({ visible, unchanged: plain.join() === styled.join() })
      }
      return checks
    } finally { grid.dispose() }
  })
  expect(result).toEqual([.5, 1.5, 2.25, 3.5].map(visible => ({ visible, unchanged: true })))
})
