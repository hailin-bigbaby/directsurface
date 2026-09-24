import type { Offset } from '../core/render_object'
import type { PaintContext } from '../rendering/paint_context'
import { deriveTextInputStyle } from '../theme/component_styles'
import type { Color } from '../theme/theme'
import type { IconName } from './icon'
import {
  layoutFormFieldInlineContent,
  paintFormFieldInlineDecorations,
  paintFormFieldShell,
  type FormFieldInlineLayout,
  type FormFieldStatus,
} from './form_field_shell'

export interface TriggerFieldShellLayout extends FormFieldInlineLayout {
  fieldHeight: number
  totalHeight: number
}

export function paintTriggerFieldShell(
  context: PaintContext,
  offset: Offset,
  width: number,
  opts: {
    focused?: boolean
    hovered?: boolean
    disabled?: boolean
    status?: FormFieldStatus
    helperText?: string
    leadingText?: string
    leadingIcon?: IconName
    prefixText?: string
    suffixText?: string
    showClearButton?: boolean
    reserveTrailingWidth?: number
    trailingIcon?: IconName
    trailingIconColor?: Color
    fieldHeight?: number
  },
): TriggerFieldShellLayout {
  const style = deriveTextInputStyle(context.theme)
  const fieldHeight = opts.fieldHeight ?? style.height
  const shell = paintFormFieldShell(context, offset, width, fieldHeight, {
    focused: opts.focused,
    hovered: opts.hovered,
    disabled: opts.disabled,
    status: opts.status,
    helperText: opts.helperText,
  })
  const layout = layoutFormFieldInlineContent(style, offset, width, fieldHeight, {
    leadingText: opts.leadingText,
    leadingIcon: opts.leadingIcon,
    prefixText: opts.prefixText,
    suffixText: opts.suffixText,
    showClearButton: opts.showClearButton,
    reserveTrailingWidth: opts.reserveTrailingWidth,
  })
  paintFormFieldInlineDecorations(context, layout, {
    leadingText: opts.leadingText,
    leadingIcon: opts.leadingIcon,
    prefixText: opts.prefixText,
    suffixText: opts.suffixText,
    showClearButton: opts.showClearButton,
    trailingIcon: opts.trailingIcon,
    trailingIconColor: opts.trailingIconColor,
    disabled: opts.disabled,
  })
  return {
    ...layout,
    fieldHeight: shell.fieldHeight,
    totalHeight: shell.totalHeight,
  }
}
