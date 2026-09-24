import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../core/render_object'
import { RenderBox, type RenderBoxOptions } from '../layout/render_box'
import { RenderStackPanel } from '../layout/render_flex'
import type { PaintContext } from '../rendering/paint_context'
import { TextMeasurer } from '../core/text_measurer'
import { colorToCSS, type Color, type ResolvedTheme } from '../theme/theme'
import { resolveContrastText } from '../theme/component_styles'
import { RenderButton } from './button'
import { RenderScrollViewer } from './scroll_view'
import { RenderTextArea } from './text_area'
import { HitTestResult, isPrimaryPointerButton } from '../gestures/hit_test'
import type { InteractiveRenderObject, PointerEvent, WheelPointerEvent } from '../gestures/recognizers'

export type ReviewSidebarItemType = 'comment' | 'track'

export interface ReviewSidebarAction {
  key: string
  label: string
  disabled?: boolean
  variant?: 'default' | 'primary' | 'danger' | 'text' | 'link'
  onClick?: () => void
}

export interface ReviewSidebarAuditRecord {
  key: string
  label: string
  meta?: string
  detail?: string
}

export interface ReviewSidebarItem {
  key: string
  type: ReviewSidebarItemType
  title: string
  meta?: string
  content: string
  reason?: string
  badgeLabel?: string
  badgeColor?: string
  badgeColorRole?: 'primary' | 'danger' | 'warning' | 'success' | 'muted'
  anchorX: number
  anchorY: number
  connector?: boolean
  color?: string
  colorRole?: 'primary' | 'danger' | 'warning' | 'success' | 'muted'
  editable?: boolean
  onCommitText?: (value: string) => void
  actions?: ReviewSidebarAction[]
  active?: boolean
  onActivate?: () => void
  expanded?: boolean
  onToggleExpanded?: () => void
  detailLines?: string[]
  auditTrail?: ReviewSidebarAuditRecord[]
}

export interface RenderReviewSidebarOptions extends RenderBoxOptions {
  items?: ReviewSidebarItem[]
}

const CARD_GAP = 8
const CARD_PADDING = 10
const CARD_RADIUS = 4
const ACCENT_WIDTH = 4
const HEADER_HEIGHT = 34
const READ_LINE_HEIGHT = 16
const EDITOR_HEIGHT = 76
const EXPAND_BUTTON_SIZE = 18
const DETAIL_LINE_HEIGHT = 15
const AUDIT_LINE_HEIGHT = 28
const DETAIL_TOP_GAP = 6
const ACTION_TOP_GAP = 8
const HEADER_CONTENT_HEIGHT = HEADER_HEIGHT
const MIN_DETAIL_VIEWPORT_HEIGHT = 24

export class RenderReviewSidebar extends RenderBox {
  static override debugTypeName = 'RenderReviewSidebar'
  private _items: ReviewSidebarItem[] = []
  private _itemsSignature = ''
  private readonly _cards = new Map<string, RenderReviewCard>()
  private _orderedCards: RenderReviewCard[] = []
  private _scrollY = 0
  private _contentHeight = 0
  private _activeKey = ''
  private _pendingRevealActive = false
  private _pendingActiveViewportY: number | null = null

  constructor(options: RenderReviewSidebarOptions = {}) {
    super({ ...options, width: options.width ?? 250, minWidth: options.minWidth ?? 160 })
    if (options.items) {
      this.setItems(options.items)
    }
  }

  get items(): ReviewSidebarItem[] {
    return this._items
  }

  setItems(items: ReviewSidebarItem[]): void {
    const next = [...items].sort((a, b) => a.anchorY - b.anchorY)
    const nextSignature = reviewSidebarItemsSignature(next)
    const itemsChanged = nextSignature !== this._itemsSignature
    const activeKey = next.find(item => item.active)?.key ?? ''
    const activeChanged = activeKey !== this._activeKey
    const previousActiveCard = activeKey && !activeChanged ? this._cards.get(activeKey) : null
    if (activeKey && activeChanged) {
      this._pendingRevealActive = true
      this._pendingActiveViewportY = null
    } else if (previousActiveCard) {
      this._pendingActiveViewportY = previousActiveCard.offset.y
    }
    this._activeKey = activeKey
    this._items = next
    this._itemsSignature = nextSignature
    const nextKeys = new Set(next.map(item => item.key))
    let structureChanged = false
    for (const [key, card] of this._cards) {
      if (!nextKeys.has(key)) {
        card.dispose()
        this._cards.delete(key)
        structureChanged = true
      }
    }
    this._orderedCards = next.map(item => {
      let card = this._cards.get(item.key)
      if (!card) {
        card = new RenderReviewCard(item)
        card.parent = this
        if (this.owner) card.attach(this.owner)
        this._cards.set(item.key, card)
        structureChanged = true
      } else {
        card.setItem(item)
      }
      return card
    })
    if (itemsChanged || activeChanged || structureChanged) {
      this.markNeedsLayout()
    }
  }

