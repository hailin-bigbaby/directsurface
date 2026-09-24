# Themes

Applications pass a complete `ResolvedTheme` to `Application.run()`. The package exports `ImGuiLightTheme`, `ImGuiDarkTheme`, and `ModernCompactLightTheme` as ready-to-use themes.

Use `createTheme()` to change semantic tokens without copying component paint logic:

```ts
import { ImGuiLightTheme, createTheme, rgba } from 'ds-ui'

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
