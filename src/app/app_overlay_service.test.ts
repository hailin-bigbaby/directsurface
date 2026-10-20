// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_CONTEXT_PROVIDER, AppContextRegistry, createAppContextKey } from '../core/app_context'
import { FocusManager } from '../core/focus_manager'
import { PopupManager } from '../core/popup_manager'
import { PipelineOwner, type BoxConstraints, type LayoutContext, type Offset, type RenderObject } from '../core/render_object'
import { RenderBox } from '../layout/render_box'
import type { PaintContext } from '../rendering/paint_context'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { RenderModal } from '../widgets/modal'
import { RenderLoadingModal } from '../widgets/loading_modal'
import { RenderWindow } from '../widgets/window'
import { AppOverlayService } from './app_overlay_service'
import type { AppPerformanceOverlayController, AppRuntimeDebugController } from './app_overlay_service'
import type { RuntimeDiagnosticsSnapshot } from '../runtime/runtime_host'

const viewport = { width: 800, height: 600, dpr: 1 }

class TestOverlayBox extends RenderBox {
  disposed = false

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, _context: LayoutContext): void {
    this.size = {
      width: constraints.maxWidth === Infinity ? 100 : constraints.maxWidth,
      height: constraints.maxHeight === Infinity ? 40 : constraints.maxHeight,
    }
  }

  performPaint(_context: PaintContext, _offset: Offset): void {}

  override dispose(): void {
    this.disposed = true
    super.dispose()
  }
}

class ContextOverlayBox extends TestOverlayBox {
  constructor(readonly appContext: AppContextRegistry) {
    super()
  }

  [APP_CONTEXT_PROVIDER](): AppContextRegistry {
    return this.appContext
  }
}

function createModalWindowHost() {
  let windows: readonly RenderWindow[] = []
  return {
    host: {
      setModalWindows: vi.fn((nextWindows: readonly RenderWindow[]) => {
        windows = [...nextWindows]
      }),
      centerWindowInViewport: vi.fn((window: RenderWindow) => {
        window.windowX = (viewport.width - window.windowWidth) / 2
        window.windowY = (viewport.height - window.windowHeight) / 2
        window.offset = { x: window.windowX, y: window.windowY }
      }),
    },
    get windows() {
      return windows
    },
  }
}

function diagnosticsSnapshot(): RuntimeDiagnosticsSnapshot {
  return {
    version: 1,
    createdAt: '2026-05-13T00:00:00.000Z',
    environment: {
      userAgent: 'test',
      viewport,
      canvas: { width: 800, height: 600, styleWidth: '800px', styleHeight: '600px' },
      dpr: 1,
    },
    runtime: {
      disposed: false,
      rootCount: 1,
      mountedWindowCount: 1,
      performanceOverlayVisible: false,
      paintRequestDebugEnabled: false,
      frameScheduled: false,
      layoutNeeded: false,
    },
    layers: { registered: [], dirty: [] },
    pipeline: {
      layoutCount: 0,
      paintCount: 0,
      transientPaintCount: 0,
      layoutTargets: [],
      paintTargets: [],
      transientPaintTargets: [],
    },
    paintRequests: [],
    hotspots: [],
    performance: {
      state: {
        visible: false,
        minimized: false,
        sampleCount: 0,
        averageTotalMs: 0,
        slowFrameCount: 0,
        bounds: { x: 0, y: 0, width: 100, height: 80 },
        headerRect: { x: 0, y: 0, width: 100, height: 32 },
        toggleButtonRect: { x: 80, y: 6, width: 20, height: 20 },
      },
      samples: [],
    },
    layoutInspector: {
      enabled: false,
      overlayVisible: false,
      hoverPathLength: 0,
      selectedPathLength: 0,
      selectedPathIndex: -1,
      hoverPathInfo: [],
      selectedPathInfo: [],
    },
    appContext: [],
    roots: [],
    windows: [],
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  PopupManager.disposeInstance()
  FocusManager.disposeInstance()
})

