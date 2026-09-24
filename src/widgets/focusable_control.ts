import { FocusManager, type Focusable } from '../core/focus_manager'
import { runCleanupSteps } from '../core/disposable'
import { InteractiveStateController } from '../core/interactive_state_controller'
import { RenderBox, type RenderBoxOptions } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { Color } from '../theme/theme'

export interface ControlInteractionSnapshot {
  hovered: boolean
  pressed: boolean
  focused: boolean
  disabled: boolean
}

export abstract class FocusableControl extends RenderBox implements Focusable {
  static override debugTypeName = 'FocusableControl'
  protected readonly _interaction: InteractiveStateController
  private _focusRegistered = false

  protected constructor(opts?: RenderBoxOptions & { disabled?: boolean }) {
    super(opts)
    this._interaction = new InteractiveStateController({ disabled: opts?.disabled ?? false })
    this._syncFocusRegistration()
  }

  get isFocused(): boolean {
    return this._interaction.isFocused
  }

  protected get isDisabled(): boolean {
    return this._interaction.isDisabled
  }

  focusIn(): void {
    if (this._interaction.isDisabled) return
    if (!this._interaction.focus()) return
    runCleanupSteps([
      () => this.onFocusChanged(true),
      () => this.markNeedsPaint(),
    ])
  }

  focusOut(): void {
    if (!this._interaction.blur()) return
    runCleanupSteps([
      () => this.onFocusChanged(false),
      () => this.markNeedsPaint(),
    ])
  }

  requestFocus(): boolean {
    if (this._interaction.isDisabled) return false
    if (typeof window === 'undefined') return false
    FocusManager.instance.setFocus(this)
    return this.isFocused
  }

  blur(): void {
    if (typeof window === 'undefined') {
      this.focusOut()
      return
    }
    FocusManager.instance.clearFocusOf(this)
  }

  protected setDisabledState(disabled: boolean): boolean {
    const previous: ControlInteractionSnapshot = {
      hovered: this._interaction.isHovered,
      pressed: this._interaction.isPressed,
      focused: this._interaction.isFocused,
      disabled: this._interaction.isDisabled,
    }
    if (previous.disabled === disabled) return false

    runCleanupSteps([
      () => {
        if (disabled && previous.focused) this.focusOut()
      },
      () => {
        if (disabled) this._interaction.disable()
        else this._interaction.enable()
      },
      () => this._syncFocusRegistration(),
      () => this.onDisabledStateChanged(disabled, previous),
      () => this.markNeedsPaint(),
    ])
    return true
  }

  protected onFocusChanged(_focused: boolean): void {}

  protected onDisabledStateChanged(_disabled: boolean, _previous: ControlInteractionSnapshot): void {}

  protected override onVisibilityChanged(visible: boolean): void {
    runCleanupSteps([
      () => {
        if (!visible && this.isFocused) this.focusOut()
      },
      () => this._syncFocusRegistration(),
    ])
  }

  private _syncFocusRegistration(): void {
    if (typeof window === 'undefined') return
    if (this._interaction.isDisabled || !this.visible) {
      if (this._focusRegistered) {
        FocusManager.instance.unregister(this)
        this._focusRegistered = false
      }
      return
    }
    if (!this._focusRegistered) {
      FocusManager.instance.register(this)
      this._focusRegistered = true
    }
  }

  override dispose(): void {
    runCleanupSteps([
      () => {
        if (this.isFocused) this.focusOut()
      },
      () => {
        if (this._focusRegistered && typeof window !== 'undefined') {
          FocusManager.instance.unregister(this)
          this._focusRegistered = false
        }
      },
      () => super.dispose(),
    ])
  }
}

export function paintFocusRing(
  dl: DrawList,
  color: Color,
  x: number,
  y: number,
  width: number,
  height: number,
  borderRadius: number,
): void {
  if (width <= 2 || height <= 2) return
  const ringColor: Color = { ...color, a: Math.min(0.84, Math.max(0.4, color.a * 0.76)) }
  dl.strokeRectDashed(
    x + 1.5,
    y + 1.5,
    width - 3,
    height - 3,
    ringColor,
    1,
    Math.max(0, borderRadius - 1),
    [4, 3],
  )
}
