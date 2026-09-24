# CheckedComboBox 勾选组合框

> **通用布局能力**：`RenderCheckedComboBox` 支持 `width`、`height`、min/max、`margin` 和槽位对齐，详见[组件通用布局属性](../common-layout-properties.md)。

`RenderCheckedComboBox` 是 [MultiSelectDropdown](./multi-select-dropdown.md) 的高密度摘要模式。它继续使用同一个 `MultiSelectDropdownPopup` 完成搜索、分组、勾选、键盘导航和滚动，只把触发字段中的多个 chip 改为一行摘要文本。

它适合选中项可能很多、字段宽度有限，但操作员仍需要在下拉浮层中连续勾选的后台表单。


## API 总览

主类和公开类型：

- `RenderCheckedComboBox`
- `RenderCheckedComboBoxOptions`
- `DropdownOption`
- `FormFieldStatus`

导入：

```ts
import {
  RenderCheckedComboBox,
  type DropdownOption,
  type RenderCheckedComboBoxOptions,
} from 'ds-ui'
```

## 何时使用

- 查询条件需要选择多个状态、部门、角色或类别。
- 已选项数量较多，不适合在输入框内逐个绘制 chip。
- 表单追求固定行高和较高信息密度。
- 仍然需要搜索、分组、禁用候选项和完整键盘操作。

不适合：

- 需要在触发字段中直接查看并删除每一个已选项，使用 [MultiSelectDropdown](./multi-select-dropdown.md)。
- 需要输入并创建自由标签，使用 [TokenEdit](./token-edit.md)。
- 只能选择一个值，使用 [ComboBox](./combo-box.md)。
- 候选项是树结构，使用 [DropCheckTreeEdit](./drop-check-tree-edit.md)。

## 最小示例

```ts
import {
  RenderCheckedComboBox,
  type DropdownOption,
} from 'ds-ui'

const statusOptions: DropdownOption[] = [
  { value: 'draft', label: '暂存' },
  { value: 'submitted', label: '已提交' },
  { value: 'executing', label: '执行中' },
  { value: 'stopped', label: '已停止' },
]

const statusEdit = new RenderCheckedComboBox({
  options: statusOptions,
  values: ['submitted', 'executing'],
  searchable: true,
  clearable: true,
  onChange: (values, selectedOptions) => {
    state.statusValues = values
    state.statusLabels = selectedOptions.map(option => option.label)
  },
})
```

## 候选项模型

CheckedComboBox 直接复用 `DropdownOption`：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `value` | `string` | 是 | 稳定且唯一的提交值。 |
| `label` | `string` | 是 | 摘要和 popup 中使用的显示文本。 |
| `group` | `string` | 否 | popup 分组名称。 |
| `disabled` | `boolean` | 否 | 禁用该候选项；仍显示在 popup 中，但不能切换。 |

`values` 会按 `options` 顺序归一化。不存在于 `options` 的值会被丢弃，重复值只保留一次。

## 构造参数

`RenderCheckedComboBoxOptions` 等于 `RenderMultiSelectDropdownOptions` 去掉 `displayMode`。组件始终以摘要模式创建。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `options` | `DropdownOption[]` | 必填 | 候选项数组。 |
| `values` | `string[]` | `[]` | 初始选中值。 |
| `placeholder` | `string` | `'请选择...'` | 没有选中值时的提示文本。 |
| `onChange` | `(values: string[], options: DropdownOption[]) => void` | `undefined` | 勾选、取消、清除时触发。 |
| `searchable` | `boolean` | `false` | 是否在 popup 顶部显示搜索框。 |
| `maxVisibleItems` | `number` | `8` | popup 最大可见行数。 |
| `disabled` | `boolean` | `false` | 禁用整个字段。 |
| `readonly` | `boolean` | `false` | 只读显示，不允许打开或修改。 |
| `status` | `FormFieldStatus` | `'default'` | `'default'`、`'success'`、`'warning'` 或 `'error'`。 |
| `helperText` | `string` | `''` | 字段下方的帮助或错误文案。 |
| `prefixText` | `string` | `''` | 值区域左侧固定文本。 |
| `suffixText` | `string` | `''` | 值区域右侧固定文本。 |
| `clearable` | `boolean` | `false` | 有选中值时是否显示整组清除按钮。 |

