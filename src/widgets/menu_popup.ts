import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import type { Offset, Rect } from '../core/render_object'
import type { PointerEvent } from '../gestures/hit_test'
import {
  deriveContextMenuStyle,
  derivePopupStyle,
  resolveBgColor,
  resolveTextColor,
  type ContextMenuStyleTokens,
  type PopupStyleTokens,
} from '../theme/component_styles'
import { PopupManager, type Popup, type PopupContext } from '../core/popup_manager'
import { PopupRenderNode } from '../core/popup_render_surface'
import { PopupSurfaceShell } from '../core/popup_shell'
import { drawPopupPanel } from '../rendering/popup_painter'
import { TextMeasurer } from '../core/text_measurer'
import { isIconName, paintIconGlyph } from './icon'

export interface ContextMenuItem {
  key: string
  label: string
  icon?: string
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  items?: ContextMenuEntry[]
  separator?: false
}

export interface ContextMenuSeparator {
  separator: true
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator

export interface ContextMenuItemDebugTarget {
  key: string
  path: readonly string[]
  rect: Rect
  disabled: boolean
  hasSubmenu: boolean
}

export function isContextMenuSeparator(entry: ContextMenuEntry): entry is ContextMenuSeparator {
  return 'separator' in entry && entry.separator === true
}

export function isContextMenuItem(entry: ContextMenuEntry): entry is ContextMenuItem {
  return !isContextMenuSeparator(entry)
}

export function hasContextSubmenu(entry: ContextMenuEntry): entry is ContextMenuItem & { items: ContextMenuEntry[] } {
  return isContextMenuItem(entry) && Array.isArray(entry.items) && entry.items.length > 0
}

interface MenuPopupLayoutItem {
  entry: ContextMenuItem
  rect: Rect
}

interface MenuPopupLayout {
  pos: Offset
  totalHeight: number
  menuWidth: number
  itemHeight: number
  separatorHeight: number
  style: ContextMenuStyleTokens
  popupStyle: PopupStyleTokens
  itemLayouts: MenuPopupLayoutItem[]
}

interface MenuPopupPaintSnapshot {
  theme: PopupContext['theme']
  viewport: PopupContext['viewport']
}

export type MenuPopupBoundsProvider = (popupContext: PopupContext) => Rect
export interface MenuPopupPositionMetrics {
  menuWidth: number
  totalHeight: number
  bounds: Rect
}

export type MenuPopupPositionProvider = (popupContext: PopupContext, metrics: MenuPopupPositionMetrics) => Offset

interface MenuPopupOptions {
  items: ContextMenuEntry[]
  onSelect: (key: string) => void
  bounds: MenuPopupBoundsProvider
  position?: MenuPopupPositionProvider
  owner?: object
  parent?: Popup
  parentMenu?: MenuPopup
  parentItemKey?: string
  onClose?: () => void
}

export class MenuPopup extends PopupSurfaceShell implements Popup {
  readonly overlayLayer = 'overlay'

  private readonly _items: ContextMenuEntry[]
  private readonly _onSelect: (key: string) => void
  private readonly _bounds: MenuPopupBoundsProvider
  private readonly _position?: MenuPopupPositionProvider
  private readonly _owner?: object
  private readonly _parent?: Popup
  private readonly _parentMenu?: MenuPopup
  private readonly _parentItemKey?: string
  private readonly _onClose?: () => void

  private _hoveredKey = ''
  private _keyboardIndex = -1
  private _child: MenuPopup | null = null
  private _childParentKey = ''
  private _paintedItems: ContextMenuItemDebugTarget[] = []
  private _paintSnapshot: MenuPopupPaintSnapshot | null = null

