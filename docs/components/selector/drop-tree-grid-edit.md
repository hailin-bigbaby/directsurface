# DropTreeGridEdit 树表下拉

> **通用布局能力**：`RenderDropTreeGridEdit` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；下拉树表的 popup 尺寸使用选择器浮层配置。详见[组件通用布局属性](../common-layout-properties.md)。


DirectSurface UI 的树表单选下拉公共类名是 `RenderDropTreeGridEdit`。它用于从树形数据中选择一个节点，同时在 popup 中用多列表格展示节点的编码、分类、规格、拼音码等字段。

`DropTreeGridEdit` 适合“有层级，又需要多列信息”的目录选择。触发字段负责表单布局、已选 label、meta 文本、焦点、只读禁用和清除；popup 内部组合 `RenderTreeGrid`，负责树表列、展开折叠、键盘导航、滚动、查询和右下角拖拽调整尺寸。

## API 总览

主类：

- `RenderDropTreeGridEdit`

相关 public API：

- `TreeGridNode`
- `GridColumnDef`
- `defaultDropTreeGridEditQueryProcessor`
- `DropTreeGridEditQueryContext`
- `DropTreeGridEditQueryProcessor`
- `DropTreeGridEditQueryTextBuilder`
- `DropTreeGridEditExpandedKeysResolver`
- `DropTreeGridEditExpandOnOpenContext`
- `DropTreeGridEditDebugState`
- `FormFieldStatus`

导入：

```ts
import {
  RenderDropTreeGridEdit,
  defaultDropTreeGridEditQueryProcessor,
  type DropTreeGridEditDebugState,
  type DropTreeGridEditExpandOnOpenContext,
  type DropTreeGridEditExpandedKeysResolver,
  type DropTreeGridEditQueryContext,
  type DropTreeGridEditQueryProcessor,
  type DropTreeGridEditQueryTextBuilder,
  type FormFieldStatus,
  type GridColumnDef,
  type TreeGridNode,
} from 'directsurface'
```

`RenderDropTreeGridEdit` 的构造参数是公开 options 对象，但当前没有单独导出的 DropTreeGridEdit options 类型。业务代码直接按本文参数表传入对象。

## 何时使用

- 候选项是树形目录，并且节点需要多列字段。
- 只能选择一个节点。
- 需要同时查看名称、编码、分类、负责部门、规格等字段。
- 需要输入关键字过滤树表。
- 需要 popup 初始展开到当前选中路径，或按业务指定展开节点。

不适合：

- 只有树形 label，不需要多列，使用 [DropTreeEdit](./drop-tree-edit.md)。
- 树形多选，使用 [DropCheckTreeEdit](./drop-check-tree-edit.md)。
- 扁平多列候选，使用 [LookupEdit](./lookup-edit.md)。
- 扁平单列枚举，使用 [ComboBox](./combo-box.md)。

## 最小示例

```ts
import { RenderDropTreeGridEdit, type GridColumnDef, type TreeGridNode } from 'directsurface'

interface ExamDirectoryRow {
  name: string
  code: string
  category: string
  py?: string
}

const examColumns: GridColumnDef<ExamDirectoryRow>[] = [
  { type: 'text', key: 'name', title: '项目名称', width: 220, fixed: true },
  { type: 'text', key: 'code', title: '项目编码', width: 96 },
  { type: 'text', key: 'category', title: '目录分类', width: 96 },
]

const examRoots: TreeGridNode<ExamDirectoryRow>[] = [
  {
    key: 'exam-root',
    row: { name: '服务目录', code: 'EX', category: '目录', py: 'jcml' },
    selectable: false,
    children: [
      { key: 'exam-ct', row: { name: '头颅 CT', code: 'IMG301', category: '影像', py: 'tlct' } },
    ],
  },
]

const examTreeGridState = {
  examCode: '',
  examName: '',
}

const examTreeGrid = new RenderDropTreeGridEdit<ExamDirectoryRow>({
  columns: examColumns,
  roots: examRoots,
  treeColumnKey: 'name',
  labelKey: 'name',
  metaKey: 'code',
  searchable: true,
  clearable: true,
  queryTextBuilder: node => [node.key, node.row.name, node.row.code, node.row.py ?? ''],
  onChange: (value, node) => {
    examTreeGridState.examCode = value
    examTreeGridState.examName = node?.row.name ?? ''
  },
})
```

