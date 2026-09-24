import { HitTestResult, type HitTestTarget } from '../gestures/hit_test'
import type { EventDispatcher } from '../gestures/recognizers'
import {
  APP_CONTEXT_PROVIDER,
  AppContextRegistry,
  isAppContextProvider,
  type AppContextLookupKey,
} from '../core/app_context'
import { RenderObject, type Offset, type RenderDebugInfo } from '../core/render_object'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { rgba } from '../theme/theme'

const CONTEXT_VALUE_MAX_LENGTH = 360

export interface LayoutInspectorDebugState {
  enabled: boolean
  overlayVisible: boolean
  hoverPathLength: number
  selectedPathLength: number
  selectedPathIndex: number
  hoverPathInfo: RenderDebugInfo[]
  selectedPathInfo: RenderDebugInfo[]
  selectedAppContext?: LayoutInspectorAppContextEntry[]
  renderTree?: LayoutInspectorTreeNode
  hover?: RenderDebugInfo
  selected?: RenderDebugInfo
  selectedRenderObject?: RenderObject
}

export interface LayoutInspectorAppContextEntry {
  key: string
  source: string
  value: string
  rawValue?: unknown
}

export interface LayoutInspectorTreeNode {
  info: RenderDebugInfo
  children: LayoutInspectorTreeNode[]
}

interface LayoutInspectorRevealContainer {
  revealDescendant(target: RenderObject): boolean
}

export type LayoutInspectorListener = (state: LayoutInspectorDebugState) => void

export class LayoutInspectorService {
  enabled = false
  overlayVisible = false
  hoverPath: HitTestResult | null = null
  selectedPath: HitTestResult | null = null
  private _selectedPathIndex = -1
  private _selectedTreeRoot: RenderObject | null = null
  private _selectedTree?: LayoutInspectorTreeNode
  private _selectedTreeRevision = -1
  private _selectedAppContextTarget: RenderObject | null = null
  private _selectedAppContextIndex = -1
  private _selectedAppContextRevision = ''
  private _selectedAppContextEntries?: LayoutInspectorAppContextEntry[]
  private _needsOverlayClear = false
  private readonly _listeners = new Set<LayoutInspectorListener>()

  constructor(
    private readonly _dispatcher: EventDispatcher,
    private readonly _requestPaint: () => void,
  ) {}

  hoverAt(position: Offset): void {
    if (!this.enabled || !this.overlayVisible) return
    this.hoverPath = this._dispatcher.debugHitTest(position)
    if (this.overlayVisible) this._requestPaint()
    this._emitChanged()
  }

  inspectAt(position: Offset): void {
    if (this._dispatcher.isDebugHitTestIgnored(position)) return
    this.enabled = true
    this.overlayVisible = true
    this.selectedPath = this._dispatcher.debugHitTest(position)
    this._selectedPathIndex = this.selectedPath.path.length - 1
    this._setSelectedTreeRoot(this._rootForPath(this.selectedPath))
    this.hoverPath = this.selectedPath
    this._requestPaint()
    this._emitChanged()
  }

  lockSelection(): void {
    if (!this.enabled) return
    this.overlayVisible = true
    this.selectedPath = this.hoverPath
    this._selectedPathIndex = this.selectedPath ? this.selectedPath.path.length - 1 : -1
    this._setSelectedTreeRoot(this._rootForPath(this.selectedPath))
    this._requestPaint()
    this._emitChanged()
  }

  selectSelectedPathIndex(index: number): boolean {
    this._discardStalePaths({ requestPaint: true, emit: true })
    if (!this.selectedPath) return false
    if (!Number.isInteger(index) || index < 0 || index >= this.selectedPath.path.length) return false
    if (this._selectedPathIndex === index) return true
    this._selectedPathIndex = index
    if (this.overlayVisible) this._requestPaint()
    this._emitChanged()
    return true
  }

