# MultiSelectDropdown 多选下拉

> **通用布局能力**：`RenderMultiSelectDropdown` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；chip、输入区和 popup 的内部尺寸由组件配置管理。详见[组件通用布局属性](../common-layout-properties.md)。


DirectSurface UI 的多选下拉公共类名是 `RenderMultiSelectDropdown`。它用于从同一组选项中选择多个值，触发字段负责表单布局、chip 展示、焦点和清除；独立 `MultiSelectDropdownPopup` 负责浮层里的搜索、分组、复选框、滚动和可选 footer 操作。

`MultiSelectDropdown` 和 [ComboBox](./combo-box.md) 复用同一类 `DropdownOption`，但值模型不同：单选使用 `value: string`，多选使用 `values: string[]`。

## API 总览

主类：

- `RenderMultiSelectDropdown`
- `MultiSelectDropdownPopup`

相关 public type：

- `DropdownOption`
- `FormFieldStatus`
- `RenderMultiSelectDropdownOptions`
- `MultiSelectDropdownDisplayMode`

导入：

```ts
import {
  MultiSelectDropdownPopup,
  RenderMultiSelectDropdown,
  type DropdownOption,
  type FormFieldStatus,
  type MultiSelectDropdownDisplayMode,
  type RenderMultiSelectDropdownOptions,
} from 'directsurface'
```

`RenderMultiSelectDropdownOptions` 是公开构造参数类型，并继承通用的 `RenderBoxOptions` 布局属性。`MultiSelectDropdownDisplayMode` 用于在标准 chip 模式和摘要模式之间切换。

## 何时使用

- 一个字段需要选择多个枚举值，例如多标签、多状态、多部门、多角色。
- 候选项来自扁平字典，但可按 `group` 做视觉分组。
- 需要在表单字段里展示已选项 chip，并支持单个删除。
- 查询条件需要多选过滤，例如“多个负责部门”或“多个状态”。

不适合：

- 只能选择一个值，使用 [ComboBox](./combo-box.md)。
- 候选项是树结构且需要父子勾选联动，使用 [DropCheckTreeEdit](./drop-check-tree-edit.md)。
- 候选项需要多列信息，使用 [LookupEdit](./lookup-edit.md) 或 [DropTreeGridEdit](./drop-tree-grid-edit.md)。
- 自由输入多个文本标签，当前组件不负责 tag 创建，应由业务先创建候选项再选择。

## 最小示例

```ts
import { RenderMultiSelectDropdown, type DropdownOption } from 'directsurface'

const tagOptions: DropdownOption[] = [
  { value: 'critical', label: '危急' },
  { value: 'follow-up', label: '随访' },
  { value: 'archive', label: '归档' },
]

const tagState = {
  tagValues: ['critical'],
  tagLabels: ['危急'],
}

const tagDropdown = new RenderMultiSelectDropdown({
  options: tagOptions,
  values: tagState.tagValues,
  onChange: (values, options) => {
    tagState.tagValues = values
    tagState.tagLabels = options.map(option => option.label)
  },
})
```

## 组件关系

| 组件 | 用途 | 说明 |
| --- | --- | --- |
| `RenderMultiSelectDropdown` | 标准多选下拉字段。 | 参与布局、焦点、hover、只读禁用、chip 删除和表单状态。 |
| `MultiSelectDropdownPopup` | 独立多选浮层。 | 可由标准字段内部使用，也可给自定义触发器或表格编辑器使用。 |
| `DropdownOption` | 候选项数据结构。 | 复用 ComboBox 的 `value`、`label`、`group`、`disabled`。 |

## 候选项和选中值

