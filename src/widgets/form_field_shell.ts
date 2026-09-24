import type { Offset } from '../core/render_object'
import { TextMeasurer } from '../core/text_measurer'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import {
  blendColor,
  deriveTextInputStyle,
  resolveBgColor,
  type InteractionState,
  type TextInputStyleTokens,
} from '../theme/component_styles'
import type { Color } from '../theme/theme'
import { paintIconGlyph, type IconName } from './icon'

export type FormFieldStatus = 'default' | 'success' | 'warning' | 'error'

export interface FormFieldShellMetrics {
  fieldHeight: number
  totalHeight: number
  contentX: number
  contentY: number
  contentWidth: number
  contentHeight: number
  helperTextY: number | null
}

export interface FormFieldRect {
  x: number
  y: number
  w: number
  h: number
}

export interface FormFieldInlineLayout {
  valueRect: FormFieldRect
  leadingTextRect: FormFieldRect | null
  leadingRect: FormFieldRect | null
  prefixRect: FormFieldRect | null
  suffixRect: FormFieldRect | null
  clearRect: FormFieldRect | null
  trailingRect: FormFieldRect | null
}

export function measureFormFieldHelperHeight(
  style: TextInputStyleTokens,
  helperText?: string,
): number {
  return helperText ? style.helperGap + style.helperLineHeight : 0
}

export function measureFormFieldHeight(
  style: TextInputStyleTokens,
  fieldHeight: number,
  helperText?: string,
): number {
  return fieldHeight + measureFormFieldHelperHeight(style, helperText)
}

export function resolveFormFieldState(opts: {
  focused?: boolean
  hovered?: boolean
  disabled?: boolean
}): InteractionState {
  if (opts.disabled) return 'disabled'
  if (opts.focused) return 'focused'
  if (opts.hovered) return 'hovered'
  return 'normal'
}

export function resolveFormFieldTextColor(
  style: TextInputStyleTokens,
  disabled = false,
): Color {
  return disabled ? style.textDisabled : style.text
}

export function resolveFormFieldPlaceholderColor(
  style: TextInputStyleTokens,
  disabled = false,
): Color {
  return disabled ? style.textDisabled : style.placeholderText
}

export function resolveFormFieldDecorationColor(
  style: TextInputStyleTokens,
  disabled = false,
): Color {
  return disabled ? style.textDisabled : style.placeholderText
}

export function resolveFormFieldHelperColor(
  style: TextInputStyleTokens,
  status: FormFieldStatus = 'default',
  disabled = false,
): Color {
  if (disabled) return style.helperTextDisabled
  switch (status) {
    case 'success': return style.successText
    case 'warning': return style.warningText
    case 'error': return style.errorText
    default: return style.helperText
  }
}

export function resolveFormFieldBorderColor(
  style: TextInputStyleTokens,
  state: InteractionState,
  status: FormFieldStatus = 'default',
): Color {
  if (state === 'disabled') return resolveBgColor(style.inputBorder, 'disabled')
  const statusColor = resolveFormFieldStatusBorder(style, status)
  if (!statusColor) return resolveBgColor(style.inputBorder, state)
  if (state === 'focused') return blendColor(statusColor, style.focusedBorder, 0.38)
  return statusColor
}

export function paintFormFieldShell(
  context: PaintContext,
  offset: Offset,
  width: number,
  fieldHeight: number,
  opts: {
    focused?: boolean
    hovered?: boolean
    disabled?: boolean
    status?: FormFieldStatus
    helperText?: string
  },
): FormFieldShellMetrics {
  const dl = new DrawList(context)
  return _paintFormFieldShell(dl, context, offset, width, fieldHeight, opts)
}