## 组件关系

| 组件 / 类型 | 用途 | 说明 |
| --- | --- | --- |
| `RenderDropTreeGridEdit<T>` | 标准树表单选下拉字段。 | 参与布局、焦点、hover、只读禁用、清除和表单状态。 |
| `TreeGridNode<T>` | 树表节点数据。 | 来自 [TreeGrid](../data/tree-grid.md)，节点包含 `key`、`row`、`children`、`selectable`。 |
| `GridColumnDef<T>` | 树表列定义。 | 来自 [DataGrid](../data/data-grid.md)，描述 popup 表格列。 |
| `DropTreeGridEditQueryProcessor<T>` | 自定义搜索过滤函数。 | 接收 query、roots、columns、treeColumnKey、labelKey、selectedValue。 |
| `DropTreeGridEditQueryTextBuilder<T>` | 搜索文本构造函数。 | 决定默认查询时每个节点参与匹配的字符串。 |
| `DropTreeGridEditExpandedKeysResolver<T>` | 打开时展开 keys 解析函数。 | 根据 roots 和 selectedValue 动态决定初始展开节点。 |
| `defaultDropTreeGridEditQueryProcessor()` | 默认搜索过滤器。 | 按节点 key、labelKey 和列字段做包含匹配。 |

内部 popup 类不作为正式 public API 使用。业务代码应优先使用 `RenderDropTreeGridEdit` 和导出的查询/展开类型。

## TreeGridNode 和列定义

`TreeGridNode<T>` 的 `row` 承载业务字段：

```ts
interface CategoryDirectoryRow {
  name: string
  code: string
  category: string
  py?: string
}

const categoryRoots: TreeGridNode<CategoryDirectoryRow>[] = [
  {
    key: 'diag-root',
    row: { name: '项目目录', code: 'ITEM', category: '目录', py: 'xmml' },
    selectable: false,
    children: [
      { key: 'item-office', row: { name: '办公用品', code: 'ITEM-01', category: '项目', py: 'bgyp' } },
    ],
  },
]
```

常用字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `key` | `string` | 节点唯一 key，也是提交值。必须稳定。 |
| `row` | `T` | 行数据对象。`labelKey`、`metaKey`、列字段都从这里读取。 |
| `children` | `TreeGridNode<T>[]` | 子节点。 |
| `selectable` | `boolean` | 设为 `false` 时该节点不能被提交。常用于分类父节点。 |

列定义使用 `GridColumnDef<T>`，`treeColumnKey` 必须指向其中一列：

```ts
interface CategoryColumnRow {
  name: string
  code: string
  category: string
}

const categoryColumns: GridColumnDef<CategoryColumnRow>[] = [
  { type: 'text', key: 'name', title: '分类名称', width: 220, fixed: true },
  { type: 'text', key: 'code', title: '编码', width: 96 },
  { type: 'text', key: 'category', title: '分类', width: 96 },
]
```

如果运行时设置的 `treeColumnKey` 不存在于 `columns`，组件会回退到第一列 key。

## 表单绑定

`RenderDropTreeGridEdit<T>` 实现 `ValueEditor<string, ..., TreeGridNode<T> | null>`，可以直接绑定字符串字段。选择事件的 `detail` 是包含 `key` 和 `row` 的树表节点，清除时为 `null`；`setValue()` 保持静默。

触发框、popup 搜索框和树表共同组成一次逻辑焦点会话。焦点进入 popup 不会触发 blur 校验；只有离开整个字段、显式调用 `blur()`，或切换为 disabled/readonly 时才发布一次 blur。

## RenderDropTreeGridEdit 构造参数