  clearSelection(): void {
    const hadState = this.selectedPath !== null || this.hoverPath !== null
    this.selectedPath = null
    this.hoverPath = null
    this._selectedPathIndex = -1
    this._setSelectedTreeRoot(null)
    if (!this.overlayVisible) this.enabled = false
    if (hadState && this.overlayVisible) this._requestPaint()
    if (hadState) this._emitChanged()
  }

  deactivate(): void {
    const hadState = this.enabled ||
      this.overlayVisible ||
      this.hoverPath !== null ||
      this.selectedPath !== null ||
      this._selectedPathIndex !== -1 ||
      this._selectedTreeRoot !== null
    this.enabled = false
    this.overlayVisible = false
    this.hoverPath = null
    this.selectedPath = null
    this._selectedPathIndex = -1
    this._setSelectedTreeRoot(null)
    this._needsOverlayClear = true
    this._requestPaint()
    if (hadState) this._emitChanged()
  }

  toggleOverlay(force?: boolean): boolean {
    const nextVisible = force ?? !this.overlayVisible
    const hadHover = this.hoverPath !== null
    this.overlayVisible = nextVisible
    if (this.overlayVisible) {
      this.enabled = true
    } else {
      this.hoverPath = null
      if (!this.selectedPath) this.enabled = false
      if (hadHover) this._needsOverlayClear = true
    }
    this._requestPaint()
    this._emitChanged()
    return this.overlayVisible
  }

  setIgnoredRoot(root: RenderObject, ignored: boolean): void {
    this._dispatcher.setDebugHitTestIgnoredRoot(root, ignored)
  }

  selectTreeNode(debugId: number): boolean {
    this._discardStalePaths({ requestPaint: true, emit: true })
    if (!this._selectedTreeRoot || !Number.isInteger(debugId)) return false
    const path = this._findPathByDebugId(this._selectedTreeRoot, debugId)
    if (!path) return false
    const revealed = this._revealPath(path)
    const result = new HitTestResult()
    for (const target of path) {
      result.add({ target: target as unknown as HitTestTarget, localPosition: { x: 0, y: 0 } })
    }
    this.enabled = true
    this.overlayVisible = true
    this.selectedPath = result
    this.hoverPath = result
    this._selectedPathIndex = result.path.length - 1
    if (revealed || this.overlayVisible) this._requestPaint()
    this._emitChanged()
    return true
  }

  subscribe(listener: LayoutInspectorListener): () => void {
    this._listeners.add(listener)
    listener(this.debugState())
    return () => {
      this._listeners.delete(listener)
    }
  }

  debugState(): LayoutInspectorDebugState {
    this._discardStalePaths({ requestPaint: true })
    return {
      enabled: this.enabled,
      overlayVisible: this.overlayVisible,
      hoverPathLength: this.hoverPath?.path.length ?? 0,
      selectedPathLength: this.selectedPath?.path.length ?? 0,
      selectedPathIndex: this._selectedPathIndex,
      hoverPathInfo: this._debugInfoListForPath(this.hoverPath),
      selectedPathInfo: this._debugInfoListForPath(this.selectedPath),
      selectedAppContext: this._appContextEntriesForPath(this.selectedPath, this._selectedPathIndex),
      renderTree: this._debugTreeForSelectedRoot(),
      hover: this._debugInfoForPath(this.hoverPath),
      selected: this._debugInfoForPath(this.selectedPath, this._selectedPathIndex),
      selectedRenderObject: this._renderObjectForPath(this.selectedPath, this._selectedPathIndex),
    }
  }

  shouldPaint(): boolean {
    this._discardStalePaths({ emit: true })
    return this.overlayVisible && (!!this.hoverPath || !!this.selectedPath || this._needsOverlayClear)
  }

  paint(context: PaintContext): void {
    this._discardStalePaths({ emit: true })
    if (!this.overlayVisible) return
    const dl = new DrawList(context)
    this._paintPath(dl, this.hoverPath, 'hover', context.theme.fontFamily)
    this._paintPath(dl, this.selectedPath, 'selected', context.theme.fontFamily)
    this._needsOverlayClear = false
  }

