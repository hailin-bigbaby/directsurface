# Slider 滑块

> **通用布局能力**：`RenderSlider` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；轨道、thumb 和主题高度是内部绘制规格。详见[组件通用布局属性](../common-layout-properties.md)。


`RenderSlider` 用于在连续范围内调整一个数值，例如缩放、透明度、阈值、进度、音量。

它是单值滑块，不是范围选择器。需要选择一个区间时使用图表范围滑块或业务自定义控件；需要少量离散选项时使用 `RenderSegmentedControl` 或 [ComboBox](../selector/combo-box.md)。

## API 总览

主类：

- `RenderSlider`

导入：

```ts
import { RenderSlider } from 'directsurface'
```

`RenderSlider` 的构造参数是公开 options 对象，但当前没有单独导出的 Slider options 类型。业务代码直接按本文参数表传入对象。

`RenderSlider` 实现 `ValueEditor<number>`，可以直接绑定数值字段。`setValue()` 和 `value` 赋值保持静默；点击、键盘调整和拖动发布 `reason: 'input'`。拖动期间会连续发布正式值变化，因此把表单校验配置为 change 时也会连续校验；高成本业务规则更适合放在 blur 或 submit 阶段。

## 何时使用

使用 `RenderSlider`：

- 数值在一个明确范围内。
- 用户更关心快速调节，而不是精确录入。
- 可接受拖动过程中持续触发 `onChange`。
- 值可以用视觉进度表达。

不要使用：

- 金额、年龄、页码等需要精确输入的值，优先使用 [NumberInput](./number-input.md)。
- 少量互斥选项，例如“日/周/月”，优先使用 `RenderSegmentedControl` 或 [RadioGroup](./checkbox-switch-radio.md)。
- 大量离散业务选项，使用 [ComboBox](../selector/combo-box.md)。
- 时间范围、图表 viewport 区间，使用图表范围滑块。

## 最小示例

```ts
import { RenderSlider } from 'directsurface'

const zoomState = {
  zoom: 100,
}

const zoom = new RenderSlider({
  value: zoomState.zoom,
  min: 50,
  max: 200,
  step: 10,
  label: '缩放',
  onChange: value => {
    zoomState.zoom = value
  },
})
```

隐藏当前值：

```ts
import { RenderSlider } from 'directsurface'

const opacity = new RenderSlider({
  value: 0.5,
  min: 0,
  max: 1,
  step: 0.01,
  showValue: false,
})
```

禁用：

```ts
import { RenderSlider } from 'directsurface'

const disabled = new RenderSlider({
  value: 30,
  min: 0,
  max: 100,
  disabled: true,
})
```

## 构造参数

```ts
const slider = new RenderSlider({
  value: 0.5,
  min: 0,
  max: 1,
  step: 0.1,
  disabled: false,
  label: '阈值',
  showValue: true,
  onChange: value => {
    state.threshold = value
  },
})
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `value` | `number` | 必填 | 初始值。会被限制到 `[min, max]`。 |
| `min` | `number` | `0` | 最小值。 |
| `max` | `number` | `1` | 最大值。 |
| `step` | `number` | `undefined` | 键盘步进值。必须大于 0 才生效；鼠标拖动不按 step 吸附。 |
| `disabled` | `boolean` | `false` | 是否禁用。 |
| `label` | `string` | `''` | 左侧标签。 |
| `onChange` | `(value: number) => void` | `undefined` | 用户拖动、点击或键盘调整后触发。 |
| `showValue` | `boolean` | `true` | 是否在右侧显示当前值。 |

## 属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `value` | `number` | 当前值。赋值会限制到 `[min, max]` 并请求重绘，但不触发 `onChange`。 |
| `min` | `number` | 最小值。直接修改不会自动重新限制现有值。 |
| `max` | `number` | 最大值。直接修改不会自动重新限制现有值。 |
| `step` | `number \| undefined` | 键盘步进值。 |
| `label` | `string` | 左侧标签。直接修改不会自动触发布局。 |
| `onChange` | `(value: number) => void \| undefined` | 用户调整回调。 |
| `showValue` | `boolean` | 是否显示当前值。直接修改后需要触发布局或重建。 |
| `disabled` | `boolean` | 禁用态。赋值会同步 focusable disabled 状态。 |

动态修改 `label/showValue/min/max/step` 时，建议重建 slider，或由父组件显式触发布局和绘制。

## 数值规则

`RenderSlider` 的值只做范围限制：

```ts
const slider = new RenderSlider({
  value: 120,
  min: 0,
  max: 100,
})

