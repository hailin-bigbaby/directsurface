import type { RenderBoxOptions } from '../layout/render_box'
import type { FormFieldStatus } from './form_field_shell'
import type { IconName } from './icon'
import { RenderTextBox, type TextBoxAction } from './text_field'

export interface ButtonEditButton {
  readonly key?: string
  readonly label?: string
  readonly icon?: IconName
  readonly tooltip?: string
  readonly disabled?: boolean
  readonly width?: number
  readonly onClick?: () => void
}

export interface RenderButtonEditOptions extends RenderBoxOptions {
  value?: string
  placeholder?: string
  buttons: readonly ButtonEditButton[]
  onChange?: (value: string) => void
  onSubmit?: (value: string) => void
  onBlur?: (value: string) => void
  onKeyDown?: (event: KeyboardEvent) => boolean | void
  readonly?: boolean
  disabled?: boolean
  status?: FormFieldStatus
  helperText?: string
  prefixText?: string
  suffixText?: string
  clearable?: boolean
  maxLength?: number
  fieldHeight?: number
}

export class RenderButtonEdit extends RenderTextBox {
  static override debugTypeName = 'RenderButtonEdit'

  constructor(options: RenderButtonEditOptions) {
    super({
      ...options,
      actions: options.buttons,
    })
  }

  get buttons(): readonly ButtonEditButton[] {
    return this.actions
  }

  set buttons(buttons: readonly ButtonEditButton[]) {
    this.actions = buttons as readonly TextBoxAction[]
  }
}
