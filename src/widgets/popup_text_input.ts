import { TextInputController } from '../core/text_input_controller'
import { SingleLineTextInput } from '../core/single_line_text_input'
import type { Offset } from '../core/render_object'
import { PopupManager } from '../core/popup_manager'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { paintSingleLineEditableText } from '../rendering/single_line_text_renderer'
import { TextMeasurer } from '../core/text_measurer'
import { deriveTextInputStyle, resolveBgColor } from '../theme/component_styles'
import type { ResolvedTheme } from '../theme/theme'
import { resolveWordSelectionRange } from '../core/text_selection'

export interface PopupTextInputLayout {
  x: number
  y: number
  w: number
  h: number
}

export interface PopupTextInputSessionOptions {
  value: string
  placeholder?: string
  multiline?: boolean
  onInput?: (value: string, controller: TextInputController) => void
  onCompositionUpdate?: (text: string, controller: TextInputController) => void
  onCompositionEnd?: (value: string, controller: TextInputController) => void
  onKeyDown?: (event: KeyboardEvent, controller: TextInputController) => void
}

export class PopupTextInput {
  private _value = ''
  private _placeholder = ''
  private _multiline = false
  private _layout: PopupTextInputLayout | null = null
  private _dragging = false
  private _currentTheme: ResolvedTheme | null = null
  readonly input: TextInputController
  readonly singleLineInput: SingleLineTextInput

  constructor(private readonly _onInvalidate: () => void) {
    this.input = new TextInputController({ onInvalidate: () => this._onInvalidate() })
    this.singleLineInput = new SingleLineTextInput({
      controller: this.input,
      getDisplayText: () => this._value,
      measureText: text => {
        const input = deriveTextInputStyle(this._theme())
        return TextMeasurer.measureWidth(text, input.fontSize, input.fontFamily)
      },
      getViewportWidth: () => {
        if (!this._layout) return 0
        const input = deriveTextInputStyle(this._theme())
        return Math.max(0, this._layout.w - input.padding * 2)
      },
      getTextOrigin: () => {
        if (!this._layout) return { x: 0, y: 0 }
        const input = deriveTextInputStyle(this._theme())
        return { x: this._layout.x + input.padding, y: this._layout.y + 4 }
      },
    })
  }

  private _theme(): ResolvedTheme {
    return this._currentTheme ?? PopupManager.instance.context.theme
  }

  get value(): string { return this._value }
  get cursorPos(): number { return this.input.cursorPos }
  get selStart(): number { return this.input.selStart }
  get selEnd(): number { return this.input.selEnd }
  get composing(): boolean { return this.input.composing }
  get compositionText(): string { return this.input.compositionText }

  beginSession(options: PopupTextInputSessionOptions): void {
    this.endSession()
    this._value = options.value
    this._placeholder = options.placeholder ?? ''
    this._multiline = options.multiline ?? false
    this.input.beginSession({
      onInput: (value, controller) => {
        this._value = value
        controller.syncSelectionFromComposer()
        controller.resetBlink()
        this._syncViewportToCursor()
        options.onInput?.(value, controller)
        this._onInvalidate()
      },
      onCompositionUpdate: (text, controller) => {
        controller.resetBlink()
        this._syncViewportToCursor()
        options.onCompositionUpdate?.(text, controller)
        this._onInvalidate()
      },
      onCompositionEnd: (value, controller) => {
        this._value = value
        controller.syncSelectionFromComposer()
        controller.resetBlink()
        this._syncViewportToCursor()
        options.onCompositionEnd?.(value, controller)
        this._onInvalidate()
      },
      onKeyDown: (event, controller) => {
        options.onKeyDown?.(event, controller)
        if (event.defaultPrevented) return
        if (!shouldRefreshSelectionFromKey(event)) return
        requestAnimationFrame(() => {
          if (!this.input.hasSession) return
          controller.syncSelectionFromComposer()
          controller.resetBlink()
          this.singleLineInput.scrollToCursor()
          this.singleLineInput.updateComposerPosition()
          this._onInvalidate()
        })
      },
    }, options.value)
  }

  endSession(): void {
    this.input.endSession()
    this._dragging = false
  }

  dispose(): void {
    this.input.dispose()
  }

  setValue(value: string): void {
    if (this._value === value) return
    this._value = value
    this._onInvalidate()
  }

  setSelection(
    start: number,
    end: number,
    opts: { cursorPos?: number; syncComposer?: boolean } = {},
  ): void {
    this.input.setSelection(start, end, {
      cursorPos: opts.cursorPos ?? end,
      syncComposer: opts.syncComposer ?? false,
    })
  }

  focus(): void {
    this.input.focusComposer()
    this.singleLineInput.updateComposerPosition()
  }

