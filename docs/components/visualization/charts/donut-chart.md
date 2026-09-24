# DonutChart 环形图


> **通用布局能力**：`RenderDonutChart` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；内外半径和图例间距属于图表内部规格。详见[组件通用布局属性](../../common-layout-properties.md)。

`RenderDonutChart` 适合展示少量分类占比。分类很多、需要排序/筛选/分页时，应改用表格或柱图。

## API 总览

```ts
import {
  RenderDonutChart,
  type ChartDataState,
  type ChartLegendMode,
  type DonutChartDebugState,
  type DonutChartSegment,
  type DonutSegmentLayout,
} from 'directsurface'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderDonutChart` | class | 环形占比图 render object。 |
| `DonutChartSegment` | type | 片段数据，包含 label、value 和可选 color。 |
| `DonutSegmentLayout` | type | 片段布局调试信息。 |
| `DonutChartDebugState` | type | 调试状态。 |
| `ChartLegendMode` / `ChartDataState` | type | 图例和状态层配置。 |

最小装配顺序是：准备少量 `DonutChartSegment[]`，创建 `RenderDonutChart({ segments })`。片段过多时优先换成 `RenderBarChart` 或 `RenderDataGrid`。

```ts
const chart = new RenderDonutChart({
  segments: [
    { label: '已完成', value: 72 },
    { label: '处理中', value: 18 },
    { label: '异常', value: 6 },
  ],
  legendMode: 'toggle',
  innerRatio: 0.58,
})
```

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `segments` | `DonutChartSegment[]` | 必填 | 分类片段。 |
| `showLegend` | `boolean` | `true` | 是否显示图例。 |
| `legendMode` | `ChartLegendMode` | `'static'` | `'toggle'` 时图例可切换片段显示。 |
| `visibleSegments` | `number[]` | `undefined` | 初始可见片段。 |
| `dataState` / `emptyMessage` / `loadingMessage` / `errorMessage` | 状态配置 | 自动/默认文案 | 状态层配置。 |
| `showTooltip` | `boolean` | `true` | 是否显示 tooltip。 |
| `height` | `number` | `220` | 期望高度。宽度由父约束决定，无限宽时回退到 `280`。 |
| `innerRatio` | `number` | `0.58` | 内圆半径占外圆半径比例。 |
| `onSegmentVisibilityChange` | `(event) => void` | `undefined` | 片段显隐变化回调。 |
| `onSegmentClick` | `(segment) => void` | `undefined` | 点击片段回调。 |

## 属性和方法

| API | 说明 |
| --- | --- |
| `setSegments(segments)` | 替换片段并重新布局。 |
| `setVisibleSegments(segmentIndexes?, reason?)` | 设置可见片段。 |
| `getVisibleSegments()` / `isSegmentVisible(index)` | 查询片段显隐状态。 |
| `debugState()` | 返回 total、hoverIndex、segments 布局、tooltip、显隐状态、中心点、半径和状态层。 |
| `dispose()` | 清理回调和 hover 状态。 |

## 使用建议

- 控制分类数量，通常 3-8 个片段更容易阅读。
- 分类数量很多时用 `RenderBarChart` 或 `RenderDataGrid`。
- `legendMode: 'toggle'` 适合让用户临时隐藏某些片段。
- `innerRatio` 过小接近饼图，过大环形过细；默认 `0.58` 适合多数业务卡片。

## 相关文档

- [Charts 总览和公共类型](./overview.md)
- [BarChart 柱状图](./bar-chart.md)
- Dashboard 看板示例
