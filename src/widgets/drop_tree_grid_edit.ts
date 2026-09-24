import { FocusManager, type Focusable } from '../core/focus_manager'
import {
  type PopupAnchor,
  type PopupAnchorTarget,
  GET_POPUP_ANCHOR_RECT,
  resolvePopupAnchorRect,
  resolvePopupAnchorTarget,
} from '../core/popup_anchor'
import { PopupManager, clampRectToPopupViewport, type PopupContext } from '../core/popup_manager'
import { ResizablePopupPanelShell, type PopupResizablePanelLayout } from '../core/popup_shell'
import type { BoxConstraints, LayoutContext, Offset, RenderObject } from '../core/render_object'
import { runCleanupSteps, type DisposeFn } from '../core/disposable'
import { TextMeasurer } from '../core/text_measurer'
import { isPrimaryPointerButton, type PointerEvent as PopupPointerEvent, type WheelPointerEvent } from '../gestures/hit_test'
import type { InteractiveRenderObject, PointerEvent } from '../gestures/recognizers'
import { RenderBox } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import { paintSingleLineText } from '../rendering/text_painter'
import type { PaintContext } from '../rendering/paint_context'
import { drawPopupPanel } from '../rendering/popup_painter'
import {
  blendColor,
  deriveGridCellStyle,
  deriveDropdownStyle,
  derivePopupStyle,
  deriveScrollbarStyle,
  deriveTextInputStyle,
  deriveWindowChromeStyle,
  resolveBgColor,
  resolveTextColor,
  type PopupStyleTokens,
  type TextInputStyleTokens,
} from '../theme/component_styles'
import type { ResolvedTheme } from '../theme/theme'
import { layoutFormFieldInlineContent, measureFormFieldHeight, pointInFormFieldRect, type FormFieldStatus } from './form_field_shell'
import { paintTriggerFieldShell } from './trigger_field_shell'
import { paintIconGlyph } from './icon'
import { PopupTextInput } from './popup_text_input'
import { RenderTreeGrid, type TreeGridNode } from './tree_grid'
import type { GridColumnDef } from './grid/grid_types'
import {
  ValueEditorEventEmitter,
  type ValueEditor,
  type ValueEditorValueChangeListener,
} from './value_editor'

type DropTreeGridLayout = PopupResizablePanelLayout & {
  theme: ResolvedTheme
  popupStyle: PopupStyleTokens
  inputStyle: TextInputStyleTokens
  minPanelW: number
  minPanelH: number
  panelX: number
  panelY: number
  panelW: number
  panelH: number
  itemH: number
  headerH: number
  colWidths: number[]
  searchInputH: number
  searchH: number
  gridH: number
  searchRect: { x: number; y: number; w: number; h: number } | null
  gridRect: { x: number; y: number; w: number; h: number }
}

export interface DropTreeGridEditQueryContext<T extends Record<string, any> = any> {
  query: string
  roots: readonly TreeGridNode<T>[]
  columns: readonly GridColumnDef<T>[]
  treeColumnKey: keyof T & string
  labelKey: keyof T & string
  selectedValue: string
}

export interface DropTreeGridEditExpandOnOpenContext<T extends Record<string, any> = any> {
  roots: readonly TreeGridNode<T>[]
  selectedValue: string
}

export type DropTreeGridEditQueryProcessor<T extends Record<string, any> = any> =
  (context: DropTreeGridEditQueryContext<T>) => TreeGridNode<T>[]

export type DropTreeGridEditQueryTextBuilder<T extends Record<string, any> = any> =
  (node: TreeGridNode<T>) => string[]

export type DropTreeGridEditExpandedKeysResolver<T extends Record<string, any> = any> =
  (context: DropTreeGridEditExpandOnOpenContext<T>) => readonly string[]

export interface DropTreeGridEditDebugState {
  popupVisible: boolean
  queryText: string
  showQueryInField: boolean
  displayText: string
  focused: boolean
  disabled: boolean
  readonly: boolean
  value: string
  selectedLabel: string
  filteredCount: number
  expandedKeys: string[]
}

export type DropTreeGridEditValueChangeReason = 'selection' | 'clear'

export interface DropTreeGridPopupDebugState {
  searchText: string
  searchable: boolean
  selectedValue: string
  filteredCount: number
  expandedKeys: string[]
  panelX: number
  panelY: number
  panelW: number
  panelH: number
  anchorRect: { x: number; y: number; w: number; h: number }
  gridRect: { x: number; y: number; w: number; h: number }
  resizeGripRect: { x: number; y: number; w: number; h: number }
}

export interface DropTreeGridPopupOpenOptions<T extends Record<string, any> = any> {
  anchor: PopupAnchor
  columns: GridColumnDef<T>[]
  treeColumnKey: keyof T & string
  selectedValue: string
  searchable: boolean
  maxVisibleItems: number
  initialQuery: string
  resolveRoots: (query: string) => TreeGridNode<T>[]
  onSelect: (node: TreeGridNode<T>) => boolean | void
  onSearchTextChange?: (value: string) => void
  onClose: () => void
  openExpandedKeys?: readonly string[]
}

export class DropTreeGridPopup<T extends Record<string, any> = any> extends ResizablePopupPanelShell {
  private static readonly MIN_PANEL_WIDTH = 280
  private static readonly MIN_FLEX_COL_WIDTH = 80
  private static readonly RESIZE_GRIP_SIZE = 16

  private readonly _searchInput = new PopupTextInput(() => PopupManager.instance.requestPaint())
  private _grid: RenderTreeGrid<T> | null = null
  private _anchor?: PopupAnchor
  private _columns: GridColumnDef<T>[] = []
  private _treeColumnKey: keyof T & string = '' as keyof T & string
  private _selectedValue = ''
  private _searchable = false
  private _maxVisibleItems = 8
  private _searchText = ''
  private _resolveRoots?: (query: string) => TreeGridNode<T>[]
  private _onSelect?: (node: TreeGridNode<T>) => boolean | void
  private _onSearchTextChange?: (value: string) => void
  private _onClose?: () => void
  private _expandedKeys = new Set<string>()

  get columns(): GridColumnDef<T>[] { return this._columns }

