# DatePicker 日期时间

> **通用布局能力**：`RenderDatePicker` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；日期 popup 的 viewport 定位不属于普通 `RenderBox` 盒模型。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderDatePicker` 用于录入日期或日期时间。它不是自由文本输入框，而是“触发框 + 日历弹窗 + 分段数字输入”的日期组件。

日期表单框负责显示、清除、分段编辑和打开日历；`DatePickerPopup` 负责日历面板、年月日视图、确认取消、今日按钮和可选的时间分段输入。

## API 总览

主类：

- `RenderDatePicker`
- `DatePickerPopup`

相关 public type：

- `ISODate`
- `CalendarTime`
- `CalendarTimePrecision`
- `FormFieldStatus`

导入：

```ts
import {
  DatePickerPopup,
  RenderDatePicker,
  type CalendarTime,
  type CalendarTimePrecision,
  type FormFieldStatus,
  type ISODate,
} from 'ds-ui'
```

`RenderDatePicker` 的构造参数是公开 options 对象，但当前没有单独导出的 DatePicker options 类型。业务代码直接按本文参数表传入对象。

## 何时使用

- 出生日期、开始日期、结束日期、预约日期。
- 开始日期、结束日期。
- 需要选择日期和时间的业务字段。
- 业务文书日期数据元。
- 表格单元格或弹窗中的日期选择。

不适合：

- 普通文本输入，使用 [TextBox](./text-box.md)。
- 纯日期范围选择优先使用 [DateRangeEdit](./date-range-edit.md)。它在一个 popup 中并排提供两个日期面板，确认时自动按日期大小生成范围。
- 复杂排班、周视图、日程视图。应开发独立业务组件。
- 自由格式日期输入。DatePicker 当前只支持受控的分段数字输入和日历选择。

## 最小示例

```ts
import { RenderDatePicker, type ISODate } from 'ds-ui'

const visitDateState: { visitDate: ISODate } = {
  visitDate: '',
}

const visitDatePicker = new RenderDatePicker({
  value: visitDateState.visitDate,
  placeholder: '选择预约日期',
  clearable: true,
  onChange: value => {
    visitDateState.visitDate = value
  },
})
```

## 日期时间示例

```ts
import { RenderDatePicker, type ISODate } from 'ds-ui'

const visitDateTimeState: { visitDateTime: ISODate } = {
  visitDateTime: '2026-05-14T09:30:00',
}