  constructor(opts: MenuPopupOptions) {
    super()
    this._items = opts.items
    this._onSelect = opts.onSelect
    this._bounds = opts.bounds
    this._position = opts.position
    this._owner = opts.owner
    this._parent = opts.parent
    this._parentMenu = opts.parentMenu
    this._parentItemKey = opts.parentItemKey
    this._onClose = opts.onClose
    this.setPopupSurfaceRoot(new PopupRenderNode({
      paint: (_node, context, offset) => this._paintSurface(context, offset),
      onPointerDown: (_node, event) => this._handleSurfacePointerDown(event),
      onPointerMove: (_node, event) => this._handleSurfacePointerMove(event),
      onPointerLeave: (_node, event) => this._handleSurfaceHoverExit(event),
      onPointerCancel: (_node, event) => this._handleSurfaceSequenceCancel(event),
    }))
    this.setPopupSurfaceSync((root, popupContext) => {
      const layout = this._layout(popupContext)
      root.offset = { x: layout.pos.x, y: layout.pos.y }
      root.layout({
        minWidth: layout.menuWidth,
        maxWidth: layout.menuWidth,
        minHeight: layout.totalHeight,
        maxHeight: layout.totalHeight,
      }, false, { theme: popupContext.theme })
    })
  }

  get hoveredKey(): string { return this._hoveredKey }

  debugPaintedItems(popupContext: PopupContext = PopupManager.instance.context): ContextMenuItemDebugTarget[] {
    const snapshot = this._paintSnapshot
    const viewport = popupContext.viewport
    const own = this.visible && snapshot &&
      snapshot.theme === popupContext.theme &&
      snapshot.viewport.width === viewport.width &&
      snapshot.viewport.height === viewport.height &&
      snapshot.viewport.dpr === viewport.dpr
      ? this._paintedItems.map(item => ({
          ...item,
          path: [...item.path],
          rect: { ...item.rect },
        }))
      : []
    return [...own, ...(this._child?.debugPaintedItems(popupContext) ?? [])]
  }

  debugState(popupContext: PopupContext = PopupManager.instance.context): {
    pos: Offset
    totalHeight: number
    menuWidth: number
    itemHeight: number
    separatorHeight: number
    hoveredKey: string
    childParentKey: string
  } {
    const layout = this._layout(popupContext)
    return {
      pos: { ...layout.pos },
      totalHeight: layout.totalHeight,
      menuWidth: layout.menuWidth,
      itemHeight: layout.itemHeight,
      separatorHeight: layout.separatorHeight,
      hoveredKey: this._hoveredKey,
      childParentKey: this._childParentKey,
    }
  }

  open(): void {
    if (this.popupOpen) this.close()
    this._hoveredKey = ''
    this._keyboardIndex = -1
    this._child = null
    this._childParentKey = ''
    this._clearPaintedItems()
    this.resetPopupSurface()
    this.openPopup({
      owner: this._owner,
      parent: this._parent ?? this._parentMenu,
    })
  }

  dismiss(): void {
    super.dismiss()
  }

  private _handleSurfacePointerMove(event: PointerEvent, popupContext: PopupContext = PopupManager.instance.context): void {
    const layout = this._layout(popupContext)
    this._highlightItem(this._itemAt(event.position, layout))
  }

  private _handleSurfacePointerDown(event: PointerEvent, popupContext: PopupContext = PopupManager.instance.context): void {
    const layout = this._layout(popupContext)
    const item = this._itemAt(event.position, layout)
    if (!item || item.entry.disabled) return
    this._highlightItem(item)
    if (hasContextSubmenu(item.entry)) {
      this._openChild(item.entry.key, item.entry.items)
      return
    }
    this._onSelect(item.entry.key)
  }

  private _handleSurfaceHoverExit(_event: PointerEvent): void {
    if (this._child && this._child.visible && this._childParentKey) {
      const branchIndex = this._selectableIndexByKey(this._childParentKey)
      const changed = this._hoveredKey !== this._childParentKey || this._keyboardIndex !== branchIndex
      this._hoveredKey = this._childParentKey
      this._keyboardIndex = branchIndex
      if (changed) PopupManager.instance.requestPaint()
      return
    }
    if (!this._hoveredKey) return
    this._hoveredKey = ''
    this._keyboardIndex = -1
    PopupManager.instance.requestPaint()
  }

