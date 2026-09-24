import type { TextInputController } from './text_input_controller'
import { resolveWordSelectionRange, type TextSelectionRange } from './text_selection'

export interface SingleLineEditableTextLayout {
  prefix: string
  compositionText: string
  suffix: string
  totalWidth: number
  caretOffset: number
}

export function resolveSingleLineEditableTextLayout(opts: {
  controller: TextInputController
  displayText: string
  measureText: (text: string) => number
}): SingleLineEditableTextLayout {
  const { controller, displayText, measureText } = opts
  if (!controller.composing || !controller.compositionText) {
    return {
      prefix: displayText,
      compositionText: '',
      suffix: '',
      totalWidth: measureText(displayText),
      caretOffset: measureText(displayText.slice(0, controller.cursorPos)),
    }
  }

  const hasSelection = controller.selStart !== controller.selEnd
  const start = hasSelection
    ? Math.min(controller.selStart, controller.selEnd)
    : controller.cursorPos
  const end = hasSelection
    ? Math.max(controller.selStart, controller.selEnd)
    : controller.cursorPos
  const prefix = displayText.slice(0, start)
  const suffix = displayText.slice(end)
  const prefixWidth = measureText(prefix)
  const compositionWidth = measureText(controller.compositionText)

  return {
    prefix,
    compositionText: controller.compositionText,
    suffix,
    totalWidth: prefixWidth + compositionWidth + measureText(suffix),
    caretOffset: prefixWidth + compositionWidth,
  }
}

export interface SingleLineTextInputDelegate {
  controller: TextInputController
  getDisplayText: () => string
  measureText: (text: string) => number
  getViewportWidth: () => number
  getViewportOffsetX?: () => number
  getTextOrigin: () => { x: number; y: number }
}

export interface SingleLineCursorRevealResult {
  scrollChanged: boolean
  unrevealedLeft: number
  unrevealedRight: number
}

export interface SingleLineSelectionOptions {
  extend?: boolean
  syncComposer?: boolean
}

export class SingleLineTextInput {
  private readonly _delegate: SingleLineTextInputDelegate

  constructor(delegate: SingleLineTextInputDelegate) {
    this._delegate = delegate
  }

  localXFromGlobal(globalX: number): number {
    const { x } = this._delegate.getTextOrigin()
    return globalX - x + this._delegate.controller.scrollX
  }

  hitCharIndex(localX: number): number {
    const text = this._delegate.getDisplayText()
    if (localX <= 0) return 0
    const totalW = this._delegate.measureText(text)
    if (localX >= totalW) return text.length

    let lo = 0
    let hi = text.length
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this._delegate.measureText(text.slice(0, mid)) <= localX) lo = mid
      else hi = mid - 1
    }
    const wLeft = this._delegate.measureText(text.slice(0, lo))
    const wRight = lo < text.length
      ? this._delegate.measureText(text.slice(0, lo + 1))
      : wLeft
    return localX - wLeft < wRight - localX ? lo : Math.min(lo + 1, text.length)
  }

  hitCharIndexFromGlobal(globalX: number): number {
    return this.hitCharIndex(this.localXFromGlobal(globalX))
  }

  hitCharacterIndexFromGlobal(globalX: number): number | null {
    const localX = this.localXFromGlobal(globalX)
    const text = this._delegate.getDisplayText()
    const totalWidth = this._delegate.measureText(text)
    if (text.length === 0 || localX < 0 || localX >= totalWidth) return null

    let low = 0
    let high = text.length - 1
    while (low < high) {
      const middle = (low + high) >> 1
      if (this._delegate.measureText(text.slice(0, middle + 1)) > localX) high = middle
      else low = middle + 1
    }
    return low
  }

  selectWordFromGlobal(
    globalX: number,
    opts: { syncComposer?: boolean; text?: string } = {},
  ): TextSelectionRange | null {
    const text = opts.text ?? this._delegate.getDisplayText()
    const characterIndex = this.hitCharacterIndexFromGlobal(globalX)
    if (characterIndex === null) return null
    const range = resolveWordSelectionRange(text, characterIndex)
    if (!range) return null
    this._delegate.controller.setSelection(range.start, range.end, {
      cursorPos: range.end,
      syncComposer: opts.syncComposer,
    })
    return range
  }

  setSelectionFromGlobal(globalX: number, opts: SingleLineSelectionOptions = {}): number {
    return this.setSelectionFromLocal(this.localXFromGlobal(globalX), opts)
  }

  setSelectionFromLocal(localX: number, opts: SingleLineSelectionOptions = {}): number {
    const charIdx = this.hitCharIndex(localX)
    if (opts.extend) {
      this._delegate.controller.extendSelection(charIdx, {
        cursorPos: charIdx,
        syncComposer: opts.syncComposer,
      })
    } else {
      this._delegate.controller.setSelection(charIdx, charIdx, {
        cursorPos: charIdx,
        syncComposer: opts.syncComposer,
      })
    }
    return charIdx
  }

  scrollToCursor(): SingleLineCursorRevealResult {
    const controller = this._delegate.controller
    const displayText = this._delegate.getDisplayText()
    const layout = resolveSingleLineEditableTextLayout({
      controller,
      displayText,
      measureText: this._delegate.measureText,
    })
    const cursorX = layout.caretOffset
    const rawViewportOffsetX = this._delegate.getViewportOffsetX?.() ?? 0
    const viewportOffsetX = Number.isFinite(rawViewportOffsetX)
      ? Math.max(0, rawViewportOffsetX)
      : 0
    const innerW = this._delegate.getViewportWidth()
    if (!Number.isFinite(innerW) || innerW <= 0) {
      const cursorViewportX = cursorX - controller.scrollX
      return {
        scrollChanged: false,
        unrevealedLeft: Math.max(0, viewportOffsetX - cursorViewportX),
        unrevealedRight: Math.max(0, cursorViewportX - viewportOffsetX),
      }
    }
    const viewportRight = viewportOffsetX + innerW - 2

    const contentWidth = layout.totalWidth
    const maxScrollX = Math.max(0, contentWidth - innerW + 2)
    let scrollX = Math.min(controller.scrollX, maxScrollX)

    if (cursorX - scrollX > viewportRight) scrollX = cursorX - viewportRight
    if (cursorX - scrollX < viewportOffsetX) {
      scrollX = Math.max(0, cursorX - viewportOffsetX - 4)
    }

    const beforeScrollX = controller.scrollX
    controller.setScrollX(Math.min(scrollX, maxScrollX))
    const revealedCursorX = cursorX - controller.scrollX
    return {
      scrollChanged: controller.scrollX !== beforeScrollX,
      unrevealedLeft: Math.max(0, viewportOffsetX - revealedCursorX),
      unrevealedRight: Math.max(0, revealedCursorX - viewportRight),
    }
  }

  updateComposerPosition(): void {
    const controller = this._delegate.controller
    const charIndex = controller.selStart !== controller.selEnd
      ? controller.selStart
      : controller.cursorPos
    this.updateComposerPositionAt(charIndex)
  }

  updateComposerPositionAt(charIndex: number): void {
    const controller = this._delegate.controller
    const { x, y } = this._delegate.getTextOrigin()
    const displayText = this._delegate.getDisplayText()
    const layout = resolveSingleLineEditableTextLayout({
      controller,
      displayText,
      measureText: this._delegate.measureText,
    })
    const cursorOffsetX = (
      layout.compositionText
        ? layout.caretOffset
        : this._delegate.measureText(displayText.slice(0, charIndex))
    ) - controller.scrollX

    controller.updateComposerPosition(x + cursorOffsetX, y)
  }
}
