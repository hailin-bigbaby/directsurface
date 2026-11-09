import { RenderBox } from '../layout/render_box'
import { RenderObject } from '../core/render_object'
import {
  APP_CONTEXT_PROVIDER,
  AppContextRegistry,
} from '../core/app_context'
import { AnimationController } from '../animation/animation_controller'
import { Curves } from '../animation/curves'
import { isPrimaryPointerButton, type PointerEvent, type WheelPointerEvent } from '../gestures/hit_test'
import { PopupManager, type Popup, type PopupContext } from '../core/popup_manager'
import type { PaintContext } from '../rendering/paint_context'
import type { BoxConstraints, Offset } from '../core/render_object'
import { DialogScroller, resolveDialogLayout, paintDialog, dialogButtonAt } from './dialog_layout'
import { DefaultThemeMotion, resolveThemeMotion } from '../theme/theme'

export type DialogIntent = 'info' | 'warning' | 'success' | 'error'

export interface ModalButton {
  label: string
  key: string
  primary?: boolean
  danger?: boolean
}

export class RenderModal extends RenderBox implements Popup {
  static override debugTypeName = 'RenderModal'
  private static readonly _emptyAppContext = new AppContextRegistry()

  title: string
  intent?: DialogIntent | null
  content: string
  buttons: ModalButton[]
  onClose?: (buttonKey: string | null) => void

  modalWidth: number
  modalHeight: number

  overlayLayer = 'overlay' as const

  private _fadeAnim: AnimationController
  private readonly _scroller = new DialogScroller()
  private _focusIndex = -1
  private _hoveredButton = ''
  private _pressedButton = ''
  private _appContext?: AppContextRegistry
  private _disposeAppContextOnDispose = false

