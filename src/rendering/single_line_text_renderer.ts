import type { TextInputController } from '../core/text_input_controller'
import { resolveSingleLineEditableTextLayout } from '../core/single_line_text_input'
import type { Color } from '../theme/theme'
import { DrawList } from './draw_list'

export interface SingleLineTextRendererOptions {
  dl: DrawList
  controller: TextInputController
  displayText: string
  measureText: (text: string) => number
  fontSize: number
  fontFamily: string
  textX: number
  textY: number
  lineTop: number
  lineBottom: number
  textColor: Color
  selectionBg: Color
  caretColor: Color
  compositionTextColor: Color
  compositionUnderlineColor: Color
  placeholder?: string
  placeholderColor?: Color
  showSelection?: boolean
  showCaret?: boolean
}

export function resolveSingleLineTextOriginX(opts: {
  contentX: number
  contentWidth: number
  textWidth: number
  align: 'left' | 'center' | 'right'
}): number {
  const available = Math.max(0, opts.contentWidth)
  if (opts.textWidth >= available) return opts.contentX
  if (opts.align === 'right') return opts.contentX + available - opts.textWidth
  if (opts.align === 'center') return opts.contentX + (available - opts.textWidth) / 2
  return opts.contentX
}

export function paintSingleLineEditableText(options: SingleLineTextRendererOptions): void {
  const {
    dl,
    controller,
    displayText,
    measureText,
    fontSize,
    fontFamily,
    textX,
    textY,
    lineTop,
    lineBottom,
    textColor,
    selectionBg,
    caretColor,
    compositionTextColor,
    compositionUnderlineColor,
    placeholder,
    placeholderColor,
    showSelection = true,
    showCaret = true,
  } = options

  const layout = resolveSingleLineEditableTextLayout({
    controller,
    displayText,
    measureText,
  })

  if (showSelection && !layout.compositionText && controller.selStart !== controller.selEnd) {
    const selStart = Math.min(controller.selStart, controller.selEnd)
    const selEnd = Math.max(controller.selStart, controller.selEnd)
    const selX0 = textX + measureText(displayText.slice(0, selStart))
    const selX1 = textX + measureText(displayText.slice(0, selEnd))
    dl.fillRect(selX0, lineTop - 1, Math.max(2, selX1 - selX0), lineBottom - lineTop + 2, selectionBg, 0)
  }

  if (layout.compositionText) {
    const prefixW = measureText(layout.prefix)
    const compW = measureText(layout.compositionText)

    if (layout.prefix) dl.fillText(layout.prefix, textX, textY, textColor, fontSize, fontFamily, 'left', 'middle')
    dl.fillText(layout.compositionText, textX + prefixW, textY, compositionTextColor, fontSize, fontFamily, 'left', 'middle')
    dl.line(textX + prefixW, lineBottom + 1, textX + prefixW + compW, lineBottom + 1, compositionUnderlineColor, 1.5)
    if (layout.suffix) dl.fillText(layout.suffix, textX + prefixW + compW, textY, textColor, fontSize, fontFamily, 'left', 'middle')

    if (showCaret && controller.cursorVisible) {
      const caretX = textX + prefixW + compW
      dl.line(caretX, lineTop, caretX, lineBottom, caretColor, 1.5)
    }
    return
  }

  if (displayText.length > 0) {
    dl.fillText(displayText, textX, textY, textColor, fontSize, fontFamily, 'left', 'middle')
  } else if (placeholder && placeholderColor) {
    dl.fillText(placeholder, textX, textY, placeholderColor, fontSize, fontFamily, 'left', 'middle')
  }

  if (showCaret && controller.cursorVisible) {
    const caretX = textX + measureText(displayText.slice(0, controller.cursorPos))
    dl.line(caretX, lineTop, caretX, lineBottom, caretColor, 1.5)
  }
}
