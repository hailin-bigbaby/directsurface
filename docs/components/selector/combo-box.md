# ComboBox 单选下拉

> **通用布局能力**：`RenderComboBox` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；`fieldHeight` 只表示触发字段主体高度，popup 使用独立浮层尺寸。详见[组件通用布局属性](../common-layout-properties.md)。

DirectSurface UI 的单选下拉公共类名是 `RenderComboBox`。它用于从一组候选项中选择一个值，内部由触发字段和独立 `DropdownPopup` 组成。触发字段参与正常布局、焦点和表单状态；popup 通过 `PopupManager` 绘制在浮层上，不作为触发字段的子节点。

`ComboBox` 适合字典值域、状态字段、查询条件和表格单元格编辑。它不允许自由输入，搜索框只用于过滤候选项，最终提交的值一定来自 `options`。

## API 总览

主类：

- `RenderComboBox`
- `DropdownPopup`

相关 public type：

- `DropdownOption`
- `FormFieldStatus`

导入：

```ts
import {
  DropdownPopup,
  RenderComboBox,
  type DropdownOption,
  type FormFieldStatus,
} from 'ds-ui'
```

`RenderComboBox` 的构造参数是公开 options 对象，但当前没有单独导出的 ComboBox options 类型。业务代码直接按本文参数表传入对象。

## 何时使用

- 只能从候选项中选择一个值。
- 候选项数量少到中等，但需要键盘导航、搜索过滤或滚动。
- 表单字段需要统一的前缀、后缀、帮助文案、状态边框和清除按钮。
- 数据表格、文档数据元或查询区需要稳定的枚举值录入。

不适合：

- 需要多选，使用 [MultiSelectDropdown](./multi-select-dropdown.md)。
- 候选项来自树结构，使用 [DropTreeEdit](./drop-tree-edit.md)。
- 候选项需要表格列展示，使用 [LookupEdit](./lookup-edit.md) 或 [DropTreeGridEdit](./drop-tree-grid-edit.md)。
- 日期时间输入，使用 [DatePicker](../input/date-picker.md)。
- 任意文本输入，使用 [TextBox](../input/text-box.md)。

## 最小示例

```ts
import { RenderComboBox, type DropdownOption } from 'ds-ui'

const statusOptions: DropdownOption[] = [
  { value: 'active', label: '启用' },
  { value: 'disabled', label: '停用' },
]

const statusState = {
  status: 'active',
  statusLabel: '启用',
}

const statusDropdown = new RenderComboBox({
  options: statusOptions,
  value: statusState.status,
  onChange: (value, option) => {
    statusState.status = value
    statusState.statusLabel = option?.label ?? ''
  },
})
```


## 组件关系

| 组件 | 用途 | 说明 |
| --- | --- | --- |
| `RenderComboBox` | 标准单选下拉字段。 | 参与布局、焦点、hover、只读禁用、清除和表单状态。 |
| `DropdownPopup` | 独立下拉浮层。 | 由 `RenderComboBox` 内部持有，也可用于自定义触发器或表格单元格编辑器。 |
| `DropdownOption` | 候选项数据结构。 | `value` 是提交值，`label` 是显示文本。 |

## DropdownOption

