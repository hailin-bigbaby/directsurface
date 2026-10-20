import { expect, test } from 'playwright/test'

declare const chartsUnderTest: typeof import('../../src/index') & { charts: typeof import('../../src/index') }

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => 'renderingUnderTest' in window)
  await page.evaluate(() => {
    const api = (globalThis as any).renderingUnderTest
    ;(globalThis as any).chartsUnderTest = { ...api, charts: api }
  })
})

for (const ratio of [1, 2]) {
  test(`chart text fits real Canvas bounds and wrapped legends remain clickable at scale ${ratio}`, async ({ page }, testInfo) => {
    await page.evaluate(() => { document.body.style.cssText = 'margin:0;background:white' })
    const result = await page.evaluate(ratio => {
      const { charts, PaintContext, ImGuiLightTheme, createTheme } = chartsUnderTest
      const overflow: object[] = []
      const toggleFailures: string[] = []
      const rows: number[] = []
      const names = ['第一项趋势指标', 'Second series label', '第三项数据', 'Fourth']
      for (const fontSize of [14, 28]) {
        const theme = createTheme(ImGuiLightTheme, { fontSize })
        const series = names.map((name, index) => ({ name, data: [{ x: 0, y: 10 + index }, { x: 1, y: 20 + index }] }))
        for (const width of [180, 280]) {
          const subjects = [
            new charts.RenderComboChart({ categories: ['较长分类甲', 'Category B'], series: names.map((name, i) => ({ name, type: i % 2 ? 'line' as const : 'bar' as const, data: [10, 20] })), height: 260, legendMode: 'toggle' }),
            new charts.RenderScatterChart({ series: names.map((name, i) => ({ name, data: [{ x: i + 10, y: i + 20 }, { x: i + 20, y: i + 30 }] })), height: 260, legendMode: 'toggle' }),
            new charts.RenderLineChart({ series, height: 260, legendMode: 'toggle', yAxis: { unit: '人次' } }),
            new charts.RenderBarChart({ categories: ['较长分类甲', 'Category B'], series: names.map(name => ({ name, data: [10, 20] })), height: 260, legendMode: 'toggle' }),
            new charts.RenderBarChart({ categories: ['较长分类甲', 'Category B'], series: names.map(name => ({ name, data: [10, 20] })), height: 260, orientation: 'horizontal', legendMode: 'toggle' }),
            new charts.RenderDonutChart({ segments: names.map(label => ({ label, value: 10 })), height: 260, legendMode: 'toggle' }),
          ]
          for (const chart of subjects) {
            const height = 260
            const canvas = document.createElement('canvas')
            canvas.width = (width + 40) * ratio
            canvas.height = (height + 40) * ratio
            canvas.style.width = `${width + 40}px`
            canvas.style.height = `${height + 40}px`
            document.body.append(canvas)
            const ctx = canvas.getContext('2d')!
            ctx.scale(ratio, ratio)
            ctx.fillStyle = 'white'
            ctx.fillRect(0, 0, width + 40, height + 40)
            const draws: Array<{ text: string; x: number; y: number }> = []
            const fillText = ctx.fillText.bind(ctx)
            ctx.fillText = (text, x, y) => {
              const metric = ctx.measureText(text)
              if (text && (x - metric.actualBoundingBoxLeft < 19 || x + metric.actualBoundingBoxRight > width + 21 || y - metric.actualBoundingBoxAscent < 19 || y + metric.actualBoundingBoxDescent > height + 21)) {
                overflow.push({ type: chart.constructor.name, width, fontSize, text, x, y,
                  left: x - metric.actualBoundingBoxLeft, right: x + metric.actualBoundingBoxRight,
                  top: y - metric.actualBoundingBoxAscent, bottom: y + metric.actualBoundingBoxDescent })
              }
              draws.push({ text, x, y })
              fillText(text, x, y)
            }
            chart.layout({ minWidth: 0, maxWidth: width, minHeight: 0, maxHeight: height }, false, { theme })
            chart.paint(new PaintContext(ctx, theme), { x: 20, y: 20 })
            if (chart instanceof charts.RenderLineChart && width === 280 && fontSize === 14) {
              const legend = draws.filter(draw => names.includes(draw.text))
              rows.push(new Set(legend.map(draw => draw.y)).size)
              const target = legend.find(draw => draw.text === names[2])!
              chart.onPointerDown({ pointerId: 1, type: 'down', position: { x: target.x - 20, y: target.y - 20 } })
              if (chart.isSeriesVisible(2)) toggleFailures.push('wrapped legend did not toggle')
              chart.layout({ minWidth: 0, maxWidth: width, minHeight: 0, maxHeight: height }, false, { theme })
              ctx.clearRect(0, 0, width + 40, height + 40)
              const plot = chart.debugState().plot
              chart.onPointerMove({ pointerId: 1, type: 'move', position: { x: plot.x, y: plot.y + plot.height / 2 } })
              chart.paint(new PaintContext(ctx, theme), { x: 20, y: 20 })
            }
            chart.dispose()
          }
        }
      }
      return { overflow, toggleFailures, rows }
    }, ratio)
    expect(result.overflow).toEqual([])
    expect(result.toggleFailures).toEqual([])
    expect(result.rows.every(rows => rows > 1)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('charts.png'), fullPage: true })
  })
}

