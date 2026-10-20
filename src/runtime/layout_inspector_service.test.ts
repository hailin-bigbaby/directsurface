// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  APP_CONTEXT_PROVIDER,
  AppContextRegistry,
  createAppContextKey,
} from '../core/app_context'
import { PipelineOwner, RenderObject, type BoxConstraints, type Offset } from '../core/render_object'
import { RenderBox } from '../layout/render_box'
import type { PaintContext } from '../rendering/paint_context'
import { EventDispatcher } from '../gestures/recognizers'
import { RenderScrollViewer } from '../widgets/scroll_view'
import { LayoutInspectorService } from './layout_inspector_service'

class TestNode extends RenderBox {
  children: RenderObject[] = []

  constructor(width: number, height: number) {
    super()
    this.size = { width, height }
  }

  addChild(child: RenderObject): void {
    child.parent = this
    this.children.push(child)
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    for (const child of this.children) visitor(child)
  }

  performLayout(_constraints: BoxConstraints): void {}
  performPaint(_context: PaintContext, _offset: Offset): void {}
}

class ContextNode extends TestNode {
  constructor(
    width: number,
    height: number,
    readonly appContext: AppContextRegistry,
  ) {
    super(width, height)
  }

  [APP_CONTEXT_PROVIDER](): AppContextRegistry {
    return this.appContext
  }
}

