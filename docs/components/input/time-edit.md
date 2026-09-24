# TimeEdit

> **通用布局能力**：`TimeEditOptions` 继承 `RenderBoxOptions`，可在构造时配置 `width`、`height`、min/max、`margin` 和槽位对齐，也可在创建后通过对应属性调整。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderTimeEdit` 用于编辑一天中的时刻。它使用固定的 `HH:mm` 或 `HH:mm:ss` 字符串，不附带日期和时区，也不会把时间转换成 JavaScript `Date`。


## 基本使用

```ts
import { RenderTimeEdit } from 'ds-ui'

const time = new RenderTimeEdit({
  value: '08:30',
  precision: 'minute',
  minuteStep: 5,
  clearable: true,
  onChange: value => {
    console.log(value)
  },
})
```

秒精度：

```ts
const preciseTime = new RenderTimeEdit({
  value: '08:30:15',
  precision: 'second',
})
```

## 值格式

| `precision` | 值格式 | 示例 |
| --- | --- | --- |
| `'minute'` | `HH:mm` | `08:30` |
| `'second'` | `HH:mm:ss` | `08:30:15` |

空值使用空字符串。小时范围为 `0..23`，分钟和秒为 `0..59`。非法外部值会归一化为空字符串。

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `value` | `string` | `''` | 当前受控时间值。 |
| `precision` | `'minute' \| 'second'` | `'second'` | 是否显示和提交秒。 |
| `placeholder` | `string` | 按精度生成 | 空值提示。 |
| `hourStep` | `number` | `1` | 小时段上下键步进。 |
| `minuteStep` | `number` | `1` | 分钟段上下键步进。 |
| `secondStep` | `number` | `1` | 秒段上下键步进。 |
| `onChange` | `(value: string) => void` | `undefined` | 清空或有效时间变化时调用。 |
| `disabled` | `boolean` | `false` | 禁用输入和焦点。 |
| `readonly` | `boolean` | `false` | 只读显示。 |
| `status` | `FormFieldStatus` | `'default'` | 成功、警告和错误状态。 |
| `helperText` | `string` | `''` | 字段下方提示。 |
| `prefixText` | `string` | `''` | 输入区前缀。 |
| `suffixText` | `string` | `''` | 输入区后缀。 |
| `clearable` | `boolean` | `false` | 有值时显示清除入口。 |

未显式提供 `placeholder` 时，组件会按当前 `precision` 生成 `HH:mm` 或 `HH:mm:ss`，运行时修改精度也会同步更新。显式配置或运行时赋值的自定义占位符不会被后续精度变化覆盖。

## 键盘行为

| 按键 | 行为 |
| --- | --- |
| 数字 | 写入当前时、分或秒段；两位完成后前进到下一段。 |
| `Left` / `Right` | 在分段之间移动。 |
| `Up` / `Down` | 按对应 step 调整当前段，并在边界回绕。 |
| `Backspace` | 删除当前尚未提交的分段数字。 |
| `Tab` / `Shift+Tab` | 在分段间移动；到达边界后交给外层焦点导航。 |
| `Enter` | 提交当前分段。 |
| `Escape` | 退出当前分段输入。 |

鼠标点击清除按钮时，按下只进入按压状态；只有该指针赢得手势仲裁，并且抬起时仍位于清除按钮内，才会清空值。拖动外层滚动区域、手势被拒绝、指针取消或离开按钮都不会误清。

## DataGrid 时间列

DataGrid 和 TreeGrid 共用同一套时间解析、格式化、步进和校验：

```ts
const columns = [
  {
    type: 'time',
    key: 'startTime',
    title: '开始时间',
    width: 96,
    editable: true,
    precision: 'minute',
    sortable: true,
    filterable: true,
  },
]
```

`precision` 不只是显示选项，也是时间列的统一值精度：

- `'minute'` 会把合法值归一为 `HH:mm`。例如 `08:30`、`08:30:00` 和 `08:30:59` 在该列中都按 `08:30` 处理。
- `'second'` 会把合法值归一为 `HH:mm:ss`，缺少秒的输入按 `00` 秒处理。
- 显示、编辑提交、排序、条件筛选、值筛选去重和分组均使用同一份归一化结果，不会出现单元格显示相同、筛选或分组却仍按隐藏秒数拆开的情况。

如果列显式配置了 `editor:{ kind:'time', precision:... }`，以编辑器中的 `precision` 为准；否则使用列上的 `precision`，默认是 `'second'`。源数据在未编辑时不会因为绘制而被改写，单元格提交后写回当前精度对应的规范字符串。

单元格编辑仍只创建当前活动编辑会话，不会为每个单元格创建 `RenderTimeEdit` 实例。

## 时间与日期时间的区别

- 只有时刻时使用 `TimeEdit` 或 Grid `type:'time'`。
- 同时包含日期和时刻时使用 `RenderDatePicker({ showTime:true })` 或 Grid `type:'date', showTime:true`。
- 持续时长使用 [TimeSpanEdit](time-span-edit.md)，不能用 TimeEdit 表示超过 24 小时的时长。

## 相关组件

- [DatePicker](date-picker.md)
- [DateRangeEdit](date-range-edit.md)
- [TimeSpanEdit](time-span-edit.md)
- [DataGrid](../data/data-grid.md)

## TimeEdit 与 TimePicker 的选择

- 需要高效键盘分段录入时使用 `RenderTimeEdit`。
- 需要鼠标、触屏或候选列选择时使用 [TimePicker](time-picker.md)。
- 两者使用相同的时间格式、精度和步进语义。
- 两个时刻组成的范围使用 [TimeRangeEdit](time-range-edit.md)。