`new RenderDropTreeGridEdit<T>(options)` 的 `options`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `columns` | `GridColumnDef<T>[]` | 必填 | popup 树表列定义。 |
| `roots` | `TreeGridNode<T>[]` | 必填 | 根节点数组。 |
| `treeColumnKey` | `keyof T & string` | 必填 | 树缩进、展开图标所在列。必须能匹配 `columns`。 |
| `labelKey` | `keyof T & string` | 必填 | 触发字段主显示文本字段。 |
| `value` | `string` | `''` | 当前选中节点 key。 |
| `metaKey` | `keyof T & string` | `undefined` | 已选节点附加显示字段，例如编码、规格。 |
| `metaFormatter` | `(node: TreeGridNode<T>) => string` | `undefined` | 自定义附加显示文本。优先级高于 `metaKey`。 |
| `placeholder` | `string` | `'请选择...'` | 未选中时显示的提示文本。 |
| `onChange` | `(value: string, node: TreeGridNode<T> \| null) => void` | `undefined` | 选中或清除时触发。清除时 `node` 为 `null`。 |
| `searchable` | `boolean` | `true` | 是否允许输入关键字查询，并在 popup 顶部显示搜索框。 |
| `maxVisibleItems` | `number` | `8` | popup 树表最多按多少个可见节点计算自然高度。 |
| `readonly` | `boolean` | `false` | 只读。不可聚焦、不可打开、不可清除，显示锁图标。 |
| `disabled` | `boolean` | `false` | 禁用。不可聚焦、不可打开、不可清除。 |
| `status` | `FormFieldStatus` | `'default'` | 表单状态。可选 `'default'`、`'success'`、`'warning'`、`'error'`。 |
| `helperText` | `string` | `''` | 字段下方帮助或错误文案。会增加组件高度。 |
| `prefixText` | `string` | `''` | 输入区域左侧固定文本。 |
| `suffixText` | `string` | `''` | 输入区域右侧固定文本。 |
| `clearable` | `boolean` | `false` | 有值、非禁用、非只读时显示清除按钮，并允许 Backspace/Delete 清除。 |
| `expandAllOnOpen` | `boolean` | `false` | 打开 popup 时是否展开所有可展开节点。 |
| `expandedKeysOnOpen` | `readonly string[] \| DropTreeGridEditExpandedKeysResolver<T>` | `undefined` | 打开 popup 时默认展开的节点 key。会自动合并当前选中节点的祖先 key。 |
| `queryTextBuilder` | `DropTreeGridEditQueryTextBuilder<T>` | 自动构造 | 默认查询时每个节点参与匹配的文本。 |
| `queryProcessor` | `DropTreeGridEditQueryProcessor<T>` | `defaultDropTreeGridEditQueryProcessor(queryTextBuilder)` | 自定义查询函数。 |

```ts
interface CategoryTreeGridRow {
  name: string
  code: string
  category: string
}
const categoryTreeGridColumns: GridColumnDef<CategoryTreeGridRow>[] = [
  { type: 'text', key: 'name', title: '分类名称', width: 220 },
  { type: 'text', key: 'code', title: '编码', width: 96 },
]
const categoryTreeGridRoots: TreeGridNode<CategoryTreeGridRow>[] = [
  {
    key: 'diag-root',
    row: { name: '项目目录', code: 'ITEM', category: '目录' },
    children: [{ key: 'item-office', row: { name: '办公用品', code: 'ITEM-01', category: '项目' } }],
  },
]
const categoryTreeGrid = new RenderDropTreeGridEdit<CategoryTreeGridRow>({
  columns: categoryTreeGridColumns,
  roots: categoryTreeGridRoots,
  treeColumnKey: 'name',
  labelKey: 'name',
  metaKey: 'code',
  placeholder: '检索分类目录',
  searchable: true,
  maxVisibleItems: 8,
  clearable: true,
  expandedKeysOnOpen: ['diag-root'],
  onChange: (value, node) => {
    state.categoryKey = value
    state.categoryName = node?.row.name ?? ''
  },
})
```

## RenderDropTreeGridEdit 属性

