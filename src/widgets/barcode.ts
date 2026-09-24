import { constrainSize, type BoxConstraints, type LayoutContext, type Offset, type Size } from '../core/render_object'
import { RenderBox, type RenderBoxOptions } from '../layout/render_box'
import type { PaintContext } from '../rendering/paint_context'
import { qrcodegen } from '../rendering/qrcode'
import { deriveEmptyStyle } from '../theme/component_styles'
import { colorToCSS } from '../theme/theme'

export type BarcodeType = 'ean13' | 'ena13' | 'code39' | 'code128' | 'qrcode'

export interface BarcodeOptions {
  type?: BarcodeType | string
  text?: string
  width?: number
  height?: number
  foreground?: string
  background?: string
  showText?: boolean
  quietZone?: number
  moduleWidth?: number
  barHeight?: number
}

export interface RenderBarcodeOptions extends BarcodeOptions, RenderBoxOptions {}

export interface BarcodeMetrics extends Size {
  valid: boolean
  type: Exclude<BarcodeType, 'ena13'>
  message?: string
}

export interface BarcodeVectorPlan extends BarcodeMetrics {
  modules: boolean[]
  barHeight: number
  displayText: string
}

interface BarcodePlan extends BarcodeVectorPlan {
  moduleWidth: number
  symbolWidth: number
  symbolOffsetX: number
  fitsWidth: boolean
  fitsHeight: boolean
  fixedModuleWidth: boolean
}

const defaultBarcodeWidth = 120
const defaultBarcodeHeight = 48
const defaultQrSize = 48
const defaultQuietZone = 10
const qrBorder = 2
const maxBarcodePlanCacheSize = 256
const barcodePlanCache = new Map<string, BarcodePlan>()

const eanL: Record<string, string> = {
  '0': '0001101',
  '1': '0011001',
  '2': '0010011',
  '3': '0111101',
  '4': '0100011',
  '5': '0110001',
  '6': '0101111',
  '7': '0111011',
  '8': '0110111',
  '9': '0001011',
}

const eanG: Record<string, string> = {
  '0': '0100111',
  '1': '0110011',
  '2': '0011011',
  '3': '0100001',
  '4': '0011101',
  '5': '0111001',
  '6': '0000101',
  '7': '0010001',
  '8': '0001001',
  '9': '0010111',
}

const eanR: Record<string, string> = {
  '0': '1110010',
  '1': '1100110',
  '2': '1101100',
  '3': '1000010',
  '4': '1011100',
  '5': '1001110',
  '6': '1010000',
  '7': '1000100',
  '8': '1001000',
  '9': '1110100',
}

const eanParity = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
]

const code39Patterns: Record<string, string> = {
  '0': 'nnnwwnwnn',
  '1': 'wnnwnnnnw',
  '2': 'nnwwnnnnw',
  '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn',
  '6': 'nnwwwnnnn',
  '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn',
  '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw',
  B: 'nnwnnwnnw',
  C: 'wnwnnwnnn',
  D: 'nnnnwwnnw',
  E: 'wnnnwwnnn',
  F: 'nnwnwwnnn',
  G: 'nnnnnwwnw',
  H: 'wnnnnwwnn',
  I: 'nnwnnwwnn',
  J: 'nnnnwwwnn',
  K: 'wnnnnnnww',
  L: 'nnwnnnnww',
  M: 'wnwnnnnwn',
  N: 'nnnnwnnww',
  O: 'wnnnwnnwn',
  P: 'nnwnwnnwn',
  Q: 'nnnnnnwww',
  R: 'wnnnnnwwn',
  S: 'nnwnnnwwn',
  T: 'nnnnwnwwn',
  U: 'wwnnnnnnw',
  V: 'nwwnnnnnw',
  W: 'wwwnnnnnn',
  X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw',
  '.': 'wwnnnnwnn',
  ' ': 'nwwnnnwnn',
  '$': 'nwnwnwnnn',
  '/': 'nwnwnnnwn',
  '+': 'nwnnnwnwn',
  '%': 'nnnwnwnwn',
  '*': 'nwnnwnwnn',
}

