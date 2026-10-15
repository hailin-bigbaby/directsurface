import { expect, test } from 'playwright/test'

declare const renderingUnderTest: typeof import('../../src/index')

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => 'renderingUnderTest' in window)
})

test('rounded navigation outlines keep equal edge coverage inside a clipped viewport', async ({ page }, info) => {
  const samples = await page.evaluate(() => {
    const { DrawList, PaintContext } = renderingUnderTest
    const samples: Array<{ scale: number; width: number; edges: number[] }> = []
    for (const scale of [1, 1.25, 1.5, 2, 3]) {
      for (const width of [1, 2, 3]) {
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(120 * scale)
        canvas.height = Math.ceil(48 * scale)
        const ctx = canvas.getContext('2d')!
        ctx.scale(scale, scale)
        ctx.translate(0.25, 0.5)
        const dl = new DrawList(new PaintContext(ctx))
        // Horizontal edges touch the list viewport; top/bottom have row spacing.
        dl.pushClip(8, 0, 100, 48)
        dl.strokeRect(8, 8, 100, 32, { r: 16, g: 88, b: 224, a: 1 }, width, 4)
        dl.popClip()
        const vertical = ctx.getImageData(Math.round(58.25 * scale), 0, 1, canvas.height).data
        const horizontal = ctx.getImageData(0, Math.round(24.5 * scale), canvas.width, 1).data
        const coverage = (data: Uint8ClampedArray, start: number, end: number) => {
          let sum = 0
          for (let i = start; i < end; i++) sum += data[i * 4 + 3]!
          return sum
        }
        samples.push({ scale, width, edges: [
          coverage(horizontal, 0, Math.floor(canvas.width / 2)),
          coverage(horizontal, Math.floor(canvas.width / 2), canvas.width),
          coverage(vertical, 0, Math.floor(canvas.height / 2)),
          coverage(vertical, Math.floor(canvas.height / 2), canvas.height),
        ] })
        canvas.style.cssText = 'display:block;margin:8px;width:600px;image-rendering:pixelated'
        document.body.append(canvas)
      }
    }
    return samples
  })
  for (const sample of samples) {
    for (const edge of sample.edges) {
      expect(Math.abs(edge - 255 * sample.scale * sample.width), JSON.stringify(sample)).toBeLessThanOrEqual(2)
    }
  }
  await page.screenshot({ path: info.outputPath('navigation-outline.png'), fullPage: true })
})

test('row separators preserve thickness across positions, fractional DPR and viewport clipping', async ({ page }) => {
  const results = await page.evaluate(() => {
    const { RenderItemContainer, RenderText, DrawList, PaintContext } = renderingUnderTest
    const results = []
    const cases = [0.5, 1, 1.25, 1.5, 2, 3].flatMap(dpr =>
      [0.25, 0.5, 1, 1.5, 2].flatMap(borderWidth =>
        [8, 8.5, 9].flatMap(y => [0, 0.25].map(translation => ({ dpr, borderWidth, y, translation })))))
    for (const { dpr, borderWidth, y, translation } of cases) {
      const coverages = []
      for (const clipped of [false, true]) {
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(120 * dpr)
        canvas.height = Math.ceil(56 * dpr)
        const ctx = canvas.getContext('2d')!
        ctx.scale(dpr, dpr)
        ctx.translate(translation, translation)
        const context = new PaintContext(ctx)
        const dl = new DrawList(context)
        const row = new RenderItemContainer({
          itemKey: 'row', item: {}, index: 0, appearance: 'row',
          template: () => new RenderText(''),
          style: { borderWidth, border: { normalBg: { r: 0, g: 0, b: 0, a: 1 } } },
        })
        row.size = { width: 100, height: 32 }
        if (clipped) dl.pushClip(8, y, 100, 32)
        row.performPaint(context, { x: 8, y })
        if (clipped) dl.popClip()
        const data = ctx.getImageData(60 * dpr, 0, 1, canvas.height).data
        let coverage = 0
        for (let i = 3; i < data.length; i += 4) coverage += data[i]!
        coverages.push(coverage)
        row.dispose()
      }
      results.push({ dpr, borderWidth, y, translation, coverages })
    }
    return results
  })
  for (const result of results) {
    const { dpr, borderWidth, coverages } = result
    expect(coverages[1], JSON.stringify(result)).toBeGreaterThan(0)
    expect(coverages[1], JSON.stringify(result)).toBe(coverages[0])
    expect(Math.abs(coverages[1]! - 255 * dpr * borderWidth), JSON.stringify(result)).toBeLessThanOrEqual(2)
  }
})

