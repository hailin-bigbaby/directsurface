# Layouts

DirectSurface uses parent-to-child constraints. A parent gives each child an allowed size, the child computes its size, and the parent places it. A child does not choose its global position.

`RenderStackPanel` arranges children in a row or column. The optional second argument to `addChild(child, flex)` allocates remaining space when the parent has a finite extent:

```ts
import { RenderButton, RenderStackPanel, RenderText } from 'ds-ui'

const column = new RenderStackPanel({
  orientation: 'vertical',
  padding: 24,
  spacing: 12,
})
column.addChild(new RenderText('Settings', { role: 'title' }))
column.addChild(new RenderButton({ label: 'Save', onClick: () => {} }))
```

Other exported panels include `RenderDockPanel` for edge regions and a fill area, `RenderGridPanel` for row and column tracks, `RenderWrapPanel` for wrapping, and `RenderScrollViewer` for a scrollable viewport. Start with one component that owns scrolling in each region.

When text, children, or dimensions change, layout must run again. Color, hover, and focus changes normally require only painting. See [runtime and lifecycle](lifecycle.md) for invalidation and [the component catalog](components.md) for available panels.
