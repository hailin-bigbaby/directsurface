import { AnimationController } from '../animation/animation_controller'
import { Curves } from '../animation/curves'
import { PopupRenderNode } from '../core/popup_render_surface'
import { PopupSurfaceShell } from '../core/popup_shell'
import { PopupManager, popupViewportRect, type PopupContext } from '../core/popup_manager'
import type { BoxConstraints, LayoutContext, Offset, Rect } from '../core/render_object'
import { RenderBox, resolveChildLayout } from '../layout/render_box'
import type { PointerEvent, WheelPointerEvent } from '../gestures/hit_test'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { deriveDrawerStyle } from '../theme/component_styles'
import { DefaultThemeMotion, resolveThemeMotion } from '../theme/theme'
import { paintIconGlyph } from './icon'

export type DrawerSide = 'left' | 'right'

interface DrawerLayout {
  viewportRect: Rect
  panelRect: Rect
  contentRect: Rect
  closeRect: Rect
}

export class RenderDrawer extends PopupSurfaceShell {
  static debugTypeName = 'RenderDrawer'
  title: string
  child?: RenderBox
  side: DrawerSide
  drawerWidth: number
  overlayClosable: boolean
  onOpenChange?: (open: boolean) => void
  onBeforeClose?: () => boolean

  private readonly _surfaceRoot: PopupRenderNode
  private readonly _anim: AnimationController
  private _hoveredClose = false
  private _pressedClose = false
  private _closing = false
  private _childLayoutCache?: {
    child: RenderBox
    width: number
    height: number
    theme: LayoutContext['theme']
  }

  constructor(options: {
    title: string
    child?: RenderBox
    side?: DrawerSide
    width?: number
    overlayClosable?: boolean
    onOpenChange?: (open: boolean) => void
    onBeforeClose?: () => boolean
  }) {
    super()
    this.title = options.title
    this.child = options.child
    this.side = options.side ?? 'right'
    this.drawerWidth = options.width ?? 320
    this.overlayClosable = options.overlayClosable ?? true
    this.onOpenChange = options.onOpenChange
    this.onBeforeClose = options.onBeforeClose
    this._surfaceRoot = new PopupRenderNode({
      layout: (node, constraints, context) => this._layoutSurface(node, constraints, context),
      paint: (_node, context, offset) => this._paintSurface(context, offset),
      visitChildren: (_node, visitor) => {
        if (this.child) visitor(this.child)
      },
      onPointerDown: (_node, event) => this._handleSurfacePointerDown(event),
      onPointerMove: (_node, event) => this._handleSurfacePointerMove(event),
      onPointerLeave: (_node, event) => this._handleSurfacePointerLeave(event),
      onPointerCancel: (_node, event) => this._handleSurfacePointerCancel(event),
      onPointerUp: (_node, event) => this._handleSurfacePointerUp(event),
      onWheel: (_node, event) => this._handleSurfaceWheel(event),
    })
    this.setPopupSurfaceRoot(this._surfaceRoot)
    this.setPopupSurfaceSync((root, popupContext) => {
      const viewportRect = popupViewportRect(popupContext)
      root.offset = { x: viewportRect.x, y: viewportRect.y }
      root.layout({
        minWidth: popupContext.viewport.width,
        maxWidth: popupContext.viewport.width,
        minHeight: popupContext.viewport.height,
        maxHeight: popupContext.viewport.height,
      }, false, { theme: popupContext.theme })
    })
    if (this.child) this.child.parent = this._surfaceRoot

    this._anim = new AnimationController({ duration: DefaultThemeMotion.normalDuration, curve: Curves.easeOut })
    this._anim.addListener(() => this.requestPopupPaint())
    this._anim.addStatusListener(status => {
      if (status !== 'dismissed') return
      if (!this._closing || !this.visible) return
      this._finishAnimatedClose()
    })
  }

  setChild(child?: RenderBox): void {
    if (this.child === child) return
    if (this.child) this.child.parent = undefined
    this.child = child
    if (child) child.parent = this._surfaceRoot
    this._childLayoutCache = undefined
    this.requestPopupPaint()
  }

  show(): void {
    if (this.visible) return
    this._closing = false
    this._hoveredClose = false
    this._pressedClose = false
    this.resetPopupSurface()
    this._anim.resetValue(0)
    this._anim.duration = resolveThemeMotion(PopupManager.instance.context.theme).normalDuration
    this.openPopup({ closeExisting: false })
    this.onOpenChange?.(true)
    this._anim.forward()
  }