test('runtime clock drives loading animations in the same frame at 60, 120 and 144 Hz', async ({ page }) => {
  const results = await page.evaluate(() => {
    const { RuntimeHost, RenderProgressBar, RenderButton, RenderLoadingHost, RenderLoadingModal,
      RenderStackPanel, RenderText } = renderingUnderTest
    const nativeRequest = window.requestAnimationFrame
    const nativeCancel = window.cancelAnimationFrame
    const nativeInterval = window.setInterval
    const frames = new Map<number, FrameRequestCallback>()
    let nextId = 0
    let intervals = 0
    window.requestAnimationFrame = callback => { frames.set(++nextId, callback); return nextId }
    window.cancelAnimationFrame = id => { frames.delete(id) }
    window.setInterval = ((...args: Parameters<typeof window.setInterval>) => {
      intervals++
      return nativeInterval(...args)
    }) as typeof window.setInterval
    const results = []
    try {
      for (const hz of [60, 120, 144]) {
        const canvas = document.createElement('canvas')
        const host = new RuntimeHost({ canvas, dpr: 1.5, getViewportSize: () => ({ width: 240, height: 200 }) })
        try {
          const root = new RenderStackPanel({ orientation: 'vertical' })
          const progress = new RenderProgressBar({ value: -1 })
          const button = new RenderButton({ label: 'Loading', loading: true })
          const loading = new RenderLoadingHost({ child: new RenderText('Content'), loading: true })
          root.addChild(progress)
          root.addChild(button)
          root.addChild(loading)
          let layouts = 0
          const layout = root.performLayout.bind(root)
          root.performLayout = (...args) => { layouts++; layout(...args) }
          const positions: number[] = []
          const angles: number[] = []
          const overlayAngles: number[] = []
          const paintProgress = progress.performPaint.bind(progress)
          progress.performPaint = (context, offset) => {
            const native = context.ctx.roundRect
            context.ctx.roundRect = function(x, y, w, h, radii) {
              if (w === progress.size.width * 0.35) positions.push(x)
              native.call(this, x, y, w, h, radii)
            }
            try { paintProgress(context, offset) } finally { context.ctx.roundRect = native }
          }
          const paintButton = button.performPaint.bind(button)
          button.performPaint = (context, offset) => {
            const native = context.ctx.arc
            context.ctx.arc = function(x, y, r, start, end, reverse) {
              angles.push(start)
              native.call(this, x, y, r, start, end, reverse)
            }
            try { paintButton(context, offset) } finally { context.ctx.arc = native }
          }
          const paintLoading = loading.performPaint.bind(loading)
          loading.performPaint = (context, offset) => {
            const native = context.ctx.arc
            context.ctx.arc = function(x, y, r, start, end, reverse) {
              if (end - start < Math.PI * 2) overlayAngles.push(start)
              native.call(this, x, y, r, start, end, reverse)
            }
            try { paintLoading(context, offset) } finally { context.ctx.arc = native }
          }
          host.addRoot(root)
          host.registerLayer({ layer: 'main',
            shouldPaint: () => host.isLayerDirty('main') || host.hasDirtyPaintForRoot(root),
            paint: ({ context }) => root.paint(context, root.globalOffset),
          })
          const modal = new RenderLoadingModal({ text: 'Loading' })
          modal.show()
          const pendingCounts: number[] = []
          const advance = (time: number) => {
            pendingCounts.push(frames.size)
            const callbacks = [...frames.values()]
            frames.clear()
            callbacks.forEach(callback => callback(time))
          }
          advance(0) // Initial layout makes the render-tree animations eligible.
          advance(1)
          const layoutCount = layouts
          positions.length = angles.length = overlayAngles.length = 0
          const times = [1000 / hz, 2000 / hz, 3000 / hz, 400]
          for (const elapsed of times) advance(1 + elapsed)
          const subscribers = host.animationClock.subscriberCount
          progress.stopIndeterminate()
          button.loading = false
          loading.loading = false
          modal.close()
          advance(500)
          results.push({ hz, times, positions: positions.slice(0, times.length),
            angles: angles.slice(0, times.length), overlayAngles: overlayAngles.slice(0, times.length),
            travel: progress.size.width * 1.35, barWidth: progress.size.width * 0.35,
            pendingCounts, subscribers, extraLayouts: layouts - layoutCount - 1,
            remainingFrames: frames.size, remainingSubscribers: host.animationClock.subscriberCount })
        } finally { host.dispose() }
      }
      return { results, intervals }
    } finally {
      window.requestAnimationFrame = nativeRequest
      window.cancelAnimationFrame = nativeCancel
      window.setInterval = nativeInterval
    }
  })
  expect(results.intervals).toBe(0)
  for (const result of results.results) {
    expect(result.pendingCounts.every(count => count === 1), JSON.stringify(result)).toBe(true)
    expect(result.subscribers).toBe(4)
    expect(result.remainingSubscribers).toBe(0)
    expect(result.remainingFrames).toBe(0)
    expect(result.extraLayouts).toBe(0)
    expect(result.positions).toHaveLength(result.times.length)
    for (let i = 0; i < result.times.length; i++) {
      expect(result.positions[i]).toBeCloseTo(-result.barWidth + result.times[i]! / 800 * result.travel)
      expect(result.angles[i]).toBeCloseTo(result.times[i]! * 0.15 / 16)
      expect(result.overlayAngles[i]).toBeCloseTo(result.times[i]! * 0.12 / 16)
    }
  }
})