const visitDateTimePicker = new RenderDatePicker({
  value: visitDateTimeState.visitDateTime,
  showTime: true,
  placeholder: '选择预约时间',
  onChange: value => {
    visitDateTimeState.visitDateTime = value
  },
})
```


## 值格式

`ISODate` 是字符串类型：

| 模式 | `value` 格式 | 显示格式 | 示例 |
| --- | --- | --- | --- |
| 日期 | `YYYY-MM-DD` | `YYYY-MM-DD` | `2026-05-14` |
| 日期时间 | `YYYY-MM-DDTHH:mm:ss` | `YYYY-MM-DD HH:mm:ss` | `2026-05-14T09:30:00` |
| 空值 | `''` | placeholder | `''` |

`RenderDatePicker` 的 `showTime` 为 `true` 时，输出值使用 `T` 连接日期和时间；绘制时显示为空格连接。

`parseISO()` 当前只识别 `YYYY-MM-DD` 开头的字符串。传入无法解析的字符串时，组件会进入空日期状态。

## RenderDatePicker 构造参数

`new RenderDatePicker(options)` 的 `options`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `value` | `ISODate` | `''` | 初始值。日期模式为 `YYYY-MM-DD`；日期时间模式为 `YYYY-MM-DDTHH:mm:ss`。 |
| `placeholder` | `string` | `showTime ? '选择日期时间' : '选择日期'` | 空值提示文本。 |
| `showTime` | `boolean` | `false` | 是否显示并输出时间部分。当前表单框固定使用秒精度。 |
| `onChange` | `(value: ISODate) => void` | `undefined` | 日期值变化时触发。日历确认、分段编辑、步进、清除都会触发。 |
| `disabled` | `boolean` | `false` | 禁用。不可聚焦、不可打开弹窗、不可清除。 |
| `readonly` | `boolean` | `false` | 只读。不可聚焦、不可打开弹窗、不可分段编辑、不可清除。 |
| `status` | `FormFieldStatus` | `'default'` | 状态边框颜色。可选 `'default'`、`'success'`、`'warning'`、`'error'`。 |
| `helperText` | `string` | `''` | 下方帮助或错误文案。会增加组件高度。 |
| `prefixText` | `string` | `''` | 输入框值区域前缀。 |
| `suffixText` | `string` | `''` | 输入框值区域后缀。 |
| `clearable` | `boolean` | `false` | 有值、非禁用、非只读时显示清除按钮。 |

```ts
const dischargeDatePicker = new RenderDatePicker({
  value: '',
  placeholder: '选择结束日期',
  status: 'default',
  helperText: '',
  prefixText: '结束',
  suffixText: '',
  clearable: true,
  onChange: value => {
    state.dischargeDate = value
  },
})
```

## RenderDatePicker 属性

| 属性 | 类型 | 可写 | 说明 |
| --- | --- | --- | --- |
| `value` | `ISODate` | 是 | 当前值。赋值会重新解析年月日时分秒并重绘。 |
| `placeholder` | `string` | 是 | 空值提示文本。公开字段，动态修改后业务需要触发重绘。 |
| `onChange` | `(value: ISODate) => void \| undefined` | 是 | 值变化回调。 |
| `disabled` | `boolean` | 是 | 禁用状态。设为 `true` 会失焦并关闭弹窗。 |
| `readonly` | `boolean` | 是 | 只读状态。设为 `true` 会失焦、关闭弹窗并清空激活分段。 |
| `status` | `FormFieldStatus` | 是 | 状态色。赋值会重绘。 |
| `helperText` | `string` | 是 | 帮助文案。赋值会重新 layout。 |
| `prefixText` | `string` | 是 | 前缀文本。赋值会重绘。 |
| `suffixText` | `string` | 是 | 后缀文本。赋值会重绘。 |
| `clearable` | `boolean` | 是 | 是否显示清除按钮。赋值会重绘。 |
| `isFocused` | `boolean` | 否 | 当前是否处于焦点或分段输入状态。 |

`showTime` 目前是构造参数，不提供运行时 setter。需要切换日期/日期时间模式时，建议重建组件或由业务层重新组合。

## RenderDatePicker 方法

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `focusIn()` | `void` | 获得焦点。不会自动打开弹窗。通常由 `FocusManager` 调用。 |
| `focusOut()` | `void` | 失焦并退出当前分段输入。 |
| `onKeyDown(event)` | `boolean` | 处理键盘打开弹窗、分段输入、步进和退出。通常由焦点系统调用。 |
| `getMinLayoutWidthHint()` | `number \| undefined` | 返回最小宽度建议。日期模式约 `140`，日期时间模式约 `220`。 |
| `dispose()` | `void` | 注销焦点并释放内部 `DatePickerPopup`。 |

组件还实现了 `GET_POPUP_ANCHOR_RECT`，popup 会使用输入框主体作为定位锚点。外部通常不需要直接调用。

## 输入与鼠标行为

| 操作 | 行为 |
| --- | --- |
| 点击输入框日期/时间数字段 | 激活对应分段，进入键盘数字输入模式。 |
| 点击尾部箭头 | 打开或关闭日历弹窗。 |
| 点击清除按钮 | 清空 `value`，触发 `onChange('')`。 |
| 点击日历弹窗外部 | 如果不是触发框区域，交给 PopupManager 关闭策略；点击触发框会切换关闭。 |
| readonly / disabled 状态点击 | 不聚焦、不打开弹窗、不清除。 |

日期字段不是普通文本框，不支持直接输入任意字符串。业务如果要求“日期数据元不能自由打字”，应使用 DatePicker 这种受控录入方式。

## 键盘行为

未激活分段时：

| 按键 | 行为 |
| --- | --- |
| Enter | 打开日历弹窗。 |
| Space | 打开日历弹窗。 |
| ArrowDown | 打开日历弹窗。 |
| Escape | 弹窗打开时关闭弹窗。 |

激活分段时：

| 按键 | 行为 |
| --- | --- |
| 数字键 | 写入当前分段输入缓冲；达到分段长度或首位已可判断时提交。 |
| Backspace | 删除当前分段输入缓冲最后一位。 |
| ArrowUp | 当前分段加 1。 |
| ArrowDown | 当前分段减 1。 |
| Tab | 提交当前缓冲并切到下一个分段。 |
| Enter | 提交当前缓冲并退出分段输入。 |
| Escape | 提交当前缓冲并退出分段输入。 |

`RenderDatePicker` 表单框分段顺序：

- 日期模式：`year -> month -> day`
- 日期时间模式：`year -> month -> day -> hour -> minute -> second`

分段值会被约束到有效范围：

- year：`1..9999`
- month：`1..12`
- day：当前年月的有效天数
- hour：`0..23`
- minute：`0..59`
- second：`0..59`

```ts
const segmentDatePicker = new RenderDatePicker({
  value: '2026-05-14',
  onChange: value => {
    state.segmentDate = value
  },
})