  setWidth(width: number): void {
    const next = Math.max(160, width)
    if (this.width === next) return
    this.width = next
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      for (const card of this._orderedCards) visitor(card)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    for (const card of this._orderedCards) visitor(card)
  }

  override hitTest(point: Offset): boolean {
    return this._items.length > 0 && super.hitTest(point)
  }

  override hitTestPath(point: Offset, result: HitTestResult): boolean {
    if (!this.hitTest(point)) return false
    return super.hitTestPath(point, result)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const preferredWidth = this.width ?? 250
    const maxWidth = constraints.maxWidth === Infinity ? preferredWidth : constraints.maxWidth
    const width = Math.max(constraints.minWidth, Math.min(preferredWidth, maxWidth))
    const viewportHeight = constraints.maxHeight === Infinity ? 260 : constraints.maxHeight
    let nextY = 12
    const naturalY = new Map<RenderReviewCard, number>()
    for (const card of this._orderedCards) {
      const maxCardHeight = Math.max(card.minimumVisibleHeight, 140, Math.min(360, viewportHeight - 24))
      card.layout({ minWidth: width, maxWidth: width, minHeight: 0, maxHeight: maxCardHeight }, true, context)
      const y = Math.max(card.item.anchorY - 8, nextY)
      naturalY.set(card, y)
      nextY = y + card.size.height + CARD_GAP
    }
    this._contentHeight = Math.max(nextY, ...this._items.map(item => item.anchorY + 24), 0)
    this.size = constrainSize(constraints, {
      width,
      height: constraints.maxHeight === Infinity ? this._contentHeight : viewportHeight,
    })
    if (context.pass === 'measure') return
    this._clampScrollY()
    if (this._pendingActiveViewportY !== null) {
      const activeCard = this._orderedCards.find(item => item.item.active)
      const naturalActiveY = activeCard ? naturalY.get(activeCard) : undefined
      if (naturalActiveY !== undefined) {
        this._scrollY = naturalActiveY - this._pendingActiveViewportY
        this._clampScrollY()
      } else if (this._pendingRevealActive) {
        this._revealActiveCard(naturalY)
      }
      this._pendingActiveViewportY = null
      this._pendingRevealActive = false
    } else if (this._pendingRevealActive) {
      this._revealActiveCard(naturalY)
      this._pendingRevealActive = false
    }
    for (const card of this._orderedCards) {
      card.offset = { x: 0, y: (naturalY.get(card) ?? 0) - this._scrollY }
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const ctx = context.ctx
    this.paintConnectors(context, offset)
    ctx.save()
    ctx.beginPath()
    ctx.rect(offset.x, offset.y, this.size.width, this.size.height)
    ctx.clip()
    super.performPaint(context, offset)
    ctx.restore()
  }

  onWheel(event: WheelPointerEvent): boolean {
    if (!this.hitTest(event.position)) return false
    if (event.deltaY === 0 || this._maxScrollY <= 0) return false
    const before = this._scrollY
    const speed = 44
    this._scrollY += event.deltaY > 0 ? speed : -speed
    this._clampScrollY()
    if (this._scrollY !== before) {
      this.markNeedsLayout()
      this.markNeedsPaint()
    }
    return true
  }

  debugState(): {
    scrollY: number
    maxScrollY: number
    contentHeight: number
    viewportHeight: number
    cardOffsets: Array<{ key: string; y: number; height: number }>
  } {
    return {
      scrollY: this._scrollY,
      maxScrollY: this._maxScrollY,
      contentHeight: this._contentHeight,
      viewportHeight: this.size.height,
      cardOffsets: this._orderedCards.map(card => ({ key: card.item.key, y: card.offset.y, height: card.size.height })),
    }
  }

  private paintConnectors(context: PaintContext, offset: Offset): void {
    const ctx = context.ctx
    ctx.save()
    const connectorItems = this._items.filter(item => item.connector !== false)
    const minAnchorX = Math.min(0, ...connectorItems.map(item => item.anchorX), -12) - 12
    ctx.beginPath()
    ctx.rect(offset.x + minAnchorX, offset.y, this.size.width - minAnchorX, this.size.height)
    ctx.clip()
    for (const card of this._orderedCards) {
      const item = card.item
      if (item.connector === false) continue
      const color = resolveReviewSidebarItemColor(context.theme, item)
      const startX = offset.x + item.anchorX
      const startY = offset.y + item.anchorY
      const endX = offset.x + card.offset.x
      const endY = offset.y + card.offset.y
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.globalAlpha = item.active ? 1 : 0.78
      ctx.lineWidth = item.active ? 1.5 : 1
      if (typeof ctx.setLineDash === 'function') ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(startX, startY)
      ctx.lineTo(endX, endY)
      ctx.stroke()
      if (typeof ctx.setLineDash === 'function') ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(startX, startY - 4)
      ctx.lineTo(startX - 4, startY + 4)
      ctx.lineTo(startX + 4, startY + 4)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  }

  private get _maxScrollY(): number {
    return Math.max(0, this._contentHeight - this.size.height)
  }

  private _clampScrollY(): void {
    this._scrollY = Math.max(0, Math.min(this._maxScrollY, this._scrollY))
  }

  private _revealActiveCard(naturalY: Map<RenderReviewCard, number>): void {
    const card = this._orderedCards.find(item => item.item.active)
    if (!card) return
    const y = naturalY.get(card) ?? 0
    const margin = 10
    const bottom = y + card.size.height
    if (y < this._scrollY + margin) {
      this._scrollY = y - margin
    } else if (bottom > this._scrollY + this.size.height - margin) {
      this._scrollY = bottom - this.size.height + margin
    }
    this._clampScrollY()
  }

}

class RenderReviewCard extends RenderBox implements InteractiveRenderObject {
  static override debugTypeName = 'RenderReviewCard'
  private _item: ReviewSidebarItem
  private readonly _header: RenderReviewCardHeader
  private readonly _readBody: RenderReviewTextBlock
  private readonly _detailBody: RenderReviewDetailsBody
  private readonly _detailScroll: RenderScrollViewer
  private _editor: RenderTextArea | null = null
  private _actions: RenderStackPanel | null = null
  private _detailVisible = false

  constructor(item: ReviewSidebarItem) {
    super()
    this._item = item
    this._header = new RenderReviewCardHeader(item)
    this._header.parent = this
    this._readBody = new RenderReviewTextBlock()
    this._readBody.parent = this
    this._detailBody = new RenderReviewDetailsBody()
    this._detailScroll = new RenderScrollViewer({ direction: 'vertical', child: this._detailBody })
    this._detailScroll.parent = this
    this.syncChildren()
  }

  get item(): ReviewSidebarItem {
    return this._item
  }

  get minimumVisibleHeight(): number {
    const bodyHeight = this._item.editable ? EDITOR_HEIGHT : READ_LINE_HEIGHT * 3
    const actionHeight = this._item.actions?.length ? ACTION_TOP_GAP + 34 : 0
    return CARD_PADDING * 2 + HEADER_HEIGHT + bodyHeight + actionHeight
  }

  setItem(item: ReviewSidebarItem): void {
    const previous = this._item
    const layoutChanged = reviewCardLayoutSignature(previous) !== reviewCardLayoutSignature(item)
    this._item = item
    this._header.setItem(item)
    this.syncChildren(previous)
    if (layoutChanged) {
      this.markNeedsLayout()
    }
  }

  onPointerDown(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event) || !this.hitTest(event.position)) {
      return
    }
    if (this.isInteractiveChildHit(event.position)) {
      return
    }
    if (this.isExpandable() && this.isExpandButtonHit(event.position)) {
      this._item.onToggleExpanded?.()
      event.stopPropagation?.()
      return
    }
    this._item.onActivate?.()
    event.stopPropagation?.()
  }

