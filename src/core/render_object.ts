// RenderObject: 几何计算 + Canvas 绘制基类
// 采用 Box Constraint 协议，脏标记驱动局部重算

import type { PaintContext } from '../rendering/paint_context'
import { HitTestResult, type HitTestTarget } from '../gestures/hit_test'
import { PopupManager } from './popup_manager'
import { ImGuiDarkTheme } from '../theme/default_theme'
import {
  themeMetricSignature,
  themeValueSignature,
  type ResolvedTheme,
} from '../theme/theme'
import {
  APP_CONTEXT_PROVIDER,
  AppContextRegistry,
  type AppContextKey,
  type AppContextLookupKey,
  isAppContextProvider,
} from './app_context'
import { runCleanupSteps } from './disposable'

export interface Offset {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface BoxConstraints {
  minWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number
}

export type LayoutPassKind = 'layout' | 'measure'

export interface LayoutContext {
  readonly theme: ResolvedTheme
  readonly pass?: LayoutPassKind
}

export interface RenderLoadedContext {
  readonly owner: PipelineOwner
  readonly theme: ResolvedTheme
  readonly size: Size
  readonly constraints: BoxConstraints
}

export interface RenderLifecycleAware {
  onLoaded?(context: RenderLoadedContext): void
}

export interface RenderDebugInfo {
  debugId: number
  debugName?: string
  typeName: string
  visible: boolean
  offset: Offset
  globalOffset: Offset
  size: Size
  constraints?: BoxConstraints
  needsLayout: boolean
  needsPaint: boolean
  state?: unknown
}

const DEFAULT_LAYOUT_CONTEXT: LayoutContext = { theme: ImGuiDarkTheme }
let nextLayoutEpoch = 0
let nextRenderDebugId = 1
let ambientLayoutContext: LayoutContext | undefined
let activeMeasureScope: MeasureScope | undefined

interface MeasureSnapshot {
  size: Size
  offset: Offset
  needsLayout: boolean
  needsPaint: boolean
  detachedTheme: ResolvedTheme | null
  globalOffsetCache: Offset | null
  globalOffsetDirty: boolean
}

interface MeasureSnapshotTarget {
  size: Size
  _offset: Offset
  _needsLayout: boolean
  _needsPaint: boolean
  _detachedTheme: ResolvedTheme | null
  _globalOffsetCache: Offset | null
  _globalOffsetDirty: boolean
}

function captureMeasureSnapshot(node: RenderObject): MeasureSnapshot {
  const target = node as unknown as MeasureSnapshotTarget
  return {
    size: { ...target.size },
    offset: { ...target._offset },
    needsLayout: target._needsLayout,
    needsPaint: target._needsPaint,
    detachedTheme: target._detachedTheme,
    globalOffsetCache: target._globalOffsetCache ? { ...target._globalOffsetCache } : null,
    globalOffsetDirty: target._globalOffsetDirty,
  }
}

function restoreMeasureSnapshot(node: RenderObject, snapshot: MeasureSnapshot): void {
  const target = node as unknown as MeasureSnapshotTarget
  target.size = snapshot.size
  target._offset = snapshot.offset
  target._needsLayout = snapshot.needsLayout
  target._needsPaint = snapshot.needsPaint
  target._detachedTheme = snapshot.detachedTheme
  target._globalOffsetCache = snapshot.globalOffsetCache
  target._globalOffsetDirty = snapshot.globalOffsetDirty
}

class MeasureScope {
  private readonly _snapshots = new Map<RenderObject, MeasureSnapshot>()

  capture(node: RenderObject): void {
    if (this._snapshots.has(node)) return
    this._snapshots.set(node, captureMeasureSnapshot(node))
  }

