// ProgressBar: 进度条组件
// 支持确定进度（0-1）、不确定动画（indeterminate）、颜色自定义

import { RenderBox, type RenderBoxOptions } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import { lerpColor, rgba, type Color } from '../theme/theme'
import type { PaintContext } from '../rendering/paint_context'
import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { RenderObject } from '../core/render_object'
import { DisposableBag, type DisposeFn } from '../core/disposable'
import { deriveProgressBarStyle } from '../theme/component_styles'

export interface RenderProgressBarOptions extends RenderBoxOptions {
  value?: number
  label?: string
  color?: Color
}

export class RenderProgressBar extends RenderBox {
  static override debugTypeName = 'RenderProgressBar'
  private _value: number          // 0.0 ~ 1.0，-1 表示 indeterminate
  label: string
  color?: Color          // 自定义进度颜色，不设则用 sliderGrab
  private _usesThemeHeight: boolean

  override get height(): number { return super.height ?? deriveProgressBarStyle(ImGuiDarkTheme).height }
  override set height(value: number) { super.height = value }

  private _animOffset = 0
  private _animDisposer?: DisposeFn
  private _disposables = new DisposableBag()

  constructor(opts: RenderProgressBarOptions) {
    super({ ...opts, height: opts.height ?? deriveProgressBarStyle(ImGuiDarkTheme).height })
    this._value = opts.value ?? 0
    this.label = opts.label ?? ''
    this.color = opts.color
    this._usesThemeHeight = opts.height === undefined
  }

  get value(): number { return this._value }
  set value(value: number) {
    if (value < 0) {
      this.startIndeterminate()
      return
    }
    this.stopIndeterminate(Math.max(0, Math.min(1, value)))
  }

  setValue(value: number): void {
    this.value = value
  }

  // 启动不确定动画
  startIndeterminate(): void {
    if (this._value === -1 && this._animDisposer) return
    this._value = -1
    this.markNeedsPaint()
    if (this._animDisposer) return
    this._animDisposer = this._disposables.setInterval(() => {
      this._animOffset = (this._animOffset + 0.02) % 1
      this.markNeedsPaint()
    }, 16)
  }

  stopIndeterminate(finalValue = 0): void {
    const clampedValue = Math.max(0, Math.min(1, finalValue))
    this._value = clampedValue
    if (this._animDisposer) {
      this._animDisposer()
      this._animDisposer = undefined
    }
    this.markNeedsPaint()
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const s = deriveProgressBarStyle(context.theme)
    if (this._usesThemeHeight) this.setHeightDuringLayout(s.height)
    this.size = {
      width: constraints.maxWidth === Infinity ? 200 : constraints.maxWidth,
      height: this.height ?? s.height,
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const s = deriveProgressBarStyle(context.theme)
    const dl = new DrawList(context)
    const { x, y } = offset
    const { width: w, height: h } = this.size
    const r = h / 2  // 圆角 = 高度一半（胶囊形）

    // 轨道背景
    dl.fillRect(x, y, w, h, s.trackBg, r)
    dl.strokeRect(x, y, w, h, s.trackBorder, 1, r)

    const fillColor = this.color ?? s.fillBg

    if (this.value < 0) {
      // 不确定模式：滑动光条
      const barW = w * 0.35
      const travel = w + barW
      const pos = x - barW + this._animOffset * travel
      dl.pushClip(x, y, w, h)
      dl.fillRect(pos, y, barW, h, fillColor, r)
      // 高光
      dl.fillRect(pos, y, barW * 0.4, h, lerpColor(fillColor, rgba(255, 255, 255), 0.3), r)
      dl.popClip()
    } else {
      // 确定模式
      const fillW = Math.max(0, Math.min(w, w * this.value))
      if (fillW > 0) {
        dl.pushClip(x, y, w, h)
        // 渐变填充
        const ctx = context.ctx
        ctx.save()
        const grad = ctx.createLinearGradient(x, y, x, y + h)
        grad.addColorStop(0, `rgba(${fillColor.r + 30},${fillColor.g + 30},${fillColor.b + 30},${fillColor.a})`)
        grad.addColorStop(1, `rgba(${fillColor.r},${fillColor.g},${fillColor.b},${fillColor.a})`)
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.roundRect(x, y, fillW, h, r)
        ctx.fill()
        ctx.restore()
        dl.popClip()
      }
    }

    // 标签文字（居中显示在进度条上）
    if (this.label) {
      dl.pushClip(x + 2, y, w - 4, h)
      dl.fillText(this.label, x + w / 2, y + h / 2, s.text, s.labelFontSize, s.fontFamily, 'center', 'middle')
      dl.popClip()
    } else if (this.value >= 0) {
      // 百分比
      const pct = `${Math.round(this.value * 100)}%`
      dl.pushClip(x + 2, y, w - 4, h)
      dl.fillText(pct, x + w / 2, y + h / 2, s.text, s.labelFontSize, s.fontFamily, 'center', 'middle')
      dl.popClip()
    }
  }

  dispose(): void {
    this._disposables.dispose()
    this._animDisposer = undefined
    super.dispose()
  }
}