FocusManager.instance.setFocus(segmentDatePicker)
```

## 清除行为

清除按钮显示条件：

- `clearable === true`
- `value.length > 0`
- 非 `disabled`
- 非 `readonly`

点击清除按钮会：

- 关闭弹窗。
- 把 `value` 设为 `''`。
- 清空内部日期解析状态。
- 退出分段输入。
- 触发 `onChange('')`。

```ts
const clearableDatePicker = new RenderDatePicker({
  value: '2026-05-14',
  clearable: true,
  onChange: value => {
    state.clearableDate = value
  },
})
```

## 只读和禁用

| 状态 | 可聚焦 | 可打开弹窗 | 可分段输入 | 可清除 | 典型用途 |
| --- | --- | --- | --- | --- | --- |
| 正常 | 是 | 是 | 是 | 取决于 `clearable` | 普通编辑。 |
| `readonly` | 否 | 否 | 否 | 否 | 展示日期但禁止修改。 |
| `disabled` | 否 | 否 | 否 | 否 | 当前业务不可操作。 |

`readonly` 和 `disabled` 都会让组件关闭 popup 并退出分段输入。视觉上 readonly 不展示聚焦态，disabled 使用禁用态颜色。

## DatePickerPopup

`DatePickerPopup` 是可独立使用的日历浮层。`RenderDatePicker` 内部持有一个 popup；表格单元格编辑器、文档编辑器等也可以复用它。

### open 参数

`popup.open(options)`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `anchor` | `PopupAnchor` | 必填 | 弹窗定位锚点。可传实现 `GET_POPUP_ANCHOR_RECT` 的对象或静态锚点。 |
| `selected` | `{ year: number; month: number; day: number } \| null` | 必填 | 当前选中日期。为空时默认显示今天所在月。 |
| `selectedTime` | `CalendarTime \| null` | 当前时间 | 当前时间值。 |
| `showTime` | `boolean` | `false` | 是否显示时间编辑行。 |
| `timePrecision` | `CalendarTimePrecision` | `'second'` | 时间精度。可选 `'minute'` 或 `'second'`。 |
| `onSelect` | `(date, time?) => boolean \| void` | 必填 | 确认选择后触发；返回 false 保持 popup 打开。`showTime` 为 true 时第二个参数为时间。 |
| `clearable` | `boolean` | `false` | 是否在 footer 显示“清空”。 |
| `onClear` | `() => boolean \| void` | `undefined` | 清空时触发；返回 false 保持 popup 打开。 |
| `onTab` | `(direction: 1 \| -1) => void` | `undefined` | 可选宿主导航钩子。配置后 Tab 确认当前草稿并通知方向。 |
| `onClose` | `() => void` | 必填 | 弹窗关闭时触发。 |

```ts
const standaloneDatePopup = new DatePickerPopup()
const standaloneDateAnchor = {
  [GET_POPUP_ANCHOR_RECT]: () => ({
    x: 20,
    y: 20,
    width: 160,
    height: 32,
  }),
}

