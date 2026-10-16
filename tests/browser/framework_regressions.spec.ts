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