| 属性 | 类型 | 可写 | 说明 |
| --- | --- | --- | --- |
| `columns` | `GridColumnDef<T>[]` | 是 | 当前列。popup 打开时重新赋值会同步列；如果当前 treeColumnKey 不存在，会回退到第一列。 |
| `roots` | `TreeGridNode<T>[]` | 是 | 当前根节点。popup 打开时重新赋值会刷新 popup 树表。 |
| `treeColumnKey` | `keyof T & string` | 是 | 树列 key。赋值时会校验是否在 columns 中。 |
| `labelKey` | `keyof T & string` | 是 | 触发字段主显示字段。公开字段。 |
| `value` | `string` | 是 | 当前选中节点 key。赋值会转成字符串并重绘；popup 打开时会同步 selectedKey。 |
| `placeholder` | `string` | 是 | 提示文本。公开字段。 |
| `onChange` | `(value: string, node: TreeGridNode<T> \| null) => void \| undefined` | 是 | 值变化回调。 |
| `searchable` | `boolean` | 是 | 是否允许搜索。公开字段；修改后下一次打开 popup 生效。 |
| `maxVisibleItems` | `number` | 是 | popup 最大可见节点数。公开字段；修改后下一次打开 popup 生效。 |
| `readonly` | `boolean` | 是 | 只读状态。设为 `true` 会关闭 popup、清理 query、失焦并注销焦点。 |
| `disabled` | `boolean` | 是 | 禁用状态。设为 `true` 会关闭 popup、清理 query、失焦并注销焦点。 |
| `status` | `FormFieldStatus` | 是 | 状态色。赋值会重绘。 |
| `helperText` | `string` | 是 | 帮助文案。赋值会重新 layout。 |
| `prefixText` | `string` | 是 | 前缀文本。赋值会重绘。 |
| `suffixText` | `string` | 是 | 后缀文本。赋值会重绘。 |
| `clearable` | `boolean` | 是 | 是否显示清除按钮。赋值会重绘。 |
| `metaKey` | `keyof T & string \| undefined` | 是 | 附加显示字段。公开字段。 |
| `metaFormatter` | `(node: TreeGridNode<T>) => string \| undefined` | 是 | 自定义附加显示文本。公开字段。 |
| `expandAllOnOpen` | `boolean` | 是 | 打开时是否展开所有可展开节点。公开字段。 |
| `expandedKeysOnOpen` | `readonly string[] \| DropTreeGridEditExpandedKeysResolver<T> \| undefined` | 是 | 打开时展开 key。公开字段。 |
| `queryTextBuilder` | `DropTreeGridEditQueryTextBuilder<T> \| undefined` | 是 | 默认查询文本构造器。公开字段。 |
| `queryProcessor` | `DropTreeGridEditQueryProcessor<T> \| undefined` | 是 | 自定义查询函数。公开字段。 |
| `isFocused` | `boolean` | 否 | 触发器或自有树表 popup 处于编辑焦点时为 `true`。 |

公开字段不是 setter 时，运行时修改后如果影响当前画面，应由业务触发重绘或在下一次打开 popup 前修改。

## RenderDropTreeGridEdit 方法

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `focusIn()` | `void` | 进入焦点。通常由 `FocusManager` 调用。 |
| `focusOut()` | `void` | 退出焦点。通常由 `FocusManager` 调用。 |
| `requestFocus()` / `blur()` | `void` | 进入或离开整个逻辑编辑焦点；`blur()` 同时关闭自有 popup。 |
| `getValue()` / `setValue(value)` | `string` / `void` | 读取或静默写入正式值。 |
| `debugState()` | `DropTreeGridEditDebugState` | 返回当前 popup、query、显示文本、选中 label、过滤节点数和展开 keys。 |
| `dispose()` | `void` | 关闭并释放 popup、注销焦点、清理 query 和 hover。 |

`RenderDropTreeGridEdit` 没有公开 `open()` 方法。打开行为由点击、Enter、Space、ArrowDown 或可搜索状态下的字符输入触发。

## DropTreeGridEditDebugState

`debugState()` 返回：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `popupVisible` | `boolean` | popup 是否打开。 |
| `queryText` | `string` | 当前查询文本。 |
| `showQueryInField` | `boolean` | 触发字段当前是否显示 query，而不是已选 label。 |
| `displayText` | `string` | 当前触发字段主文本。 |
| `focused` | `boolean` | 是否聚焦。 |
| `disabled` | `boolean` | 是否禁用。 |
| `readonly` | `boolean` | 是否只读。 |
| `value` | `string` | 当前选中 key。 |
| `selectedLabel` | `string` | 当前 value 对应节点的 label。 |
| `filteredCount` | `number` | popup 打开时为过滤树表节点总数；关闭时为全部节点总数。 |
| `expandedKeys` | `string[]` | popup 当前展开 keys。 |