  hide(): void {
    if (!this.visible) return
    this._anim.duration = resolveThemeMotion(PopupManager.instance.context.theme).normalDuration
    this.close()
  }

  debugState(popupContext: PopupContext = PopupManager.instance.context): DrawerLayout & { open: boolean } {
    const layout = this._layout(popupContext)
    return {
      ...layout,
      open: this.visible,
    }
  }

  close(): void {
    if (!this.visible) return
    if (this._closing) return
    if (this.onBeforeClose && !this.onBeforeClose()) return
    this._hoveredClose = false
    this._pressedClose = false
    if (this._anim.value <= 0 || !PopupManager.instance.stack.includes(this)) {
      super.close()
      return
    }
    this._closing = true
    this._anim.reverse()
    this.requestPopupPaint()
  }

  onEscape(event: KeyboardEvent): boolean {
    event.preventDefault()
    this.close()
    return true
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (!this.visible) return false
    if (event.key === 'Escape') {
      event.preventDefault()
      this.close()
      return true
    }
    return false
  }

  onOutsidePointerDown(_event: PointerEvent): boolean {
    if (!this.overlayClosable) return true
    this.close()
    return true
  }

  onWheel(event: WheelPointerEvent, popupContext: PopupContext = PopupManager.instance.context): boolean {
    if (!this.visible) return false
    super.onWheel(event, popupContext)
    return true
  }

  protected override onPopupClose(): void {
    super.onPopupClose()
    this._closing = false
    this._hoveredClose = false
    this._pressedClose = false
    this.onOpenChange?.(false)
  }

  dispose(): void {
    if (this.visible) super.close()
    this._anim.dispose()
    if (this.child) {
      this.child.parent = undefined
      this.child.dispose()
      this.child = undefined
    }
    this._childLayoutCache = undefined
    this.disposePopupSurface()
  }

  private _layoutSurface(node: PopupRenderNode, constraints: BoxConstraints, context: LayoutContext): void {
    const layout = this._layout({
      theme: context.theme,
      viewport: {
        x: node.offset.x,
        y: node.offset.y,
        width: constraints.maxWidth,
        height: constraints.maxHeight,
        dpr: 1,
      },
    })
    if (this.child) {
      this._layoutChildIfNeeded(this.child, layout, context)
      this.child.positionInSlot({
        x: layout.contentRect.x - node.offset.x,
        y: layout.contentRect.y - node.offset.y,
        width: layout.contentRect.width,
        height: layout.contentRect.height,
      }, this.child.resolveHorizontalAlignment('start'), this.child.resolveVerticalAlignment('start'))
    }
    node.size = {
      width: constraints.maxWidth,
      height: constraints.maxHeight,
    }
  }

  private _finishAnimatedClose(): void {
    if (!this.visible) return
    this._closing = false
    super.close()
  }

  private _layoutChildIfNeeded(child: RenderBox, layout: DrawerLayout, context: LayoutContext): void {
    const width = layout.contentRect.width
    const height = layout.contentRect.height
    const cache = this._childLayoutCache
    if (
      !cache ||
      cache.child !== child ||
      cache.width !== width ||
      cache.height !== height ||
      cache.theme !== context.theme ||
      child.needsLayout
    ) {
      const childLayout = resolveChildLayout(
        child,
        { minWidth: width, maxWidth: width, minHeight: height, maxHeight: height },
        'start',
        'start',
      )
      child.layout(childLayout.constraints, true, context)
      this._childLayoutCache = { child, width, height, theme: context.theme }
    }
  }

