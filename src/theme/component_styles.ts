import type { Color, ResolvedTheme } from './theme'
import {
  lerpColor,
  isThemeColor,
  resolvedThemeColorTokenEntries,
  resolveThemeChart,
  resolveThemeElevation,
  resolveThemeSyntax,
  resolveThemeTypography,
  rgba,
} from './theme'
import { isCompiledTheme } from './theme_registry'

type ThemeRecipe<T> = (theme: ResolvedTheme) => T
type ThemeVariantRecipe<TVariant extends PropertyKey, T> =
  (theme: ResolvedTheme, variant: TVariant) => T

function freezeRecipeValue<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value as Record<string, unknown>)) freezeRecipeValue(nested)
  return Object.freeze(value)
}

function memoizeThemeRecipe<T>(recipe: ThemeRecipe<T>): ThemeRecipe<T> {
  const cache = new WeakMap<ResolvedTheme, T>()
  return theme => {
    // Resolved themes are deeply frozen by the compiler. Avoid retaining a
    // result for ad-hoc mutable theme objects whose tokens may still change.
    if (!isCompiledTheme(theme)) return recipe(theme)
    const cached = cache.get(theme)
    if (cached !== undefined) return cached
    const resolved = freezeRecipeValue(recipe(theme))
    cache.set(theme, resolved)
    return resolved
  }
}

function memoizeThemeVariantRecipe<TVariant extends PropertyKey, T>(
  recipe: ThemeVariantRecipe<TVariant, T>,
  defaultVariant: TVariant,
): (theme: ResolvedTheme, variant?: TVariant) => T {
  const cache = new WeakMap<ResolvedTheme, Map<TVariant, T>>()
  return (theme, variant = defaultVariant) => {
    if (!isCompiledTheme(theme)) return recipe(theme, variant)
    let variants = cache.get(theme)
    if (!variants) {
      variants = new Map<TVariant, T>()
      cache.set(theme, variants)
    }
    const cached = variants.get(variant)
    if (cached !== undefined) return cached
    const resolved = freezeRecipeValue(recipe(theme, variant))
    variants.set(variant, resolved)
    return resolved
  }
}

// ---- Interaction State ----

export type InteractionState =
  | 'normal'
  | 'hovered'
  | 'pressed'
  | 'focused'
  | 'selected'
  | 'disabled'

export interface InteractionStateFlags {
  hovered?: boolean
  pressed?: boolean
  focused?: boolean
  selected?: boolean
  disabled?: boolean
}

export type InteractionStateInput = InteractionState | Readonly<InteractionStateFlags>

export interface InteractionBgTokens {
  normalBg: Color
  hoveredBg?: Color
  pressedBg?: Color
  focusedBg?: Color
  selectedBg?: Color
  selectedHoveredBg?: Color
  selectedPressedBg?: Color
  selectedFocusedBg?: Color
  disabledBg?: Color
}

export interface InteractionTextTokens {
  text: Color
  hoveredText?: Color
  pressedText?: Color
  focusedText?: Color
  selectedText?: Color
  selectedHoveredText?: Color
  selectedPressedText?: Color
  selectedFocusedText?: Color
  disabledText?: Color
}

function perceivedLuminance(color: Color): number {
  return color.r * 0.299 + color.g * 0.587 + color.b * 0.114
}

function linearColorChannel(channel: number): number {
  const normalized = channel / 255
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(color: Color): number {
  return 0.2126 * linearColorChannel(color.r) +
    0.7152 * linearColorChannel(color.g) +
    0.0722 * linearColorChannel(color.b)
}

function compositeColor(foreground: Color, background: Color): Color {
  const alpha = foreground.a + background.a * (1 - foreground.a)
  if (alpha <= 0) return rgba(0, 0, 0, 0)
  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
    a: alpha,
  }
}

export function contrastRatio(foreground: Color, background: Color, backdrop: Color = rgba(255, 255, 255)): number {
  const opaqueBackground = background.a < 1 ? compositeColor(background, backdrop) : background
  const opaqueForeground = foreground.a < 1 ? compositeColor(foreground, opaqueBackground) : foreground
  const foregroundLuminance = relativeLuminance(opaqueForeground)
  const backgroundLuminance = relativeLuminance(opaqueBackground)
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

export function resolveContrastText(
  theme: ResolvedTheme,
  background: Color,
  preferred: Color = theme.textOnAccent,
  backdrop: Color = theme.surfacePanel,
): Color {
  if (contrastRatio(preferred, background, backdrop) >= 4.5) return preferred
  if (contrastRatio(theme.textPrimary, background, backdrop) >= 4.5) return theme.textPrimary
  const candidates = [preferred, rgba(255, 255, 255), rgba(0, 0, 0)]
  return candidates.reduce((best, candidate) =>
    contrastRatio(candidate, background, backdrop) > contrastRatio(best, background, backdrop)
      ? candidate
      : best)
}

function ensureContrastColor(
  preferred: Color,
  background: Color,
  minimum: number,
  backdrop: Color = rgba(255, 255, 255),
): Color {
  const opaqueBackground = background.a < 1 ? compositeColor(background, backdrop) : background
  const opaquePreferred = preferred.a < 1 ? compositeColor(preferred, opaqueBackground) : preferred
  if (contrastRatio(opaquePreferred, opaqueBackground, backdrop) >= minimum) return opaquePreferred

  const dark = rgba(0, 0, 0)
  const light = rgba(255, 255, 255)
  const fallback = contrastRatio(dark, opaqueBackground, backdrop) >= contrastRatio(light, opaqueBackground, backdrop)
    ? dark
    : light
  let lower = 0
  let upper = 1
  let result = fallback
  for (let i = 0; i < 12; i++) {
    const amount = (lower + upper) / 2
    const candidate = lerpColor(opaquePreferred, fallback, amount)
    if (contrastRatio(candidate, opaqueBackground, backdrop) >= minimum) {
      result = candidate
      upper = amount
    } else {
      lower = amount
    }
  }
  return result
}

export function resolveSelectionText(
  theme: ResolvedTheme,
  background: Color = theme.selectionBg,
): Color {
  return resolveContrastText(theme, background, theme.textOnSelection)
}

export interface ThemeValidationIssue {
  path: string
  severity: 'error' | 'warning'
  message: string
}

function colorsEqual(a: Color, b: Color): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a
}

export function validateTheme(theme: ResolvedTheme): ThemeValidationIssue[] {
  const issues: ThemeValidationIssue[] = []
  if (theme.contrastMode !== 'normal' && theme.contrastMode !== 'high') {
    issues.push({
      path: 'contrastMode',
      severity: 'error',
      message: 'contrastMode must be "normal" or "high".',
    })
  }
  const requireContrast = (
    path: string,
    foreground: Color,
    background: Color,
    backdrop = theme.surfacePanel,
    minimum = 4.5,
  ) => {
    const ratio = contrastRatio(foreground, background, backdrop)
    if (ratio >= minimum) return
    issues.push({
      path,
      severity: 'error',
      message: `Expected a contrast ratio of at least ${minimum}:1, received ${ratio.toFixed(2)}:1.`,
    })
  }

  let hasMalformedColor = false
  for (const { path, value } of resolvedThemeColorTokenEntries(theme)) {
    if (!isThemeColor(value)) {
      hasMalformedColor = true
      issues.push({ path, severity: 'error', message: 'Color tokens must define numeric r, g, b and a channels.' })
      continue
    }
    const color = value
    if (
      Number.isFinite(color.r) && color.r >= 0 && color.r <= 255 &&
      Number.isFinite(color.g) && color.g >= 0 && color.g <= 255 &&
      Number.isFinite(color.b) && color.b >= 0 && color.b <= 255 &&
      Number.isFinite(color.a) && color.a >= 0 && color.a <= 1
    ) continue
    issues.push({ path, severity: 'error', message: 'Color channels must use RGB 0-255 and alpha 0-1.' })
  }
  if (hasMalformedColor) return issues

  requireContrast('textPrimary/surfacePanel', theme.textPrimary, theme.surfacePanel)
  requireContrast('textSecondary/surfacePanel', theme.textSecondary, theme.surfacePanel)
  requireContrast('textPrimary/surfaceContent', theme.textPrimary, theme.surfaceContent)
  requireContrast('textSecondary/surfaceContent', theme.textSecondary, theme.surfaceContent)
  requireContrast('textPrimary/surfaceDataBody', theme.textPrimary, theme.surfaceDataBody)
  requireContrast('textSecondary/surfaceDataBody', theme.textSecondary, theme.surfaceDataBody)
  requireContrast('textPlaceholder/fieldBg', theme.textPlaceholder, theme.fieldBg)
  requireContrast('textOnAccent/accentPrimary', theme.textOnAccent, theme.accentPrimary)
  requireContrast('textOnAccent/accentPrimaryHover', theme.textOnAccent, theme.accentPrimaryHover)
  requireContrast('textOnAccent/accentPrimaryActive', theme.textOnAccent, theme.accentPrimaryActive)
  requireContrast('textOnDanger/accentDanger', theme.textOnDanger, theme.accentDanger)
  requireContrast('textOnDanger/accentDangerHover', theme.textOnDanger, theme.accentDangerHover)
  requireContrast(
    'textOnDanger/accentDangerActive',
    theme.textOnDanger,
    theme.accentDangerActive,
  )
  const textOnSelection = theme.textOnSelection
  requireContrast('textOnSelection/selectionBg', textOnSelection, theme.selectionBg)
  requireContrast('textOnSelection/selectionStrong', textOnSelection, theme.selectionStrong)
  requireContrast('focusBorder/surfaceControl', theme.focusBorder, theme.surfaceControl, theme.surfacePanel, 3)
  requireContrast('borderControl/surfaceControl', theme.borderControl, theme.surfaceControl, theme.surfacePanel, 3)

  if (colorsEqual(theme.stateHoverOverlay, theme.statePressedOverlay)) {
    issues.push({
      path: 'statePressedOverlay',
      severity: 'warning',
      message: 'statePressedOverlay should remain visually distinct from stateHoverOverlay.',
    })
  }
  for (const [path, alpha, maximum] of [
    ['stateHoverOverlay', theme.stateHoverOverlay.a, 0.35],
    ['statePressedOverlay', theme.statePressedOverlay.a, 0.45],
  ] as const) {
    if (alpha > 0 && alpha <= maximum) continue
    issues.push({
      path,
      severity: 'error',
      message: `Interaction overlays must remain translucent with alpha in the range (0, ${maximum}].`,
    })
  }
  if (
    theme.stateHoverOverlay.r === theme.statePressedOverlay.r &&
    theme.stateHoverOverlay.g === theme.statePressedOverlay.g &&
    theme.stateHoverOverlay.b === theme.statePressedOverlay.b &&
    theme.statePressedOverlay.a <= theme.stateHoverOverlay.a
  ) {
    issues.push({
      path: 'statePressedOverlay',
      severity: 'warning',
      message: 'statePressedOverlay should be stronger than stateHoverOverlay when they share a hue.',
    })
  }
  if (theme.chart.series.length === 0) {
    issues.push({ path: 'chart.series', severity: 'error', message: 'Chart series palette must not be empty.' })
  }
  for (let index = 0; index < theme.chart.series.length; index += 1) {
    const color = theme.chart.series[index] as unknown
    const isColor = index in theme.chart.series &&
      color !== null &&
      typeof color === 'object' &&
      ['r', 'g', 'b', 'a'].every(channel => typeof (color as Record<string, unknown>)[channel] === 'number')
    if (isColor) continue
    issues.push({
      path: `chart.series[${index}]`,
      severity: 'error',
      message: 'Chart series palette entries must be defined colors.',
    })
  }
  const typography = resolveThemeTypography(theme)
  for (const [path, value] of Object.entries({
    fontSize: theme.fontSize,
    bodyFontSize: typography.bodyFontSize,
    bodyLineHeight: typography.bodyLineHeight,
    bodyFontWeight: typography.bodyFontWeight,
    titleFontSize: typography.titleFontSize,
    titleLineHeight: typography.titleLineHeight,
    titleFontWeight: typography.titleFontWeight,
    secondaryFontSize: typography.secondaryFontSize,
    secondaryLineHeight: typography.secondaryLineHeight,
    secondaryFontWeight: typography.secondaryFontWeight,
    controlHeight: theme.controlHeight,
    dataRowHeight: theme.dataRowHeight,
    dataHeaderHeight: theme.dataHeaderHeight,
    panelHeaderHeight: theme.panelHeaderHeight,
    toolbarHeight: theme.toolbarHeight,
    statusBarHeight: theme.statusBarHeight,
    scrollbarSize: theme.scrollbarSize,
    loadingSpinnerSize: theme.loadingSpinnerSize,
    loadingSpinnerLineWidth: theme.loadingSpinnerLineWidth,
  })) {
    if (Number.isFinite(value) && value > 0) continue
    issues.push({
      path,
      severity: 'error',
      message: 'Theme font sizes and density metrics must be finite positive numbers.',
    })
  }
  for (const [path, lineHeight, fontSize] of [
    ['typography.bodyLineHeight', typography.bodyLineHeight, typography.bodyFontSize],
    ['typography.titleLineHeight', typography.titleLineHeight, typography.titleFontSize],
    ['typography.secondaryLineHeight', typography.secondaryLineHeight, typography.secondaryFontSize],
  ] as const) {
    if (lineHeight >= fontSize) continue
    issues.push({
      path,
      severity: 'error',
      message: 'Theme line heights must be greater than or equal to their font size.',
    })
  }
  for (const [path, value] of Object.entries({
    contentPadding: theme.contentPadding,
    windowPadding: theme.windowPadding,
    framePadding: theme.framePadding,
    itemSpacing: theme.itemSpacing,
    windowRounding: theme.windowRounding,
    windowBorderSize: theme.windowBorderSize,
    frameRounding: theme.frameRounding,
    frameBorderSize: theme.frameBorderSize,
    scrollbarRounding: theme.scrollbarRounding,
    loadingTextGap: theme.loadingTextGap,
    'motion.fastDuration': theme.motion.fastDuration,
    'motion.normalDuration': theme.motion.normalDuration,
    'motion.slowDuration': theme.motion.slowDuration,
    'elevation.popupShadowBlur': theme.elevation.popupShadowBlur,
    'elevation.windowShadowBlur': theme.elevation.windowShadowBlur,
    'elevation.cardShadowBlur': theme.elevation.cardShadowBlur,
  })) {
    if (Number.isFinite(value) && value >= 0) continue
    issues.push({
      path,
      severity: 'error',
      message: 'Theme spacing and rounding metrics must be finite non-negative numbers.',
    })
  }
  for (const [path, value] of Object.entries({
    'elevation.popupShadowOffsetX': theme.elevation.popupShadowOffsetX,
    'elevation.popupShadowOffsetY': theme.elevation.popupShadowOffsetY,
    'elevation.windowShadowOffsetX': theme.elevation.windowShadowOffsetX,
    'elevation.windowShadowOffsetY': theme.elevation.windowShadowOffsetY,
    'elevation.cardShadowOffsetX': theme.elevation.cardShadowOffsetX,
    'elevation.cardShadowOffsetY': theme.elevation.cardShadowOffsetY,
  })) {
    if (Number.isFinite(value)) continue
    issues.push({
      path,
      severity: 'error',
      message: 'Theme elevation offsets must be finite numbers.',
    })
  }
  if (
    theme.motion.fastDuration > theme.motion.normalDuration ||
    theme.motion.normalDuration > theme.motion.slowDuration
  ) {
    issues.push({
      path: 'motion',
      severity: 'warning',
      message: 'Theme motion durations should be ordered from fast to normal to slow.',
    })
  }
  if (!theme.fontFamily.trim()) {
    issues.push({ path: 'fontFamily', severity: 'error', message: 'Theme fontFamily must not be empty.' })
  }
  if (!typography.monoFontFamily.trim()) {
    issues.push({
      path: 'typography.monoFontFamily',
      severity: 'error',
      message: 'Theme monoFontFamily must not be empty.',
    })
  }
  return issues
}

function selectionSurface(theme: ResolvedTheme): Color {
  return theme.selectionBg
}

function navHoverSurface(theme: ResolvedTheme): Color {
  return lerpColor(theme.surfaceNav, theme.selectionMuted, 0.45)
}

function chromeStripSurface(theme: ResolvedTheme): Color {
  if (perceivedLuminance(theme.surfaceNav) >= 140) return theme.surfaceNav
  return lerpColor(theme.surfaceNav, theme.surfaceDataHeader, 0.68)
}

function dataHeaderHoverSurface(theme: ResolvedTheme): Color {
  return lerpColor(theme.surfaceDataHeader, theme.selectionMuted, 0.32)
}

function dataHeaderSelectedSurface(theme: ResolvedTheme): Color {
  return lerpColor(theme.surfaceDataHeader, theme.selectionBg, 0.48)
}

function disabledSurface(theme: ResolvedTheme, bg: Color = theme.surfaceControl): Color {
  return lerpColor(bg, theme.surfaceContent, 0.58)
}

