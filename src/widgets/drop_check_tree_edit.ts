import { FocusManager, type Focusable } from '../core/focus_manager'
import { type PopupAnchorTarget, GET_POPUP_ANCHOR_RECT } from '../core/popup_anchor'
import { PopupManager, clampRectToPopupViewport, type PopupContext } from '../core/popup_manager'
import { PopupPanelShell, type PopupPanelLayout } from '../core/popup_shell'
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
  deriveDropdownStyle,
  derivePopupStyle,
  deriveTextInputStyle,
  deriveTreeStyle,
  resolveBgColor,
  resolveTextColor,
} from '../theme/component_styles'
import { layoutFormFieldInlineContent, measureFormFieldHeight, pointInFormFieldRect, type FormFieldStatus } from './form_field_shell'
import { paintTriggerFieldShell } from './trigger_field_shell'
import { paintIconGlyph } from './icon'
import { PopupTextInput } from './popup_text_input'
import { RenderTreeView, type TreeNode } from './tree'
import {
  ValueEditorEventEmitter,
  type ValueEditor,
  type ValueEditorValueChangeListener,
} from './value_editor'

type DropCheckTreeLayout = PopupPanelLayout & {
  searchRect: { x: number; y: number; w: number; h: number } | null
  treeRect: { x: number; y: number; w: number; h: number }
}

export interface DropCheckTreeEditQueryContext<T = any> {
  query: string
  roots: readonly TreeNode<T>[]
  checkedKeys: readonly string[]
}

export interface DropCheckTreeEditExpandOnOpenContext<T = any> {
  roots: readonly TreeNode<T>[]
  checkedKeys: readonly string[]
}

export interface DropCheckTreeEditSummaryContext<T = any> {
  roots: readonly TreeNode<T>[]
  checkedKeys: readonly string[]
  checkedNodes: readonly TreeNode<T>[]
}

export type DropCheckTreeEditQueryProcessor<T = any> =
  (context: DropCheckTreeEditQueryContext<T>) => TreeNode<T>[]

export type DropCheckTreeEditQueryTextBuilder<T = any> =
  (node: TreeNode<T>) => string[]

export type DropCheckTreeEditExpandedKeysResolver<T = any> =
  (context: DropCheckTreeEditExpandOnOpenContext<T>) => readonly string[]

export type DropCheckTreeEditSummaryBuilder<T = any> =
  (context: DropCheckTreeEditSummaryContext<T>) => string

export interface DropCheckTreeEditDebugState {
  popupVisible: boolean
  queryText: string
  showQueryInField: boolean
  displayText: string
  focused: boolean
  disabled: boolean
  readonly: boolean
  checkedKeys: string[]
  checkedLabel: string
  filteredCount: number
  expandedKeys: string[]
}

export type DropCheckTreeEditValueChangeReason = 'selection' | 'clear'

interface DropCheckTreePopupOpenOptions<T = any> {
  anchor: PopupAnchorTarget
  checkedKeys: readonly string[]
  searchable: boolean
  maxVisibleItems: number
  initialQuery: string
  resolveRoots: (query: string) => TreeNode<T>[]
  onCheck: (checkedKeys: string[], checkedNodes: TreeNode<T>[]) => void
  onSearchTextChange?: (value: string) => void
  onClose: () => void
  openExpandedKeys?: readonly string[]
}

class DropCheckTreePopup<T = any> extends PopupPanelShell {
  private readonly _searchInput = new PopupTextInput(() => PopupManager.instance.requestPaint())
  private _tree: RenderTreeView<T> | null = null
  private _anchor?: PopupAnchorTarget
  private _checkedKeys = new Set<string>()
  private _searchable = false
  private _maxVisibleItems = 8
  private _searchText = ''
  private _resolveRoots?: (query: string) => TreeNode<T>[]
  private _onCheck?: (checkedKeys: string[], checkedNodes: TreeNode<T>[]) => void
  private _onSearchTextChange?: (value: string) => void
  private _onClose?: () => void
  private _expandedKeys = new Set<string>()

  get searchText(): string { return this._searchText }

  get checkedKeys(): string[] { return [...this._checkedKeys] }

  get expandedKeys(): string[] {
    return this._tree ? this._tree.expandedKeys : [...this._expandedKeys]
  }

