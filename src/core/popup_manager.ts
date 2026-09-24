import type { Offset, Rect, RenderObject } from '../core/render_object'
import { isPrimaryPointerButton, type PointerEvent, type WheelPointerEvent } from '../gestures/hit_test'
import {
  pointerKey,
  type PointerKey,
} from '../gestures/pointer_identity'
import { ImGuiDarkTheme } from '../theme/default_theme'
import type { ResolvedTheme } from '../theme/theme'
import { FocusManager, FocusScope, FocusScopeType, type Focusable } from './focus_manager'
import { OverlayInvalidator, type OverlayPaintInvalidator } from './overlay_invalidator'

export interface PopupViewport {
  x?: number
  y?: number
  width: number
  height: number
  dpr: number
}

export interface PopupContext {
  theme: ResolvedTheme
  viewport: PopupViewport
  setCursor?: (cursor: string) => void
}

export interface Popup {
  hitTest(point: Offset, context: PopupContext): boolean
  close(): void
  ownsCursor?(): boolean
  syncCursor?(context: PopupContext): boolean
  onPointerDown?(event: PointerEvent, context: PopupContext): void
  onPointerMove?(event: PointerEvent, context: PopupContext): void
  onPointerUp?(event: PointerEvent, context: PopupContext): void
  onPointerCancel?(event: PointerEvent, context: PopupContext): void
  onWheel?(event: WheelPointerEvent, context: PopupContext): boolean | void
  onOutsidePointerDown?(event: PointerEvent, context: PopupContext): boolean | void
  onEscape?(event: KeyboardEvent): boolean | void
  onKeyDown?(event: KeyboardEvent): boolean | void
  focusRoots?(context: PopupContext): readonly RenderObject[]
}

export interface PopupOpenOptions {
  anchorMode?: PopupAnchorMode
  anchorRoot?: RenderObject
  closeExisting?: boolean
  closeOnTransient?: boolean
  interactionMode?: PopupInteractionMode
  interactive?: boolean
  owner?: object
  parent?: Popup
  persistent?: boolean
}

export type PopupPaintInvalidator = OverlayPaintInvalidator
export type PopupAnchorMode = 'stable' | 'dynamic'
export type PopupInteractionMode = 'passive' | 'nonmodal' | 'popup'
export type PopupContextProvider = (
  anchorRoot?: RenderObject,
  anchorMode?: PopupAnchorMode,
) => PopupContext

interface PopupStackEntry {
  anchorMode: PopupAnchorMode
  anchorRoot?: RenderObject
  popup: Popup
  closeOnTransient: boolean
  interactionMode: PopupInteractionMode
  owner?: object
  parent?: Popup
  persistent: boolean
}

interface PopupHit {
  context: PopupContext
  entry: PopupStackEntry
  popup: Popup
}

const PENDING_POINTER_SEQUENCE_OWNER = Symbol('pending-pointer-sequence-owner')
const INVALIDATED_POPUP_HIT = Symbol('invalidated-popup-hit')

type PointerSequenceOwner =
  | PopupStackEntry
  | null
  | typeof PENDING_POINTER_SEQUENCE_OWNER

type PopupHitResult = PopupHit | null | typeof INVALIDATED_POPUP_HIT

const DEFAULT_POPUP_CONTEXT: PopupContext = {
  theme: ImGuiDarkTheme,
  viewport: { width: 9999, height: 9999, dpr: 1 },
  setCursor: () => {},
}

const MAX_ANCHORED_CLOSE_PASSES = 100

export function popupViewportRect(contextOrViewport: PopupContext | PopupViewport): Rect {
  const viewport = 'viewport' in contextOrViewport
    ? contextOrViewport.viewport
    : contextOrViewport
  return {
    x: viewport.x ?? 0,
    y: viewport.y ?? 0,
    width: viewport.width,
    height: viewport.height,
  }
}

export function isPointInsidePopupViewport(point: Offset, context: PopupContext): boolean {
  const viewport = popupViewportRect(context)
  return point.x >= viewport.x &&
    point.x <= viewport.x + viewport.width &&
    point.y >= viewport.y &&
    point.y <= viewport.y + viewport.height
}

export function clampRectToPopupViewport(
  rect: Rect,
  contextOrViewport: PopupContext | PopupViewport,
  inset = 0,
): Rect {
  const viewport = popupViewportRect(contextOrViewport)
  const minX = viewport.x + inset
  const minY = viewport.y + inset
  const maxX = Math.max(minX, viewport.x + viewport.width - inset - rect.width)
  const maxY = Math.max(minY, viewport.y + viewport.height - inset - rect.height)
  return {
    ...rect,
    x: Math.min(maxX, Math.max(minX, rect.x)),
    y: Math.min(maxY, Math.max(minY, rect.y)),
  }
}

export function clampXToPopupViewport(
  x: number,
  width: number,
  contextOrViewport: PopupContext | PopupViewport,
  inset = 0,
): number {
  const viewport = popupViewportRect(contextOrViewport)
  const minX = viewport.x + inset
  const maxX = Math.max(minX, viewport.x + viewport.width - inset - width)
  return Math.min(maxX, Math.max(minX, x))
}