describe('LayoutInspectorService', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('selects the deepest hit target and exposes debug state', () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, toJSON: () => ({}),
    })
    const dispatcher = new EventDispatcher(canvas)
    const requestPaint = vi.fn()
    const inspector = new LayoutInspectorService(dispatcher, requestPaint)
    const root = new TestNode(200, 200)
    const child = new TestNode(40, 40)
    child.offset = { x: 20, y: 30 }
    root.addChild(child)
    dispatcher.addRoot(root)

    inspector.inspectAt({ x: 30, y: 40 })

    expect(inspector.enabled).toBe(true)
    expect(inspector.overlayVisible).toBe(true)
    expect(inspector.selectedPath?.deepest?.target).toBe(child)
    expect(inspector.debugState().selected?.typeName).toBe('TestNode')
    expect(inspector.debugState().selectedPathIndex).toBe(1)
    expect(inspector.debugState().selectedPathInfo.map(info => info.typeName)).toEqual(['TestNode', 'TestNode'])
    expect(requestPaint).toHaveBeenCalledTimes(1)

    dispatcher.dispose()
  })

  it('reuses the selected render tree while hover state changes', () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, toJSON: () => ({}),
    })
    const dispatcher = new EventDispatcher(canvas)
    const requestPaint = vi.fn()
    const inspector = new LayoutInspectorService(dispatcher, requestPaint)
    const root = new TestNode(200, 200)
    const child = new TestNode(40, 40)
    child.offset = { x: 20, y: 30 }
    root.addChild(child)
    dispatcher.addRoot(root)
    const visitRoot = vi.spyOn(root, 'visitChildren')
    const visitChild = vi.spyOn(child, 'visitChildren')

    inspector.inspectAt({ x: 30, y: 40 })
    const firstTree = inspector.debugState().renderTree
    expect(firstTree?.info.typeName).toBe('TestNode')
    expect(visitRoot).toHaveBeenCalled()
    expect(visitChild).toHaveBeenCalled()

    visitRoot.mockClear()
    visitChild.mockClear()
    inspector.hoverAt({ x: 40, y: 50 })
    visitRoot.mockClear()
    visitChild.mockClear()
    const nextTree = inspector.debugState().renderTree

    expect(nextTree).toBe(firstTree)
    expect(visitRoot).not.toHaveBeenCalled()
    expect(visitChild).not.toHaveBeenCalled()

    dispatcher.dispose()
  })

  it('rebuilds the selected render tree when the root structure changes', () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, toJSON: () => ({}),
    })
    const dispatcher = new EventDispatcher(canvas)
    const inspector = new LayoutInspectorService(dispatcher, vi.fn())
    const root = new TestNode(200, 200)
    const firstChild = new TestNode(40, 40)
    const secondChild = new TestNode(30, 30)
    root.addChild(firstChild)
    dispatcher.addRoot(root)

    inspector.inspectAt({ x: 10, y: 10 })
    const firstTree = inspector.debugState().renderTree

    root.addChild(secondChild)
    const nextTree = inspector.debugState().renderTree

    expect(nextTree).not.toBe(firstTree)
    expect(nextTree?.children).toHaveLength(2)

    dispatcher.dispose()
  })

  it('updates hover only when enabled and clears selected state', () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, toJSON: () => ({}),
    })
    const dispatcher = new EventDispatcher(canvas)
    const requestPaint = vi.fn()
    const inspector = new LayoutInspectorService(dispatcher, requestPaint)
    const root = new TestNode(100, 100)
    dispatcher.addRoot(root)

    inspector.hoverAt({ x: 10, y: 10 })
    expect(inspector.hoverPath).toBeNull()

    inspector.toggleOverlay(true)
    inspector.hoverAt({ x: 10, y: 10 })
    expect(inspector.hoverPath?.deepest?.target).toBe(root)

    inspector.clearSelection()
    expect(inspector.hoverPath).toBeNull()
    expect(inspector.selectedPath).toBeNull()

    dispatcher.dispose()
  })

  it('clears hover and skips debug hit testing when the overlay is hidden', () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, toJSON: () => ({}),
    })
    const dispatcher = new EventDispatcher(canvas)
    const requestPaint = vi.fn()
    const inspector = new LayoutInspectorService(dispatcher, requestPaint)
    const root = new TestNode(100, 100)
    dispatcher.addRoot(root)
    const debugHitTest = vi.spyOn(dispatcher, 'debugHitTest')

    inspector.toggleOverlay(true)
    inspector.hoverAt({ x: 10, y: 10 })
    expect(inspector.debugState().hover?.typeName).toBe('TestNode')
    expect(debugHitTest).toHaveBeenCalledTimes(1)

    inspector.toggleOverlay(false)
    debugHitTest.mockClear()
    inspector.hoverAt({ x: 20, y: 20 })

    const state = inspector.debugState()
    expect(state.enabled).toBe(false)
    expect(state.overlayVisible).toBe(false)
    expect(state.hover).toBeUndefined()
    expect(debugHitTest).not.toHaveBeenCalled()

    dispatcher.dispose()
  })

  it('deactivates hit testing and clears selected inspector state', () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, toJSON: () => ({}),
    })
    const dispatcher = new EventDispatcher(canvas)
    const requestPaint = vi.fn()
    const inspector = new LayoutInspectorService(dispatcher, requestPaint)
    const root = new TestNode(100, 100)
    dispatcher.addRoot(root)
    const debugHitTest = vi.spyOn(dispatcher, 'debugHitTest')

    inspector.inspectAt({ x: 10, y: 10 })
    expect(inspector.debugState().selected?.typeName).toBe('TestNode')

    inspector.deactivate()
    debugHitTest.mockClear()
    inspector.hoverAt({ x: 20, y: 20 })

    const state = inspector.debugState()
    expect(state.enabled).toBe(false)
    expect(state.overlayVisible).toBe(false)
    expect(state.hover).toBeUndefined()
    expect(state.selected).toBeUndefined()
    expect(state.hoverPathLength).toBe(0)
    expect(state.selectedPathLength).toBe(0)
    expect(state.selectedPathIndex).toBe(-1)
    expect(debugHitTest).not.toHaveBeenCalled()
    expect(requestPaint).toHaveBeenCalledTimes(2)

    dispatcher.dispose()
  })

  it('locks the current hover path as the selected path', () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 120, bottom: 120, width: 120, height: 120, toJSON: () => ({}),
    })
    const dispatcher = new EventDispatcher(canvas)
    const requestPaint = vi.fn()
    const inspector = new LayoutInspectorService(dispatcher, requestPaint)
    const root = new TestNode(120, 120)
    const child = new TestNode(30, 30)
    child.offset = { x: 10, y: 10 }
    root.addChild(child)
    dispatcher.addRoot(root)

    inspector.toggleOverlay(true)
    inspector.hoverAt({ x: 20, y: 20 })
    inspector.lockSelection()

    expect(inspector.selectedPath?.deepest?.target).toBe(child)
    expect(inspector.overlayVisible).toBe(true)
    expect(requestPaint).toHaveBeenCalledTimes(3)

    dispatcher.dispose()
  })

  it('selects an ancestor from the current selected path without truncating the path', () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 120, bottom: 120, width: 120, height: 120, toJSON: () => ({}),
    })
    const dispatcher = new EventDispatcher(canvas)
    const requestPaint = vi.fn()
    const inspector = new LayoutInspectorService(dispatcher, requestPaint)
    const root = new TestNode(120, 120)
    root.debugName = 'root'
    const child = new TestNode(30, 30)
    child.debugName = 'child'
    child.offset = { x: 10, y: 10 }
    root.addChild(child)
    dispatcher.addRoot(root)

    inspector.inspectAt({ x: 20, y: 20 })
    expect(inspector.selectSelectedPathIndex(0)).toBe(true)

    const state = inspector.debugState()
    expect(state.selected?.debugName).toBe('root')
    expect(state.selectedPathIndex).toBe(0)
    expect(state.selectedPathLength).toBe(2)
    expect(state.selectedPathInfo.map(info => info.debugName)).toEqual(['root', 'child'])
    expect(requestPaint).toHaveBeenCalledTimes(2)

    dispatcher.dispose()
  })

  it('drops a selected path after the selected render object is detached', () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 120, width: 200, height: 120, toJSON: () => ({}),
    })
    const dispatcher = new EventDispatcher(canvas)
    const requestPaint = vi.fn()
    const inspector = new LayoutInspectorService(dispatcher, requestPaint)
    const root = new TestNode(200, 120)
    const oldPage = new TestNode(60, 60)
    oldPage.debugName = 'old-page'
    oldPage.offset = { x: 10, y: 10 }
    const activePage = new TestNode(60, 60)
    activePage.debugName = 'active-page'
    activePage.offset = { x: 90, y: 10 }
    root.addChild(oldPage)
    root.addChild(activePage)
    dispatcher.addRoot(root)

    inspector.inspectAt({ x: 20, y: 20 })
    expect(inspector.debugState().selected?.debugName).toBe('old-page')

    root.children = root.children.filter(child => child !== oldPage)
    oldPage.parent = undefined
    inspector.hoverAt({ x: 100, y: 20 })

    const state = inspector.debugState()
    expect(state.selected).toBeUndefined()
    expect(state.selectedPathLength).toBe(0)
    expect(state.hover?.debugName).toBe('active-page')
    expect(inspector.shouldPaint()).toBe(true)

    dispatcher.dispose()
  })

  it('drops a selected path when a descendant is moved out of its inspected ancestor path', () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 240, bottom: 120, width: 240, height: 120, toJSON: () => ({}),
    })
    const dispatcher = new EventDispatcher(canvas)
    const inspector = new LayoutInspectorService(dispatcher, vi.fn())
    const root = new TestNode(240, 120)
    const oldPane = new TestNode(80, 80)
    oldPane.debugName = 'old-pane'
    oldPane.offset = { x: 10, y: 10 }
    const newPane = new TestNode(80, 80)
    newPane.debugName = 'new-pane'
    newPane.offset = { x: 120, y: 10 }
    const child = new TestNode(30, 30)
    child.debugName = 'moved-child'
    child.offset = { x: 5, y: 5 }
    oldPane.addChild(child)
    root.addChild(oldPane)
    root.addChild(newPane)
    dispatcher.addRoot(root)

    inspector.inspectAt({ x: 20, y: 20 })
    expect(inspector.selectSelectedPathIndex(1)).toBe(true)
    expect(inspector.debugState().selected?.debugName).toBe('old-pane')

    oldPane.children = []
    root.children = root.children.filter(candidate => candidate !== oldPane)
    oldPane.parent = undefined
    newPane.addChild(child)
    child.offset = { x: 10, y: 10 }

    const state = inspector.debugState()
    expect(state.selected).toBeUndefined()
    expect(state.selectedPathLength).toBe(0)

    dispatcher.dispose()
  })

  it('exposes a render tree for the inspected root and selects nodes from it', () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 160, bottom: 160, width: 160, height: 160, toJSON: () => ({}),
    })
    const dispatcher = new EventDispatcher(canvas)
    const requestPaint = vi.fn()
    const inspector = new LayoutInspectorService(dispatcher, requestPaint)
    const root = new TestNode(160, 160)
    root.debugName = 'root'
    const child = new TestNode(80, 80)
    child.debugName = 'child'
    child.offset = { x: 10, y: 10 }
    const grandchild = new TestNode(20, 20)
    grandchild.debugName = 'grandchild'
    grandchild.offset = { x: 5, y: 5 }
    child.addChild(grandchild)
    root.addChild(child)
    dispatcher.addRoot(root)

    inspector.inspectAt({ x: 20, y: 20 })

    const tree = inspector.debugState().renderTree
    expect(tree?.info.debugName).toBe('root')
    expect(tree?.children[0]?.info.debugName).toBe('child')
    expect(tree?.children[0]?.children[0]?.info.debugName).toBe('grandchild')

    expect(inspector.selectTreeNode(child.debugInfo().debugId)).toBe(true)

    const state = inspector.debugState()
    expect(state.selected?.debugName).toBe('child')
    expect(state.selectedPathInfo.map(info => info.debugName)).toEqual(['root', 'child'])
    expect(state.renderTree?.children[0]?.children[0]?.info.debugName).toBe('grandchild')
    expect(requestPaint).toHaveBeenCalledTimes(2)

    dispatcher.dispose()
  })

  it('exposes the selected render object app context with nearest values first', () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 160, bottom: 160, width: 160, height: 160, toJSON: () => ({}),
    })
    const dispatcher = new EventDispatcher(canvas)
    const requestPaint = vi.fn()
    const inspector = new LayoutInspectorService(dispatcher, requestPaint)
    const tenantKey = createAppContextKey<string>('tenant')
    const userKey = createAppContextKey<{ id: string }>('user')
    const rootOwnerContext = new AppContextRegistry(undefined, [['locale', 'zh-CN']])
    rootOwnerContext.set(userKey, { id: 'u-1' })
    const owner = new PipelineOwner({ appContext: rootOwnerContext })
    const rootContext = new AppContextRegistry(undefined, [[tenantKey, 'root-tenant']])
    const localContext = new AppContextRegistry(undefined, [[tenantKey, 'local-tenant']])
    localContext.set('numbers', [1, 2, 3])
    const root = new ContextNode(160, 160, rootContext)
    root.debugName = 'root'
    const scope = new ContextNode(80, 80, localContext)
    scope.debugName = 'local'
    scope.offset = { x: 10, y: 10 }
    const leaf = new TestNode(20, 20)
    leaf.debugName = 'leaf'
    leaf.offset = { x: 5, y: 5 }
    scope.addChild(leaf)
    root.addChild(scope)
    root.attach(owner)
    dispatcher.addRoot(root)

    inspector.inspectAt({ x: 20, y: 20 })

    const state = inspector.debugState()
    const appContext = state.selectedAppContext ?? []
    expect(state.selected?.debugName).toBe('leaf')
    expect(appContext).toEqual([
      expect.objectContaining({ key: 'tenant', value: '"local-tenant"', rawValue: 'local-tenant' }),
      expect.objectContaining({ key: 'numbers', value: 'Array(3) [1,2,3]', rawValue: [1, 2, 3] }),
      expect.objectContaining({ key: 'locale', source: 'PipelineOwner', value: '"zh-CN"', rawValue: 'zh-CN' }),
      expect.objectContaining({ key: 'user', source: 'PipelineOwner', value: '{"id":"u-1"}', rawValue: { id: 'u-1' } }),
    ])
    expect(appContext.filter(entry => entry.key === 'tenant')).toHaveLength(1)

    dispatcher.dispose()
  })

  it('reuses selected app context entries while the selected target is unchanged', () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 160, bottom: 160, width: 160, height: 160, toJSON: () => ({}),
    })
    const dispatcher = new EventDispatcher(canvas)
    const requestPaint = vi.fn()
    const inspector = new LayoutInspectorService(dispatcher, requestPaint)
    const toJSON = vi.fn(() => ({ id: 'ctx-1' }))
    const ownerContext = new AppContextRegistry(undefined, [['expensive', { toJSON }]])
    const owner = new PipelineOwner({ appContext: ownerContext })
    const root = new TestNode(160, 160)
    const leaf = new TestNode(20, 20)
    leaf.offset = { x: 5, y: 5 }
    root.addChild(leaf)
    root.attach(owner)
    dispatcher.addRoot(root)

    inspector.inspectAt({ x: 10, y: 10 })

    expect(inspector.debugState().selectedAppContext?.[0]).toEqual(
      expect.objectContaining({ key: 'expensive', value: '{"toJSON":"[Function]"}' }),
    )
    expect(toJSON).not.toHaveBeenCalled()

    inspector.hoverAt({ x: 12, y: 12 })
    expect(inspector.debugState().selectedAppContext?.[0]).toEqual(
      expect.objectContaining({ key: 'expensive', value: '{"toJSON":"[Function]"}' }),
    )
    expect(toJSON).not.toHaveBeenCalled()

    dispatcher.dispose()
  })

  it('refreshes selected app context entries when the context revision changes', () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 160, bottom: 160, width: 160, height: 160, toJSON: () => ({}),
    })
    const dispatcher = new EventDispatcher(canvas)
    const inspector = new LayoutInspectorService(dispatcher, vi.fn())
    const ownerContext = new AppContextRegistry(undefined, [['status', 'draft']])
    const owner = new PipelineOwner({ appContext: ownerContext })
    const root = new TestNode(160, 160)
    root.attach(owner)
    dispatcher.addRoot(root)

    inspector.inspectAt({ x: 10, y: 10 })
    expect(inspector.debugState().selectedAppContext?.[0]).toEqual(
      expect.objectContaining({ key: 'status', value: '"draft"' }),
    )

    ownerContext.set('status', 'signed')
    expect(inspector.debugState().selectedAppContext?.[0]).toEqual(
      expect.objectContaining({ key: 'status', value: '"signed"' }),
    )

    dispatcher.dispose()
  })

  it('reveals selected tree nodes inside scroll containers before painting the highlight', () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 120, bottom: 80, width: 120, height: 80, toJSON: () => ({}),
    })
    const dispatcher = new EventDispatcher(canvas)
    const requestPaint = vi.fn()
    const inspector = new LayoutInspectorService(dispatcher, requestPaint)
    const target = new TestNode(20, 20)
    target.debugName = 'offscreen'
    target.offset = { x: 10, y: 170 }
    const content = new TestNode(100, 220)
    content.addChild(target)
    const scroll = new RenderScrollViewer({ child: content })
    scroll.layout({ minWidth: 0, maxWidth: 120, minHeight: 0, maxHeight: 80 }, false)
    dispatcher.addRoot(scroll)

    inspector.inspectAt({ x: 10, y: 10 })
    expect(scroll.scrollY).toBe(0)

    expect(inspector.selectTreeNode(target.debugInfo().debugId)).toBe(true)

    expect(scroll.scrollY).toBeGreaterThan(0)
    expect(inspector.debugState().selected?.debugName).toBe('offscreen')
    expect(target.globalOffset.y).toBeLessThan(80)
    expect(requestPaint).toHaveBeenCalledTimes(2)

    dispatcher.dispose()
  })

  it('notifies subscribers when the inspector state changes', () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 80, bottom: 80, width: 80, height: 80, toJSON: () => ({}),
    })
    const dispatcher = new EventDispatcher(canvas)
    const inspector = new LayoutInspectorService(dispatcher, vi.fn())
    const root = new TestNode(80, 80)
    dispatcher.addRoot(root)
    const states: boolean[] = []

    const unsubscribe = inspector.subscribe(state => states.push(state.overlayVisible))
    inspector.inspectAt({ x: 10, y: 10 })
    unsubscribe()
    inspector.toggleOverlay(false)

    expect(states).toEqual([false, true])

    dispatcher.dispose()
  })
})