function popupSurface(theme: ResolvedTheme): Color {
  return theme.surfacePopup
}

function stateHoverSurface(theme: ResolvedTheme, baseSurface: Color): Color {
  return compositeColor(theme.stateHoverOverlay, baseSurface)
}

function isLowContrastStateSurface(surface: Color, stateSurface: Color): boolean {
  const luminanceDelta = Math.abs(perceivedLuminance(surface) - perceivedLuminance(stateSurface))
  const channelDelta = Math.abs(surface.r - stateSurface.r) +
    Math.abs(surface.g - stateSurface.g) +
    Math.abs(surface.b - stateSurface.b)
  return luminanceDelta < 6 && channelDelta < 18 && Math.abs(surface.a - stateSurface.a) < 0.02
}

function chromeItemSelectedSurface(theme: ResolvedTheme, baseSurface: Color): Color {
  return isLowContrastStateSurface(baseSurface, theme.selectionMuted)
    ? theme.selectionBg
    : theme.selectionMuted
}

function popupHoverSurface(theme: ResolvedTheme): Color {
  return stateHoverSurface(theme, popupSurface(theme))
}

function controlPaddingV(theme: ResolvedTheme): number {
  return Math.max(0, (theme.controlHeight - theme.fontSize) / 2)
}

// ---- Scrollbar ----

export interface ScrollbarStyleTokens {
  trackBg: Color
  trackHoveredBg: Color
  trackPressedBg: Color
  thumbBg: Color
  thumbHoveredBg: Color
  thumbPressedBg: Color
  thumbRadius: number
  gutterSize: number
  thumbThickness: number
  thumbHoveredThickness: number
  thumbPressedThickness: number
  minThumbLength: number
  endInset: number
  trackRadius: number
}

function computeScrollbarStyle(theme: ResolvedTheme): ScrollbarStyleTokens {
  const gutterSize = Math.max(1, theme.scrollbarSize)
  const maxVisualThickness = Math.max(1, gutterSize - 2)
  const thumbThickness = Math.min(maxVisualThickness, 6, Math.max(4, Math.round(gutterSize * 0.5)))
  const thumbHoveredThickness = Math.min(maxVisualThickness, thumbThickness + 2)
  const trackColor = theme.scrollbarBg
  return {
    trackBg: rgba(trackColor.r, trackColor.g, trackColor.b, trackColor.a * 0.35),
    trackHoveredBg: rgba(trackColor.r, trackColor.g, trackColor.b, trackColor.a * 0.7),
    trackPressedBg: trackColor,
    thumbBg: theme.scrollbarGrab,
    thumbHoveredBg: theme.scrollbarGrabHovered,
    thumbPressedBg: theme.scrollbarGrabActive,
    thumbRadius: theme.scrollbarRounding,
    gutterSize,
    thumbThickness,
    thumbHoveredThickness,
    thumbPressedThickness: thumbHoveredThickness,
    minThumbLength: 28,
    endInset: 2,
    trackRadius: theme.scrollbarRounding,
  }
}

// ---- Text ----

export interface TextStyleTokens {
  text: Color
  fontSize: number
  fontFamily: string
  lineHeight: number
  fontWeight: number
  titleFontSize: number
  titleLineHeight: number
  titleFontWeight: number
  secondaryFontSize: number
  secondaryLineHeight: number
  secondaryFontWeight: number
}

function computeTextStyle(theme: ResolvedTheme): TextStyleTokens {
  const typography = resolveThemeTypography(theme)
  return {
    text: theme.textPrimary,
    fontSize: typography.bodyFontSize,
    fontFamily: theme.fontFamily,
    lineHeight: typography.bodyLineHeight,
    fontWeight: typography.bodyFontWeight,
    titleFontSize: typography.titleFontSize,
    titleLineHeight: typography.titleLineHeight,
    titleFontWeight: typography.titleFontWeight,
    secondaryFontSize: typography.secondaryFontSize,
    secondaryLineHeight: typography.secondaryLineHeight,
    secondaryFontWeight: typography.secondaryFontWeight,
  }
}

// ---- Loading ----

export interface LoadingStyleTokens {
  maskBg: Color
  spinnerColor: Color
  spinnerTrackColor: Color
  text: Color
  spinnerSize: number
  spinnerLineWidth: number
  textGap: number
  fontSize: number
  fontFamily: string
}

function computeLoadingStyle(theme: ResolvedTheme): LoadingStyleTokens {
  return {
    maskBg: theme.loadingMaskBg,
    spinnerColor: theme.loadingSpinnerColor,
    spinnerTrackColor: theme.loadingSpinnerTrackColor,
    text: theme.loadingTextColor,
    spinnerSize: theme.loadingSpinnerSize,
    spinnerLineWidth: theme.loadingSpinnerLineWidth,
    textGap: theme.loadingTextGap,
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
  }
}

// ---- Button ----

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'text' | 'link'

export interface ButtonStyleTokens {
  normalBg: Color
  hoveredBg: Color
  pressedBg: Color
  disabledBg: Color
  frameBg: Color
  focusedBorder: Color
  text: Color
  disabledText: Color
  fontSize: number
  fontFamily: string
  borderRadius: number
  borderWidth: number
  borderColor: Color
  paddingH: number
  paddingV: number
}

function computeButtonStyle(theme: ResolvedTheme, variant: ButtonVariant = 'default'): ButtonStyleTokens {
  const base: ButtonStyleTokens = {
    normalBg: theme.surfaceControl,
    hoveredBg: theme.surfaceControlHover,
    pressedBg: theme.surfaceControlActive,
    disabledBg: disabledSurface(theme),
    frameBg: theme.surfaceControl,
    focusedBorder: theme.focusBorder,
    text: theme.textPrimary,
    disabledText: theme.textDisabled,
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    borderRadius: theme.frameRounding,
    borderWidth: theme.frameBorderSize,
    borderColor: theme.borderControl,
    paddingH: theme.framePadding,
    paddingV: controlPaddingV(theme),
  }
  switch (variant) {
    case 'primary':
      return {
        ...base,
        normalBg: theme.accentPrimary,
        hoveredBg: theme.accentPrimaryHover,
        pressedBg: theme.accentPrimaryActive,
        disabledBg: disabledSurface(theme, theme.accentPrimary),
        frameBg: theme.accentPrimary,
        text: theme.textOnAccent,
        borderColor: theme.accentPrimary,
      }
    case 'danger':
      return {
        ...base,
        normalBg: theme.accentDanger,
        hoveredBg: theme.accentDangerHover,
        pressedBg: theme.accentDangerActive,
        disabledBg: disabledSurface(theme, theme.accentDanger),
        frameBg: theme.accentDanger,
        text: theme.textOnDanger,
        borderColor: theme.accentDanger,
      }
    case 'text':
      return {
        ...base,
        normalBg: rgba(0, 0, 0, 0),
        hoveredBg: theme.stateHoverOverlay,
        pressedBg: theme.statePressedOverlay,
        disabledBg: rgba(0, 0, 0, 0),
        frameBg: rgba(0, 0, 0, 0),
        text: theme.textAccent,
        borderWidth: 0,
        borderColor: rgba(0, 0, 0, 0),
      }
    case 'link':
      return {
        ...base,
        normalBg: rgba(0, 0, 0, 0),
        hoveredBg: theme.stateHoverOverlay,
        pressedBg: theme.statePressedOverlay,
        disabledBg: rgba(0, 0, 0, 0),
        frameBg: rgba(0, 0, 0, 0),
        text: theme.textAccent,
        borderWidth: 0,
        borderColor: rgba(0, 0, 0, 0),
      }
    default:
      return base
  }
}

export interface PopoverTriggerStyleTokens {
  background: InteractionBgTokens
  border: InteractionBgTokens
  text: InteractionTextTokens
  focusedBorder: Color
  fontSize: number
  fontFamily: string
  borderRadius: number
  borderWidth: number
  paddingH: number
  paddingV: number
}

function computePopoverTriggerStyle(theme: ResolvedTheme): PopoverTriggerStyleTokens {
  const button = computeButtonStyle(theme)
  const selectedBg = theme.selectionMuted
  return {
    background: {
      normalBg: button.normalBg,
      hoveredBg: button.hoveredBg,
      pressedBg: button.pressedBg,
      selectedBg,
      selectedHoveredBg: compositeColor(theme.stateHoverOverlay, selectedBg),
      selectedPressedBg: compositeColor(theme.statePressedOverlay, selectedBg),
      disabledBg: button.disabledBg,
    },
    border: {
      normalBg: button.borderColor,
      hoveredBg: theme.borderControlHover,
      pressedBg: lerpColor(theme.borderControlHover, theme.accentPrimary, 0.35),
      selectedBg: theme.borderControlHover,
      selectedHoveredBg: theme.borderControlHover,
      selectedPressedBg: lerpColor(theme.borderControlHover, theme.accentPrimary, 0.35),
      disabledBg: theme.borderSubtle,
    },
    text: {
      text: button.text,
      hoveredText: theme.textAccent,
      pressedText: theme.textPrimary,
      selectedText: theme.textAccent,
      selectedHoveredText: theme.textAccent,
      selectedPressedText: theme.textPrimary,
      disabledText: button.disabledText,
    },
    focusedBorder: button.focusedBorder,
    fontSize: button.fontSize,
    fontFamily: button.fontFamily,
    borderRadius: button.borderRadius,
    borderWidth: button.borderWidth,
    paddingH: button.paddingH,
    paddingV: button.paddingV,
  }
}

// ---- Checkbox ----

export interface CheckboxStyleTokens {
  boxBg: InteractionBgTokens
  checkedBoxBg: InteractionBgTokens
  boxBorder: InteractionBgTokens
  checkMark: InteractionTextTokens
  labelText: InteractionTextTokens
  fontSize: number
  fontFamily: string
  itemSpacing: number
  boxSize: number
  borderRadius: number
}

function computeCheckboxStyle(theme: ResolvedTheme): CheckboxStyleTokens {
  return {
    boxBg: {
      normalBg: theme.surfaceControl,
      hoveredBg: theme.surfaceControlHover,
      disabledBg: disabledSurface(theme),
    },
    checkedBoxBg: {
      normalBg: theme.accentPrimary,
      hoveredBg: theme.accentPrimaryHover,
      disabledBg: disabledSurface(theme, theme.accentPrimary),
    },
    boxBorder: {
      normalBg: theme.borderControl,
      hoveredBg: theme.borderControlHover,
      disabledBg: lerpColor(theme.borderControl, theme.surfaceContent, 0.45),
    },
    checkMark: {
      text: theme.textOnAccent,
      hoveredText: theme.textOnAccent,
      selectedText: theme.textOnAccent,
      disabledText: theme.textDisabled,
    },
    labelText: {
      text: theme.textPrimary,
      hoveredText: theme.textPrimary,
      selectedText: theme.textPrimary,
      disabledText: theme.textDisabled,
    },
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    itemSpacing: theme.itemSpacing,
    boxSize: theme.fontSize + 4,
    borderRadius: theme.frameRounding,
  }
}

// ---- Switch ----

export interface SwitchStyleTokens {
  offTrackBg: InteractionBgTokens
  onTrackBg: InteractionBgTokens
  trackBorder: InteractionBgTokens
  thumbBg: InteractionBgTokens
  thumbShadowColor: Color
  labelText: InteractionTextTokens
  fontSize: number
  fontFamily: string
  itemSpacing: number
  height: number
  trackWidth: number
  trackHeight: number
  thumbRadius: number
}

function computeSwitchStyle(theme: ResolvedTheme): SwitchStyleTokens {
  const elevation = resolveThemeElevation(theme)
  const trackHeight = theme.fontSize * 1.1
  const offTrack = lerpColor(theme.surfaceControl, theme.surfaceNav, 0.22)
  const offTrackHovered = lerpColor(theme.surfaceControlHover, theme.surfaceNav, 0.28)
  const onTrack = lerpColor(theme.accentPrimary, theme.selectionBg, 0.2)
  const onTrackHovered = lerpColor(theme.accentPrimaryHover, theme.selectionBg, 0.12)
  const disabledTrackBg = disabledSurface(theme, theme.surfaceControl)
  return {
    offTrackBg: {
      normalBg: offTrack,
      hoveredBg: offTrackHovered,
      disabledBg: disabledTrackBg,
    },
    onTrackBg: {
      normalBg: onTrack,
      hoveredBg: onTrackHovered,
      disabledBg: disabledTrackBg,
    },
    trackBorder: {
      normalBg: theme.borderControl,
      hoveredBg: theme.borderControlHover,
      disabledBg: { ...theme.borderControl, a: 0.2 },
    },
    thumbBg: {
      normalBg: theme.surfacePopup,
      pressedBg: lerpColor(theme.surfacePopup, theme.surfaceNav, 0.24),
      disabledBg: disabledSurface(theme, theme.surfacePopup),
    },
    thumbShadowColor: elevation.cardShadowColor,
    labelText: {
      text: theme.textPrimary,
      disabledText: theme.textDisabled,
    },
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    itemSpacing: theme.itemSpacing,
    height: theme.controlHeight,
    trackWidth: theme.fontSize * 2.2,
    trackHeight,
    thumbRadius: trackHeight * 0.42,
  }
}

// ---- Slider ----

interface PrimaryDragHandleStyleTokens {
  fill: InteractionBgTokens
  border: InteractionBgTokens
}

function computePrimaryDragHandleStyle(theme: ResolvedTheme): PrimaryDragHandleStyleTokens {
  return {
    fill: {
      normalBg: theme.accentPrimary,
      hoveredBg: theme.accentPrimaryHover,
      pressedBg: theme.accentPrimaryActive,
      disabledBg: disabledSurface(theme, theme.accentPrimary),
    },
    border: {
      normalBg: lerpColor(theme.accentPrimary, rgba(255, 255, 255), 0.2),
      hoveredBg: lerpColor(theme.accentPrimaryHover, rgba(255, 255, 255), 0.2),
      pressedBg: lerpColor(theme.accentPrimaryActive, rgba(255, 255, 255), 0.2),
      disabledBg: lerpColor(theme.borderControl, theme.surfaceContent, 0.45),
    },
  }
}

export interface SliderStyleTokens {
  trackBg: InteractionBgTokens
  fillBg: InteractionBgTokens
  grabBg: InteractionBgTokens
  grabBorder: InteractionBgTokens
  labelText: InteractionTextTokens
  valueText: InteractionTextTokens
  fontSize: number
  fontFamily: string
  itemSpacing: number
  height: number
  trackHeight: number
}

function computeSliderStyle(theme: ResolvedTheme): SliderStyleTokens {
  const grab = computePrimaryDragHandleStyle(theme)
  return {
    trackBg: {
      normalBg: theme.surfaceControl,
      hoveredBg: theme.surfaceControl,
      pressedBg: theme.surfaceControl,
      disabledBg: disabledSurface(theme),
    },
    fillBg: {
      normalBg: theme.accentPrimary,
      hoveredBg: theme.accentPrimaryHover,
      pressedBg: theme.accentPrimaryActive,
      disabledBg: disabledSurface(theme, theme.accentPrimary),
    },
    grabBg: grab.fill,
    grabBorder: grab.border,
    labelText: {
      text: theme.textPrimary,
      hoveredText: theme.textPrimary,
      pressedText: theme.textPrimary,
      disabledText: theme.textDisabled,
    },
    valueText: {
      text: theme.textSecondary,
      hoveredText: theme.textSecondary,
      pressedText: theme.textSecondary,
      disabledText: theme.textDisabled,
    },
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    itemSpacing: theme.itemSpacing,
    height: theme.controlHeight,
    trackHeight: 4,
  }
}

// ---- Progress Bar ----

export interface ProgressBarStyleTokens {
  trackBg: Color
  trackBorder: Color
  fillBg: Color
  text: Color
  fontSize: number
  fontFamily: string
  labelFontSize: number
  height: number
}

function computeProgressBarStyle(theme: ResolvedTheme): ProgressBarStyleTokens {
  return {
    trackBg: theme.surfaceControl,
    trackBorder: theme.borderControl,
    fillBg: theme.accentPrimary,
    text: theme.textPrimary,
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    labelFontSize: theme.fontSize * 0.85,
    height: theme.fontSize + theme.framePadding,
  }
}

// ---- Text Input ----

export interface TextInputStyleTokens {
  normalBg: Color
  hoveredBg: Color
  focusedBg: Color
  borderColor: Color
  focusedBorder: Color
  inputBg: InteractionBgTokens
  inputBorder: InteractionBgTokens
  text: Color
  textDisabled: Color
  contrastText: Color
  placeholderText: Color
  helperText: Color
  helperTextDisabled: Color
  successBorder: Color
  successText: Color
  warningBorder: Color
  warningText: Color
  errorBorder: Color
  errorText: Color
  selectionBg: Color
  compositionText: Color
  caretColor: Color
  separator: Color
  fontSize: number
  fontFamily: string
  helperFontSize: number
  helperLineHeight: number
  helperGap: number
  padding: number
  itemSpacing: number
  borderRadius: number
  borderWidth: number
  height: number
  lineHeight: number
  buttonWidth: number
}