const code128Patterns = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
]

export function normalizeBarcodeType(type: BarcodeOptions['type']): Exclude<BarcodeType, 'ena13'> {
  const raw = String(type ?? 'code128').toLowerCase()
  if (raw === 'ena13' || raw === 'ean13') return 'ean13'
  if (raw === 'code39') return 'code39'
  if (raw === 'qrcode') return 'qrcode'
  return 'code128'
}

export function measureBarcode(options: BarcodeOptions): BarcodeMetrics {
  const plan = createBarcodePlan(options)
  return toBarcodeMetrics(plan)
}

export function barcodeToVectorPlan(options: BarcodeOptions): BarcodeVectorPlan {
  const plan = createBarcodePlan(options)
  return {
    width: plan.width,
    height: plan.height,
    valid: plan.valid,
    type: plan.type,
    message: plan.message,
    modules: [...plan.modules],
    barHeight: plan.barHeight,
    displayText: plan.displayText,
  }
}

export function paintBarcode(ctx: CanvasRenderingContext2D, x: number, y: number, options: BarcodeOptions): BarcodeMetrics {
  const plan = createBarcodePlan(options)
  const foreground = options.foreground ?? '#000'
  const background = options.background ?? '#fff'
  if (!plan.valid) {
    paintBarcodePlaceholder(
      ctx,
      x,
      y,
      plan.width,
      plan.height,
      barcodePlaceholderLabel(plan),
    )
    return toBarcodeMetrics(plan)
  }
  ctx.save()
  ctx.fillStyle = background
  ctx.fillRect(x, y, plan.width, plan.height)
  if (plan.type === 'qrcode') {
    paintQrCode(ctx, x, y, plan, foreground)
  } else {
    paintLinearBarcode(ctx, x, y, plan, foreground)
  }
  ctx.restore()
  return toBarcodeMetrics(plan)
}

function toBarcodeMetrics(plan: BarcodePlan): BarcodeMetrics {
  return {
    width: plan.width,
    height: plan.height,
    valid: plan.valid,
    type: plan.type,
    message: plan.message,
  }
}

export function barcodeToSvgVNode(options: BarcodeOptions): any {
  const plan = createBarcodePlan(options)
  if (!plan.valid) {
    return placeholderSvg(plan)
  }
  const foreground = options.foreground ?? '#000'
  const background = options.background ?? '#fff'
  const children: any[] = [
    svgEle('rect', { x: 0, y: 0, width: '100%', height: '100%', fill: background }),
  ]
  if (plan.type === 'qrcode') {
    children.push(qrPathSvg(plan, foreground))
  } else {
    children.push(linearPathSvg(plan, foreground))
    if (options.showText !== false && plan.displayText) {
      children.push(svgEle('text', {
        x: plan.width / 2,
        y: plan.height - 3,
        fill: foreground,
        'font-size': 10,
        'text-anchor': 'middle',
        'font-family': 'sans-serif',
      }, plan.displayText))
    }
  }
  return svgEle('svg', {
    viewBox: `0 0 ${plan.width} ${plan.height}`,
    width: plan.width,
    height: plan.height,
    stroke: 'none',
  }, children)
}

export class RenderBarcode extends RenderBox {
  static override debugTypeName = 'RenderBarcode'
  type: BarcodeOptions['type']
  text: string
  foreground?: string
  background?: string
  showText?: boolean
  quietZone?: number
  moduleWidth?: number
  barHeight?: number

  constructor(options: RenderBarcodeOptions = {}) {
    super(options)
    this.type = options.type ?? 'code128'
    this.text = options.text ?? ''
    this.foreground = options.foreground
    this.background = options.background
    this.showText = options.showText
    this.quietZone = options.quietZone
    this.moduleWidth = options.moduleWidth
    this.barHeight = options.barHeight
  }

  visitChildren(): void {}

  setValue(text: string): void {
    if (this.text === text) return
    this.text = text
    this.markNeedsLayout()
  }

