// FocusManager: 全局焦点管理器
// 统一管理可聚焦控件的焦点状态，支持 Tab/Shift+Tab 键盘导航
// 通过 FocusScope 支持普通焦点、模态陷阱、弹出层临时焦点
// keydown 事件通过 FocusScope 栈分发，替代全局优先级注册

import { DisposableBag } from './disposable'
import { RenderObject } from './render_object'
import { ClipboardController, isCopyShortcut, isCopyableSelection } from './clipboard'

export interface Focusable {
  focusIn(): void
  focusOut(): void
  readonly isFocused: boolean
  shouldIgnoreKeyDown?(event: KeyboardEvent): boolean
  onKeyDown?(event: KeyboardEvent): boolean | void
}

export interface AuxiliaryFocusRootRegistration {
  updateOrder(order: number): void
  dispose(options?: { restoreFocus?: boolean }): void
}

function isFocusable(value: unknown): value is Focusable {
  const candidate = value as Partial<Focusable> | null
  return !!candidate &&
    typeof candidate.focusIn === 'function' &&
    typeof candidate.focusOut === 'function' &&
    typeof candidate.isFocused === 'boolean'
}

export enum FocusScopeType {
  Normal = 'normal',
  Modal = 'modal',
  Popup = 'popup',
}

export class FocusScope {
  readonly type: FocusScopeType
  private _focusables: Focusable[] = []
  private _focusRoots: RenderObject[] = []
  private _current: Focusable | null = null
  private _focusGeneration = 0
  private readonly _onKeyDown?: (event: KeyboardEvent) => boolean | void

  constructor(type: FocusScopeType, onKeyDown?: (event: KeyboardEvent) => boolean | void) {
    this.type = type
    this._onKeyDown = onKeyDown
  }

  add(focusable: Focusable): void {
    if (!this._focusables.includes(focusable)) {
      this._focusables.push(focusable)
    }
  }

  remove(focusable: Focusable): void {
    const idx = this._focusables.indexOf(focusable)
    if (idx >= 0) {
      if (this._current === focusable) {
        this._focusGeneration++
        this._current = null
      }
      this._focusables.splice(idx, 1)
    }
  }

  setFocusables(focusables: readonly Focusable[]): void {
    this._focusables = [...focusables]
    const current = this._current
    if (!current || this._focusables.includes(current)) return
    this._focusGeneration++
    this._current = null
    current.focusOut()
  }

  setFocusRoots(roots: readonly RenderObject[]): void {
    this._focusRoots = [...roots]
  }

  contains(focusable: Focusable): boolean {
    return this._focusables.includes(focusable)
  }

  setFocus(widget: Focusable): void {
    if (!this._focusables.includes(widget)) return
    const generation = ++this._focusGeneration
    if (this._current === widget) {
      if (!widget.isFocused) {
        try {
          widget.focusIn()
        } catch (error) {
          if (
            this._focusGeneration === generation &&
            this._current === widget
          ) {
            this._current = null
            this._focusGeneration++
          }
          throw error
        }
      }
      return
    }
    const previous = this._current
    this._current = null
    let failed = false
    let firstError: unknown
    if (previous) {
      try {
        previous.focusOut()
      } catch (error) {
        failed = true
        firstError = error
      }
      if (
        this._focusGeneration !== generation ||
        this._current !== null ||
        !this._focusables.includes(widget)
      ) {
        if (failed) throw firstError
        return
      }
    }
    this._current = widget
    try {
      widget.focusIn()
    } catch (error) {
      if (
        this._focusGeneration === generation &&
        this._current === widget
      ) {
        this._current = null
        this._focusGeneration++
      }
      if (!failed) {
        failed = true
        firstError = error
      }
    }
    if (failed) throw firstError
  }

  clearFocus(): void {
    this._focusGeneration++
    const current = this._current
    if (!current) return
    this._current = null
    current.focusOut()
  }