slider.value // 100
```

限制规则：

- 小于 `min` 时取 `min`。
- 大于 `max` 时取 `max`。
- `min === max` 时，绘制位置按 0 处理。
- 鼠标拖动值按指针在 track 上的比例线性计算。
- 鼠标拖动不会按 `step` 吸附。
- 键盘调整才使用 `step` 或自动推导的 keyboard step。

直接设置 `value` 不触发 `onChange`。只有用户交互通过内部 `_setValue(..., true)` 更新时才触发。

## 键盘步进

如果传入 `step > 0`，键盘使用该 step。

如果没有传入有效 step，会按范围推导：

| 范围大小 | 自动 keyboard step |
| --- | --- |
| `abs(max - min) <= 1` | `0.01` |
| `abs(max - min) <= 10` | `0.1` |
| 其他 | `max(1, range / 100)` |

键盘行为：

| 按键 | 行为 |
| --- | --- |
| `ArrowLeft` / `ArrowDown` | 减少一个 step。 |
| `ArrowRight` / `ArrowUp` | 增加一个 step。 |
| `PageDown` | 减少 `step * 10`。 |
| `PageUp` | 增加 `step * 10`。 |
| `Home` | 设置为 `min`。 |
| `End` | 设置为 `max`。 |

每次键盘调整都会触发 `onChange`。

## 鼠标和手势

基本行为：

- 只响应主按钮。
- pointer down 命中 slider 时请求焦点。
- 点击 track 会把值设置到点击位置。
- 水平拖动时持续更新值并触发 `onChange`。
- pointer up/cancel 会释放 pressed、dragging 和 pointer capture。
- pointer leave 只清理 hover，不会中断已经按下的拖动序列。

滚动容器内的手势判断：

- 如果事件提供 gesture arena，pointer down 后先进入 pending。
- 移动距离小于 `DRAG_SLOP` 时不抢占手势。
- 水平移动超过阈值时接受手势、捕获指针并开始拖动。
- 垂直移动超过阈值时拒绝手势，让父级 ScrollView 处理滚动。
- 只点击不拖动时，pointer up 会接受手势并执行一次值更新。

这使 slider 可以安全放在纵向滚动面板中：横向调值归 slider，纵向滚动归父容器。

## 显示值格式

`showValue === true` 时，右侧显示格式化后的值。

格式规则：

- 根据 `step` 或自动 keyboard step 推导小数位。
- `range <= 100` 且 step 有小数位时，使用对应小数位 `toFixed(decimals)`。
- `range <= 100` 且当前值不是整数时，显示 1 位小数。
- 其他情况四舍五入为整数。

示例：

- `min: 0, max: 1, step: 0.01` 显示 `0.50`。
- `min: 0, max: 10, step: 0.1` 显示 `5.0`。
- `min: 0, max: 200` 显示整数。

## 布局和绘制

布局：

- 宽度：有限约束下填满 `constraints.maxWidth`；无限约束下默认 `200`。
- 高度：使用主题 `SliderStyleTokens.height`。
- 如果有 `label`，track 左侧会为 label 测量并预留宽度。
- 如果 `showValue` 为 true，track 右侧会为格式化值测量并预留宽度。
- 实际 track 宽度 = 总宽度 - labelWidth - valueWidth。

绘制顺序：

1. 可选 label。
2. 可选 value 文本。
3. track 背景。
4. 从起点到当前值的 fill。
5. grab 圆点。
6. grab 边框。
7. focus ring。

label 和 value 不自动换行、不省略。空间不足时 track 会变窄，业务侧应保证 slider 宽度足够。

## 主题来源

`RenderSlider` 使用 `deriveSliderStyle(theme)`：

| token | 说明 |
| --- | --- |
| `trackBg` | 未填充轨道背景。 |
| `fillBg` | 已填充轨道背景。 |
| `grabBg` | 滑块圆点背景。 |
| `grabBorder` | 滑块圆点边框。 |
| `labelText` | 左侧 label 文本色。 |
| `valueText` | 右侧 value 文本色。 |
| `fontSize` / `fontFamily` | 文本字体。 |
| `itemSpacing` | label/value 与 track 的间距。 |
| `height` | 控件高度，默认来自 `theme.controlHeight`。 |
| `trackHeight` | 轨道高度，当前为 `4`。 |

状态颜色使用 `normal`、`hovered`、`pressed`、`disabled`。

## 生命周期

`RenderSlider` 继承 `FocusableControl`，并参与 gesture arena。

`dispose()` 会：

- 释放 pointer capture。
- 调用父类释放焦点相关状态。
- 清空 `onChange`。

如果 slider 被动态移除，应确保走正常 dispose 流程。

## 与相关组件的区别

| 组件 | 用途 |
| --- | --- |
| `RenderSlider` | 单个连续数值调节。 |
| [NumberInput](./number-input.md) | 精确数字输入和步进。 |
| `RenderSegmentedControl` | 少量离散选项切换。 |
| `RenderChartRangeSlider` | 图表 viewport 区间选择。 |
| [ProgressBar](../visualization/charts.md) | 只读进度展示，不负责输入。 |

## 常见组合

Slider + NumberInput：

```ts
const volume = new RenderSlider({
  value: state.volume,
  min: 0,
  max: 100,
  step: 1,
  label: '音量',
  onChange: value => {
    state.volume = value
  },
})

