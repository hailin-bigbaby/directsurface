// Theme: ImGui 风格颜色表 + 几何参数

import { isCompiledTheme, markThemeAsCompiled } from './theme_registry'

export interface Color {
  readonly r: number  // 0-255
  readonly g: number
  readonly b: number
  readonly a: number  // 0-1
}

export interface ThemeTypographyTokens {
  readonly bodyFontSize: number
  readonly bodyLineHeight: number
  readonly bodyFontWeight: number
  readonly titleFontSize: number
  readonly titleLineHeight: number
  readonly titleFontWeight: number
  readonly secondaryFontSize: number
  readonly secondaryLineHeight: number
  readonly secondaryFontWeight: number
  readonly monoFontFamily: string
}

export interface ThemeMotionTokens {
  readonly fastDuration: number
  readonly normalDuration: number
  readonly slowDuration: number
}

export const DefaultThemeMotion: ThemeMotionTokens = Object.freeze({
  fastDuration: 120,
  normalDuration: 180,
  slowDuration: 250,
})

export interface ThemeElevationTokens {
  readonly modalScrim: Color
  readonly drawerScrim: Color
  readonly popupShadowColor: Color
  readonly popupShadowBlur: number
  readonly popupShadowOffsetX: number
  readonly popupShadowOffsetY: number
  readonly windowShadowColor: Color
  readonly windowShadowBlur: number
  readonly windowShadowOffsetX: number
  readonly windowShadowOffsetY: number
  readonly cardShadowColor: Color
  readonly cardShadowBlur: number
  readonly cardShadowOffsetX: number
  readonly cardShadowOffsetY: number
  readonly cardHighlightColor: Color
}

export interface ThemeEditorTokens {
  readonly selectionBg: Color
  readonly selectionText: Color
  readonly searchMatchBg: Color
  readonly searchActiveMatchBg: Color
  readonly searchActiveMatchBorder: Color
}

export interface ThemeChartTokens {
  readonly series: readonly Color[]
  readonly negative: Color
  readonly timelineOther: Color
}

export interface ThemeSyntaxTokens {
  readonly string: Color
  readonly number: Color
  readonly boolean: Color
  readonly function: Color
  readonly type: Color
  readonly meta: Color
}

export function rgba(r: number, g: number, b: number, a = 1): Color {
  return { r, g, b, a }
}

export function colorToCSS(c: Color): string {
  return `rgba(${c.r},${c.g},${c.b},${c.a})`
}

export function lerpColor(a: Color, b: Color, t: number): Color {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
    a: a.a + (b.a - a.a) * t,
  }
}

export type ThemeContrastMode = 'normal' | 'high'

interface ResolvedThemeShape {
  // Rendering policy
  contrastMode: ThemeContrastMode

  // Surfaces
  surfaceCanvas: Color
  surfaceContent: Color
  surfaceWindowTitle: Color
  surfaceWindowTitleActive: Color
  surfacePanel: Color
  surfacePopup: Color
  surfaceControl: Color
  surfaceControlHover: Color
  surfaceControlActive: Color
  surfaceNav: Color
  surfaceDataHeader: Color
  surfaceDataBody: Color

  // Window geometry
  windowRounding: number
  windowPadding: number
  windowBorderSize: number

  // Widget geometry
  framePadding: number
  itemSpacing: number
  frameRounding: number
  frameBorderSize: number

  // Text
  textPrimary: Color
  textSecondary: Color
  textPlaceholder: Color
  textDisabled: Color
  textAccent: Color
  textOnAccent: Color
  textOnDanger: Color
  textOnSelection: Color

  // Borders
  borderWindow: Color
  borderPanel: Color
  borderControl: Color
  borderControlHover: Color
  borderSubtle: Color
  borderData: Color
  borderDataStrong: Color
  focusBorder: Color

  // Accent
  accentPrimary: Color
  accentPrimaryHover: Color
  accentPrimaryActive: Color
  accentSuccess: Color
  accentSuccessHover: Color
  accentWarning: Color
  accentWarningHover: Color
  accentDanger: Color
  accentDangerHover: Color
  accentDangerActive: Color

  // Status surfaces
  statusSuccessBg: Color
  statusSuccessBorder: Color
  statusWarningBg: Color
  statusWarningBorder: Color
  statusDangerBg: Color
  statusDangerBorder: Color

  // Interaction / selection
  stateHoverOverlay: Color
  statePressedOverlay: Color
  selectionMuted: Color
  selectionBg: Color
  selectionStrong: Color