  clearFocusOf(widget: Focusable): void {
    if (this._current !== widget) return
    this._focusGeneration++
    this._current = null
    widget.focusOut()
  }

  get current(): Focusable | null { return this._current }
  get focusables(): Focusable[] { return this._focusables }
  get focusRoots(): readonly RenderObject[] { return this._focusRoots }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (this._current && typeof this._current.onKeyDown === 'function') {
      const result = this._current.onKeyDown(event)
      if (result === true) return true
    }
    if (this._current && isCopyShortcut(event) && isCopyableSelection(this._current)) {
      const text = this._current.getCopyText()
      if (text != null) {
        void ClipboardController.instance.writeText(text)
        return true
      }
    }
    if (this._onKeyDown) {
      const result = this._onKeyDown(event)
      if (result === true) return true
    }
    return false
  }
}

export class FocusManager {
  private static _instance: FocusManager | null = null

  static get instance(): FocusManager {
    if (!FocusManager._instance) FocusManager._instance = new FocusManager()
    return FocusManager._instance
  }

  static disposeInstance(): void {
    FocusManager._instance?.dispose()
  }

  private _defaultScope = new FocusScope(FocusScopeType.Normal)
  private _scopeStack: FocusScope[] = [this._defaultScope]
  private _disposables = new DisposableBag()
  private _keyHandler: (e: KeyboardEvent) => void
  private _rootResolver?: () => RenderObject[]
  private _activeRoot?: RenderObject
  private readonly _auxiliaryRoots = new Map<RenderObject, number>()
  private _previousNonAuxiliaryFocus: Focusable | null = null

  private constructor() {
    this._keyHandler = (e: KeyboardEvent) => {
      this.handleKeyDownEvent(e)
    }
    this._disposables.listen(window, 'keydown', this._keyHandler, true)
  }

  private get _activeScope(): FocusScope {
    return this._scopeStack[this._scopeStack.length - 1]!
  }

  register(widget: Focusable): void {
    this._defaultScope.add(widget)
    for (let i = 1; i < this._scopeStack.length; i += 1) {
      const scope = this._scopeStack[i]!
      if (scope.focusRoots.length === 0) continue
      if (!(widget instanceof RenderObject)) continue
      if (this._isFocusableWithinRoots(widget, scope.focusRoots)) {
        scope.add(widget)
      }
    }
  }

  setRootResolver(resolver?: () => RenderObject[]): void {
    this._rootResolver = resolver
  }

  setActiveRoot(root?: RenderObject | null): void {
    this._activeRoot = root ?? undefined
  }

  registerAuxiliaryRoot(root: RenderObject, options: { order: number }): AuxiliaryFocusRootRegistration {
    this._auxiliaryRoots.set(root, options.order)
    let disposed = false
    return {
      updateOrder: order => {
        if (disposed || !this._auxiliaryRoots.has(root)) return
        this._auxiliaryRoots.set(root, order)
      },
      dispose: (disposeOptions = {}) => {
        if (disposed) return
        disposed = true
        const current = this._defaultScope.current
        const containedCurrent = current ? this._isWithinRoot(current, root) : false
        this._auxiliaryRoots.delete(root)
        if (!containedCurrent) return
        this._defaultScope.clearFocus()
        const restore = this._previousNonAuxiliaryFocus
        this._previousNonAuxiliaryFocus = null
        if (disposeOptions.restoreFocus === false) return
        if (this._activeScope !== this._defaultScope) return
        if (restore && this._defaultScope.contains(restore) && this._isFocusableActiveInScope(this._defaultScope, restore)) {
          this._setFocusInScope(this._defaultScope, restore)
        }
      },
    }
  }

  canFocusAuxiliaryRoot(root: RenderObject): boolean {
    return this._activeScope === this._defaultScope &&
      this._auxiliaryRoots.has(root) &&
      root.visible
  }

  get activeRoot(): RenderObject | undefined {
    return this._activeRoot
  }