function deriveInputPlaceholderText(theme: ResolvedTheme): Color {
  return theme.textPlaceholder
}

function computeTextInputStyle(theme: ResolvedTheme): TextInputStyleTokens {
  const normalBg = theme.surfaceControl
  const hoveredBg = theme.surfaceControlHover
  const focusedBg = theme.surfaceControl
  const successBorder = theme.accentSuccess
  const warningBorder = theme.accentWarning
  const errorBorder = theme.accentDanger
  const inputBg: InteractionBgTokens = {
    normalBg,
    hoveredBg,
    focusedBg,
    disabledBg: disabledSurface(theme),
  }
  const inputBorder: InteractionBgTokens = {
    normalBg: theme.borderControl,
    hoveredBg: theme.borderControlHover,
    focusedBg: theme.focusBorder,
    disabledBg: lerpColor(theme.borderControl, theme.surfaceContent, 0.45),
  }
  return {
    normalBg: inputBg.normalBg,
    hoveredBg: inputBg.hoveredBg!,
    focusedBg: inputBg.focusedBg!,
    borderColor: inputBorder.normalBg,
    focusedBorder: inputBorder.focusedBg!,
    inputBg,
    inputBorder,
    text: theme.textPrimary,
    textDisabled: theme.textDisabled,
    contrastText: theme.textOnAccent,
    placeholderText: deriveInputPlaceholderText(theme),
    helperText: theme.textSecondary,
    helperTextDisabled: theme.textDisabled,
    successBorder,
    successText: successBorder,
    warningBorder,
    warningText: warningBorder,
    errorBorder,
    errorText: errorBorder,
    selectionBg: theme.fieldSelectionBg,
    compositionText: { ...theme.textPrimary, a: 0.6 },
    caretColor: theme.textPrimary,
    separator: theme.borderSubtle,
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    helperFontSize: theme.fontSize * 0.86,
    helperLineHeight: theme.fontSize * 1.2,
    helperGap: Math.max(4, Math.round(theme.framePadding * 0.75)),
    padding: theme.framePadding,
    itemSpacing: theme.itemSpacing,
    borderRadius: theme.frameRounding,
    borderWidth: theme.frameBorderSize,
    height: theme.controlHeight,
    lineHeight: theme.fontSize * 1.4,
    buttonWidth: theme.controlHeight,
  }
}

// ---- Dropdown ----

export interface DropdownStyleTokens {
  itemHeight: number
  itemBg: InteractionBgTokens
  itemText: InteractionTextTokens
  arrowText: InteractionTextTokens
  separator: Color
  fontSize: number
  fontFamily: string
  padding: number
}

function computeDropdownStyle(theme: ResolvedTheme): DropdownStyleTokens {
  const selectedBg = selectionSurface(theme)
  const selectedHoveredBg = compositeColor(theme.stateHoverOverlay, selectedBg)
  const selectedText = resolveSelectionText(theme, selectedBg)
  return {
    itemHeight: theme.controlHeight,
    itemBg: {
      normalBg: rgba(0, 0, 0, 0),
      hoveredBg: theme.stateHoverOverlay,
      selectedBg,
      selectedHoveredBg,
    },
    itemText: {
      text: theme.textPrimary,
      selectedText,
      selectedHoveredText: resolveSelectionText(theme, selectedHoveredBg),
      disabledText: theme.textDisabled,
    },
    arrowText: {
      text: theme.textSecondary,
      selectedText,
    },
    separator: theme.borderData,
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    padding: theme.framePadding,
  }
}

// ---- Date Picker ----

export interface DatePickerStyleTokens {
  text: Color
  textDisabled: Color
  contrastText: Color
  accentText: Color
  weekendText: Color
  navBg: InteractionBgTokens
  cellBg: InteractionBgTokens
  footerButtonBg: InteractionBgTokens
  separator: Color
  fontSize: number
  fontFamily: string
  padding: number
  cellSize: number
  headerHeight: number
  footerHeight: number
  weekLabelFontSize: number
  navFontSize: number
}

function computeDatePickerStyle(theme: ResolvedTheme): DatePickerStyleTokens {
  const cellSize = theme.controlHeight
  const selectedBg = theme.accentPrimary
  return {
    text: theme.textPrimary,
    textDisabled: theme.textDisabled,
    contrastText: theme.textOnAccent,
    accentText: theme.textAccent,
    weekendText: theme.textSecondary,
    navBg: {
      normalBg: rgba(0, 0, 0, 0),
      hoveredBg: theme.selectionMuted,
    },
    cellBg: {
      normalBg: rgba(0, 0, 0, 0),
      hoveredBg: theme.stateHoverOverlay,
      selectedBg: selectedBg,
      selectedHoveredBg: compositeColor(theme.stateHoverOverlay, selectedBg),
    },
    footerButtonBg: {
      normalBg: rgba(0, 0, 0, 0),
      hoveredBg: theme.selectionMuted,
    },
    separator: theme.borderSubtle,
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    padding: theme.framePadding,
    cellSize,
    headerHeight: cellSize + theme.framePadding,
    footerHeight: cellSize + theme.framePadding * 2,
    weekLabelFontSize: theme.fontSize * 0.85,
    navFontSize: theme.fontSize * 1.2,
  }
}

// ---- Color Picker ----

export interface ColorPickerStyleTokens {
  text: Color
  textDisabled: Color
  borderColor: Color
  cancelButtonBg: InteractionBgTokens
  confirmButtonBg: InteractionBgTokens
  cancelButtonText: InteractionTextTokens
  confirmButtonText: InteractionTextTokens
  fontSize: number
  fontFamily: string
  itemSpacing: number
  padding: number
  popupWidth: number
  svSize: number
  barHeight: number
  buttonHeight: number
  previewHeight: number
  previewWidth: number
  previewLabelFontSize: number
  triggerSwatchWidthFactor: number
  triggerInset: number
  borderRadius: number
  innerBorderRadius: number
  barThumbRadius: number
}

function computeColorPickerStyle(theme: ResolvedTheme): ColorPickerStyleTokens {
  const fontSize = theme.fontSize
  const padding = theme.framePadding * 2
  const svSize = fontSize * 10
  const barHeight = fontSize * 0.9
  const previewHeight = theme.controlHeight
  return {
    text: theme.textPrimary,
    textDisabled: theme.textDisabled,
    borderColor: theme.borderPanel,
    cancelButtonBg: {
      normalBg: theme.surfaceControl,
      hoveredBg: theme.surfaceControlHover,
      pressedBg: theme.surfaceControlActive,
    },
    confirmButtonBg: {
      normalBg: theme.accentPrimary,
      hoveredBg: theme.accentPrimaryHover,
      pressedBg: theme.accentPrimaryActive,
    },
    cancelButtonText: {
      text: theme.textPrimary,
      disabledText: theme.textDisabled,
    },
    confirmButtonText: {
      text: theme.textOnAccent,
      hoveredText: theme.textOnAccent,
      pressedText: theme.textOnAccent,
      disabledText: resolveContrastText(theme, disabledSurface(theme, theme.accentPrimary)),
    },
    fontSize,
    fontFamily: theme.fontFamily,
    itemSpacing: theme.itemSpacing,
    padding,
    popupWidth: svSize + padding * 2,
    svSize,
    barHeight,
    buttonHeight: theme.controlHeight,
    previewHeight,
    previewWidth: previewHeight * 1.5,
    previewLabelFontSize: fontSize * 0.85,
    triggerSwatchWidthFactor: 1,
    triggerInset: 3,
    borderRadius: theme.frameRounding,
    innerBorderRadius: Math.max(0, theme.frameRounding - 1),
    barThumbRadius: barHeight * 0.55,
  }
}

// ---- Context Menu ----

export interface ContextMenuStyleTokens {
  text: Color
  textDisabled: Color
  dangerText: Color
  hoveredBg: Color
  itemBg: InteractionBgTokens
  itemText: InteractionTextTokens
  dangerItemText: InteractionTextTokens
  shortcutText: InteractionTextTokens
  separator: Color
  fontSize: number
  fontFamily: string
  padding: number
  itemHeight: number
  separatorHeight: number
  menuWidth: number
  shortcutFontSize: number
  rowRadius: number
  iconGap: number
}

function computeContextMenuStyle(theme: ResolvedTheme): ContextMenuStyleTokens {
  const hoveredBg = popupHoverSurface(theme)
  return {
    text: theme.textPrimary,
    textDisabled: theme.textDisabled,
    dangerText: theme.accentDanger,
    hoveredBg: hoveredBg,
    itemBg: {
      normalBg: rgba(0, 0, 0, 0),
      hoveredBg: hoveredBg,
      disabledBg: rgba(0, 0, 0, 0),
    },
    itemText: {
      text: theme.textPrimary,
      hoveredText: theme.textPrimary,
      disabledText: theme.textDisabled,
    },
    dangerItemText: {
      text: theme.accentDanger,
      hoveredText: theme.accentDanger,
      disabledText: theme.textDisabled,
    },
    shortcutText: {
      text: theme.textSecondary,
      hoveredText: theme.textSecondary,
      disabledText: theme.textDisabled,
    },
    separator: theme.borderSubtle,
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    padding: theme.framePadding,
    itemHeight: theme.controlHeight,
    separatorHeight: theme.itemSpacing * 2 + 1,
    menuWidth: 200,
    shortcutFontSize: theme.fontSize * 0.85,
    rowRadius: Math.max(0, theme.frameRounding - 1),
    iconGap: theme.fontSize + theme.framePadding,
  }
}

// ---- Menu Bar ----

export interface MenuBarStyleTokens {
  barBg: Color
  separator: Color
  text: Color
  fontSize: number
  fontFamily: string
  padding: number
  height: number
  itemRadius: number
  dropdownWidth: number
  itemBg: InteractionBgTokens
  itemText: InteractionTextTokens
}

function computeMenuBarStyle(theme: ResolvedTheme): MenuBarStyleTokens {
  const barBg = chromeStripSurface(theme)
  const selectedBg = chromeItemSelectedSurface(theme, barBg)
  const selectedHoveredBg = compositeColor(theme.stateHoverOverlay, selectedBg)
  return {
    barBg,
    separator: theme.borderSubtle,
    text: theme.textPrimary,
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    padding: theme.framePadding,
    height: theme.controlHeight,
    itemRadius: theme.frameRounding,
    dropdownWidth: theme.fontSize * 12,
    itemBg: {
      normalBg: { ...barBg, a: 0 },
      hoveredBg: stateHoverSurface(theme, barBg),
      focusedBg: stateHoverSurface(theme, barBg),
      selectedBg,
      selectedHoveredBg,
      selectedFocusedBg: selectedBg,
      disabledBg: { ...barBg, a: 0 },
    },
    itemText: {
      text: theme.textPrimary,
      hoveredText: theme.textPrimary,
      focusedText: theme.textPrimary,
      selectedText: theme.textPrimary,
      selectedHoveredText: theme.textPrimary,
      selectedFocusedText: theme.textPrimary,
      disabledText: theme.textDisabled,
    },
  }
}

// ---- Tabs ----

export interface TabsStyleTokens {
  barBg: Color
  separator: Color
  indicatorBg: Color
  activeTabBg: Color
  tabRadius: number
  tabTopInset: number
  stripStartInset: number
  indicatorHeight: number
  fontSize: number
  fontFamily: string
  padding: number
  itemSpacing: number
  height: number
  closeButtonSize: number
  tabBg: InteractionBgTokens
  tabText: InteractionTextTokens
  closeBg: InteractionBgTokens
  closeText: InteractionTextTokens
}

function computeTabsStyle(theme: ResolvedTheme): TabsStyleTokens {
  const stripBase = chromeStripSurface(theme)
  const stripBg = perceivedLuminance(stripBase) >= 140
    ? lerpColor(stripBase, theme.surfaceWindowTitleActive, 0.18)
    : lerpColor(stripBase, theme.surfaceWindowTitle, 0.48)
  const activeTabBg = theme.surfaceContent
  const hoveredTabBg = compositeColor(theme.stateHoverOverlay, stripBg)
  const pressedTabBg = compositeColor(theme.statePressedOverlay, stripBg)
  const activeHoveredTabBg = compositeColor(theme.stateHoverOverlay, activeTabBg)
  const activePressedTabBg = compositeColor(theme.statePressedOverlay, activeTabBg)
  return {
    barBg: stripBg,
    separator: lerpColor(stripBg, theme.borderSubtle, 0.42),
    indicatorBg: theme.accentPrimary,
    activeTabBg,
    tabRadius: 0,
    tabTopInset: 0,
    stripStartInset: 0,
    indicatorHeight: 2,
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    padding: Math.max(6, theme.framePadding),
    itemSpacing: Math.max(4, theme.itemSpacing - 1),
    height: theme.panelHeaderHeight,
    closeButtonSize: Math.max(16, theme.fontSize + 2),
    tabBg: {
      normalBg: { ...stripBg, a: 0 },
      hoveredBg: hoveredTabBg,
      pressedBg: pressedTabBg,
      selectedBg: activeTabBg,
      selectedHoveredBg: activeHoveredTabBg,
      selectedPressedBg: activePressedTabBg,
      disabledBg: { ...stripBg, a: 0 },
    },
    tabText: {
      text: lerpColor(theme.textSecondary, stripBg, 0.18),
      hoveredText: theme.textPrimary,
      pressedText: theme.textPrimary,
      selectedText: theme.textPrimary,
      selectedHoveredText: theme.textPrimary,
      selectedPressedText: theme.textPrimary,
      disabledText: theme.textDisabled,
    },
    closeBg: {
      normalBg: { ...stripBg, a: 0 },
      hoveredBg: compositeColor(theme.stateHoverOverlay, activeTabBg),
      disabledBg: { ...stripBg, a: 0 },
    },
    closeText: {
      text: theme.textSecondary,
      hoveredText: theme.textPrimary,
      disabledText: theme.textDisabled,
    },
  }
}

// ---- Dock Workbench ----

export interface DockWorkbenchGuideScopeStyleTokens {
  buttonSize: number
  clusterPadding: number
  clusterBg: Color
  clusterActiveBg: Color
  clusterBorder: Color
  clusterActiveBorder: Color
}

export interface DockWorkbenchStyleTokens {
  guideGap: number
  guideEdgeInset: number
  guideRadius: number
  guideShadowBg: Color
  guideShadowActiveBg: Color
  guideButtonBg: Color
  guideButtonActiveBg: Color
  guideButtonBorder: Color
  guideButtonActiveBorder: Color
  guideIcon: Color
  guideIconActive: Color
  guideIconFill: Color
  guideIconActiveFill: Color
  groupGuide: DockWorkbenchGuideScopeStyleTokens
  documentAreaGuide: DockWorkbenchGuideScopeStyleTokens
  workbenchGuide: DockWorkbenchGuideScopeStyleTokens
  dropPreviewBg: Color
  dropPreviewBorder: Color
  dropPreviewInnerBorder: Color
  dragScrimBg: Color
  dragScrimRejectedBg: Color
  pinButtonSize: number
  headerActionWidth: number
  pinButtonRadius: number
  pinButtonHoverBg: Color
  pinButtonPressedBg: Color
  pinButtonHoverBorder: Color
  pinButtonPressedBorder: Color
  pinIcon: Color
  pinIconActive: Color
  autoHideRailSize: number
  autoHideSideTabBaseSize: number
  autoHideSideTabMaxSize: number
  autoHideSideTabTextMaxLength: number
  autoHideSideTabLabelOffset: number
  autoHideRailBg: Color
  autoHideRailInner: Color
  autoHideRailBorder: Color
  autoHideTabBg: InteractionBgTokens
  autoHideTabBorder: InteractionBgTokens
  autoHideTabText: InteractionTextTokens
  autoHideTabFontSize: number
  autoHideTabFontFamily: string
  autoHideTabFontWeight: number
  autoHideSideIconSize: number
  autoHideBottomIconSize: number
  autoHideBottomIconGap: number
  autoHideBottomTextInset: number
  autoHideSideTabTextUnit: number
  autoHideSideTabExtra: number
  overlayMinWidth: number
  overlayMinHeight: number
  floatingGuideButtonSize: number
  floatingGuideClusterPadding: number
}

