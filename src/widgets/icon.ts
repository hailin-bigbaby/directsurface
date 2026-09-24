import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import type { Color } from '../theme/theme'
import { colorToCSS } from '../theme/theme'
import { RenderObject } from '../core/render_object'
import { RenderBox } from '../layout/render_box'
import {
  builtInIconNames,
  builtInIconOpticalVariants,
  builtInIconPaths,
  type IconName,
  type IconPathDefinition,
} from './icon_catalog.generated'

export {
  builtInIconCatalog,
  builtInIconCategoryLabels,
  builtInIconNames,
  type BuiltInIconMetadata,
  type IconCategory,
  type IconName,
  type IconPathDefinition,
} from './icon_catalog.generated'

const iconNames = new Set<string>(builtInIconNames)
const fluentPathCaches = new WeakMap<typeof Path2D, Map<string, Path2D>>()

export function isIconName(value: string | undefined): value is IconName {
  return typeof value === 'string' && iconNames.has(value)
}

export interface PaintIconGlyphOptions {
  name: IconName
  x: number
  y: number
  size: number
  color: Color
  strokeWidth?: number
}

function strokeIconPath(
  context: PaintContext,
  color: Color,
  strokeWidth: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): void {
  const ctx = context.ctx
  ctx.save()
  ctx.strokeStyle = colorToCSS(color)
  ctx.lineWidth = strokeWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  draw(ctx)
  ctx.stroke()
  ctx.restore()
}

function drawTextRows(
  dl: DrawList,
  x: number,
  y: number,
  size: number,
  color: Color,
  strokeWidth: number,
  rows: readonly [number, number, number][],
): void {
  for (const [yRatio, startRatio, endRatio] of rows) {
    dl.line(x + size * startRatio, y + size * yRatio, x + size * endRatio, y + size * yRatio, color, strokeWidth)
  }
}

function paintLetterIcon(
  context: PaintContext,
  text: string,
  x: number,
  y: number,
  size: number,
  color: Color,
  fontWeight?: string | number,
): void {
  new DrawList(context).fillText(
    text,
    x + size / 2,
    y + size * 0.52,
    color,
    size * 0.78,
    'Arial, sans-serif',
    'center',
    'middle',
    fontWeight,
  )
}

function fillFluentPathIcon(
  context: PaintContext,
  color: Color,
  x: number,
  y: number,
  size: number,
  viewBoxSize: number,
  pathData: string,
): boolean {
  const Path2DConstructor = globalThis.Path2D
  if (typeof Path2DConstructor === 'undefined') {
    return false
  }
  let pathCache = fluentPathCaches.get(Path2DConstructor)
  if (!pathCache) {
    pathCache = new Map()
    fluentPathCaches.set(Path2DConstructor, pathCache)
  }
  let path = pathCache.get(pathData)
  if (!path) {
    path = new Path2DConstructor(pathData)
    pathCache.set(pathData, path)
  }
  const ctx = context.ctx
  ctx.save()
  ctx.fillStyle = colorToCSS(color)
  ctx.translate(x, y)
  const scale = size / viewBoxSize
  ctx.scale(scale, scale)
  ctx.fill(path)
  ctx.restore()
  return true
}

function paintUndoFallback(context: PaintContext, color: Color, x: number, y: number, size: number, strokeWidth: number): void {
  strokeIconPath(context, color, strokeWidth, ctx => {
    ctx.moveTo(x + size * 0.3, y + size * 0.14)
    ctx.lineTo(x + size * 0.3, y + size * 0.5)
    ctx.lineTo(x + size * 0.66, y + size * 0.5)
    ctx.moveTo(x + size * 0.35, y + size * 0.45)
    ctx.bezierCurveTo(x + size * 0.58, y + size * 0.15, x + size * 0.96, y + size * 0.28, x + size * 0.91, y + size * 0.58)
    ctx.bezierCurveTo(x + size * 0.88, y + size * 0.76, x + size * 0.69, y + size * 0.84, x + size * 0.5, y + size * 0.9)
  })
}

