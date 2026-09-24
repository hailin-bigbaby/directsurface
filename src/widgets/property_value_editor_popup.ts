import type { Offset } from '../core/render_object'
import { PopupManager, clampXToPopupViewport, clampYToPopupViewport, type PopupContext } from '../core/popup_manager'
import { PopupShell } from '../core/popup_shell'
import {
  type PopupAnchor,
  resolvePopupAnchorRect,
  resolvePopupAnchorTarget,
} from '../core/popup_anchor'
import { isPrimaryPointerButton, type PointerEvent as PopupPointerEvent, type WheelPointerEvent } from '../gestures/hit_test'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { drawPopupPanel } from '../rendering/popup_painter'
import { paintSingleLineText } from '../rendering/text_painter'
import { derivePopupStyle, deriveTextInputStyle } from '../theme/component_styles'
import { PopupTextInput } from './popup_text_input'

export interface PropertyValueEditorPopupOpenOptions {
  value: string
  anchor: PopupAnchor
  placeholder?: string
  quickInserts?: readonly PropertyValueEditorQuickInsert[]
  preview?: PropertyValueEditorPreviewProvider
  previewLabel?: string
  previewPresentation?: PropertyValueEditorPreviewPresentation
  multiline?: boolean
  minWidth?: number
  maxWidth?: number
  commitOnOutside?: boolean
  dismissOnPanelPointerDown?: boolean
  onCommit: (value: string, trigger: PropertyValueEditorCommitTrigger) => boolean | void
  onCancel?: () => void
  onClose?: () => void
}

export type PropertyValueEditorCommitTrigger =
  | 'enter'
  | 'tab-forward'
  | 'tab-backward'
  | 'outside'

export interface PropertyValueEditorQuickInsert {
  readonly label: string
  readonly value: string
  readonly group?: string
}

export interface PropertyValueEditorPreview {
  readonly status: 'ok' | 'error' | 'empty'
  readonly text: string
}

export type PropertyValueEditorPreviewProvider = (value: string) => PropertyValueEditorPreview

export type PropertyValueEditorPreviewPresentation = 'panel' | 'error-text'

interface PropertyValueEditorPopupLayout {
  rect: { x: number; y: number; w: number; h: number }
  inputRect: { x: number; y: number; w: number; h: number }
  quickRects: Array<{ item: PropertyValueEditorQuickInsert; rect: { x: number; y: number; w: number; h: number } }>
  preview?: PropertyValueEditorPreview
  previewRect?: { x: number; y: number; w: number; h: number }
}

const viewportPadding = 8
const quickInsertHeight = 22
const quickInsertGap = 6
const previewHeight = 26

export class PropertyValueEditorPopup extends PopupShell {
  private _anchor?: PopupAnchor
  private _value = ''
  private _placeholder = ''
  private _minWidth = 160
  private _maxWidth = 360
  private _multiline = false
  private _quickInserts: PropertyValueEditorQuickInsert[] = []
  private _preview?: PropertyValueEditorPreviewProvider
  private _previewLabel = 'Test'
  private _previewPresentation: PropertyValueEditorPreviewPresentation = 'panel'
  private _committed = false
  private _commitOnOutside = false
  private _dismissOnPanelPointerDown = true
  private _onCommit?: (value: string, trigger: PropertyValueEditorCommitTrigger) => boolean | void
  private _onCancel?: () => void
  private _onClose?: () => void
  private readonly _input = new PopupTextInput(() => PopupManager.instance.requestPaint())

  debugState(context: PopupContext = PopupManager.instance.context): {
    value: string
    quickInserts: PropertyValueEditorQuickInsert[]
    quickRects: PropertyValueEditorPopupLayout['quickRects']
    rect: { x: number; y: number; w: number; h: number }
    inputRect: { x: number; y: number; w: number; h: number }
    preview?: PropertyValueEditorPreview
    previewRect?: { x: number; y: number; w: number; h: number }
    multiline: boolean
  } {
    const layout = this._layout(context)
    return {
      value: this._input.value,
      quickInserts: [...this._quickInserts],
      quickRects: layout.quickRects,
      rect: layout.rect,
      inputRect: layout.inputRect,
      preview: this._preview?.(this._input.value),
      previewRect: layout.previewRect,
      multiline: this._multiline,
    }
  }