```ts
const roleOptions: DropdownOption[] = [
  { value: 'editor', label: '用户', group: '业务' },
  { value: 'reviewer', label: '审核者', group: '业务' },
  { value: 'admin', label: '管理员', group: '系统' },
  { value: 'disabled-role', label: '停用角色', disabled: true },
]
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `value` | `string` | 是 | 提交值。必须稳定、唯一。 |
| `label` | `string` | 是 | 显示文本。chip、popup、tooltip 都使用它。 |
| `group` | `string` | 否 | 分组名称。popup 中连续相同 group 会绘制一个分组头。 |
| `disabled` | `boolean` | 否 | 禁用单个候选项。禁用项可显示，但不能勾选或取消勾选。 |

`values` 会按 `options` 顺序归一化。不存在于 `options` 的值会被丢弃，重复值也只保留一次。

## RenderMultiSelectDropdown 构造参数

`new RenderMultiSelectDropdown(options)` 的 `options`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `options` | `DropdownOption[]` | 必填 | 候选项数组。 |
| `values` | `string[]` | `[]` | 初始选中值。会按 `options` 归一化。 |
| `placeholder` | `string` | `'请选择...'` | 未选择时显示的提示文本。 |
| `onChange` | `(values: string[], options: DropdownOption[]) => void` | `undefined` | 值变化回调。勾选、取消勾选、清除、删除 chip 都会触发。 |
| `searchable` | `boolean` | `false` | popup 是否显示搜索框。搜索只过滤候选项，不创建新值。 |
| `maxVisibleItems` | `number` | `8` | popup 最多显示的行数。超过后显示 popup 内滚动条。 |
| `disabled` | `boolean` | `false` | 禁用。不可聚焦、不可打开、不可清除、不可删除 chip。 |
| `readonly` | `boolean` | `false` | 只读。不可聚焦、不可打开、不可清除、不可删除 chip，触发区显示只读锁图标。 |
| `status` | `FormFieldStatus` | `'default'` | 表单状态。可选 `'default'`、`'success'`、`'warning'`、`'error'`。 |
| `helperText` | `string` | `''` | 字段下方帮助或错误文案。会增加组件高度。 |
| `prefixText` | `string` | `''` | 输入区域左侧固定文本。 |
| `suffixText` | `string` | `''` | 输入区域右侧固定文本。 |
| `clearable` | `boolean` | `false` | 有选中值、非禁用、非只读时显示清除按钮，并允许 Backspace/Delete 清空全部。 |
| `displayMode` | `MultiSelectDropdownDisplayMode` | `'chips'` | `'chips'` 显示可删除 chip；`'summary'` 显示一行选中摘要。 |

```ts
const selectableRoles: DropdownOption[] = [
  { value: 'editor', label: '用户' },
  { value: 'reviewer', label: '审核者' },
  { value: 'admin', label: '管理员' },
]
const roleDropdown = new RenderMultiSelectDropdown({
  options: selectableRoles,
  values: ['editor', 'reviewer'],
  placeholder: '选择角色',
  searchable: true,
  maxVisibleItems: 6,
  clearable: true,
  prefixText: '角色',
  helperText: '',
  onChange: (values, options) => {
    state.roleValues = values
    state.roleNames = options.map(option => option.label)
  },
})
```

## RenderMultiSelectDropdown 属性

| 属性 | 类型 | 可写 | 说明 |
| --- | --- | --- | --- |
| `options` | `DropdownOption[]` | 是 | 当前候选项。重新赋值会按新候选项归一化 `values`，并原位刷新已打开的 popup。 |
| `values` | `string[]` | 是 | 当前选中值。赋值会按 `options` 顺序归一化并重绘。读取时返回副本。 |
| `placeholder` | `string` | 是 | 空值提示文本。公开字段，直接修改后如需立即刷新，应触发重绘。 |
| `onChange` | `(values: string[], options: DropdownOption[]) => void \| undefined` | 是 | 值变化回调。 |
| `searchable` | `boolean` | 是 | 是否开启搜索。公开字段；修改后下一次打开 popup 生效。 |
| `maxVisibleItems` | `number` | 是 | popup 最大可见项数。公开字段；修改后下一次打开 popup 生效。 |
| `disabled` | `boolean` | 是 | 禁用状态。设为 `true` 会清理指针状态、失焦并关闭 popup。 |
| `readonly` | `boolean` | 是 | 只读状态。设为 `true` 会清理指针状态、失焦并关闭 popup。 |
| `status` | `FormFieldStatus` | 是 | 状态色。赋值会重绘。 |
| `helperText` | `string` | 是 | 帮助文案。赋值会重新 layout。 |
| `prefixText` | `string` | 是 | 前缀文本。赋值会重绘。 |
| `suffixText` | `string` | 是 | 后缀文本。赋值会重绘。 |
| `clearable` | `boolean` | 是 | 是否显示清除按钮。赋值会重绘。 |
| `isFocused` | `boolean` | 否 | 当前是否拥有焦点。 |

`placeholder`、`onChange`、`searchable`、`maxVisibleItems` 是公开字段，不是 setter。运行时修改它们时，如果当前视觉需要立即刷新，应由业务触发一次重绘；popup 行为会在下一次打开时读取新值。

## RenderMultiSelectDropdown 方法

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `focusIn()` | `void` | 进入焦点。通常由 `FocusManager` 调用。 |
| `focusOut()` | `void` | 退出焦点。通常由 `FocusManager` 调用。 |
| `dispose()` | `void` | 释放内部 popup、注销焦点、清理 hover、pressed 和 chip 状态。 |

`RenderMultiSelectDropdown` 没有公开 `open()` 方法。打开行为由点击、Enter、Space 或 ArrowDown 触发；需要自定义确认流程或 popup 宽度时，可直接使用 `MultiSelectDropdownPopup`。

## 触发字段显示规则

触发字段优先绘制 chip：

- 没有选中值：显示 `placeholder`。
- 有选中值且空间足够：按 `options` 顺序绘制可删除 chip。
- 空间不足：绘制前几个 chip，并追加 `+N` 溢出 chip。
- 点击普通 chip 的删除区域会删除该值；点击 `+N` 溢出 chip 会打开 popup。

```ts
const manyTagsDropdown = new RenderMultiSelectDropdown({
  options: [
    { value: 'a', label: '异常' },
    { value: 'b', label: '过敏' },
    { value: 'c', label: '长期任务' },
    { value: 'd', label: '随访' },
  ],
  values: ['a', 'b', 'c', 'd'],
  clearable: true,
  onChange: values => {
    state.tags = values
  },
})
```

即使普通 chip 一个都放不下，标准 `'chips'` 模式仍会显示 `+N` 溢出 chip，不会切换成文本摘要。

显式使用 `displayMode: 'summary'` 时，组件按照实际可用宽度生成单行摘要：

- 能容纳全部标签时，按 `options` 顺序显示完整标签。
- 只能容纳部分标签时，显示可见标签和隐藏数量，例如 `label1, label2 +2`。
- 不能同时容纳标签和隐藏数量时，回退为 `已选择 N 项`。
- 连数量摘要也放不下时，在可用宽度内显示省略文本。

摘要模式不存在固定的选中数量折叠阈值。

## 鼠标行为

| 操作 | 行为 |
| --- | --- |
| 点击字段主体 | 获得焦点并打开 popup；popup 已打开时关闭。 |
| 点击清除按钮 | 在同一按钮内完成按下和抬起后清空全部 `values`，触发 `onChange([], [])`，字段保持焦点。若滚动手势接管则不清空。 |
| 点击 chip 删除区域 | 在同一删除区域内完成按下和抬起后删除对应值，触发 `onChange(nextValues, nextOptions)`。若滚动手势接管则不删除。 |
| 点击 `+N` 溢出 chip | 打开 popup。 |
| 点击 popup 候选项 | 切换该项勾选状态；标准字段不会关闭 popup。 |
| 点击 popup 分组头 | 不切换选中状态。 |
| hover popup 长文本候选项 | 如果文本被截断，显示完整 `label` tooltip。 |
| 鼠标移出 popup 列表 | 清理 hover，不会把 hover 自动跳回第一项。 |
| 滚轮滚动 popup | 只滚动 popup 内候选行，并消费滚轮事件。 |
| 拖动 popup 滚动条 | 更新 popup 内部 `scrollOffset`。 |

## 键盘行为

### 字段获得焦点时

| 按键 | 行为 |
| --- | --- |
| Enter | 打开 popup。 |
| Space | 打开 popup。 |
| ArrowDown | 打开 popup。 |
| Escape | 如果 popup 已打开则关闭。 |
| Backspace / Delete | 当 `clearable` 且有选中值时清空全部。 |
| Tab / Shift+Tab | 由 `FocusManager` 移动焦点；popup 打开时会先关闭 popup。 |

### Popup 打开时

| 按键 | 行为 |
| --- | --- |
| ArrowDown / ArrowUp | 在可选候选项之间循环移动，跳过 disabled 项。 |
| Home / End | 跳到第一个或最后一个可选候选项。 |
| Enter / Space | 标准即时提交模式下切换当前候选项勾选状态。 |
| Enter | footer 确认模式下执行确认并关闭 popup。 |
| Escape | 关闭 popup。 |
| Tab | 关闭 popup，并让焦点继续移动。 |
| 非搜索模式下输入字符 | 跳到下一个以该字符开头的候选项。 |
| 搜索模式下输入字符 | 输入到 popup 搜索框，按 `label.includes(query)` 过滤候选项。 |

搜索 popup 使用共享 `InputComposer`，支持中文 IME。composition update 刷新搜索框显示，composition end 后更新过滤结果。组字期间的 Enter（包括 `keyCode 229` 兼容路径）不会切换候选项或关闭 popup。

## 清除和删除

多选下拉有两类清除入口：

- 清除按钮：清空全部选中值。
- chip 删除按钮：删除单个值。

清除按钮显示条件：

- `clearable === true`
- `values.length > 0`
- 非 `disabled`
- 非 `readonly`

```ts
const clearableRoleOptions: DropdownOption[] = [
  { value: 'editor', label: '用户' },
  { value: 'reviewer', label: '审核者' },
]
const clearableDropdown = new RenderMultiSelectDropdown({
  options: clearableRoleOptions,
  values: ['editor', 'reviewer'],
  clearable: true,
  onChange: (values, options) => {
    state.roleValues = values
    state.roleNames = options.map(option => option.label)
  },
})
```

## 只读和禁用

| 状态 | 可聚焦 | 可打开 popup | 可删除 chip | 可清除 | 视觉 |
| --- | --- | --- | --- | --- | --- |
| 正常 | 是 | 是 | 是 | 取决于 `clearable` | 箭头图标。 |
| `readonly` | 否 | 否 | 否 | 否 | 只读底色和锁图标。 |
| `disabled` | 否 | 否 | 否 | 否 | 禁用文本和禁用边框。 |

如果字段只是当前流程不允许编辑，但仍要展示已选值，优先使用 `readonly`；如果字段完全不可交互，使用 `disabled`。

## 搜索和分组

开启 `searchable` 后，popup 顶部显示搜索输入框。过滤规则和 ComboBox 一致：

- 搜索内容和候选项 `label` 都转成小写后比较。
- 使用 `label.includes(query)`。
- 搜索为空时恢复全部候选项。
- 搜索后键盘索引重置到第一个可选候选项，滚动位置回到顶部。

`group` 会在 popup 内生成分组头：

```ts
const groupedDropdown = new RenderMultiSelectDropdown({
  options: [
    { value: 'create', label: '新建', group: '文档' },
    { value: 'edit', label: '编辑', group: '文档' },
    { value: 'audit', label: '审核', group: '流程' },
  ],
  values: [],
  searchable: true,
  onChange: values => {
    state.permissions = values
  },
})
```

分组头只用于显示，不可点击、不可键盘选中，也不会出现在 `values` 中。

## MultiSelectDropdownPopup 独立用法

`MultiSelectDropdownPopup` 适合自定义触发区、表格单元格编辑器，或需要底部“确定、取消、清除”按钮的场景。标准 `RenderMultiSelectDropdown` 使用即时提交模式，不显示 footer。

```ts
const popup = new MultiSelectDropdownPopup()
const popupAnchor: PopupAnchorTarget = {
  [GET_POPUP_ANCHOR_RECT]: () => ({
    x: 20,
    y: 20,
    width: 220,
    height: 32,
  }),
}
const popupOptions: DropdownOption[] = [
  { value: 'group-a', label: '分组 A' },
  { value: 'group-b', label: '分组 B' },
]

