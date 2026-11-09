import { AnimationController } from '../animation/animation_controller'
import { Curves } from '../animation/curves'
import type { BoxConstraints, Offset } from '../core/render_object'
import {
  APP_CONTEXT_PROVIDER,
  AppContextRegistry,
} from '../core/app_context'
import { RenderBox } from '../layout/render_box'
import type { PaintContext } from '../rendering/paint_context'
import { PopupManager, type Popup, type PopupContext } from '../core/popup_manager'
import { isPrimaryPointerButton, type PointerEvent, type WheelPointerEvent } from '../gestures/hit_test'
import { deriveTextInputStyle } from '../theme/component_styles'
import { DefaultThemeMotion, resolveThemeMotion } from '../theme/theme'
import { DialogScroller, resolveDialogLayout, paintDialog, dialogButtonAt, inDialogRect } from './dialog_layout'
import type { ModalButton, DialogIntent } from './modal'
import type { RenderObject } from '../core/render_object'
import { RenderTextBox } from './text_field'
import { FocusManager } from '../core/focus_manager'

export class RenderPromptModal extends RenderBox implements Popup {
  static override debugTypeName = 'RenderPromptModal'
  private static readonly _emptyAppContext = new AppContextRegistry()

  title: string
  intent?: DialogIntent | null
  content: string
  placeholder: string
  buttons: ModalButton[]
  modalWidth: number
  modalHeight: number
  onClose?: (buttonKey: string | null, value: string) => void

  overlayLayer = 'overlay' as const

