import { AnimationController } from '../animation/animation_controller'
import { Curves } from '../animation/curves'
import type { BoxConstraints, LayoutContext, Offset, Rect, RenderObject } from '../core/render_object'
import { PopupManager, popupViewportRect, type PopupContext } from '../core/popup_manager'
import { PopupSurfaceShell } from '../core/popup_shell'
import { TextMeasurer } from '../core/text_measurer'
import type { PointerEvent } from '../gestures/hit_test'
import { RenderBox, RenderPanel, resolveChildLayout } from '../layout/render_box'
import { RenderStackPanel } from '../layout/render_flex'
import { deriveBorderStyle, deriveItemContainerStyle, derivePopupStyle, deriveScrollbarStyle, deriveTextStyle, type BadgeStatus } from '../theme/component_styles'
import { lerpColor, resolveThemeElevation } from '../theme/theme'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { drawPopupPanel } from '../rendering/popup_painter'
import { measureBadgeLayout, RenderBadge } from './badge'
import { RenderText } from './basic'
import { RenderBorder } from './border'
import { RenderIcon, type IconName } from './icon'
import { RenderIconButton } from './icon_button'
import { RenderItemsControl } from './items_control'
import { RenderSearchBox } from './search_box'

export type NavigationMenuItemStatus = 'none' | 'opened' | 'success' | 'warning' | 'danger'

export interface NavigationMenuItem {
  key: string
  title: string
  icon?: IconName
  status?: NavigationMenuItemStatus
  opened?: boolean
  loading?: boolean
  disabled?: boolean
  badge?: string | number
  tooltip?: string
}

export interface NavigationMenuGroup {
  key: string
  title: string
  icon?: IconName
  children: NavigationMenuItem[]
  collapsible?: boolean
  collapsed?: boolean
}

export type NavigationMenuEntry =
  | { kind: 'group'; group: NavigationMenuGroup }
  | { kind: 'item'; groupKey: string; item: NavigationMenuItem }

const navigationTrailingSlotWidth = 13
const navigationItemIconWidth = 15
const navigationItemIconGap = 8
const navigationPopupPanelPaddingX = 8
const navigationPopupMinWidth = 144
const navigationPopupMaxWidth = 320

function navigationTrailingOffset(width: number, childWidth: number): number {
  return Math.max(0, width - navigationTrailingSlotWidth + (navigationTrailingSlotWidth - childWidth) / 2)
}

function navigationItemTrailingNaturalWidth(item: NavigationMenuItem, context: LayoutContext): number {
  const status = itemToneStatus(item)
  const opened = itemOpened(item)
  if (item.loading) return navigationTrailingSlotWidth
  if (item.badge !== undefined) {
    return measureBadgeLayout(context.theme, item.badge, {
      status: statusBadgeStatus(status),
      appearance: 'filled',
      compact: true,
    }).width
  }
  if (status !== 'none' && status !== 'opened') return navigationTrailingSlotWidth
  if (opened) return navigationTrailingSlotWidth
  return 0
}

function navigationItemRowNaturalWidth(item: NavigationMenuItem, context: LayoutContext): number {
  const textStyle = deriveTextStyle(context.theme)
  const textWidth = TextMeasurer.measureWidth(item.title, textStyle.fontSize, textStyle.fontFamily)
  const leadingWidth = item.icon ? navigationItemIconWidth + navigationItemIconGap : 0
  const trailingWidth = navigationItemTrailingNaturalWidth(item, context)
  const trailingGap = trailingWidth > 0
    ? navigationItemIconGap + Math.max(trailingWidth, navigationTrailingSlotWidth)
    : 0
  return leadingWidth + textWidth + trailingGap
}

class RenderNavigationOpenedDot extends RenderBox {
  static override debugTypeName = 'RenderNavigationOpenedDot'
  performLayout(constraints: BoxConstraints, _context: LayoutContext): void {
    const size = Math.max(5, Math.min(constraints.maxWidth, constraints.maxHeight, 6))
    this.size = {
      width: Math.max(constraints.minWidth, size),
      height: Math.max(constraints.minHeight, size),
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    dl.fillRect(
      offset.x,
      offset.y,
      this.size.width,
      this.size.height,
      { ...context.theme.accentPrimary, a: Math.min(0.34, context.theme.accentPrimary.a * 0.42) },
      this.size.width / 2,
    )
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}
}

class RenderCollapsedNavigationItem extends RenderBox {
  static override debugTypeName = 'RenderCollapsedNavigationItem'
  private readonly _icon?: RenderIcon
  private readonly _badge?: RenderBadge
  private readonly _openedDot?: RenderNavigationOpenedDot