  unregister(widget: Focusable): void {
    for (const scope of this._scopeStack) {
      scope.remove(widget)
    }
    if (this._previousNonAuxiliaryFocus === widget) this._previousNonAuxiliaryFocus = null
    this._clearStaleAuxiliaryRestoreCandidate()
  }

  setFocus(widget: Focusable): void {
    for (let i = this._scopeStack.length - 1; i >= 0; i--) {
      const scope = this._scopeStack[i]!
      if (scope.contains(widget)) {
        if (!this._isFocusableActiveInScope(scope, widget)) return
        this._setFocusInScope(scope, widget)
        return
      }
      if (scope.type === FocusScopeType.Modal) {
        if (this._isFocusableWithinRoots(widget, scope.focusRoots)) {
          scope.add(widget)
          this._setFocusInScope(scope, widget)
        }
        return
      }
    }
  }

  clearFocus(): void {
    for (const scope of this._scopeStack) {
      scope.clearFocus()
    }
    this._previousNonAuxiliaryFocus = null
  }

  clearFocusOf(widget: Focusable): void {
    for (const scope of this._scopeStack) {
      scope.clearFocusOf(widget)
    }
    if (this._previousNonAuxiliaryFocus === widget) this._previousNonAuxiliaryFocus = null
    this._clearStaleAuxiliaryRestoreCandidate()
  }

  clearFocusWithin(root: RenderObject): void {
    for (const scope of this._scopeStack) {
      const current = scope.current
      if (current && this._isWithinRoot(current, root)) scope.clearFocus()
    }
    if (this._previousNonAuxiliaryFocus && this._isWithinRoot(this._previousNonAuxiliaryFocus, root)) {
      this._previousNonAuxiliaryFocus = null
    }
    this._clearStaleAuxiliaryRestoreCandidate()
  }

  focusablesWithinRoots(roots: readonly RenderObject[]): Focusable[] {
    if (roots.length === 0) return []
    const activeNodes = this._activeNodesWithinRoots(roots)
    return this._defaultScope.focusables.filter(focusable =>
      focusable instanceof RenderObject && activeNodes.has(focusable),
    )
  }

  get current(): Focusable | null {
    for (let i = this._scopeStack.length - 1; i >= 0; i--) {
      const c = this._scopeStack[i]!.current
      if (c) return c
    }
    return null
  }

  pushScope(scope: FocusScope): Focusable | null {
    const prev = this._stableScopeRestoreCandidate()
    if (scope.type !== FocusScopeType.Popup) {
      this._activeScope.clearFocus()
    }
    this._scopeStack.push(scope)
    return prev
  }