  performLayout(constraints: BoxConstraints, _context: LayoutContext): void {
    const metrics = measureBarcode(this._options())
    this.size = constrainSize(constraints, metrics)
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const options = {
      ...this._options(),
      width: this.size.width,
      height: this.size.height,
    }
    const plan = createBarcodePlan(options)
    if (!plan.valid) {
      const style = deriveEmptyStyle(context.theme)
      paintBarcodePlaceholder(
        context.ctx,
        offset.x,
        offset.y,
        plan.width,
        plan.height,
        barcodePlaceholderLabel(plan),
        {
          background: colorToCSS(style.backgroundColor),
          border: colorToCSS(style.borderColor),
          text: colorToCSS(style.descriptionColor),
          fontFamily: context.theme.fontFamily,
        },
      )
      return
    }
    paintBarcode(context.ctx, offset.x, offset.y, options)
  }

  debugState(): BarcodeMetrics {
    return measureBarcode(this._options())
  }

  private _options(): BarcodeOptions {
    return {
      type: this.type,
      text: this.text,
      width: this.width,
      height: this.height,
      foreground: this.foreground,
      background: this.background,
      showText: this.showText,
      quietZone: this.quietZone,
      moduleWidth: this.moduleWidth,
      barHeight: this.barHeight,
    }
  }
}

function createBarcodePlan(options: BarcodeOptions): BarcodePlan {
  const key = [
    normalizeBarcodeType(options.type),
    options.text ?? '',
    options.width ?? '',
    options.height ?? '',
    options.showText === false ? '0' : '1',
    options.quietZone ?? defaultQuietZone,
    options.moduleWidth ?? '',
    options.barHeight ?? '',
  ].join('\u0000')
  const cached = barcodePlanCache.get(key)
  if (cached) {
    barcodePlanCache.delete(key)
    barcodePlanCache.set(key, cached)
    return cached
  }
  const plan = createBarcodePlanUncached(options)
  barcodePlanCache.set(key, plan)
  if (barcodePlanCache.size > maxBarcodePlanCacheSize) {
    const oldestKey = barcodePlanCache.keys().next().value
    if (oldestKey) barcodePlanCache.delete(oldestKey)
  }
  return plan
}

function createBarcodePlanUncached(options: BarcodeOptions): BarcodePlan {
  const type = normalizeBarcodeType(options.type)
  if (type === 'qrcode') {
    return createQrPlan(options, type)
  }
  const quietZone = Math.max(0, options.quietZone ?? defaultQuietZone)
  const width = Math.max(1, options.width ?? defaultBarcodeWidth)
  const height = Math.max(1, options.height ?? defaultBarcodeHeight)
  const fixedModuleWidth = options.moduleWidth !== undefined
  if ((fixedModuleWidth && !isFinitePositiveNumber(options.moduleWidth))
    || (options.barHeight !== undefined && !isFinitePositiveNumber(options.barHeight))) {
    return invalidLinearPlan(type, width, height, '条码属性无效', fixedModuleWidth)
  }
  const encoded = type === 'ean13'
    ? encodeEan13(options.text ?? '')
    : type === 'code39'
      ? encodeCode39(options.text ?? '')
      : encodeCode128Auto(options.text ?? '')
  if (!encoded.valid) {
    return invalidLinearPlan(type, width, height, encoded.message, fixedModuleWidth)
  }
  const modules = addQuiet(encoded.modules, quietZone)
  const showText = options.showText !== false
  const textHeight = showText ? 14 : 0
  const barHeight = options.barHeight ?? Math.max(1, height - textHeight)
  const moduleWidth = options.moduleWidth ?? width / modules.length
  const symbolWidth = modules.length * moduleWidth
  const symbolOffsetX = Math.max(0, (width - symbolWidth) / 2)
  const fitsWidth = symbolWidth <= width + 1e-9
  const fitsHeight = barHeight + textHeight <= height + 1e-9
  if ((fixedModuleWidth && !fitsWidth) || (options.barHeight !== undefined && !fitsHeight)) {
    return {
      type,
      valid: false,
      message: '条码空间不足',
      modules: [],
      width,
      height,
      barHeight,
      displayText: '',
      moduleWidth,
      symbolWidth,
      symbolOffsetX,
      fitsWidth,
      fitsHeight,
      fixedModuleWidth,
    }
  }
  return {
    type,
    valid: true,
    modules,
    width,
    height,
    barHeight,
    displayText: encoded.text,
    moduleWidth,
    symbolWidth,
    symbolOffsetX,
    fitsWidth,
    fitsHeight,
    fixedModuleWidth,
  }
}