```ts
interface DebugTreeGridRow {
  name: string
  code: string
}
const debugTreeGrid = new RenderDropTreeGridEdit<DebugTreeGridRow>({
  columns: [
    { type: 'text', key: 'name', title: '名称' },
    { type: 'text', key: 'code', title: '编码', width: 96 },
  ],
  roots: [
    { key: 'item-office', row: { name: '办公用品', code: 'ITEM-01' } },
  ],
  treeColumnKey: 'name',
  labelKey: 'name',
})
const snapshot = debugTreeGrid.debugState()
if (snapshot.popupVisible) {
  notificationManager.show(`过滤节点数: ${snapshot.filteredCount}`)
}
```

## 查询行为

### 默认查询

默认查询由 `defaultDropTreeGridEditQueryProcessor(queryTextBuilder)` 创建：

- query 会 trim 后转小写。
- query 为空时返回原始 roots 的浅拷贝。
- 如果未传 `queryTextBuilder`，默认文本包含节点 key、`labelKey` 对应字段、所有列字段文本。
- 任一文本包含 query 即认为该节点匹配。
- 子节点匹配时，会保留祖先节点，并只保留匹配路径下的 children。
- 查询状态下 popup 会展开所有可展开节点，方便看到匹配结果。

```ts
interface DefaultQueryTreeGridRow {
  name: string
  code: string
}
const defaultQueryColumns: GridColumnDef<DefaultQueryTreeGridRow>[] = [
  { type: 'text', key: 'name', title: '名称' },
  { type: 'text', key: 'code', title: '编码', width: 96 },
]
const defaultQueryRoots: TreeGridNode<DefaultQueryTreeGridRow>[] = [
  { key: 'item-office', row: { name: '办公用品', code: 'ITEM-01' } },
]
const defaultTreeGridProcessor = defaultDropTreeGridEditQueryProcessor<DefaultQueryTreeGridRow>()
const filteredTreeGridRoots = defaultTreeGridProcessor({
  query: 'J06',
  roots: defaultQueryRoots,
  columns: defaultQueryColumns,
  treeColumnKey: 'name',
  labelKey: 'name',
  selectedValue: '',
})

state.filteredCategoryCount = filteredTreeGridRoots.length
```

### 自定义查询

`queryProcessor` 接收 `DropTreeGridEditQueryContext<T>`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `query` | `string` | 当前查询文本。 |
| `roots` | `readonly TreeGridNode<T>[]` | 原始根节点。 |
| `columns` | `readonly GridColumnDef<T>[]` | 当前列。 |
| `treeColumnKey` | `keyof T & string` | 树列 key。 |
| `labelKey` | `keyof T & string` | 触发字段 label key。 |
| `selectedValue` | `string` | 当前已选 key。 |

返回 `TreeGridNode<T>[]`，即过滤后的根节点。

```ts
interface CustomCategoryTreeGridRow {
  name: string
  code: string
  py?: string
}
const customCategoryColumns: GridColumnDef<CustomCategoryTreeGridRow>[] = [
  { type: 'text', key: 'name', title: '分类名称' },
  { type: 'text', key: 'code', title: '编码', width: 96 },
]
const customCategoryRoots: TreeGridNode<CustomCategoryTreeGridRow>[] = [
  {
    key: 'diag-root',
    row: { name: '项目目录', code: 'ITEM' },
    children: [{ key: 'item-office', row: { name: '办公用品', code: 'ITEM-01', py: 'bgyp' } }],
  },
]
const customCategoryTree = new RenderDropTreeGridEdit<CustomCategoryTreeGridRow>({
  columns: customCategoryColumns,
  roots: customCategoryRoots,
  treeColumnKey: 'name',
  labelKey: 'name',
  queryProcessor: context => {
    const query = context.query.trim().toLowerCase()
    if (!query) return [...context.roots]
    return context.roots
      .map(root => ({
        ...root,
        children: root.children?.filter(child =>
          child.row.name.includes(context.query) ||
          child.row.code.toLowerCase().includes(query) ||
          (child.row.py ?? '').includes(query),
        ),
      }))
      .filter(root => root.row.name.includes(context.query) || (root.children?.length ?? 0) > 0)
  },
})
```

