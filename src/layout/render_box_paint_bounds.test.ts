import { describe, expect, it } from 'vitest'
import type { BoxConstraints } from '../core/render_object'
import { ImGuiLightTheme } from '../theme/default_theme'
import { RenderBox } from './render_box'
class FixedBox extends RenderBox {
  constructor(private readonly desiredWidth: number, private readonly desiredHeight: number) { super() }
  performLayout(_constraints: BoxConstraints): void { this.size = { width: this.desiredWidth, height: this.desiredHeight } }
  visitChildren(): void {}
}
describe('RenderBox paint extent', () => {
  it('includes standard stroke overflow in paint bounds without changing layout or hit size', () => {
    const box = new FixedBox(40, 20)
    box.layout({ minWidth: 0, maxWidth: 100, minHeight: 0, maxHeight: 60 })
    box.offset = { x: 10, y: 20 }
    expect(box.paintBounds).toEqual({ x: 8, y: 18, width: 44, height: 24 })
    expect(box.size).toEqual({ width: 40, height: 20 })
    expect(box.outerSize).toEqual({ width: 40, height: 20 })
    box.layout({ minWidth: 0, maxWidth: 100, minHeight: 0, maxHeight: 60 }, false,
      { theme: { ...ImGuiLightTheme, frameBorderSize: 8 } })
    expect(box.paintBounds).toEqual({ x: 2, y: 12, width: 56, height: 36 })
    box.visible = false
    expect(box.paintBounds).toEqual({ x: 10, y: 20, width: 0, height: 0 })
  })

})