popup.open({
  options: popupOptions,
  selectedValues: state.wardValues,
  anchor: popupAnchor,
  searchable: true,
  maxVisibleItems: 6,
  minPopupWidth: 220,
  maxPopupWidth: 480,
  commitOnChange: false,
  showFooter: true,
  onChange: values => {
    state.previewWardValues = values
  },
  onConfirm: (values, options) => {
    state.wardValues = values
    state.wardNames = options.map(option => option.label)
  },
  onClear: () => {
    state.wardValues = []
    state.wardNames = []
  },
  onClose: () => {
    state.wardPopupOpen = false
  },
})
```

`MultiSelectDropdownPopup.open(options)` 的参数：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `options` | `DropdownOption[]` | 必填 | 候选项。 |
| `selectedValues` | `string[]` | 必填 | 当前选中值。打开时会按 `options` 归一化。 |
| `anchor` | `PopupAnchor` | 必填 | popup 定位锚点。 |
| `searchable` | `boolean` | 必填 | 是否显示搜索框。 |
| `maxVisibleItems` | `number` | 必填 | 最大可见行数。 |
| `minPopupWidth` | `number` | `undefined` | popup 最小宽度。 |
| `maxPopupWidth` | `number` | `560` | popup 最大宽度。 |
| `commitOnChange` | `boolean` | `true` | 切换候选项时是否立即触发 `onChange`。 |
| `showFooter` | `boolean` | `false` | 是否显示底部“确定、取消、清除”按钮。 |
| `onChange` | `(values: string[], options: DropdownOption[]) => void` | 必填 | 选中集合变化时触发。`commitOnChange: false` 时切换候选项不会触发。 |
| `onConfirm` | `(values: string[], options: DropdownOption[]) => void` | `undefined` | footer 确认时触发；未提供时确认会调用 `onChange`。 |
| `onClear` | `() => void` | `undefined` | footer 清除时触发。 |
| `onClose` | `() => void` | 必填 | popup 关闭后触发。 |

`MultiSelectDropdownPopup` 的公开成员：

| 成员 | 类型 / 返回值 | 说明 |
| --- | --- | --- |
| `selectedValues` | `string[]` | 当前 popup 内按 `options` 顺序归一化后的选中值。 |
| `open(options)` | `void` | 打开 popup。已打开时会先关闭旧 popup。 |
| `close()` | `void` | 关闭当前 popup。 |
| `debugState()` | `{ filteredOptions; rows; keyboardIndex; scrollOffset; selectedValues; searchText; searchable; hoveredFooterAction }` | 返回调试状态，供测试和诊断使用。 |
| `dispose()` | `void` | 关闭 popup、释放搜索输入和回调引用。 |

## 即时提交和确认提交

标准 `RenderMultiSelectDropdown` 使用即时提交：

- 点击选项立即更新触发字段 `values`。
- 立即触发 `onChange`。
- popup 保持打开，方便连续多选。

独立 `MultiSelectDropdownPopup` 可以使用确认提交：

- `commitOnChange: false`
- `showFooter: true`
- 点击选项只更新 popup 内部集合，不触发 `onChange`。
- 点击“确定”触发 `onConfirm` 并关闭。
- 点击“取消”只关闭。
- 点击“清除”清空内部集合，按当前实现会触发 `onClear` 并关闭；如果 `commitOnChange: true`，清除还会先触发 `onChange([], [])`。

这种模式适合候选项很多、操作员需要确认后再提交的业务场景。

## Popup 宽度和长文本

`MultiSelectDropdownPopup` 使用与 ComboBox 相同的 `resolveDropdownPopupLayout()`：

- 不小于触发锚点宽度。
- 不小于 `minPopupWidth`。
- 不超过 `maxPopupWidth`，默认最大宽度为 560。
- 不超出视口左右 8px 边距。
- 下方空间不足时尝试显示到锚点上方。
- 高度不足时减少可见行并启用内部滚动。

候选项文本过长时，popup 内会使用省略号；hover 被截断的选项时，tooltip 显示完整 `label`。

## 生命周期

- `RenderMultiSelectDropdown.dispose()` 会释放内部 popup、注销焦点并清理 chip 指针状态。
- `RenderMultiSelectDropdown.detach()` 继承 render object 生命周期；离开树前应确保组件被正常 dispose。
- `options` 重新赋值会按新 options 归一化 `values`，并原位刷新已打开的 popup，但不会触发 `onChange`。
- `values` 重新赋值会同步刷新已打开 popup 的勾选状态，不需要先关闭再打开。
- `disabled` 或 `readonly` 变为 `true` 会关闭 popup、失焦并清理 hover/pressed 状态。
- `MultiSelectDropdownPopup.dispose()` 会结束搜索输入 session，避免隐藏 textarea 或计时器泄漏。

## 表单组合建议

多选下拉使用共享的触发字段壳，支持前缀、后缀、helper 文案和状态色：

```ts
const requiredTagsDropdown = new RenderMultiSelectDropdown({
  options: [
    { value: 'special', label: '特殊任务' },
    { value: 'allergy', label: '过敏史' },
  ],
  values: state.riskTags,
  prefixText: '标签',
  clearable: true,
  status: state.riskTags.length > 0 ? 'default' : 'warning',
  helperText: state.riskTags.length > 0 ? '' : '至少选择一个标签',
  onChange: values => {
    state.riskTags = values
  },
})
```

布局注意：

- 组件宽度由父布局约束决定；无限宽度下默认使用 200。
- `helperText` 会增加组件总高度。
- chip 只在输入框主体高度内横向排列；当前组件不自动把 chip 换到多行。
- 已选项较多时，触发区会用 `+N` 表示溢出，完整集合仍保存在 `values`。

## 主题和视觉

MultiSelectDropdown 复用这些主题 token：

- `deriveTextInputStyle()`：触发字段、placeholder、helper、清除按钮。
- `deriveDropdownStyle()`：popup 行高、选项文本、hover 背景、分割线和箭头。
- `deriveCheckboxStyle()`：popup 复选框和勾选标记。
- `derivePopupStyle()`：popup 外壳 padding、边框、阴影。
- `deriveScrollbarStyle()`：popup 内滚动条。
- `deriveTreeStyle().panelBg`：popup 面板背景。
- `paintChip()` / chip token：触发区已选项 chip 和删除按钮。

只读状态会额外绘制轻微 tint，并用 `lock` 图标替代下拉箭头，避免误以为可以操作。

## 常见问题

### 为什么传入的 `values` 顺序和读出来的不一样？

组件会按 `options` 顺序归一化选中值，这样 chip、popup 勾选和回调顺序都稳定。需要自定义顺序时，应调整 `options` 的顺序。

### 为什么 `options` 改了以后某些已选值消失？

不存在于新 `options` 的值会被过滤掉。这能避免界面展示无法解释的旧值。该过滤不会自动触发 `onChange`，业务如果需要同步保存，应在更新 options 后自行检查。

```ts
const resetOptions: DropdownOption[] = [
  { value: 'reviewer', label: '审核者' },
]
const resetDropdown = new RenderMultiSelectDropdown({
  options: [
    { value: 'editor', label: '用户' },
    { value: 'reviewer', label: '审核者' },
  ],
  values: ['editor', 'reviewer'],
})

resetDropdown.options = resetOptions
state.roleValues = resetDropdown.values
```

### 为什么 popup 不会选择后自动关闭？

多选场景通常需要连续勾选多个选项，所以标准字段保持 popup 打开。需要“选完点确定”时，使用独立 `MultiSelectDropdownPopup` 的 `showFooter` 和 `commitOnChange: false`。

### 为什么搜索框输入的文本不会变成新标签？

MultiSelectDropdown 是枚举多选组件，搜索只过滤候选项。如果业务需要创建新标签，应先由业务创建新的 `DropdownOption`，再更新 `options` 和 `values`。

## 相关组件

- [ComboBox](./combo-box.md)
- [DropCheckTreeEdit](./drop-check-tree-edit.md)
- [LookupEdit](./lookup-edit.md)
- [DropTreeGridEdit](./drop-tree-grid-edit.md)
- [TextBox](../input/text-box.md)
