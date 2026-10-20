import { describe, expect, it } from 'vitest'
import type { BoxConstraints, LayoutContext, RenderObject } from '../core/render_object'
import { RenderBox } from './render_box'
import { RenderDockPanel } from './render_dock_panel'

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

class RecordingBox extends FixedBox {
  lastConstraints?: BoxConstraints

  override performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    this.lastConstraints = { ...constraints }
    super.performLayout(constraints, context)
  }
}

class WidthSensitiveBox extends RenderBox {
  lastConstraints?: BoxConstraints

  constructor(
    private readonly naturalWidth: number,
    private readonly breakpointWidth: number,
    private readonly wideHeight: number,
    private readonly narrowHeight: number,
  ) {
    super()
  }

  performLayout(constraints: BoxConstraints, _context: LayoutContext): void {
    this.lastConstraints = { ...constraints }
    const width = Math.max(constraints.minWidth, Math.min(constraints.maxWidth, this.naturalWidth))
    const preferredHeight = width <= this.breakpointWidth ? this.narrowHeight : this.wideHeight
    this.size = {
      width,
      height: Math.max(constraints.minHeight, Math.min(constraints.maxHeight, preferredHeight)),
    }
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}
}

describe('RenderDockPanel', () => {
  it('lays out shell regions around a fill child', () => {
    const toolbar = new FixedBox(80, 30)
    const nav = new FixedBox(120, 100)
    const status = new FixedBox(80, 20)
    const content = new FixedBox(10, 10)
    const panel = new RenderDockPanel()
    toolbar.height = 30
    nav.width = 120
    status.height = 20
    panel.addChild(toolbar, { dock: 'top' })
    panel.addChild(nav, { dock: 'left' })
    panel.addChild(status, { dock: 'bottom' })
    panel.setFill(content)

    panel.layout({ minWidth: 0, maxWidth: 400, minHeight: 0, maxHeight: 300 })

    expect(panel.size).toEqual({ width: 400, height: 300 })
    expect(toolbar.offset).toEqual({ x: 0, y: 0 })
    expect(toolbar.size).toEqual({ width: 400, height: 30 })
    expect(nav.offset).toEqual({ x: 0, y: 30 })
    expect(nav.size).toEqual({ width: 120, height: 270 })
    expect(status.offset).toEqual({ x: 120, y: 280 })
    expect(status.size).toEqual({ width: 280, height: 20 })
    expect(content.offset).toEqual({ x: 120, y: 30 })
    expect(content.size).toEqual({ width: 280, height: 250 })
  })

  it('derives natural size from docked children under loose constraints', () => {
    const toolbar = new FixedBox(240, 30)
    const nav = new FixedBox(120, 160)
    const content = new FixedBox(280, 140)
    const panel = new RenderDockPanel()
    panel.addChild(toolbar, { dock: 'top' })
    panel.addChild(nav, { dock: 'left' })
    panel.setFill(content)

    panel.layout({ minWidth: 0, maxWidth: Infinity, minHeight: 0, maxHeight: Infinity })

    expect(panel.size).toEqual({ width: 400, height: 190 })
    expect(toolbar.size).toEqual({ width: 400, height: 30 })
    expect(nav.size).toEqual({ width: 120, height: 160 })
    expect(content.size).toEqual({ width: 280, height: 160 })
  })

  it('does not leave natural measurement constraints on docked children', () => {
    const toolbar = new RecordingBox(240, 30)
    const nav = new RecordingBox(120, 160)
    const content = new RecordingBox(280, 140)
    const panel = new RenderDockPanel()
    panel.addChild(toolbar, { dock: 'top' })
    panel.addChild(nav, { dock: 'left' })
    panel.setFill(content)

    panel.layout({ minWidth: 0, maxWidth: Infinity, minHeight: 0, maxHeight: Infinity })

    expect(toolbar.lastConstraints).toEqual({ minWidth: 400, maxWidth: 400, minHeight: 0, maxHeight: 190 })
    expect(nav.lastConstraints).toEqual({ minWidth: 0, maxWidth: 400, minHeight: 160, maxHeight: 160 })
    expect(content.lastConstraints).toEqual({ minWidth: 280, maxWidth: 280, minHeight: 160, maxHeight: 160 })
  })

  it('measures fill height with the remaining dock width when height is unbounded', () => {
    const nav = new FixedBox(120, 24)
    const content = new WidthSensitiveBox(220, 140, 32, 88)
    const panel = new RenderDockPanel()
    nav.width = 120
    panel.addChild(nav, { dock: 'left' })
    panel.setFill(content)

    panel.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: Infinity })

    expect(panel.size).toEqual({ width: 260, height: 88 })
    expect(nav.size).toEqual({ width: 120, height: 88 })
    expect(content.lastConstraints).toEqual({ minWidth: 140, maxWidth: 140, minHeight: 88, maxHeight: 88 })
    expect(content.size).toEqual({ width: 140, height: 88 })
  })

  it('lets explicit child alignment override directional dock defaults', () => {
    const toolbar = new FixedBox(40, 20)
    toolbar.horizontalAlignment = 'center'
    const panel = new RenderDockPanel()
    panel.addChild(toolbar, { dock: 'top' })

    panel.layout({ minWidth: 100, maxWidth: 100, minHeight: 60, maxHeight: 60 })

    expect(toolbar.size).toEqual({ width: 40, height: 20 })
    expect(toolbar.offset).toEqual({ x: 30, y: 0 })
  })

  it('clears invisible docked children from ownership state', () => {
    const child = new FixedBox(120, 24)
    child.visible = false
    const panel = new RenderDockPanel()
    child.width = 120
    panel.addChild(child, { dock: 'left' })

    panel.clearChildren()

    expect(child.parent).toBeUndefined()
  })
})

describe('DockPanel fill replacement ownership', () => {
  it('releases metadata for replaced fill children while retaining edge metadata', () => {
    const dock = new RenderDockPanel(), edge = new FixedBox(20, 20)
    dock.addChild(edge, { dock: 'left' })
    let previous = new FixedBox(20, 20)
    dock.setFill(previous)
    for (let index = 0; index < 20; index++) {
      const next = new FixedBox(20, 20)
      dock.setFill(next)
      expect(previous.parent).toBeUndefined()
      expect(dock.childData.has(previous)).toBe(false)
      expect(dock.childData.size).toBe(2)
      previous.dispose(); previous = next
    }
    dock.setFill(undefined)
    expect(dock.childData.size).toBe(1)
    expect(dock.childData.get(edge)).toEqual({ dock: 'left' })
    previous.dispose(); dock.dispose()
  })
})