  private _handleSurfaceSequenceCancel(_event: PointerEvent): void {
    const hadHover = !!this._hoveredKey
    const hadChild = !!this._childParentKey || !!this._child
    this._hoveredKey = ''
    this._keyboardIndex = -1
    this._closeChild()
    if (hadHover || hadChild) PopupManager.instance.requestPaint()
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (!this.visible) return false
    if (event.key === 'Tab') {
      this._closeRootMenu()
      return false
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      this._stepKeyboard(1)
      return true
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      this._stepKeyboard(-1)
      return true
    }
    if (event.key === 'ArrowRight') {
      const item = this._currentSelectableItem()
      if (!item || !hasContextSubmenu(item)) return false
      event.preventDefault()
      this._openChild(item.key, item.items)
      return true
    }
    if (event.key === 'ArrowLeft') {
      if (!this._parentMenu) return false
      event.preventDefault()
      this.dismiss()
      return true
    }
    if (event.key === 'Enter') {
      const item = this._currentSelectableItem()
      if (!item) return false
      event.preventDefault()
      if (hasContextSubmenu(item)) {
        this._openChild(item.key, item.items)
      } else {
        this._onSelect(item.key)
      }
      return true
    }
    return false
  }

  override onEscape(event: KeyboardEvent): boolean {
    if (!this.visible) return false
    event.preventDefault()
    this._closeRootMenu()
    return true
  }

  onWheel(): boolean {
    return true
  }

  protected override onPopupClose(): void {
    super.onPopupClose()
    this._hoveredKey = ''
    this._keyboardIndex = -1
    this._child = null
    this._childParentKey = ''
    this._clearPaintedItems()
    this._onClose?.()
  }

  private _paintSurface(context: PaintContext, offset: Offset): void {
    const popupContext = PopupManager.instance.context
    const layout = this._layout(popupContext)
    const dl = new DrawList(context)
    const s = layout.style
    const x = offset.x
    const y = offset.y
    const w = layout.menuWidth
    const pathPrefix = this._debugPathPrefix()

    drawPopupPanel(dl, x, y, w, layout.totalHeight, layout.popupStyle)

    let curY = y + s.padding
    for (const entry of this._items) {
      if (isContextMenuSeparator(entry)) {
        const sepY = curY + layout.separatorHeight / 2
        dl.line(x + s.padding, sepY, x + w - s.padding, sepY, s.separator, 1)
        curY += layout.separatorHeight
        continue
      }

      const isHovered = entry.key === this._hoveredKey
      const isDisabled = !!entry.disabled
      const isDanger = !!entry.danger
      const state = isDisabled ? 'disabled' : isHovered ? 'hovered' : 'normal'

      if (state !== 'normal') {
        dl.fillRect(x + 2, curY, w - 4, layout.itemHeight, resolveBgColor(s.itemBg, state), s.rowRadius)
      }

      let textX = x + s.padding * 2
      if (entry.icon) {
        const iconColor = resolveTextColor(s.itemText, state)
        if (isIconName(entry.icon)) {
          const iconSize = Math.max(12, Math.min(s.fontSize + 2, layout.itemHeight - 8))
          paintIconGlyph(context, {
            name: entry.icon,
            x: textX,
            y: curY + (layout.itemHeight - iconSize) / 2,
            size: iconSize,
            color: iconColor,
          })
          textX += iconSize + s.iconGap
        } else {
          dl.fillText(entry.icon, textX, curY + layout.itemHeight / 2,
            iconColor, s.fontSize, s.fontFamily, 'left', 'middle')
          textX += TextMeasurer.measureWidth(entry.icon, s.fontSize, s.fontFamily) + s.iconGap
        }
      }

      const labelColor = resolveTextColor(isDanger ? s.dangerItemText : s.itemText, state)
      const rightInset = x + w - s.padding * 2
      const shortcutX = hasContextSubmenu(entry) ? rightInset - s.fontSize * 0.9 : rightInset
      const labelRight = entry.shortcut || hasContextSubmenu(entry) ? shortcutX - s.padding : rightInset
      const labelWidth = Math.max(0, labelRight - textX)
      if (labelWidth > 0) {
        dl.pushClip(textX, curY, labelWidth, layout.itemHeight)
        dl.fillText(entry.label, textX, curY + layout.itemHeight / 2,
          labelColor, s.fontSize, s.fontFamily, 'left', 'middle')
        dl.popClip()
      }

      if (entry.shortcut) {
        dl.fillText(entry.shortcut, shortcutX, curY + layout.itemHeight / 2,
          resolveTextColor(s.shortcutText, state), s.shortcutFontSize, s.fontFamily, 'right', 'middle')
      }

      if (hasContextSubmenu(entry)) {
        const iconSize = Math.max(12, Math.min(s.fontSize, layout.itemHeight - 8))
        paintIconGlyph(context, {
          name: 'chevron-right',
          x: rightInset - iconSize,
          y: curY + (layout.itemHeight - iconSize) / 2,
          size: iconSize,
          color: resolveTextColor(s.shortcutText, state),
        })
      }

      curY += layout.itemHeight
    }
    this._paintedItems = layout.itemLayouts.map(item => ({
      key: item.entry.key,
      path: [...pathPrefix, item.entry.key],
      rect: { ...item.rect },
      disabled: !!item.entry.disabled,
      hasSubmenu: hasContextSubmenu(item.entry),
    }))
    this._paintSnapshot = {
      theme: popupContext.theme,
      viewport: { ...popupContext.viewport },
    }
  }