export function clampYToPopupViewport(
  y: number,
  height: number,
  contextOrViewport: PopupContext | PopupViewport,
  inset = 0,
): number {
  const viewport = popupViewportRect(contextOrViewport)
  const minY = viewport.y + inset
  const maxY = Math.max(minY, viewport.y + viewport.height - inset - height)
  return Math.min(maxY, Math.max(minY, y))
}

export class PopupManager {
  private static _instance: PopupManager | null = null

  static get instance(): PopupManager {
    if (!PopupManager._instance) PopupManager._instance = new PopupManager()
    return PopupManager._instance
  }

  static disposeInstance(): void {
    PopupManager._instance?.dispose()
  }

  private _stack: PopupStackEntry[] = []
  private _popupScope: FocusScope | null = null
  private _previousFocus: Focusable | null = null
  private _contextProvider?: PopupContextProvider
  private _anchorRootProvider?: () => RenderObject | null | undefined
  private _contextPopup?: Popup
  private _contextAnchorMode: PopupAnchorMode = 'stable'
  private _contextAnchorRoot?: RenderObject
  private readonly _pointerCaptures = new Map<PointerKey, PopupStackEntry>()
  private readonly _pointerSequenceOwners = new Map<PointerKey, PointerSequenceOwner>()
  private readonly _pointerSequenceGenerations = new Map<PointerKey, number>()
  private readonly _pointerHoverOwners = new Map<PointerKey, PopupStackEntry>()
  private readonly _terminatingPointers = new Set<PointerKey>()
  private _nextPointerSequenceGeneration = 0
  private _disposing = false
  private _disposed = false

  private constructor() {}

  setPaintInvalidator(invalidator?: PopupPaintInvalidator): void {
    OverlayInvalidator.instance.setPaintInvalidator(invalidator)
  }

  setContextProvider(provider?: PopupContextProvider): void {
    this._contextProvider = provider
  }

  setAnchorRootProvider(provider?: () => RenderObject | null | undefined): void {
    this._anchorRootProvider = provider
  }

  get context(): PopupContext {
    return this._context(this._contextPopup ?? this.current ?? undefined)
  }

  contextFor(popup: Popup): PopupContext {
    return this._context(popup)
  }

  withContextFor<T>(
    popup: Popup,
    action: () => T,
    anchorRoot: RenderObject | undefined = this._entry(popup)?.anchorRoot,
    anchorMode: PopupAnchorMode = this._entry(popup)?.anchorMode ?? 'stable',
  ): T {
    const previousPopup = this._contextPopup
    const previousAnchorMode = this._contextAnchorMode
    const previousAnchorRoot = this._contextAnchorRoot
    this._contextPopup = popup
    this._contextAnchorMode = anchorMode
    this._contextAnchorRoot = anchorRoot
    try {
      return action()
    } finally {
      this._contextPopup = previousPopup
      this._contextAnchorMode = previousAnchorMode
      this._contextAnchorRoot = previousAnchorRoot
    }
  }

  requestPaint(fallback?: () => void): void {
    OverlayInvalidator.instance.requestPaint(fallback)
  }

  syncCurrentCursor(): void {
    if (this._disposed) return
    const popup = this.current
    if (
      !popup ||
      popup.ownsCursor?.() !== true ||
      typeof popup.syncCursor !== 'function'
    ) return
    const context = this._context(popup)
    this.withContextFor(
      popup,
      () => popup.syncCursor!(context),
    )
  }

  open(popup: Popup, options: PopupOpenOptions = {}): void {
    if (this._disposed) return
    if (options.interactionMode !== undefined && options.interactive !== undefined) {
      throw new Error('Popup interactionMode and legacy interactive cannot be used together.')
    }
    const hoverPointerKeys = [...this._pointerHoverOwners.entries()]
      .filter(([, entry]) => entry.popup === popup)
      .map(([key]) => key)
    this._removeBeforeReopen(popup)
    if (options.closeExisting) this._closeEntries(this._transientEntriesToClose())
    const parent = this._normalizeParent(options.parent)
    const parentEntry = parent ? this._entry(parent) : undefined
    const interactionMode = options.interactionMode ??
      (options.interactive === undefined ? 'popup' : options.interactive ? 'popup' : 'passive')
    const anchorMode = options.anchorMode ?? parentEntry?.anchorMode ?? 'stable'
    const contextAnchorRoot = this._contextPopup && anchorMode === 'stable'
      ? this._contextAnchorRoot
      : undefined
    const entry: PopupStackEntry = {
      anchorMode,
      anchorRoot: options.anchorRoot ??
        parentEntry?.anchorRoot ??
        contextAnchorRoot ??
        (anchorMode === 'stable' ? this._anchorRootProvider?.() ?? undefined : undefined),
      popup,
      closeOnTransient: options.closeOnTransient ?? interactionMode !== 'nonmodal',
      interactionMode,
      owner: options.owner,
      parent,
      persistent: options.persistent ?? false,
    }
    this._insertEntry(entry)
    for (const key of hoverPointerKeys) this._pointerHoverOwners.set(key, entry)
    this._syncPopupScope()
  }

