import { describe, expect, it, vi } from 'vitest'
import { PaintContext } from '../rendering/paint_context'
import {
  PipelineOwner,
  RenderObject,
  type BoxConstraints,
  type LayoutContext,
  type Offset,
  type RenderLifecycleAware,
  type RenderLoadedContext,
} from './render_object'
import { RenderStackPanel } from '../layout/render_flex'
import { RenderText } from '../widgets/basic'
import { ImGuiDarkTheme, ImGuiLightTheme } from '../theme/default_theme'
import { rgba, type ResolvedTheme } from '../theme/theme'
import { RenderSlider } from '../widgets/slider'
import { RenderProgressBar } from '../widgets/progress_bar'
import { RenderSplitter } from '../widgets/splitter'
import { RenderScrollViewer } from '../widgets/scroll_view'
import { RenderDataGrid, type GridColumnDef } from '../widgets/grid_view'
import { RenderDatePicker } from '../widgets/date_picker'
import { RenderTabs } from '../widgets/tabs'
import { RenderTable } from '../widgets/table'
import { RenderTreeView } from '../widgets/tree'
import { RenderWindow } from '../widgets/window'
import { PopupManager } from './popup_manager'
import { RenderBorder } from '../widgets/border'
import { RenderCanvas } from '../layout/render_anchor'

const constraints: BoxConstraints = {
  minWidth: 0,
  maxWidth: 100,
  minHeight: 0,
  maxHeight: 50,
}

function createPaintContext(): PaintContext {
  const gradient = { addColorStop: vi.fn() }
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
  } as unknown as CanvasRenderingContext2D
  return new PaintContext(ctx)
}

interface GridRowData {
  id: number
  name: string
}

class TestNode extends RenderObject {
  children: TestNode[] = []
  layoutCalls = 0
  paintCalls = 0
  lastConstraints?: BoxConstraints

  addChild(child: TestNode): void {
    child.parent = this
    this.children.push(child)
  }

  triggerPaint(): void {
    this.requestPaint()
  }

  triggerLayout(): void {
    this.requestLayout()
  }

  performLayout(input: BoxConstraints, _context?: LayoutContext): void {
    this.layoutCalls++
    this.lastConstraints = { ...input }
    this.size = { width: input.maxWidth, height: input.maxHeight }
    for (const child of this.children) child.layout(input)
  }

  performPaint(_context: PaintContext, _offset: Offset): void {
    this.paintCalls++
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    for (const child of this.children) visitor(child)
  }
}

class ContextTrackingNode extends TestNode {
  lastPass?: LayoutContext['pass']

  override performLayout(input: BoxConstraints, context: LayoutContext): void {
    this.lastPass = context.pass
    super.performLayout(input)
  }
}

class LoadedTestNode extends TestNode implements RenderLifecycleAware {
  readonly loadedContexts: RenderLoadedContext[] = []

  onLoaded(context: RenderLoadedContext): void {
    this.loadedContexts.push(context)
  }
}

class DebugStateTestNode extends TestNode {
  debugState(): { selected: boolean } {
    return { selected: true }
  }
}

class StableDebugTypeNode extends TestNode {
  static override debugTypeName = 'StableDebugTypeNode'
}

class ChildSizeReadingNode extends RenderObject {
  constructor(private readonly child: RenderObject) {
    super()
    child.parent = this
  }

  performLayout(_input: BoxConstraints, context: LayoutContext): void {
    this.child.layout({
      minWidth: 0,
      maxWidth: 64,
      minHeight: 0,
      maxHeight: 32,
    }, true, context)
    this.child.offset = { x: 11, y: 13 }
    this.size = {
      width: this.child.size.width + 6,
      height: this.child.size.height + 4,
    }
  }

  performPaint(_context: PaintContext, _offset: Offset): void {}

  visitChildren(visitor: (child: RenderObject) => void): void {
    visitor(this.child)
  }
}