  onPointerMove(_event: PointerEvent): void {}

  onPointerUp(event: PointerEvent): void {
    if (isPrimaryPointerButton(event)) {
      event.stopPropagation?.()
    }
  }

  onPointerCancel(_event: PointerEvent): void {}

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      visitor(this._header)
      if (this._editor) visitor(this._editor)
      visitor(this._readBody)
      visitor(this._detailScroll)
      if (this._actions) visitor(this._actions)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    visitor(this._header)
    if (this._editor) visitor(this._editor)
    else visitor(this._readBody)
    if (this._detailVisible) visitor(this._detailScroll)
    if (this._actions) visitor(this._actions)
  }

  override isFocusChildActive(child: RenderObject): boolean {
    if (child === this._header || child === this._actions) return child.visible
    if (child === this._editor) return child.visible
    if (child === this._readBody) return !this._editor && child.visible
    if (child === this._detailScroll) return this._detailVisible && child.visible
    return super.isFocusChildActive(child)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const width = constraints.maxWidth === Infinity ? 240 : constraints.maxWidth
    const textWidth = Math.max(0, width - CARD_PADDING * 2 - ACCENT_WIDTH)
    this._header.layout({
      minWidth: textWidth,
      maxWidth: textWidth,
      minHeight: HEADER_CONTENT_HEIGHT,
      maxHeight: HEADER_CONTENT_HEIGHT,
    }, true, context)
    this._header.offset = { x: CARD_PADDING, y: CARD_PADDING }

    let baseContentHeight = 0
    if (this._editor) {
      this._editor.layout({
        minWidth: textWidth,
        maxWidth: textWidth,
        minHeight: EDITOR_HEIGHT,
        maxHeight: EDITOR_HEIGHT,
      }, true, context)
      this._editor.offset = { x: CARD_PADDING, y: CARD_PADDING + HEADER_HEIGHT }
      baseContentHeight += this._editor.size.height
    } else {
      this._readBody.setContent(this._item.content, this._item.reason)
      this._readBody.layout({
        minWidth: textWidth,
        maxWidth: textWidth,
        minHeight: 0,
        maxHeight: Infinity,
      }, true, context)
      this._readBody.offset = { x: CARD_PADDING, y: CARD_PADDING + HEADER_HEIGHT }
      baseContentHeight += this._readBody.size.height
    }

    let actionsContentHeight = 0
    if (this._actions) {
      this._actions.layout({ minWidth: 0, maxWidth: textWidth, minHeight: 0, maxHeight: 34 }, true, context)
      actionsContentHeight = this._actions.size.height
    }

    let detailViewportHeight = 0
    let detailGap = 0
    this._detailVisible = false
    if (this._item.expanded) {
      this._detailBody.setContent(this._item.detailLines ?? [], this._item.auditTrail ?? [])
      this._detailBody.layout({
        minWidth: textWidth,
        maxWidth: textWidth,
        minHeight: 0,
        maxHeight: Infinity,
      }, true, context)
      const detailContentHeight = this._detailBody.size.height
      const actionBlockHeight = this._actions ? ACTION_TOP_GAP + actionsContentHeight : 0
      const reservedHeight = CARD_PADDING * 2 + HEADER_HEIGHT + baseContentHeight + actionBlockHeight
      const availableDetailHeight = constraints.maxHeight === Infinity
        ? detailContentHeight
        : Math.max(0, constraints.maxHeight - reservedHeight - DETAIL_TOP_GAP)
      detailViewportHeight = Math.min(detailContentHeight, availableDetailHeight)
      if (detailContentHeight > 0 && detailViewportHeight >= Math.min(detailContentHeight, MIN_DETAIL_VIEWPORT_HEIGHT)) {
        detailGap = DETAIL_TOP_GAP
        this._detailVisible = true
        this._detailScroll.layout({
          minWidth: textWidth,
          maxWidth: textWidth,
          minHeight: detailViewportHeight,
          maxHeight: detailViewportHeight,
        }, true, context)
        this._detailScroll.offset = {
          x: CARD_PADDING,
          y: CARD_PADDING + HEADER_HEIGHT + baseContentHeight + detailGap,
        }
      } else {
        detailViewportHeight = 0
      }
    }

    if (this._actions) {
      this._actions.offset = {
        x: CARD_PADDING,
        y: CARD_PADDING + HEADER_HEIGHT + baseContentHeight + detailGap + detailViewportHeight + ACTION_TOP_GAP,
      }
    }

    this.size = constrainSize(constraints, {
      width,
      height: CARD_PADDING * 2
        + HEADER_HEIGHT
        + baseContentHeight
        + detailGap
        + detailViewportHeight
        + (this._actions ? ACTION_TOP_GAP + actionsContentHeight : 0),
    })
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const ctx = context.ctx
    const theme = context.theme
    const active = this._item.active === true
    ctx.save()
    ctx.fillStyle = colorToCSS(active ? theme.selectionMuted : theme.surfacePanel)
    drawRoundRect(ctx, offset.x, offset.y, this.size.width, this.size.height, CARD_RADIUS)
    ctx.fill()
    ctx.strokeStyle = active
      ? colorToCSS(theme.focusBorder)
      : resolveReviewSidebarItemColor(theme, this._item, theme.borderPanel)
    ctx.lineWidth = active ? 2 : 1
    ctx.stroke()
    ctx.fillStyle = resolveReviewSidebarItemColor(theme, this._item)
    ctx.fillRect(offset.x, offset.y, active ? ACCENT_WIDTH + 1 : ACCENT_WIDTH, this.size.height)
    ctx.beginPath()
    ctx.rect(offset.x, offset.y, this.size.width, this.size.height)
    ctx.clip()

    super.performPaint(context, offset)
    ctx.restore()
  }

  private isExpandable(): boolean {
    return !!(this._item.detailLines?.length || this._item.auditTrail?.length)
  }

  private isExpandButtonHit(point: Offset): boolean {
    const rect = this.expandButtonRect()
    return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
  }

  private isInteractiveChildHit(point: Offset): boolean {
    return !!((this._editor?.hitTest(point)) || (this._actions?.hitTest(point)) || (this._detailVisible && this._detailScroll.hitTest(point)))
  }

  private expandButtonRect(): { x: number; y: number; width: number; height: number } {
    const g = this.globalOffset
    const textWidth = Math.max(0, this.size.width - CARD_PADDING * 2 - ACCENT_WIDTH)
    return {
      x: g.x + CARD_PADDING + textWidth - EXPAND_BUTTON_SIZE,
      y: g.y + CARD_PADDING + 20,
      width: EXPAND_BUTTON_SIZE,
      height: EXPAND_BUTTON_SIZE,
    }
  }

  private syncChildren(previous?: ReviewSidebarItem): void {
    if (this._item.editable) {
      if (!this._editor) {
        this._editor = new RenderTextArea({
          value: this._item.content,
          placeholder: '请输入批注内容',
          onCommit: value => this._item.onCommitText?.(value),
        })
        this._editor.parent = this
        if (this.owner) this._editor.attach(this.owner)
      } else if (!this._editor.isFocused && previous?.content !== this._item.content) {
        this._editor.value = this._item.content
      }
      this._editor.readonly = false
    } else if (this._editor) {
      this._editor.dispose()
      this._editor = null
    }
    this.syncActions(previous)
  }

  private syncActions(previous?: ReviewSidebarItem): void {
    const actions = this._item.actions ?? []
    if (!actions.length) {
      if (this._actions) {
        this._actions.dispose()
        this._actions = null
      }
      return
    }
    const actionSig = actions.map(action => `${action.key}:${action.label}:${action.disabled ?? false}:${action.variant ?? 'default'}`).join('|')
    const previousSig = previous?.actions?.map(action => `${action.key}:${action.label}:${action.disabled ?? false}:${action.variant ?? 'default'}`).join('|')
    if (this._actions && actionSig === previousSig) {
      this.updateActionButtons(actions)
      return
    }
    if (this._actions) {
      this._actions.dispose()
    }
    const row = new RenderStackPanel({ orientation: 'horizontal', spacing: 6, crossAxisAlignment: 'center' })
    for (const action of actions) {
      row.addChild(new RenderButton({
        label: action.label,
        variant: action.variant,
        disabled: action.disabled,
        onClick: action.onClick,
      }))
    }
    row.parent = this
    if (this.owner) row.attach(this.owner)
    this._actions = row
  }

  private updateActionButtons(actions: ReviewSidebarAction[]): void {
    if (!this._actions) return
    for (let index = 0; index < actions.length; index++) {
      const button = this._actions.children[index]
      const action = actions[index]
      if (!(button instanceof RenderButton) || !action) continue
      button.onClick = action.onClick
      button.disabled = action.disabled ?? false
      button.variant = action.variant ?? 'default'
    }
  }
}