  constructor(options: {
    icon?: IconName
    status?: NavigationMenuItemStatus
  }) {
    super()
    this._icon = options.icon ? new RenderIcon({ name: options.icon, size: 15 }) : undefined
    const status = options.status ?? 'none'
    this._openedDot = status === 'opened' ? new RenderNavigationOpenedDot() : undefined
    this._badge = status !== 'none' && status !== 'opened'
      ? new RenderBadge({
        dot: true,
        status: statusBadgeStatus(status),
        appearance: 'filled',
        compact: true,
      })
      : undefined
    if (this._icon) this._icon.parent = this
    if (this._badge) this._badge.parent = this
    if (this._openedDot) this._openedDot.parent = this
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      if (this._icon) visitor(this._icon)
      if (this._badge) visitor(this._badge)
      if (this._openedDot) visitor(this._openedDot)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    if (this._icon) visitor(this._icon)
    if (this._badge) visitor(this._badge)
    if (this._openedDot) visitor(this._openedDot)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const width = constraints.maxWidth === Infinity ? Math.max(constraints.minWidth, 24) : constraints.maxWidth
    const height = constraints.maxHeight === Infinity ? Math.max(constraints.minHeight, 18) : constraints.maxHeight
    this.size = { width, height }

    if (this._icon) {
      this._icon.layout({ minWidth: 0, maxWidth: 15, minHeight: 0, maxHeight: 15 }, true, context)
      this._icon.offset = {
        x: (width - this._icon.size.width) / 2,
        y: (height - this._icon.size.height) / 2,
      }
    }

    if (this._badge) {
      this._badge.layout({ minWidth: 0, maxWidth: 12, minHeight: 0, maxHeight: 12 }, true, context)
      this._badge.offset = {
        x: navigationTrailingOffset(width, this._badge.size.width),
        y: (height - this._badge.size.height) / 2,
      }
    }
    if (this._openedDot) {
      this._openedDot.layout({ minWidth: 0, maxWidth: 6, minHeight: 0, maxHeight: 6 }, true, context)
      this._openedDot.offset = {
        x: navigationTrailingOffset(width, this._openedDot.size.width),
        y: (height - this._openedDot.size.height) / 2,
      }
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    super.performPaint(context, offset)
  }
}

class RenderCollapsedNavigationGroup extends RenderBox {
  static override debugTypeName = 'RenderCollapsedNavigationGroup'
  private readonly _icon?: RenderIcon
  private readonly _label?: RenderText

  constructor(options: {
    title: string
    icon?: IconName
    selected?: boolean
  }) {
    super()
    this._icon = options.icon ? new RenderIcon({ name: options.icon, size: 15 }) : undefined
    this._label = this._icon ? undefined : new RenderText(options.title.slice(0, 1), {
      role: options.selected ? 'accent' : 'default',
      weight: options.selected ? 'semibold' : 'normal',
    })
    if (this._icon) this._icon.parent = this
    if (this._label) this._label.parent = this
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      if (this._icon) visitor(this._icon)
      if (this._label) visitor(this._label)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    if (this._icon) visitor(this._icon)
    if (this._label) visitor(this._label)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const width = constraints.maxWidth === Infinity ? Math.max(constraints.minWidth, 24) : constraints.maxWidth
    const height = constraints.maxHeight === Infinity ? Math.max(constraints.minHeight, 18) : constraints.maxHeight
    this.size = { width, height }
    const main = this._icon ?? this._label
    if (main) {
      main.layout({ minWidth: 0, maxWidth: width, minHeight: 0, maxHeight: 18 }, true, context)
      main.offset = {
        x: (width - main.size.width) / 2,
        y: (height - main.size.height) / 2,
      }
    }
  }
}

class RenderNavigationItemRow extends RenderBox {
  static override debugTypeName = 'RenderNavigationItemRow'
  private readonly _icon?: RenderIcon
  private readonly _text: RenderText
  private readonly _trailing?: RenderBox

