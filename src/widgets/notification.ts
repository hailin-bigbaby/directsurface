import { popupViewportRect, PopupManager, type PopupContext, type PopupInteractionMode } from '../core/popup_manager'
import { PopupSurfaceShell } from '../core/popup_shell'
import { resolveThemeMotion } from '../theme/theme'
import { deriveNotificationStyle } from '../theme/component_styles'
import { calculateNotificationLayout } from './notification_layout'
import {
  NotificationStore,
  type NotificationHandle,
  type NotificationOptions,
  type NotificationPatch,
  type NotificationType,
} from './notification_store'
import { measureNotificationToastPresentations, RenderNotificationSurface } from './notification_surface'

export type {
  NotificationAction,
  NotificationCloseReason,
  NotificationHandle,
  NotificationOptions,
  NotificationPatch,
  NotificationType,
} from './notification_store'

export class NotificationManager extends PopupSurfaceShell {
  readonly overlayLayer = 'tooltip'
  readonly maxVisible = 3
  private readonly _notificationSurface: RenderNotificationSurface
  private readonly _store: NotificationStore
  private _interactionMode: PopupInteractionMode = 'passive'
  private _disposed = false

  constructor() {
    const surface = new RenderNotificationSurface()
    super(surface)
    this._notificationSurface = surface
    this._store = new NotificationStore({
      onChange: () => this._handleStoreChange(),
      exitDuration: () => resolveThemeMotion(PopupManager.instance.context.theme).slowDuration,
    })
    this.setPopupSurfaceSync((_root, popupContext) => this._syncSurface(popupContext))
  }

  get cardWidth(): number { return this._style().cardWidth }
  get cardHeight(): number { return this._style().maxCardHeight }
  get cardSpacing(): number { return this._style().cardSpacing }
  get margin(): number { return this._style().margin }
  get hasItems(): boolean { return this._store.hasItems }

  show(type: NotificationType, title: string, message = '', duration = 3000): number {
    const id = this._store.showLegacy(type, title, message, duration)
    this._reconcileCapacity()
    return id
  }

  notify(options: NotificationOptions): NotificationHandle {
    const handle = this._store.notify(options)
    this._reconcileCapacity()
    return handle
  }

  update(idOrKey: number | string, patch: NotificationPatch): boolean {
    const updated = this._store.update(idOrKey, patch)
    if (updated) this._reconcileCapacity()
    return updated
  }

  close(): void
  close(idOrKey: number | string): boolean
  close(idOrKey?: number | string): void | boolean {
    if (idOrKey === undefined) {
      this._store.closeAll('programmatic')
      return
    }
    return this._store.close(idOrKey, 'programmatic')
  }

  override onEscape(event: KeyboardEvent): boolean {
    const current = this._store.newestFirst.find(entry => entry.dismissible)
    if (!current) return false
    event.preventDefault()
    return this._store.close(current.id, 'dismiss')
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this._store.dispose()
    this.disposePopupSurface()
  }

  private _handleStoreChange(): void {
    this._notificationSurface.prune(this._store.entries)
    if (!this._store.hasItems) {
      if (this.popupOpen) super.close()
      return
    }
    if (!this._ensureOverlayMode()) this.requestPopupPaint()
  }

  private _ensureOverlayMode(): boolean {
    const mode: PopupInteractionMode = this._store.entries.some(entry => entry.action || entry.dismissible)
      ? 'nonmodal'
      : 'passive'
    if (!this.popupOpen) {
      this._interactionMode = mode
      this.openPopup({ interactionMode: mode })
      return true
    }
    if (this._interactionMode === mode) return false
    this._interactionMode = mode
    PopupManager.instance.open(this, { interactionMode: mode })
    return false
  }

  private _syncSurface(popupContext: PopupContext): void {
    const viewport = popupViewportRect(popupContext)
    const measured = this._measureReconciledLayout(popupContext)
    const viewportOffset = { x: viewport.x, y: viewport.y }
    this._notificationSurface.offset = viewportOffset
    this._notificationSurface.sync(
      measured.presentations,
      measured.style,
      resolveThemeMotion(popupContext.theme),
      measured.layout.placements,
      viewportOffset,
      {
        close: id => { this._store.close(id, 'dismiss') },
        invokeAction: id => { this._store.invokeAction(id) },
        pause: (id, source, paused) => this._store.setPaused(id, source, paused),
        markVisible: id => this._store.markVisible(id),
      },
    )
    this._notificationSurface.layout({
      minWidth: viewport.width,
      maxWidth: viewport.width,
      minHeight: viewport.height,
      maxHeight: viewport.height,
    }, false, { theme: popupContext.theme })
  }

  private _reconcileCapacity(): void {
    this._measureReconciledLayout(PopupManager.instance.context)
  }

  private _measureReconciledLayout(popupContext: PopupContext) {
    let measured = this._measureLayout(popupContext)
    for (let attempt = 0; attempt < this.maxVisible + 2; attempt += 1) {
      const measuredIds = measured.presentations.map(presentation => presentation.entry.id)
      this._store.reconcileCapacity(measured.layout.effectiveCapacity)
      const currentIds = this._store.newestFirst.map(entry => entry.id)
      if (
        measuredIds.length === currentIds.length &&
        measuredIds.every((id, index) => id === currentIds[index])
      ) return measured
      measured = this._measureLayout(popupContext)
    }
    return measured
  }

  private _measureLayout(popupContext: PopupContext) {
    const style = this._style(popupContext.theme)
    const widthLayout = calculateNotificationLayout({
      viewport: popupContext.viewport,
      preferredCardWidth: style.cardWidth,
      itemHeights: [],
      spacing: style.cardSpacing,
      margin: style.margin,
      maxVisible: this.maxVisible,
    })
    const presentations = measureNotificationToastPresentations(
      this._store.newestFirst,
      style,
      popupContext.theme,
      widthLayout.cardWidth,
    )
    const layout = calculateNotificationLayout({
      viewport: popupContext.viewport,
      preferredCardWidth: style.cardWidth,
      itemHeights: presentations.map(presentation => presentation.layout.cardHeight),
      spacing: style.cardSpacing,
      margin: style.margin,
      maxVisible: this.maxVisible,
    })
    return { layout, presentations, style }
  }

  private _style(theme = PopupManager.instance.context.theme) {
    return deriveNotificationStyle(theme)
  }
}