class RenderReviewCardHeader extends RenderBox {
  static override debugTypeName = 'RenderReviewCardHeader'
  private _item: ReviewSidebarItem

  constructor(item: ReviewSidebarItem) {
    super()
    this._item = item
  }

  setItem(item: ReviewSidebarItem): void {
    const changed = reviewCardHeaderSignature(this._item) !== reviewCardHeaderSignature(item)
    this._item = item
    if (changed) {
      this.markNeedsPaint()
    }
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, _context: LayoutContext): void {
    this.size = constrainSize(constraints, {
      width: constraints.maxWidth === Infinity ? 220 : constraints.maxWidth,
      height: HEADER_CONTENT_HEIGHT,
    })
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const ctx = context.ctx
    ctx.fillStyle = colorToCSS(context.theme.textPrimary)
    ctx.font = `600 12px ${context.theme.fontFamily}`
    ctx.textBaseline = 'middle'
    ctx.fillText(this._item.title, offset.x, offset.y + 7)
    if (this._item.meta) {
      ctx.fillStyle = colorToCSS(context.theme.textSecondary)
      ctx.font = `11px ${context.theme.fontFamily}`
      ctx.fillText(this._item.meta, offset.x, offset.y + 24)
    }
    if (this._item.badgeLabel) {
      const badgeText = this._item.badgeLabel
      const badgeFontSize = 11
      ctx.font = `${badgeFontSize}px ${context.theme.fontFamily}`
      const badgeWidth = Math.min(this.size.width, TextMeasurer.measureWidth(badgeText, badgeFontSize, context.theme.fontFamily) + 12)
      const badgeHeight = 18
      const badgeX = offset.x + this.size.width - badgeWidth
      const badgeY = offset.y
      const fallbackBadge = resolveReviewSidebarRoleColor(
        context.theme,
        this._item.badgeColorRole ?? 'muted',
      )
      ctx.fillStyle = this._item.badgeColor || colorToCSS(fallbackBadge)
      drawRoundRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 3)
      ctx.fill()
      ctx.fillStyle = this._item.badgeColor
        ? colorToCSS(context.theme.textOnAccent)
        : colorToCSS(resolveContrastText(context.theme, fallbackBadge))
      ctx.font = `${badgeFontSize}px ${context.theme.fontFamily}`
      ctx.textAlign = 'center'
      ctx.fillText(badgeText, badgeX + badgeWidth / 2, badgeY + badgeHeight / 2)
      ctx.textAlign = 'left'
    }
    if (!this.isExpandable()) return
    const x = offset.x + this.size.width - EXPAND_BUTTON_SIZE
    const y = offset.y + 20
    const centerX = x + EXPAND_BUTTON_SIZE / 2
    const centerY = y + EXPAND_BUTTON_SIZE / 2
    ctx.save()
    ctx.strokeStyle = colorToCSS(context.theme.textSecondary)
    ctx.lineWidth = 1.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    if (this._item.expanded) {
      ctx.moveTo(centerX - 4, centerY + 2)
      ctx.lineTo(centerX, centerY - 2)
      ctx.lineTo(centerX + 4, centerY + 2)
    } else {
      ctx.moveTo(centerX - 4, centerY - 2)
      ctx.lineTo(centerX, centerY + 2)
      ctx.lineTo(centerX + 4, centerY - 2)
    }
    ctx.stroke()
    ctx.restore()
  }

  private isExpandable(): boolean {
    return !!(this._item.detailLines?.length || this._item.auditTrail?.length)
  }
}

