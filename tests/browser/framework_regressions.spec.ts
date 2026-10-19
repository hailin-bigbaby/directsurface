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

test('native pointer and keyboard routing controls focus rings while retaining input editing chrome', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { RuntimeHost, FocusManager, RenderButton, RenderRadioGroup, RenderItemsControl,
      RenderTextBox, RenderTextArea, RenderText, RenderStackPanel, DrawList } = renderingUnderTest
    const canvas = document.createElement('canvas')
    document.body.append(canvas)
    const host = new RuntimeHost({ canvas, dpr: 2, getViewportSize: () => ({ width: 400, height: 360 }) })
    const originalRing = DrawList.prototype.strokeRectDashed
    const originalBorder = DrawList.prototype.strokeRect
    let rings = 0
    let editingBorders = 0
    DrawList.prototype.strokeRectDashed = function(...args) { rings++; originalRing.apply(this, args) }
    DrawList.prototype.strokeRect = function(...args) {
      if (args[5] === 1.5) editingBorders++
      originalBorder.apply(this, args)
    }
    try {
      const root = new RenderStackPanel({ orientation: 'vertical', spacing: 8 })
      let activations = 0
      const button = new RenderButton({ label: 'Save', onClick: () => activations++ })
      const radio = new RenderRadioGroup({ value: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] })
      const item = { key: 'home' }
      const navigation = new RenderItemsControl({ items: [item], getKey: item => item.key, selectedItem: item,
        itemAppearance: 'navigation', itemTemplate: () => new RenderText('Home') })
      navigation.height = 40
      const input = new RenderTextBox({ value: 'Hello' })
      const area = new RenderTextArea({ value: 'Multiline' })
      area.height = 80
      for (const control of [button, radio, navigation, input, area]) root.addChild(control)
      host.addRoot(root)
      host.registerLayer({ layer: 'main', paint: ({ context }) => root.paint(context, root.globalOffset) })
      const snapshot = () => {
        rings = editingBorders = 0
        host.markAllLayersDirty()
        host.renderFrame()
        return { rings, editingBorders, modality: FocusManager.instance.inputModality }
      }
      snapshot()
      const click = (control: typeof button | typeof radio | typeof navigation | typeof input | typeof area) => {
        const rect = canvas.getBoundingClientRect()
        const point = control.globalOffset
        const init = { bubbles: true, cancelable: true, button: 0, clientX: rect.left + point.x + 10,
          clientY: rect.top + point.y + Math.min(10, control.size.height / 2) }
        canvas.dispatchEvent(new MouseEvent('mousedown', { ...init, buttons: 1 }))
        canvas.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }))
      }
      const key = (key: string, options: KeyboardEventInit = {}) =>
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }))
      click(button)
      const pointerButton = { ...snapshot(), focused: button.isFocused, activations }
      key('Tab')
      const keyboardRadio = { ...snapshot(), focused: radio.isFocused }
      key('ArrowRight')
      const arrowRadio = { ...snapshot(), value: radio.value }
      canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 5, bubbles: true }))
      const afterMove = snapshot()
      click(radio)
      const pointerRadio = { ...snapshot(), focused: radio.isFocused }
      key('Shift')
      const modifierOnly = snapshot()
      click(navigation)
      const pointerNavigation = { ...snapshot(), selected: navigation.selectedItem?.key }
      key('ArrowDown')
      const keyboardNavigation = { ...snapshot(), selected: navigation.selectedItem?.key }
      click(input)
      const pointerInput = { ...snapshot(), focused: input.isFocused, inputElement: document.activeElement?.tagName }
      key('Enter', { isComposing: true })
      const composition = snapshot()
      click(area)
      const pointerArea = { ...snapshot(), focused: area.isFocused }
      return { pointerButton, keyboardRadio, arrowRadio, afterMove, pointerRadio, modifierOnly,
        pointerNavigation, keyboardNavigation, pointerInput, composition, pointerArea }
    } finally {
      DrawList.prototype.strokeRectDashed = originalRing
      DrawList.prototype.strokeRect = originalBorder
      host.dispose()
      canvas.remove()
    }
  })
  expect(result.pointerButton).toMatchObject({ rings: 0, focused: true, activations: 1, modality: 'pointer' })
  expect(result.keyboardRadio).toMatchObject({ rings: 1, focused: true, modality: 'keyboard' })
  expect(result.arrowRadio).toMatchObject({ rings: 1, value: 'b' })
  expect(result.afterMove).toMatchObject({ rings: 1, modality: 'keyboard' })
  expect(result.pointerRadio).toMatchObject({ rings: 0, focused: true, modality: 'pointer' })
  expect(result.modifierOnly).toMatchObject({ rings: 0, modality: 'pointer' })
  expect(result.pointerNavigation).toMatchObject({ rings: 0, selected: 'home' })
  expect(result.keyboardNavigation).toMatchObject({ rings: 1, selected: 'home' })
  expect(result.pointerInput).toMatchObject({ rings: 0, editingBorders: 1, focused: true, inputElement: 'TEXTAREA' })
  expect(result.composition).toMatchObject({ rings: 0, editingBorders: 1, modality: 'pointer' })
  expect(result.pointerArea).toMatchObject({ rings: 0, editingBorders: 1, focused: true })
})