describe('RenderObject pipeline ownership', () => {
  it('disposes every child and detaches even when an earlier child throws', () => {
    const parent = new RenderStackPanel({ orientation: 'vertical' })
    const first = new RenderText('first')
    const second = new RenderText('second')
    parent.addChild(first)
    parent.addChild(second)
    const firstDispose = vi.spyOn(first, 'dispose').mockImplementation(() => {
      throw new Error('first child failed')
    })
    const secondDispose = vi.spyOn(second, 'dispose')

    expect(() => parent.dispose()).toThrow('first child failed')
    expect(firstDispose).toHaveBeenCalledTimes(1)
    expect(secondDispose).toHaveBeenCalledTimes(1)
    expect(first.parent).toBeUndefined()
    expect(second.parent).toBeUndefined()
    expect(parent.parent).toBeUndefined()
  })

  it('collapses invisible nodes out of layout paint and hit testing', () => {
    const node = new TestNode()
    node.visible = false

    node.layout(constraints)
    node.paint(createPaintContext(), { x: 0, y: 0 })

    expect(node.size).toEqual({ width: 0, height: 0 })
    expect(node.layoutCalls).toBe(0)
    expect(node.paintCalls).toBe(0)
    expect(node.hitTest({ x: 1, y: 1 })).toBe(false)
    expect(node.debugInfo().visible).toBe(false)
  })

  it('schedules layout and paint requests through PipelineOwner callbacks', () => {
    const onNeedLayout = vi.fn()
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout, onNeedPaint })
    const root = new TestNode()
    root.attach(owner)

    root.layout(constraints)
    root.paint({ ctx: {} as CanvasRenderingContext2D } as PaintContext, { x: 0, y: 0 })

    root.markNeedsPaint()
    root.markNeedsLayout()

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    expect(onNeedLayout).toHaveBeenCalledTimes(1)
  })

  it('coalesces frame commits by owner and flushes reentrant work next time', () => {
    const onNeedFrameCommit = vi.fn()
    const owner = new PipelineOwner({ onNeedFrameCommit })
    const root = new TestNode()
    const first = vi.fn()
    const second = vi.fn(() => {
      owner.scheduleFrameCommit(root, first)
    })
    root.attach(owner)

    owner.scheduleFrameCommit(root, first)
    owner.scheduleFrameCommit(root, second)

    expect(onNeedFrameCommit).toHaveBeenCalledTimes(1)
    owner.flushFrameCommits()
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()

    owner.flushFrameCommits()
    expect(first).toHaveBeenCalledTimes(1)
  })

  it('cancels pending frame commits when their render owner detaches', () => {
    const owner = new PipelineOwner()
    const root = new TestNode()
    const commit = vi.fn()
    root.attach(owner)

    owner.scheduleFrameCommit(root, commit)
    root.detach()
    owner.flushFrameCommits()

    expect(commit).not.toHaveBeenCalled()
  })

  it('detects nested changes on a shallow-frozen theme reference', () => {
    const textPrimary = { ...ImGuiLightTheme.textPrimary }
    const theme = Object.freeze({ ...ImGuiLightTheme, textPrimary }) as ResolvedTheme
    const owner = new PipelineOwner({}, theme)

    textPrimary.r = 1

    expect(owner.updateTheme(theme)).toBe('paint')
    expect(owner.theme.textPrimary).toEqual(rgba(1, textPrimary.g, textPrimary.b, textPrimary.a))
  })

  it('exposes layout debug info for inspector tooling', () => {
    const owner = new PipelineOwner()
    const root = new TestNode()
    const child = new DebugStateTestNode()
    root.addChild(child)
    root.attach(owner)
    root.offset = { x: 7, y: 9 }
    child.offset = { x: 3, y: 4 }
    child.debugName = 'field-editor'

    root.layout(constraints, false, { theme: ImGuiDarkTheme })

    const info = child.debugInfo()

    expect(info.debugId).toBeGreaterThan(0)
    expect(info.debugName).toBe('field-editor')
    expect(info.typeName).toBe('DebugStateTestNode')
    expect(info.offset).toEqual({ x: 3, y: 4 })
    expect(info.globalOffset).toEqual({ x: 10, y: 13 })
    expect(info.size).toEqual({ width: 100, height: 50 })
    expect(info.constraints).toEqual(constraints)
    expect(info.needsLayout).toBe(false)
    expect(info.needsPaint).toBe(true)
    expect(info.state).toEqual({ selected: true })
  })

  it('uses stable debug type names before constructor names', () => {
    const stable = new StableDebugTypeNode()
    const instanceOverride = new StableDebugTypeNode()
    instanceOverride.debugTypeName = 'InstanceDebugTypeNode'

    expect(stable.debugInfo().typeName).toBe('StableDebugTypeNode')
    expect(instanceOverride.debugInfo().typeName).toBe('InstanceDebugTypeNode')
  })

  it('uses local stable debug type names for built-in render classes', () => {
    expect(new RenderBorder().debugInfo().typeName).toBe('RenderBorder')
    expect(new RenderCanvas().debugInfo().typeName).toBe('RenderCanvas')
  })

  it('requests overlay repaint when a popup is open and a render object becomes paint-dirty', () => {
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedPaint })
    const root = new TestNode()
    const overlayPaint = vi.spyOn(PopupManager.instance, 'requestPaint')
    const popup = {
      hitTest: () => false,
      close: vi.fn(),
    }

    root.attach(owner)
    root.layout(constraints)
    root.paint({ ctx: {} as CanvasRenderingContext2D } as PaintContext, { x: 0, y: 0 })
    PopupManager.instance.open(popup)

    root.markNeedsPaint()

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    expect(overlayPaint).toHaveBeenCalledTimes(1)

    PopupManager.instance.closeAll()
    PopupManager.disposeInstance()
  })

  it('flushes dirty layout nodes with their last known constraints', () => {
    const owner = new PipelineOwner()
    const root = new TestNode()
    root.attach(owner)
    root.layout(constraints)

    root.markNeedsLayout()
    owner.flushLayout()

    expect(root.layoutCalls).toBe(2)
    expect(root.lastConstraints).toEqual(constraints)
  })

  it('syncs owner to children added after parent attach during layout', () => {
    const owner = new PipelineOwner()
    const root = new TestNode()
    const child = new TestNode()
    root.attach(owner)

    root.addChild(child)

    expect(child.owner).toBeUndefined()

    root.layout(constraints)

    expect(child.owner).toBe(owner)
  })

  it('does not fire onLoaded for detached manual layout', () => {
    const node = new LoadedTestNode()

    node.layout(constraints)

    expect(node.loadedContexts).toHaveLength(0)
  })

  it('fires onLoaded once after first attached layout with owner, theme, size, and constraints', () => {
    const theme = { ...ImGuiDarkTheme, fontSize: ImGuiDarkTheme.fontSize + 2 }
    const owner = new PipelineOwner({}, theme)
    const node = new LoadedTestNode()
    node.attach(owner)

    node.layout(constraints)
    node.layout({ minWidth: 0, maxWidth: 120, minHeight: 0, maxHeight: 80 })
    node.detach()
    node.attach(owner)
    node.layout({ minWidth: 0, maxWidth: 140, minHeight: 0, maxHeight: 90 })

    expect(node.loadedContexts).toHaveLength(1)
    expect(node.loadedContexts[0]?.owner).toBe(owner)
    expect(node.loadedContexts[0]?.theme).toBe(theme)
    expect(node.loadedContexts[0]?.size).toEqual({ width: 100, height: 50 })
    expect(node.loadedContexts[0]?.constraints).toEqual(constraints)
  })

  it('uses the layout context theme for onLoaded', () => {
    const owner = new PipelineOwner({}, ImGuiDarkTheme)
    const node = new LoadedTestNode()
    node.attach(owner)

    node.layout(constraints, false, { theme: ImGuiLightTheme })

    expect(node.loadedContexts).toHaveLength(1)
    expect(node.loadedContexts[0]?.theme).toBe(ImGuiLightTheme)
  })

  it('measures without firing onLoaded before the first real layout', () => {
    const owner = new PipelineOwner()
    const node = new LoadedTestNode()
    node.attach(owner)

    const measured = node.measure(constraints)

    expect(measured).toEqual({ width: 100, height: 50 })
    expect(node.loadedContexts).toHaveLength(0)

    node.layout(constraints)

    expect(node.loadedContexts).toHaveLength(1)
  })

  it('measures without replacing the last committed layout constraints', () => {
    const owner = new PipelineOwner()
    const node = new TestNode()
    node.attach(owner)
    node.layout(constraints)

    node.measure({ minWidth: 0, maxWidth: 240, minHeight: 0, maxHeight: 120 })

    expect(node.debugInfo().constraints).toEqual(constraints)
    expect(owner.getLastLayoutConstraints(node)).toEqual(constraints)
  })

  it('measures without replacing committed size or offset', () => {
    const node = new TestNode()
    node.offset = { x: 12, y: 8 }
    node.layout(constraints)

    const measured = node.measure({ minWidth: 0, maxWidth: 240, minHeight: 0, maxHeight: 120 })

    expect(measured).toEqual({ width: 240, height: 120 })
    expect(node.size).toEqual({ width: 100, height: 50 })
    expect(node.offset).toEqual({ x: 12, y: 8 })
  })

  it('lets measured parents read measured child sizes without committing child geometry', () => {
    const child = new TestNode()
    const parent = new ChildSizeReadingNode(child)
    child.layout({ minWidth: 0, maxWidth: 18, minHeight: 0, maxHeight: 12 })
    child.offset = { x: 3, y: 5 }

    const measured = parent.measure({ minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: 120 })

    expect(measured).toEqual({ width: 70, height: 36 })
    expect(child.size).toEqual({ width: 18, height: 12 })
    expect(child.offset).toEqual({ x: 3, y: 5 })
  })

  it('measures without clearing dirty layout or paint state', () => {
    const owner = new PipelineOwner()
    const node = new TestNode()
    node.attach(owner)
    node.layout(constraints)
    node.paint(createPaintContext(), { x: 0, y: 0 })
    node.markNeedsLayout()

    node.measure({ minWidth: 0, maxWidth: 240, minHeight: 0, maxHeight: 120 })

    expect(node.needsLayout).toBe(true)
    expect(node.needsPaint).toBe(false)
  })

  it('inherits measure pass for nested child layout calls without explicit context', () => {
    const owner = new PipelineOwner()
    const root = new ContextTrackingNode()
    const child = new ContextTrackingNode()
    root.addChild(child)
    root.attach(owner)

    root.measure(constraints)

    expect(root.lastPass).toBe('measure')
    expect(child.lastPass).toBe('measure')
    expect(child.needsLayout).toBe(true)
    expect(child.debugInfo().constraints).toBeUndefined()
  })

  it('fires onLoaded for a child dynamically added to an attached tree after its first layout', () => {
    const owner = new PipelineOwner()
    const root = new TestNode()
    const child = new LoadedTestNode()
    root.attach(owner)
    root.layout(constraints)

    root.addChild(child)
    root.layout(constraints)

    expect(child.owner).toBe(owner)
    expect(child.loadedContexts).toHaveLength(1)
    expect(child.loadedContexts[0]?.size).toEqual({ width: 100, height: 50 })
  })

  it('does not fire onLoaded from a stale detached layout when a child is attached before being laid out in the tree', () => {
    class UnmeasuredLateChildParent extends TestNode {
      readonly lateChild = new LoadedTestNode()
      shouldLayoutLateChild = false

      override performLayout(input: BoxConstraints): void {
        this.layoutCalls++
        this.lastConstraints = { ...input }
        this.size = { width: input.maxWidth, height: input.maxHeight }
        if (!this.children.includes(this.lateChild)) this.addChild(this.lateChild)
        if (this.shouldLayoutLateChild) this.lateChild.layout(input)
      }
    }

    const owner = new PipelineOwner()
    const root = new UnmeasuredLateChildParent()
    root.lateChild.layout({ minWidth: 0, maxWidth: 10, minHeight: 0, maxHeight: 10 })
    root.attach(owner)

    root.layout(constraints)

    expect(root.lateChild.owner).toBe(owner)
    expect(root.lateChild.loadedContexts).toHaveLength(0)

    root.shouldLayoutLateChild = true
    root.layout(constraints)

    expect(root.lateChild.loadedContexts).toHaveLength(1)
    expect(root.lateChild.loadedContexts[0]?.size).toEqual({ width: 100, height: 50 })
    expect(root.lateChild.loadedContexts[0]?.constraints).toEqual(constraints)
  })

  it('fires onLoaded for children that are attached by owner sync after parent layout', () => {
    class LateChildParent extends TestNode {
      readonly lateChild = new LoadedTestNode()

      override performLayout(input: BoxConstraints): void {
        this.layoutCalls++
        this.lastConstraints = { ...input }
        this.size = { width: input.maxWidth, height: input.maxHeight }
        if (!this.children.includes(this.lateChild)) this.addChild(this.lateChild)
        this.lateChild.layout(input)
      }
    }

    const owner = new PipelineOwner()
    const root = new LateChildParent()
    root.attach(owner)

    root.layout(constraints)

    expect(root.lateChild.owner).toBe(owner)
    expect(root.lateChild.loadedContexts).toHaveLength(1)
  })

  it('routes invalidation through the owner after attach', () => {
    const onNeedLayout = vi.fn()
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout, onNeedPaint })
    const root = new TestNode()
    root.attach(owner)
    root.layout(constraints)
    root.paint({ ctx: {} as CanvasRenderingContext2D } as PaintContext, { x: 0, y: 0 })

    root.triggerPaint()
    root.triggerLayout()