function _paintFormFieldShell(
  dl: DrawList,
  context: PaintContext,
  offset: Offset,
  width: number,
  fieldHeight: number,
  opts: {
    focused?: boolean
    hovered?: boolean
    disabled?: boolean
    status?: FormFieldStatus
    helperText?: string
  },
): FormFieldShellMetrics {
  const s = deriveTextInputStyle(context.theme)
  const state = resolveFormFieldState(opts)
  const borderColor = resolveFormFieldBorderColor(s, state, opts.status ?? 'default')
  const helperHeight = measureFormFieldHelperHeight(s, opts.helperText)

  dl.fillRect(offset.x, offset.y, width, fieldHeight, resolveBgColor(s.inputBg, state), s.borderRadius)
  dl.strokeRect(
    offset.x,
    offset.y,
    width,
    fieldHeight,
    borderColor,
    state === 'focused' ? 1.5 : Math.max(1, s.borderWidth),
    s.borderRadius,
  )

  let helperTextY: number | null = null
  if (opts.helperText) {
    helperTextY = offset.y + fieldHeight + s.helperGap + s.helperLineHeight / 2
    dl.fillText(
      opts.helperText,
      offset.x + 1,
      helperTextY,
      resolveFormFieldHelperColor(s, opts.status ?? 'default', opts.disabled ?? false),
      s.helperFontSize,
      s.fontFamily,
      'left',
      'middle',
    )
  }

  return {
    fieldHeight,
    totalHeight: fieldHeight + helperHeight,
    contentX: offset.x + s.padding,
    contentY: offset.y + s.padding,
    contentWidth: width - s.padding * 2,
    contentHeight: fieldHeight - s.padding * 2,
    helperTextY,
  }
}

export function layoutFormFieldInlineContent(
  style: TextInputStyleTokens,
  offset: Offset,
  width: number,
  fieldHeight: number,
  opts?: {
    leadingText?: string
    leadingIcon?: IconName
    reserveLeadingWidth?: number
    prefixText?: string
    suffixText?: string
    showClearButton?: boolean
    reserveTrailingWidth?: number
  },
): FormFieldInlineLayout {
  const gap = Math.max(4, Math.round(style.itemSpacing * 0.75))
  const centerY = offset.y + fieldHeight / 2
  const textY = centerY
  const clearSize = Math.max(style.fontSize, fieldHeight - style.padding * 2)
  const trailingWidth = Math.max(0, opts?.reserveTrailingWidth ?? 0)

  let right = offset.x + width - style.padding
  let trailingRect: FormFieldRect | null = null
  if (trailingWidth > 0) {
    trailingRect = {
      x: right - trailingWidth,
      y: offset.y + (fieldHeight - clearSize) / 2,
      w: trailingWidth,
      h: clearSize,
    }
    right = trailingRect.x - gap
  }

  let clearRect: FormFieldRect | null = null
  if (opts?.showClearButton) {
    clearRect = {
      x: right - clearSize,
      y: offset.y + (fieldHeight - clearSize) / 2,
      w: clearSize,
      h: clearSize,
    }
    right = clearRect.x - gap
  }

  let suffixRect: FormFieldRect | null = null
  if (opts?.suffixText) {
    const suffixWidth = TextMeasurer.measureWidth(opts.suffixText, style.fontSize, style.fontFamily)
    suffixRect = {
      x: right - suffixWidth,
      y: textY - style.lineHeight / 2,
      w: suffixWidth,
      h: style.lineHeight,
    }
    right = suffixRect.x - gap
  }

  let left = offset.x + style.padding

  let leadingTextRect: FormFieldRect | null = null
  if (opts?.leadingText || opts?.leadingIcon) {
    const leadingWidth = opts.leadingIcon
      ? style.fontSize
      : TextMeasurer.measureWidth(opts.leadingText!, style.fontSize, style.fontFamily)
    leadingTextRect = {
      x: left,
      y: textY - style.lineHeight / 2,
      w: leadingWidth,
      h: style.lineHeight,
    }
    left = leadingTextRect.x + leadingTextRect.w + gap
  }

  let leadingRect: FormFieldRect | null = null
  const leadingWidth = Math.max(0, opts?.reserveLeadingWidth ?? 0)
  if (leadingWidth > 0) {
    leadingRect = {
      x: left,
      y: offset.y + style.padding,
      w: leadingWidth,
      h: Math.max(0, fieldHeight - style.padding * 2),
    }
    left = leadingRect.x + leadingRect.w + gap
  }

  let prefixRect: FormFieldRect | null = null
  if (opts?.prefixText) {
    const prefixWidth = TextMeasurer.measureWidth(opts.prefixText, style.fontSize, style.fontFamily)
    prefixRect = {
      x: left,
      y: textY - style.lineHeight / 2,
      w: prefixWidth,
      h: style.lineHeight,
    }
    left = prefixRect.x + prefixRect.w + gap
  }

  return {
    valueRect: {
      x: left,
      y: offset.y + style.padding,
      w: Math.max(0, right - left),
      h: Math.max(0, fieldHeight - style.padding * 2),
    },
    leadingTextRect,
    leadingRect,
    prefixRect,
    suffixRect,
    clearRect,
    trailingRect,
  }
}

