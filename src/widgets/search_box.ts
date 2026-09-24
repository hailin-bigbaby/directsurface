import type { FormFieldStatus } from './form_field_shell'
import { RenderTextBox } from './text_field'

export class RenderSearchBox extends RenderTextBox {
  static override debugTypeName = 'RenderSearchBox'
  onSearch?: (value: string) => void

  constructor(options: {
    value: string
    placeholder?: string
    onChange?: (value: string) => void
    onSearch?: (value: string) => void
    onKeyDown?: (event: KeyboardEvent) => boolean | void
    readonly?: boolean
    disabled?: boolean
    status?: FormFieldStatus
    helperText?: string
    clearable?: boolean
    maxLength?: number
  }) {
    super({
      value: options.value,
      placeholder: options.placeholder ?? '搜索...',
      onChange: options.onChange,
      onSubmit: value => options.onSearch?.(value),
      onKeyDown: options.onKeyDown,
      readonly: options.readonly,
      disabled: options.disabled,
      status: options.status,
      helperText: options.helperText,
      clearable: options.clearable ?? true,
      maxLength: options.maxLength,
      trailingIcon: 'search',
    })
    this.onSearch = options.onSearch
    this.onTrailingIconClick = () => this.search()
  }

  protected override shouldBlurOnSubmit(): boolean {
    return false
  }

  search(): void {
    this.onSearch?.(this.value)
  }
}