`queryProcessor` 是同步函数。远程树表查询应由业务层异步更新 `roots`：输入时先返回当前缓存结果，请求完成后给 `field.roots` 重新赋值；popup 打开时会刷新树表。

## 展开策略

打开 popup 时的展开 keys 按下面顺序处理：

1. 如果 `expandAllOnOpen === true`，展开所有有 children 的节点。
2. 否则如果 `expandedKeysOnOpen` 是函数，调用它取得展开 keys。
3. 否则如果 `expandedKeysOnOpen` 是数组，使用该数组。
4. 最后都会合并当前选中节点的祖先 keys，保证当前选中值可见。

```ts
interface ResolverTreeGridRow {
  name: string
  code: string
}
const resolverTreeGrid = new RenderDropTreeGridEdit<ResolverTreeGridRow>({
  columns: [
    { type: 'text', key: 'name', title: '名称' },
    { type: 'text', key: 'code', title: '编码', width: 96 },
  ],
  roots: [
    {
      key: 'diag-root',
      row: { name: '项目目录', code: 'ITEM' },
      children: [{ key: 'item-office', row: { name: '办公用品', code: 'ITEM-01' } }],
    },
  ],
  treeColumnKey: 'name',
  labelKey: 'name',
  value: 'item-office',
  expandedKeysOnOpen: context => {
    return context.selectedValue ? ['diag-root'] : []
  },
})
```

用户在非搜索状态下展开/折叠树表，popup 关闭时会记录展开 keys；下次正常打开会恢复。搜索状态下为了展示匹配路径会自动展开，不会把搜索时的展开状态写回正常展开状态。

## 鼠标行为

| 操作 | 行为 |
| --- | --- |
| 点击字段主体 | 获得焦点并打开 popup；popup 已打开时关闭并恢复已选 label。 |
| 点击清除按钮 | 清空 `value`，触发 `onChange('', null)`，字段保持焦点。 |
| 点击可选树表行 | 提交该节点，触发 `onChange(node.key, node)` 并关闭 popup。 |
| 点击 `selectable: false` 节点 | 不提交，popup 保持当前状态。 |
| 点击展开图标 | 展开或折叠该节点。 |
| 点击 popup 搜索框 | 聚焦搜索输入，并清理树表 hover 状态。 |
| 在 popup 树表区域滚轮 | 滚动树表。 |
| 拖动右下角 resize grip | 调整 popup 面板宽度和高度。 |

## 键盘行为

### 字段获得焦点时

| 按键 | 行为 |
| --- | --- |
| Enter | 打开 popup。 |
| Space | 打开 popup。 |
| ArrowDown | 打开 popup。 |
| Escape | 如果 popup 已打开则关闭并恢复已选 label。 |
| Tab | 如果 popup 已打开则关闭，然后让焦点继续移动。 |
| Backspace / Delete | 当 `clearable` 且有值时清空。 |
| 可导出字符 | 当 `searchable` 为 `true` 且 popup 未打开时，使用该字符作为首个 query 打开 popup。 |

### Popup 打开时

| 按键 | 行为 |
| --- | --- |
| ArrowDown / ArrowUp | 由内部 `RenderTreeGrid` 移动焦点行。 |
| ArrowLeft / ArrowRight | 由内部 `RenderTreeGrid` 折叠或展开节点。 |
| Enter | 激活当前焦点节点。可选节点会提交；不可选节点不会提交。 |
| Escape | 关闭 popup。 |
| Tab | 关闭 popup，并让焦点继续移动。 |
| 搜索框输入 | 更新 query，刷新过滤树表，并在触发字段里临时显示 query。 |

当用户输入 query 但未选择任何节点，关闭 popup 后触发字段会恢复显示已提交的节点 label，不会把 query 当作 value 提交。

