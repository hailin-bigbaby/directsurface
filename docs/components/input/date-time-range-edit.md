# DateTimeRangeEdit

`RenderDateTimeRangeEdit` 用于编辑带具体日期和时刻的开始/结束范围。它与纯日期的 `RenderDateRangeEdit`、纯时刻的 `RenderTimeRangeEdit` 分离，避免一个组件同时承担互相冲突的值语义。


## 基本用法

```ts
import { RenderDateTimeRangeEdit } from 'directsurface'

const range = new RenderDateTimeRangeEdit({
  value: {
    start: '2026-07-31T08:30',
    end: '2026-08-01T17:30',
  },
  timePrecision: 'minute',
  minuteStep: 5,
  clearable: true,
  onChange: value => console.log(value),
})
```

值类型：

```ts
interface DateTimeRangeValue {
  start: string | null
  end: string | null
}
```

- 分钟精度格式为 `YYYY-MM-DDTHH:mm`。
- 秒精度格式为 `YYYY-MM-DDTHH:mm:ss`。
- 两端均为本地日期时间，不附带时区偏移。
- 起点为空时终点也会归一化为空。
- 完整的反向范围按完整日期时间排序，保证 `start <= end`。

## popup 交互

popup 左右分别对应开始和结束端点。每一侧提供“日期 / 时间”页签：

- 日期页签复用 `DatePicker` 的日、月、年三级日历面板。
- 时间页签复用 `TimePicker` 的多列时间面板。
- 两侧的日期、时间、视图层级和键盘位置互不干扰。
- “当前栏设为现在”只更新当前活动端点。
- 点击“确定”后统一归一化并提交，点击“取消”丢弃草稿。
- 空范围首次打开时以当前本地时间作为开始端回退值，结束端回退为开始端后一小时；弹窗打开期间同步只有开始端的受控值时也沿用同一规则。结束端回退越过支持的日历上界时会饱和在 `9999-12-31T23:59:59`，并按当前时间精度格式化。

页签模式使 popup 高度与普通双日历接近，避免在两个日历下方再堆叠两套长时间列表。

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `value` | `DateTimeRangeValue` | 空范围 | 开始与结束日期时间。 |
| `timePrecision` | `'minute' \| 'second'` | `'second'` | 两端统一时间精度。 |
| `hourStep` / `minuteStep` / `secondStep` | `number` | `1` | 时间页签候选步长。 |
| `separator` | `string` | `' ~ '` | 字段显示分隔符。 |
| `clearable` | `boolean` | `false` | 显示清除入口。 |
| `onChange` | `(value:DateTimeRangeValue) => void` | `undefined` | 确认或清空时调用。 |

相关组件：[DateRangeEdit](date-range-edit.md)、[TimeRangeEdit](time-range-edit.md)、[DatePicker](date-picker.md)。
