import { afterEach, describe, expect, it, vi } from 'vitest'
import { PipelineOwner, type BoxConstraints, type LayoutContext, type RenderLifecycleAware, type RenderLoadedContext, type RenderObject } from '../core/render_object'
import { RenderBox } from './render_box'
import { RenderUniformGrid } from './render_uniform_grid'
import { RenderParagraph } from '../widgets/basic'
import { TextMeasurer } from '../core/text_measurer'

afterEach(() => { vi.restoreAllMocks() })

class FixedBox extends RenderBox {
  constructor(
    private readonly desiredWidth: number,
    private readonly desiredHeight: number,
  ) {
    super()
  }

  performLayout(constraints: BoxConstraints, _context: LayoutContext): void {
    this.size = {
      width: Math.max(constraints.minWidth, Math.min(constraints.maxWidth, this.desiredWidth)),
      height: Math.max(constraints.minHeight, Math.min(constraints.maxHeight, this.desiredHeight)),
    }
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}
}

class LoadedFixedBox extends FixedBox implements RenderLifecycleAware {
  readonly loadedContexts: RenderLoadedContext[] = []

  onLoaded(context: RenderLoadedContext): void {
    this.loadedContexts.push(context)
  }
}

class WidthSensitiveBox extends RenderBox {
  constructor(
    private readonly naturalWidth: number,
    private readonly breakpointWidth: number,
    private readonly wideHeight: number,
    private readonly narrowHeight: number,
  ) {
    super()
  }

  performLayout(constraints: BoxConstraints, _context: LayoutContext): void {
    const width = Math.max(constraints.minWidth, Math.min(constraints.maxWidth, this.naturalWidth))
    const preferredHeight = width <= this.breakpointWidth ? this.narrowHeight : this.wideHeight
    this.size = {
      width,
      height: Math.max(constraints.minHeight, Math.min(constraints.maxHeight, preferredHeight)),
    }
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}
}

describe('RenderUniformGrid', () => {
  it('lays out children in equally sized cells', () => {
    const grid = new RenderUniformGrid({ columns: 2, columnGap: 10, rowGap: 4 })
    const first = new FixedBox(10, 10)
    const second = new FixedBox(10, 10)
    const third = new FixedBox(10, 10)
    grid.addChild(first)
    grid.addChild(second)
    grid.addChild(third)

    grid.layout({ minWidth: 0, maxWidth: 210, minHeight: 0, maxHeight: 104 })

    expect(first.size).toEqual({ width: 100, height: 50 })
    expect(second.offset).toEqual({ x: 110, y: 0 })
    expect(third.offset).toEqual({ x: 0, y: 54 })
    expect(grid.size).toEqual({ width: 210, height: 104 })
  })

  it('honors minimum constraints when unconstrained', () => {
    const grid = new RenderUniformGrid({ columns: 2, columnGap: 10, rowGap: 4 })
    const first = new FixedBox(40, 16)
    const second = new FixedBox(40, 16)
    grid.addChild(first)
    grid.addChild(second)

    grid.layout({ minWidth: 210, maxWidth: Infinity, minHeight: 52, maxHeight: Infinity })

    expect(first.size).toEqual({ width: 100, height: 52 })
    expect(second.offset).toEqual({ x: 110, y: 0 })
    expect(grid.size).toEqual({ width: 210, height: 52 })
  })

  it('invalidates layout when tracks or gaps change', () => {
    const grid = new RenderUniformGrid({ columns: 2 })
    grid.addChild(new FixedBox(10, 10))
    grid.layout({ minWidth: 0, maxWidth: 100, minHeight: 0, maxHeight: 40 })

    expect(grid.needsLayout).toBe(false)

    grid.columns = 3
    expect(grid.needsLayout).toBe(true)

    grid.layout({ minWidth: 0, maxWidth: 100, minHeight: 0, maxHeight: 40 })
    grid.rowGap = 6
    expect(grid.needsLayout).toBe(true)
  })

  it('does not fire child lifecycle while measuring the natural cell', () => {
    const owner = new PipelineOwner()
    const grid = new RenderUniformGrid({ columns: 2, columnGap: 10, rowGap: 4 })
    const child = new LoadedFixedBox(40, 16)
    grid.addChild(child)
    grid.addChild(new FixedBox(20, 10))
    grid.attach(owner)

    grid.layout({ minWidth: 0, maxWidth: 210, minHeight: 0, maxHeight: 52 })

    expect(child.loadedContexts).toHaveLength(1)
    expect(child.loadedContexts[0]?.constraints).toEqual({
      minWidth: 100,
      maxWidth: 100,
      minHeight: 52,
      maxHeight: 52,
    })
  })

  it('measures natural cell height with the resolved bounded cell width', () => {
    const grid = new RenderUniformGrid({ columns: 2, columnGap: 10, rowGap: 4 })
    const first = new WidthSensitiveBox(180, 100, 24, 72)
    const second = new FixedBox(20, 16)
    grid.addChild(first)
    grid.addChild(second)

    grid.layout({ minWidth: 0, maxWidth: 210, minHeight: 0, maxHeight: Infinity })

    expect(first.size).toEqual({ width: 100, height: 72 })
    expect(second.size).toEqual({ width: 100, height: 72 })
    expect(grid.size).toEqual({ width: 210, height: 72 })
  })

  it('skips invisible children when resolving cell count and natural cell size', () => {
    const grid = new RenderUniformGrid({ columns: 2, columnGap: 10, rowGap: 4 })
    const first = new FixedBox(20, 10)
    const hidden = new FixedBox(100, 50)
    const second = new FixedBox(30, 12)
    hidden.visible = false
    grid.addChild(first)
    grid.addChild(hidden)
    grid.addChild(second)

    grid.layout({ minWidth: 0, maxWidth: Infinity, minHeight: 0, maxHeight: Infinity })

    expect(grid.size).toEqual({ width: 70, height: 12 })
    expect(first.offset).toEqual({ x: 0, y: 0 })
    expect(second.offset).toEqual({ x: 40, y: 0 })
    expect(hidden.size).toEqual({ width: 0, height: 0 })
  })
})


describe('UniformGrid width-sensitive natural height', () => {
  it.each(['fixed', 'max', 'stretch'] as const)('uses the actual child width for %s text', kind => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => String(text).length * 8)
    const grid = new RenderUniformGrid({ columns: 1, columnGap: 0, rowGap: 0 })
    const paragraph = new RenderParagraph('1234567890'.repeat(4))
    if (kind === 'fixed') paragraph.width = 80
    if (kind === 'max') { paragraph.maxWidth = 80; paragraph.horizontalAlignment = 'center' }
    const next = new FixedBox(10, 10)
    grid.addChild(paragraph); grid.addChild(next)
    grid.layout({ minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: Infinity })
    expect(next.offset.y).toBeGreaterThanOrEqual(paragraph.offset.y + paragraph.size.height)
    expect(grid.size.height).toBeGreaterThanOrEqual(next.offset.y + next.size.height)
    grid.dispose()
  })
})
