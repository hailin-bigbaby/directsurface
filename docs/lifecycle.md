# Runtime and lifecycle

The host page owns the Canvas. `Application.mount('#app').run(window)` creates an `AppHost` that owns the runtime, event routing, overlay services, and the root render tree.

```text
HTMLCanvasElement
  → Application
  → AppHost
  → RenderWindow
  → RenderPage
  → layouts and widgets
```

Keep one active `AppHost` per Canvas. Save the value returned by `run()` and call `dispose()` when the page unmounts, a route replaces the Canvas, or hot reload recreates the app. Dispose the old host before mounting another one on the same Canvas.

A `RenderObject` receives constraints during layout, paints with the current theme, participates in hit testing when visible, and releases owned resources on disposal. Use `markNeedsLayout()` for changes that affect size or placement, and `markNeedsPaint()` for visual-only changes. See [layouts](layouts.md) for the parent-child constraint model.

For ordinary page changes, replace or update the page inside the running window; the host does not need to be recreated. The [basic app](../examples/basic-app/src/main.ts) shows a minimal startup and disposal pattern.
