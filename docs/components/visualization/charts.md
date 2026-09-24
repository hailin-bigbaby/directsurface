# Charts 图表

> **通用布局能力**：本页中的图表 `Render*` 组件实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；图例、坐标轴和 plot padding 是图表内部规格。详见[组件通用布局属性](../common-layout-properties.md)。

DirectSurface UI 内置一组轻量 Canvas 图表控件，面向业务看板、运行时诊断、趋势分析和小型统计展示。图表文档已拆分为独立页面；本页作为兼容入口和选型索引保留。

当前图表不是完整 BI 平台：不负责远程取数、数据透视、复杂图形语法、导出图片、动画过渡或无障碍表格替代内容；这些能力应由业务层或更高层页面组合提供。

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
  type ChartSeries,
  type DonutChartSegment,
  type FramePerformanceTimelineSample,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderLineChart` | class | 折线图、面积图、时间序列和 viewport。 |
| `RenderBarChart` | class | 分类柱图、条形图、堆叠和百分比堆叠。 |
| `RenderDonutChart` | class | 少量分类占比。 |
| `RenderSparkline` | class | 卡片内迷你趋势。 |
| `RenderChartRangeSlider` | class | 折线图 x viewport 范围选择器。 |
| `paintFramePerformanceTimelineChart()` | function | 运行时性能时间线绘制 helper。 |

最小装配顺序是：按数据形态选择具体图表，准备对应数据结构，显式处理 loading/empty/error 状态，并阅读对应分篇的属性、回调和性能边界。

## 选型

| 组件 / helper | 用途 | 文档 |
| --- | --- | --- |
| `RenderLineChart` | 折线图、面积图、时间序列、堆叠趋势、可平移缩放 viewport。 | [LineChart 折线图](./charts/line-chart.md) |
| `RenderBarChart` | 纵向柱图、横向条形图、堆叠柱图、百分比堆叠柱图。 | [BarChart 柱状图](./charts/bar-chart.md) |
| `RenderDonutChart` | 少量分类的环形占比。 | [DonutChart 环形图](./charts/donut-chart.md) |
| `RenderSparkline` | KPI 卡片中的迷你趋势线、面积线、小柱图。 | [Sparkline 迷你趋势](./charts/sparkline.md) |
| `RenderChartRangeSlider` | 与折线图配合的 x 轴范围选择器。 | [ChartRangeSlider 范围选择器](./charts/range-slider.md) |
| `paintFramePerformanceTimelineChart()` | 运行时性能浮层使用的帧耗时堆叠时间线绘制 helper。 | [PerformanceTimeline 性能时间线](./charts/performance-timeline.md) |

## 推荐阅读顺序

1. [Charts 总览和公共类型](./charts/overview.md)
2. 根据要展示的数据类型选择具体图表文档。
3. 需要大时间序列 viewport 时，同时阅读 [LineChart](./charts/line-chart.md) 和 [ChartRangeSlider](./charts/range-slider.md)。
4. 需要运行时性能浮层时，阅读 [PerformanceTimeline](./charts/performance-timeline.md)。

## 公共能力

所有图表共享这些基础设计：

- 通过 `dataState` 显示 `ready`、`loading`、`empty`、`error` 状态层。
- 主题色来自框架主题和图表调色板，业务可以在 series/segment 上覆盖 `color`。
- tooltip、hover 和图例 toggle 都是 Canvas 内绘制和命中，不创建 DOM。
- 图表本身不做列表虚拟化；大量图表卡片要由外层虚拟列表或分页控制。


## 相关文档

- Dashboard 看板示例
- [运行时诊断面板](../../lifecycle.md)
- 绘制性能
- [Slider 输入滑块](../input/slider.md)
- [DataGrid 数据表格](../data/data-grid.md)