  constructor(options: {
    title: string
    icon?: IconName
    selected?: boolean
    emphasized?: boolean
    trailing?: RenderBox
  }) {
    super()
    this._icon = options.icon ? new RenderIcon({ name: options.icon, size: 15 }) : undefined
    this._text = new RenderText(options.title, {
      role: options.selected ? 'accent' : options.emphasized ? 'accent' : 'default',
      weight: options.selected || options.emphasized ? 'semibold' : 'normal',
    })
    this._trailing = options.trailing
    if (this._icon) this._icon.parent = this
    this._text.parent = this
    if (this._trailing) this._trailing.parent = this
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      if (this._icon) visitor(this._icon)
      visitor(this._text)
      if (this._trailing) visitor(this._trailing)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    if (this._icon) visitor(this._icon)
    visitor(this._text)
    if (this._trailing) visitor(this._trailing)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const width = constraints.maxWidth === Infinity ? Math.max(constraints.minWidth, 120) : constraints.maxWidth
    const height = constraints.maxHeight === Infinity ? Math.max(constraints.minHeight, 18) : constraints.maxHeight
    this.size = { width, height }

    const gap = 8
    let leadingWidth = 0
    if (this._icon) {
      this._icon.layout({ minWidth: 0, maxWidth: 15, minHeight: 0, maxHeight: 15 }, true, context)
      this._icon.offset = {
        x: 0,
        y: (height - this._icon.size.height) / 2,
      }
      leadingWidth = this._icon.size.width + gap
    }

    let trailingWidth = 0
    if (this._trailing) {
      this._trailing.layout({ minWidth: 0, maxWidth: 48, minHeight: 0, maxHeight: height }, true, context)
      trailingWidth = this._trailing.size.width
      this._trailing.offset = {
        x: trailingWidth <= navigationTrailingSlotWidth
          ? navigationTrailingOffset(width, trailingWidth)
          : Math.max(0, width - trailingWidth),
        y: (height - this._trailing.size.height) / 2,
      }
    }

    const trailingGap = trailingWidth > 0 ? gap + Math.max(trailingWidth, navigationTrailingSlotWidth) : 0
    const textWidth = Math.max(0, width - leadingWidth - trailingGap)
    this._text.layout({ minWidth: 0, maxWidth: textWidth, minHeight: 0, maxHeight: height }, true, context)
    this._text.offset = {
      x: leadingWidth,
      y: (height - this._text.size.height) / 2,
    }
  }
}

function createNavigationItemRow(item: NavigationMenuItem, selected: boolean): RenderBox {
  const status = itemToneStatus(item)
  const opened = itemOpened(item)
  const emphasizesText = (status !== 'none' && status !== 'opened') || item.badge !== undefined || item.loading
  const hasBadgeStatus = status !== 'none' && status !== 'opened'
  let trailing: RenderBox | undefined
  if (item.loading) {
    trailing = new RenderBadge({
      dot: true,
      status: 'warning',
      appearance: 'filled',
      compact: true,
    })
  } else if (item.badge !== undefined) {
    trailing = new RenderBadge({
      value: item.badge,
      status: statusBadgeStatus(status),
      appearance: 'filled',
      compact: true,
    })
  } else if (hasBadgeStatus) {
    trailing = new RenderBadge({
      dot: true,
      status: statusBadgeStatus(status),
      appearance: 'filled',
      compact: true,
    })
  } else if (opened) {
    trailing = new RenderNavigationOpenedDot()
  }
  return new RenderNavigationItemRow({
    title: item.title,
    icon: item.icon,
    selected,
    emphasized: emphasizesText,
    trailing,
  })
}

class RenderNavigationPopupPanel extends RenderPanel {
  static override debugTypeName = 'RenderNavigationPopupPanel'
  private readonly _content: RenderBox
  panelWidth = 192

  constructor(child: RenderBox) {
    super({ padding: { left: 4, right: 4, top: 5, bottom: 5 } })
    this._content = child
    this._content.parent = this
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    visitor(this._content)
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    visitor(this._content)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const width = Math.max(constraints.minWidth, Math.min(constraints.maxWidth, this.panelWidth))
    const contentConstraints = this.deflatePaddingConstraints({ ...constraints, minWidth: width, maxWidth: width })
    const contentLayout = resolveChildLayout(
      this._content,
      {
        minWidth: contentConstraints.maxWidth,
        maxWidth: contentConstraints.maxWidth,
        minHeight: 0,
        maxHeight: contentConstraints.maxHeight,
      },
      'stretch',
      'start',
    )
    this._content.layout(contentLayout.constraints, true, context)
    this.size = this.inflatePaddingSize(constraints, this._content.outerSize)
    this._content.positionInSlot({
      x: this.contentOffset.x,
      y: this.contentOffset.y,
      width: this.contentSize.width,
      height: this._content.outerSize.height,
    }, contentLayout.horizontalAlignment, contentLayout.verticalAlignment)
  }

  performPaint(context: PaintContext, offset: Offset): void {
    drawPopupPanel(
      new DrawList(context),
      offset.x,
      offset.y,
      this.size.width,
      this.size.height,
      derivePopupStyle(context.theme),
    )
    super.performPaint(context, offset)
  }
}

class NavigationCollapsedGroupPopup extends PopupSurfaceShell {
  readonly overlayLayer = 'overlay'

  private readonly _itemsControl: RenderItemsControl<NavigationMenuItem>
  private readonly _panel: RenderNavigationPopupPanel
  private readonly _position: (popupContext: PopupContext) => Offset
  private readonly _bounds: (popupContext: PopupContext) => Rect
  private readonly _owner: object
  private readonly _onRailPointerMove: (event: PointerEvent) => boolean
  private readonly _onClose?: () => void
  private _disposed = false