describe('AppOverlayService notifications', () => {
  it('exposes the new handle API while preserving the legacy entry', () => {
    PopupManager.instance.setContextProvider(() => ({ theme: ImGuiDarkTheme, viewport }))
    const service = new AppOverlayService()

    expect(service.showNotification('success', 'Legacy', '', 0)).toBeTypeOf('number')
    const handle = service.notify({ type: 'error', title: 'Save failed', key: 'save', duration: 0 })

    expect(handle.closed).toBe(false)
    expect(service.updateNotification('save', { message: 'Retry later' })).toBe(true)
    expect(service.closeNotification('save')).toBe(true)
    expect(service.closeNotification('save')).toBe(false)

    service.dispose()
  })
})

describe('AppOverlayService.showLoading', () => {
  it('returns a handle and closes the modal when the handle closes', () => {
    PopupManager.instance.setContextProvider(() => ({ theme: ImGuiDarkTheme, viewport }))
    const service = new AppOverlayService()
    const handle = service.showLoading({ text: 'Loading...', progress: 0.25 })

    expect(handle.closed).toBe(false)
    expect(PopupManager.instance.current).toBeInstanceOf(RenderLoadingModal)
    expect((PopupManager.instance.current as RenderLoadingModal).text).toBe('Loading...')
    expect((PopupManager.instance.current as RenderLoadingModal).progress).toBe(0.25)

    handle.setProgress(0.75)
    expect((PopupManager.instance.current as RenderLoadingModal).progress).toBe(0.75)

    handle.close()
    handle.close()

    expect(handle.closed).toBe(true)
    expect(PopupManager.instance.stack.some(popup => popup instanceof RenderLoadingModal)).toBe(false)

    service.dispose()
  })

  it('keeps one modal for concurrent handles and hides after the last closes', () => {
    PopupManager.instance.setContextProvider(() => ({ theme: ImGuiDarkTheme, viewport }))
    const service = new AppOverlayService()
    const first = service.showLoading('First')
    const modal = PopupManager.instance.current as RenderLoadingModal
    const second = service.showLoading('Second')

    expect(PopupManager.instance.current).toBe(modal)
    expect(PopupManager.instance.stack.filter(popup => popup instanceof RenderLoadingModal)).toHaveLength(1)
    expect(modal.text).toBe('Second')

    first.close()

    expect(modal.visible).toBe(true)
    expect(PopupManager.instance.stack).toContain(modal)
    expect(modal.text).toBe('Second')

    second.close()

    expect(PopupManager.instance.stack).not.toContain(modal)

    service.dispose()
  })

  it('updates the current handle text and falls back to the previous open handle', () => {
    PopupManager.instance.setContextProvider(() => ({ theme: ImGuiDarkTheme, viewport }))
    const service = new AppOverlayService()
    const first = service.showLoading('First')
    const second = service.showLoading('Second')
    const modal = PopupManager.instance.current as RenderLoadingModal

    first.setText('First updated')
    first.setProgress(0.25)
    expect(modal.text).toBe('Second')
    expect(modal.progress).toBeUndefined()

    second.setText('Second updated')
    second.setProgress(0.6)
    expect(modal.text).toBe('Second updated')
    expect(modal.progress).toBe(0.6)

    second.close()
    expect(modal.text).toBe('First updated')
    expect(modal.progress).toBe(0.25)

    first.close()
    expect(PopupManager.instance.stack).not.toContain(modal)

    service.dispose()
  })

  it('closes the loading modal after a wrapped task resolves', async () => {
    PopupManager.instance.setContextProvider(() => ({ theme: ImGuiDarkTheme, viewport }))
    const service = new AppOverlayService()

    await expect(service.withLoading('Saving...', async handle => {
      expect(handle.closed).toBe(false)
      expect(PopupManager.instance.current).toBeInstanceOf(RenderLoadingModal)
      handle.setText('Almost done')
      return 'ok'
    })).resolves.toBe('ok')

    expect(PopupManager.instance.stack.some(popup => popup instanceof RenderLoadingModal)).toBe(false)

    service.dispose()
  })

  it('closes the loading modal after a wrapped task rejects and rethrows the error', async () => {
    PopupManager.instance.setContextProvider(() => ({ theme: ImGuiDarkTheme, viewport }))
    const service = new AppOverlayService()

    await expect(service.withLoading('Saving...', async () => {
      throw new Error('save failed')
    })).rejects.toThrow('save failed')

    expect(PopupManager.instance.stack.some(popup => popup instanceof RenderLoadingModal)).toBe(false)

    service.dispose()
  })

  it('keeps the loading modal above modal dialogs opened with closeExisting', () => {
    PopupManager.instance.setContextProvider(() => ({ theme: ImGuiDarkTheme, viewport }))
    const service = new AppOverlayService()
    const handle = service.showLoading('Loading...')
    const loadingModal = PopupManager.instance.current as RenderLoadingModal

    const modal = new RenderModal({
      title: 'Confirm',
      content: 'Proceed?',
    })
    modal.show()

    expect(handle.closed).toBe(false)
    expect(PopupManager.instance.stack).toEqual([modal, loadingModal])
    expect(PopupManager.instance.current).toBe(loadingModal)

    handle.close()
    modal.dispose()
    service.dispose()
  })
})

