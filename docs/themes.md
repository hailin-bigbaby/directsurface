# Themes

Applications pass a complete `ResolvedTheme` to `Application.run()`. The package exports `ImGuiLightTheme`, `ImGuiDarkTheme`, and `ModernCompactLightTheme` as ready-to-use themes.

Use `createTheme()` to change semantic tokens without copying component paint logic:

```ts
import { ImGuiLightTheme, createTheme, rgba } from 'directsurface'

const theme = createTheme(ImGuiLightTheme, {
  accentPrimary: rgba(28, 105, 188),
  focusBorder: rgba(28, 105, 188),
})
```

`ThemeDefinition` describes overrides; `createTheme()` returns a complete, frozen `ResolvedTheme`. Set the theme when starting the app:

```ts
const host = Application.mount('#app').run(window, { theme })
```

Use component options for local differences and theme tokens for application-wide colors, typography, spacing, and interaction states. For the shape of each token, refer to the `ThemeDefinition` and `ResolvedTheme` declarations in the built package.

## Text fitting and font readiness

Controls using the shared single-line text painter reuse fitted text and its measured width when the text, available width and typography are unchanged. The cache is bounded to 2,048 entries; labels longer than 4,096 UTF-16 code units are fitted without retaining the result. Ellipsis and Unicode handling remain unchanged.

Changing width, font family, size, weight or style uses a separate result. When web fonts become ready, `loadDirectSurfaceFonts()` clears measurement caches and invalidates fitted results too. Call it after loading additional fonts, then request the layout or repaint required by your host; cache invalidation itself does not schedule a frame. No cache configuration is required.


## Drawing state and cache limits

DrawList checks the actual Canvas fill, stroke, font, line width and text alignment state before reusing a cached assignment. Multiple DrawLists and raw Canvas painters can alternate without inheriting stale values. Browser-normalized colors and fonts are retained so repeated matching draws still avoid redundant assignments. This protects drawing properties; custom painters must still balance their own transforms and clips with `save()` and `restore()`.

Stroke primitives ignore zero, negative and non-finite line widths without changing Canvas state. Positive finite widths retain their existing behavior. DrawList's shared color-string and font-string caches use bounded LRU storage: at most 2,048 colors and 256 fonts. Evicted strings are regenerated on demand; no application configuration is needed.
