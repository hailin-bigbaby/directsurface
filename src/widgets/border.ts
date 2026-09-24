import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../core/render_object'
import { RenderBox, RenderPanel, resolveChildLayout, type RenderPanelOptions } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { deriveBorderStyle, type BorderBackground } from '../theme/component_styles'
import type { Color } from '../theme/theme'

export type BorderAccentSide = 'left' | 'right' | 'top' | 'bottom'

function normalizeNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function normalizeOptionalNonNegative(value: number | undefined): number | undefined {
  return value === undefined ? undefined : normalizeNonNegative(value)
}

export interface RenderBorderOptions extends RenderPanelOptions {
  background?: BorderBackground | Color
  borderColor?: Color
  borderWidth?: number
  cornerRadius?: number
  accentSide?: BorderAccentSide
  accentWidth?: number
  child?: RenderBox
}

export class RenderBorder extends RenderPanel {
  static override debugTypeName = 'RenderBorder'
  private _background: BorderBackground | Color
  private _borderColor?: Color
  private _borderWidth?: number
  private _cornerRadius?: number
  private _accentSide?: BorderAccentSide
  private _accentWidth: number
  child?: RenderBox
  constructor(options: RenderBorderOptions = {}) {
    super(options)
    this._background = options.background ?? 'panel'
    this._borderColor = options.borderColor
    this._borderWidth = normalizeOptionalNonNegative(options.borderWidth)
    this._cornerRadius = normalizeOptionalNonNegative(options.cornerRadius)
    this._accentSide = options.accentSide
    this._accentWidth = normalizeNonNegative(options.accentWidth ?? 3)
    this.child = options.child
    if (options.child) options.child.parent = this
  }

  get background(): BorderBackground | Color { return this._background }
  set background(value: BorderBackground | Color) {
    if (this._background === value) return
    this._background = value
    this.markNeedsPaint()
  }

  get borderColor(): Color | undefined { return this._borderColor }
  set borderColor(value: Color | undefined) {
    if (this._borderColor === value) return
    this._borderColor = value
    this.markNeedsPaint()
  }

  get borderWidth(): number | undefined { return this._borderWidth }
  set borderWidth(value: number | undefined) {
    const normalized = normalizeOptionalNonNegative(value)
    if (this._borderWidth === normalized) return
    this._borderWidth = normalized
    this.markNeedsPaint()
  }

  get cornerRadius(): number | undefined { return this._cornerRadius }
  set cornerRadius(value: number | undefined) {
    const normalized = normalizeOptionalNonNegative(value)
    if (this._cornerRadius === normalized) return
    this._cornerRadius = normalized
    this.markNeedsPaint()
  }

  get accentSide(): BorderAccentSide | undefined { return this._accentSide }
  set accentSide(value: BorderAccentSide | undefined) {
    if (this._accentSide === value) return
    this._accentSide = value
    this.markNeedsPaint()
  }

  get accentWidth(): number { return this._accentWidth }
  set accentWidth(value: number) {
    const normalized = normalizeNonNegative(value)
    if (this._accentWidth === normalized) return
    this._accentWidth = normalized
    this.markNeedsPaint()
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  setChild(child?: RenderBox): void {
    if (this.child === child) return
    if (this.child) {
      this.child.parent = undefined
      if (this.child.owner) this.child.detach()
    }
    this.child = child
    if (child) {
      child.parent = this
      if (this.owner && child.owner !== this.owner) child.attach(this.owner)
    }
    this.markNeedsLayout()
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
    if (!this.child) {
      this.size = this.inflatePaddingSize(constraints, { width: 0, height: 0 })
      return
    }

    const inner = this.deflatePaddingConstraints(constraints)
    const layout = resolveChildLayout(this.child, inner, 'stretch', 'stretch')
    this.child.layout(layout.constraints, true, context)
    this.size = this.inflatePaddingSize(constraints, this.child.outerSize)
    const offset = this.contentOffset
    const content = this.contentSize
    this.child.positionInSlot({
      x: offset.x,
      y: offset.y,
      width: content.width,
      height: content.height,
    }, layout.horizontalAlignment, layout.verticalAlignment)
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const style = deriveBorderStyle(context.theme, typeof this._background === 'string' ? this._background : 'panel')
    const backgroundColor = typeof this._background === 'string' ? style.backgroundColor : this._background
    const borderColor = this._borderColor ?? style.borderColor
    const borderWidth = this._borderWidth ?? style.borderWidth
    const radius = this._cornerRadius ?? style.borderRadius
    const dl = new DrawList(context)
    dl.fillRect(offset.x, offset.y, this.size.width, this.size.height, backgroundColor, radius)
    if (this._accentSide && this._accentWidth > 0) {
      const accent = this.accentRect(offset)
      dl.pushRoundedClip(offset.x, offset.y, this.size.width, this.size.height, radius)
      dl.fillRect(accent.x, accent.y, accent.width, accent.height, style.accentColor, 0)
      dl.popClip()
    }
    if (borderWidth > 0) {
      dl.strokeRect(offset.x, offset.y, this.size.width, this.size.height, borderColor, borderWidth, radius)
    }
    super.performPaint(context, offset)
  }

  private accentRect(offset: Offset): { x: number; y: number; width: number; height: number } {
    switch (this._accentSide) {
      case 'right':
        return { x: offset.x + this.size.width - this._accentWidth, y: offset.y, width: this._accentWidth, height: this.size.height }
      case 'top':
        return { x: offset.x, y: offset.y, width: this.size.width, height: this._accentWidth }
      case 'bottom':
        return { x: offset.x, y: offset.y + this.size.height - this._accentWidth, width: this.size.width, height: this._accentWidth }
      default:
        return { x: offset.x, y: offset.y, width: this._accentWidth, height: this.size.height }
    }
  }
}
