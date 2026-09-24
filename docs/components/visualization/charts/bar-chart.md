# BarChart 柱状图


> **通用布局能力**：`RenderBarChart` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；柱间距和绘图区 padding 属于图表内部规格。详见[组件通用布局属性](../../common-layout-properties.md)。

`RenderBarChart` 适合分类对比，支持纵向柱图、横向条形图、普通堆叠和百分比堆叠。它按 `categories` 和每个序列的 `data` 下标对应；业务应保持数据长度和分类数量一致。

## API 总览

```ts
import {
  RenderBarChart,
  type BarChartDebugState,
  type BarChartOrientation,
  type BarChartSeries,
  type ChartAnnotation,
  type ChartAxisOptions,
  type ChartDataState,
  type ChartLegendMode,
  type ChartStackMode,
  type ChartTooltipMode,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderBarChart` | class | 分类柱图、横向条形图和堆叠柱图 render object。 |
| `BarChartSeries` | type | 柱图序列数据。 |
| `BarChartOrientation` | type | 图表方向：vertical 或 horizontal。 |
| `ChartAxisOptions` | type | 数值轴和分类轴配置。 |
| `ChartAnnotation` | type | 目标线、阈值区间等标注。 |
| `BarChartDebugState` | type | 调试状态。 |

最小装配顺序是：准备 `categories: string[]` 和等长的 `BarChartSeries[]`，创建 `RenderBarChart({ categories, series })`。分类过多时应改用横向条形图、分页或表格。

```ts
const chart = new RenderBarChart({
  categories: ['研发部', '产品部', '运营部'],
  series: [
    { name: '场景 B', data: [120, 96, 180] },
    { name: '场景 A', data: [42, 58, 20] },
  ],
  valueAxis: { unit: '人次', min: 0, tickCount: 4 },
  categoryAxis: { maxLabelLength: 4 },
  stackMode: 'none',
  legendMode: 'toggle',
})
```

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `categories` | `string[]` | 必填 | 分类标签。 |
| `series` | `BarChartSeries[]` | 必填 | 每个序列的数值数组。 |
| `annotations` | `ChartAnnotation[]` | `[]` | 目标线、阈值区间等。柱图常用 `axis: 'value'`。 |
| `valueAxis` | `ChartAxisOptions` | `{}` | 数值轴配置。 |
| `categoryAxis` | `ChartAxisOptions` | `{}` | 分类轴配置，常用 `maxLabelLength`。 |
| `orientation` | `BarChartOrientation` | `'vertical'` | `'vertical'` 或 `'horizontal'`。 |
| `stackMode` | `ChartStackMode` | `'none'` | `'none'`、`'stacked'`、`'percent'`。 |
| `showGrid` | `boolean` | `true` | 是否显示网格。 |
| `showLegend` | `boolean` | `true` | 是否显示图例。 |
| `legendMode` | `ChartLegendMode` | `'static'` | 图例是否可点击切换序列。 |
| `visibleSeries` | `number[]` | `undefined` | 初始可见序列。 |
| `dataState` / `emptyMessage` / `loadingMessage` / `errorMessage` | 状态配置 | 自动/默认文案 | 状态层配置。 |
| `showTooltip` | `boolean` | `true` | 是否显示 tooltip。 |
| `tooltipMode` | `ChartTooltipMode` | `'axis'` | `'axis'` 聚合同分类；`'item'` 显示单柱。 |
| `height` | `number` | `220` | 期望高度。宽度由父约束决定，无限宽时回退到 `360`。 |
| `maxBarThickness` | `number` | `undefined` | 单柱最大厚度，适合宽容器中的百分比堆叠图。 |
| `onSeriesVisibilityChange` | `(event) => void` | `undefined` | 图例显隐变化回调。 |
| `onBarClick` | `(bar) => void` | `undefined` | 点击柱子回调。 |

## 属性和方法

| API | 说明 |
| --- | --- |
| `setData(categories, series)` | 替换分类和序列并重新布局。 |
| `setAnnotations(annotations)` / `getAnnotations()` | 设置或读取标注。 |
| `setVisibleSeries(seriesIndexes?, reason?)` | 设置可见序列。 |
| `getVisibleSeries()` / `isSeriesVisible(index)` | 查询序列显隐状态。 |
| `debugState()` | 返回 plot、hover、tooltip、序列显隐、标注布局、柱布局、方向、堆叠模式、数值域和状态层。 |
| `dispose()` | 清理回调和 hover 状态。 |

## 堆叠和百分比

`stackMode: 'stacked'` 会在同一分类下堆叠可见序列。`stackMode: 'percent'` 会把同分类下可见序列转换为百分比堆叠。百分比柱图通常配合：

```ts
const chart = new RenderBarChart({
  categories: ['线上', '窗口'],
  series: [
    { name: '已完成', data: [64, 52] },
    { name: '待处理', data: [36, 48] },
  ],
  stackMode: 'percent',
  valueAxis: { min: 0, max: 100, unit: '%' },
})
```

## 使用建议

- 分类很多时优先使用横向条形图，或者改成表格/分页。
- 宽容器中的百分比堆叠图建议设置 `maxBarThickness`。
- 需要目标线、阈值区间时使用 `annotations`。
- 图例 toggle 适合少量序列；序列很多时使用外部筛选器。

## 相关文档

- [Charts 总览和公共类型](./overview.md)
- [DataGrid 数据表格](../../data/data-grid.md)
- Dashboard 看板示例
