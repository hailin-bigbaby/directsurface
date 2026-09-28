# Changelog

## Unreleased

- Chart data now preserves missing line points (`y: null`), excludes invalid x values, and parses ISO date-time strings on time axes.
- Line and range previews keep bounded, gap-aware peak/valley samples; isolated samples remain visible.
- Chart clicks resolve the current pointer target, and series/segment visibility follows stable optional IDs across reordered data.
- Linked line and range viewports follow full-domain changes while preserving partial selections.
- `ChartPoint.y` is now `number | null`; callers reading chart series data should handle missing values.

## 0.1.0 — 2026-09-24

Initial public release of the reusable DirectSurface Canvas GUI framework.

- Public ESM `directsurface` package with TypeScript declarations, MIT license, and third-party notices.
- Rendering runtime, responsive layouts, themes, forms, data controls, charts, overlays, and dockable workspaces.
- Standalone project-delivery and Canvas-workspace demos, including a 10,000-row local grid example.
- Component guides, package checks, external-consumer validation, browser regression, CI, and GitHub Pages demo.

Current boundary: no accessibility support for assistive technologies. The demo uses fictional local data and has no backend or real login.
