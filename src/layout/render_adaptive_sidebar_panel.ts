import { RenderObject, type BoxConstraints, type LayoutContext, type Offset } from '../core/render_object'
import { FocusManager } from '../core/focus_manager'
import { PopupManager } from '../core/popup_manager'
import type { PaintContext } from '../rendering/paint_context'
import { deriveLayoutStyle } from '../theme/component_styles'
import { RenderBox, RenderPanel, resolveChildLayout, type RenderPanelOptions } from './render_box'

export type AdaptiveSidebarMode = 'auto' | 'expanded' | 'collapsed'
export type AdaptiveSidebarResolvedMode = Exclude<AdaptiveSidebarMode, 'auto'>
export type AdaptiveSidebarSide = 'left' | 'right'

export interface AdaptiveSidebarPanelOptions extends RenderPanelOptions {
  sidebar: RenderBox
  content: RenderBox
  collapsedSidebar?: RenderBox
  mode?: AdaptiveSidebarMode
  side?: AdaptiveSidebarSide
  breakpoint?: number
  sidebarWidth?: number
  collapsedSidebarWidth?: number
  gap?: number
}

export interface AdaptiveSidebarDebugState {
  readonly mode: AdaptiveSidebarMode
  readonly resolvedMode: AdaptiveSidebarResolvedMode
  readonly side: AdaptiveSidebarSide
  readonly availableWidth: number
  readonly sidebarWidth: number
  readonly contentWidth: number
}

const DEFAULT_BREAKPOINT = 720
const DEFAULT_SIDEBAR_WIDTH = 240
const DEFAULT_COLLAPSED_SIDEBAR_WIDTH = 56

function normalizeNonNegative(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(0, value)
}

function normalizeGap(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return Math.max(0, value)
}

export class RenderAdaptiveSidebarPanel extends RenderPanel {
  static override debugTypeName = 'RenderAdaptiveSidebarPanel'

  readonly sidebar: RenderBox
  readonly content: RenderBox
  readonly collapsedSidebar?: RenderBox

  private _mode: AdaptiveSidebarMode
  private _side: AdaptiveSidebarSide
  private _breakpoint: number
  private _sidebarWidth: number
  private _collapsedSidebarWidth: number
  private _gap?: number
  private _debugState: AdaptiveSidebarDebugState

  constructor(options: AdaptiveSidebarPanelOptions) {
    super(options)
    this._assertDistinctChildren(options)
    this.sidebar = options.sidebar
    this.content = options.content
    this.collapsedSidebar = options.collapsedSidebar
    this._mode = options.mode ?? 'auto'
    this._side = options.side ?? 'left'
    this._breakpoint = normalizeNonNegative(options.breakpoint, DEFAULT_BREAKPOINT)
    this._sidebarWidth = normalizeNonNegative(options.sidebarWidth, DEFAULT_SIDEBAR_WIDTH)
    this._collapsedSidebarWidth = normalizeNonNegative(
      options.collapsedSidebarWidth,
      DEFAULT_COLLAPSED_SIDEBAR_WIDTH,
    )
    this._gap = normalizeGap(options.gap)
    this._adopt(this.sidebar)
    if (this.collapsedSidebar) this._adopt(this.collapsedSidebar)
    this._adopt(this.content)
    this._debugState = {
      mode: this._mode,
      resolvedMode: this._mode === 'collapsed' ? 'collapsed' : 'expanded',
      side: this._side,
      availableWidth: 0,
      sidebarWidth: 0,
      contentWidth: 0,
    }
  }

  get mode(): AdaptiveSidebarMode { return this._mode }
  set mode(value: AdaptiveSidebarMode) {
    if (this._mode === value) return
    this._mode = value
    this.markNeedsLayout()
  }

  get side(): AdaptiveSidebarSide { return this._side }
  set side(value: AdaptiveSidebarSide) {
    if (this._side === value) return
    this._side = value
    this.markNeedsLayout()
  }