test('shared scrollbars distinguish track and thumb colors on both axes', async ({ page }, info) => {
  const samples = await page.evaluate(() => {
    const { RenderScrollViewer, RenderBox, PaintContext, ImGuiLightTheme, ImGuiDarkTheme } = renderingUnderTest
    class Content extends RenderBox {
      constructor(private readonly horizontal: boolean) { super() }
      visitChildren(): void {}
      performLayout(): void { this.size = this.horizontal ? { width: 300, height: 80 } : { width: 80, height: 300 } }
      performPaint(): void {}
    }
    const samples: { theme: string; axis: string; dpr: number; state: string; pixel: number[]; expected: number[]; scroll: number[] }[] = []
    for (const [name, theme] of [['light', ImGuiLightTheme], ['dark', ImGuiDarkTheme]] as const) {
      for (const axis of ['vertical', 'horizontal'] as const) {
        for (const dpr of [1, 1.5, 2]) {
          const view = new RenderScrollViewer({ child: new Content(axis === 'horizontal'), direction: axis })
          view.layout({ minWidth: 0, maxWidth: 100, minHeight: 0, maxHeight: 100 }, false, { theme })
          const across = 100 - view.scrollBarSize / 2
          const point = (along: number) => axis === 'vertical' ? { x: across, y: along } : { x: along, y: across }
          for (const state of ['idle', 'track', 'thumb', 'drag'] as const) {
            if (state === 'track') view.onPointerMove({ pointerId: 1, type: 'move', position: point(90) })
            if (state === 'thumb') view.onPointerMove({ pointerId: 1, type: 'move', position: point(15) })
            if (state === 'drag') {
              view.onPointerDown({ pointerId: 1, type: 'down', position: point(15) })
              view.onPointerLeave({ pointerId: 1, type: 'move', position: { x: -10, y: -10 } })
            }
            const canvas = document.createElement('canvas')
            canvas.width = canvas.height = 100 * dpr
            canvas.style.cssText = 'width:100px;height:100px;margin:4px'
            const ctx = canvas.getContext('2d')!
            ctx.scale(dpr, dpr)
            // Compare against an independently composited center pixel: track under thumb.
            ctx.fillStyle = '#fff'
            ctx.fillRect(0, 0, 100, 100)
            view.performPaint(new PaintContext(ctx, theme), { x: 0, y: 0 })
            const at = point(15)
            const pixel = Array.from(ctx.getImageData(Math.floor(at.x * dpr), Math.floor(at.y * dpr), 1, 1).data)
            const expectedCanvas = document.createElement('canvas')
            expectedCanvas.width = expectedCanvas.height = 1
            const expectedCtx = expectedCanvas.getContext('2d')!
            const fill = (color: { r: number; g: number; b: number; a: number }, opacity = 1) => {
              expectedCtx.fillStyle = `rgba(${color.r},${color.g},${color.b},${color.a * opacity})`
              expectedCtx.fillRect(0, 0, 1, 1)
            }
            fill({ r: 255, g: 255, b: 255, a: 1 })
            fill(theme.scrollbarBg, state === 'idle' ? 0.35 : state === 'drag' ? 1 : 0.7)
            fill(state === 'drag' ? theme.scrollbarGrabActive : state === 'thumb' ? theme.scrollbarGrabHovered : theme.scrollbarGrab)
            samples.push({ theme: name, axis, dpr, state, pixel,
              expected: Array.from(expectedCtx.getImageData(0, 0, 1, 1).data), scroll: [view.scrollX, view.scrollY] })
            document.body.append(canvas)
          }
          view.dispose()
        }
      }
    }
    return samples
  })
  for (const sample of samples) {
    expect(sample.pixel, JSON.stringify(sample)).toEqual(sample.expected)
    expect(sample.scroll).toEqual([0, 0])
  }
  await page.screenshot({ path: info.outputPath('scrollbar-hover.png') })
})


test('Table cached paints stay identical and reflect in-place sorted data changes', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const { RenderTable, PaintContext, ImGuiLightTheme, ImGuiDarkTheme, loadDirectSurfaceFonts } = renderingUnderTest
    const results = []
    for (const theme of [ImGuiLightTheme, ImGuiDarkTheme]) {
      const rows = [{ id: 3, name: 'Charlie' }, { id: 1, name: 'Alpha' }, { id: 2, name: 'Bravo' }]
      const table = new RenderTable({
        columns: [{ key: 'id', title: 'ID', width: 50, sortable: true }, { key: 'name', title: 'Name', width: 120 }],
        rows,
      })
      table.sortState = { key: 'id', order: 'asc' }
      table.layout({ minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: 180 }, false, { theme })
      const canvas = document.createElement('canvas')
      canvas.width = 200
      canvas.height = 180
      const ctx = canvas.getContext('2d')!
      const original = ctx.fillText.bind(ctx)
      let labels: string[] = []
      ctx.fillText = (text, x, y, maxWidth) => {
        if (rows.some(row => row.name === text)) labels.push(text)
        if (maxWidth === undefined) original(text, x, y)
        else original(text, x, y, maxWidth)
      }
      const paint = () => {
        labels = []
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        table.performPaint(new PaintContext(ctx, theme), { x: 0, y: 0 })
        return { labels: [...labels], image: canvas.toDataURL() }
      }
      const first = paint()
      const cached = paint()
      await loadDirectSurfaceFonts()
      const afterFontReady = paint()
      rows[0]!.id = 0
      const edited = paint()
      rows.reverse()
      rows[0]!.id = 0
      const reordered = paint()
      table.sortState = { key: 'id', order: 'desc' }
      const descending = paint()
      results.push({ samePixels: first.image === cached.image && first.image === afterFontReady.image,
        initial: first.labels, cached: cached.labels, edited: edited.labels,
        reordered: reordered.labels, descending: descending.labels })
      table.dispose()
    }
    return results
  })
  for (const result of results) {
    expect(result).toEqual({ samePixels: true, initial: ['Alpha', 'Bravo', 'Charlie'],
      cached: ['Alpha', 'Bravo', 'Charlie'], edited: ['Charlie', 'Alpha', 'Bravo'],
      reordered: ['Bravo', 'Charlie', 'Alpha'], descending: ['Alpha', 'Bravo', 'Charlie'] })
  }
})


