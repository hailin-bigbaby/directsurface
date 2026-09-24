import type { ResolvedTheme } from './theme'

const compiledThemes = new WeakSet<object>()

export function markThemeAsCompiled(theme: ResolvedTheme): void {
  compiledThemes.add(theme)
}

export function isCompiledTheme(theme: ResolvedTheme): boolean {
  return compiledThemes.has(theme)
}