  constructor(opts: {
    title: string
    intent?: DialogIntent | null
    content: string
    buttons?: ModalButton[]
    visible?: boolean
    modalWidth?: number
    modalHeight?: number
    appContext?: AppContextRegistry
    disposeAppContextOnDispose?: boolean
    onClose?: (buttonKey: string | null) => void
  }) {
    super()
    this.title = opts.title
    this.intent = opts.intent === undefined ? 'info' : opts.intent
    this.content = opts.content
    this.buttons = opts.buttons ?? [
      { label: '取消', key: 'cancel' },
      { label: '确认', key: 'ok', primary: true },
    ]
    this.visible = opts.visible ?? false
    this.modalWidth = opts.modalWidth ?? 360
    this.modalHeight = opts.modalHeight ?? 0
    this._appContext = opts.appContext
    this._disposeAppContextOnDispose = opts.disposeAppContextOnDispose ?? false
    this.onClose = opts.onClose

    this._fadeAnim = new AnimationController({ duration: DefaultThemeMotion.normalDuration, curve: Curves.easeOut })
    this._fadeAnim.addListener(() => PopupManager.instance.requestPaint())

    if (this.visible) this._fadeAnim.resetValue(1)
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  get appContext(): AppContextRegistry | undefined {
    return this._appContext
  }

  [APP_CONTEXT_PROVIDER](): AppContextRegistry {
    return this._appContext ?? RenderModal._emptyAppContext
  }

  setAppContext(context?: AppContextRegistry, options: { disposeOnDispose?: boolean } = {}): void {
    const disposeOnDispose = options.disposeOnDispose ?? false
    if (this._appContext === context && this._disposeAppContextOnDispose === disposeOnDispose) return
    const previousContext = this._appContext
    const disposePrevious = this._disposeAppContextOnDispose
    this._appContext = context
    this._disposeAppContextOnDispose = disposeOnDispose
    if (previousContext && previousContext !== context && disposePrevious) previousContext.dispose()
  }

  performLayout(constraints: BoxConstraints): void {
    this.size = {
      width: constraints.maxWidth === Infinity ? this.size.width : constraints.maxWidth,
      height: constraints.maxHeight === Infinity ? this.size.height : constraints.maxHeight,
    }
  }

  // ---- Popup interface ----

  close(): void {
    this.hide(null)
  }

  onOutsidePointerDown(_event: PointerEvent, _popupContext?: PopupContext): boolean {
    return true
  }

  onEscape(_event: KeyboardEvent): boolean {
    this.hide(null)
    return true
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (!this.visible || event.isComposing || event.keyCode === 229) return false
    const layout = this._resolveLayout(PopupManager.instance.context, { x: PopupManager.instance.context.viewport.x ?? 0, y: PopupManager.instance.context.viewport.y ?? 0 }, 1)
    if (this._scroller.key(event, layout)) return true
    if (event.key === 'Tab') {
      event.preventDefault()
      const count = this.buttons.length
      if (count) {
        this._focusIndex = this._focusIndex < 0
          ? (event.shiftKey ? count - 1 : 0)
          : (this._focusIndex + (event.shiftKey ? -1 : 1) + count) % count
        this._scroller.ensure(layout.buttons[this._focusIndex]!, layout)
      }
      PopupManager.instance.requestPaint()
      return true
    }
    if (event.key === 'Enter' || (event.key === ' ' && this._focusIndex >= 0)) {
      const button = this.buttons[this._focusIndex] ?? this.buttons.find(b => b.primary)
      if (button) { event.preventDefault(); this.hide(button.key); return true }
    }
    if (event.key === 'Escape') { event.preventDefault(); this.hide(null); return true }
    return false
  }

  onWheel(event: WheelPointerEvent, context = PopupManager.instance.context): boolean {
    this._scroller.wheel(event, this._resolveLayout(context, { x: context.viewport.x ?? 0, y: context.viewport.y ?? 0 }, 1))
    return true
  }

  // ---- Show / Hide ----

  show(): void {
    if (this.visible) return
    this.visible = true
    this._scroller.reset()
    this._focusIndex = -1
    this._hoveredButton = this._pressedButton = ''
    this._fadeAnim.duration = resolveThemeMotion(PopupManager.instance.context.theme).normalDuration
    this._fadeAnim.resetValue(0)
    this._fadeAnim.forward()
    PopupManager.instance.open(this, { closeExisting: true })
    PopupManager.instance.requestPaint()
  }

  hide(buttonKey: string | null = null): void {
    if (!this.visible) return
    this.visible = false
    PopupManager.instance.dismiss(this)
    this.onClose?.(buttonKey)
    PopupManager.instance.requestPaint()
  }

  // ---- Pointer handlers (Popup interface: Offset parameter) ----

  onPointerDown(event: PointerEvent, popupContext: PopupContext = PopupManager.instance.context): void {
    if (!isPrimaryPointerButton(event)) return
    if (!this.visible) return
    if (this._scroller.pointer('down', event, this._resolveLayout(popupContext, { x: popupContext.viewport.x ?? 0, y: popupContext.viewport.y ?? 0 }, 1), popupContext)) return
    const btn = this._buttonAt(event.position, popupContext)
    if (btn !== this._pressedButton) {
      this._pressedButton = btn
      PopupManager.instance.requestPaint()
    }
  }

  onPointerMove(event: PointerEvent, popupContext: PopupContext = PopupManager.instance.context): void {
    if (!this.visible) return
    if (this._scroller.pointer('move', event, this._resolveLayout(popupContext, { x: popupContext.viewport.x ?? 0, y: popupContext.viewport.y ?? 0 }, 1), popupContext)) return
    const btn = this._buttonAt(event.position, popupContext)
    if (btn !== this._hoveredButton) {
      this._hoveredButton = btn
      PopupManager.instance.requestPaint()
    }
  }

  onPointerUp(event: PointerEvent, popupContext: PopupContext = PopupManager.instance.context): void {
    if (!isPrimaryPointerButton(event)) return
    if (!this.visible) return
    if (this._scroller.pointer('up', event, this._resolveLayout(popupContext, { x: popupContext.viewport.x ?? 0, y: popupContext.viewport.y ?? 0 }, 1), popupContext)) return
    const btn = this._buttonAt(event.position, popupContext)
    const shouldClose = !!btn && btn === this._pressedButton
    const hadPressed = !!this._pressedButton
    this._pressedButton = ''
    if (shouldClose) {
      this.hide(btn)
      return
    }
    if (hadPressed) PopupManager.instance.requestPaint()
  }

  // ---- Paint ----

  paint(context: PaintContext, offset: Offset = { x: 0, y: 0 }): void {
    const popupContext = PopupManager.instance.context
    this._syncViewportSize(popupContext)
    super.paint(context, {
      x: offset.x + (popupContext.viewport.x ?? 0),
      y: offset.y + (popupContext.viewport.y ?? 0),
    })
  }

  performPaint(context: PaintContext, offset: Offset): void {
    if (!this.visible && this._fadeAnim.value === 0) return
    const popup = PopupManager.instance.context
    const layout = this._resolveLayout(popup, offset, this._fadeAnim.value)
    paintDialog(context, popup, layout, this.title, this._fadeAnim.value, this._scroller, this._hoveredButton, this._pressedButton, this.buttons[this._focusIndex]?.key ?? '', this.intent)
  }

  private _buttonAt(point: Offset, context: PopupContext): string {
    return dialogButtonAt(point, this._resolveLayout(context, { x: context.viewport.x ?? 0, y: context.viewport.y ?? 0 }, 1))
  }

  private _resolveLayout(context: PopupContext, offset: Offset, _alpha: number) {
    return resolveDialogLayout(context, this.modalWidth, this.modalHeight, this.content, this.buttons, 0, this._scroller.offset, offset)
  }

  onPointerCancel(_event: PointerEvent): void {
    this._scroller.cancel(); this._pressedButton = this._hoveredButton = ''
    PopupManager.instance.requestPaint()
  }

  hitTest(point: Offset, popupContext: PopupContext = PopupManager.instance.context): boolean {
    if (!this.visible) return false
    const x = popupContext.viewport.x ?? 0
    const y = popupContext.viewport.y ?? 0
    return point.x >= x && point.x <= x + popupContext.viewport.width &&
           point.y >= y && point.y <= y + popupContext.viewport.height
  }

  dispose(): void {
    this.close()
    this._fadeAnim.dispose()
    super.dispose()
    if (this._disposeAppContextOnDispose) this._appContext?.dispose()
    this._appContext = undefined
    this._disposeAppContextOnDispose = false
  }

  private _syncViewportSize(popupContext: PopupContext): void {
    this.size = {
      width: popupContext.viewport.width,
      height: popupContext.viewport.height,
    }
  }
}
