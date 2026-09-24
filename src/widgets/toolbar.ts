import { TextMeasurer } from '../core/text_measurer'
import type { BoxConstraints, LayoutContext, Offset, Rect } from '../core/render_object'
import { RenderObject, constrainSize } from '../core/render_object'
import { PopupManager, popupViewportRect, type Popup, type PopupContext } from '../core/popup_manager'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { RenderBox } from '../layout/render_box'
import type { PointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import {
  deriveToolbarStyle,
  resolveBgColor,
  resolveTextColor,
  type InteractionStateInput,
  type ToolbarStyleTokens,
} from '../theme/component_styles'
import { paintIconGlyph, type IconName } from './icon'
import { TooltipService } from './tooltip'
import { FocusableControl, paintFocusRing, type ControlInteractionSnapshot } from './focusable_control'
import type { ContextMenuEntry } from './context_menu'
import { MenuPopup } from './menu_popup'

export type ToolbarSlot = 'leading' | 'trailing'

interface ToolbarItemBase {
  id: string
  visible?: boolean
  disabled?: boolean
  tooltip?: string
  showLabel?: boolean
}

export interface ToolbarButtonItem extends ToolbarItemBase {
  kind: 'button'
  label: string
  icon?: IconName
  onClick?: () => void
}

export interface ToolbarToggleItem extends ToolbarItemBase {
  kind: 'toggle'
  label: string
  icon?: IconName
  checked: boolean
  onChange?: (checked: boolean) => void
}

export interface ToolbarDropDownItem extends ToolbarItemBase {
  kind: 'dropdown'
  label: string
  icon?: IconName
  items: ContextMenuEntry[]
  onSelect?: (key: string) => void
}

export interface ToolbarSeparatorItem extends ToolbarItemBase {
  kind: 'separator'
}

export type ToolbarItem =
  | ToolbarButtonItem
  | ToolbarToggleItem
  | ToolbarDropDownItem
  | ToolbarSeparatorItem

export interface ToolbarGroup {
  id: string
  slot: ToolbarSlot
  visible?: boolean
  items: ToolbarItem[]
}

interface ToolbarMeasuredItem {
  item: ToolbarItem
  width: number
}

interface ToolbarMeasuredGroup {
  group: ToolbarGroup
  items: ToolbarMeasuredItem[]
  width: number
}

interface ToolbarOverflowEntry {
  groupId: string
  item: ToolbarItem
}

interface ToolbarItemLayout {
  id: string
  rect: Rect
  item: ToolbarItem | null
  groupId: string
  disabled: boolean
  interactive: boolean
  tooltip: string
  overflowButton?: boolean
}

interface ToolbarResolvedLayout {
  visibleLeading: ToolbarMeasuredGroup[]
  visibleTrailing: ToolbarMeasuredGroup[]
  overflowEntries: ToolbarOverflowEntry[]
  itemLayouts: ToolbarItemLayout[]
  leftWidth: number
  rightWidth: number
  contentHeight: number
}

const OVERFLOW_ITEM_ID = '__toolbar_overflow__'

function isSeparator(item: ToolbarItem): item is ToolbarSeparatorItem {
  return item.kind === 'separator'
}

function isDropdown(item: ToolbarItem): item is ToolbarDropDownItem {
  return item.kind === 'dropdown'
}

function isToggle(item: ToolbarItem): item is ToolbarToggleItem {
  return item.kind === 'toggle'
}

function isActionItem(item: ToolbarItem): item is ToolbarButtonItem | ToolbarToggleItem | ToolbarDropDownItem {
  return item.kind !== 'separator'
}

function collectContextMenuKeys(
  items: ContextMenuEntry[],
  owner: ToolbarDropDownItem,
  map: Map<string, ToolbarDropDownItem>,
): void {
  for (const entry of items) {
    if ('separator' in entry && entry.separator === true) continue
    map.set(entry.key, owner)
    if (entry.items) collectContextMenuKeys(entry.items, owner, map)
  }
}

export class RenderToolbar extends FocusableControl implements InteractiveRenderObject {
  static override debugTypeName = 'RenderToolbar'
  private _groups: ToolbarGroup[] = []
  private _disabled = false
  private _resolvedLayout: ToolbarResolvedLayout = {
    visibleLeading: [],
    visibleTrailing: [],
    overflowEntries: [],
    itemLayouts: [],
    leftWidth: 0,
    rightWidth: 0,
    contentHeight: 0,
  }
  private _hoveredItemId = ''
  private _pressedItemId = ''
  private _keyboardItemId = ''
  private _openItemId = ''
  private _popupProxy: Popup | null = null
  private _rootPopup: MenuPopup | null = null

  constructor(options?: { groups?: ToolbarGroup[]; disabled?: boolean }) {
    super({ disabled: options?.disabled ?? false })
    this._disabled = options?.disabled ?? false
    if (options?.groups) this._groups = [...options.groups]
  }

  get disabled(): boolean { return this._disabled }
  set disabled(value: boolean) {
    if (this._disabled === value) return
    this._disabled = value
    this.setDisabledState(value)
  }

  get groups(): readonly ToolbarGroup[] {
    return this._groups
  }

  addGroup(group: ToolbarGroup): void {
    this._groups.push(group)
    this.markNeedsLayout()
  }

  removeGroup(id: string): void {
    const next = this._groups.filter(group => group.id !== id)
    if (next.length === this._groups.length) return
    this._groups = next
    this._syncInteractiveStateAfterGroupChange()
    this.markNeedsLayout()
  }

  setGroups(groups: ToolbarGroup[]): void {
    this._groups = [...groups]
    this._syncInteractiveStateAfterGroupChange()
    this.markNeedsLayout()
  }

  clearGroups(): void {
    if (this._groups.length === 0) return
    this._groups = []
    this._syncInteractiveStateAfterGroupChange()
    this.markNeedsLayout()
  }

  itemRect(id: string): Rect | null {
    const item = this._resolvedLayout.itemLayouts.find(candidate => candidate.id === id)
    return item ? { ...item.rect } : null
  }

  debugState(): {
    visibleLeadingGroupIds: string[]
    visibleTrailingGroupIds: string[]
    overflowGroupIds: string[]
    visibleItemIds: string[]
    openItemId: string
  } {
    return {
      visibleLeadingGroupIds: this._resolvedLayout.visibleLeading.map(group => group.group.id),
      visibleTrailingGroupIds: this._resolvedLayout.visibleTrailing.map(group => group.group.id),
      overflowGroupIds: Array.from(new Set(this._resolvedLayout.overflowEntries.map(entry => entry.groupId))),
      visibleItemIds: this._resolvedLayout.itemLayouts.map(item => item.id),
      openItemId: this._openItemId,
    }
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = deriveToolbarStyle(context.theme)
    const measuredLeading = this._measureGroups('leading', context, style)
    const measuredTrailing = this._measureGroups('trailing', context, style)
    const naturalContentWidth = this._slotWidth(measuredLeading, style) +
      this._slotWidth(measuredTrailing, style) +
      (measuredLeading.length > 0 && measuredTrailing.length > 0 ? style.sectionGap : 0)
    const naturalWidth = naturalContentWidth + style.padding * 2
    const widthTarget = constraints.maxWidth === Infinity
      ? naturalWidth
      : Math.min(constraints.maxWidth, naturalWidth)
    const availableContentWidth = Math.max(0, widthTarget - style.padding * 2)

    this._resolvedLayout = this._resolveLayout(measuredLeading, measuredTrailing, availableContentWidth, style)
    const desiredWidth = this._resolvedLayout.leftWidth +
      this._resolvedLayout.rightWidth +
      (this._resolvedLayout.leftWidth > 0 && this._resolvedLayout.rightWidth > 0 ? style.sectionGap : 0) +
      style.padding * 2
    const desiredHeight = Math.max(style.minHeight, this._resolvedLayout.contentHeight + style.padding * 2)
    this.size = constrainSize(constraints, { width: desiredWidth, height: desiredHeight })
    this._positionItems(style)
    this._syncKeyboardItem()
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const style = deriveToolbarStyle(context.theme)
    const dl = new DrawList(context)
    dl.fillRect(offset.x, offset.y, this.size.width, this.size.height, style.backgroundColor, style.borderRadius)
    if (style.borderWidth > 0) {
      dl.strokeRect(offset.x, offset.y, this.size.width, this.size.height, style.borderColor, style.borderWidth, style.borderRadius)
    }

    for (const layout of this._resolvedLayout.itemLayouts) {
      const x = offset.x + layout.rect.x
      const y = offset.y + layout.rect.y
      const item = layout.item
      if (layout.overflowButton) {
        const state = this._itemState(layout)
        this._paintActionShell(dl, style, layout, x, y, state)
        this._paintItemContent(
          context,
          style,
          x,
          y,
          layout.rect,
          style.overflowLabel,
          'chevron-down',
          undefined,
          resolveTextColor(style.itemText, state),
        )
        if (this.isFocused && layout.id === this._keyboardItemId) {
          paintFocusRing(dl, style.focusedBorder, x, y, layout.rect.width, layout.rect.height, style.itemRadius)
        }
        continue
      }
      if (!item) continue
      if (isSeparator(item)) {
        const lineX = x + layout.rect.width / 2
        const inset = style.separatorInset
        dl.line(lineX, y + inset, lineX, y + layout.rect.height - inset, style.separatorColor, 1)
        continue
      }
      const state = this._itemState(layout)
      this._paintActionShell(dl, style, layout, x, y, state)
      const icon = item.icon
      const label = item.label
      const arrow = isDropdown(item) ? 'chevron-down' as IconName : undefined
      this._paintItemContent(context, style, x, y, layout.rect, label, icon, arrow, resolveTextColor(style.itemText, state), item.showLabel !== false || !icon)
      if (this.isFocused && layout.id === this._keyboardItemId) {
        paintFocusRing(dl, style.focusedBorder, x, y, layout.rect.width, layout.rect.height, style.itemRadius)
      }
    }
  }

  onPointerDown(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (this.isDisabled) return
    this.requestFocus()
    const hit = this._itemAt(event.position)
    if (!hit || !hit.interactive) {
      this._setHoveredItem('')
      this._pressedItemId = ''
      return
    }
    this._keyboardItemId = hit.id
    this._setHoveredItem(hit.id, event.position)
    if (this._openItemId && hit.id === this._openItemId) {
      this._dismissMenu()
      this._pressedItemId = ''
      this.markNeedsPaint()
      return
    }
    this._pressedItemId = hit.id
    this.markNeedsPaint()
  }

  onPointerUp(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (this.isDisabled) {
      this._pressedItemId = ''
      return
    }
    const hit = this._itemAt(event.position)
    const shouldActivate = !!hit && hit.id === this._pressedItemId && hit.interactive
    const pressedItemId = this._pressedItemId
    this._pressedItemId = ''
    if (!shouldActivate) {
      this.markNeedsPaint()
      return
    }
    const target = this._resolvedLayout.itemLayouts.find(item => item.id === pressedItemId)
    if (target) this._activateItem(target)
    this.markNeedsPaint()
  }

  onPointerMove(event: PointerEvent): void {
    if (this.isDisabled) return
    const hit = this._itemAt(event.position)
    if (!hit || !hit.interactive) {
      this._setHoveredItem('', event.position)
      return
    }
    this._setHoveredItem(hit.id, event.position)
    if (this._openItemId && hit.id !== this._openItemId && (hit.overflowButton || isDropdown(hit.item!))) {
      this._openMenuForLayout(hit)
    }
  }

  onPointerCancel(_event: PointerEvent): void {
    this._pressedItemId = ''
    this._setHoveredItem('')
    this.markNeedsPaint()
  }

  onPointerLeave(_event: PointerEvent): void {
    this._pressedItemId = ''
    this._setHoveredItem('')
    this.markNeedsPaint()
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.isDisabled) return false
    const items = this._keyboardOrder()
    if (items.length === 0) return false
    const currentIndex = Math.max(0, items.findIndex(item => item.id === this._keyboardItemId))
    const moveTo = (index: number): boolean => {
      this._keyboardItemId = items[index]!.id
      this.markNeedsPaint()
      return true
    }

    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault()
        return moveTo((currentIndex - 1 + items.length) % items.length)
      case 'ArrowRight':
        event.preventDefault()
        return moveTo((currentIndex + 1) % items.length)
      case 'Home':
        event.preventDefault()
        return moveTo(0)
      case 'End':
        event.preventDefault()
        return moveTo(items.length - 1)
      case 'Enter':
      case ' ':
      case 'ArrowDown': {
        const target = items[currentIndex]!
        event.preventDefault()
        this._activateItem(target)
        return true
      }
      case 'Escape':
        if (!this._openItemId) return false
        event.preventDefault()
        this._dismissMenu()
        return true
      default:
        return false
    }
  }

  override dispose(): void {
    if (this._hoveredItemId) TooltipService.currentOrNull?.hide()
    this._dismissMenu()
    super.dispose()
  }

  protected override onFocusChanged(focused: boolean): void {
    if (focused) {
      this._syncKeyboardItem()
      return
    }
    this._pressedItemId = ''
    this._setHoveredItem('')
  }

  protected override onDisabledStateChanged(disabled: boolean, _previous: ControlInteractionSnapshot): void {
    if (!disabled) return
    this._dismissMenu()
    this._pressedItemId = ''
    this._keyboardItemId = ''
    this._setHoveredItem('')
  }

  private _measureGroups(slot: ToolbarSlot, context: LayoutContext, style: ToolbarStyleTokens): ToolbarMeasuredGroup[] {
    return this._groups
      .filter(group => group.slot === slot && group.visible !== false)
      .map(group => {
        const items = group.items
          .filter(item => item.visible !== false)
          .map(item => ({ item, width: this._measureItem(item, context, style) }))
        const visibleItems = items.filter(entry => entry.width > 0)
        const width = visibleItems.reduce((total, entry, index) => total + entry.width + (index > 0 ? style.itemSpacing : 0), 0)
        return { group, items: visibleItems, width }
      })
      .filter(group => group.items.length > 0)
  }

  private _measureItem(item: ToolbarItem, context: LayoutContext, style: ToolbarStyleTokens): number {
    if (isSeparator(item)) return style.separatorWidth
    const showLabel = item.showLabel !== false || !item.icon
    const labelWidth = showLabel ? TextMeasurer.measureWidth(item.label, style.fontSize, style.fontFamily) : 0
    if (!showLabel && item.icon && !isDropdown(item)) return style.itemIconOnlyWidth
    let width = style.itemPaddingX * 2 + labelWidth
    if (item.icon) width += style.iconSize + (showLabel ? style.iconGap : 0)
    if (isDropdown(item)) width += style.dropdownGap + style.iconSize
    return Math.max(style.itemMinWidth, Math.ceil(width))
  }

  private _overflowButtonWidth(style: ToolbarStyleTokens): number {
    const labelWidth = TextMeasurer.measureWidth(style.overflowLabel, style.fontSize, style.fontFamily)
    return Math.max(style.itemMinWidth, Math.ceil(style.itemPaddingX * 2 + labelWidth + style.dropdownGap + style.iconSize))
  }

  private _slotWidth(groups: readonly ToolbarMeasuredGroup[], style: ToolbarStyleTokens): number {
    if (groups.length === 0) return 0
    return groups.reduce((total, group, index) => total + group.width + (index > 0 ? style.sectionGap : 0), 0)
  }

  private _fitsLayout(
    leading: readonly ToolbarMeasuredGroup[],
    trailing: readonly ToolbarMeasuredGroup[],
    includeOverflowButton: boolean,
    availableWidth: number,
    style: ToolbarStyleTokens,
  ): boolean {
    const leftWidth = this._slotWidth(leading, style)
    const rightGroupWidth = this._slotWidth(trailing, style)
    const rightWidth = rightGroupWidth + (includeOverflowButton ? this._overflowButtonWidth(style) + (rightGroupWidth > 0 ? style.sectionGap : 0) : 0)
    const clusterGap = leftWidth > 0 && rightWidth > 0 ? style.sectionGap : 0
    return leftWidth + rightWidth + clusterGap <= availableWidth
  }

  private _resolveLayout(
    leading: ToolbarMeasuredGroup[],
    trailing: ToolbarMeasuredGroup[],
    availableWidth: number,
    style: ToolbarStyleTokens,
  ): ToolbarResolvedLayout {
    const visibleLeading = [...leading]
    const visibleTrailing = [...trailing]
    const overflowEntries: ToolbarOverflowEntry[] = []
    const moveGroupToOverflow = (group: ToolbarMeasuredGroup): void => {
      for (const entry of group.items) overflowEntries.push({ groupId: group.group.id, item: entry.item })
    }

    if (!this._fitsLayout(visibleLeading, visibleTrailing, false, availableWidth, style)) {
      while (visibleLeading.length > 0 && !this._fitsLayout(visibleLeading, visibleTrailing, true, availableWidth, style)) {
        const removed = visibleLeading.pop()
        if (!removed) break
        moveGroupToOverflow(removed)
      }
      while (!this._fitsLayout(visibleLeading, visibleTrailing, true, availableWidth, style) && visibleTrailing.length > 0) {
        const removed = visibleTrailing.shift()
        if (!removed) break
        moveGroupToOverflow(removed)
      }
    }

    const hasOverflow = overflowEntries.length > 0
    const leftWidth = this._slotWidth(visibleLeading, style)
    const trailingWidth = this._slotWidth(visibleTrailing, style)
    const rightWidth = trailingWidth + (hasOverflow ? this._overflowButtonWidth(style) + (trailingWidth > 0 ? style.sectionGap : 0) : 0)
    const itemLayouts: ToolbarItemLayout[] = []
    const contentHeight = style.itemHeight

    return {
      visibleLeading,
      visibleTrailing,
      overflowEntries,
      itemLayouts,
      leftWidth,
      rightWidth,
      contentHeight,
    }
  }

  private _positionItems(style: ToolbarStyleTokens): void {
    this._resolvedLayout.itemLayouts = []
    const itemHeight = style.itemHeight
    const itemY = style.padding + (this.size.height - style.padding * 2 - itemHeight) / 2
    const contentLeft = style.padding
    const contentRight = Math.max(contentLeft, this.size.width - style.padding)
    const clampRect = (x: number, width: number): Rect => {
      const clampedX = Math.max(contentLeft, Math.min(x, contentRight))
      return {
        x: clampedX,
        y: itemY,
        width: Math.max(0, Math.min(width, contentRight - clampedX)),
        height: itemHeight,
      }
    }
    let leadingX = style.padding

    const appendGroup = (group: ToolbarMeasuredGroup, startX: number): number => {
      let cursorX = startX
      for (let i = 0; i < group.items.length; i++) {
        const entry = group.items[i]!
        this._resolvedLayout.itemLayouts.push(this._layoutEntry(group.group.id, entry.item, clampRect(cursorX, entry.width)))
        cursorX += entry.width
        if (i < group.items.length - 1) cursorX += style.itemSpacing
      }
      return cursorX
    }

    for (let i = 0; i < this._resolvedLayout.visibleLeading.length; i++) {
      const group = this._resolvedLayout.visibleLeading[i]!
      leadingX = appendGroup(group, leadingX)
      if (i < this._resolvedLayout.visibleLeading.length - 1) leadingX += style.sectionGap
    }

    let rightX = this.size.width - style.padding - this._resolvedLayout.rightWidth
    for (let i = 0; i < this._resolvedLayout.visibleTrailing.length; i++) {
      const group = this._resolvedLayout.visibleTrailing[i]!
      rightX = appendGroup(group, rightX)
      if (i < this._resolvedLayout.visibleTrailing.length - 1) rightX += style.sectionGap
    }

    if (this._resolvedLayout.overflowEntries.length > 0) {
      if (this._resolvedLayout.visibleTrailing.length > 0) rightX += style.sectionGap
      this._resolvedLayout.itemLayouts.push({
        id: OVERFLOW_ITEM_ID,
        rect: clampRect(rightX, this._overflowButtonWidth(style)),
        item: null,
        groupId: OVERFLOW_ITEM_ID,
        disabled: false,
        interactive: true,
        tooltip: '更多命令',
        overflowButton: true,
      })
    }
  }

  private _layoutEntry(groupId: string, item: ToolbarItem, rect: Rect): ToolbarItemLayout {
    return {
      id: item.id,
      rect,
      item,
      groupId,
      disabled: !!item.disabled,
      interactive: !isSeparator(item) && !item.disabled,
      tooltip: item.tooltip ?? (isActionItem(item) && item.showLabel === false ? item.label : ''),
    }
  }

  private _itemRectGlobal(rect: Rect): Rect {
    const global = this.globalOffset
    return { x: global.x + rect.x, y: global.y + rect.y, width: rect.width, height: rect.height }
  }

  private _itemAt(point: Offset): ToolbarItemLayout | null {
    return this._resolvedLayout.itemLayouts.find(item => {
      const rect = this._itemRectGlobal(item.rect)
      return point.x >= rect.x &&
        point.x <= rect.x + rect.width &&
        point.y >= rect.y &&
        point.y <= rect.y + rect.height
    }) ?? null
  }

  private _keyboardOrder(): ToolbarItemLayout[] {
    if (this.isDisabled) return []
    return this._resolvedLayout.itemLayouts.filter(item => item.interactive)
  }

  private _syncKeyboardItem(): void {
    const items = this._keyboardOrder()
    if (items.length === 0) {
      this._keyboardItemId = ''
      return
    }
    if (items.some(item => item.id === this._keyboardItemId)) return
    this._keyboardItemId = items[0]!.id
  }

  private _setHoveredItem(id: string, position?: Offset): void {
    const item = id ? this._resolvedLayout.itemLayouts.find(candidate => candidate.id === id) : undefined
    const tooltip = item?.tooltip || undefined
    if (id === this._hoveredItemId) {
      this.tooltip = tooltip
      this.tooltipDelay = tooltip ? 250 : undefined
      if (id && position) TooltipService.currentOrNull?.updatePos(position)
      return
    }
    if (this._hoveredItemId) TooltipService.currentOrNull?.hide()
    this._hoveredItemId = id
    this.tooltip = tooltip
    this.tooltipDelay = tooltip ? 250 : undefined
    if (id && position) {
      if (item?.tooltip) TooltipService.currentOrNull?.show(item.tooltip, position)
    }
    this.markNeedsPaint()
  }

  private _itemState(layout: ToolbarItemLayout): InteractionStateInput {
    return {
      disabled: this.isDisabled || layout.disabled,
      pressed: this._pressedItemId === layout.id,
      selected: layout.id === this._openItemId ||
        Boolean(layout.item && isToggle(layout.item) && layout.item.checked),
      hovered: this._hoveredItemId === layout.id,
    }
  }

  private _paintActionShell(
    dl: DrawList,
    style: ToolbarStyleTokens,
    layout: ToolbarItemLayout,
    x: number,
    y: number,
    state: InteractionStateInput,
  ): void {
    const bg = resolveBgColor(style.itemBg, state)
    const disabled = typeof state === 'string' ? state === 'disabled' : state.disabled === true
    const pressed = !disabled && (typeof state === 'string' ? state === 'pressed' : state.pressed === true)
    const selected = !disabled && (typeof state === 'string' ? state === 'selected' : state.selected === true)
    const hovered = !disabled && (typeof state === 'string' ? state === 'hovered' : state.hovered === true)
    if (bg.a > 0) {
      const highlightMix = pressed ? 0.04 : selected ? 0.1 : 0.14
      const bgTop = {
        r: Math.round(bg.r + (255 - bg.r) * highlightMix),
        g: Math.round(bg.g + (255 - bg.g) * highlightMix),
        b: Math.round(bg.b + (255 - bg.b) * highlightMix),
        a: bg.a,
      }
      dl.fillRectGradient(x, y, layout.rect.width, layout.rect.height, bgTop, bg, style.itemRadius)
    }
    if (pressed) {
      dl.strokeRect(x, y, layout.rect.width, layout.rect.height, style.pressedBorder, 1, style.itemRadius)
    } else if (selected) {
      dl.strokeRect(x, y, layout.rect.width, layout.rect.height, style.selectedBorder, 1, style.itemRadius)
    } else if (hovered) {
      dl.strokeRect(x, y, layout.rect.width, layout.rect.height, style.hoveredBorder, 1, style.itemRadius)
    }
  }

  private _paintItemContent(
    context: PaintContext,
    style: ToolbarStyleTokens,
    x: number,
    y: number,
    rect: Rect,
    label: string,
    icon?: IconName,
    arrow?: IconName,
    textColor = style.itemText.text,
    showLabel = true,
  ): void {
    if (rect.width <= 0 || rect.height <= 0) return
    const dl = new DrawList(context)
    dl.pushClip(x, y, rect.width, rect.height)
    const labelWidth = showLabel ? TextMeasurer.measureWidth(label, style.fontSize, style.fontFamily) : 0
    const iconWidth = icon ? style.iconSize + (showLabel ? style.iconGap : 0) : 0
    const arrowWidth = arrow ? style.dropdownGap + style.iconSize : 0
    const contentWidth = labelWidth + iconWidth + arrowWidth
    let cursorX = x + Math.max(style.itemPaddingX, Math.round((rect.width - contentWidth) / 2))

    if (icon) {
      paintIconGlyph(context, {
        name: icon,
        x: cursorX,
        y: y + (rect.height - style.iconSize) / 2,
        size: style.iconSize,
        color: textColor,
      })
      cursorX += style.iconSize + (showLabel ? style.iconGap : 0)
    }

    if (showLabel) {
      dl.fillText(
        label,
        cursorX,
        y + rect.height / 2,
        textColor,
        style.fontSize,
        style.fontFamily,
        'left',
        'middle',
      )
      cursorX += labelWidth
    }

    if (arrow) {
      cursorX += style.dropdownGap
      paintIconGlyph(context, {
        name: arrow,
        x: cursorX,
        y: y + (rect.height - style.iconSize) / 2,
        size: style.iconSize,
        color: textColor,
      })
    }
    dl.popClip()
  }

  private _activateItem(layout: ToolbarItemLayout): void {
    if (!layout.interactive) return
    if (layout.overflowButton || (layout.item && isDropdown(layout.item))) {
      this._openMenuForLayout(layout)
      return
    }
    const item = layout.item
    if (!item || !isActionItem(item)) return
    this._dismissMenu()
    if (isToggle(item)) {
      item.onChange?.(!item.checked)
      return
    }
    item.onClick?.()
  }

  private _openMenuForLayout(layout: ToolbarItemLayout): void {
    const menu = this._menuSpecForLayout(layout)
    if (!menu) return
    this._dismissMenu()

    const proxy: Popup = {
      hitTest: point => this._toolbarHitTest(point),
      close: () => {
        if (this._popupProxy === proxy) {
          this._popupProxy = null
          this._rootPopup = null
          this._openItemId = ''
          this.markNeedsPaint()
        }
      },
      onPointerDown: event => {
        const hit = this._itemAt(event.position)
        if (!hit || !hit.interactive) {
          this._dismissMenu()
          return
        }
        this._keyboardItemId = hit.id
        if (hit.id === this._openItemId) {
          this._dismissMenu()
          return
        }
        if (hit.overflowButton || (hit.item && isDropdown(hit.item))) {
          this._openMenuForLayout(hit)
        } else {
          this._dismissMenu()
          this._activateItem(hit)
        }
      },
      onPointerMove: event => {
        const hit = this._itemAt(event.position)
        this._setHoveredItem(hit?.interactive ? hit.id : '', event.position)
        if (hit && hit.id !== this._openItemId && (hit.overflowButton || (hit.item && isDropdown(hit.item)))) {
          this._openMenuForLayout(hit)
        }
      },
    }

    PopupManager.instance.open(proxy, { owner: this })
    this._popupProxy = proxy
    this._openItemId = layout.id

    const rootPopup = new MenuPopup({
      items: menu.items,
      owner: this,
      parent: proxy,
      position: (_popupContext, metrics) => {
        const rect = this._itemRectGlobal(layout.rect)
        const startX = rect.x
        const endAlignedX = rect.x + rect.width - metrics.menuWidth
        const maxX = metrics.bounds.x + metrics.bounds.width - metrics.menuWidth - 4
        const x = startX <= maxX ? startX : endAlignedX
        return { x, y: rect.y + rect.height }
      },
      bounds: popupContext => this._popupBounds(popupContext),
      onSelect: key => {
        try {
          menu.onSelect(key)
        } finally {
          this._dismissMenu()
        }
      },
      onClose: () => {
        if (this._rootPopup === rootPopup) this._rootPopup = null
      },
    })

    this._rootPopup = rootPopup
    rootPopup.open()
    this.markNeedsPaint()
  }

  private _menuSpecForLayout(layout: ToolbarItemLayout): { items: ContextMenuEntry[]; onSelect: (key: string) => void } | null {
    if (layout.overflowButton) {
      const overflowEntries = this._resolvedLayout.overflowEntries
      const keyMap = new Map<string, ToolbarOverflowEntry>()
      const dropdownKeyMap = new Map<string, ToolbarDropDownItem>()
      const items: ContextMenuEntry[] = []
      let currentGroupId = ''
      for (const entry of overflowEntries) {
        if (entry.groupId !== currentGroupId) {
          if (items.length > 0) items.push({ separator: true })
          items.push({
            key: `group:${entry.groupId}`,
            label: entry.groupId,
            disabled: true,
          })
          currentGroupId = entry.groupId
        }
        if (isSeparator(entry.item)) {
          items.push({ separator: true })
          continue
        }
        const menuKey = `item:${entry.item.id}`
        keyMap.set(menuKey, entry)
        if (isDropdown(entry.item)) {
          collectContextMenuKeys(entry.item.items, entry.item, dropdownKeyMap)
          items.push({
            key: menuKey,
            label: entry.item.label,
            icon: entry.item.icon,
            disabled: !!entry.item.disabled,
            items: entry.item.items,
          })
          continue
        }
        items.push({
          key: menuKey,
          label: entry.item.label,
          icon: isToggle(entry.item) && entry.item.checked ? 'check' : entry.item.icon,
          disabled: !!entry.item.disabled,
        })
      }
      return {
        items,
        onSelect: key => {
          const dropdown = dropdownKeyMap.get(key)
          if (dropdown) {
            dropdown.onSelect?.(key)
            return
          }
          const entry = keyMap.get(key)
          if (!entry || !isActionItem(entry.item)) return
          if (isDropdown(entry.item)) return
          if (isToggle(entry.item)) {
            entry.item.onChange?.(!entry.item.checked)
            return
          }
          entry.item.onClick?.()
        },
      }
    }

    const item = layout.item
    if (!item || !isDropdown(item)) return null
    return {
      items: item.items,
      onSelect: key => item.onSelect?.(key),
    }
  }

  private _dismissMenu(): void {
    const proxy = this._popupProxy
    const root = this._rootPopup
    if (proxy) {
      PopupManager.instance.dismiss(proxy)
      proxy.close()
    } else if (root) {
      root.dismiss()
    }
    this._popupProxy = null
    this._rootPopup = null
    this._openItemId = ''
    this.markNeedsPaint()
  }

  private _toolbarHitTest(point: Offset): boolean {
    const global = this.globalOffset
    return point.x >= global.x &&
      point.x <= global.x + this.size.width &&
      point.y >= global.y &&
      point.y <= global.y + this.size.height
  }

  private _popupBounds(popupContext: PopupContext): Rect {
    return popupViewportRect(popupContext)
  }

  private _syncInteractiveStateAfterGroupChange(): void {
    const visibleIds = new Set(
      this._groups.flatMap(group => group.items.filter(item => item.visible !== false).map(item => item.id)),
    )
    if (!visibleIds.has(this._hoveredItemId)) {
      if (this._hoveredItemId) TooltipService.currentOrNull?.hide()
      this._hoveredItemId = ''
      this.tooltip = undefined
      this.tooltipDelay = undefined
    }
    if (!visibleIds.has(this._pressedItemId)) this._pressedItemId = ''
    if (!visibleIds.has(this._keyboardItemId)) this._keyboardItemId = ''
    if (!visibleIds.has(this._openItemId)) this._dismissMenu()
  }
}