function paintRedoFallback(context: PaintContext, color: Color, x: number, y: number, size: number, strokeWidth: number): void {
  strokeIconPath(context, color, strokeWidth, ctx => {
    ctx.moveTo(x + size * 0.7, y + size * 0.14)
    ctx.lineTo(x + size * 0.7, y + size * 0.5)
    ctx.lineTo(x + size * 0.34, y + size * 0.5)
    ctx.moveTo(x + size * 0.65, y + size * 0.45)
    ctx.bezierCurveTo(x + size * 0.42, y + size * 0.15, x + size * 0.04, y + size * 0.28, x + size * 0.09, y + size * 0.58)
    ctx.bezierCurveTo(x + size * 0.12, y + size * 0.76, x + size * 0.31, y + size * 0.84, x + size * 0.5, y + size * 0.9)
  })
}

export function paintIconGlyph(context: PaintContext, options: PaintIconGlyphOptions): void {
  const dl = new DrawList(context)
  const { name, x, y, size, color } = options
  const strokeWidth = options.strokeWidth ?? Math.max(1.5, size * 0.11)
  const centerX = x + size / 2
  const centerY = y + size / 2
  const inset = size * 0.22
  const fluentPathIcon = resolveFluentPathIcon(name, size)
  if (fluentPathIcon && fillFluentPathIcon(context, color, x, y, size, fluentPathIcon.viewBoxSize, fluentPathIcon.pathData)) {
    return
  }

  switch (name) {
    case 'plus':
      dl.line(centerX, y + inset, centerX, y + size - inset, color, strokeWidth)
      dl.line(x + inset, centerY, x + size - inset, centerY, color, strokeWidth)
      return
    case 'close':
      dl.line(x + inset, y + inset, x + size - inset, y + size - inset, color, strokeWidth)
      dl.line(x + size - inset, y + inset, x + inset, y + size - inset, color, strokeWidth)
      return
    case 'check':
      dl.drawCheckmark(x + size * 0.12, y + size * 0.14, size * 0.74, color, strokeWidth)
      return
    case 'lock':
      dl.strokeRect(x + size * 0.28, y + size * 0.44, size * 0.44, size * 0.34, color, strokeWidth, 0)
      strokeIconPath(context, color, strokeWidth, ctx => {
        ctx.arc(centerX, y + size * 0.42, size * 0.16, Math.PI, 0)
      })
      return
    case 'eye':
      dl.line(x + size * 0.16, centerY, x + size * 0.34, y + size * 0.24, color, strokeWidth)
      dl.line(x + size * 0.34, y + size * 0.24, x + size * 0.66, y + size * 0.24, color, strokeWidth)
      dl.line(x + size * 0.66, y + size * 0.24, x + size * 0.84, centerY, color, strokeWidth)
      dl.line(x + size * 0.84, centerY, x + size * 0.66, y + size * 0.76, color, strokeWidth)
      dl.line(x + size * 0.66, y + size * 0.76, x + size * 0.34, y + size * 0.76, color, strokeWidth)
      dl.line(x + size * 0.34, y + size * 0.76, x + size * 0.16, centerY, color, strokeWidth)
      dl.strokeCircle(centerX, centerY, size * 0.12, color, strokeWidth)
      return
    case 'eye-off':
      dl.line(x + size * 0.18, centerY, x + size * 0.34, y + size * 0.28, color, strokeWidth)
      dl.line(x + size * 0.34, y + size * 0.28, x + size * 0.66, y + size * 0.28, color, strokeWidth)
      dl.line(x + size * 0.66, y + size * 0.28, x + size * 0.82, centerY, color, strokeWidth)
      dl.line(x + size * 0.82, centerY, x + size * 0.66, y + size * 0.72, color, strokeWidth)
      dl.line(x + size * 0.66, y + size * 0.72, x + size * 0.34, y + size * 0.72, color, strokeWidth)
      dl.line(x + size * 0.34, y + size * 0.72, x + size * 0.18, centerY, color, strokeWidth)
      dl.strokeCircle(centerX, centerY, size * 0.12, color, strokeWidth)
      dl.line(x + size * 0.22, y + size * 0.78, x + size * 0.78, y + size * 0.22, color, strokeWidth)
      return
    case 'chevron-down':
      dl.line(x + inset, y + size * 0.38, centerX, y + size - inset, color, strokeWidth)
      dl.line(centerX, y + size - inset, x + size - inset, y + size * 0.38, color, strokeWidth)
      return
    case 'chevron-up':
      dl.line(x + inset, y + size * 0.62, centerX, y + inset, color, strokeWidth)
      dl.line(centerX, y + inset, x + size - inset, y + size * 0.62, color, strokeWidth)
      return
    case 'chevron-left':
      dl.line(x + size - inset, y + inset, x + size * 0.38, centerY, color, strokeWidth)
      dl.line(x + size * 0.38, centerY, x + size - inset, y + size - inset, color, strokeWidth)
      return
    case 'chevron-right':
      dl.line(x + size * 0.38, y + inset, x + size - inset, centerY, color, strokeWidth)
      dl.line(x + size - inset, centerY, x + size * 0.38, y + size - inset, color, strokeWidth)
      return
    case 'search':
      dl.strokeCircle(x + size * 0.42, y + size * 0.42, size * 0.22, color, strokeWidth)
      dl.line(x + size * 0.58, y + size * 0.58, x + size * 0.8, y + size * 0.8, color, strokeWidth)
      return
    case 'refresh':
      strokeIconPath(context, color, strokeWidth, ctx => {
        ctx.arc(centerX, centerY, size * 0.27, Math.PI * 0.2, Math.PI * 1.65)
      })
      dl.line(x + size * 0.66, y + size * 0.2, x + size * 0.8, y + size * 0.18, color, strokeWidth)
      dl.line(x + size * 0.66, y + size * 0.2, x + size * 0.73, y + size * 0.33, color, strokeWidth)
      return
    case 'trash':
      dl.strokeRect(x + size * 0.28, y + size * 0.32, size * 0.44, size * 0.44, color, strokeWidth, 0)
      dl.line(x + size * 0.24, y + size * 0.28, x + size * 0.76, y + size * 0.28, color, strokeWidth)
      dl.line(x + size * 0.4, y + size * 0.22, x + size * 0.6, y + size * 0.22, color, strokeWidth)
      dl.line(x + size * 0.42, y + size * 0.4, x + size * 0.42, y + size * 0.68, color, strokeWidth * 0.9)
      dl.line(x + size * 0.58, y + size * 0.4, x + size * 0.58, y + size * 0.68, color, strokeWidth * 0.9)
      return
    case 'copy':
      dl.strokeRect(x + size * 0.22, y + size * 0.18, size * 0.38, size * 0.46, color, strokeWidth, 0)
      dl.strokeRect(x + size * 0.38, y + size * 0.34, size * 0.4, size * 0.48, color, strokeWidth, 0)
      return
    case 'calendar':
      dl.strokeRect(x + size * 0.18, y + size * 0.24, size * 0.64, size * 0.58, color, strokeWidth, 0)
      dl.line(x + size * 0.18, y + size * 0.38, x + size * 0.82, y + size * 0.38, color, strokeWidth)
      dl.line(x + size * 0.32, y + size * 0.16, x + size * 0.32, y + size * 0.3, color, strokeWidth)
      dl.line(x + size * 0.68, y + size * 0.16, x + size * 0.68, y + size * 0.3, color, strokeWidth)
      return
    case 'window':
      dl.strokeRect(x + size * 0.18, y + size * 0.2, size * 0.64, size * 0.6, color, strokeWidth, 0)
      dl.line(x + size * 0.18, y + size * 0.34, x + size * 0.82, y + size * 0.34, color, strokeWidth)
      return
    case 'bell':
      strokeIconPath(context, color, strokeWidth, ctx => {
        ctx.arc(centerX, y + size * 0.46, size * 0.22, Math.PI, 0)
      })
      dl.line(x + size * 0.28, y + size * 0.46, x + size * 0.28, y + size * 0.7, color, strokeWidth)
      dl.line(x + size * 0.72, y + size * 0.46, x + size * 0.72, y + size * 0.7, color, strokeWidth)
      dl.line(x + size * 0.24, y + size * 0.7, x + size * 0.76, y + size * 0.7, color, strokeWidth)
      dl.line(centerX, y + size * 0.74, centerX, y + size * 0.82, color, strokeWidth)
      return
    case 'undo':
      if (!fillFluentPathIcon(context, color, x, y, size, 20, 'M5 2.5C5 2.22386 4.77614 2 4.5 2C4.22386 2 4 2.22386 4 2.5V7.4C4 7.73137 4.26863 8 4.6 8H9.5C9.77614 8 10 7.77614 10 7.5C10 7.22386 9.77614 7 9.5 7H5.90603L9.37872 3.98124C11.046 2.53191 13.5725 2.70858 15.0218 4.37584C16.4711 6.0431 16.2945 8.56959 14.6272 10.0189L6.45529 17.1226C6.24688 17.3038 6.2248 17.6196 6.40596 17.828C6.58713 18.0364 6.90294 18.0585 7.11135 17.8774L15.2833 10.7736C17.3673 8.96197 17.5882 5.80385 15.7765 3.71978C13.9648 1.63571 10.8067 1.41487 8.72266 3.22653L5 6.46259V2.5Z')) {
        paintUndoFallback(context, color, x, y, size, strokeWidth)
      }
      return
    case 'redo':
      if (!fillFluentPathIcon(context, color, x, y, size, 20, 'M15.003 2.5C15.003 2.22386 15.2269 2 15.503 2C15.7792 2 16.003 2.22386 16.003 2.5V7.4C16.003 7.73137 15.7344 8 15.403 8H10.503C10.2269 8 10.003 7.77614 10.003 7.5C10.003 7.22386 10.2269 7 10.503 7H14.097L10.6243 3.98124C8.95706 2.53191 6.43056 2.70858 4.98124 4.37584C3.53191 6.0431 3.70858 8.56959 5.37584 10.0189L13.5477 17.1226C13.7562 17.3038 13.7782 17.6196 13.5971 17.828C13.4159 18.0364 13.1001 18.0585 12.8917 17.8774L4.71978 10.7736C2.63571 8.96197 2.41487 5.80385 4.22653 3.71978C6.03818 1.63571 9.1963 1.41487 11.2804 3.22653L15.003 6.46259V2.5Z')) {
        paintRedoFallback(context, color, x, y, size, strokeWidth)
      }
      return
    case 'text-bold':
      paintLetterIcon(context, 'B', x, y, size, color, 700)
      return
    case 'text-italic':
      dl.line(x + size * 0.44, y + size * 0.22, x + size * 0.72, y + size * 0.22, color, strokeWidth)
      dl.line(x + size * 0.28, y + size * 0.78, x + size * 0.56, y + size * 0.78, color, strokeWidth)
      dl.line(x + size * 0.58, y + size * 0.22, x + size * 0.42, y + size * 0.78, color, strokeWidth * 1.25)
      return
    case 'text-underline':
      paintLetterIcon(context, 'U', x, y - size * 0.04, size, color, 600)
      dl.line(x + size * 0.26, y + size * 0.86, x + size * 0.74, y + size * 0.86, color, strokeWidth)
      return
    case 'text-strikethrough':
      paintLetterIcon(context, 'S', x, y, size, color, 600)
      dl.line(x + size * 0.2, centerY, x + size * 0.8, centerY, color, strokeWidth)
      return
    case 'text-subscript':
      paintLetterIcon(context, 'X', x - size * 0.08, y - size * 0.02, size * 0.78, color, 600)
      new DrawList(context).fillText('2', x + size * 0.68, y + size * 0.74, color, size * 0.38, 'Arial, sans-serif', 'center', 'middle', 600)
      return
    case 'text-superscript':
      paintLetterIcon(context, 'X', x - size * 0.08, y + size * 0.08, size * 0.78, color, 600)
      new DrawList(context).fillText('2', x + size * 0.68, y + size * 0.28, color, size * 0.38, 'Arial, sans-serif', 'center', 'middle', 600)
      return
    case 'text-color':
      paintLetterIcon(context, 'A', x, y - size * 0.04, size, color, 600)
      dl.line(x + size * 0.24, y + size * 0.84, x + size * 0.76, y + size * 0.84, color, strokeWidth * 1.2)
      return
    case 'text-highlight':
      dl.line(x + size * 0.28, y + size * 0.68, x + size * 0.62, y + size * 0.34, color, strokeWidth * 1.35)
      dl.line(x + size * 0.54, y + size * 0.26, x + size * 0.74, y + size * 0.46, color, strokeWidth * 1.35)
      dl.line(x + size * 0.24, y + size * 0.76, x + size * 0.58, y + size * 0.76, color, strokeWidth)
      return
    case 'font-increase':
      paintLetterIcon(context, 'A', x - size * 0.08, y, size, color, 600)
      dl.line(x + size * 0.74, y + size * 0.2, x + size * 0.74, y + size * 0.46, color, strokeWidth)
      dl.line(x + size * 0.61, y + size * 0.33, x + size * 0.87, y + size * 0.33, color, strokeWidth)
      return
    case 'font-decrease':
      paintLetterIcon(context, 'A', x - size * 0.08, y, size, color, 600)
      dl.line(x + size * 0.61, y + size * 0.33, x + size * 0.87, y + size * 0.33, color, strokeWidth)
      return
    case 'align-left':
      drawTextRows(dl, x, y, size, color, strokeWidth, [[0.28, 0.14, 0.78], [0.5, 0.14, 0.88], [0.72, 0.14, 0.62]])
      return
    case 'align-center':
      drawTextRows(dl, x, y, size, color, strokeWidth, [[0.28, 0.2, 0.8], [0.5, 0.12, 0.88], [0.72, 0.28, 0.72]])
      return
    case 'align-right':
      drawTextRows(dl, x, y, size, color, strokeWidth, [[0.28, 0.22, 0.86], [0.5, 0.12, 0.86], [0.72, 0.38, 0.86]])
      return
    case 'align-justify':
      drawTextRows(dl, x, y, size, color, strokeWidth, [[0.28, 0.12, 0.88], [0.5, 0.12, 0.88], [0.72, 0.12, 0.88]])
      return
    case 'indent-increase':
      drawTextRows(dl, x, y, size, color, strokeWidth, [[0.28, 0.42, 0.82], [0.5, 0.42, 0.9], [0.72, 0.42, 0.82]])
      dl.line(x + size * 0.14, centerY, x + size * 0.3, centerY, color, strokeWidth)
      dl.line(x + size * 0.24, y + size * 0.38, x + size * 0.34, centerY, color, strokeWidth)
      dl.line(x + size * 0.24, y + size * 0.62, x + size * 0.34, centerY, color, strokeWidth)
      return
    case 'indent-decrease':
      drawTextRows(dl, x, y, size, color, strokeWidth, [[0.28, 0.42, 0.82], [0.5, 0.42, 0.9], [0.72, 0.42, 0.82]])
      dl.line(x + size * 0.18, centerY, x + size * 0.34, centerY, color, strokeWidth)
      dl.line(x + size * 0.24, y + size * 0.38, x + size * 0.14, centerY, color, strokeWidth)
      dl.line(x + size * 0.24, y + size * 0.62, x + size * 0.14, centerY, color, strokeWidth)
      return
    case 'list-bullets':
      dl.fillCircle(x + size * 0.2, y + size * 0.3, size * 0.035, color)
      dl.fillCircle(x + size * 0.2, y + size * 0.5, size * 0.035, color)
      dl.fillCircle(x + size * 0.2, y + size * 0.7, size * 0.035, color)
      drawTextRows(dl, x, y, size, color, strokeWidth, [[0.3, 0.34, 0.84], [0.5, 0.34, 0.84], [0.7, 0.34, 0.84]])
      return
    case 'list-numbered':
      new DrawList(context).fillText('1', x + size * 0.2, y + size * 0.3, color, size * 0.22, 'Arial, sans-serif', 'center', 'middle', 600)
      new DrawList(context).fillText('2', x + size * 0.2, y + size * 0.5, color, size * 0.22, 'Arial, sans-serif', 'center', 'middle', 600)
      new DrawList(context).fillText('3', x + size * 0.2, y + size * 0.7, color, size * 0.22, 'Arial, sans-serif', 'center', 'middle', 600)
      drawTextRows(dl, x, y, size, color, strokeWidth, [[0.3, 0.34, 0.84], [0.5, 0.34, 0.84], [0.7, 0.34, 0.84]])
      return
    case 'table':
      dl.strokeRect(x + size * 0.18, y + size * 0.22, size * 0.64, size * 0.56, color, strokeWidth, 0)
      dl.line(x + size * 0.18, y + size * 0.41, x + size * 0.82, y + size * 0.41, color, strokeWidth)
      dl.line(x + size * 0.18, y + size * 0.59, x + size * 0.82, y + size * 0.59, color, strokeWidth)
      dl.line(x + size * 0.4, y + size * 0.22, x + size * 0.4, y + size * 0.78, color, strokeWidth)
      dl.line(x + size * 0.62, y + size * 0.22, x + size * 0.62, y + size * 0.78, color, strokeWidth)
      return
    case 'border-all':
      dl.strokeRect(x + size * 0.22, y + size * 0.22, size * 0.56, size * 0.56, color, strokeWidth, 0)
      dl.line(centerX, y + size * 0.22, centerX, y + size * 0.78, color, strokeWidth)
      dl.line(x + size * 0.22, centerY, x + size * 0.78, centerY, color, strokeWidth)
      return
    case 'document':
      dl.strokeRect(x + size * 0.28, y + size * 0.18, size * 0.44, size * 0.64, color, strokeWidth, 0)
      dl.line(x + size * 0.38, y + size * 0.36, x + size * 0.62, y + size * 0.36, color, strokeWidth)
      dl.line(x + size * 0.38, y + size * 0.5, x + size * 0.62, y + size * 0.5, color, strokeWidth)
      dl.line(x + size * 0.38, y + size * 0.64, x + size * 0.54, y + size * 0.64, color, strokeWidth)
      return
    case 'settings':
      dl.strokeCircle(centerX, centerY, size * 0.22, color, strokeWidth)
      dl.strokeCircle(centerX, centerY, size * 0.06, color, strokeWidth)
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4
        dl.line(
          centerX + Math.cos(angle) * size * 0.32,
          centerY + Math.sin(angle) * size * 0.32,
          centerX + Math.cos(angle) * size * 0.42,
          centerY + Math.sin(angle) * size * 0.42,
          color,
          strokeWidth,
        )
      }
      return
    case 'sparkle':
      dl.line(centerX, y + size * 0.16, centerX, y + size * 0.84, color, strokeWidth)
      dl.line(x + size * 0.16, centerY, x + size * 0.84, centerY, color, strokeWidth)
      dl.line(x + size * 0.3, y + size * 0.3, x + size * 0.7, y + size * 0.7, color, strokeWidth)
      dl.line(x + size * 0.7, y + size * 0.3, x + size * 0.3, y + size * 0.7, color, strokeWidth)
      return
  }
}