standaloneDatePopup.open({
  anchor: standaloneDateAnchor,
  selected: { year: 2026, month: 5, day: 14 },
  selectedTime: { hour: 9, minute: 30, second: 0 },
  showTime: true,
  timePrecision: 'minute',
  onSelect: (date, time) => {
    state.popupDate = `${date.year}-${date.month}-${date.day}`
    state.popupTime = time ? `${time.hour}:${time.minute}` : ''
  },
  onClose: () => {
    state.popupClosed = true
  },
})
```

### CalendarTime

`CalendarTime`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `hour` | `number` | 小时，范围 `0..23`。 |
| `minute` | `number` | 分钟，范围 `0..59`。 |
| `second` | `number` | 秒，范围 `0..59`。 |

`CalendarTimePrecision`：

| 值 | 说明 |
| --- | --- |
| `'minute'` | 只编辑时、分；秒会归零。 |
| `'second'` | 编辑时、分、秒。 |

### Popup 方法

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `open(options)` | `void` | 打开日历浮层。 |
| `syncView(year, month)` | `void` | 同步当前日历视图到指定年月。仅 visible 时生效。 |
| `syncSelected(selected, selectedTime?, opts?)` | `void` | 同步选中日期、时间、是否显示时间和精度。 |
| `debugState(context?)` | object | 返回面板位置、视图模式、选中值、时间输入状态等调试信息。 |
| `onEscape(event)` | `boolean` | visible 时关闭弹窗并消费 Escape。 |
| `onKeyDown(event)` | `boolean` | 处理日历导航、分段输入、确认和关闭。 |
| `onWheel(event)` | `boolean` | 始终返回 `true`，避免滚轮穿透。 |
| `onOutsidePointerDown(event)` | `boolean` | 点击触发框区域时关闭并消费事件。 |
| `dispose()` | `void` | 关闭弹窗并清理键盘路由。 |

`debugState()` 返回字段包括：

- `panelX`、`panelY`、`panelW`、`panelH`
- `anchorRect`
- `viewMode`
- `viewYear`
- `viewMonth`
- `yearRangeStart`
- `selected`
- `showTime`
- `timePrecision`
- `selectedTime`
- `activeSegment`
- `activeTimeSegment`

## 日历弹窗交互

| 操作 | 行为 |
| --- | --- |
| 点击上一月/下一月 | day 视图切换月份；month/year 视图切换年份或年份区间。 |
| 点击标题 | day -> month，month -> year，year -> day。 |
| 点击日期 | 只更新当前选中日期，不立即关闭。 |
| 点击今日 | 选中今天，不立即关闭。 |
| 点击确定 | 提交选中日期和时间并关闭。 |
| 点击取消 | 关闭，不触发 `onSelect`。 |
| Escape | 关闭，不触发 `onSelect`。 |
| Tab | 关闭弹窗并不消费焦点移动。 |
| Arrow 键 | 在 day/month/year 视图中移动当前日期、月份或年份。 |
| Enter | 在 day 视图确认当前日期；在 month/year 视图进入下一层视图。 |

## 弹窗时间输入

`DatePickerPopup` 的时间输入行支持年月日、时分秒分段输入。

分段输入规则：

- 数字输入达到该段长度后提交。
- 年、月输入完成后自动切到下一个日期段。
- 日输入完成后停留在日段，不自动跳到时间段。
- 时、分、秒输入完成后不自动跳到下一个时间段。
- 时间段需要用户手动点击或按 Tab 切换。
- ArrowUp / ArrowDown 可以步进当前段。

这个设计避免用户快速输入秒后，焦点自动跳回日期段导致误改日期。

## 布局和定位

`RenderDatePicker`：

- 日期模式默认宽度建议为 `140`。
- 日期时间模式默认宽度建议为 `220`。
- 实际宽度由父布局约束决定。
- 高度由文本输入主题高度和 `helperText` 决定。
- popup 锚点始终是输入框主体区域，不包含 helper text。

`DatePickerPopup`：

- 根据当前主题的 `DatePickerStyleTokens` 计算 cell、header、footer 和时间行尺寸。
- 优先显示在锚点下方。
- 下方空间不足时显示在锚点上方。
- 右侧超出视口时向左修正。
- 弹窗位置每次基于当前 popup context 重新计算，适合滚动和布局变化后的跟随定位。

## 表单组合

纯日期范围直接使用 `RenderDateRangeEdit`：

```ts
import { RenderDateRangeEdit } from 'ds-ui'

