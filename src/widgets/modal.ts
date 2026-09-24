import { RenderBox } from '../layout/render_box'
import { RenderObject } from '../core/render_object'
import {
  APP_CONTEXT_PROVIDER,
  AppContextRegistry,
} from '../core/app_context'
import { DrawList } from '../rendering/draw_list'
import { AnimationController } from '../animation/animation_controller'
import { Curves } from '../animation/curves'
import { isPrimaryPointerButton, type PointerEvent, type WheelPointerEvent } from '../gestures/hit_test'
import { PopupManager, type Popup, type PopupContext } from '../core/popup_manager'
import type { PaintContext } from '../rendering/paint_context'
import type { BoxConstraints, Offset } from '../core/render_object'
import { TextMeasurer } from '../core/text_measurer'
import { ellipsizeText } from '../core/text_overflow'
import {
  deriveModalStyle,
  resolveBgColor,
  resolveTextColor,
} from '../theme/component_styles'
import { DefaultThemeMotion, resolveThemeMotion } from '../theme/theme'

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
  content: string
  buttons: ModalButton[]
  onClose?: (buttonKey: string | null) => void

  modalWidth: number
  modalHeight: number

  overlayLayer = 'overlay' as const

  private _fadeAnim: AnimationController
  private _hoveredButton = ''
  private _pressedButton = ''
  private _appContext?: AppContextRegistry
  private _disposeAppContextOnDispose = false

  constructor(opts: {
    title: string
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
    this.content = opts.content
    this.buttons = opts.buttons ?? [
      { label: '取消', key: 'cancel' },
      { label: '确认', key: 'ok', primary: true },
    ]
    this.visible = opts.visible ?? false
    this.modalWidth = opts.modalWidth ?? 360
    this.modalHeight = opts.modalHeight ?? 180
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
    if (!this.visible) return false
    if (event.key === 'Tab') {
      event.preventDefault()
      return true
    }
    if (event.key === 'Enter') {
      const primary = this.buttons.find(b => b.primary)
      if (primary) {
        event.preventDefault()
        this.hide(primary.key)
        return true
      }
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

  // ---- Show / Hide ----

  show(): void {
    if (this.visible) return
    this.visible = true
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
    const btn = this._buttonAt(event.position, popupContext)
    if (btn !== this._pressedButton) {
      this._pressedButton = btn
      PopupManager.instance.requestPaint()
    }
  }

  onPointerMove(event: PointerEvent, popupContext: PopupContext = PopupManager.instance.context): void {
    if (!this.visible) return
    const btn = this._buttonAt(event.position, popupContext)
    if (btn !== this._hoveredButton) {
      this._hoveredButton = btn
      PopupManager.instance.requestPaint()
    }
  }

  onPointerUp(event: PointerEvent, popupContext: PopupContext = PopupManager.instance.context): void {
    if (!isPrimaryPointerButton(event)) return
    if (!this.visible) return
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
    const alpha = this._fadeAnim.value
    const dl = new DrawList(context)
    const { x, y } = offset
    const { width: w, height: h } = this.size
    const s = deriveModalStyle(context.theme)

    // 遮罩层
    dl.fillRect(x, y, w, h, { ...s.overlayBg, a: s.overlayBg.a * alpha }, 0)

    const layout = this._resolveLayout(PopupManager.instance.context, { x, y }, alpha)
    const mw = layout.panelW
    const mh = layout.panelH
    const mx = layout.panelX
    const my = layout.panelY

    // 弹窗阴影
    dl.outerShadow(
      mx,
      my,
      mw,
      mh,
      s.shadowBlur,
      { ...s.shadowColor, a: s.shadowColor.a * alpha },
      s.borderRadius,
      s.shadowOffsetX,
      s.shadowOffsetY,
    )

    // 弹窗背景
    const bgColor = { ...s.panelBg, a: s.panelBg.a * alpha }
    dl.fillRect(mx, my, mw, mh, bgColor, s.borderRadius)
    dl.strokeRect(mx, my, mw, mh, { ...s.panelBorder, a: s.panelBorder.a * alpha }, 1, s.borderRadius)

    // 标题栏
    const titleH = s.titleHeight
    const ctx = context.ctx
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.beginPath()
    ctx.roundRect(mx, my, mw, titleH, [s.borderRadius, s.borderRadius, 0, 0])
    ctx.fillStyle = `rgba(${s.titleBg.r},${s.titleBg.g},${s.titleBg.b},${s.titleBg.a})`
    ctx.fill()
    ctx.restore()

    dl.fillText(this.title, mx + mw / 2, my + titleH / 2,
      { ...s.titleText, a: s.titleText.a * alpha }, s.fontSize, s.fontFamily, 'center', 'middle')
    dl.line(mx, my + titleH, mx + mw, my + titleH, { ...s.separator, a: alpha }, 1)

    // 内容文字
    let lineY = layout.contentY + layout.lineHeight / 2
    for (const line of layout.contentLines) {
      if (line) {
        dl.fillText(line, mx + s.padding, lineY,
          { ...s.text, a: alpha }, s.fontSize, s.fontFamily, 'left', 'middle')
      }
      lineY += layout.lineHeight
    }

    // 按钮行
    const btnH = s.buttonHeight
    const btnY = layout.buttonY
    const btnSpacing = s.buttonSpacing
    const totalBtnW = this.buttons.reduce((sum, btn) => {
      return sum + Math.max(s.buttonMinWidth, TextMeasurer.measureWidth(btn.label, s.fontSize, s.fontFamily) + s.padding * 2)
    }, 0) + btnSpacing * (this.buttons.length - 1)

    let btnX = mx + (mw - totalBtnW) / 2
    for (const btn of this.buttons) {
      const bw = Math.max(s.buttonMinWidth, TextMeasurer.measureWidth(btn.label, s.fontSize, s.fontFamily) + s.padding * 2)
      const isHovered = btn.key === this._hoveredButton
      const isPressed = btn.key === this._pressedButton
      const state = isPressed ? 'pressed' : isHovered ? 'hovered' : 'normal'
      const bgTokens = btn.danger ? s.dangerButtonBg : btn.primary ? s.primaryButtonBg : s.secondaryButtonBg
      const textTokens = btn.danger ? s.dangerButtonText : btn.primary ? s.primaryButtonText : s.secondaryButtonText

      const bg = resolveBgColor(bgTokens, state)
      const bgWithAlpha = { ...bg, a: bg.a * alpha }
      dl.fillRect(btnX, btnY, bw, btnH, bgWithAlpha, s.buttonRadius)
      if (!btn.primary && !btn.danger) {
        const border = resolveBgColor(s.secondaryButtonBorder, state)
        dl.strokeRect(btnX, btnY, bw, btnH, { ...border, a: border.a * alpha }, 1, s.buttonRadius)
      }
      dl.fillText(btn.label, btnX + bw / 2, btnY + btnH / 2,
        { ...resolveTextColor(textTokens, state), a: alpha }, s.fontSize, s.fontFamily, 'center', 'middle')

      btnX += bw + btnSpacing
    }
  }

  private _buttonAt(p: Offset, popupContext: PopupContext): string {
    const s = deriveModalStyle(popupContext.theme)
    const layout = this._resolveLayout(popupContext, { x: popupContext.viewport.x ?? 0, y: popupContext.viewport.y ?? 0 }, 1)
    const btnH = s.buttonHeight
    const btnY = layout.buttonY
    const btnSpacing = s.buttonSpacing
    const totalBtnW = this.buttons.reduce((sum, btn) => {
      return sum + Math.max(s.buttonMinWidth, TextMeasurer.measureWidth(btn.label, s.fontSize, s.fontFamily) + s.padding * 2)
    }, 0) + btnSpacing * (this.buttons.length - 1)

    let btnX = layout.panelX + (layout.panelW - totalBtnW) / 2
    for (const btn of this.buttons) {
      const bw = Math.max(s.buttonMinWidth, TextMeasurer.measureWidth(btn.label, s.fontSize, s.fontFamily) + s.padding * 2)
      if (p.x >= btnX && p.x <= btnX + bw && p.y >= btnY && p.y <= btnY + btnH) return btn.key
      btnX += bw + btnSpacing
    }
    return ''
  }

  private _resolveLayout(popupContext: PopupContext, offset: Offset, alpha: number): {
    panelX: number
    panelY: number
    panelW: number
    panelH: number
    contentY: number
    buttonY: number
    lineHeight: number
    contentLines: string[]
  } {
    const s = deriveModalStyle(popupContext.theme)
    const viewportWidth = this.size.width || popupContext.viewport.width
    const viewportHeight = this.size.height || popupContext.viewport.height
    const minPanelWidth = 240
    const maxPanelWidth = Math.max(minPanelWidth, viewportWidth - s.padding * 2)
    const panelW = Math.min(this.modalWidth, maxPanelWidth)
    const contentWidth = Math.max(0, panelW - s.padding * 2)
    const lineHeight = Math.ceil(TextMeasurer.lineHeight(s.fontSize))
    const wrappedLines = this._wrapContentLines(contentWidth, s.fontSize, s.fontFamily)
    const contentHeight = Math.max(lineHeight, wrappedLines.length * lineHeight)
    const minPanelHeight = s.titleHeight + s.padding + lineHeight + s.padding + s.buttonHeight + s.padding
    const desiredPanelHeight = s.titleHeight + s.padding + contentHeight + s.padding + s.buttonHeight + s.padding
    const maxPanelHeight = Math.max(minPanelHeight, viewportHeight - s.padding * 2)
    const panelH = Math.min(Math.max(this.modalHeight, desiredPanelHeight), maxPanelHeight)
    const panelX = offset.x + (viewportWidth - panelW) / 2
    const panelY = offset.y + (viewportHeight - panelH) / 2 - 20 * (1 - alpha)
    const contentY = panelY + s.titleHeight + s.padding
    const buttonY = panelY + panelH - s.buttonHeight - s.padding
    const availableContentHeight = Math.max(0, buttonY - contentY - s.padding)
    const maxVisibleLines = Math.max(1, Math.floor(availableContentHeight / lineHeight))
    const contentLines = this._fitContentLines(wrappedLines, maxVisibleLines, contentWidth, s.fontSize, s.fontFamily)
    return { panelX, panelY, panelW, panelH, contentY, buttonY, lineHeight, contentLines }
  }

  private _wrapContentLines(maxWidth: number, fontSize: number, fontFamily: string): string[] {
    if (!this.content) return ['']
    const lines: string[] = []
    const paragraphs = this.content.replace(/\r\n?/g, '\n').split('\n')
    for (const paragraph of paragraphs) {
      if (!paragraph) {
        lines.push('')
        continue
      }
      lines.push(...this._wrapParagraph(paragraph, maxWidth, fontSize, fontFamily))
    }
    return lines.length > 0 ? lines : ['']
  }

  private _wrapParagraph(text: string, maxWidth: number, fontSize: number, fontFamily: string): string[] {
    if (maxWidth <= 0) return [text]
    const measure = (value: string) => TextMeasurer.measureWidth(value, fontSize, fontFamily)
    const tokens = text.match(/\s+|[A-Za-z0-9_./:@#%+~-]+|./gu) ?? []
    const lines: string[] = []
    let line = ''
    let pendingSpace = ''

    for (const token of tokens) {
      if (/^\s+$/.test(token)) {
        if (line) pendingSpace = ' '
        continue
      }
      const nextToken = line && pendingSpace ? `${pendingSpace}${token}` : token
      pendingSpace = ''
      if (!line) {
        if (measure(token) <= maxWidth) {
          line = token
        } else {
          const broken = this._breakLongToken(token, maxWidth, fontSize, fontFamily)
          lines.push(...broken.slice(0, -1))
          line = broken[broken.length - 1] ?? ''
        }
        continue
      }
      const candidate = `${line}${nextToken}`
      if (measure(candidate) <= maxWidth) {
        line = candidate
        continue
      }
      lines.push(line.trimEnd())
      line = ''
      if (measure(token) <= maxWidth) {
        line = token
      } else {
        const broken = this._breakLongToken(token, maxWidth, fontSize, fontFamily)
        lines.push(...broken.slice(0, -1))
        line = broken[broken.length - 1] ?? ''
      }
    }

    if (line) lines.push(line.trimEnd())
    return lines.length > 0 ? lines : ['']
  }

  private _breakLongToken(token: string, maxWidth: number, fontSize: number, fontFamily: string): string[] {
    const measure = (value: string) => TextMeasurer.measureWidth(value, fontSize, fontFamily)
    const lines: string[] = []
    let line = ''
    for (const char of Array.from(token)) {
      const candidate = `${line}${char}`
      if (line && measure(candidate) > maxWidth) {
        lines.push(line)
        line = char
      } else {
        line = candidate
      }
    }
    if (line) lines.push(line)
    return lines.length > 0 ? lines : [token]
  }

  private _fitContentLines(lines: string[], maxLines: number, maxWidth: number, fontSize: number, fontFamily: string): string[] {
    if (lines.length <= maxLines) return lines
    const visible = lines.slice(0, maxLines)
    const lastIndex = visible.length - 1
    if (lastIndex >= 0) {
      const measure = (value: string) => TextMeasurer.measureWidth(value, fontSize, fontFamily)
      visible[lastIndex] = ellipsizeText(`${visible[lastIndex]}...`, maxWidth, measure)
    }
    return visible
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