  set checkedKeys(keys: readonly string[]) {
    const nextKeys = new Set(keys)
    const changed = nextKeys.size !== this._checkedKeys.size || [...nextKeys].some(key => !this._checkedKeys.has(key))
    if (!changed) return
    this._checkedKeys = nextKeys
    if (this._tree) {
      this._tree.checkedKeys = [...nextKeys]
      this._tree.expandedKeys = this._defaultExpandedKeys()
    }
    PopupManager.instance.requestPaint()
  }

  get filteredRoots(): TreeNode<T>[] {
    return this._resolveRoots ? this._resolveRoots(this._searchText) : []
  }

  get filteredCount(): number {
    return this._tree ? countTreeNodes(this._tree.roots) : 0
  }

  refresh(): void {
    this._syncTree()
    PopupManager.instance.requestPaint()
  }

  open(options: DropCheckTreePopupOpenOptions<T>): void {
    if (this.visible) this.close()
    this._anchor = options.anchor
    this._checkedKeys = new Set(options.checkedKeys)
    this._searchable = options.searchable
    this._maxVisibleItems = options.maxVisibleItems
    this._resolveRoots = options.resolveRoots
    this._onCheck = options.onCheck
    this._onSearchTextChange = options.onSearchTextChange
    this._onClose = options.onClose
    this._searchText = options.initialQuery
    if (options.openExpandedKeys) this._expandedKeys = new Set(options.openExpandedKeys)
    this._tree = this._createTree()
    this.openPopup({ owner: options.anchor })
    if (this._searchable) {
      this._searchInput.beginSession({
        value: this._searchText,
        placeholder: '搜索...',
        onInput: value => {
          this._searchText = value
          this._syncTree()
          this._onSearchTextChange?.(value)
          PopupManager.instance.requestPaint()
        },
        onCompositionUpdate: () => {
          PopupManager.instance.requestPaint()
        },
        onCompositionEnd: value => {
          this._searchText = value
          this._syncTree()
          this._onSearchTextChange?.(value)
          PopupManager.instance.requestPaint()
        },
        onKeyDown: event => {
          this._handleNavigationKey(event)
        },
      })
    } else if (this._tree) {
      FocusManager.instance.setFocus(this._tree)
    }
    PopupManager.instance.requestPaint()
  }

  override close(): void {
    super.close()
  }

  override hitTest(point: Offset, popupContext: PopupContext): boolean {
    if (!this.visible) return false
    const layout = this.getPanelLayout(popupContext)
    return point.x >= layout.panelX &&
      point.x <= layout.panelX + layout.panelW &&
      point.y >= layout.panelY &&
      point.y <= layout.panelY + layout.panelH
  }

  onOutsidePointerDown(event: PopupPointerEvent): boolean {
    if (!this._anchor) return false
    const rect = this._anchor[GET_POPUP_ANCHOR_RECT]()
    const hitAnchor = event.position.x >= rect.x &&
      event.position.x <= rect.x + rect.width &&
      event.position.y >= rect.y &&
      event.position.y <= rect.y + rect.height
    if (!hitAnchor) return false
    this.close()
    return true
  }

  onPointerDown(event: PopupPointerEvent, popupContext: PopupContext = PopupManager.instance.context): void {
    if (!isPrimaryPointerButton(event)) return
    const layout = this._layout(popupContext)
    if (layout.searchRect && this._searchInput.hitTest(event.position, layout.searchRect)) {
      this._searchInput.handlePointerDown(event.position, layout.searchRect, event.clickCount)
      return
    }
    this._tree?.onPointerDown(event)
  }

  onPointerMove(event: PopupPointerEvent, popupContext: PopupContext = PopupManager.instance.context): void {
    const layout = this._layout(popupContext)
    if (layout.searchRect && this._searchInput.hitTest(event.position, layout.searchRect)) {
      this._searchInput.handlePointerMove(event.position)
      return
    }
    this._searchInput.handlePointerCancel()
    this._tree?.onPointerMove(event)
  }

  onPointerUp(event: PopupPointerEvent, popupContext: PopupContext = PopupManager.instance.context): void {
    if (!isPrimaryPointerButton(event)) return
    const layout = this._layout(popupContext)
    if (layout.searchRect && this._searchInput.hitTest(event.position, layout.searchRect)) {
      this._searchInput.handlePointerUp()
      return
    }
    this._searchInput.handlePointerUp()
    this._tree?.onPointerUp(event)
  }

