import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../core/render_object'
import { RenderBox, resolveChildLayout, type RenderBoxOptions } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import {
  deriveItemContainerStyle,
  mergeItemContainerStyle,
  resolveBgColor,
  type ItemContainerAppearance,
  type ItemContainerStyleOverrides,
  type InteractionStateInput,
} from '../theme/component_styles'
import { paintFocusRing } from './focusable_control'

export interface ItemContainerState {
  selected: boolean
  hovered: boolean
  focused: boolean
  disabled: boolean
}

export type ItemTemplate<T> = (item: T, state: ItemContainerState, index: number) => RenderBox

export class RenderItemContainer<T> extends RenderBox {
  static override debugTypeName = 'RenderItemContainer'
  itemKey: string
  item: T
  index: number
  child?: RenderBox

  private _selected = false
  private _hovered = false
  private _focused = false
  private _disabled = false
  private readonly _template: ItemTemplate<T>
  private _paddingY?: number
  private _showAccent: boolean
  private _appearance: ItemContainerAppearance
  private _style?: ItemContainerStyleOverrides

  constructor(options: RenderBoxOptions & {
    itemKey: string
    item: T
    index: number
    disabled?: boolean
    paddingY?: number
    showAccent?: boolean
    appearance?: ItemContainerAppearance
    style?: ItemContainerStyleOverrides
    template: ItemTemplate<T>
  }) {
    super(options)
    this.itemKey = options.itemKey
    this.item = options.item
    this.index = options.index
    this._disabled = options.disabled ?? false
    this._template = options.template
    this._paddingY = options.paddingY
    this._showAccent = options.showAccent ?? true
    this._appearance = options.appearance ?? 'default'
    this._style = options.style
    this._rebuildChild()
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  get state(): ItemContainerState {
    return {
      selected: this._selected,
      hovered: this._hovered,
      focused: this._focused,
      disabled: this._disabled,
    }
  }

  get selected(): boolean { return this._selected }
  get hovered(): boolean { return this._hovered }
  get focused(): boolean { return this._focused }
  get disabled(): boolean { return this._disabled }

  setItem(item: T, index: number, disabled = false, forceTemplateRefresh = false): void {
    const changed = this.item !== item || this.index !== index || this._disabled !== disabled
    if (!changed && !forceTemplateRefresh) return
    this.item = item
    this.index = index
    this._disabled = disabled
    this._rebuildChild()
    this.markNeedsPaint()
  }

  setLayoutOptions(options: {
    minHeight?: number
    paddingY?: number
    showAccent?: boolean
    appearance?: ItemContainerAppearance
    style?: ItemContainerStyleOverrides
  }): void {
    const showAccent = options.showAccent ?? true
    const appearance = options.appearance ?? 'default'
    if (
      this.minHeight === options.minHeight &&
      this._paddingY === options.paddingY &&
      this._showAccent === showAccent &&
      this._appearance === appearance &&
      this._style === options.style
    ) return
    this.minHeight = options.minHeight
    this._paddingY = options.paddingY
    this._showAccent = showAccent
    this._appearance = appearance
    this._style = options.style
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  setVisualState(state: Partial<ItemContainerState>): void {
    const selected = state.selected ?? this._selected
    const hovered = state.hovered ?? this._hovered
    const focused = state.focused ?? this._focused
    const disabled = state.disabled ?? this._disabled
    if (
      selected === this._selected &&
      hovered === this._hovered &&
      focused === this._focused &&
      disabled === this._disabled
    ) return
    this._selected = selected
    this._hovered = hovered
    this._focused = focused
    this._disabled = disabled
    this._rebuildChild()
    this.markNeedsPaint()
  }

  setHoveredState(hovered: boolean, refreshTemplate = true): void {
    if (this._hovered === hovered) return
    this._hovered = hovered
    if (refreshTemplate) this._rebuildChild()
    this.markNeedsPaint()
  }

  refreshTemplate(): void {
    this._rebuildChild()
    this.markNeedsPaint()
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      if (this.child) visitor(this.child)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    if (this.child) visitor(this.child)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = this._resolveStyle(context)
    const minHeight = this.minHeight ?? style.minHeight
    const paddingY = this._paddingY ?? style.paddingY
    const horizontalPadding = style.paddingX * 2
    const verticalPadding = paddingY * 2
    if (!this.child) {
      this.size = constrainSize(constraints, {
        width: horizontalPadding,
        height: Math.max(minHeight, verticalPadding),
      })
      return
    }

    const maxInnerWidth = Math.max(0, constraints.maxWidth - horizontalPadding)
    const childLayout = resolveChildLayout(
      this.child,
      {
        minWidth: constraints.maxWidth === Infinity ? 0 : maxInnerWidth,
        maxWidth: maxInnerWidth,
        minHeight: 0,
        maxHeight: Math.max(0, constraints.maxHeight - verticalPadding),
      },
      'stretch',
      'center',
    )
    this.child.layout(childLayout.constraints, true, context)
    const naturalWidth = this.child.outerSize.width + horizontalPadding
    const naturalHeight = Math.max(minHeight, this.child.outerSize.height + verticalPadding)
    this.size = constrainSize(constraints, {
      width: constraints.maxWidth === Infinity ? naturalWidth : constraints.maxWidth,
      height: naturalHeight,
    })
    this.child.positionInSlot({
      x: style.paddingX,
      y: paddingY,
      width: Math.max(0, this.size.width - horizontalPadding),
      height: Math.max(0, this.size.height - verticalPadding),
    }, childLayout.horizontalAlignment, childLayout.verticalAlignment)
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const style = this._resolveStyle(context)
    const state = this._interactionState()
    const dl = new DrawList(context)
    dl.fillRect(
      offset.x,
      offset.y,
      this.size.width,
      this.size.height,
      resolveBgColor(style.background, state),
      style.borderRadius,
    )
    if (this._selected && this._showAccent) {
      dl.pushRoundedClip(offset.x, offset.y, this.size.width, this.size.height, style.borderRadius)
      dl.fillRect(
        offset.x,
        offset.y + style.borderWidth,
        style.accentWidth,
        Math.max(0, this.size.height - style.borderWidth * 2),
        style.accentColor,
        0,
      )
      dl.popClip()
    }
    if (style.borderWidth > 0) {
      const borderColor = resolveBgColor(style.border, state)
      if (style.borderPlacement === 'bottom') {
        dl.line(
          offset.x,
          offset.y + this.size.height,
          offset.x + this.size.width,
          offset.y + this.size.height,
          borderColor,
          style.borderWidth,
        )
      } else {
        dl.strokeRect(
          offset.x,
          offset.y,
          this.size.width,
          this.size.height,
          borderColor,
          style.borderWidth,
          style.borderRadius,
        )
      }
    }
    super.performPaint(context, offset)
    if (this._focused && !this._disabled) {
      paintFocusRing(
        dl,
        style.focusColor,
        offset.x,
        offset.y,
        this.size.width,
        this.size.height,
        style.borderRadius,
      )
    }
  }

  debugState(): ItemContainerState & { childOffset?: Offset } {
    return {
      ...this.state,
      childOffset: this.child?.offset,
    }
  }

  private _interactionState(): InteractionStateInput {
    return {
      disabled: this._disabled,
      selected: this._selected,
      hovered: this._hovered,
      focused: this._focused,
    }
  }

  private _rebuildChild(): void {
    if (this.child) {
      this.child.parent = undefined
      if (this.child.owner) this.child.detach()
    }
    const child = this._template(this.item, this.state, this.index)
    this.child = child
    child.parent = this
    if (this.owner && child.owner !== this.owner) child.attach(this.owner)
    this.markNeedsLayout()
  }

  private _resolveStyle(context: LayoutContext | PaintContext) {
    return mergeItemContainerStyle(deriveItemContainerStyle(context.theme, this._appearance), this._style)
  }
}