test('paint-time main and transient invalidations reach the screen on the next scheduled frame', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const { RuntimeHost, RenderObject } = renderingUnderTest
    const results = []
    for (const layer of ['main', 'transient'] as const) {
      for (const dpr of [1, 1.5, 2]) {
        const canvas = document.createElement('canvas')
        const host = new RuntimeHost({ canvas, dpr, getViewportSize: () => ({ width: 80, height: 40 }) })
        try {
          class ReentrantNode extends RenderObject {
            updateDuringPaint = false
            rightColor = 'red'
            paintCount = 0
            visitChildren(): void {}
            performLayout(): void { this.size = { width: 80, height: 40 } }
            performPaint(context: InstanceType<typeof renderingUnderTest.PaintContext>): void {
              if (layer === 'main') this.draw(context)
            }
            performTransientPaint(context: InstanceType<typeof renderingUnderTest.PaintContext>): void {
              if (layer === 'transient') this.draw(context)
            }
            request(x: number): void {
              const rect = { x, y: 5, width: 10, height: 10 }
              if (layer === 'main') this.markNeedsPaint(rect)
              else this.markNeedsTransientPaint(rect)
            }
            draw(context: InstanceType<typeof renderingUnderTest.PaintContext>): void {
              this.paintCount++
              context.ctx.fillStyle = 'green'
              context.ctx.fillRect(5, 5, 10, 10)
              context.ctx.fillStyle = this.rightColor
              context.ctx.fillRect(55, 5, 10, 10)
              if (this.updateDuringPaint) {
                this.updateDuringPaint = false
                this.rightColor = 'blue'
                this.request(55)
              }
            }
          }
          const root = new ReentrantNode()
          host.addRoot(root)
          host.registerLayer({ layer: 'main',
            shouldPaint: () => host.isLayerDirty('main') || host.hasDirtyPaintForRoot(root),
            dirtyRect: () => host.getDirtyPaintRectForRoots([root]),
            paint: ({ context }) => root.paint(context, root.globalOffset),
          })
          root.request(55)
          host.renderFrame()
          host.frameScheduler.cancelFrame()
          const before = root.paintCount
          root.updateDuringPaint = true
          root.request(5)
          for (let frame = 0; frame < 4; frame++) await new Promise(requestAnimationFrame)
          const pixels = canvas.getContext('2d')!.getImageData(Math.floor(60 * dpr), Math.floor(10 * dpr), 1, 1).data
          results.push({ layer, dpr, pixels: [...pixels], paints: root.paintCount - before,
            pending: host.frameScheduler.frameScheduled,
            paintCount: host.pipelineOwner.debugPaintState().paintCount,
            transientPaintCount: host.pipelineOwner.debugPaintState().transientPaintCount,
          })
        } finally { host.dispose() }
      }
    }
    return results
  })
  for (const result of results) {
    expect(result.pixels, JSON.stringify(result)).toEqual([0, 0, 255, 255])
    expect(result.paints, JSON.stringify(result)).toBe(2)
    expect(result.pending, JSON.stringify(result)).toBe(false)
    expect(result.paintCount).toBe(0)
    expect(result.transientPaintCount).toBe(0)
  }
})


test('DrawList repairs real Canvas state and ignores invalid stroke widths', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { DrawList, PaintContext, rgba } = renderingUnderTest
    const canvas = document.createElement('canvas')
    canvas.width = 100; canvas.height = 50
    const ctx = canvas.getContext('2d')!
    const a = new DrawList(new PaintContext(ctx)), b = new DrawList(new PaintContext(ctx))
    const red = rgba(255, 0, 0), blue = rgba(0, 0, 255)
    a.fillRect(0, 0, 10, 10, red)
    b.fillRect(10, 0, 10, 10, blue)
    a.fillRect(20, 0, 10, 10, red)
    const pixels = [5, 15, 25].map(x => Array.from(ctx.getImageData(x, 5, 1, 1).data))
    a.line(0, 15, 30, 15, red, 2)
    b.line(0, 18, 30, 18, blue, 4)
    a.line(0, 22, 30, 22, red, 2)
    const stroke = { color: ctx.strokeStyle, width: ctx.lineWidth }
    a.fillText('A', 40, 20, red, 12, 'Arial', 'left', 'middle')
    const initialFont = ctx.font
    ctx.font = '20px serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'top'
    a.fillText('B', 60, 20, red, 12, 'Arial', 'left', 'middle')
    const text = { sameFont: ctx.font === initialFont, align: ctx.textAlign, baseline: ctx.textBaseline }
    const before = canvas.toDataURL()
    for (const width of [0, -1, NaN, Infinity]) {
      a.line(0, 30, 90, 30, blue, width)
      a.lineDashed(0, 35, 90, 35, blue, width)
      a.strokeRect(0, 25, 90, 20, blue, width)
      a.strokeRectDashed(0, 25, 90, 20, blue, width)
      a.strokeCircle(50, 30, 10, blue, width)
      a.strokePolygon([{ x: 30, y: 30 }, { x: 80, y: 45 }], blue, width)
      a.drawCheckmark(30, 30, 10, blue, width)
    }
    return { pixels, stroke, text, unchanged: canvas.toDataURL() === before }
  })
  expect(result).toEqual({ pixels: [[255, 0, 0, 255], [0, 0, 255, 255], [255, 0, 0, 255]],
    stroke: { color: '#ff0000', width: 2 }, text: { sameFont: true, align: 'left', baseline: 'middle' }, unchanged: true })
})