function resolveFluentPathIcon(name: IconName, size: number): IconPathDefinition {
  const fallback = builtInIconPaths[name]
  const variants = builtInIconOpticalVariants[name]
  if (!variants || variants.length === 0 || !Number.isFinite(size) || size <= 0) return fallback
  let best = variants[0]!
  let bestDistance = Math.abs(best.nominalSize - size)
  for (let index = 1; index < variants.length; index += 1) {
    const candidate = variants[index]!
    const distance = Math.abs(candidate.nominalSize - size)
    if (distance < bestDistance || distance === bestDistance && candidate.nominalSize > best.nominalSize) {
      best = candidate
      bestDistance = distance
    }
  }
  return best.definition
}

export class RenderIcon extends RenderBox {
  static override debugTypeName = 'RenderIcon'
  name: IconName
  color?: Color
  iconSize?: number
  strokeWidth?: number

  constructor(options: {
    name: IconName
    color?: Color
    size?: number
    strokeWidth?: number
  }) {
    super()
    this.name = options.name
    this.color = options.color
    this.iconSize = options.size
    this.strokeWidth = options.strokeWidth
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const size = this.iconSize ?? context.theme.fontSize
    const edge = Math.max(
      constraints.minWidth,
      Math.max(
        Math.min(size, constraints.maxWidth),
        Math.min(size, constraints.maxHeight),
      ),
    )
    this.size = { width: edge, height: edge }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    paintIconGlyph(context, {
      name: this.name,
      x: offset.x,
      y: offset.y,
      size: Math.min(this.size.width, this.size.height),
      color: this.color ?? context.theme.textPrimary,
      strokeWidth: this.strokeWidth,
    })
  }
}
