# Layouts

DirectSurface uses parent-to-child constraints. A parent gives each child an allowed size, the child computes its size, and the parent places it. A child does not choose its global position.

`RenderStackPanel` arranges children in a row or column. The optional second argument to `addChild(child, flex)` allocates remaining space when the parent has a finite extent:

```ts
import { RenderButton, RenderStackPanel, RenderText } from 'directsurface'

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

## Scrollbar feedback

Shared scrollbars distinguish the track from the thumb. Hovering an empty part of the track highlights the track; the thumb uses its hover color only when the pointer is over its hit area. Dragging keeps the pressed feedback even when the pointer leaves the track. These states apply to both axes in ScrollViewer and other controls using shared scrollbars. Hover changes repaint without scrolling or relayout, and do not change the hit area, track-click navigation, or drag distance.

## Measurement and committed layout

`measure()` predicts the requested size. It must not switch active children, clear focus, close popups, commit paint caches, or invoke loaded callbacks. Custom components should use `context.pass` to distinguish prediction from committed layout in `performLayout()`. The framework restores common geometry fields after prediction; it does not automatically restore every custom field.

`RenderText` and `RenderParagraph` retain the most recently laid-out ellipsis, fitted font size and wrapped lines while measuring another width or theme. Apply changed constraints through a real layout before painting the new geometry.

## GridPanel placement and track limits

`RenderGridPanel` supports `gridPx`, `gridAuto` and `gridFr` tracks. Children with both `row` and `column` explicitly set may overlap for intentional layering. Automatic placement checks the whole row/column span and avoids every fully specified placement, including children added later. With only `column` set, it searches subsequent rows in that column. With only `row` set, it starts at the first column of that row and continues to later rows if necessary. Indices are nonnegative integers; spans are at least one, and column spans cannot exceed the column count.

Fraction tracks reserve their `min` first, then share remaining space by weight. Tracks reaching `max` stop growing and the remaining space is redistributed to tracks with capacity. Empty space is allowed when all tracks reach their caps. Spanning natural content counts fixed pixel tracks and gaps, grows available `auto` tracks first, then available `fr` tracks.

Fixed pixel tracks and fraction tracks in bounded space skip content measurements that cannot affect their size. Auto tracks and unbounded fraction tracks still measure content. This is not a cross-frame cache: changed content and fonts are measured again as needed. Child positioning and committed layout happen after track sizes are resolved.

## Natural row heights and two-phase layouts

`RenderUniformGrid` measures unbounded natural row height using the width the child will actually receive. This includes an explicit child width and a maximum width with non-stretch alignment, so wrapped narrow text leaves enough room for the next row.

`RenderAdaptiveGridPanel` predicts row heights before laying out the final slots. `RenderWrapPanel` similarly predicts runs before committing their geometry. Their preliminary passes do not publish temporary child layouts or trigger `onLoaded`. A stretched child's first loaded callback therefore sees its allocated row height. `onLoaded` remains a first-attached-layout callback, not a recurring size-change notification or a guarantee that the entire render tree will never resize afterward.

## Adaptive sidebar state

`RenderAdaptiveSidebarPanel.measure()` may evaluate other widths and breakpoints without changing the current `resolvedMode`, active subtree, focus or open popups. `debugState()` retains the last committed layout. Switching sidebars and cleaning up the inactive subtree happen only during committed layout. With unbounded height, child heights are measured before committing the active sidebar and main content.

## Replacing DockPanel content

`RenderDockPanel.setFill(next)` removes metadata for the previous fill child, clears its parent and detaches it from the runtime. It does not automatically dispose that child: the caller decides whether to reuse or dispose it. Repeated replacement does not retain former fill children in `childData`. `setFill(undefined)` clears the fill area while keeping edge-docked children.

## Splitter limits and small viewports

Changing `RenderSplitter.minRatio` or `maxRatio` immediately clamps the current ratio and requests layout. Programmatic updates do not invoke `onChange`, which represents dragging or keyboard interaction. Keep `0 <= minRatio <= maxRatio <= 1`.

When the available main-axis size is smaller than `splitterSize`, the visible separator shrinks to the available extent and both content slots become zero-sized. Children never receive negative slot constraints; dragging cannot change the ratio when no distributable space remains. Layout, separator painting and hit testing use the same split geometry, independent of child margins or alignment.