function computeDockWorkbenchStyle(theme: ResolvedTheme): DockWorkbenchStyleTokens {
  const guideSurface = perceivedLuminance(theme.surfacePopup) >= 140
    ? lerpColor(theme.surfacePopup, theme.surfaceNav, 0.82)
    : lerpColor(theme.surfacePopup, theme.surfaceWindowTitle, 0.48)
  const guideActiveSurface = lerpColor(guideSurface, theme.accentPrimary, perceivedLuminance(guideSurface) >= 140 ? 0.18 : 0.38)
  const guideBorder = lerpColor(theme.borderControl, theme.accentPrimary, 0.28)
  const guideActiveBorder = lerpColor(theme.focusBorder, theme.accentPrimary, 0.42)
  const railBg = chromeStripSurface(theme)
  const railHoverBg = stateHoverSurface(theme, railBg)
  const railActiveBg = chromeItemSelectedSurface(theme, railBg)
  const pinHoverBg = lerpColor(theme.surfaceControlHover, theme.selectionMuted, 0.42)
  const pinPressedBg = lerpColor(theme.surfaceControlActive, theme.selectionBg, 0.45)
  const guideScope = (
    buttonSize: number,
    padding: number,
    bgMix: number,
    activeMix: number,
  ): DockWorkbenchGuideScopeStyleTokens => {
    const bg = lerpColor(guideSurface, theme.surfaceContent, bgMix)
    const activeBg = lerpColor(guideActiveSurface, theme.selectionBg, activeMix)
    return {
      buttonSize,
      clusterPadding: padding,
      clusterBg: { ...bg, a: perceivedLuminance(bg) >= 140 ? 0.94 : 0.66 },
      clusterActiveBg: { ...activeBg, a: perceivedLuminance(activeBg) >= 140 ? 0.96 : 0.76 },
      clusterBorder: { ...guideBorder, a: 0.42 },
      clusterActiveBorder: { ...guideActiveBorder, a: 0.86 },
    }
  }
  const pinButtonSize = Math.max(20, theme.controlHeight - 4)
  const autoHideRailSize = Math.max(30, theme.controlHeight + 8)
  return {
    guideGap: Math.max(6, theme.itemSpacing),
    guideEdgeInset: Math.max(40, theme.controlHeight + theme.itemSpacing * 3),
    guideRadius: Math.max(4, theme.frameRounding + 2),
    guideShadowBg: rgba(0, 0, 0, perceivedLuminance(guideSurface) >= 140 ? 0.12 : 0.22),
    guideShadowActiveBg: rgba(0, 0, 0, perceivedLuminance(guideSurface) >= 140 ? 0.16 : 0.30),
    guideButtonBg: guideSurface,
    guideButtonActiveBg: guideActiveSurface,
    guideButtonBorder: guideBorder,
    guideButtonActiveBorder: guideActiveBorder,
    guideIcon: theme.textSecondary,
    guideIconActive: resolveContrastText(theme, guideActiveSurface),
    guideIconFill: lerpColor(theme.accentPrimary, guideSurface, 0.18),
    guideIconActiveFill: lerpColor(theme.accentPrimary, theme.selectionBg, 0.22),
    groupGuide: guideScope(Math.max(28, theme.controlHeight + 4), 6, 0.06, 0.18),
    documentAreaGuide: guideScope(Math.max(32, theme.controlHeight + 8), 7, 0.02, 0.14),
    workbenchGuide: guideScope(Math.max(34, theme.controlHeight + 10), 8, 0, 0.10),
    dropPreviewBg: { ...theme.selectionBg, a: 0.28 },
    dropPreviewBorder: { ...theme.focusBorder, a: 0.98 },
    dropPreviewInnerBorder: { ...theme.selectionMuted, a: 0.54 },
    dragScrimBg: { ...theme.selectionBg, a: 0.06 },
    dragScrimRejectedBg: rgba(
      Math.max(0, Math.min(255, theme.surfaceCanvas.r)),
      Math.max(0, Math.min(255, theme.surfaceCanvas.g)),
      Math.max(0, Math.min(255, theme.surfaceCanvas.b)),
      0.14,
    ),
    pinButtonSize,
    headerActionWidth: pinButtonSize + Math.max(8, theme.itemSpacing + 2),
    pinButtonRadius: Math.max(2, theme.frameRounding),
    pinButtonHoverBg: pinHoverBg,
    pinButtonPressedBg: pinPressedBg,
    pinButtonHoverBorder: theme.borderControlHover,
    pinButtonPressedBorder: theme.focusBorder,
    pinIcon: theme.textSecondary,
    pinIconActive: theme.accentPrimary,
    autoHideRailSize,
    autoHideSideTabBaseSize: Math.max(48, theme.controlHeight + 30),
    autoHideSideTabMaxSize: Math.max(148, theme.controlHeight * 6),
    autoHideSideTabTextMaxLength: 18,
    autoHideSideTabLabelOffset: Math.max(6, Math.round(theme.fontSize * 0.62)),
    autoHideRailBg: railBg,
    autoHideRailInner: railHoverBg,
    autoHideRailBorder: theme.borderControl,
    autoHideTabBg: {
      normalBg: railBg,
      hoveredBg: railHoverBg,
      pressedBg: compositeColor(theme.statePressedOverlay, railBg),
      selectedBg: railActiveBg,
      selectedHoveredBg: compositeColor(theme.stateHoverOverlay, railActiveBg),
      selectedPressedBg: compositeColor(theme.statePressedOverlay, railActiveBg),
    },
    autoHideTabBorder: {
      normalBg: theme.borderControl,
      hoveredBg: theme.borderControlHover,
      pressedBg: theme.focusBorder,
      selectedBg: theme.focusBorder,
      selectedHoveredBg: theme.focusBorder,
      selectedPressedBg: theme.focusBorder,
    },
    autoHideTabText: {
      text: theme.textSecondary,
      hoveredText: theme.textPrimary,
      pressedText: theme.textPrimary,
      selectedText: theme.accentPrimary,
      selectedHoveredText: theme.accentPrimary,
      selectedPressedText: theme.accentPrimary,
    },
    autoHideTabFontSize: Math.max(11, theme.fontSize - 1),
    autoHideTabFontFamily: theme.fontFamily,
    autoHideTabFontWeight: 600,
    autoHideSideIconSize: Math.max(12, theme.fontSize),
    autoHideBottomIconSize: Math.max(13, theme.fontSize + 1),
    autoHideBottomIconGap: Math.max(5, theme.itemSpacing + 1),
    autoHideBottomTextInset: Math.max(8, theme.framePadding + 2),
    autoHideSideTabTextUnit: Math.max(6, Math.round(theme.fontSize * 0.62)),
    autoHideSideTabExtra: Math.max(28, theme.controlHeight + 4),
    overlayMinWidth: Math.max(200, theme.controlHeight * 8),
    overlayMinHeight: Math.max(140, theme.controlHeight * 5 + 10),
    floatingGuideButtonSize: Math.max(28, theme.controlHeight + 4),
    floatingGuideClusterPadding: 6,
  }
}

// ---- Radio Group ----

export interface RadioGroupStyleTokens {
  fontSize: number
  fontFamily: string
  padding: number
  itemSpacing: number
  itemHeight: number
  radioRadius: number
  controlBg: InteractionBgTokens
  controlBorder: InteractionBgTokens
  dotBg: InteractionBgTokens
  labelText: InteractionTextTokens
}

function computeRadioGroupStyle(theme: ResolvedTheme): RadioGroupStyleTokens {
  const selectedControlBg = theme.surfaceControl
  const selectedHoveredControlBg = compositeColor(theme.stateHoverOverlay, selectedControlBg)
  const selectedBorder = theme.accentPrimary
  const selectedHoveredBorder = compositeColor(theme.stateHoverOverlay, selectedBorder)
  const selectedDot = theme.accentPrimary
  const selectedHoveredDot = compositeColor(theme.stateHoverOverlay, selectedDot)
  return {
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    padding: theme.framePadding,
    itemSpacing: theme.itemSpacing,
    itemHeight: Math.max(theme.controlHeight - 2, theme.fontSize + theme.framePadding * 1.5),
    radioRadius: theme.fontSize * 0.5,
    controlBg: {
      normalBg: theme.surfaceControl,
      hoveredBg: theme.surfaceControlHover,
      selectedBg: selectedControlBg,
      selectedHoveredBg: selectedHoveredControlBg,
      disabledBg: disabledSurface(theme),
    },
    controlBorder: {
      normalBg: theme.borderControl,
      hoveredBg: theme.borderControlHover,
      selectedBg: selectedBorder,
      selectedHoveredBg: selectedHoveredBorder,
      disabledBg: lerpColor(theme.borderControl, theme.surfaceContent, 0.4),
    },
    dotBg: {
      normalBg: { ...theme.accentPrimaryHover, a: 0 },
      selectedBg: selectedDot,
      selectedHoveredBg: selectedHoveredDot,
      disabledBg: lerpColor(theme.textDisabled, theme.surfaceContent, 0.15),
    },
    labelText: {
      text: theme.textPrimary,
      selectedText: theme.textPrimary,
      disabledText: theme.textDisabled,
    },
  }
}

// ---- Segmented Control ----

export interface SegmentedControlStyleTokens {
  containerBg: Color
  containerBorder: Color
  segmentBg: InteractionBgTokens
  segmentText: InteractionTextTokens
  separator: Color
  focusedBorder: Color
  fontSize: number
  fontFamily: string
  height: number
  paddingX: number
  borderRadius: number
  borderWidth: number
}

function computeSegmentedControlStyle(theme: ResolvedTheme): SegmentedControlStyleTokens {
  const selectedBg = theme.accentPrimary
  const selectedHoveredBg = compositeColor(theme.stateHoverOverlay, selectedBg)
  const selectedPressedBg = compositeColor(theme.statePressedOverlay, selectedBg)
  return {
    containerBg: theme.surfaceControl,
    containerBorder: theme.borderControl,
    segmentBg: {
      normalBg: rgba(0, 0, 0, 0),
      hoveredBg: theme.stateHoverOverlay,
      pressedBg: theme.statePressedOverlay,
      selectedBg,
      selectedHoveredBg,
      selectedPressedBg,
      disabledBg: rgba(0, 0, 0, 0),
    },
    segmentText: {
      text: theme.textSecondary,
      hoveredText: theme.textPrimary,
      pressedText: theme.textPrimary,
      selectedText: theme.textOnAccent,
      selectedHoveredText: resolveContrastText(theme, selectedHoveredBg),
      selectedPressedText: resolveContrastText(theme, selectedPressedBg),
      disabledText: theme.textDisabled,
    },
    separator: theme.borderSubtle,
    focusedBorder: theme.focusBorder,
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    height: theme.controlHeight,
    paddingX: Math.max(10, theme.framePadding + 5),
    borderRadius: theme.frameRounding,
    borderWidth: theme.frameBorderSize,
  }
}

// ---- Modal ----

export interface ModalStyleTokens {
  overlayBg: Color
  panelBg: Color
  panelBorder: Color
  shadowColor: Color
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  titleBg: Color
  titleText: Color
  separator: Color
  text: Color
  fontSize: number
  fontFamily: string
  borderRadius: number
  padding: number
  titleHeight: number
  buttonHeight: number
  buttonSpacing: number
  buttonMinWidth: number
  buttonRadius: number
  secondaryButtonBg: InteractionBgTokens
  secondaryButtonBorder: InteractionBgTokens
  primaryButtonBg: InteractionBgTokens
  dangerButtonBg: InteractionBgTokens
  secondaryButtonText: InteractionTextTokens
  primaryButtonText: InteractionTextTokens
  dangerButtonText: InteractionTextTokens
}

function computeModalStyle(theme: ResolvedTheme): ModalStyleTokens {
  const elevation = resolveThemeElevation(theme)
  const secondaryBase = theme.surfaceControl
  const primaryBase = theme.accentPrimary
  const dangerBase = theme.accentDanger
  const secondaryHover = lerpColor(theme.surfaceControlHover, theme.selectionMuted, 0.45)
  const secondaryPressed = lerpColor(theme.surfaceControlActive, theme.selectionBg, 0.3)
  const titleBg = theme.surfaceWindowTitleActive
  return {
    overlayBg: elevation.modalScrim,
    panelBg: theme.surfacePopup,
    panelBorder: theme.borderPanel,
    shadowColor: elevation.windowShadowColor,
    shadowBlur: elevation.windowShadowBlur,
    shadowOffsetX: elevation.windowShadowOffsetX,
    shadowOffsetY: elevation.windowShadowOffsetY,
    titleBg,
    titleText: resolveContrastText(theme, titleBg),
    separator: theme.borderSubtle,
    text: theme.textPrimary,
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    borderRadius: theme.windowRounding,
    padding: theme.windowPadding,
    titleHeight: theme.panelHeaderHeight,
    buttonHeight: theme.controlHeight,
    buttonSpacing: theme.itemSpacing,
    buttonMinWidth: Math.max(theme.controlHeight * 2.6, theme.fontSize * 5),
    buttonRadius: theme.frameRounding,
    secondaryButtonBg: {
      normalBg: secondaryBase,
      hoveredBg: secondaryHover,
      pressedBg: secondaryPressed,
      disabledBg: disabledSurface(theme, secondaryBase),
    },
    secondaryButtonBorder: {
      normalBg: theme.borderControl,
      hoveredBg: theme.borderControlHover,
      pressedBg: theme.borderControlHover,
      disabledBg: lerpColor(theme.borderControl, theme.surfaceContent, 0.45),
    },
    primaryButtonBg: {
      normalBg: primaryBase,
      hoveredBg: theme.accentPrimaryHover,
      pressedBg: theme.accentPrimaryActive,
      disabledBg: disabledSurface(theme, primaryBase),
    },
    dangerButtonBg: {
      normalBg: dangerBase,
      hoveredBg: theme.accentDangerHover,
      pressedBg: theme.accentDangerActive,
      disabledBg: disabledSurface(theme, dangerBase),
    },
    secondaryButtonText: {
      text: theme.textPrimary,
      hoveredText: theme.textPrimary,
      pressedText: theme.textPrimary,
      disabledText: theme.textDisabled,
    },
    primaryButtonText: {
      text: theme.textOnAccent,
      hoveredText: theme.textOnAccent,
      pressedText: theme.textOnAccent,
      disabledText: resolveContrastText(theme, disabledSurface(theme, primaryBase)),
    },
    dangerButtonText: {
      text: theme.textOnDanger,
      hoveredText: theme.textOnDanger,
      pressedText: theme.textOnDanger,
      disabledText: resolveContrastText(theme, disabledSurface(theme, dangerBase), theme.textOnDanger),
    },
  }
}

export interface DrawerStyleTokens {
  overlayBg: Color
  panelBg: Color
  panelBorder: Color
  titleBg: Color
  separator: Color
  titleText: Color
  closeText: Color
  fontSize: number
  fontFamily: string
  borderRadius: number
  padding: number
  titleHeight: number
  closeButtonSize: number
  shadowColor: Color
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
}

function computeDrawerStyle(theme: ResolvedTheme): DrawerStyleTokens {
  const elevation = resolveThemeElevation(theme)
  return {
    overlayBg: elevation.drawerScrim,
    panelBg: theme.surfacePopup,
    panelBorder: theme.borderPanel,
    titleBg: theme.surfaceWindowTitle,
    separator: theme.borderSubtle,
    titleText: theme.textPrimary,
    closeText: theme.textSecondary,
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    borderRadius: theme.windowRounding,
    padding: theme.windowPadding + 2,
    titleHeight: theme.panelHeaderHeight,
    closeButtonSize: Math.max(16, theme.fontSize + 2),
    shadowColor: elevation.windowShadowColor,
    shadowBlur: elevation.windowShadowBlur,
    shadowOffsetX: elevation.windowShadowOffsetX,
    shadowOffsetY: elevation.windowShadowOffsetY,
  }
}

// ---- Table Row ----

export interface TableRowStyleTokens {
  normalBg: Color
  hoveredBg: Color
  selectedBg: Color
  focusedBorder: Color
  headerBgState: InteractionBgTokens
  headerTextState: InteractionTextTokens
  headerArrowText: InteractionTextTokens
  rowBgState: InteractionBgTokens
  rowTextState: InteractionTextTokens
  rowBorderState: InteractionBgTokens
  headerBg: Color
  headerHoveredBg: Color
  headerText: Color
  activeArrowColor: Color
  inactiveArrowColor: Color
  rowHeight: number
  headerHeight: number
  cellPaddingH: number
  cellPaddingV: number
  text: Color
  textDisabled: Color
  fontSize: number
  fontFamily: string
  separator: Color
  rowSeparatorColor: Color
  cellSeparatorColor: Color
  stripeBg: Color
  windowBorder: Color
  frameBorderSize: number
  frameRounding: number
  scrollbarWidth: number
}

