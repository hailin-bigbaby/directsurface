# ComboChart 同轴柱线组合图


`RenderComboChart` 在同一分类坐标和同一 Y 数值轴上绘制分组柱形与折线，适合实际数量与目标趋势的对比。各序列必须使用相同单位；不同单位的数据应分图展示。

## API 总览

```ts
import {
  RenderComboChart,
  type RenderComboChartOptions,
  type ComboChartSeries,
  type ComboChartItem,
  type ComboChartDebugState,
  type CartesianChartOptions,
  type CartesianChartDebugState,
} from 'directsurface'
```

最小装配顺序：准备 `categories` 和按下标对应的数据，使用 `type: 'bar' | 'line'` 指定绘制方式，按需设置坐标轴和点击回调。

```ts
const chart = new RenderComboChart({
  categories: ['周一', '周二', '周三'],
  series: [
    { id: 'actual', name: '实际', type: 'bar', data: [80, null, 120] },
    { id: 'target', name: '目标', type: 'line', data: [100, 100, 110] },
  ],
  yAxis: { unit: '项' },
  legendMode: 'toggle',
  onItemClick: item => console.log(item.kind, item.categoryIndex, item.value),
})
```

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `categories` | `string[]` | 必填 | 分类标签；相同文字的分类仍按下标区分。 |
| `series` | `ComboChartSeries[]` | 必填 | 包含 `id?`、`name`、`type`、`data: (number \| null)[]`、`color?`。 |
| `xAxis` | `ChartAxisOptions` | `{}` | 分类标签的 `tickCount`、`unit`、`labelFormatter`、`showLabels`、`maxLabelLength`；分类轴不应用 `min/max`。 |
| `yAxis` | `ChartAxisOptions` | `{}` | 所有柱线序列共用的数值轴。支持固定 `min/max`、格式化及单位。 |
| `showGrid` / `showLegend` | `boolean` | `true` | 网格和公共图例。 |
| `legendMode` | `ChartLegendMode` | `'static'` | `'toggle'` 可切换柱或线序列显隐。 |
| `visibleSeries` | `number[]` | 全部可见 | 初始序列索引。 |
| `showTooltip` | `boolean` | `true` | 是否绘制数据提示；不影响点击。 |
| `tooltipMode` | `ChartTooltipMode` | `'axis'` | `'axis'` 聚合同分类所有有效柱线值；`'item'` 仅显示命中项。 |
| `maxBarThickness` | `number` | 自动 | 限制单柱宽度，非有限或非正值按自动处理。 |
| `dataState` | `ChartDataState` | 自动 | ready/loading/empty/error 状态层。 |
| `emptyMessage` / `loadingMessage` / `errorMessage` | `string` | 公共默认文案 | 状态层文字。 |
| `height` | `number` | `220` | 期望高度；无限宽约束时宽度回退到 360。 |
| `onSeriesVisibilityChange` | `(event) => void` | 无 | 显隐变更事件，包含原因和当前可见索引。 |
| `onItemClick` | `(item: ComboChartItem) => void` | 无 | 直接命中柱形或折线标记时触发。 |

支持通用 `RenderBox` 布局属性，见[通用布局属性](../../common-layout-properties.md)。

## 数据和交互规则

- 构造及 `setData()` 克隆标签、序列、颜色和数据。缺少的数组项、`null`、非有限数值视为缺测；多于分类数的数据忽略，不参与数值域。
- 缺测柱不绘制，缺测折线断开；零值保留在聚合 Tooltip 中，但零高度柱不可点击。
- 同分类柱组围绕分类中心排列，折线标记位于同一中心。存在可见柱序列时自动数值域包含零；显隐改变后统一重算坐标域、柱宽和点位。
- `axis` 模式悬停分类空白处也能查看柱线值，但点击空白不会触发 `onItemClick`。折线标记在柱形上方绘制和命中；标记采用 8 像素命中半径。
- 固定 Y 域会裁剪图形。聚合 Tooltip 仍报告该分类的原始值；点击仅作用于可见柱形区域或域内折线标记。
- `ComboChartItem` 包含 `kind`、`seriesIndex`、`categoryIndex`、`pointIndex`、`seriesName`、`label`、`value` 和局部像素 `x/y`。`pointIndex` 等于分类索引；柱项的 `x/y` 表示分类中心和原始数值位置，柱形边界见 `debugState().bars`。
- loading/empty/error 状态阻止数据交互，图例仍可切换。所有序列隐藏时自动显示 empty。

## 方法与更新

| 方法 | 说明 |
| --- | --- |
| `setData(categories, series)` | 替换数据并重新布局，优先按稳定 `id` 保留显隐；无 id 时按名称及出现次序匹配。 |
| `setVisibleSeries(indexes?, reason?)` | 设置显隐；省略 indexes 表示全部显示，reason 默认为 `'api'`。 |
| `getVisibleSeries()` / `isSeriesVisible(index)` | 查询显隐。 |
| `debugState()` | 返回坐标域、绘图区、刻度、图例边界、柱形、折线点、hover 分类和 Tooltip。 |
| `dispose()` | 释放回调和交互状态。 |

普通属性变更后按影响调用 `markNeedsLayout()` 或 `markNeedsPaint()`。预测量不改变当前绘图缓存；正式重新布局会清除 hover，下一次指针移动重新命中。

## 边界与性能

此版本为纵向、同轴、分组柱线组合，不提供双轴、堆叠、时间轴、缩放平移、标注或自动抽稀。所有分类按完整数据布局，适合有限分类的看板；分类很多时使用外部分页或筛选。图例换行、省略和极小尺寸行为与 [Charts 总览](./overview.md) 一致。

## 相关文档

- [BarChart 柱状图](./bar-chart.md)
- [LineChart 折线图](./line-chart.md)
- [ScatterChart 散点图](./scatter-chart.md)