test('TextBox native readonly blocks typing and resets between sessions', async ({ page }) => {
  await page.evaluate(() => {
    const field = new renderingUnderTest.RenderTextBox({ value: 'locked', readonly: true })
    ;(window as any).__readonlyField = field
    field.focusIn()
  })
  try {
    await page.keyboard.type('x')
    expect(await page.evaluate(() => ({ value: (window as any).__readonlyField.value,
      nativeReadonly: (document.querySelector('#__ds_ui_input__') as HTMLTextAreaElement).readOnly })))
      .toEqual({ value: 'locked', nativeReadonly: true })
    await page.evaluate(() => {
      ;(window as any).__readonlyField.readonly = false
      const input = document.querySelector('#__ds_ui_input__') as HTMLTextAreaElement
      input.setSelectionRange(input.value.length, input.value.length)
    })
    await page.keyboard.type('!')
    expect(await page.evaluate(() => (window as any).__readonlyField.value)).toBe('locked!')
    await page.evaluate(() => {
      const field = (window as any).__readonlyField
      field.readonly = true
      field.focusOut(); field.dispose()
      const next = new renderingUnderTest.RenderTextBox({ value: 'next' })
      ;(window as any).__readonlyField = next
      next.focusIn()
      const input = document.querySelector('#__ds_ui_input__') as HTMLTextAreaElement
      input.setSelectionRange(input.value.length, input.value.length)
    })
    await page.keyboard.type('?')
    expect(await page.evaluate(() => ({ value: (window as any).__readonlyField.value,
      nativeReadonly: (document.querySelector('#__ds_ui_input__') as HTMLTextAreaElement).readOnly })))
      .toEqual({ value: 'next?', nativeReadonly: false })
  } finally {
    await page.evaluate(() => { (window as any).__readonlyField?.dispose(); delete (window as any).__readonlyField })
  }
})


test('partial paints preserve overlapping translucent content and fractional damage edges', async ({ page }) => {
  const results = await page.evaluate(() => {
    const { RuntimeHost } = renderingUnderTest
    return [1, 1.25, 1.5, 2].map(dpr => {
      const canvas = document.createElement('canvas')
      const host = new RuntimeHost({ canvas, dpr, getViewportSize: () => ({ width: 40, height: 30 }) })
      const compositor = host.compositor
      const manager = host.layerManager
      manager.registerPainter({ layer: 'main', paint: ({ context }) => {
        context.ctx.fillStyle = 'rgba(255,0,0,0.5)'
        context.ctx.fillRect(0, 0, 40, 30)
      } })
      manager.registerPainter({ layer: 'main', paint: ({ context }) => {
        context.ctx.fillStyle = 'rgba(0,0,255,0.5)'
        context.ctx.fillRect(5, 0, 20, 30)
      } })
      const pixels = () => Array.from(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data)
      manager.paintAll()
      compositor.composite()
      const before = pixels()
      for (let n = 0; n < 10; n++) {
        manager.markDirtyRect('main', { x: 6.25, y: 4.2, width: 5.5, height: 6.4 })
        manager.paintAll()
        compositor.composite()
      }
      compositor.markDirty('overlay')
      compositor.composite()
      const after = pixels()
      host.dispose()
      return { dpr, differences: before.filter((value, i) => value !== after[i]).length }
    })
  })
  for (const result of results) expect(result.differences, `DPR ${result.dpr}`).toBe(0)
})


test('painter transform and clipping cannot leak into the next painter', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { RuntimeHost } = renderingUnderTest
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 40
    const host = new RuntimeHost({ canvas, getViewportSize: () => ({ width: 40, height: 40 }) })
    const compositor = host.compositor
    const manager = host.layerManager
    manager.registerPainter({ layer: 'main', paint: ({ context }) => {
      context.ctx.translate(20, 20)
      context.clipRect(0, 0, 1, 1)
    } })
    manager.registerPainter({ layer: 'main', paint: ({ context }) => {
      context.ctx.fillStyle = 'red'
      context.ctx.fillRect(0, 0, 10, 10)
    } })
    manager.paintAll()
    compositor.composite()
    const pixel = Array.from(canvas.getContext('2d')!.getImageData(5, 5, 1, 1).data)
    host.dispose()
    return pixel
  })
  expect(result).toEqual([255, 0, 0, 255])
})


test('paint-only button border changes match a full repaint at fractional and high DPR', async ({ page }) => {
  const results = await page.evaluate(() => {
    const { RuntimeHost, RenderButton } = renderingUnderTest
    const results = []
    for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      const canvas = document.createElement('canvas')
      const host = new RuntimeHost({ canvas, dpr, onFrame: () => {}, getViewportSize: () => ({ width: 160, height: 90 }) })
      const button = new RenderButton({ label: 'Button' })
      const theme = { ...host.pipelineOwner.theme, frameBorderSize: 1 }
      host.pipelineOwner.setTheme(theme)
      host.addRoot(button)
      host.setRootConstraints(button, { minWidth: 80, maxWidth: 80, minHeight: 30, maxHeight: 30 })
      button.offset = { x: 20, y: 20 }
      host.registerLayer({ layer: 'main',
        shouldPaint: () => host.isLayerDirty('main') || host.hasDirtyPaintForRoots([button]),
        dirtyRect: () => host.getDirtyPaintRectForRoots([button]),
        paint: ({ context }) => {
          context.setTheme(theme)
          context.ctx.fillStyle = 'white'
          context.ctx.fillRect(0, 0, 160, 90)
          button.paint(context, button.offset)
        },
      })
      host.renderFrame()
      for (const variant of ['danger', 'text', 'default'] as const) {
        button.variant = variant
        host.renderFrame()
        const partial = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
        host.markLayerDirty('main')
        host.renderFrame()
        const full = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
        results.push({ dpr, variant, differences: partial.filter((value, i) => value !== full[i]).length })
      }
      host.dispose()
    }
    return results
  })
  for (const result of results) expect(result.differences, JSON.stringify(result)).toBe(0)
})


