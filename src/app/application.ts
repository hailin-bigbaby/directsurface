// Application: 业务层对外入口
// 目标使用形态: Application.mount('#app').run(new MainWindow())
// Application 只负责找到宿主 canvas，并启动围绕主窗口运行的应用
// AppHost 退化为极薄的应用生命周期壳；窗口树、layer 与 close 机制改由 RuntimeHost 接管

import { RuntimeHost, type RuntimeCaptureImageOptions, type RuntimeSize } from '../runtime/runtime_host'
import type { ResolvedTheme } from '../theme/theme'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { RenderWindow } from '../widgets/window'
import { AppOverlayService, type AppOverlayServiceConsumer } from './app_overlay_service'
import { KeyboardBindingController } from '../core/keyboard_binding_controller'
import {
  type AppContextInitialValues,
  AppContextRegistry,
  createAppContext,
} from '../core/app_context'

export interface ApplicationRunOptions {
  dpr?: number
  enableLayoutInspector?: boolean
  enablePerformanceMonitoring?: boolean
  enablePerformanceOverlay?: boolean
  getViewportSize?: () => { width: number, height: number }
  onResize?: (size: RuntimeSize) => void
  theme?: ResolvedTheme
  context?: AppContextInitialValues
}

export class Application {
  private _canvas: HTMLCanvasElement | null = null

  static mount(selector: string): Application {
    const app = new Application()
    const el = document.querySelector(selector)
    if (!el || !(el instanceof HTMLCanvasElement)) {
      throw new Error(`Canvas element "${selector}" was not found.`)
    }
    app._canvas = el
    return app
  }

  run(mainWindow: RenderWindow, options?: ApplicationRunOptions): AppHost {
    if (!this._canvas) throw new Error('Application.mount() must be called before run()')
    return AppHost.create(this._canvas, mainWindow, options)
  }

  get canvas(): HTMLCanvasElement | null { return this._canvas }
}

export class AppHost {
  private _disposed = false
  private _keyboardShortcutDisposer?: () => void

  private constructor(
    private readonly _runtime: RuntimeHost,
    private readonly _uiServices: AppOverlayService,
    private readonly _uiServiceConsumer: (RenderWindow & AppOverlayServiceConsumer) | null,
    private readonly _appContext: AppContextRegistry,
  ) {}

  static create(
    canvas: HTMLCanvasElement,
    mainWindow: RenderWindow,
    options?: ApplicationRunOptions,
  ): AppHost {
    const appContext = createAppContext(options?.context)
    const runtime = new RuntimeHost({
      canvas,
      dpr: options?.dpr,
      getViewportSize: options?.getViewportSize,
      onResize: options?.onResize,
      appContext,
      enablePerformanceMonitoring: options?.enablePerformanceMonitoring,
      enablePerformanceOverlay: options?.enablePerformanceOverlay,
    })
    const uiServiceConsumer = supportsAppOverlayServiceConsumer(mainWindow) ? mainWindow : null
    let uiServices: AppOverlayService | null = null
    let host: AppHost | null = null
    let servicesBound = false

    try {
      runtime.initTheme(options?.theme ?? mainWindow.resolveWindowTheme() ?? ImGuiDarkTheme)

      uiServices = new AppOverlayService()
      uiServices.bindWindowHost(mainWindow)
      uiServices.bindDockWindowHost(runtime)
      uiServices.bindModalWindowHost(runtime)
      uiServices.bindPerformanceOverlay(runtime)
      uiServices.bindRuntimeDebug(runtime)
      uiServices.bindLayoutInspector(runtime.layoutInspector)
      host = new AppHost(runtime, uiServices, uiServiceConsumer, appContext)
      uiServiceConsumer?.bindAppOverlayService(uiServices)
      servicesBound = uiServiceConsumer !== null

      runtime.runMainWindow(mainWindow, {
        onMainWindowClose: () => host?.dispose(),
        themeSource: options?.theme === undefined ? 'main-window' : 'runtime',
      })
      if (options?.enableLayoutInspector) {
        host._installKeyboardShortcuts()
      }
      runtime.scheduleFrame()

      return host
    } catch (error) {
      try {
        if (servicesBound && uiServices) {
          releaseAppOverlayServiceConsumer(uiServiceConsumer, uiServices)
        }
      } catch {
        // Preserve the original startup failure after best-effort cleanup.
      } finally {
        try {
          uiServices?.dispose()
        } finally {
          try {
            runtime.dispose()
          } finally {
            appContext.dispose()
          }
        }
      }
      throw error
    }
  }

  get theme(): ResolvedTheme { return this._runtime.theme }
  get uiServices(): AppOverlayService { return this._uiServices }
  get context(): AppContextRegistry { return this._appContext }

  setTheme(theme: ResolvedTheme): void {
    this._runtime.setTheme(theme)
  }

  useMainWindowTheme(): void {
    this._runtime.useMainWindowTheme()
  }

  captureImageDataUrl(options?: RuntimeCaptureImageOptions): string {
    return this._runtime.captureImageDataUrl(options)
  }

  captureImageBlob(options?: RuntimeCaptureImageOptions): Promise<Blob> {
    return this._runtime.captureImageBlob(options)
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this._keyboardShortcutDisposer?.()
    this._keyboardShortcutDisposer = undefined
    try {
      releaseAppOverlayServiceConsumer(this._uiServiceConsumer, this._uiServices)
    } finally {
      try {
        this._uiServices.dispose()
      } finally {
        try {
          this._runtime.dispose()
        } finally {
          this._appContext.dispose()
        }
      }
    }
  }

  private _installKeyboardShortcuts(): void {
    if (this._keyboardShortcutDisposer) return
    this._keyboardShortcutDisposer = KeyboardBindingController.instance.addBinding(event => {
      if (this._uiServices.activeModalWindow) {
        if (event.ctrlKey || event.metaKey || event.altKey || event.key === 'Escape') {
          event.preventDefault()
          return true
        }
        return false
      }

      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'i') {
        event.preventDefault()
        this._uiServices.toggleDevTools({ activeTab: 'layout-inspector' })
        return true
      }

      if (event.key === 'Escape') {
        const state = this._uiServices.layoutInspectorDebugState
        if (!state?.overlayVisible && !state?.selected && !state?.hover) return false
        event.preventDefault()
        this._uiServices.clearLayoutInspectorSelection()
        return true
      }

      return false
    }, 1000)
  }
}

function supportsAppOverlayServiceConsumer(value: RenderWindow): value is RenderWindow & AppOverlayServiceConsumer {
  return typeof (value as Partial<AppOverlayServiceConsumer>).bindAppOverlayService === 'function'
}

function releaseAppOverlayServiceConsumer(
  consumer: (RenderWindow & AppOverlayServiceConsumer) | null,
  uiServices: AppOverlayService,
): void {
  if (!consumer || typeof consumer.unbindAppOverlayService !== 'function') return
  consumer.unbindAppOverlayService(uiServices)
}