  constructor(options: {
    items: NavigationMenuItem[]
    selectedKey: string
    owner: object
    position: (popupContext: PopupContext) => Offset
    bounds: (popupContext: PopupContext) => Rect
    onSelect: (item: NavigationMenuItem) => void
    onRailPointerMove: (event: PointerEvent) => boolean
    onClose?: () => void
  }) {
    super()
    const selectedItem = options.items.find(item => item.key === options.selectedKey) ?? null
    this._owner = options.owner
    this._position = options.position
    this._bounds = options.bounds
    this._onRailPointerMove = options.onRailPointerMove
    this._onClose = options.onClose
    this._itemsControl = new RenderItemsControl<NavigationMenuItem>({
      items: options.items,
      getKey: item => item.key,
      selectedItem,
      itemTemplate: (item, state) => createNavigationItemRow(item, state.selected),
      onActivate: item => {
        if (itemInteractiveDisabled(item)) return
        options.onSelect(item)
      },
      onItemHover: () => this.requestPopupPaint(),
      isItemDisabled: item => itemInteractiveDisabled(item),
      scrollMode: 'auto',
      spacing: 2,
      itemMinHeight: 30,
      itemPaddingY: 2,
      itemShowAccent: true,
      itemAppearance: 'navigation',
      maxHeight: 320,
    })
    this._panel = new RenderNavigationPopupPanel(this._itemsControl)
    this.setPopupSurfaceRoot(this._panel)
    this.setPopupSurfaceSync((root, popupContext) => {
      const layout = this._layout(popupContext)
      root.offset = { x: layout.x, y: layout.y }
      if (root instanceof RenderNavigationPopupPanel) root.panelWidth = layout.width
      root.layout({
        minWidth: layout.width,
        maxWidth: layout.width,
        minHeight: 0,
        maxHeight: layout.height,
      }, false, { theme: popupContext.theme })
    })
  }

  open(): void {
    this.resetPopupSurface()
    this.openPopup({ owner: this._owner })
  }

  override onPointerMove(event: PointerEvent, popupContext: PopupContext = PopupManager.instance.context): void {
    if (this._onRailPointerMove(event)) return
    super.onPointerMove(event, popupContext)
  }

  debugItemsControl(): RenderItemsControl<NavigationMenuItem> {
    return this._itemsControl
  }

  protected override onPopupClose(): void {
    super.onPopupClose()
    try {
      this._disposeContent()
    } finally {
      this._onClose?.()
    }
  }

  private _layout(popupContext: PopupContext): Rect {
    const bounds = this._bounds(popupContext)
    const naturalHeight = 10 + this._itemsControl.items.length * 30 +
      Math.max(0, this._itemsControl.items.length - 1) * 2
    const height = Math.min(320, naturalHeight, Math.max(48, bounds.height - 8))
    const width = this._preferredWidth(popupContext, bounds, naturalHeight > height)
    const pos = this._position(popupContext)
    const minX = bounds.x + 4
    const minY = bounds.y + 4
    const maxX = Math.max(minX, bounds.x + bounds.width - width - 4)
    const maxY = Math.max(minY, bounds.y + bounds.height - height - 4)
    return {
      x: Math.max(minX, Math.min(maxX, pos.x)),
      y: Math.max(minY, Math.min(maxY, pos.y)),
      width,
      height,
    }
  }

  private _preferredWidth(popupContext: PopupContext, bounds: Rect, hasVerticalScrollbar: boolean): number {
    const itemStyle = deriveItemContainerStyle(popupContext.theme, 'navigation')
    const maxItemWidth = this._itemsControl.items.reduce((max, item) => {
      return Math.max(max, navigationItemRowNaturalWidth(item, { theme: popupContext.theme }))
    }, 0)
    const scrollbarWidth = hasVerticalScrollbar ? deriveScrollbarStyle(popupContext.theme).gutterSize : 0
    const contentWidth = Math.ceil(
      maxItemWidth +
      itemStyle.paddingX * 2 +
      navigationPopupPanelPaddingX +
      scrollbarWidth,
    )
    const availableWidth = Math.max(48, bounds.width - 8)
    const maxWidth = Math.min(navigationPopupMaxWidth, availableWidth)
    const minWidth = Math.min(navigationPopupMinWidth, maxWidth)
    return Math.max(minWidth, Math.min(maxWidth, contentWidth))
  }

