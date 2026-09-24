# TimeSpanEdit

> **通用布局能力**：`TimeSpanEditOptions` 继承 `RenderBoxOptions`，可在构造时配置 `width`、`height`、min/max、`margin` 和槽位对齐，也可在创建后通过对应属性调整。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderTimeSpanEdit` 用于编辑持续时长，例如执行耗时、疗程间隔或设备运行时间。它与一天中的时刻不同：时长可以超过 24 小时，也可以按业务需要允许负值。

## 基本使用

```ts
import { RenderTimeSpanEdit } from 'ds-ui'

const duration = new RenderTimeSpanEdit({
  value: 90 * 60 * 1000,
  precision: 'minute',
  clearable: true,
  onChange: value => {
    console.log(value)
  },
})
```

`value` 使用整数毫秒；空值为 `null`。组件只负责录入时长，不附带日期、时区或开始时间。

## 值与显示

| `precision` | 显示形式 | 示例 |
| --- | --- | --- |
| `'minute'` | `天 时:分` | `2d 03:15` |
| `'second'` | `天 时:分:秒` | `2d 03:15:40` |

天数不设 24 小时上限；小时、分钟和秒分别保持在 `0..23`、`0..59`、`0..59`，步进越界时会自动向更高单位进位。外部值会按当前精度向下归一到整分钟或整秒，并限制在 JavaScript 安全整数范围内。

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `value` | `number \| null` | `null` | 当前时长，单位为毫秒。 |
| `precision` | `'minute' \| 'second'` | `'second'` | 是否显示和提交秒。 |
| `allowNegative` | `boolean` | `false` | 是否允许负时长。关闭时，负外部值归一为 `0`。 |
| `placeholder` | `string` | 按精度生成 | 空值提示。 |
| `daysStep` | `number` | `1` | 天数段步进。 |
| `hoursStep` | `number` | `1` | 小时段步进。 |
| `minutesStep` | `number` | `1` | 分钟段步进。 |
| `secondsStep` | `number` | `1` | 秒段步进。分钟精度下不显示秒段。 |
| `onChange` | `(value: number \| null) => void` | `undefined` | 有效值变化或清空时调用。 |
| `disabled` | `boolean` | `false` | 禁用输入和焦点。 |
| `readonly` | `boolean` | `false` | 只读显示。 |
| `status` | `FormFieldStatus` | `'default'` | 成功、警告和错误状态。 |
| `helperText` | `string` | `''` | 字段下方提示。 |
| `prefixText` | `string` | `''` | 输入区前缀。 |
| `suffixText` | `string` | `''` | 输入区后缀。 |
| `clearable` | `boolean` | `false` | 有值时显示清除入口，清除后值为 `null`。 |

程序设置 `value`、`precision` 或 `allowNegative` 只更新组件状态，不触发 `onChange`。

## 键盘行为

| 按键 | 行为 |
| --- | --- |
| 数字 | 写入当前天、时、分或秒段。 |
| `Left` / `Right` | 在可见分段之间移动。 |
| `Up` / `Down` | 按当前分段的 step 调整时长，并自动进位或借位。 |
| `Tab` / `Shift+Tab` | 在分段之间移动；到达首尾后交给外层焦点导航。 |
| `Backspace` | 删除当前尚未提交的分段数字。 |
| `Enter` | 激活或提交当前分段。 |
| `Escape` | 退出当前分段输入。 |
| `+` / `-` | `allowNegative:true` 时切换正负号。 |

### 零值与负号

`value` 始终是普通毫秒数，不会用 `-0` 表达业务状态。`allowNegative:true` 时，组件会在当前组件状态中单独保留负号意图：

- 值为 `0` 时按 `-`，`value` 仍为 `0`，界面保留负号；随后输入非零分段会得到负时长。
- 编辑一个负时长时，即使中间把所有分段改成 `0`，负号也不会提前丢失；继续输入其他非零分段仍按负值提交。
- 按 `+` 会清除负号意图。程序设置不同的 `value`、关闭 `allowNegative` 或清空为 `null` 时，以新的外部状态为准。

因此，负号切换但数值仍为 `0` 时不会单独触发一个 `-0` 的 `onChange`；等实际毫秒值发生变化后再按正常规则回调。

鼠标点击负号区域或清除按钮时，业务值都在抬起时才改变。指针必须赢得手势仲裁，并在抬起时仍位于同一个操作区域；父级滚动开始、手势被拒绝、指针取消或离开操作区域时，本次操作会取消。

## 选择正确的时间组件

- 一天中的时刻使用 [TimeEdit](time-edit.md)。
- 同时包含日期和时刻时使用 [DatePicker](date-picker.md)。
- 起止日期使用 [DateRangeEdit](date-range-edit.md)。
- 持续时长使用 TimeSpanEdit，不要用 `Date` 或 `TimeEdit` 绕过 24 小时边界。