  private _value: string
  private readonly _fadeAnim: AnimationController
  private readonly _field: RenderTextBox
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
    value?: string
    placeholder?: string
    buttons?: ModalButton[]
    visible?: boolean
    modalWidth?: number
    modalHeight?: number
    appContext?: AppContextRegistry
    disposeAppContextOnDispose?: boolean
    onClose?: (buttonKey: string | null, value: string) => void
  }) {
    super()
    this.title = opts.title
    this.intent = opts.intent === undefined ? 'info' : opts.intent
    this.content = opts.content
    this.placeholder = opts.placeholder ?? ''
    this._value = opts.value ?? ''
    this.buttons = opts.buttons ?? [
      { label: '取消', key: 'cancel' },
      { label: '确认', key: 'ok', primary: true },
    ]
    this.visible = opts.visible ?? false
    this.modalWidth = opts.modalWidth ?? 420
    this.modalHeight = opts.modalHeight ?? 0
    this._appContext = opts.appContext
    this._disposeAppContextOnDispose = opts.disposeAppContextOnDispose ?? false
    this.onClose = opts.onClose
    this._field = new RenderTextBox({
      value: this._value,
      placeholder: this.placeholder,
      clearable: true,
      onChange: value => {
        this._value = value
        PopupManager.instance.requestPaint()
      },
      onSubmit: value => {
        this._value = value
        const primary = this.buttons.find(button => button.primary)
        if (primary) this.hide(primary.key)
      },
    })
    this._field.parent = this
    this._fadeAnim = new AnimationController({ duration: DefaultThemeMotion.normalDuration, curve: Curves.easeOut })
    this._fadeAnim.addListener(() => PopupManager.instance.requestPaint())
    if (this.visible) this._fadeAnim.resetValue(1)
  }

  get value(): string {
    return this._value
  }

  get appContext(): AppContextRegistry | undefined {
    return this._appContext
  }

  [APP_CONTEXT_PROVIDER](): AppContextRegistry {
    return this._appContext ?? RenderPromptModal._emptyAppContext
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

  visitChildren(visitor: (child: RenderObject) => void): void {
    visitor(this._field)
  }

  focusRoots(): readonly RenderObject[] {
    return [this]
  }

  performLayout(constraints: BoxConstraints): void {
    this.size = {
      width: constraints.maxWidth === Infinity ? this.size.width : constraints.maxWidth,
      height: constraints.maxHeight === Infinity ? this.size.height : constraints.maxHeight,
    }
  }

  close(): void {
    this.hide(null)
  }

  onOutsidePointerDown(_event: PointerEvent, _popupContext?: PopupContext): boolean {
    return true
  }

  onEscape(event: KeyboardEvent): boolean {
    event.preventDefault()
    this.hide(null)
    return true
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (!this.visible || event.isComposing || event.keyCode === 229) return false
    const layout = this._layout(PopupManager.instance.context)
    if (this._scroller.key(event, layout)) return true
    if (event.key === 'Tab') {
      event.preventDefault()
      const count = this.buttons.length + 1
      this._focusIndex = ((this._focusIndex + 1 + (event.shiftKey ? -1 : 1) + count) % count) - 1
      if (this._focusIndex < 0) {
        this._scroller.ensure(layout.inputRect, layout)
        this._syncFieldLayout(PopupManager.instance.context)
        FocusManager.instance.setFocus(this._field)
        this._field.focusIn()
      } else {
        this._field.focusOut()
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
    this._scroller.wheel(event, this._layout(context))
    return true
  }

  show(): void {
    if (this.visible) return
    this.visible = true
    this._scroller.reset()
    this._focusIndex = -1
    this._fadeAnim.duration = resolveThemeMotion(PopupManager.instance.context.theme).normalDuration
    this._hoveredButton = ''
    this._pressedButton = ''
    this._field.value = this._value
    this._fadeAnim.resetValue(0)
    this._fadeAnim.forward()
    PopupManager.instance.open(this, { closeExisting: true })
    this._scroller.ensure(this._layout(PopupManager.instance.context).inputRect, this._layout(PopupManager.instance.context))
    this._syncFieldLayout(PopupManager.instance.context)
    FocusManager.instance.setFocus(this._field)
    PopupManager.instance.requestPaint()
  }

  hide(buttonKey: string | null = null): void {
    if (!this.visible) return
    this.visible = false
    PopupManager.instance.dismiss(this)
    this._value = this._field.value
    this._field.focusOut()
    this.onClose?.(buttonKey, this._value)
    PopupManager.instance.requestPaint()
  }

  onPointerDown(event: PointerEvent, popupContext: PopupContext = PopupManager.instance.context): void {
    if (!isPrimaryPointerButton(event)) return
    if (!this.visible) return
    if (this._scroller.pointer('down', event, this._layout(popupContext), popupContext)) return
    const inputRect = this._inputRect(popupContext)
    if (pointInRect(event.position, inputRect) && (!this._layout(popupContext).scrollAll || inDialogRect(event.position, this._layout(popupContext).body))) {
      this._focusIndex = -1
      this._pressedButton = ''
      this._syncFieldLayout(popupContext)
      this._field.onPointerDown(event as never)
      PopupManager.instance.requestPaint()
      return
    }
    const button = this._buttonAt(event.position, popupContext)
    if (button !== this._pressedButton) {
      this._pressedButton = button
      PopupManager.instance.requestPaint()
    }
  }

  onPointerMove(event: PointerEvent, popupContext: PopupContext = PopupManager.instance.context): void {
    if (!this.visible) return
    if (this._scroller.pointer('move', event, this._layout(popupContext), popupContext)) return
    this._field.onPointerMove(event as never)
    const inputRect = this._inputRect(popupContext)
    const button = pointInRect(event.position, inputRect) ? '' : this._buttonAt(event.position, popupContext)
    if (button !== this._hoveredButton) {
      this._hoveredButton = button
      PopupManager.instance.requestPaint()
    }
  }

  onPointerUp(event: PointerEvent, popupContext: PopupContext = PopupManager.instance.context): void {
    if (!isPrimaryPointerButton(event)) return
    if (!this.visible) return
    if (this._scroller.pointer('up', event, this._layout(popupContext), popupContext)) return
    this._field.onPointerUp(event as never)
    const button = this._buttonAt(event.position, popupContext)
    const shouldClose = !!button && button === this._pressedButton
    const hadPressed = !!this._pressedButton
    this._pressedButton = ''
    if (shouldClose) {
      this.hide(button)
      return
    }
    if (hadPressed) PopupManager.instance.requestPaint()
  }

  onPointerCancel(_event: PointerEvent): void {
    this._scroller.cancel()
    this._field.onPointerCancel({ pointerId: -1, position: { x: -1, y: -1 }, type: 'cancel' } as never)
    const hadPressed = !!this._pressedButton || !!this._hoveredButton
    this._pressedButton = ''
    this._hoveredButton = ''
    if (hadPressed) PopupManager.instance.requestPaint()
  }

  paint(context: PaintContext, offset: Offset = { x: 0, y: 0 }): void {
    const popupContext = PopupManager.instance.context
    this._syncViewportSize(popupContext)
    super.paint(context, {
      x: offset.x + (popupContext.viewport.x ?? 0),
      y: offset.y + (popupContext.viewport.y ?? 0),
    })
  }

  performPaint(context: PaintContext, _offset: Offset): void {
    if (!this.visible && this._fadeAnim.value === 0) return
    const popup = PopupManager.instance.context
    const layout = this._layout(popup)
    this._syncFieldLayout(popup)
    paintDialog(context, popup, layout, this.title, this._fadeAnim.value, this._scroller, this._hoveredButton, this._pressedButton, this.buttons[this._focusIndex]?.key ?? '', this.intent, () => {
      this._field.paint(context, this._field.globalOffset)
      this._field.paintTransient(context, this._field.globalOffset)
    })
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

  private _layout(context: PopupContext) {
    return resolveDialogLayout(context, this.modalWidth, this.modalHeight, this.content, this.buttons, deriveTextInputStyle(context.theme).height, this._scroller.offset)
  }

  private _inputRect(popupContext: PopupContext): { x: number; y: number; w: number; h: number } {
    return this._layout(popupContext).inputRect
  }

  private _buttonAt(point: Offset, context: PopupContext): string {
    return dialogButtonAt(point, this._layout(context))
  }

  private _syncViewportSize(popupContext: PopupContext): void {
    this.size = {
      width: popupContext.viewport.width,
      height: popupContext.viewport.height,
    }
  }

  private _syncFieldLayout(popupContext: PopupContext): void {
    const layout = this._layout(popupContext)
    this._field.offset = { x: layout.inputRect.x, y: layout.inputRect.y }
    this._field.layout({
      minWidth: layout.inputRect.w,
      maxWidth: layout.inputRect.w,
      minHeight: layout.inputRect.h,
      maxHeight: layout.inputRect.h,
    }, true, { theme: popupContext.theme })
  }
}

function pointInRect(point: Offset, rect: { x: number; y: number; w: number; h: number }): boolean {
  return point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
}