  private _paintPath(dl: DrawList, path: HitTestResult | null, kind: 'hover' | 'selected', fontFamily: string): void {
    const info = this._debugInfoForPath(path, kind === 'selected' ? this._selectedPathIndex : undefined)
    if (!info || info.size.width <= 0 || info.size.height <= 0) return
    const color = kind === 'selected' ? rgba(255, 146, 43, 0.95) : rgba(64, 150, 255, 0.88)
    const labelBg = kind === 'selected' ? rgba(70, 38, 6, 0.92) : rgba(8, 35, 72, 0.92)
    const label = `${info.typeName} ${Math.round(info.size.width)}x${Math.round(info.size.height)}`
    const x = info.globalOffset.x
    const y = info.globalOffset.y
    dl.strokeRect(x, y, info.size.width, info.size.height, color, kind === 'selected' ? 2 : 1)
    dl.fillRect(x, Math.max(0, y - 20), Math.max(80, label.length * 7 + 10), 18, labelBg, 3)
    dl.fillText(label, x + 5, Math.max(9, y - 11), rgba(255, 255, 255, 0.96), 12, fontFamily, 'left', 'middle')
  }

  private _debugInfoForPath(path: HitTestResult | null, index?: number): RenderDebugInfo | undefined {
    if (path && !this._isPathReachable(path)) return undefined
    const target = index === undefined || index < 0
      ? path?.deepest?.target
      : path?.path[index]?.target
    const debugTarget = target as { debugInfo?: () => RenderDebugInfo } | undefined
    return typeof debugTarget?.debugInfo === 'function' ? debugTarget.debugInfo() : undefined
  }

  private _renderObjectForPath(path: HitTestResult | null, index?: number): RenderObject | undefined {
    if (path && !this._isPathReachable(path)) return undefined
    const target = index === undefined || index < 0
      ? path?.deepest?.target
      : path?.path[index]?.target
    return target instanceof RenderObject ? target : undefined
  }

  private _debugInfoListForPath(path: HitTestResult | null): RenderDebugInfo[] {
    if (!path) return []
    if (!this._isPathReachable(path)) return []
    return path.path.flatMap(entry => {
      const target = entry.target as { debugInfo?: () => RenderDebugInfo }
      return typeof target.debugInfo === 'function' ? [target.debugInfo()] : []
    })
  }

  private _rootForPath(path: HitTestResult | null): RenderObject | null {
    const target = path?.first?.target
    return target instanceof RenderObject ? target : null
  }

  private _appContextEntriesForPath(path: HitTestResult | null, index: number): LayoutInspectorAppContextEntry[] {
    if (!path || !this._isPathReachable(path)) return []
    const target = index < 0
      ? path.deepest?.target
      : path.path[index]?.target
    if (!(target instanceof RenderObject)) return []
    const contextRevision = this._appContextRevisionForTarget(target)
    if (
      this._selectedAppContextTarget === target &&
      this._selectedAppContextIndex === index &&
      this._selectedAppContextRevision === contextRevision &&
      this._selectedAppContextEntries
    ) {
      return this._selectedAppContextEntries
    }

    const entries: LayoutInspectorAppContextEntry[] = []
    const seen = new Set<AppContextLookupKey>()
    const visited = new Set<RenderObject>()
    let current: RenderObject | undefined = target
    while (current && !visited.has(current)) {
      visited.add(current)
      if (isAppContextProvider(current)) {
        this._appendContextEntries(entries, seen, current[APP_CONTEXT_PROVIDER](), this._contextSourceLabel(current), false)
      }
      current = current.parent
    }

    const rootContext = target.owner?.appContext
    if (rootContext) {
      this._appendContextEntries(entries, seen, rootContext, 'PipelineOwner', true)
    }
    this._selectedAppContextTarget = target
    this._selectedAppContextIndex = index
    this._selectedAppContextRevision = contextRevision
    this._selectedAppContextEntries = entries
    return entries
  }