  private _paintSurface(context: PaintContext, offset: Offset): void {
    const s = deriveDrawerStyle(context.theme)
    const dl = new DrawList(context)
    const layout = this._layout(PopupManager.instance.context)
    const alpha = this._anim.value

    dl.fillRect(
      offset.x,
      offset.y,
      layout.viewportRect.width,
      layout.viewportRect.height,
      { ...s.overlayBg, a: s.overlayBg.a * alpha },
      0,
    )
    dl.outerShadow(
      layout.panelRect.x,
      layout.panelRect.y,
      layout.panelRect.width,
      layout.panelRect.height,
      s.shadowBlur,
      { ...s.shadowColor, a: s.shadowColor.a * alpha },
      0,
      s.shadowOffsetX,
      s.shadowOffsetY,
    )
    dl.fillRect(layout.panelRect.x, layout.panelRect.y, layout.panelRect.width, layout.panelRect.height, s.panelBg, 0)
    dl.strokeRect(layout.panelRect.x, layout.panelRect.y, layout.panelRect.width, layout.panelRect.height, s.panelBorder, 1, 0)
    dl.fillRect(layout.panelRect.x, layout.panelRect.y, layout.panelRect.width, s.titleHeight, s.titleBg, 0)
    dl.line(
      layout.panelRect.x,
      layout.panelRect.y + s.titleHeight,
      layout.panelRect.x + layout.panelRect.width,
      layout.panelRect.y + s.titleHeight,
      s.separator,
      1,
    )
    dl.fillText(
      this.title,
      layout.panelRect.x + s.padding,
      layout.panelRect.y + s.titleHeight / 2,
      s.titleText,
      s.fontSize,
      s.fontFamily,
      'left',
      'middle',
    )

    const closeColor = this._pressedClose
      ? s.titleText
      : this._hoveredClose
        ? s.titleText
        : s.closeText
    if (this._hoveredClose || this._pressedClose) {
      dl.fillRect(
        layout.closeRect.x - 4,
        layout.closeRect.y - 4,
        layout.closeRect.width + 8,
        layout.closeRect.height + 8,
        { ...s.panelBorder, a: this._pressedClose ? 0.26 : 0.16 },
        6,
      )
    }
    paintIconGlyph(context, {
      name: 'close',
      x: layout.closeRect.x,
      y: layout.closeRect.y,
      size: layout.closeRect.width,
      color: closeColor,
    })

    if (this.child) {
      this.child.paint(context, {
        x: offset.x + this.child.offset.x,
        y: offset.y + this.child.offset.y,
      })
    }
  }

  private _layout(popupContext: PopupContext): DrawerLayout {
    const s = deriveDrawerStyle(popupContext.theme)
    const viewportRect = popupViewportRect(popupContext)
    const panelWidth = Math.min(this.drawerWidth, Math.max(200, viewportRect.width - 32))
    const hiddenOffset = panelWidth + 12
    const slideOffset = hiddenOffset * (1 - this._anim.value)
    const panelX = this.side === 'right'
      ? viewportRect.x + viewportRect.width - panelWidth + slideOffset
      : viewportRect.x + (slideOffset === 0 ? 0 : -slideOffset)
    const panelRect = {
      x: this.side === 'right' ? panelX : panelX,
      y: viewportRect.y,
      width: panelWidth,
      height: viewportRect.height,
    }
    const closeRect = {
      x: panelRect.x + panelRect.width - s.padding - s.closeButtonSize,
      y: panelRect.y + (s.titleHeight - s.closeButtonSize) / 2,
      width: s.closeButtonSize,
      height: s.closeButtonSize,
    }
    const contentRect = {
      x: panelRect.x + s.padding,
      y: panelRect.y + s.titleHeight + s.padding,
      width: panelRect.width - s.padding * 2,
      height: panelRect.height - s.titleHeight - s.padding * 2,
    }
    return { viewportRect, panelRect, contentRect, closeRect }
  }

  private _handleSurfacePointerDown(event: PointerEvent): void {
    const layout = this._layout(PopupManager.instance.context)
    if (this._pointInRect(event.position, layout.closeRect)) {
      this._pressedClose = true
      this.requestPopupPaint()
      return
    }
    if (!this._pointInRect(event.position, layout.panelRect) && this.overlayClosable) {
      this.close()
    }
  }

  private _handleSurfacePointerMove(event: PointerEvent): void {
    const layout = this._layout(PopupManager.instance.context)
    const hoveredClose = this._pointInRect(event.position, layout.closeRect)
    if (hoveredClose === this._hoveredClose) return
    this._hoveredClose = hoveredClose
    this.requestPopupPaint()
  }

  private _handleSurfacePointerLeave(_event: PointerEvent): void {
    if (!this._hoveredClose) return
    this._hoveredClose = false
    this.requestPopupPaint()
  }

  private _handleSurfacePointerCancel(_event: PointerEvent): void {
    if (!this._pressedClose && !this._hoveredClose) return
    this._pressedClose = false
    this._hoveredClose = false
    this.requestPopupPaint()
  }

  private _handleSurfacePointerUp(event: PointerEvent): void {
    if (!this._pressedClose) return
    const layout = this._layout(PopupManager.instance.context)
    const shouldClose = this._pointInRect(event.position, layout.closeRect)
    this._pressedClose = false
    this.requestPopupPaint()
    if (shouldClose) this.close()
  }

  private _handleSurfaceWheel(_event: WheelPointerEvent): boolean {
    return false
  }

  private _pointInRect(point: Offset, rect: Rect): boolean {
    return point.x >= rect.x && point.x <= rect.x + rect.width &&
      point.y >= rect.y && point.y <= rect.y + rect.height
  }
}