describe('AppOverlayService app context', () => {
  it('inherits context from the source render object when showing a floating window', () => {
    const key = createAppContextKey<string>('encounter-id')
    const rootContext = new AppContextRegistry(undefined, [[key, 'enc-1']])
    const owner = new PipelineOwner({ appContext: rootContext })
    const source = new TestOverlayBox()
    source.attach(owner)
    const host = new RenderWindow({ title: 'Host' })
    const service = new AppOverlayService()
    service.bindWindowHost(host)
    const popupWindow = new RenderWindow({ title: 'Popup' })
    const child = new TestOverlayBox()
    popupWindow.setChildren([child])

    service.showWindow(popupWindow, { source })

    expect(child.getAppContext(key)).toBe('enc-1')

    popupWindow.dispose()
    source.dispose()
    service.dispose()
    rootContext.dispose()
  })

  it('flattens source render-scope context before applying overlay values', () => {
    const workspaceKey = createAppContextKey<string>('workspace')
    const patientKey = createAppContextKey<string>('patient')
    const userKey = createAppContextKey<string>('user')
    const overlayKey = createAppContextKey<string>('overlay')
    const rootContext = new AppContextRegistry(undefined, [[userKey, 'doctor-1']])
    const owner = new PipelineOwner({ appContext: rootContext })
    const workspaceScope = new ContextOverlayBox(new AppContextRegistry(undefined, [[workspaceKey, 'ward-a']]))
    const patientScope = new ContextOverlayBox(new AppContextRegistry(undefined, [[patientKey, 'patient-1']]))
    const source = new TestOverlayBox()
    patientScope.parent = workspaceScope
    source.parent = patientScope
    source.attach(owner)
    const host = new RenderWindow({ title: 'Host' })
    const service = new AppOverlayService()
    service.bindWindowHost(host)
    const popupWindow = new RenderWindow({ title: 'Popup' })
    const child = new TestOverlayBox()
    popupWindow.setChildren([child])

    service.showWindow(popupWindow, {
      source,
      contextValues: [[overlayKey, 'open-once']],
    })

    expect(child.getAppContext(workspaceKey)).toBe('ward-a')
    expect(child.getAppContext(patientKey)).toBe('patient-1')
    expect(child.getAppContext(userKey)).toBe('doctor-1')
    expect(child.getAppContext(overlayKey)).toBe('open-once')

    popupWindow.dispose()
    source.dispose()
    service.dispose()
    rootContext.dispose()
  })

  it('always owns generated overlay context snapshots', () => {
    const sourceKey = createAppContextKey<string>('source')
    const overlayKey = createAppContextKey<string>('overlay')
    const rootContext = new AppContextRegistry(undefined, [[sourceKey, 'root']])
    const owner = new PipelineOwner({ appContext: rootContext })
    const source = new TestOverlayBox()
    source.attach(owner)
    const host = new RenderWindow({ title: 'Host' })
    const service = new AppOverlayService()
    service.bindWindowHost(host)
    const popupWindow = new RenderWindow({ title: 'Popup' })
    const child = new TestOverlayBox()
    popupWindow.setChildren([child])

    service.showWindow(popupWindow, {
      source,
      contextValues: [[overlayKey, 'overlay']],
      disposeContextOnClose: false,
    })

    const overlayContext = popupWindow[APP_CONTEXT_PROVIDER]()
    expect(child.getAppContext(sourceKey)).toBe('root')
    expect(child.getAppContext(overlayKey)).toBe('overlay')
    expect(overlayContext.disposed).toBe(false)

    popupWindow.dispose()

    expect(overlayContext.disposed).toBe(true)
    expect(rootContext.disposed).toBe(false)

    source.dispose()
    service.dispose()
    rootContext.dispose()
  })

  it('provides explicit context to modals without owning external context by default', () => {
    PopupManager.instance.setContextProvider(() => ({ theme: ImGuiDarkTheme, viewport }))
    const key = createAppContextKey<string>('workspace')
    const context = new AppContextRegistry(undefined, [[key, 'external']])
    const service = new AppOverlayService()

    const modal = service.showModal({
      title: 'Info',
      content: 'Done',
      context,
    })

    expect(modal.getAppContext(key)).toBe('external')

    modal.hide('ok')

    expect(context.disposed).toBe(false)

    service.dispose()
    context.dispose()
  })

  it('disposes explicit modal context only when requested', () => {
    PopupManager.instance.setContextProvider(() => ({ theme: ImGuiDarkTheme, viewport }))
    const key = createAppContextKey<string>('workspace')
    const context = new AppContextRegistry(undefined, [[key, 'external']])
    const service = new AppOverlayService()

    const modal = service.showModal({
      title: 'Info',
      content: 'Done',
      context,
      disposeContextOnClose: true,
    })

    expect(modal.getAppContext(key)).toBe('external')

    modal.hide('ok')

    expect(context.disposed).toBe(true)

    service.dispose()
  })
})

