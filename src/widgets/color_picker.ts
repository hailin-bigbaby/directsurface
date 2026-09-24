// ColorPicker: 颜色选择器
// 架构：触发器（RenderColorPicker）+ 独立弹出层（ColorPickerPopup，interceptor 模式）
// 通过 popup anchor 引用按需解析位置，窗口移动时弹出层跟随
// 拖拽为实时预览，点击"确认"才提交颜色，"取消"恢复原色

import { DrawList } from '../rendering/draw_list'
import { paintSingleLineText } from '../rendering/text_painter'
import type { ResolvedTheme, Color } from '../theme/theme'
import type { PaintContext } from '../rendering/paint_context'
import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import { RenderObject } from '../core/render_object'
import { runCleanupSteps, type DisposeFn } from '../core/disposable'
import type { PointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton, type PointerEvent as PopupPointerEvent, type WheelPointerEvent } from '../gestures/hit_test'
import { PopupManager, clampXToPopupViewport, clampYToPopupViewport, type Popup, type PopupContext } from '../core/popup_manager'
import { PopupRenderNode } from '../core/popup_render_surface'
import { TextMeasurer } from '../core/text_measurer'
import { PopupSurfaceShell } from '../core/popup_shell'
import { FocusManager } from '../core/focus_manager'
import {
  GET_POPUP_ANCHOR_RECT,
  type PopupAnchor,
  type PopupAnchorTarget,
  resolvePopupAnchorTarget,
  resolvePopupAnchorRect,
} from '../core/popup_anchor'
import {
  deriveColorPickerStyle,
  derivePopupStyle,
  deriveTextInputStyle,
  resolveBgColor,
  resolveTextColor,
  type ColorPickerStyleTokens,
  type PopupStyleTokens,
  type TextInputStyleTokens,
} from '../theme/component_styles'
import { drawPopupPanel } from '../rendering/popup_painter'
import { FocusableControl, type ControlInteractionSnapshot } from './focusable_control'
import { measureFormFieldHeight, type FormFieldStatus } from './form_field_shell'
import { paintTriggerFieldShell } from './trigger_field_shell'
import {
  ValueEditorEventEmitter,
  type ValueEditor,
  type ValueEditorValueChangeListener,
} from './value_editor'

// ---- HSV 工具函数 ----

interface HSV { h: number; s: number; v: number; a: number }

function sameColor(left: Color, right: Color): boolean {
  return left.r === right.r &&
    left.g === right.g &&
    left.b === right.b &&
    left.a === right.a
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const i = Math.floor(h / 60) % 6
  const f = h / 60 - Math.floor(h / 60)
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const tt = v * (1 - (1 - f) * s)
  const lut: [number, number, number][] = [
    [v, tt, p], [q, v, p], [p, v, tt],
    [p, q, v], [tt, p, v], [v, p, q],
  ]
  const rgb = lut[i]!
  return { r: Math.round(rgb[0] * 255), g: Math.round(rgb[1] * 255), b: Math.round(rgb[2] * 255) }
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + 6) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