function computeTableRowStyle(theme: ResolvedTheme): TableRowStyleTokens {
  const selectedRowBg = selectionSurface(theme)
  const selectedRowText = resolveSelectionText(theme, selectedRowBg)
  const headerBg = theme.surfaceDataHeader
  return {
    normalBg: theme.surfaceDataBody,
    hoveredBg: theme.stateHoverOverlay,
    selectedBg: selectedRowBg,
    focusedBorder: theme.focusBorder,
    headerBgState: {
      normalBg: headerBg,
      hoveredBg: dataHeaderHoverSurface(theme),
      selectedBg: dataHeaderSelectedSurface(theme),
      selectedHoveredBg: compositeColor(theme.stateHoverOverlay, dataHeaderSelectedSurface(theme)),
    },
    headerTextState: {
      text: theme.textPrimary,
      selectedText: theme.textPrimary,
    },
    headerArrowText: {
      text: theme.textDisabled,
      selectedText: theme.textAccent,
    },
    rowBgState: {
      normalBg: rgba(0, 0, 0, 0),
      hoveredBg: theme.stateHoverOverlay,
      selectedBg: selectedRowBg,
      selectedHoveredBg: compositeColor(theme.stateHoverOverlay, selectedRowBg),
      selectedPressedBg: compositeColor(theme.statePressedOverlay, selectedRowBg),
    },
    rowTextState: {
      text: theme.textPrimary,
      selectedText: selectedRowText,
      disabledText: theme.textDisabled,
    },
    rowBorderState: {
      normalBg: rgba(0, 0, 0, 0),
      focusedBg: theme.focusBorder,
    },
    headerBg: headerBg,
    headerHoveredBg: dataHeaderHoverSurface(theme),
    headerText: theme.textPrimary,
    activeArrowColor: theme.textAccent,
    inactiveArrowColor: theme.textDisabled,
    rowHeight: theme.dataRowHeight,
    headerHeight: theme.dataHeaderHeight,
    cellPaddingH: theme.framePadding,
    cellPaddingV: theme.framePadding,
    text: theme.textPrimary,
    textDisabled: theme.textDisabled,
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    separator: theme.borderDataStrong,
    rowSeparatorColor: theme.borderData,
    cellSeparatorColor: theme.borderData,
    stripeBg: lerpColor(theme.surfaceDataBody, theme.surfaceCanvas, 0.24),
    windowBorder: theme.borderWindow,
    frameBorderSize: theme.frameBorderSize,
    frameRounding: theme.frameRounding,
    scrollbarWidth: theme.scrollbarSize,
  }
}

// ---- Grid Cell ----

export interface GridHeaderActionStyleTokens {
  slotSize: number
  iconSize: number
  gap: number
  badgeHeight: number
  badgePaddingH: number
}

export interface NumberStepperStyleTokens {
  width: number
  background: InteractionBgTokens
  border: Color
  arrowText: InteractionTextTokens
}

export type GridNumberStepperStyleTokens = NumberStepperStyleTokens

export type NumberStepperStyleVariant = 'control' | 'grid'

function computeNumberStepperStyle(
  theme: ResolvedTheme,
  variant: NumberStepperStyleVariant,
): NumberStepperStyleTokens {
  const hostHeight = variant === 'grid' ? theme.dataRowHeight : theme.controlHeight
  return {
    width: Math.max(16, Math.min(20, hostHeight - 4)),
    background: {
      normalBg: theme.surfaceControl,
      hoveredBg: theme.surfaceControlHover,
      pressedBg: theme.surfaceControlActive,
      disabledBg: disabledSurface(theme),
    },
    border: theme.borderControl,
    arrowText: {
      text: theme.textSecondary,
      hoveredText: theme.textPrimary,
      pressedText: theme.textAccent,
      disabledText: theme.textDisabled,
    },
  }
}

export interface GridCellStyleTokens {
  windowBg: Color
  windowBorder: Color
  disabledOverlay: Color
  frameRounding: number
  scrollbarWidth: number

  headerBgState: InteractionBgTokens
  headerTextState: InteractionTextTokens
  headerArrowText: InteractionTextTokens
  headerAction: GridHeaderActionStyleTokens

  headerBg: Color
  headerText: Color
  sortActiveArrow: Color
  sortInactiveArrow: Color
  separator: Color
  resizeActiveColor: Color
  resizeGlow: Color

  rowBgState: InteractionBgTokens
  rowBorderState: InteractionBgTokens
  groupRowBgState: InteractionBgTokens
  groupRowTextState: InteractionTextTokens
  groupRowBorderState: InteractionBgTokens
  selectedBg: Color
  hoveredRowBg: Color
  stripeBg: Color
  focusedRowBorder: Color
  cellErrorBorder: Color
  rowSeparator: Color
  groupBadgeBg: Color
  groupBadgeText: Color

  cellTextState: InteractionTextTokens
  text: Color
  textDisabled: Color
  fontSize: number
  fontFamily: string
  paddingH: number
  rowHeight: number
  headerHeight: number

  editBgState: InteractionBgTokens
  editBorderState: InteractionBgTokens
  editBg: Color
  editBorder: Color
  selectionBg: Color
  numberStepper?: GridNumberStepperStyleTokens

  checkboxBg: Color
  checkboxBorder: Color
  checkMark: Color

  dropdownArrowText: InteractionTextTokens
  dropdownArrowColor: Color
  groupArrowText: InteractionTextTokens
}

export type ResolvedGridCellStyleTokens = GridCellStyleTokens & {
  numberStepper: GridNumberStepperStyleTokens
}

function computeGridCellStyle(theme: ResolvedTheme): ResolvedGridCellStyleTokens {
  const selectedRowBg = selectionSurface(theme)
  const selectedRowText = resolveSelectionText(theme, selectedRowBg)
  const headerBg = theme.surfaceDataHeader
  const gridSeparator = theme.borderData
  const headerActionSize = Math.max(18, Math.ceil(theme.fontSize + 5))
  return {
    windowBg: theme.surfaceDataBody,
    windowBorder: theme.borderWindow,
    disabledOverlay: { ...theme.surfaceDataBody, a: 0.42 },
    frameRounding: theme.frameRounding,
    scrollbarWidth: theme.scrollbarSize,

    headerBgState: {
      normalBg: headerBg,
      hoveredBg: dataHeaderHoverSurface(theme),
      selectedBg: dataHeaderSelectedSurface(theme),
      selectedHoveredBg: compositeColor(theme.stateHoverOverlay, dataHeaderSelectedSurface(theme)),
    },
    headerTextState: {
      text: theme.textPrimary,
      selectedText: theme.textPrimary,
    },
    headerArrowText: {
      text: theme.textDisabled,
      selectedText: theme.textAccent,
    },
    headerAction: {
      slotSize: headerActionSize,
      iconSize: Math.max(11, Math.min(14, theme.fontSize)),
      gap: Math.max(2, Math.min(4, theme.framePadding / 2)),
      badgeHeight: Math.max(14, Math.min(headerActionSize, theme.fontSize + 2)),
      badgePaddingH: Math.max(4, Math.min(6, theme.framePadding / 2)),
    },

    headerBg: headerBg,
    headerText: theme.textPrimary,
    sortActiveArrow: theme.textAccent,
    sortInactiveArrow: theme.textDisabled,
    separator: gridSeparator,
    resizeActiveColor: theme.focusBorder,
    resizeGlow: { ...theme.focusBorder, a: Math.min(theme.focusBorder.a, 0.14) },

    rowBgState: {
      normalBg: rgba(0, 0, 0, 0),
      hoveredBg: theme.stateHoverOverlay,
      selectedBg: selectedRowBg,
      selectedHoveredBg: compositeColor(theme.stateHoverOverlay, selectedRowBg),
      selectedPressedBg: compositeColor(theme.statePressedOverlay, selectedRowBg),
    },
    rowBorderState: {
      normalBg: rgba(0, 0, 0, 0),
      focusedBg: theme.focusBorder,
    },
    groupRowBgState: {
      normalBg: lerpColor(theme.surfaceDataBody, theme.surfacePanel, 0.5),
      hoveredBg: lerpColor(theme.surfacePanel, theme.selectionMuted, 0.2),
      selectedBg: lerpColor(theme.surfacePanel, selectedRowBg, 0.18),
      focusedBg: lerpColor(theme.surfacePanel, selectedRowBg, 0.24),
    },
    groupRowTextState: {
      text: theme.textPrimary,
      hoveredText: theme.textPrimary,
      selectedText: theme.textPrimary,
      focusedText: theme.textPrimary,
    },
    groupRowBorderState: {
      normalBg: rgba(0, 0, 0, 0),
      focusedBg: theme.focusBorder,
    },
    selectedBg: selectedRowBg,
    hoveredRowBg: theme.stateHoverOverlay,
    stripeBg: lerpColor(theme.surfaceDataBody, theme.surfaceCanvas, 0.22),
    focusedRowBorder: theme.focusBorder,
    cellErrorBorder: theme.accentDanger,
    rowSeparator: theme.borderData,
    groupBadgeBg: theme.accentPrimary,
    groupBadgeText: theme.textOnAccent,

    cellTextState: {
      text: theme.textPrimary,
      selectedText: selectedRowText,
      disabledText: theme.textDisabled,
    },
    text: theme.textPrimary,
    textDisabled: theme.textDisabled,
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    paddingH: theme.framePadding,
    rowHeight: theme.dataRowHeight,
    headerHeight: theme.dataHeaderHeight,

    editBgState: {
      normalBg: theme.fieldBg,
      focusedBg: theme.fieldBg,
    },
    editBorderState: {
      normalBg: theme.fieldFocusBorder,
      focusedBg: theme.fieldFocusBorder,
    },
    editBg: theme.fieldBg,
    editBorder: theme.fieldFocusBorder,
    selectionBg: theme.fieldSelectionBg,
    numberStepper: computeNumberStepperStyle(theme, 'grid'),

    checkboxBg: theme.surfaceControl,
    checkboxBorder: theme.borderControl,
    checkMark: theme.accentPrimary,

    dropdownArrowText: {
      text: theme.textAccent,
      selectedText: theme.textAccent,
    },
    dropdownArrowColor: theme.textAccent,
    groupArrowText: {
      text: theme.textDisabled,
      hoveredText: theme.textPrimary,
      selectedText: theme.textPrimary,
      focusedText: theme.textPrimary,
    },
  }
}

// ---- Tree ----

export interface TreeStyleTokens {
  panelBg: Color
  panelBorder: Color
  rowBg: InteractionBgTokens
  rowBorder: InteractionBgTokens
  labelText: InteractionTextTokens
  labelTokenText: Record<TreeLabelTokenKind, Color>
  iconText: InteractionTextTokens
  arrowText: InteractionTextTokens
  levelLine: Color
  borderRadius: number
  fontSize: number
  paddingH: number
  fontFamily: string
}

export type TreeLabelTokenKind =
  | 'text'
  | 'name'
  | 'punctuation'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'undefined'
  | 'function'
  | 'type'
  | 'meta'
  | 'error'

function computeTreeStyle(theme: ResolvedTheme): TreeStyleTokens {
  const syntax = resolveThemeSyntax(theme)
  const selectedRowBg = theme.selectionStrong
  const selectedRowText = resolveSelectionText(theme, selectedRowBg)
  const levelLine = blendColor(theme.textSecondary, theme.surfaceDataBody, 0.35)
  const hoveredRowBg = stateHoverSurface(theme, theme.surfaceDataBody)
  return {
    panelBg: theme.surfaceDataBody,
    panelBorder: theme.borderPanel,
    rowBg: {
      normalBg: rgba(0, 0, 0, 0),
      hoveredBg: hoveredRowBg,
      selectedBg: selectedRowBg,
      selectedHoveredBg: compositeColor(theme.stateHoverOverlay, selectedRowBg),
      selectedPressedBg: compositeColor(theme.statePressedOverlay, selectedRowBg),
    },
    rowBorder: {
      normalBg: rgba(0, 0, 0, 0),
      focusedBg: theme.focusBorder,
    },
    labelText: {
      text: theme.textPrimary,
      hoveredText: theme.textPrimary,
      selectedText: selectedRowText,
    },
    labelTokenText: {
      text: theme.textPrimary,
      name: theme.textAccent,
      punctuation: theme.textSecondary,
      string: syntax.string,
      number: syntax.number,
      boolean: syntax.boolean,
      null: theme.textSecondary,
      undefined: theme.textSecondary,
      function: syntax.function,
      type: syntax.type,
      meta: syntax.meta,
      error: theme.accentDanger,
    },
    iconText: {
      text: theme.textPrimary,
      hoveredText: theme.textPrimary,
      selectedText: selectedRowText,
    },
    arrowText: {
      text: theme.textDisabled,
      hoveredText: theme.textPrimary,
      selectedText: selectedRowText,
    },
    levelLine: { ...levelLine, a: 0.72 },
    borderRadius: theme.frameRounding,
    fontSize: theme.fontSize,
    paddingH: theme.framePadding,
    fontFamily: theme.fontFamily,
  }
}

// ---- Window Chrome ----

export interface WindowChromeStyleTokens {
  windowBg: Color
  borderColor: Color
  borderWidth: number
  borderRadius: number
  separator: Color
  titleText: InteractionTextTokens
  fontSize: number
  fontFamily: string
  titleHeight: number
  contentPadding: number
  itemSpacing: number
  shadowColor: Color
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  attentionFill: Color
  attentionTitleFill: Color
  attentionBorder: Color
  titleBg: InteractionBgTokens
  controlText: InteractionTextTokens
  gripText: InteractionTextTokens
}

function computeWindowChromeStyle(theme: ResolvedTheme): WindowChromeStyleTokens {
  const elevation = resolveThemeElevation(theme)
  const focusedTitleText = resolveContrastText(theme, theme.surfaceWindowTitleActive)
  const focusedControlText = resolveContrastText(theme, theme.surfaceWindowTitleActive, theme.textSecondary)
  return {
    windowBg: theme.surfaceContent,
    borderColor: theme.borderWindow,
    borderWidth: theme.windowBorderSize,
    borderRadius: theme.windowRounding,
    separator: theme.borderSubtle,
    titleText: {
      text: theme.textPrimary,
      focusedText: focusedTitleText,
    },
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    titleHeight: theme.panelHeaderHeight,
    contentPadding: theme.contentPadding,
    itemSpacing: theme.itemSpacing,
    shadowColor: elevation.windowShadowColor,
    shadowBlur: elevation.windowShadowBlur,
    shadowOffsetX: elevation.windowShadowOffsetX,
    shadowOffsetY: elevation.windowShadowOffsetY,
    attentionFill: {
      ...theme.accentWarning,
      a: theme.contrastMode === 'high' ? 0.24 : 0.16,
    },
    attentionTitleFill: {
      ...theme.accentWarning,
      a: theme.contrastMode === 'high' ? 0.32 : 0.24,
    },
    attentionBorder: {
      ...theme.statusWarningBorder,
      a: theme.contrastMode === 'high' ? 1 : 0.65,
    },
    titleBg: {
      normalBg: theme.surfaceWindowTitle,
      focusedBg: theme.surfaceWindowTitleActive,
    },
    controlText: {
      text: { ...theme.textSecondary, a: 0.7 },
      focusedText: focusedControlText,
    },
    gripText: {
      text: { ...theme.textSecondary, a: 0.4 },
      hoveredText: { ...theme.textSecondary, a: 0.4 },
      pressedText: { ...theme.textSecondary, a: 0.4 },
    },
  }
}

// ---- Splitter ----

export interface SplitterStyleTokens {
  barBg: InteractionBgTokens
  gripText: InteractionTextTokens
}

function computeSplitterStyle(theme: ResolvedTheme): SplitterStyleTokens {
  return {
    barBg: {
      normalBg: theme.borderData,
      hoveredBg: theme.scrollbarGrabHovered,
      pressedBg: theme.focusBorder,
      disabledBg: lerpColor(theme.borderSubtle, theme.surfaceContent, 0.45),
    },
    gripText: {
      text: theme.textDisabled,
      hoveredText: theme.textDisabled,
      pressedText: theme.textDisabled,
      disabledText: { ...theme.textDisabled, a: 0.8 },
    },
  }
}

// ---- Notification ----

export interface NotificationStyleTokens {
  accents: {
    info: Color
    success: Color
    warning: Color
    error: Color
  }
  cardWidth: number
  minCardHeight: number
  maxCardHeight: number
  cardHeight: number
  cardSpacing: number
  margin: number
  accentWidth: number
  bgColor: Color
  borderColor: Color
  borderWidth: number
  borderRadius: number
  shadowColor: Color
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  titleText: Color
  messageText: Color
  fontSize: number
  messageFontSize: number
  iconFontSize: number
  fontFamily: string
  padding: number
  titleMessageGap: number
}

function computeNotificationStyle(theme: ResolvedTheme): NotificationStyleTokens {
  const popup = derivePopupStyle(theme)
  const typography = resolveThemeTypography(theme)
  const minCardHeight = popup.padding * 2 + theme.controlHeight
  const titleMessageGap = Math.max(3, Math.round(theme.framePadding / 2))
  const maxCardHeight = Math.max(
    minCardHeight,
    Math.ceil(
      popup.padding * 2 +
      popup.fontSize +
      titleMessageGap +
      typography.secondaryFontSize * 1.25 * 2,
    ),
  )
  return {
    accents: {
      info: theme.accentPrimary,
      success: theme.accentSuccess,
      warning: theme.accentWarning,
      error: theme.accentDanger,
    },
    cardWidth: Math.max(theme.controlHeight * 10, typography.bodyFontSize * 20),
    minCardHeight,
    maxCardHeight,
    cardHeight: maxCardHeight,
    cardSpacing: theme.itemSpacing,
    margin: theme.windowPadding * 2,
    accentWidth: Math.max(3, theme.frameBorderSize + 3),
    bgColor: { ...popup.bgColor, a: Math.min(popup.bgColor.a, 0.97) },
    borderColor: popup.borderColor,
    borderWidth: 1,
    borderRadius: popup.borderRadius,
    shadowColor: popup.shadowColor,
    shadowBlur: popup.shadowBlur,
    shadowOffsetX: popup.shadowOffsetX,
    shadowOffsetY: popup.shadowOffsetY,
    titleText: popup.text,
    messageText: theme.textSecondary,
    fontSize: popup.fontSize,
    messageFontSize: typography.secondaryFontSize,
    iconFontSize: popup.fontSize * 1.1,
    fontFamily: popup.fontFamily,
    padding: popup.padding,
    titleMessageGap,
  }
}

