// MenuBar: 顶部菜单栏
// 顶层菜单项通过 proxy popup + MenuPopup branch 驱动，可直接打开 submenu

import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import type { BoxConstraints, LayoutContext, Offset, Rect } from '../core/render_object'
import type { ResolvedTheme } from '../theme/theme'
import { RenderObject } from '../core/render_object'
import { TextMeasurer } from '../core/text_measurer'
import type { PointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import { PopupManager, popupViewportRect, type Popup, type PopupContext } from '../core/popup_manager'
import {
  deriveMenuBarStyle,
  resolveBgColor,
  resolveTextColor,
  type MenuBarStyleTokens,
} from '../theme/component_styles'
import type { ContextMenuEntry } from './context_menu'
import { MenuPopup } from './menu_popup'
import { RenderWindow } from './window'
import { FocusableControl, paintFocusRing, type ControlInteractionSnapshot } from './focusable_control'

export interface MenuBarItem {
  key: string
  label: string
  items: ContextMenuEntry[]
  disabled?: boolean
}

export class RenderMenuBar extends FocusableControl implements InteractiveRenderObject {
  static override debugTypeName = 'RenderMenuBar'
  items: MenuBarItem[]

  private _disabled = false
  private _hoveredKey = ''
  private _keyboardKey = ''
  private _openKey = ''
  private _popupProxy: Popup | null = null
  private _rootPopup: MenuPopup | null = null
  private _onSelect?: (menuKey: string, itemKey: string) => void

  constructor(opts: {
    items: MenuBarItem[]
    disabled?: boolean
    onSelect?: (menuKey: string, itemKey: string) => void
  }) {
    super({ disabled: opts.disabled ?? false })
    this.items = opts.items
    this._disabled = opts.disabled ?? false
    this._onSelect = opts.onSelect
  }

  get disabled(): boolean { return this._disabled }
  set disabled(value: boolean) {
    if (this._disabled === value) return
    this._disabled = value
    this.setDisabledState(value)
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = this._menuTokens(context.theme)
    this.size = {
      width: constraints.maxWidth === Infinity ? 800 : constraints.maxWidth,
      height: style.height,
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const { x, y } = offset
    const { width: w, height: h } = this.size
    const s = this._menuTokens(context.theme)

    dl.fillRect(x, y, w, h, s.barBg, 0)
    dl.line(x, y + h, x + w, y + h, s.separator, 1)

    const rects = this._itemRects(s)
    for (const r of rects) {
      const menuItem = this.items.find(item => item.key === r.key)!
      const itemDisabled = this.isDisabled || !!menuItem.disabled
      const isOpen = r.key === this._openKey
      const isHovered = !itemDisabled && r.key === this._hoveredKey
      const isKeyboardKey = !itemDisabled && this.isFocused && r.key === this._keyboardKey
      const localX = r.x - this.globalOffset.x + x
      const state = {
        disabled: itemDisabled,
        selected: isOpen,
        hovered: isHovered,
        focused: isKeyboardKey,
      }
      const bg = resolveBgColor(s.itemBg, state)
      if (bg.a > 0) dl.fillRect(localX, y, r.w, h, bg, s.itemRadius)
      if (this.isFocused && !itemDisabled && (isOpen || isKeyboardKey)) {
        paintFocusRing(dl, context.theme.focusBorder, localX, y, r.w, h, s.itemRadius)
      }
      dl.fillText(menuItem.label, localX + r.w / 2, y + h / 2,
        resolveTextColor(s.itemText, state), s.fontSize, s.fontFamily, 'center', 'middle')
    }
  }

  paintDropdown(context: PaintContext): void {
    this._rootPopup?.paint(context)
  }

  onPointerDown(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    if (this.isDisabled || !this.hitTest(e.position)) return
    this.requestFocus()
    const key = this._keyAt(e.position)
    if (!key) return
    if (!this._isEnabledKey(key)) {
      if (this._openKey) this._dismissDropdown()
      return
    }
    if (key === this._openKey) this._dismissDropdown()
    else this._openDropdown(key)
    this._keyboardKey = key
    this.markNeedsPaint()
  }

  onPointerMove(e: PointerEvent): void {
    if (this.isDisabled) return
    const hitKey = this._keyAt(e.position)
    const key = this._isEnabledKey(hitKey) ? hitKey : ''
    if (key !== this._hoveredKey) {
      this._hoveredKey = key
      if (key) this._keyboardKey = key
      this.markNeedsPaint()
    }
  }

  onPointerUp(_e: PointerEvent): void {}

  onKeyDown(event: KeyboardEvent): boolean {
    const enabledItems = this._enabledItems()
    if (this.isDisabled || enabledItems.length === 0) return false
    const fallbackKey = enabledItems[0]!.key
    const currentKey = this._isEnabledKey(this._keyboardKey)
      ? this._keyboardKey
      : this._isEnabledKey(this._openKey)
        ? this._openKey
        : fallbackKey
    const currentIndex = Math.max(0, enabledItems.findIndex(item => item.key === currentKey))
    const moveToIndex = (index: number): void => {
      const nextKey = enabledItems[index]!.key
      this._keyboardKey = nextKey
      this._hoveredKey = nextKey
      if (this._openKey) this._openDropdown(nextKey)
      else this.markNeedsPaint()
    }

    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault()
        moveToIndex((currentIndex - 1 + enabledItems.length) % enabledItems.length)
        return true
      case 'ArrowRight':
        event.preventDefault()
        moveToIndex((currentIndex + 1) % enabledItems.length)
        return true
      case 'Home':
        event.preventDefault()
        moveToIndex(0)
        return true
      case 'End':
        event.preventDefault()
        moveToIndex(enabledItems.length - 1)
        return true
      case 'ArrowDown':
      case 'Enter':
      case ' ':
        event.preventDefault()
        this._openDropdown(currentKey)
        this._keyboardKey = currentKey
        return true
      case 'Escape':
        if (!this._openKey) return false
        event.preventDefault()
        this._dismissDropdown()
        return true
      default:
        return false
    }
  }

  onPointerCancel(_e: PointerEvent): void {
    this._hoveredKey = ''
    this.markNeedsPaint()
  }

  onPointerLeave(_e: PointerEvent): void {
    if (!this._hoveredKey) return
    this._hoveredKey = ''
    this.markNeedsPaint()
  }

  dispose(): void {
    this._dismissDropdown()
    super.dispose()
    this._hoveredKey = ''
    this._openKey = ''
    this._popupProxy = null
    this._rootPopup = null
    this._onSelect = undefined
  }

  private _itemRects(style: MenuBarStyleTokens = this._currentMenuTokens()): Array<{ key: string; x: number; w: number }> {
    const g = this.globalOffset
    const rects: Array<{ key: string; x: number; w: number }> = []
    let curX = g.x
    for (const item of this.items) {
      const textW = TextMeasurer.measureWidth(item.label, style.fontSize, style.fontFamily)
      const w = textW + style.padding * 2
      rects.push({ key: item.key, x: curX, w })
      curX += w
    }
    return rects
  }

  private _keyAt(point: Offset): string {
    const g = this.globalOffset
    const h = this.size.height
    if (point.y < g.y || point.y > g.y + h) return ''
    for (const rect of this._itemRects()) {
      if (point.x >= rect.x && point.x <= rect.x + rect.w) return rect.key
    }
    return ''
  }

  private _barHitTest(point: Offset): boolean {
    const g = this.globalOffset
    return point.x >= g.x && point.x <= g.x + this.size.width &&
           point.y >= g.y && point.y <= g.y + this.size.height
  }

  private _dismissDropdown(): void {
    const proxy = this._popupProxy
    const rootPopup = this._rootPopup

    if (proxy) {
      PopupManager.instance.dismiss(proxy)
      proxy.close()
    } else if (rootPopup) {
      rootPopup.dismiss()
    }

    this._clearDropdownState()
    this._hoveredKey = ''
    this.markNeedsPaint()
  }

  private _clearDropdownState(popup?: Popup): void {
    if (!popup || this._popupProxy === popup) {
      this._popupProxy = null
      this._rootPopup = null
      this._openKey = ''
    }
  }

  private _openDropdown(key: string): void {
    const menuItem = this.items.find(item => item.key === key)
    if (!menuItem || menuItem.disabled) return

    this._dismissDropdown()

    const proxy: Popup = {
      hitTest: point => this._barHitTest(point),
      close: () => {
        this._clearDropdownState(proxy)
        this.markNeedsPaint()
      },
      onPointerDown: event => {
        if (!isPrimaryPointerButton(event)) return
        const hitKey = this._keyAt(event.position)
        if (!hitKey) {
          this._dismissDropdown()
          return
        }
        if (!this._isEnabledKey(hitKey)) {
          this._dismissDropdown()
          return
        }
        if (hitKey === this._openKey) this._dismissDropdown()
        else this._openDropdown(hitKey)
        this.markNeedsPaint()
      },
      onPointerMove: event => {
        const hitKey = this._keyAt(event.position)
        if (this._isEnabledKey(hitKey) && hitKey !== this._openKey) this._openDropdown(hitKey)
        if (hitKey && !this._isEnabledKey(hitKey)) return
        if (hitKey !== this._hoveredKey) {
          this._hoveredKey = hitKey
          this.markNeedsPaint()
        }
      },
    }

    PopupManager.instance.open(proxy, { owner: this })

    this._openKey = key
    this._keyboardKey = key
    this._popupProxy = proxy

    const rootPopup = new MenuPopup({
      items: menuItem.items,
      owner: this,
      parent: proxy,
      position: (_popupContext: PopupContext) => {
        const rect = this._itemRects().find(candidate => candidate.key === key)
        const g = this.globalOffset
        return rect ? { x: rect.x, y: g.y + this.size.height } : { x: g.x, y: g.y + this.size.height }
      },
      bounds: (_popupContext: PopupContext) => this._dropdownBounds(),
      onSelect: itemKey => {
        try {
          this._onSelect?.(key, itemKey)
        } finally {
          this._dismissDropdown()
          this.markNeedsPaint()
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

  protected override onFocusChanged(focused: boolean): void {
    if (focused) {
      this._keyboardKey = this._isEnabledKey(this._openKey)
        ? this._openKey
        : this._isEnabledKey(this._hoveredKey)
          ? this._hoveredKey
          : (this._enabledItems()[0]?.key ?? '')
    } else {
      this._keyboardKey = ''
    }
  }

  protected override onDisabledStateChanged(disabled: boolean, _previous: ControlInteractionSnapshot): void {
    if (!disabled) return
    this._dismissDropdown()
    this._hoveredKey = ''
    this._keyboardKey = ''
  }

  private _dropdownBounds(): Rect {
    let current: RenderObject | undefined = this.parent
    while (current) {
      if (current instanceof RenderWindow) {
        const g = current.globalOffset
        return {
          x: g.x,
          y: g.y,
          width: current.windowWidth,
          height: current.windowHeight,
        }
      }
      current = current.parent
    }

    const { viewport } = PopupManager.instance.context
    return popupViewportRect(viewport)
  }

  private _menuTokens(theme: ResolvedTheme): MenuBarStyleTokens {
    return deriveMenuBarStyle(theme)
  }

  private _currentMenuTokens(): MenuBarStyleTokens {
    return this._menuTokens(this.currentTheme)
  }

  private _enabledItems(): MenuBarItem[] {
    return this.items.filter(item => !item.disabled)
  }

  private _isEnabledKey(key: string): boolean {
    return !!key && this.items.some(item => item.key === key && !item.disabled)
  }
}
