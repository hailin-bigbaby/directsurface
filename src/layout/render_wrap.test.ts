import { describe, expect, it } from 'vitest'
import { PipelineOwner, type RenderLoadedContext, type BoxConstraints, type LayoutContext, type RenderObject } from '../core/render_object'
import { RenderBox } from './render_box'
import { RenderWrapPanel } from './render_wrap'

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

describe('RenderWrapPanel', () => {
  it('does not create negative distributed gaps when content overflows', () => {
    const wrap = new RenderWrapPanel({ spacing: 8, alignment: 'spaceBetween' })
    const first = new FixedBox(70, 20)
    const second = new FixedBox(70, 20)
    wrap.addChild(first)
    wrap.addChild(second)

    wrap.layout({ minWidth: 0, maxWidth: 120, minHeight: 0, maxHeight: Infinity })

    expect(first.offset.x).toBe(0)
    expect(second.offset.x).toBe(0)
    expect(second.offset.y).toBeGreaterThan(first.offset.y)
  })

  it('keeps spacing when distributing children within a run', () => {
    const wrap = new RenderWrapPanel({ spacing: 10, alignment: 'spaceBetween' })
    const first = new FixedBox(20, 10)
    const second = new FixedBox(20, 10)
    wrap.addChild(first)
    wrap.addChild(second)

    wrap.layout({ minWidth: 0, maxWidth: 100, minHeight: 0, maxHeight: Infinity })

    expect(first.offset.x).toBe(0)
    expect(second.offset.x).toBe(80)
  })

  it('keeps run spacing when distributing runs vertically', () => {
    const wrap = new RenderWrapPanel({
      spacing: 8,
      runSpacing: 10,
      runAlignment: 'spaceBetween',
    })
    const first = new FixedBox(70, 20)
    const second = new FixedBox(70, 20)
    wrap.addChild(first)
    wrap.addChild(second)

    wrap.layout({ minWidth: 0, maxWidth: 100, minHeight: 100, maxHeight: 100 })

    expect(first.offset.y).toBe(0)
    expect(second.offset.y).toBe(80)
  })

  it('does not distribute runs against maxHeight when natural height is smaller', () => {
    const wrap = new RenderWrapPanel({
      spacing: 8,
      runSpacing: 10,
      runAlignment: 'spaceBetween',
    })
    const first = new FixedBox(70, 20)
    const second = new FixedBox(70, 20)
    wrap.addChild(first)
    wrap.addChild(second)

    wrap.layout({ minWidth: 0, maxWidth: 100, minHeight: 0, maxHeight: 100 })

    expect(wrap.size.height).toBe(50)
    expect(first.offset.y).toBe(0)
    expect(second.offset.y).toBe(30)
  })

  it('centers children inside each run on the cross axis', () => {
    const wrap = new RenderWrapPanel({ spacing: 8, crossAxisAlignment: 'center' })
    const tall = new FixedBox(30, 30)
    const short = new FixedBox(30, 10)
    wrap.addChild(tall)
    wrap.addChild(short)

    wrap.layout({ minWidth: 0, maxWidth: 100, minHeight: 0, maxHeight: Infinity })

    expect(tall.offset.y).toBe(0)
    expect(short.offset.y).toBe(10)
  })

  it('lets child alignment override the run cross-axis fallback', () => {
    const wrap = new RenderWrapPanel({ spacing: 8, crossAxisAlignment: 'center' })
    const tall = new FixedBox(30, 30)
    const short = new FixedBox(30, 10)
    short.verticalAlignment = 'start'
    wrap.addChild(tall)
    wrap.addChild(short)

    wrap.layout({ minWidth: 0, maxWidth: 100, minHeight: 0, maxHeight: Infinity })

    expect(short.offset.y).toBe(0)
  })

  it('invalidates layout when spacing or alignment changes', () => {
    const wrap = new RenderWrapPanel({ spacing: 4 })
    wrap.addChild(new FixedBox(20, 10))
    wrap.layout({ minWidth: 0, maxWidth: 120, minHeight: 0, maxHeight: Infinity })

    expect(wrap.needsLayout).toBe(false)

    wrap.spacing = 12
    expect(wrap.needsLayout).toBe(true)

    wrap.layout({ minWidth: 0, maxWidth: 120, minHeight: 0, maxHeight: Infinity })
    wrap.alignment = 'center'
    expect(wrap.needsLayout).toBe(true)
  })
})

describe('two-phase layout lifecycle', () => {
  it('measures without loading children and commits stretched geometry once', () => {
    const contexts: RenderLoadedContext[] = []
    class LoadedBox extends FixedBox { onLoaded(context: RenderLoadedContext): void { contexts.push(context) } }
    const panel = new RenderWrapPanel({ spacing: 0, runSpacing: 0 })
    const child = new LoadedBox(20, 10)
    child.verticalAlignment = 'stretch'
    panel.addChild(child); panel.addChild(new FixedBox(20, 80))
    panel.attach(new PipelineOwner())
    const constraints = { minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: Infinity }
    expect(panel.measure(constraints).height).toBe(80)
    expect(contexts).toHaveLength(0)
    panel.layout(constraints)
    expect(child.size.height).toBe(80)
    expect(contexts.map(context => context.size.height)).toEqual([80])
    panel.layout({ ...constraints, maxWidth: 100 })
    expect(contexts).toHaveLength(1)
    panel.dispose()
  })
})
