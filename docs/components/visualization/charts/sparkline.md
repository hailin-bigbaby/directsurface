# Sparkline 迷你趋势


> **通用布局能力**：`RenderSparkline` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；折线绘图区的 inset 属于图表内部规格。详见[组件通用布局属性](../../common-layout-properties.md)。

`RenderSparkline` 适合卡片内部的小型趋势，不绘制完整坐标轴。它用于表达变化方向、波动和最近值附近趋势，不适合承载精确分析。

## API 总览

```ts
import {
  RenderSparkline,
  type ChartDataState,
  type Color,
  type SparklineDebugState,
  type SparklineVariant,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderSparkline` | class | 迷你趋势图，支持 line、area、bar。 |
| `SparklineVariant` | type | 迷你图变体。 |
| `SparklineDebugState` | type | 调试状态。 |
| `ChartDataState` | type | loading、empty、error、ready 状态层。 |

最小装配顺序是：准备 `number[]`，创建 `RenderSparkline({ values })`。需要坐标轴、图例、标注或多序列时改用 `RenderLineChart`。

```ts
const sparkline = new RenderSparkline({
  values: [32, 44, 51, 48, 66, 72, 86],
  variant: 'area',
  height: 46,
  showLastValue: true,
})
```

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `values` | `number[]` | 必填 | 数值数组。非有限值会保留在调试状态中，但绘制时按安全值处理。 |
| `variant` | `SparklineVariant` | `'line'` | `'line'`、`'area'`、`'bar'`。 |
| `color` | `Color` | 主题图表第 1 色 | 主色。 |
| `height` | `number` | `48` | 期望高度。宽度由父约束决定，无限宽时回退到 `160`。 |
| `showLastValue` | `boolean` | `false` | 无 hover 时是否在右侧显示最后一个值。 |
| `showTooltip` | `boolean` | `true` | 是否显示 tooltip。 |
| `showCrosshair` | `boolean` | 与 `showTooltip` 相同 | 是否显示 hover 辅助线。 |
| `dataState` / `emptyMessage` / `loadingMessage` / `errorMessage` | 状态配置 | 自动/默认文案 | 状态层配置。 |
| `onPointClick` | `(index, value) => void` | `undefined` | 点击当前 hover 点回调。 |

## 方法

| API | 说明 |
| --- | --- |
| `setValues(values)` | 替换数据并重新布局。 |
| `debugState()` | 返回 values、variant、hoverIndex、crosshair、tooltip、状态层和点布局。 |
| `dispose()` | 清理点击回调。 |

## 变体

| 变体 | 说明 |
| --- | --- |
| `'line'` | 单线趋势。 |
| `'area'` | 折线下方带渐变填充。 |
| `'bar'` | 小柱图。负值使用危险色。 |

## 使用建议

- KPI 卡片、指标列表、状态摘要优先使用 Sparkline。
- 需要坐标轴、图例、标注、viewport 或多序列时改用 `RenderLineChart`。
- Sparkline 不做抽稀，值很多时应由业务先聚合。

## 相关文档

- [Charts 总览和公共类型](./overview.md)
- [LineChart 折线图](./line-chart.md)
- Dashboard 看板示例
