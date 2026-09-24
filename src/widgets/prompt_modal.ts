import { AnimationController } from '../animation/animation_controller'
import { Curves } from '../animation/curves'
import type { BoxConstraints, Offset } from '../core/render_object'
import {
  APP_CONTEXT_PROVIDER,
  AppContextRegistry,
} from '../core/app_context'
import { RenderBox } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { PopupManager, type Popup, type PopupContext } from '../core/popup_manager'
import { isPrimaryPointerButton, type PointerEvent, type WheelPointerEvent } from '../gestures/hit_test'
import { TextMeasurer } from '../core/text_measurer'
import {
  deriveModalStyle,
  deriveTextInputStyle,
  resolveBgColor,
  resolveTextColor,
} from '../theme/component_styles'
import type { ModalButton } from './modal'
import type { RenderObject } from '../core/render_object'
import { RenderTextBox } from './text_field'
import { FocusManager } from '../core/focus_manager'

export class RenderPromptModal extends RenderBox implements Popup {
  static override debugTypeName = 'RenderPromptModal'
  private static readonly _emptyAppContext = new AppContextRegistry()

  title: string
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
  private _hoveredButton = ''
  private _pressedButton = ''
  private _appContext?: AppContextRegistry
  private _disposeAppContextOnDispose = false