  closeAll(): void {
    this._closeEntries([...this._stack])
  }

  closeTransient(): void {
    this._closeEntries(this._transientEntriesToClose())
  }

  handlePointerDown(event: PointerEvent): boolean {
    const key = pointerKey(event)
    if (this._terminatingPointers.has(key)) {
      this._beginBlockedPointerSequence(key)
      return true
    }
    if (!isPrimaryPointerButton(event)) return false
    if (this._stack.length === 0) return false
    const generation = ++this._nextPointerSequenceGeneration
    this._pointerCaptures.delete(key)
    this._pointerSequenceOwners.set(key, PENDING_POINTER_SEQUENCE_OWNER)
    this._pointerSequenceGenerations.set(key, generation)
    try {
      this._syncPopupFocusables()
      if (!this._isPointerSequenceCurrent(key, generation)) return true
      const hit = this._findTopmostHit(event.position)
      if (!this._isPointerSequenceCurrent(key, generation)) return true
      if (hit === INVALIDATED_POPUP_HIT) {
        this._pointerSequenceOwners.set(key, null)
        return true
      }
      if (hit) {
        this._pointerSequenceOwners.set(key, hit.entry)
        const liveIndex = this._stack.indexOf(hit.entry)
        if (liveIndex < 0) {
          this._pointerSequenceOwners.set(key, null)
          return true
        }
        const nonmodal = hit.entry.interactionMode === 'nonmodal'
        if (!nonmodal) this._closeInteractiveAbove(liveIndex, event)
        if (
          !this._isPointerSequenceCurrent(key, generation) ||
          !this._stack.includes(hit.entry) ||
          this._pointerSequenceOwners.get(key) !== hit.entry ||
          (!nonmodal && this._currentEntry() !== hit.entry)
        ) {
          if (this._isPointerSequenceCurrent(key, generation)) {
            this._pointerCaptures.delete(key)
            this._pointerSequenceOwners.set(key, null)
          }
          return true
        }
        const context = this._context(hit.popup)
        this.withContextFor(hit.popup, () => {
          hit.popup.onPointerDown?.(
            this._pointerEventForPopup(event, hit.entry, generation),
            context,
          )
        })
        return true
      }

      const popup = this.current
      if (!popup) {
        this._clearPointerSequenceIfCurrent(key, generation)
        return false
      }
      const context = this._context(popup)
      if (!isPointInsidePopupViewport(event.position, context)) {
        this._clearPointerSequenceIfCurrent(key, generation)
        return false
      }
      this._pointerSequenceOwners.set(key, null)
      const consumed = this._handleOutsidePointerDown(event)
      if (!this._isPointerSequenceCurrent(key, generation)) return consumed
      if (!consumed) this._clearPointerSequenceIfCurrent(key, generation)
      return consumed
    } catch (error) {
      this._clearPointerSequenceIfCurrent(key, generation)
      throw error
    }
  }

  handlePointerMove(event: PointerEvent): boolean {
    const key = pointerKey(event)
    const generation = this._pointerSequenceGenerations.get(key)
    if (this._terminatingPointers.has(key)) return true
    if (this._hasPendingSequenceOwner(key)) return true
    if (this._hasClosedSequenceOwner(key)) return true
    const sequenceOwnerEntry =
      this._capturedEntry(key) ??
      this._sequenceOwnerEntry(key)
    if (sequenceOwnerEntry) {
      const sequenceOwner = sequenceOwnerEntry.popup
      const context = this._context(sequenceOwner)
      const ownedCursorBeforeMove = sequenceOwner.ownsCursor?.() === true
      this.withContextFor(sequenceOwner, () => {
        sequenceOwner.onPointerMove?.(
          this._pointerEventForPopup(event, sequenceOwnerEntry, generation),
          context,
        )
      })
      if (
        !ownedCursorBeforeMove &&
        sequenceOwner.ownsCursor?.() !== true
      ) {
        context.setCursor?.('default')
      }
      return true
    }
    const hit = this._findTopmostHit(event.position)
    if (hit === INVALIDATED_POPUP_HIT) return true
    const popupEntry = hit?.entry ?? this._currentEntry()
    const previousHoverOwner = this._pointerHoverOwners.get(key)
    if (previousHoverOwner && previousHoverOwner !== popupEntry) {
      this._pointerHoverOwners.delete(key)
      if (this._stack.includes(previousHoverOwner)) {
        this._dispatchPointerMove(previousHoverOwner, event, generation)
      }
    }
    if (!popupEntry) return false
    if (!this._stack.includes(popupEntry)) return false
    const context = hit?.context ?? this._context(popupEntry.popup)
    if (!isPointInsidePopupViewport(event.position, context)) return false
    this._dispatchPointerMove(popupEntry, event, generation, context)
    if (hit && this._stack.includes(popupEntry) && popupEntry.popup.onPointerMove) {
      this._pointerHoverOwners.set(key, popupEntry)
    } else {
      this._pointerHoverOwners.delete(key)
    }
    return true
  }

