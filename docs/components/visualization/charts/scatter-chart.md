# ScatterChart 散点图


`RenderScatterChart` 用两个数值坐标表达相关性、分布和离群点。每个有效观测独立绘制，不连接成线，不按相同 X 聚合，也不采用折线抽稀。

## API 总览

```ts
import {
  RenderScatterChart,
  type RenderScatterChartOptions,
  type ScatterChartPoint,
  type ScatterChartSeries,
  type ScatterPointLayout,
  type ScatterChartDebugState,
} from 'directsurface'
```

最小装配顺序：准备数值 `x/y` 点序列，设置各轴单位，根据回调中的原始坐标与索引关联业务数据。

```ts
const chart = new RenderScatterChart({
  series: [
    { id: 'normal', name: '常规请求', data: [
      { id: 'a', label: '请求 A', x: 10, y: 32 },
      { id: 'b', label: '请求 B', x: 20, y: 46 },
      { id: 'c', label: '请求 C', x: 20, y: 54 },
    ] },
    { id: 'slow', name: '待分析请求', data: [{ id: 'd', label: '请求 D', x: 15, y: 130 }] },
  ],
  xAxis: { unit: 'KB' },
  yAxis: { unit: 'ms' },
  legendMode: 'toggle',
  onPointClick: point => console.log(point.id, point.xValue, point.yValue),
})
```

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `series` | `ScatterChartSeries[]` | 必填 | 每个序列包含 `id?`、`name`、`color?`、`data`。 |
| `xAxis` / `yAxis` | `ChartAxisOptions` | `{}` | 两个独立数值轴，支持固定 min/max、tickCount、单位和 labelFormatter。 |
| `pointRadius` | `number` | `4` | 绘制半径，限制在 1～32 像素；非有限值回退到 4。 |
| `hitRadius` | `number` | `8` | 命中半径，限制在 0～64 像素，实际不小于绘制半径；非有限值回退到 8。 |
| `showGrid` / `showLegend` | `boolean` | `true` | 网格和公共图例。 |
| `legendMode` | `ChartLegendMode` | `'static'` | `'toggle'` 可切换序列。 |
| `visibleSeries` | `number[]` | 全部可见 | 初始可见索引。 |
| `showTooltip` | `boolean` | `true` | 显示命中点的 X/Y；关闭后仍支持 hover 标记和点击。 |
| `dataState` | `ChartDataState` | 自动 | ready/loading/empty/error 状态层。 |
| `emptyMessage` / `loadingMessage` / `errorMessage` | `string` | 公共默认文案 | 状态文字。 |
| `height` | `number` | `220` | 期望高度，无限宽约束时宽度回退到 360。 |
| `onSeriesVisibilityChange` | `(event) => void` | 无 | 序列显隐变化回调。 |
| `onPointClick` | `(point: ScatterPointLayout) => void` | 无 | 点击有效可见点时触发。 |

支持通用 `RenderBox` 布局属性，见[通用布局属性](../../common-layout-properties.md)。

## 数据和命中规则

`ScatterChartPoint` 为 `{ x: number, y: number, id?: string, label?: string }`。构造及 `setSeries()` 克隆序列、颜色和每个点；X 或 Y 非有限时，该观测不参与域、绘制与命中。原始数组下标保持不变，不排序、不自动补零。

- 相同 X、相同 Y，甚至完全重合的多个点都会保留。命中选择半径内距离最近的点；距离相同时选择后绘制的点，完全重合时同样如此。
- 隐藏序列不参与坐标域和命中；固定坐标域外的点不显示、不命中。没有可见有效点时为 empty。
- `ScatterPointLayout.x/y` 为组件局部像素坐标，`xValue/yValue` 为原始数值；还包含 `id?`、`pointIndex`、`seriesIndex`、`seriesName`、`label`、`value`（等于原始 Y）。回调与调试返回副本。
- Tooltip 标题使用点的 `label`，未提供时使用序列名；X/Y 分别使用对应轴的 formatter 或 unit。加载和错误状态不触发数据点击。

## 方法与更新

| 方法 | 说明 |
| --- | --- |
| `setSeries(series)` | 替换数据并重新布局，按稳定 id 或名称及出现次序保留显隐。 |
| `setVisibleSeries(indexes?, reason?)` | 设置显隐，省略 indexes 表示全部显示。 |
| `getVisibleSeries()` / `isSeriesVisible(index)` | 查询显隐。 |
| `debugState()` | 返回坐标域、刻度、绘图区、图例、原始点对应的像素布局、hover 与 Tooltip。 |
| `dispose()` | 清理回调与交互状态。 |

普通属性修改后按影响调用 `markNeedsLayout()` 或 `markNeedsPaint()`。预测量不改变当前点位缓存；重新布局清除 hover，下一次移动重新命中。

## 边界与性能

此版本不提供时间轴、气泡大小编码、回归线、聚类、框选、缩放平移和点抽稀。点布局、绘制和命中搜索随有效点数增长；数据量大时由外部筛选限制可见观测，不能把保留所有点误认为已有大数据加速。重复点的视觉重叠不会改变原始数据；需要观察密度时应采用其他聚合展示。

## 相关文档

- [Charts 总览](./overview.md)
- [ComboChart 同轴柱线组合图](./combo-chart.md)
- [LineChart 折线图](./line-chart.md)