export function paintFormFieldInlineDecorations(
  context: PaintContext,
  layout: FormFieldInlineLayout,
  opts?: {
    leadingText?: string
    leadingIcon?: IconName
    prefixText?: string
    suffixText?: string
    showClearButton?: boolean
    clearButtonText?: string
    trailingIcon?: IconName
    trailingIconColor?: Color
    disabled?: boolean
  },
): void {
  const dl = new DrawList(context)
  const style = deriveTextInputStyle(context.theme)
  const color = resolveFormFieldDecorationColor(style, opts?.disabled ?? false)

  if (opts?.leadingIcon && layout.leadingTextRect) {
    const iconSize = Math.min(style.fontSize, layout.leadingTextRect.w, layout.leadingTextRect.h)
    paintIconGlyph(context, {
      name: opts.leadingIcon,
      x: layout.leadingTextRect.x + (layout.leadingTextRect.w - iconSize) / 2,
      y: layout.leadingTextRect.y + (layout.leadingTextRect.h - iconSize) / 2,
      size: iconSize,
      color,
    })
  } else if (opts?.leadingText && layout.leadingTextRect) {
    dl.fillText(
      opts.leadingText,
      layout.leadingTextRect.x,
      layout.leadingTextRect.y + layout.leadingTextRect.h / 2,
      color,
      style.fontSize,
      style.fontFamily,
      'left',
      'middle',
    )
  }
  if (opts?.prefixText && layout.prefixRect) {
    dl.fillText(
      opts.prefixText,
      layout.prefixRect.x,
      layout.prefixRect.y + layout.prefixRect.h / 2,
      color,
      style.fontSize,
      style.fontFamily,
      'left',
      'middle',
    )
  }
  if (opts?.suffixText && layout.suffixRect) {
    dl.fillText(
      opts.suffixText,
      layout.suffixRect.x,
      layout.suffixRect.y + layout.suffixRect.h / 2,
      color,
      style.fontSize,
      style.fontFamily,
      'left',
      'middle',
    )
  }
  if (opts?.showClearButton && layout.clearRect) {
    if (opts.clearButtonText) {
      dl.fillText(
        opts.clearButtonText,
        layout.clearRect.x + layout.clearRect.w / 2,
        layout.clearRect.y + layout.clearRect.h / 2,
        color,
        style.fontSize,
        style.fontFamily,
        'center',
        'middle',
      )
    } else {
      const iconSize = Math.min(style.fontSize, layout.clearRect.w, layout.clearRect.h)
      paintIconGlyph(context, {
        name: 'close',
        x: layout.clearRect.x + (layout.clearRect.w - iconSize) / 2,
        y: layout.clearRect.y + (layout.clearRect.h - iconSize) / 2,
        size: iconSize,
        color,
      })
    }
  }
  if (opts?.trailingIcon && layout.trailingRect) {
    const iconSize = Math.min(style.fontSize, layout.trailingRect.w, layout.trailingRect.h)
    paintIconGlyph(context, {
      name: opts.trailingIcon,
      x: layout.trailingRect.x + (layout.trailingRect.w - iconSize) / 2,
      y: layout.trailingRect.y + (layout.trailingRect.h - iconSize) / 2,
      size: iconSize,
      color: opts.trailingIconColor ?? color,
    })
  }
}

export function pointInFormFieldRect(rect: FormFieldRect | null, point: Offset): boolean {
  if (!rect) return false
  return point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
}

function resolveFormFieldStatusBorder(
  style: TextInputStyleTokens,
  status: FormFieldStatus,
): Color | null {
  switch (status) {
    case 'success': return style.successBorder
    case 'warning': return style.warningBorder
    case 'error': return style.errorBorder
    default: return null
  }
}
