# DateRangeEdit

> **通用布局能力**：`DateRangeEditOptions` 继承 `RenderBoxOptions`，可在构造时配置 `width`、`height`、min/max、`margin` 和槽位对齐，也可在创建后通过对应属性调整。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderDateRangeEdit` 是一个日期范围编辑组件。它使用一个输入框展示结果，点击后打开一个横向双日历 popup。左右两侧都是与 `DatePicker` 一致的完整日历面板，支持日、月、年三级切换；每侧各自选择一个日期，确认时组件比较两个日期，较小值写入 `start`，较大值写入 `end`。

两个日历是独立的日期选择面板，选择过程中不强制承担开始日期或结束日期的身份，因此不存在反向范围错误，也没有先选起点、再选终点的状态切换。提交并再次打开后，左侧显示规范化后的 `start`，右侧显示 `end`。

首版只处理日历日期，不包含时间和时区。


## 基本使用

```ts
import { RenderDateRangeEdit } from 'ds-ui'

const range = new RenderDateRangeEdit({
  value: {
    start: '2026-07-01',
    end: '2026-07-31',
  },
  clearable: true,
  onChange: value => {
    console.log(value.start, value.end)
  },
})
```

## 值模型

```ts
interface DateRangeValue {
  start: string | null
  end: string | null
}
```

- 日期使用 `YYYY-MM-DD`。
- 支持的日历范围为 `0001-01-01` 到 `9999-12-31`。
- `{ start:null, end:null }` 表示空值。
- 确认时必须已经选择两个有效日期。
- 无论两个日历按什么顺序选择，确认后始终满足 `start <= end`。
- 外部传入的反向范围也会自动交换两端。
- 起点无效时，终点也会被清空。

## popup 交互

1. 点击组件打开一个 popup，左右并排显示两个完整日历。
2. 每侧标题使用 `YYYY年 M月` 与统一的 `chevron-down` 图标；点击标题可从日期视图切换到月份视图，再切换到年份视图。
3. 两个日历分别保存自己的视图层级、当前年月、键盘位置和选中日期，可以独立导航。
4. 点击任意日历中的日期，只替换该日历的选择，不会清空或重新解释另一个日期。
5. 两个日期完整后，日历使用浅色背景提示范围，popup 底部预览最终保存结果；如果左侧日期晚于右侧日期，预览会自动按大小交换。
6. 点击“确定”统一排序并触发 `onChange`；点击“取消”保留打开 popup 前的组件值。
7. “今天”会把两个日期同时设为今天，仍需点击“确定”提交。

在 `0001-01` 和 `9999-12`，越过支持范围的相邻月日期不显示，也不能点击。翻月和键盘移动会停在对应边界。

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `value` | `DateRangeValue` | 空范围 | 当前受控日期范围。 |
| `placeholder` | `string` | `'选择日期范围'` | 空值提示。 |
| `separator` | `string` | `' ~ '` | 输入框中两个日期之间的显示文本。 |
| `onChange` | `(value: DateRangeValue) => void` | `undefined` | 确认或清空时调用。 |
| `disabled` | `boolean` | `false` | 禁用焦点、popup 和清除。 |
| `readonly` | `boolean` | `false` | 只读显示，不允许打开 popup。 |
| `status` | `FormFieldStatus` | `'default'` | 成功、警告和错误状态。 |
| `helperText` | `string` | `''` | 字段下方提示。 |
| `prefixText` | `string` | `''` | 输入区前缀。 |
| `suffixText` | `string` | `''` | 输入区后缀。 |
| `clearable` | `boolean` | `false` | 有值时显示清除入口。 |

## 键盘行为

组件获得焦点后：

| 按键 | 行为 |
| --- | --- |
| `Enter` / `Space` / `Down` | 打开或关闭日期范围 popup。 |
| `Escape` | 关闭 popup，不提交当前选择。 |

popup 打开后：

| 按键 | 行为 |
| --- | --- |
| `Tab` | 从左日历切到右日历；在右日历按下时关闭 popup，并继续移动到下一个表单字段。 |
| `Shift+Tab` | 从右日历切回左日历；在左日历按下时关闭 popup，并继续移动到上一个表单字段。 |
| `Left` / `Right` | 日期视图前后移动一天；月份或年份视图移动一个单元。 |
| `Up` / `Down` | 日期视图前后移动一周；月份或年份视图移动一行。 |
| `PageUp` / `PageDown` | 日期视图前后移动一个月；月份或年份视图移动到相邻年份或年份区间。 |
| `Enter` | 日期视图写入当前日期；月份和年份视图进入下一层。 |
| `Escape` | 取消并关闭 popup。 |

字段清除按钮在指针抬起时提交：只有手势仲裁成功且抬起仍命中按钮才清空范围；父级滚动、reject、cancel 或 leave 都会取消本次清除。

## 方法和状态

| API | 说明 |
| --- | --- |
| `value` | 读取或替换受控日期范围。 |
| `getValue()` / `setValue()` | `ValueEditor` 标准值接口。 |
| `commitEdit()` | 提交 popup 中的两个日期；任一日期为空时返回 `false`。 |
| `cancelEdit()` | 关闭 popup 并丢弃尚未确认的选择。 |
| `disabled` / `readonly` | 动态改变交互状态。 |
| `status` / `helperText` | 动态设置字段状态。 |
| `debugState()` | 返回当前值和双日历 popup 的诊断状态。 |

`DateRangePickerPopup` 也公开导出，供特殊宿主复用。普通表单页面应优先使用 `RenderDateRangeEdit`。

## 当前边界

- 不包含时间范围；日期时间区间由业务组合或后续专用组件承担。
- 不内置“最近 7 天”“本月”等业务快捷范围。
- 不接管查询提交，组件只返回排序后的日历日期范围。
- 当前不作为 DataGrid 默认列类型。范围通常是查询条件，而不是单个业务单元格。

## 相关组件

- [DatePicker](date-picker.md)
- [TimeEdit](time-edit.md)
- [ButtonEdit](button-edit.md)

## 日期时间范围

`DateRangeEdit` 继续保持纯日期语义，不增加可选时间字段。需要同时编辑开始/结束日期和时刻时，使用 [DateTimeRangeEdit](date-time-range-edit.md)；只有两个时刻且不带日期时，使用 [TimeRangeEdit](time-range-edit.md)。