```ts
const departmentOptions: DropdownOption[] = [
  { value: 'internal', label: '研发部' },
  { value: 'surgery', label: '产品部' },
  { value: 'archive', label: '已停用部门', disabled: true },
]
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `value` | `string` | 是 | 提交值。建议稳定、唯一，不要使用会变更的显示文本。 |
| `label` | `string` | 是 | 显示文本。触发字段、popup 选项、tooltip 都使用它。 |
| `group` | `string` | 否 | 预留分组字段。当前 `RenderComboBox` popup 不绘制分组标题。 |
| `disabled` | `boolean` | 否 | 禁用单个候选项。禁用项可显示，但点击和 Enter 不会选中。 |

`value` 和 `label` 都是字符串。如果业务值是数字或对象，应在业务层做映射，不要把复杂对象塞进 `value`。

## RenderComboBox 构造参数

`new RenderComboBox(options)` 的 `options`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `options` | `DropdownOption[]` | 必填 | 候选项数组。 |
| `value` | `string` | `''` | 当前选中值。空字符串表示未选择。 |
| `placeholder` | `string` | `'请选择...'` | 未选择时显示的提示文本。 |
| `onChange` | `(value: string, option: DropdownOption \| null) => void` | `undefined` | 值变化回调。选中候选项时 `option` 为对应项；清除时 `option` 为 `null`。 |
| `searchable` | `boolean` | `false` | popup 是否显示搜索框。搜索只过滤 `label`，不会提交自由输入文本。 |
| `maxVisibleItems` | `number` | `8` | popup 最多显示的行数。超过后显示 popup 内滚动条。 |
| `disabled` | `boolean` | `false` | 禁用。不可聚焦、不可打开、不可清除。 |
| `readonly` | `boolean` | `false` | 只读。不可聚焦、不可打开、不可清除，视觉上按只读状态绘制。 |
| `status` | `FormFieldStatus` | `'default'` | 表单状态。可选 `'default'`、`'success'`、`'warning'`、`'error'`。 |
| `helperText` | `string` | `''` | 字段下方帮助或错误文案。会增加组件高度。 |
| `prefixText` | `string` | `''` | 输入区域左侧固定文本。 |
| `suffixText` | `string` | `''` | 输入区域右侧固定文本。 |
| `clearable` | `boolean` | `false` | 有值、非禁用、非只读时显示清除按钮，并允许 Backspace/Delete 清除。 |

| `fieldHeight` | `number` | 主题默认高度 | 触发字段主体高度；组件总高度统一使用 `RenderBox.height`。 |

```ts
const selectableDepartments: DropdownOption[] = [
  { value: 'internal', label: '研发部' },
  { value: 'surgery', label: '产品部' },
]
const departmentDropdown = new RenderComboBox({
  options: selectableDepartments,
  value: '',
  placeholder: '选择部门',
  searchable: true,
  maxVisibleItems: 6,
  clearable: true,
  status: 'default',
  helperText: '',
  onChange: (value, option) => {
    state.departmentId = value
    state.departmentName = option?.label ?? ''
  },
})
```

## RenderComboBox 属性

| 属性 | 类型 | 可写 | 说明 |
| --- | --- | --- | --- |
| `options` | `DropdownOption[]` | 是 | 当前候选项。重新赋值会关闭已打开的 popup，但不会自动清空当前 `value`。 |
| `value` | `string` | 是 | 当前选中值。赋值会重绘；如果找不到对应 option，会显示 placeholder。 |
| `placeholder` | `string` | 是 | 空值提示文本。公开字段，直接修改后如需立即刷新，应触发重绘。 |
| `onChange` | `(value: string, option: DropdownOption \| null) => void \| undefined` | 是 | 值变化回调。 |
| `searchable` | `boolean` | 是 | 是否开启搜索。公开字段；修改后下一次打开 popup 生效。 |
| `maxVisibleItems` | `number` | 是 | popup 最大可见项数。公开字段；修改后下一次打开 popup 生效。 |
| `disabled` | `boolean` | 是 | 禁用状态。设为 `true` 会清理 hover、失焦并关闭 popup。 |
| `readonly` | `boolean` | 是 | 只读状态。设为 `true` 会清理 hover、失焦并关闭 popup。 |
| `status` | `FormFieldStatus` | 是 | 状态色。赋值会重绘。 |
| `helperText` | `string` | 是 | 帮助文案。赋值会重新 layout。 |
| `prefixText` | `string` | 是 | 前缀文本。赋值会重绘。 |
| `suffixText` | `string` | 是 | 后缀文本。赋值会重绘。 |
| `clearable` | `boolean` | 是 | 是否显示清除按钮。赋值会重绘。 |
| `isFocused` | `boolean` | 否 | 当前是否拥有焦点。 |

`placeholder`、`onChange`、`searchable`、`maxVisibleItems` 是公开字段，不是 setter。运行时修改它们时，框架不会自动知道所有视觉变化；如果已经显示在界面上，业务应触发一次重绘或在下一次打开 popup 前修改。

`fieldHeight` 可在构造后修改并触发重新布局。`height`、`minHeight`、`maxHeight`、`margin` 和对齐属性来自统一的 `RenderBox` 布局契约，不再由 ComboBox 维护第二套尺寸状态。

## RenderComboBox 方法

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `focusIn()` | `void` | 进入焦点。通常由 `FocusManager` 调用。 |
| `focusOut()` | `void` | 退出焦点。通常由 `FocusManager` 调用。 |
| `dispose()` | `void` | 释放内部 popup、注销焦点、清理 hover 和 focused 状态。 |

`RenderComboBox` 没有公开 `open()` 方法。打开行为由点击、Enter、Space 或 ArrowDown 触发；需要自定义打开策略时，可直接使用 `DropdownPopup`。

## 鼠标行为

| 操作 | 行为 |
| --- | --- |
| 点击字段主体 | 获得焦点并打开 popup；如果 popup 已打开，则关闭。 |
| 点击清除按钮 | 清空 `value`，触发 `onChange('', null)`，字段保持焦点。 |
| 点击 popup 候选项 | 选择该项、关闭 popup、触发 `onChange(value, option)`。 |
| 再次点击当前已选候选项 | `RenderComboBox` 默认不会在 popup 内清除；需要清除请使用字段清除按钮或键盘 Backspace/Delete。 |
| hover 触发字段 | 绘制 hover 状态。禁用和只读状态不会 hover。 |
| hover popup 长文本候选项 | 如果文本被截断，显示完整 `label` tooltip。 |
| 滚轮滚动 popup | 只在 popup 内滚动候选项，并消费滚轮事件，避免透传到外层滚动容器。 |
| 拖动 popup 滚动条 | 更新 popup 内部 `scrollOffset`。 |
| 点击触发字段外部 | popup 由 `PopupManager` 关闭。 |

清除按钮和 popup 内“再次点击已选项清除”不是同一套交互：`DropdownPopup` 支持 `clearable`，但 `RenderComboBox` 当前内部打开 popup 时没有把 `clearable` 传给 popup，因此标准 `RenderComboBox` 的清除入口是触发字段里的清除按钮和键盘清除。

## 键盘行为

### 字段获得焦点时

| 按键 | 行为 |
| --- | --- |
| Enter | 打开 popup。 |
| Space | 打开 popup。 |
| ArrowDown | 打开 popup。 |
| Escape | 如果 popup 已打开则关闭。 |
| Backspace / Delete | 当 `clearable` 且有值时清空，并触发 `onChange('', null)`。 |
| Tab / Shift+Tab | 由 `FocusManager` 移动焦点；popup 打开时会先关闭 popup。 |

### Popup 打开时

| 按键 | 行为 |
| --- | --- |
| ArrowDown / ArrowUp | 在可选候选项之间循环移动，跳过 disabled 项。 |
| Home / End | 跳到第一个或最后一个可选候选项。 |
| Enter | 选择当前键盘行或 hover 行。 |
| Escape | 关闭 popup。 |
| Tab | 关闭 popup，并让焦点继续移动。 |
| 非搜索模式下输入字符 | 跳到下一个以该字符开头的候选项。 |
| 搜索模式下输入字符 | 输入到 popup 搜索框，按 `label.includes(query)` 过滤候选项。 |

搜索 popup 使用共享 `InputComposer` 支持中文 IME。composition update 会实时刷新搜索框显示，composition end 后更新过滤结果。组字期间的 Enter（包括 `keyCode 229` 兼容路径）只交给输入法确认候选，不会选择下拉项或关闭 popup。

## 清除行为

`RenderComboBox` 的清除按钮显示条件：

- `clearable === true`
- `value.length > 0`
- 非 `disabled`
- 非 `readonly`

清除后：

- `value` 变成 `''`
- popup 关闭
- 字段获得焦点
- 触发 `onChange('', null)`

```ts
const yesNoDropdown = new RenderComboBox({
  options: [
    { value: 'yes', label: '是' },
    { value: 'no', label: '否' },
  ],
  value: 'yes',
  clearable: true,
  onChange: (value, option) => {
    state.answer = value
    state.answerLabel = option?.label ?? ''
  },
})
```

## 只读和禁用

| 状态 | 可聚焦 | 可打开 popup | 可清除 | 典型用途 |
| --- | --- | --- | --- | --- |
| 正常 | 是 | 是 | 取决于 `clearable` | 普通枚举选择。 |
| `readonly` | 否 | 否 | 否 | 展示已选值，但当前业务状态不允许修改。 |
| `disabled` | 否 | 否 | 否 | 当前字段不可用，且不参与交互。 |

如果字段需要显示真实值但不能修改，优先使用 `readonly`；如果字段在当前业务流程里完全不可操作，使用 `disabled`。

## 搜索模式

开启 `searchable` 后，popup 顶部会显示搜索输入框：

```ts
const categoryDropdown = new RenderComboBox({
  options: [
    { value: 'J00', label: '急性鼻咽炎' },
    { value: 'standard', label: '标准服务' },
    { value: 'express', label: '加急服务' },
  ],
  searchable: true,
  maxVisibleItems: 8,
  clearable: true,
  onChange: value => {
    state.categoryCode = value
  },
})
```

过滤规则：

- 搜索内容和候选项 `label` 都转为小写后比较。
- 使用 `label.includes(query)`，不是前缀匹配。
- 搜索为空时恢复全部候选项。
- 搜索后键盘索引重置，滚动位置回到顶部。

搜索框只是过滤条件，不会变成 `value`。如果需要输入任意文本并从候选项补全，应使用 Lookup 类组件，而不是 ComboBox。

## Popup 宽度和长文本

`DropdownPopup` 会根据候选项文本测量结果扩展宽度，同时受下面约束：

- 不小于触发字段宽度。
- 不小于 `minPopupWidth`。
- 不超过 `maxPopupWidth`，默认最大宽度为 560。
- 不超出视口左右 8px 边距。

如果候选项仍然放不下，popup 内显示省略号，hover 该项时 tooltip 显示完整 `label`。

```ts
const longTextOptions: DropdownOption[] = [
  {
    value: 'normal-skin',
    label: '皮肤粘膜未见异常，无肝掌，全身浅表淋巴结无肿大。未见皮下出血点，未见皮疹',
  },
]
```

标准 `RenderComboBox` 当前不暴露 `minPopupWidth` 和 `maxPopupWidth` 构造参数。需要控制 popup 宽度时，应使用自定义触发器和 `DropdownPopup`，或使用支持这些参数的业务组件。

## DropdownPopup 独立用法

`DropdownPopup` 适合表格单元格编辑器、文档数据元编辑器、或需要自定义触发区域的场景。它不参与布局，调用方必须提供 anchor 和回调。

```ts
const popup = new DropdownPopup()
const popupAnchor: PopupAnchorTarget = {
  [GET_POPUP_ANCHOR_RECT]: () => ({
    x: 20,
    y: 20,
    width: 180,
    height: 32,
  }),
}
const popupOptions: DropdownOption[] = [
  { value: 'internal', label: '研发部' },
  { value: 'surgery', label: '产品部' },
]