  get breakpoint(): number { return this._breakpoint }
  set breakpoint(value: number) {
    const next = normalizeNonNegative(value, DEFAULT_BREAKPOINT)
    if (this._breakpoint === next) return
    this._breakpoint = next
    this.markNeedsLayout()
  }

  get sidebarWidth(): number { return this._sidebarWidth }
  set sidebarWidth(value: number) {
    const next = normalizeNonNegative(value, DEFAULT_SIDEBAR_WIDTH)
    if (this._sidebarWidth === next) return
    this._sidebarWidth = next
    this.markNeedsLayout()
  }

  get collapsedSidebarWidth(): number { return this._collapsedSidebarWidth }
  set collapsedSidebarWidth(value: number) {
    const next = normalizeNonNegative(value, DEFAULT_COLLAPSED_SIDEBAR_WIDTH)
    if (this._collapsedSidebarWidth === next) return
    this._collapsedSidebarWidth = next
    this.markNeedsLayout()
  }

  get gap(): number | undefined { return this._gap }
  set gap(value: number | undefined) {
    const next = normalizeGap(value)
    if (this._gap === next) return
    this._gap = next
    this.markNeedsLayout()
  }

  get resolvedMode(): AdaptiveSidebarResolvedMode {
    return this._debugState.resolvedMode
  }

  debugState(): AdaptiveSidebarDebugState {
    return { ...this._debugState }
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      visitor(this.sidebar)
      if (this.collapsedSidebar) visitor(this.collapsedSidebar)
      visitor(this.content)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    const activeSidebar = this._activeSidebar(this._debugState.resolvedMode)
    if (activeSidebar?.participatesInLayout) visitor(activeSidebar)
    if (this.content.participatesInLayout) visitor(this.content)
  }