test('partial transient repaint preserves unchanged translucent overlaps', async ({ page }) => {
  const results = await page.evaluate(() => {
    const { RuntimeHost, RenderObject } = renderingUnderTest
    return [1, 1.25, 1.5, 2, 3].map(dpr => {
      const canvas = document.createElement('canvas')
      const host = new RuntimeHost({ canvas, dpr, getViewportSize: () => ({ width: 80, height: 50 }) })
      class Transient extends RenderObject {
        constructor(private readonly color: string, private readonly x: number) { super() }
        visitChildren(): void {}
        performLayout(): void { this.size = { width: 80, height: 50 } }
        performPaint(): void {}
        performTransientPaint(context: InstanceType<typeof renderingUnderTest.PaintContext>): void {
          context.ctx.fillStyle = this.color
          context.ctx.fillRect(this.x, 5, 45, 35)
        }
      }
      try {
        const a = new Transient('rgba(255,0,0,0.5)', 5)
        const b = new Transient('rgba(0,0,255,0.5)', 20)
        host.addRoot(a); host.addRoot(b)
        a.markNeedsTransientPaint(); b.markNeedsTransientPaint()
        host.renderFrame(); host.frameScheduler.cancelFrame()
        const pixels = () => Array.from(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data)
        const before = pixels()
        for (let i = 0; i < 10; i++) {
          a.markNeedsTransientPaint({ x: 25.3, y: 10.2, width: 10.1, height: 12.4 })
          host.renderFrame(); host.frameScheduler.cancelFrame()
        }
        // Reveal any accumulation outside the partial composite area as well.
        host.compositor.markDirty('overlay'); host.compositor.composite()
        const after = pixels()
        return { dpr, differences: before.filter((value, i) => value !== after[i]).length,
          dirty: host.pipelineOwner.hasTransientPaint(), pending: host.frameScheduler.frameScheduled }
      } finally { host.dispose() }
    })
  })
  for (const result of results) {
    expect(result.differences, JSON.stringify(result)).toBe(0)
    expect(result.dirty).toBe(false)
    expect(result.pending).toBe(false)
  }
})

test('partial paint failure restores Canvas state and recovers without residual pixels', async ({ page }) => {
  const results = await page.evaluate(() => {
    const { RuntimeHost } = renderingUnderTest
    return [1, 1.25, 1.5, 2, 3].map(dpr => {
      const canvas = document.createElement('canvas')
      const host = new RuntimeHost({ canvas, dpr, getViewportSize: () => ({ width: 60, height: 40 }) })
      let fail = false
      host.registerLayerPainter({ layer: 'main', paint: ({ context }) => {
        if (!fail) return
        context.ctx.translate(15, 10)
        context.clipRect(0, 0, 2, 2)
        context.ctx.fillStyle = 'magenta'; context.ctx.fillRect(0, 0, 10, 10)
        host.markLayerDirtyRect('main', { x: 30, y: 10, width: 10, height: 10 })
        throw new Error('expected paint failure')
      } })
      host.registerLayerPainter({ layer: 'main', paint: ({ context }) => {
        context.ctx.fillStyle = 'rgba(255,0,0,0.5)'; context.ctx.fillRect(0, 0, 60, 40)
        context.ctx.fillStyle = 'rgba(0,0,255,0.5)'; context.ctx.fillRect(15, 5, 30, 30)
      } })
      try {
        host.renderFrame(); host.frameScheduler.cancelFrame()
        const pixels = () => Array.from(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data)
        const reference = pixels()
        fail = true
        host.markLayerDirtyRect('main', { x: 6.25, y: 4.2, width: 15.5, height: 12.4 })
        let error = ''
        try { host.renderFrame() } catch (cause) { error = (cause as Error).message }
        const pendingAfterError = host.frameScheduler.frameScheduled
        const dirtyAfterError = host.isLayerDirty('main')
        const transform = host.compositor.getContext('main').ctx.getTransform()
        fail = false
        host.renderFrame()
        host.compositor.markDirty('overlay'); host.compositor.composite()
        const recovered = pixels()
        return { dpr, error, pendingAfterError, dirtyAfterError,
          transform: [transform.a, transform.d, transform.e, transform.f],
          differences: reference.filter((value, i) => value !== recovered[i]).length,
          dirty: host.layerManager.hasDirtyLayers }
      } finally { host.dispose() }
    })
  })
  for (const result of results) {
    expect(result.error).toBe('expected paint failure')
    expect(result.pendingAfterError).toBe(false)
    expect(result.dirtyAfterError).toBe(true)
    expect(result.transform).toEqual([result.dpr, result.dpr, 0, 0])
    expect(result.differences, JSON.stringify(result)).toBe(0)
    expect(result.dirty).toBe(false)
  }
})