  popScope(restore?: Focusable | null, expectedScope?: FocusScope): void {
    const scopeToPop = expectedScope ?? this._activeScope
    const initialIndex = this._scopeStack.lastIndexOf(scopeToPop)
    if (initialIndex <= 0) return
    let firstError: unknown
    try {
      scopeToPop.clearFocus()
    } catch (error) {
      firstError = error
    }
    const currentIndex = this._scopeStack.lastIndexOf(scopeToPop)
    if (currentIndex > 0) this._scopeStack.splice(currentIndex, 1)
    if (restore && this._activeScope.contains(restore)) {
      try {
        this._setFocusInScope(this._activeScope, restore)
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstError !== undefined) throw firstError
  }

  get scopeStack(): ReadonlyArray<FocusScope> {
    return this._scopeStack
  }

  get hasModalScope(): boolean {
    return this._scopeStack.some(scope => scope.type === FocusScopeType.Modal)
  }

  allowsKeyboardBindingSource(source?: RenderObject): boolean {
    const modalScope = this._activeModalScope()
    if (!modalScope) return true
    if (!source) return false
    return modalScope.focusRoots.some(root => this._isWithinRoot(source, root))
  }

  pushTrap(widgets: Focusable[]): Focusable | null {
    const scope = new FocusScope(FocusScopeType.Modal)
    for (const w of widgets) scope.add(w)
    return this.pushScope(scope)
  }

  refreshScopeFocusRoots(scope: FocusScope, roots: readonly RenderObject[]): void {
    scope.setFocusRoots(roots)
    const focusables = this.focusablesWithinRoots(roots)
    for (const root of roots) {
      if (isFocusable(root) && !focusables.includes(root)) focusables.push(root)
    }
    scope.setFocusables(focusables)
  }

  popTrap(restore: Focusable | null): void {
    this.popScope(restore)
  }

  handleKeyDownEvent(e: KeyboardEvent): boolean {
    this._clearInactiveFocus()
    if (this.current?.shouldIgnoreKeyDown?.(e) === true) return false

    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const dir = e.shiftKey ? -1 : 1
      for (let i = this._scopeStack.length - 1; i >= 0; i--) {
        const scope = this._scopeStack[i]!
        if (scope.handleKeyDown(e)) {
          e.preventDefault()
          e.stopImmediatePropagation()
          return true
        }
        const pool = this._orderedFocusables(scope)
        if (pool.length > 0) {
          e.preventDefault()
          e.stopImmediatePropagation()
          this._moveFocusIn(scope, dir, pool)
          return true
        }
        if (scope.type === FocusScopeType.Modal) {
          e.preventDefault()
          e.stopImmediatePropagation()
          return true
        }
      }
      return false
    }

    for (let i = this._scopeStack.length - 1; i >= 0; i--) {
      const scope = this._scopeStack[i]!
      if (scope.handleKeyDown(e)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        return true
      }
      if (scope.type === FocusScopeType.Modal) return false
    }
    const current = this.current
    if (current && this.dispatchUnhandledKeyDownFrom(current, e)) {
      e.preventDefault()
      e.stopImmediatePropagation()
      return true
    }
    return false
  }

  dispatchUnhandledEnterFrom(widget: Focusable, event: KeyboardEvent): boolean {
    if (!(widget instanceof RenderObject)) return false
    let node: RenderObject | undefined = widget.parent
    while (node) {
      const handler = (node as RenderObject & {
        handleUnhandledEnterFromDescendant?: (target: Focusable, event: KeyboardEvent) => boolean | void
      }).handleUnhandledEnterFromDescendant
      if (typeof handler === 'function' && handler.call(node, widget, event) === true) return true
      node = node.parent
    }
    return false
  }

  dispatchUnhandledKeyDownFrom(widget: Focusable, event: KeyboardEvent): boolean {
    if (!(widget instanceof RenderObject)) return false
    let node: RenderObject | undefined = widget.parent
    while (node) {
      const handler = (node as RenderObject & {
        handleUnhandledKeyDownFromDescendant?: (target: Focusable, event: KeyboardEvent) => boolean | void
      }).handleUnhandledKeyDownFromDescendant
      if (typeof handler === 'function' && handler.call(node, widget, event) === true) return true
      node = node.parent
    }
    return false
  }

  private _moveFocusIn(scope: FocusScope, dir: 1 | -1, orderedPool?: Focusable[]): void {
    const pool = orderedPool ?? this._orderedFocusables(scope)
    if (pool.length === 0) return
    const idx = scope.current ? pool.indexOf(scope.current) : -1
    let next = idx + dir
    if (next < 0) next = pool.length - 1
    if (next >= pool.length) next = 0
    const target = pool[next]
    if (target) this._setFocusInScope(scope, target)
  }

