# NumberInput 数字输入

> **通用布局能力**：`RenderNumberInput` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；字段内部 padding 和增减按钮宽度仍由输入组件样式控制。详见[组件通用布局属性](../common-layout-properties.md)。


`RenderNumberInput` 用于录入和调整数字值，例如数量、比例、年龄、金额、页码、行号跳转。

它是带右侧上下步进按钮的单行数字输入框，步进器视觉与 DataGrid 数字编辑器一致。组件内部复用文本编辑会话，因此支持光标定位、文本选择、IME 输入、粘贴和滚动到光标。数值在提交或步进时才会解析、取整、限制范围并回调。

## API 总览

主类：

- `RenderNumberInput`

相关 public type：

- `FormFieldStatus`

导入：

```ts
import { RenderNumberInput, type FormFieldStatus } from 'directsurface'
```

`RenderNumberInput` 的构造参数是公开 options 对象，但当前没有单独导出的 NumberInput options 类型。业务代码直接按本文参数表传入对象。

## 何时使用

使用 `RenderNumberInput`：

- 字段值必须是数字。
- 需要 `min/max/step/decimals` 约束。
- 需要通过按钮、键盘或滚轮按步进调整。
- 需要前缀/后缀显示单位，例如 `$`、`kg`、`%`。
- 需要表单状态、辅助文本、禁用或只读。

不要使用：

- 普通文本、编号、证件号、电话号码。这些不是数字运算值，应使用 [TextBox](./text-box.md)。
- 需要滑动调节并可视化范围的值，优先使用 [Slider](./slider.md)。
- 金额格式化、千分位、货币规则很复杂的场景，应在业务层封装格式化逻辑。

## 最小示例

```ts
import { RenderNumberInput } from 'directsurface'

const countState = {
  count: 1,
}

const count = new RenderNumberInput({
  value: countState.count,
  min: 0,
  max: 999,
  step: 1,
  decimals: 0,
  onChange: value => {
    countState.count = value
  },
})
```

带单位：

```ts
import { RenderNumberInput } from 'directsurface'

const temperature = new RenderNumberInput({
  value: 36.8,
  min: 30,
  max: 45,
  step: 0.1,
  decimals: 1,
  suffixText: 'C',
})
```

带表单状态：

```ts
import { RenderNumberInput } from 'directsurface'

const age = new RenderNumberInput({
  value: 32,
  min: 0,
  max: 150,
  status: 'warning',
  helperText: '年龄超出常见范围时需要确认。',
})
```

## 构造参数

```ts
import { RenderNumberInput } from 'directsurface'

const numberFormState = {
  value: 12,
}

const input = new RenderNumberInput({
  value: numberFormState.value,
  min: 0,
  max: 100,
  step: 1,
  decimals: 0,
  label: '数量',
  prefixText: '',
  suffixText: '次',
  status: 'default',
  helperText: '',
  disabled: false,
  readonly: false,
  onChange: value => {
    numberFormState.value = value
  },
})
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `value` | `number` | `0` | 初始数值。会经过 `decimals`、`min`、`max` 归一化。 |
| `min` | `number` | `-Infinity` | 最小值。 |
| `max` | `number` | `Infinity` | 最大值。 |
| `step` | `number` | `1` | 步进按钮、上下键和滚轮每次调整的值。 |
| `decimals` | `number` | `0` | 小数位数。用于取整和格式化显示。 |
| `label` | `string` | `''` | 绘制在输入框右侧的标签。 |
| `onChange` | `(value: number) => void` | `undefined` | 用户提交或步进后触发。 |
| `disabled` | `boolean` | `false` | 禁用。不可聚焦、不可编辑、不可步进。 |
| `readonly` | `boolean` | `false` | 只读。不可聚焦、不可编辑、不可步进。 |
| `status` | `FormFieldStatus` | `'default'` | 表单视觉状态。 |
| `helperText` | `string` | `''` | 输入框下方辅助文本。为空时不占用辅助行高度。 |
| `prefixText` | `string` | `''` | 数值区域左侧前缀。 |
| `suffixText` | `string` | `''` | 数值区域右侧后缀。 |

## FormFieldStatus

`status` 复用表单字段状态：

```ts
type FormFieldStatus = 'default' | 'success' | 'warning' | 'error'
```

| 值 | 说明 |
| --- | --- |
| `'default'` | 默认状态。 |
| `'success'` | 校验通过或正向提示。 |
| `'warning'` | 需要注意但可继续。 |
| `'error'` | 校验错误。 |

## 属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `value` | `number` | 当前数值。赋值会归一化并请求重绘，但不会触发 `onChange`。 |
| `min` | `number` | 最小值。直接修改不会自动重新归一化现有 `value`。 |
| `max` | `number` | 最大值。直接修改不会自动重新归一化现有 `value`。 |
| `step` | `number` | 步进值。 |
| `decimals` | `number` | 小数位数。直接修改不会自动重新归一化现有 `value`。 |
| `label` | `string` | 右侧标签。直接修改不会自动触发布局。 |
| `onChange` | `(value: number) => void \| undefined` | 用户提交或步进回调。 |
| `disabled` | `boolean` | 禁用态。赋值为 true 时会提交当前编辑、清理 hover/pressed 并取消焦点注册。 |
| `readonly` | `boolean` | 只读态。赋值为 true 时会取消当前编辑、清理 hover/pressed 并取消焦点注册。 |
| `status` | `FormFieldStatus` | 表单状态。赋值后请求重绘。 |
| `helperText` | `string` | 辅助文本。赋值后请求布局和重绘。 |
| `prefixText` | `string` | 前缀文本。赋值后请求重绘。 |
| `suffixText` | `string` | 后缀文本。赋值后请求重绘。 |
| `btnWidth` | `number` | 右侧步进器宽度，来自当前主题 number stepper 样式。 |
| `isFocused` | `boolean` | 当前是否处于编辑焦点。 |

## 方法和生命周期

| 方法 | 说明 |
| --- | --- |
| `focusIn()` | 开始编辑。禁用或只读时无效。 |
| `focusOut()` | 提交当前编辑。 |
| `dispose()` | 释放输入会话、取消 pending gesture、注销焦点并清理资源。 |

`RenderNumberInput` 内部会根据 `disabled/readonly` 自动注册或注销 `FocusManager`。如果控件被动态移除，必须调用 `dispose()` 或由父级生命周期释放。

## 数值归一化

归一化顺序：

1. 按 `decimals` 四舍五入。
2. 按 `min/max` 裁剪。

```ts
import { RenderNumberInput } from 'directsurface'

