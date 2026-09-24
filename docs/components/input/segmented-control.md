# SegmentedControl 分段选择

> **通用布局能力**：`RenderSegmentedControl` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；分段内部 padding 属于组件视觉规格。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderSegmentedControl` 是一组互斥选项组成的紧凑选择控件。它适合在同一位置切换少量模式，例如视图模式、时间范围、密度、排序维度等。

它只负责当前 value、鼠标/键盘选择、disabled 状态和视觉绘制；业务筛选、路由、数据重查和权限判断应在外层完成。


## API 总览

```ts
import {
  RenderSegmentedControl,
  type SegmentedControlOption,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderSegmentedControl` | class | 分段选择控件。 |
| `SegmentedControlOption` | type | 单个分段配置，包含 `value`、`label` 和可选 `disabled`。 |

最小装配顺序是：准备 `SegmentedControlOption[]`，创建 `RenderSegmentedControl({ options, value, onChange })`，在 `onChange(value)` 中更新业务状态。直接设置 `value` 不触发 `onChange`。

`RenderSegmentedControl` 同时实现 `ValueEditor<string>`，可以直接绑定 `FormSession` 字段。用户选择发布 `reason: 'selection'`；调用 `setOptions()` 后，如果原值已不在新选项中，控件会选择第一个可用项并发布 `reason: 'options-reconcile'`、`userInitiated: false`。这类配置归一化会同步表单草稿，但不会把字段标记为 touched。

## 何时使用

使用 SegmentedControl：

- 选项数量少，通常 2 到 5 个。
- 所有选项互斥，并且适合平铺展示。
- 需要比 RadioGroup 更紧凑的模式切换。
- 选项文本较短，不需要图标或说明。

不要使用：

- 候选项很多，使用 ComboBox。
- 需要单选表单字段和较长说明，使用 RadioGroup。
- 需要多选，使用 Checkbox、MultiSelectDropdown 或 Chip 组合。
- 需要权限、快捷键和命令复用，使用命令组件。

## 最小示例

```ts
import { RenderSegmentedControl, type SegmentedControlOption } from 'ds-ui'

const densityOptions: SegmentedControlOption[] = [
  { value: 'compact', label: '紧凑' },
  { value: 'normal', label: '常规' },
  { value: 'relaxed', label: '宽松' },
]

const densityControl = new RenderSegmentedControl({
  options: densityOptions,
  value: 'normal',
  onChange: value => {
    state.density = value
  },
})
```

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `options` | `SegmentedControlOption[]` | 必填 | 分段选项。组件保留数组引用。 |
| `value` | `string` | 第一个非禁用选项 | 当前选中值。 |
| `disabled` | `boolean` | `false` | 是否禁用整个控件。 |
| `onChange` | `(value: string) => void` | `undefined` | 用户选择新值时触发。 |

## SegmentedControlOption

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `value` | `string` | 是 | 稳定值。用于当前选中、键盘焦点和回调。 |
| `label` | `string` | 是 | 分段显示文本。 |
| `disabled` | `boolean` | 否 | 禁用该分段。禁用分段不可点击、不可键盘选择。 |

## 属性和方法

| API | 类型 / 返回值 | 说明 |
| --- | --- | --- |
| `options` | `SegmentedControlOption[]` | 当前选项数组。直接修改后应触发布局。 |
| `value` | `string` | 当前选中值。赋值只更新状态和绘制，不触发 `onChange`。 |
| `disabled` | `boolean` | 整体禁用状态。 |
| `onChange` | `(value: string) => void` | 选择回调。 |
| `setOptions(options, value?)` | `void` | 替换选项，并校正当前 value。 |
| `debugState()` | object | 返回当前 value 和 segment rects。 |

## 鼠标和键盘

| 操作 | 行为 |
| --- | --- |
| 点击分段 | 请求焦点，选中该值并触发 `onChange`。 |
| hover 分段 | 绘制 hover 状态。 |
| `ArrowLeft` / `ArrowUp` | 选择上一个可用选项，循环。 |
| `ArrowRight` / `ArrowDown` | 选择下一个可用选项，循环。 |
| `Home` | 选择第一个可用选项。 |
| `End` | 选择最后一个可用选项。 |
| `Enter` / `Space` | 选择当前焦点分段。 |

## 布局和边界

- 每个分段宽度由 label 文本宽度和主题 padding 计算。
- 父级给定额外宽度时，额外空间平均分配到每个分段。
- 文本居中绘制，不换行。
- 选项很多或 label 很长时会变宽，不会自动折叠成下拉。

## 相关组件

- [RadioGroup](checkbox-switch-radio.md)
- [ComboBox](../selector/combo-box.md)
- [Toolbar](../command/toolbar.md)