## 清除行为

清除按钮显示条件：

- `clearable === true`
- `value.length > 0`
- 非 `disabled`
- 非 `readonly`

清除后：

- 关闭 popup。
- 清空 query 展示。
- 字段获得焦点。
- `value` 变成 `''`。
- 触发 `onChange('', null)`。

```ts
interface ClearableTreeGridRow {
  name: string
  code: string
}
const clearableTreeGrid = new RenderDropTreeGridEdit<ClearableTreeGridRow>({
  columns: [
    { type: 'text', key: 'name', title: '名称' },
    { type: 'text', key: 'code', title: '编码', width: 96 },
  ],
  roots: [
    { key: 'item-office', row: { name: '办公用品', code: 'ITEM-01' } },
  ],
  treeColumnKey: 'name',
  labelKey: 'name',
  value: 'item-office',
  clearable: true,
  onChange: (value, node) => {
    state.categoryKey = value
    state.categoryName = node?.row.name ?? ''
  },
})
```

## 只读和禁用

| 状态 | 可聚焦 | 可打开 popup | 可清除 | 视觉 |
| --- | --- | --- | --- | --- |
| 正常 | 是 | 是 | 取决于 `clearable` | 箭头图标。 |
| `readonly` | 否 | 否 | 否 | 只读底色和锁图标。 |
| `disabled` | 否 | 否 | 否 | 禁用文本和禁用边框。 |

`readonly` 适合展示已选节点但当前流程不允许修改；`disabled` 适合字段完全不可交互的状态。

## meta 和 tooltip

`metaKey` 或 `metaFormatter` 用于在触发字段右侧显示附加文本：

```ts
interface MetaTreeGridRow {
  name: string
  code: string
}
const metaTreeGrid = new RenderDropTreeGridEdit<MetaTreeGridRow>({
  columns: [
    { type: 'text', key: 'name', title: '名称' },
    { type: 'text', key: 'code', title: '编码', width: 96 },
  ],
  roots: [
    { key: 'item-office', row: { name: '办公用品', code: 'ITEM-01' } },
  ],
  treeColumnKey: 'name',
  labelKey: 'name',
  metaFormatter: node => `编码: ${node.row.code}`,
  onChange: value => {
    state.categoryKey = value
  },
})
```

显示规则：

- popup 关闭时，主文本显示 `row[labelKey]`，右侧显示 meta。
- 用户输入 query 时，触发字段显示 query，并临时隐藏 meta。
- 选择或关闭 popup 后恢复已提交值展示。
- 如果主文本和 meta 在触发字段内被裁剪，组件 tooltip 会显示完整 `label + meta`。

## columns / roots / treeColumnKey 动态更新

- popup 打开时，`columns` 重新赋值会同步 popup 和内部 `RenderTreeGrid`。
- 如果当前 `treeColumnKey` 不存在于新 columns，组件会回退到第一列 key，并同步 popup。
- popup 打开时，`treeColumnKey` 重新赋值会同步内部树列。
- popup 打开时，`roots` 重新赋值会按当前 query 刷新树表。
- `roots` 变化不会自动清空 `value`，也不会触发 `onChange`。
- `value` 重新赋值时，如果 popup 打开，会同步 popup 的 selectedValue 和树表选中态。

```ts
interface DynamicTreeGridRow {
  name: string
  code: string
}
const dynamicTreeGrid = new RenderDropTreeGridEdit<DynamicTreeGridRow>({
  columns: [
    { type: 'text', key: 'name', title: '名称' },
    { type: 'text', key: 'code', title: '编码', width: 96 },
  ],
  roots: [
    { key: 'item-office', row: { name: '办公用品', code: 'ITEM-01' } },
  ],
  treeColumnKey: 'name',
  labelKey: 'name',
  value: 'item-office',
})

dynamicTreeGrid.columns = [
  { type: 'text', key: 'code', title: '编码', width: 120 },
]
if (!dynamicTreeGrid.debugState().displayText) {
  dynamicTreeGrid.value = ''
}
```

## Popup 布局和尺寸

popup 宽高规则：

