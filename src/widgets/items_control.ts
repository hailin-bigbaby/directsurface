import { FocusManager, type Focusable } from '../core/focus_manager'
import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import { RenderObject, constrainSize } from '../core/render_object'
import type { PointerEvent, WheelPointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { HitTestResult, isPrimaryPointerButton, type HitTestTarget } from '../gestures/hit_test'
import { pointerKey } from '../gestures/pointer_identity'
import { ScrollbarAxisController } from '../gestures/scrollbar_interaction_controller'
import { RenderBox, type RenderBoxOptions } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { hitTestScrollbarGeometry, paintHBar, paintVBar, resolveScrollbarGeometryForState, type ScrollbarGeometry } from '../rendering/scrollbar'
import { deriveLayoutStyle, deriveScrollbarStyle } from '../theme/component_styles'
import type { ItemContainerAppearance, ItemContainerStyleOverrides } from '../theme/component_styles'
import { ScrollController } from '../virtualization/scroll_controller'
import { VariableVirtualizer, type VariableVirtualRange } from '../virtualization/variable_virtual_range'
import type { ScrollAlign as VirtualScrollAlign } from '../virtualization/fixed_virtual_range'
import { RenderItemContainer, type ItemTemplate } from './item_container'

export type ItemsControlOrientation = 'vertical' | 'horizontal'
export type ItemsControlSelectionMode = 'none' | 'single'
export type ItemsControlScrollMode = 'none' | 'auto'
export type ItemsControlScrollAlign = VirtualScrollAlign

export interface ItemsControlSelectionChange<T> {
  item: T
  index: number
}

export interface ItemsControlItemMetrics {
  key: string
  index: number
  mainOffset: number
  mainSize: number
  crossSize: number
}

export interface ItemsControlVirtualizationOptions {
  enabled?: boolean
  estimatedItemMainSize?: number
  overscan?: number
}

interface ItemsControlViewportState {
  width: number
  height: number
  showVBar: boolean
  showHBar: boolean
}

export class RenderItemsControl<T> extends RenderBox implements InteractiveRenderObject, Focusable {
  static override debugTypeName = 'RenderItemsControl'
  onSelectionChange?: (change: ItemsControlSelectionChange<T>) => void
  onActivate?: (item: T, index: number) => void
  onItemHover?: (item: T | null, index: number) => void

  private _items: T[]
  private _itemKeys: string[] = []
  private _itemKeyIndex = new Map<string, number>()
  private readonly _getKey: (item: T, index: number) => string
  private readonly _itemTemplate: ItemTemplate<T>
  private readonly _isItemDisabled?: (item: T, index: number) => boolean
  private readonly _isItemSelectable?: (item: T, index: number) => boolean
  private _orientation: ItemsControlOrientation
  private _selectionMode: ItemsControlSelectionMode
  private _scrollMode: ItemsControlScrollMode
  private _selectedKey = ''
  private _hoveredKey = ''
  private _templatePreservedHoverKey = ''
  private _focusedKey = ''
  private _focused = false
  private _focusRegistered = false
  private _disabled: boolean
  private _spacing?: number
  private _itemMinHeight?: number
  private _itemPaddingY?: number
  private _itemShowAccent = true
  private _refreshTemplateOnHover = true
  private _itemAppearance: ItemContainerAppearance
  private _itemStyle?: ItemContainerStyleOverrides
  private _virtualization: Required<ItemsControlVirtualizationOptions>
  private _virtualizer?: VariableVirtualizer<string>
  private _virtualKeysSynced = false
  private _virtualRange: VariableVirtualRange | null = null
  private _contentWidth = 0
  private _contentHeight = 0
  private _scrollX = new ScrollController({ axis: 'x' })
  private _scrollY = new ScrollController({ axis: 'y' })
  private readonly _vScrollbarController = new ScrollbarAxisController('vertical')
  private readonly _hScrollbarController = new ScrollbarAxisController('horizontal')
  private readonly _vScrollbar = this._vScrollbarController.state
  private readonly _hScrollbar = this._hScrollbarController.state
  private _containers: RenderItemContainer<T>[] = []
  private _containersByKey = new Map<string, RenderItemContainer<T>>()
  private _contentOffsets = new Map<RenderItemContainer<T>, Offset>()
  private _itemMetrics: ItemsControlItemMetrics[] = []
  private _itemMetricsByKey = new Map<string, ItemsControlItemMetrics>()
  private _metricCrossSize = 0
  private _metricSpacing = 0
  private _pendingEnsureVisibleKey = ''

  constructor(options: RenderBoxOptions & {
    items: T[]
    getKey: (item: T, index: number) => string
    itemTemplate: ItemTemplate<T>
    selectedItem?: T | null
    defaultSelectedItem?: T | null
    onSelectionChange?: (change: ItemsControlSelectionChange<T>) => void
    onActivate?: (item: T, index: number) => void
    orientation?: ItemsControlOrientation
    selectionMode?: ItemsControlSelectionMode
    scrollMode?: ItemsControlScrollMode
    spacing?: number
    itemMinHeight?: number
    itemPaddingY?: number
    itemShowAccent?: boolean
    refreshTemplateOnHover?: boolean
    itemAppearance?: ItemContainerAppearance
    itemStyle?: ItemContainerStyleOverrides
    disabled?: boolean
    virtualization?: ItemsControlVirtualizationOptions
    isItemDisabled?: (item: T, index: number) => boolean
    isItemSelectable?: (item: T, index: number) => boolean
    onItemHover?: (item: T | null, index: number) => void
  }) {
    super(options)
    this._items = options.items.slice()
    this._getKey = options.getKey
    this._itemTemplate = options.itemTemplate
    this._syncItemKeys()
    this._orientation = options.orientation ?? 'vertical'
    this._selectionMode = options.selectionMode ?? 'single'
    this._scrollMode = options.scrollMode ?? 'auto'
    this._selectedKey = this._keyForItem(options.selectedItem ?? options.defaultSelectedItem ?? null)
    this.onSelectionChange = options.onSelectionChange
    this.onActivate = options.onActivate
    this.onItemHover = options.onItemHover
    this._spacing = options.spacing
    this._itemMinHeight = options.itemMinHeight
    this._itemPaddingY = options.itemPaddingY
    this._itemShowAccent = options.itemShowAccent ?? true
    this._refreshTemplateOnHover = options.refreshTemplateOnHover ?? true
    this._itemAppearance = options.itemAppearance ?? 'default'
    this._itemStyle = options.itemStyle
    this._virtualization = normalizeVirtualizationOptions(options.virtualization)
    if (this._virtualization.enabled) {
      this._virtualizer = new VariableVirtualizer<string>({
        estimatedItemSize: this._virtualization.estimatedItemMainSize,
      })
    }
    this._disabled = options.disabled ?? false
    this._isItemDisabled = options.isItemDisabled
    this._isItemSelectable = options.isItemSelectable
    this._reconcileContainers()
    this._syncFocusRegistration()
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  get items(): T[] { return this._items }
  set items(items: T[]) {
    this._items = items.slice()
    this._syncItemKeys()
    this._reconcileContainers()
    this.markNeedsLayout()
  }

  get selectedItem(): T | null {
    const index = this._indexForKey(this._selectedKey)
    return index >= 0 ? this._items[index] ?? null : null
  }
  set selectedItem(item: T | null) {
    const key = this._keyForItem(item)
    const index = this._indexForKey(key)
    const next = this._selectionMode === 'single' &&
      key &&
      index >= 0 &&
      !this._containerDisabled(key) &&
      this._containerSelectable(key)
      ? key
      : ''
    if (next === this._selectedKey) return
    this._selectedKey = next
    if (this._focusedKey && !this._containersByKey.has(this._focusedKey)) this._focusedKey = next
    if (next) this._ensureKeyVisible(next)
    this._syncContainerStates()
    this.markNeedsPaint()
  }

  getItemMetrics(): readonly ItemsControlItemMetrics[] {
    if (this._virtualization.enabled) return this._virtualItemMetrics()
    return this._itemMetrics
  }

  getItemMetricsForKey(key: string): ItemsControlItemMetrics | undefined {
    return this._itemMetricsByKey.get(key) ?? this._virtualMetricForKey(key)
  }

  get orientation(): ItemsControlOrientation { return this._orientation }
  set orientation(value: ItemsControlOrientation) {
    if (this._orientation === value) return
    this._orientation = value
    this.markNeedsLayout()
  }

  get selectionMode(): ItemsControlSelectionMode { return this._selectionMode }
  set selectionMode(value: ItemsControlSelectionMode) {
    if (this._selectionMode === value) return
    this._selectionMode = value
    if (value === 'none') this._selectedKey = ''
    this._syncContainerStates()
    this.markNeedsPaint()
  }

  get scrollMode(): ItemsControlScrollMode { return this._scrollMode }
  set scrollMode(value: ItemsControlScrollMode) {
    if (this._scrollMode === value) return
    this._scrollMode = value
    this._syncScrollBounds()
    this.markNeedsLayout()
  }

  get virtualization(): ItemsControlVirtualizationOptions {
    return { ...this._virtualization }
  }
  set virtualization(value: ItemsControlVirtualizationOptions | undefined) {
    const next = normalizeVirtualizationOptions(value)
    if (
      this._virtualization.enabled === next.enabled &&
      this._virtualization.estimatedItemMainSize === next.estimatedItemMainSize &&
      this._virtualization.overscan === next.overscan
    ) return
    this._virtualization = next
    this._virtualizer = next.enabled
      ? new VariableVirtualizer<string>({ estimatedItemSize: next.estimatedItemMainSize })
      : undefined
    this._virtualKeysSynced = false
    this._virtualRange = null
    this._reconcileContainers()
    this.markNeedsLayout()
  }

  get spacing(): number | undefined { return this._spacing }
  set spacing(value: number | undefined) {
    if (this._spacing === value) return
    this._spacing = value
    this.markNeedsLayout()
  }

  get itemMinHeight(): number | undefined { return this._itemMinHeight }
  set itemMinHeight(value: number | undefined) {
    if (this._itemMinHeight === value) return
    this._itemMinHeight = value
    this._reconcileContainers()
    this.markNeedsLayout()
  }

  get itemPaddingY(): number | undefined { return this._itemPaddingY }
  set itemPaddingY(value: number | undefined) {
    if (this._itemPaddingY === value) return
    this._itemPaddingY = value
    this._reconcileContainers()
    this.markNeedsLayout()
  }

  get itemShowAccent(): boolean { return this._itemShowAccent }
  set itemShowAccent(value: boolean) {
    if (this._itemShowAccent === value) return
    this._itemShowAccent = value
    this._reconcileContainers()
    this.markNeedsPaint()
  }

  get refreshTemplateOnHover(): boolean { return this._refreshTemplateOnHover }
  set refreshTemplateOnHover(value: boolean) {
    if (this._refreshTemplateOnHover === value) return
    this._refreshTemplateOnHover = value
  }

  get itemAppearance(): ItemContainerAppearance { return this._itemAppearance }
  set itemAppearance(value: ItemContainerAppearance) {
    if (this._itemAppearance === value) return
    this._itemAppearance = value
    this._reconcileContainers()
    this.markNeedsPaint()
  }

  get itemStyle(): ItemContainerStyleOverrides | undefined { return this._itemStyle }
  set itemStyle(value: ItemContainerStyleOverrides | undefined) {
    if (this._itemStyle === value) return
    this._itemStyle = value
    this._reconcileContainers()
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  get scrollX(): number { return this._scrollX.offset }
  set scrollX(value: number) {
    const before = this._scrollX.offset
    this._scrollX.setOffset(value, { viewportSize: this._viewW, contentSize: this._contentWidth })
    if (this._scrollX.offset === before) return
    if (this._virtualization.enabled) this.markNeedsLayout()
    else this._syncContainerOffsets()
    this.markNeedsPaint()
  }

  get scrollY(): number { return this._scrollY.offset }
  set scrollY(value: number) {
    const before = this._scrollY.offset
    this._scrollY.setOffset(value, { viewportSize: this._viewH, contentSize: this._contentHeight })
    if (this._scrollY.offset === before) return
    if (this._virtualization.enabled) this.markNeedsLayout()
    else this._syncContainerOffsets()
    this.markNeedsPaint()
  }

  get disabled(): boolean { return this._disabled }
  set disabled(value: boolean) {
    if (this._disabled === value) return
    this._disabled = value
    if (value) this._clearInteractionState()
    this._syncFocusRegistration()
    this._syncContainerStates()
    this.markNeedsPaint()
  }

  get isFocused(): boolean { return this._focused }

  scrollToIndex(index: number, align: ItemsControlScrollAlign = 'nearest'): boolean {
    const normalized = Math.floor(index)
    if (!Number.isFinite(normalized) || normalized < 0 || normalized >= this._items.length) return false
    if (this._orientation === 'vertical') {
      const before = this.scrollY
      const next = this._scrollOffsetToIndex(normalized, this._viewH, this.scrollY, align)
      this._scrollY.setOffset(next, { viewportSize: this._viewH, contentSize: this._contentHeight })
      if (this.scrollY === before) return false
    } else {
      const before = this.scrollX
      const next = this._scrollOffsetToIndex(normalized, this._viewW, this.scrollX, align)
      this._scrollX.setOffset(next, { viewportSize: this._viewW, contentSize: this._contentWidth })
      if (this.scrollX === before) return false
    }
    if (this._virtualization.enabled) this.markNeedsLayout()
    else this._syncContainerOffsets()
    this.markNeedsPaint()
    return true
  }

  scrollToKey(key: string, align: ItemsControlScrollAlign = 'nearest'): boolean {
    const index = this._indexForKey(key)
    if (index < 0) return false
    return this.scrollToIndex(index, align)
  }

  focusIn(): void {
    if (this.disabled || !this.visible) return
    this._focused = true
    if (!this._focusedKey) {
      this._focusedKey = this._selectedKey || this._firstEnabledKey()
    }
    this._syncContainerStates()
    this.markNeedsPaint()
  }

  focusOut(): void {
    this._focused = false
    this._syncContainerStates()
    this.markNeedsPaint()
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      for (const container of this._containers) visitor(container)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    for (const container of this._containers) visitor(container)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const previousScrollX = this.scrollX
    const previousScrollY = this.scrollY
    const previousSize = { ...this.size }
    const spacing = this._spacing ?? deriveLayoutStyle(context.theme).itemSpacing
    const isVertical = this._orientation === 'vertical'
    const constrainedMaxWidth = constraints.maxWidth
    const constrainedMaxHeight = constraints.maxHeight
    const maxCross = isVertical ? constrainedMaxWidth : constrainedMaxHeight
    if (this._virtualization.enabled) {
      this._layoutVirtualContainers(maxCross, isVertical, spacing, context)
    } else {
      this._layoutContainers(maxCross, isVertical, spacing, context)
    }
    const stableNaturalSize = (): { width: number; height: number } => this._naturalSizeWithStableScrolledViewport(
      constraints,
      isVertical,
      previousSize,
      previousScrollX,
      previousScrollY,
    )
    this.size = constrainSize(constraints, stableNaturalSize())

    const viewport = this._viewport
    if (isVertical && viewport.showVBar && maxCross !== Infinity) {
      const viewportWidth = Math.max(0, this.size.width - this._scrollbarSize)
      if (viewportWidth < maxCross) {
        const outerWidth = this.size.width
        if (this._virtualization.enabled) {
          this._layoutVirtualContainers(viewportWidth, isVertical, spacing, context)
        } else {
          this._layoutContainers(viewportWidth, isVertical, spacing, context)
        }
        this.size = constrainSize(constraints, {
          ...stableNaturalSize(),
          width: outerWidth,
        })
      }
    } else if (isVertical && viewport.showVBar) {
      this.size = constrainSize(constraints, {
        ...stableNaturalSize(),
        width: this._contentWidth + this._scrollbarSize,
      })
    } else if (!isVertical && viewport.showHBar && maxCross !== Infinity) {
      const viewportHeight = Math.max(0, this.size.height - this._scrollbarSize)
      if (viewportHeight < maxCross) {
        const outerHeight = this.size.height
        if (this._virtualization.enabled) {
          this._layoutVirtualContainers(viewportHeight, isVertical, spacing, context)
        } else {
          this._layoutContainers(viewportHeight, isVertical, spacing, context)
        }
        this.size = constrainSize(constraints, {
          ...stableNaturalSize(),
          height: outerHeight,
        })
      }
    } else if (!isVertical && viewport.showHBar) {
      this.size = constrainSize(constraints, {
        ...stableNaturalSize(),
        height: this._contentHeight + this._scrollbarSize,
      })
    }

    if (context.pass === 'measure') return
    this._syncScrollBounds()
    this._syncContainerOffsets()
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    dl.pushClip(offset.x, offset.y, this._viewW, this._viewH)
    this.paintContentChildren(context, offset)
    dl.popClip()
    this.paintAdornerChildren(context, offset)
    this._paintScrollbars(dl, offset)
  }

  override hitTestPath(point: Offset, result: HitTestResult): boolean {
    const adornerResult = this._hitTestAdornerChildren(point)
    if (!this.hitTest(point)) {
      if (!adornerResult) return false
      for (const entry of adornerResult.path) result.add(entry)
      return true
    }

    const childResult = adornerResult ?? this._hitTestMaterializedChildren(point)
    const g = this.globalOffset
    result.add({
      target: this as unknown as HitTestTarget,
      localPosition: { x: point.x - g.x, y: point.y - g.y },
    })
    if (childResult) {
      for (const entry of childResult.path) result.add(entry)
    }
    return true
  }

  onPointerDown(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (this.disabled || !this.hitTest(event.position)) {
      FocusManager.instance.clearFocus()
      return
    }
    const key = pointerKey(event)
    const verticalResult = this._showVBar
      ? this._vScrollbarController.beginPointer(event.position, this._vScrollbarGeometry(), key)
      : undefined
    if (verticalResult?.handled) {
      this._pendingEnsureVisibleKey = ''
      event.stopPropagation?.()
      if (verticalResult.capturePointer) event.setPointerCapture?.()
      if (verticalResult.scrollOffset !== undefined) {
        this._scrollY.setOffset(verticalResult.scrollOffset, {
          viewportSize: this._viewH,
          contentSize: this._contentHeight,
        })
        if (this._virtualization.enabled) this.markNeedsLayout()
        else this._syncContainerOffsets()
      }
      this.markNeedsPaint()
      return
    }
    const horizontalResult = this._showHBar
      ? this._hScrollbarController.beginPointer(event.position, this._hScrollbarGeometry(), key)
      : undefined
    if (horizontalResult?.handled) {
      this._pendingEnsureVisibleKey = ''
      event.stopPropagation?.()
      if (horizontalResult.capturePointer) event.setPointerCapture?.()
      if (horizontalResult.scrollOffset !== undefined) {
        this._scrollX.setOffset(horizontalResult.scrollOffset, {
          viewportSize: this._viewW,
          contentSize: this._contentWidth,
        })
        if (this._virtualization.enabled) this.markNeedsLayout()
        else this._syncContainerOffsets()
      }
      this.markNeedsPaint()
      return
    }
    if (!this._inViewport(event.position)) return
    const container = this._containerAtPoint(event.position)
    if (!container || container.disabled) return
    if (this._eventTargetsNestedInteractiveChild(event, container)) return
    const selectable = this._selectionMode === 'single' && this._containerSelectable(container)
    const activatable = this.onActivate !== undefined
    if (!selectable && !activatable) return
    FocusManager.instance.setFocus(this)
    this._focused = true
    this._focusedKey = container.itemKey
    if (selectable) this._selectContainer(container, true)
    else {
      this._syncContainerStates()
      this.markNeedsPaint()
    }
  }

  onPointerMove(event: PointerEvent): void {
    const key = pointerKey(event)
    if (this._vScrollbar.dragging) {
      const result = this._vScrollbarController.updatePointer(
        event.position,
        this._vScrollbarGeometry(),
        key,
      )
      if (!result.handled) return
      event.stopPropagation?.()
      this._scrollY.setOffset(result.scrollOffset ?? this.scrollY, {
        viewportSize: this._viewH,
        contentSize: this._contentHeight,
      })
      if (this._virtualization.enabled) this.markNeedsLayout()
      else this._syncContainerOffsets()
      this.markNeedsPaint()
      return
    }
    if (this._hScrollbar.dragging) {
      const result = this._hScrollbarController.updatePointer(
        event.position,
        this._hScrollbarGeometry(),
        key,
      )
      if (!result.handled) return
      event.stopPropagation?.()
      this._scrollX.setOffset(result.scrollOffset ?? this.scrollX, {
        viewportSize: this._viewW,
        contentSize: this._contentWidth,
      })
      if (this._virtualization.enabled) this.markNeedsLayout()
      else this._syncContainerOffsets()
      this.markNeedsPaint()
      return
    }
    if (this.disabled || !this.hitTest(event.position)) {
      this._setHoveredKey('')
      return
    }
    const verticalHoverChanged = this._vScrollbarController.updateHover(
      event.position,
      this._vScrollbarGeometry(),
    )
    const horizontalHoverChanged = this._hScrollbarController.updateHover(
      event.position,
      this._hScrollbarGeometry(),
    )
    const scrollbarHoverChanged = verticalHoverChanged || horizontalHoverChanged
    const hoveredV = this._vScrollbar.hovered
    const hoveredH = this._hScrollbar.hovered
    if (hoveredV || hoveredH || !this._inViewport(event.position)) {
      this._setHoveredKey('')
      if (scrollbarHoverChanged) this.markNeedsPaint()
      return
    }
    const container = this._containerAtPoint(event.position)
    const nestedInteractive = !!container && this._eventTargetsNestedInteractiveChild(event, container)
    this._setHoveredKey(container && !container.disabled ? container.itemKey : '', {
      refreshCurrentTemplate: this._refreshTemplateOnHover && !nestedInteractive,
      refreshPreviousTemplate: this._refreshTemplateOnHover,
    })
    if (scrollbarHoverChanged) this.markNeedsPaint()
  }

  onPointerLeave(_event: PointerEvent): void {
    this._setHoveredKey('')
    const verticalHoverChanged = this._vScrollbarController.clearHover()
    const horizontalHoverChanged = this._hScrollbarController.clearHover()
    const hadScrollbarHover = verticalHoverChanged || horizontalHoverChanged
    if (hadScrollbarHover) this.markNeedsPaint()
  }

  onPointerUp(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    const key = pointerKey(event)
    if ((this._vScrollbar.dragging && !this._vScrollbarController.ownsPointer(key)) ||
      (this._hScrollbar.dragging && !this._hScrollbarController.ownsPointer(key))) return
    const verticalResult = this._vScrollbarController.endPointer(
      event.position,
      this._vScrollbarGeometry(),
      key,
    )
    const horizontalResult = this._hScrollbarController.endPointer(
      event.position,
      this._hScrollbarGeometry(),
      key,
    )
    const wasDragging = !!verticalResult.dragEnded || !!horizontalResult.dragEnded
    if (wasDragging) {
      event.stopPropagation?.()
      event.releasePointerCapture?.()
      this.markNeedsPaint()
      return
    }
    if (this.disabled || !this.hitTest(event.position)) return
    if (!this._inViewport(event.position)) return
    const container = this._containerAtPoint(event.position)
    if (!container || container.disabled) return
    if (this._eventTargetsNestedInteractiveChild(event, container)) return
    const canActivate = this._selectionMode === 'none' ||
      !this._containerSelectable(container) ||
      container.itemKey === this._selectedKey
    if (canActivate) this.onActivate?.(container.item, container.index)
  }

  onPointerCancel(event: PointerEvent): void {
    event.releasePointerCapture?.()
    this._setHoveredKey('')
    const key = pointerKey(event)
    if ((this._vScrollbar.dragging && !this._vScrollbarController.ownsPointer(key)) ||
      (this._hScrollbar.dragging && !this._hScrollbarController.ownsPointer(key))) return
    const verticalStateChanged = this._vScrollbarController.cancelPointer(key)
    const horizontalStateChanged = this._hScrollbarController.cancelPointer(key)
    const hadScrollbarState = verticalStateChanged || horizontalStateChanged
    if (hadScrollbarState) this.markNeedsPaint()
  }

  onWheel(event: WheelPointerEvent): boolean {
    if (this.disabled || !this.hitTest(event.position) || !this._inViewport(event.position)) return false
    this._pendingEnsureVisibleKey = ''
    const beforeX = this.scrollX
    const beforeY = this.scrollY
    const absX = Math.abs(event.deltaX)
    const absY = Math.abs(event.deltaY)
    const verticalWheelForHorizontalList = this._orientation === 'horizontal' && event.deltaX === 0 && event.deltaY !== 0
    const primaryAxis: 'x' | 'y' = verticalWheelForHorizontalList || absX > absY ? 'x' : 'y'
    const secondaryAxis: 'x' | 'y' = primaryAxis === 'x' ? 'y' : 'x'
    const primaryDelta = verticalWheelForHorizontalList ? event.deltaY : (primaryAxis === 'x' ? event.deltaX : event.deltaY)
    const secondaryDelta = secondaryAxis === 'x' ? event.deltaX : event.deltaY
    let changed = this._scrollWheelAxis(primaryAxis, primaryDelta)
    if (!changed) changed = this._scrollWheelAxis(secondaryAxis, secondaryDelta)
    if (!changed && verticalWheelForHorizontalList) changed = this._scrollWheelAxis(secondaryAxis, primaryDelta)
    const containsWheel = this._containsWheelAtBoundary(primaryAxis, primaryDelta) ||
      this._containsWheelAtBoundary(secondaryAxis, secondaryDelta) ||
      (verticalWheelForHorizontalList && this._containsWheelAtBoundary(secondaryAxis, primaryDelta))
    if (this.scrollX === beforeX && this.scrollY === beforeY) return containsWheel
    if (this._virtualization.enabled) this.markNeedsLayout()
    else this._syncContainerOffsets()
    this.markNeedsPaint()
    return true
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (!this._focused || this.disabled || this._containers.length === 0) return false
    const nextKey = (delta: number): string => this._enabledKeyFrom(this._focusedIndex(), delta)
    if (event.key === 'ArrowDown' && this._orientation === 'vertical') {
      event.preventDefault()
      this._focusKey(nextKey(1))
      return true
    }
    if (event.key === 'ArrowUp' && this._orientation === 'vertical') {
      event.preventDefault()
      this._focusKey(nextKey(-1))
      return true
    }
    if (event.key === 'ArrowRight' && this._orientation === 'horizontal') {
      event.preventDefault()
      this._focusKey(nextKey(1))
      return true
    }
    if (event.key === 'ArrowLeft' && this._orientation === 'horizontal') {
      event.preventDefault()
      this._focusKey(nextKey(-1))
      return true
    }
    if (event.key === 'Home') {
      event.preventDefault()
      this._focusKey(this._firstEnabledKey())
      return true
    }
    if (event.key === 'End') {
      event.preventDefault()
      this._focusKey(this._lastEnabledKey())
      return true
    }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      const focused = this._itemForKey(this._focusedKey)
      if (!focused || this._itemDisabled(focused.item, focused.index)) return true
      if (this._selectionMode === 'single' && this._containerSelectable(this._focusedKey)) {
        const changed = this._selectedKey !== this._focusedKey
        this._selectedKey = this._focusedKey
        this._syncContainerStates()
        this.markNeedsPaint()
        if (changed) {
          this.onSelectionChange?.({
            item: focused.item,
            index: focused.index,
          })
        }
      }
      if (event.key === 'Enter') this.onActivate?.(focused.item, focused.index)
      return true
    }
    return false
  }

  override dispose(): void {
    if (this._focusRegistered && typeof window !== 'undefined') {
      FocusManager.instance.unregister(this)
      this._focusRegistered = false
    }
    super.dispose()
  }

  protected override onVisibilityChanged(_visible: boolean): void {
    if (!this.visible) this._clearInteractionState()
    this._syncFocusRegistration()
  }

  debugContainers(): readonly RenderItemContainer<T>[] {
    return this._containers
  }

  debugState(): {
    selectedKey: string
    selectedItem: T | null
    hoveredKey: string
    focusedKey: string
    scrollX: number
    scrollY: number
    contentWidth: number
    contentHeight: number
    viewportWidth: number
    viewportHeight: number
    containerKeys: string[]
    itemMetrics: ItemsControlItemMetrics[]
    virtualized: boolean
    virtualRange: Pick<VariableVirtualRange, 'startIndex' | 'endIndex' | 'visibleStartIndex' | 'visibleEndIndex'> | null
    materializedKeys: string[]
  } {
    const virtualRange = this._virtualRange
      ? {
          startIndex: this._virtualRange.startIndex,
          endIndex: this._virtualRange.endIndex,
          visibleStartIndex: this._virtualRange.visibleStartIndex,
          visibleEndIndex: this._virtualRange.visibleEndIndex,
        }
      : null
    return {
      selectedKey: this._selectedKey,
      selectedItem: this.selectedItem,
      hoveredKey: this._hoveredKey,
      focusedKey: this._focusedKey,
      scrollX: this.scrollX,
      scrollY: this.scrollY,
      contentWidth: this._contentWidth,
      contentHeight: this._contentHeight,
      viewportWidth: this._viewW,
      viewportHeight: this._viewH,
      containerKeys: this._containers.map(container => container.itemKey),
      itemMetrics: this._itemMetrics.map(metric => ({ ...metric })),
      virtualized: this._virtualization.enabled,
      virtualRange,
      materializedKeys: this._containers.map(container => container.itemKey),
    }
  }

  private _reconcileContainers(): void {
    this._syncVirtualKeys()
    const previous = this._containersByKey
    const nextContainers: RenderItemContainer<T>[] = []
    const nextByKey = new Map<string, RenderItemContainer<T>>()
    const firstIndex = this._materializedStartIndex()
    const lastIndex = this._materializedEndIndex()

    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const item = this._items[index] as T
      if (item === undefined) continue
      const key = this._getKey(item, index)
      const disabled = this._isItemDisabled?.(item, index) ?? false
      let container = previous.get(key)
      if (container) {
        container.setItem(item, index, disabled)
        container.setLayoutOptions({
          minHeight: this._itemMinHeight,
          paddingY: this._itemPaddingY,
          showAccent: this._itemShowAccent,
          appearance: this._itemAppearance,
          style: this._itemStyle,
        })
      } else {
        container = new RenderItemContainer<T>({
          itemKey: key,
          item,
          index,
          disabled,
          minHeight: this._itemMinHeight,
          paddingY: this._itemPaddingY,
          showAccent: this._itemShowAccent,
          appearance: this._itemAppearance,
          style: this._itemStyle,
          template: this._itemTemplate,
        })
      }
      container.parent = this
      if (this.owner && container.owner !== this.owner) container.attach(this.owner)
      nextContainers.push(container)
      nextByKey.set(key, container)
    }

    for (const container of previous.values()) {
      if (nextByKey.has(container.itemKey)) continue
      container.parent = undefined
      if (container.owner) container.detach()
    }

    this._containers = nextContainers
    this._containersByKey = nextByKey
    if (this._selectedKey && (
      this._selectionMode !== 'single' ||
      this._indexForKey(this._selectedKey) < 0 ||
      this._containerDisabled(this._selectedKey) ||
      !this._containerSelectable(this._selectedKey)
    )) this._selectedKey = ''
    if (this._hoveredKey && this._indexForKey(this._hoveredKey) < 0) this._hoveredKey = ''
    if (this._focusedKey && this._indexForKey(this._focusedKey) < 0) this._focusedKey = ''
    if (this._focused && !this._focusedKey) this._focusedKey = this._selectedKey || this._firstEnabledKey()
    this._syncContainerStates()
  }

  private _syncContainerStates(): void {
    for (const container of this._containers) {
      container.setVisualState({
        selected: this._selectionMode === 'single' && container.itemKey === this._selectedKey,
        hovered: container.itemKey === this._hoveredKey,
        focused: this._focused && container.itemKey === this._focusedKey,
        disabled: this._itemDisabled(container.item, container.index),
      })
    }
  }

  private _clearInteractionState(): void {
    if (typeof window !== 'undefined' && FocusManager.instance.current === this) {
      FocusManager.instance.clearFocusOf(this)
    } else if (this._focused) {
      this.focusOut()
    }
    this._hoveredKey = ''
    this._templatePreservedHoverKey = ''
    this._focusedKey = ''
    this._pendingEnsureVisibleKey = ''
    this._vScrollbarController.reset()
    this._hScrollbarController.reset()
  }

  private _syncFocusRegistration(): void {
    if (typeof window === 'undefined') return
    if (this.disabled || !this.visible) {
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

  private _syncScrollBounds(): void {
    if (this._scrollMode === 'none') {
      this._scrollX.setOffset(0, { viewportSize: this._viewW, contentSize: this._contentWidth })
      this._scrollY.setOffset(0, { viewportSize: this._viewH, contentSize: this._contentHeight })
      return
    }
    this._scrollX.setOffset(this.scrollX, { viewportSize: this._viewW, contentSize: this._contentWidth })
    this._scrollY.setOffset(this.scrollY, { viewportSize: this._viewH, contentSize: this._contentHeight })
  }

  private _layoutContainers(
    maxCross: number,
    isVertical: boolean,
    spacing: number,
    context: LayoutContext,
  ): void {
    let cursor = 0
    let cross = 0
    this._contentOffsets.clear()
    this._itemMetrics = []
    this._itemMetricsByKey.clear()

    for (let index = 0; index < this._containers.length; index += 1) {
      const child = this._containers[index]!
      const childConstraints: BoxConstraints = isVertical
        ? {
            minWidth: maxCross === Infinity ? 0 : maxCross,
            maxWidth: maxCross,
            minHeight: 0,
            maxHeight: Infinity,
          }
        : {
            minWidth: 0,
            maxWidth: Infinity,
            minHeight: maxCross === Infinity ? 0 : maxCross,
            maxHeight: maxCross,
      }
      child.layout(childConstraints, true, context)
      this._contentOffsets.set(child, isVertical ? { x: 0, y: cursor } : { x: cursor, y: 0 })
      const mainSize = isVertical ? child.outerSize.height : child.outerSize.width
      const crossSize = isVertical ? child.outerSize.width : child.outerSize.height
      const metrics: ItemsControlItemMetrics = {
        key: child.itemKey,
        index,
        mainOffset: cursor,
        mainSize,
        crossSize,
      }
      this._itemMetrics.push(metrics)
      this._itemMetricsByKey.set(child.itemKey, metrics)
      cursor += mainSize
      if (index < this._containers.length - 1) cursor += spacing
      cross = Math.max(cross, crossSize)
    }

    this._contentWidth = isVertical ? cross : cursor
    this._contentHeight = isVertical ? cursor : cross
  }

  private _layoutVirtualContainers(
    maxCross: number,
    isVertical: boolean,
    spacing: number,
    context: LayoutContext,
  ): void {
    this._syncVirtualKeys()
    const virtualizer = this._virtualizer
    if (!virtualizer) {
      this._layoutContainers(maxCross, isVertical, spacing, context)
      return
    }
    virtualizer.setEstimatedItemSize(this._virtualization.estimatedItemMainSize + spacing)

    const viewportSize = this._estimatedViewportSize(isVertical)
    const scrollOffset = isVertical ? this.scrollY : this.scrollX
    this._virtualRange = virtualizer.calcRange({
      viewportSize,
      scrollOffset,
      overscan: this._virtualization.overscan,
    })
    this._reconcileContainers()
    const measuredChanged = this._layoutMaterializedContainers(maxCross, isVertical, spacing, context)
    if (measuredChanged) {
      const nextRange = virtualizer.calcRange({
        viewportSize,
        scrollOffset,
        overscan: this._virtualization.overscan,
      })
      if (!sameVirtualRange(this._virtualRange, nextRange)) {
        this._virtualRange = nextRange
        this._reconcileContainers()
        this._layoutMaterializedContainers(maxCross, isVertical, spacing, context)
      } else {
        this._virtualRange = nextRange
      }
    }
    this._syncVirtualMetrics(maxCross, isVertical, spacing)
    if (this._scrollPendingKeyIntoViewFromMetrics()) {
      this._virtualRange = virtualizer.calcRange({
        viewportSize: this._estimatedViewportSize(isVertical),
        scrollOffset: isVertical ? this.scrollY : this.scrollX,
        overscan: this._virtualization.overscan,
      })
      this._reconcileContainers()
      this._layoutMaterializedContainers(maxCross, isVertical, spacing, context)
      this._syncVirtualMetrics(maxCross, isVertical, spacing)
    }
  }

  private _layoutMaterializedContainers(
    maxCross: number,
    isVertical: boolean,
    spacing: number,
    context: LayoutContext,
  ): boolean {
    const virtualizer = this._virtualizer
    if (!virtualizer) return false
    let cross = 0
    let measuredChanged = false
    this._contentOffsets.clear()
    this._metricCrossSize = maxCross === Infinity ? 0 : maxCross
    this._metricSpacing = spacing

    for (const child of this._containers) {
      const childConstraints: BoxConstraints = isVertical
        ? {
            minWidth: maxCross === Infinity ? 0 : maxCross,
            maxWidth: maxCross,
            minHeight: 0,
            maxHeight: Infinity,
          }
        : {
            minWidth: 0,
            maxWidth: Infinity,
            minHeight: maxCross === Infinity ? 0 : maxCross,
            maxHeight: maxCross,
      }
      child.layout(childConstraints, true, context)
      const mainSize = isVertical ? child.outerSize.height : child.outerSize.width
      const crossSize = isVertical ? child.outerSize.width : child.outerSize.height
      const measuredMainSize = mainSize + (child.index < this._items.length - 1 ? spacing : 0)
      if (virtualizer.setMeasuredSize(child.itemKey, measuredMainSize)) measuredChanged = true
      this._contentOffsets.set(child, isVertical
        ? { x: 0, y: virtualizer.prefixIndex.offsetOf(child.index) }
        : { x: virtualizer.prefixIndex.offsetOf(child.index), y: 0 })
      cross = Math.max(cross, crossSize)
    }

    if (isVertical) {
      this._contentWidth = maxCross === Infinity ? cross : maxCross
      this._contentHeight = virtualizer.totalSize
    } else {
      this._contentWidth = virtualizer.totalSize
      this._contentHeight = maxCross === Infinity ? cross : maxCross
    }
    return measuredChanged
  }

  private _syncVirtualMetrics(maxCross: number, isVertical: boolean, spacing: number): void {
    const virtualizer = this._virtualizer
    if (!virtualizer) return
    this._itemMetrics = []
    this._itemMetricsByKey.clear()
    this._metricCrossSize = maxCross === Infinity ? 0 : maxCross
    this._metricSpacing = spacing
    for (const container of this._containers) {
      const metric = this._virtualMetricForIndex(container.index, isVertical)
      if (!metric) continue
      this._itemMetrics.push(metric)
      this._itemMetricsByKey.set(metric.key, metric)
    }
  }

  private _hitTestAdornerChildren(point: Offset): HitTestResult | null {
    const adornerChildren: RenderObject[] = []
    this.visitAdornerChildren(child => adornerChildren.push(child))
    for (let index = adornerChildren.length - 1; index >= 0; index -= 1) {
      const child = adornerChildren[index]!
      child.prepareForRenderOrHitTest()
      const childResult = new HitTestResult()
      if (child.hitTestPath(point, childResult)) return childResult
    }
    return null
  }

  private _hitTestMaterializedChildren(point: Offset): HitTestResult | null {
    if (!this._inViewport(point)) return null
    for (let index = this._containers.length - 1; index >= 0; index -= 1) {
      const child = this._containers[index]!
      child.prepareForRenderOrHitTest()
      const childResult = new HitTestResult()
      if (child.hitTestPath(point, childResult)) return childResult
    }
    return null
  }

  private _naturalSize(): { width: number; height: number } {
    return {
      width: this.maxWidth === undefined ? this._contentWidth : Math.min(this._contentWidth, this.maxWidth),
      height: this._contentHeight,
    }
  }

  private _naturalSizeWithStableScrolledViewport(
    constraints: BoxConstraints,
    isVertical: boolean,
    previousSize: { width: number; height: number },
    previousScrollX: number,
    previousScrollY: number,
  ): { width: number; height: number } {
    const natural = this._naturalSize()
    if (this._scrollMode !== 'auto') return natural
    if (isVertical) {
      const previousHeight = previousSize.height
      if (
        constraints.maxHeight === Infinity &&
        previousScrollY > 0 &&
        Number.isFinite(previousHeight) &&
        previousHeight > 0 &&
        this._contentHeight > previousHeight
      ) return { ...natural, height: Math.min(natural.height, previousHeight) }
      return natural
    }
    const previousWidth = previousSize.width
    if (
      constraints.maxWidth === Infinity &&
      previousScrollX > 0 &&
      Number.isFinite(previousWidth) &&
      previousWidth > 0 &&
      this._contentWidth > previousWidth
    ) return { ...natural, width: Math.min(natural.width, previousWidth) }
    return natural
  }

  private _scrollWheelAxis(axis: 'x' | 'y', delta: number): boolean {
    if (delta === 0) return false
    const amount = delta > 0 ? 60 : -60
    if (axis === 'x') {
      const before = this.scrollX
      this._scrollX.scrollBy(amount, { viewportSize: this._viewW, contentSize: this._contentWidth })
      return this.scrollX !== before
    }
    const before = this.scrollY
    this._scrollY.scrollBy(amount, { viewportSize: this._viewH, contentSize: this._contentHeight })
    return this.scrollY !== before
  }

  private _containsWheelAtBoundary(axis: 'x' | 'y', delta: number): boolean {
    if (delta === 0) return false
    if (axis === 'x') return this._showHBar
    return this._showVBar
  }

  private _syncContainerOffsets(): void {
    for (const container of this._containers) {
      const contentOffset = this._contentOffsets.get(container) ?? { x: 0, y: 0 }
      container.positionInSlot({
        x: contentOffset.x - this.scrollX,
        y: contentOffset.y - this.scrollY,
        width: container.outerSize.width,
        height: container.outerSize.height,
      }, 'start', 'start')
    }
  }

  private _paintScrollbars(dl: DrawList, offset: Offset): void {
    if (this._scrollMode === 'none') return
    const style = deriveScrollbarStyle(this.currentTheme)
    if (this._showVBar) {
      paintVBar({
        dl,
        style,
        trackX: offset.x + this.size.width - this._scrollbarSize,
        trackY: offset.y,
        trackW: this._scrollbarSize,
        trackH: this._viewH,
        viewSize: this._viewH,
        contentSize: this._contentHeight,
        scrollOffset: this.scrollY,
        state: this._vScrollbar,
      })
    }
    if (this._showHBar) {
      paintHBar({
        dl,
        style,
        trackX: offset.x,
        trackY: offset.y + this.size.height - this._scrollbarSize,
        trackW: this._viewW,
        trackH: this._scrollbarSize,
        viewSize: this._viewW,
        contentSize: this._contentWidth,
        scrollOffset: this.scrollX,
        state: this._hScrollbar,
      })
    }
  }

  private _inViewport(point: Offset): boolean {
    const g = this.globalOffset
    return point.x >= g.x && point.x <= g.x + this._viewW &&
      point.y >= g.y && point.y <= g.y + this._viewH
  }

  private _inVBar(point: Offset): boolean {
    return this._showVBar && hitTestScrollbarGeometry(point, this._vScrollbarGeometry())
  }

  private _inHBar(point: Offset): boolean {
    return this._showHBar && hitTestScrollbarGeometry(point, this._hScrollbarGeometry())
  }

  private _vScrollbarGeometry(): ScrollbarGeometry {
    const g = this.globalOffset
    return resolveScrollbarGeometryForState({
      axis: 'vertical',
      trackRect: { x: g.x + this.size.width - this._scrollbarSize, y: g.y, width: this._scrollbarSize, height: this._viewH },
      viewportSize: this._viewH,
      contentSize: this._contentHeight,
      scrollOffset: this.scrollY,
      style: deriveScrollbarStyle(this.currentTheme),
      state: this._vScrollbar,
    })
  }

  private _hScrollbarGeometry(): ScrollbarGeometry {
    const g = this.globalOffset
    return resolveScrollbarGeometryForState({
      axis: 'horizontal',
      trackRect: { x: g.x, y: g.y + this.size.height - this._scrollbarSize, width: this._viewW, height: this._scrollbarSize },
      viewportSize: this._viewW,
      contentSize: this._contentWidth,
      scrollOffset: this.scrollX,
      style: deriveScrollbarStyle(this.currentTheme),
      state: this._hScrollbar,
    })
  }

  private _containerAtPoint(point: Offset): RenderItemContainer<T> | null {
    for (let index = this._containers.length - 1; index >= 0; index -= 1) {
      const container = this._containers[index]!
      if (container.hitTest(point)) return container
    }
    return null
  }

  private _eventTargetsNestedInteractiveChild(event: PointerEvent, container: RenderItemContainer<T>): boolean {
    const entries = event.path?.path
    if (!entries) return false
    const containerIndex = entries.findIndex(entry => entry.target === container)
    if (containerIndex < 0) return false
    for (let index = containerIndex + 1; index < entries.length; index += 1) {
      const target = entries[index]!.target as {
        onPointerDown?: unknown
        onPointerMove?: unknown
        onPointerUp?: unknown
        onPointerCancel?: unknown
      }
      if (
        typeof target.onPointerDown === 'function' ||
        typeof target.onPointerMove === 'function' ||
        typeof target.onPointerUp === 'function' ||
        typeof target.onPointerCancel === 'function'
      ) return true
    }
    return false
  }

  private _selectContainer(container: RenderItemContainer<T>, notify: boolean): void {
    if (container.disabled || this._selectionMode !== 'single' || !this._containerSelectable(container)) return
    const changed = this._selectedKey !== container.itemKey
    this._selectedKey = container.itemKey
    this._focusedKey = container.itemKey
    this._syncContainerStates()
    this.markNeedsPaint()
    if (changed && notify) {
      this.onSelectionChange?.({
        item: container.item,
        index: container.index,
      })
    }
  }

  private _setHoveredKey(key: string, options: {
    refreshPreviousTemplate?: boolean
    refreshCurrentTemplate?: boolean
  } = {}): void {
    const refreshCurrentTemplate = options.refreshCurrentTemplate ?? true
    if (key === this._hoveredKey) {
      if (!key || !refreshCurrentTemplate || this._templatePreservedHoverKey !== key) return
      const current = this._containersByKey.get(key)
      current?.refreshTemplate()
      this._templatePreservedHoverKey = ''
      this.markNeedsPaint()
      return
    }
    const previous = this._hoveredKey ? this._containersByKey.get(this._hoveredKey) : undefined
    this._hoveredKey = key
    const container = key ? this._containersByKey.get(key) : undefined
    this.onItemHover?.(container?.item ?? null, container?.index ?? -1)
    const refreshPreviousTemplate = options.refreshPreviousTemplate ?? true
    if (previous) previous.setHoveredState(false, refreshPreviousTemplate)
    if (container) container.setHoveredState(true, refreshCurrentTemplate)
    this._templatePreservedHoverKey = key && !refreshCurrentTemplate ? key : ''
    this.markNeedsPaint()
  }

  private _focusKey(key: string): void {
    if (!key || key === this._focusedKey) return
    this._focusedKey = key
    this._ensureKeyVisible(key)
    this._syncContainerStates()
    this.markNeedsPaint()
  }

  private _focusedIndex(): number {
    const key = this._focusedKey || this._selectedKey
    return this._indexForKey(key)
  }

  private _enabledKeyFrom(index: number, delta: number): string {
    if (this._items.length === 0) return ''
    let cursor = index >= 0 ? index : (delta >= 0 ? -1 : this._items.length)
    for (let step = 0; step < this._items.length; step += 1) {
      cursor = Math.max(0, Math.min(this._items.length - 1, cursor + delta))
      const item = this._items[cursor]!
      const key = this._getKey(item, cursor)
      if (!this._itemDisabled(item, cursor)) return key
      if ((delta > 0 && cursor === this._items.length - 1) || (delta < 0 && cursor === 0)) break
    }
    return this._focusedKey
  }

  private _firstEnabledKey(): string {
    for (let index = 0; index < this._items.length; index += 1) {
      const item = this._items[index]!
      if (!this._itemDisabled(item, index)) return this._getKey(item, index)
    }
    return ''
  }

  private _lastEnabledKey(): string {
    for (let index = this._items.length - 1; index >= 0; index -= 1) {
      const item = this._items[index]!
      if (!this._itemDisabled(item, index)) return this._getKey(item, index)
    }
    return ''
  }

  private _containerDisabled(key: string): boolean {
    const item = this._itemForKey(key)
    return item ? this._itemDisabled(item.item, item.index) : false
  }

  private _containerSelectable(containerOrKey: RenderItemContainer<T> | string): boolean {
    const item = typeof containerOrKey === 'string'
      ? this._itemForKey(containerOrKey)
      : { item: containerOrKey.item, index: containerOrKey.index }
    if (!item) return false
    return this._isItemSelectable?.(item.item, item.index) ?? true
  }

  private _itemDisabled(item: T, index: number): boolean {
    return this.disabled || (this._isItemDisabled?.(item, index) ?? false)
  }

  private _keyForItem(item: T | null | undefined): string {
    if (!item) return ''
    const index = this._items.indexOf(item)
    if (index < 0) return ''
    return this._itemKeys[index] ?? ''
  }

  private _itemForKey(key: string): { item: T; index: number } | null {
    const index = this._indexForKey(key)
    if (index < 0) return null
    return { item: this._items[index]!, index }
  }

  private _indexForKey(key: string): number {
    if (!key) return -1
    return this._itemKeyIndex.get(key) ?? -1
  }

  private _syncItemKeys(): void {
    this._itemKeys = this._items.map((item, index) => this._getKey(item, index))
    this._itemKeyIndex.clear()
    for (let index = 0; index < this._itemKeys.length; index += 1) {
      const key = this._itemKeys[index]!
      if (!this._itemKeyIndex.has(key)) this._itemKeyIndex.set(key, index)
    }
    this._virtualKeysSynced = false
  }

  private _syncVirtualKeys(): void {
    if (!this._virtualizer) return
    if (this._virtualKeysSynced) return
    this._virtualizer.syncItems(this._itemKeys)
    this._virtualKeysSynced = true
  }

  private _materializedStartIndex(): number {
    if (!this._virtualization.enabled) return 0
    if (this._virtualRange && this._virtualRange.startIndex >= 0) {
      const focused = this._visibleFocusedIndex()
      return focused >= 0 ? Math.min(this._virtualRange.startIndex, focused) : this._virtualRange.startIndex
    }
    return 0
  }

  private _materializedEndIndex(): number {
    if (!this._virtualization.enabled) return this._items.length - 1
    if (this._items.length === 0) return -1
    if (this._virtualRange && this._virtualRange.endIndex >= 0) {
      const focused = this._visibleFocusedIndex()
      return focused >= 0 ? Math.max(this._virtualRange.endIndex, focused) : this._virtualRange.endIndex
    }
    const estimatedViewport = Math.max(this._virtualization.estimatedItemMainSize, this.height ?? this.maxHeight ?? 220)
    const estimatedCount = Math.ceil(estimatedViewport / this._virtualization.estimatedItemMainSize) + this._virtualization.overscan
    return Math.min(this._items.length - 1, Math.max(0, estimatedCount - 1))
  }

  private _visibleFocusedIndex(): number {
    if (!this._focused || !this._focusedKey) return -1
    const metric = this._itemMetricsByKey.get(this._focusedKey)
    if (!metric) return -1
    const scrollOffset = this._orientation === 'vertical' ? this.scrollY : this.scrollX
    const viewportSize = this._orientation === 'vertical' ? this._viewH : this._viewW
    const itemEnd = metric.mainOffset + metric.mainSize
    if (metric.mainOffset >= scrollOffset + viewportSize || itemEnd <= scrollOffset) return -1
    return metric.index
  }

  private _virtualItemMetrics(): ItemsControlItemMetrics[] {
    if (!this._virtualizer) return this._itemMetrics
    const metrics: ItemsControlItemMetrics[] = []
    for (let index = 0; index < this._items.length; index += 1) {
      const metric = this._virtualMetricForIndex(index, this._orientation === 'vertical')
      if (metric) metrics.push(metric)
    }
    return metrics
  }

  private _virtualMetricForKey(key: string): ItemsControlItemMetrics | undefined {
    if (!this._virtualizer) return undefined
    const index = this._indexForKey(key)
    if (index < 0) return undefined
    return this._virtualMetricForIndex(index, this._orientation === 'vertical')
  }

  private _virtualMetricForIndex(index: number, isVertical: boolean): ItemsControlItemMetrics | undefined {
    const virtualizer = this._virtualizer
    const key = this._itemKeys[index]
    if (!virtualizer || key === undefined) return undefined
    const measuredContainer = this._containersByKey.get(key)
    const virtualMainSize = virtualizer.getSize(index)
    const mainSize = measuredContainer
      ? (isVertical ? measuredContainer.size.height : measuredContainer.size.width)
      : Math.max(0, virtualMainSize - (index < this._items.length - 1 ? this._metricSpacing : 0))
    const crossSize = measuredContainer
      ? (isVertical ? measuredContainer.size.width : measuredContainer.size.height)
      : this._metricCrossSize
    return {
      key,
      index,
      mainOffset: virtualizer.prefixIndex.offsetOf(index),
      mainSize,
      crossSize,
    }
  }

  private _scrollPendingKeyIntoViewFromMetrics(): boolean {
    const key = this._pendingEnsureVisibleKey
    if (!key) return false
    this._pendingEnsureVisibleKey = ''
    const metric = this._itemMetricsByKey.get(key)
    if (!metric) return false
    if (this._orientation === 'vertical') {
      const before = this.scrollY
      this._scrollY.setOffset(this._scrollIntoView(
        this.scrollY,
        this._viewH,
        metric.mainOffset,
        metric.mainSize,
      ), { viewportSize: this._viewH, contentSize: this._contentHeight })
      return this.scrollY !== before
    }
    const before = this.scrollX
    this._scrollX.setOffset(this._scrollIntoView(
      this.scrollX,
      this._viewW,
      metric.mainOffset,
      metric.mainSize,
    ), { viewportSize: this._viewW, contentSize: this._contentWidth })
    return this.scrollX !== before
  }

  private _estimatedViewportSize(isVertical: boolean): number {
    const current = isVertical ? this._viewH : this._viewW
    if (current > 0) return current
    const explicit = isVertical ? this.height ?? this.maxHeight : this.maxWidth
    if (explicit !== undefined && explicit > 0) return explicit
    return 220
  }

  private _ensureKeyVisible(key: string): void {
    const index = this._indexForKey(key)
    if (index < 0) return
    if (this._virtualization.enabled) this._pendingEnsureVisibleKey = key
    const metric = this._itemMetricsByKey.get(key)
    if (this._orientation === 'vertical') {
      const next = metric
        ? this._scrollIntoView(this.scrollY, this._viewH, metric.mainOffset, metric.mainSize)
        : this._scrollOffsetToIndex(index, this._viewH, this.scrollY, 'nearest')
      this._scrollY.setOffset(next, { viewportSize: this._viewH, contentSize: this._contentHeight })
    } else {
      const next = metric
        ? this._scrollIntoView(this.scrollX, this._viewW, metric.mainOffset, metric.mainSize)
        : this._scrollOffsetToIndex(index, this._viewW, this.scrollX, 'nearest')
      this._scrollX.setOffset(next, { viewportSize: this._viewW, contentSize: this._contentWidth })
    }
    if (this._virtualization.enabled) this.markNeedsLayout()
    else this._syncContainerOffsets()
  }

  private _scrollIntoView(scrollOffset: number, viewportSize: number, itemStart: number, itemSize: number): number {
    const itemEnd = itemStart + itemSize
    const viewEnd = scrollOffset + viewportSize
    if (itemStart < scrollOffset) return itemStart
    if (itemEnd > viewEnd) return itemEnd - viewportSize
    return scrollOffset
  }

  private _scrollOffsetToIndex(index: number, viewportSize: number, currentOffset: number, align: ItemsControlScrollAlign): number {
    if (this._virtualizer) {
      return this._virtualizer.scrollToIndex({
        index,
        viewportSize,
        currentOffset,
        align,
      })
    }
    const metric = this._itemMetrics[index]
    if (!metric) return currentOffset
    if (align === 'start') return metric.mainOffset
    if (align === 'center') return metric.mainOffset - (viewportSize - metric.mainSize) / 2
    if (align === 'end') return metric.mainOffset + metric.mainSize - viewportSize
    return this._scrollIntoView(currentOffset, viewportSize, metric.mainOffset, metric.mainSize)
  }

  private get _scrollbarSize(): number {
    return deriveScrollbarStyle(this.currentTheme).gutterSize
  }

  private get _viewW(): number {
    return this._viewport.width
  }

  private get _viewH(): number {
    return this._viewport.height
  }

  private get _showVBar(): boolean {
    return this._viewport.showVBar
  }

  private get _showHBar(): boolean {
    return this._viewport.showHBar
  }

  private get _viewport(): ItemsControlViewportState {
    const width = Math.max(0, this.size.width)
    const height = Math.max(0, this.size.height)
    if (this._scrollMode !== 'auto') {
      return { width, height, showVBar: false, showHBar: false }
    }

    const scrollbarSize = this._scrollbarSize
    let showVBar = this._contentHeight > height
    let showHBar = this._contentWidth > width

    for (let iteration = 0; iteration < 2; iteration += 1) {
      const viewportWidth = Math.max(0, width - (showVBar ? scrollbarSize : 0))
      const viewportHeight = Math.max(0, height - (showHBar ? scrollbarSize : 0))
      const nextShowVBar = this._contentHeight > viewportHeight
      const nextShowHBar = this._contentWidth > viewportWidth
      if (nextShowVBar === showVBar && nextShowHBar === showHBar) break
      showVBar = nextShowVBar
      showHBar = nextShowHBar
    }

    return {
      width: Math.max(0, width - (showVBar ? scrollbarSize : 0)),
      height: Math.max(0, height - (showHBar ? scrollbarSize : 0)),
      showVBar,
      showHBar,
    }
  }
}

function normalizeVirtualizationOptions(
  options: ItemsControlVirtualizationOptions | undefined,
): Required<ItemsControlVirtualizationOptions> {
  const estimated = options?.estimatedItemMainSize
  const overscan = options?.overscan
  return {
    enabled: options?.enabled ?? false,
    estimatedItemMainSize: Number.isFinite(estimated) && estimated !== undefined
      ? Math.max(1, estimated)
      : 40,
    overscan: Number.isFinite(overscan) && overscan !== undefined
      ? Math.max(0, Math.floor(overscan))
      : 2,
  }
}

function sameVirtualRange(left: VariableVirtualRange | null, right: VariableVirtualRange | null): boolean {
  if (!left || !right) return left === right
  return left.startIndex === right.startIndex &&
    left.endIndex === right.endIndex &&
    left.visibleStartIndex === right.visibleStartIndex &&
    left.visibleEndIndex === right.visibleEndIndex
}
