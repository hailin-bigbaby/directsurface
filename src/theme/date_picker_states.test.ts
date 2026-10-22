import { expect, it } from 'vitest'
import { ImGuiDarkTheme } from './default_theme'
import { ModernCompactLightTheme } from './modern_theme'
import { deriveDatePickerStyle } from './component_styles'
import { lerpColor } from './theme'

for (const theme of [ImGuiDarkTheme, ModernCompactLightTheme]) {
  it(`distinguishes calendar interaction states in ${theme.accentPrimary.r}`, () => {
    const style = deriveDatePickerStyle(theme)
    const hover = lerpColor(theme.surfacePopup, theme.accentPrimary, 0.22)
    expect(style.cellBg.hoveredBg).toEqual(hover)
    expect(style.navBg.hoveredBg).toEqual(hover)
    expect(style.footerButtonBg.hoveredBg).toEqual(hover)
    expect(style.cellBg.focusedBg).toEqual(theme.selectionBg)
    expect(style.cellBg.selectedBg).toEqual(theme.accentPrimary)
    expect(style.cellBg.hoveredBg).not.toEqual(style.cellBg.selectedBg)
  })
}