- 最小宽度不小于触发字段宽度。
- 最小宽度不小于 280。
- 固定列使用 `width`。
- 未设置 `width` 的列按剩余宽度弹性分配，最小 80。
- 如果可见树表行数超过 `maxVisibleItems`，会保留滚动条宽度。
- 下方空间不足时会尝试显示到触发字段上方。
- 右下角 resize grip 可调整 popup 宽高。

`maxVisibleItems` 控制自然高度，但用户调整过 popup 尺寸后，浮层会使用当前 override 尺寸。

## 生命周期

- `RenderDropTreeGridEdit.dispose()` 会关闭并释放 popup、注销焦点、清理 query 和 hover。
- `readonly` / `disabled` 变为 `true` 会关闭 popup、清理 query、失焦并从焦点顺序中移除。
- popup 关闭会结束搜索输入 session，并销毁内部 `RenderTreeGrid`。
- `debugState()` 在 popup 关闭时不会执行 `queryProcessor`，避免调试面板触发额外业务查询。

## 表单组合建议

```ts
interface RequiredExamTreeGridRow {
  name: string
  code: string
  py?: string
}
const requiredExamColumns: GridColumnDef<RequiredExamTreeGridRow>[] = [
  { type: 'text', key: 'name', title: '项目名称', width: 220 },
  { type: 'text', key: 'code', title: '项目编码', width: 96 },
]
const requiredExamRoots: TreeGridNode<RequiredExamTreeGridRow>[] = [
  {
    key: 'exam-root',
    row: { name: '服务目录', code: 'EX', py: 'jcml' },
    children: [{ key: 'exam-ct', row: { name: '头颅 CT', code: 'IMG301', py: 'tlct' } }],
  },
]
const requiredExamTreeGrid = new RenderDropTreeGridEdit<RequiredExamTreeGridRow>({
  columns: requiredExamColumns,
  roots: requiredExamRoots,
  treeColumnKey: 'name',
  labelKey: 'name',
  value: state.examKey,
  placeholder: '选择服务项目',
  prefixText: '服务',
  metaKey: 'code',
  clearable: true,
  status: state.examKey ? 'default' : 'error',
  helperText: state.examKey ? '' : '请选择服务项目',
  expandedKeysOnOpen: ['exam-root'],
  queryTextBuilder: node => [node.key, node.row.name, node.row.code, node.row.py ?? ''],
  onChange: value => {
    state.examKey = value
  },
})
```

布局注意：

- 组件宽度由父布局约束决定；无限宽度下默认使用 220。
- `helperText` 会增加组件总高度。
- 已选 label 和 meta 只在单行内裁剪，不会自动换行。
- 分类父节点建议设置 `selectable: false`，避免用户误选分类容器。
- popup 需要足够宽度展示列；列很多时优先调整列宽或减少列数，不要把所有业务字段都放进 popup。

## 常见问题

### 为什么点击目录行没有提交？

检查节点是否设置了 `selectable: false`。这种节点只作为分类容器，不会触发 `onChange`。

### 为什么 treeColumnKey 自动变了？

当 `columns` 变化后，如果当前 `treeColumnKey` 不存在于新列中，组件会回退到第一列 key，避免树表没有树列。

### 为什么搜索后树表会全部展开？

搜索状态下组件会展开过滤后的所有可展开节点，目的是让匹配节点立即可见。搜索时的展开状态不会保存为正常展开状态。

### 为什么设置了 `value` 但显示 placeholder？

`value` 必须能在 `roots` 中找到相同 key 的节点。找不到时组件没有可显示 label，会显示 placeholder。

### 远程树表查询怎么做？

当前 `queryProcessor` 是同步函数。推荐业务层维护缓存 roots：用户输入 query 时先返回当前缓存，请求完成后更新 `field.roots`。如果 popup 仍打开，组件会刷新过滤树表。

## 相关组件

- [TreeGrid](../data/tree-grid.md)
- [DropTreeEdit](./drop-tree-edit.md)
- [DropCheckTreeEdit](./drop-check-tree-edit.md)
- [LookupEdit](./lookup-edit.md)
- [DataGrid](../data/data-grid.md)
