import type { FormFieldStatus } from './form_field_shell'
import type { RenderBoxOptions } from '../layout/render_box'
import { RenderTextBox } from './text_field'

export class RenderPasswordField extends RenderTextBox {
  static override debugTypeName = 'RenderPasswordField'
  private _revealed: boolean
  onRevealChange?: (revealed: boolean) => void

  constructor(options: RenderBoxOptions & {
    value: string
    placeholder?: string
    onChange?: (value: string) => void
    onSubmit?: (value: string) => void
    onBlur?: (value: string) => void
    readonly?: boolean
    disabled?: boolean
    status?: FormFieldStatus
    helperText?: string
    prefixText?: string
    suffixText?: string
    clearable?: boolean
    maxLength?: number
    revealed?: boolean
    onRevealChange?: (revealed: boolean) => void
    fieldHeight?: number
  }) {
    super({
      ...options,
      value: options.value,
      placeholder: options.placeholder,
      onChange: options.onChange,
      onSubmit: options.onSubmit,
      onBlur: options.onBlur,
      password: !(options.revealed ?? false),
      readonly: options.readonly,
      disabled: options.disabled,
      status: options.status,
      helperText: options.helperText,
      prefixText: options.prefixText,
      suffixText: options.suffixText,
      clearable: options.clearable,
      maxLength: options.maxLength,
      fieldHeight: options.fieldHeight,
    })
    this._revealed = options.revealed ?? false
    this.onRevealChange = options.onRevealChange
    this.onTrailingIconClick = () => this.toggleReveal()
    this._syncRevealState()
  }

  get revealed(): boolean {
    return this._revealed
  }

  set revealed(revealed: boolean) {
    if (this._revealed === revealed) return
    this._revealed = revealed
    this._syncRevealState()
    this.onRevealChange?.(revealed)
  }

  showPassword(): void {
    this.revealed = true
  }

  hidePassword(): void {
    this.revealed = false
  }

  toggleReveal(): void {
    this.revealed = !this.revealed
  }

  private _syncRevealState(): void {
    this.password = !this._revealed
    this.trailingIcon = this._revealed ? 'eye-off' : 'eye'
  }
}