// ---- Popup Panel ----

export interface PopupStyleTokens {
  shadowColor: Color
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  borderColor: Color
  borderRadius: number
  bgColor: Color
  padding: number
  fontSize: number
  fontFamily: string
  text: Color
  textDisabled: Color
  danger: Color
}

function computePopupStyle(theme: ResolvedTheme): PopupStyleTokens {
  const bgColor = popupSurface(theme)
  const elevation = resolveThemeElevation(theme)
  return {
    shadowColor: elevation.popupShadowColor,
    shadowBlur: elevation.popupShadowBlur,
    shadowOffsetX: elevation.popupShadowOffsetX,
    shadowOffsetY: elevation.popupShadowOffsetY,
    borderColor: theme.borderPanel,
    borderRadius: theme.frameRounding,
    bgColor,
    padding: theme.framePadding + 1,
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    text: theme.textPrimary,
    textDisabled: theme.textDisabled,
    danger: theme.accentDanger,
  }
}

export interface GridFilterPopupStyleTokens {
  minWidth: number
  preferredWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number
  conditionHeight: number
  maxVisibleValueRows: number
  viewportMargin: number
  anchorGap: number
  padding: number
  sectionGap: number
  tabGap: number
  scrollbarGap: number
  titleHeight: number
  tabHeight: number
  inputHeight: number
  summaryHeight: number
  rowHeight: number
  footerHeight: number
  checkboxSize: number
  clearActionWidth: number
  clearActionHeight: number
  buttonWidth: number
  buttonHeight: number
  countWidth: number
  fontSize: number
  fontFamily: string
  secondaryFontSize: number
  controlTextPadding: number
  rowRadius: number
  borderWidth: number
  checkmarkStrokeWidth: number
  tabBg: InteractionBgTokens
  tabText: InteractionTextTokens
  tabFocusBorder: Color
  tabIndicator: Color
  tabIndicatorHeight: number
  footerBg: Color
  footerBorder: Color
  actionText: InteractionTextTokens
}

function computeGridFilterPopupStyle(theme: ResolvedTheme): GridFilterPopupStyleTokens {
  const typography = resolveThemeTypography(theme)
  const padding = theme.framePadding + 1
  const sectionGap = theme.itemSpacing
  const titleHeight = theme.controlHeight
  const tabHeight = theme.controlHeight
  const inputHeight = theme.controlHeight
  const summaryHeight = theme.fontSize
  const rowHeight = Math.max(theme.controlHeight, theme.dataRowHeight)
  const footerHeight = theme.controlHeight + theme.itemSpacing * 2
  const minWidth = Math.max(300, theme.controlHeight * 9.5, theme.fontSize * 18)
  const preferredWidth = Math.max(theme.controlHeight * 11, theme.fontSize * 22)
  const maxWidth = Math.max(theme.controlHeight * 13, theme.fontSize * 28)
  const maxVisibleValueRows = 6
  const valuesContentY = padding + titleHeight + sectionGap + tabHeight + sectionGap +
    inputHeight + sectionGap + summaryHeight + sectionGap
  const conditionHeight = padding + titleHeight + sectionGap + tabHeight + sectionGap +
    inputHeight + sectionGap + inputHeight + sectionGap + footerHeight
  const checkboxSize = Math.min(deriveCheckboxStyle(theme).boxSize, rowHeight - theme.itemSpacing)
  const popupBg = popupSurface(theme)
  const tabNormalBg = lerpColor(popupBg, theme.surfaceControl, 0.38)
  const selectedTabBg = lerpColor(popupBg, theme.selectionMuted, 0.72)
  const selectedHoveredTabBg = compositeColor(theme.stateHoverOverlay, selectedTabBg)
  const selectedText = resolveSelectionText(theme, selectedTabBg)
  const selectedHoveredText = resolveSelectionText(theme, selectedHoveredTabBg)
  return {
    minWidth,
    preferredWidth,
    maxWidth,
    minHeight: conditionHeight,
    maxHeight: valuesContentY + rowHeight * maxVisibleValueRows + sectionGap + footerHeight,
    conditionHeight,
    maxVisibleValueRows,
    viewportMargin: Math.max(4, theme.itemSpacing),
    anchorGap: Math.max(2, Math.floor(theme.itemSpacing / 2)),
    padding,
    sectionGap,
    tabGap: Math.max(1, theme.frameBorderSize),
    scrollbarGap: Math.max(2, Math.floor(theme.itemSpacing / 2)),
    titleHeight,
    tabHeight,
    inputHeight,
    summaryHeight,
    rowHeight,
    footerHeight,
    checkboxSize,
    clearActionWidth: Math.max(theme.controlHeight * 2.75, theme.fontSize * 5.5),
    clearActionHeight: theme.controlHeight,
    buttonWidth: Math.max(theme.controlHeight * 2.4, theme.fontSize * 4.5),
    buttonHeight: theme.controlHeight,
    countWidth: theme.fontSize * 3.25,
    fontSize: typography.bodyFontSize,
    fontFamily: theme.fontFamily,
    secondaryFontSize: theme.fontSize * 0.9,
    controlTextPadding: padding,
    rowRadius: Math.max(0, theme.frameRounding - 1),
    borderWidth: 1,
    checkmarkStrokeWidth: Math.max(1, checkboxSize * 0.12),
    tabBg: {
      normalBg: tabNormalBg,
      hoveredBg: popupHoverSurface(theme),
      pressedBg: theme.statePressedOverlay,
      focusedBg: popupHoverSurface(theme),
      selectedBg: selectedTabBg,
      selectedHoveredBg: selectedHoveredTabBg,
      selectedFocusedBg: selectedTabBg,
    },
    tabText: {
      text: theme.textSecondary,
      hoveredText: theme.textPrimary,
      pressedText: theme.textPrimary,
      focusedText: theme.textPrimary,
      selectedText,
      selectedHoveredText,
      selectedFocusedText: selectedText,
      disabledText: theme.textDisabled,
    },
    tabFocusBorder: theme.focusBorder,
    tabIndicator: theme.accentPrimary,
    tabIndicatorHeight: Math.max(2, theme.frameBorderSize * 2),
    footerBg: lerpColor(popupBg, theme.surfacePanel, 0.32),
    footerBorder: theme.borderSubtle,
    actionText: {
      text: theme.textSecondary,
      hoveredText: theme.textAccent,
      focusedText: theme.textAccent,
      disabledText: theme.textDisabled,
    },
  }
}

// ---- Resolve helpers ----

export function resolveBgColor(
  style: InteractionBgTokens,
  state: InteractionStateInput,
): Color {
  if (typeof state !== 'string') {
    if (state.disabled) return style.disabledBg ?? style.normalBg
    if (state.selected && state.pressed) {
      return style.selectedPressedBg ??
        style.selectedBg ??
        style.pressedBg ??
        style.hoveredBg ??
        style.normalBg
    }
    if (state.selected && state.hovered) {
      return style.selectedHoveredBg ??
        style.selectedBg ??
        style.hoveredBg ??
        style.normalBg
    }
    if (state.selected && state.focused) {
      return style.selectedFocusedBg ??
        style.selectedBg ??
        style.focusedBg ??
        style.normalBg
    }
    if (state.pressed) return style.pressedBg ?? style.hoveredBg ?? style.normalBg
    if (state.hovered) return style.hoveredBg ?? style.normalBg
    if (state.focused) return style.focusedBg ?? style.normalBg
    if (state.selected) return style.selectedBg ?? style.normalBg
    return style.normalBg
  }
  switch (state) {
    case 'pressed': return style.pressedBg ?? style.selectedBg ?? style.hoveredBg ?? style.normalBg
    case 'hovered': return style.hoveredBg ?? style.normalBg
    case 'disabled': return style.disabledBg ?? style.normalBg
    case 'focused': return style.focusedBg ?? style.selectedBg ?? style.hoveredBg ?? style.normalBg
    case 'selected': return style.selectedBg ?? style.pressedBg ?? style.hoveredBg ?? style.normalBg
    default: return style.normalBg
  }
}

export function resolveTextColor(
  style: InteractionTextTokens,
  state: InteractionStateInput,
): Color {
  if (typeof state !== 'string') {
    if (state.disabled) return style.disabledText ?? style.text
    if (state.selected && state.pressed) {
      return style.selectedPressedText ??
        style.selectedText ??
        style.pressedText ??
        style.hoveredText ??
        style.text
    }
    if (state.selected && state.hovered) {
      return style.selectedHoveredText ??
        style.selectedText ??
        style.hoveredText ??
        style.text
    }
    if (state.selected && state.focused) {
      return style.selectedFocusedText ??
        style.selectedText ??
        style.focusedText ??
        style.text
    }
    if (state.pressed) return style.pressedText ?? style.hoveredText ?? style.text
    if (state.hovered) return style.hoveredText ?? style.text
    if (state.focused) return style.focusedText ?? style.text
    if (state.selected) return style.selectedText ?? style.text
    return style.text
  }
  switch (state) {
    case 'pressed': return style.pressedText ?? style.selectedText ?? style.hoveredText ?? style.text
    case 'hovered': return style.hoveredText ?? style.text
    case 'disabled': return style.disabledText ?? style.text
    case 'focused': return style.focusedText ?? style.selectedText ?? style.hoveredText ?? style.text
    case 'selected': return style.selectedText ?? style.hoveredText ?? style.text
    default: return style.text
  }
}

export function interpolateBgColor(
  style: InteractionBgTokens,
  fromState: InteractionState,
  toState: InteractionState,
  t: number,
): Color {
  return lerpColor(resolveBgColor(style, fromState), resolveBgColor(style, toState), t)
}

export function blendColor(from: Color, to: Color, t: number): Color {
  return lerpColor(from, to, t)
}

// ---- Layout ----

export interface LayoutStyleTokens {
  itemSpacing: number
  framePadding: number
}

function computeLayoutStyle(theme: ResolvedTheme): LayoutStyleTokens {
  return {
    itemSpacing: theme.itemSpacing,
    framePadding: theme.framePadding,
  }
}

export interface DividerStyleTokens {
  color: Color
  thickness: number
  inset: number
}

function computeDividerStyle(theme: ResolvedTheme): DividerStyleTokens {
  return {
    color: theme.borderSubtle,
    thickness: 1,
    inset: Math.max(4, Math.round(theme.framePadding * 0.75)),
  }
}

export interface ToolbarStyleTokens {
  backgroundColor: Color
  borderColor: Color
  borderRadius: number
  borderWidth: number
  padding: number
  itemSpacing: number
  sectionGap: number
  minHeight: number
  fontSize: number
  fontFamily: string
  itemHeight: number
  itemMinWidth: number
  itemIconOnlyWidth: number
  itemPaddingX: number
  itemRadius: number
  iconSize: number
  iconGap: number
  dropdownGap: number
  separatorWidth: number
  separatorInset: number
  separatorColor: Color
  hoveredBorder: Color
  pressedBorder: Color
  selectedBorder: Color
  focusedBorder: Color
  itemBg: InteractionBgTokens
  itemText: InteractionTextTokens
  overflowLabel: string
}

function computeToolbarStyle(theme: ResolvedTheme): ToolbarStyleTokens {
  const backgroundColor = lerpColor(theme.surfaceNav, theme.surfacePanel, 0.2)
  const selectedItemBg = theme.selectionMuted
  return {
    backgroundColor,
    borderColor: theme.borderSubtle,
    borderRadius: theme.frameRounding,
    borderWidth: 1,
    padding: Math.max(2, Math.round(theme.framePadding * 0.5)),
    itemSpacing: Math.max(1, Math.round(theme.itemSpacing * 0.3)),
    sectionGap: Math.max(4, Math.round(theme.itemSpacing * 0.6)),
    minHeight: theme.toolbarHeight,
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    itemHeight: Math.max(24, theme.controlHeight - 4),
    itemMinWidth: 28,
    itemIconOnlyWidth: Math.max(24, theme.controlHeight - 6),
    itemPaddingX: Math.max(3, Math.round(theme.framePadding * 0.5)),
    itemRadius: Math.max(2, theme.frameRounding - 1),
    iconSize: Math.max(12, theme.fontSize - 1),
    iconGap: Math.max(3, Math.round(theme.itemSpacing * 0.45)),
    dropdownGap: Math.max(3, Math.round(theme.framePadding * 0.5)),
    separatorWidth: Math.max(5, Math.round(theme.framePadding * 0.9)),
    separatorInset: Math.max(4, Math.round(theme.framePadding * 0.75)),
    separatorColor: theme.borderSubtle,
    hoveredBorder: theme.borderControlHover,
    pressedBorder: lerpColor(theme.borderControlHover, theme.accentPrimary, 0.35),
    selectedBorder: theme.borderControlHover,
    focusedBorder: theme.focusBorder,
    itemBg: {
      normalBg: rgba(0, 0, 0, 0),
      hoveredBg: navHoverSurface(theme),
      pressedBg: lerpColor(navHoverSurface(theme), theme.selectionMuted, 0.48),
      selectedBg: selectedItemBg,
      selectedHoveredBg: compositeColor(theme.stateHoverOverlay, selectedItemBg),
      selectedPressedBg: compositeColor(theme.statePressedOverlay, selectedItemBg),
      disabledBg: rgba(0, 0, 0, 0),
    },
    itemText: {
      text: theme.textPrimary,
      hoveredText: theme.textAccent,
      pressedText: theme.textPrimary,
      selectedText: theme.textAccent,
      selectedHoveredText: theme.textAccent,
      selectedPressedText: theme.textPrimary,
      disabledText: theme.textDisabled,
    },
    overflowLabel: '更多',
  }
}

export type StatusBarTextTone = 'primary' | 'secondary' | 'success' | 'warning' | 'danger'

export interface StatusBarStyleTokens {
  backgroundTop: Color
  backgroundBottom: Color
  topBorder: Color
  bottomBorder: Color
  borderWidth: number
  height: number
  paddingX: number
  paddingY: number
  itemGap: number
  sectionGap: number
  fontSize: number
  fontFamily: string
  separatorColor: Color
  separatorWidth: number
  separatorInset: number
  textColors: Record<StatusBarTextTone, Color>
}

function computeStatusBarStyle(theme: ResolvedTheme): StatusBarStyleTokens {
  const stripBase = chromeStripSurface(theme)
  const backgroundBottom = perceivedLuminance(theme.surfaceNav) < 140
    ? lerpColor(stripBase, theme.surfacePanel, 0.14)
    : lerpColor(theme.surfaceNav, theme.surfacePanel, 0.18)
  const backgroundLuma = (backgroundBottom.r * 299 + backgroundBottom.g * 587 + backgroundBottom.b * 114) / 1000
  const highlightAlpha = backgroundLuma < 140 ? 0.04 : 0.12
  const backgroundTop = compositeColor(rgba(255, 255, 255, highlightAlpha), backgroundBottom)
  const fontSize = Math.max(11, theme.fontSize - 1)
  return {
    backgroundTop,
    backgroundBottom,
    topBorder: lerpColor(theme.borderSubtle, theme.borderPanel, 0.35),
    bottomBorder: rgba(255, 255, 255, backgroundLuma < 140 ? 0.02 : 0.1),
    borderWidth: 1,
    height: theme.statusBarHeight,
    paddingX: Math.max(8, theme.framePadding + 2),
    paddingY: Math.max(1, Math.round(theme.framePadding * 0.2)),
    itemGap: Math.max(6, Math.round(theme.itemSpacing * 0.85)),
    sectionGap: Math.max(12, theme.itemSpacing + theme.framePadding),
    fontSize,
    fontFamily: theme.fontFamily,
    separatorColor: lerpColor(theme.borderSubtle, theme.textDisabled, backgroundLuma < 140 ? 0.42 : 0.5),
    separatorWidth: Math.max(10, theme.framePadding * 2),
    separatorInset: Math.max(4, Math.round(theme.framePadding * 0.7)),
    textColors: {
      primary: theme.textPrimary,
      secondary: theme.textSecondary,
      success: theme.accentSuccess,
      warning: theme.accentWarning,
      danger: theme.accentDanger,
    },
  }
}

export interface ChipStyleTokens {
  fontSize: number
  fontFamily: string
  height: number
  paddingX: number
  radius: number
  closeIconSize: number
  closeGap: number
  borderWidth: number
  focusedBorder: Color
  defaultBg: InteractionBgTokens
  selectedBg: InteractionBgTokens
  borderColor: InteractionBgTokens
  textColor: InteractionTextTokens
}