  itemRect(key: string, popupContext: PopupContext = PopupManager.instance.context): Rect | null {
    const item = this._layout(popupContext).itemLayouts.find(candidate => candidate.entry.key === key)
    return item ? { ...item.rect } : null
  }

  private _layout(popupContext: PopupContext): MenuPopupLayout {
    const style = deriveContextMenuStyle(popupContext.theme)
    const popupStyle = derivePopupStyle(popupContext.theme)
    const bounds = this._bounds(popupContext)
    const itemHeight = style.itemHeight
    const separatorHeight = style.separatorHeight
    const menuWidth = style.menuWidth
    let totalHeight = style.padding * 2
    for (const item of this._items) {
      totalHeight += isContextMenuSeparator(item) ? separatorHeight : itemHeight
    }

    let x = 0
    let y = 0
    if (this._parentMenu && this._parentItemKey) {
      const anchor = this._parentMenu.itemRect(this._parentItemKey, popupContext)
      if (anchor) {
        x = anchor.x + anchor.width - 2
        y = anchor.y - 2
        if (x + menuWidth > bounds.x + bounds.width - 4) x = anchor.x - menuWidth + 2
      }
    } else {
      const pos = this._position?.(popupContext, { menuWidth, totalHeight, bounds }) ?? { x: 0, y: 0 }
      x = pos.x
      y = pos.y
    }

    const minX = bounds.x + 4
    const minY = bounds.y + 4
    const maxX = Math.max(minX, bounds.x + bounds.width - menuWidth - 4)
    const maxY = Math.max(minY, bounds.y + bounds.height - totalHeight - 4)
    if (x > maxX) x = maxX
    if (y > maxY) y = maxY
    if (x < minX) x = minX
    if (y < minY) y = minY

    const itemLayouts: MenuPopupLayoutItem[] = []
    let curY = y + style.padding
    for (const entry of this._items) {
      if (isContextMenuSeparator(entry)) {
        curY += separatorHeight
        continue
      }
      itemLayouts.push({
        entry,
        rect: { x: x + 2, y: curY, width: menuWidth - 4, height: itemHeight },
      })
      curY += itemHeight
    }

    return {
      pos: { x, y },
      totalHeight,
      menuWidth,
      itemHeight,
      separatorHeight,
      style,
      popupStyle,
      itemLayouts,
    }
  }