  handlePointerUp(event: PointerEvent): void {
    const key = pointerKey(event)
    const generation = this._pointerSequenceGenerations.get(key)
    if (this._terminatingPointers.has(key)) return
    if (this._hasPendingSequenceOwner(key)) {
      if (generation !== undefined) this._clearPointerSequenceIfCurrent(key, generation)
      return
    }
    if (this._hasClosedSequenceOwner(key)) {
      this._pointerCaptures.delete(key)
      this._pointerSequenceOwners.delete(key)
      this._pointerSequenceGenerations.delete(key)
      return
    }
    const sequenceOwnerEntry =
      this._capturedEntry(key) ??
      this._sequenceOwnerEntry(key)
    if (sequenceOwnerEntry) {
      const sequenceOwner = sequenceOwnerEntry.popup
      const context = this._context(sequenceOwner)
      this._terminatingPointers.add(key)
      try {
        this.withContextFor(sequenceOwner, () => {
          sequenceOwner.onPointerUp?.(
            this._pointerEventForPopup(event, sequenceOwnerEntry, generation),
            context,
          )
        })
      } finally {
        this._clearTerminalPointerSequenceIfCurrent(key, generation)
        this._terminatingPointers.delete(key)
      }
      return
    }
    const hit = this._findTopmostHit(event.position)
    if (hit === INVALIDATED_POPUP_HIT) {
      if (generation !== undefined) this._clearPointerSequenceIfCurrent(key, generation)
      return
    }
    const popup = hit?.popup ?? this.current
    if (!popup) return
    const context = hit?.context ?? this._context(popup)
    if (!isPointInsidePopupViewport(event.position, context)) return
    const popupEntry = hit?.entry ?? this._entry(popup)
    if (!popupEntry) return
    this._terminatingPointers.add(key)
    try {
      this.withContextFor(popup, () => {
        popup.onPointerUp?.(
          this._pointerEventForPopup(event, popupEntry, generation),
          context,
        )
      })
    } finally {
      this._clearTerminalPointerSequenceIfCurrent(key, generation)
      this._terminatingPointers.delete(key)
    }
  }

  handlePointerCancel(event: PointerEvent): boolean {
    const key = pointerKey(event)
    const generation = this._pointerSequenceGenerations.get(key)
    if (this._terminatingPointers.has(key)) return true
    if (this._hasPendingSequenceOwner(key)) {
      if (generation !== undefined) this._clearPointerSequenceIfCurrent(key, generation)
      return true
    }
    if (this._hasClosedSequenceOwner(key)) {
      this._pointerCaptures.delete(key)
      this._pointerSequenceOwners.delete(key)
      this._pointerSequenceGenerations.delete(key)
      return true
    }
    const hoverOwner = this._pointerHoverOwners.get(key)
    this._pointerHoverOwners.delete(key)
    const popupEntry =
      this._capturedEntry(key) ??
      this._sequenceOwnerEntry(key) ??
      (hoverOwner && this._stack.includes(hoverOwner) ? hoverOwner : null) ??
      this._currentEntry()
    if (!popupEntry) return false
    const popup = popupEntry.popup
    this._terminatingPointers.add(key)
    try {
      const context = this._context(popup)
      this.withContextFor(popup, () => {
        popup.onPointerCancel?.(
          this._pointerEventForPopup(event, popupEntry, generation),
          context,
        )
      })
    } finally {
      this._clearTerminalPointerSequenceIfCurrent(key, generation)
      this._terminatingPointers.delete(key)
    }
    return true
  }

  isInteractiveAt(position: Offset): boolean {
    const hit = this._findTopmostHit(position)
    return hit !== null
  }

  handleWheel(event: WheelPointerEvent): boolean {
    const key = pointerKey(event)
    if (this._terminatingPointers.has(key)) return true
    if (this._hasPendingSequenceOwner(key)) return true
    if (this._hasClosedSequenceOwner(key)) return true
    const sequenceOwnerEntry = this._sequenceOwnerEntry(key)
    const sequenceOwner = sequenceOwnerEntry?.popup
    if (sequenceOwner && typeof sequenceOwner.onWheel === 'function') {
      const context = this._context(sequenceOwner)
      const consumed = this.withContextFor(
        sequenceOwner,
        () => sequenceOwner.onWheel!(event, context) !== false,
      )
      if (consumed) return true
    }
    const hit = this._findTopmostHit(event.position)
    if (hit === INVALIDATED_POPUP_HIT) return true
    if (hit?.popup === sequenceOwner) return false
    if (!hit || typeof hit.popup.onWheel !== 'function') return false
    return this.withContextFor(hit.popup, () => hit.popup.onWheel!(event, hit.context) !== false)
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    this._syncPopupFocusables()
    const popup = this.current
    if (!popup) return false
    if (event.key === 'Escape') return this.handleEscape(event)
    return this.withContextFor(popup, () => popup.onKeyDown?.(event) === true)
  }

