# Changelog

## Unreleased

- Add an office procurement example with local SQLite persistence and a separate online demo.

- Button text changes now invalidate layout automatically.
- DockWorkbench can cancel activation before leaving an invalid edit.
- Consumed shortcuts no longer reach a newly opened confirmation dialog.

## 0.2.0 — 2026-10-21

- DataGrid adds vertical row merging, automatic row heights, and wrapped cell text.
- Charts add combo and scatter views, improve text and tooltip geometry, and preserve gaps and linked ranges in line data.
- Inputs add text-area character limits, atomic batch submission, and number-input wheel policies.
- Docking, overlays, DevTools, layout measurement, painting, and Canvas recovery receive interaction and rendering fixes.
- `ChartPoint.y` is now `number | null`; consumers reading chart data should handle missing values.

## 0.1.0 — 2026-09-24

Initial public release of the reusable DirectSurface Canvas GUI framework.

- Public ESM `directsurface` package with TypeScript declarations, MIT license, and third-party notices.
- Rendering runtime, responsive layouts, themes, forms, data controls, charts, overlays, and dockable workspaces.
- Standalone project-delivery and Canvas-workspace demos, including a 10,000-row local grid example.
- Component guides, package checks, external-consumer validation, browser regression, CI, and GitHub Pages demo.

Current boundary: no accessibility support for assistive technologies. The demo uses fictional local data and has no backend or real login.