  private _disposeContent(): void {
    if (this._disposed) return
    this._disposed = true
    this._panel.dispose()
    this.disposePopupSurface()
  }
}

function entryKey(entry: NavigationMenuEntry): string {
  return entry.kind === 'group' ? `group:${entry.group.key}` : entry.item.key
}

function statusBadgeStatus(status: NavigationMenuItemStatus | undefined): BadgeStatus {
  switch (status) {
    case 'success':
      return 'success'
    case 'warning':
      return 'warning'
    case 'danger':
      return 'danger'
    case 'opened':
      return 'primary'
    default:
      return 'normal'
  }
}

function itemOpened(item: NavigationMenuItem): boolean {
  return item.opened === true || item.status === 'opened'
}

function itemInteractiveDisabled(item: NavigationMenuItem): boolean {
  return item.disabled === true || item.loading === true
}

function itemToneStatus(item: NavigationMenuItem): NavigationMenuItemStatus {
  if (item.status && item.status !== 'none') return item.status
  return item.opened ? 'opened' : 'none'
}

function matchesSearch(group: NavigationMenuGroup, item: NavigationMenuItem, query: string): boolean {
  if (!query) return true
  const normalized = query.toLocaleLowerCase()
  return item.title.toLocaleLowerCase().includes(normalized) ||
    item.key.toLocaleLowerCase().includes(normalized) ||
    group.title.toLocaleLowerCase().includes(normalized)
}

export class RenderNavigationMenu extends RenderBorder {
  static override debugTypeName = 'RenderNavigationMenu'
  static readonly expandedWidth = 248
  static readonly collapsedWidth = 56

  readonly searchBox: RenderSearchBox
  readonly itemsControl: RenderItemsControl<NavigationMenuEntry>
  readonly collapseButton: RenderIconButton
  onItemActivate?: (item: NavigationMenuItem) => void
  onCollapsedChange?: (collapsed: boolean) => void

  private _groups: NavigationMenuGroup[]
  private readonly _title: string
  private readonly _subtitle?: string
  private _selectedKey = ''
  private _searchValue = ''
  private _collapsedGroupKeys = new Set<string>()
  private _collapsed: boolean
  private _disabled: boolean
  private readonly _collapseAnim: AnimationController
  private _collapsedGroupPopup: NavigationCollapsedGroupPopup | null = null
  private _collapsedGroupPopupKey = ''

  constructor(options: {
    title: string
    subtitle?: string
    groups: NavigationMenuGroup[]
    selectedKey?: string | null
    searchPlaceholder?: string
    collapsed?: boolean
    disabled?: boolean
    onItemActivate?: (item: NavigationMenuItem) => void
    onCollapsedChange?: (collapsed: boolean) => void
  }) {
    super({
      background: 'muted',
      padding: { left: 8, right: 8, top: 10, bottom: 8 },
      cornerRadius: 0,
    })
    this._groups = options.groups.map(group => ({
      ...group,
      children: group.children.slice(),
    }))
    this._title = options.title
    this._subtitle = options.subtitle
    this._collapsed = options.collapsed ?? false
    this._disabled = options.disabled ?? false
    this._collapseAnim = new AnimationController({
      initialValue: this._collapsed ? 0 : 1,
      duration: 180,
      curve: Curves.easeInOutCubic,
      onTick: () => {
        this.markNeedsLayout()
      },
    })
    this._collapseAnim.addListener(() => {
      this.onCollapsedChange?.(this._collapsed)
      this.markNeedsLayout()
    })
    this._syncCollapsedGroupsFromDefinitions()
    this._selectedKey = options.selectedKey ?? ''
    this.onItemActivate = options.onItemActivate
    this.onCollapsedChange = options.onCollapsedChange
    this.searchBox = new RenderSearchBox({
      value: '',
      placeholder: options.searchPlaceholder ?? '搜索导航...',
      onChange: value => this._setSearchValue(value),
      onSearch: value => this._setSearchValue(value),
    })
    this.collapseButton = new RenderIconButton({
      icon: this._collapsed ? 'chevron-right' : 'chevron-left',
      tooltip: this._collapsed ? '展开导航' : '折叠导航',
      size: 28,
      iconSize: 14,
      onClick: () => {
        this.collapsed = !this._collapsed
      },
    })
    this.itemsControl = new RenderItemsControl<NavigationMenuEntry>({
      items: this._createEntries(),
      getKey: entryKey,
      selectedItem: null,
      isItemDisabled: entry => entry.kind === 'item' && itemInteractiveDisabled(entry.item),
      itemTemplate: (entry, state) => this._createEntryRenderObject(entry, state.selected),
      onSelectionChange: ({ item }) => {
        if (this.disabled) return
        if (item.kind !== 'item') return
        this.selectedKey = item.item.key
      },
      onActivate: item => {
        if (this.disabled) return
        if (item.kind === 'group') {
          if (this._collapsed) this._showCollapsedGroupPopup(item.group.key)
          else this.toggleGroup(item.group.key)
          return
        }
        if (item.kind !== 'item') return
        if (itemInteractiveDisabled(item.item)) return
        this.selectedKey = item.item.key
        this.onItemActivate?.(item.item)
      },
      onItemHover: item => {
        if (this.disabled) return
        if (!this._collapsed || item?.kind !== 'group') return
        this._showCollapsedGroupPopup(item.group.key)
      },
      scrollMode: 'auto',
      spacing: 2,
      itemMinHeight: this._collapsed ? 32 : 30,
      itemPaddingY: 2,
      itemShowAccent: !this._collapsed,
      itemAppearance: 'navigation',
      isItemSelectable: entry => this._collapsed && !this._searchValue.trim()
        ? entry.kind === 'group'
        : entry.kind === 'item',
    })
    this._syncDisabledState()
    this._rebuildShell()
    this._syncSelection()
  }