  handleEscape(event: KeyboardEvent): boolean {
    const popup = this.current
    if (!popup) return false
    const result = this.withContextFor(popup, () => popup.onEscape?.(event))
    if (result === true) return true
    if (result === false) return false
    return this.closeTop()
  }

  dismiss(popup: Popup): void {
    const subtree = this._subtreeEntries(popup)
    if (subtree.length === 0) return
    this._removeEntries(subtree)
    for (const entry of [...subtree].reverse()) {
      if (entry.popup === popup) continue
      this._closePopupEntry(entry)
    }
    this._syncPopupScope()
  }

  closeOwnedBy(owner: object): boolean {
    return this.closeOwnedByAny(new Set([owner]))
  }

  /** @internal Closes one stack snapshot for a set of render-tree owners. */
  closeOwnedByAny(owners: ReadonlySet<object>): boolean {
    const roots = this._ownedRootsAny(owners)
    return this._closeRoots(roots)
  }

  bringToFront(popup: Popup): void {
    const root = this._rootEntry(popup)
    if (!root) return
    const subtree = this._subtreeEntries(root.popup)
    if (subtree.length === 0) return
    this._removeEntries(subtree, false)
    this._stack.push(...subtree)
    this._syncPopupScope()
  }

  closeTop(): boolean {
    const popup = this.current
    return popup ? this._closeRoots([popup]) : false
  }

  get current(): Popup | null {
    for (let i = this._stack.length - 1; i >= 0; i--) {
      const entry = this._stack[i]!
      if (entry.interactionMode === 'popup') return entry.popup
    }
    return null
  }

  get top(): Popup | null { return this._stack[this._stack.length - 1]?.popup ?? null }
  get hasOpen(): boolean { return this._stack.some(entry => entry.interactionMode === 'popup') }
  get hasOverlays(): boolean { return this._stack.length > 0 }
  get stack(): readonly Popup[] { return this._stack.map(entry => entry.popup) }

  dispose(): void {
    if (this._disposed || this._disposing) return
    this._disposing = true
    let firstError: unknown
    const attempt = (callback: () => void): void => {
      try {
        callback()
      } catch (error) {
        firstError ??= error
      }
    }

    attempt(() => {
      OverlayInvalidator.instance.suppressPaint(() => {
        let passes = 0
        while (this._stack.length > 0 || this._popupScope) {
          if (passes >= MAX_ANCHORED_CLOSE_PASSES) {
            this._reportPopupCallbackError(
              'dispose',
              new Error('PopupManager stopped a reentrant popup disposal chain.'),
            )
            break
          }
          if (this._stack.length > 0) {
            try {
              this._drainPopupsForDispose()
            } catch (error) {
              firstError ??= error
            }
          }
          if (this._popupScope) {
            try {
              this._releasePopupScope()
            } catch (error) {
              firstError ??= error
            }
          }
          passes++
        }
      })
    })
    this._disposed = true
    this._stack = []
    this._pointerCaptures.clear()
    this._pointerSequenceOwners.clear()
    this._pointerSequenceGenerations.clear()
    this._pointerHoverOwners.clear()
    this._terminatingPointers.clear()
    attempt(() => this._releasePopupScope())
    this._contextProvider = undefined
    this._anchorRootProvider = undefined
    attempt(() => OverlayInvalidator.instance.setPaintInvalidator(undefined))
    this._disposing = false
    if (PopupManager._instance === this) PopupManager._instance = null

    if (firstError !== undefined) throw firstError
  }

  private _drainPopupsForDispose(): void {
    let passes = 0
    while (this._stack.length > 0) {
      const entries = [...this._stack]
      this._removeEntries(entries)
      if (passes >= MAX_ANCHORED_CLOSE_PASSES) {
        this._reportPopupCallbackError(
          'dispose',
          new Error('PopupManager stopped a reentrant popup disposal chain.'),
        )
        return
      }
      for (const entry of [...entries].reverse()) {
        this._closePopupEntry(entry)
      }
      passes++
    }
  }

  private _context(popup?: Popup): PopupContext {
    const entry = popup ? this._entry(popup) : undefined
    const usesExecutionContext = popup === this._contextPopup
    const anchorRoot = usesExecutionContext
      ? this._contextAnchorRoot
      : entry?.anchorRoot
    const anchorMode = usesExecutionContext
      ? this._contextAnchorMode
      : entry?.anchorMode ?? 'stable'
    return this._contextProvider?.(anchorRoot, anchorMode) ?? DEFAULT_POPUP_CONTEXT
  }

  private _normalizeParent(parent?: Popup): Popup | undefined {
    if (!parent) return undefined
    return this._entry(parent) ? parent : undefined
  }

