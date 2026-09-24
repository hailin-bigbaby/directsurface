# TokenEdit 标签输入

> **通用布局能力**：`RenderTokenEditOptions` 继承 `RenderBoxOptions`，支持 `width`、`height`、min/max、`margin` 和槽位对齐，详见[组件通用布局属性](../common-layout-properties.md)。

`RenderTokenEdit` 是单行标签输入组件。已确认的值绘制为 chip，剩余区域继续使用原生输入法承载的文本输入；获得焦点后，组件使用共享 `DropdownPopup` 显示尚未选中的候选项。

它可以只接受预定义候选项，也可以允许操作员输入新的字符串 token。

## API 总览

主类和公开类型：

- `RenderTokenEdit`
- `RenderTokenEditOptions`
- `TokenEditOption`
- `TokenEditToken`

导入：

```ts
import {
  RenderTokenEdit,
  type RenderTokenEditOptions,
  type TokenEditOption,
  type TokenEditToken,
} from 'directsurface'
```

## 何时使用

- 一个字段需要录入多个短文本标签。
- 候选项可以搜索选择，同时允许输入业务尚未收录的新值。
- 需要用 Enter、逗号或分号快速连续录入。
- 已选 token 需要按录入顺序保留，并允许逐个删除。

不适合：

- 只能从固定字典中勾选，且不允许创建新值，优先使用 [MultiSelectDropdown](./multi-select-dropdown.md) 或 [CheckedComboBox](./checked-combo-box.md)。
- 候选项是树或多列表格，使用 DropTree、LookupEdit 等结构化选择器。
- 输入内容是长文本或多行内容，使用 TextArea 或文档编辑器。

## 最小示例

```ts
import {
  RenderTokenEdit,
  type TokenEditOption,
} from 'directsurface'

const allergyOptions: TokenEditOption[] = [
  { value: 'penicillin', label: '青霉素' },
  { value: 'cephalosporin', label: '头孢菌素' },
  { value: 'sulfonamide', label: '磺胺类' },
]

const allergyEdit = new RenderTokenEdit({
  options: allergyOptions,
  values: ['penicillin'],
  allowCustomTokens: true,
  placeholder: '输入或选择过敏原',
  onChange: (values, tokens) => {
    state.allergyValues = values
    state.allergyLabels = tokens.map(token => token.label)
  },
})
```

## 值模型

### TokenEditOption

`TokenEditOption` 继承 `DropdownOption`：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `value` | `string` | 是 | 稳定且唯一的 token 值。 |
| `label` | `string` | 是 | 候选 popup 和 chip 中的显示文本。 |
| `group` | `string` | 否 | popup 分组名称。 |
| `disabled` | `boolean` | 否 | 禁用候选项。TokenEdit 会直接从建议结果中排除禁用项。 |

### TokenEditToken

```ts
interface TokenEditToken {
  value: string
  label: string
}
```

- 预定义 token 的 `label` 来自对应 `TokenEditOption`。
- 自定义 token 的 `value` 和 `label` 相同。
- `values` 是提交用的字符串数组；`tokens` 是用于显示或业务映射的只读派生结果。

### 归一化规则

组件按传入顺序处理 `values`：

1. 每个值会转换为字符串并执行 `trim()`。
2. 空字符串会被丢弃。
3. 相同 `value` 只保留第一次出现的位置。
4. `allowCustomTokens: false` 时，不存在于 `options` 的值会被丢弃。
5. `allowCustomTokens: true` 时，未知值会作为自定义 token 保留。

去重依据是 `value`，不是 `label`。

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `options` | `TokenEditOption[]` | `[]` | 预定义候选项。 |
| `values` | `string[]` | `[]` | 初始 token 值。 |
| `placeholder` | `string` | `'请输入或选择'` | 没有 token 且查询为空时显示。 |
| `allowCustomTokens` | `boolean` | `false` | 是否允许把未匹配候选项的文本创建为 token。 |
| `tokenSeparators` | `readonly string[]` | `[',', ';', '，', '；']` | 按下其中任意键时提交当前查询文本。传入空数组会使用默认值。 |
| `onChange` | `(values: string[], tokens: TokenEditToken[]) => void` | `undefined` | token 集合变化回调。 |
| `disabled` | `boolean` | `false` | 禁用输入、删除和候选 popup。 |
| `readonly` | `boolean` | `false` | 允许只读查看，不允许新增或删除。 |
| `status` | `FormFieldStatus` | `'default'` | `'default'`、`'success'`、`'warning'` 或 `'error'`。 |
| `helperText` | `string` | `''` | 字段下方帮助或错误文案。 |
| `maxVisibleItems` | `number` | `8` | 建议 popup 最大可见项数；构造时向下取整且最小为 1。 |
| `width`、`height` 等 | `RenderBoxOptions` | 继承默认值 | 通用布局属性。 |