function invalidLinearPlan(
  type: Exclude<BarcodeType, 'ena13' | 'qrcode'>,
  width: number,
  height: number,
  message: string | undefined,
  fixedModuleWidth: boolean,
): BarcodePlan {
  return {
    type,
    valid: false,
    message,
    modules: [],
    width,
    height,
    barHeight: height,
    displayText: '',
    moduleWidth: 0,
    symbolWidth: 0,
    symbolOffsetX: 0,
    fitsWidth: false,
    fitsHeight: false,
    fixedModuleWidth,
  }
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function createQrPlan(options: BarcodeOptions, type: Exclude<BarcodeType, 'ena13'>): BarcodePlan {
  const size = Math.max(1, options.width ?? options.height ?? defaultQrSize)
  const height = Math.max(1, options.height ?? size)
  try {
    const qr = qrcodegen.QrCode.encodeText(options.text ?? '', qrcodegen.QrCode.Ecc.MEDIUM)
    const modules: boolean[] = []
    for (let row = 0; row < qr.size; row++) {
      for (let col = 0; col < qr.size; col++) {
        modules.push(qr.getModule(col, row))
      }
    }
    return {
      type,
      valid: true,
      modules,
      width: size,
      height,
      barHeight: qr.size,
      displayText: String(qr.size),
      moduleWidth: 0,
      symbolWidth: size,
      symbolOffsetX: 0,
      fitsWidth: true,
      fitsHeight: true,
      fixedModuleWidth: false,
    }
  } catch (error) {
    return {
      type,
      valid: false,
      message: String(error),
      modules: [],
      width: size,
      height,
      barHeight: height,
      displayText: '',
      moduleWidth: 0,
      symbolWidth: size,
      symbolOffsetX: 0,
      fitsWidth: true,
      fitsHeight: true,
      fixedModuleWidth: false,
    }
  }
}

function encodeEan13(text: string): { valid: boolean; modules: boolean[]; text: string; message?: string } {
  const digits = text.replace(/\s/g, '')
  if (!/^\d{12,13}$/.test(digits)) {
    return { valid: false, modules: [], text: '', message: 'EAN13 requires 12 or 13 digits' }
  }
  const body = digits.slice(0, 12)
  const checksum = ean13Checksum(body)
  if (digits.length === 13 && Number(digits[12]) !== checksum) {
    return { valid: false, modules: [], text: '', message: 'Invalid EAN13 checksum' }
  }
  const full = body + checksum
  const parity = eanParity[Number(full[0])]!
  let bits = '101'
  for (let i = 1; i <= 6; i++) {
    const digit = full[i]!
    bits += parity[i - 1] === 'L' ? eanL[digit] : eanG[digit]
  }
  bits += '01010'
  for (let i = 7; i <= 12; i++) {
    bits += eanR[full[i]!]
  }
  bits += '101'
  return { valid: true, modules: bitsToModules(bits), text: full }
}

function ean13Checksum(body: string): number {
  let sum = 0
  for (let i = 0; i < body.length; i++) {
    sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3)
  }
  return (10 - sum % 10) % 10
}