```ts
const departmentEditOptions: RenderCheckedComboBoxOptions = {
  options: [
    { value: 'group-a', label: '分组 A', group: '场景 A' },
    { value: 'group-b', label: '分组 B', group: '场景 A' },
    { value: 'scenario-b', label: '场景 B', group: '场景 B' },
  ],
  values: [],
  placeholder: '选择负责部门',
  searchable: true,
  maxVisibleItems: 6,
  clearable: true,
  prefixText: '部门',
  onChange: values => {
    state.departmentValues = values
  },
}

const departmentEdit = new RenderCheckedComboBox(departmentEditOptions)
```

## 摘要显示规则

触发字段不会绘制可删除 chip，而是根据扣除 padding、前后缀、清除按钮和下拉箭头后的实际可用宽度生成单行摘要：

| 可用空间 | 显示内容 |
| --- | --- |
| 没有选中值 | `placeholder`。 |
| 能容纳全部标签 | 按 `options` 顺序显示完整的 `label1, label2, label3`。 |
| 只能容纳部分标签 | 显示可见标签和隐藏数量，例如 `label1, label2 +2`。 |
| 不能同时容纳标签和隐藏数量 | 回退为 `已选择 N 项`。 |
| 连数量摘要也放不下 | 在可用宽度内显示省略文本。 |

选中第三项不会再触发固定折叠；宽字段会继续显示完整标签，只有空间不足时才逐级退化。完整选中集合始终保存在 `values` 中，并在 popup 中以复选框状态呈现。

因为触发字段不显示单项删除按钮，删除某一个值需要重新打开 popup 并取消勾选；`clearable` 只负责一次清空全部值。

## 属性

`RenderCheckedComboBox` 继承 `RenderMultiSelectDropdown` 的公开属性：

| 属性 | 类型 | 可写 | 说明 |
| --- | --- | --- | --- |
| `options` | `DropdownOption[]` | 是 | 重新赋值会按新候选项归一化 `values`，并原位刷新已打开的 popup。 |
| `values` | `string[]` | 是 | 当前选中值；读取返回副本。 |
| `placeholder` | `string` | 是 | 空值提示。 |
| `onChange` | `(values, options) => void \| undefined` | 是 | 值变化回调。 |
| `searchable` | `boolean` | 是 | 下一次打开 popup 时是否显示搜索框。 |
| `maxVisibleItems` | `number` | 是 | 下一次打开 popup 时使用的最大可见行数。 |
| `disabled` | `boolean` | 是 | 设为 `true` 会关闭 popup、失焦并清理交互状态。 |
| `readonly` | `boolean` | 是 | 设为 `true` 会关闭 popup、失焦并清理交互状态。 |
| `status` | `FormFieldStatus` | 是 | 表单状态色。 |
| `helperText` | `string` | 是 | 帮助或错误文案。 |
| `prefixText` | `string` | 是 | 前缀文本。 |
| `suffixText` | `string` | 是 | 后缀文本。 |
| `clearable` | `boolean` | 是 | 是否允许整组清除。 |
| `displayMode` | `'chips' \| 'summary'` | 是 | 构造时固定为 `'summary'`。业务不应修改；需要 chip 模式时直接使用 MultiSelectDropdown。 |
| `isFocused` | `boolean` | 否 | 当前是否拥有焦点。 |

对 `options` 重新赋值只做归一化，不触发 `onChange`。如果业务状态也需要同步，应在赋值后读取一次 `values`。

## 方法

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `focusIn()` | `void` | 进入焦点，通常由 `FocusManager` 调用。 |
| `focusOut()` | `void` | 退出焦点，通常由 `FocusManager` 调用。 |
| `dispose()` | `void` | 关闭并释放 popup，注销焦点，清理指针状态。 |