```ts
const categoryTagOptions: RenderTokenEditOptions = {
  options: [
    { value: 'priority-high', label: '高优先级' },
    { value: 'priority-medium', label: '中优先级' },
    { value: 'priority-low', label: '低优先级' },
  ],
  values: [],
  allowCustomTokens: true,
  tokenSeparators: [',', '，', ';', '；'],
  placeholder: '输入业务标签',
  maxVisibleItems: 6,
  status: 'default',
  helperText: '',
  onChange: (values, tokens) => {
    state.tagValues = values
    state.tagText = tokens.map(token => token.label).join('、')
  },
}

const categoryTagEdit = new RenderTokenEdit(categoryTagOptions)
```

## 属性

| 属性 | 类型 | 可写 | 说明 |
| --- | --- | --- | --- |
| `options` | `TokenEditOption[]` | 是 | 当前预定义候选项。读取返回副本。 |
| `values` | `string[]` | 是 | 当前 token 值。读取返回副本；赋值会归一化，但不触发 `onChange`。 |
| `tokens` | `TokenEditToken[]` | 否 | 按当前 `values` 解析出的 token 副本。 |
| `query` | `string` | 是 | 当前尚未提交的输入文本。 |
| `allowCustomTokens` | `boolean` | 是 | 是否保留和创建自定义 token。 |
| `disabled` | `boolean` | 是 | 设为 `true` 会关闭 popup、清理 chip 指针状态，并由内部 TextBox 退出焦点。 |
| `readonly` | `boolean` | 是 | 设为 `true` 会关闭 popup并禁止修改。 |
| `status` | `FormFieldStatus` | 是 | 当前表单状态。 |
| `helperText` | `string` | 是 | 帮助或错误文案。修改后重新布局。 |
| `placeholder` | `string` | 是 | 空值提示。已有 token 时不显示。 |
| `onChange` | `(values, tokens) => void \| undefined` | 是 | token 集合变化回调。 |
| `isFocused` | `boolean` | 否 | 内部文本输入当前是否拥有焦点。 |

`tokenSeparators` 和 `maxVisibleItems` 当前只在构造时配置，没有运行时 setter。

`allowCustomTokens` 从 `true` 改为 `false` 时会重新归一化 `values`，因此未知值会被删除；这个属性赋值过程不会触发 `onChange`，业务如需同步外部状态，应在修改后读取 `values`。

### 重新绑定 options

给 `options` 重新赋值时，组件会：

1. 保存候选项副本。
2. 按当前 `allowCustomTokens` 重新归一化已有 `values`。
3. 刷新 chip 和已打开的建议 popup。
4. 不触发 `onChange`；如果归一化删除了已有值，业务可以在赋值后读取一次 `values`。

```text
tagEdit.options = nextOptions
```

当 `allowCustomTokens: true` 时，候选项被移除不会删除同值 token，只会使它的显示文本退回为 value。

## 查询和建议

字段获得焦点后，只要存在可用建议项，popup 就会打开：

- 已选值不会再次出现在建议列表中。
- `disabled` 候选项不会出现在建议列表中。
- 查询为空时显示全部尚未选择的可用项。
- 查询不为空时，对 `label` 和 `value` 分别执行不区分大小写的 `includes` 匹配。
- `group` 会继续在共享 DropdownPopup 中显示分组头。
- 查询变化时会原位更新 popup 数据，不会反复销毁输入 session。

TokenEdit 的查询文本直接输入在主字段中，popup 不会再创建第二个搜索框。主字段复用 `RenderTextBox` 及其内部输入和编辑会话，支持中文 IME、选择、粘贴和光标定位。组字期间的 Enter 只确认输入法候选，不会提前创建 token、选择建议或触发字段提交。

