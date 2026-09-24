import { TextMeasurer } from '../core/text_measurer'
import { DefaultFontFamily } from '../theme/default_theme'

export const DirectSurfaceFontFamily = DefaultFontFamily

export async function loadDirectSurfaceFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return

  await document.fonts.ready
  TextMeasurer.clearCache()
}