  restore(): void {
    for (const [node, snapshot] of [...this._snapshots].reverse()) {
      restoreMeasureSnapshot(node, snapshot)
    }
  }
}

export function constrainSize(constraints: BoxConstraints, size: Size): Size {
  return {
    width: Math.max(constraints.minWidth, Math.min(constraints.maxWidth, size.width)),
    height: Math.max(constraints.minHeight, Math.min(constraints.maxHeight, size.height)),
  }
}

export function tightConstraints(width: number, height: number): BoxConstraints {
  return { minWidth: width, maxWidth: width, minHeight: height, maxHeight: height }
}

export function looseConstraints(maxWidth: number, maxHeight: number): BoxConstraints {
  return { minWidth: 0, maxWidth, minHeight: 0, maxHeight }
}

// ---- RenderObject 基类 ----

export abstract class RenderObject {
  static debugTypeName?: string
  private readonly _debugId = nextRenderDebugId++
  private _parent?: RenderObject
  private _offset: Offset = { x: 0, y: 0 }
  size: Size = { width: 0, height: 0 }

  private _needsLayout = true
  private _needsPaint = true
  private _owner?: PipelineOwner
  private _visible = true
  private _detachedTheme: ResolvedTheme | null = null
  private _lastLayoutConstraints?: BoxConstraints
  private _lastLayoutTheme?: ResolvedTheme
  private _lastLayoutEpoch = 0
  private _debugTreeRevision = 0
  private _hasLoaded = false
  // globalOffset 缓存：layout 后计算一次，避免每次 hit test/paint 遍历父链
  private _globalOffsetCache: Offset | null = null
  private _globalOffsetDirty = true

  debugName?: string
  debugTypeName?: string

  get owner(): PipelineOwner | undefined { return this._owner }
  protected get currentTheme(): ResolvedTheme { return this._owner?.theme ?? this._detachedTheme ?? DEFAULT_LAYOUT_CONTEXT.theme }

