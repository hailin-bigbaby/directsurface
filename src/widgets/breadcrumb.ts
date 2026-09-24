import { TextMeasurer } from '../core/text_measurer'
import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../core/render_object'
import type { PointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { deriveBreadcrumbStyle, resolveTextColor } from '../theme/component_styles'
import { paintIconGlyph } from './icon'
import { FocusableControl, paintFocusRing, type ControlInteractionSnapshot } from './focusable_control'

export interface BreadcrumbItem {
  key: string
  label: string
  disabled?: boolean
}

export class RenderBreadcrumb extends FocusableControl implements InteractiveRenderObject {
  static override debugTypeName = 'RenderBreadcrumb'
  items: BreadcrumbItem[]
  onNavigate?: (item: BreadcrumbItem, index: number) => void

  private _hoveredIndex = -1
  private _focusedIndex = -1

  constructor(options: {
    items: BreadcrumbItem[]
    disabled?: boolean
    onNavigate?: (item: BreadcrumbItem, index: number) => void
  }) {
    super({ disabled: options.disabled ?? false })
    this.items = options.items.slice()
    this.onNavigate = options.onNavigate
  }

  get disabled(): boolean { return this.isDisabled }
  set disabled(value: boolean) {
    this.setDisabledState(value)
  }

  protected override onFocusChanged(focused: boolean): void {
    if (!focused) return
    if (this._focusedIndex < 0) this._focusedIndex = this._firstInteractiveIndex()
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = deriveBreadcrumbStyle(context.theme)
    const width = this._itemRects(style, context.theme.fontFamily).at(-1)?.right ?? 0
    this.size = constrainSize(constraints, {
      width,
      height: style.height,
    })
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const style = deriveBreadcrumbStyle(context.theme)
    const dl = new DrawList(context)
    dl.pushClip(offset.x, offset.y, this.size.width, this.size.height)
    const rects = this._itemRects(style, context.theme.fontFamily)
    for (let index = 0; index < this.items.length; index += 1) {
      const item = this.items[index]!
      const rect = rects[index]!
      const isCurrent = index === this.items.length - 1
      const state = this.isDisabled || item.disabled
        ? 'disabled'
        : isCurrent
          ? 'selected'
          : this._hoveredIndex === index
            ? 'hovered'
          : this.isFocused && this._focusedIndex === index
              ? 'focused'
              : 'normal'
      if (this.isFocused && this._focusedIndex === index && !this.isDisabled && !item.disabled && !isCurrent) {
        paintFocusRing(dl, context.theme.focusBorder, offset.x + rect.x - 4, offset.y + 2, rect.width + 8, this.size.height - 4, style.focusRadius)
      }
      dl.fillText(
        item.label,
        offset.x + rect.x,
        offset.y + this.size.height / 2,
        resolveTextColor(style.itemText, state),
        style.fontSize,
        style.fontFamily,
        'left',
        'middle',
      )
      if (index < this.items.length - 1) {
        paintIconGlyph(context, {
          name: 'chevron-right',
          x: offset.x + rect.right + style.separatorGap - style.fontSize * 0.25,
          y: offset.y + (this.size.height - style.fontSize) / 2,
          size: style.fontSize,
          color: style.separatorColor,
          strokeWidth: Math.max(1.2, style.fontSize * 0.09),
        })
      }
    }
    dl.popClip()
  }

  onPointerDown(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (this.isDisabled) return
    if (!this.hitTest(event.position)) {
      return
    }
    this.requestFocus()
    const index = this._itemIndexAt(event.position.x)
    if (index < 0) return
    this._focusedIndex = index
    this._activate(index)
  }

  onPointerMove(event: PointerEvent): void {
    if (this.isDisabled) return
    if (!this.hitTest(event.position)) {
      if (this._hoveredIndex >= 0) {
        this._hoveredIndex = -1
        this.markNeedsPaint()
      }
      return
    }
    const index = this._itemIndexAt(event.position.x)
    if (index !== this._hoveredIndex) {
      this._hoveredIndex = index
      this.markNeedsPaint()
    }
  }

  onPointerUp(_event: PointerEvent): void {}
  onPointerCancel(_event: PointerEvent): void {
    if (this._hoveredIndex >= 0) {
      this._hoveredIndex = -1
      this.markNeedsPaint()
    }
  }
  onPointerLeave(_event: PointerEvent): void {
    if (this._hoveredIndex >= 0) {
      this._hoveredIndex = -1
      this.markNeedsPaint()
    }
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.isDisabled) return false
    if (this.items.length === 0) return false
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
        this._focusedIndex = this._firstInteractiveIndex()
        this.markNeedsPaint()
        return true
      case 'End':
        event.preventDefault()
        this._focusedIndex = this._lastInteractiveIndex()
        this.markNeedsPaint()
        return true
      case 'Enter':
      case ' ':
        event.preventDefault()
        this._activate(this._focusedIndex)
        return true
      default:
        return false
    }
  }

  override dispose(): void {
    super.dispose()
    this.onNavigate = undefined
  }

  protected override onDisabledStateChanged(disabled: boolean, _previous: ControlInteractionSnapshot): void {
    if (!disabled) return
    this._hoveredIndex = -1
    this._focusedIndex = -1
  }

  private _activate(index: number): void {
    if (this.isDisabled) return
    if (index < 0 || index >= this.items.length - 1) return
    const item = this.items[index]!
    if (item.disabled) return
    this.onNavigate?.(item, index)
  }

  private _moveFocus(delta: number): void {
    if (this.items.length <= 1) return
    let index = this._focusedIndex >= 0 ? this._focusedIndex : this._firstInteractiveIndex()
    while (true) {
      index += delta
      if (index < 0 || index >= this.items.length - 1) break
      if (!this.items[index]?.disabled) {
        this._focusedIndex = index
        this.markNeedsPaint()
        return
      }
    }
  }

  private _firstInteractiveIndex(): number {
    return this.items.findIndex((item, index) => !item.disabled && index < this.items.length - 1)
  }

  private _lastInteractiveIndex(): number {
    for (let index = this.items.length - 2; index >= 0; index -= 1) {
      if (!this.items[index]?.disabled) return index
    }
    return -1
  }

  private _itemIndexAt(globalX: number): number {
    const style = deriveBreadcrumbStyle(this.currentTheme)
    const rects = this._itemRects(style, this.currentTheme.fontFamily)
    const localX = globalX - this.globalOffset.x
    for (let index = 0; index < rects.length; index += 1) {
      const rect = rects[index]!
      if (localX >= rect.x && localX <= rect.right) return index
    }
    return -1
  }

  private _itemRects(style: ReturnType<typeof deriveBreadcrumbStyle>, fontFamily: string): Array<{ x: number; width: number; right: number }> {
    const rects: Array<{ x: number; width: number; right: number }> = []
    let x = 0
    for (let index = 0; index < this.items.length; index += 1) {
      const item = this.items[index]!
      const width = TextMeasurer.measureWidth(item.label, style.fontSize, fontFamily)
      rects.push({ x, width, right: x + width })
      x += width
      if (index < this.items.length - 1) {
        x += style.separatorGap * 2 + style.fontSize + style.itemGap
      }
    }
    return rects
  }
}
