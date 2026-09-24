# Charts 总览和公共类型

> **通用布局能力**：图表 `Render*` 组件实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；图例、坐标轴和绘图区 padding 属于图表内部规格。详见[组件通用布局属性](../../common-layout-properties.md)。

本页说明 DirectSurface UI 图表组件共享的数据结构、状态层、图例、tooltip、性能边界和使用规则。具体组件参数见：

- [LineChart 折线图](./line-chart.md)
- [BarChart 柱状图](./bar-chart.md)
- [DonutChart 环形图](./donut-chart.md)
- [Sparkline 迷你趋势](./sparkline.md)
- [ChartRangeSlider 范围选择器](./range-slider.md)
- [PerformanceTimeline 性能时间线](./performance-timeline.md)

## API 总览

```ts
import {
  RenderBarChart,
  RenderChartRangeSlider,
  RenderDonutChart,
  RenderLineChart,
  RenderSparkline,
  paintFramePerformanceTimelineChart,
  resolveFramePerformanceTimelineChartState,
  type BarChartSeries,
  type ChartAnnotation,
  type ChartAxisOptions,
  type ChartAxisType,
  type ChartDataState,
  type ChartLegendMode,
  type ChartSeries,
  type ChartTooltipMode,
  type ChartViewportChangeEvent,
  type DonutChartSegment,
  type RenderChartRangeSliderOptions,
  type RenderLineChartOptions,
  type SparklineVariant,
} from 'directsurface'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderLineChart` / `RenderBarChart` / `RenderDonutChart` | class | 主要图表组件。 |
| `RenderSparkline` | class | KPI 卡片中的迷你趋势图。 |
| `RenderChartRangeSlider` | class | 时间序列范围选择器。 |
| `ChartSeries` / `BarChartSeries` / `DonutChartSegment` | type | 折线/范围、柱图、环形图的数据结构。 |
| `ChartAxisOptions` / `ChartAxisType` | type | 坐标轴配置。 |
| `ChartDataState` | type | loading、empty、error、ready 状态层。 |
| `ChartAnnotation` | type | 折线图和柱图标注。 |
| `paintFramePerformanceTimelineChart()` | function | 性能时间线底层绘制函数。 |
| `resolveFramePerformanceTimelineChartState()` | function | 性能时间线状态解析函数。 |

最小装配顺序是：选择具体图表组件，准备对应 series/segments/categories，显式处理 `dataState`，并在数据替换、viewport 或显隐变化后使用组件提供的方法或触发布局/重绘。

## 公共数据结构

折线图和范围选择器使用 `ChartSeries`：

```text
interface ChartSeries {
  name: string
  data: Array<{ x: number | string | Date; y: number }>
  color?: Color
}
```

柱状图使用 `BarChartSeries`：

```text
interface BarChartSeries {
  name: string
  data: number[]
  color?: Color
}
```

环形图使用 `DonutChartSegment`：

```text
interface DonutChartSegment {
  label: string
  value: number
  color?: Color
}
```

## 坐标轴

`ChartAxisOptions`：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `tickCount` | `number` | 期望刻度数量。会取整并至少为 `1`。 |
| `labelFormatter` | `ChartAxisLabelFormatter` | 自定义刻度文本。优先级高于 `unit`。 |
| `unit` | `string` | 默认格式化后追加的单位，例如 `%`、`人次`。 |
| `min` | `number` | 强制轴最小值。 |
| `max` | `number` | 强制轴最大值。 |
| `showLabels` | `boolean` | 是否显示轴标签。`false` 时隐藏。 |
| `maxLabelLength` | `number` | 标签最大字符数，超出后省略。 |

`ChartAxisType`：

| 值 | 说明 |
| --- | --- |
| `'auto'` | 根据数据自动判断。 |
| `'linear'` | 数值轴。 |
| `'time'` | 时间轴，`Date` 或可解析时间的 x 值会转换为时间戳。 |
| `'category'` | 分类轴。 |

## 数据状态

`ChartDataState` 用于所有图表的状态层：

| 值 | 含义 | 默认文案 |
| --- | --- | --- |
| `'ready'` | 正常绘制数据。 | 空字符串 |
| `'loading'` | 数据加载中。 | `加载中` |
| `'empty'` | 没有可绘制数据。 | `暂无数据` |
| `'error'` | 数据加载或计算失败。 | `数据加载失败` |

未显式传 `dataState` 时，图表会根据是否有数据自动在 `ready` 和 `empty` 之间切换。请求失败时应显式设置 `dataState: 'error'`，不要用空数组表达异常。

```ts
const loadingChart = new RenderBarChart({
  categories: ['上午', '下午'],
  series: [{ name: '预约量', data: [32, 46] }],
  dataState: 'loading',
  loadingMessage: '指标加载中',
})
```

## 图例、tooltip 和点击

- `showLegend` 控制是否显示图例。
- `legendMode: 'static'` 只展示图例。
- `legendMode: 'toggle'` 允许点击图例切换序列或片段可见性。
- 折线图、柱图、环形图和 Sparkline 都支持 hover tooltip。
- 折线图通过 `onPointClick` 响应点点击。
- 柱图通过 `onBarClick` 响应柱子点击。
- 环形图通过 `onSegmentClick` 响应片段点击。

图例 toggle 适合少量序列。序列很多时，应使用外部筛选器或列表，不要依赖图例承担复杂筛选。

## 标注类型

`ChartAnnotation` 支持三种：

```text
{ type: 'line', axis: 'x' | 'y' | 'value', value, label? }
{ type: 'range', axis: 'x' | 'y' | 'value', min, max, label? }
{ type: 'event', x, label? }
```

`line` 适合阈值线，`range` 适合正常区间或警戒区间，`event` 适合时间轴事件标记。折线图和柱图支持标注。

## 性能边界

- 折线图大点位默认使用 `decimation: 'minMax'`，能保留峰谷特征并降低绘制点数。
- 大时间序列应配合 `xViewport` 和 `RenderChartRangeSlider`，不要一次把全量数据都当作可视范围展示。
- 实时数据建议调用数据更新方法，避免重建整个页面。
- 图表本身不做列表虚拟化。大量图表卡片要放在外层虚拟列表或分页容器中。
- tooltip 和 hover 会触发重绘；超高频数据页面中应减少同时可见图表数量。
- 柱图分类过多时会拥挤，优先改成分页表格、横向条形图或外部筛选。
- 环形图分类过多时可读性迅速下降，通常控制在 3-8 个片段。

## 常见问题

### 为什么修改属性后界面没有更新？

图表属性是普通可读写字段。直接修改 `area`、`orientation`、`height`、`showLegend` 等字段后，需要根据影响范围调用 `markNeedsPaint()` 或 `markNeedsLayout()`。替换数据、标注、显隐和 viewport 时优先使用对应方法。

### 什么时候用 Sparkline 而不是 LineChart？

只需要表达趋势方向、最新值附近变化、KPI 卡片中的迷你趋势时用 Sparkline。需要坐标轴、图例、tooltip 聚合、标注或 viewport 时用 `RenderLineChart`。

## 相关文档

- [Charts 图表入口](../charts.md)
- Dashboard 看板示例
- 绘制性能