  get visible(): boolean { return this._visible }
  set visible(value: boolean) {
    if (this._visible === value) return
    this._visible = value
    if (!value) {
      PopupManager.instance.closeOwnedBy(this)
      this.size = { width: 0, height: 0 }
    }
    this.onVisibilityChanged(value)
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  get parent(): RenderObject | undefined { return this._parent }

  get debugTreeRevision(): number { return this._debugTreeRevision }

  set parent(value: RenderObject | undefined) {
    if (this._parent === value) return
    const oldParent = this._parent
    this._parent = value
    this._debugTreeRevision += 1
    oldParent?._markDebugTreeChanged()
    value?._markDebugTreeChanged()
    this.invalidateGlobalOffset()
  }

  get offset(): Offset { return this._offset }

  set offset(value: Offset) {
    if (this._offset.x === value.x && this._offset.y === value.y) return
    this._offset = value
    this.invalidateGlobalOffset()
  }

  get paintBounds(): Rect {
    const offset = this.globalOffset
    return {
      x: offset.x,
      y: offset.y,
      width: this.size.width,
      height: this.size.height,
    }
  }

  attach(owner: PipelineOwner): void {
    if (this._owner && this._owner !== owner) this._owner.forget(this)
    this._owner = owner
    this.visitChildren(child => child.attach(owner))
  }

  detach(): void {
    const owner = this._owner
    this._owner = undefined
    owner?.forget(this)
    PopupManager.instance.closeOwnedBy(this)
    this.visitChildren(child => child.detach())
  }

  // 脏标记向上传播
  markNeedsLayout(): void {
    if (this._needsLayout) return
    this._needsLayout = true
    this._owner?.requestLayout(this)
    // 父节点也需要重新布局（因为子尺寸可能变化）
    if (this.parent && !this.parent._needsLayout) {
      this.parent.markNeedsLayout()
    }
  }

  markNeedsPaint(damageRect?: Rect): void {
    if (this._needsPaint) {
      if (damageRect) this._owner?.requestPaint(this, damageRect)
      return
    }
    this._needsPaint = true
    this._owner?.requestPaint(this, damageRect)
    if (PopupManager.instance.hasOverlays) PopupManager.instance.requestPaint()
    // 祖先节点需要知道其子树里有 paint dirty，但不需要把整条祖先链都加入 owner 的 paint 队列。
    let parent = this.parent
    while (parent && !parent._needsPaint) {
      parent._needsPaint = true
      parent = parent.parent
    }
  }

  markNeedsPaintForGeometryChange(previousPaintBounds: Rect): void {
    this.markNeedsPaint(unionRect(previousPaintBounds, this.paintBounds))
  }

  markNeedsTransientPaint(rect?: Rect): void {
    if (this._owner) {
      this._owner.requestTransientPaint(this, rect)
      return
    }
    if (PopupManager.instance.hasOverlays) PopupManager.instance.requestPaint()
  }

  get needsLayout(): boolean { return this._needsLayout }
  get needsPaint(): boolean { return this._needsPaint }

  debugInfo(): RenderDebugInfo {
    const constraints = this._owner?.getLastLayoutConstraints(this) ??
      (this._lastLayoutConstraints ? { ...this._lastLayoutConstraints } : undefined)
    const state = this._readDebugState()
    const info: RenderDebugInfo = {
      debugId: this._debugId,
      typeName: this._resolveDebugTypeName(),
      visible: this._visible,
      offset: { ...this.offset },
      globalOffset: { ...this.globalOffset },
      size: { ...this.size },
      needsLayout: this.needsLayout,
      needsPaint: this.needsPaint,
    }
    if (this.debugName !== undefined) info.debugName = this.debugName
    if (constraints) info.constraints = constraints
    if (state !== undefined) info.state = state
    return info
  }

  private _resolveDebugTypeName(): string {
    const constructorWithDebugName = this.constructor as typeof RenderObject
    const staticDebugTypeName = Object.prototype.hasOwnProperty.call(constructorWithDebugName, 'debugTypeName')
      ? constructorWithDebugName.debugTypeName
      : undefined
    return this.debugTypeName ??
      staticDebugTypeName ??
      this.constructor.name ??
      'RenderObject'
  }

  protected requestPaint(): void {
    if (this._owner) {
      this.markNeedsPaint()
      return
    }
  }

  protected requestLayout(): void {
    if (this._owner) {
      this.markNeedsLayout()
      return
    }
  }

  getAppContext<T>(key: AppContextKey<T>): T | undefined
  getAppContext(key: string): unknown
  getAppContext(key: AppContextLookupKey): unknown {
    let current: RenderObject | undefined = this
    while (current) {
      if (isAppContextProvider(current)) {
        const context = current[APP_CONTEXT_PROVIDER]()
        if (context.hasOwn(key)) return context.getOwn(key as never)
      }
      current = current.parent
    }
    const rootContext = this._owner?.appContext
    if (rootContext?.has(key)) return rootContext.get(key as never)
    return undefined
  }

  requireAppContext<T>(key: AppContextKey<T>): T
  requireAppContext(key: string): unknown
  requireAppContext(key: AppContextLookupKey): unknown {
    const value = this.getAppContext(key as never)
    if (value !== undefined || this._hasAppContext(key)) return value
    const label = typeof key === 'string' ? key : key.description
    throw new Error(`App context value "${label}" was not found.`)
  }

// 布局入口：始终执行，脏标记仅供 PipelineOwner 优化用
  layout(constraints: BoxConstraints, parentUsesSize = false, context?: LayoutContext): void {
    const layoutEpoch = ++nextLayoutEpoch
    const resolvedContext = this._resolveLayoutContext(context, 'layout')
    if (resolvedContext.pass === 'measure') {
      this._performMeasure(constraints, resolvedContext)
      return
    }
    this._detachedTheme = resolvedContext.theme
    this._lastLayoutConstraints = { ...constraints }
    this._lastLayoutTheme = resolvedContext.theme
    this._lastLayoutEpoch = layoutEpoch
    this._owner?.recordLayoutConstraints(this, constraints)
    this._syncChildOwners(false)
    this._needsLayout = false
    if (!this._visible) {
      this.size = { width: 0, height: 0 }
      this._syncChildOwners(true, layoutEpoch)
      this._needsPaint = false
      this.invalidateGlobalOffset()
      return
    }
    this._withLayoutContext(resolvedContext, () => this.performLayout(constraints, resolvedContext))
    this.prepareForRenderOrHitTest()
    this._syncChildOwners(true, layoutEpoch)
    this._needsPaint = true
    // layout 后 globalOffset 可能变化，标记自身和后代缓存 dirty
    this.invalidateGlobalOffset()
    this._dispatchLoadedIfNeeded()
  }

  measure(constraints: BoxConstraints, context?: LayoutContext): Size {
    const resolvedContext = this._resolveLayoutContext(context, 'measure')
    return this._performMeasure(constraints, { ...resolvedContext, pass: 'measure' })
  }

  // 绘制入口：始终执行，脏标记仅供 PipelineOwner 优化用
  paint(context: PaintContext, offset: Offset): void {
    this._needsPaint = false
    if (!this._visible) return
    this.performPaint(context, offset)
  }

  paintTransient(context: PaintContext, offset: Offset): void {
    if (!this._visible) return
    this.performTransientPaint(context, offset)
  }

  // 子类实现
  abstract performLayout(constraints: BoxConstraints, context: LayoutContext): void
  abstract performPaint(context: PaintContext, offset: Offset): void
  performTransientPaint(_context: PaintContext, _offset: Offset): void {}
  abstract visitChildren(visitor: (child: RenderObject) => void): void
  prepareForRenderOrHitTest(): void {}
  protected onVisibilityChanged(_visible: boolean): void {}
  visitContentChildren(visitor: (child: RenderObject) => void): void {
    this.visitChildren(visitor)
  }
  visitAdornerChildren(_visitor: (child: RenderObject) => void): void {}
  visitFocusChildren(visitor: (child: RenderObject) => void): void {
    const visited = new Set<RenderObject>()
    const visit = (child: RenderObject): void => {
      if (visited.has(child)) return
      visited.add(child)
      visitor(child)
    }
    this.visitContentChildren(visit)
    this.visitAdornerChildren(visit)
  }

  /** @internal O(1) membership check used for active focus-path validation. */
  isFocusChildActive(child: RenderObject): boolean {
    return child.parent === this && child.visible
  }

  dispose(): void {
    const children: RenderObject[] = []
    this.visitChildren(child => children.push(child))
    try {
      runCleanupSteps(children.map(child => () => {
        try {
          child.dispose()
        } finally {
          if (child.parent === this) child.parent = undefined
          if (child.owner) child.detach()
        }
      }))
    } finally {
      this.parent = undefined
      this._globalOffsetCache = null
      this._globalOffsetDirty = true
      this.detach()
    }
  }

  private _syncChildOwners(dispatchLoadedForNewChildren: boolean, minLayoutEpoch = 0): void {
    if (!this._owner) return
    this.visitChildren(child => {
      if (child.owner !== this._owner) {
        child.attach(this._owner!)
        if (dispatchLoadedForNewChildren) child._dispatchLoadedInSubtree(minLayoutEpoch)
      }
    })
  }

  private _markDebugTreeChanged(): void {
    this._debugTreeRevision += 1
    this.parent?._markDebugTreeChanged()
  }

  private _performMeasure(constraints: BoxConstraints, context: LayoutContext): Size {
    const parentScope = activeMeasureScope
    const scope = parentScope ?? new MeasureScope()
    activeMeasureScope = scope
    scope.capture(this)
    try {
      this._detachedTheme = context.theme
      this._syncChildOwners(false)
      if (!this._visible) {
        this.size = { width: 0, height: 0 }
        return { ...this.size }
      }
      this._withLayoutContext(context, () => this.performLayout(constraints, context))
      this.prepareForRenderOrHitTest()
      this._syncChildOwners(false)
      return { ...this.size }
    } finally {
      if (!parentScope) {
        scope.restore()
        activeMeasureScope = undefined
      } else {
        activeMeasureScope = parentScope
      }
    }
  }

  private _resolveLayoutContext(context: LayoutContext | undefined, defaultPass: LayoutPassKind): LayoutContext {
    const base = context ?? ambientLayoutContext ?? this._owner?.layoutContext ?? DEFAULT_LAYOUT_CONTEXT
    const pass = context?.pass ?? ambientLayoutContext?.pass ?? base.pass ?? defaultPass
    return base.pass === pass ? base : { ...base, pass }
  }

  private _withLayoutContext<T>(context: LayoutContext, action: () => T): T {
    const previous = ambientLayoutContext
    ambientLayoutContext = context
    try {
      return action()
    } finally {
      ambientLayoutContext = previous
    }
  }

  private _dispatchLoadedInSubtree(minLayoutEpoch = 0): void {
    this._dispatchLoadedIfNeeded(minLayoutEpoch)
    this.visitChildren(child => child._dispatchLoadedInSubtree(minLayoutEpoch))
  }

  private _dispatchLoadedIfNeeded(minLayoutEpoch = 0): void {
    if (this._hasLoaded || !this._owner || !this._lastLayoutConstraints) return
    if (this._lastLayoutEpoch < minLayoutEpoch) return
    const lifecycle = this as RenderObject & Partial<RenderLifecycleAware>
    if (typeof lifecycle.onLoaded !== 'function') {
      this._hasLoaded = true
      return
    }
    this._hasLoaded = true
    lifecycle.onLoaded({
      owner: this._owner,
      theme: this._lastLayoutTheme ?? this._owner.theme,
      size: { ...this.size },
      constraints: { ...this._lastLayoutConstraints },
    })
  }

  private _readDebugState(): unknown {
    const target = this as unknown as { debugState?: () => unknown }
    if (typeof target.debugState !== 'function') return undefined
    try {
      return target.debugState.call(this)
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private _hasAppContext(key: AppContextLookupKey): boolean {
    let current: RenderObject | undefined = this
    while (current) {
      if (isAppContextProvider(current) && current[APP_CONTEXT_PROVIDER]().hasOwn(key)) return true
      current = current.parent
    }
    return Boolean(this._owner?.appContext.has(key))
  }

  // globalOffset 缓存：layout 时标记 dirty，首次访问时懒计算
  // 避免每次 hit test / paint 遍历父链（O(depth) → O(1)）
  get globalOffset(): Offset {
    if (!this._globalOffsetDirty && this._globalOffsetCache) {
      return this._globalOffsetCache
    }
    let x = this.offset.x
    let y = this.offset.y
    let cur = this.parent
    while (cur) {
      x += cur.offset.x
      y += cur.offset.y
      cur = cur.parent
    }
    this._globalOffsetCache = { x, y }
    this._globalOffsetDirty = false
    return this._globalOffsetCache
  }

  /** 将自身及所有后代的 globalOffset 缓存标记为 dirty */
  invalidateGlobalOffset(): void {
    this._globalOffsetDirty = true
    this._globalOffsetCache = null
    this.visitChildren(child => child.invalidateGlobalOffset())
  }

  offsetToAncestor(ancestor: RenderObject): Offset | null {
    let x = 0
    let y = 0
    let current: RenderObject | undefined = this
    while (current && current !== ancestor) {
      x += current.offset.x
      y += current.offset.y
      current = current.parent
    }
    return current === ancestor ? { x, y } : null
  }

// 命中测试（使用全局坐标）
  // 保留旧签名以兼容 InteractiveRenderObject 接口
  // 组件可覆写此方法实现自定义命中区域
  hitTest(point: Offset): boolean {
    if (!this._visible) return false
    const g = this.globalOffset
    return (
      point.x >= g.x &&
      point.x <= g.x + this.size.width &&
      point.y >= g.y &&
      point.y <= g.y + this.size.height
    )
  }

  // 路径式命中测试：从当前节点向下递归，将命中的节点加入 path
  // 返回 true 表示当前节点或其子节点有命中
  // 路径顺序：祖先节点在前，叶节点（最深命中）在后
  // 对应 DOM 事件 capture 阶段顺序
  // 子节点逆序遍历（后渲染的在前），使得视觉上在前的子节点优先命中
  // 使用 this.hitTest(point) 而非 globalOffset+size，以尊重组件自定义命中区域
  hitTestPath(point: Offset, result: HitTestResult): boolean {
    if (!this._visible) return false
    const collectHit = (children: RenderObject[]): HitTestResult | null => {
      for (let i = children.length - 1; i >= 0; i--) {
        children[i]!.prepareForRenderOrHitTest()
        const childResult = new HitTestResult()
        if (children[i]!.hitTestPath(point, childResult)) return childResult
      }
      return null
    }

    const adornerChildren: RenderObject[] = []
    this.visitAdornerChildren(child => adornerChildren.push(child))
    const adornerResult = collectHit(adornerChildren)

    const contentChildren: RenderObject[] = []
    this.visitContentChildren(child => contentChildren.push(child))
    const childResult = adornerResult ?? collectHit(contentChildren)
    const childHit = childResult !== null

    // 使用 this.hitTest(point) 以尊重组件覆写（如 RenderModal 不可见时返回 false）
    if (this.hitTest(point)) {
      const g = this.globalOffset
      const localPoint: Offset = { x: point.x - g.x, y: point.y - g.y }
      result.add({ target: this as unknown as HitTestTarget, localPosition: localPoint })
      if (childResult) {
        for (const entry of childResult.path) result.add(entry)
      }
      return true
    }

    if (childResult) {
      for (const entry of childResult.path) result.add(entry)
    }
    return childHit
  }

  // 收集命中路径（从叶到根）
  hitTestChildren(point: Offset, result: RenderObject[]): boolean {
    if (!this._visible) return false
    const collectHit = (children: RenderObject[]): boolean => {
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i]!
        child.prepareForRenderOrHitTest()
        if (child.hitTest(point)) {
          child.hitTestChildren(point, result)
          result.push(child)
          return true
        }
      }
      return false
    }

    const adornerChildren: RenderObject[] = []
    this.visitAdornerChildren(child => adornerChildren.push(child))
    if (collectHit(adornerChildren)) return true

    const contentChildren: RenderObject[] = []
    this.visitContentChildren(child => contentChildren.push(child))
    return collectHit(contentChildren)
  }
}

// ---- PipelineOwner ----

export interface PipelineOwnerOptions {
  onNeedFrameCommit?: (info: PipelineRequestInfo) => void
  onNeedLayout?: (info: PipelineRequestInfo) => void
  onNeedPaint?: (info: PipelineRequestInfo) => void
  setCursor?: (cursor: string) => void
  activateWindow?: (target: RenderObject) => void
  appContext?: AppContextRegistry
}

export interface PipelineRequestInfo {
  type: 'frame-commit' | 'layout' | 'paint' | 'transient-paint'
  target: string
  rect?: Rect
}

export interface PipelineDebugPaintState {
  layoutCount: number
  paintCount: number
  transientPaintCount: number
  layoutTargets: string[]
  paintTargets: string[]
  transientPaintTargets: string[]
}

export type ThemeUpdateKind = 'none' | 'paint' | 'layout'

export class PipelineOwner {
  private _frameCommits = new Map<RenderObject, {
    active: boolean
    callback: () => void
  }>()
  private _nodesNeedingLayout = new Set<RenderObject>()
  private _nodesNeedingPaint = new Set<RenderObject>()
  private _nodesNeedingTransientPaint = new Set<RenderObject>()
  private _transientPaintReplayNodes = new Set<RenderObject>()
  private _lastLayoutConstraints = new Map<RenderObject, BoxConstraints>()
  private _paintRects = new Map<RenderObject, Rect>()
  private _transientPaintRects = new Map<RenderObject, Rect>()
  private _theme: ResolvedTheme
  private _themeValueSignature: string
  private _themeMetricSignature: string
  private _layoutContext: LayoutContext
  private _appContext: AppContextRegistry