  moveFocusFrom(
    widget: Focusable,
    dir: 1 | -1,
    options: { withinRoot?: RenderObject; wrap?: boolean } = {},
  ): boolean {
    const scope = this._scopeContaining(widget)
    if (!scope) return false
    let pool = this._orderedFocusables(scope)
    if (options.withinRoot) {
      pool = pool.filter(focusable => this._isWithinRoot(focusable, options.withinRoot!))
    }
    if (pool.length === 0) return false
    const idx = pool.indexOf(widget)
    if (idx < 0) return false
    let next = idx + dir
    if (options.wrap ?? true) {
      if (next < 0) next = pool.length - 1
      if (next >= pool.length) next = 0
    } else if (next < 0 || next >= pool.length) {
      return false
    }
    const target = pool[next]
    if (!target) return false
    this._setFocusInScope(scope, target)
    return true
  }

  private _orderedFocusables(scope: FocusScope): Focusable[] {
    const pool = scope.focusables
    const roots = this._rootsForScope(scope)
    if (!roots) {
      return pool.filter(focusable =>
        !(focusable instanceof RenderObject) || this._hasVisibleAncestors(focusable),
      )
    }

    const ordered: Focusable[] = []
    const remaining = new Set(pool)
    const visited = new Set<RenderObject>()

    const visit = (node: RenderObject): void => {
      if (visited.has(node) || !node.visible) return
      visited.add(node)
      if (remaining.has(node as unknown as Focusable)) {
        ordered.push(node as unknown as Focusable)
        remaining.delete(node as unknown as Focusable)
      }
      node.visitFocusChildren(child => visit(child))
    }

    for (const root of roots) visit(root)
    return ordered
  }

  private _rootsForScope(scope: FocusScope): readonly RenderObject[] | undefined {
    if (scope.focusRoots.length > 0) return scope.focusRoots
    const resolvedRoots = this._rootResolver?.()
    let roots: readonly RenderObject[] | undefined = resolvedRoots
    if (scope === this._defaultScope && this._activeRoot) {
      if (!resolvedRoots || resolvedRoots.includes(this._activeRoot)) roots = [this._activeRoot]
    }
    if (scope !== this._defaultScope || this._auxiliaryRoots.size === 0) return roots
    const auxiliary = [...this._auxiliaryRoots.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([root]) => root)
    return [...(roots ?? []), ...auxiliary]
  }

  private _setFocusInScope(scope: FocusScope, widget: Focusable): void {
    if (!this._isFocusableActiveInScope(scope, widget)) return
    if (scope === this._defaultScope && widget instanceof RenderObject) {
      const auxiliaryRoot = this._auxiliaryRootFor(widget)
      const current = scope.current
      if (auxiliaryRoot && current && (!(current instanceof RenderObject) || !this._auxiliaryRootFor(current))) {
        this._previousNonAuxiliaryFocus = current
      } else if (!auxiliaryRoot) {
        this._previousNonAuxiliaryFocus = null
      }
    }
    scope.setFocus(widget)
    if (scope === this._defaultScope && scope.current) {
      this._syncActiveRootFor(scope.current)
    }
  }

  private _syncActiveRootFor(widget: Focusable): void {
    if (!(widget instanceof RenderObject)) return
    const roots = this._rootResolver?.()
    if (!roots) return
    const root = roots.find(candidate => this._isWithinRoot(widget, candidate))
    if (root) this._activeRoot = root
  }

  private _scopeContaining(widget: Focusable): FocusScope | null {
    for (let i = this._scopeStack.length - 1; i >= 0; i--) {
      const scope = this._scopeStack[i]!
      if (scope.contains(widget)) return scope
    }
    return null
  }

  private _stableScopeRestoreCandidate(): Focusable | null {
    const current = this._activeScope.current
    if (
      this._activeScope !== this._defaultScope ||
      !(current instanceof RenderObject) ||
      !this._auxiliaryRootFor(current)
    ) return current
    const previous = this._previousNonAuxiliaryFocus
    if (
      previous &&
      this._defaultScope.contains(previous) &&
      this._isFocusableActiveInScope(this._defaultScope, previous)
    ) return previous
    return current
  }

  private _activeModalScope(): FocusScope | null {
    for (let i = this._scopeStack.length - 1; i >= 0; i--) {
      const scope = this._scopeStack[i]!
      if (scope.type === FocusScopeType.Modal) return scope
    }
    return null
  }

