// RadioGroup: 单选按钮组
// 支持水平/垂直排列、键盘导航和统一焦点语义

import { DrawList } from '../rendering/draw_list'
import { paintSingleLineText } from '../rendering/text_painter'
import { AnimationController } from '../animation/animation_controller'
import { Curves } from '../animation/curves'
import type { PaintContext } from '../rendering/paint_context'
import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import { RenderObject } from '../core/render_object'
import { runCleanupSteps, type DisposeFn } from '../core/disposable'
import { TextMeasurer } from '../core/text_measurer'
import type { PointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import {
  deriveRadioGroupStyle,
  resolveBgColor,
  resolveTextColor,
} from '../theme/component_styles'
import { FocusableControl, paintFocusRing } from './focusable_control'
import {
  ValueEditorEventEmitter,
  type ValueEditor,
  type ValueEditorValueChangeListener,
} from './value_editor'

export interface RadioOption {
  value: string
  label: string
  disabled?: boolean
}

export type RadioGroupValueChangeReason = 'selection'

export class RenderRadioGroup extends FocusableControl implements
  InteractiveRenderObject,
  ValueEditor<string, RadioGroupValueChangeReason, undefined> {
  static override debugTypeName = 'RenderRadioGroup'
  private _options: RadioOption[]
  private _value: string
  private _disabled: boolean
  private _focusedValue = ''
  direction: 'horizontal' | 'vertical'
  onChange?: (value: string) => void

  private _hoveredValue = ''
  private _anims = new Map<string, AnimationController>()
  private readonly _valueEditorEvents = new ValueEditorEventEmitter<
    string,
    RadioGroupValueChangeReason,
    undefined
  >()

  constructor(opts: {
    options: RadioOption[]
    value?: string
    disabled?: boolean
    direction?: 'horizontal' | 'vertical'
    onChange?: (value: string) => void
  }) {
    super({ disabled: opts.disabled ?? false })
    this._options = opts.options
    this._value = opts.value ?? ''
    this._disabled = opts.disabled ?? false
    this.direction = opts.direction ?? 'horizontal'
    this.onChange = opts.onChange
    this._focusedValue = this._value || this._firstEnabledValue()
    this._resetOptionAnimations()
  }

  get options(): RadioOption[] { return this._options }
  set options(options: RadioOption[]) {
    if (this._options === options) return
    this._options = options
    if (!this._options.some(option => !option.disabled && option.value === this._focusedValue)) {
      this._focusedValue = this._options.some(option => option.value === this._value)
        ? this._value
        : this._firstEnabledValue()
    }
    this._resetOptionAnimations()
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  get disabled(): boolean { return this._disabled }
  set disabled(value: boolean) {
    if (this._disabled === value) return
    this._disabled = value
    this.setDisabledState(value)
  }

  getValue(): string {
    return this.value
  }

  setValue(value: string): void {
    this.value = value
  }

  subscribeValueChange(
    listener: ValueEditorValueChangeListener<string, RadioGroupValueChangeReason, undefined>,
  ): DisposeFn {
    return this._valueEditorEvents.subscribeValueChange(listener)
  }

  subscribeBlur(listener: () => void): DisposeFn {
    return this._valueEditorEvents.subscribeBlur(listener)
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  private get _itemH(): number {
    return deriveRadioGroupStyle(this.currentTheme).itemHeight
  }

  private get _radioR(): number {
    return deriveRadioGroupStyle(this.currentTheme).radioRadius
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const s = deriveRadioGroupStyle(context.theme)
    const itemH = this._itemH
    const n = this.options.length

    if (this.direction === 'horizontal') {
      let totalW = 0
      for (const opt of this.options) {
        const textW = this._measureLabel(opt.label)
        totalW += this._radioR * 2 + s.padding + textW + s.itemSpacing * 3
      }
      this.size = {
        width: Math.min(totalW, constraints.maxWidth === Infinity ? totalW : constraints.maxWidth),
        height: itemH,
      }
    } else {
      const maxW = constraints.maxWidth === Infinity ? 200 : constraints.maxWidth
      this.size = { width: maxW, height: itemH * n }
    }
  }

  private _measureLabel(label: string): number {
    const s = deriveRadioGroupStyle(this.currentTheme)
    return TextMeasurer.measureWidth(label, s.fontSize, s.fontFamily)
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const s = deriveRadioGroupStyle(context.theme)
    const dl = new DrawList(context)
    const { x, y } = offset
    const itemH = this._itemH
    const r = this._radioR
    const focusValue = this._focusValue()

    let curX = x
    let curY = y

    for (const opt of this.options) {
      const isSelected = opt.value === this.value
      const isHovered = opt.value === this._hoveredValue
      const isDisabled = this.isDisabled || !!opt.disabled
      const isFocusedOption = this.isFocused && opt.value === focusValue && !isDisabled
      const animT = this._anims.get(opt.value)?.value ?? (isSelected ? 1 : 0)
      const state = {
        disabled: isDisabled,
        selected: isSelected,
        hovered: isHovered,
        focused: isFocusedOption,
      }

      const cx = curX + r
      const cy = curY + itemH / 2
      const textW = this._measureLabel(opt.label)
      const itemW = r * 2 + s.padding + textW + s.itemSpacing * 3

      dl.fillCircle(cx, cy, r, resolveBgColor(s.controlBg, state))
      dl.strokeCircle(cx, cy, r, resolveBgColor(s.controlBorder, state), isSelected ? 1.5 : 1)
      if (isFocusedOption) {
        paintFocusRing(dl, context.theme.focusBorder, curX, curY, itemW, itemH, itemH / 2)
      }
      if (animT > 0) {
        const innerR = r * 0.5 * animT
        dl.fillCircle(cx, cy, innerR, resolveBgColor(s.dotBg, {
          disabled: isDisabled,
          selected: true,
          hovered: isHovered,
        }))
      }

      const textX = curX + r * 2 + s.padding
      paintSingleLineText(dl, {
        text: opt.label,
        x: textX,
        y: cy,
        maxWidth: Math.max(0, x + this.size.width - textX),
        color: resolveTextColor(s.labelText, state),
        fontSize: s.fontSize,
        fontFamily: s.fontFamily,
      })

      if (this.direction === 'horizontal') {
        curX += itemW
      } else {
        curY += itemH
      }
    }
  }

  private _optionAt(p: Offset): RadioOption | null {
    const g = this.globalOffset
    const s = deriveRadioGroupStyle(this.currentTheme)
    const itemH = this._itemH
    const r = this._radioR

    let curX = g.x
    let curY = g.y

    for (const opt of this.options) {
      const textW = this._measureLabel(opt.label)
      const itemW = r * 2 + s.padding + textW + s.itemSpacing * 3

      const inItem = this.direction === 'horizontal'
        ? p.x >= curX && p.x <= curX + itemW && p.y >= curY && p.y <= curY + itemH
        : p.x >= g.x && p.x <= g.x + this.size.width && p.y >= curY && p.y <= curY + itemH

      if (inItem) return opt

      if (this.direction === 'horizontal') curX += itemW
      else curY += itemH
    }
    return null
  }

  private _select(value: string): void {
    if (!value || this.value === value) {
      this._focusedValue = value || this._focusedValue
      this.markNeedsPaint()
      return
    }
    const previousValue = this.value
    const oldAnim = this._anims.get(previousValue)
    oldAnim?.reverse()
    const newAnim = this._anims.get(value)
    newAnim?.forward()
    this._value = value
    this._focusedValue = value
    runCleanupSteps([
      () => this.onChange?.(value),
      () => this._valueEditorEvents.emitValueChange({
        value,
        previousValue,
        reason: 'selection',
      }),
    ])
    this.markNeedsPaint()
  }

  onPointerDown(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    if (this.isDisabled || !this.hitTest(e.position)) return
    this.requestFocus()
    const opt = this._optionAt(e.position)
    if (opt && !opt.disabled) this._select(opt.value)
  }

  onPointerMove(e: PointerEvent): void {
    if (this.isDisabled) return
    const opt = this._optionAt(e.position)
    const key = opt && !opt.disabled ? opt.value : ''
    if (key !== this._hoveredValue) {
      this._hoveredValue = key
      this.markNeedsPaint()
    }
  }

  get value(): string { return this._value }
  set value(value: string) {
    if (this._value === value) return
    const oldAnim = this._anims.get(this._value)
    oldAnim?.reverse()
    const newAnim = this._anims.get(value)
    newAnim?.forward()
    this._value = value
    this._focusedValue = value
    this.markNeedsPaint()
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.isDisabled) return false
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        this._moveFocus(-1)
        return true
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        this._moveFocus(1)
        return true
      case 'Home':
        event.preventDefault()
        this._select(this._firstEnabledValue())
        return true
      case 'End':
        event.preventDefault()
        this._select(this._lastEnabledValue())
        return true
      case 'Enter':
      case ' ':
        event.preventDefault()
        this._select(this._focusValue())
        return true
      default:
        return false
    }
  }

  onPointerUp(_e: PointerEvent): void {}

  onPointerCancel(_e: PointerEvent): void {
    this._hoveredValue = ''
    this.markNeedsPaint()
  }

  onPointerLeave(_e: PointerEvent): void {
    if (!this._hoveredValue) return
    this._hoveredValue = ''
    this.markNeedsPaint()
  }

  protected override onFocusChanged(focused: boolean): void {
    if (focused && !this._focusedValue) {
      this._focusedValue = this._value || this._firstEnabledValue()
    }
    if (!focused) this._valueEditorEvents.emitBlur()
  }

  protected override onDisabledStateChanged(disabled: boolean): void {
    if (!disabled) return
    this._hoveredValue = ''
  }

  private _moveFocus(delta: 1 | -1): void {
    const enabled = this.options.filter(option => !option.disabled)
    if (enabled.length === 0) return
    const current = this._focusValue()
    const currentIndex = enabled.findIndex(option => option.value === current)
    const nextIndex = currentIndex >= 0
      ? (currentIndex + delta + enabled.length) % enabled.length
      : 0
    this._select(enabled[nextIndex]!.value)
  }

  private _focusValue(): string {
    return this._focusedValue || this._value || this._firstEnabledValue()
  }

  private _firstEnabledValue(): string {
    return this.options.find(option => !option.disabled)?.value ?? ''
  }

  private _lastEnabledValue(): string {
    const reversed = [...this.options].reverse()
    return reversed.find(option => !option.disabled)?.value ?? ''
  }

  private _resetOptionAnimations(): void {
    for (const anim of this._anims.values()) anim.dispose()
    this._anims.clear()
    for (const opt of this._options) {
      const anim = new AnimationController({ duration: 150, curve: Curves.easeOut })
      anim.addListener(() => this.markNeedsPaint())
      if (opt.value === this.value) anim.resetValue(1)
      this._anims.set(opt.value, anim)
    }
  }

  dispose(): void {
    runCleanupSteps([
      ...[...this._anims.values()].map(anim => () => anim.dispose()),
      () => this._valueEditorEvents.dispose(),
      () => super.dispose(),
      () => { this.onChange = undefined },
    ])
  }
}