  constructor(private readonly _options: PipelineOwnerOptions = {}, theme: ResolvedTheme = ImGuiDarkTheme) {
    this._theme = theme
    this._themeValueSignature = themeValueSignature(theme)
    this._themeMetricSignature = themeMetricSignature(theme)
    this._layoutContext = { theme, pass: 'layout' }
    this._appContext = _options.appContext ?? new AppContextRegistry()
  }

  get theme(): ResolvedTheme {
    return this._theme
  }

  get layoutContext(): LayoutContext {
    return this._layoutContext
  }

  get appContext(): AppContextRegistry {
    return this._appContext
  }

  setAppContext(context: AppContextRegistry): void {
    this._appContext = context
  }

  setTheme(theme: ResolvedTheme): boolean {
    return this.updateTheme(theme) !== 'none'
  }

  updateTheme(theme: ResolvedTheme): ThemeUpdateKind {
    const valueSignature = themeValueSignature(theme)
    if (this._themeValueSignature === valueSignature) return 'none'
    const metricSignature = themeMetricSignature(theme)
    const updateKind: ThemeUpdateKind = this._themeMetricSignature === metricSignature ? 'paint' : 'layout'
    this._theme = theme
    this._themeValueSignature = valueSignature
    this._themeMetricSignature = metricSignature
    this._layoutContext = { theme, pass: 'layout' }
    return updateKind
  }