```text
tagEdit.query = '高'
tagEdit.focus()
```

程序设置 `query` 只更新查询和建议，不会自动创建 token。

## 提交规则

`commitQuery(query)` 会先执行 `trim()`：

- 文本精确等于某个非禁用 option 的 `value` 或 `label` 时，添加该 option 的 `value`。
- 没有精确匹配且 `allowCustomTokens: true` 时，添加修剪后的文本作为自定义 token。
- 没有精确匹配且 `allowCustomTokens: false` 时，不改变 token 集合，查询文本也会保留。
- value 已存在时不会重复添加；当前查询会被清空，但不触发 `onChange`。

popup 打开且存在过滤结果时，Enter 优先选择当前高亮建议。popup 没有可选建议时，Enter 才按上述规则提交当前文本。

## 方法

面向业务的公开方法：

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `focus()` | `void` | 让内部文本输入获得焦点，并在有建议时打开 popup。 |
| `commitQuery(query)` | `void` | 按提交规则把文本转换为预定义或自定义 token。 |
| `removeToken(value)` | `void` | 按 value 删除一个 token；成功删除时触发 `onChange`。 |
| `debugState()` | 调试对象 | 返回 query、values、tokens、可见 chip、popup 状态和当前建议，用于测试和诊断。 |
| `dispose()` | `void` | 释放建议 popup 和内部文本输入。 |

`handleQueryChange()`、`handleInputFocus()`、`handleInputBlur()`、`handleInputKeyDown()`、`resolveChipLayout()`、`locateChip()` 和 `fieldVerticalPadding()` 是内部输入与绘制适配使用的方法。虽然当前类声明可见，但业务不应直接依赖这些实现细节。

## onChange 触发时机

会触发：

- 从建议 popup 选择一个新值。
- 通过 Enter 或分隔符创建一个新 token。
- 点击 chip 删除按钮。
- 查询为空时按 Backspace 或 Delete 删除最后一个 token。
- 调用 `removeToken(value)` 并且该值确实存在。

不会触发：

- 直接给 `values` 赋值。
- 重新赋值 `options`，即使该操作导致已有 token 被归一化删除。
- 修改 `allowCustomTokens` 导致未知值被归一化删除。
- 只修改 `query`。
- 提交重复 value。
- `allowCustomTokens: false` 时提交无法匹配的文本。
- 只修改 `placeholder`、`status` 或 `helperText`。

回调收到的两个数组都是当前状态的副本，可以安全保存：

```ts
const tagEdit = new RenderTokenEdit()

tagEdit.onChange = (values, tokens) => {
  state.values = values
  state.labels = tokens.map(token => token.label)
}
```

## 鼠标行为

| 操作 | 行为 |
| --- | --- |
| 点击输入区域 | 聚焦文本输入，并在有建议时打开 popup。 |
| 点击 chip 删除区域并在同一区域抬起 | 删除该 token。按下后移出删除区域不会误删。 |
| 点击普通 chip 区域 | 不删除 token，事件继续交给文本输入处理。 |
| 点击 `+N` 溢出 chip | 不删除 token，字段保持可输入。 |
| 点击建议项 | 添加该 option，清空 query，关闭 popup。 |
| 点击字段内部且 popup 已打开 | 不会被 popup 当作外部点击消费，仍可调整文本输入。 |
| 点击字段和 popup 之外 | 关闭 popup。 |

## 键盘行为

### 文本输入

| 按键 | 行为 |
| --- | --- |
| 普通字符 | 写入 `query` 并实时过滤建议。 |
| Enter | 有建议时选择高亮建议；没有建议时调用 `commitQuery(query)`。提交后不退出字段。 |
| `tokenSeparators` 中的键 | 调用 `commitQuery(query)`，分隔符本身不会写入 query。 |
| Backspace / Delete | query 为空时删除最后一个 token；query 非空时执行普通文本删除。 |
| Escape | popup 打开时先关闭 popup；再次按下按 TextBox 默认行为退出焦点。 |
| Tab / Shift+Tab | popup 先关闭，然后继续焦点导航。 |

