# TimeRangeEdit

`RenderTimeRangeEdit` 用于编辑两个“时刻”组成的范围。popup 横向并列两个完整时间面板，左侧为开始时间，右侧为结束时间。


## 基本用法

```ts
import { RenderTimeRangeEdit } from 'directsurface'

const range = new RenderTimeRangeEdit({
  value: { start: '09:00', end: '17:30' },
  precision: 'minute',
  minuteStep: 5,
  clearable: true,
  onChange: value => console.log(value.start, value.end),
})
```

值类型：

```ts
interface TimeRangeValue {
  start: string | null
  end: string | null
}
```

## 跨日规则

时间范围没有日期，因此 `22:00 ~ 06:00` 既可能是错误顺序，也可能表示跨日。组件不会自动交换两个值：

- `allowOvernight:false`（默认）时，`end < start` 会阻止确认并显示提示。
- `allowOvernight:true` 时，同一范围明确表示“22:00 到次日 06:00”。字段和 popup 预览都会标注“次日”。

这个规则只适用于纯时间范围。包含日期的范围应使用 `RenderDateTimeRangeEdit`。

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `value` | `TimeRangeValue` | 空范围 | 开始与结束时刻。 |
| `precision` | `'minute' \| 'second'` | `'second'` | 两端统一精度。 |
| `allowOvernight` | `boolean` | `false` | 是否允许结束时刻早于开始时刻。 |
| `hourStep` / `minuteStep` / `secondStep` | `number` | `1` | 两个面板共用的候选步长。 |
| `separator` | `string` | `' ~ '` | 字段显示分隔符。 |
| `clearable` | `boolean` | `false` | 显示清除入口。 |
| `onChange` | `(value:TimeRangeValue) => void` | `undefined` | 确认或清空时调用。 |

`setValue()` 和直接设置 `value` 不触发 `onChange`。确认选择时发出 `selection` 变更，清空时发出 `clear` 变更。

相关组件：[TimePicker](time-picker.md)、[DateTimeRangeEdit](date-time-range-edit.md)、[TimeSpanEdit](time-span-edit.md)。