  private _isFocusableWithinRoots(focusable: Focusable | RenderObject, roots: readonly RenderObject[]): boolean {
    if (roots.length === 0) return false
    if (!(focusable instanceof RenderObject)) return false
    return this._isRenderObjectActiveWithinRoots(focusable, roots)
  }

  private _isFocusableActiveInScope(scope: FocusScope, focusable: Focusable): boolean {
    if (!(focusable instanceof RenderObject)) return true
    const roots = this._activityRootsForScope(scope)
    if (!roots) return this._hasVisibleAncestors(focusable)
    return this._isRenderObjectActiveWithinRoots(focusable, roots)
  }

  private _activityRootsForScope(scope: FocusScope): readonly RenderObject[] | undefined {
    if (scope.focusRoots.length > 0) return scope.focusRoots
    const roots = this._rootResolver?.()
    if (scope !== this._defaultScope || this._auxiliaryRoots.size === 0) return roots
    return [...(roots ?? []), ...this._auxiliaryRoots.keys()]
  }

  private _auxiliaryRootFor(node: RenderObject): RenderObject | undefined {
    for (const root of this._auxiliaryRoots.keys()) {
      if (this._isWithinRoot(node, root)) return root
    }
    return undefined
  }

  private _isRenderObjectActiveWithinRoots(node: RenderObject, roots: readonly RenderObject[]): boolean {
    let current: RenderObject | undefined = node
    while (current) {
      if (!current.visible) return false
      if (roots.includes(current)) return true
      const parent: RenderObject | undefined = current.parent
      if (!parent || !parent.isFocusChildActive(current)) return false
      current = parent
    }
    return false
  }

  private _activeNodesWithinRoots(roots: readonly RenderObject[]): Set<RenderObject> {
    const active = new Set<RenderObject>()
    const visit = (node: RenderObject): void => {
      if (active.has(node) || !node.visible) return
      active.add(node)
      node.visitFocusChildren(child => visit(child))
    }
    for (const root of roots) visit(root)
    return active
  }

  private _hasVisibleAncestors(node: RenderObject): boolean {
    let current: RenderObject | undefined = node
    while (current) {
      if (!current.visible) return false
      current = current.parent
    }
    return true
  }

  private _clearInactiveFocus(): void {
    for (const scope of this._scopeStack) {
      const current = scope.current
      if (current && !this._isFocusableActiveInScope(scope, current)) scope.clearFocus()
    }
    this._clearStaleAuxiliaryRestoreCandidate()
  }

  private _clearStaleAuxiliaryRestoreCandidate(): void {
    const current = this._defaultScope.current
    if (
      !(current instanceof RenderObject) ||
      !this._auxiliaryRootFor(current)
    ) {
      this._previousNonAuxiliaryFocus = null
      return
    }
    const previous = this._previousNonAuxiliaryFocus
    if (
      previous &&
      (!this._defaultScope.contains(previous) || !this._isFocusableActiveInScope(this._defaultScope, previous))
    ) {
      this._previousNonAuxiliaryFocus = null
    }
  }

  private _isWithinRoot(focusable: Focusable | RenderObject, root: RenderObject): boolean {
    if (!(focusable instanceof RenderObject)) return false
    let node: RenderObject | undefined = focusable
    while (node) {
      if (node === root) return true
      node = node.parent
    }
    return false
  }

  dispose(): void {
    for (const scope of this._scopeStack) {
      scope.clearFocus()
    }
    this._defaultScope = new FocusScope(FocusScopeType.Normal)
    this._scopeStack = [this._defaultScope]
    this._rootResolver = undefined
    this._activeRoot = undefined
    this._auxiliaryRoots.clear()
    this._previousNonAuxiliaryFocus = null
    this._disposables.dispose()
    FocusManager._instance = null
  }
}