  constructor(opts: {
    title: string
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
    this.content = opts.content
    this.placeholder = opts.placeholder ?? ''
    this._value = opts.value ?? ''
    this.buttons = opts.buttons ?? [
      { label: '取消', key: 'cancel' },
      { label: '确认', key: 'ok', primary: true },
    ]
    this.visible = opts.visible ?? false
    this.modalWidth = opts.modalWidth ?? 420
    this.modalHeight = opts.modalHeight ?? 220
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
        this.hide('ok')
      },
    })
    this._field.parent = this
    this._fadeAnim = new AnimationController({ duration: 180, curve: Curves.easeOut })
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
    if (!this.visible) return false
    if (event.key === 'Tab') {
      event.preventDefault()
      return true
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      this.hide('ok')
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      this.hide(null)
      return true
    }
    return false
  }

  onWheel(_event: WheelPointerEvent, _popupContext?: PopupContext): boolean {
    return true
  }

  show(): void {
    if (this.visible) return
    this.visible = true
    this._hoveredButton = ''
    this._pressedButton = ''
    this._field.value = this._value
    this._fadeAnim.resetValue(0)
    this._fadeAnim.forward()
    PopupManager.instance.open(this, { closeExisting: true })
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
    const inputRect = this._inputRect(popupContext)
    if (pointInRect(event.position, inputRect)) {
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

  performPaint(context: PaintContext, offset: Offset): void {
    if (!this.visible && this._fadeAnim.value === 0) return
    const popupContext = PopupManager.instance.context
    const modal = deriveModalStyle(context.theme)
    const alpha = this._fadeAnim.value
    const dl = new DrawList(context)
    const { x, y } = offset
    const { width, height } = this.size
    const layout = this._layout(popupContext)

    dl.fillRect(x, y, width, height, { ...modal.overlayBg, a: modal.overlayBg.a * alpha }, 0)
    dl.outerShadow(
      layout.panelX,
      layout.panelY,
      layout.panelW,
      layout.panelH,
      modal.shadowBlur,
      { ...modal.shadowColor, a: modal.shadowColor.a * alpha },
      modal.borderRadius,
      modal.shadowOffsetX,
      modal.shadowOffsetY,
    )
    dl.fillRect(layout.panelX, layout.panelY, layout.panelW, layout.panelH, { ...modal.panelBg, a: modal.panelBg.a * alpha }, modal.borderRadius)
    dl.strokeRect(layout.panelX, layout.panelY, layout.panelW, layout.panelH, { ...modal.panelBorder, a: modal.panelBorder.a * alpha }, 1, modal.borderRadius)

    const ctx = context.ctx
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.beginPath()
    ctx.roundRect(layout.panelX, layout.panelY, layout.panelW, modal.titleHeight, [modal.borderRadius, modal.borderRadius, 0, 0])
    ctx.fillStyle = `rgba(${modal.titleBg.r},${modal.titleBg.g},${modal.titleBg.b},${modal.titleBg.a})`
    ctx.fill()
    ctx.restore()

    dl.fillText(this.title, layout.panelX + layout.panelW / 2, layout.panelY + modal.titleHeight / 2, { ...modal.titleText, a: modal.titleText.a * alpha }, modal.fontSize, modal.fontFamily, 'center', 'middle')
    dl.line(layout.panelX, layout.panelY + modal.titleHeight, layout.panelX + layout.panelW, layout.panelY + modal.titleHeight, { ...modal.separator, a: alpha }, 1)

    dl.fillText(this.content, layout.panelX + modal.padding, layout.contentY + modal.fontSize / 2, { ...modal.text, a: alpha }, modal.fontSize, modal.fontFamily, 'left', 'middle')
    this._syncFieldLayout(popupContext)
    this._field.paint(context, this._field.globalOffset)
    this._field.paintTransient(context, this._field.globalOffset)

    for (const button of layout.buttons) {
      const isHovered = button.key === this._hoveredButton
      const isPressed = button.key === this._pressedButton
      const state = isPressed ? 'pressed' : isHovered ? 'hovered' : 'normal'
      const bgTokens = button.danger ? modal.dangerButtonBg : button.primary ? modal.primaryButtonBg : modal.secondaryButtonBg
      const textTokens = button.danger ? modal.dangerButtonText : button.primary ? modal.primaryButtonText : modal.secondaryButtonText
      const bg = resolveBgColor(bgTokens, state)
      dl.fillRect(button.x, layout.buttonY, button.w, modal.buttonHeight, { ...bg, a: bg.a * alpha }, modal.buttonRadius)
      if (!button.primary && !button.danger) {
        const border = resolveBgColor(modal.secondaryButtonBorder, state)
        dl.strokeRect(button.x, layout.buttonY, button.w, modal.buttonHeight, { ...border, a: border.a * alpha }, 1, modal.buttonRadius)
      }
      dl.fillText(button.label, button.x + button.w / 2, layout.buttonY + modal.buttonHeight / 2, { ...resolveTextColor(textTokens, state), a: alpha }, modal.fontSize, modal.fontFamily, 'center', 'middle')
    }

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

  private _layout(popupContext: PopupContext) {
    const modal = deriveModalStyle(popupContext.theme)
    const input = deriveTextInputStyle(popupContext.theme)
    const viewportX = popupContext.viewport.x ?? 0
    const viewportY = popupContext.viewport.y ?? 0
    const panelX = viewportX + (popupContext.viewport.width - this.modalWidth) / 2
    const panelY = viewportY + (popupContext.viewport.height - this.modalHeight) / 2
    const contentY = panelY + modal.titleHeight + modal.padding
    const inputRect = {
      x: panelX + modal.padding,
      y: contentY + modal.fontSize + modal.padding,
      w: this.modalWidth - modal.padding * 2,
      h: input.height,
    }
    const buttonY = panelY + this.modalHeight - modal.buttonHeight - modal.padding
    const totalButtonWidth = this.buttons.reduce((sum, button) => {
      return sum + Math.max(modal.buttonMinWidth, TextMeasurer.measureWidth(button.label, modal.fontSize, modal.fontFamily) + modal.padding * 2)
    }, 0) + modal.buttonSpacing * (this.buttons.length - 1)
    let buttonX = panelX + (this.modalWidth - totalButtonWidth) / 2
    const buttons = this.buttons.map(button => {
      const w = Math.max(modal.buttonMinWidth, TextMeasurer.measureWidth(button.label, modal.fontSize, modal.fontFamily) + modal.padding * 2)
      const entry = { ...button, x: buttonX, w }
      buttonX += w + modal.buttonSpacing
      return entry
    })
    return {
      panelX,
      panelY,
      panelW: this.modalWidth,
      panelH: this.modalHeight,
      contentY,
      inputRect,
      buttonY,
      buttons,
    }
  }

  private _inputRect(popupContext: PopupContext): { x: number; y: number; w: number; h: number } {
    return this._layout(popupContext).inputRect
  }

  private _buttonAt(point: Offset, popupContext: PopupContext): string {
    const layout = this._layout(popupContext)
    const modal = deriveModalStyle(popupContext.theme)
    for (const button of layout.buttons) {
      if (
        point.x >= button.x &&
        point.x <= button.x + button.w &&
        point.y >= layout.buttonY &&
        point.y <= layout.buttonY + modal.buttonHeight
      ) {
        return button.key
      }
    }
    return ''
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