  get groups(): NavigationMenuGroup[] {
    return this._groups
  }

  set groups(groups: NavigationMenuGroup[]) {
    this._groups = groups.map(group => ({
      ...group,
      children: group.children.slice(),
    }))
    this._syncCollapsedGroupsFromDefinitions(true)
    this._syncEntries()
  }

  get selectedKey(): string | null {
    return this._selectedKey || null
  }

  set selectedKey(key: string | null) {
    const next = key ?? ''
    if (this._selectedKey === next) return
    this._selectedKey = next
    this._syncSelection()
  }

  get selectedItem(): NavigationMenuItem | null {
    if (!this._selectedKey) return null
    const entry = this.itemsControl.selectedItem
    return entry?.kind === 'item' ? entry.item : null
  }

  get selectedGlobalItem(): NavigationMenuItem | null {
    if (!this._selectedKey) return null
    return this._findItem(this._selectedKey)
  }

  get searchValue(): string {
    return this._searchValue
  }

  set searchValue(value: string) {
    this._setSearchValue(value)
  }

  get visibleEntries(): readonly NavigationMenuEntry[] {
    return this.itemsControl.items
  }

  get collapsed(): boolean {
    return this._collapsed
  }

  get disabled(): boolean {
    return this._disabled
  }

  set disabled(disabled: boolean) {
    if (this._disabled === disabled) return
    this._disabled = disabled
    this._syncDisabledState()
    this.markNeedsPaint()
  }

  set collapsed(collapsed: boolean) {
    if (this._collapsed === collapsed) return
    this._collapsed = collapsed
    if (!collapsed) this._dismissCollapsedGroupPopup()
    this.collapseButton.icon = collapsed ? 'chevron-right' : 'chevron-left'
    this.collapseButton.tooltip = collapsed ? '展开导航' : '折叠导航'
    this.itemsControl.itemMinHeight = collapsed ? 32 : 30
    this.itemsControl.itemShowAccent = !collapsed
    this._syncEntries()
    this._rebuildShell()
    this.onCollapsedChange?.(collapsed)
    if (typeof requestAnimationFrame !== 'function' || typeof cancelAnimationFrame !== 'function') {
      this._collapseAnim.resetValue(collapsed ? 0 : 1)
      this.markNeedsLayout()
      return
    }
    this._collapseAnim.animateTo(collapsed ? 0 : 1)
    this.markNeedsLayout()
  }

  get currentWidth(): number {
    return RenderNavigationMenu.collapsedWidth +
      (RenderNavigationMenu.expandedWidth - RenderNavigationMenu.collapsedWidth) * this._collapseAnim.value
  }

  override performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const width = Math.max(constraints.minWidth, Math.min(constraints.maxWidth, this.currentWidth))
    super.performLayout({
      minWidth: width,
      maxWidth: width,
      minHeight: constraints.minHeight,
      maxHeight: constraints.maxHeight,
    }, context)
  }

  override performPaint(context: PaintContext, offset: Offset): void {
    const style = deriveBorderStyle(context.theme, 'muted')
    const elevation = resolveThemeElevation(context.theme)
    const dl = new DrawList(context)
    const radius = this._collapsed ? 8 : 6

    dl.shadowBehind(
      offset.x,
      offset.y,
      this.size.width,
      this.size.height,
      14,
      elevation.cardShadowColor,
      radius,
      3,
      0,
    )
    dl.fillRect(
      offset.x,
      offset.y,
      this.size.width,
      this.size.height,
      lerpColor(style.backgroundColor, context.theme.surfacePanel, 0.18),
      radius,
    )
    dl.strokeRect(
      offset.x,
      offset.y,
      this.size.width,
      this.size.height,
      style.borderColor,
      1,
      radius,
    )
    dl.line(
      offset.x + this.size.width - 0.5,
      offset.y,
      offset.x + this.size.width - 0.5,
      offset.y + this.size.height,
      style.borderColor,
      1,
    )
    this.paintContentChildren(context, offset)
    this.paintAdornerChildren(context, offset)
  }