const admissionRange = new RenderDateRangeEdit({
  value: {
    start: null,
    end: null,
  },
  onChange: range => {
    state.startDate = range.start
    state.endDate = range.end
  },
})
```

如果两个日期是互不构成范围的业务字段，需要分别设置状态、校验或权限，也可以组合两个 DatePicker：

```ts
const startDatePicker = new RenderDatePicker({
  value: '',
  placeholder: '开始日期',
  clearable: true,
  onChange: value => {
    state.startDate = value
  },
})

const endDatePicker = new RenderDatePicker({
  value: '',
  placeholder: '结束日期',
  clearable: true,
  onChange: value => {
    state.endDate = value
  },
})
```

## 业务文书日期数据元

业务文书中的日期数据元通常不应允许随便打字。推荐交互：

- 文档中点击日期数据元，打开 `DatePickerPopup`。
- 日期数据元清除由业务提供清除按钮或 DatePicker clearable 行为完成。
- 日期时间值统一保存为 ISO 字符串。
- 日期显示可用空格分隔，持久化值仍使用 `T`。
- 如果日期数据元断行显示，清除按钮和 popup 锚点应由业务按数据元首行或当前编辑矩形定位。

## 生命周期

`RenderDatePicker.dispose()` 会：

- 从 `FocusManager` 注销。
- dispose 内部 `DatePickerPopup`。
- 清理 hover 状态。
- 调用父类 `dispose()`。

`DatePickerPopup.dispose()` 会关闭 popup、解绑键盘路由并清理 PopupManager 当前弹窗引用。页面、表格编辑器、文档编辑器销毁时，应同步释放持有的 popup。

## 常见问题

### 为什么 DatePicker 不允许直接输入任意日期字符串？

DatePicker 是受控日期组件，目的是避免自由文本造成格式不一致。用户可以通过日历选择或分段数字输入录入日期。

### 为什么 showTime 为 true 时 value 里是 `T`，显示时是空格？

`T` 是持久化格式，便于和 ISO 日期时间字符串兼容；显示时用空格更符合表单阅读习惯。

### 为什么点击日期不会立即关闭弹窗？

弹窗提供“今日 / 确定 / 取消”三类明确操作。点击日期只改变临时选择，点击确定才提交，点击取消不提交。

### 为什么时间段输入完成后不自动跳到下一段？

时间输入容易连续快速输入。自动跳段可能导致用户不知道当前焦点已经移动，后续数字误改其他段。当前策略是时间段输入完成后停留在本段，手动点击或 Tab 才切换。

### 为什么 readonly 不能打开弹窗？

readonly 表示展示但禁止修改。打开弹窗会产生可编辑入口，因此 readonly 下不聚焦、不打开、不清除。

## 相关组件

- [TextBox](./text-box.md)：单行文本输入。
- [TextArea](./text-area.md)：多行文本输入。
- [ComboBox](../selector/combo-box.md)：单选下拉。
- [DataGrid](../data/data-grid.md)：查询表单和表格单元格编辑。
- [Popup](../overlay/popup.md)：弹窗基础机制。
- [GridPanel](../../layouts.md)：表单布局。