  set columns(columns: GridColumnDef<T>[]) {
    if (columns === this._columns) return
    this._columns = columns
    this._syncGrid()
    PopupManager.instance.requestPaint()
  }

  get treeColumnKey(): keyof T & string { return this._treeColumnKey }

  set treeColumnKey(key: keyof T & string) {
    if (key === this._treeColumnKey) return
    this._treeColumnKey = key
    this._syncGrid()
    PopupManager.instance.requestPaint()
  }

  get selectedValue(): string { return this._selectedValue }

  set selectedValue(value: string) {
    const nextValue = String(value ?? '')
    if (nextValue === this._selectedValue) return
    this._selectedValue = nextValue
    if (this._grid) {
      this._grid.selectedKey = nextValue
      this._grid.expandedKeys = this._defaultExpandedKeys()
      this._grid.revealNode(nextValue)
    }
    PopupManager.instance.requestPaint()
  }

  get searchText(): string { return this._searchText }

  get expandedKeys(): string[] {
    return this._grid ? this._grid.expandedKeys : [...this._expandedKeys]
  }

  get filteredRoots(): TreeGridNode<T>[] {
    return this._resolveRoots ? this._resolveRoots(this._searchText) : []
  }

  get filteredCount(): number {
    return this._grid ? countTreeGridNodes(this._grid.roots) : 0
  }

  debugState(): DropTreeGridPopupDebugState {
    const popupContext = PopupManager.instance.context
    const layout = this._layout(popupContext)
    const anchorRect = this._anchor
      ? resolvePopupAnchorRect(this._anchor)
      : { x: 0, y: 0, w: 240, h: deriveTextInputStyle(popupContext.theme).height }
    return {
      searchText: this._searchText,
      searchable: this._searchable,
      selectedValue: this._selectedValue,
      filteredCount: this.filteredCount,
      expandedKeys: this.expandedKeys,
      panelX: layout.panelX,
      panelY: layout.panelY,
      panelW: layout.panelW,
      panelH: layout.panelH,
      anchorRect,
      gridRect: layout.gridRect,
      resizeGripRect: layout.resizeGripRect,
    }
  }

  refresh(): void {
    this._syncGrid()
    PopupManager.instance.requestPaint()
  }

  open(options: DropTreeGridPopupOpenOptions<T>): void {
    if (this.visible) this.close()
    this._anchor = options.anchor
    this._columns = options.columns
    this._treeColumnKey = options.treeColumnKey
    this._selectedValue = options.selectedValue
    this._searchable = options.searchable
    this._maxVisibleItems = options.maxVisibleItems
    this._resolveRoots = options.resolveRoots
    this._onSelect = options.onSelect
    this._onSearchTextChange = options.onSearchTextChange
    this._onClose = options.onClose
    this._searchText = options.initialQuery
    if (options.openExpandedKeys) this._expandedKeys = new Set(options.openExpandedKeys)
    this._grid = this._createGrid()
    this.openPopup({ owner: resolvePopupAnchorTarget(options.anchor) })
    if (this._searchable) {
      this._searchInput.beginSession({
        value: this._searchText,
        placeholder: '搜索...',
        onInput: value => {
          this._searchText = value
          this._syncGrid()
          this._onSearchTextChange?.(value)
          PopupManager.instance.requestPaint()
        },
        onCompositionUpdate: () => {
          PopupManager.instance.requestPaint()
        },
        onCompositionEnd: value => {
          this._searchText = value
          this._syncGrid()
          this._onSearchTextChange?.(value)
          PopupManager.instance.requestPaint()
        },
        onKeyDown: event => {
          this._handleNavigationKey(event)
        },
      })
    } else if (this._grid) {
      FocusManager.instance.setFocus(this._grid)
    }
    PopupManager.instance.requestPaint()
  }

  onOutsidePointerDown(event: PopupPointerEvent): boolean {
    if (!this._anchor) return false
    const rect = resolvePopupAnchorRect(this._anchor)
    const hitAnchor = event.position.x >= rect.x &&
      event.position.x <= rect.x + rect.w &&
      event.position.y >= rect.y &&
      event.position.y <= rect.y + rect.h
    if (!hitAnchor) return false
    this.close()
    return true
  }

  override onEscape(event: KeyboardEvent): boolean {
    if (!this.visible) return false
    event.preventDefault()
    this.close()
    return true
  }

  onKeyDown(event: KeyboardEvent): boolean {
    return this._handleNavigationKey(event)
  }

  paint(context: PaintContext): void {
    if (!this.visible) return
    const popupContext = PopupManager.instance.context
    const layout = this._layout(popupContext)
    this._syncGridLayout(layout, popupContext)
    const dl = new DrawList(context)
    drawPopupPanel(dl, layout.panelX, layout.panelY, layout.panelW, layout.panelH, layout.popupStyle)
    if (layout.searchRect) {
      this._searchInput.paint(context, layout.searchRect, context.theme)
    }
    if (this._grid) {
      this._grid.paint(context, this._grid.offset)
      if (this.filteredRoots.length === 0) {
        dl.fillText(
          '无匹配节点',
          layout.gridRect.x + 8,
          layout.gridRect.y + layout.gridRect.h / 2,
          layout.popupStyle.textDisabled,
          layout.popupStyle.fontSize,
          layout.popupStyle.fontFamily,
          'left',
          'middle',
        )
      }
    }
    this._paintResizeGrip(dl, layout)
  }

  disposePopup(): void {
    this.close()
    this._teardownGrid()
    this._searchInput.dispose()
  }

  protected override getResizablePanelLayout(popupContext: PopupContext): PopupResizablePanelLayout {
    return this._layout(popupContext)
  }

  protected override getMinPanelWidth(layout: PopupResizablePanelLayout): number {
    return (layout as DropTreeGridLayout).minPanelW
  }

  protected override getMinPanelHeight(layout: PopupResizablePanelLayout): number {
    return (layout as DropTreeGridLayout).minPanelH
  }