  // Edit / data states
  fieldBg: Color
  fieldFocusBorder: Color
  fieldSelectionBg: Color

  // Scrollbar
  scrollbarBg: Color
  scrollbarGrab: Color
  scrollbarGrabHovered: Color
  scrollbarGrabActive: Color
  scrollbarRounding: number
  scrollbarSize: number

  // Loading overlay
  loadingMaskBg: Color
  loadingSpinnerColor: Color
  loadingSpinnerTrackColor: Color
  loadingTextColor: Color
  loadingSpinnerSize: number
  loadingSpinnerLineWidth: number
  loadingTextGap: number

  // Density
  controlHeight: number
  dataRowHeight: number
  dataHeaderHeight: number
  panelHeaderHeight: number
  toolbarHeight: number
  statusBarHeight: number
  contentPadding: number

  // Font
  fontSize: number
  fontFamily: string

  // Resolved design-system layers. Runtime code consumes these complete values
  // and never fills missing authoring input on demand.
  typography: ThemeTypographyTokens
  motion: ThemeMotionTokens
  elevation: ThemeElevationTokens
  editor: ThemeEditorTokens
  chart: ThemeChartTokens
  syntax: ThemeSyntaxTokens
}

export type ResolvedTheme = Readonly<Omit<ResolvedThemeShape,
  | 'typography'
  | 'motion'
  | 'elevation'
  | 'editor'
  | 'chart'
  | 'syntax'
>> & {
  readonly typography: Readonly<ThemeTypographyTokens>
  readonly motion: Readonly<ThemeMotionTokens>
  readonly elevation: Readonly<ThemeElevationTokens>
  readonly editor: Readonly<ThemeEditorTokens>
  readonly chart: Readonly<ThemeChartTokens>
  readonly syntax: Readonly<ThemeSyntaxTokens>
}

/**
 * Theme authoring input. A definition may override any root token and may
 * partially override each nested design-system layer.
 */
export interface ThemeDefinition extends Partial<Omit<ResolvedTheme,
  | 'typography'
  | 'motion'
  | 'elevation'
  | 'editor'
  | 'chart'
  | 'syntax'
>> {
  typography?: Partial<ThemeTypographyTokens>
  motion?: Partial<ThemeMotionTokens>
  elevation?: Partial<ThemeElevationTokens>
  editor?: Partial<ThemeEditorTokens>
  chart?: Partial<ThemeChartTokens>
  syntax?: Partial<ThemeSyntaxTokens>
}

type ColorTokenKey<T extends object> = Extract<{
  [K in keyof T]-?: T[K] extends Color ? K : never
}[keyof T], string>

type PrimitiveTokenKey<T extends object, V extends number | string> = Extract<{
  [K in keyof T]-?: T[K] extends V ? K : never
}[keyof T], string>

const colorChannelTokens: Readonly<Record<keyof Color, true>> = {
  r: true,
  g: true,
  b: true,
  a: true,
}

const rootColorTokens: Readonly<Record<ColorTokenKey<ResolvedThemeShape>, true>> = {
  surfaceCanvas: true,
  surfaceContent: true,
  surfaceWindowTitle: true,
  surfaceWindowTitleActive: true,
  surfacePanel: true,
  surfacePopup: true,
  surfaceControl: true,
  surfaceControlHover: true,
  surfaceControlActive: true,
  surfaceNav: true,
  surfaceDataHeader: true,
  surfaceDataBody: true,
  textPrimary: true,
  textSecondary: true,
  textPlaceholder: true,
  textDisabled: true,
  textAccent: true,
  textOnAccent: true,
  textOnDanger: true,
  textOnSelection: true,
  borderWindow: true,
  borderPanel: true,
  borderControl: true,
  borderControlHover: true,
  borderSubtle: true,
  borderData: true,
  borderDataStrong: true,
  focusBorder: true,
  accentPrimary: true,
  accentPrimaryHover: true,
  accentPrimaryActive: true,
  accentSuccess: true,
  accentSuccessHover: true,
  accentWarning: true,
  accentWarningHover: true,
  accentDanger: true,
  accentDangerHover: true,
  accentDangerActive: true,
  statusSuccessBg: true,
  statusSuccessBorder: true,
  statusWarningBg: true,
  statusWarningBorder: true,
  statusDangerBg: true,
  statusDangerBorder: true,
  stateHoverOverlay: true,
  statePressedOverlay: true,
  selectionMuted: true,
  selectionBg: true,
  selectionStrong: true,
  fieldBg: true,
  fieldFocusBorder: true,
  fieldSelectionBg: true,
  scrollbarBg: true,
  scrollbarGrab: true,
  scrollbarGrabHovered: true,
  scrollbarGrabActive: true,
  loadingMaskBg: true,
  loadingSpinnerColor: true,
  loadingSpinnerTrackColor: true,
  loadingTextColor: true,
}

