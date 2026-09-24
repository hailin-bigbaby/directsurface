import { FocusManager } from '../core/focus_manager'
import type { Focusable } from '../core/focus_manager'
import type { CopyableSelection } from '../core/clipboard'
import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../core/render_object'
import type { PointerEvent, WheelPointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import { pointerKey } from '../gestures/pointer_identity'
import { ScrollbarAxisController } from '../gestures/scrollbar_interaction_controller'
import { RenderBox, type RenderBoxOptions } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { hitTestScrollbarGeometry, paintVBar, resolveScrollbarGeometryForState, type ScrollbarGeometry } from '../rendering/scrollbar'
import {
  deriveListViewStyle,
  deriveScrollbarStyle,
  resolveBgColor,
  resolveTextColor,
  type ListViewStyleTokens,
  type ScrollbarStyleTokens,
} from '../theme/component_styles'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { calcFixedVirtualRange } from '../virtualization/fixed_virtual_range'
import { ScrollController } from '../virtualization/scroll_controller'
import { paintIconGlyph, type IconName } from './icon'

export interface ListViewItem<T = unknown> {
  key: string
  label: string
  icon?: IconName
  trailingText?: string
  disabled?: boolean
  data?: T
}

export class RenderListView<T = unknown> extends RenderBox implements InteractiveRenderObject, Focusable, CopyableSelection {
  static override debugTypeName = 'RenderListView'
  onSelect?: (item: ListViewItem<T>, index: number) => void
  onActivate?: (item: ListViewItem<T>, index: number) => void

  private _items: ListViewItem<T>[]
  private _selectedKey = ''
  private _hoveredKey = ''
  private _focusedIndex = -1
  private _focused = false
  private _focusRegistered = false
  private _disabled: boolean
  private _scroll = new ScrollController()
  private readonly _vScrollbarController = new ScrollbarAxisController('vertical')
  private readonly _vScrollbar = this._vScrollbarController.state
  private _rowHeight: number
  private _copyable: boolean
  private _copyText?: (item: ListViewItem<T>, index: number) => string | null | undefined

  constructor(options: RenderBoxOptions & {
    items: ListViewItem<T>[]
    selectedItem?: ListViewItem<T> | null
    defaultSelectedItem?: ListViewItem<T> | null
    onSelect?: (item: ListViewItem<T>, index: number) => void
    onActivate?: (item: ListViewItem<T>, index: number) => void
    disabled?: boolean
    copyable?: boolean
    copyText?: (item: ListViewItem<T>, index: number) => string | null | undefined
  }) {
    super(options)
    this._items = options.items.slice()
    this._selectedKey = this._keyForItem(options.selectedItem ?? options.defaultSelectedItem ?? null)
    this.onSelect = options.onSelect
    this.onActivate = options.onActivate
    this._rowHeight = deriveListViewStyle(ImGuiDarkTheme).rowHeight
    this._disabled = options.disabled ?? false
    this._copyable = options.copyable ?? true
    this._copyText = options.copyText
    this._syncItemsState()
    this._syncFocusRegistration()
  }

  get items(): ListViewItem<T>[] { return this._items }
  set items(items: ListViewItem<T>[]) {
    this._items = items.slice()
    this._syncItemsState()
    this.markNeedsLayout()
  }

  get selectedItem(): ListViewItem<T> | null {
    return this._items.find(item => item.key === this._selectedKey) ?? null
  }
  set selectedItem(item: ListViewItem<T> | null) {
    const key = this._keyForItem(item)
    if (key === this._selectedKey) return
    this._selectedKey = key
    this.markNeedsPaint()
  }

  get disabled(): boolean { return this._disabled }
  set disabled(disabled: boolean) {
    if (this._disabled === disabled) return
    this._disabled = disabled
    if (disabled) this._clearInteractionState()
    this._syncFocusRegistration()
    this.markNeedsPaint()
  }

  focusIn(): void {
    if (this.disabled || !this.visible) return
    this._focused = true
    if (this._focusedIndex < 0 && this._items.length > 0) {
      this._focusedIndex = this._selectedIndex() >= 0 ? this._selectedIndex() : 0
    }
    this.markNeedsPaint()
  }

  focusOut(): void {
    this._focused = false
    this.markNeedsPaint()
  }

  get isFocused(): boolean { return this._focused }

  getCopyText(): string | null {
    if (this.disabled || !this._copyable) return null
    const selectedIndex = this._selectedIndex()
    const index = selectedIndex >= 0 ? selectedIndex : this._focusedIndex
    const item = index >= 0 ? this._items[index] : undefined
    if (!item) return null
    const text = this._copyText ? this._copyText(item, index) : item.label
    return text ?? null
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    this._rowHeight = deriveListViewStyle(context.theme).rowHeight
    this.size = constrainSize(constraints, {
      width: constraints.maxWidth === Infinity ? 240 : constraints.maxWidth,
      height: constraints.maxHeight === Infinity ? 220 : constraints.maxHeight,
    })
    if (context.pass === 'measure') return
    this._clampState()
  }

  debugState(): {
    scrollY: number
    selectedItem: ListViewItem<T> | null
    selectedIndex: number
    hoveredKey: string
    focusedIndex: number
    rowHeight: number
  } {
    return {
      scrollY: this._scroll.offset,
      selectedItem: this.selectedItem,
      selectedIndex: this._selectedIndex(),
      hoveredKey: this._hoveredKey,
      focusedIndex: this._focusedIndex,
      rowHeight: this._rowHeight,
    }
  }

  onPointerDown(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (this.disabled) return
    if (!this.hitTest(event.position)) {
      FocusManager.instance.clearFocus()
      return
    }
    const scrollbarResult = this._vScrollbarController.beginPointer(
      event.position,
      this._scrollbarGeometry(),
      pointerKey(event),
    )
    if (scrollbarResult.handled) {
      event.stopPropagation?.()
      event.preventActivation?.()
      if (scrollbarResult.capturePointer) event.setPointerCapture?.()
      if (scrollbarResult.scrollOffset !== undefined) {
        this._scroll.setOffset(scrollbarResult.scrollOffset, {
          viewportSize: this._viewH,
          contentSize: this._totalH,
        })
      }
      this.markNeedsPaint()
      return
    }
    this._focused = true
    FocusManager.instance.setFocus(this)
    const index = this._indexAtPoint(event.position)
    if (index < 0) return
    const item = this._items[index]!
    if (item.disabled) return
    this._focusedIndex = index
    this._selectedKey = item.key
    this.onSelect?.(item, index)
    this.markNeedsPaint()
  }

  onPointerMove(event: PointerEvent): void {
    if (this.disabled) return
    if (this._vScrollbar.dragging) {
      const result = this._vScrollbarController.updatePointer(
        event.position,
        this._scrollbarGeometry(),
        pointerKey(event),
      )
      if (!result.handled) return
      event.stopPropagation?.()
      this._scroll.setOffset(result.scrollOffset ?? this._scroll.offset, {
        viewportSize: this._viewH,
        contentSize: this._totalH,
      })
      this.markNeedsPaint()
      return
    }

    if (!this.hitTest(event.position)) {
      const hadHover = this._hoveredKey || this._vScrollbarController.clearHover()
      this._hoveredKey = ''
      if (hadHover) this.markNeedsPaint()
      return
    }

    if (this._vScrollbarController.updateHover(event.position, this._scrollbarGeometry())) this.markNeedsPaint()
    const hoveredScrollbar = this._vScrollbar.hovered
    if (hoveredScrollbar) {
      if (this._hoveredKey) {
        this._hoveredKey = ''
        this.markNeedsPaint()
      }
      return
    }

    const index = this._indexAtPoint(event.position)
    const nextKey = index >= 0 ? this._items[index]?.key ?? '' : ''
    if (nextKey !== this._hoveredKey) {
      this._hoveredKey = nextKey
      this.markNeedsPaint()
    }
  }

  onPointerUp(event: PointerEvent): void {
    if (this.disabled) return
    const key = pointerKey(event)
    if (this._vScrollbar.dragging && !this._vScrollbarController.ownsPointer(key)) return
    const result = this._vScrollbarController.endPointer(event.position, this._scrollbarGeometry(), key)
    if (result.dragEnded) {
      event.stopPropagation?.()
      event.releasePointerCapture?.()
    }
    if (result.dragEnded) {
      this.markNeedsPaint()
      return
    }
    if (!this.hitTest(event.position)) return
    if (this._inScrollbar(event.position)) return
    const index = this._indexAtPoint(event.position)
    if (index < 0) return
    const item = this._items[index]!
    if (item.disabled) return
    if (item.key === this._selectedKey) this.onActivate?.(item, index)
  }

  onPointerCancel(event: PointerEvent): void {
    const key = pointerKey(event)
    if (this._vScrollbar.dragging && !this._vScrollbarController.ownsPointer(key)) return
    if (this._vScrollbar.dragging) {
      event.stopPropagation?.()
      event.releasePointerCapture?.()
    }
    this._vScrollbarController.cancelPointer(key)
    this._hoveredKey = ''
  }

  onPointerLeave(_event: PointerEvent): void {
    const hadHover = this._hoveredKey || this._vScrollbarController.clearHover()
    this._hoveredKey = ''
    if (hadHover) this.markNeedsPaint()
  }

  onWheel(event: WheelPointerEvent): boolean {
    if (this.disabled || !this.hitTest(event.position)) return false
    if (event.deltaY === 0) return false
    const scrollable = this._totalH > this._viewH
    const before = this._scroll.offset
    this._scroll.scrollBy(event.deltaY > 0 ? 60 : -60, { viewportSize: this._viewH, contentSize: this._totalH })
    if (this._scroll.offset === before) return scrollable
    this.markNeedsPaint()
    return true
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.disabled || !this._focused || this._items.length === 0) return false
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      this._moveFocus(1)
      return true
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      this._moveFocus(-1)
      return true
    }
    if (event.key === 'Home') {
      event.preventDefault()
      this._focusItem(0)
      return true
    }
    if (event.key === 'End') {
      event.preventDefault()
      this._focusItem(this._items.length - 1)
      return true
    }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      const index = this._focusedIndex
      if (index < 0) return true
      const item = this._items[index]!
      if (item.disabled) return true
      this._selectedKey = item.key
      this.onSelect?.(item, index)
      if (event.key === 'Enter') this.onActivate?.(item, index)
      this.markNeedsPaint()
      return true
    }
    return false
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const s = this._listTokens(context.theme)
    const sb = this._scrollbarTokens(context.theme)
    const { x, y } = offset
    const { width: w, height: h } = this.size
    const hasVScrollbar = this._totalH > this._viewH
    const contentW = this._contentWidth(sb)

    dl.fillRect(x, y, w, h, s.panelBg, s.borderRadius)
    dl.strokeRect(x, y, w, h, s.panelBorder, 1, s.borderRadius)
    dl.pushClip(x, y, contentW, h)

    const range = calcFixedVirtualRange({
      itemCount: this._items.length,
      itemSize: this._rowHeight,
      viewportSize: this._viewH,
      scrollOffset: this._scroll.offset,
      overscan: 1,
    })
    this._scroll.setOffset(range.scrollOffset, { viewportSize: this._viewH, contentSize: this._totalH })

    if (range.startIndex >= 0) {
      for (let index = range.startIndex; index <= range.endIndex; index += 1) {
        const item = this._items[index]!
        const rowY = y + index * this._rowHeight - this._scroll.offset
        const rowState = {
          disabled: this.disabled || item.disabled,
          selected: item.key === this._selectedKey,
          hovered: item.key === this._hoveredKey,
          focused: this._focused && index === this._focusedIndex,
        }
        if (rowState.disabled || rowState.selected || rowState.hovered) {
          dl.fillRect(x, rowY, contentW, this._rowHeight, resolveBgColor(s.rowBg, rowState), 0)
        }
        if (!rowState.disabled && rowState.focused) {
          dl.strokeRect(x + 1, rowY + 1, Math.max(0, contentW - 2), this._rowHeight - 2, resolveBgColor(s.rowBorder, 'focused'), 1, 0)
        }

        let cursorX = x + s.paddingH
        if (item.icon) {
          const iconSize = Math.max(14, s.fontSize)
          paintIconGlyph(context, {
            name: item.icon,
            x: cursorX,
            y: rowY + (this._rowHeight - iconSize) / 2,
            size: iconSize,
            color: resolveTextColor(s.iconText, rowState),
          })
          cursorX += iconSize + 8
        }

        const trailingWidth = item.trailingText
          ? 8 + item.trailingText.length * s.fontSize * 0.6
          : 0
        const textRight = x + contentW - s.paddingH - trailingWidth
        dl.pushClip(cursorX, rowY, Math.max(0, textRight - cursorX), this._rowHeight)
        dl.fillText(
          item.label,
          cursorX,
          rowY + this._rowHeight / 2,
          resolveTextColor(s.labelText, rowState),
          s.fontSize,
          s.fontFamily,
          'left',
          'middle',
        )
        dl.popClip()

        if (item.trailingText) {
          dl.fillText(
            item.trailingText,
            x + contentW - s.paddingH,
            rowY + this._rowHeight / 2,
            resolveTextColor(s.trailingText, rowState),
            s.fontSize,
            s.fontFamily,
            'right',
            'middle',
          )
        }
      }
    }

    dl.popClip()
    if (hasVScrollbar) {
      paintVBar({
        dl,
        style: sb,
        trackX: x + contentW,
        trackY: y,
        trackW: sb.gutterSize,
        trackH: h,
        viewSize: this._viewH,
        contentSize: this._totalH,
        scrollOffset: this._scroll.offset,
        state: this._vScrollbar,
      })
    }
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

  private _containsKey(key: string): boolean {
    return !!key && this._items.some(item => item.key === key)
  }

  private _containsSelectableKey(key: string): boolean {
    return !!key && this._items.some(item => item.key === key && !item.disabled)
  }

  private _keyForItem(item: ListViewItem<T> | null | undefined): string {
    if (!item) return ''
    const index = this._items.indexOf(item)
    if (index < 0 || item.disabled) return ''
    return item.key
  }

  private _selectedIndex(): number {
    return this._items.findIndex(item => item.key === this._selectedKey)
  }

  private _syncItemsState(): void {
    if (this._selectedKey && !this._containsSelectableKey(this._selectedKey)) this._selectedKey = ''
    if (this._hoveredKey && !this._containsKey(this._hoveredKey)) this._hoveredKey = ''
    if (this._focusedIndex >= this._items.length) this._focusedIndex = this._items.length - 1
    if (this._focusedIndex < 0 && this._selectedKey) this._focusedIndex = this._selectedIndex()
    this._clampState()
  }

  private _clearInteractionState(): void {
    if (typeof window !== 'undefined' && FocusManager.instance.current === this) {
      FocusManager.instance.clearFocusOf(this)
    } else if (this._focused) {
      this.focusOut()
    }
    this._hoveredKey = ''
    this._focusedIndex = -1
    this._vScrollbarController.reset()
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

  private _moveFocus(delta: number): void {
    if (this._items.length === 0) return
    const start = this._focusedIndex >= 0 ? this._focusedIndex : (this._selectedIndex() >= 0 ? this._selectedIndex() : 0)
    let index = start
    for (let step = 0; step < this._items.length; step += 1) {
      index = Math.max(0, Math.min(this._items.length - 1, index + delta))
      if (!this._items[index]?.disabled) {
        this._focusItem(index)
        return
      }
      if ((delta > 0 && index === this._items.length - 1) || (delta < 0 && index === 0)) break
    }
  }

  private _focusItem(index: number): void {
    if (index < 0 || index >= this._items.length) return
    this._focusedIndex = index
    this._scroll.scrollToIndex({
      itemCount: this._items.length,
      itemSize: this._rowHeight,
      viewportSize: this._viewH,
      index,
      align: 'nearest',
    })
    this.markNeedsPaint()
  }

  private _clampState(): void {
    this._scroll.setOffset(this._scroll.offset, { viewportSize: this._viewH, contentSize: this._totalH })
  }

  private _indexAtPoint(point: Offset): number {
    const g = this.globalOffset
    const relY = point.y - g.y + this._scroll.offset
    const index = Math.floor(relY / this._rowHeight)
    return index >= 0 && index < this._items.length ? index : -1
  }

  private _inScrollbar(point: Offset): boolean {
    return hitTestScrollbarGeometry(point, this._scrollbarGeometry())
  }

  private _scrollbarGeometry(): ScrollbarGeometry {
    const g = this.globalOffset
    const scrollbarW = this._scrollbarWidth()
    return resolveScrollbarGeometryForState({
      axis: 'vertical',
      trackRect: { x: g.x + this.size.width - scrollbarW, y: g.y, width: scrollbarW, height: this.size.height },
      viewportSize: this._viewH,
      contentSize: this._totalH,
      scrollOffset: this._scroll.offset,
      style: deriveScrollbarStyle(this.currentTheme),
      state: this._vScrollbar,
    })
  }

  private _scrollbarWidth(): number {
    return deriveScrollbarStyle(this.currentTheme).gutterSize
  }

  private _contentWidth(style: ScrollbarStyleTokens = this._scrollbarTokens()): number {
    return Math.max(0, this.size.width - (this._totalH > this._viewH ? style.gutterSize : 0))
  }

  private get _viewH(): number {
    return this.size.height
  }

  private get _totalH(): number {
    return this._items.length * this._rowHeight
  }

  private _listTokens(theme = this.currentTheme): ListViewStyleTokens {
    return deriveListViewStyle(theme)
  }

  private _scrollbarTokens(theme = this.currentTheme): ScrollbarStyleTokens {
    return deriveScrollbarStyle(theme)
  }
}