  onPointerCancel(_event: PopupPointerEvent): void {
    this._searchInput.handlePointerCancel()
    this._tree?.onPointerCancel(_event)
  }

  onWheel(event: WheelPointerEvent, popupContext: PopupContext = PopupManager.instance.context): boolean {
    const layout = this._layout(popupContext)
    const inPanel = event.position.x >= layout.panelX &&
      event.position.x <= layout.panelX + layout.panelW &&
      event.position.y >= layout.panelY &&
      event.position.y <= layout.panelY + layout.panelH
    if (!inPanel) return false
    const inTree = event.position.x >= layout.treeRect.x &&
      event.position.x <= layout.treeRect.x + layout.treeRect.w &&
      event.position.y >= layout.treeRect.y &&
      event.position.y <= layout.treeRect.y + layout.treeRect.h
    if (inTree) this._tree?.onWheel(event)
    return true
  }

  onKeyDown(event: KeyboardEvent): boolean {
    return this._handleNavigationKey(event)
  }

  paint(context: PaintContext): void {
    if (!this.visible) return
    const popupContext = PopupManager.instance.context
    const layout = this._layout(popupContext)
    this._syncTreeLayout(layout, popupContext)
    const dl = new DrawList(context)
    const popup = derivePopupStyle(context.theme)
    drawPopupPanel(dl, layout.panelX, layout.panelY, layout.panelW, layout.panelH, popup)
    if (layout.searchRect) {
      this._searchInput.paint(context, layout.searchRect, context.theme)
    }
    if (this._tree) {
      this._tree.paint(context, { x: this._tree.offset.x, y: this._tree.offset.y })
      if (this.filteredRoots.length === 0) {
        dl.fillText(
          '无匹配节点',
          layout.treeRect.x + 8,
          layout.treeRect.y + layout.treeRect.h / 2,
          popup.textDisabled,
          popup.fontSize,
          popup.fontFamily,
          'left',
          'middle',
        )
      }
    }
  }

  override onEscape(event: KeyboardEvent): boolean {
    if (!this.visible) return false
    event.preventDefault()
    this.close()
    return true
  }

  disposePopup(): void {
    this.close()
    this._teardownTree()
    this._searchInput.dispose()
  }

  protected override getPanelLayout(popupContext: PopupContext): PopupPanelLayout {
    return this._layout(popupContext)
  }

  protected override onPopupClose(): void {
    this._searchInput.endSession()
    this._teardownTree()
    this._onClose?.()
  }

  private _createTree(): RenderTreeView<T> {
    const tree = new RenderTreeView<T>({
      roots: this.filteredRoots,
      selectionMode: 'check',
      defaultCheckedKeys: [...this._checkedKeys],
      defaultExpandedKeys: this._defaultExpandedKeys(),
      onCheck: payload => {
        this._checkedKeys = new Set(payload.checkedKeys)
        this._onCheck?.(payload.checkedKeys, payload.checkedNodes)
      },
      onExpand: () => {
        if (this._searchText.trim()) return
        this._captureExpandedKeys(tree)
      },
    })
    return tree
  }

  private _syncTree(): void {
    if (!this._tree) return
    this._tree.setRoots(this.filteredRoots)
    this._tree.checkedKeys = [...this._checkedKeys]
    this._tree.expandedKeys = this._defaultExpandedKeys()
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
    if (!this._tree) return false
    if (event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight' ||
      event.key === 'Enter') {
      event.preventDefault()
      FocusManager.instance.setFocus(this._tree)
      return this._tree.onKeyDown(event)
    }
    return false
  }

  private _syncTreeLayout(layout: DropCheckTreeLayout, popupContext: PopupContext): void {
    if (!this._tree) return
    this._tree.offset = { x: layout.treeRect.x, y: layout.treeRect.y }
    this._tree.layout({
      minWidth: layout.treeRect.w,
      maxWidth: layout.treeRect.w,
      minHeight: layout.treeRect.h,
      maxHeight: layout.treeRect.h,
    }, false, { theme: popupContext.theme })
  }