const elevationColorTokens: Readonly<Record<ColorTokenKey<ThemeElevationTokens>, true>> = {
  modalScrim: true,
  drawerScrim: true,
  popupShadowColor: true,
  windowShadowColor: true,
  cardShadowColor: true,
  cardHighlightColor: true,
}

const editorColorTokens: Readonly<Record<ColorTokenKey<ThemeEditorTokens>, true>> = {
  selectionBg: true,
  selectionText: true,
  searchMatchBg: true,
  searchActiveMatchBg: true,
  searchActiveMatchBorder: true,
}

const chartColorTokens: Readonly<Record<ColorTokenKey<ThemeChartTokens>, true>> = {
  negative: true,
  timelineOther: true,
}

const syntaxColorTokens: Readonly<Record<ColorTokenKey<ThemeSyntaxTokens>, true>> = {
  string: true,
  number: true,
  boolean: true,
  function: true,
  type: true,
  meta: true,
}

const rootNumberTokens: Readonly<Record<PrimitiveTokenKey<ResolvedThemeShape, number>, true>> = {
  windowRounding: true,
  windowPadding: true,
  windowBorderSize: true,
  framePadding: true,
  itemSpacing: true,
  frameRounding: true,
  frameBorderSize: true,
  scrollbarRounding: true,
  scrollbarSize: true,
  loadingSpinnerSize: true,
  loadingSpinnerLineWidth: true,
  loadingTextGap: true,
  controlHeight: true,
  dataRowHeight: true,
  dataHeaderHeight: true,
  panelHeaderHeight: true,
  toolbarHeight: true,
  statusBarHeight: true,
  contentPadding: true,
  fontSize: true,
}

const rootStringTokens: Readonly<Record<PrimitiveTokenKey<ResolvedThemeShape, string>, true>> = {
  contrastMode: true,
  fontFamily: true,
}

const typographyNumberTokens: Readonly<Record<PrimitiveTokenKey<ThemeTypographyTokens, number>, true>> = {
  bodyFontSize: true,
  bodyLineHeight: true,
  bodyFontWeight: true,
  titleFontSize: true,
  titleLineHeight: true,
  titleFontWeight: true,
  secondaryFontSize: true,
  secondaryLineHeight: true,
  secondaryFontWeight: true,
}

const typographyStringTokens: Readonly<Record<PrimitiveTokenKey<ThemeTypographyTokens, string>, true>> = {
  monoFontFamily: true,
}

const motionNumberTokens: Readonly<Record<PrimitiveTokenKey<ThemeMotionTokens, number>, true>> = {
  fastDuration: true,
  normalDuration: true,
  slowDuration: true,
}

const elevationNumberTokens: Readonly<Record<PrimitiveTokenKey<ThemeElevationTokens, number>, true>> = {
  popupShadowBlur: true,
  popupShadowOffsetX: true,
  popupShadowOffsetY: true,
  windowShadowBlur: true,
  windowShadowOffsetX: true,
  windowShadowOffsetY: true,
  cardShadowBlur: true,
  cardShadowOffsetX: true,
  cardShadowOffsetY: true,
}

export interface ResolvedThemeColorTokenEntry {
  readonly path: string
  readonly value: unknown
}

export function isThemeColor(value: unknown): value is Color {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (Object.keys(colorChannelTokens) as (keyof Color)[]).every(channel =>
    Object.prototype.hasOwnProperty.call(record, channel) &&
    typeof record[channel] === 'number')
}