  setCursor(cursor: string): void {
    this._options.setCursor?.(cursor)
  }

  activateWindow(target: RenderObject): void {
    this._options.activateWindow?.(target)
  }

  recordLayoutConstraints(node: RenderObject, constraints: BoxConstraints): void {
    this._lastLayoutConstraints.set(node, { ...constraints })
  }

  getLastLayoutConstraints(node: RenderObject): BoxConstraints | undefined {
    const constraints = this._lastLayoutConstraints.get(node)
    return constraints ? { ...constraints } : undefined
  }

  requestLayout(node: RenderObject): void {
    const wasIdle = this._nodesNeedingLayout.size === 0
    this._nodesNeedingLayout.add(node)
    if (wasIdle) {
      this._options.onNeedLayout?.({
        type: 'layout',
        target: debugRenderObjectName(node),
      })
    }
  }

  scheduleFrameCommit(owner: RenderObject, callback: () => void): () => void {
    if (owner.owner !== this) return () => {}
    const previous = this._frameCommits.get(owner)
    if (previous) previous.active = false
    const entry = { active: true, callback }
    const wasIdle = this._frameCommits.size === 0
    this._frameCommits.set(owner, entry)
    if (wasIdle) {
      this._options.onNeedFrameCommit?.({
        type: 'frame-commit',
        target: debugRenderObjectName(owner),
      })
    }
    return () => {
      if (!entry.active) return
      entry.active = false
      if (this._frameCommits.get(owner) === entry) {
        this._frameCommits.delete(owner)
      }
    }
  }