  debugSetValue(value: string): void {
    this._input.setValue(value)
    this._input.setSelection(value.length, value.length, { syncComposer: true })
    this._value = value
    this.requestPopupPaint()
  }

  open(opts: PropertyValueEditorPopupOpenOptions): void {
    if (this.popupOpen) this.close()
    this._anchor = opts.anchor
    this._value = opts.value
    this._placeholder = opts.placeholder ?? ''
    this._quickInserts = [...(opts.quickInserts ?? [])]
    this._preview = opts.preview
    this._previewLabel = opts.previewLabel ?? 'Test'
    this._previewPresentation = opts.previewPresentation ?? 'panel'
    this._multiline = opts.multiline ?? false
    this._minWidth = opts.minWidth ?? 160
    this._maxWidth = opts.maxWidth ?? 360
    this._committed = false
    this._commitOnOutside = opts.commitOnOutside ?? false
    this._dismissOnPanelPointerDown = opts.dismissOnPanelPointerDown ?? true
    this._onCommit = opts.onCommit
    this._onCancel = opts.onCancel
    this._onClose = opts.onClose
    this._input.beginSession({
      value: this._value,
      placeholder: this._placeholder,
      multiline: this._multiline,
      onInput: value => {
        this._value = value
        this.requestPopupPaint()
      },
      onCompositionUpdate: () => this.requestPopupPaint(),
      onCompositionEnd: value => {
        this._value = value
        this.requestPopupPaint()
      },
      onKeyDown: event => {
        this._handleKeyDown(event)
      },
    })
    this._input.setSelection(0, this._value.length, { cursorPos: this._value.length, syncComposer: true })
    this.openPopup({ owner: resolvePopupAnchorTarget(opts.anchor) })
  }

  onKeyDown(event: KeyboardEvent): boolean {
    return this._handleKeyDown(event)
  }

  hitTest(point: Offset, context: PopupContext): boolean {
    if (!this.visible) return false
    const rect = this._layout(context).rect
    return pointInRect(point, rect)
  }

  onPointerDown(event: PopupPointerEvent, context: PopupContext): void {
    if (!isPrimaryPointerButton(event)) return
    if (!this.visible) return
    const layout = this._layout(context)
    if (this._input.hitTest(event.position, layout.inputRect)) {
      this._input.handlePointerDown(event.position, layout.inputRect, event.clickCount)
      return
    }
    const quick = layout.quickRects.find(item => pointInRect(event.position, item.rect))
    if (quick) {
      this._insertQuickValue(quick.item.value)
      return
    }
    if (this._dismissOnPanelPointerDown) this.close()
  }

  onPointerMove(event: PopupPointerEvent): void {
    if (!this.visible) return
    this._input.handlePointerMove(event.position)
  }

  onPointerUp(event: PopupPointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    this._input.handlePointerUp()
  }

  onPointerCancel(_event: PopupPointerEvent): void {
    this._input.handlePointerCancel()
  }

  onWheel(_event: WheelPointerEvent): boolean {
    return this.visible
  }

  onOutsidePointerDown(_event: PopupPointerEvent): boolean {
    if (!this._commitOnOutside) {
      this.close()
      return false
    }
    return !this._commit('outside')
  }

  override onEscape(event: KeyboardEvent): boolean {
    event.preventDefault()
    this.close()
    return true
  }

  paint(context: PaintContext): void {
    if (!this.visible) return
    const popupContext = PopupManager.instance.context
    const popupStyle = derivePopupStyle(context.theme)
    const dl = new DrawList(context)
    const layout = this._layout(popupContext)
    drawPopupPanel(dl, layout.rect.x, layout.rect.y, layout.rect.w, layout.rect.h, popupStyle)
    this._input.paint(context, layout.inputRect, context.theme)
    this._paintQuickInserts(dl, layout)
    this._paintPreview(dl, layout)
  }