export function resolvedThemeColorTokenEntries(theme: ResolvedTheme): ResolvedThemeColorTokenEntry[] {
  const entries: ResolvedThemeColorTokenEntry[] = []
  const appendGroup = <T extends object>(
    value: unknown,
    path: string,
    tokens: Readonly<Record<ColorTokenKey<T>, true>>,
  ): void => {
    const record = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
    for (const token of Object.keys(tokens) as ColorTokenKey<T>[]) {
      entries.push({
        path: path ? `${path}.${token}` : token,
        value: record[token],
      })
    }
  }

  appendGroup<ResolvedThemeShape>(theme, '', rootColorTokens)
  appendGroup<ThemeElevationTokens>(theme.elevation, 'elevation', elevationColorTokens)
  appendGroup<ThemeEditorTokens>(theme.editor, 'editor', editorColorTokens)
  appendGroup<ThemeChartTokens>(theme.chart, 'chart', chartColorTokens)
  appendGroup<ThemeSyntaxTokens>(theme.syntax, 'syntax', syntaxColorTokens)
  const series = theme.chart?.series
  if (Array.isArray(series)) {
    for (let index = 0; index < series.length; index += 1) {
      entries.push({
        path: `chart.series[${index}]`,
        value: index in series ? series[index] : undefined,
      })
    }
  }
  return entries
}

export type ThemeMetricKey = keyof Pick<ResolvedTheme,
  | 'windowPadding'
  | 'windowBorderSize'
  | 'framePadding'
  | 'itemSpacing'
  | 'frameRounding'
  | 'frameBorderSize'
  | 'scrollbarRounding'
  | 'scrollbarSize'
  | 'loadingSpinnerSize'
  | 'loadingSpinnerLineWidth'
  | 'loadingTextGap'
  | 'controlHeight'
  | 'dataRowHeight'
  | 'dataHeaderHeight'
  | 'panelHeaderHeight'
  | 'toolbarHeight'
  | 'statusBarHeight'
  | 'contentPadding'
  | 'fontSize'
  | 'fontFamily'
  | 'windowRounding'
>

export function haveSameThemeMetrics(
  current: ResolvedTheme,
  next: ResolvedTheme,
  keys: readonly ThemeMetricKey[],
): boolean {
  return keys.every(key => current[key] === next[key])
}

export const ThemeMetricKeys: readonly ThemeMetricKey[] = [
  'windowPadding',
  'windowBorderSize',
  'framePadding',
  'itemSpacing',
  'frameRounding',
  'frameBorderSize',
  'scrollbarRounding',
  'scrollbarSize',
  'loadingSpinnerSize',
  'loadingSpinnerLineWidth',
  'loadingTextGap',
  'controlHeight',
  'dataRowHeight',
  'dataHeaderHeight',
  'panelHeaderHeight',
  'toolbarHeight',
  'statusBarHeight',
  'contentPadding',
  'fontSize',
  'fontFamily',
  'windowRounding',
]

export function resolveThemeTypography(theme: ResolvedTheme): ThemeTypographyTokens {
  return theme.typography
}

export function resolveThemeMotion(theme: ResolvedTheme): ThemeMotionTokens {
  return theme.motion
}

export function resolveThemeElevation(theme: ResolvedTheme): ThemeElevationTokens {
  return theme.elevation
}

export function resolveThemeEditor(theme: ResolvedTheme): ThemeEditorTokens {
  return theme.editor
}

export function resolveThemeChart(theme: ResolvedTheme): ThemeChartTokens {
  return theme.chart
}

export function resolveThemeSyntax(theme: ResolvedTheme): ThemeSyntaxTokens {
  return theme.syntax
}

function stableThemeValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'number:NaN'
    if (value === Infinity) return 'number:+Infinity'
    if (value === -Infinity) return 'number:-Infinity'
    if (Object.is(value, -0)) return 'number:-0'
    return `number:${value}`
  }
  if (typeof value === 'string') return `string:${JSON.stringify(value)}`
  if (typeof value === 'boolean') return `boolean:${value}`
  if (typeof value !== 'object') return `${typeof value}:${String(value)}`
  if (Array.isArray(value)) {
    const entries = Array.from({ length: value.length }, (_, index) =>
      index in value ? stableThemeValue(value[index]) : 'array-hole')
    return `[${entries.join(',')}]`
  }
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableThemeValue(record[key])}`).join(',')}}`
}

const frozenThemeValueSignatures = new WeakMap<object, string>()
const frozenThemeMetricSignatures = new WeakMap<object, string>()

export function themeValueSignature(theme: ResolvedTheme): string {
  const cached = isCompiledTheme(theme)
    ? frozenThemeValueSignatures.get(theme)
    : undefined
  if (cached) return cached
  const signature = stableThemeValue(theme)
  if (isCompiledTheme(theme)) frozenThemeValueSignatures.set(theme, signature)
  return signature
}