describe('AppOverlayService.showModalWindow', () => {
  it('resolves true or false through closeWithResult', async () => {
    const service = new AppOverlayService()
    const hostWindow = new RenderWindow({ title: 'Host' })
    const modalHost = createModalWindowHost()
    service.bindWindowHost(hostWindow)
    service.bindModalWindowHost(modalHost.host)

    const okWindow = new RenderWindow({ title: 'OK' })
    const okPromise = service.showModalWindow(okWindow)
    expect(service.activeModalWindow).toBe(okWindow)
    expect(hostWindow.getOwnedWindows()).toContain(okWindow)
    expect(modalHost.windows).toEqual([okWindow])
    okWindow.closeWithResult(true)
    await expect(okPromise).resolves.toBe(true)
    expect(service.activeModalWindow).toBeNull()

    const cancelWindow = new RenderWindow({ title: 'Cancel' })
    const cancelPromise = service.showModalWindow(cancelWindow)
    cancelWindow.closeWithResult(false)
    await expect(cancelPromise).resolves.toBe(false)

    service.dispose()
  })

  it('resolves false for uncontrolled close', async () => {
    const service = new AppOverlayService()
    const hostWindow = new RenderWindow({ title: 'Host' })
    service.bindWindowHost(hostWindow)
    service.bindModalWindowHost(createModalWindowHost().host)

    const modalWindow = new RenderWindow({ title: 'Close' })
    const promise = service.showModalWindow(modalWindow)
    modalWindow.close()

    await expect(promise).resolves.toBe(false)

    service.dispose()
  })

  it('disposes and unowns a modal window when closed without a runtime host wrapper', async () => {
    const service = new AppOverlayService()
    const hostWindow = new RenderWindow({ title: 'Host' })
    service.bindWindowHost(hostWindow)
    service.bindModalWindowHost(createModalWindowHost().host)

    const modalWindow = new RenderWindow({ title: 'Standalone' })
    const promise = service.showModalWindow(modalWindow)

    expect(hostWindow.getOwnedWindows()).toContain(modalWindow)

    modalWindow.closeWithResult(true)

    await expect(promise).resolves.toBe(true)
    expect(modalWindow.disposed).toBe(true)
    expect(hostWindow.getOwnedWindows()).not.toContain(modalWindow)

    service.dispose()
  })

  it('keeps nested modal windows in stack order', async () => {
    const service = new AppOverlayService()
    const hostWindow = new RenderWindow({ title: 'Host' })
    const modalHost = createModalWindowHost()
    service.bindWindowHost(hostWindow)
    service.bindModalWindowHost(modalHost.host)

    const first = new RenderWindow({ title: 'First' })
    const second = new RenderWindow({ title: 'Second' })
    const firstPromise = service.showModalWindow(first)
    const secondPromise = service.showModalWindow(second)

    expect(service.modalWindows).toEqual([first, second])
    expect(service.activeModalWindow).toBe(second)
    expect(modalHost.windows).toEqual([first, second])

    second.closeWithResult(true)
    await expect(secondPromise).resolves.toBe(true)
    expect(service.modalWindows).toEqual([first])
    expect(service.activeModalWindow).toBe(first)

    first.closeWithResult(false)
    await expect(firstPromise).resolves.toBe(false)
    expect(service.modalWindows).toEqual([])

    service.dispose()
  })

  it('restores the previous close and maximize button state after closing', async () => {
    const service = new AppOverlayService()
    const hostWindow = new RenderWindow({ title: 'Host' })
    service.bindWindowHost(hostWindow)
    service.bindModalWindowHost(createModalWindowHost().host)

    const modalWindow = new RenderWindow({
      title: 'Chrome',
      showCloseButton: false,
      showMaximizeButton: true,
    })
    const promise = service.showModalWindow(modalWindow)

    expect(modalWindow.showCloseButton).toBe(true)
    expect(modalWindow.showMaximizeButton).toBe(false)

    modalWindow.closeWithResult(true)

    await expect(promise).resolves.toBe(true)
    expect(modalWindow.showCloseButton).toBe(false)
    expect(modalWindow.showMaximizeButton).toBe(true)

    service.dispose()
  })

  it('rejects showing the same modal window twice', async () => {
    const service = new AppOverlayService()
    const hostWindow = new RenderWindow({ title: 'Host' })
    service.bindWindowHost(hostWindow)
    service.bindModalWindowHost(createModalWindowHost().host)

    const modalWindow = new RenderWindow({ title: 'Duplicate' })
    const promise = service.showModalWindow(modalWindow)

    expect(() => service.showModalWindow(modalWindow)).toThrow('same modal window')

    modalWindow.closeWithResult(false)
    await expect(promise).resolves.toBe(false)

    service.dispose()
  })
})