  dispose(): void {
    this.close()
    this._input.dispose()
  }

  protected override onPopupClose(): void {
    this._input.endSession()
    if (!this._committed) this._onCancel?.()
    this._onClose?.()
  }

  private _handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.visible) return false
    if (event.key === 'Enter' && (!this._multiline || event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      event.stopPropagation()
      this._commit('enter')
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.close()
      return true
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      this._commit(event.shiftKey ? 'tab-backward' : 'tab-forward')
      return true
    }
    return false
  }

  private _commit(trigger: PropertyValueEditorCommitTrigger): boolean {
    const next = this._input.value
    if (this._onCommit?.(next, trigger) === false) {
      this.requestPopupPaint()
      return false
    }
    this._committed = true
    this.close()
    return true
  }

  private _insertQuickValue(value: string): void {
    const start = Math.min(this._input.selStart, this._input.selEnd)
    const end = Math.max(this._input.selStart, this._input.selEnd)
    const next = this._input.value.slice(0, start) + value + this._input.value.slice(end)
    const cursor = start + value.length
    this._input.setValue(next)
    this._input.setSelection(cursor, cursor, { syncComposer: true })
    this._value = next
    this.requestPopupPaint()
  }

  private _paintQuickInserts(dl: DrawList, layout: PropertyValueEditorPopupLayout): void {
    if (layout.quickRects.length === 0) return
    const theme = PopupManager.instance.context.theme
    for (const item of layout.quickRects) {
      const rect = item.rect
      dl.fillRect(rect.x, rect.y, rect.w, rect.h, theme.surfaceControl, 4)
      dl.strokeRect(rect.x, rect.y, rect.w, rect.h, theme.borderControl, 1, 4)
      dl.fillText(item.item.label, rect.x + 7, rect.y + rect.h / 2, theme.textSecondary, 11, 'Arial, sans-serif', 'left', 'middle')
    }
  }

  private _paintPreview(dl: DrawList, layout: PropertyValueEditorPopupLayout): void {
    if (!layout.previewRect || !layout.preview) return
    const theme = PopupManager.instance.context.theme
    const inputStyle = deriveTextInputStyle(theme)
    const preview = layout.preview
    const rect = layout.previewRect
    if (this._previewPresentation === 'error-text') {
      paintSingleLineText(dl, {
        text: preview.text,
        x: rect.x + 1,
        y: rect.y + rect.h / 2,
        maxWidth: Math.max(0, rect.w - 2),
        color: inputStyle.errorText,
        fontSize: inputStyle.helperFontSize,
        fontFamily: inputStyle.fontFamily,
      })
      return
    }
    const errorColor = inputStyle.errorBorder
    const tone = preview.status === 'error' ? errorColor : preview.status === 'empty' ? theme.textSecondary : theme.textAccent
    dl.fillRect(rect.x, rect.y, rect.w, rect.h, theme.surfacePanel, 4)
    dl.strokeRect(rect.x, rect.y, rect.w, rect.h, preview.status === 'error' ? errorColor : theme.borderSubtle, 1, 4)
    const label = this._previewLabel ? this._previewLabel + ': ' : ''
    dl.fillText(label + preview.text, rect.x + 7, rect.y + rect.h / 2, tone, 11, 'Arial, sans-serif', 'left', 'middle')
  }

  private _layout(context: PopupContext): PropertyValueEditorPopupLayout {
    const popupStyle = derivePopupStyle(context.theme)
    const inputStyle = deriveTextInputStyle(context.theme)
    const anchor = resolvePopupAnchorRect(this._anchor)
    const panelPadding = popupStyle.padding
    const width = Math.min(
      Math.max(anchor.w, this._minWidth, 48),
      this._maxWidth,
    )
    const hasQuickInserts = this._quickInserts.length > 0
    const quickRowCount = hasQuickInserts ? this._quickInsertRowCount(width, panelPadding) : 0
    const inputHeight = this._multiline ? inputStyle.height * 4 : inputStyle.height
    const preview = this._visiblePreview()
    const previewRowHeight = this._previewPresentation === 'error-text'
      ? inputStyle.helperLineHeight
      : previewHeight
    const previewGap = this._previewPresentation === 'error-text'
      ? inputStyle.helperGap
      : quickInsertGap
    const height = inputHeight + panelPadding * 2 +
      quickRowCount * (quickInsertHeight + quickInsertGap) +
      (preview ? previewRowHeight + previewGap : 0)
    const rawX = anchor.x
    const downY = anchor.y + anchor.h + 2
    const upY = anchor.y - height - 2
    const y = clampYToPopupViewport(downY, height, context, viewportPadding) === downY
      ? downY
      : upY
    const rect = {
      x: clampXToPopupViewport(rawX, width, context, viewportPadding),
      y: clampYToPopupViewport(y, height, context, viewportPadding),
      w: width,
      h: height,
    }
    return {
      rect,
      inputRect: {
        x: rect.x + panelPadding,
        y: rect.y + panelPadding,
        w: Math.max(0, rect.w - panelPadding * 2),
        h: inputHeight,
      },
      quickRects: hasQuickInserts ? this._layoutQuickInserts(rect, panelPadding, inputHeight) : [],
      preview,
      previewRect: preview ? this._layoutPreview(rect, panelPadding, previewRowHeight) : undefined,
    }
  }

  private _visiblePreview(): PropertyValueEditorPreview | undefined {
    const preview = this._preview?.(this._input.value)
    if (!preview) return undefined
    if (
      this._previewPresentation === 'error-text'
      && (preview.status !== 'error' || !preview.text.trim())
    ) {
      return undefined
    }
    return preview
  }

  private _layoutQuickInserts(
    rect: { x: number; y: number; w: number; h: number },
    panelPadding: number,
    inputHeight: number,
  ): PropertyValueEditorPopupLayout['quickRects'] {
    const items: PropertyValueEditorPopupLayout['quickRects'] = []
    const startX = rect.x + panelPadding
    let x = startX
    let y = rect.y + panelPadding + inputHeight + quickInsertGap
    const maxRight = rect.x + rect.w - panelPadding
    for (const item of this._quickInserts) {
      const width = quickInsertWidth(item.label, Math.max(48, maxRight - startX))
      if (x > startX && x + width > maxRight) {
        x = startX
        y += quickInsertHeight + quickInsertGap
      }
      items.push({ item, rect: { x, y, w: width, h: quickInsertHeight } })
      x += width + quickInsertGap
    }
    return items
  }

  private _quickInsertRowCount(width: number, panelPadding: number): number {
    if (this._quickInserts.length === 0) return 0
    const availableWidth = Math.max(48, width - panelPadding * 2)
    let rowCount = 1
    let x = 0
    for (const item of this._quickInserts) {
      const itemWidth = quickInsertWidth(item.label, availableWidth)
      if (x > 0 && x + itemWidth > availableWidth) {
        rowCount++
        x = 0
      }
      x += itemWidth + quickInsertGap
    }
    return rowCount
  }

  private _layoutPreview(
    rect: { x: number; y: number; w: number; h: number },
    panelPadding: number,
    height: number,
  ): { x: number; y: number; w: number; h: number } {
    return {
      x: rect.x + panelPadding,
      y: rect.y + rect.h - panelPadding - height,
      w: Math.max(0, rect.w - panelPadding * 2),
      h: height,
    }
  }
}

function quickInsertWidth(label: string, maxWidth: number): number {
  return Math.min(Math.max(48, label.length * 7 + 16), maxWidth)
}

function pointInRect(point: Offset, rect: { x: number; y: number; w: number; h: number }): boolean {
  return point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
}