export function themeMetricSignature(theme: ResolvedTheme): string {
  const cached = isCompiledTheme(theme)
    ? frozenThemeMetricSignatures.get(theme)
    : undefined
  if (cached) return cached
  const metrics = Object.fromEntries(ThemeMetricKeys.map(key => [key, theme[key]]))
  const signature = stableThemeValue({ metrics, typography: theme.typography })
  if (isCompiledTheme(theme)) frozenThemeMetricSignatures.set(theme, signature)
  return signature
}

export function haveSameThemeValues(current: ResolvedTheme, next: ResolvedTheme): boolean {
  return themeValueSignature(current) === themeValueSignature(next)
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object') return value
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  return Object.isFrozen(value) ? value : Object.freeze(value)
}

function cloneThemeValue<T>(value: T): T {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(cloneThemeValue) as T
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, nested]) => [key, cloneThemeValue(nested)]),
  ) as T
}

function assertFiniteThemeStructure(
  value: unknown,
  path: string,
  visited: WeakSet<object>,
): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Theme token "${path}" must be a finite number.`)
    }
    return
  }
  if (value === undefined) {
    throw new TypeError(`Theme token "${path}" must be defined.`)
  }
  if (value === null || typeof value !== 'object' || visited.has(value)) return
  visited.add(value)

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) {
        throw new TypeError(`Theme token "${path}[${index}]" must be defined.`)
      }
      assertFiniteThemeStructure(value[index], `${path}[${index}]`, visited)
    }
    return
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    assertFiniteThemeStructure(nested, path ? `${path}.${key}` : key, visited)
  }
}

function assertColorToken(value: unknown, path: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Theme token "${path}" must be a color.`)
  }
  const record = value as Record<string, unknown>
  for (const channel of Object.keys(colorChannelTokens) as (keyof Color)[]) {
    if (
      !Object.prototype.hasOwnProperty.call(record, channel) ||
      typeof record[channel] !== 'number'
    ) {
      throw new TypeError(`Theme token "${path}.${channel}" must be a number.`)
    }
  }
}

function assertColorTokenGroup<T extends object>(
  value: unknown,
  path: string,
  tokens: Readonly<Record<ColorTokenKey<T>, true>>,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Theme token "${path || 'theme'}" must be an object.`)
  }
  const record = value as Record<string, unknown>
  for (const token of Object.keys(tokens) as ColorTokenKey<T>[]) {
    assertColorToken(record[token], path ? `${path}.${token}` : token)
  }
  return record
}

function assertPrimitiveTokenGroup<T extends object, V extends number | string>(
  value: unknown,
  path: string,
  tokens: Readonly<Record<PrimitiveTokenKey<T, V>, true>>,
  expectedType: 'number' | 'string',
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Theme token "${path || 'theme'}" must be an object.`)
  }
  const record = value as Record<string, unknown>
  for (const token of Object.keys(tokens) as PrimitiveTokenKey<T, V>[]) {
    const tokenPath = path ? `${path}.${token}` : token
    if (
      !Object.prototype.hasOwnProperty.call(record, token) ||
      typeof record[token] !== expectedType
    ) {
      throw new TypeError(`Theme token "${tokenPath}" must be a ${expectedType}.`)
    }
  }
}

function assertResolvedThemeStructure(theme: ResolvedTheme): void {
  assertColorTokenGroup<ResolvedThemeShape>(theme, '', rootColorTokens)
  assertPrimitiveTokenGroup<ResolvedThemeShape, number>(theme, '', rootNumberTokens, 'number')
  assertPrimitiveTokenGroup<ResolvedThemeShape, string>(theme, '', rootStringTokens, 'string')
  if (theme.contrastMode !== 'normal' && theme.contrastMode !== 'high') {
    throw new TypeError('Theme token "contrastMode" must be "normal" or "high".')
  }
  assertPrimitiveTokenGroup<ThemeTypographyTokens, number>(
    theme.typography,
    'typography',
    typographyNumberTokens,
    'number',
  )
  assertPrimitiveTokenGroup<ThemeTypographyTokens, string>(
    theme.typography,
    'typography',
    typographyStringTokens,
    'string',
  )
  assertPrimitiveTokenGroup<ThemeMotionTokens, number>(
    theme.motion,
    'motion',
    motionNumberTokens,
    'number',
  )
  assertColorTokenGroup<ThemeElevationTokens>(theme.elevation, 'elevation', elevationColorTokens)
  assertPrimitiveTokenGroup<ThemeElevationTokens, number>(
    theme.elevation,
    'elevation',
    elevationNumberTokens,
    'number',
  )
  assertColorTokenGroup<ThemeEditorTokens>(theme.editor, 'editor', editorColorTokens)
  const chart = assertColorTokenGroup<ThemeChartTokens>(theme.chart, 'chart', chartColorTokens)
  assertColorTokenGroup<ThemeSyntaxTokens>(theme.syntax, 'syntax', syntaxColorTokens)
  assertFiniteThemeStructure(theme, '', new WeakSet())
  if (!Array.isArray(chart.series)) {
    throw new TypeError('Theme token "chart.series" must be an array of colors.')
  }
  if (chart.series.length === 0) {
    throw new TypeError('Theme token "chart.series" must contain at least one color.')
  }
  for (let index = 0; index < chart.series.length; index += 1) {
    assertColorToken(chart.series[index], `chart.series[${index}]`)
  }
}