class RenderReviewTextBlock extends RenderBox {
  static override debugTypeName = 'RenderReviewTextBlock'
  private _content = ''
  private _reason = ''
  private _contentLines: string[] = []
  private _reasonLines: string[] = []

  setContent(content: string, reason?: string): void {
    const nextReason = reason ?? ''
    if (this._content === content && this._reason === nextReason) return
    this._content = content
    this._reason = nextReason
    this.markNeedsLayout()
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const width = constraints.maxWidth === Infinity ? 220 : constraints.maxWidth
    this._contentLines = wrapText(this._content, width, 2, 12, context.theme.fontFamily)
    this._reasonLines = this._reason ? wrapText(this._reason, width, 1, 12, context.theme.fontFamily) : []
    this.size = constrainSize(constraints, {
      width,
      height: Math.max(READ_LINE_HEIGHT, this._contentLines.length * READ_LINE_HEIGHT)
        + this._reasonLines.length * READ_LINE_HEIGHT,
    })
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const ctx = context.ctx
    let y = offset.y
    ctx.fillStyle = colorToCSS(context.theme.textPrimary)
    ctx.font = `12px ${context.theme.fontFamily}`
    ctx.textBaseline = 'top'
    for (const line of this._contentLines) {
      ctx.fillText(line, offset.x, y)
      y += READ_LINE_HEIGHT
    }
    ctx.fillStyle = colorToCSS(context.theme.textSecondary)
    for (const line of this._reasonLines) {
      ctx.fillText(line, offset.x, y)
      y += READ_LINE_HEIGHT
    }
  }
}