test('thin strokes and translated strokes occupy one physical pixel row', async ({ page }, info) => {
  const result = await page.evaluate(() => {
    const { DrawList, PaintContext } = renderingUnderTest
    const samples: Record<string, number[]> = {}
    document.body.innerHTML = '<h2>Line clarity · real Canvas pixels</h2><p>Left: previous alignment · Right: corrected alignment · nearest-neighbor 8× inspection</p>'
    for (const [name, width, translation] of [['0.5 px line', 0.5, 0], ['1 px line + 0.5 px translation', 1, 0.5]] as const) {
      const row = document.createElement('div')
      row.innerHTML = `<p>${name}</p>`
      for (const corrected of [false, true]) {
        const canvas = document.createElement('canvas')
        canvas.width = 48
        canvas.height = 20
        canvas.style.cssText = 'width:384px;height:160px;image-rendering:pixelated;border:1px solid #ddd;margin-right:16px'
        const ctx = canvas.getContext('2d')!
        ctx.translate(0, translation)
        if (corrected) {
          new DrawList(new PaintContext(ctx)).line(4, 10, 44, 10, { r: 0, g: 0, b: 0, a: 1 }, width)
        } else {
          // Previous DPR-1 policy: only exact odd integer widths received a half-pixel offset.
          const y = 10 + (width === 1 ? 0.5 : 0)
          ctx.lineWidth = width
          ctx.beginPath()
          ctx.moveTo(4, y)
          ctx.lineTo(44, y)
          ctx.stroke()
        }
        const data = ctx.getImageData(20, 0, 1, 20).data
        const coverage = []
        for (let y = 0; y < 20; y++) if (data[y * 4 + 3]) coverage.push(data[y * 4 + 3]!)
        samples[`${name}/${corrected ? 'after' : 'before'}`] = coverage
        row.append(canvas)
      }
      document.body.append(row)
    }
    return samples
  })
  expect(result['0.5 px line/before']).toHaveLength(2)
  expect(result['0.5 px line/after']).toHaveLength(1)
  expect(result['0.5 px line/after']![0]).toBeGreaterThanOrEqual(126)
  expect(result['0.5 px line/after']![0]).toBeLessThanOrEqual(128)
  expect(result['1 px line + 0.5 px translation/after']).toEqual([255])
  const screenshot = info.outputPath('line-clarity.png')
  await page.screenshot({ path: screenshot, fullPage: true })
  await info.attach('line-clarity', { path: screenshot, contentType: 'image/png' })
  await info.attach('coverage', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
})


test('hairlines stay sharp across fractional DPR, zoom, reflection and nonuniform scale', async ({ page }) => {
  const samples = await page.evaluate(() => {
    const { DrawList, PaintContext } = renderingUnderTest
    const samples: Array<{ scale: number; vertical: boolean; coverage: number[] }> = []
    const cases = [0.5, 1, 1.25, 1.5, 2, 3, -2].flatMap(scale =>
      [false, true].map(vertical => ({ sx: scale, sy: scale, scale, vertical })))
    cases.push({ sx: 2, sy: 1, scale: 1, vertical: false }, { sx: 1, sy: 2, scale: 1, vertical: true })
    for (const { sx, sy, scale, vertical } of cases) {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 160
      const ctx = canvas.getContext('2d')!
      const tx = sx < 0 ? 80.25 : 0.25
      const ty = sy < 0 ? 80.5 : 0.5
      ctx.setTransform(sx, 0, 0, sy, tx, ty)
      const dl = new DrawList(new PaintContext(ctx))
      dl.line(vertical ? 10 : 4, vertical ? 4 : 10, vertical ? 10 : 30, vertical ? 30 : 10,
        { r: 0, g: 0, b: 0, a: 1 }, 1 / Math.abs(scale))
      const tangentPixel = Math.round(17 * (vertical ? sy : sx) + (vertical ? ty : tx))
      const data = vertical ? ctx.getImageData(0, tangentPixel, 160, 1).data : ctx.getImageData(tangentPixel, 0, 1, 160).data
      const coverage = []
      for (let i = 3; i < data.length; i += 4) if (data[i]) coverage.push(data[i]!)
      samples.push({ scale, vertical, coverage })
    }
    return samples
  })
  for (const sample of samples) expect(sample.coverage, JSON.stringify(sample)).toEqual([255])
})


test('text and circles match device-aligned native Canvas across DPR and transforms', async ({ page }) => {
  const results = await page.evaluate(() => {
    const { DrawList, PaintContext } = renderingUnderTest
    const results = []
    for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      for (const zoom of [0.5, 1, 1.6]) {
        for (const mode of ['uniform', 'nonuniform', 'reflected'] as const) {
          for (const primitive of ['text', 'fill-circle', 'stroke-circle'] as const) {
            const a = dpr * zoom * (mode === 'reflected' ? -1 : 1)
            const d = dpr * zoom * (mode === 'nonuniform' ? 1.5 : 1)
            const e = dpr * (mode === 'reflected' ? 100.25 : 0.25), f = dpr * 0.5
            const canvas = document.createElement('canvas'), reference = document.createElement('canvas')
            canvas.width = reference.width = Math.ceil(180 * dpr)
            canvas.height = reference.height = Math.ceil(100 * dpr)
            const ctx = canvas.getContext('2d')!, expected = reference.getContext('2d')!
            ctx.setTransform(a, 0, 0, d, e, f)
            expected.setTransform(a, 0, 0, d, e, f)
            const dl = new DrawList(new PaintContext(ctx)), color = { r: 16, g: 88, b: 224, a: 1 }
            const x = 20.3, y = 20.7, radius = 6.3
            // Independent reference: round the transformed anchor in physical pixels,
            // then express that point in the original Canvas coordinate system.
            const px = (Math.round(a * x + e) - e) / a
            const py = (Math.round(d * y + f) - f) / d
            expected.fillStyle = expected.strokeStyle = 'rgb(16,88,224)'
            if (primitive === 'text') {
              dl.fillText('Ag', x, y, color, 16, 'Arial', 'left', 'middle')
              expected.font = '16px Arial'; expected.textAlign = 'left'; expected.textBaseline = 'middle'
              expected.fillText('Ag', px, py)
            } else {
              if (primitive === 'fill-circle') dl.fillCircle(x, y, radius, color)
              else dl.strokeCircle(x, y, radius, color, 1)
              expected.beginPath(); expected.arc(px, py, radius, 0, Math.PI * 2)
              if (primitive === 'fill-circle') expected.fill()
              else { expected.lineWidth = 1; expected.stroke() }
            }
            const actual = ctx.getImageData(0, 0, canvas.width, canvas.height).data
            const wanted = expected.getImageData(0, 0, reference.width, reference.height).data
            let differences = 0, ink = 0
            for (let i = 0; i < actual.length; i++) {
              if (actual[i] !== wanted[i]) differences++
              if (i % 4 === 3 && actual[i]) ink++
            }
            results.push({ dpr, zoom, mode, primitive, differences, ink })
          }
        }
      }
    }
    return results
  })
  expect(results).toHaveLength(135)
  for (const result of results) {
    expect(result.ink, JSON.stringify(result)).toBeGreaterThan(0)
    expect(result.differences, JSON.stringify(result)).toBe(0)
  }
})