export function freezeTheme(theme: ResolvedTheme): ResolvedTheme {
  assertResolvedThemeStructure(theme)
  const frozen = deepFreeze(theme)
  markThemeAsCompiled(frozen)
  return frozen
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, nested]) => nested !== undefined),
  ) as Partial<T>
}

export function compileTheme(
  base: ResolvedTheme,
  definition: ThemeDefinition = {},
): ResolvedTheme {
  if (!isCompiledTheme(base)) assertResolvedThemeStructure(base)
  const baseTypography = resolveThemeTypography(base)
  const fontSizeOverridden = definition.fontSize !== undefined
  const nextFontSize = fontSizeOverridden ? definition.fontSize! : base.fontSize
  const fontSizeDelta = nextFontSize - base.fontSize
  const typographyDefinition = withoutUndefined(definition.typography ?? {})
  const typography = definition.typography || fontSizeOverridden
    ? {
        bodyFontSize: typographyDefinition.bodyFontSize ??
          (fontSizeOverridden ? nextFontSize : baseTypography.bodyFontSize),
        bodyLineHeight: typographyDefinition.bodyLineHeight ??
          (fontSizeOverridden ? baseTypography.bodyLineHeight + fontSizeDelta : baseTypography.bodyLineHeight),
        bodyFontWeight: typographyDefinition.bodyFontWeight ?? baseTypography.bodyFontWeight,
        titleFontSize: typographyDefinition.titleFontSize ??
          (fontSizeOverridden ? baseTypography.titleFontSize + fontSizeDelta : baseTypography.titleFontSize),
        titleLineHeight: typographyDefinition.titleLineHeight ??
          (fontSizeOverridden ? baseTypography.titleLineHeight + fontSizeDelta : baseTypography.titleLineHeight),
        titleFontWeight: typographyDefinition.titleFontWeight ?? baseTypography.titleFontWeight,
        secondaryFontSize: typographyDefinition.secondaryFontSize ??
          (fontSizeOverridden ? baseTypography.secondaryFontSize + fontSizeDelta : baseTypography.secondaryFontSize),
        secondaryLineHeight: typographyDefinition.secondaryLineHeight ??
          (fontSizeOverridden ? baseTypography.secondaryLineHeight + fontSizeDelta : baseTypography.secondaryLineHeight),
        secondaryFontWeight: typographyDefinition.secondaryFontWeight ?? baseTypography.secondaryFontWeight,
        monoFontFamily: typographyDefinition.monoFontFamily ?? baseTypography.monoFontFamily,
      }
    : baseTypography
  const rootDefinition = withoutUndefined(definition)
  const composed: ResolvedTheme = {
    ...base,
    ...rootDefinition,
    typography,
    motion: {
      ...resolveThemeMotion(base),
      ...withoutUndefined(definition.motion ?? {}),
    },
    elevation: {
      ...resolveThemeElevation(base),
      ...withoutUndefined(definition.elevation ?? {}),
    },
    editor: {
      ...resolveThemeEditor(base),
      ...withoutUndefined(definition.editor ?? {}),
    },
    chart: {
      ...base.chart,
      ...withoutUndefined(definition.chart ?? {}),
    },
    syntax: {
      ...resolveThemeSyntax(base),
      ...withoutUndefined(definition.syntax ?? {}),
    },
  }
  return freezeTheme(cloneThemeValue(composed))
}

export function createTheme(
  base: ResolvedTheme,
  definition: ThemeDefinition = {},
): ResolvedTheme {
  return compileTheme(base, definition)
}