class RenderReviewDetailsBody extends RenderBox {
  static override debugTypeName = 'RenderReviewDetailsBody'
  private _detailSourceLines: string[] = []
  private _auditTrail: ReviewSidebarAuditRecord[] = []
  private _detailLines: string[] = []
  private _auditRows: Array<{ record: ReviewSidebarAuditRecord; detailLines: string[] }> = []

  setContent(detailLines: string[], auditTrail: ReviewSidebarAuditRecord[]): void {
    this._detailSourceLines = detailLines
    this._auditTrail = auditTrail
    this.markNeedsLayout()
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const width = constraints.maxWidth === Infinity ? 220 : constraints.maxWidth
    this._detailLines = this._detailSourceLines.flatMap(line => wrapText(line, width, 2, 11, context.theme.fontFamily))
    this._auditRows = this._auditTrail.map(record => ({
      record,
      detailLines: record.detail ? wrapText(record.detail, Math.max(0, width - 14), 2, 11, context.theme.fontFamily) : [],
    }))
    const auditHeight = this._auditRows.reduce((sum, row) => sum + AUDIT_LINE_HEIGHT + row.detailLines.length * DETAIL_LINE_HEIGHT, 0)
    this.size = constrainSize(constraints, {
      width,
      height: 8 + this._detailLines.length * DETAIL_LINE_HEIGHT + (this._auditRows.length ? 18 + auditHeight : 0),
    })
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const ctx = context.ctx
    let y = offset.y
    const left = offset.x
    const right = offset.x + this.size.width
    ctx.strokeStyle = colorToCSS(context.theme.borderSubtle)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(left, y)
    ctx.lineTo(right, y)
    ctx.stroke()
    y += 7
    ctx.textBaseline = 'top'
    ctx.font = `11px ${context.theme.fontFamily}`
    ctx.fillStyle = colorToCSS(context.theme.textSecondary)
    for (const line of this._detailLines) {
      ctx.fillText(line, left, y)
      y += DETAIL_LINE_HEIGHT
    }
    if (!this._auditRows.length) {
      return
    }
    y += 2
    ctx.fillStyle = colorToCSS(context.theme.textPrimary)
    ctx.font = `600 11px ${context.theme.fontFamily}`
    ctx.fillText('审计轨迹', left, y)
    y += 17
    for (let index = 0; index < this._auditRows.length; index++) {
      const row = this._auditRows[index]!
      const dotX = left + 4
      const dotY = y + 6
      ctx.fillStyle = colorToCSS(index === 0 ? context.theme.accentPrimary : context.theme.textDisabled)
      ctx.fillRect(dotX - 2, dotY - 2, 4, 4)
      if (index < this._auditRows.length - 1) {
        ctx.strokeStyle = colorToCSS(context.theme.borderData)
        ctx.beginPath()
        ctx.moveTo(dotX, dotY + 5)
        ctx.lineTo(dotX, y + AUDIT_LINE_HEIGHT + Math.max(0, row.detailLines.length - 1) * DETAIL_LINE_HEIGHT)
        ctx.stroke()
      }
      ctx.fillStyle = colorToCSS(context.theme.textPrimary)
      ctx.font = `11px ${context.theme.fontFamily}`
      ctx.fillText(row.record.label, left + 14, y)
      if (row.record.meta) {
        ctx.fillStyle = colorToCSS(context.theme.textSecondary)
        ctx.fillText(row.record.meta, left + 14, y + 13)
      }
      y += AUDIT_LINE_HEIGHT
      ctx.fillStyle = colorToCSS(context.theme.textSecondary)
      for (const line of row.detailLines) {
        ctx.fillText(line, left + 14, y)
        y += DETAIL_LINE_HEIGHT
      }
    }
  }
}