  private _removeEntries(entries: PopupStackEntry[], releasePointerCaptures = true): void {
    const removedEntries = new Set(entries)
    this._stack = this._stack.filter(entry => !removedEntries.has(entry))
    if (!releasePointerCaptures) return
    for (const [key, entry] of this._pointerCaptures) {
      if (removedEntries.has(entry)) this._pointerCaptures.delete(key)
    }
    for (const [key, entry] of this._pointerSequenceOwners) {
      if (
        entry !== null &&
        entry !== PENDING_POINTER_SEQUENCE_OWNER &&
        removedEntries.has(entry)
      ) {
        this._pointerSequenceOwners.set(key, null)
      }
    }
    for (const [key, entry] of this._pointerHoverOwners) {
      if (removedEntries.has(entry)) this._pointerHoverOwners.delete(key)
    }
  }

  private _dispatchPointerMove(
    entry: PopupStackEntry,
    event: PointerEvent,
    generation: number | undefined,
    context: PopupContext = this._context(entry.popup),
  ): void {
    const popup = entry.popup
    const ownedCursorBeforeMove = popup.ownsCursor?.() === true
    this.withContextFor(popup, () => {
      popup.onPointerMove?.(
        this._pointerEventForPopup(event, entry, generation),
        context,
      )
    })
    if (!ownedCursorBeforeMove && popup.ownsCursor?.() !== true) {
      context.setCursor?.('default')
    }
  }

  private _capturedEntry(key: PointerKey): PopupStackEntry | null {
    const entry = this._pointerCaptures.get(key)
    if (!entry) return null
    if (this._stack.includes(entry)) return entry
    this._pointerCaptures.delete(key)
    return null
  }

  private _sequenceOwnerEntry(key: PointerKey): PopupStackEntry | null {
    const entry = this._pointerSequenceOwners.get(key)
    if (
      entry === undefined ||
      entry === null ||
      entry === PENDING_POINTER_SEQUENCE_OWNER
    ) {
      return null
    }
    if (this._stack.includes(entry)) return entry
    this._pointerSequenceOwners.set(key, null)
    return null
  }

  private _currentEntry(): PopupStackEntry | null {
    for (let i = this._stack.length - 1; i >= 0; i--) {
      const entry = this._stack[i]!
      if (entry.interactionMode === 'popup') return entry
    }
    return null
  }

  private _hasClosedSequenceOwner(key: PointerKey): boolean {
    return this._pointerSequenceOwners.has(key) &&
      this._pointerSequenceOwners.get(key) === null
  }

  private _hasPendingSequenceOwner(key: PointerKey): boolean {
    return this._pointerSequenceOwners.get(key) === PENDING_POINTER_SEQUENCE_OWNER
  }

  private _isPointerSequenceCurrent(key: PointerKey, generation: number): boolean {
    return this._pointerSequenceGenerations.get(key) === generation
  }

  private _clearPointerSequenceIfCurrent(key: PointerKey, generation: number): void {
    if (!this._isPointerSequenceCurrent(key, generation)) return
    this._pointerCaptures.delete(key)
    this._pointerSequenceOwners.delete(key)
    this._pointerSequenceGenerations.delete(key)
  }

  private _beginBlockedPointerSequence(key: PointerKey): void {
    const generation = ++this._nextPointerSequenceGeneration
    this._pointerCaptures.delete(key)
    this._pointerSequenceOwners.set(key, null)
    this._pointerSequenceGenerations.set(key, generation)
  }

  private _clearTerminalPointerSequenceIfCurrent(
    key: PointerKey,
    generation: number | undefined,
  ): void {
    if (generation !== undefined) {
      this._clearPointerSequenceIfCurrent(key, generation)
      return
    }
    if (this._pointerSequenceGenerations.has(key)) return
    this._pointerCaptures.delete(key)
    this._pointerSequenceOwners.delete(key)
  }

  get activeAnchorRoot(): RenderObject | null {
    const popup = this.current
    return popup ? this._entry(popup)?.anchorRoot ?? null : null
  }

  closeAnchoredTo(root: RenderObject): boolean {
    let closed = false
    let passes = 0
    const closedPopups = new Set<Popup>()
    while (true) {
      const entries = this._stack.filter(entry => entry.anchorRoot === root)
      if (entries.length === 0) return closed
      const entryPopups = new Set(entries.map(entry => entry.popup))
      const roots = entries
        .filter(entry => !entry.parent || !entryPopups.has(entry.parent))
        .map(entry => entry.popup)
      const closingEntries = this._entriesForRoots(roots)
      if (closingEntries.length === 0) return closed
      if (passes >= MAX_ANCHORED_CLOSE_PASSES) {
        this._removeEntries(closingEntries)
        this._syncPopupScope()
        this._reportPopupCallbackError(
          'anchored close',
          new Error('PopupManager stopped a reentrant anchored popup close chain.'),
        )
        return true
      }
      this._removeEntries(closingEntries)
      try {
        for (const entry of [...closingEntries].reverse()) {
          if (closedPopups.has(entry.popup)) continue
          closedPopups.add(entry.popup)
          this._closePopupEntry(entry)
        }
      } finally {
        this._syncPopupScope()
      }
      closed = true
      passes++
    }
  }