expect(onNeedPaint).toHaveBeenCalledTimes(1)
    expect(onNeedLayout).toHaveBeenCalledTimes(1)
  })

  it('tracks dirty paint bounds for the smallest invalidated subtree', () => {
    const owner = new PipelineOwner()
    const root = new TestNode()
    const child = new TestNode()
    root.addChild(child)
    root.attach(owner)
    root.layout(constraints)
    child.paint(createPaintContext(), child.globalOffset)
    child.offset = { x: 12, y: 8 }
    child.size = { width: 24, height: 10 }

    child.markNeedsPaint()

    expect(owner.hasDirtyPaintInSubtree(root)).toBe(true)
    expect(owner.getDirtyPaintRectInSubtree(root)).toEqual({
      x: 12,
      y: 8,
      width: 24,
      height: 10,
    })
  })

  it('accumulates explicit damage while a render object is already paint-dirty', () => {
    const owner = new PipelineOwner()
    const root = new TestNode()
    root.attach(owner)
    root.layout(constraints)
    root.paint(createPaintContext(), root.globalOffset)

    root.markNeedsPaint({ x: 10, y: 8, width: 20, height: 12 })
    root.markNeedsPaint({ x: 42, y: 30, width: 18, height: 10 })

    expect(owner.getDirtyPaintRectInSubtree(root)).toEqual({
      x: 10,
      y: 8,
      width: 50,
      height: 32,
    })
  })

  it('marks RenderText dirty for layout when text changes after attach', () => {
    const onNeedLayout = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout })
    const flex = new RenderStackPanel({ orientation: 'vertical' })
    flex.attach(owner)
    flex.layout(constraints)

    flex.addChild(new RenderText('item'))

    expect(onNeedLayout).toHaveBeenCalledTimes(1)
    expect(flex.needsLayout).toBe(true)
  })

  it('marks RenderSlider dirty for paint when value changes after attach', () => {
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedPaint })
    const slider = new RenderSlider({ value: 0 })
    slider.attach(owner)
    slider.layout(constraints)
    slider.paint(createPaintContext(), { x: 0, y: 0 })

    slider.value = 0.5

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    expect(slider.needsPaint).toBe(true)
  })

  it('marks RenderProgressBar dirty for paint when value changes after attach', () => {
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedPaint })
    const progress = new RenderProgressBar({ value: 0.2 })
    progress.attach(owner)
    progress.layout(constraints)
    progress.paint(createPaintContext(), { x: 0, y: 0 })

    progress.value = 0.8

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    expect(progress.needsPaint).toBe(true)
  })

  it('marks RenderSplitter dirty for layout when ratio changes after attach', () => {
    const onNeedLayout = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout })
    const first = new RenderStackPanel({ orientation: 'vertical' })
    const second = new RenderStackPanel({ orientation: 'vertical' })
    const splitter = new RenderSplitter({
      first,
      second,
      ratio: 0.5,
    })
    splitter.attach(owner)
    splitter.layout(constraints)

    splitter.ratio = 0.25

    expect(onNeedLayout).toHaveBeenCalledTimes(1)
    expect(splitter.needsLayout).toBe(true)
  })

  it('marks RenderDataGrid dirty for layout when columns change after attach', () => {
    const onNeedLayout = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout })
    const columns: GridColumnDef<GridRowData>[] = [
      { key: 'id', title: 'ID', type: 'number', width: 40, editable: false },
    ]
    const grid = new RenderDataGrid<GridRowData>({
      columns,
      rows: [{ id: 1, name: 'Alpha' }],
    })
    grid.attach(owner)
    grid.layout(constraints)

    grid.columns = [
      ...columns,
      { key: 'name', title: 'Name', type: 'text', width: 80 },
    ]

    expect(onNeedLayout).toHaveBeenCalledTimes(1)
    expect(grid.needsLayout).toBe(true)
  })

  it('marks RenderDataGrid dirty for paint when rows change after attach', () => {
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedPaint })
    const grid = new RenderDataGrid<GridRowData>({
      columns: [
        { key: 'id', title: 'ID', type: 'number', width: 40, editable: false },
      ],
      rows: [{ id: 1, name: 'Alpha' }],
    })
    grid.attach(owner)
    grid.layout(constraints)
    grid.paint(createPaintContext(), { x: 0, y: 0 })

    grid.rows = [{ id: 2, name: 'Beta' }]

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    expect(grid.needsPaint).toBe(true)
  })

  it('marks RenderDataGrid dirty for paint when sortState changes after attach', () => {
    const onNeedLayout = vi.fn()
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout, onNeedPaint })
    const grid = new RenderDataGrid<GridRowData>({
      columns: [
        { key: 'id', title: 'ID', type: 'number', width: 40, editable: false, sortable: true },
      ],
      rows: [{ id: 1, name: 'Alpha' }],
      sortable: true,
    })
    grid.attach(owner)
    grid.layout(constraints)
    grid.paint(createPaintContext(), { x: 0, y: 0 })

    grid.sortState = { key: 'id', order: 'asc' }

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    expect(onNeedLayout).not.toHaveBeenCalled()
    expect(grid.needsPaint).toBe(true)
  })

  it('marks RenderDataGrid dirty for paint when selection changes programmatically', () => {
    const onNeedLayout = vi.fn()
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout, onNeedPaint })
    const grid = new RenderDataGrid<GridRowData>({
      columns: [
        { key: 'id', title: 'ID', type: 'number', width: 40, editable: false },
      ],
      rows: [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }],
    })
    grid.attach(owner)
    grid.layout(constraints)
    grid.paint(createPaintContext(), { x: 0, y: 0 })

    grid.setSelectedRows([grid.rows[1]!])

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    expect(onNeedLayout).not.toHaveBeenCalled()
    expect(grid.needsPaint).toBe(true)
  })

  it('marks RenderScrollViewer dirty for layout when child changes after attach', () => {
    const onNeedLayout = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout })
    const initialChild = new RenderStackPanel({ orientation: 'vertical' })
    const replacementChild = new RenderStackPanel({ orientation: 'vertical' })
    const view = new RenderScrollViewer({
      child: initialChild,
    })
    view.attach(owner)
    view.layout(constraints)

    view.setChild(replacementChild)

    expect(onNeedLayout).toHaveBeenCalledTimes(1)
    expect(view.needsLayout).toBe(true)
    expect(replacementChild.parent).toBe(view)
  })

  it('marks RenderWindow dirty for layout when children are replaced after attach', () => {
    const onNeedLayout = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout })
    const first = new RenderStackPanel({ orientation: 'vertical' })
    const second = new RenderStackPanel({ orientation: 'vertical' })
    const win = new RenderWindow({
      title: 'Test',
      width: 200,
      height: 120,
    })
    win.setChildren([first])
    win.attach(owner)
    win.layout(constraints)

    win.setChildren([second])

    expect(onNeedLayout).toHaveBeenCalledTimes(1)
    expect(win.needsLayout).toBe(true)
    expect(first.parent).toBeUndefined()
    expect(second.parent).toBe(win)
  })

  it('marks RenderDataGrid dirty for paint when focusRow changes focus programmatically', () => {
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedPaint })
    const grid = new RenderDataGrid<GridRowData>({
      columns: [
        { key: 'id', title: 'ID', type: 'number', width: 40, editable: false },
      ],
      rows: [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }],
    })
    grid.attach(owner)
    grid.layout(constraints)
    grid.paint(createPaintContext(), { x: 0, y: 0 })

    grid.focusRow(grid.rows[1]!, { select: true, scroll: false })

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    expect(grid.needsPaint).toBe(true)
  })

  it('marks RenderDataGrid dirty for paint when presentation hooks change after attach', () => {
    const assertPaintDirty = (mutate: (grid: RenderDataGrid<GridRowData>) => void) => {
      const onNeedPaint = vi.fn()
      const owner = new PipelineOwner({ onNeedPaint })
      const grid = new RenderDataGrid<GridRowData>({
        columns: [
          { key: 'id', title: 'ID', type: 'number', width: 40, editable: false },
          { key: 'name', title: 'Name', type: 'text', width: 80 },
        ],
        rows: [{ id: 1, name: 'Alpha' }],
      })
      grid.attach(owner)
      grid.layout(constraints)
      grid.paint(createPaintContext(), { x: 0, y: 0 })

      mutate(grid)

      expect(onNeedPaint).toHaveBeenCalledTimes(1)
      expect(grid.needsPaint).toBe(true)
    }

    assertPaintDirty(grid => {
      grid.getCellDisplayText = () => 'display'
    })
    assertPaintDirty(grid => {
      grid.resolveRowStyle = () => null
    })
    assertPaintDirty(grid => {
      grid.resolveCellStyle = () => null
    })
  })

  it('marks RenderTabs dirty for paint when activeKey changes after attach', () => {
    const onNeedLayout = vi.fn()
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout, onNeedPaint })
    const tabs = new RenderTabs({
      tabs: [
        { key: 'controls', label: 'Controls' },
        { key: 'grid', label: 'Grid' },
      ],
      activeKey: 'controls',
    })
    tabs.attach(owner)
    tabs.layout(constraints)
    tabs.paint(createPaintContext(), { x: 0, y: 0 })

    tabs.activeKey = 'grid'

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    expect(onNeedLayout).not.toHaveBeenCalled()
    expect(tabs.needsPaint).toBe(true)
  })

  it('marks RenderDatePicker dirty for paint when value changes after attach', () => {
    const onNeedLayout = vi.fn()
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout, onNeedPaint })
    const picker = new RenderDatePicker({
      value: '2026-04-14',
    })
    picker.attach(owner)
    picker.layout(constraints)
    picker.paint(createPaintContext(), { x: 0, y: 0 })

    picker.value = '2026-04-15'

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    expect(onNeedLayout).not.toHaveBeenCalled()
    expect(picker.needsPaint).toBe(true)
  })

  it('marks RenderTable dirty for paint when rows change after attach', () => {
    const onNeedLayout = vi.fn()
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout, onNeedPaint })
    const table = new RenderTable<GridRowData>({
      columns: [
        { key: 'id', title: 'ID', width: 40 },
      ],
      rows: [{ id: 1, name: 'Alpha' }],
      rowHeight: 20,
      headerHeight: 20,
    })
    table.attach(owner)
    table.layout(constraints)
    table.paint(createPaintContext(), { x: 0, y: 0 })

    table.rows = [{ id: 2, name: 'Beta' }]

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    expect(onNeedLayout).not.toHaveBeenCalled()
    expect(table.needsPaint).toBe(true)
  })

  it('marks RenderTable dirty for paint when sortState changes after attach', () => {
    const onNeedLayout = vi.fn()
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout, onNeedPaint })
    const table = new RenderTable<GridRowData>({
      columns: [
        { key: 'id', title: 'ID', width: 40, sortable: true },
      ],
      rows: [{ id: 1, name: 'Alpha' }],
      rowHeight: 20,
      headerHeight: 20,
    })
    table.attach(owner)
    table.layout(constraints)
    table.paint(createPaintContext(), { x: 0, y: 0 })

    table.sortState = { key: 'id', order: 'asc' }

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    expect(onNeedLayout).not.toHaveBeenCalled()
    expect(table.needsPaint).toBe(true)
  })

  it('marks RenderTable dirty for paint when selection changes programmatically', () => {
    const onNeedLayout = vi.fn()
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout, onNeedPaint })
    const table = new RenderTable<GridRowData>({
      columns: [
        { key: 'id', title: 'ID', width: 40 },
      ],
      rows: [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }],
      rowHeight: 20,
      headerHeight: 20,
    })
    table.attach(owner)
    table.layout(constraints)
    table.paint(createPaintContext(), { x: 0, y: 0 })

    table.setSelectedRows([1])

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    expect(onNeedLayout).not.toHaveBeenCalled()
    expect(table.needsPaint).toBe(true)
  })

  it('marks RenderTreeView dirty for paint when roots change after attach', () => {
    const onNeedLayout = vi.fn()
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout, onNeedPaint })
    const tree = new RenderTreeView({
      roots: [{ key: 'root', label: 'Root' }],
    })
    tree.attach(owner)
    tree.layout(constraints)
    tree.paint(createPaintContext(), { x: 0, y: 0 })

    tree.roots = [{ key: 'next', label: 'Next' }]

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    expect(onNeedLayout).not.toHaveBeenCalled()
    expect(tree.needsPaint).toBe(true)
  })

  it('marks RenderTreeView dirty for paint when selectedKey changes after attach', () => {
    const onNeedLayout = vi.fn()
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout, onNeedPaint })
    const tree = new RenderTreeView({
      roots: [{ key: 'root', label: 'Root' }],
    })
    tree.attach(owner)
    tree.layout(constraints)
    tree.paint(createPaintContext(), { x: 0, y: 0 })

    tree.selectedKey = 'root'

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    expect(onNeedLayout).not.toHaveBeenCalled()
    expect(tree.needsPaint).toBe(true)
  })

  it('marks RenderTreeView dirty for paint when expandedKeys change after attach', () => {
    const onNeedLayout = vi.fn()
    const onNeedPaint = vi.fn()
    const owner = new PipelineOwner({ onNeedLayout, onNeedPaint })
    const tree = new RenderTreeView({
      roots: [{
        key: 'root',
        label: 'Root',
        children: [{ key: 'child', label: 'Child' }],
      }],
    })
    tree.attach(owner)
    tree.layout(constraints)
    tree.paint(createPaintContext(), { x: 0, y: 0 })

    tree.expandedKeys = ['root']

    expect(onNeedPaint).toHaveBeenCalledTimes(1)
    expect(onNeedLayout).not.toHaveBeenCalled()
    expect(tree.needsPaint).toBe(true)
  })
})