const input = new RenderNumberInput({
  value: 12.34,
  min: 0,
  max: 10,
  decimals: 1,
})

input.value // 10
```

显示格式：

- 非编辑状态使用 `value.toFixed(decimals)`。
- 编辑状态显示用户正在编辑的字符串。
- 提交后再次格式化到固定小数位。

注意：

- `decimals: 0` 时显示整数格式，例如 `1`。
- `decimals: 2` 时显示 `1.00`。
- 直接修改 `min/max/decimals` 不会自动重新设置当前值；需要业务侧重新写入 `input.value = input.value` 或重建组件。

## 输入和提交规则

进入编辑：

- 点击数值区域会聚焦并开始编辑。
- `focusIn()` 也会开始编辑。
- 编辑开始时，文本为当前格式化值，光标位于末尾。

编辑中：

- 支持普通输入、粘贴、中文组合输入。
- 支持点击定位光标。
- 支持水平拖选文本。
- prefix/suffix 只作为装饰，不进入编辑文本。

提交：

- `Enter` 提交当前文本。
- `focusOut()` 提交当前文本。
- 点击组件外部时，如果当前正在编辑，会先提交。
- 如果 `parseFloat(editText)` 得到有效数字，则归一化后写入 `value` 并触发 `onChange`。
- 如果无法解析为数字，不改变 `value`，直接结束编辑。

取消：

- `Escape` 取消编辑，不提交 `_editText`。
- 设置 `readonly = true` 会取消当前编辑。

提交后：

- 退出编辑状态。
- 清理拖选和 pending gesture。
- 重置文本滚动位置。

## 步进规则

触发步进的方式：

- 点击右侧上箭头：`value += step`。
- 点击右侧下箭头：`value -= step`。
- 编辑状态按 `ArrowUp`：`value += step`。
- 编辑状态按 `ArrowDown`：`value -= step`。
- 鼠标滚轮在输入框区域内：向上滚 `value += step`，向下滚 `value -= step`。

每次步进都会：

- 按 `decimals` 和 `min/max` 归一化。
- 写入 `value`。
- 触发 `onChange(value)`。
- 请求重绘。
- 如果正在编辑，同步编辑文本和输入 composer，并把光标移动到文本末尾。

禁用或只读时不会步进。

## 鼠标和手势

点击区域：

- 右侧步进器上半区为增加。
- 右侧步进器下半区为减少。
- 步进器左侧 value area 为编辑文本区域。
- 点击 field 外部会提交当前编辑。

拖选：

- 在 value area 按下后，小幅移动时保持 pending，不立即抢占滚动。
- 水平移动超过 `DRAG_SLOP` 后接受手势并开始文本拖选。
- 垂直移动超过 `DRAG_SLOP` 后拒绝手势，方便滚动容器继续滚动。
- pointer up/cancel 会释放捕获和拖选状态。

这保证 NumberInput 放在 ScrollView 里时，点击编辑和纵向滚动不会互相误伤。

## 键盘行为

| 按键 | 行为 |
| --- | --- |
| `Enter` | 提交当前编辑，并把 Enter 继续派发给上层未处理 Enter 逻辑。 |
| `Escape` | 取消编辑。 |
| `ArrowUp` | 步进增加。 |
| `ArrowDown` | 步进减少。 |
| 普通输入 | 更新编辑文本，不立即解析。 |

其他单行文本编辑行为由内部文本编辑会话处理，例如光标移动、选区、组合输入和粘贴。

## 布局和绘制

布局：

- 总宽度：有限约束下填满 `constraints.maxWidth`；无限约束下为默认 `160` 输入框宽度加右侧 label 宽度。
- 有 label 时，组件会在总宽度内为 label 测量并预留空间，输入框占用剩余宽度；空间不足时优先保证步进按钮和最小输入区域，label 在组件边界内裁剪。
- 高度：`measureFormFieldHeight(inputStyle, inputStyle.height, helperText)`。
- 有 helperText 时，高度会增加 helper gap 和 helper line height。

绘制顺序：

1. 表单字段 shell。
2. prefix/suffix 装饰文本。
3. 数值文本或编辑态文本。
4. 右侧上下步进器。
5. 最外层边框。
6. 右侧 label。

非编辑状态：

- 数值在 value area 内右对齐显示。

编辑状态：

- 数值按单行编辑器绘制。
- 绘制 caret、选区、composition text 和 composition underline。
- value area 会 clip，超长文本通过内部水平滚动保证光标可见。

## 主题来源

`RenderNumberInput` 主要使用：

- `deriveTextInputStyle(theme)`：输入框背景、边框、字号、padding、selection、caret、helperText、prefix/suffix。
- `deriveNumberStepperStyle(theme)`：右侧上下步进器的宽度、背景、边框和箭头状态色。
- `paintFormFieldShell()`：字段背景、状态边框、helperText。
- `layoutFormFieldInlineContent()`：prefix、valueRect、suffix 的横向布局。

`status` 会影响表单字段边框颜色，`disabled` 会影响文本、按钮和 shell 状态。

## 表单组合建议

- 年龄、数量、页码：`decimals: 0`。
- 体温、比例：设置合适 `step` 和 `decimals`。
- 单位用 `suffixText`，不要拼到 `label` 里。
- 货币符号可用 `prefixText`。
- 字段标题建议由表单布局或 [EntryGrid](../data/entry-grid.md) 提供；`label` 更适合紧跟输入框右侧的小提示。

```ts
import { RenderNumberInput } from 'directsurface'