describe('AppOverlayService performance overlay', () => {
  it('routes visibility changes to the bound performance overlay controller', () => {
    let visible = false
    const controller: AppPerformanceOverlayController = {
      get performanceOverlayVisible() {
        return visible
      },
      setPerformanceOverlayVisible(nextVisible: boolean): void {
        visible = nextVisible
      },
      togglePerformanceOverlay(): boolean {
        visible = !visible
        return visible
      },
    }
    const service = new AppOverlayService()

    expect(service.performanceOverlayVisible).toBe(false)

    service.bindPerformanceOverlay(controller)

    expect(service.setPerformanceOverlayVisible(true)).toBe(true)
    expect(service.performanceOverlayVisible).toBe(true)
    expect(service.togglePerformanceOverlay()).toBe(false)
    expect(service.performanceOverlayVisible).toBe(false)

    service.unbindPerformanceOverlay(controller)

    expect(service.performanceOverlayVisible).toBe(false)
    expect(() => service.togglePerformanceOverlay()).toThrow(
      'AppOverlayService performance overlay is unavailable before Application.run() binds RuntimeHost.',
    )

    service.dispose()
  })

  it('rejects replacing a bound performance overlay controller', () => {
    const first: AppPerformanceOverlayController = {
      performanceOverlayVisible: false,
      setPerformanceOverlayVisible: vi.fn(),
      togglePerformanceOverlay: vi.fn(() => true),
    }
    const second: AppPerformanceOverlayController = {
      performanceOverlayVisible: false,
      setPerformanceOverlayVisible: vi.fn(),
      togglePerformanceOverlay: vi.fn(() => true),
    }
    const service = new AppOverlayService()

    service.bindPerformanceOverlay(first)

    expect(() => service.bindPerformanceOverlay(second)).toThrow(
      'AppOverlayService is already bound to a different performance overlay.',
    )
    expect(() => service.unbindPerformanceOverlay(second)).toThrow(
      'AppOverlayService cannot unbind a different performance overlay.',
    )

    service.dispose()
  })

  it('routes paint request debug actions to the bound runtime debug controller', () => {
    let paintRequestDebugEnabled = false
    const history = [{
      seq: 1,
      time: 10,
      kind: 'frame' as const,
      source: 'runtime' as const,
      reason: 'manual',
      alreadyScheduled: false,
      layoutNeeded: false,
      dirtyLayers: [],
      pipeline: {
        layoutCount: 0,
        paintCount: 0,
        transientPaintCount: 0,
        layoutTargets: [],
        paintTargets: [],
        transientPaintTargets: [],
      },
    }]
    const controller: AppRuntimeDebugController = {
      performanceOverlayVisible: false,
      setPerformanceOverlayVisible: vi.fn(),
      togglePerformanceOverlay: vi.fn(() => false),
      get paintRequestDebugEnabled() {
        return paintRequestDebugEnabled
      },
      setPaintRequestDebugEnabled(nextEnabled: boolean): void {
        paintRequestDebugEnabled = nextEnabled
      },
      getPaintRequestHistory: vi.fn(() => history),
      clearPaintRequestHistory: vi.fn(),
    }
    const service = new AppOverlayService()

    service.bindRuntimeDebug(controller)

    expect(service.paintRequestDebugEnabled).toBe(false)
    expect(service.togglePaintRequestDebug()).toBe(true)
    expect(service.paintRequestDebugEnabled).toBe(true)
    expect(service.getPaintRequestHistory()).toEqual(history)

    service.clearPaintRequestHistory()

    expect(controller.clearPaintRequestHistory).toHaveBeenCalledTimes(1)

    service.unbindRuntimeDebug(controller)
    expect(() => service.togglePaintRequestDebug()).toThrow(
      'AppOverlayService runtime debug controller is unavailable before Application.run() binds RuntimeHost.',
    )

    service.dispose()
  })

  it('shows and toggles the runtime diagnostics panel with current request history', () => {
    let paintRequestDebugEnabled = false
    const history = [{
      seq: 7,
      time: 20,
      kind: 'layout' as const,
      source: 'pipeline' as const,
      reason: 'pipeline:layout',
      detail: { type: 'layout', target: 'RenderTextBox' },
      alreadyScheduled: false,
      layoutNeeded: false,
      dirtyLayers: [],
      pipeline: {
        layoutCount: 1,
        paintCount: 0,
        transientPaintCount: 0,
        layoutTargets: ['RenderTextBox'],
        paintTargets: [],
        transientPaintTargets: [],
      },
    }]
    const controller: AppRuntimeDebugController = {
      performanceOverlayVisible: false,
      setPerformanceOverlayVisible: vi.fn(),
      togglePerformanceOverlay: vi.fn(() => false),
      get paintRequestDebugEnabled() {
        return paintRequestDebugEnabled
      },
      setPaintRequestDebugEnabled(nextEnabled: boolean): void {
        paintRequestDebugEnabled = nextEnabled
      },
      getPaintRequestHistory: vi.fn(() => history),
      clearPaintRequestHistory: vi.fn(() => {
        history.length = 0
      }),
    }
    const service = new AppOverlayService()
    const host = new RenderWindow({ title: 'Host' })
    service.bindWindowHost(host)
    service.bindRuntimeDebug(controller)

    const panel = service.showRuntimeDiagnosticsPanel()
    const devToolsWindow = service.devToolsWindow

    expect(service.runtimeDiagnosticsPanel).toBe(panel)
    expect(host.getOwnedWindows()).toContain(devToolsWindow)
    expect(panel.debugState()).toMatchObject({
      requestCount: 1,
      selectedSeq: 7,
      paintRequestDebugEnabled: false,
    })

    expect(service.toggleRuntimeDiagnosticsPanel()).toBe(false)
    expect(service.runtimeDiagnosticsPanel).toBeNull()

    service.dispose()
  })

  it('keeps legacy panel debugState shapes stable when switching DevTools tabs', () => {
    const controller: AppRuntimeDebugController = {
      performanceOverlayVisible: false,
      setPerformanceOverlayVisible: vi.fn(),
      togglePerformanceOverlay: vi.fn(() => false),
      paintRequestDebugEnabled: false,
      setPaintRequestDebugEnabled: vi.fn(),
      getPaintRequestHistory: vi.fn(() => [{
        seq: 11,
        time: 100,
        kind: 'frame' as const,
        source: 'pipeline' as const,
        reason: 'pipeline:paint',
        detail: { type: 'paint', target: 'RenderWindow' },
        alreadyScheduled: false,
        layoutNeeded: false,
        dirtyLayers: [],
        pipeline: {
          layoutCount: 0,
          paintCount: 1,
          transientPaintCount: 0,
          layoutTargets: [],
          paintTargets: ['RenderWindow'],
          transientPaintTargets: [],
        },
      }]),
      clearPaintRequestHistory: vi.fn(),
    }
    const service = new AppOverlayService()
    const host = new RenderWindow({ title: 'Host' })
    service.bindWindowHost(host)
    service.bindRuntimeDebug(controller)

    service.showDevTools({ activeTab: 'layout-inspector' })
    const layoutPanel = service.layoutInspectorPanel!
    const runtimePanel = service.showRuntimeDiagnosticsPanel()

    expect(runtimePanel.debugState()).toMatchObject({ requestCount: 1 })
    expect(service.devToolsWindow?.debugDevToolsState()).toMatchObject({ activeTab: 'runtime' })
    expect(layoutPanel.debugState()).toMatchObject({ selectedTypeName: '' })

    service.activateDevToolsTab('layout-inspector')

    expect(runtimePanel.debugState()).toMatchObject({ requestCount: 1 })
    expect(service.devToolsWindow?.debugDevToolsState()).toMatchObject({ activeTab: 'layout-inspector' })

    service.dispose()
  })

  it('registers custom DevTools tabs and updates an open DevTools window', () => {
    const service = new AppOverlayService()
    const host = new RenderWindow({ title: 'Host' })
    service.bindWindowHost(host)

    const unregister = service.registerDevToolsTab({
      key: 'network',
      label: 'Network',
      icon: 'server',
      createContent: () => new TestOverlayBox(),
    })
    const window = service.showDevTools({ activeTab: 'network' })
    const firstContent = window.debugDevToolsState().tabs.includes('network')

    expect(firstContent).toBe(true)
    expect(window.debugDevToolsState().activeTab).toBe('network')

    unregister()

    expect(window.debugDevToolsState().tabs).toEqual(['layout-inspector', 'runtime'])
    expect(window.debugDevToolsState().activeTab).toBe('layout-inspector')

    service.dispose()
  })

  it('rolls back an open DevTools tab update when a content factory fails', () => {
    const service = new AppOverlayService()
    const host = new RenderWindow({ title: 'Host' })
    const network = new TestOverlayBox()
    const stagedLogs = new TestOverlayBox()
    service.bindWindowHost(host)
    service.setDevToolsTabs([{
      key: 'network',
      label: 'Network',
      createContent: () => network,
    }])
    const window = service.showDevTools({ activeTab: 'network' })

    expect(() => service.setDevToolsTabs([
      {
        key: 'logs',
        label: 'Logs',
        createContent: () => stagedLogs,
      },
      {
        key: 'broken',
        label: 'Broken',
        createContent: () => { throw new Error('factory failed') },
      },
    ])).toThrow('factory failed')

    expect(stagedLogs.disposed).toBe(true)
    expect(network.disposed).toBe(false)
    expect(window.debugDevToolsState()).toMatchObject({
      activeTab: 'network',
      tabs: ['layout-inspector', 'runtime', 'network'],
    })

    service.dispose()
  })

  it('validates DevTools tab keys before invoking content factories', () => {
    const service = new AppOverlayService()
    const createContent = vi.fn(() => new TestOverlayBox())

    expect(() => service.setDevToolsTabs([{
      key: 'runtime',
      label: 'Duplicate runtime',
      createContent,
    }])).toThrow('already used')
    expect(createContent).not.toHaveBeenCalled()

    service.dispose()
  })

  it('disposes partially created tabs when opening DevTools fails', () => {
    const service = new AppOverlayService()
    const host = new RenderWindow({ title: 'Host' })
    const created = new TestOverlayBox()
    service.bindWindowHost(host)
    service.setDevToolsTabs([
      {
        key: 'network',
        label: 'Network',
        createContent: () => created,
      },
      {
        key: 'broken',
        label: 'Broken',
        createContent: () => { throw new Error('open failed') },
      },
    ])

    expect(() => service.showDevTools()).toThrow('open failed')
    expect(created.disposed).toBe(true)
    expect(service.devToolsWindow).toBeNull()
    expect(host.getOwnedWindows()).toEqual([])

    service.dispose()
  })

  it('notifies DevTools visibility changes', () => {
    const service = new AppOverlayService()
    const host = new RenderWindow({ title: 'Host' })
    const listener = vi.fn()
    service.bindWindowHost(host)

    const unsubscribe = service.subscribeDevToolsVisibility(listener)

    expect(listener).toHaveBeenCalledWith(false)
    service.showDevTools()
    expect(listener).toHaveBeenLastCalledWith(true)
    expect(service.devToolsVisible).toBe(true)

    service.devToolsWindow?.close()
    expect(listener).toHaveBeenLastCalledWith(false)
    expect(service.devToolsVisible).toBe(false)

    unsubscribe()
    service.showDevTools()
    expect(listener).toHaveBeenCalledTimes(3)

    service.dispose()
  })

  it('isolates failing DevTools visibility listeners during close', () => {
    const service = new AppOverlayService()
    const host = new RenderWindow({ title: 'Host' })
    const listenerError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failingListener = vi.fn(() => { throw new Error('listener failed') })
    const healthyListener = vi.fn()
    service.bindWindowHost(host)
    service.subscribeDevToolsVisibility(failingListener)
    service.subscribeDevToolsVisibility(healthyListener)
    const window = service.showDevTools()

    expect(() => window.close()).not.toThrow()
    expect(window.disposed).toBe(true)
    expect(service.devToolsWindow).toBeNull()
    expect(host.getOwnedWindows()).not.toContain(window)
    expect(healthyListener).toHaveBeenLastCalledWith(false)
    expect(listenerError).toHaveBeenCalledWith(
      'AppOverlayService DevTools visibility listener failed.',
      expect.any(Error),
    )

    service.dispose()
  })

  it('closes the runtime diagnostics panel when runtime debug is unbound', () => {
    const controller: AppRuntimeDebugController = {
      performanceOverlayVisible: false,
      setPerformanceOverlayVisible: vi.fn(),
      togglePerformanceOverlay: vi.fn(() => false),
      paintRequestDebugEnabled: false,
      setPaintRequestDebugEnabled: vi.fn(),
      getPaintRequestHistory: vi.fn(() => []),
      clearPaintRequestHistory: vi.fn(),
    }
    const service = new AppOverlayService()
    const host = new RenderWindow({ title: 'Host' })
    service.bindWindowHost(host)
    service.bindRuntimeDebug(controller)

    const panel = service.showRuntimeDiagnosticsPanel()
    const devToolsWindow = service.devToolsWindow

    service.unbindRuntimeDebug(controller)

    expect(panel.disposed).toBe(true)
    expect(service.runtimeDiagnosticsPanel).toBeNull()
    expect(host.getOwnedWindows()).not.toContain(devToolsWindow)

    service.dispose()
  })

  it('shows and reuses the runtime diagnostics snapshot viewer', () => {
    const service = new AppOverlayService()
    const host = new RenderWindow({ title: 'Host' })
    service.bindWindowHost(host)

    const first = service.showRuntimeDiagnosticsSnapshotViewer(diagnosticsSnapshot())
    const second = service.showRuntimeDiagnosticsSnapshotViewer({
      ...diagnosticsSnapshot(),
      paintRequests: [{
        seq: 1,
        time: 1,
        kind: 'frame',
        source: 'runtime',
        reason: 'manual',
        alreadyScheduled: false,
        layoutNeeded: false,
        dirtyLayers: [],
        pipeline: {
          layoutCount: 0,
          paintCount: 1,
          transientPaintCount: 0,
          layoutTargets: [],
          paintTargets: ['RenderWindow'],
          transientPaintTargets: [],
        },
      }],
    })

    expect(second).toBe(first)
    expect(service.runtimeDiagnosticsSnapshotViewer).toBe(first)
    expect(host.getOwnedWindows()).toContain(first)
    expect(first.debugState().summaryText).toContain('requests 1')

    service.dispose()
  })
})