  cancelFrameCommit(owner: RenderObject): void {
    const entry = this._frameCommits.get(owner)
    if (!entry) return
    entry.active = false
    this._frameCommits.delete(owner)
  }

  flushFrameCommits(): void {
    if (!this._frameCommits.size) return
    const entries = [...this._frameCommits.entries()]
    this._frameCommits.clear()
    let failed = false
    let firstError: unknown
    for (const [owner, entry] of entries) {
      if (!entry.active || owner.owner !== this) continue
      entry.active = false
      try {
        entry.callback()
      } catch (error) {
        if (failed) continue
        failed = true
        firstError = error
      }
    }
    if (failed) throw firstError
  }

  clearFrameCommits(): void {
    this._frameCommits.forEach(entry => {
      entry.active = false
    })
    this._frameCommits.clear()
  }

  requestPaint(node: RenderObject, damageRect?: Rect): void {
    const wasIdle = this._nodesNeedingPaint.size === 0
    this._nodesNeedingPaint.add(node)
    const nextRect = damageRect ?? node.paintBounds
    const existing = this._paintRects.get(node)
    this._paintRects.set(node, existing ? unionRect(existing, nextRect) : { ...nextRect })
    if (wasIdle) {
      this._options.onNeedPaint?.({
        type: 'paint',
        target: debugRenderObjectName(node),
        rect: this._paintRects.get(node),
      })
    }
  }