  private _syncViewportToCursor(): void {
    if (!this._layout) return
    this.singleLineInput.scrollToCursor()
    this.singleLineInput.updateComposerPosition()
  }

  hitTest(point: Offset, layout: PopupTextInputLayout): boolean {
    return point.x >= layout.x && point.x <= layout.x + layout.w &&
      point.y >= layout.y && point.y <= layout.y + layout.h
  }

  handlePointerDown(point: Offset, layout: PopupTextInputLayout, clickCount = 1): void {
    this._layout = layout
    this._currentTheme = PopupManager.instance.context.theme
    this.focus()
    if (clickCount === 2 && this.handleDoubleClick(point, layout)) return
    if (this._multiline) {
      const offset = this._offsetFromMultilinePoint(point, layout)
      this.setSelection(offset, offset, { syncComposer: true })
    } else {
      this.singleLineInput.setSelectionFromGlobal(point.x, { syncComposer: true })
    }
    this._dragging = true
    this.input.resetBlink()
    this.singleLineInput.scrollToCursor()
    this.singleLineInput.updateComposerPosition()
    this._onInvalidate()
  }

  handlePointerMove(point: Offset): void {
    if (!this._dragging || !this._layout) return
    if (this._multiline) {
      const offset = this._offsetFromMultilinePoint(point, this._layout)
      this.input.extendSelection(offset, { cursorPos: offset, syncComposer: true })
    } else {
      this.singleLineInput.setSelectionFromGlobal(point.x, {
        extend: true,
        syncComposer: true,
      })
      this.singleLineInput.scrollToCursor()
      this.singleLineInput.updateComposerPosition()
    }
    this._onInvalidate()
  }

  handleDoubleClick(point: Offset, layout: PopupTextInputLayout): boolean {
    if (!this.hitTest(point, layout)) return false
    this._layout = layout
    this._currentTheme = PopupManager.instance.context.theme
    this.focus()
    this._dragging = false

    const characterOffset = this._multiline
      ? this._characterOffsetFromMultilinePoint(point, layout)
      : null
    const range = this._multiline
      ? characterOffset === null ? null : resolveWordSelectionRange(this._value, characterOffset)
      : this.singleLineInput.selectWordFromGlobal(point.x, { syncComposer: true })
    if (!range) return false
    if (this._multiline) {
      this.setSelection(range.start, range.end, {
        cursorPos: range.end,
        syncComposer: true,
      })
    }
    this.input.resetBlink()
    this._syncViewportToCursor()
    this._onInvalidate()
    return true
  }

  handlePointerUp(): void {
    this._dragging = false
  }

  handlePointerCancel(): void {
    this._dragging = false
  }

  paint(context: PaintContext, layout: PopupTextInputLayout, theme: ResolvedTheme): void {
    this._layout = layout
    this._currentTheme = theme
    const input = deriveTextInputStyle(theme)
    const dl = new DrawList(context)
    dl.fillRect(layout.x, layout.y, layout.w, layout.h, resolveBgColor(input.inputBg, 'focused'), input.borderRadius)
    dl.strokeRect(layout.x, layout.y, layout.w, layout.h, resolveBgColor(input.inputBorder, 'focused'), 1, input.borderRadius)
    if (this._multiline) {
      this._paintMultiline(context, layout, theme)
      return
    }
    dl.pushClip(layout.x + input.padding, layout.y, layout.w - input.padding * 2, layout.h)
    paintSingleLineEditableText({
      dl,
      controller: this.input,
      displayText: this._value,
      measureText: text => TextMeasurer.measureWidth(text, input.fontSize, input.fontFamily),
      fontSize: input.fontSize,
      fontFamily: input.fontFamily,
      textX: layout.x + input.padding,
      textY: layout.y + layout.h / 2,
      lineTop: layout.y + 4,
      lineBottom: layout.y + layout.h - 4,
      textColor: input.text,
      selectionBg: input.selectionBg,
      caretColor: input.caretColor,
      compositionTextColor: input.compositionText,
      compositionUnderlineColor: resolveBgColor(input.inputBorder, 'focused'),
      placeholder: this._placeholder,
      placeholderColor: input.placeholderText,
    })
    dl.popClip()
  }

