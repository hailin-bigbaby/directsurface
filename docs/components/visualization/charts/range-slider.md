# ChartRangeSlider 范围选择器

> **通用布局能力**：`RenderChartRangeSlider` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；轨道和手柄尺寸属于组件内部规格。详见[组件通用布局属性](../../common-layout-properties.md)。

`RenderChartRangeSlider` 用于选择折线图的 x viewport。它本身只维护范围，不会自动绑定某个折线图，需要业务在两个控件之间同步。


## API 总览

```ts
import {
  RenderChartRangeSlider,
  RenderLineChart,
  type ChartAxisType,
  type ChartDataState,
  type ChartDomain,
  type ChartRangeSliderDebugState,
  type ChartSeries,
  type ChartViewportChangeEvent,
  type RenderChartRangeSliderOptions,
} from 'directsurface'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderChartRangeSlider` | class | x viewport 范围选择器。 |
| `RenderChartRangeSliderOptions` | type | 构造参数。 |
| `ChartSeries` | type | 用于预览和推导 fullDomain 的数据。 |
| `ChartDomain` | type | x 轴范围。 |
| `ChartViewportChangeEvent` | type | 范围变化回调 payload。 |
| `ChartRangeSliderDebugState` | type | 调试状态。 |

最小装配顺序是：给 slider 和 line chart 传同一组 series，在 slider 的 `onViewportChange` 调用 `line.setXViewport()`，在 line chart 的 `onViewportChange` 调用 `slider.setViewport()`。

```ts
const series = [{
  name: '检验完成',
  data: [
    { x: new Date('2026-05-01T00:00:00'), y: 12 },
    { x: new Date('2026-05-01T01:00:00'), y: 18 },
    { x: new Date('2026-05-01T02:00:00'), y: 16 },
  ],
}]

const line = new RenderLineChart({
  series,
  xAxisType: 'time',
  enablePan: true,
  enableWheelZoom: true,
})

const slider = new RenderChartRangeSlider({
  series,
  xAxisType: 'time',
  onViewportChange: event => line.setXViewport(event.viewport, event.reason),
})

line.onViewportChange = event => slider.setViewport(event.viewport, event.reason)
```

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `series` | `ChartSeries[]` | 必填 | 预览和 fullDomain 推导使用的数据。 |
| `viewport` | `ChartDomain` | 全量域 | 初始选择范围。 |
| `fullDomain` | `ChartDomain` | 根据 series 推导 | 可选择的完整范围。 |
| `xAxisType` | `ChartAxisType` | `'auto'` | x 值解析方式。 |
| `height` | `number` | `64` | 期望高度。宽度由父约束决定，无限宽时回退到 `260`。 |
| `minSpan` | `number` | `undefined` | 最小范围跨度。 |
| `maxSpan` | `number` | `undefined` | 最大范围跨度。 |
| `showPreview` | `boolean` | `true` | 是否在轨道内绘制趋势预览。 |
| `dataState` / `emptyMessage` / `loadingMessage` / `errorMessage` | 状态配置 | 自动/默认文案 | 状态层配置。 |
| `onViewportChange` | `(event) => void` | `undefined` | 拖拽、跳转或 API 改变范围时触发。 |

## 方法和交互

| API | 说明 |
| --- | --- |
| `setSeries(series)` | 替换预览数据，并重新计算 fullDomain 和 viewport。 |
| `setViewport(viewport, reason?)` | 设置当前范围。 |
| `setFullDomain(domain?)` | 设置或清除显式完整范围。清除后从数据推导。 |
| `getViewport()` | 返回当前范围克隆。 |
| `getFullDomain()` | 返回完整范围克隆。 |
| `debugState()` | 返回 fullDomain、viewport、track、左右 handle、预览点、交互状态和状态层。 |
| `dispose()` | 清理回调、手势和焦点状态。 |

鼠标可拖拽左右 handle 调整范围，也可拖拽中间窗口平移范围；点击轨道会跳转选择窗口。控件继承 `FocusableControl`，聚焦时会绘制 focus ring。

## 联动规则

RangeSlider 和 LineChart 是独立控件。推荐双向同步：

- RangeSlider 的 `onViewportChange` 调用 `line.setXViewport(event.viewport, event.reason)`。
- LineChart 的 `onViewportChange` 调用 `slider.setViewport(event.viewport, event.reason)`。

同步时保留 `reason`，便于业务日志和调试区分 API、拖拽、缩放和轨道跳转。

## 相关文档

- [LineChart 折线图](./line-chart.md)
- [Charts 总览和公共类型](./overview.md)
- [Slider 输入滑块](../../input/slider.md)