  private _appendContextEntries(
    output: LayoutInspectorAppContextEntry[],
    seen: Set<AppContextLookupKey>,
    context: AppContextRegistry,
    source: string,
    includeParents: boolean,
  ): void {
    let current: AppContextRegistry | undefined = context
    let depth = 0
    while (current) {
      for (const key of current.keys()) {
        if (seen.has(key)) continue
        seen.add(key)
        const rawValue = current.getOwn(key as never)
        output.push({
          key: formatContextKey(key),
          source: depth === 0 ? source : `${source} parent ${depth}`,
          value: formatContextValue(rawValue),
          rawValue,
        })
      }
      if (!includeParents) return
      current = current.parent
      depth++
    }
  }

  private _contextSourceLabel(target: RenderObject): string {
    const info = target.debugInfo()
    return `${info.typeName} #${info.debugId}`
  }

  private _discardStalePaths(options: { requestPaint?: boolean, emit?: boolean } = {}): boolean {
    let changed = false
    if (this.selectedPath && !this._isPathReachable(this.selectedPath)) {
      this.selectedPath = null
      this._selectedPathIndex = -1
      this._setSelectedTreeRoot(null)
      changed = true
    }
    if (this.hoverPath && !this._isPathReachable(this.hoverPath)) {
      this.hoverPath = null
      changed = true
    }
    if (!changed) return false
    if (!this.overlayVisible && !this.selectedPath && !this.hoverPath) this.enabled = false
    this._needsOverlayClear = true
    if (options.requestPaint && this.overlayVisible) this._requestPaint()
    if (options.emit) this._emitChanged()
    return true
  }

  private _isPathReachable(path: HitTestResult): boolean {
    if (path.isEmpty) return false
    return path.path.every(entry => (
      entry.target instanceof RenderObject &&
      this._isRenderObjectReachable(entry.target)
    ))
  }

  private _isRenderObjectReachable(target: RenderObject): boolean {
    const roots = this._dispatcher.getRoots()
    const seen = new Set<RenderObject>()
    let current: RenderObject | undefined = target
    while (current && !seen.has(current)) {
      if (roots.includes(current)) return true
      seen.add(current)
      current = current.parent
    }
    return false
  }

  private _findPathByDebugId(root: RenderObject, debugId: number): RenderObject[] | null {
    const path: RenderObject[] = []
    const visit = (node: RenderObject): boolean => {
      path.push(node)
      if (node.debugInfo().debugId === debugId) return true
      let found = false
      node.visitChildren(child => {
        if (!found) found = visit(child)
      })
      if (found) return true
      path.pop()
      return false
    }
    return visit(root) ? [...path] : null
  }

  private _revealPath(path: readonly RenderObject[]): boolean {
    const target = path[path.length - 1]
    if (!target) return false
    let revealed = false
    for (let index = path.length - 2; index >= 0; index--) {
      const ancestor = path[index] as RenderObject & Partial<LayoutInspectorRevealContainer>
      if (typeof ancestor.revealDescendant === 'function') {
        revealed = ancestor.revealDescendant(target) || revealed
      }
    }
    return revealed
  }

  private _debugTreeForRoot(root: RenderObject | null): LayoutInspectorTreeNode | undefined {
    if (!root) return undefined
    const seen = new Set<RenderObject>()
    const visit = (node: RenderObject): LayoutInspectorTreeNode => {
      seen.add(node)
      const children: LayoutInspectorTreeNode[] = []
      node.visitChildren(child => {
        if (!seen.has(child)) children.push(visit(child))
      })
      return {
        info: node.debugInfo(),
        children,
      }
    }
    return visit(root)
  }

  private _debugTreeForSelectedRoot(): LayoutInspectorTreeNode | undefined {
    if (!this._selectedTreeRoot) return undefined
    const revision = this._selectedTreeRoot.debugTreeRevision
    if (!this._selectedTree || this._selectedTreeRevision !== revision) {
      this._selectedTree = this._debugTreeForRoot(this._selectedTreeRoot)
      this._selectedTreeRevision = revision
    }
    return this._selectedTree
  }

