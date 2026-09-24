// PaintContext: 封装 Canvas 2D 绘制上下文，供 RenderObject 使用

import type { Offset } from '../core/render_object'
import { ImGuiDarkTheme } from '../theme/default_theme'
import type { ResolvedTheme } from '../theme/theme'

export class PaintContext {
  readonly ctx: CanvasRenderingContext2D
  private _theme: ResolvedTheme

  constructor(ctx: CanvasRenderingContext2D, theme: ResolvedTheme = ImGuiDarkTheme) {
    this.ctx = ctx
    this._theme = theme
  }

  get theme(): ResolvedTheme {
    return this._theme
  }

  setTheme(theme: ResolvedTheme): this {
    this._theme = theme
    return this
  }

  save(): void { this.ctx.save() }
  restore(): void { this.ctx.restore() }

  translate(offset: Offset): void {
    this.ctx.translate(offset.x, offset.y)
  }

  clipRect(x: number, y: number, w: number, h: number): void {
    this.ctx.beginPath()
    this.ctx.rect(x, y, w, h)
    this.ctx.clip()
  }
}