function wrapText(text: string, maxWidth: number, maxLines: number, fontSize: number, fontFamily: string): string[] {
  const value = String(text || '')
  if (!value) return []
  const lines: string[] = []
  let line = ''
  for (const char of value) {
    const next = line + char
    if (line && TextMeasurer.measureWidth(next, fontSize, fontFamily) > maxWidth) {
      lines.push(line)
      line = char
      if (lines.length === maxLines) break
    } else {
      line = next
    }
  }
  if (lines.length < maxLines && line) lines.push(line)
  if (lines.length === maxLines && TextMeasurer.measureWidth(value, fontSize, fontFamily) > maxWidth * maxLines) {
    const last = lines[lines.length - 1] ?? ''
    lines[lines.length - 1] = ellipsize(last, maxWidth, fontSize, fontFamily)
  }
  return lines
}

function ellipsize(text: string, maxWidth: number, fontSize: number, fontFamily: string): string {
  const ellipsis = '...'
  if (TextMeasurer.measureWidth(ellipsis, fontSize, fontFamily) > maxWidth) return ''
  const chars = Array.from(text)
  while (chars.length > 0 && TextMeasurer.measureWidth(`${chars.join('')}${ellipsis}`, fontSize, fontFamily) > maxWidth) {
    chars.pop()
  }
  return `${chars.join('')}${ellipsis}`
}

