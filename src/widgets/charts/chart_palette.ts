import { resolveThemeChart, type Color, type ResolvedTheme } from '../../theme/theme'

export function withAlpha(color: Color, alpha: number): Color {
  return { ...color, a: alpha }
}

export function chartPalette(theme: ResolvedTheme): Color[] {
  const series = resolveThemeChart(theme).series
  if (series.length === 0) {
    throw new TypeError('ResolvedTheme chart.series must contain at least one color.')
  }
  const palette: Color[] = []
  for (let index = 0; index < series.length; index += 1) {
    const color = series[index]
    if (
      !color ||
      typeof color !== 'object' ||
      !['r', 'g', 'b', 'a'].every(channel =>
        typeof (color as unknown as Record<string, unknown>)[channel] === 'number')
    ) {
      throw new TypeError(`ResolvedTheme chart.series[${index}] must be a color.`)
    }
    palette.push(color)
  }
  return palette
}

export function chartColor(theme: ResolvedTheme, index: number, override?: Color): Color {
  if (override) return override
  const palette = chartPalette(theme)
  const normalizedIndex = ((Math.trunc(index) % palette.length) + palette.length) % palette.length
  return palette[normalizedIndex]!
}
