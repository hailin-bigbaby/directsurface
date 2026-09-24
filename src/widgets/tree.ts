// Tree: 树形组件
// 支持展开/折叠、节点选中、缩进层级、虚拟滚动

import { RenderBox, type RenderBoxOptions } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import { hitTestScrollbarGeometry, paintVBar, resolveScrollbarGeometryForState, type ScrollbarGeometry } from '../rendering/scrollbar'
import { ellipsizeText } from '../core/text_overflow'
import { TextMeasurer } from '../core/text_measurer'
import {
  blendColor,
  deriveCheckboxStyle,
  deriveScrollbarStyle,
  deriveTreeStyle,
  resolveBgColor,
  resolveTextColor,
  type CheckboxStyleTokens,
  type InteractionStateFlags,
  type ScrollbarStyleTokens,
  type TreeLabelTokenKind,
  type TreeStyleTokens,
} from '../theme/component_styles'
import type { PaintContext } from '../rendering/paint_context'
import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset, type Rect } from '../core/render_object'
import type { ResolvedTheme } from '../theme/theme'
import type { PointerEvent, WheelPointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import { pointerKey } from '../gestures/pointer_identity'
import { ScrollbarAxisController } from '../gestures/scrollbar_interaction_controller'
import { calcFixedVirtualRange } from '../virtualization/fixed_virtual_range'
import { ScrollController } from '../virtualization/scroll_controller'
import { FocusManager } from '../core/focus_manager'
import type { Focusable } from '../core/focus_manager'
import type { CopyableSelection } from '../core/clipboard'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { isIconName, paintIconGlyph } from './icon'
import {
  paintSurfaceBackground,
  paintSurfaceBorder,
  pushSurfaceContentClip,
  type SurfaceAppearance,
} from './surface_appearance'

export type { TreeLabelTokenKind }

export interface TreeLabelToken {
  text: string
  kind: TreeLabelTokenKind
}

export interface TreeNode<T = any> {
  key: string
  label: string
  labelTokens?: readonly TreeLabelToken[]
  tooltip?: string
  icon?: string          // 内置 IconName、emoji 或单字符图标
  selectable?: boolean
  checkable?: boolean
  data?: T
  children?: TreeNode<T>[]
}

export type TreeSelectionMode = 'single' | 'check'

export interface TreeCheckChange<T = any> {
  checkedKeys: string[]
  halfCheckedKeys: string[]
  checkedNodes: TreeNode<T>[]
  halfCheckedNodes: TreeNode<T>[]
  toggledNode: TreeNode<T>
}

export interface TreeContextMenuRequest<T = unknown> {
  node: TreeNode<T>
  position: Offset
  source: 'pointer' | 'keyboard'
}

export interface TreeVisibleNodeDebugTarget {
  key: string
  rect: Rect
}

export interface TreeViewDebugState {
  scrollY: number
  focusedIndex: number
  hoveredKey: string
  totalContentH: number
  rowHeight: number
  indentWidth: number
  checkedKeys: string[]
  halfCheckedKeys: string[]
  visibleNodes: readonly TreeVisibleNodeDebugTarget[]
}

// 扁平化后的节点（用于虚拟滚动）
interface FlatNode<T> {
  node: TreeNode<T>
  depth: number
  hasChildren: boolean
  expanded: boolean
  isLast: boolean
}

interface TreeVisibleNodePaintSnapshot {
  globalOffset: Offset
  size: { width: number; height: number }
  scrollY: number
  flatRevision: number
  theme: ResolvedTheme
}

export class RenderTreeView<T = any> extends RenderBox implements InteractiveRenderObject, Focusable, CopyableSelection {
  static override debugTypeName = 'RenderTreeView'
  onSelect?: (node: TreeNode<T>) => void
  onExpand?: (node: TreeNode<T>, expanded: boolean) => void
  onActivate?: (node: TreeNode<T>) => void
  onCheck?: (payload: TreeCheckChange<T>) => void
  onContextMenuRequest?: (request: TreeContextMenuRequest<T>) => boolean | void

  private _roots: TreeNode<T>[]
  private _selectedKey = ''
  private _selectionMode: TreeSelectionMode
  private _checkedLeafKeys = new Set<string>()
  private _fullyCheckedKeys = new Set<string>()
  private _halfCheckedKeys = new Set<string>()
  private _expanded = new Set<string>()
  private _flatNodes: FlatNode<T>[] = []
  private _hoveredKey = ''
  private _scroll = new ScrollController()
  private _focusedIndex = -1   // 键盘焦点行索引
  private _focused = false
  private _focusRegistered = false
  private _disabled: boolean
  private _appearance: SurfaceAppearance
  private _rowHeight: number
  private readonly _vScrollbarController = new ScrollbarAxisController('vertical')
  private readonly _vScrollbar = this._vScrollbarController.state
  private _indentWidth: number
  private _framePadding: number
  private _revealSelectedOnNextLayout = false
  private _suppressNextFocusReveal = false
  private _copyable: boolean
  private _copyText?: (node: TreeNode<T>) => string | null | undefined
  private _flatRevision = 0
  private _paintedVisibleNodes: TreeVisibleNodeDebugTarget[] = []
  private _visibleNodePaintSnapshot: TreeVisibleNodePaintSnapshot | null = null

  focusIn(): void {
    if (this.disabled || !this.visible) return
    this._focused = true
    if (this._flatNodes.length > 0) {
      const selectedIndex = this._selectedKey
        ? this._flatNodes.findIndex(flat => flat.node.key === this._selectedKey)
        : -1
      if (selectedIndex >= 0) this._focusedIndex = selectedIndex
      else if (this._selectionMode === 'check') {
        const checkedIndex = this._findCheckAnchorIndex()
        if (checkedIndex >= 0) this._focusedIndex = checkedIndex
        else if (this._focusedIndex < 0) this._focusedIndex = 0
      } else if (this._focusedIndex < 0) this._focusedIndex = 0
    }
    if (!this._suppressNextFocusReveal) this._scrollToFocused()
    this._suppressNextFocusReveal = false
    this.markNeedsPaint()
  }
  focusOut(): void { this._blur() }
  get isFocused(): boolean { return this._focused }

  constructor(opts: RenderBoxOptions & {
    roots: TreeNode<T>[]
    selectionMode?: TreeSelectionMode
    checkedKeys?: readonly string[]
    defaultCheckedKeys?: readonly string[]
    defaultExpandedKeys?: string[]
    disabled?: boolean
    /** Controls whether the tree owns its outer frame. @default 'flush' */
    appearance?: SurfaceAppearance
    onSelect?: (node: TreeNode<T>) => void
    onExpand?: (node: TreeNode<T>, expanded: boolean) => void
    onActivate?: (node: TreeNode<T>) => void
    onCheck?: (payload: TreeCheckChange<T>) => void
    onContextMenuRequest?: (request: TreeContextMenuRequest<T>) => boolean | void
    copyable?: boolean
    copyText?: (node: TreeNode<T>) => string | null | undefined
  }) {
    super(opts)
    this._roots = opts.roots
    this._selectionMode = opts.selectionMode ?? 'single'
    this.onSelect = opts.onSelect
    this.onExpand = opts.onExpand
    this.onActivate = opts.onActivate
    this.onCheck = opts.onCheck
    this.onContextMenuRequest = opts.onContextMenuRequest
    const _defaultTreeStyle = deriveTreeStyle(ImGuiDarkTheme)
    this._rowHeight = _defaultTreeStyle.fontSize + _defaultTreeStyle.paddingH * 1.5
    this._indentWidth = _defaultTreeStyle.fontSize + 4
    this._framePadding = _defaultTreeStyle.paddingH
    this._disabled = opts.disabled ?? false
    this._appearance = opts.appearance ?? 'flush'
    this._copyable = opts.copyable ?? true
    this._copyText = opts.copyText

    for (const key of opts.defaultExpandedKeys ?? []) {
      this._expanded.add(key)
    }
    for (const key of opts.checkedKeys ?? opts.defaultCheckedKeys ?? []) {
      this._checkedLeafKeys.add(key)
    }
    this._buildFlatNodes()
    this._recomputeCheckState()
    this._syncFocusRegistration()
  }

  get selectionMode(): TreeSelectionMode { return this._selectionMode }
  set selectionMode(mode: TreeSelectionMode) {
    if (mode === this._selectionMode) return
    this._selectionMode = mode
    this.markNeedsPaint()
  }

  get appearance(): SurfaceAppearance { return this._appearance }
  set appearance(value: SurfaceAppearance) {
    if (value === this._appearance) return
    this._appearance = value
    this.markNeedsPaint()
  }

  get roots(): TreeNode<T>[] { return this._roots }
  set roots(roots: TreeNode<T>[]) {
    if (roots === this._roots) {
      this._syncTreeState()
      this.markNeedsPaint()
      return
    }
    this._roots = roots
    this._syncTreeState()
    this.markNeedsPaint()
  }

  get indentWidth(): number { return this._indentWidth }

  get expandedKeys(): string[] { return [...this._expanded] }
  set expandedKeys(keys: readonly string[]) {
    const nextExpanded = new Set(keys)
    const changed = nextExpanded.size !== this._expanded.size || [...nextExpanded].some(key => !this._expanded.has(key))
    if (!changed) return
    this._expanded = nextExpanded
    this._syncTreeState()
    this.markNeedsPaint()
  }

  get selectedKey(): string { return this._selectedKey }
  set selectedKey(key: string) {
    const nextKey = key && this._isSelectableKey(key) ? key : ''
    if (nextKey === this._selectedKey) return
    this._selectedKey = nextKey
    this._revealSelectedOnNextLayout = nextKey.length > 0
    this.markNeedsPaint()
  }

  get checkedKeys(): string[] { return [...this._checkedLeafKeys] }
  set checkedKeys(keys: readonly string[]) {
    const nextKeys = new Set(keys)
    const changed = nextKeys.size !== this._checkedLeafKeys.size || [...nextKeys].some(key => !this._checkedLeafKeys.has(key))
    if (!changed) return
    this._checkedLeafKeys = nextKeys
    this._recomputeCheckState()
    this.markNeedsPaint()
  }

  get halfCheckedKeys(): string[] { return [...this._halfCheckedKeys] }

  get disabled(): boolean { return this._disabled }
  set disabled(disabled: boolean) {
    if (this._disabled === disabled) return
    this._disabled = disabled
    this._clearPaintedVisibleNodes()
    if (disabled) this._clearInteractionState()
    this._syncFocusRegistration()
    this.markNeedsPaint()
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  getCopyText(): string | null {
    if (this.disabled || !this._copyable) return null
    const node = this._selectedNode() ?? this._flatNodes[this._focusedIndex]?.node ?? null
    if (!node) return null
    const text = this._copyText ? this._copyText(node) : node.label
    return text ?? null
  }

  nodeAtPosition(position: Offset): TreeNode<T> | null {
    return this._flatNodeAtPosition(position)?.node ?? null
  }

  onContextMenu(position: Offset): boolean {
    const callback = this.onContextMenuRequest
    if (!callback || this.disabled || !this.visible) return false
    const flat = this._flatNodeAtPosition(position)
    if (!flat) return false

    this._focused = true
    if (FocusManager.instance.current !== this) this._suppressNextFocusReveal = true
    FocusManager.instance.setFocus(this)
    this._suppressNextFocusReveal = false
    this._focusedIndex = this._flatNodes.indexOf(flat)

    if (flat.node.selectable !== false && this._selectedKey !== flat.node.key) {
      this.selectedKey = flat.node.key
      this.onSelect?.(flat.node)
    }
    this.markNeedsPaint()
    const handled = callback({
      node: flat.node,
      position: { ...position },
      source: 'pointer',
    })
    return handled !== false
  }

  isExpandToggleAtPosition(position: Offset): boolean {
    const flat = this._flatNodeAtPosition(position)
    return !!flat?.hasChildren && this._isArrowClick(position.x, flat)
  }

  nodeRect(key: string): Rect | undefined {
    const index = this._flatNodes.findIndex(flat => flat.node.key === key)
    if (index < 0) return undefined
    const y = this.globalOffset.y + index * this._rowHeight - this._scrollY
    const bottom = this.globalOffset.y + this.size.height
    if (y + this._rowHeight < this.globalOffset.y || y > bottom) return undefined
    return {
      x: this.globalOffset.x,
      y,
      width: this._contentWidth(this.currentTheme),
      height: this._rowHeight,
    }
  }
  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    this._clearPaintedVisibleNodes()
    this._syncThemeMetrics(context.theme)
    this.size = constrainSize(constraints, {
      width: constraints.maxWidth === Infinity ? 240 : constraints.maxWidth,
      height: constraints.maxHeight === Infinity ? 300 : constraints.maxHeight,
    })
    if (context.pass === 'measure') return
    this._clampScrollY()
    if (this._revealSelectedOnNextLayout) {
      this.revealSelectedKey()
      this._revealSelectedOnNextLayout = false
    }
  }

  debugState(): TreeViewDebugState {
    return {
      scrollY: this._scrollY,
      focusedIndex: this._focusedIndex,
      hoveredKey: this._hoveredKey,
      totalContentH: this._totalH,
      rowHeight: this._rowHeight,
      indentWidth: this.indentWidth,
      checkedKeys: [...this._checkedLeafKeys],
      halfCheckedKeys: [...this._halfCheckedKeys],
      visibleNodes: this._debugVisibleNodes(),
    }
  }

  private _buildFlatNodes(): void {
    this._flatRevision += 1
    this._clearPaintedVisibleNodes()
    this._flatNodes = []
    const visit = (nodes: TreeNode<T>[], depth: number) => {
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index]!
        const hasChildren = !!(node.children && node.children.length > 0)
        const expanded = this._expanded.has(node.key)
        const isLast = index === nodes.length - 1
        this._flatNodes.push({ node, depth, hasChildren, expanded, isLast })
        if (hasChildren && expanded) {
          visit(node.children!, depth + 1)
        }
      }
    }
    visit(this._roots, 0)
  }

  private _debugVisibleNodes(): TreeVisibleNodeDebugTarget[] {
    const snapshot = this._visibleNodePaintSnapshot
    if (!snapshot || this.disabled || !this.visible) return []
    const globalOffset = this.globalOffset
    if (
      snapshot.globalOffset.x !== globalOffset.x ||
      snapshot.globalOffset.y !== globalOffset.y ||
      snapshot.size.width !== this.size.width ||
      snapshot.size.height !== this.size.height ||
      snapshot.scrollY !== this._scrollY ||
      snapshot.flatRevision !== this._flatRevision ||
      snapshot.theme !== this.currentTheme
    ) return []
    return this._paintedVisibleNodes.map(target => ({
      key: target.key,
      rect: { ...target.rect },
    }))
  }

  private _clearPaintedVisibleNodes(): void {
    this._paintedVisibleNodes = []
    this._visibleNodePaintSnapshot = null
  }

  private _containsKey(key: string): boolean {
    if (!key) return false
    return this._flatNodes.some(flat => flat.node.key === key)
  }

  private _isSelectableKey(key: string): boolean {
    if (!key) return false
    const node = this._findNodeByKey(this._roots, key)
    return !!node && node.selectable !== false
  }

  private _isCheckableNode(node: TreeNode<T>): boolean {
    return node.checkable !== false
  }

  private _syncTreeState(): void {
    this._buildFlatNodes()
    this._recomputeCheckState()
    this._clampScrollY()
    if (this._focusedIndex >= this._flatNodes.length) this._focusedIndex = this._flatNodes.length - 1
    if (this._hoveredKey && !this._containsKey(this._hoveredKey)) this._hoveredKey = ''
    if (this._selectedKey) {
      const selected = this._findNodeByKey(this._roots, this._selectedKey)
      if (!selected || selected.selectable === false) this._selectedKey = ''
    }
  }

  private get _totalH(): number { return this._flatNodes.length * this._rowHeight }
  private get _viewH(): number { return this.size.height }
  private get _scrollY(): number { return this._scroll.offset }
  private _clampScrollY(): void {
    this._scroll.setOffset(this._scrollY, { viewportSize: this._viewH, contentSize: this._totalH })
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const { x, y } = offset
    const { width: w, height: h } = this.size
    const s = this._treeTokens(context.theme)
    const sb = this._scrollbarTokens(context.theme)
    const contentW = this._contentWidth(context.theme)
    const frame = { x, y, width: w, height: h }
    const frameStyle = {
      background: s.panelBg,
      border: s.panelBorder,
      borderRadius: s.borderRadius,
    }
    const paintedVisibleNodes: TreeVisibleNodeDebugTarget[] = []
    const contentRect: Rect = { x, y, width: contentW, height: h }

    paintSurfaceBackground(dl, frame, this._appearance, frameStyle)
    pushSurfaceContentClip(dl, frame, this._appearance, frameStyle.borderRadius)
    dl.pushClip(x, y, contentW, h)

    const virtualRange = calcFixedVirtualRange({
      itemCount: this._flatNodes.length,
      itemSize: this._rowHeight,
      viewportSize: h,
      scrollOffset: this._scrollY,
      overscan: 1,
    })
    this._scroll.setOffset(virtualRange.scrollOffset, { viewportSize: this._viewH, contentSize: this._totalH })

    if (virtualRange.startIndex >= 0) {
      for (let i = virtualRange.startIndex; i <= virtualRange.endIndex; i++) {
        const flat = this._flatNodes[i]!
        const rowY = y + i * this._rowHeight - this._scrollY
        const indentX = x + flat.depth * this.indentWidth + this._framePadding

        // 行背景
        const isSelected = flat.node.key === this._selectedKey
        const isHovered = !this.disabled && flat.node.key === this._hoveredKey
        const isFocused = !this.disabled && this._focused && i === this._focusedIndex
        const isSelectable = !this.disabled && flat.node.selectable !== false
        const rowState: InteractionStateFlags = {
          disabled: this.disabled,
          selected: isSelected,
          hovered: isHovered,
          focused: isFocused,
        }
        const checkboxState: InteractionStateFlags = {
          disabled: this.disabled,
          hovered: isHovered,
          focused: isFocused,
        }
        if (rowState.disabled || rowState.selected || rowState.hovered) {
          const rowBg = !isSelectable && rowState.hovered
            ? blendColor(s.panelBg, resolveBgColor(s.rowBg, rowState), 0.28)
            : resolveBgColor(s.rowBg, rowState)
          dl.fillRect(x, rowY, contentW, this._rowHeight, rowBg, 0)
        }
        if (isFocused) {
          dl.strokeRect(x + 1, rowY + 1, Math.max(0, contentW - 2), this._rowHeight - 2, resolveBgColor(s.rowBorder, 'focused'), 1, 0)
        }

        // 展开/折叠箭头
        const rowLayout = this._rowLayout(flat, x, rowY, context.theme)
        const arrowX = rowLayout.arrowX
        const arrowY = rowY + this._rowHeight / 2
        this._drawLevelLines(dl, flat, x, rowY, arrowY, rowLayout.arrowX, s)
        if (flat.hasChildren) {
          this._drawExpandArrow(dl, arrowX, arrowY, flat.expanded, s)
        }

        if (rowLayout.checkboxRect) {
          const checkboxStyle = this._checkboxTokens(context.theme)
          const fullyChecked = this._fullyCheckedKeys.has(flat.node.key)
          const halfChecked = this._halfCheckedKeys.has(flat.node.key) && !fullyChecked
          const bg = fullyChecked || halfChecked
            ? resolveBgColor(checkboxStyle.checkedBoxBg, checkboxState)
            : resolveBgColor(checkboxStyle.boxBg, checkboxState)
          dl.fillRect(
            rowLayout.checkboxRect.x,
            rowLayout.checkboxRect.y,
            rowLayout.checkboxRect.w,
            rowLayout.checkboxRect.h,
            bg,
            checkboxStyle.borderRadius,
          )
          dl.strokeRect(
            rowLayout.checkboxRect.x,
            rowLayout.checkboxRect.y,
            rowLayout.checkboxRect.w,
            rowLayout.checkboxRect.h,
            resolveBgColor(checkboxStyle.boxBorder, checkboxState),
            1,
            checkboxStyle.borderRadius,
          )
          if (fullyChecked) {
            dl.drawCheckmark(
              rowLayout.checkboxRect.x,
              rowLayout.checkboxRect.y,
              rowLayout.checkboxRect.w,
              resolveTextColor(checkboxStyle.checkMark, checkboxState),
              2,
            )
          } else if (halfChecked) {
            const pad = rowLayout.checkboxRect.w * 0.25
            const midY = rowLayout.checkboxRect.y + rowLayout.checkboxRect.h / 2
            dl.line(
              rowLayout.checkboxRect.x + pad,
              midY,
              rowLayout.checkboxRect.x + rowLayout.checkboxRect.w - pad,
              midY,
              resolveTextColor(checkboxStyle.checkMark, checkboxState),
              2,
            )
          }
        }

        // 图标
        const labelColor = !isSelectable
          ? blendColor(resolveTextColor(s.labelText, rowState), context.theme.textDisabled, isHovered ? 0.45 : 0.62)
          : resolveTextColor(s.labelText, rowState)
        const iconColor = !isSelectable
          ? blendColor(resolveTextColor(s.iconText, rowState), context.theme.textDisabled, isHovered ? 0.45 : 0.62)
          : resolveTextColor(s.iconText, rowState)
        if (flat.node.icon) {
          if (isIconName(flat.node.icon)) {
            paintIconGlyph(context, {
              name: flat.node.icon,
              x: rowLayout.iconX,
              y: arrowY - s.fontSize / 2,
              size: s.fontSize,
              color: iconColor,
            })
          } else {
            dl.fillText(flat.node.icon, rowLayout.iconX, arrowY, iconColor, s.fontSize, s.fontFamily, 'left', 'middle')
          }
        }

        const labelClipW = Math.max(0, contentW - (rowLayout.textX - x) - this._framePadding)
        dl.pushClip(rowLayout.textX, rowY, labelClipW, this._rowHeight)
        if (flat.node.labelTokens?.length) {
          this._drawLabelTokens(dl, flat.node.labelTokens, rowLayout.textX, arrowY, labelColor, isSelectable, rowState, context.theme, s)
        } else {
          const labelText = ellipsizeText(
            flat.node.label,
            labelClipW,
            text => dl.measureText(text, s.fontSize, s.fontFamily).width,
          )
          dl.fillText(labelText, rowLayout.textX, arrowY, labelColor, s.fontSize, s.fontFamily, 'left', 'middle')
        }
        dl.popClip()

        if (!this.disabled) {
          const clipped = intersectTreeRect({
            x,
            y: rowY,
            width: contentW,
            height: this._rowHeight,
          }, contentRect)
          if (clipped && this.nodeAtPosition({
            x: clipped.x + clipped.width / 2,
            y: clipped.y + clipped.height / 2,
          })?.key === flat.node.key) {
            paintedVisibleNodes.push({ key: flat.node.key, rect: clipped })
          }
        }
      }
    }

    dl.popClip()

    // 滚动条
    paintVBar({
      dl,
      style: sb,
      trackX: x + w - sb.gutterSize,
      trackY: y,
      trackW: sb.gutterSize,
      trackH: h,
      viewSize: this._viewH,
      contentSize: this._totalH,
      scrollOffset: this._scrollY,
      state: this._vScrollbar,
    })
    dl.popClip()
    paintSurfaceBorder(dl, frame, this._appearance, frameStyle)

    this._paintedVisibleNodes = paintedVisibleNodes
    this._visibleNodePaintSnapshot = {
      globalOffset: { ...this.globalOffset },
      size: { ...this.size },
      scrollY: this._scrollY,
      flatRevision: this._flatRevision,
      theme: context.theme,
    }
  }

  private _drawLabelTokens(
    dl: DrawList,
    tokens: readonly TreeLabelToken[],
    x: number,
    y: number,
    fallbackColor: ResolvedTheme['textPrimary'],
    isSelectable: boolean,
    rowState: InteractionStateFlags,
    theme: ResolvedTheme,
    style: TreeStyleTokens,
  ): void {
    let cursorX = x
    for (const token of tokens) {
      if (!token.text) continue
      const tokenColor = style.labelTokenText[token.kind] ?? fallbackColor
      const color = !isSelectable
        ? blendColor(tokenColor, theme.textDisabled, rowState.hovered ? 0.45 : 0.62)
        : tokenColor
      dl.fillText(token.text, cursorX, y, color, style.fontSize, style.fontFamily, 'left', 'middle')
      cursorX += dl.measureText(token.text, style.fontSize, style.fontFamily).width
    }
  }

  private _drawExpandArrow(dl: DrawList, x: number, y: number, expanded: boolean, style: TreeStyleTokens): void {
    const size = style.fontSize * 0.5
    const color = resolveTextColor(style.arrowText, 'normal')
    const ctx = (dl as any).ctx as CanvasRenderingContext2D
    ctx.save()
    ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${color.a})`
    ctx.beginPath()
    if (expanded) {
      ctx.moveTo(x - size, y - size * 0.5)
      ctx.lineTo(x + size, y - size * 0.5)
      ctx.lineTo(x, y + size * 0.5)
    } else {
      ctx.moveTo(x - size * 0.5, y - size)
      ctx.lineTo(x + size * 0.5, y)
      ctx.lineTo(x - size * 0.5, y + size)
    }
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  private _drawLevelLines(
    dl: DrawList,
    flat: FlatNode<T>,
    rowX: number,
    rowY: number,
    centerY: number,
    nodeAxisX: number,
    style: TreeStyleTokens,
  ): void {
    if (flat.depth <= 0 && (!flat.hasChildren || !flat.expanded)) return
    const color = style.levelLine
    const lineWidth = 1
    const branchX = (level: number): number =>
      rowX + this._framePadding + level * this.indentWidth + this.indentWidth / 2

    for (let level = 0; level < flat.depth - 1; level += 1) {
      const x = branchX(level)
      dl.line(x, rowY, x, rowY + this._rowHeight, color, lineWidth)
    }

    if (flat.depth > 0) {
      const parentX = branchX(flat.depth - 1)
      const verticalEndY = flat.isLast && (!flat.hasChildren || !flat.expanded)
        ? centerY
        : rowY + this._rowHeight
      const arrowClearance = flat.hasChildren ? style.fontSize * 0.5 + 3 : 2
      const horizontalEndX = Math.max(parentX, nodeAxisX - arrowClearance)
      dl.line(parentX, rowY, parentX, verticalEndY, color, lineWidth)
      dl.line(parentX, centerY, horizontalEndX, centerY, color, lineWidth)
    }

    if (flat.hasChildren && flat.expanded) {
      const arrowBottomY = centerY + style.fontSize * 0.25
      dl.line(nodeAxisX, arrowBottomY, nodeAxisX, rowY + this._rowHeight, color, lineWidth)
    }
  }

  private _flatNodeAtPosition(position: Offset): FlatNode<T> | null {
    if (this.disabled) return null
    const g = this.globalOffset
    const inBounds = position.x >= g.x &&
      position.x <= g.x + this.size.width &&
      position.y >= g.y &&
      position.y <= g.y + this.size.height
    if (!inBounds) return null
    if (this.size.height > 0 && this._inScrollbar(position)) return null
    return this._nodeAtY(position.y)
  }

  private _nodeAtY(globalY: number): FlatNode<T> | null {
    const g = this.globalOffset
    const relY = globalY - g.y + this._scrollY
    const i = Math.floor(relY / this._rowHeight)
    return i >= 0 && i < this._flatNodes.length ? this._flatNodes[i]! : null
  }

  private _isArrowClick(globalX: number, flat: FlatNode<T>): boolean {
    const g = this.globalOffset
    const arrowX = g.x + flat.depth * this.indentWidth + this._framePadding + this.indentWidth / 2
    return globalX >= arrowX - this.indentWidth / 2 && globalX <= arrowX + this.indentWidth / 2
  }

  private _inScrollbar(p: Offset): boolean {
    return hitTestScrollbarGeometry(p, this._scrollbarGeometry())
  }

  private _scrollbarGeometry(): ScrollbarGeometry {
    const g = this.globalOffset
    const scrollbarW = this._scrollbarWidth()
    return resolveScrollbarGeometryForState({
      axis: 'vertical',
      trackRect: { x: g.x + this.size.width - scrollbarW, y: g.y, width: scrollbarW, height: this.size.height },
      viewportSize: this._viewH,
      contentSize: this._totalH,
      scrollOffset: this._scrollY,
      style: deriveScrollbarStyle(this.currentTheme),
      state: this._vScrollbar,
    })
  }

  private _contentWidth(theme: ResolvedTheme = this.currentTheme): number {
    const scrollbarW = this._scrollbarWidth(theme)
    return Math.max(0, this.size.width - (this._totalH > this._viewH ? scrollbarW : 0))
  }

  private _syncOverflowTooltip(position: Offset): void {
    this.tooltip = undefined
    if (!this.hitTest(position) || this._inScrollbar(position)) return
    const flat = this._nodeAtY(position.y)
    if (!flat || !flat.node.label) return
    const theme = this.currentTheme
    const s = this._treeTokens(theme)
    const rowLayout = this._rowLayout(flat, this.globalOffset.x, 0, theme)
    const availableWidth = Math.max(0, this._contentWidth(theme) - (rowLayout.textX - this.globalOffset.x) - this._framePadding)
    if (TextMeasurer.measureWidth(flat.node.label, s.fontSize, s.fontFamily) > availableWidth) {
      this.tooltip = flat.node.tooltip ?? flat.node.label
    }
  }

  onPointerDown(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    if (this.disabled) return
    if (!this.hitTest(e.position)) {
      FocusManager.instance.clearFocus()
      return
    }

    const scrollbarResult = this._vScrollbarController.beginPointer(
      e.position,
      this._scrollbarGeometry(),
      pointerKey(e),
    )
    if (scrollbarResult.handled) {
      e.stopPropagation?.()
      e.preventActivation?.()
      if (scrollbarResult.capturePointer) e.setPointerCapture?.()
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
    if (FocusManager.instance.current !== this) {
      this._suppressNextFocusReveal = true
    }
    FocusManager.instance.setFocus(this)
    this._suppressNextFocusReveal = false
    const flat = this._nodeAtY(e.position.y)
    if (!flat) return

    const i = this._flatNodes.indexOf(flat)
    this._focusedIndex = i

    if (this._selectionMode === 'check') {
      const rowY = this.globalOffset.y + i * this._rowHeight - this._scrollY
      const checkboxRect = this._rowLayout(flat, this.globalOffset.x, rowY, this.currentTheme).checkboxRect
      if (checkboxRect && pointInRect(e.position, checkboxRect)) {
        this._toggleCheckedNode(flat.node)
        return
      }
      if (flat.node.selectable === false && flat.hasChildren) {
        if (this._expanded.has(flat.node.key)) this._expanded.delete(flat.node.key)
        else this._expanded.add(flat.node.key)
        this._buildFlatNodes()
        this._focusedIndex = this._flatNodes.findIndex(f => f.node.key === flat.node.key)
        this.onExpand?.(flat.node, this._expanded.has(flat.node.key))
      }
      this.markNeedsPaint()
      return
    }

    if (flat.hasChildren && this._isArrowClick(e.position.x, flat)) {
      if (this._expanded.has(flat.node.key)) {
        this._expanded.delete(flat.node.key)
      } else {
        this._expanded.add(flat.node.key)
      }
      this._buildFlatNodes()
      // 重新找 focusedIndex（展开/折叠后 flatNodes 变化）
      this._focusedIndex = this._flatNodes.findIndex(f => f.node.key === flat.node.key)
      this.onExpand?.(flat.node, this._expanded.has(flat.node.key))
    } else if (flat.node.selectable !== false) {
      this.selectedKey = flat.node.key
      this.onSelect?.(flat.node)
    } else if (flat.hasChildren) {
      if (this._expanded.has(flat.node.key)) this._expanded.delete(flat.node.key)
      else this._expanded.add(flat.node.key)
      this._buildFlatNodes()
      this._focusedIndex = this._flatNodes.findIndex(f => f.node.key === flat.node.key)
      this.onExpand?.(flat.node, this._expanded.has(flat.node.key))
    }
    this.markNeedsPaint()
  }

  onDoubleClick(position: Offset): void {
    if (this.disabled || !this.hitTest(position) || this._inScrollbar(position)) return
    const flat = this._nodeAtY(position.y)
    if (!flat || flat.node.selectable === false) return
    if (flat.hasChildren && this._isArrowClick(position.x, flat)) return
    this._focused = true
    this._focusedIndex = this._flatNodes.indexOf(flat)
    this.selectedKey = flat.node.key
    this.onActivate?.(flat.node)
    this.markNeedsPaint()
  }

  onPointerMove(e: PointerEvent): void {
    if (this.disabled) return
    if (this._vScrollbar.dragging) {
      const result = this._vScrollbarController.updatePointer(
        e.position,
        this._scrollbarGeometry(),
        pointerKey(e),
      )
      if (!result.handled) return
      e.stopPropagation?.()
      this._scroll.setOffset(result.scrollOffset ?? this._scrollY, {
        viewportSize: this._viewH,
        contentSize: this._totalH,
      })
      this.markNeedsPaint()
      return
    }

    if (!this.hitTest(e.position)) {
      const hadState = this._hoveredKey || this._vScrollbarController.clearHover()
      this._hoveredKey = ''
      this.tooltip = undefined
      if (hadState) this.markNeedsPaint()
      return
    }

    if (this._vScrollbarController.updateHover(e.position, this._scrollbarGeometry())) this.markNeedsPaint()
    const hoveredScrollbar = this._vScrollbar.hovered
    if (hoveredScrollbar) {
      if (this._hoveredKey) {
        this._hoveredKey = ''
        this.markNeedsPaint()
      }
      this.tooltip = undefined
      return
    }

    const flat = this._nodeAtY(e.position.y)
    const key = flat?.node.key ?? ''
    if (key !== this._hoveredKey) {
      this._hoveredKey = key
      this.markNeedsPaint()
    }
    this._syncOverflowTooltip(e.position)
  }

  onPointerUp(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    const key = pointerKey(e)
    if (this._vScrollbar.dragging && !this._vScrollbarController.ownsPointer(key)) return
    const result = this._vScrollbarController.endPointer(e.position, this._scrollbarGeometry(), key)
    if (result.dragEnded) {
      e.stopPropagation?.()
      e.releasePointerCapture?.()
    }
    if (result.stateChanged) this.markNeedsPaint()
  }

  onPointerCancel(e: PointerEvent): void {
    const key = pointerKey(e)
    if (this._vScrollbar.dragging && !this._vScrollbarController.ownsPointer(key)) return
    if (this._vScrollbar.dragging) {
      e.stopPropagation?.()
      e.releasePointerCapture?.()
    }
    this._vScrollbarController.cancelPointer(key)
    this._hoveredKey = ''
    this.tooltip = undefined
  }

  onPointerLeave(_e: PointerEvent): void {
    const hadHover = this._vScrollbarController.clearHover() || !!this._hoveredKey
    this._hoveredKey = ''
    this.tooltip = undefined
    if (hadHover) this.markNeedsPaint()
  }

  onWheel(e: WheelPointerEvent): boolean {
    if (this.disabled || !this.hitTest(e.position)) return false
    if (e.deltaY === 0) return false
    const scrollable = this._totalH > this._viewH
    const before = this._scroll.offset
    this._scroll.scrollBy(e.deltaY > 0 ? 60 : -60, { viewportSize: this._viewH, contentSize: this._totalH })
    if (this._scroll.offset === before) return scrollable
    this.markNeedsPaint()
    return true
  }

  private _blur(): void {
    this._focused = false
    this.markNeedsPaint()
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.disabled || !this._focused) return false
    const n = this._flatNodes.length
    if (n === 0) return false

    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      const callback = this.onContextMenuRequest
      if (!callback) return false
      const flat = this._flatNodes[this._focusedIndex]
      if (!flat) return false
      if (flat.node.selectable !== false && this._selectedKey !== flat.node.key) {
        this.selectedKey = flat.node.key
        this.onSelect?.(flat.node)
      }
      const rect = this.nodeRect(flat.node.key)
      if (!rect) return false
      const handled = callback({
        node: flat.node,
        position: { x: rect.x, y: rect.y + rect.height },
        source: 'keyboard',
      })
      this.markNeedsPaint()
      if (handled === false) return false
      event.preventDefault()
      return true
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      this._focusedIndex = Math.min(n - 1, this._focusedIndex + 1)
      this._scrollToFocused()
      this.markNeedsPaint()
      return true
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      this._focusedIndex = Math.max(0, this._focusedIndex - 1)
      this._scrollToFocused()
      this.markNeedsPaint()
      return true
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      const flat = this._flatNodes[this._focusedIndex]
      if (flat?.hasChildren && !this._expanded.has(flat.node.key)) {
        this._expanded.add(flat.node.key)
        this._buildFlatNodes()
        this._focusedIndex = this._flatNodes.findIndex(f => f.node.key === flat.node.key)
        this.onExpand?.(flat.node, true)
      } else if (flat?.hasChildren) {
        const childIndex = this._flatNodes.findIndex((candidate, index) =>
          index > this._focusedIndex &&
          candidate.depth === flat.depth + 1,
        )
        if (childIndex >= 0) {
          this._focusedIndex = childIndex
          this._scrollToFocused()
        }
      }
      this.markNeedsPaint()
      return true
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      const flat = this._flatNodes[this._focusedIndex]
      if (!flat) return true
      if (flat.hasChildren && this._expanded.has(flat.node.key)) {
        this._expanded.delete(flat.node.key)
        this._buildFlatNodes()
        this._focusedIndex = this._flatNodes.findIndex(f => f.node.key === flat.node.key)
        this.onExpand?.(flat.node, false)
      } else if (flat.depth > 0) {
        const parentIdx = this._flatNodes.slice(0, this._focusedIndex)
          .map((f, i) => ({ f, i }))
          .reverse()
          .find(({ f }) => f.depth === flat.depth - 1)?.i ?? -1
        if (parentIdx >= 0) this._focusedIndex = parentIdx
        this._scrollToFocused()
      }
      this.markNeedsPaint()
      return true
    } else if (event.key === ' ') {
      event.preventDefault()
      const flat = this._flatNodes[this._focusedIndex]
      if (!flat) return true
      if (this._selectionMode === 'check') {
        if (this._isCheckableNode(flat.node)) {
          this._toggleCheckedNode(flat.node)
          return true
        }
        if (flat.hasChildren) {
          if (this._expanded.has(flat.node.key)) this._expanded.delete(flat.node.key)
          else this._expanded.add(flat.node.key)
          this._buildFlatNodes()
          this._focusedIndex = this._flatNodes.findIndex(f => f.node.key === flat.node.key)
          this.onExpand?.(flat.node, this._expanded.has(flat.node.key))
          this.markNeedsPaint()
        }
        return true
      }
      if (flat.node.selectable === false) {
        if (flat.hasChildren) {
          if (this._expanded.has(flat.node.key)) this._expanded.delete(flat.node.key)
          else this._expanded.add(flat.node.key)
          this._buildFlatNodes()
          this._focusedIndex = this._flatNodes.findIndex(f => f.node.key === flat.node.key)
          this.onExpand?.(flat.node, this._expanded.has(flat.node.key))
          this.markNeedsPaint()
        }
        return true
      }
      this.selectedKey = flat.node.key
      this.onSelect?.(flat.node)
      this.markNeedsPaint()
      return true
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const flat = this._flatNodes[this._focusedIndex]
      if (!flat) return true
      if (flat.node.selectable === false) {
        if (flat.hasChildren && !this._expanded.has(flat.node.key)) {
          this._expanded.add(flat.node.key)
          this._buildFlatNodes()
          this._focusedIndex = this._flatNodes.findIndex(f => f.node.key === flat.node.key)
          this.onExpand?.(flat.node, true)
          this.markNeedsPaint()
        }
        return true
      }
      this.onActivate?.(flat.node)
      this.markNeedsPaint()
      return true
    }
    return false
  }

  private _scrollToFocused(): void {
    this._scroll.scrollToIndex({
      itemCount: this._flatNodes.length,
      itemSize: this._rowHeight,
      viewportSize: this._viewH,
      index: this._focusedIndex,
      align: 'nearest',
    })
  }

  private _rowLayout(flat: FlatNode<T>, rowX: number, rowY: number, theme: ResolvedTheme): {
    arrowX: number
    checkboxRect: { x: number; y: number; w: number; h: number } | null
    iconX: number
    textX: number
  } {
    const treeStyle = this._treeTokens(theme)
    const checkboxStyle = this._checkboxTokens(theme)
    const indentX = rowX + flat.depth * this.indentWidth + this._framePadding
    const arrowX = indentX + this.indentWidth / 2
    const iconOffset = flat.hasChildren ? this.indentWidth : this.indentWidth * 0.5
    let cursorX = indentX + iconOffset
    let checkboxRect: { x: number; y: number; w: number; h: number } | null = null
    if (this._selectionMode === 'check' && this._isCheckableNode(flat.node)) {
      const checkboxSize = Math.min(checkboxStyle.boxSize, this._rowHeight - 6)
      checkboxRect = {
        x: cursorX,
        y: rowY + (this._rowHeight - checkboxSize) / 2,
        w: checkboxSize,
        h: checkboxSize,
      }
      cursorX += checkboxSize + Math.max(4, Math.round(treeStyle.paddingH * 0.75))
    }
    const iconX = cursorX
    const textX = flat.node.icon ? iconX + treeStyle.fontSize + 4 : cursorX
    return {
      arrowX,
      checkboxRect,
      iconX,
      textX,
    }
  }

  revealSelectedKey(): void {
    if (!this._selectedKey) return
    const selectedIndex = this._flatNodes.findIndex(flat => flat.node.key === this._selectedKey)
    if (selectedIndex < 0) return
    this._scroll.scrollToIndex({
      itemCount: this._flatNodes.length,
      itemSize: this._rowHeight,
      viewportSize: this._viewH,
      index: selectedIndex,
      align: 'nearest',
    })
  }

  // 外部更新数据
  setRoots(roots: TreeNode<T>[]): void {
    this.roots = roots
  }

  private _checkboxTokens(theme: ResolvedTheme): CheckboxStyleTokens {
    return deriveCheckboxStyle(theme)
  }

  private _findCheckAnchorIndex(): number {
    const checkedLeafIndex = this._flatNodes.findIndex(flat => this._checkedLeafKeys.has(flat.node.key))
    if (checkedLeafIndex >= 0) return checkedLeafIndex
    return this._flatNodes.findIndex(flat =>
      this._halfCheckedKeys.has(flat.node.key) || this._fullyCheckedKeys.has(flat.node.key),
    )
  }

  private _toggleCheckedNode(node: TreeNode<T>): void {
    const targetKeys = this._checkTargetKeys(node)
    if (targetKeys.length === 0) return
    const shouldCheck = targetKeys.some(key => !this._checkedLeafKeys.has(key))
    for (const key of targetKeys) {
      if (shouldCheck) this._checkedLeafKeys.add(key)
      else this._checkedLeafKeys.delete(key)
    }
    this._recomputeCheckState()
    this.markNeedsPaint()
    this.onCheck?.({
      checkedKeys: [...this._checkedLeafKeys],
      halfCheckedKeys: [...this._halfCheckedKeys],
      checkedNodes: this._resolveNodes([...this._checkedLeafKeys]),
      halfCheckedNodes: this._resolveNodes([...this._halfCheckedKeys]),
      toggledNode: node,
    })
  }

  private _checkTargetKeys(node: TreeNode<T>): string[] {
    const childTargets = (node.children ?? []).flatMap(child => this._checkTargetKeys(child))
    if (childTargets.length > 0) return childTargets
    return this._isCheckableNode(node) ? [node.key] : []
  }

  private _resolveNodes(keys: readonly string[]): TreeNode<T>[] {
    return keys
      .map(key => this._findNodeByKey(this._roots, key))
      .filter((node): node is TreeNode<T> => node !== null)
  }

  private _selectedNode(): TreeNode<T> | null {
    return this._selectedKey ? this._findNodeByKey(this._roots, this._selectedKey) : null
  }

  private _findNodeByKey(nodes: readonly TreeNode<T>[], key: string): TreeNode<T> | null {
    for (const node of nodes) {
      if (node.key === key) return node
      const child = node.children ? this._findNodeByKey(node.children, key) : null
      if (child) return child
    }
    return null
  }

  private _recomputeCheckState(): void {
    const nextValidCheckedLeafKeys = new Set<string>()
    const nextFullyCheckedKeys = new Set<string>()
    const nextHalfCheckedKeys = new Set<string>()
    const visit = (node: TreeNode<T>): { targetCount: number; checkedTargetCount: number } => {
      const childStats = (node.children ?? []).map(child => visit(child))
      const childTargetCount = childStats.reduce((sum, child) => sum + child.targetCount, 0)
      const childCheckedTargetCount = childStats.reduce((sum, child) => sum + child.checkedTargetCount, 0)
      const isTarget = this._isCheckableNode(node) && childTargetCount === 0
      const selfChecked = isTarget && this._checkedLeafKeys.has(node.key)
      if (isTarget && selfChecked) nextValidCheckedLeafKeys.add(node.key)
      const targetCount = childTargetCount + (isTarget ? 1 : 0)
      const checkedTargetCount = childCheckedTargetCount + (selfChecked ? 1 : 0)
      if (targetCount > 0) {
        if (checkedTargetCount === targetCount) nextFullyCheckedKeys.add(node.key)
        else if (checkedTargetCount > 0) nextHalfCheckedKeys.add(node.key)
      }
      return { targetCount, checkedTargetCount }
    }
    for (const root of this._roots) visit(root)
    this._checkedLeafKeys = nextValidCheckedLeafKeys
    this._fullyCheckedKeys = nextFullyCheckedKeys
    this._halfCheckedKeys = nextHalfCheckedKeys
  }

  expandAll(): void {
    const expandedKeys = new Set<string>()
    const visit = (nodes: TreeNode<T>[]) => {
      for (const n of nodes) {
        if (n.children?.length) {
          expandedKeys.add(n.key)
          visit(n.children)
        }
      }
    }
    visit(this._roots)
    this.expandedKeys = [...expandedKeys]
  }

  collapseAll(): void {
    this.expandedKeys = []
  }

private _syncThemeMetrics(theme: ResolvedTheme): void {
    const s = deriveTreeStyle(theme)
    this._rowHeight = s.fontSize + s.paddingH * 1.5
    this._indentWidth = s.fontSize + 4
    this._framePadding = s.paddingH
  }

  private _treeTokens(theme: ResolvedTheme): TreeStyleTokens {
    return deriveTreeStyle(theme)
  }

  private _scrollbarTokens(theme: ResolvedTheme): ScrollbarStyleTokens {
    return deriveScrollbarStyle(theme)
  }

  private _scrollbarWidth(theme: ResolvedTheme = this.currentTheme): number {
    return this._scrollbarTokens(theme).gutterSize
  }

  override detach(): void {
    this._clearPaintedVisibleNodes()
    super.detach()
  }

  override dispose(): void {
    if (this._focusRegistered && typeof window !== 'undefined') {
      FocusManager.instance.unregister(this)
      this._focusRegistered = false
    }
    this._vScrollbarController.reset()
    this._hoveredKey = ''
    this._focused = false
    this._focusedIndex = -1
    this.onActivate = undefined
    this.onCheck = undefined
    this.onContextMenuRequest = undefined
    this._clearPaintedVisibleNodes()
    super.dispose()
  }

  protected override onVisibilityChanged(_visible: boolean): void {
    this._clearPaintedVisibleNodes()
    if (!this.visible) this._clearInteractionState()
    this._syncFocusRegistration()
  }

  private _clearInteractionState(): void {
    if (typeof window !== 'undefined' && FocusManager.instance.current === this) {
      FocusManager.instance.clearFocusOf(this)
    } else if (this._focused) {
      this.focusOut()
    }
    this._hoveredKey = ''
    this._focusedIndex = -1
    this._suppressNextFocusReveal = false
    this._vScrollbarController.reset()
    this.tooltip = undefined
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
}

function intersectTreeRect(first: Rect, second: Rect): Rect | null {
  const left = Math.max(first.x, second.x)
  const top = Math.max(first.y, second.y)
  const right = Math.min(first.x + first.width, second.x + second.width)
  const bottom = Math.min(first.y + first.height, second.y + second.height)
  if (right <= left || bottom <= top) return null
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function pointInRect(point: Offset, rect: { x: number; y: number; w: number; h: number }): boolean {
  return point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
}
