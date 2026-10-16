import { BoundedCache } from './bounded_cache'
import { ellipsizeText } from '../core/text_overflow'
import { TextMeasurer } from '../core/text_measurer'
import type { Color } from '../theme/theme'
import type { DrawList } from './draw_list'

export interface SingleLineTextPaintOptions {
  text: string
  x: number
  y: number
  maxWidth: number
  color: Color
  fontSize: number
  fontFamily: string
  align?: CanvasTextAlign
  baseline?: CanvasTextBaseline
  fontWeight?: string | number
  fontStyle?: 'normal' | 'italic'
  textDecoration?: 'none' | 'underline'
}

export interface SingleLineTextPaintResult {
  text: string
  width: number
}

const fittedTextCache = new BoundedCache<string, SingleLineTextPaintResult>(2048)
let fontRevision = -1
let measureFunction = TextMeasurer.measureWidth

export function fitSingleLineText(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontFamily: string,
  fontWeight?: string | number,
  fontStyle?: 'normal' | 'italic',
): SingleLineTextPaintResult {
  if (!text || maxWidth <= 0) return { text: '', width: 0 }
  if (fontRevision !== TextMeasurer.revision || measureFunction !== TextMeasurer.measureWidth) {
    fittedTextCache.clear()
    fontRevision = TextMeasurer.revision
    measureFunction = TextMeasurer.measureWidth
  }
  const key = text.length <= 4096
    ? JSON.stringify([text, String(maxWidth), String(fontSize), fontFamily, fontWeight, fontStyle]) : undefined
  const cached = key === undefined ? undefined : fittedTextCache.get(key)
  if (cached) return { ...cached }
  const fitted = Number.isFinite(maxWidth)
    ? ellipsizeText(text, maxWidth, value => TextMeasurer.measureWidth(value, fontSize, fontFamily, fontWeight, fontStyle))
    : text
  const result = {
    text: fitted,
    width: TextMeasurer.measureWidth(fitted, fontSize, fontFamily, fontWeight, fontStyle),
  }
  if (key !== undefined) fittedTextCache.set(key, result)
  return { ...result }
}

export function paintSingleLineText(
  dl: DrawList,
  options: SingleLineTextPaintOptions,
): SingleLineTextPaintResult {
  const fitted = fitSingleLineText(options.text, options.maxWidth, options.fontSize, options.fontFamily, options.fontWeight, options.fontStyle)
  if (!fitted.text) return fitted
  dl.fillText(
    fitted.text,
    options.x,
    options.y,
    options.color,
    options.fontSize,
    options.fontFamily,
    options.align ?? 'left',
    options.baseline ?? 'middle',
    options.fontWeight,
    options.fontStyle,
  )
  if (options.textDecoration === 'underline' && fitted.width > 0) {
    const align = options.align ?? 'left'
    const startX = align === 'center' ? options.x - fitted.width / 2 : align === 'right' ? options.x - fitted.width : options.x
    const underlineY = options.y + options.fontSize * 0.42
    dl.line(startX, underlineY, startX + fitted.width, underlineY, options.color, Math.max(1, options.fontSize / 14))
  }
  return fitted
}