  requestTransientPaint(node: RenderObject, rect?: Rect): void {
    const wasIdle = this._nodesNeedingTransientPaint.size === 0
    this._nodesNeedingTransientPaint.add(node)
    this._transientPaintReplayNodes.add(node)
    const nextRect = rect ?? {
      x: node.globalOffset.x,
      y: node.globalOffset.y,
      width: node.size.width,
      height: node.size.height,
    }
    const existing = this._transientPaintRects.get(node)
    this._transientPaintRects.set(node, existing ? unionRect(existing, nextRect) : { ...nextRect })
    if (wasIdle) {
      this._options.onNeedPaint?.({
        type: 'transient-paint',
        target: debugRenderObjectName(node),
        rect: this._transientPaintRects.get(node),
      })
    }
  }

  forget(node: RenderObject): void {
    this.cancelFrameCommit(node)
    this._nodesNeedingLayout.delete(node)
    this._nodesNeedingPaint.delete(node)
    this._nodesNeedingTransientPaint.delete(node)
    this._transientPaintReplayNodes.delete(node)
    this._lastLayoutConstraints.delete(node)
    this._paintRects.delete(node)
    this._transientPaintRects.delete(node)
    node.visitChildren(child => this.forget(child))
  }

  clearPaintRequests(): void {
    this._nodesNeedingPaint.clear()
    this._paintRects.clear()
  }