  override isFocusChildActive(child: RenderObject): boolean {
    if (child === this.sidebar || child === this.collapsedSidebar) {
      return child === this._activeSidebar(this._debugState.resolvedMode) && (child as RenderBox).participatesInLayout
    }
    if (child === this.content) return (child as RenderBox).participatesInLayout
    return super.isFocusChildActive(child)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const previousResolvedMode = this._debugState.resolvedMode
    const contentConstraints = this.deflatePaddingConstraints(constraints)
    const finiteWidth = contentConstraints.maxWidth !== Infinity
    const resolvedMode = this._resolveMode(contentConstraints.maxWidth, finiteWidth)
    const activeSidebar = this._activeSidebar(resolvedMode)
    const hasSidebar = !!activeSidebar?.participatesInLayout
    const configuredSidebarWidth = resolvedMode === 'expanded'
      ? this._sidebarWidth
      : this.collapsedSidebar ? this._collapsedSidebarWidth : 0
    const themedGap = this._gap ?? deriveLayoutStyle(context.theme).itemSpacing
    const naturalContentWidth = !finiteWidth && this.content.participatesInLayout
      ? this.content.measureOuter({
        minWidth: 0,
        maxWidth: Infinity,
        minHeight: 0,
        maxHeight: contentConstraints.maxHeight,
      }, context).width
      : 0
    const availableWidth = finiteWidth
      ? contentConstraints.maxWidth
      : Math.max(
        contentConstraints.minWidth,
        naturalContentWidth + (hasSidebar ? configuredSidebarWidth + themedGap : 0),
      )
    const sidebarWidth = hasSidebar ? Math.min(availableWidth, configuredSidebarWidth) : 0
    const gap = hasSidebar && sidebarWidth < availableWidth ? themedGap : 0
    const contentWidth = Math.max(0, availableWidth - sidebarWidth - gap)
    const maxHeight = contentConstraints.maxHeight

    const sidebarHeight = activeSidebar && hasSidebar
      ? this._layoutChild(activeSidebar, sidebarWidth, maxHeight, context)
      : 0
    const contentHeight = this.content.participatesInLayout
      ? this._layoutChild(this.content, contentWidth, maxHeight, context)
      : 0
    const height = maxHeight === Infinity
      ? Math.max(contentConstraints.minHeight, sidebarHeight, contentHeight)
      : maxHeight

    if (activeSidebar && hasSidebar) this._layoutChild(activeSidebar, sidebarWidth, height, context, true)
    if (this.content.participatesInLayout) this._layoutChild(this.content, contentWidth, height, context, true)

    const contentX = this._side === 'left'
      ? this.contentOffset.x + sidebarWidth + gap
      : this.contentOffset.x
    const sidebarX = this._side === 'left'
      ? this.contentOffset.x
      : this.contentOffset.x + contentWidth + gap

    if (activeSidebar && hasSidebar) {
      activeSidebar.positionInSlot({
        x: sidebarX,
        y: this.contentOffset.y,
        width: sidebarWidth,
        height,
      }, activeSidebar.resolveHorizontalAlignment('stretch'), activeSidebar.resolveVerticalAlignment('stretch'))
    }
    if (this.content.participatesInLayout) {
      this.content.positionInSlot({
        x: contentX,
        y: this.contentOffset.y,
        width: contentWidth,
        height,
      }, this.content.resolveHorizontalAlignment('stretch'), this.content.resolveVerticalAlignment('stretch'))
    }

    this.size = this.inflatePaddingSize(constraints, { width: availableWidth, height })
    this._debugState = {
      mode: this._mode,
      resolvedMode,
      side: this._side,
      availableWidth,
      sidebarWidth,
      contentWidth,
    }
    if (previousResolvedMode !== resolvedMode) {
      const inactiveSidebar = this._activeSidebar(previousResolvedMode)
      const activeSidebar = this._activeSidebar(resolvedMode)
      if (inactiveSidebar && inactiveSidebar !== activeSidebar) {
        const inactiveOwners = this._snapshotSubtreeOwners(inactiveSidebar)
        if (typeof window !== 'undefined') FocusManager.instance.clearFocusWithin(inactiveSidebar)
        PopupManager.instance.closeOwnedByAny(inactiveOwners)
      }
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    this.paintContentChildren(context, offset)
    this.paintAdornerChildren(context, offset)
  }

  private _layoutChild(
    child: RenderBox,
    width: number,
    height: number,
    context: LayoutContext,
    stretchHeight = false,
  ): number {
    const layout = resolveChildLayout(
      child,
      { minWidth: width, maxWidth: width, minHeight: stretchHeight ? height : 0, maxHeight: height },
      'stretch',
      'stretch',
    )
    child.layout(layout.constraints, true, context)
    return child.outerSize.height
  }

  private _resolveMode(availableWidth: number, finiteWidth: boolean): AdaptiveSidebarResolvedMode {
    if (this._mode !== 'auto') return this._mode
    if (!finiteWidth) return 'expanded'
    return availableWidth < this._breakpoint ? 'collapsed' : 'expanded'
  }

  private _activeSidebar(mode: AdaptiveSidebarResolvedMode): RenderBox | undefined {
    if (mode === 'expanded') return this.sidebar
    return this.collapsedSidebar
  }

  private _adopt(child: RenderBox): void {
    child.parent = this
  }

  private _snapshotSubtreeOwners(root: RenderObject): Set<object> {
    const owners = new Set<object>()
    const visit = (node: RenderObject): void => {
      if (owners.has(node)) return
      owners.add(node)
      node.visitChildren(child => visit(child))
    }
    visit(root)
    return owners
  }

  private _assertDistinctChildren(options: AdaptiveSidebarPanelOptions): void {
    const children = [options.sidebar, options.content, options.collapsedSidebar].filter(
      (child): child is RenderBox => !!child,
    )
    if (new Set(children).size !== children.length) {
      throw new Error('RenderAdaptiveSidebarPanel requires distinct children.')
    }
    if (children.some(child => child.parent !== undefined)) {
      throw new Error('RenderAdaptiveSidebarPanel child already has a parent.')
    }
    if (children.some(child => child.owner !== undefined)) {
      throw new Error('RenderAdaptiveSidebarPanel child is already attached to a render tree.')
    }
  }
}