const price = new RenderNumberInput({
  value: 20,
  min: 0,
  step: 0.5,
  decimals: 2,
  prefixText: '$',
})
```

## 性能边界

- 布局时会测量 label、prefix、suffix 和编辑文本。
- 编辑态会维护共享输入 composer、selection、caret 和水平滚动。
- 大量 NumberInput 应放在虚拟化列表或表格中，不要一次性创建大量可编辑控件。
- 禁用、只读或移除控件时确保释放生命周期，避免焦点和输入 composer 残留。

## 常见问题

### onChange 为什么不是每输入一个字符都触发？

`NumberInput` 编辑时先保留字符串，提交时才解析为数字。`onChange` 在提交成功或步进时触发，避免业务层收到 `-`、`.`、空字符串这类中间态。

### 输入非法字符串后会怎样？

提交时使用 `parseFloat()`。如果结果是 `NaN`，不修改 `value`，也不触发 `onChange`，只退出编辑。

### 直接设置 value 会触发 onChange 吗？

不会。直接设置 `value` 是外部状态投影，只会归一化并重绘。用户提交或步进才触发 `onChange`。

### readonly 和 disabled 有什么区别？

两者都不能编辑和步进。`disabled` 表示不可用并绘制禁用态；`readonly` 表示只读展示，不注册焦点，视觉上仍按字段状态绘制。

### 为什么修改 label 后宽度没变？

`label` 是公开字段，直接修改不会自动请求 layout。动态 label 建议重建控件或由父组件触发布局。

### 为什么有上下按钮？

当前 `RenderNumberInput` 固定包含右侧上下步进按钮，并与 DataGrid 数字编辑器保持一致。只需要纯数字文本框时，应封装业务组件或使用 `TextBox` 加业务校验。

## 相关文档

- [TextBox 文本输入](./text-box.md)
- [TextArea 多行输入](./text-area.md)
- [Slider 滑块](./slider.md)
- [EntryGrid 表单网格](../data/entry-grid.md)
- [DataGrid 数据表格](../data/data-grid.md)
- [焦点与输入](../../lifecycle.md)
- [事件路由](../../lifecycle.md)
- [主题与状态](../../themes.md)