test('batched segments match native combined-path rendering across transforms', async ({ page }) => {
  const results = await page.evaluate(() => {
    const { DrawList, PaintContext } = renderingUnderTest
    const results = []
    for (const scale of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
      for (const alpha of [0.35, 1]) {
        const render = (batch: boolean) => {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 180
          const ctx = canvas.getContext('2d')!
          ctx.setTransform(scale, 0, 0, scale, 0.25, 0.5)
          const dl = new DrawList(new PaintContext(ctx))
          const lines = Array.from({ length: 5 }, (_, i) => ({ x1: 4, y1: 5 + i * 12, x2: 65, y2: 5 + i * 12 }))
          const color = { r: 12, g: 66, b: 120, a: alpha }
          if (batch) dl.strokeSegments(lines, color, 1)
          else {
            ctx.strokeStyle = `rgba(12,66,120,${alpha})`; ctx.lineWidth = 1
            ctx.beginPath()
            const phase = scale <= 1 || Math.round(scale) % 2 === 1 ? 0.5 : 0
            for (const line of lines) {
              const x1 = (Math.round(line.x1 * scale + 0.25) - 0.25) / scale
              const x2 = (Math.round(line.x2 * scale + 0.25) - 0.25) / scale
              const y = (Math.round(line.y1 * scale + 0.5 - phase) + phase - 0.5) / scale
              ctx.moveTo(x1, y); ctx.lineTo(x2, y)
            }
            ctx.stroke()
          }
          return ctx.getImageData(0, 0, 180, 180).data
        }
        const reference = render(false), batched = render(true)
        results.push({ scale, alpha, ink: batched.some(value => value !== 0),
          differences: reference.filter((value, i) => value !== batched[i]).length })
      }
    }
    return results
  })
  for (const result of results) {
    expect(result.ink).toBe(true)
    expect(result.differences, JSON.stringify(result)).toBe(0)
  }
})

test('performance overlay partial updates match full repaint without changing outside pixels', async ({ page }) => {
  const results = await page.evaluate(() => {
    const { RuntimeHost } = renderingUnderTest
    const results: Array<{ dpr: number; label: string; mismatches: number; outsideChanges: number; area: number; screen: number; partial: boolean }> = []
    for (const dpr of [1, 1.25, 2]) {
      const canvas = document.createElement('canvas')
      document.body.append(canvas)
      let size = { width: 800, height: 480 }
      const host = new RuntimeHost({ canvas, dpr, enablePerformanceOverlay: true,
        onFrame: () => {}, getViewportSize: () => size })
      host.performanceMonitor.position = 'top-left'
      host.registerLayer({ layer: 'main', paint: ({ context }) => {
        context.ctx.fillStyle = '#eadfcc'
        context.ctx.fillRect(0, 0, size.width, size.height)
        context.ctx.fillStyle = '#c6dcec'
        context.ctx.fillRect(0, size.height / 2, size.width, size.height / 2)
      } })
      host.performanceMonitor.recordFrame({ seq: 1, totalMs: 10, paintMs: 3, layoutMs: 2,
        compositeMs: 1, rootCount: 0, layerCount: 7, layoutNeeded: false })
      host.performanceMonitor.recordFrame = () => {}
      host.renderFrame()
      const ctx = canvas.getContext('2d')!
      const clear = ctx.clearRect.bind(ctx)
      let cleared: Array<{ x: number; y: number; w: number; h: number }> = []
      ctx.clearRect = (x, y, w, h) => { cleared.push({ x, y, w, h }); clear(x, y, w, h) }
      const pixels = () => ctx.getImageData(0, 0, canvas.width, canvas.height).data
      const check = (label: string, partial = true) => {
        const before = pixels()
        cleared = []
        host.renderFrame()
        const actual = pixels()
        const damage = cleared.slice()
        host.markLayerDirty('performance-overlay')
        host.renderFrame()
        const reference = pixels()
        let mismatches = 0
        let outsideChanges = 0
        for (let i = 0; i < actual.length; i++) {
          if (actual[i] !== reference[i]) mismatches++
          if (actual[i] === before[i]) continue
          const pixel = Math.floor(i / 4)
          const x = pixel % canvas.width
          const y = Math.floor(pixel / canvas.width)
          if (!damage.some(r => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h)) outsideChanges++
        }
        results.push({ dpr, label, mismatches, outsideChanges, area: damage.reduce((sum, r) => sum + r.w * r.h, 0),
          screen: canvas.width * canvas.height, partial })
      }
      check('update')
      const header = host.performanceMonitor.debugState().headerRect
      host.performanceMonitor.onPointerDown({ type: 'down', pointerId: 1, button: 0,
        position: { x: header.x + 10, y: header.y + 14 } })
      host.performanceMonitor.onPointerMove({ type: 'move', pointerId: 1,
        position: { x: header.x + 90, y: header.y + 54 } })
      host.performanceMonitor.onPointerUp({ type: 'up', pointerId: 1, position: { x: 0, y: 0 } })
      check('move')
      host.performanceMonitor.minimized = true
      check('minimize')
      check('minimized update')
      host.performanceMonitor.minimized = false
      check('restore')
      host.setPerformanceOverlayVisible(false)
      check('hide')
      check('hidden idle')
      host.setPerformanceOverlayVisible(true)
      check('show again')
      host.performanceMonitor.position = 'top-right'
      host.setPerformanceOverlayVisible(false)
      check('move and hide before paint')
      host.setPerformanceOverlayVisible(true)
      check('show at new position')
      size = { width: 240, height: 180 }
      host.resize()
      check('resize', false)
      check('update after resize')
      host.dispose()
      canvas.remove()
    }
    return results
  })
  for (const result of results) {
    expect(result.mismatches, JSON.stringify(result)).toBe(0)
    expect(result.outsideChanges, JSON.stringify(result)).toBe(0)
    if (result.partial) expect(result.area, JSON.stringify(result)).toBeLessThan(result.screen)
    if (result.label === 'hidden idle') expect(result.area).toBe(0)
  }
})