  private _paintMultiline(context: PaintContext, layout: PopupTextInputLayout, theme: ResolvedTheme): void {
    const input = deriveTextInputStyle(theme)
    const dl = new DrawList(context)
    const lineHeight = Math.max(input.lineHeight, input.fontSize + 4)
    const left = layout.x + input.padding
    const top = layout.y + input.padding
    const clipW = Math.max(0, layout.w - input.padding * 2)
    const clipH = Math.max(0, layout.h - input.padding * 2)
    dl.pushClip(left, top, clipW, clipH)
    const lines = this._value.split('\n')
    if (!this._value && this._placeholder) {
      dl.fillText(this._placeholder, left, top + lineHeight / 2, input.placeholderText, input.fontSize, input.fontFamily, 'left', 'middle')
    } else {
      let lineStart = 0
      for (let index = 0; index < lines.length; index++) {
        const y = top + index * lineHeight + lineHeight / 2
        if (y > top + clipH + lineHeight) break
        const line = lines[index] ?? ''
        const lineEnd = lineStart + line.length
        if (this.input.selStart < lineEnd && this.input.selEnd > lineStart) {
          const selectionStart = Math.max(0, this.input.selStart - lineStart)
          const selectionEnd = Math.min(line.length, this.input.selEnd - lineStart)
          const selectionX = left + TextMeasurer.measureWidth(
            line.slice(0, selectionStart),
            input.fontSize,
            input.fontFamily,
          )
          const selectionEndX = left + TextMeasurer.measureWidth(
            line.slice(0, selectionEnd),
            input.fontSize,
            input.fontFamily,
          )
          dl.fillRect(
            selectionX,
            top + index * lineHeight,
            Math.max(2, selectionEndX - selectionX),
            lineHeight,
            input.selectionBg,
          )
        }
        dl.fillText(line || ' ', left, y, input.text, input.fontSize, input.fontFamily, 'left', 'middle')
        lineStart = lineEnd + 1
      }
    }
    if (this.input.cursorVisible && this.input.selStart === this.input.selEnd) {
      const caret = this._multilineCaretPosition(left, top, lineHeight, input.fontSize, input.fontFamily)
      dl.line(caret.x, caret.y, caret.x, caret.y + lineHeight - 2, input.caretColor, 1)
    }
    dl.popClip()
  }

  private _offsetFromMultilinePoint(point: Offset, layout: PopupTextInputLayout): number {
    const input = deriveTextInputStyle(this._theme())
    const lineHeight = Math.max(input.lineHeight, input.fontSize + 4)
    const lines = this._value.split('\n')
    const lineIndex = Math.max(0, Math.min(lines.length - 1, Math.floor((point.y - layout.y - input.padding) / lineHeight)))
    const line = lines[lineIndex] ?? ''
    const localX = Math.max(0, point.x - layout.x - input.padding)
    let col = 0
    for (; col < line.length; col++) {
      const width = TextMeasurer.measureWidth(line.slice(0, col + 1), input.fontSize, input.fontFamily)
      if (width > localX) break
    }
    return lines.slice(0, lineIndex).reduce((sum, item) => sum + item.length + 1, 0) + col
  }

  private _characterOffsetFromMultilinePoint(
    point: Offset,
    layout: PopupTextInputLayout,
  ): number | null {
    const input = deriveTextInputStyle(this._theme())
    const lineHeight = Math.max(input.lineHeight, input.fontSize + 4)
    const localY = point.y - layout.y - input.padding
    const contentHeight = Math.max(0, layout.h - input.padding * 2)
    if (localY < 0 || localY >= contentHeight) return null
    const lines = this._value.split('\n')
    const lineIndex = Math.floor(localY / lineHeight)
    if (lineIndex < 0 || lineIndex >= lines.length) return null

    const line = lines[lineIndex] ?? ''
    const localX = point.x - layout.x - input.padding
    const totalWidth = TextMeasurer.measureWidth(line, input.fontSize, input.fontFamily)
    if (line.length === 0 || localX < 0 || localX >= totalWidth) return null

    let column = 0
    for (; column < line.length; column++) {
      const width = TextMeasurer.measureWidth(
        line.slice(0, column + 1),
        input.fontSize,
        input.fontFamily,
      )
      if (width > localX) break
    }
    return lines.slice(0, lineIndex).reduce((sum, item) => sum + item.length + 1, 0) + column
  }

  private _multilineCaretPosition(left: number, top: number, lineHeight: number, fontSize: number, fontFamily: string): { x: number; y: number } {
    const before = this._value.slice(0, this.input.cursorPos)
    const lines = before.split('\n')
    const lineIndex = Math.max(0, lines.length - 1)
    const line = lines[lineIndex] ?? ''
    return {
      x: left + TextMeasurer.measureWidth(line, fontSize, fontFamily),
      y: top + lineIndex * lineHeight + 1,
    }
  }
}

function shouldRefreshSelectionFromKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey) {
    return event.key.toLowerCase() === 'a'
  }
  return event.key === 'ArrowLeft' ||
    event.key === 'ArrowRight' ||
    event.key === 'Home' ||
    event.key === 'End'
}