组件没有公开的 `open()` 方法。popup 由字段点击或键盘操作打开。

## 鼠标行为

| 操作 | 行为 |
| --- | --- |
| 点击字段主体 | 聚焦并打开 popup；popup 已打开时关闭。 |
| 点击清除按钮 | 清空全部值，并触发 `onChange([], [])`。 |
| 点击 popup 候选项 | 切换该项勾选状态，立即触发 `onChange`，popup 保持打开。 |
| 点击 popup 分组头 | 不改变选中值。 |
| 滚轮或拖动滚动条 | 只滚动 popup 内候选项。 |
| 点击字段和 popup 之外 | 关闭 popup。 |

## 键盘行为

### 字段获得焦点时

| 按键 | 行为 |
| --- | --- |
| Enter / Space / ArrowDown | 打开 popup。 |
| Escape | popup 已打开时关闭。 |
| Backspace / Delete | `clearable: true` 且已有值时清空全部。 |
| Tab / Shift+Tab | 移动焦点；popup 会先关闭。 |

### Popup 打开时

| 按键 | 行为 |
| --- | --- |
| ArrowDown / ArrowUp | 在非禁用候选项之间循环移动。 |
| Home / End | 跳到第一个或最后一个可选项。 |
| Enter / Space | 切换当前项勾选状态。 |
| Escape | 关闭 popup。 |
| Tab | 关闭 popup并继续焦点导航。 |
| 非搜索模式下输入字符 | 跳到下一个以该字符开头的候选项。 |
| 搜索模式下输入 | 写入 popup 搜索框，并按 `label.includes(query)` 过滤。 |

搜索输入复用共享 `InputComposer`，支持中文 IME；组字期间的 Enter 不会切换候选项或关闭 popup。

## 只读和禁用

| 状态 | 可聚焦 | 可打开 popup | 可清除 | 视觉 |
| --- | --- | --- | --- | --- |
| 正常 | 是 | 是 | 取决于 `clearable` | 摘要文本和下拉箭头。 |
| `readonly` | 否 | 否 | 否 | 只读底色和锁图标。 |
| `disabled` | 否 | 否 | 否 | 禁用文本和边框。 |

## 生命周期

- 构造时会创建并持有一个 `MultiSelectDropdownPopup`，不会复制另一套 popup 实现。
- `options` 重新赋值会归一化当前 `values`，并原位刷新已打开的 popup，不会触发 `onChange`。
- `values` 重新赋值会同步刷新已打开 popup 的勾选状态，不需要先关闭再打开。
- `disabled` 或 `readonly` 变为 `true` 时会关闭 popup、清理 hover/pressed 状态并退出焦点。
- `dispose()` 会关闭并释放 popup、注销焦点并清理指针状态。
- 从 render tree 移除并且不再复用的实例，应正常调用 `dispose()`。

## 边界

- CheckedComboBox 只接受 `options` 中存在的枚举值，不创建自由标签。
- 搜索只处理当前内存中的 `options`，不负责远程查询；业务可以直接更新 `options`，已打开的 popup 会原位刷新。
- 触发字段只显示摘要，不提供单项 chip 删除。
- 组件保持单行固定高度，不自动换行。
- `group` 只影响 popup 视觉分组，不改变值结构。
- 组件不负责业务校验和保存；通过 `status`、`helperText` 和 `onChange` 与表单状态组合。

## 与 MultiSelectDropdown 的选择

| 需求 | 推荐 |
| --- | --- |
| 已选项较少，需要在字段内逐个查看、删除 | `RenderMultiSelectDropdown` |
| 已选项可能很多，优先保持字段紧凑 | `RenderCheckedComboBox` |
| 需要自由输入并创建标签 | `RenderTokenEdit` |

## 相关组件

- [MultiSelectDropdown](./multi-select-dropdown.md)
- [TokenEdit](./token-edit.md)
- [ComboBox](./combo-box.md)
- [DropCheckTreeEdit](./drop-check-tree-edit.md)