for (const ratio of [1, 2]) {
  test(`combo and scatter use native routing and preserve painted geometry at DPR ${ratio}`, async ({ page }, testInfo) => {
    await page.evaluate(() => { document.body.style.cssText = 'margin:20px;background:white' })
    const result = await page.evaluate(ratio => {
      const { charts, RuntimeHost } = chartsUnderTest
      const results: Array<{ clicks: number; hidden: boolean; hoverItems: number; marker: boolean; gap: boolean }> = []
      for (const kind of ['combo', 'scatter']) {
        const canvas = document.createElement('canvas')
        document.body.append(canvas)
        const host = new RuntimeHost({ canvas, dpr: ratio, getViewportSize: () => ({ width: 400, height: 260 }) })
        let clicks = 0
        const red = { r: 220, g: 20, b: 50, a: 1 }
        const chart = kind === 'combo' ? new charts.RenderComboChart({
          categories: ['A', 'B', 'C', 'D'], height: 240, legendMode: 'toggle',
          series: [{ name: 'Actual', type: 'bar', color: { r: 20, g: 130, b: 80, a: 1 }, data: [10, 20, 30, 40] },
            { name: 'Target', type: 'line', color: red, data: [15, null, 25, 35] }],
          onItemClick: () => clicks++,
        }) : new charts.RenderScatterChart({ series: [{ name: 'Observations', color: red,
          data: [{ id: 'a', x: 10, y: 20 }, { id: 'b', x: 30, y: 40 }] }], height: 240, legendMode: 'toggle', onPointClick: () => clicks++ })
        try {
          host.addRoot(chart)
          const roots = new Set([chart])
          host.registerLayer({ layer: 'main', paint: ({ context }) => host.paintRoots(context),
            shouldPaint: () => host.isLayerDirty('main') || host.hasDirtyPaintForRoots(roots),
            dirtyRect: () => host.getDirtyPaintRectForRoots(roots) })
          host.renderFrame()
          const state = chart.debugState()
          const point = state.points[0]!
          const next = state.points[1]!
          const redAt = (x: number, y: number): boolean => {
            const pixel = canvas.getContext('2d')!.getImageData(Math.round((x + chart.globalOffset.x) * ratio), Math.round((y + chart.globalOffset.y) * ratio), 1, 1).data
            return pixel[0]! > 150 && pixel[1]! < 80 && pixel[2]! < 100
          }
          const marker = redAt(point.x, point.y)
          const gap = !redAt((point.x + next.x) / 2, (point.y + next.y) / 2)
          const mouse = (type: string, x: number, y: number) => {
            const rect = canvas.getBoundingClientRect()
            canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0,
              buttons: type === 'mousedown' ? 1 : 0, clientX: rect.left + chart.globalOffset.x + x, clientY: rect.top + chart.globalOffset.y + y }))
          }
          mouse('mousemove', point.x, point.y)
          host.renderFrame()
          const hoverItems = chart.debugState().tooltip?.items.length ?? 0
          mouse('mousedown', point.x, point.y)
          mouse('mouseup', point.x, point.y)
          const legend = chart.debugState().legend[0]!
          mouse('mousedown', legend.x + 4, legend.y + legend.height / 2)
          mouse('mouseup', legend.x + 4, legend.y + legend.height / 2)
          host.renderFrame()
          results.push({ clicks, hidden: !chart.isSeriesVisible(0), hoverItems, marker, gap })
          chart.setVisibleSeries()
          host.markAllLayersDirty()
          host.renderFrame()
        } finally { host.dispose(); chart.dispose() }
      }
      return results
    }, ratio)
    expect(result).toEqual([
      { clicks: 1, hidden: true, hoverItems: 2, marker: true, gap: true },
      { clicks: 1, hidden: true, hoverItems: 2, marker: true, gap: true },
    ])
    await page.screenshot({ path: testInfo.outputPath('combo-scatter.png'), fullPage: true })
  })
}
