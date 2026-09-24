import { AnimationController } from '../animation/animation_controller'
import { Curves } from '../animation/curves'
import { FocusManager, type AuxiliaryFocusRootRegistration } from '../core/focus_manager'
import { TextMeasurer } from '../core/text_measurer'
import { constrainSize, type BoxConstraints, type LayoutContext, type Offset, type RenderObject } from '../core/render_object'
import type { PointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { RenderBox } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { paintSingleLineText } from '../rendering/text_painter'
import { deriveButtonStyle, deriveNotificationStyle } from '../theme/component_styles'
import type { ThemeMotionTokens } from '../theme/theme'
import { RenderButton } from './button'
import { RenderIconButton } from './icon_button'
import { paintIconGlyph, type IconName } from './icon'
import { measureNotificationToastLayout, type NotificationToastLayoutModel } from './notification_layout'
import type { NotificationStoreEntry } from './notification_store'

type NotificationStyle = ReturnType<typeof deriveNotificationStyle>

export interface NotificationToastPresentation {
  entry: NotificationStoreEntry
  layout: NotificationToastLayoutModel
}

const TYPE_ICONS: Record<NotificationStoreEntry['type'], IconName> = {
  info: 'info',
  success: 'checkmark-circle',
  warning: 'warning',
  error: 'error-circle',
}

class NotificationButton extends RenderButton {
  constructor(
    options: ConstructorParameters<typeof RenderButton>[0],
    private readonly _root: () => RenderObject,
    private readonly _onFocus: (focused: boolean) => void,
  ) {
    super(options)
  }

  override requestFocus(): boolean {
    if (!FocusManager.instance.canFocusAuxiliaryRoot(this._root())) return false
    return super.requestFocus()
  }

  protected override onFocusChanged(focused: boolean): void {
    this._onFocus(focused)
  }
}

class NotificationIconButton extends RenderIconButton {
  constructor(
    options: ConstructorParameters<typeof RenderIconButton>[0],
    private readonly _root: () => RenderObject,
    private readonly _onFocus: (focused: boolean) => void,
  ) {
    super(options)
  }

  override requestFocus(): boolean {
    if (!FocusManager.instance.canFocusAuxiliaryRoot(this._root())) return false
    return super.requestFocus()
  }

  protected override onFocusChanged(focused: boolean): void {
    this._onFocus(focused)
  }
}

export interface NotificationToastCallbacks {
  close(id: number): void
  invokeAction(id: number): void
  pause(id: number, source: string, paused: boolean): void
  markVisible(id: number): void
}

export function measureNotificationToastPresentations(
  entries: readonly NotificationStoreEntry[],
  style: NotificationStyle,
  theme: Parameters<typeof deriveButtonStyle>[0],
  cardWidth: number,
): NotificationToastPresentation[] {
  const buttonStyle = deriveButtonStyle(theme, 'text')
  return entries.map(entry => {
    let actionSize: { width: number; height: number } | undefined
    if (entry.action) {
      const textWidth = TextMeasurer.measureWidth(entry.action.label, buttonStyle.fontSize, buttonStyle.fontFamily)
      const spinnerWidth = buttonStyle.fontSize * 0.8 + Math.max(6, buttonStyle.paddingH * 0.75)
      actionSize = {
        width: Math.min(96, textWidth + spinnerWidth + buttonStyle.paddingH * 2),
        height: 26,
      }
    }
    return {
      entry,
      layout: measureNotificationToastLayout({
        cardWidth,
        minCardHeight: style.minCardHeight,
        maxCardHeight: style.maxCardHeight,
        accentWidth: style.accentWidth,
        padding: style.padding,
        iconSize: style.iconFontSize,
        titleHeight: style.fontSize,
        titleMessageGap: style.titleMessageGap,
        message: entry.message,
        messageFontSize: style.messageFontSize,
        messageLineHeight: style.messageFontSize * 1.25,
        fontFamily: style.fontFamily,
        actionSize,
        closeSize: entry.dismissible ? 26 : undefined,
      }),
    }
  })
}

export class RenderNotificationToast extends RenderBox implements InteractiveRenderObject {
  static override debugTypeName = 'RenderNotificationToast'
  private _entry: NotificationStoreEntry
  private _style: NotificationStyle
  private readonly _callbacks: NotificationToastCallbacks
  private readonly _enterAnimation: AnimationController
  private readonly _exitAnimation: AnimationController
  private _actionButton?: NotificationButton
  private _closeButton?: NotificationIconButton
  private _toastLayout: NotificationToastLayoutModel
  private _focusRegistration?: AuxiliaryFocusRootRegistration
  private _exitStarted = false

  constructor(
    entry: NotificationStoreEntry,
    style: NotificationStyle,
    motion: ThemeMotionTokens,
    callbacks: NotificationToastCallbacks,
    layout: NotificationToastLayoutModel,
  ) {
    super()
    this._entry = entry
    this._style = style
    this._callbacks = callbacks
    this._toastLayout = layout
    this._enterAnimation = new AnimationController({ duration: motion.normalDuration, curve: Curves.easeOut })
    this._exitAnimation = new AnimationController({ duration: motion.slowDuration, curve: Curves.easeIn })
    this._enterAnimation.addListener(() => this.markNeedsPaint())
    this._exitAnimation.addListener(() => this.markNeedsPaint())
    this._enterAnimation.addStatusListener(status => {
      if (status === 'completed') this._callbacks.markVisible(this._entry.id)
    })
    this._syncControls()
    this._enterAnimation.forward()
  }

  get entry(): NotificationStoreEntry { return this._entry }

  update(entry: NotificationStoreEntry, style: NotificationStyle, layout: NotificationToastLayoutModel): void {
    this._entry = entry
    this._style = style
    this._toastLayout = layout
    this._syncControls()
    if (entry.state === 'closing' && !this._exitStarted) {
      this._exitStarted = true
      this._exitAnimation.forward()
    }
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    if (this._actionButton) visitor(this._actionButton)
    if (this._closeButton) visitor(this._closeButton)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    this.size = constrainSize(constraints, {
      width: constraints.maxWidth,
      height: constraints.maxHeight,
    })
    if (this._closeButton && this._toastLayout.closeRect) {
      const rect = this._toastLayout.closeRect
      this._closeButton.layout({
        minWidth: rect.width,
        maxWidth: rect.width,
        minHeight: rect.height,
        maxHeight: rect.height,
      }, true, context)
      this._closeButton.offset = rect
    }
    if (this._actionButton && this._toastLayout.actionRect) {
      const rect = this._toastLayout.actionRect
      this._actionButton.layout({
        minWidth: rect.width,
        maxWidth: rect.width,
        minHeight: rect.height,
        maxHeight: rect.height,
      }, true, context)
      this._actionButton.offset = rect
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const style = this._style
    const enter = this._enterAnimation.value
    const exit = this._exitAnimation.value
    const alpha = enter * (1 - exit)
    const slideX = this._entry.motionKind === 'legacy-slide'
      ? (1 - enter) * (this.size.width + style.margin)
      : 0
    const x = offset.x + slideX
    const y = offset.y
    const dl = new DrawList(context)
    const accent = style.accents[this._entry.type]
    const bg = { ...style.bgColor, a: style.bgColor.a * alpha }

    dl.outerShadow(x, y, this.size.width, this.size.height, style.shadowBlur,
      { ...style.shadowColor, a: style.shadowColor.a * alpha }, style.borderRadius,
      style.shadowOffsetX, style.shadowOffsetY)
    dl.fillRect(x, y, this.size.width, this.size.height, bg, style.borderRadius)

    const canvas = context.ctx
    canvas.save()
    canvas.globalAlpha = alpha
    canvas.beginPath()
    canvas.roundRect(x, y, style.accentWidth, this.size.height, [style.borderRadius, 0, 0, style.borderRadius])
    canvas.fillStyle = `rgba(${accent.r},${accent.g},${accent.b},1)`
    canvas.fill()
    canvas.restore()

    dl.strokeRect(x, y, this.size.width, this.size.height,
      { ...style.borderColor, a: style.borderColor.a * alpha }, style.borderWidth, style.borderRadius)

    dl.pushClip(x, y, this.size.width, this.size.height)
    const layout = this._toastLayout
    const iconX = x + layout.iconRect.x
    const iconY = y + layout.iconRect.y
    paintIconGlyph(context, {
      name: TYPE_ICONS[this._entry.type],
      x: iconX,
      y: iconY,
      size: style.iconFontSize,
      color: { ...accent, a: alpha },
    })

    const textX = x + layout.titleRect.x
    const titleY = y + layout.titleRect.y + layout.titleRect.height / 2
    paintSingleLineText(dl, {
      text: this._entry.title,
      x: textX,
      y: titleY,
      maxWidth: layout.titleRect.width,
      color: { ...style.titleText, a: style.titleText.a * alpha },
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      baseline: 'middle',
    })

    if (layout.messageLines.length > 0) {
      const lineHeight = style.messageFontSize * 1.25
      const firstY = y + layout.messageRect.y + lineHeight / 2
      for (let index = 0; index < layout.messageLines.length; index += 1) {
        dl.fillText(layout.messageLines[index]!, textX, firstY + index * lineHeight,
          { ...style.messageText, a: style.messageText.a * alpha * 0.85 },
          style.messageFontSize, style.fontFamily, 'left', 'middle')
      }
    }
    canvas.save()
    canvas.globalAlpha = alpha
    super.performPaint(context, { x, y })
    canvas.restore()
    dl.popClip()
  }

  override hitTest(point: Offset): boolean {
    if (!this._isInteractive()) return false
    return super.hitTest(point)
  }

  onPointerEnter(_event: PointerEvent): void {
    this._callbacks.pause(this._entry.id, 'hover', true)
  }

  onPointerLeave(_event: PointerEvent): void {
    this._callbacks.pause(this._entry.id, 'hover', false)
  }

  handleUnhandledKeyDownFromDescendant(_target: unknown, event: KeyboardEvent): boolean {
    if (event.key !== 'Escape') return false
    event.preventDefault()
    this._callbacks.close(this._entry.id)
    return true
  }

  override dispose(): void {
    this._focusRegistration?.dispose()
    this._focusRegistration = undefined
    this._enterAnimation.dispose()
    this._exitAnimation.dispose()
    this._actionButton?.dispose()
    this._closeButton?.dispose()
    this._actionButton = undefined
    this._closeButton = undefined
    super.dispose()
  }

  private _syncControls(): void {
    const nextInteractive = !!(this._entry.action || this._entry.dismissible)
    if (!nextInteractive && this._focusRegistration) {
      this._focusRegistration.dispose()
      this._focusRegistration = undefined
    }
    if (this._entry.action && !this._actionButton) {
      this._actionButton = new NotificationButton({
        label: this._entry.action.label,
        variant: 'text',
        onClick: () => this._callbacks.invokeAction(this._entry.id),
      }, () => this, focused => this._callbacks.pause(this._entry.id, 'focus', focused))
      this._actionButton.parent = this
    }
    this._actionButton?.setLoading(this._entry.actionPending)
    if (this._entry.dismissible && !this._closeButton) {
      this._closeButton = new NotificationIconButton({
        icon: 'close',
        variant: 'text',
        size: 26,
        onClick: () => this._callbacks.close(this._entry.id),
        tooltip: '关闭',
      }, () => this, focused => this._callbacks.pause(this._entry.id, 'focus', focused))
      this._closeButton.parent = this
    } else if (!this._entry.dismissible && this._closeButton) {
      this._closeButton.parent = undefined
      this._closeButton.dispose()
      this._closeButton = undefined
    }
    if (nextInteractive && !this._focusRegistration) {
      this._focusRegistration = FocusManager.instance.registerAuxiliaryRoot(this, { order: this._entry.generation })
    } else if (nextInteractive) {
      this._focusRegistration?.updateOrder(this._entry.generation)
    }
  }

  private _isInteractive(): boolean {
    return this._entry.state !== 'removed' && !!(this._entry.action || this._entry.dismissible)
  }

}

export class RenderNotificationSurface extends RenderBox {
  static override debugTypeName = 'RenderNotificationSurface'
  private _cards: RenderNotificationToast[] = []
  private _placements: ReadonlyArray<{ rect: { width: number; height: number } }> = []

  sync(
    presentations: readonly NotificationToastPresentation[],
    style: NotificationStyle,
    motion: ThemeMotionTokens,
    placements: ReadonlyArray<{ rect: { x: number; y: number; width: number; height: number } }>,
    viewportOffset: Offset,
    callbacks: NotificationToastCallbacks,
  ): void {
    this._placements = placements
    const entries = presentations.map(presentation => presentation.entry)
    this.prune(entries)
    const byEntry = new Map(this._cards.map(card => [card.entry, card]))
    this._cards = presentations.map(presentation => {
      const { entry, layout } = presentation
      const existing = byEntry.get(entry)
      const card = existing ?? new RenderNotificationToast(entry, style, motion, callbacks, layout)
      if (!existing) card.parent = this
      card.update(entry, style, layout)
      return card
    })
    for (let index = 0; index < this._cards.length; index += 1) {
      const placement = placements[index]
      if (!placement) continue
      this._cards[index]!.offset = {
        x: placement.rect.x - viewportOffset.x,
        y: placement.rect.y - viewportOffset.y,
      }
    }
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  prune(entries: readonly NotificationStoreEntry[]): void {
    const live = new Set(entries)
    for (const card of [...this._cards]) {
      if (live.has(card.entry)) continue
      this._removeCard(card)
    }
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    for (const card of this._cards) visitor(card)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    this.size = constrainSize(constraints, { width: constraints.maxWidth, height: constraints.maxHeight })
    for (let index = 0; index < this._cards.length; index += 1) {
      const card = this._cards[index]!
      const rect = this._placements[index]?.rect
      if (!rect) continue
      card.layout({
        minWidth: rect.width,
        maxWidth: rect.width,
        minHeight: rect.height,
        maxHeight: rect.height,
      }, true, context)
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    super.performPaint(context, offset)
  }

  override hitTest(_point: Offset): boolean {
    return false
  }

  override dispose(): void {
    for (const card of [...this._cards]) this._removeCard(card)
    super.dispose()
  }

  private _removeCard(card: RenderNotificationToast): void {
    const index = this._cards.indexOf(card)
    if (index >= 0) this._cards.splice(index, 1)
    card.parent = undefined
    card.dispose()
  }
}
