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
