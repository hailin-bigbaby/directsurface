# LineChart 折线图


> **通用布局能力**：`RenderLineChart` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；坐标轴和绘图区 padding 属于图表内部规格。详见[组件通用布局属性](../../common-layout-properties.md)。

`RenderLineChart` 支持 category、linear、time 三类横轴，适合趋势图、面积图、堆叠面积图和带范围 viewport 的大时间序列。

## API 总览

```ts
import {
  RenderChartRangeSlider,
  RenderLineChart,
  type ChartAnnotation,
  type ChartAxisOptions,
  type ChartAxisType,
  type ChartDataState,
  type ChartDecimationMode,
  type ChartDomain,
  type ChartLegendMode,
  type ChartSeries,
  type ChartStackMode,
  type ChartTooltipMode,
  type ChartViewportChangeEvent,
  type ChartWheelZoomModifier,
  type LineChartDebugState,
  type RenderLineChartOptions,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderLineChart` | class | 折线图和面积图 render object。 |
| `RenderLineChartOptions` | type | 构造参数。 |
| `ChartSeries` | type | 折线图数据序列。 |
| `ChartAxisOptions` / `ChartAxisType` | type | 坐标轴配置和 x 轴类型。 |
| `ChartDomain` / `ChartViewportChangeEvent` | type | x viewport 范围和变化回调。 |
| `ChartAnnotation` | type | 阈值线、区间和事件标注。 |
| `LineChartDebugState` | type | 调试状态。 |

最小装配顺序是：准备 `ChartSeries[]`，创建 `RenderLineChart({ series })`。大时间序列应配置 `xViewport`，并可与 `RenderChartRangeSlider` 双向同步。

```ts
const chart = new RenderLineChart({
  series: [
    {
      name: '场景 B量',
      data: [
        { x: '周一', y: 120 },
        { x: '周二', y: 156 },
        { x: '周三', y: 142 },
      ],
    },
  ],
  xAxisType: 'category',
  yAxis: { unit: '人次', min: 0, tickCount: 4 },
  area: true,
  legendMode: 'toggle',
  showTooltip: true,
  height: 240,
})
```

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `series` | `ChartSeries[]` | 必填 | 数据序列。构造和 `setSeries()` 都会克隆输入。 |
| `xAxis` | `ChartAxisOptions` | `{}` | x 轴配置。 |
| `yAxis` | `ChartAxisOptions` | `{}` | y 轴配置。 |
| `area` | `boolean` | `false` | 是否绘制面积填充。 |
| `showGrid` | `boolean` | `true` | 是否显示网格线。 |
| `showLegend` | `boolean` | `true` | 是否显示图例。 |
| `legendMode` | `ChartLegendMode` | `'static'` | 图例模式。`'toggle'` 可点击隐藏/显示序列。 |
| `visibleSeries` | `number[]` | `undefined` | 初始可见序列索引。未传表示全部可见。 |
| `annotations` | `ChartAnnotation[]` | `[]` | 阈值线、区间、事件标注。 |
| `stackMode` | `ChartStackMode` | `'none'` | `'none'`、`'stacked'`、`'percent'`。 |
| `dataState` | `ChartDataState` | 自动 | 状态层。 |
| `emptyMessage` | `string` | `暂无数据` | 空数据文案。 |
| `loadingMessage` | `string` | `加载中` | 加载中文案。 |
| `errorMessage` | `string` | `数据加载失败` | 错误文案。 |
| `showTooltip` | `boolean` | `true` | 是否显示 tooltip。 |
| `tooltipMode` | `ChartTooltipMode` | `'axis'` | `'axis'` 聚合同一 x；`'item'` 只显示单点。 |
| `showCrosshair` | `boolean` | 与 `showTooltip` 相同 | 是否显示十字/辅助线。 |
| `height` | `number` | `220` | 期望高度。宽度由父约束决定，无限宽时回退到 `360`。 |
| `xAxisType` | `ChartAxisType` | `'auto'` | `'auto'`、`'linear'`、`'time'`、`'category'`。 |
| `xViewport` | `ChartDomain` | 全量 x 域 | 当前可见 x 范围。 |
| `enablePan` | `boolean` | `false` | 是否允许拖拽平移 x viewport。 |
| `enableWheelZoom` | `boolean` | `false` | 是否允许滚轮缩放 x viewport。 |
| `wheelZoomModifier` | `ChartWheelZoomModifier` | `'ctrlOrMeta'` | 触发滚轮缩放需要的修饰键。 |
| `wheelZoomSpeed` | `number` | `0.12` | 滚轮缩放速度。 |
| `minXSpan` | `number` | `undefined` | x viewport 最小跨度。 |
| `maxXSpan` | `number` | `undefined` | x viewport 最大跨度。 |
| `decimation` | `ChartDecimationMode` | `'minMax'` | 点位抽稀模式。`'minMax'` 适合大序列。 |
| `onViewportChange` | `(event) => void` | `undefined` | viewport 改变回调。 |
| `onSeriesVisibilityChange` | `(event) => void` | `undefined` | 图例显隐变化回调。 |
| `onPointClick` | `(point) => void` | `undefined` | 点击数据点回调。 |

