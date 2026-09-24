// Tabs: 多标签页组件
// 支持标签切换、关闭按钮、焦点和键盘导航

import { DrawList } from '../rendering/draw_list'
import { TextMeasurer } from '../core/text_measurer'
import { AnimationController } from '../animation/animation_controller'
import { Curves } from '../animation/curves'
import type { PaintContext } from '../rendering/paint_context'
import type { BoxConstraints, LayoutContext, Offset, Rect } from '../core/render_object'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { DefaultThemeMotion, resolveThemeMotion } from '../theme/theme'
import { RenderObject } from '../core/render_object'
import type { PointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import { pointerKey, type PointerKey } from '../gestures/pointer_identity'
import { popupViewportRect } from '../core/popup_manager'
import type { IconName } from './icon'
import { paintIconGlyph } from './icon'
import {
  deriveTabsStyle,
  resolveBgColor,
  resolveTextColor,
} from '../theme/component_styles'
import { FocusableControl, paintFocusRing, type ControlInteractionSnapshot } from './focusable_control'
import { MenuPopup, type ContextMenuEntry } from './menu_popup'

export interface TabItem {
  key: string
  label: string
  closable?: boolean
  dirty?: boolean
  tooltip?: string
  icon?: IconName
}

export type TabContextMenuHandler = (key: string, position: Offset) => boolean | void
export type TabDragHandler = (key: string, position: Offset) => void
export type TabOverflowMode = 'menu' | 'icon-strip'

interface MeasuredTabRect {
  x: number
  w: number
  iconSize: number
  iconGap: number
  dirtySize: number
  dirtyGap: number
  closeW: number
  contentStartX: number
  compact?: boolean
}

interface VisibleTabLayout {
  rects: Array<MeasuredTabRect | undefined>
  overflowRect: MeasuredTabRect | null
  overflowTabs: TabItem[]
}

export class RenderTabs extends FocusableControl implements InteractiveRenderObject {
  static override debugTypeName = 'RenderTabs'
  readonly preservesCurrentFocusOnPointerDown = true
  tabs: TabItem[]
  onTabChange?: (key: string) => void
  onTabClose?: (key: string) => void
  onTabReorder?: (key: string, targetIndex: number) => void
  onTabContextMenu?: TabContextMenuHandler
  onTabDragStart?: TabDragHandler
  onTabDragMove?: TabDragHandler
  onTabDragEnd?: TabDragHandler
  onTabDragCancel?: TabDragHandler
  overflowMode: TabOverflowMode

  private _activeKey: string
  private _disabled: boolean
  private _hoveredTab = ''
  private _hoveredClose = ''
  private _hoveredOverflow = false
  private _pressedTab = ''
  private _pressedOverflow = false
  private _draggingTab = ''
  private _dragPointerKey?: PointerKey
  private _pointerGeneration = 0
  private _moveFrameGeneration = 0
  private _dragStartPos?: Offset
  private _dragCurrentPos?: Offset
  private _dragCurrentX = 0
  private _dragTabPointerOffsetX = 0
  private _releasePointerCapture?: () => void
  private _tabBarHeight: number
  private _underlineAnim: AnimationController
  private _underlineFrom = 0
  private _underlineTo = 0
  private _underlineFromW = 0
  private _underlineToW = 0
  private _overflowPopup: MenuPopup | null = null

  constructor(opts: {
    tabs: TabItem[]
    activeKey: string
    disabled?: boolean
    onTabChange?: (key: string) => void
    onTabClose?: (key: string) => void
    onTabReorder?: (key: string, targetIndex: number) => void
    onTabContextMenu?: TabContextMenuHandler
    onTabDragStart?: TabDragHandler
    onTabDragMove?: TabDragHandler
    onTabDragEnd?: TabDragHandler
    onTabDragCancel?: TabDragHandler
    overflowMode?: TabOverflowMode
  }) {
    super({ disabled: opts.disabled ?? false })
    this.tabs = opts.tabs
    this._activeKey = opts.activeKey
    this._disabled = opts.disabled ?? false
    this.onTabChange = opts.onTabChange
    this.onTabClose = opts.onTabClose
    this.onTabReorder = opts.onTabReorder
    this.onTabContextMenu = opts.onTabContextMenu
    this.onTabDragStart = opts.onTabDragStart
    this.onTabDragMove = opts.onTabDragMove
    this.onTabDragEnd = opts.onTabDragEnd
    this.onTabDragCancel = opts.onTabDragCancel
    this.overflowMode = opts.overflowMode ?? 'menu'
    this._tabBarHeight = deriveTabsStyle(ImGuiDarkTheme).height

    this._underlineAnim = new AnimationController({ duration: DefaultThemeMotion.normalDuration, curve: Curves.easeInOut })
    this._underlineAnim.addListener(() => this.markNeedsPaint())
  }

  get activeKey(): string { return this._activeKey }
  set activeKey(value: string) {
    if (value === this._activeKey) return
    this._syncUnderline(value, true)
    this._activeKey = value
    this.markNeedsPaint()
  }

  get disabled(): boolean { return this._disabled }
  set disabled(value: boolean) {
    if (this._disabled === value) return
    this._disabled = value
    this.setDisabledState(value)
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const s = deriveTabsStyle(context.theme)
    this._tabBarHeight = s.height
    this.size = {
      width: constraints.maxWidth === Infinity ? 400 : constraints.maxWidth,
      height: this._tabBarHeight,
    }
    if (this._activeKey) this._syncUnderline(this._activeKey, false)
  }

  private _tabRects(s: ReturnType<typeof deriveTabsStyle>): MeasuredTabRect[] {
    const rects: MeasuredTabRect[] = []
    let x = s.stripStartInset
    for (const tab of this.tabs) {
      const textW = TextMeasurer.measureWidth(tab.label, s.fontSize, s.fontFamily)
      const iconSize = tab.icon ? s.fontSize : 0
      const iconGap = tab.icon ? Math.max(4, Math.round(s.itemSpacing * 0.5)) : 0
      const dirtySize = tab.dirty ? Math.max(6, Math.round(s.fontSize * 0.4)) : 0
      const dirtyGap = tab.dirty ? Math.max(4, Math.round(s.itemSpacing * 0.5)) : 0
      const closeW = tab.closable ? s.closeButtonSize : 0
      const w = textW +
        s.padding * 2 +
        iconSize +
        iconGap +
        dirtySize +
        dirtyGap +
        closeW +
        (tab.closable ? s.itemSpacing : 0)
      rects.push({
        x,
        w,
        iconSize,
        iconGap,
        dirtySize,
        dirtyGap,
        closeW,
        contentStartX: s.padding,
      })
      x += w
    }
    return rects
  }

  private _overflowButtonWidth(s: ReturnType<typeof deriveTabsStyle>): number {
    return Math.max(30, s.closeButtonSize + s.padding * 2)
  }

  private _visibleTabLayout(s: ReturnType<typeof deriveTabsStyle>, activeKey = this.activeKey): VisibleTabLayout {
    const natural = this._tabRects(s)
    const activeIndex = this.tabs.findIndex(tab => tab.key === activeKey)
    const allWidth = natural.length === 0
      ? s.stripStartInset
      : natural[natural.length - 1]!.x + natural[natural.length - 1]!.w
    if (allWidth <= this.size.width) {
      return {
        rects: natural,
        overflowRect: null,
        overflowTabs: [],
      }
    }

    if (this.overflowMode === 'icon-strip') {
      const available = Math.max(0, this.size.width - s.stripStartInset)
      const inactiveCompactWidth = this.tabs.length > 0
        ? Math.max(0, Math.min(Math.max(26, s.fontSize + 12), Math.floor(available / this.tabs.length)))
        : 0
      const activeAvailable = Math.max(0, available - inactiveCompactWidth * Math.max(0, this.tabs.length - 1))
      const activeNaturalWidth = activeIndex >= 0 ? natural[activeIndex]!.w : 0
      const keepActiveReadable = activeIndex >= 0 && activeAvailable >= Math.max(64, s.fontSize * 5)
      const compactWidth = keepActiveReadable
        ? inactiveCompactWidth
        : this.tabs.length > 0 ? Math.max(0, Math.floor(available / this.tabs.length)) : 0
      const iconSize = Math.min(s.fontSize, Math.max(10, compactWidth - 8))
      const rects: Array<MeasuredTabRect | undefined> = []
      let cursor = s.stripStartInset
      for (let i = 0; i < this.tabs.length; i++) {
        if (keepActiveReadable && i === activeIndex) {
          const width = Math.min(activeNaturalWidth, activeAvailable)
          rects[i] = {
            ...natural[i]!,
            x: cursor,
            w: width,
          }
          cursor += width
          continue
        }
        const width = keepActiveReadable
          ? compactWidth
          : i === this.tabs.length - 1 ? Math.max(0, this.size.width - cursor) : compactWidth
        rects[i] = {
          ...natural[i]!,
          x: cursor,
          w: width,
          iconSize,
          iconGap: 0,
          dirtySize: this.tabs[i]!.dirty ? Math.max(5, Math.round(s.fontSize * 0.36)) : 0,
          dirtyGap: 0,
          closeW: 0,
          contentStartX: Math.max(0, Math.round((width - iconSize) / 2)),
          compact: true,
        }
        cursor += width
      }
      return {
        rects,
        overflowRect: null,
        overflowTabs: [],
      }
    }

    const overflowWidth = this._overflowButtonWidth(s)
    const limit = Math.max(s.stripStartInset, this.size.width - overflowWidth)
    const visibleIndexes = new Set<number>()
    const visibleWidths = new Map<number, number>()
    let cursor = s.stripStartInset

    const canAppend = (index: number): boolean => cursor + natural[index]!.w <= limit
    const append = (index: number, width = natural[index]!.w): void => {
      visibleIndexes.add(index)
      visibleWidths.set(index, width)
      cursor += width
    }

    for (let i = 0; i < this.tabs.length; i++) {
      if (i === activeIndex) {
        while (!canAppend(i) && visibleIndexes.size > 0) {
          const last = Math.max(...visibleIndexes)
          visibleIndexes.delete(last)
          cursor -= natural[last]!.w
        }
        if (canAppend(i)) append(i)
        else if (visibleIndexes.size === 0) append(i, Math.max(0, limit - cursor))
        continue
      }
      if (canAppend(i)) append(i)
    }

    const rects: Array<MeasuredTabRect | undefined> = new Array(this.tabs.length)
    cursor = s.stripStartInset
    for (let i = 0; i < this.tabs.length; i++) {
      if (!visibleIndexes.has(i)) continue
      const width = visibleWidths.get(i) ?? natural[i]!.w
      rects[i] = { ...natural[i]!, x: cursor, w: width }
      cursor += width
    }

    return {
      rects,
      overflowRect: {
        x: this.size.width - overflowWidth,
        w: overflowWidth,
        iconSize: s.fontSize,
        iconGap: 0,
        dirtySize: 0,
        dirtyGap: 0,
        closeW: 0,
        contentStartX: Math.max(0, Math.round((overflowWidth - s.fontSize) / 2)),
      },
      overflowTabs: this.tabs.filter((_tab, index) => !visibleIndexes.has(index)),
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    this._underlineAnim.duration = resolveThemeMotion(context.theme).normalDuration
    const s = deriveTabsStyle(context.theme)
    const dl = new DrawList(context)
    const { x, y } = offset
    const { width: w, height: h } = this.size
    const layout = this._visibleTabLayout(s)
    const rects = layout.rects
    const activeIdx = this.tabs.findIndex(tab => tab.key === this.activeKey)
    const tabY = y + s.tabTopInset
    const tabH = Math.max(0, h - s.tabTopInset)
    const inactiveTabH = Math.max(0, tabH - 1)

    dl.fillRect(x, y, w, h, s.barBg, 0)

    const paintTab = (i: number): void => {
      const tab = this.tabs[i]!
      const rect = rects[i]
      if (!rect) return
      const tabX = x + rect.x
      const isActive = tab.key === this.activeKey
      const isHovered = !this.isDisabled && tab.key === this._hoveredTab
      const state = {
        disabled: this.isDisabled,
        selected: isActive,
        hovered: isHovered,
        pressed: !this.isDisabled && tab.key === this._pressedTab,
        focused: !this.isDisabled && this.isFocused && isActive,
      }
      const tabBg = resolveBgColor(s.tabBg, state)
      const paintHeight = isActive ? tabH : inactiveTabH

      if (tabBg.a > 0 && paintHeight > 0) {
        dl.fillTopRoundedRect(tabX, tabY, rect.w, paintHeight, tabBg, s.tabRadius)
      }
      if (isActive && s.indicatorHeight > 0) {
        dl.fillRect(tabX, tabY, rect.w, s.indicatorHeight, s.indicatorBg, 0)
      }
      if (this.isFocused && isActive && !this.isDisabled) {
        paintFocusRing(dl, context.theme.focusBorder, tabX + 1, tabY + 1, rect.w - 2, tabH - 2, s.tabRadius)
      }
      let contentX = tabX + rect.contentStartX
      const contentY = tabY + paintHeight / 2
      if (tab.dirty) {
        const dotX = contentX + rect.dirtySize / 2
        dl.fillCircle(dotX, contentY, rect.dirtySize / 2, s.indicatorBg)
        contentX += rect.dirtySize + rect.dirtyGap
      }
      if (rect.compact) {
        if (tab.icon) {
          paintIconGlyph(context, {
            name: tab.icon,
            x: contentX,
            y: contentY - rect.iconSize / 2,
            size: rect.iconSize,
            color: resolveTextColor(s.tabText, state),
          })
        } else {
          const fallback = tab.label.trim().slice(0, 2)
          dl.fillText(
            fallback,
            tabX + rect.w / 2,
            contentY,
            resolveTextColor(s.tabText, state),
            Math.max(10, s.fontSize - 1),
            s.fontFamily,
            'center',
            'middle',
          )
        }
      } else if (tab.icon) {
        paintIconGlyph(context, {
          name: tab.icon,
          x: contentX,
          y: contentY - rect.iconSize / 2,
          size: rect.iconSize,
          color: resolveTextColor(s.tabText, state),
        })
        contentX += rect.iconSize + rect.iconGap
      }
      const closeVisible = !rect.compact && tab.closable === true && this._isCloseVisible(tab.key)
      const textClipRight = tabX + rect.w - (tab.closable ? rect.closeW + s.itemSpacing : s.padding)
      const textClipW = Math.max(0, textClipRight - contentX)
      if (!rect.compact && textClipW > 0) {
        dl.pushClip(contentX, tabY, textClipW, paintHeight)
        dl.fillText(
          tab.label,
          contentX,
          contentY,
          resolveTextColor(s.tabText, state),
          s.fontSize,
          s.fontFamily,
          'left',
          'middle',
        )
        dl.popClip()
      }

      if (closeVisible && rect.w >= rect.closeW) {
        const closeX = tabX + rect.w - rect.closeW
        const isCloseHovered = !this.isDisabled && tab.key === this._hoveredClose
        const closeState = this.isDisabled ? 'disabled' : isCloseHovered ? 'hovered' : 'normal'
        const closeBg = resolveBgColor(s.closeBg, closeState)
        if (closeBg.a > 0) {
          dl.fillCircle(closeX + s.fontSize / 2, contentY, s.fontSize / 2 + 2, closeBg)
        }
        const closeColor = resolveTextColor(s.closeText, closeState)
        const cx = closeX + s.fontSize / 2
        const cy = contentY
        const r = s.fontSize * 0.3
        dl.line(cx - r, cy - r, cx + r, cy + r, closeColor, 1.5)
        dl.line(cx + r, cy - r, cx - r, cy + r, closeColor, 1.5)
      }
    }

    for (let i = 0; i < this.tabs.length; i++) {
      if (i === activeIdx) continue
      if (!rects[i]) continue
      paintTab(i)
      if (i < this.tabs.length - 1 && i + 1 !== activeIdx && rects[i + 1]) {
        const rect = rects[i]!
        dl.line(x + rect.x + rect.w, tabY + 5, x + rect.x + rect.w, y + h - 5, s.separator, 1)
      }
    }
    if (activeIdx >= 0) paintTab(activeIdx)

    if (this._draggingTab && this._dragCurrentPos && this.hitTest(this._dragCurrentPos)) {
      const targetIndex = this._reorderIndexAtX(this._dragCurrentX, this._draggingTab)
      const insertionX = this._insertionXForIndex(targetIndex, this._draggingTab, rects, s)
      if (insertionX !== null) {
        dl.fillRect(x + insertionX - 1, tabY + 4, 2, Math.max(0, tabH - 8), s.indicatorBg, 0)
      }
      this._paintDragGhost(context, dl, offset, s, rects)
    }

    if (layout.overflowRect) {
      const rect = layout.overflowRect
      const tabX = x + rect.x
      const isSelected = this._overflowPopup?.visible === true
      const state = {
        disabled: this.isDisabled,
        selected: isSelected,
        hovered: !this.isDisabled && this._hoveredOverflow,
        pressed: !this.isDisabled && this._pressedOverflow,
      }
      const bg = resolveBgColor(s.tabBg, state)
      if (bg.a > 0) dl.fillTopRoundedRect(tabX, tabY, rect.w, tabH, bg, s.tabRadius)
      paintIconGlyph(context, {
        name: 'chevron-down',
        x: tabX + rect.contentStartX,
        y: tabY + (tabH - rect.iconSize) / 2,
        size: rect.iconSize,
        color: resolveTextColor(s.tabText, state),
      })
    }

    dl.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1), s.separator, 1, 0)
  }

  private _activateTab(key: string): void {
    if (!key || key === this.activeKey) return
    this.activeKey = key
    this.onTabChange?.(key)
    this.markNeedsPaint()
  }

  private _syncUnderline(nextKey: string, animate: boolean): void {
    const s = deriveTabsStyle(this.currentTheme)
    const oldRects = this._visibleTabLayout(s, this._activeKey).rects
    const nextRects = this._visibleTabLayout(s, nextKey).rects
    const oldIdx = this.tabs.findIndex(tab => tab.key === this._activeKey)
    const nextIdx = this.tabs.findIndex(tab => tab.key === nextKey)
    const oldRect = oldIdx >= 0 ? oldRects[oldIdx] : undefined
    const nextRect = nextIdx >= 0 ? nextRects[nextIdx] : undefined
    if (!nextRect) return
    const canAnimate = typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function'
    if (animate && oldRect && canAnimate) {
      if (sameUnderlineRect(oldRect, nextRect)) {
        this._syncUnderline(nextKey, false)
        return
      }
      this._underlineFrom = oldRect.x
      this._underlineFromW = oldRect.w
      this._underlineTo = nextRect.x
      this._underlineToW = nextRect.w
      this._underlineAnim.stop()
      this._underlineAnim.resetValue(0)
      this._underlineAnim.forward()
      return
    }
    if (!this._underlineAnim.isAnimating &&
      this._underlineAnim.value === 1 &&
      sameUnderlineGeometry(this._underlineFrom, this._underlineFromW, this._underlineTo, this._underlineToW, nextRect)) {
      return
    }
    this._underlineAnim.stop()
    this._underlineFrom = nextRect.x
    this._underlineFromW = nextRect.w
    this._underlineTo = nextRect.x
    this._underlineToW = nextRect.w
    this._underlineAnim.resetValue(1)
  }

  private _tabAtX(globalX: number): string {
    const g = this.globalOffset
    const s = deriveTabsStyle(this.currentTheme)
    const rects = this._visibleTabLayout(s).rects
    const localX = globalX - g.x
    for (let i = 0; i < this.tabs.length; i++) {
      const rect = rects[i]
      if (!rect) continue
      if (localX >= rect.x && localX < rect.x + rect.w) return this.tabs[i]!.key
    }
    return ''
  }

  private _tabRectForKey(key: string): MeasuredTabRect | undefined {
    const index = this.tabs.findIndex(tab => tab.key === key)
    if (index < 0) return undefined
    return this._visibleTabLayout(deriveTabsStyle(this.currentTheme)).rects[index]
  }

  tabRect(key: string): Rect | undefined {
    const rect = this._tabRectForKey(key)
    if (!rect) return undefined
    const offset = this.globalOffset
    return { x: offset.x + rect.x, y: offset.y, width: rect.w, height: this.size.height }
  }

  private _overflowAtX(globalX: number): boolean {
    const g = this.globalOffset
    const s = deriveTabsStyle(this.currentTheme)
    const rect = this._visibleTabLayout(s).overflowRect
    if (!rect) return false
    const localX = globalX - g.x
    return localX >= rect.x && localX < rect.x + rect.w
  }

  private _isCloseVisible(tabKey: string, hoveredKey = this._hoveredTab): boolean {
    return tabKey === this.activeKey || tabKey === hoveredKey || tabKey === this._hoveredClose
  }

  private _closeAtX(globalX: number, hoveredKey = this._hoveredTab): string {
    const g = this.globalOffset
    const s = deriveTabsStyle(this.currentTheme)
    const rects = this._visibleTabLayout(s).rects
    const localX = globalX - g.x
    for (let i = 0; i < this.tabs.length; i++) {
      const tab = this.tabs[i]!
      if (!tab.closable) continue
      if (!this._isCloseVisible(tab.key, hoveredKey)) continue
      const rect = rects[i]
      if (!rect || rect.compact || rect.closeW <= 0) continue
      const closeW = rect.closeW
      if (rect.w < closeW) continue
      const closeX = rect.x + rect.w - closeW
      if (localX >= closeX && localX < rect.x + rect.w) return tab.key
    }
    return ''
  }

  onPointerDown(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    if (this.isDisabled || !this.hitTest(e.position)) return
    if (this._dragPointerKey && this._dragPointerKey !== pointerKey(e)) {
      e.preventActivation?.()
      return
    }
    const pressedTabKey = this._tabAtX(e.position.x)
    const closeKey = this._closeAtX(e.position.x)
    if (closeKey) {
      this.onTabClose?.(closeKey)
      return
    }
    if (this._overflowAtX(e.position.x)) {
      this._pressedOverflow = true
      this._dragPointerKey = pointerKey(e)
      this._pointerGeneration++
      this._openOverflowMenu()
      this.markNeedsPaint()
      return
    }
    const key = pressedTabKey
    if (!key) return
    this._pressedTab = key
    this._dragPointerKey = pointerKey(e)
    this._pointerGeneration++
    this._dragStartPos = { ...e.position }
    this._dragCurrentPos = { ...e.position }
    this._dragCurrentX = e.position.x
    const rect = this._tabRectForKey(key)
    const localX = e.position.x - this.globalOffset.x
    this._dragTabPointerOffsetX = rect ? localX - rect.x : 0
    e.setPointerCapture?.()
    this._releasePointerCapture = e.releasePointerCapture
    this._activateTab(key)
  }

  onContextMenu(position: Offset): boolean {
    if (this.isDisabled || !this.hitTest(position)) return false
    const key = this._tabAtX(position.x)
    if (!key) return false
    if (!this.onTabContextMenu) return false
    const handled = this.onTabContextMenu(key, position)
    if (handled === false) return false
    this.requestFocus()
    this._hoveredTab = key
    this._hoveredClose = ''
    this.tooltip = this.tabs.find(tab => tab.key === key)?.tooltip
    this.markNeedsPaint()
    return true
  }

  onPointerMove(e: PointerEvent): void {
    if (this.isDisabled) return
    if (this._dragPointerKey && this._dragPointerKey !== pointerKey(e)) return
    if (this._dragPointerKey === pointerKey(e) && this._pressedTab) {
      const ownerKey = this._dragPointerKey
      const generation = this._pointerGeneration
      const moveFrameGeneration = ++this._moveFrameGeneration
      const isMoveFrameCurrent = (): boolean =>
        this._isPointerFrameCurrent(ownerKey, generation) &&
        this._moveFrameGeneration === moveFrameGeneration
      this._dragCurrentX = e.position.x
      this._dragCurrentPos = { ...e.position }
      try {
        if (!this._draggingTab && this._dragStartPos) {
          const dx = e.position.x - this._dragStartPos.x
          const dy = e.position.y - this._dragStartPos.y
          if (Math.sqrt(dx * dx + dy * dy) >= 4) {
            this._draggingTab = this._pressedTab
            this.onTabDragStart?.(this._draggingTab, e.position)
            if (!isMoveFrameCurrent()) return
            this.markNeedsPaint()
          }
        }
        if (this._draggingTab) {
          this.onTabDragMove?.(this._draggingTab, e.position)
          if (!isMoveFrameCurrent()) return
          this.markNeedsPaint()
        }
      } catch (error) {
        if (isMoveFrameCurrent()) {
          try {
            this._clearPointerInteraction()
          } catch {
            // Keep the initiating callback failure.
          }
        }
        throw error
      }
    }
    if (!this.hitTest(e.position)) {
      if (this._hoveredTab || this._hoveredClose || this._hoveredOverflow) {
        this._hoveredTab = ''
        this._hoveredClose = ''
        this._hoveredOverflow = false
        this.tooltip = undefined
        this.markNeedsPaint()
      }
      return
    }
    const tabKey = this._tabAtX(e.position.x)
    const closeKey = this._closeAtX(e.position.x, tabKey)
    const overflow = !closeKey && !tabKey && this._overflowAtX(e.position.x)
    const changed = closeKey !== this._hoveredClose || tabKey !== this._hoveredTab || overflow !== this._hoveredOverflow
    this._hoveredClose = closeKey
    this._hoveredTab = tabKey
    this._hoveredOverflow = overflow
    this.tooltip = this.tabs.find(tab => tab.key === (closeKey || tabKey))?.tooltip
    if (changed) this.markNeedsPaint()
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.isDisabled || this.tabs.length === 0) return false
    const currentIndex = Math.max(0, this.tabs.findIndex(tab => tab.key === this.activeKey))
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        this._activateTab(this.tabs[(currentIndex - 1 + this.tabs.length) % this.tabs.length]!.key)
        return true
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        this._activateTab(this.tabs[(currentIndex + 1) % this.tabs.length]!.key)
        return true
      case 'Home':
        event.preventDefault()
        this._activateTab(this.tabs[0]!.key)
        return true
      case 'End':
        event.preventDefault()
        this._activateTab(this.tabs[this.tabs.length - 1]!.key)
        return true
      case 'Delete':
      case 'Backspace': {
        const active = this.tabs.find(tab => tab.key === this.activeKey)
        if (!active?.closable) return false
        event.preventDefault()
        this.onTabClose?.(active.key)
        return true
      }
      default:
        return false
    }
  }

  onPointerUp(e: PointerEvent): void {
    if (!isPrimaryPointerButton(e)) return
    if (this._dragPointerKey && this._dragPointerKey !== pointerKey(e)) return
    const ownsPointer = this._dragPointerKey === pointerKey(e)
    const draggingTab = ownsPointer ? this._draggingTab : ''
    const targetIndex = draggingTab
      ? this._reorderIndexAtX(this._dragCurrentX, draggingTab)
      : -1
    const currentIndex = draggingTab
      ? this.tabs.findIndex(tab => tab.key === draggingTab)
      : -1
    let firstError: unknown
    const attempt = (callback: () => void): void => {
      try {
        callback()
      } catch (error) {
        firstError ??= error
      }
    }
    attempt(() => this._clearPointerInteraction())
    if (ownsPointer && !draggingTab) attempt(() => { this.requestFocus() })
    if (draggingTab) {
      if (targetIndex >= 0 && targetIndex !== currentIndex) {
        attempt(() => this.onTabReorder?.(draggingTab, targetIndex))
      }
      attempt(() => this.onTabDragEnd?.(draggingTab, e.position))
    }
    if (firstError !== undefined) throw firstError
  }

  onPointerCancel(e: PointerEvent): void {
    if (this._dragPointerKey && this._dragPointerKey !== pointerKey(e)) return
    const draggingTab = this._dragPointerKey === pointerKey(e)
      ? this._draggingTab
      : ''
    let firstError: unknown
    const attempt = (callback: () => void): void => {
      try {
        callback()
      } catch (error) {
        firstError ??= error
      }
    }
    attempt(() => this._clearPointerInteraction())
    const hadState = !!this._hoveredTab || !!this._hoveredClose || this._hoveredOverflow
    this._hoveredTab = ''
    this._hoveredClose = ''
    this._hoveredOverflow = false
    this.tooltip = undefined
    if (hadState) attempt(() => this.markNeedsPaint())
    if (draggingTab) {
      attempt(() => this.onTabDragCancel?.(draggingTab, e.position))
    }
    if (firstError !== undefined) throw firstError
  }

  protected override onDisabledStateChanged(disabled: boolean, _previous: ControlInteractionSnapshot): void {
    if (!disabled) return
    const draggingTab = this._draggingTab
    const dragCurrentPos = this._dragCurrentPos
    let firstError: unknown
    const attempt = (callback: () => void): void => {
      try {
        callback()
      } catch (error) {
        firstError ??= error
      }
    }
    attempt(() => this._clearPointerInteraction())
    attempt(() => this._dismissOverflowMenu())
    const hadHover = !!this._hoveredTab || !!this._hoveredClose || this._hoveredOverflow
    this._hoveredTab = ''
    this._hoveredClose = ''
    this._hoveredOverflow = false
    this.tooltip = undefined
    if (hadHover) attempt(() => this.markNeedsPaint())
    if (draggingTab && dragCurrentPos) {
      attempt(() => this.onTabDragCancel?.(draggingTab, dragCurrentPos))
    }
    if (firstError !== undefined) throw firstError
  }

  onPointerLeave(_e: PointerEvent): void {
    if (this._dragPointerKey !== undefined) return
    const hadState = !!this._hoveredTab || !!this._hoveredClose || this._hoveredOverflow
    this._hoveredTab = ''
    this._hoveredClose = ''
    this._hoveredOverflow = false
    this.tooltip = undefined
    if (hadState) this.markNeedsPaint()
  }

  private _reorderIndexAtX(globalX: number, dragKey: string): number {
    if (!this.tabs.some(tab => tab.key === dragKey)) return -1
    const g = this.globalOffset
    const rects = this._visibleTabLayout(deriveTabsStyle(this.currentTheme)).rects
    const localX = globalX - g.x
    let insertionIndex = 0
    for (let i = 0; i < this.tabs.length; i++) {
      const tab = this.tabs[i]!
      if (tab.key === dragKey) continue
      const rect = rects[i]
      if (!rect) continue
      if (localX < rect.x + rect.w / 2) return insertionIndex
      insertionIndex += 1
    }
    return insertionIndex
  }

  private _insertionXForIndex(
    insertionIndex: number,
    dragKey: string,
    rects: Array<MeasuredTabRect | undefined>,
    s: ReturnType<typeof deriveTabsStyle>,
  ): number | null {
    if (insertionIndex < 0) return null
    let visibleIndex = 0
    let lastRight = s.stripStartInset
    for (let i = 0; i < this.tabs.length; i++) {
      const tab = this.tabs[i]!
      if (tab.key === dragKey) continue
      const rect = rects[i]
      if (!rect) continue
      if (visibleIndex === insertionIndex) return rect.x
      visibleIndex += 1
      lastRight = rect.x + rect.w
    }
    return visibleIndex === insertionIndex ? lastRight : null
  }

  private _paintDragGhost(
    context: PaintContext,
    dl: DrawList,
    offset: Offset,
    s: ReturnType<typeof deriveTabsStyle>,
    rects: Array<MeasuredTabRect | undefined>,
  ): void {
    const dragIndex = this.tabs.findIndex(tab => tab.key === this._draggingTab)
    if (dragIndex < 0) return
    const tab = this.tabs[dragIndex]!
    const rect = rects[dragIndex]
    if (!rect) return
    const { x, y } = offset
    const tabY = y + s.tabTopInset
    const tabH = Math.max(0, this.size.height - s.tabTopInset)
    const localX = this._dragCurrentX - this.globalOffset.x
    const ghostX = x + Math.max(s.stripStartInset, Math.min(this.size.width - rect.w, localX - this._dragTabPointerOffsetX))
    dl.fillTopRoundedRect(ghostX, tabY + 2, rect.w, Math.max(0, tabH - 4), { ...s.activeTabBg, a: Math.min(0.92, s.activeTabBg.a) }, s.tabRadius)
    dl.strokeRect(ghostX, tabY + 2, rect.w, Math.max(0, tabH - 4), { ...s.indicatorBg, a: 0.8 }, 1, s.tabRadius)
    const textX = ghostX + rect.contentStartX
    const textY = tabY + tabH / 2
    const textClipW = Math.max(0, rect.w - rect.contentStartX - s.padding)
    if (textClipW <= 0) return
    dl.pushClip(textX, tabY + 2, textClipW, Math.max(0, tabH - 4))
    dl.fillText(tab.label, textX, textY, resolveTextColor(s.tabText, 'selected'), s.fontSize, s.fontFamily, 'left', 'middle')
    dl.popClip()
  }

  private _resetPointerState(): void {
    this._pointerGeneration++
    const hadDrag = !!this._pressedTab || !!this._draggingTab || this._pressedOverflow
    this._pressedTab = ''
    this._pressedOverflow = false
    this._draggingTab = ''
    this._dragPointerKey = undefined
    this._dragStartPos = undefined
    this._dragCurrentPos = undefined
    this._dragCurrentX = 0
    this._dragTabPointerOffsetX = 0
    if (hadDrag) this.markNeedsPaint()
  }

  private _openOverflowMenu(): void {
    const s = deriveTabsStyle(this.currentTheme)
    const layout = this._visibleTabLayout(s)
    if (!layout.overflowRect || layout.overflowTabs.length === 0) return
    this._dismissOverflowMenu()

    const items: ContextMenuEntry[] = layout.overflowTabs.map(tab => ({
      key: `tab:${tab.key}`,
      label: tab.label,
      icon: tab.key === this.activeKey ? 'check' : undefined,
      disabled: tab.key === this.activeKey,
    }))
    const popup = new MenuPopup({
      items,
      owner: this,
      position: () => {
        const global = this.globalOffset
        return {
          x: global.x + layout.overflowRect!.x,
          y: global.y + this.size.height,
        }
      },
      bounds: popupContext => popupViewportRect(popupContext),
      onSelect: key => {
        const tabKey = key.startsWith('tab:') ? key.slice(4) : key
        this._dismissOverflowMenu()
        this._activateTab(tabKey)
      },
      onClose: () => {
        if (this._overflowPopup === popup) {
          this._overflowPopup = null
          this._hoveredOverflow = false
          this.markNeedsPaint()
        }
      },
    })
    this._overflowPopup = popup
    popup.open()
    this.markNeedsPaint()
  }

  private _dismissOverflowMenu(): void {
    const popup = this._overflowPopup
    this._overflowPopup = null
    popup?.dismiss()
  }

  private _clearPointerInteraction(): void {
    let firstError: unknown
    const releasePointerCapture = this._releasePointerCapture
    this._releasePointerCapture = undefined
    try {
      this._resetPointerState()
    } catch (error) {
      firstError = error
    }
    try {
      releasePointerCapture?.()
    } catch (error) {
      firstError ??= error
    }
    if (firstError !== undefined) throw firstError
  }

  private _isPointerFrameCurrent(
    pointerKey: PointerKey,
    generation: number,
  ): boolean {
    return this._dragPointerKey === pointerKey &&
      this._pointerGeneration === generation
  }

  dispose(): void {
    this._dismissOverflowMenu()
    this._clearPointerInteraction()
    this._underlineAnim.dispose()
    super.dispose()
    this.onTabChange = undefined
    this.onTabClose = undefined
    this.onTabReorder = undefined
    this.onTabContextMenu = undefined
    this.onTabDragStart = undefined
    this.onTabDragMove = undefined
    this.onTabDragEnd = undefined
    this.onTabDragCancel = undefined
  }
}

function sameUnderlineRect(a: MeasuredTabRect, b: MeasuredTabRect): boolean {
  return a.x === b.x && a.w === b.w
}

function sameUnderlineGeometry(
  from: number,
  fromW: number,
  to: number,
  toW: number,
  rect: MeasuredTabRect,
): boolean {
  return from === rect.x && fromW === rect.w && to === rect.x && toW === rect.w
}
