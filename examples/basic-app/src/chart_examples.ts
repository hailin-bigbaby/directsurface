import {
  RenderAdaptiveGridPanel,
  RenderCard,
  RenderComboChart,
  RenderScatterChart,
  RenderStackPanel,
  RenderText,
} from 'directsurface'

/** Sample composition consumed through the installed package entry. */
export function createChartExamples() {
  const selection = new RenderText('Click a bar or point to inspect its original value.', { role: 'secondary', overflow: 'ellipsis' })
  const showSelection = (text: string) => { selection.text = text; selection.tooltip = text }
  const combo = new RenderComboChart({
    categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    series: [
      { id: 'actual', name: 'Completed', type: 'bar', data: [80, 105, null, 118, 132] },
      { id: 'target', name: 'Target', type: 'line', data: [100, 100, 110, 110, 120] },
    ],
    yAxis: { unit: ' tasks' }, legendMode: 'toggle', height: 260,
    onItemClick: item => showSelection(`${item.label}: ${item.seriesName} = ${item.value} tasks`),
  })
  const scatter = new RenderScatterChart({
    series: [
      { id: 'normal', name: 'Typical', data: [
        { id: 'a', label: 'Request A', x: 10, y: 32 },
        { id: 'b', label: 'Request B', x: 20, y: 46 },
        { id: 'c', label: 'Request C', x: 20, y: 54 },
        { id: 'd', label: 'Request D', x: 35, y: 70 },
      ] },
      { id: 'slow', name: 'Investigate', data: [{ id: 'e', label: 'Request E', x: 15, y: 130 }] },
    ],
    xAxis: { unit: ' KB' }, yAxis: { unit: ' ms' }, legendMode: 'toggle', height: 260,
    onPointClick: point => showSelection(`${point.label}: ${point.xValue} KB / ${point.yValue} ms`),
  })
  const grid = new RenderAdaptiveGridPanel({ minColumnWidth: 300, maxColumns: 2, columnGap: 12, rowGap: 12 })
  grid.addChild(new RenderCard({ title: 'Actual vs target', description: 'Shared axis; one missing bar.', child: combo }))
  grid.addChild(new RenderCard({ title: 'Request size vs duration', description: 'Repeated X values and one outlier.', child: scatter }))
  const panel = new RenderStackPanel({ orientation: 'vertical', spacing: 12, crossAxisAlignment: 'stretch' })
  panel.addChild(grid)
  panel.addChild(selection)
  return { root: panel, combo, scatter, selection }
}