  private _layout(popupContext: PopupContext): DropCheckTreeLayout {
    const popup = derivePopupStyle(popupContext.theme)
    const input = deriveTextInputStyle(popupContext.theme)
    const treeStyle = deriveTreeStyle(popupContext.theme)
    const anchorRect = this._anchor?.[GET_POPUP_ANCHOR_RECT]() ?? { x: 0, y: 0, width: 240, height: input.height }
    const viewportInset = 8
    const panelW = Math.min(
      Math.max(280, anchorRect.width),
      popupContext.viewport.width - viewportInset * 2,
    )
    const rowHeight = treeStyle.fontSize + treeStyle.paddingH * 1.5
    const expandedKeysForLayout = this._tree ? this._tree.expandedKeys : this._defaultExpandedKeys()
    const visibleCount = Math.max(1, Math.min(this._maxVisibleItems, countVisibleTreeNodes(this.filteredRoots, expandedKeysForLayout)))
    const searchRect = this._searchable
      ? {
          x: 0,
          y: 0,
          w: panelW - popup.padding * 2,
          h: input.height,
        }
      : null
    const treeH = Math.max(rowHeight + 8, rowHeight * visibleCount)
    const contentH = treeH + (searchRect ? searchRect.h + popup.padding : 0)
    const panelH = popup.padding * 2 + contentH
    const rawX = anchorRect.x
    const rawY = anchorRect.y + anchorRect.height + 4
    const panelRect = clampRectToPopupViewport({ x: rawX, y: rawY, width: panelW, height: panelH }, popupContext, viewportInset)
    const panelX = panelRect.x
    const panelY = panelRect.y
    const searchLayout = searchRect
      ? {
          x: panelX + popup.padding,
          y: panelY + popup.padding,
          w: searchRect.w,
          h: searchRect.h,
        }
      : null
    const treeY = searchLayout ? searchLayout.y + searchLayout.h + popup.padding : panelY + popup.padding
    return {
      panelX,
      panelY,
      panelW,
      panelH,
      searchRect: searchLayout,
      treeRect: {
        x: panelX + popup.padding,
        y: treeY,
        w: panelW - popup.padding * 2,
        h: treeH,
      },
    }
  }

  private _captureExpandedKeys(tree: RenderTreeView<T>): void {
    this._expandedKeys = new Set(tree.expandedKeys)
  }

  private _defaultExpandedKeys(): string[] {
    if (this._searchText.trim()) return collectExpandableNodeKeys(this.filteredRoots)
    return Array.from(new Set([
      ...this._expandedKeys,
      ...collectAncestorKeysForKeys(this.filteredRoots, [...this._checkedKeys]),
    ]))
  }

  private _teardownTree(): void {
    if (!this._tree) return
    if (!this._searchText.trim()) this._captureExpandedKeys(this._tree)
    this._tree.dispose()
    this._tree = null
  }
}