  private _pointerEventForPopup(
    event: PointerEvent,
    entry: PopupStackEntry,
    generation?: number,
  ): PointerEvent {
    const key = pointerKey(event)
    const isCurrentSequence = (): boolean =>
      generation !== undefined &&
      this._pointerSequenceGenerations.get(key) === generation
    return {
      ...event,
      setPointerCapture: () => {
        if (
          isCurrentSequence() &&
          !this._terminatingPointers.has(key) &&
          this._stack.includes(entry) &&
          this._pointerSequenceOwners.get(key) === entry
        ) {
          this._pointerCaptures.set(key, entry)
        }
      },
      releasePointerCapture: () => {
        if (isCurrentSequence() && this._pointerCaptures.get(key) === entry) {
          this._pointerCaptures.delete(key)
        }
      },
      hasPointerCapture: () =>
        isCurrentSequence() &&
        this._pointerCaptures.get(key) === entry,
    }
  }

  private _insertEntry(entry: PopupStackEntry): void {
    if (entry.persistent) {
      this._stack.push(entry)
      return
    }
    const persistentIndex = this._stack.findIndex(item => item.persistent)
    if (persistentIndex < 0) {
      this._stack.push(entry)
      return
    }
    this._stack.splice(persistentIndex, 0, entry)
  }

  private _entry(popup: Popup): PopupStackEntry | undefined {
    return this._stack.find(item => item.popup === popup)
  }

  private _rootEntry(popup: Popup): PopupStackEntry | undefined {
    let entry = this._entry(popup)
    while (entry?.parent) {
      const parent = this._entry(entry.parent)
      if (!parent) break
      entry = parent
    }
    return entry
  }

  private _isDescendantOf(entry: PopupStackEntry, ancestor: Popup): boolean {
    let current = entry.parent
    while (current) {
      if (current === ancestor) return true
      current = this._entry(current)?.parent
    }
    return false
  }

  private _subtreeEntries(root: Popup): PopupStackEntry[] {
    return this._stack.filter(entry => entry.popup === root || this._isDescendantOf(entry, root))
  }

