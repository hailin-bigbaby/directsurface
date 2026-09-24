# Framework containers and developer tools

These `Render*` exports support layout composition and diagnostics. They are public values, but several are infrastructure rather than standalone input controls.

## Layout helpers

- `RenderClip` clips a child to a bounded paint region.
- `RenderSpacer` reserves a fixed or flexible gap inside layouts such as `RenderStackPanel`.
- `RenderAdaptiveSidebarPanel` arranges a sidebar and main content, with a compact layout when the available width narrows.
- `RenderOverlayHost` places an overlay over a normally laid-out base child.

Start with [layouts](../layouts.md) for the constraint model. The public declarations provide the exact options for each helper.

## Inspecting the running UI

`RenderDevToolsWindow` hosts framework diagnostics. Most applications open it through the `AppHost` UI services rather than constructing it in a page. Layout inspection is represented by `RenderLayoutInspectorPanel` and `RenderLayoutInspectorView`; runtime diagnostics use `RenderRuntimeDiagnosticsPanel` and `RenderRuntimeDiagnosticsView`. `RenderRuntimeDiagnosticsSnapshotViewer` displays a saved diagnostic snapshot. `RenderObjectInspector` expands object values for debugging.

The normal startup path remains `Application.mount(...).run(window)`. Enable layout inspection through the application options when needed, keep the returned host, and release it when the host Canvas is removed. See [runtime and lifecycle](../lifecycle.md).