popup.open({
  options: popupOptions,
  selectedValue: state.departmentId,
  anchor: popupAnchor,
  searchable: true,
  maxVisibleItems: 6,
  maxPopupWidth: 420,
  clearable: true,
  onSelect: (value, option) => {
    state.departmentId = value
    state.departmentName = option.label
  },
  onClear: () => {
    state.departmentId = ''
    state.departmentName = ''
  },
  onClose: () => {
    state.departmentPopupOpen = false
  },
})
```

`DropdownPopup.open(options)` 的参数：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `options` | `DropdownOption[]` | 必填 | 候选项。 |
| `selectedValue` | `string` | 必填 | 当前选中值。 |
| `anchor` | `PopupAnchor` | 必填 | popup 定位锚点。 |
| `searchable` | `boolean` | 必填 | 是否显示搜索框。 |
| `maxVisibleItems` | `number` | 必填 | 最大可见行数。 |
| `minPopupWidth` | `number` | `undefined` | popup 最小宽度。 |
| `maxPopupWidth` | `number` | `560` | popup 最大宽度。 |
| `clearable` | `boolean` | `false` | 选中项可否通过再次点击当前项清除。 |
| `onSelect` | `(value: string, option: DropdownOption) => boolean \| void` | 必填 | 选择候选项时触发；返回 false 保持 popup 打开。 |
| `onClear` | `() => boolean \| void` | `undefined` | `clearable` 模式下再次点击当前已选项时触发；返回 false 保持 popup 打开。 |
| `onTab` | `(direction: 1 \| -1) => void` | `undefined` | 可选宿主导航钩子；配置后 Tab 关闭 popup 并通知方向。 |
| `onClose` | `() => void` | 必填 | popup 关闭后触发。 |

`DropdownPopup` 的公开方法：

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `open(options)` | `void` | 打开 popup。已打开时会先关闭旧 popup。 |
| `close()` | `void` | 关闭当前 popup。 |
| `debugState()` | `{ filteredOptions; keyboardIndex; scrollOffset; searchText; searchable; clearable }` | 返回调试状态，供测试和诊断使用。 |
| `dispose()` | `void` | 关闭 popup、释放搜索输入和回调引用。 |

`DropdownPopup` 的 `clearable` 行为和 `RenderComboBox` 不同：popup 的 `clearable` 表示“再次点击当前已选项清除”；字段的 `clearable` 表示“触发字段显示清除按钮”。

## Popup 定位和生命周期

`RenderComboBox` 实现了 `GET_POPUP_ANCHOR_RECT`，popup 会使用字段主体作为定位锚点。字段下方空间不足时，popup 会尝试显示到字段上方；如果视口高度不足，则减少可见行数并启用内部滚动。

生命周期规则：

- `RenderComboBox.dispose()` 会释放内部 popup。
- `RenderComboBox.detach()` 会关闭已打开的 popup。
- `options` 重新赋值会关闭已打开的 popup，但不会触发 `onChange`。
- `disabled` 或 `readonly` 变为 `true` 会关闭 popup 并从焦点管理中注销。
- `DropdownPopup.dispose()` 会结束搜索输入 session，避免隐藏 textarea 或计时器泄漏。

## 表单组合建议

ComboBox 使用共享的表单壳绘制输入框、清除按钮、前缀、后缀和 helper 文案，适合直接放入表单布局中。

```ts
const requiredStatusDropdown = new RenderComboBox({
  options: [
    { value: 'draft', label: '草稿' },
    { value: 'submitted', label: '已提交' },
  ],
  value: state.status,
  prefixText: '状态',
  clearable: true,
  status: state.status ? 'default' : 'error',
  helperText: state.status ? '' : '请选择状态',
  onChange: value => {
    state.status = value
  },
})
```

布局注意：

- 组件宽度由父布局约束决定；`performLayout` 在无限宽度下默认使用 200。
- `helperText` 会增加组件总高度，父容器要按实际高度布局。
- 触发字段里的选中长文本会被裁剪；如果裁剪，组件 tooltip 会显示完整选中项 `label`。
- popup 宽度可大于触发字段，长文本优先在 popup 中展示完整内容。

## 和 DataGrid 的关系

`DataGrid` 的 dropdown 单元格编辑器复用 `DropdownPopup`，因此候选过滤、键盘选择、长文本 tooltip、popup 宽度和滚轮行为与 `RenderComboBox` 的 popup 保持一致。表格列编辑器会自己管理 anchor、提交和关闭时机。

## 主题和视觉

ComboBox 的视觉来自主题派生 token：

- `deriveTextInputStyle()`：触发字段背景、边框、placeholder、helper、清除按钮。
- `deriveDropdownStyle()`：popup 行高、选项文本、hover/selected 背景、箭头和分割线。
- `derivePopupStyle()`：popup 外壳 padding、边框、阴影。
- `deriveScrollbarStyle()`：popup 内滚动条轨道和滑块。
- `deriveTreeStyle().panelBg`：popup 面板背景。

不要在业务组件里手绘另一套 hover、selected 或滚动条样式。需要全局调整时，应从主题 token 入手，保证 ComboBox、TreeView、DataGrid 的交互状态一致。

## 常见问题

### 为什么设置了 `value` 但显示 placeholder？

`value` 必须能在 `options` 中找到相同 `value` 的候选项。找不到时组件认为当前没有可显示的选中项，会显示 placeholder。

### 为什么重新设置 `options` 后 `value` 没有清空？

这是刻意行为。重新绑定候选项只关闭 popup，不替业务决定当前值是否仍然有效。需要清空时由业务显式设置：

```ts
const resetOptions: DropdownOption[] = [
  { value: 'surgery', label: '产品部' },
]
const resetDropdown = new RenderComboBox({
  options: [{ value: 'internal', label: '研发部' }],
  value: 'internal',
})

resetDropdown.options = resetOptions
if (!resetOptions.some(option => option.value === resetDropdown.value)) {
  resetDropdown.value = ''
}
```

### 为什么 popup 里的搜索文本不会作为值提交？

ComboBox 是枚举选择组件，不是输入组件。搜索文本只用于过滤候选项。需要“输入即值”的交互应使用 TextBox 或 LookupEdit。

### 为什么标准 `RenderComboBox` 不能配置 `maxPopupWidth`？

标准组件保持简单的表单字段 API，并使用默认 560 的 popup 最大宽度。需要针对文档数据元或表格编辑器控制 popup 宽度时，应使用 `DropdownPopup` 或封装业务组件。

## 相关组件

- [MultiSelectDropdown](./multi-select-dropdown.md)
- [LookupEdit](./lookup-edit.md)
- [DropTreeEdit](./drop-tree-edit.md)
- [DropTreeGridEdit](./drop-tree-grid-edit.md)
- [TextBox](../input/text-box.md)
- [DatePicker](../input/date-picker.md)