function encodeCode39(text: string): { valid: boolean; modules: boolean[]; text: string; message?: string } {
  const value = (text || ' ').toUpperCase()
  const content = `*${value}*`
  const modules: boolean[] = []
  for (let index = 0; index < content.length; index++) {
    const char = content[index]!
    const pattern = code39Patterns[char]
    if (!pattern) {
      return { valid: false, modules: [], text: '', message: `Unsupported CODE39 character: ${char}` }
    }
    appendCode39Pattern(modules, pattern)
    if (index < content.length - 1) modules.push(false)
  }
  return { valid: true, modules, text: value }
}

function appendCode39Pattern(modules: boolean[], pattern: string): void {
  for (let i = 0; i < pattern.length; i++) {
    const width = pattern[i] === 'w' ? 3 : 1
    const black = i % 2 === 0
    for (let j = 0; j < width; j++) modules.push(black)
  }
}

function encodeCode128Auto(text: string): { valid: boolean; modules: boolean[]; text: string; message?: string } {
  if (text.length === 0) {
    return { valid: false, modules: [], text: '', message: 'CODE128 内容不能为空' }
  }
  if (!Array.from(text).every(char => {
    const code = char.charCodeAt(0)
    return code >= 32 && code <= 127
  })) {
    return { valid: false, modules: [], text: '', message: 'CODE128 仅支持 ASCII 32-127' }
  }
  const codes: number[] = []
  if (/^\d+$/.test(text) && text.length % 2 === 0) {
    codes.push(105)
    appendCode128DigitPairs(codes, text)
  } else if (/^\d+$/.test(text) && text.length >= 3) {
    codes.push(104, text.charCodeAt(0) - 32, 99)
    appendCode128DigitPairs(codes, text.slice(1))
  } else {
    codes.push(104)
    for (let i = 0; i < text.length; i++) {
      codes.push(text.charCodeAt(i) - 32)
    }
  }
  let checksum = codes[0]!
  for (let i = 1; i < codes.length; i++) checksum += codes[i]! * i
  codes.push(checksum % 103, 106)
  const modules: boolean[] = []
  for (const code of codes) {
    appendCode128Pattern(modules, code128Patterns[code]!)
  }
  return { valid: true, modules, text }
}

function appendCode128DigitPairs(codes: number[], digits: string): void {
  for (let index = 0; index < digits.length; index += 2) {
    codes.push(Number(digits.slice(index, index + 2)))
  }
}

function appendCode128Pattern(modules: boolean[], pattern: string): void {
  let black = true
  for (const char of pattern) {
    const width = Number(char)
    for (let i = 0; i < width; i++) modules.push(black)
    black = !black
  }
}

function bitsToModules(bits: string): boolean[] {
  return Array.from(bits, bit => bit === '1')
}

function addQuiet(modules: boolean[], quietZone: number): boolean[] {
  return [...Array(Math.max(0, quietZone)).fill(false), ...modules, ...Array(Math.max(0, quietZone)).fill(false)]
}

function paintLinearBarcode(ctx: CanvasRenderingContext2D, x: number, y: number, plan: BarcodePlan, foreground: string): void {
  const moduleWidth = plan.moduleWidth
  ctx.fillStyle = foreground
  let start = -1
  for (let i = 0; i <= plan.modules.length; i++) {
    if (plan.modules[i] && start < 0) start = i
    if ((!plan.modules[i] || i === plan.modules.length) && start >= 0) {
      const barWidth = (i - start) * moduleWidth
      ctx.fillRect(
        x + plan.symbolOffsetX + start * moduleWidth,
        y,
        plan.fixedModuleWidth ? barWidth : Math.max(1, barWidth),
        plan.barHeight,
      )
      start = -1
    }
  }
  if (plan.displayText && plan.barHeight < plan.height) {
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(plan.displayText, x + plan.width / 2, y + plan.height - 3)
  }
}