  private _itemAt(point: Offset, layout: MenuPopupLayout): MenuPopupLayoutItem | null {
    return layout.itemLayouts.find(item =>
      point.x >= item.rect.x &&
      point.x <= item.rect.x + item.rect.width &&
      point.y >= item.rect.y &&
      point.y <= item.rect.y + item.rect.height,
    ) ?? null
  }

  private _highlightItem(item: MenuPopupLayoutItem | null): void {
    const nextKey = item?.entry.key ?? ''
    let changed = nextKey !== this._hoveredKey
    if (changed) {
      this._hoveredKey = nextKey
      this._keyboardIndex = this._selectableIndexByKey(nextKey)
    }
    const branchChanged = item && hasContextSubmenu(item.entry) && !item.entry.disabled
      ? this._openChild(item.entry.key, item.entry.items)
      : this._closeChild()
    if (changed || branchChanged) PopupManager.instance.requestPaint()
  }

  private _selectableItems(): ContextMenuItem[] {
    return this._items.filter(entry => isContextMenuItem(entry) && !entry.disabled) as ContextMenuItem[]
  }

  private _selectableIndexByKey(key: string): number {
    if (!key) return -1
    return this._selectableItems().findIndex(item => item.key === key)
  }

  private _currentSelectableItem(): ContextMenuItem | null {
    const selectable = this._selectableItems()
    if (selectable.length === 0) return null
    const index = this._keyboardIndex >= 0 ? this._keyboardIndex : 0
    return selectable[Math.max(0, Math.min(index, selectable.length - 1))] ?? null
  }

  private _stepKeyboard(delta: number): void {
    const selectable = this._selectableItems()
    if (selectable.length === 0) return
    const nextIndex = this._keyboardIndex < 0
      ? (delta > 0 ? 0 : selectable.length - 1)
      : Math.max(0, Math.min(this._keyboardIndex + delta, selectable.length - 1))
    this._keyboardIndex = nextIndex
    this._hoveredKey = selectable[nextIndex]!.key
    const current = selectable[nextIndex]!
    const branchChanged = hasContextSubmenu(current) ? this._openChild(current.key, current.items) : this._closeChild()
    PopupManager.instance.requestPaint()
    if (branchChanged) PopupManager.instance.requestPaint()
  }

  private _openChild(parentKey: string, items: ContextMenuEntry[]): boolean {
    if (this._child && this._childParentKey === parentKey && this._child.visible) return false
    this._closeChild()
    const child = new MenuPopup({
      items,
      onSelect: this._onSelect,
      bounds: this._bounds,
      owner: this._owner,
      parentMenu: this,
      parentItemKey: parentKey,
      onClose: () => {
        if (this._child === child) {
          this._child = null
          this._childParentKey = ''
        }
      },
    })
    this._child = child
    this._childParentKey = parentKey
    child.open()
    return true
  }

  private _closeChild(): boolean {
    if (!this._child) return false
    const child = this._child
    this._child = null
    this._childParentKey = ''
    child.dismiss()
    return true
  }

  private _debugPathPrefix(): string[] {
    if (!this._parentMenu || !this._parentItemKey) return []
    return [...this._parentMenu._debugPathPrefix(), this._parentItemKey]
  }

  private _clearPaintedItems(): void {
    this._paintedItems = []
    this._paintSnapshot = null
  }

  private _rootMenu(): MenuPopup {
    let current: MenuPopup = this
    while (current._parentMenu) current = current._parentMenu
    return current
  }

  private _closeRootMenu(): void {
    const root = this._rootMenu()
    if (root._parent && !root._parentMenu) {
      PopupManager.instance.dismiss(root._parent)
      root._parent.close()
      return
    }
    root.close()
  }
}