  private _interactiveTip(entries: PopupStackEntry[]): PopupStackEntry | undefined {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]!
      if (entry.interactionMode === 'popup') return entry
    }
    return undefined
  }

  private _ownedRootsAny(owners: ReadonlySet<object>): Popup[] {
    if (owners.size === 0) return []
    const roots: Popup[] = []
    const seen = new Set<Popup>()
    for (const entry of this._stack) {
      if (!entry.owner || !owners.has(entry.owner)) continue
      let root = entry
      while (root.parent) {
        const parent = this._entry(root.parent)
        if (!parent || !parent.owner || !owners.has(parent.owner)) break
        root = parent
      }
      if (seen.has(root.popup)) continue
      seen.add(root.popup)
      roots.push(root.popup)
    }
    return roots
  }

  private _closeRoots(roots: Popup[]): boolean {
    if (roots.length === 0) return false
    const entries = this._entriesForRoots(roots)
    this._closeEntries(entries)
    return true
  }

  private _entriesForRoots(roots: Popup[]): PopupStackEntry[] {
    const popups = new Set<Popup>()
    for (const root of roots) {
      for (const entry of this._subtreeEntries(root)) popups.add(entry.popup)
    }
    return this._stack.filter(entry => popups.has(entry.popup))
  }

  private _transientEntriesToClose(): PopupStackEntry[] {
    return this._stack.filter(entry =>
      !entry.persistent && entry.closeOnTransient,
    )
  }

  private _closeEntries(entries: PopupStackEntry[]): void {
    if (entries.length === 0) return
    this._removeEntries(entries)
    try {
      for (const entry of [...entries].reverse()) this._closePopupEntry(entry)
    } finally {
      this._syncPopupScope()
    }
  }

  private _removeBeforeReopen(popup: Popup): void {
    const subtree = this._subtreeEntries(popup)
    if (subtree.length === 0) return
    this._removeEntries(subtree)
    for (const entry of [...subtree].reverse()) {
      if (entry.popup === popup) continue
      this._closePopupEntry(entry)
    }
  }

  private _findTopmostHit(point: Offset): PopupHitResult {
    const stackSnapshot = [...this._stack]
    for (let i = stackSnapshot.length - 1; i >= 0; i--) {
      const entry = stackSnapshot[i]!
      if (entry.interactionMode === 'passive') continue
      if (entry.interactionMode === 'nonmodal' && FocusManager.instance.hasModalScope) continue
      const context = this._context(entry.popup)
      if (!this._isStackSnapshotCurrent(stackSnapshot)) return INVALIDATED_POPUP_HIT
      const hit = this.withContextFor(
        entry.popup,
        () => entry.popup.hitTest(point, context),
        entry.anchorRoot,
      )
      if (!this._isStackSnapshotCurrent(stackSnapshot)) return INVALIDATED_POPUP_HIT
      if (hit) return { context, entry, popup: entry.popup }
    }
    return null
  }

  private _isStackSnapshotCurrent(snapshot: readonly PopupStackEntry[]): boolean {
    return snapshot.length === this._stack.length &&
      snapshot.every((entry, index) => this._stack[index] === entry)
  }

  private _closeInteractiveAbove(index: number, event: PointerEvent): void {
    const roots: Popup[] = []
    const seen = new Set<Popup>()
    for (let i = this._stack.length - 1; i > index; i--) {
      const entry = this._stack[i]!
      if (entry.interactionMode !== 'popup') continue
      let root = entry
      while (root.parent) {
        const parent = this._entry(root.parent)
        if (!parent || this._stack.indexOf(parent) <= index) break
        root = parent
      }
      if (seen.has(root.popup)) continue
      seen.add(root.popup)
      roots.push(root.popup)
    }
    for (const root of roots) this._closeSubtreeForOutside(root, event)
  }

  private _handleOutsidePointerDown(event: PointerEvent): boolean {
    const popup = this.current
    if (!popup) return false
    const root = this._rootEntry(popup)?.popup ?? popup
    return this._closeSubtreeForOutside(root, event)
  }

  private _closeSubtreeForOutside(root: Popup, event: PointerEvent): boolean {
    const subtree = this._subtreeEntries(root)
    if (subtree.length === 0) return false
    const tip = this._interactiveTip(subtree)
    const tipContext = tip ? this._context(tip.popup) : undefined
    const reverse = [...subtree].reverse()
    this._removeEntries(subtree)

    const aboveTip: PopupStackEntry[] = []
    const belowTip: PopupStackEntry[] = []
    let pastTip = tip === undefined
    for (const entry of reverse) {
      if (tip && entry.popup === tip.popup) {
        pastTip = true
        continue
      }
      if (!pastTip) aboveTip.push(entry)
      else belowTip.push(entry)
    }

    let consumed = false
    try {
      for (const entry of aboveTip) this._closePopupEntry(entry)
      consumed = tip && tipContext
        ? this._closeForOutsidePointerDown(tip, event, tipContext)
        : false
      for (const entry of belowTip) this._closePopupEntry(entry)
    } finally {
      this._syncPopupScope()
    }
    return consumed
  }

  private _closeForOutsidePointerDown(
    entry: PopupStackEntry,
    event: PointerEvent,
    context: PopupContext,
  ): boolean {
    let result: boolean | void = undefined
    try {
      result = this.withContextFor(
        entry.popup,
        () => entry.popup.onOutsidePointerDown?.(event, context),
        entry.anchorRoot,
        entry.anchorMode,
      )
    } catch (error) {
      this._reportPopupCallbackError('outside pointer down', error)
    }
    if (result === true) return true
    this._closePopupEntry(entry)
    return false
  }

  private _closePopupEntry(entry: PopupStackEntry): void {
    try {
      this.withContextFor(
        entry.popup,
        () => entry.popup.close(),
        entry.anchorRoot,
        entry.anchorMode,
      )
    } catch (error) {
      this._reportPopupCallbackError('close', error)
    }
  }

  private _reportPopupCallbackError(role: string, error: unknown): void {
    console.error(`PopupManager popup ${role} callback failed.`, error)
  }

  private _syncPopupScope(): void {
    if (this.hasOpen) {
      this._ensurePopupScope()
      this._syncPopupFocusables()
    } else {
      this._releasePopupScope()
    }
  }

  private _ensurePopupScope(): void {
    if (this._popupScope) return
    this._popupScope = new FocusScope(FocusScopeType.Popup, event => this.handleKeyDown(event))
    this._previousFocus = FocusManager.instance.pushScope(this._popupScope)
    FocusManager.instance.clearFocus()
  }

  private _syncPopupFocusables(): void {
    if (!this._popupScope) return
    const roots = this._popupFocusRoots()
    this._popupScope.setFocusRoots(roots)
    this._popupScope.setFocusables(FocusManager.instance.focusablesWithinRoots(roots))
  }

  private _popupFocusRoots(): RenderObject[] {
    const roots: RenderObject[] = []
    for (const entry of this._stack) {
      if (entry.interactionMode !== 'popup') continue
      const context = this._context(entry.popup)
      const popupRoots = this.withContextFor(
        entry.popup,
        () => entry.popup.focusRoots?.(context) ?? [],
        entry.anchorRoot,
      )
      for (const root of popupRoots) roots.push(root)
    }
    return roots
  }

  private _releasePopupScope(): void {
    if (!this._popupScope) return
    const popupScope = this._popupScope
    const previousFocus = this._previousFocus
    this._popupScope = null
    this._previousFocus = null
    FocusManager.instance.popScope(previousFocus, popupScope)
  }
}
