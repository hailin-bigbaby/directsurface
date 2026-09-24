# TimePicker

`RenderTimePicker` 用于从弹出式多列面板中选择一天内的时刻。它与 `RenderTimeEdit` 使用相同的 `HH:mm` / `HH:mm:ss` 值模型，但交互侧重点不同：`TimeEdit` 适合键盘分段录入，`TimePicker` 适合鼠标、触屏和候选值选择。


## 基本用法

```ts
import { RenderTimePicker } from 'directsurface'

const picker = new RenderTimePicker({
  value: '09:30',
  precision: 'minute',
  minuteStep: 5,
  clearable: true,
  onChange: value => console.log(value),
})
```

## 值模型

- `precision:'minute'` 使用 `HH:mm`。
- `precision:'second'` 使用 `HH:mm:ss`。
- 空值使用空字符串。
- 小时范围为 `0..23`，分和秒范围为 `0..59`。
- 组件只表达本地时刻，不包含日期、时区或持续时长。

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `value` | `string` | `''` | 当前时刻。 |
| `precision` | `'minute' \| 'second'` | `'second'` | 值和面板的时间精度。 |
| `hourStep` | `number` | `1` | 小时候选和键盘步进。 |
| `minuteStep` | `number` | `1` | 分钟候选和键盘步进。 |
| `secondStep` | `number` | `1` | 秒候选和键盘步进。 |
| `placeholder` | `string` | 按精度生成 | 空值提示。 |
| `clearable` | `boolean` | `false` | 显示清除入口。 |
| `onChange` | `(value:string) => void` | `undefined` | 确认选择或清空时调用。 |
| `disabled` / `readonly` | `boolean` | `false` | 禁用或只读。 |
| `status` / `helperText` | 表单字段属性 | — | 校验状态和帮助文本。 |

未显式提供 `placeholder` 时，组件会按当前 `precision` 生成默认提示，运行时修改精度也会同步更新。显式配置或运行时赋值的自定义占位符保持不变。

## popup 交互

- popup 顶部显示当前草稿值；字段继续显示已提交值，点击“确定”后才写回。
- 时、分、秒按精度显示为两列或三列；统一的横向选中轨道表示最终组合值。
- 每列围绕当前值展示候选；未配置 step 时小时、分钟和秒均按 `1` 递增。
- 滚轮只调整指针所在列。
- “现在”写入当前本地时间，但仍需点击“确定”提交。
- “取消”丢弃 popup 草稿。
- 键盘方向键按 step 调整当前列，左右键切换列；`Enter`（包括 `Shift+Enter`）确认当前草稿，`Tab` 到达边界后把焦点交还表单。

直接使用 `TimePickerPopup` 时，还可以通过 `clearable` 显示“清空”，并通过 `validate(value)` 返回错误文本。校验返回非空文本时，popup 会保持打开并在顶部显示错误；`onSelect(value)` 也可以返回错误文本，用于展示提交冲突等宿主错误。选择候选值和“现在”始终只修改 popup 草稿；点击“确定”、按 `Enter` 或显式“清空”时才调用 `onSelect`。

如需直接键入数字，使用 [TimeEdit](time-edit.md)；如需两个时刻，使用 [TimeRangeEdit](time-range-edit.md)。