  clearLayoutRequests(): void {
    this._nodesNeedingLayout.clear()
  }

  clearTransientPaintRequests(): void {
    this._nodesNeedingTransientPaint.clear()
    this._transientPaintRects.clear()
  }

  flushLayout(): void {
    const context = this._layoutContext = { theme: this._theme, pass: 'layout' }
    // 按深度排序（浅层先布局）
    const nodes = [...this._nodesNeedingLayout]
    this._nodesNeedingLayout.clear()
    nodes.sort((a, b) => depth(a) - depth(b))
    for (const node of nodes) {
      if (node.needsLayout) {
        node.layout(
          this._lastLayoutConstraints.get(node) ?? looseConstraints(Infinity, Infinity),
          false,
          context,
        )
      }
    }
  }

  flushPaint(context: PaintContext): void {
    context.setTheme(this._theme)
    const nodes = [...this._nodesNeedingPaint]
    this._nodesNeedingPaint.clear()
    for (const node of nodes) {
      if (node.needsPaint) {
        node.paint(context, node.globalOffset)
      }
    }
    this._paintRects.clear()
  }

  flushTransientPaint(context: PaintContext): void {
    context.setTheme(this._theme)
    const nodes = [...this._nodesNeedingTransientPaint]
    this._nodesNeedingTransientPaint.clear()
    for (const node of nodes) {
      node.paintTransient(context, node.globalOffset)
    }
    this._transientPaintRects.clear()
  }

  replayTransientPaint(context: PaintContext): void {
    context.setTheme(this._theme)
    for (const node of this._transientPaintReplayNodes) {
      node.paintTransient(context, node.globalOffset)
    }
  }

  hasDirtyPaintInSubtree(root: RenderObject): boolean {
    for (const node of this._nodesNeedingPaint) {
      if (node === root || isDescendantOf(node, root)) return true
    }
    return false
  }

  getDirtyPaintRectInSubtree(root: RenderObject): Rect | undefined {
    let rect: Rect | undefined
    for (const [node, next] of this._paintRects) {
      if (node !== root && !isDescendantOf(node, root)) continue
      rect = rect ? unionRect(rect, next) : { ...next }
    }
    return rect
  }

  hasTransientPaint(): boolean {
    return this._nodesNeedingTransientPaint.size > 0
  }

  getTransientPaintRect(): Rect | undefined {
    let rect: Rect | undefined
    for (const next of this._transientPaintRects.values()) {
      rect = rect ? unionRect(rect, next) : { ...next }
    }
    return rect
  }

  debugPaintState(): PipelineDebugPaintState {
    return {
      layoutCount: this._nodesNeedingLayout.size,
      paintCount: this._nodesNeedingPaint.size,
      transientPaintCount: this._nodesNeedingTransientPaint.size,
      layoutTargets: [...this._nodesNeedingLayout].map(debugRenderObjectName),
      paintTargets: [...this._nodesNeedingPaint].map(debugRenderObjectName),
      transientPaintTargets: [...this._nodesNeedingTransientPaint].map(debugRenderObjectName),
    }
  }
}

function depth(node: RenderObject): number {
  let d = 0
  let cur: RenderObject | undefined = node.parent
  while (cur) { d++; cur = cur.parent }
  return d
}

function isDescendantOf(node: RenderObject, ancestor: RenderObject): boolean {
  let cur = node.parent
  while (cur) {
    if (cur === ancestor) return true
    cur = cur.parent
  }
  return false
}

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const bottom = Math.max(a.y + a.height, b.y + b.height)
  return { x, y, width: right - x, height: bottom - y }
}

function debugRenderObjectName(node: RenderObject): string {
  return node.constructor?.name || 'RenderObject'
}