### 建议 popup

| 按键 | 行为 |
| --- | --- |
| ArrowDown / ArrowUp | 在建议项之间循环移动。 |
| Home / End | 跳到第一项或最后一项。 |
| Enter / Space | 选择当前建议并关闭 popup。 |
| Escape | 关闭 popup。 |

popup 打开时默认高亮第一条建议。

## Chip 和单行溢出

TokenEdit 始终保留至少约 48px 的查询输入空间。其余宽度用于绘制 token chip：

- 空间足够时按 `values` 顺序显示 chip。
- 空间不足时保留前面的 chip，并用一个 `+N` chip 表示其余值。
- 如果继续缩窄，组件会减少普通 chip 数量，优先保留 `+N`。
- `+N` 只表示视觉溢出，所有值仍保存在 `values` 中。
- chip 不换行，组件保持单行输入高度。

正常状态下普通 chip 显示删除按钮；`readonly` 和 `disabled` 状态下不显示可删除行为。

## 只读和禁用

| 状态 | 文本输入 | 建议 popup | chip 删除 | 程序赋值 |
| --- | --- | --- | --- | --- |
| 正常 | 可输入 | 可打开 | 可删除 | 可用 |
| `readonly` | 不可修改 | 不打开 | 不可删除 | 可用 |
| `disabled` | 不可聚焦或输入 | 不打开 | 不可删除 | 可用 |

只读模式仍沿用 TextBox 的只读文本选择能力，但不会创建或删除 token。

## 生命周期

- 构造时会创建一个内部 `TokenTextBox` 和一个共享 `DropdownPopup` 实例。
- 内部输入属于 TokenEdit 的 render subtree，会随父组件 attach、detach 和 dispose。
- 首次聚焦时 popup 的焦点作用域会暂时切换；组件会恢复主输入焦点，避免打断 `InputComposer`。
- query 更新时使用 `DropdownPopup.updateOptions()` 原位更新建议，避免每次输入都关闭重开 popup。
- 失焦后的 popup 关闭使用微任务确认；如果焦点只是因 popup 作用域切换后立即恢复，不会误关。
- `disabled = true` 会关闭 popup并清理输入、chip 指针状态。
- `readonly = true` 会关闭 popup并禁止创建和删除。
- `dispose()` 会先释放 popup，再由 render tree 释放内部 TextBox、输入 session 和焦点注册。
- 从 render tree 移除且不再复用的实例，应正常调用 `dispose()`。

## 边界

- 当前建议源是同步的 `options` 数组，不内置远程检索、分页或异步取消。业务取得结果后可以重新赋值 `options`。
- 自定义 token 只是本地字符串，不会自动调用后端创建字典项。
- 不支持 token 拖动排序；顺序由 `values` 决定。
- 不支持多行 chip 或自动换行。
- 不提供 `maxTokens`、单项只读或每个 token 独立样式。
- 复制粘贴的文本不会按多个分隔符自动拆成多个 token；粘贴内容先进入 query，再由 Enter 或分隔键提交。
- 候选项只提供 `value`、`label`、`group` 和 `disabled`。需要多列信息或复杂检索时，应使用 LookupEdit 或 DropTreeGridEdit。
- 组件负责输入交互和显示，不负责业务校验、持久化或服务端冲突处理。

## 受控更新示例

```ts
const initialOptions: TokenEditOption[] = [
  { value: 'priority-high', label: '高优先级' },
]
const nextOptions: TokenEditOption[] = [
  ...initialOptions,
  { value: 'priority-medium', label: '中优先级' },
]

const edit = new RenderTokenEdit({
  options: initialOptions,
  values: state.values,
  allowCustomTokens: true,
  onChange: values => {
    state.values = values
  },
})

// 外部状态恢复：不会触发 onChange
edit.values = state.values

// 业务检索完成后更新同步候选集合
edit.options = nextOptions

// 程序清空：不会触发 onChange
edit.values = []
edit.query = ''
```

## 相关组件

- [MultiSelectDropdown](./multi-select-dropdown.md)
- [CheckedComboBox](./checked-combo-box.md)
- [ComboBox](./combo-box.md)
- [Chip](../basic/badge-chip-divider.md)
- [TextBox](../input/text-box.md)