  protected override onPanelPointerDown(event: PopupPointerEvent, popupContext: PopupContext, layout: PopupResizablePanelLayout): void {
    if (!isPrimaryPointerButton(event)) return
    const typed = layout as DropTreeGridLayout
    if (typed.searchRect && this._searchInput.hitTest(event.position, typed.searchRect)) {
      this._cancelGridPointerState(event)
      this._searchInput.handlePointerDown(event.position, typed.searchRect, event.clickCount)
      return
    }
    this._grid?.onPointerDown(event)
  }

  protected override onPanelPointerMove(event: PopupPointerEvent, popupContext: PopupContext, layout: PopupResizablePanelLayout): void {
    const typed = layout as DropTreeGridLayout
    if (typed.searchRect && this._searchInput.hitTest(event.position, typed.searchRect)) {
      this._cancelGridPointerState(event)
      this._searchInput.handlePointerMove(event.position)
      return
    }
    this._searchInput.handlePointerCancel()
    this._grid?.onPointerMove(event)
  }

  protected override onPanelPointerUp(event: PopupPointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    this._searchInput.handlePointerUp()
    this._grid?.onPointerUp(event)
  }

  protected override onPanelPointerCancel(event: PopupPointerEvent): void {
    this._searchInput.handlePointerCancel()
    this._grid?.onPointerCancel(event)
  }

  protected override onPanelWheel(event: WheelPointerEvent, _popupContext: PopupContext, layout: PopupResizablePanelLayout): void {
    const typed = layout as DropTreeGridLayout
    const inGrid = event.position.x >= typed.gridRect.x &&
      event.position.x <= typed.gridRect.x + typed.gridRect.w &&
      event.position.y >= typed.gridRect.y &&
      event.position.y <= typed.gridRect.y + typed.gridRect.h
    if (!inGrid) return
    this._grid?.onWheel(event)
  }

  protected override onPopupClose(): void {
    super.onPopupClose()
    this._searchInput.endSession()
    this._teardownGrid()
    this._onClose?.()
  }

  private _createGrid(): RenderTreeGrid<T> {
    const grid = new RenderTreeGrid<T>({
      columns: this._columns,
      roots: this.filteredRoots,
      treeColumnKey: this._treeColumnKey,
      sortable: false,
      resizableColumns: false,
      reserveScrollbars: false,
      defaultExpandedKeys: this._defaultExpandedKeys(),
      onSelect: node => this._select(node),
      onActivate: node => this._select(node),
      onExpand: () => {
        if (this._searchText.trim()) return
        this._captureExpandedKeys(grid)
      },
    })
    grid.selectedKey = this._selectedValue
    return grid
  }

  private _select(node: TreeGridNode<T>): void {
    if (node.selectable === false) return
    if (this._onSelect?.(node) === false) {
      PopupManager.instance.requestPaint()
      return
    }
    this.close()
  }

  private _cancelGridPointerState(event: PopupPointerEvent): void {
    this._grid?.onPointerCancel({ ...event, type: 'cancel' })
  }

  private _syncGrid(): void {
    if (!this._grid) return
    this._grid.columns = this._columns
    this._grid.treeColumnKey = this._treeColumnKey
    this._grid.roots = this.filteredRoots
    this._grid.selectedKey = this._selectedValue
    this._grid.expandedKeys = this._defaultExpandedKeys()
    if (this._selectedValue) this._grid.revealNode(this._selectedValue)
  }

  private _handleNavigationKey(event: KeyboardEvent): boolean {
    if (!this.visible) return false
    if (event.key === 'Tab') {
      this.close()
      return false
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      this.close()
      return true
    }
    if (!this._grid) return false
    if (event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight' ||
      event.key === 'Enter') {
      event.preventDefault()
      FocusManager.instance.setFocus(this._grid)
      return this._grid.onKeyDown(event)
    }
    return false
  }

  private _syncGridLayout(layout: DropTreeGridLayout, popupContext: PopupContext): void {
    if (!this._grid) return
    this._grid.columns = this._columns.map((column, index) => ({
      ...column,
      width: layout.colWidths[index] ?? column.width,
    }))
    this._grid.offset = { x: layout.gridRect.x, y: layout.gridRect.y }
    this._grid.layout({
      minWidth: layout.gridRect.w,
      maxWidth: layout.gridRect.w,
      minHeight: layout.gridRect.h,
      maxHeight: layout.gridRect.h,
    }, false, { theme: popupContext.theme })
  }

