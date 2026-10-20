import { expect, test } from 'playwright/test'

declare const devtoolsUnderTest: typeof import('../../src/index') & { themes: typeof import('../../src/index') }

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => 'renderingUnderTest' in window)
  await page.evaluate(() => {
    const api = (globalThis as any).renderingUnderTest
    ;(globalThis as any).devtoolsUnderTest = { ...api, themes: api }
  })
})

for (const width of [360, 520, 920]) for (const themeName of ['ImGuiLightTheme', 'ImGuiDarkTheme'] as const) {
  test(`DevTools layout and actions at ${width}px ${themeName}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: width + 40, height: 740 })
    await page.evaluate(() => { document.body.style.cssText = 'margin:20px;background:#e8ebef' })
    const first = await page.evaluate(({ width, themeName }) => {
      const { RenderDevToolsWindow, RuntimeHost, themes } = devtoolsUnderTest
      const canvas = document.createElement('canvas'); document.body.append(canvas)
      const host = new RuntimeHost({ canvas, dpr: 1, getViewportSize: () => ({ width, height: 700 }) })
      host.setTheme(themes[themeName])
      const request = (seq: number): import('../../src/runtime/runtime_host').RuntimePaintRequestRecord => ({
        seq, time: seq * 16, kind: 'frame', source: 'pipeline', reason: 'pipeline:paint', detail: { target: 'RenderTreeView', type: 'paint' },
        alreadyScheduled: false, layoutNeeded: false, dirtyLayers: [],
        pipeline: { layoutCount: 0, paintCount: 1, transientPaintCount: 0, layoutTargets: [], paintTargets: ['RenderTreeView'], transientPaintTargets: [] },
      })
      let refreshes = 0
      const window = new RenderDevToolsWindow({ runtimeDiagnostics: {
        state: { paintRequestDebugEnabled: false, paintRequests: [request(1), request(2)] },
        onRefresh: () => { refreshes++; return { paintRequestDebugEnabled: false, paintRequests: [request(1), request(2), request(3)] } },
        onExportDiagnosticsSnapshot: () => host.createDiagnosticsSnapshot(),
      } })
      window.windowX = window.windowY = 0; window.windowWidth = width; window.windowHeight = 700
      const info = (id: number, typeName: string): import('../../src/core/render_object').RenderDebugInfo => ({ debugId: id, typeName, visible: true,
        offset: { x: 0, y: 0 }, globalOffset: { x: 16, y: 24 }, size: { width: 320, height: 200 }, needsLayout: false, needsPaint: false })
      const root = info(1, 'Workbench'), branch = info(2, 'RenderStackPanel'), leaf = info(3, 'RenderTreeView')
      window.setLayoutInspectorState({ enabled: true, overlayVisible: false, hoverPathLength: 0, selectedPathLength: 3, selectedPathIndex: 2,
        hoverPathInfo: [], selectedPathInfo: [root, branch, leaf], selected: leaf,
        selectedAppContext: [{ key: 'theme', source: 'AppHost', value: 'default', rawValue: { name: 'default', density: 'comfortable' } }],
        renderTree: { info: root, children: [{ info: branch, children: [{ info: leaf, children: [] }] }] } })
      host.addRoot(window)
      const roots = new Set([window])
      host.registerLayer({ layer: 'main', paint: ({ context }) => host.paintRoots(context, root => root === window),
        shouldPaint: () => host.isLayerDirty('main') || host.hasDirtyPaintForRoots(roots), dirtyRect: () => host.getDirtyPaintRectForRoots(roots) })
      host.renderFrame(); host.renderFrame()
      ;(globalThis as any).testDevtools = { host, window, canvas, getRefreshes: () => refreshes }
      const layout = window.debugLayoutInspectorView().debugDockManager().root
      return { width: window.size.width, direction: layout.type === 'split' ? layout.direction : layout.type,
        selectedVisible: !!window.debugTreeView().nodeRect('render-3') }
    }, { width, themeName })
    expect(first.width).toBe(width)
    expect(first.direction).toBe(width < 760 ? 'vertical' : 'horizontal')
    expect(first.selectedVisible).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('layout.png') })
    const runtime = await page.evaluate(() => {
      const { host, window, canvas, getRefreshes } = (globalThis as any).testDevtools
      window.activateTab('runtime'); host.renderFrame(); host.renderFrame()
      const view = window.debugRuntimeDiagnosticsView()
      const nodes: import('../../src/core/render_object').RenderObject[] = []
      const visit = (node: import('../../src/core/render_object').RenderObject) => {
        if (!node.visible) return
        nodes.push(node); node.visitChildren(visit)
      }
      visit(view)
      const buttons = nodes.filter(node => node instanceof devtoolsUnderTest.RenderButton) as InstanceType<typeof devtoolsUnderTest.RenderButton>[]
      const outside = buttons.filter(node => node.globalOffset.x < 0 || node.globalOffset.x + node.size.width > window.size.width + 0.1)
      const click = (node: import('../../src/core/render_object').RenderObject) => {
        const rect = canvas.getBoundingClientRect()
        for (const type of ['mousedown', 'mouseup']) canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0,
          buttons: type === 'mousedown' ? 1 : 0, clientX: rect.left + node.globalOffset.x + node.size.width / 2, clientY: rect.top + node.globalOffset.y + node.size.height / 2 }))
        host.renderFrame()
      }
      click(buttons.find(button => button.label === '刷新')!)
      ;(globalThis as any).testDevtools.clickExport = () => click(buttons.find(button => button.label === '导出')!)
      return { outside: outside.map(button => button.label), refreshes: getRefreshes(), requestCount: view.debugState().requestCount,
        compact: view.debugState().compact, listWidth: view.debugRequestList().size.width, listHeight: view.debugRequestList().size.height }
    })
    expect(runtime.outside).toEqual([])
    expect(runtime.refreshes).toBe(1)
    expect(runtime.requestCount).toBe(3)
    expect(runtime.compact).toBe(width < 760)
    expect(runtime.listHeight).toBeGreaterThan(150)
    await page.screenshot({ path: testInfo.outputPath('runtime.png') })
    const detail = await page.evaluate(() => {
      const { host, window, clickExport } = (globalThis as any).testDevtools
      clickExport(); host.renderFrame(); host.renderFrame()
      const view = window.debugRuntimeDiagnosticsView()
      return { activePane: view.debugState().activePane, detailVisible: view.debugDetailInspector().parent!.visible }
    })
    expect(detail.detailVisible).toBe(true)
    if (width < 760) expect(detail.activePane).toBe('detail')
    await page.screenshot({ path: testInfo.outputPath('runtime-detail.png') })
    await page.evaluate(() => { const { host, window } = (globalThis as any).testDevtools; host.dispose(); window.dispose() })
  })
}

test('deep selection survives the hidden Layout page and manual tab moves disable automatic orientation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 960, height: 740 })
  await page.evaluate(() => { document.body.style.cssText = 'margin:20px;background:#e8ebef' })
  const result = await page.evaluate(() => {
    const { RenderDevToolsWindow, RuntimeHost, themes } = devtoolsUnderTest
    const canvas = document.createElement('canvas'); document.body.append(canvas)
    const host = new RuntimeHost({ canvas, dpr: 1, getViewportSize: () => ({ width: 920, height: 700 }) })
    host.setTheme(themes.ImGuiLightTheme)
    const window = new RenderDevToolsWindow({ activeTab: 'runtime', runtimeDiagnostics: { state: { paintRequestDebugEnabled: false, paintRequests: [] } } })
    window.windowX = window.windowY = 0; window.windowWidth = 360; window.windowHeight = 700
    const path: import('../../src/core/render_object').RenderDebugInfo[] = Array.from({ length: 31 }, (_, index) => ({
      debugId: index + 1, typeName: 'RenderDeepNode', visible: true, offset: { x: 0, y: 0 }, globalOffset: { x: 0, y: 0 },
      size: { width: 100, height: 100 }, needsLayout: false, needsPaint: false,
    }))
    let tree: import('../../src/runtime/layout_inspector_service').LayoutInspectorTreeNode = { info: path[30]!, children: [] }
    for (let index = 29; index >= 0; index--) tree = { info: path[index]!, children: [tree] }
    window.setLayoutInspectorState({ enabled: true, overlayVisible: false, hoverPathLength: 0, selectedPathLength: path.length,
      selectedPathIndex: 30, hoverPathInfo: [], selectedPathInfo: path, selected: path[30], renderTree: tree })
    try {
      host.addRoot(window)
      const roots = new Set([window])
      host.registerLayer({ layer: 'main', paint: ({ context }) => host.paintRoots(context),
        shouldPaint: () => host.isLayerDirty('main') || host.hasDirtyPaintForRoots(roots), dirtyRect: () => host.getDirtyPaintRectForRoots(roots) })
      host.renderFrame(); host.renderFrame()
      window.activateTab('layout-inspector')
      host.renderFrame(); host.renderFrame()
      const state = window.debugTreeView().debugState()
      const selectedVisible = !!window.debugTreeView().nodeRect('render-31') && state.scrollX > 0 &&
        30 * state.indentWidth - state.scrollX < state.viewportWidth
      const manager = window.debugLayoutInspectorView().debugDockManager()
      const split = manager.root
      if (split.type !== 'split' || split.second.type !== 'tabs') throw new Error('expected split')
      manager.dockWindow(manager.getDocument('app-context')!.window, split.second, 'center')
      window.windowWidth = 920; window.markNeedsLayout()
      host.renderFrame(); host.renderFrame()
      return { selectedVisible, directionAfterUserMove: split.direction }
    } finally { host.dispose(); window.dispose() }
  })
  expect(result).toEqual({ selectedVisible: true, directionAfterUserMove: 'vertical' })
  await page.screenshot({ path: testInfo.outputPath('manual-layout.png') })
})