  isGroupCollapsed(groupKey: string): boolean {
    return this._collapsedGroupKeys.has(groupKey)
  }

  setGroupCollapsed(groupKey: string, collapsed: boolean): void {
    const group = this._groups.find(candidate => candidate.key === groupKey)
    if (!group || group.collapsible === false) return
    const changed = collapsed
      ? !this._collapsedGroupKeys.has(groupKey)
      : this._collapsedGroupKeys.has(groupKey)
    if (!changed) return
    if (collapsed) this._collapsedGroupKeys.add(groupKey)
    else this._collapsedGroupKeys.delete(groupKey)
    this._syncEntries()
  }

  toggleGroup(groupKey: string): void {
    this.setGroupCollapsed(groupKey, !this.isGroupCollapsed(groupKey))
  }

  override visitChildren(visitor: (child: RenderObject) => void): void {
    super.visitChildren(visitor)
  }

  override dispose(): void {
    this._dismissCollapsedGroupPopup()
    this._collapseAnim.dispose()
    super.dispose()
  }

  private _setSearchValue(value: string): void {
    if (this._searchValue === value) return
    this._searchValue = value
    this.searchBox.value = value
    this._syncEntries()
  }

  private _syncEntries(): void {
    this.itemsControl.items = this._createEntries()
    this._syncSelection()
  }

  private _syncSelection(): void {
    if (this._collapsed && !this._searchValue.trim()) {
      const selectedGroupKey = this._collapsedGroupPopupKey ||
        this._groups.find(group => this._groupHasSelectedItem(group))?.key ||
        ''
      const selectedGroupEntry = selectedGroupKey
        ? this.itemsControl.items.find(entry =>
          entry.kind === 'group' && entry.group.key === selectedGroupKey
        ) ?? null
        : null
      this.itemsControl.selectedItem = selectedGroupEntry
      return
    }

    const selectedEntry = this.itemsControl.items.find(entry =>
      entry.kind === 'item' && entry.item.key === this._selectedKey
    ) ?? null
    this.itemsControl.selectedItem = selectedEntry
  }

  private _syncDisabledState(): void {
    if (this._disabled) {
      this.searchBox.disabled = true
      this.collapseButton.disabled = true
      this._dismissCollapsedGroupPopup()
      this._syncSelection()
      this.itemsControl.disabled = true
      return
    }
    this.searchBox.disabled = false
    this.collapseButton.disabled = false
    this.itemsControl.disabled = false
    this._syncSelection()
  }

  private _createEntries(): NavigationMenuEntry[] {
    const entries: NavigationMenuEntry[] = []
    const query = this._searchValue.trim()
    for (const group of this._groups) {
      const children = group.children.filter(item => matchesSearch(group, item, query))
      if (children.length === 0) continue
      if (this._collapsed && !query) {
        entries.push({ kind: 'group', group })
        continue
      }
      if (!this._collapsed) {
        entries.push({ kind: 'group', group })
        if (!query && this._collapsedGroupKeys.has(group.key)) continue
      }
      for (const item of children) {
        entries.push({ kind: 'item', groupKey: group.key, item })
      }
    }
    return entries
  }

  private _createEntryRenderObject(entry: NavigationMenuEntry, selected: boolean): RenderBox {
    if (entry.kind === 'group') {
      if (this._collapsed) {
        const selected = this._collapsedGroupPopupKey === entry.group.key ||
          this._groupHasSelectedItem(entry.group)
        return new RenderCollapsedNavigationGroup({
          title: entry.group.title,
          icon: entry.group.icon,
          selected,
        })
      }
      const group = this._createGroupRenderObject(entry)
      group.margin = { left: 2, top: 7, bottom: 2 }
      return group
    }

    const item = entry.item
    const status = itemToneStatus(item)
    const opened = itemOpened(item)
    if (this._collapsed) {
      return new RenderCollapsedNavigationItem({
        icon: item.icon,
        status: opened ? 'opened' : status,
      })
    }

    return createNavigationItemRow(item, selected)
  }

  private _rebuildShell(): void {
    const column = new RenderStackPanel({
      orientation: 'vertical',
      crossAxisAlignment: 'stretch',
      spacing: this._collapsed ? 8 : 10,
    })

    if (this._collapsed) {
      this.collapseButton.margin = { left: 6, right: 6 }
      this.itemsControl.margin = { left: 2, right: 3 }
      column.addChild(this.collapseButton)
      column.addChild(this.itemsControl, 1)
      this.setChild(column)
      return
    }

    const titleBlock = new RenderStackPanel({ orientation: 'vertical', spacing: 2 })
    titleBlock.addChild(new RenderText(this._title, {
      role: 'title',
      weight: 'semibold',
    }))
    if (this._subtitle) {
      titleBlock.addChild(new RenderText(this._subtitle, {
        role: 'secondary',
        size: 'small',
      }))
    }

    const headerRow = new RenderStackPanel({
      orientation: 'horizontal',
      crossAxisAlignment: 'center',
      spacing: 8,
    })
    headerRow.addChild(titleBlock, 1)
    headerRow.addChild(this.collapseButton)

    headerRow.margin = { left: 4, top: 2 }
    column.addChild(headerRow)
    column.addChild(this.searchBox)
    column.addChild(this.itemsControl, 1)
    this.setChild(column)
  }