test('invalid batch coordinates cannot connect unrelated subpaths', async ({ page }) => {
  const equal = await page.evaluate(() => {
    const { DrawList, PaintContext } = renderingUnderTest
    const render = (invalid: boolean) => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      const dl = new DrawList(new PaintContext(ctx))
      const segments = [{ x1: 5, y1: 5, x2: 20, y2: 5 }, { x1: 5, y1: 50, x2: 20, y2: 50 }]
      if (invalid) segments.splice(1, 0, { x1: NaN, y1: NaN, x2: 60, y2: 30 })
      dl.strokeSegments(segments, { r: 0, g: 0, b: 0, a: 1 })
      return canvas.toDataURL()
    }
    return render(true) === render(false)
  })
  expect(equal).toBe(true)
})

test('encoded image previews decode through the browser loader and retain borrowed sources', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { RenderImagePreview, PaintContext } = renderingUnderTest
    const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>')
    const preview = new RenderImagePreview({ source: { bytes, mediaType: 'image/svg+xml' }, size: 16, fit: 'fill', shape: 'rectangle' })
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16
    const ctx = canvas.getContext('2d')!
    const external = document.createElement('canvas'); external.width = external.height = 8
    external.getContext('2d')!.fillStyle = 'blue'; external.getContext('2d')!.fillRect(0, 0, 8, 8)
    const borrowed = new RenderImagePreview({ source: external, size: 16, fit: 'fill', shape: 'rectangle' })
    try {
      for (let i = 0; i < 60 && preview.debugState().loadState === 'loading'; i++) await new Promise(requestAnimationFrame)
      preview.layout({ minWidth: 16, maxWidth: 16, minHeight: 16, maxHeight: 16 })
      preview.performPaint(new PaintContext(ctx), { x: 0, y: 0 })
      const loaded = preview.debugState().loadState
      const red = Array.from(ctx.getImageData(8, 8, 1, 1).data)
      borrowed.dispose()
      const blue = Array.from(external.getContext('2d')!.getImageData(4, 4, 1, 1).data)
      return { loaded, red, blue }
    } finally { preview.dispose(); borrowed.dispose() }
  })
  expect(result).toEqual({ loaded: 'loaded', red: [255, 0, 0, 255], blue: [0, 0, 255, 255] })
})


test('notifications become idle and popup action spinners use the host clock', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { RuntimeHost, NotificationManager } = renderingUnderTest
    const canvas = document.createElement('canvas')
    document.body.append(canvas)
    let frames = 0
    const host = new RuntimeHost({ canvas, getViewportSize: () => ({ width: 800, height: 600 }), onFrame: () => { frames++ } })
    const manager = new NotificationManager()
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
    try {
      manager.notify({ type: 'error', title: 'Persistent notification', duration: 0 })
      await wait(650)
      const idleStart = frames
      await wait(160)
      const idleEnd = frames
      manager.close()
      manager.notify({ type: 'error', title: 'Retry action', duration: 0,
        action: { label: 'Retry', onInvoke: () => new Promise<void>(() => {}) } })
      await wait(250)
      const surface = (manager as any)._notificationSurface
      const button = surface._cards[0]._actionButton
      button.onClick()
      await wait(80)
      const firstAngle = button._spinAngle
      const activeFrames = frames
      await wait(160)
      const secondAngle = button._spinAngle
      const animatedFrames = frames - activeFrames
      const clockInherited = button.owner.animationClock === host.animationClock
      manager.close()
      await wait(100)
      const closedStart = frames
      await wait(160)
      return { idleStart, idleEnd, firstAngle, secondAngle, animatedFrames, clockInherited,
        closedFrames: frames - closedStart, subscribers: host.animationClock.subscriberCount }
    } finally { manager.dispose(); host.dispose(); canvas.remove() }
  })
  expect(result.idleEnd).toBe(result.idleStart)
  expect(result.clockInherited).toBe(true)
  expect(result.secondAngle).not.toBe(result.firstAngle)
  expect(result.animatedFrames).toBeGreaterThan(0)
  expect(result.closedFrames).toBe(0)
  expect(result.subscribers).toBe(0)
})

test('passive notifications pause on hover while clicks still reach the page', async ({ page }) => {
  const point = await page.evaluate(() => {
    const { RuntimeHost, NotificationManager, RenderButton } = renderingUnderTest
    const canvas = document.createElement('canvas')
    document.body.append(canvas)
    let clicks = 0
    const host = new RuntimeHost({ canvas, getViewportSize: () => ({ width: 800, height: 600 }) })
    const button = new RenderButton({ label: 'Page button', onClick: () => { clicks++ } })
    button.width = 800
    button.height = 600
    host.addRoot(button)
    const manager = new NotificationManager()
    const handle = manager.notify({ type: 'success', title: 'Hover to read', dismissible: false, duration: 350 })
    manager.hitTest({ x: 0, y: 0 }, (manager as any).popupContext)
    const card = (manager as any)._notificationSurface._cards[0]
    const rect = canvas.getBoundingClientRect()
    ;(window as any).notificationProbe = { get closed() { return handle.closed }, get clicks() { return clicks },
      dispose: () => { manager.dispose(); host.dispose(); canvas.remove() } }
    return { x: rect.left + card.globalOffset.x + 40, y: rect.top + card.globalOffset.y + 20 }
  })
  try {
    await page.mouse.move(point.x, point.y)
    await page.waitForTimeout(650)
    expect(await page.evaluate(() => (window as any).notificationProbe.closed)).toBe(false)
    await page.mouse.click(point.x, point.y)
    expect(await page.evaluate(() => (window as any).notificationProbe.clicks)).toBe(1)
    await page.mouse.move(0, 0)
    await page.waitForFunction(() => (window as any).notificationProbe.closed)
  } finally {
    await page.evaluate(() => { (window as any).notificationProbe.dispose(); delete (window as any).notificationProbe })
  }
})