function computeChipStyle(theme: ResolvedTheme): ChipStyleTokens {
  const defaultSurface = lerpColor(theme.surfaceControl, theme.surfacePanel, 0.2)
  const selectedSurface = lerpColor(theme.selectionMuted, theme.surfacePanel, 0.08)
  const selectedBg = theme.selectionBg
  const selectedHoveredBg = compositeColor(theme.stateHoverOverlay, selectedBg)
  const selectedPressedBg = compositeColor(theme.statePressedOverlay, selectedBg)
  const selectedText = resolveSelectionText(theme, selectedBg)
  const selectedHoveredText = resolveSelectionText(theme, selectedHoveredBg)
  const selectedPressedText = resolveSelectionText(theme, selectedPressedBg)
  return {
    fontSize: Math.max(11, theme.fontSize - 1),
    fontFamily: theme.fontFamily,
    height: Math.max(20, theme.controlHeight - 1),
    paddingX: Math.max(8, theme.framePadding + 2),
    radius: Math.max(10, Math.round(theme.controlHeight / 2)),
    closeIconSize: Math.max(10, (Math.max(11, theme.fontSize - 1)) * 0.78),
    closeGap: 4,
    borderWidth: 1,
    focusedBorder: theme.focusBorder,
    defaultBg: {
      normalBg: defaultSurface,
      hoveredBg: theme.surfaceControlHover,
      pressedBg: theme.surfaceControlActive,
      disabledBg: disabledSurface(theme, defaultSurface),
    },
    selectedBg: {
      normalBg: selectedSurface,
      hoveredBg: selectedHoveredBg,
      pressedBg: selectedPressedBg,
      selectedBg,
      selectedHoveredBg,
      selectedPressedBg,
      disabledBg: disabledSurface(theme, selectedSurface),
    },
    borderColor: {
      normalBg: theme.borderControl,
      hoveredBg: theme.borderControlHover,
      pressedBg: lerpColor(theme.borderControlHover, theme.accentPrimary, 0.35),
      selectedBg: theme.borderControlHover,
      selectedHoveredBg: lerpColor(theme.borderControlHover, theme.accentPrimary, 0.18),
      selectedPressedBg: lerpColor(theme.borderControlHover, theme.accentPrimary, 0.35),
      disabledBg: theme.borderSubtle,
    },
    textColor: {
      text: theme.textPrimary,
      hoveredText: theme.textAccent,
      pressedText: theme.textPrimary,
      selectedText,
      selectedHoveredText,
      selectedPressedText,
      disabledText: theme.textDisabled,
    },
  }
}

export type BadgeStatus = 'normal' | 'primary' | 'success' | 'warning' | 'danger'
export type BadgeAppearance = 'subtle' | 'filled'

export interface BadgeStatusStyleTokens {
  subtleBg: Color
  subtleBorder: Color
  subtleText: Color
  filledBg: Color
  filledBorder: Color
  filledText: Color
}

export interface BadgeStyleTokens {
  fontSize: number
  fontFamily: string
  minHeight: number
  minWidth: number
  dotSize: number
  paddingX: number
  radius: number
  borderWidth: number
  statuses: Record<BadgeStatus, BadgeStatusStyleTokens>
}

function computeBadgeStyle(theme: ResolvedTheme): BadgeStyleTokens {
  const normalBg = lerpColor(theme.surfaceControlActive, theme.surfacePanel, 0.16)
  const makeStatus = (
    base: Color,
    subtleText = base,
    subtleBg = lerpColor(base, theme.surfacePanel, 0.84),
    subtleBorder = lerpColor(base, theme.borderSubtle, 0.22),
    preferredFilledText = theme.textOnAccent,
  ): BadgeStatusStyleTokens => ({
    subtleBg,
    subtleBorder,
    subtleText,
    filledBg: base,
    filledBorder: lerpColor(base, theme.borderPanel, 0.18),
    filledText: resolveContrastText(theme, base, preferredFilledText),
  })

  return {
    fontSize: Math.max(10, theme.fontSize - 2),
    fontFamily: theme.fontFamily,
    minHeight: Math.max(18, theme.fontSize + theme.framePadding * 2 - 4),
    minWidth: Math.max(18, theme.fontSize + theme.framePadding * 2 - 4),
    dotSize: Math.max(8, theme.framePadding + 4),
    paddingX: Math.max(6, theme.framePadding + 1),
    radius: Math.max(9, Math.round((theme.fontSize + theme.framePadding * 2) / 2)),
    borderWidth: 1,
    statuses: {
      normal: {
        subtleBg: lerpColor(normalBg, theme.surfacePanel, 0.18),
        subtleBorder: theme.borderSubtle,
        subtleText: theme.textSecondary,
        filledBg: normalBg,
        filledBorder: theme.borderControl,
        filledText: theme.textPrimary,
      },
      primary: makeStatus(theme.accentPrimary, theme.textAccent),
      success: makeStatus(theme.accentSuccess, theme.accentSuccess, theme.statusSuccessBg, theme.statusSuccessBorder),
      warning: makeStatus(theme.accentWarning, theme.accentWarning, theme.statusWarningBg, theme.statusWarningBorder),
      danger: makeStatus(theme.accentDanger, theme.accentDanger, theme.statusDangerBg, theme.statusDangerBorder, theme.textOnDanger),
    },
  }
}

export type BorderBackground = 'panel' | 'muted' | 'selected' | 'primary'

export interface BorderStyleTokens {
  backgroundColor: Color
  borderColor: Color
  accentColor: Color
  borderRadius: number
  borderWidth: number
}

function computeBorderStyle(theme: ResolvedTheme, background: BorderBackground = 'panel'): BorderStyleTokens {
  const base: BorderStyleTokens = {
    backgroundColor: theme.surfacePanel,
    borderColor: theme.borderData,
    accentColor: theme.accentPrimary,
    borderRadius: Math.max(6, theme.frameRounding + 3),
    borderWidth: 1,
  }
  switch (background) {
    case 'muted':
      return {
        ...base,
        backgroundColor: theme.surfaceDataHeader,
        borderColor: theme.borderSubtle,
      }
    case 'selected':
      return {
        ...base,
        backgroundColor: lerpColor(theme.selectionBg, theme.surfacePanel, 0.35),
        borderColor: theme.accentPrimaryHover,
      }
    case 'primary':
      return {
        ...base,
        backgroundColor: theme.accentPrimary,
        borderColor: theme.accentPrimaryHover,
        accentColor: theme.textOnAccent,
      }
    default:
      return base
  }
}

export interface ItemContainerStyleTokens {
  background: InteractionBgTokens
  border: InteractionBgTokens
  text: InteractionTextTokens
  accentColor: Color
  focusColor: Color
  paddingX: number
  paddingY: number
  minHeight: number
  borderRadius: number
  borderWidth: number
  borderPlacement: 'box' | 'bottom'
  accentWidth: number
}

export interface ItemContainerStyleOverrides {
  background?: Partial<InteractionBgTokens>
  border?: Partial<InteractionBgTokens>
  text?: Partial<InteractionTextTokens>
  accentColor?: Color
  focusColor?: Color
  paddingX?: number
  paddingY?: number
  minHeight?: number
  borderRadius?: number
  borderWidth?: number
  borderPlacement?: 'box' | 'bottom'
  accentWidth?: number
}

export type ItemContainerAppearance = 'default' | 'navigation' | 'row'

export function mergeItemContainerStyle(
  base: ItemContainerStyleTokens,
  overrides?: ItemContainerStyleOverrides,
): ItemContainerStyleTokens {
  if (!overrides) return base
  return {
    background: { ...base.background, ...overrides.background },
    border: { ...base.border, ...overrides.border },
    text: { ...base.text, ...overrides.text },
    accentColor: overrides.accentColor ?? base.accentColor,
    focusColor: overrides.focusColor ?? base.focusColor,
    paddingX: overrides.paddingX ?? base.paddingX,
    paddingY: overrides.paddingY ?? base.paddingY,
    minHeight: overrides.minHeight ?? base.minHeight,
    borderRadius: overrides.borderRadius ?? base.borderRadius,
    borderWidth: overrides.borderWidth ?? base.borderWidth,
    borderPlacement: overrides.borderPlacement ?? base.borderPlacement,
    accentWidth: overrides.accentWidth ?? base.accentWidth,
  }
}

function computeItemContainerStyle(theme: ResolvedTheme, appearance: ItemContainerAppearance = 'default'): ItemContainerStyleTokens {
  if (appearance === 'row') {
    const transparent = rgba(0, 0, 0, 0)
    const selectedBg = lerpColor(theme.selectionBg, theme.surfacePanel, 0.48)
    return {
      background: {
        normalBg: transparent,
        hoveredBg: theme.stateHoverOverlay,
        focusedBg: theme.stateHoverOverlay,
        selectedBg,
        selectedHoveredBg: compositeColor(theme.stateHoverOverlay, selectedBg),
        selectedFocusedBg: selectedBg,
        disabledBg: transparent,
      },
      border: {
        normalBg: theme.borderSubtle,
        hoveredBg: theme.borderData,
        focusedBg: theme.focusBorder,
        selectedBg: theme.accentPrimaryHover,
        selectedHoveredBg: theme.accentPrimary,
        selectedFocusedBg: theme.accentPrimaryHover,
        disabledBg: theme.borderSubtle,
      },
      text: {
        text: theme.textPrimary,
        hoveredText: theme.textPrimary,
        focusedText: theme.textPrimary,
        selectedText: theme.textPrimary,
        selectedHoveredText: theme.textPrimary,
        selectedFocusedText: theme.textPrimary,
        disabledText: theme.textDisabled,
      },
      accentColor: theme.accentPrimary,
      focusColor: theme.focusBorder,
      paddingX: Math.max(4, theme.framePadding),
      paddingY: 1,
      minHeight: Math.max(24, theme.controlHeight),
      borderRadius: 0,
      borderWidth: 1,
      borderPlacement: 'bottom',
      accentWidth: 3,
    }
  }

  if (appearance === 'navigation') {
    const normalBg = rgba(0, 0, 0, 0)
    const hoveredBg = navHoverSurface(theme)
    const focusedBg = lerpColor(theme.surfaceNav, theme.selectionMuted, 0.34)
    const selectedBg = lerpColor(theme.selectionMuted, theme.surfaceNav, 0.18)
    return {
      background: {
        normalBg,
        hoveredBg,
        focusedBg,
        selectedBg,
        selectedHoveredBg: compositeColor(theme.stateHoverOverlay, selectedBg),
        selectedFocusedBg: selectedBg,
        disabledBg: normalBg,
      },
      border: {
        normalBg,
        hoveredBg: rgba(theme.borderSubtle.r, theme.borderSubtle.g, theme.borderSubtle.b, 0.32),
        focusedBg: theme.focusBorder,
        selectedBg: rgba(theme.accentPrimary.r, theme.accentPrimary.g, theme.accentPrimary.b, 0.52),
        selectedHoveredBg: rgba(theme.accentPrimary.r, theme.accentPrimary.g, theme.accentPrimary.b, 0.68),
        selectedFocusedBg: theme.focusBorder,
        disabledBg: normalBg,
      },
      text: {
        text: theme.textPrimary,
        hoveredText: theme.textAccent,
        focusedText: theme.textAccent,
        selectedText: theme.textAccent,
        selectedHoveredText: theme.textAccent,
        selectedFocusedText: theme.textAccent,
        disabledText: theme.textDisabled,
      },
      accentColor: theme.accentPrimary,
      focusColor: theme.focusBorder,
      paddingX: Math.max(7, theme.framePadding),
      paddingY: 2,
      minHeight: 30,
      borderRadius: Math.max(4, theme.frameRounding),
      borderWidth: 1,
      borderPlacement: 'box',
      accentWidth: 3,
    }
  }

  const normalBg = theme.surfacePanel
  const selectedBg = lerpColor(theme.selectionBg, theme.surfacePanel, 0.35)
  const hoveredBg = lerpColor(theme.surfacePanel, theme.selectionMuted, 0.24)
  return {
    background: {
      normalBg,
      hoveredBg,
      focusedBg: lerpColor(normalBg, theme.selectionMuted, 0.18),
      selectedBg,
      selectedHoveredBg: compositeColor(theme.stateHoverOverlay, selectedBg),
      selectedFocusedBg: selectedBg,
      disabledBg: disabledSurface(theme, normalBg),
    },
    border: {
      normalBg: theme.borderData,
      hoveredBg: theme.borderControlHover,
      focusedBg: theme.focusBorder,
      selectedBg: theme.accentPrimaryHover,
      selectedHoveredBg: theme.accentPrimary,
      selectedFocusedBg: theme.focusBorder,
      disabledBg: theme.borderSubtle,
    },
    text: {
      text: theme.textPrimary,
      hoveredText: theme.textPrimary,
      focusedText: theme.textPrimary,
      selectedText: theme.textPrimary,
      selectedHoveredText: theme.textPrimary,
      selectedFocusedText: theme.textPrimary,
      disabledText: theme.textDisabled,
    },
    accentColor: theme.accentPrimary,
    focusColor: theme.focusBorder,
    paddingX: Math.max(7, theme.framePadding + 2),
    paddingY: Math.max(6, theme.framePadding + 1),
    minHeight: Math.max(44, theme.controlHeight + 20),
    borderRadius: Math.max(6, theme.frameRounding + 3),
    borderWidth: 1,
    borderPlacement: 'box',
    accentWidth: 3,
  }
}

export interface SectionStyleTokens {
  titleColor: Color
  descriptionColor: Color
  titleFontSize: number
  descriptionFontSize: number
  titleFontWeight: number
  descriptionFontWeight: number
  titleLineHeight: number
  descriptionLineHeight: number
  headerGap: number
  contentGap: number
}

function computeSectionStyle(theme: ResolvedTheme): SectionStyleTokens {
  const typography = resolveThemeTypography(theme)
  return {
    titleColor: theme.textPrimary,
    descriptionColor: theme.textSecondary,
    titleFontSize: typography.titleFontSize,
    descriptionFontSize: typography.secondaryFontSize,
    titleFontWeight: typography.titleFontWeight,
    descriptionFontWeight: typography.secondaryFontWeight,
    titleLineHeight: typography.titleLineHeight,
    descriptionLineHeight: typography.secondaryLineHeight,
    headerGap: Math.max(4, Math.round(theme.framePadding * 0.75)),
    contentGap: Math.max(theme.itemSpacing, theme.framePadding),
  }
}

export type CardVariant = 'default' | 'translucent'

export interface CardStyleTokens extends SectionStyleTokens {
  backgroundColor: Color
  borderColor: Color
  borderWidth: number
  borderRadius: number
  padding: number
  shadowColor: Color
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  highlightColor: Color
  highlightWidth: number
}

function computeCardStyle(theme: ResolvedTheme, variant: CardVariant = 'default'): CardStyleTokens {
  const section = deriveSectionStyle(theme)
  const elevation = resolveThemeElevation(theme)
  const base: CardStyleTokens = {
    ...section,
    backgroundColor: theme.surfacePanel,
    borderColor: theme.borderPanel,
    borderWidth: 1,
    borderRadius: theme.frameRounding,
    padding: theme.framePadding + 2,
    shadowColor: rgba(0, 0, 0, 0),
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    highlightColor: rgba(255, 255, 255, 0),
    highlightWidth: 0,
  }

  if (variant !== 'translucent') return base

  const isLightSurface = perceivedLuminance(theme.surfacePanel) >= 140
  const surface = lerpColor(theme.surfacePanel, theme.surfaceContent, 0.08)
  return {
    ...base,
    backgroundColor: { ...surface, a: isLightSurface ? 0.72 : 0.68 },
    borderColor: { ...lerpColor(theme.borderPanel, theme.accentPrimary, 0.35), a: isLightSurface ? 0.42 : 0.5 },
    borderRadius: theme.frameRounding + 4,
    shadowColor: elevation.cardShadowColor,
    shadowBlur: elevation.cardShadowBlur,
    shadowOffsetX: elevation.cardShadowOffsetX,
    shadowOffsetY: elevation.cardShadowOffsetY,
    highlightColor: elevation.cardHighlightColor,
    highlightWidth: 1,
  }
}

export interface GroupPanelStyleTokens {
  backgroundColor: Color
  borderColor: Color
  borderWidth: number
  borderRadius: number
  headerBgTop: Color
  headerBgBottom: Color
  headerBorderColor: Color
  titleColor: Color
  infoColor: Color
  titleFontSize: number
  infoFontSize: number
  titleFontWeight: number
  infoFontWeight: number
  headerHeight: number
  headerPaddingX: number
  contentPadding: number
}