  private _findItem(key: string): NavigationMenuItem | null {
    for (const group of this._groups) {
      const item = group.children.find(child => child.key === key)
      if (item) return item
    }
    return null
  }

  private _createGroupRenderObject(entry: Extract<NavigationMenuEntry, { kind: 'group' }>): RenderBox {
    const collapsed = this._collapsedGroupKeys.has(entry.group.key)
    const row = new RenderStackPanel({
      orientation: 'horizontal',
      mainAxisAlignment: 'spaceBetween',
      crossAxisAlignment: 'center',
      spacing: 6,
    })
    row.addChild(new RenderText(entry.group.title, {
      role: 'secondary',
      size: 'small',
      weight: 'semibold',
    }))
    row.addChild(new RenderIcon({
      name: collapsed ? 'chevron-right' : 'chevron-down',
      size: 13,
    }))
    return row
  }

  private _syncCollapsedGroupsFromDefinitions(preserveExisting = false): void {
    const next = new Set<string>()
    for (const group of this._groups) {
      if (group.collapsible === false) continue
      if ((preserveExisting && this._collapsedGroupKeys.has(group.key)) || group.collapsed) {
        next.add(group.key)
      }
    }
    this._collapsedGroupKeys = next
  }

  private _groupHasSelectedItem(group: NavigationMenuGroup): boolean {
    return group.children.some(item => item.key === this._selectedKey)
  }

  private _showCollapsedGroupPopup(groupKey: string): void {
    const group = this._groups.find(candidate => candidate.key === groupKey)
    if (this.disabled || !group || !this._collapsed) return
    if (this._collapsedGroupPopupKey === groupKey && this._collapsedGroupPopup?.visible) return
    this._collapsedGroupPopup?.dismiss()
    const popup = new NavigationCollapsedGroupPopup({
      items: group.children,
      selectedKey: this._selectedKey,
      owner: this,
      onSelect: item => {
        if (this.disabled) return
        this._collapsedGroupPopup?.dismiss()
        this.selectedKey = item.key
        this.onItemActivate?.(item)
      },
      position: () => {
        const rect = this._entryGlobalRect(`group:${groupKey}`)
        return {
          x: rect.x + rect.width + 6,
          y: rect.y,
        }
      },
      bounds: popupContext => popupViewportRect(popupContext),
      onRailPointerMove: event => {
        const hoveredGroupKey = this._collapsedGroupKeyAt(event.position)
        if (!hoveredGroupKey || hoveredGroupKey === this._collapsedGroupPopupKey) return false
        this._showCollapsedGroupPopup(hoveredGroupKey)
        return true
      },
      onClose: () => {
        if (this._collapsedGroupPopup === popup) {
          this._collapsedGroupPopup = null
          this._collapsedGroupPopupKey = ''
          this._syncSelection()
        }
      },
    })
    this._collapsedGroupPopup = popup
    this._collapsedGroupPopupKey = groupKey
    this._syncSelection()
    popup.open()
  }

  private _dismissCollapsedGroupPopup(): void {
    this._collapsedGroupPopup?.dismiss()
    this._collapsedGroupPopup = null
    this._collapsedGroupPopupKey = ''
  }

  private _collapsedGroupKeyAt(point: Offset): string {
    if (this.disabled || !this._collapsed || this._searchValue.trim()) return ''
    for (const container of this.itemsControl.debugContainers()) {
      if (container.item.kind !== 'group') continue
      const offset = container.globalOffset
      if (
        point.x >= offset.x &&
        point.x <= offset.x + container.size.width &&
        point.y >= offset.y &&
        point.y <= offset.y + container.size.height
      ) {
        return container.item.group.key
      }
    }
    return ''
  }

  private _entryGlobalRect(key: string): Rect {
    const container = this.itemsControl.debugContainers().find(candidate => candidate.itemKey === key)
    if (!container) {
      return {
        x: this.globalOffset.x,
        y: this.globalOffset.y,
        width: this.size.width,
        height: 32,
      }
    }
    const offset = container.globalOffset
    return {
      x: offset.x,
      y: offset.y,
      width: container.size.width,
      height: container.size.height,
    }
  }
}