function paintQrCode(ctx: CanvasRenderingContext2D, x: number, y: number, plan: BarcodePlan, foreground: string): void {
  const qrSize = Number(plan.displayText)
  const cells = qrSize + qrBorder * 2
  const cellSize = Math.min(plan.width, plan.height) / cells
  const offsetX = x + Math.max(0, (plan.width - cellSize * cells) / 2)
  const offsetY = y + Math.max(0, (plan.height - cellSize * cells) / 2)
  ctx.fillStyle = foreground
  for (let row = 0; row < qrSize; row++) {
    for (let col = 0; col < qrSize; col++) {
      if (plan.modules[row * qrSize + col]) {
        ctx.fillRect(
          offsetX + (col + qrBorder) * cellSize,
          offsetY + (row + qrBorder) * cellSize,
          Math.ceil(cellSize),
          Math.ceil(cellSize),
        )
      }
    }
  }
}

function linearPathSvg(plan: BarcodePlan, foreground: string): any {
  const moduleWidth = plan.moduleWidth
  const parts: string[] = []
  let start = -1
  for (let i = 0; i <= plan.modules.length; i++) {
    if (plan.modules[i] && start < 0) start = i
    if ((!plan.modules[i] || i === plan.modules.length) && start >= 0) {
      const x = plan.symbolOffsetX + start * moduleWidth
      const width = (i - start) * moduleWidth
      parts.push(`M${round(x)} 0h${round(width)}v${round(plan.barHeight)}h-${round(width)}z`)
      start = -1
    }
  }
  return svgEle('path', { d: parts.join(' '), fill: foreground })
}

function qrPathSvg(plan: BarcodePlan, foreground: string): any {
  const qrSize = Number(plan.displayText)
  const cells = qrSize + qrBorder * 2
  const cellSize = Math.min(plan.width, plan.height) / cells
  const offsetX = Math.max(0, (plan.width - cellSize * cells) / 2)
  const offsetY = Math.max(0, (plan.height - cellSize * cells) / 2)
  const parts: string[] = []
  for (let row = 0; row < qrSize; row++) {
    for (let col = 0; col < qrSize; col++) {
      if (plan.modules[row * qrSize + col]) {
        parts.push(`M${round(offsetX + (col + qrBorder) * cellSize)} ${round(offsetY + (row + qrBorder) * cellSize)}h${round(cellSize)}v${round(cellSize)}h-${round(cellSize)}z`)
      }
    }
  }
  return svgEle('path', { d: parts.join(' '), fill: foreground })
}

function placeholderSvg(plan: BarcodePlan): any {
  return svgEle('svg', {
    viewBox: `0 0 ${plan.width} ${plan.height}`,
    width: plan.width,
    height: plan.height,
  }, [
    svgEle('rect', { width: '100%', height: '100%', fill: '#f9fafb', stroke: '#9ca3af' }),
    svgEle('text', {
      x: plan.width / 2,
      y: plan.height / 2 + 4,
      fill: '#6b7280',
      'font-size': 10,
      'text-anchor': 'middle',
      'font-family': 'sans-serif',
    }, barcodePlaceholderLabel(plan)),
  ])
}

function barcodePlaceholderLabel(plan: BarcodePlan): string {
  return plan.type === 'qrcode' ? 'QR' : plan.message ?? 'CODE'
}

function paintBarcodePlaceholder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  style: {
    background?: string
    border?: string
    text?: string
    fontFamily?: string
  } = {},
): void {
  ctx.save()
  ctx.strokeStyle = style.border ?? '#9ca3af'
  ctx.fillStyle = style.background ?? '#f9fafb'
  ctx.lineWidth = 1
  ctx.fillRect(x, y, width, height)
  ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, width - 1), Math.max(0, height - 1))
  ctx.fillStyle = style.text ?? '#6b7280'
  ctx.font = `10px ${style.fontFamily ?? 'sans-serif'}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x + width / 2, y + height / 2)
  ctx.restore()
}

function svgEle(sel: string, attrs: Record<string, unknown>, children?: any[] | string): any {
  return {
    sel,
    data: {
      ns: 'http://www.w3.org/2000/svg',
      attrs,
    },
    children: typeof children === 'string' ? undefined : children,
    text: typeof children === 'string' ? children : undefined,
  }
}

function round(value: number): string {
  return Number(value.toFixed(3)).toString()
}