const volumeInput = new RenderNumberInput({
  value: state.volume,
  min: 0,
  max: 100,
  step: 1,
  suffixText: '%',
  onChange: value => {
    state.volume = value
  },
})
```

阈值设置：

```ts
const threshold = new RenderSlider({
  value: 0.75,
  min: 0,
  max: 1,
  step: 0.01,
  label: '阈值',
})
```

## 性能边界

- 绘制时会测量 label 和当前 value 文本。
- 鼠标拖动会持续触发 `onChange` 和重绘，回调里不要做重排大文档、远程请求或复杂计算。
- 大量 slider 应放入虚拟化容器，避免一次性创建和布局过多控件。
- 放在滚动容器里时，现有手势逻辑已经区分水平拖动和垂直滚动。

## 常见问题

### 鼠标拖动为什么不按 step 吸附？

当前实现中 `step` 只影响键盘步进和显示值小数位。鼠标拖动按 track 位置连续映射到数值。如果业务需要吸附，应该在 `onChange` 或上层状态投影时做取整。

### 直接设置 value 为什么不触发 onChange？

直接设置 `value` 是外部状态投影，只会限制范围并请求重绘。用户点击、拖动或键盘调整才触发 `onChange`。

### label 或 showValue 修改后为什么布局没变？

`label` 和 `showValue` 是公开字段，直接修改不会自动请求 layout。动态切换时建议重建 slider 或由父组件触发布局。

### Slider 可以表示范围吗？

不可以。`RenderSlider` 只表示单个数值。范围选择使用图表范围滑块或业务自定义控件。

### 放在 ScrollView 里会不会影响滚动？

横向拖动由 slider 接管，纵向拖动会让给父级滚动容器。这是为了让设置面板、表单页和诊断页中的 slider 能自然滚动。

## 相关文档

- [NumberInput 数字输入](./number-input.md)
- [Checkbox / Switch / RadioGroup](./checkbox-switch-radio.md)
- [ComboBox 下拉框](../selector/combo-box.md)
- [DataGrid 数据表格](../data/data-grid.md)
- [事件路由](../../lifecycle.md)
- [焦点与输入](../../lifecycle.md)
- [主题与状态](../../themes.md)