  private _setSelectedTreeRoot(root: RenderObject | null): void {
    if (this._selectedTreeRoot === root) return
    this._selectedTreeRoot = root
    this._selectedTree = undefined
    this._selectedTreeRevision = -1
    this._selectedAppContextTarget = null
    this._selectedAppContextIndex = -1
    this._selectedAppContextRevision = ''
    this._selectedAppContextEntries = undefined
  }

  private _appContextRevisionForTarget(target: RenderObject): string {
    const parts: string[] = []
    const visited = new Set<RenderObject>()
    let current: RenderObject | undefined = target
    while (current && !visited.has(current)) {
      visited.add(current)
      if (isAppContextProvider(current)) {
        parts.push(`node:${contextRevisionSignature(current[APP_CONTEXT_PROVIDER]())}`)
      }
      current = current.parent
    }
    if (target.owner?.appContext) {
      parts.push(`owner:${contextRevisionSignature(target.owner.appContext)}`)
    }
    return parts.join('|')
  }

  private _emitChanged(): void {
    if (this._listeners.size === 0) return
    const state = this.debugState()
    for (const listener of this._listeners) listener(state)
  }
}

function formatContextKey(key: AppContextLookupKey): string {
  return typeof key === 'string' ? key : key.description
}

const contextIds = new WeakMap<AppContextRegistry, number>()
let nextContextId = 1

function contextRevisionSignature(context: AppContextRegistry): string {
  const parts: string[] = []
  let current: AppContextRegistry | undefined = context
  while (current) {
    parts.push(`${contextId(current)}:${current.revision}`)
    current = current.parent
  }
  return parts.join('>')
}

function contextId(context: AppContextRegistry): number {
  let id = contextIds.get(context)
  if (!id) {
    id = nextContextId
    nextContextId += 1
    contextIds.set(context, id)
  }
  return id
}

function formatContextValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return limitText(JSON.stringify(value))
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  if (typeof value === 'symbol') return value.description ? `Symbol(${value.description})` : 'Symbol()'
  if (typeof value === 'function') return `[Function ${(value as Function).name || 'anonymous'}]`
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
  if (value instanceof Map) return limitText(`Map(${value.size}) ${stringifyContextValue([...value.entries()])}`, CONTEXT_VALUE_MAX_LENGTH)
  if (value instanceof Set) return limitText(`Set(${value.size}) ${stringifyContextValue([...value.values()])}`, CONTEXT_VALUE_MAX_LENGTH)
  if (Array.isArray(value)) return limitText(`Array(${value.length}) ${stringifyContextValue(value)}`, CONTEXT_VALUE_MAX_LENGTH)
  if (typeof value === 'object') {
    const name = value.constructor?.name
    const serialized = stringifyContextValue(value)
    return limitText(name && name !== 'Object' ? `${name} ${serialized}` : serialized, CONTEXT_VALUE_MAX_LENGTH)
  }
  return limitText(String(value))
}

function stringifyContextValue(value: unknown): string {
  const seen = new WeakSet<object>()
  const depths = new WeakMap<object, number>()
  try {
    const text = JSON.stringify(value, function (this: unknown, _key, next) {
      if (typeof next === 'bigint') return `${next}n`
      if (typeof next === 'function') return `[Function ${next.name || 'anonymous'}]`
      if (!next || typeof next !== 'object') return next
      const parentDepth = typeof this === 'object' && this ? depths.get(this) ?? 0 : 0
      const depth = parentDepth + 1
      if (seen.has(next)) return '[Circular]'
      if (depth > 3) return Array.isArray(next) ? `[Array(${next.length})]` : `[${next.constructor?.name || 'Object'}]`
      seen.add(next)
      depths.set(next, depth)
      return next
    })
    return text ?? String(value)
  } catch (error) {
    return error instanceof Error ? `<unserializable: ${error.message}>` : String(value)
  }
}

function limitText(text: string, maxLength = 120): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text
}