## 属性和方法

| API | 说明 |
| --- | --- |
| `series`、`xAxis`、`yAxis`、`area`、`showGrid`、`showLegend`、`legendMode`、`stackMode` 等 | 可读写属性。直接修改后需要按影响范围调用 `markNeedsPaint()` 或 `markNeedsLayout()`。 |
| `setSeries(series)` | 替换数据序列并重新布局。 |
| `setAnnotations(annotations)` | 替换标注并重新布局。 |
| `getAnnotations()` | 返回标注克隆。 |
| `setVisibleSeries(seriesIndexes?, reason?)` | 设置可见序列；不传表示全部可见。 |
| `getVisibleSeries()` | 返回当前可见序列索引。 |
| `isSeriesVisible(index)` | 判断序列是否可见。 |
| `setXViewport(viewport?, reason?)` | 设置 x viewport；不传表示恢复全量域。 |
| `resetXViewport()` | 恢复全量 x 域。 |
| `getXViewport()` | 返回当前 x viewport 克隆。 |
| `getFullXDomain()` | 返回完整 x 域克隆。 |
| `debugState()` | 返回 plot、hover、crosshair、tooltip、序列显隐、标注布局、点布局、轴域和状态层。 |
| `dispose()` | 清理回调和手势状态。 |

## viewport、pan 和 wheel zoom

大时间序列应通过 `xViewport` 限制可视范围。开启 `enablePan` 后，用户可在 plot 区域拖拽平移；开启 `enableWheelZoom` 后，用户可滚轮缩放。

默认 `wheelZoomModifier` 是 `'ctrlOrMeta'`，因此普通滚轮仍交给滚动容器。可选值包括 `'none'`、`'ctrl'`、`'meta'`、`'shift'`、`'alt'`、`'ctrlOrMeta'`。

`onViewportChange` 的 `reason` 可能是：

- `'api'`
- `'pan'`
- `'wheel'`
- `'reset'`
- `'rangePan'`
- `'rangeResize'`
- `'rangeJump'`

与范围选择器联动见 [ChartRangeSlider 范围选择器](./range-slider.md)。

## 标注

折线图支持 `line`、`range` 和 `event` 标注：

```text
{ type: 'line', axis: 'x' | 'y' | 'value', value, label? }
{ type: 'range', axis: 'x' | 'y' | 'value', min, max, label? }
{ type: 'event', x, label? }
```

标注会参与布局，并在 `debugState().annotations` 中返回像素位置。

## 性能建议

- 大点位默认使用 `decimation: 'minMax'`，保留峰谷特征。
- 大时间序列配合 `xViewport` 和 `RenderChartRangeSlider`。
- 多序列图例 toggle 适合少量序列；序列很多时使用外部筛选器。
- hover、tooltip、crosshair 会触发重绘，超高频页面要控制可见图表数量。

## 相关文档

- [Charts 总览和公共类型](./overview.md)
- [ChartRangeSlider 范围选择器](./range-slider.md)
- Dashboard 看板示例
