import { PopupRenderNode } from '../core/popup_render_surface'
import { PopupSurfaceShell } from '../core/popup_shell'
import { PopupManager, clampRectToPopupViewport, popupViewportRect, type PopupContext } from '../core/popup_manager'
import {
  GET_POPUP_ANCHOR_RECT,
  resolvePopupAnchorRect,
  resolvePopupAnchorTarget,
  type PopupAnchorTarget,
} from '../core/popup_anchor'
import { constrainSize, type BoxConstraints, type LayoutContext, type Offset, type Rect, type RenderObject } from '../core/render_object'
import { RenderBox, resolveChildLayout } from '../layout/render_box'
import type { PointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import { FocusManager } from '../core/focus_manager'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { drawPopupPanel } from '../rendering/popup_painter'
import { TextMeasurer } from '../core/text_measurer'
import { derivePopoverTriggerStyle, derivePopupStyle, resolveBgColor, resolveTextColor } from '../theme/component_styles'
import { paintIconGlyph } from './icon'
import { FocusableControl, paintFocusRing } from './focusable_control'
import {
  resolveAnchoredPopupRect,
  type AnchoredPopupPlacement,
} from '../core/anchored_popup_layout'

export type PopoverPlacement = AnchoredPopupPlacement

interface PopoverPanelMetrics {
  width: number
  height: number
}

interface PopoverPopupLayout {
  panelRect: Rect
}

export class PopoverPopup extends PopupSurfaceShell {
  private readonly _anchor: PopupAnchorTarget
  private _content: RenderBox
  private readonly _surfaceRoot: PopupRenderNode
  private _placement: PopoverPlacement
  private _fallbackPlacements?: readonly PopoverPlacement[]
  private _width?: number
  private readonly _closeOnTab: boolean
  private _onClose?: () => void

  constructor(options: {
    anchor: PopupAnchorTarget
    content: RenderBox
    placement?: PopoverPlacement
    fallbackPlacements?: readonly PopoverPlacement[]
    width?: number
    closeOnTab?: boolean
    onClose?: () => void
  }) {
    super()
    this._anchor = options.anchor
    this._content = options.content
    this._surfaceRoot = new PopupRenderNode({
      layout: (node, constraints, context) => this._layoutSurface(node, constraints, context),
      paint: (_node, context, offset) => this._paintSurface(context, offset),
      visitChildren: (_node, visitor) => visitor(this._content),
    })
    this._content.parent = this._surfaceRoot
    this._placement = options.placement ?? 'bottom-start'
    this._fallbackPlacements = options.fallbackPlacements ? [...options.fallbackPlacements] : undefined
    this._width = options.width
    this._closeOnTab = options.closeOnTab ?? true
    this._onClose = options.onClose
    this.setPopupSurfaceRoot(this._surfaceRoot)
    this.setPopupSurfaceSync((root, popupContext) => {
      const layout = this._layout(popupContext)
      root.offset = { x: layout.panelRect.x, y: layout.panelRect.y }
      root.layout({
        minWidth: layout.panelRect.width,
        maxWidth: layout.panelRect.width,
        minHeight: layout.panelRect.height,
        maxHeight: layout.panelRect.height,
      }, false, { theme: popupContext.theme })
    })
  }

  setContent(content: RenderBox): void {
    if (this._content === content) return
    this._content.parent = undefined
    this._content = content
    this._content.parent = this._surfaceRoot
    this.requestPopupPaint()
  }

  setPlacement(placement: PopoverPlacement): void {
    if (this._placement === placement) return
    this._placement = placement
    this.requestPopupPaint()
  }

  setFallbackPlacements(placements?: readonly PopoverPlacement[]): void {
    if (samePlacements(this._fallbackPlacements, placements)) return
    this._fallbackPlacements = placements ? [...placements] : undefined
    this.requestPopupPaint()
  }

  setWidth(width?: number): void {
    if (this._width === width) return
    this._width = width
    this.requestPopupPaint()
  }

  debugState(popupContext: PopupContext = PopupManager.instance.context): { panelRect: Rect; open: boolean } {
    return {
      panelRect: this._layout(popupContext).panelRect,
      open: this.visible,
    }
  }

  open(): void {
    if (this.visible) return
    this.resetPopupSurface()
    this.openPopup({ owner: resolvePopupAnchorTarget(this._anchor) })
  }

  onOutsidePointerDown(event: PointerEvent): boolean {
    if (!this._hitAnchor(event.position)) return false
    this.close()
    return true
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (!this.visible) return false
    if (event.key === 'Tab' && this._closeOnTab) {
      this.close()
      return false
    }
    return false
  }

  protected override onPopupClose(): void {
    super.onPopupClose()
    this._onClose?.()
  }

  disposePopup(): void {
    this.close()
    this._content.parent = undefined
    this.disposePopupSurface()
  }

  private _layoutSurface(node: PopupRenderNode, constraints: BoxConstraints, context: LayoutContext): void {
    const popup = derivePopupStyle(context.theme)
    const maxContentWidth = Math.max(80, constraints.maxWidth - popup.padding * 2)
    const maxContentHeight = Math.max(20, constraints.maxHeight - popup.padding * 2)
    const contentLayout = resolveChildLayout(
      this._content,
      {
        minWidth: maxContentWidth,
        maxWidth: maxContentWidth,
        minHeight: maxContentHeight,
        maxHeight: maxContentHeight,
      },
      'start',
      'start',
    )
    this._content.layout(contentLayout.constraints, true, context)
    this._content.positionInSlot({
      x: popup.padding,
      y: popup.padding,
      width: maxContentWidth,
      height: maxContentHeight,
    }, contentLayout.horizontalAlignment, contentLayout.verticalAlignment)
    node.size = {
      width: constraints.maxWidth,
      height: constraints.maxHeight,
    }
  }

  private _paintSurface(context: PaintContext, offset: Offset): void {
    const popup = derivePopupStyle(context.theme)
    const dl = new DrawList(context)
    drawPopupPanel(dl, offset.x, offset.y, this._surfaceRoot.size.width, this._surfaceRoot.size.height, popup)
    this._content.paint(context, {
      x: offset.x + this._content.offset.x,
      y: offset.y + this._content.offset.y,
    })
  }

  private _layout(popupContext: PopupContext): PopoverPopupLayout {
    const popup = derivePopupStyle(popupContext.theme)
    const viewportInset = 8
    const anchorRect = resolvePopupAnchorRect(this._anchor)
    const viewport = popupViewportRect(popupContext)
    const viewportWidth = viewport.width
    const viewportHeight = viewport.height
    const maxPanelWidth = Math.max(120, viewportWidth - viewportInset * 2)
    const measured = this._measurePanel(popupContext)
    const panelWidth = Math.min(maxPanelWidth, this._width ?? measured.width)
    const panelHeight = Math.min(Math.max(40, viewportHeight - viewportInset * 2), measured.height)
    const resolved = resolveAnchoredPopupRect({
      anchorRect: {
        x: anchorRect.x,
        y: anchorRect.y,
        width: anchorRect.w,
        height: anchorRect.h,
      },
      popupSize: { width: panelWidth, height: panelHeight },
      viewportRect: viewport,
      preferredPlacement: this._placement,
      fallbackPlacements: this._fallbackPlacements,
      overflowPreference: 'preferred',
      gap: 4,
      inset: viewportInset,
    })
    return {
      panelRect: resolved?.rect ?? clampRectToPopupViewport({
        x: anchorRect.x,
        y: anchorRect.y + anchorRect.h + 4,
        width: panelWidth,
        height: panelHeight,
      }, popupContext, viewportInset),
    }
  }

  private _measurePanel(popupContext: PopupContext): PopoverPanelMetrics {
    const popup = derivePopupStyle(popupContext.theme)
    const viewportInset = 8
    const maxContentWidth = Math.max(80, Math.min(this._width ?? 320, popupContext.viewport.width - viewportInset * 2) - popup.padding * 2)
    const maxContentHeight = Math.max(20, popupContext.viewport.height - viewportInset * 2 - popup.padding * 2)
    const contentSize = this._content.measureOuter({
      minWidth: 0,
      maxWidth: maxContentWidth,
      minHeight: 0,
      maxHeight: maxContentHeight,
    }, { theme: popupContext.theme })
    return {
      width: Math.max(this._width ?? 180, contentSize.width + popup.padding * 2),
      height: contentSize.height + popup.padding * 2,
    }
  }

  private _anchorRect(): Rect {
    const anchorRect = resolvePopupAnchorRect(this._anchor)
    return { x: anchorRect.x, y: anchorRect.y, width: anchorRect.w, height: anchorRect.h }
  }

  private _hitAnchor(point: Offset): boolean {
    const rect = this._anchorRect()
    return point.x >= rect.x && point.x <= rect.x + rect.width &&
      point.y >= rect.y && point.y <= rect.y + rect.height
  }
}

export class RenderPopover extends FocusableControl implements InteractiveRenderObject, PopupAnchorTarget {
  static override debugTypeName = 'RenderPopover'
  label: string
  content: RenderBox
  placement: PopoverPlacement
  fallbackPlacements?: readonly PopoverPlacement[]
  popoverWidth?: number
  onOpenChange?: (open: boolean) => void

  private readonly _popup: PopoverPopup
  private _hovered = false
  private _pressed = false

  constructor(options: {
    label: string
    content: RenderBox
    placement?: PopoverPlacement
    fallbackPlacements?: readonly PopoverPlacement[]
    popoverWidth?: number
    disabled?: boolean
    onOpenChange?: (open: boolean) => void
  }) {
    super({ disabled: options.disabled ?? false })
    this.label = options.label
    this.content = options.content
    this.placement = options.placement ?? 'bottom-start'
    this.fallbackPlacements = options.fallbackPlacements ? [...options.fallbackPlacements] : undefined
    this.popoverWidth = options.popoverWidth
    this.onOpenChange = options.onOpenChange
    this._popup = new PopoverPopup({
      anchor: this,
      content: options.content,
      placement: this.placement,
      fallbackPlacements: this.fallbackPlacements,
      width: this.popoverWidth,
      onClose: () => {
        this._pressed = false
        this._hovered = false
        this.markNeedsPaint()
        this.owner?.requestPaint(this)
        this.onOpenChange?.(false)
      },
    })
  }

  get open(): boolean {
    return this._popup.visible
  }

  set disabled(disabled: boolean) {
    if (!this.setDisabledState(disabled)) this.markNeedsPaint()
  }

  [GET_POPUP_ANCHOR_RECT](): Rect {
    const g = this.globalOffset
    return { x: g.x, y: g.y, width: this.size.width, height: this.size.height }
  }

  setContent(content: RenderBox): void {
    if (this.content === content) return
    this.content = content
    this._popup.setContent(content)
  }

  setPlacement(placement: PopoverPlacement): void {
    if (this.placement === placement) return
    this.placement = placement
    this._popup.setPlacement(placement)
  }

  setFallbackPlacements(placements?: readonly PopoverPlacement[]): void {
    if (samePlacements(this.fallbackPlacements, placements)) return
    this.fallbackPlacements = placements ? [...placements] : undefined
    this._popup.setFallbackPlacements(this.fallbackPlacements)
  }

  setPopoverWidth(width?: number): void {
    if (this.popoverWidth === width) return
    this.popoverWidth = width
    this._popup.setWidth(width)
  }

  openPopover(): void {
    if (this.isDisabled || this._popup.visible) return
    const previousFocus = FocusManager.instance.current
    this._popup.open()
    if (previousFocus) FocusManager.instance.setFocus(previousFocus)
    this.markNeedsPaint()
    this.onOpenChange?.(true)
  }

  closePopover(): void {
    if (!this._popup.visible) return
    this._popup.close()
    this.markNeedsPaint()
  }

  togglePopover(): void {
    if (this._popup.visible) this.closePopover()
    else this.openPopover()
  }

  debugState(): { open: boolean; panelRect: Rect } {
    return this._popup.debugState()
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = derivePopoverTriggerStyle(context.theme)
    const labelWidth = Math.ceil(TextMeasurer.measureWidth(this.label, style.fontSize, style.fontFamily))
    const iconSize = Math.max(10, style.fontSize - 1)
    const gap = Math.max(6, style.paddingH * 0.65)
    this.size = constrainSize(constraints, {
      width: labelWidth + style.paddingH * 2 + gap + iconSize,
      height: Math.max(constraints.minHeight, style.fontSize + style.paddingV * 2),
    })
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const style = derivePopoverTriggerStyle(context.theme)
    const dl = new DrawList(context)
    const state = {
      disabled: this.isDisabled,
      selected: this._popup.visible,
      pressed: this._pressed,
      hovered: this._hovered,
      focused: this.isFocused,
    }
    const bg = resolveBgColor(style.background, state)
    const border = resolveBgColor(style.border, state)
    const text = resolveTextColor(style.text, state)
    dl.fillRectGradient(
      offset.x,
      offset.y,
      this.size.width,
      this.size.height,
      {
        r: Math.round(bg.r + (255 - bg.r) * 0.08),
        g: Math.round(bg.g + (255 - bg.g) * 0.08),
        b: Math.round(bg.b + (255 - bg.b) * 0.08),
        a: bg.a,
      },
      bg,
      style.borderRadius,
    )
    dl.strokeRect(offset.x, offset.y, this.size.width, this.size.height, border, style.borderWidth, style.borderRadius)
    if (this.isFocused && !this.isDisabled) {
      paintFocusRing(dl, style.focusedBorder, offset.x, offset.y, this.size.width, this.size.height, style.borderRadius)
    }
    const iconSize = Math.max(10, style.fontSize - 1)
    const gap = Math.max(6, style.paddingH * 0.65)
    const labelWidth = TextMeasurer.measureWidth(this.label, style.fontSize, style.fontFamily)
    const totalWidth = labelWidth + gap + iconSize
    const startX = offset.x + (this.size.width - totalWidth) / 2
    dl.fillText(
      this.label,
      startX,
      offset.y + this.size.height / 2,
      text,
      style.fontSize,
      style.fontFamily,
      'left',
      'middle',
    )
    paintIconGlyph(context, {
      name: this._popup.visible ? 'chevron-up' : 'chevron-down',
      x: startX + labelWidth + gap,
      y: offset.y + (this.size.height - iconSize) / 2,
      size: iconSize,
      color: text,
    })
  }

  onPointerDown(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (this.isDisabled || !this.hitTest(event.position)) return
    this.requestFocus()
    this._pressed = true
    this.markNeedsPaint()
  }

  onPointerMove(event: PointerEvent): void {
    if (this.isDisabled) return
    const hovered = this.hitTest(event.position)
    if (hovered === this._hovered) return
    this._hovered = hovered
    this.markNeedsPaint()
  }

  onPointerUp(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (!this._pressed) return
    const activate = this.hitTest(event.position)
    this._pressed = false
    this.markNeedsPaint()
    if (activate && !this.isDisabled) this.togglePopover()
  }

  onPointerCancel(_event: PointerEvent): void {
    if (!this._pressed && !this._hovered) return
    this._pressed = false
    this._hovered = false
    this.markNeedsPaint()
  }

  onPointerLeave(_event: PointerEvent): void {
    if (!this._hovered) return
    this._hovered = false
    this.markNeedsPaint()
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.isDisabled) return false
    if (event.key === 'Escape' && this._popup.visible) {
      event.preventDefault()
      this.closePopover()
      return true
    }
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault()
      this.togglePopover()
      return true
    }
    return false
  }

  protected override onDisabledStateChanged(disabled: boolean): void {
    if (!disabled) return
    const hadPointerState = this._pressed || this._hovered
    this._pressed = false
    this._hovered = false
    this.closePopover()
    if (hadPointerState) this.markNeedsPaint()
  }

  override dispose(): void {
    this._popup.disposePopup()
    this.content.dispose()
    super.dispose()
  }
}

function samePlacements(
  first: readonly PopoverPlacement[] | undefined,
  second: readonly PopoverPlacement[] | undefined,
): boolean {
  if (first === second) return true
  if (!first || !second || first.length !== second.length) return false
  return first.every((placement, index) => placement === second[index])
}
