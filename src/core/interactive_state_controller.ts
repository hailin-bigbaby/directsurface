export type InteractiveVisualState =
  | 'normal'
  | 'hovered'
  | 'pressed'
  | 'focused'
  | 'disabled'

export class InteractiveStateController {
  private _hovered: boolean
  private _pressed: boolean
  private _focused: boolean
  private _disabled: boolean

  constructor(opts?: {
    hovered?: boolean
    pressed?: boolean
    focused?: boolean
    disabled?: boolean
  }) {
    this._disabled = opts?.disabled ?? false
    this._hovered = this._disabled ? false : opts?.hovered ?? false
    this._pressed = this._disabled ? false : opts?.pressed ?? false
    this._focused = this._disabled ? false : opts?.focused ?? false
  }

  get state(): InteractiveVisualState {
    if (this._disabled) return 'disabled'
    if (this._pressed) return 'pressed'
    if (this._focused) return 'focused'
    if (this._hovered) return 'hovered'
    return 'normal'
  }

  get isHovered(): boolean { return this._hovered }
  get isPressed(): boolean { return this._pressed }
  get isFocused(): boolean { return this._focused }
  get isDisabled(): boolean { return this._disabled }

  enterHover(): boolean {
    if (this._disabled || this._hovered) return false
    this._hovered = true
    return true
  }

  leaveHover(): boolean {
    if (!this._hovered) return false
    this._hovered = false
    return true
  }

  press(): boolean {
    if (this._disabled || this._pressed) return false
    this._pressed = true
    return true
  }

  release(): boolean {
    if (!this._pressed) return false
    this._pressed = false
    return true
  }

  focus(): boolean {
    if (this._disabled || this._focused) return false
    this._focused = true
    return true
  }

  blur(): boolean {
    if (!this._focused) return false
    this._focused = false
    return true
  }

  disable(): boolean {
    if (this._disabled) return false
    this._disabled = true
    this._hovered = false
    this._pressed = false
    this._focused = false
    return true
  }

  enable(): boolean {
    if (!this._disabled) return false
    this._disabled = false
    return true
  }
}
