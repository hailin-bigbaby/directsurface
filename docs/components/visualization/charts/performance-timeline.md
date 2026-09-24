# PerformanceTimeline 性能时间线

> **与统一布局属性的关系**：性能时间线是接收绘制矩形的底层绘制函数，不是 `RenderBox` 组件；其 `rect` 参数表示绘制边界，不支持组件 `margin` 或槽位对齐。若需参与布局，应由承载它的 `RenderBox` 使用[组件通用布局属性](../../common-layout-properties.md)。

运行时性能浮层使用 `paintFramePerformanceTimelineChart()` 绘制帧耗时堆叠图。它不是 `RenderBox`，而是一个低层绘制函数，适合运行时监控这类已有绘制上下文的场景。


## API 总览

```ts
import {
  paintFramePerformanceTimelineChart,
  resolveFramePerformanceTimelineChartState,
  type FramePerformanceTimelineChartDebugState,
  type FramePerformanceTimelineChartOptions,
  type FramePerformanceTimelineRect,
  type FramePerformanceTimelineSample,
} from 'directsurface'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `paintFramePerformanceTimelineChart()` | function | 绘制帧耗时堆叠时间线。 |
| `resolveFramePerformanceTimelineChartState()` | function | 不绘制，解析可见样本、预算线和慢帧统计。 |
| `FramePerformanceTimelineSample` | type | 单帧耗时样本。 |
| `FramePerformanceTimelineChartOptions` | type | 绘制选项。 |
| `FramePerformanceTimelineChartDebugState` | type | 调试状态。 |
| `FramePerformanceTimelineRect` | type | 绘制矩形。 |

最小装配顺序是：在已有 `PaintContext` 和 `DrawList` 中调用绘制 helper。常规业务趋势图不要使用这个低层 helper，应使用 LineChart 或 BarChart。

```text
paintFramePerformanceTimelineChart(
  drawList,
  paintContext,
  { x, y, width, height },
  samples,
  { frameBudgetMs: 16.7, maxSamples: 80, showLegend: true },
)
```

## 数据结构

`FramePerformanceTimelineSample`：

```text
interface FramePerformanceTimelineSample {
  totalMs: number
  layoutMs: number
  paintMs: number
  compositeMs: number
}
```

`FramePerformanceTimelineChartOptions`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `frameBudgetMs` | `number` | `16.7` | 帧预算线。 |
| `maxFrameMs` | `number` | 自动 | y 轴最大参考值。 |
| `maxSamples` | `number` | `80` | 最多显示最近多少个样本，内部至少为 `10`。 |
| `showLegend` | `boolean` | `true` | 是否绘制图例。 |

## 颜色含义

- `layout`：布局耗时。
- `paint`：绘制耗时。
- `comp`：合成耗时。
- `other`：`totalMs - layoutMs - paintMs - compositeMs` 的剩余部分。

超过 `frameBudgetMs` 的慢帧会额外绘制危险色提示。

## 调试状态

`resolveFramePerformanceTimelineChartState()` 可在不绘制的情况下获得：

| 字段 | 说明 |
| --- | --- |
| `sampleCount` | 原始样本数量。 |
| `visibleSampleCount` | 实际显示样本数量。 |
| `frameBudgetMs` | 帧预算。 |
| `yMax` | y 轴最大值。 |
| `slowFrameCount` | 可见样本中的慢帧数量。 |

## 使用边界

- 该 helper 依赖已有 `DrawList` 和 `PaintContext`，不创建 render tree 节点。
- 适合性能浮层、诊断面板缩略图、快照预览。
- 不提供 hover tooltip、缩放、滚动或点击。
- 常规业务趋势图应使用 [LineChart 折线图](./line-chart.md) 或 [BarChart 柱状图](./bar-chart.md)。

## 相关文档

- [运行时诊断面板](../../../lifecycle.md)
- 绘制性能
- [Charts 总览和公共类型](./overview.md)