function colorToHex(c: Color, includeAlpha = c.a < 1): string {
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0')
  return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}${includeAlpha ? toHex(c.a * 255) : ''}`
}

function parseHexColor(value: string): Color | null {
  const hex = value.trim()
  if (!/^#[0-9a-fA-F]{8}$/.test(hex) && !/^#[0-9a-fA-F]{6}$/.test(hex)) return null
  const digits = hex.slice(1)
  const withAlpha = digits.length === 8
  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16),
    a: withAlpha ? parseInt(digits.slice(6, 8), 16) / 255 : 1,
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function clampHue(value: number): number {
  const normalized = value % 360
  return normalized < 0 ? normalized + 360 : normalized
}

// ---- ColorPickerPopup ----

type DragTarget = 'sv' | 'hue' | 'alpha' | null
type FocusZone = 'sv' | 'hue' | 'alpha' | 'hex'

export class ColorPickerPopup extends PopupSurfaceShell implements Popup {
  private _hsv: HSV = { h: 0, s: 1, v: 1, a: 1 }
  private _originalHsv: HSV = { h: 0, s: 1, v: 1, a: 1 }  // 取消时恢复
  private _anchor?: PopupAnchor
  private _dragging: DragTarget = null
  private _hoveredBtn: 'ok' | 'cancel' | 'clear' | null = null
  private _focusZone: FocusZone = 'sv'
  private _hexValue = '#FFFFFFFF'
  private _hexCursor = 1

  private _onConfirm?: (color: Color) => boolean | void
  private _onCancel?: () => void
  private _onClear?: () => boolean | void
  private _onTab?: (direction: 1 | -1) => void
  private _onClose?: () => void
  private _clearable = false
  constructor() {
    super()
    this.setPopupSurfaceRoot(new PopupRenderNode({
      paint: (_node, context, offset) => this._paintSurface(context, offset),
      onPointerDown: (_node, event) => this._handleSurfacePointerDown(event),
      onPointerMove: (_node, event) => this._handleSurfacePointerMove(event),
      onPointerLeave: (_node, event) => this._handleSurfaceHoverExit(event),
      onPointerUp: (_node, event) => this._handleSurfacePointerUp(event),
      onPointerCancel: (_node, event) => this._handleSurfaceSequenceCancel(event),
    }))
    this.setPopupSurfaceSync((root, popupContext) => {
      const rect = this._popupRect(popupContext)
      root.offset = { x: rect.x, y: rect.y }
      root.layout({
        minWidth: rect.w,
        maxWidth: rect.w,
        minHeight: rect.h,
        maxHeight: rect.h,
      }, false, { theme: popupContext.theme })
    })
  }

  debugState(): {
    focusZone: FocusZone
    hexValue: string
    hexCursor: number
    color: Color
  } {
    return {
      focusZone: this._focusZone,
      hexValue: this._hexValue,
      hexCursor: this._hexCursor,
      color: this._currentColor(),
    }
  }

  open(opts: {
    color: Color
    anchor: PopupAnchor
    onConfirm: (color: Color) => boolean | void
    onCancel: () => void
    clearable?: boolean
    onClear?: () => boolean | void
    onTab?: (direction: 1 | -1) => void
    onClose: () => void
  }): void {
    if (this.popupOpen) this.close()
    const previousFocus = FocusManager.instance.current
    const { r, g, b } = opts.color
    const hsv = rgbToHsv(r, g, b)
    this._hsv = { ...hsv, a: opts.color.a }
    this._originalHsv = { ...this._hsv }
    this._anchor = opts.anchor
    this._onConfirm = opts.onConfirm
    this._onCancel = opts.onCancel
    this._clearable = opts.clearable ?? false
    this._onClear = opts.onClear
    this._onTab = opts.onTab
    this._onClose = opts.onClose
    this._dragging = null
    this._hoveredBtn = null
    this._focusZone = 'sv'
    this._hexCursor = 1
    this._syncHexInput()
    this.resetPopupSurface()
    this.openPopup({ owner: resolvePopupAnchorTarget(opts.anchor) })
    if (previousFocus) FocusManager.instance.setFocus(previousFocus)
  }

  private _confirm(tabDirection?: 1 | -1): boolean {
    if (this._onConfirm?.(this._currentColor()) === false) {
      this.requestPopupPaint()
      return false
    }
    const onTab = this._onTab
    this.close()
    if (tabDirection && onTab) onTab(tabDirection)
    return true
  }

  private _cancel(): void {
    this._onCancel?.()
    this.close()
  }

  private _clear(): boolean {
    if (!this._clearable || this._onClear?.() === false) {
      this.requestPopupPaint()
      return false
    }
    this.close()
    return true
  }

  onEscape(e: KeyboardEvent): boolean {
    if (!this.visible) return false
    e.preventDefault()
    this._cancel()
    return true
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (!this.visible) return false
    if (e.key === 'Tab') {
      if (this._onTab) {
        e.preventDefault()
        e.stopPropagation()
        this._confirm(e.shiftKey ? -1 : 1)
        return true
      }
      e.preventDefault()
      this._stepFocus(e.shiftKey ? -1 : 1)
      return true
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      this._confirm()
      return true
    }
    if (this._focusZone === 'hex') {
      const handled = this._handleHexKey(e)
      if (handled) return true
    }
    if (e.key.startsWith('Arrow')) {
      e.preventDefault()
      this._adjustFocusedControl(e.key)
      return true
    }
    return false
  }

  private _currentColor(): Color {
    const { r, g, b } = hsvToRgb(this._hsv.h, this._hsv.s, this._hsv.v)
    return { r, g, b, a: this._hsv.a }
  }

  private _syncHexInput(): void {
    this._hexValue = colorToHex(this._currentColor(), true).toUpperCase()
    this._hexCursor = Math.max(1, Math.min(this._hexCursor, this._hexValue.length - 1))
  }

  private _applyColor(color: Color): void {
    const hsv = rgbToHsv(color.r, color.g, color.b)
    this._hsv = { ...hsv, a: clamp01(color.a) }
    this._syncHexInput()
  }

  private _setFocusZone(zone: FocusZone): void {
    if (this._focusZone === zone) return
    this._focusZone = zone
    PopupManager.instance.requestPaint()
  }

  private _stepFocus(delta: 1 | -1): void {
    const zones: FocusZone[] = ['sv', 'hue', 'alpha', 'hex']
    const currentIndex = zones.indexOf(this._focusZone)
    const nextIndex = (currentIndex + delta + zones.length) % zones.length
    this._focusZone = zones[nextIndex]!
    PopupManager.instance.requestPaint()
  }

  private _adjustFocusedControl(key: string): void {
    if (this._focusZone === 'sv') {
      const nextS = this._hsv.s + (key === 'ArrowLeft' ? -0.02 : key === 'ArrowRight' ? 0.02 : 0)
      const nextV = this._hsv.v + (key === 'ArrowUp' ? 0.02 : key === 'ArrowDown' ? -0.02 : 0)
      this._hsv = {
        ...this._hsv,
        s: clamp01(nextS),
        v: clamp01(nextV),
      }
    } else if (this._focusZone === 'hue') {
      const delta = key === 'ArrowLeft' || key === 'ArrowDown' ? -2 : 2
      this._hsv = { ...this._hsv, h: clampHue(this._hsv.h + delta) }
    } else if (this._focusZone === 'alpha') {
      const delta = key === 'ArrowLeft' || key === 'ArrowDown' ? -0.02 : 0.02
      this._hsv = { ...this._hsv, a: clamp01(this._hsv.a + delta) }
    }
    this._syncHexInput()
    PopupManager.instance.requestPaint()
  }

  private _handleHexKey(e: KeyboardEvent): boolean {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      this._hexCursor = Math.max(1, this._hexCursor - 1)
      PopupManager.instance.requestPaint()
      return true
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      this._hexCursor = Math.min(8, this._hexCursor + 1)
      PopupManager.instance.requestPaint()
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      this._stepHexDigit(1)
      return true
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      this._stepHexDigit(-1)
      return true
    }
    if (e.key === 'Home') {
      e.preventDefault()
      this._hexCursor = 1
      PopupManager.instance.requestPaint()
      return true
    }
    if (e.key === 'End') {
      e.preventDefault()
      this._hexCursor = 8
      PopupManager.instance.requestPaint()
      return true
    }
    if (e.key === 'Backspace') {
      e.preventDefault()
      this._hexCursor = Math.max(1, this._hexCursor - 1)
      this._replaceHexDigit('0')
      return true
    }
    if (e.key === 'Delete') {
      e.preventDefault()
      this._replaceHexDigit('0')
      return true
    }
    if (/^[0-9a-fA-F]$/.test(e.key)) {
      e.preventDefault()
      this._replaceHexDigit(e.key.toUpperCase(), true)
      return true
    }
    return false
  }

  private _stepHexDigit(delta: 1 | -1): void {
    const digits = '0123456789ABCDEF'
    const current = this._hexValue[this._hexCursor] ?? '0'
    const currentIndex = Math.max(0, digits.indexOf(current))
    const nextIndex = (currentIndex + delta + digits.length) % digits.length
    this._replaceHexDigit(digits[nextIndex]!)
  }

  private _replaceHexDigit(digit: string, advance = false): void {
    const index = Math.max(1, Math.min(8, this._hexCursor))
    const nextChars = this._hexValue.split('')
    nextChars[index] = digit
    const parsed = parseHexColor(nextChars.join(''))
    if (!parsed) return
    this._applyColor(parsed)
    if (advance) this._hexCursor = Math.min(8, index + 1)
    else this._hexCursor = index
    PopupManager.instance.requestPaint()
  }

  // 计算各区域 Y 坐标（单一来源，避免高度/位置不一致）
  private _layout(popupContext: PopupContext = PopupManager.instance.context): {
    style: ColorPickerStyleTokens
    popupStyle: PopupStyleTokens
    inputStyle: TextInputStyleTokens
    svX: number; svY: number
    hueY: number; alphaY: number; previewY: number; hexY: number; btnY: number
    popH: number; popX: number; popY: number
  } {
    const style = deriveColorPickerStyle(popupContext.theme)
    const popupStyle = derivePopupStyle(popupContext.theme)
    const inputStyle = deriveTextInputStyle(popupContext.theme)
    const pad = style.padding
    const svSize = style.svSize
    const barH = style.barHeight
    const previewH = style.previewHeight
    const inputH = inputStyle.height
    const btnH = style.buttonHeight
    const anchor = resolvePopupAnchorRect(this._anchor)
    const w = style.popupWidth

    // 高度先算出来，再决定弹出方向
    const innerH = pad + svSize
      + style.itemSpacing + barH
      + style.itemSpacing + barH
      + style.itemSpacing + previewH
      + style.itemSpacing + inputH
      + style.itemSpacing + btnH
      + pad
    const popH = innerH

    // 水平
    const popX = clampXToPopupViewport(anchor.x, w, popupContext, 4)

    // 垂直
    const yDown = anchor.y + anchor.h + 2
    const yUp = anchor.y - popH - 2
    const viewportY = popupContext.viewport.y ?? 0
    const rawPopY = yDown + popH > viewportY + popupContext.viewport.height - 4 && yUp >= viewportY + 4 ? yUp : yDown
    const popY = clampYToPopupViewport(rawPopY, popH, popupContext, 4)

    const svX = popX + pad
    const svY = popY + pad
    const hueY = svY + svSize + style.itemSpacing
    const alphaY = hueY + barH + style.itemSpacing
    const previewY = alphaY + barH + style.itemSpacing
    const hexY = previewY + previewH + style.itemSpacing
    const btnY = hexY + inputH + style.itemSpacing
    return { style, popupStyle, inputStyle, svX, svY, hueY, alphaY, previewY, hexY, btnY, popH, popX, popY }
  }

  private _popupRect(popupContext: PopupContext = PopupManager.instance.context): { x: number; y: number; w: number; h: number } {
    const { popX, popY, popH, style } = this._layout(popupContext)
    return { x: popX, y: popY, w: style.popupWidth, h: popH }
  }

  // 按钮区域
  private _btnRects(popupContext: PopupContext = PopupManager.instance.context): {
    ok: { x: number; y: number; w: number; h: number }
    cancel: { x: number; y: number; w: number; h: number }
    clear?: { x: number; y: number; w: number; h: number }
  } {
    const { style, svX, btnY } = this._layout(popupContext)
    const btnH = style.buttonHeight
    const count = this._clearable ? 3 : 2
    const btnW = (style.svSize - style.itemSpacing * (count - 1)) / count
    return {
      clear: this._clearable ? { x: svX, y: btnY, w: btnW, h: btnH } : undefined,
      cancel: { x: svX + (this._clearable ? btnW + style.itemSpacing : 0), y: btnY, w: btnW, h: btnH },
      ok: { x: svX + (count - 1) * (btnW + style.itemSpacing), y: btnY, w: btnW, h: btnH },
    }
  }

  private _hexRect(popupContext: PopupContext = PopupManager.instance.context): { x: number; y: number; w: number; h: number } {
    const { style, inputStyle, svX, hexY } = this._layout(popupContext)
    return { x: svX, y: hexY, w: style.svSize, h: inputStyle.height }
  }

  // ---- Interceptor 接口 ----

  private _handleSurfacePointerDown(event: PopupPointerEvent, popupContext: PopupContext = PopupManager.instance.context): void {
    const point = event.position
    // 检查按钮
    const btns = this._btnRects(popupContext)
    if (this._inRect(point, btns.ok)) { this._confirm(); return }
    if (this._inRect(point, btns.cancel)) { this._cancel(); return }
    if (btns.clear && this._inRect(point, btns.clear)) { this._clear(); return }

    if (this._inRect(point, this._hexRect(popupContext))) {
      this._setFocusZone('hex')
      this._hexCursor = this._hexCursorAt(point, popupContext)
      PopupManager.instance.requestPaint()
      return
    }

    // 拖拽色板/条
    this._dragging = this._targetAt(point, popupContext)
    if (this._dragging) {
      this._setFocusZone(this._dragging)
      this._applyDrag(point, popupContext)
    }
  }

  private _handleSurfacePointerMove(event: PopupPointerEvent, popupContext: PopupContext = PopupManager.instance.context): void {
    const point = event.position
    if (this._dragging) {
      this._applyDrag(point, popupContext)
      return
    }
    // hover 按钮
    const btns = this._btnRects(popupContext)
    const prev = this._hoveredBtn
    if (this._inRect(point, btns.ok)) this._hoveredBtn = 'ok'
    else if (this._inRect(point, btns.cancel)) this._hoveredBtn = 'cancel'
    else if (btns.clear && this._inRect(point, btns.clear)) this._hoveredBtn = 'clear'
    else this._hoveredBtn = null
    if (this._hoveredBtn !== prev) PopupManager.instance.requestPaint()
  }

  private _handleSurfacePointerUp(_event: PopupPointerEvent): void {
    this._dragging = null
  }

  private _handleSurfaceHoverExit(_event: PopupPointerEvent): void {
    if (this._hoveredBtn === null) return
    this._hoveredBtn = null
    PopupManager.instance.requestPaint()
  }

  private _handleSurfaceSequenceCancel(_event: PopupPointerEvent): void {
    const hadDragging = this._dragging !== null
    const hadHover = this._hoveredBtn !== null
    this._dragging = null
    this._hoveredBtn = null
    if (hadDragging || hadHover) PopupManager.instance.requestPaint()
  }

  onOutsidePointerDown(_event: PopupPointerEvent): boolean {
    if (!this.visible) return false
    if (this._hitAnchor(_event.position)) {
      this._cancel()
      return true
    }
    this._cancel()
    return false
  }

  onWheel(_event: WheelPointerEvent): boolean {
    return true
  }

  private _inRect(p: Offset, rect: { x: number; y: number; w: number; h: number }): boolean {
    return p.x >= rect.x && p.x <= rect.x + rect.w &&
           p.y >= rect.y && p.y <= rect.y + rect.h
  }

  private _anchorRect(): { x: number; y: number; w: number; h: number } {
    const anchorRect = resolvePopupAnchorRect(this._anchor)
    return { x: anchorRect.x, y: anchorRect.y, w: anchorRect.w, h: anchorRect.h }
  }

  private _hitAnchor(point: Offset): boolean {
    const rect = this._anchorRect()
    return point.x >= rect.x && point.x <= rect.x + rect.w &&
      point.y >= rect.y && point.y <= rect.y + rect.h
  }

  private _targetAt(point: Offset, popupContext: PopupContext = PopupManager.instance.context): DragTarget {
    const { style, svX, svY, hueY, alphaY } = this._layout(popupContext)
    const svSize = style.svSize
    const barH = style.barHeight

    if (point.x >= svX && point.x <= svX + svSize &&
        point.y >= svY && point.y <= svY + svSize) return 'sv'

    if (point.y >= hueY && point.y <= hueY + barH &&
        point.x >= svX && point.x <= svX + svSize) return 'hue'

    if (point.y >= alphaY && point.y <= alphaY + barH &&
        point.x >= svX && point.x <= svX + svSize) return 'alpha'

    return null
  }

  private _hexCursorAt(point: Offset, popupContext: PopupContext = PopupManager.instance.context): number {
    const rect = this._hexRect(popupContext)
    const input = this._layout(popupContext).inputStyle
    const charWidth = input.fontSize * 0.62
    const localX = Math.max(0, point.x - rect.x - input.padding)
    const index = Math.floor(localX / charWidth)
    return Math.max(1, Math.min(8, index))
  }

  private _applyDrag(point: Offset, popupContext: PopupContext = PopupManager.instance.context): void {
    const { style, svX, svY } = this._layout(popupContext)
    const svSize = style.svSize

    if (this._dragging === 'sv') {
      const s = clamp01((point.x - svX) / svSize)
      const v = clamp01(1 - (point.y - svY) / svSize)
      this._hsv = { ...this._hsv, s, v }
    } else if (this._dragging === 'hue') {
      const h = clamp01((point.x - svX) / svSize) * 360
      this._hsv = { ...this._hsv, h }
    } else if (this._dragging === 'alpha') {
      const a = clamp01((point.x - svX) / svSize)
      this._hsv = { ...this._hsv, a }
    }
    this._syncHexInput()
    PopupManager.instance.requestPaint()
  }

  // ---- 绘制 ----

  protected override onPopupClose(): void {
    super.onPopupClose()
    this._dragging = null
    this._hoveredBtn = null
    this._onClose?.()
  }

  private _paintSurface(context: PaintContext, offset: Offset): void {
    const popupContext = PopupManager.instance.context
    const { style: s, popupStyle, inputStyle, svX, svY, hueY, alphaY, previewY, hexY } = this._layout(popupContext)
    const r = { x: offset.x, y: offset.y, w: this._popupRect(popupContext).w, h: this._popupRect(popupContext).h }
    const svSize = s.svSize
    const barH = s.barHeight
    const ctx = context.ctx
    const dl = new DrawList(context)
    const focusBorder = resolveBgColor(inputStyle.inputBorder, 'focused')

    drawPopupPanel(dl, r.x, r.y, r.w, r.h, popupStyle)

    // ---- SV 方块 ----
    const { r: hr, g: hg, b: hb } = hsvToRgb(this._hsv.h, 1, 1)
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(svX, svY, svSize, svSize, s.borderRadius)
    ctx.clip()
    ctx.fillStyle = `rgb(${hr},${hg},${hb})`
    ctx.fillRect(svX, svY, svSize, svSize)
    const gradW = ctx.createLinearGradient(svX, svY, svX + svSize, svY)
    gradW.addColorStop(0, 'rgba(255,255,255,1)')
    gradW.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradW
    ctx.fillRect(svX, svY, svSize, svSize)
    const gradB = ctx.createLinearGradient(svX, svY, svX, svY + svSize)
    gradB.addColorStop(0, 'rgba(0,0,0,0)')
    gradB.addColorStop(1, 'rgba(0,0,0,1)')
    ctx.fillStyle = gradB
    ctx.fillRect(svX, svY, svSize, svSize)
    ctx.restore()

    // SV 光标
    const cursorX = svX + this._hsv.s * svSize
    const cursorY = svY + (1 - this._hsv.v) * svSize
    ctx.save()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.shadowColor = 'rgba(0,0,0,0.5)'
    ctx.shadowBlur = 3
    ctx.beginPath()
    ctx.arc(cursorX, cursorY, s.fontSize * 0.4, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
    if (this._focusZone === 'sv') {
      dl.strokeRect(svX - 1, svY - 1, svSize + 2, svSize + 2, focusBorder, 1.5, s.borderRadius)
    }

    // ---- 色相条 ----
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(svX, hueY, svSize, barH, barH / 2)
    ctx.clip()
    const hueGrad = ctx.createLinearGradient(svX, hueY, svX + svSize, hueY)
    for (let i = 0; i <= 6; i++) {
      const { r: rr, g: gg, b: bb } = hsvToRgb(i * 60, 1, 1)
      hueGrad.addColorStop(i / 6, `rgb(${rr},${gg},${bb})`)
    }
    ctx.fillStyle = hueGrad
    ctx.fillRect(svX, hueY, svSize, barH)
    ctx.restore()
    this._paintBarThumb(ctx, s, svX + (this._hsv.h / 360) * svSize, hueY + barH / 2, barH)
    if (this._focusZone === 'hue') {
      dl.strokeRect(svX - 1, hueY - 1, svSize + 2, barH + 2, focusBorder, 1.5, barH / 2)
    }

    // ---- 透明度条 ----
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(svX, alphaY, svSize, barH, barH / 2)
    ctx.clip()
    const cellSize = barH * 0.6
    for (let ix = 0; ix < Math.ceil(svSize / cellSize); ix++) {
      for (let iy = 0; iy < 2; iy++) {
        ctx.fillStyle = (ix + iy) % 2 === 0 ? '#aaa' : '#fff'
        ctx.fillRect(svX + ix * cellSize, alphaY + iy * cellSize, cellSize, cellSize)
      }
    }
    const { r: cr, g: cg, b: cb } = hsvToRgb(this._hsv.h, this._hsv.s, this._hsv.v)
    const alphaGrad = ctx.createLinearGradient(svX, alphaY, svX + svSize, alphaY)
    alphaGrad.addColorStop(0, `rgba(${cr},${cg},${cb},0)`)
    alphaGrad.addColorStop(1, `rgba(${cr},${cg},${cb},1)`)
    ctx.fillStyle = alphaGrad
    ctx.fillRect(svX, alphaY, svSize, barH)
    ctx.restore()
    this._paintBarThumb(ctx, s, svX + this._hsv.a * svSize, alphaY + barH / 2, barH)
    if (this._focusZone === 'alpha') {
      dl.strokeRect(svX - 1, alphaY - 1, svSize + 2, barH + 2, focusBorder, 1.5, barH / 2)
    }

    // ---- 预览行：原色 + 新色 ----
    const previewH = s.previewHeight
    const previewW = s.previewWidth
    const color = this._currentColor()
    const origColor = (() => {
      const { r, g, b } = hsvToRgb(this._originalHsv.h, this._originalHsv.s, this._originalHsv.v)
      return { r, g, b, a: this._originalHsv.a }
    })()
    this._paintSwatch(ctx, dl, svX, previewY, previewW, previewH, origColor, s)
    this._paintSwatch(ctx, dl, svX + previewW + s.itemSpacing, previewY, previewW, previewH, color, s)
    dl.fillText('原色', svX + previewW / 2, previewY + previewH / 2,
      s.textDisabled, s.previewLabelFontSize, s.fontFamily, 'center', 'middle')
    dl.fillText('当前', svX + previewW + s.itemSpacing + previewW / 2, previewY + previewH / 2,
      s.textDisabled, s.previewLabelFontSize, s.fontFamily, 'center', 'middle')

    // ---- Hex 输入框 ----
    const hexRect = this._hexRect(popupContext)
    const hexState = this._focusZone === 'hex' ? 'focused' : 'normal'
    dl.fillRect(hexRect.x, hexRect.y, hexRect.w, hexRect.h, resolveBgColor(inputStyle.inputBg, hexState), inputStyle.borderRadius)
    dl.strokeRect(
      hexRect.x,
      hexRect.y,
      hexRect.w,
      hexRect.h,
      resolveBgColor(inputStyle.inputBorder, hexState),
      this._focusZone === 'hex' ? 1.5 : Math.max(1, inputStyle.borderWidth),
      inputStyle.borderRadius,
    )
    dl.fillText(
      this._hexValue,
      hexRect.x + inputStyle.padding,
      hexRect.y + hexRect.h / 2,
      this._focusZone === 'hex' ? inputStyle.text : s.textDisabled,
      inputStyle.fontSize,
      inputStyle.fontFamily,
      'left',
      'middle',
    )
    if (this._focusZone === 'hex') {
      const charWidth = inputStyle.fontSize * 0.62
      const cursorX = hexRect.x + inputStyle.padding + charWidth * this._hexCursor
      dl.line(cursorX, hexRect.y + 4, cursorX, hexRect.y + hexRect.h - 4, focusBorder, 1.5)
    }

    // ---- 确认/取消按钮 ----
    const btns = this._btnRects(popupContext)
    if (btns.clear) this._paintBtn(dl, s, btns.clear, '清空', false, this._hoveredBtn === 'clear')
    this._paintBtn(dl, s, btns.cancel, '取消', false, this._hoveredBtn === 'cancel')
    this._paintBtn(dl, s, btns.ok, '确认', true, this._hoveredBtn === 'ok')
  }

  private _paintSwatch(
    ctx: CanvasRenderingContext2D, dl: DrawList,
    x: number, y: number, w: number, h: number,
    color: Color,
    style: ColorPickerStyleTokens,
  ): void {
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, style.borderRadius)
    ctx.clip()
    const cs = h / 2
    ctx.fillStyle = '#aaa'; ctx.fillRect(x, y, cs, cs)
    ctx.fillStyle = '#fff'; ctx.fillRect(x + cs, y, w - cs, cs)
    ctx.fillStyle = '#fff'; ctx.fillRect(x, y + cs, cs, h - cs)
    ctx.fillStyle = '#aaa'; ctx.fillRect(x + cs, y + cs, w - cs, h - cs)
    ctx.restore()
    dl.fillRect(x, y, w, h, color, style.borderRadius)
    dl.strokeRect(x, y, w, h, style.borderColor, 1, style.borderRadius)
  }

  private _paintBtn(
    dl: DrawList,
    style: ColorPickerStyleTokens,
    rect: { x: number; y: number; w: number; h: number },
    label: string, primary: boolean, hovered: boolean
  ): void {
    const state = hovered ? 'hovered' : 'normal'
    const bg = resolveBgColor(primary ? style.confirmButtonBg : style.cancelButtonBg, state)
    const text = resolveTextColor(primary ? style.confirmButtonText : style.cancelButtonText, state)
    dl.fillRect(rect.x, rect.y, rect.w, rect.h, bg, style.borderRadius)
    dl.strokeRect(rect.x, rect.y, rect.w, rect.h, style.borderColor, 1, style.borderRadius)
    dl.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2,
      text, style.fontSize, style.fontFamily, 'center', 'middle')
  }

  private _paintBarThumb(ctx: CanvasRenderingContext2D, style: ColorPickerStyleTokens, x: number, y: number, _barH: number): void {
    const rr = style.barThumbRadius
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.4)'
    ctx.shadowBlur = 3
    ctx.beginPath()
    ctx.arc(x, y, rr, 0, Math.PI * 2)
    ctx.fillStyle = '#fff'
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
  }

  dispose(): void {
    this.close()
    this.disposePopupSurface()
  }
}

// ---- RenderColorPicker: 触发器 ----

export type ColorPickerValueChangeReason = 'confirm'

export class RenderColorPicker extends FocusableControl implements
  InteractiveRenderObject,
  ValueEditor<Color, ColorPickerValueChangeReason, undefined> {
  static override debugTypeName = 'RenderColorPicker'
  color: Color
  label: string
  onChange?: (color: Color) => void

  private _disabled = false
  private _readonly = false
  private _status: FormFieldStatus = 'default'
  private _helperText = ''
  private _prefixText = ''
  private _suffixText = ''
  private _popup: ColorPickerPopup
  private readonly _valueEditorEvents = new ValueEditorEventEmitter<
    Color,
    ColorPickerValueChangeReason,
    undefined
  >()

  constructor(opts: {
    color?: Color
    label?: string
    disabled?: boolean
    readonly?: boolean
    status?: FormFieldStatus
    helperText?: string
    prefixText?: string
    suffixText?: string
    onChange?: (color: Color) => void
  }) {
    super({ disabled: opts.disabled ?? false })
    this.color = opts.color ?? { r: 100, g: 149, b: 237, a: 1 }
    this.label = opts.label ?? ''
    this._disabled = opts.disabled ?? false
    this._readonly = opts.readonly ?? false
    this._status = opts.status ?? 'default'
    this._helperText = opts.helperText ?? ''
    this._prefixText = opts.prefixText ?? ''
    this._suffixText = opts.suffixText ?? ''
    this.onChange = opts.onChange
    this._popup = new ColorPickerPopup()
    if (this._readonly) this._syncReadonlyFocusRegistration()
  }

  get disabled(): boolean { return this._disabled }
  set disabled(value: boolean) {
    if (this._disabled === value) return
    if (value && this.isFocused) this.blur()
    this._disabled = value
    this.setDisabledState(value)
    this._syncReadonlyFocusRegistration()
  }

  get readonly(): boolean { return this._readonly }
  set readonly(value: boolean) {
    if (this._readonly === value) return
    if (value && this.isFocused) this.blur()
    this._readonly = value
    if (value) {
      this._interaction.leaveHover()
    }
    this._syncReadonlyFocusRegistration()
    this.markNeedsPaint()
  }

  getValue(): Color {
    return { ...this.color }
  }

  setValue(value: Color): void {
    if (sameColor(this.color, value)) return
    this._popup.close()
    this.color = { ...value }
    this.markNeedsPaint()
  }

  subscribeValueChange(
    listener: ValueEditorValueChangeListener<Color, ColorPickerValueChangeReason, undefined>,
  ): DisposeFn {
    return this._valueEditorEvents.subscribeValueChange(listener)
  }

  subscribeBlur(listener: () => void): DisposeFn {
    return this._valueEditorEvents.subscribeBlur(listener)
  }

  override get isFocused(): boolean {
    return super.isFocused || this._popup.visible
  }

  override blur(): void {
    this._popup.close()
    super.blur()
  }

  get status(): FormFieldStatus { return this._status }
  set status(status: FormFieldStatus) {
    if (this._status === status) return
    this._status = status
    this.markNeedsPaint()
  }

  get helperText(): string { return this._helperText }
  set helperText(helperText: string) {
    if (this._helperText === helperText) return
    this._helperText = helperText
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  get prefixText(): string { return this._prefixText }
  set prefixText(prefixText: string) {
    if (this._prefixText === prefixText) return
    this._prefixText = prefixText
    this.markNeedsPaint()
  }

  get suffixText(): string { return this._suffixText }
  set suffixText(suffixText: string) {
    if (this._suffixText === suffixText) return
    this._suffixText = suffixText
    this.markNeedsPaint()
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  override focusIn(): void {
    if (this.readonly) return
    super.focusIn()
  }

  [GET_POPUP_ANCHOR_RECT](): { x: number; y: number; width: number; height: number } {
    const g = this.globalOffset
    return {
      x: g.x,
      y: g.y,
      width: this.size.width,
      height: this._inputTokens(this.currentTheme).height,
    }
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const input = this._inputTokens(context.theme)
    const s = this._styleTokens(context.theme)
    const swatchW = this._triggerSwatchWidth(input, s)
    const valueText = colorToHex(this.color, true).toUpperCase()
    const labelW = this.label
      ? TextMeasurer.measureWidth(this.label, input.fontSize, input.fontFamily)
      : 0
    const valueW = TextMeasurer.measureWidth(valueText, input.fontSize, input.fontFamily)
    const prefixW = this.prefixText ? TextMeasurer.measureWidth(this.prefixText, input.fontSize, input.fontFamily) : 0
    const suffixW = this.suffixText ? TextMeasurer.measureWidth(this.suffixText, input.fontSize, input.fontFamily) : 0
    const gap = Math.max(4, Math.round(input.itemSpacing * 0.75))
    const gapCount = [this.label, this.prefixText, this.suffixText].filter(Boolean).length + 1
    const naturalWidth = input.padding * 2 + labelW + prefixW + valueW + suffixW + swatchW + gapCount * gap
    const width = constraints.maxWidth === Infinity
      ? naturalWidth
      : constraints.maxWidth
    const naturalHeight = measureFormFieldHeight(input, input.height, this.helperText)
    this.size = {
      width: Math.max(constraints.minWidth, width),
      height: Math.max(constraints.minHeight, naturalHeight),
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const { y } = offset
    const input = this._inputTokens(context.theme)
    const s = this._styleTokens(context.theme)
    const readonlyVisual = this.readonly && !this.disabled
    const shell = paintTriggerFieldShell(context, offset, this.size.width, {
      focused: readonlyVisual ? false : this._popup.visible || this.isFocused,
      hovered: readonlyVisual ? false : this._interaction.isHovered,
      disabled: this.disabled,
      status: this.status,
      helperText: this.helperText,
      leadingText: this.label,
      prefixText: this.prefixText,
      suffixText: this.suffixText,
      reserveTrailingWidth: this._triggerSwatchWidth(input, s),
    })

    const valueText = colorToHex(this.color, true).toUpperCase()
    const textColor = this.disabled
      ? input.textDisabled
      : input.text
    dl.pushClip(shell.valueRect.x, y, shell.valueRect.w, shell.fieldHeight)
    paintSingleLineText(dl, {
      text: valueText,
      x: shell.valueRect.x,
      y: y + shell.fieldHeight / 2,
      maxWidth: shell.valueRect.w,
      color: textColor,
      fontSize: input.fontSize,
      fontFamily: input.fontFamily,
    })
    dl.popClip()

    // 右侧色块：棋盘格 + 当前颜色填充
    const swatchRect = shell.trailingRect
    if (!swatchRect) return
    const ctx = context.ctx
    const pad = s.triggerInset
    const innerX = swatchRect.x + pad
    const innerY = swatchRect.y + pad
    const innerW = Math.max(0, swatchRect.w - pad * 2)
    const innerH = Math.max(0, swatchRect.h - pad * 2)
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(innerX, innerY, innerW, innerH, s.innerBorderRadius)
    ctx.clip()
    const cs = innerH / 2
    ctx.fillStyle = '#aaa'; ctx.fillRect(innerX, innerY, cs, cs)
    ctx.fillStyle = '#fff'; ctx.fillRect(innerX + cs, innerY, innerW - cs, cs)
    ctx.fillStyle = '#fff'; ctx.fillRect(innerX, innerY + cs, cs, innerH - cs)
    ctx.fillStyle = '#aaa'; ctx.fillRect(innerX + cs, innerY + cs, innerW - cs, innerH - cs)
    ctx.restore()
    const color = this.disabled || readonlyVisual ? { ...this.color, a: Math.max(0.34, this.color.a * 0.58) } : this.color
    dl.fillRect(innerX, innerY, innerW, innerH, color, s.innerBorderRadius)
    dl.strokeRect(innerX, innerY, innerW, innerH, s.borderColor, 1, s.innerBorderRadius)
  }

  private _openPopup(): void {
    if (this.isDisabled || this.readonly || this._popup.visible) return
    this._popup.open({
      color: this.color,
      anchor: this as PopupAnchorTarget,
      onConfirm: (color) => {
        const previousValue = { ...this.color }
        const nextValue = { ...color }
        const valueChanged = !sameColor(previousValue, nextValue)
        this.color = nextValue
        runCleanupSteps([
          () => this.onChange?.({ ...nextValue }),
          () => {
            if (!valueChanged) return
            this._valueEditorEvents.emitValueChange({
              value: { ...nextValue },
              previousValue,
              reason: 'confirm',
            })
          },
          () => this.markNeedsPaint(),
        ])
      },
      onCancel: () => {
        // 不更新 color，保持原值
        this.markNeedsPaint()
      },
      onClose: () => { this.markNeedsPaint() },
    })
    this.markNeedsPaint()
  }

  onPointerDown(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    if (this.isDisabled || this.readonly || !this.hitTest(e.position)) return
    this.requestFocus()
    if (this._popup.visible) this._popup.close()
    else this._openPopup()
  }

  onPointerMove(e: PointerEvent): void {
    if (this.isDisabled) return
    const isHovered = !this.readonly && this.hitTest(e.position)
    const hoverChanged = isHovered
      ? this._interaction.enterHover()
      : this._interaction.leaveHover()
    if (hoverChanged) this.markNeedsPaint()
  }

  onPointerUp(_e: PointerEvent): void {}

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.isDisabled) return false
    if (this.readonly) {
      if (event.key === 'Escape' && this._popup.visible) {
        event.preventDefault()
        this._popup.close()
        return true
      }
      return false
    }
    if (event.key === 'Escape' && this._popup.visible) {
      event.preventDefault()
      this._popup.close()
      return true
    }
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return false
    event.preventDefault()
    if (this._popup.visible) this._popup.close()
    else this._openPopup()
    return true
  }

  onPointerCancel(_e: PointerEvent): void {
    const hadHover = this._interaction.leaveHover()
    if (hadHover) this.markNeedsPaint()
  }

  onPointerLeave(_e: PointerEvent): void {
    if (!this._interaction.leaveHover()) return
    this.markNeedsPaint()
  }

  hitTest(point: Offset): boolean {
    const g = this.globalOffset
    const fieldHeight = this._inputTokens(this.currentTheme).height
    return point.x >= g.x && point.x <= g.x + this.size.width &&
           point.y >= g.y && point.y <= g.y + fieldHeight
  }

  dispose(): void {
    runCleanupSteps([
      () => this._valueEditorEvents.dispose(),
      () => this._popup.dispose(),
      () => super.dispose(),
      () => { this.onChange = undefined },
    ])
  }

  protected override onDisabledStateChanged(disabled: boolean, previous: ControlInteractionSnapshot): void {
    if (!disabled) return
    if (previous.hovered) this._interaction.leaveHover()
    if (this._popup.visible) this._popup.close()
  }

  protected override onFocusChanged(focused: boolean): void {
    if (!focused && !this._popup.visible) this._valueEditorEvents.emitBlur()
  }

  private _syncReadonlyFocusRegistration(): void {
    if (typeof window === 'undefined') return
    if (this.readonly) {
      FocusManager.instance.unregister(this)
      return
    }
    if (!this.disabled) FocusManager.instance.register(this)
  }

  private _inputTokens(theme: ResolvedTheme): TextInputStyleTokens {
    return deriveTextInputStyle(theme)
  }

  private _styleTokens(theme: ResolvedTheme): ColorPickerStyleTokens {
    return deriveColorPickerStyle(theme)
  }

  private _triggerSwatchWidth(input: TextInputStyleTokens, style: ColorPickerStyleTokens): number {
    return Math.max(input.height, input.height * style.triggerSwatchWidthFactor)
  }
}