export class RenderDropCheckTreeEdit<T = any>
  extends RenderBox
  implements
    InteractiveRenderObject,
    Focusable,
    PopupAnchorTarget,
    ValueEditor<string[], DropCheckTreeEditValueChangeReason, TreeNode<T>[]> {
  private _roots: TreeNode<T>[]
  private _checkedKeys: string[]
  placeholder: string
  onChange?: (checkedKeys: string[], nodes: TreeNode<T>[]) => void
  searchable: boolean
  maxVisibleItems: number
  private _readonly: boolean
  private _disabled: boolean
  private _status: FormFieldStatus
  private _helperText: string
  private _prefixText: string
  private _suffixText: string
  private _clearable: boolean
  expandAllOnOpen: boolean
  expandedKeysOnOpen?: readonly string[] | DropCheckTreeEditExpandedKeysResolver<T>
  queryTextBuilder?: DropCheckTreeEditQueryTextBuilder<T>
  queryProcessor?: DropCheckTreeEditQueryProcessor<T>
  summaryBuilder?: DropCheckTreeEditSummaryBuilder<T>
  maxSummaryItems: number
  private _focusRegistered = false

  private _focused = false
  private _hovered = false
  private _popup = new DropCheckTreePopup<T>()
  private _queryText = ''
  private _showQueryInField = false
  private readonly _valueEditorEvents = new ValueEditorEventEmitter<
    string[],
    DropCheckTreeEditValueChangeReason,
    TreeNode<T>[]
  >()

  constructor(options: {
    roots: TreeNode<T>[]
    checkedKeys?: readonly string[]
    placeholder?: string
    onChange?: (checkedKeys: string[], nodes: TreeNode<T>[]) => void
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
    expandedKeysOnOpen?: readonly string[] | DropCheckTreeEditExpandedKeysResolver<T>
    queryTextBuilder?: DropCheckTreeEditQueryTextBuilder<T>
    queryProcessor?: DropCheckTreeEditQueryProcessor<T>
    summaryBuilder?: DropCheckTreeEditSummaryBuilder<T>
    maxSummaryItems?: number
  }) {
    super()
    this._roots = options.roots
    this._checkedKeys = normalizeUniqueKeys(options.checkedKeys ?? [])
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
    this.summaryBuilder = options.summaryBuilder
    this.maxSummaryItems = Math.max(1, options.maxSummaryItems ?? 2)
    this._syncFocusRegistration()
  }

  get roots(): TreeNode<T>[] { return this._roots }
  set roots(roots: TreeNode<T>[]) {
    if (roots === this._roots) return
    this._roots = roots
    if (this._popup.visible) this._popup.refresh()
    this.markNeedsPaint()
  }

  get checkedKeys(): string[] { return [...this._checkedKeys] }
  set checkedKeys(keys: readonly string[]) {
    const nextKeys = normalizeUniqueKeys(keys)
    if (sameStringArray(nextKeys, this._checkedKeys)) return
    this._checkedKeys = nextKeys
    if (this._popup.visible) this._popup.checkedKeys = nextKeys
    this.markNeedsPaint()
  }

  getValue(): string[] {
    return this.checkedKeys
  }

  setValue(value: string[]): void {
    const nextValue = normalizeUniqueKeys(value)
    if (sameStringArray(nextValue, this._checkedKeys)) return
    this._popup.close()
    this._resetQueryPresentation()
    this.checkedKeys = nextValue
  }

  subscribeValueChange(
    listener: ValueEditorValueChangeListener<
      string[],
      DropCheckTreeEditValueChangeReason,
      TreeNode<T>[]
    >,
  ): DisposeFn {
    return this._valueEditorEvents.subscribeValueChange(listener)
  }

  subscribeBlur(listener: () => void): DisposeFn {
    return this._valueEditorEvents.subscribeBlur(listener)
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
    const fullTooltipText = this._fullTooltipText()
    const showingPlaceholder = displayText.length === 0 && (!this._checkedNodes().length || this._showQueryInField)
    const textColor = this.disabled
      ? input.textDisabled
      : showingPlaceholder
        ? input.placeholderText
        : resolveTextColor(dropdown.itemText, 'normal')
    const text = showingPlaceholder ? this.placeholder : displayText
    this._syncOverflowTooltip(
      text,
      fullTooltipText,
      shell.valueRect.w,
      dropdown.fontSize,
      dropdown.fontFamily,
      showingPlaceholder,
    )
    dl.pushClip(shell.valueRect.x, y, shell.valueRect.w, fieldHeight)
    paintSingleLineText(dl, {
      text,
      x: shell.valueRect.x,
      y: y + fieldHeight / 2,
      maxWidth: shell.valueRect.w,
      color: textColor,
      fontSize: dropdown.fontSize,
      fontFamily: dropdown.fontFamily,
    })
    dl.popClip()

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
    if (this.searchable && isTreeLookupTypingKey(event)) {
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

  debugState(): DropCheckTreeEditDebugState {
    return {
      popupVisible: this._popup.visible,
      queryText: this._queryText,
      showQueryInField: this._showQueryInField,
      displayText: this._displayText(),
      focused: this._focused,
      disabled: this.disabled,
      readonly: this.readonly,
      checkedKeys: this.checkedKeys,
      checkedLabel: this._checkedLabel(),
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
      checkedKeys: this.checkedKeys,
      searchable: this.searchable,
      maxVisibleItems: this.maxVisibleItems,
      initialQuery,
      openExpandedKeys: this._openExpandedKeys(),
      resolveRoots: query => this._resolveQueryRoots(query),
      onCheck: (checkedKeys, nodes) => {
        const previousValue = this.checkedKeys
        const nextValue = normalizeUniqueKeys(checkedKeys)
        this._checkedKeys = nextValue
        this._queryText = ''
        this._showQueryInField = false
        if (!sameStringArray(previousValue, nextValue)) {
          this._emitValueChange(nextValue, previousValue, nodes, 'selection')
        }
        this.markNeedsPaint()
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

  private _resolveQueryRoots(query: string): TreeNode<T>[] {
    const processor = this.queryProcessor ?? defaultDropCheckTreeEditQueryProcessor<T>(this.queryTextBuilder)
    return processor({
      query,
      roots: this.roots,
      checkedKeys: this.checkedKeys,
    })
  }

  private _openExpandedKeys(): string[] | undefined {
    if (this.expandAllOnOpen) return collectExpandableNodeKeys(this.roots)
    if (typeof this.expandedKeysOnOpen === 'function') {
      return Array.from(new Set([
        ...this.expandedKeysOnOpen({
          roots: this.roots,
          checkedKeys: this.checkedKeys,
        }),
        ...collectAncestorKeysForKeys(this.roots, this.checkedKeys),
      ]))
    }
    if (this.expandedKeysOnOpen) {
      return Array.from(new Set([
        ...this.expandedKeysOnOpen,
        ...collectAncestorKeysForKeys(this.roots, this.checkedKeys),
      ]))
    }
    return undefined
  }

  private _checkedNodes(): TreeNode<T>[] {
    return this.checkedKeys
      .map(key => findTreeNodeByKey(this.roots, key))
      .filter((node): node is TreeNode<T> => node !== null)
  }

  private _displayText(): string {
    if (this._popup.visible && this._showQueryInField) return this._queryText
    return this._checkedLabel()
  }

  private _checkedLabel(): string {
    const checkedNodes = this._checkedNodes()
    if (checkedNodes.length === 0) return ''
    if (this.summaryBuilder) {
      return this.summaryBuilder({
        roots: this.roots,
        checkedKeys: this.checkedKeys,
        checkedNodes,
      })
    }
    return defaultDropCheckSummary({
      roots: this.roots,
      checkedKeys: this.checkedKeys,
      checkedNodes,
      maxSummaryItems: this.maxSummaryItems,
    })
  }

  private _fullTooltipText(): string {
    if (this._popup.visible && this._showQueryInField) return ''
    const checkedNodes = this._checkedNodes()
    if (checkedNodes.length === 0) return ''
    return checkedNodes.map(node => node.label).join('、')
  }

  private _syncOverflowTooltip(
    displayText: string,
    fullTooltipText: string,
    availableWidth: number,
    fontSize: number,
    fontFamily: string,
    showingPlaceholder: boolean,
  ): void {
    if (showingPlaceholder || !displayText || !fullTooltipText) {
      this.tooltip = undefined
      return
    }
    const measuredWidth = TextMeasurer.measureWidth(displayText, fontSize, fontFamily)
    const summaryCollapsed = displayText !== fullTooltipText
    this.tooltip = summaryCollapsed || measuredWidth > availableWidth ? fullTooltipText : undefined
  }

  private _resetQueryPresentation(): void {
    this._queryText = ''
    this._showQueryInField = false
  }

  private _debugFilteredCount(): number {
    return this._popup.visible ? this._popup.filteredCount : countTreeNodes(this.roots)
  }

  private _showClearButton(): boolean {
    return this.clearable && !this.disabled && !this.readonly && this._checkedKeys.length > 0
  }

  private _clearValue(): void {
    if (!this._showClearButton()) return
    const previousValue = this.checkedKeys
    this._popup.close()
    this._resetQueryPresentation()
    FocusManager.instance.setFocus(this)
    this.checkedKeys = []
    this._emitValueChange([], previousValue, [], 'clear')
    this.markNeedsPaint()
  }

  private _emitValueChange(
    value: string[],
    previousValue: string[],
    nodes: TreeNode<T>[],
    reason: DropCheckTreeEditValueChangeReason,
  ): void {
    runCleanupSteps([
      () => this.onChange?.([...value], [...nodes]),
      () => this._valueEditorEvents.emitValueChange({
        value: [...value],
        previousValue: [...previousValue],
        reason,
        detail: [...nodes],
      }),
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

export function defaultDropCheckTreeEditQueryProcessor<T = any>(
  queryTextBuilder?: DropCheckTreeEditQueryTextBuilder<T>,
): DropCheckTreeEditQueryProcessor<T> {
  const builder = queryTextBuilder ?? defaultDropCheckTreeQueryTextBuilder
  return ({ query, roots }) => {
    const normalizedQuery = normalizeTreeLookupQuery(query)
    if (!normalizedQuery) return [...roots]
    const filtered: TreeNode<T>[] = []
    for (const node of roots) {
      const next = filterTreeNode(node, normalizedQuery, builder)
      if (next) filtered.push(next)
    }
    return filtered
  }
}

function defaultDropCheckTreeQueryTextBuilder<T>(node: TreeNode<T>): string[] {
  return [node.key, node.label]
}

function normalizeTreeLookupQuery(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function filterTreeNode<T>(
  node: TreeNode<T>,
  query: string,
  textBuilder: DropCheckTreeEditQueryTextBuilder<T>,
): TreeNode<T> | null {
  const texts = textBuilder(node).map(item => normalizeTreeLookupQuery(item))
  const selfMatch = texts.some(text => text.includes(query))
  const nextChildren = (node.children ?? []).flatMap(child => {
    const next = filterTreeNode(child, query, textBuilder)
    return next ? [next] : []
  })
  if (!selfMatch && nextChildren.length === 0) return null
  return nextChildren.length > 0 ? { ...node, children: nextChildren } : { ...node, children: undefined }
}

function findTreeNodeByKey<T>(roots: readonly TreeNode<T>[], key: string): TreeNode<T> | null {
  if (!key) return null
  for (const node of roots) {
    if (node.key === key) return node
    const child = node.children ? findTreeNodeByKey(node.children, key) : null
    if (child) return child
  }
  return null
}

function collectExpandableNodeKeys<T>(roots: readonly TreeNode<T>[]): string[] {
  const keys: string[] = []
  const visit = (nodes: readonly TreeNode<T>[]) => {
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

function collectAncestorKeysForKeys<T>(roots: readonly TreeNode<T>[], keys: readonly string[]): string[] {
  const ancestors = new Set<string>()
  for (const key of keys) {
    for (const ancestor of collectAncestorKeys(roots, key)) ancestors.add(ancestor)
  }
  return [...ancestors]
}

function collectAncestorKeys<T>(roots: readonly TreeNode<T>[], key: string): string[] {
  if (!key) return []
  const path: string[] = []
  const visit = (nodes: readonly TreeNode<T>[], currentAncestors: string[]): boolean => {
    for (const node of nodes) {
      if (node.key === key) {
        path.push(...currentAncestors)
        return true
      }
      if (node.children && node.children.length > 0) {
        if (visit(node.children, [...currentAncestors, node.key])) return true
      }
    }
    return false
  }
  visit(roots, [])
  return path
}

function countVisibleTreeNodes<T>(roots: readonly TreeNode<T>[], expandedKeys: readonly string[]): number {
  const expanded = new Set(expandedKeys)
  let count = 0
  const visit = (nodes: readonly TreeNode<T>[]) => {
    for (const node of nodes) {
      count += 1
      if (node.children && node.children.length > 0 && expanded.has(node.key)) visit(node.children)
    }
  }
  visit(roots)
  return count
}

function countTreeNodes<T>(roots: readonly TreeNode<T>[]): number {
  let count = 0
  const visit = (nodes: readonly TreeNode<T>[]) => {
    for (const node of nodes) {
      count += 1
      if (node.children && node.children.length > 0) visit(node.children)
    }
  }
  visit(roots)
  return count
}

function isTreeLookupTypingKey(event: KeyboardEvent): boolean {
  return !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    event.key.length === 1 &&
    /\S/.test(event.key)
}

function normalizeUniqueKeys(keys: readonly string[]): string[] {
  return Array.from(new Set(keys.map(key => String(key ?? '')).filter(Boolean)))
}

function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function defaultDropCheckSummary<T>(context: DropCheckTreeEditSummaryContext<T> & { maxSummaryItems: number }): string {
  const labels = context.checkedNodes.map(node => node.label)
  if (labels.length <= context.maxSummaryItems) return labels.join('、')
  const visible = labels.slice(0, context.maxSummaryItems)
  return `${visible.join('、')} +${labels.length - visible.length}`
}