  private _layout(popupContext: PopupContext = PopupManager.instance.context): DropTreeGridLayout {
    const theme = popupContext.theme
    const popupStyle = derivePopupStyle(theme)
    const inputStyle = deriveTextInputStyle(theme)
    const gridStyle = deriveGridCellStyle(theme)
    const itemH = gridStyle.rowHeight
    const headerH = gridStyle.headerHeight
    const searchInputH = inputStyle.height
    const searchH = this._searchable ? searchInputH + popupStyle.padding : 0
    const anchorRect = this._anchor
      ? resolvePopupAnchorRect(this._anchor)
      : { x: 0, y: 0, w: 240, h: inputStyle.height }
    const totalFixed = this._columns.reduce((sum, column) => sum + (column.width ?? 0), 0)
    const flexCount = this._columns.filter(column => !column.width).length
    const totalVisibleCount = Math.max(countVisibleTreeGridNodes(this.filteredRoots, this._defaultExpandedKeys()), 1)
    const visibleCount = Math.max(1, Math.min(totalVisibleCount, this._maxVisibleItems))
    const gridScrollbarW = totalVisibleCount > visibleCount ? deriveScrollbarStyle(theme).gutterSize : 0
    const minColumnContentW = totalFixed + flexCount * DropTreeGridPopup.MIN_FLEX_COL_WIDTH
    const minContentW = minColumnContentW + gridScrollbarW
    const minPanelW = Math.max(
      anchorRect.w,
      DropTreeGridPopup.MIN_PANEL_WIDTH,
      minContentW + popupStyle.padding * 2,
    )
    const requestedPanelW = this.panelWidthOverride ?? minPanelW
    const maxPanelW = Math.max(minPanelW, popupContext.viewport.width - 8)
    const panelW = Math.max(minPanelW, Math.min(requestedPanelW, maxPanelW))
    const contentW = Math.max(minContentW, panelW - popupStyle.padding * 2)
    const columnContentW = Math.max(minColumnContentW, contentW - gridScrollbarW)
    const flexW = flexCount > 0
      ? Math.max(DropTreeGridPopup.MIN_FLEX_COL_WIDTH, (columnContentW - totalFixed) / flexCount)
      : 0
    const colWidths = this._columns.map(column => column.width ?? flexW)
    const minGridH = headerH + itemH
    const naturalGridH = headerH + visibleCount * itemH
    const minPanelH = searchH + minGridH + popupStyle.padding * 2
    const requestedPanelH = this.panelHeightOverride ?? (searchH + naturalGridH + popupStyle.padding * 2)
    const maxPanelH = Math.max(minPanelH, popupContext.viewport.height - 8)
    const panelH = Math.max(minPanelH, Math.min(requestedPanelH, maxPanelH))
    const gridH = Math.max(minGridH, panelH - searchH - popupStyle.padding * 2)

    let panelY = anchorRect.y + anchorRect.h + 2
    if (panelY + panelH > (popupContext.viewport.y ?? 0) + popupContext.viewport.height - 4) panelY = anchorRect.y - panelH - 4
    const panelRect = clampRectToPopupViewport({ x: anchorRect.x, y: panelY, width: panelW, height: panelH }, popupContext, 4)
    const panelX = panelRect.x
    panelY = panelRect.y

    const searchRect = this._searchable
      ? {
          x: panelX + popupStyle.padding,
          y: panelY + popupStyle.padding,
          w: panelW - popupStyle.padding * 2,
          h: searchInputH,
        }
      : null
    const gridY = searchRect ? searchRect.y + searchRect.h + popupStyle.padding : panelY + popupStyle.padding

    return {
      theme,
      popupStyle,
      inputStyle,
      minPanelW,
      minPanelH,
      panelX,
      panelY,
      panelW,
      panelH,
      itemH,
      headerH,
      colWidths,
      searchInputH,
      searchH,
      gridH,
      searchRect,
      gridRect: {
        x: panelX + popupStyle.padding,
        y: gridY,
        w: panelW - popupStyle.padding * 2,
        h: gridH,
      },
      resizeGripRect: this.createResizeGripRect(
        panelX,
        panelY,
        panelW,
        panelH,
        DropTreeGridPopup.RESIZE_GRIP_SIZE,
      ),
    }
  }

  private _captureExpandedKeys(grid: RenderTreeGrid<T>): void {
    this._expandedKeys = new Set(grid.expandedKeys)
  }

  private _defaultExpandedKeys(): string[] {
    if (this._searchText.trim()) return collectExpandableTreeGridNodeKeys(this.filteredRoots)
    return Array.from(new Set([
      ...this._expandedKeys,
      ...collectTreeGridAncestorKeys(this.filteredRoots, this._selectedValue),
    ]))
  }

  private _teardownGrid(): void {
    if (!this._grid) return
    if (!this._searchText.trim()) this._captureExpandedKeys(this._grid)
    this._grid.dispose()
    this._grid = null
  }

  private _paintResizeGrip(dl: DrawList, layout: DropTreeGridLayout): void {
    const gripColor = resolveTextColor(
      deriveWindowChromeStyle(layout.theme).gripText,
      this.panelResizing ? 'pressed' : this.panelResizeGripHovered ? 'hovered' : 'normal',
    )
    const grip = layout.resizeGripRect
    const baseX = grip.x + grip.w - 2
    const baseY = grip.y + grip.h - 2
    const gap = 4
    const dotRadius = 1.5
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3 - i; j += 1) {
        dl.fillCircle(baseX - i * gap, baseY - j * gap, dotRadius, gripColor)
      }
    }
  }
}

