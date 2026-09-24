import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import type { BoxConstraints, LayoutContext, Offset, Rect } from '../core/render_object'
import { RenderObject } from '../core/render_object'
import { runCleanupSteps, type DisposeFn } from '../core/disposable'
import { TextMeasurer } from '../core/text_measurer'
import type { PointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import {
  deriveSegmentedControlStyle,
  resolveBgColor,
  resolveTextColor,
  type SegmentedControlStyleTokens,
} from '../theme/component_styles'
import { FocusableControl, paintFocusRing } from './focusable_control'
import {
  ValueEditorEventEmitter,
  type ValueEditor,
  type ValueEditorValueChangeListener,
} from './value_editor'

export interface SegmentedControlOption {
  value: string
  label: string
  disabled?: boolean
}

interface SegmentLayout {
  option: SegmentedControlOption
  rect: Rect
}

export type SegmentedControlValueChangeReason = 'selection' | 'options-reconcile'

export class RenderSegmentedControl extends FocusableControl implements
  InteractiveRenderObject,
  ValueEditor<string, SegmentedControlValueChangeReason, undefined> {
  static override debugTypeName = 'RenderSegmentedControl'
  options: SegmentedControlOption[]
  onChange?: (value: string) => void

  private _value: string
  private _disabled: boolean
  private _hoveredValue = ''
  private _pressedValue = ''
  private _focusedValue = ''
  private _segments: SegmentLayout[] = []
  private readonly _valueEditorEvents = new ValueEditorEventEmitter<
    string,
    SegmentedControlValueChangeReason,
    undefined
  >()

  constructor(options: {
    options: SegmentedControlOption[]
    value?: string
    disabled?: boolean
    onChange?: (value: string) => void
  }) {
    super({ disabled: options.disabled ?? false })
    this.options = options.options
    this._value = options.value ?? options.options.find(option => !option.disabled)?.value ?? ''
    this._disabled = options.disabled ?? false
    this._focusedValue = this._value || this._firstEnabledValue()
    this.onChange = options.onChange
  }

  get value(): string {
    return this._value
  }

  set value(value: string) {
    if (this._value === value) return
    this._value = value
    this._focusedValue = value || this._focusedValue
    this.markNeedsPaint()
  }

  get disabled(): boolean {
    return this._disabled
  }

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
    listener: ValueEditorValueChangeListener<string, SegmentedControlValueChangeReason, undefined>,
  ): DisposeFn {
    return this._valueEditorEvents.subscribeValueChange(listener)
  }

  subscribeBlur(listener: () => void): DisposeFn {
    return this._valueEditorEvents.subscribeBlur(listener)
  }

  setOptions(options: SegmentedControlOption[], value = this._value): void {
    const previousValue = this._value
    this.options = options
    this._value = options.some(option => option.value === value) ? value : this._firstEnabledValue()
    this._focusedValue = this._value || this._firstEnabledValue()
    this.markNeedsLayout()
    if (this._value !== previousValue) {
      this._valueEditorEvents.emitValueChange({
        value: this._value,
        previousValue,
        reason: 'options-reconcile',
        userInitiated: false,
      })
    }
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = deriveSegmentedControlStyle(context.theme)
    const naturalWidth = this._measureSegments(style).reduce((sum, segment) => sum + segment.rect.width, 0)
    const width = Math.max(
      constraints.minWidth,
      Math.min(constraints.maxWidth, constraints.maxWidth === Infinity ? naturalWidth : naturalWidth),
    )
    this.size = {
      width,
      height: Math.max(constraints.minHeight, Math.min(constraints.maxHeight, style.height)),
    }
    this._segments = this._layoutSegments(style, this.size.width, this.size.height)
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const style = deriveSegmentedControlStyle(context.theme)
    const dl = new DrawList(context)
    const radius = Math.min(style.borderRadius, this.size.height / 2)
    dl.fillRect(offset.x, offset.y, this.size.width, this.size.height, style.containerBg, radius)
    if (style.borderWidth > 0) {
      dl.strokeRect(offset.x, offset.y, this.size.width, this.size.height, style.containerBorder, style.borderWidth, radius)
    }

    for (let index = 0; index < this._segments.length; index += 1) {
      const segment = this._segments[index]!
      const rect = segment.rect
      const x = offset.x + rect.x
      const y = offset.y + rect.y
      const isDisabled = this.isDisabled || !!segment.option.disabled
      const isSelected = segment.option.value === this._value
      const isHovered = segment.option.value === this._hoveredValue
      const isPressed = segment.option.value === this._pressedValue
      const state = {
        disabled: isDisabled,
        selected: isSelected,
        pressed: isPressed,
        hovered: isHovered,
        focused: this.isFocused && segment.option.value === this._focusValue(),
      }
      const bg = resolveBgColor(style.segmentBg, state)
      if (bg.a > 0) {
        dl.fillRect(x + 1, y + 1, Math.max(0, rect.width - 2), Math.max(0, rect.height - 2), bg, this._segmentRadius(index, radius))
      }
      if (index > 0 && !isSelected && this._segments[index - 1]?.option.value !== this._value) {
        dl.line(x, y + 4, x, y + rect.height - 4, style.separator, 1)
      }
      if (this.isFocused && segment.option.value === this._focusValue() && !isDisabled) {
        paintFocusRing(dl, style.focusedBorder, x + 1, y + 1, Math.max(0, rect.width - 2), Math.max(0, rect.height - 2), this._segmentRadius(index, radius))
      }
      dl.fillText(
        segment.option.label,
        x + rect.width / 2,
        y + rect.height / 2,
        resolveTextColor(style.segmentText, state),
        style.fontSize,
        style.fontFamily,
        'center',
        'middle',
      )
    }
  }

  onPointerDown(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (this.isDisabled || !this.hitTest(event.position)) return
    this.requestFocus()
    const option = this._optionAt(event.position)
    if (!option || option.disabled) return
    this._pressedValue = option.value
    this._focusedValue = option.value
    this.markNeedsPaint()
  }

  onPointerMove(event: PointerEvent): void {
    if (this.isDisabled) return
    const option = this._optionAt(event.position)
    const next = option && !option.disabled ? option.value : ''
    if (next === this._hoveredValue) return
    this._hoveredValue = next
    this.markNeedsPaint()
  }

  onPointerUp(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (this.isDisabled) return
    const pressed = this._pressedValue
    this._pressedValue = ''
    const option = this._optionAt(event.position)
    if (option && !option.disabled && option.value === pressed) {
      this._select(option.value)
      return
    }
    if (pressed) this.markNeedsPaint()
  }

  onPointerCancel(_event: PointerEvent): void {
    if (!this._pressedValue && !this._hoveredValue) return
    this._pressedValue = ''
    this._hoveredValue = ''
    this.markNeedsPaint()
  }

  onPointerLeave(_event: PointerEvent): void {
    if (!this._hoveredValue) return
    this._hoveredValue = ''
    this.markNeedsPaint()
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.isDisabled) return false
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        this._moveSelection(-1)
        return true
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        this._moveSelection(1)
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

  protected override onFocusChanged(focused: boolean): void {
    if (focused && !this._focusedValue) {
      this._focusedValue = this._value || this._firstEnabledValue()
    }
    if (!focused) this._valueEditorEvents.emitBlur()
  }

  protected override onDisabledStateChanged(disabled: boolean): void {
    if (!disabled) return
    this._hoveredValue = ''
    this._pressedValue = ''
  }

  debugState(): {
    value: string
    hoveredValue: string
    pressedValue: string
    segmentRects: Rect[]
  } {
    return {
      value: this._value,
      hoveredValue: this._hoveredValue,
      pressedValue: this._pressedValue,
      segmentRects: this._segments.map(segment => ({ ...segment.rect })),
    }
  }

  private _measureSegments(style: SegmentedControlStyleTokens): SegmentLayout[] {
    return this.options.map(option => {
      const labelWidth = TextMeasurer.measureWidth(option.label, style.fontSize, style.fontFamily)
      return {
        option,
        rect: {
          x: 0,
          y: 0,
          width: Math.ceil(labelWidth + style.paddingX * 2),
          height: style.height,
        },
      }
    })
  }

  private _layoutSegments(style: SegmentedControlStyleTokens, width: number, height: number): SegmentLayout[] {
    const measured = this._measureSegments(style)
    if (measured.length === 0) return []
    const naturalWidth = measured.reduce((sum, segment) => sum + segment.rect.width, 0)
    const extraPerSegment = Math.max(0, (width - naturalWidth) / measured.length)
    let x = 0
    return measured.map((segment, index) => {
      const isLast = index === measured.length - 1
      const segmentWidth = isLast ? Math.max(0, width - x) : segment.rect.width + extraPerSegment
      const rect = { x, y: 0, width: segmentWidth, height }
      x += segmentWidth
      return { option: segment.option, rect }
    })
  }

  private _segmentRadius(index: number, radius: number): number {
    return index === 0 || index === this._segments.length - 1 ? radius : 0
  }

  private _optionAt(position: Offset): SegmentedControlOption | null {
    const g = this.globalOffset
    for (const segment of this._segments) {
      const rect = segment.rect
      if (
        position.x >= g.x + rect.x &&
        position.x <= g.x + rect.x + rect.width &&
        position.y >= g.y + rect.y &&
        position.y <= g.y + rect.y + rect.height
      ) {
        return segment.option
      }
    }
    return null
  }

  private _select(value: string): void {
    if (!value || this._isDisabledValue(value)) return
    this._focusedValue = value
    if (this._value === value) {
      this.markNeedsPaint()
      return
    }
    const previousValue = this._value
    this._value = value
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

  private _moveSelection(delta: 1 | -1): void {
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
    return [...this.options].reverse().find(option => !option.disabled)?.value ?? ''
  }

  private _isDisabledValue(value: string): boolean {
    const option = this.options.find(option => option.value === value)
    return option ? option.disabled === true : true
  }

  dispose(): void {
    runCleanupSteps([
      () => this._valueEditorEvents.dispose(),
      () => super.dispose(),
      () => { this.onChange = undefined },
    ])
  }
}