function reviewSidebarItemsSignature(items: ReviewSidebarItem[]): string {
  return items.map(reviewSidebarItemSignature).join('\n')
}

function reviewSidebarItemSignature(item: ReviewSidebarItem): string {
  return [
    item.key,
    item.type,
    item.title,
    item.meta ?? '',
    item.content,
    item.reason ?? '',
    item.badgeLabel ?? '',
    item.badgeColor ?? '',
    item.badgeColorRole ?? '',
    item.anchorX,
    item.anchorY,
    item.connector !== false,
    item.color ?? '',
    item.colorRole ?? '',
    item.editable === true,
    item.active === true,
    item.expanded === true,
    (item.detailLines ?? []).join('\u0001'),
    reviewAuditTrailSignature(item.auditTrail),
    reviewActionsSignature(item.actions),
  ].join('\u0003')
}

function reviewCardLayoutSignature(item: ReviewSidebarItem): string {
  return [
    item.content,
    item.reason ?? '',
    item.editable === true,
    item.expanded === true,
    (item.detailLines ?? []).join('\u0001'),
    reviewAuditTrailSignature(item.auditTrail),
    reviewActionsSignature(item.actions),
  ].join('\u0003')
}

function reviewCardHeaderSignature(item: ReviewSidebarItem): string {
  return [
    item.title,
    item.meta ?? '',
    item.badgeLabel ?? '',
    item.badgeColor ?? '',
    item.badgeColorRole ?? '',
    item.expanded === true,
    (item.detailLines?.length ?? 0) > 0 || (item.auditTrail?.length ?? 0) > 0,
  ].join('\u0003')
}

function reviewActionsSignature(actions?: ReviewSidebarAction[]): string {
  return (actions ?? [])
    .map(action => `${action.key}\u0002${action.label}\u0002${action.disabled ?? false}\u0002${action.variant ?? 'default'}`)
    .join('\u0001')
}

function reviewAuditTrailSignature(auditTrail?: ReviewSidebarAuditRecord[]): string {
  return (auditTrail ?? [])
    .map(audit => `${audit.key}\u0002${audit.label}\u0002${audit.meta ?? ''}\u0002${audit.detail ?? ''}`)
    .join('\u0001')
}

function resolveReviewSidebarItemColor(
  theme: ResolvedTheme,
  item: ReviewSidebarItem,
  fallback: Color = theme.accentPrimary,
): string {
  if (item.color) return item.color
  if (!item.colorRole) return colorToCSS(fallback)
  return colorToCSS(resolveReviewSidebarRoleColor(theme, item.colorRole))
}

function resolveReviewSidebarRoleColor(
  theme: ResolvedTheme,
  role: NonNullable<ReviewSidebarItem['colorRole']>,
): Color {
  switch (role) {
    case 'danger':
      return theme.accentDanger
    case 'warning':
      return theme.accentWarning
    case 'success':
      return theme.accentSuccess
    case 'muted':
      return theme.textDisabled
    default:
      return theme.accentPrimary
  }
}

function drawRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + r)
  ctx.lineTo(x + width, y + height - r)
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  ctx.lineTo(x + r, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}