export class RenderDropTreeGridEdit<T extends Record<string, any> = any>
  extends RenderBox
  implements
    InteractiveRenderObject,
    Focusable,
    PopupAnchorTarget,
    ValueEditor<string, DropTreeGridEditValueChangeReason, TreeGridNode<T> | null> {
  private _columns: GridColumnDef<T>[]
  private _treeColumnKey: keyof T & string
  labelKey: keyof T & string
  private _roots: TreeGridNode<T>[]
  private _value: string
  placeholder: string
  onChange?: (value: string, node: TreeGridNode<T> | null) => void
  searchable: boolean
  maxVisibleItems: number
  private _readonly: boolean
  private _disabled: boolean
  private _status: FormFieldStatus
  private _helperText: string
  private _prefixText: string
  private _suffixText: string
  private _clearable: boolean
  metaKey?: keyof T & string
  metaFormatter?: (node: TreeGridNode<T>) => string
  expandAllOnOpen: boolean
  expandedKeysOnOpen?: readonly string[] | DropTreeGridEditExpandedKeysResolver<T>
  queryTextBuilder?: DropTreeGridEditQueryTextBuilder<T>
  queryProcessor?: DropTreeGridEditQueryProcessor<T>
  private _focusRegistered = false

  private _focused = false
  private _hovered = false
  private _popup = new DropTreeGridPopup<T>()
  private _queryText = ''
  private _showQueryInField = false
  private readonly _valueEditorEvents = new ValueEditorEventEmitter<
    string,
    DropTreeGridEditValueChangeReason,
    TreeGridNode<T> | null
  >()

  constructor(options: {
    columns: GridColumnDef<T>[]
    roots: TreeGridNode<T>[]
    treeColumnKey: keyof T & string
    labelKey: keyof T & string
    value?: string
    metaKey?: keyof T & string
    metaFormatter?: (node: TreeGridNode<T>) => string
    placeholder?: string
    onChange?: (value: string, node: TreeGridNode<T> | null) => void
    searchable?: boolean
    maxVisibleItems?: number
    readonly?: boolean
    disabled?: boolean
    status?: FormFieldStatus
    helperText?: string
    prefixText?: string
    suffixText?: string
    clearable?: boolean
    expandAllOnOpen?: boolean
    expandedKeysOnOpen?: readonly string[] | DropTreeGridEditExpandedKeysResolver<T>
    queryTextBuilder?: DropTreeGridEditQueryTextBuilder<T>
    queryProcessor?: DropTreeGridEditQueryProcessor<T>
  }) {
    super()
    this._columns = options.columns
    this._roots = options.roots
    this._treeColumnKey = this._resolveTreeColumnKey(options.treeColumnKey)
    this.labelKey = options.labelKey
    this._value = options.value ?? ''
    this.metaKey = options.metaKey
    this.metaFormatter = options.metaFormatter
    this.placeholder = options.placeholder ?? '请选择...'
    this.onChange = options.onChange
    this.searchable = options.searchable ?? true
    this.maxVisibleItems = options.maxVisibleItems ?? 8
    this._readonly = options.readonly ?? false
    this._disabled = options.disabled ?? false
    this._status = options.status ?? 'default'
    this._helperText = options.helperText ?? ''
    this._prefixText = options.prefixText ?? ''
    this._suffixText = options.suffixText ?? ''
    this._clearable = options.clearable ?? false
    this.expandAllOnOpen = options.expandAllOnOpen ?? false
    this.expandedKeysOnOpen = options.expandedKeysOnOpen
    this.queryTextBuilder = options.queryTextBuilder
    this.queryProcessor = options.queryProcessor
    this._syncFocusRegistration()
  }

  get roots(): TreeGridNode<T>[] { return this._roots }
  set roots(roots: TreeGridNode<T>[]) {
    if (roots === this._roots) return
    this._roots = roots
    if (this._popup.visible) this._popup.refresh()
    this.markNeedsPaint()
  }

  get value(): string { return this._value }
  set value(value: string) {
    const nextValue = String(value ?? '')
    if (this._value === nextValue) return
    this._value = nextValue
    if (this._popup.visible) this._popup.selectedValue = nextValue
    this.markNeedsPaint()
  }

  getValue(): string {
    return this.value
  }

  setValue(value: string): void {
    const nextValue = String(value ?? '')
    if (this.value === nextValue) return
    this._popup.close()
    this._resetQueryPresentation()
    this.value = nextValue
  }

  subscribeValueChange(
    listener: ValueEditorValueChangeListener<
      string,
      DropTreeGridEditValueChangeReason,
      TreeGridNode<T> | null
    >,
  ): DisposeFn {
    return this._valueEditorEvents.subscribeValueChange(listener)
  }

  subscribeBlur(listener: () => void): DisposeFn {
    return this._valueEditorEvents.subscribeBlur(listener)
  }

  get columns(): GridColumnDef<T>[] { return this._columns }
  set columns(columns: GridColumnDef<T>[]) {
    if (this._columns === columns) return
    this._columns = columns
    const nextTreeColumnKey = this._resolveTreeColumnKey(this._treeColumnKey)
    const treeColumnChanged = nextTreeColumnKey !== this._treeColumnKey
    this._treeColumnKey = nextTreeColumnKey
    if (this._popup.visible) {
      this._popup.columns = columns
      if (treeColumnChanged) this._popup.treeColumnKey = nextTreeColumnKey
    }
    this.markNeedsPaint()
  }

  get treeColumnKey(): keyof T & string { return this._treeColumnKey }
  set treeColumnKey(key: keyof T & string) {
    const nextKey = this._resolveTreeColumnKey(key)
    if (this._treeColumnKey === nextKey) return
    this._treeColumnKey = nextKey
    if (this._popup.visible) this._popup.treeColumnKey = nextKey
    this.markNeedsPaint()
  }

  get disabled(): boolean { return this._disabled }
  set disabled(disabled: boolean) {
    if (this._disabled === disabled) return
    this._disabled = disabled
    if (disabled) {
      runCleanupSteps([
        () => { this._hovered = false },
        () => this._endLogicalFocusSession(),
        () => this._resetQueryPresentation(),
        () => this._syncFocusRegistration(),
        () => this.markNeedsPaint(),
      ])
      return
    }
    this._syncFocusRegistration()
    this.markNeedsPaint()
  }

  get status(): FormFieldStatus { return this._status }
  set status(status: FormFieldStatus) {
    if (this._status === status) return
    this._status = status
    this.markNeedsPaint()
  }

  get helperText(): string { return this._helperText }
  set helperText(helperText: string) {
    if (this._helperText === helperText) return
    this._helperText = helperText
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  get prefixText(): string { return this._prefixText }
  set prefixText(prefixText: string) {
    if (this._prefixText === prefixText) return
    this._prefixText = prefixText
    this.markNeedsPaint()
  }

  get suffixText(): string { return this._suffixText }
  set suffixText(suffixText: string) {
    if (this._suffixText === suffixText) return
    this._suffixText = suffixText
    this.markNeedsPaint()
  }

  get clearable(): boolean { return this._clearable }
  set clearable(clearable: boolean) {
    if (this._clearable === clearable) return
    this._clearable = clearable
    this.markNeedsPaint()
  }

  get readonly(): boolean { return this._readonly }
  set readonly(readonly: boolean) {
    if (this._readonly === readonly) return
    this._readonly = readonly
    if (readonly) {
      runCleanupSteps([
        () => { this._hovered = false },
        () => this._endLogicalFocusSession(),
        () => this._resetQueryPresentation(),
        () => this._syncFocusRegistration(),
        () => this.markNeedsPaint(),
      ])
      return
    }
    this._syncFocusRegistration()
    this.markNeedsPaint()
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  get isFocused(): boolean { return this._focused || this._popup.visible }

  focusIn(): void {
    if (this.disabled || this.readonly || this._focused) return
    this._focused = true
    this.markNeedsPaint()
  }

  focusOut(): void {
    if (!this._focused) return
    const movingIntoOwnedPopup = this._popup.visible
    this._focused = false
    this.markNeedsPaint()
    if (!movingIntoOwnedPopup) this._valueEditorEvents.emitBlur()
  }

  private _endLogicalFocusSession(): void {
    const wasFocused = this.isFocused
    runCleanupSteps([
      () => this._popup.close(),
      () => {
        this._focused = false
        this.markNeedsPaint()
      },
      () => { if (wasFocused) this._valueEditorEvents.emitBlur() },
    ])
  }

  requestFocus(): void {
    if (this.disabled || this.readonly || typeof window === 'undefined') return
    FocusManager.instance.setFocus(this)
  }

  blur(): void {
    this._popup.close()
    this._resetQueryPresentation()
    if (typeof window === 'undefined') {
      this.focusOut()
      return
    }
    FocusManager.instance.clearFocusOf(this)
  }

  [GET_POPUP_ANCHOR_RECT](): { x: number; y: number; width: number; height: number } {
    const g = this.globalOffset
    return { x: g.x, y: g.y, width: this.size.width, height: this._inputStyle().height }
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const inputStyle = deriveTextInputStyle(context.theme)
    this.size = {
      width: constraints.maxWidth === Infinity ? 220 : constraints.maxWidth,
      height: measureFormFieldHeight(inputStyle, inputStyle.height, this.helperText),
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const { x, y } = offset
    const { width: w } = this.size
    const input = deriveTextInputStyle(context.theme)
    const dropdown = deriveDropdownStyle(context.theme)
    const readonlyVisual = this.readonly && !this.disabled
    const shell = paintTriggerFieldShell(context, offset, w, {
      focused: readonlyVisual ? false : this._popup.visible || this._focused,
      hovered: readonlyVisual ? false : this._hovered,
      disabled: this.disabled,
      status: this.status,
      helperText: this.helperText,
      prefixText: this.prefixText,
      suffixText: this.suffixText,
      showClearButton: this._showClearButton(),
      reserveTrailingWidth: dropdown.fontSize,
    })
    const fieldHeight = shell.fieldHeight
    if (readonlyVisual) {
      const readonlyTint = blendColor(
        resolveBgColor(input.inputBg, 'normal'),
        input.placeholderText,
        0.06,
      )
      dl.fillRect(offset.x + 1, offset.y + 1, Math.max(0, w - 2), Math.max(0, fieldHeight - 2), readonlyTint, Math.max(0, input.borderRadius - 1))
    }
    const displayText = this._displayText()
    const displayMeta = this._displayMetaText()
    const fullTooltipText = this._fullTooltipText()
    const hasCommittedLabel = this._selectedLabel().length > 0
    const showingPlaceholder = displayText.length === 0 && (!hasCommittedLabel || this._showQueryInField)
    const textColor = this.disabled
      ? input.textDisabled
      : showingPlaceholder
        ? input.placeholderText
        : resolveTextColor(dropdown.itemText, 'normal')
    const text = showingPlaceholder ? this.placeholder : displayText
    const metaFontSize = Math.max(11, dropdown.fontSize - 1)
    const metaTextColor = this.disabled ? input.textDisabled : input.placeholderText
    const metaWidth = displayMeta
      ? TextMeasurer.measureWidth(displayMeta, metaFontSize, dropdown.fontFamily)
      : 0
    const metaGap = displayMeta ? 8 : 0
    const metaX = shell.valueRect.x + Math.max(0, shell.valueRect.w - metaWidth)
    const textClipWidth = Math.max(0, shell.valueRect.w - metaWidth - metaGap)
    this._syncOverflowTooltip(text, displayMeta, fullTooltipText, shell.valueRect.w, dropdown.fontSize, metaFontSize, dropdown.fontFamily, showingPlaceholder)
    dl.pushClip(shell.valueRect.x, y, textClipWidth, fieldHeight)
    paintSingleLineText(dl, {
      text,
      x: shell.valueRect.x,
      y: y + fieldHeight / 2,
      maxWidth: textClipWidth,
      color: textColor,
      fontSize: dropdown.fontSize,
      fontFamily: dropdown.fontFamily,
    })
    dl.popClip()
    if (displayMeta) {
      dl.pushClip(metaX, y, Math.max(0, shell.valueRect.x + shell.valueRect.w - metaX), fieldHeight)
      dl.fillText(displayMeta, metaX, y + fieldHeight / 2, metaTextColor, metaFontSize, dropdown.fontFamily, 'left', 'middle')
      dl.popClip()
    }

    const arrowX = (shell.trailingRect?.x ?? (x + w - input.padding - dropdown.fontSize)) + dropdown.fontSize / 2
    const arrowY = y + fieldHeight / 2
    const arrowColor = this.disabled
      ? input.textDisabled
      : readonlyVisual
        ? input.placeholderText
        : resolveTextColor(dropdown.arrowText, this._popup.visible || this._focused ? 'selected' : 'normal')
    if (readonlyVisual) {
      paintIconGlyph(context, {
        name: 'lock',
        x: arrowX - dropdown.fontSize / 2,
        y: arrowY - dropdown.fontSize / 2,
        size: dropdown.fontSize,
        color: arrowColor,
      })
    } else {
      const ctx = context.ctx
      ctx.save()
      ctx.fillStyle = `rgba(${arrowColor.r},${arrowColor.g},${arrowColor.b},${arrowColor.a})`
      ctx.beginPath()
      const ar = dropdown.fontSize * 0.3
      if (this._popup.visible) {
        ctx.moveTo(arrowX, arrowY - ar)
        ctx.lineTo(arrowX - ar, arrowY + ar)
        ctx.lineTo(arrowX + ar, arrowY + ar)
      } else {
        ctx.moveTo(arrowX, arrowY + ar)
        ctx.lineTo(arrowX - ar, arrowY - ar)
        ctx.lineTo(arrowX + ar, arrowY - ar)
      }
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
  }

  onPointerDown(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    if (this.disabled || !this._hitField(e.position)) return
    const layout = this._triggerLayout()
    if (pointInFormFieldRect(layout.clearRect, e.position)) {
      this._clearValue()
      return
    }
    if (this.readonly) return
    FocusManager.instance.setFocus(this)
    if (this._popup.visible) {
      this._popup.close()
      this._resetQueryPresentation()
    } else {
      this._openPopup('', false)
    }
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.disabled) return false
    if (this.readonly) {
      if (event.key === 'Escape' && this._popup.visible) {
        event.preventDefault()
        this._popup.close()
        this._resetQueryPresentation()
        return true
      }
      return false
    }
    if (event.key === 'Escape' && this._popup.visible) {
      event.preventDefault()
      this._popup.close()
      this._resetQueryPresentation()
      return true
    }
    if (event.key === 'Tab' && this._popup.visible) {
      this._popup.close()
      this._resetQueryPresentation()
      return false
    }
    if (this._popup.visible) return false
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault()
      this._openPopup('', false)
      return true
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && this._showClearButton()) {
      event.preventDefault()
      this._clearValue()
      return true
    }
    if (this.searchable && isTreeGridLookupTypingKey(event)) {
      event.preventDefault()
      this._openPopup(event.key, true)
      return true
    }
    return false
  }

  onPointerMove(e: PointerEvent): void {
    const wasHovered = this._hovered
    this._hovered = !this.disabled && !this.readonly && this._hitField(e.position)
    if (wasHovered !== this._hovered) this.markNeedsPaint()
  }

  onPointerUp(_e: PointerEvent): void {}

  onPointerCancel(_e: PointerEvent): void {
    this._hovered = false
    this.markNeedsPaint()
  }

  onPointerLeave(_e: PointerEvent): void {
    if (!this._hovered) return
    this._hovered = false
    this.markNeedsPaint()
  }

  dispose(): void {
    runCleanupSteps([
      () => this._valueEditorEvents.dispose(),
      () => this._resetQueryPresentation(),
      () => this._popup.disposePopup(),
      () => {
        if (this._focusRegistered && typeof window !== 'undefined') {
          FocusManager.instance.unregister(this)
          this._focusRegistered = false
        }
      },
      () => {
        this._focused = false
        this._hovered = false
      },
      () => super.dispose(),
      () => { this.onChange = undefined },
    ])
  }

  debugState(): DropTreeGridEditDebugState {
    return {
      popupVisible: this._popup.visible,
      queryText: this._queryText,
      showQueryInField: this._showQueryInField,
      displayText: this._displayText(),
      focused: this._focused,
      disabled: this.disabled,
      readonly: this.readonly,
      value: this.value,
      selectedLabel: this._selectedLabel(),
      filteredCount: this._debugFilteredCount(),
      expandedKeys: this._popup.expandedKeys,
    }
  }

  private _openPopup(initialQuery: string, showQueryInField: boolean): void {
    if (this.disabled || this.readonly || this._popup.visible) return
    this._queryText = initialQuery
    this._showQueryInField = showQueryInField
    this._popup.open({
      anchor: this as PopupAnchorTarget,
      columns: this.columns,
      treeColumnKey: this.treeColumnKey,
      selectedValue: this.value,
      searchable: this.searchable,
      maxVisibleItems: this.maxVisibleItems,
      initialQuery,
      openExpandedKeys: this._openExpandedKeys(),
      resolveRoots: query => this._resolveQueryRoots(query),
      onSelect: node => {
        const previousValue = this.value
        this.value = node.key
        this._queryText = ''
        this._showQueryInField = false
        this._emitValueChange(node.key, previousValue, node, 'selection')
      },
      onSearchTextChange: value => {
        this._queryText = value
        this._showQueryInField = true
        this.markNeedsPaint()
      },
      onClose: () => {
        this._resetQueryPresentation()
        this.markNeedsPaint()
      },
    })
    this.markNeedsPaint()
  }

  private _resolveQueryRoots(query: string): TreeGridNode<T>[] {
    const processor = this.queryProcessor ?? defaultDropTreeGridEditQueryProcessor<T>(this.queryTextBuilder)
    return processor({
      query,
      roots: this.roots,
      columns: this.columns,
      treeColumnKey: this.treeColumnKey,
      labelKey: this.labelKey,
      selectedValue: this.value,
    })
  }

  private _resolveTreeColumnKey(candidate: keyof T & string): keyof T & string {
    if (this._columns.some(column => column.key === candidate)) return candidate
    return (this._columns[0]?.key ?? candidate) as keyof T & string
  }

  private _openExpandedKeys(): string[] | undefined {
    if (this.expandAllOnOpen) return collectExpandableTreeGridNodeKeys(this.roots)
    if (typeof this.expandedKeysOnOpen === 'function') {
      return Array.from(new Set([
        ...this.expandedKeysOnOpen({
          roots: this.roots,
          selectedValue: this.value,
        }),
        ...collectTreeGridAncestorKeys(this.roots, this.value),
      ]))
    }
    if (this.expandedKeysOnOpen) {
      return Array.from(new Set([
        ...this.expandedKeysOnOpen,
        ...collectTreeGridAncestorKeys(this.roots, this.value),
      ]))
    }
    return undefined
  }

  private _selectedNode(): TreeGridNode<T> | null {
    return findTreeGridNodeByKey(this.roots, this.value)
  }

  private _selectedLabel(): string {
    const node = this._selectedNode()
    return node ? String(node.row[this.labelKey] ?? '') : ''
  }

  private _displayText(): string {
    if (this._popup.visible && this._showQueryInField) return this._queryText
    return this._selectedLabel()
  }

  private _displayMetaText(): string {
    if (this._popup.visible && this._showQueryInField) return ''
    const node = this._selectedNode()
    if (!node) return ''
    if (this.metaFormatter) return String(this.metaFormatter(node) ?? '')
    if (this.metaKey) return String(node.row[this.metaKey] ?? '')
    return ''
  }

  private _fullTooltipText(): string {
    const label = this._selectedLabel()
    const meta = this._displayMetaText()
    if (!label) return ''
    return meta ? `${label}  ${meta}` : label
  }

  private _syncOverflowTooltip(
    displayText: string,
    displayMeta: string,
    fullTooltipText: string,
    availableWidth: number,
    fontSize: number,
    metaFontSize: number,
    fontFamily: string,
    showingPlaceholder: boolean,
  ): void {
    if (showingPlaceholder || !displayText || !fullTooltipText) {
      this.tooltip = undefined
      return
    }
    const textWidth = TextMeasurer.measureWidth(displayText, fontSize, fontFamily)
    const metaWidth = displayMeta ? TextMeasurer.measureWidth(displayMeta, metaFontSize, fontFamily) + 8 : 0
    this.tooltip = textWidth + metaWidth > availableWidth ? fullTooltipText : undefined
  }

  private _resetQueryPresentation(): void {
    this._queryText = ''
    this._showQueryInField = false
  }

  private _debugFilteredCount(): number {
    return this._popup.visible ? this._popup.filteredCount : countTreeGridNodes(this.roots)
  }

  private _showClearButton(): boolean {
    return this.clearable && !this.disabled && !this.readonly && this.value.length > 0
  }

  private _clearValue(): void {
    if (!this._showClearButton()) return
    const previousValue = this.value
    this._popup.close()
    this._resetQueryPresentation()
    FocusManager.instance.setFocus(this)
    this.value = ''
    this._emitValueChange('', previousValue, null, 'clear')
    this.markNeedsPaint()
  }

  private _emitValueChange(
    value: string,
    previousValue: string,
    node: TreeGridNode<T> | null,
    reason: DropTreeGridEditValueChangeReason,
  ): void {
    runCleanupSteps([
      () => this.onChange?.(value, node),
      () => {
        if (value === previousValue) return
        this._valueEditorEvents.emitValueChange({
          value,
          previousValue,
          reason,
          detail: node,
        })
      },
    ])
  }

  private _triggerLayout() {
    const style = this._inputStyle()
    return layoutFormFieldInlineContent(style, this.globalOffset, this.size.width, style.height, {
      prefixText: this.prefixText,
      suffixText: this.suffixText,
      showClearButton: this._showClearButton(),
      reserveTrailingWidth: deriveDropdownStyle(this.currentTheme).fontSize,
    })
  }

  private _syncFocusRegistration(): void {
    if (typeof window === 'undefined') return
    if (this.disabled || this.readonly) {
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

  private _hitField(position: Offset): boolean {
    const g = this.globalOffset
    const fieldHeight = this._inputStyle().height
    return position.x >= g.x &&
      position.x <= g.x + this.size.width &&
      position.y >= g.y &&
      position.y <= g.y + fieldHeight
  }

  private _inputStyle(): ReturnType<typeof deriveTextInputStyle> {
    return deriveTextInputStyle(this.currentTheme)
  }
}

function isTreeGridLookupTypingKey(event: KeyboardEvent): boolean {
  return !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    event.key.length === 1 &&
    /\S/.test(event.key)
}

export function defaultDropTreeGridEditQueryProcessor<T extends Record<string, any> = any>(
  queryTextBuilder?: DropTreeGridEditQueryTextBuilder<T>,
): DropTreeGridEditQueryProcessor<T> {
  return ({ query, roots, columns, labelKey }) => {
    const normalizedQuery = normalizeTreeGridLookupQuery(query)
    if (!normalizedQuery) return [...roots]
    const filtered: TreeGridNode<T>[] = []
    for (const node of roots) {
      const next = filterTreeGridNode(node, normalizedQuery, queryTextBuilder ?? defaultDropTreeGridQueryTextBuilder(columns, labelKey))
      if (next) filtered.push(next)
    }
    return filtered
  }
}

function defaultDropTreeGridQueryTextBuilder<T extends Record<string, any>>(
  columns: readonly GridColumnDef<T>[],
  labelKey: keyof T & string,
): DropTreeGridEditQueryTextBuilder<T> {
  return node => {
    const texts = [node.key, String(node.row[labelKey] ?? '')]
    for (const column of columns) {
      const value = node.row[column.key]
      if (value === null || value === undefined) continue
      const text = String(value)
      if (text && !texts.includes(text)) texts.push(text)
    }
    return texts
  }
}

function normalizeTreeGridLookupQuery(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function filterTreeGridNode<T extends Record<string, any>>(
  node: TreeGridNode<T>,
  query: string,
  textBuilder: DropTreeGridEditQueryTextBuilder<T>,
): TreeGridNode<T> | null {
  const texts = textBuilder(node).map(item => normalizeTreeGridLookupQuery(item))
  const selfMatch = texts.some(text => text.includes(query))
  const nextChildren = (node.children ?? []).flatMap(child => {
    const next = filterTreeGridNode(child, query, textBuilder)
    return next ? [next] : []
  })
  if (!selfMatch && nextChildren.length === 0) return null
  return nextChildren.length > 0 ? { ...node, children: nextChildren } : { ...node, children: undefined }
}

function findTreeGridNodeByKey<T extends Record<string, any>>(roots: readonly TreeGridNode<T>[], key: string): TreeGridNode<T> | null {
  if (!key) return null
  for (const node of roots) {
    if (node.key === key) return node
    const child = node.children ? findTreeGridNodeByKey(node.children, key) : null
    if (child) return child
  }
  return null
}

function collectExpandableTreeGridNodeKeys<T extends Record<string, any>>(roots: readonly TreeGridNode<T>[]): string[] {
  const keys: string[] = []
  const visit = (nodes: readonly TreeGridNode<T>[]) => {
    for (const node of nodes) {
      if (node.children && node.children.length > 0) {
        keys.push(node.key)
        visit(node.children)
      }
    }
  }
  visit(roots)
  return keys
}

function collectTreeGridAncestorKeys<T extends Record<string, any>>(roots: readonly TreeGridNode<T>[], key: string): string[] {
  if (!key) return []
  const result: string[] = []
  const visit = (nodes: readonly TreeGridNode<T>[], ancestors: string[]): boolean => {
    for (const node of nodes) {
      if (node.key === key) {
        result.push(...ancestors)
        return true
      }
      if (node.children && visit(node.children, [...ancestors, node.key])) return true
    }
    return false
  }
  visit(roots, [])
  return result
}

function countVisibleTreeGridNodes<T extends Record<string, any>>(roots: readonly TreeGridNode<T>[], expandedKeys: readonly string[]): number {
  const expanded = new Set(expandedKeys)
  let count = 0
  const visit = (nodes: readonly TreeGridNode<T>[]) => {
    for (const node of nodes) {
      count += 1
      if (node.children && node.children.length > 0 && expanded.has(node.key)) {
        visit(node.children)
      }
    }
  }
  visit(roots)
  return count
}

function countTreeGridNodes<T extends Record<string, any>>(roots: readonly TreeGridNode<T>[]): number {
  let count = 0
  const visit = (nodes: readonly TreeGridNode<T>[]) => {
    for (const node of nodes) {
      count += 1
      if (node.children && node.children.length > 0) visit(node.children)
    }
  }
  visit(roots)
  return count
}