function computeGroupPanelStyle(theme: ResolvedTheme): GroupPanelStyleTokens {
  const typography = resolveThemeTypography(theme)
  return {
    backgroundColor: theme.surfacePanel,
    borderColor: theme.borderPanel,
    borderWidth: 1,
    borderRadius: theme.frameRounding,
    headerBgTop: theme.surfaceControlHover,
    headerBgBottom: lerpColor(theme.surfaceDataHeader, theme.surfacePanel, 0.36),
    headerBorderColor: theme.borderData,
    titleColor: theme.textAccent,
    infoColor: theme.textSecondary,
    titleFontSize: typography.titleFontSize,
    infoFontSize: typography.secondaryFontSize,
    titleFontWeight: typography.titleFontWeight,
    infoFontWeight: typography.secondaryFontWeight,
    headerHeight: theme.panelHeaderHeight,
    headerPaddingX: Math.max(8, theme.framePadding * 2),
    contentPadding: theme.contentPadding,
  }
}

export interface EntryGridStyleTokens {
  columnGap: number
  rowGap: number
  feedbackGap: number
  feedbackItemGap: number
  feedbackPaddingX: number
  feedbackPaddingY: number
  feedbackRadius: number
  feedbackFontSize: number
  feedbackLineHeight: number
  feedbackColors: {
    errorBg: Color
    errorBorder: Color
    errorText: Color
    warningBg: Color
    warningBorder: Color
    warningText: Color
  }
}

function computeEntryGridStyle(theme: ResolvedTheme): EntryGridStyleTokens {
  const input = deriveTextInputStyle(theme)
  return {
    columnGap: Math.max(8, theme.itemSpacing + 2),
    rowGap: Math.max(4, Math.round(theme.itemSpacing * 0.85)),
    feedbackGap: Math.max(4, Math.round(theme.itemSpacing * 0.65)),
    feedbackItemGap: Math.max(6, Math.round(theme.itemSpacing * 0.75)),
    feedbackPaddingX: Math.max(8, theme.framePadding + 1),
    feedbackPaddingY: Math.max(3, Math.round(theme.framePadding * 0.55)),
    feedbackRadius: Math.max(4, theme.frameRounding),
    feedbackFontSize: Math.max(11, theme.fontSize - 1),
    feedbackLineHeight: Math.max(16, Math.round(theme.fontSize * 1.25)),
    feedbackColors: {
      errorBg: theme.statusDangerBg,
      errorBorder: theme.statusDangerBorder,
      errorText: theme.textPrimary,
      warningBg: theme.statusWarningBg,
      warningBorder: theme.statusWarningBorder,
      warningText: theme.textPrimary,
    },
  }
}

export interface LabeledFieldStyleTokens {
  labelColor: Color
  labelRequiredColor: Color
  unitColor: Color
  metaColors: {
    default: Color
    success: Color
    warning: Color
    danger: Color
  }
  statusColors: {
    default: Color
    success: Color
    warning: Color
    error: Color
  }
  labelFontSize: number
  labelLineHeight: number
  labelGap: number
  labelWidth: number
  unitFontSize: number
  unitLineHeight: number
  unitGap: number
  metaFontSize: number
  metaLineHeight: number
  metaGap: number
  indicatorSize: number
  indicatorInset: number
  indicatorGap: number
  indicatorRadius: number
  messageFontSize: number
  messageLineHeight: number
  messageGap: number
}

function computeLabeledFieldStyle(theme: ResolvedTheme): LabeledFieldStyleTokens {
  const input = deriveTextInputStyle(theme)
  return {
    labelColor: theme.textSecondary,
    labelRequiredColor: theme.accentDanger,
    unitColor: theme.textSecondary,
    metaColors: {
      default: theme.textSecondary,
      success: input.successBorder,
      warning: input.warningBorder,
      danger: input.errorBorder,
    },
    statusColors: {
      default: theme.textSecondary,
      success: input.successBorder,
      warning: input.warningBorder,
      error: input.errorBorder,
    },
    labelFontSize: Math.max(11, theme.fontSize - 1),
    labelLineHeight: Math.max(16, theme.fontSize * 1.25),
    labelGap: Math.max(6, theme.itemSpacing),
    labelWidth: 76,
    unitFontSize: Math.max(11, theme.fontSize - 1),
    unitLineHeight: Math.max(16, theme.fontSize * 1.25),
    unitGap: Math.max(6, Math.round(theme.itemSpacing * 0.75)),
    metaFontSize: Math.max(11, theme.fontSize - 1),
    metaLineHeight: Math.max(16, theme.fontSize * 1.25),
    metaGap: Math.max(6, Math.round(theme.itemSpacing * 0.75)),
    indicatorSize: Math.max(10, theme.fontSize - 1),
    indicatorInset: Math.max(3, Math.round(theme.framePadding * 0.4)),
    indicatorGap: Math.max(4, Math.round(theme.itemSpacing * 0.5)),
    indicatorRadius: Math.max(2, theme.frameRounding - 1),
    messageFontSize: Math.max(11, theme.fontSize - 1),
    messageLineHeight: Math.max(15, Math.round(theme.fontSize * 1.2)),
    messageGap: Math.max(3, Math.round(theme.itemSpacing * 0.5)),
  }
}

export interface EmptyStyleTokens {
  backgroundColor: Color
  borderColor: Color
  borderWidth: number
  borderRadius: number
  padding: number
  iconColor: Color
  iconSize: number
  titleColor: Color
  descriptionColor: Color
  titleFontSize: number
  descriptionFontSize: number
  titleFontWeight: number
  descriptionFontWeight: number
  titleLineHeight: number
  descriptionLineHeight: number
  itemGap: number
}

function computeEmptyStyle(theme: ResolvedTheme): EmptyStyleTokens {
  const typography = resolveThemeTypography(theme)
  return {
    backgroundColor: lerpColor(theme.surfacePanel, theme.surfaceContent, 0.14),
    borderColor: theme.borderSubtle,
    borderWidth: 1,
    borderRadius: theme.frameRounding,
    padding: theme.framePadding + 4,
    iconColor: theme.textSecondary,
    iconSize: Math.max(18, theme.fontSize + 4),
    titleColor: theme.textPrimary,
    descriptionColor: theme.textSecondary,
    titleFontSize: typography.titleFontSize,
    descriptionFontSize: typography.secondaryFontSize,
    titleFontWeight: typography.titleFontWeight,
    descriptionFontWeight: typography.secondaryFontWeight,
    titleLineHeight: typography.titleLineHeight,
    descriptionLineHeight: typography.secondaryLineHeight,
    itemGap: Math.max(theme.itemSpacing, theme.framePadding),
  }
}

export interface ListViewStyleTokens {
  panelBg: Color
  panelBorder: Color
  borderRadius: number
  rowBg: InteractionBgTokens
  rowBorder: InteractionBgTokens
  labelText: InteractionTextTokens
  trailingText: InteractionTextTokens
  iconText: InteractionTextTokens
  fontSize: number
  fontFamily: string
  rowHeight: number
  paddingH: number
}

function computeListViewStyle(theme: ResolvedTheme): ListViewStyleTokens {
  const hoveredRowBg = stateHoverSurface(theme, theme.surfacePanel)
  const selectedText = resolveSelectionText(theme, theme.selectionBg)
  return {
    panelBg: theme.surfacePanel,
    panelBorder: theme.borderPanel,
    borderRadius: theme.frameRounding,
    rowBg: {
      normalBg: theme.surfacePanel,
      hoveredBg: hoveredRowBg,
      selectedBg: theme.selectionBg,
      selectedHoveredBg: compositeColor(theme.stateHoverOverlay, theme.selectionBg),
      selectedPressedBg: compositeColor(theme.statePressedOverlay, theme.selectionBg),
      disabledBg: disabledSurface(theme, theme.surfacePanel),
    },
    rowBorder: {
      normalBg: theme.borderSubtle,
      focusedBg: theme.focusBorder,
    },
    labelText: {
      text: theme.textPrimary,
      hoveredText: theme.textPrimary,
      selectedText,
      disabledText: theme.textDisabled,
    },
    trailingText: {
      text: theme.textSecondary,
      hoveredText: theme.textSecondary,
      selectedText,
      disabledText: theme.textDisabled,
    },
    iconText: {
      text: theme.textSecondary,
      hoveredText: theme.textPrimary,
      selectedText,
      disabledText: theme.textDisabled,
    },
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    rowHeight: theme.dataRowHeight,
    paddingH: theme.framePadding + 2,
  }
}

export interface PaginationStyleTokens {
  backgroundColor: Color
  borderColor: Color
  borderRadius: number
  itemBg: InteractionBgTokens
  itemText: InteractionTextTokens
  summaryText: Color
  fontSize: number
  fontFamily: string
  height: number
  itemPaddingH: number
  itemGap: number
  minItemWidth: number
}

function computePaginationStyle(theme: ResolvedTheme): PaginationStyleTokens {
  const selectedBg = theme.selectionBg
  const selectedHoveredBg = compositeColor(theme.stateHoverOverlay, selectedBg)
  const selectedPressedBg = compositeColor(theme.statePressedOverlay, selectedBg)
  const selectedText = resolveSelectionText(theme, selectedBg)
  return {
    backgroundColor: lerpColor(theme.surfacePanel, theme.surfaceContent, 0.12),
    borderColor: theme.borderSubtle,
    borderRadius: theme.frameRounding,
    itemBg: {
      normalBg: theme.surfaceControl,
      hoveredBg: theme.surfaceControlHover,
      selectedBg,
      selectedHoveredBg,
      selectedPressedBg,
      pressedBg: theme.surfaceControlActive,
      disabledBg: disabledSurface(theme, theme.surfaceControl),
    },
    itemText: {
      text: theme.textPrimary,
      hoveredText: theme.textPrimary,
      pressedText: theme.textPrimary,
      selectedText,
      selectedHoveredText: resolveSelectionText(theme, selectedHoveredBg),
      selectedPressedText: resolveSelectionText(theme, selectedPressedBg),
      disabledText: theme.textDisabled,
    },
    summaryText: theme.textSecondary,
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    height: theme.controlHeight + 4,
    itemPaddingH: theme.framePadding + 2,
    itemGap: Math.max(4, theme.itemSpacing - 1),
    minItemWidth: theme.fontSize * 1.9,
  }
}

export interface BreadcrumbStyleTokens {
  itemText: InteractionTextTokens
  separatorColor: Color
  fontSize: number
  fontFamily: string
  height: number
  itemGap: number
  separatorGap: number
  focusRadius: number
}

function computeBreadcrumbStyle(theme: ResolvedTheme): BreadcrumbStyleTokens {
  return {
    itemText: {
      text: theme.textSecondary,
      hoveredText: theme.textPrimary,
      selectedText: theme.textPrimary,
      focusedText: theme.textPrimary,
      disabledText: theme.textDisabled,
    },
    separatorColor: theme.textDisabled,
    fontSize: Math.max(11, theme.fontSize - 1),
    fontFamily: theme.fontFamily,
    height: Math.max(20, theme.controlHeight),
    itemGap: Math.max(6, theme.itemSpacing),
    separatorGap: Math.max(6, theme.itemSpacing - 1),
    focusRadius: Math.max(2, theme.frameRounding - 1),
  }
}

export interface PageHeaderStyleTokens {
  backgroundColor: Color
  borderColor: Color
  borderWidth: number
  borderRadius: number
  padding: number
  titleColor: Color
  descriptionColor: Color
  titleFontSize: number
  descriptionFontSize: number
  titleFontWeight: number
  descriptionFontWeight: number
  titleLineHeight: number
  descriptionLineHeight: number
  sectionGap: number
}

function computePageHeaderStyle(theme: ResolvedTheme): PageHeaderStyleTokens {
  const typography = resolveThemeTypography(theme)
  return {
    backgroundColor: lerpColor(theme.surfacePanel, theme.surfaceContent, 0.08),
    borderColor: theme.borderSubtle,
    borderWidth: 1,
    borderRadius: theme.frameRounding,
    padding: theme.framePadding + 3,
    titleColor: theme.textPrimary,
    descriptionColor: theme.textSecondary,
    titleFontSize: typography.titleFontSize,
    descriptionFontSize: typography.bodyFontSize,
    titleFontWeight: typography.titleFontWeight,
    descriptionFontWeight: typography.bodyFontWeight,
    titleLineHeight: typography.titleLineHeight,
    descriptionLineHeight: typography.bodyLineHeight,
    sectionGap: Math.max(theme.itemSpacing, theme.framePadding),
  }
}

// Component recipes are pure for a resolved theme. Keep their caches private so
// callers receive stable token objects without exposing caching as a public API.
export const deriveScrollbarStyle = memoizeThemeRecipe(computeScrollbarStyle)
export const deriveTextStyle = memoizeThemeRecipe(computeTextStyle)
export const deriveLoadingStyle = memoizeThemeRecipe(computeLoadingStyle)
export const deriveButtonStyle = memoizeThemeVariantRecipe<ButtonVariant, ButtonStyleTokens>(
  computeButtonStyle,
  'default',
)
export const deriveCheckboxStyle = memoizeThemeRecipe(computeCheckboxStyle)
export const deriveSwitchStyle = memoizeThemeRecipe(computeSwitchStyle)
export const deriveSliderStyle = memoizeThemeRecipe(computeSliderStyle)
export const deriveProgressBarStyle = memoizeThemeRecipe(computeProgressBarStyle)
export const deriveTextInputStyle = memoizeThemeRecipe(computeTextInputStyle)
export const deriveNumberStepperStyle = memoizeThemeVariantRecipe<
  NumberStepperStyleVariant,
  NumberStepperStyleTokens
>(computeNumberStepperStyle, 'control')
export const derivePopoverTriggerStyle = memoizeThemeRecipe(computePopoverTriggerStyle)
export const deriveDropdownStyle = memoizeThemeRecipe(computeDropdownStyle)
export const deriveDatePickerStyle = memoizeThemeRecipe(computeDatePickerStyle)
export const deriveColorPickerStyle = memoizeThemeRecipe(computeColorPickerStyle)
export const deriveContextMenuStyle = memoizeThemeRecipe(computeContextMenuStyle)
export const deriveMenuBarStyle = memoizeThemeRecipe(computeMenuBarStyle)
export const deriveTabsStyle = memoizeThemeRecipe(computeTabsStyle)
export const deriveDockWorkbenchStyle = memoizeThemeRecipe(computeDockWorkbenchStyle)
export const deriveRadioGroupStyle = memoizeThemeRecipe(computeRadioGroupStyle)
export const deriveSegmentedControlStyle = memoizeThemeRecipe(computeSegmentedControlStyle)
export const deriveModalStyle = memoizeThemeRecipe(computeModalStyle)
export const deriveDrawerStyle = memoizeThemeRecipe(computeDrawerStyle)
export const deriveTableRowStyle = memoizeThemeRecipe(computeTableRowStyle)
export const deriveGridCellStyle = memoizeThemeRecipe(computeGridCellStyle)
export const deriveTreeStyle = memoizeThemeRecipe(computeTreeStyle)
export const deriveWindowChromeStyle = memoizeThemeRecipe(computeWindowChromeStyle)
export const deriveSplitterStyle = memoizeThemeRecipe(computeSplitterStyle)
export const deriveNotificationStyle = memoizeThemeRecipe(computeNotificationStyle)
export const derivePopupStyle = memoizeThemeRecipe(computePopupStyle)
export const deriveGridFilterPopupStyle = memoizeThemeRecipe(computeGridFilterPopupStyle)
export const deriveLayoutStyle = memoizeThemeRecipe(computeLayoutStyle)
export const deriveDividerStyle = memoizeThemeRecipe(computeDividerStyle)
export const deriveToolbarStyle = memoizeThemeRecipe(computeToolbarStyle)
export const deriveStatusBarStyle = memoizeThemeRecipe(computeStatusBarStyle)
export const deriveChipStyle = memoizeThemeRecipe(computeChipStyle)
export const deriveBadgeStyle = memoizeThemeRecipe(computeBadgeStyle)
export const deriveBorderStyle = memoizeThemeVariantRecipe<BorderBackground, BorderStyleTokens>(
  computeBorderStyle,
  'panel',
)
export const deriveItemContainerStyle = memoizeThemeVariantRecipe<
  ItemContainerAppearance,
  ItemContainerStyleTokens
>(
  computeItemContainerStyle,
  'default',
)
export const deriveSectionStyle = memoizeThemeRecipe(computeSectionStyle)
export const deriveCardStyle = memoizeThemeVariantRecipe<CardVariant, CardStyleTokens>(
  computeCardStyle,
  'default',
)
export const deriveGroupPanelStyle = memoizeThemeRecipe(computeGroupPanelStyle)
export const deriveEntryGridStyle = memoizeThemeRecipe(computeEntryGridStyle)
export const deriveLabeledFieldStyle = memoizeThemeRecipe(computeLabeledFieldStyle)
export const deriveEmptyStyle = memoizeThemeRecipe(computeEmptyStyle)
export const deriveListViewStyle = memoizeThemeRecipe(computeListViewStyle)
export const derivePaginationStyle = memoizeThemeRecipe(computePaginationStyle)
export const deriveBreadcrumbStyle = memoizeThemeRecipe(computeBreadcrumbStyle)
export const derivePageHeaderStyle = memoizeThemeRecipe(computePageHeaderStyle)
