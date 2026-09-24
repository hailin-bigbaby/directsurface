# DropTreeEdit 树形下拉

> **通用布局能力**：`RenderDropTreeEdit` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；下拉树的 popup 尺寸和内部 padding 不属于普通盒模型。详见[组件通用布局属性](../common-layout-properties.md)。


DirectSurface UI 的树形单选下拉公共类名是 `RenderDropTreeEdit`。它用于从树形数据中选择一个节点，常见于部门目录、模板分类、组织结构、项目分类、权限菜单等层级字典。

`DropTreeEdit` 的触发字段负责表单布局、已选节点显示、焦点、只读禁用和清除；popup 内部组合 `RenderTreeView`，负责展开折叠、键盘导航、树节点选择、搜索过滤和滚动。

## API 总览

主类：

- `RenderDropTreeEdit`

相关 public API：

- `TreeNode`
- `defaultDropTreeEditQueryProcessor`
- `DropTreeEditQueryContext`
- `DropTreeEditQueryProcessor`
- `DropTreeEditQueryTextBuilder`
- `DropTreeEditExpandedKeysResolver`
- `DropTreeEditExpandOnOpenContext`
- `DropTreeEditDebugState`
- `FormFieldStatus`

导入：

```ts
import {
  RenderDropTreeEdit,
  defaultDropTreeEditQueryProcessor,
  type DropTreeEditDebugState,
  type DropTreeEditExpandOnOpenContext,
  type DropTreeEditExpandedKeysResolver,
  type DropTreeEditQueryContext,
  type DropTreeEditQueryProcessor,
  type DropTreeEditQueryTextBuilder,
  type FormFieldStatus,
  type TreeNode,
} from 'ds-ui'
```

`RenderDropTreeEdit` 的构造参数是公开 options 对象，但当前没有单独导出的 DropTreeEdit options 类型。业务代码直接按本文参数表传入对象。

## 何时使用

- 候选项天然是树形层级。
- 只能选择一个节点。
- 需要保留父子层级和展开状态。
- 查询时需要展示匹配节点及其祖先路径。
- 父节点是否可选需要由业务通过 `selectable` 明确控制。

不适合：

- 扁平单选枚举，使用 [ComboBox](./combo-box.md)。
- 树形多选或父子勾选联动，使用 [DropCheckTreeEdit](./drop-check-tree-edit.md)。
- 树节点需要多列字段，使用 [DropTreeGridEdit](./drop-tree-grid-edit.md)。
- 扁平多列候选，使用 [LookupEdit](./lookup-edit.md)。

## 最小示例

```ts
import { RenderDropTreeEdit, type TreeNode } from 'ds-ui'

const departmentRoots: TreeNode<{ py?: string }>[] = [
  {
    key: 'dept-internal',
    label: '组织结构',
    selectable: false,
    children: [
      { key: 'dept-engineering', label: '研发部', data: { py: 'yfb' } },
      { key: 'dept-design', label: '设计部', data: { py: 'sjb' } },
    ],
  },
]

const departmentTreeState = {
  departmentId: '',
  departmentName: '',
}

const departmentTree = new RenderDropTreeEdit({
  roots: departmentRoots,
  placeholder: '选择部门',
  searchable: true,
  clearable: true,
  queryTextBuilder: node => [node.key, node.label, node.data?.py ?? ''],
  onChange: (value, node) => {
    departmentTreeState.departmentId = value
    departmentTreeState.departmentName = node?.label ?? ''
  },
})
```

## 组件关系

| 组件 / 类型 | 用途 | 说明 |
| --- | --- | --- |
| `RenderDropTreeEdit<T>` | 标准树形单选下拉字段。 | 参与布局、焦点、hover、只读禁用、清除和表单状态。 |
| `TreeNode<T>` | 树节点数据。 | 来自 [TreeView](../data/tree-view.md)，通过 `key`、`label`、`children`、`selectable` 表达层级。 |
| `DropTreeEditQueryProcessor<T>` | 自定义搜索过滤函数。 | 接收 query、roots、selectedValue，返回过滤后的根节点。 |
| `DropTreeEditQueryTextBuilder<T>` | 搜索文本构造函数。 | 决定默认搜索时每个节点参与匹配的字符串。 |
| `DropTreeEditExpandedKeysResolver<T>` | 打开时展开 keys 解析函数。 | 根据 roots 和 selectedValue 动态决定初始展开节点。 |
| `defaultDropTreeEditQueryProcessor()` | 默认搜索过滤器。 | 按 `key`、`label` 或业务提供的 query text 做包含匹配。 |

内部 popup 类不作为正式 public API 使用。业务代码应优先使用 `RenderDropTreeEdit` 和导出的查询/展开类型。

## TreeNode 数据

`DropTreeEdit` 使用 `TreeNode<T>`：

```ts
const templateRoots: TreeNode<{ categoryCode: string }>[] = [
  {
    key: 'template-root',
    label: '文档模板',
    selectable: false,
    data: { categoryCode: 'ROOT' },
    children: [
      {
        key: 'template-start',
        label: '开始记录',
        data: { categoryCode: 'ADM' },
      },
    ],
  },
]
```

常用字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `key` | `string` | 节点唯一 key，也是提交值。必须稳定。 |
| `label` | `string` | 显示文本。 |
| `children` | `TreeNode<T>[]` | 子节点。 |
| `selectable` | `boolean` | 设为 `false` 时该节点不能被提交。常用于分类父节点。 |
| `data` | `T` | 业务数据。可用于拼音码、编码、权限类型等。 |

`onChange` 提交的 `value` 就是选中节点的 `key`。

## 表单绑定

`RenderDropTreeEdit<T>` 实现 `ValueEditor<string, ..., TreeNode<T> | null>`，可以直接传给 `FormBindingBag.bindField()`。选择事件的 `detail` 是当前节点，清除时为 `null`；`setValue()` 是静默的模型写入，不触发 `onChange` 或值事件。

触发框和它打开的树 popup 属于同一次逻辑焦点会话。焦点进入搜索框或树不会发布 blur；关闭 popup 后焦点回到触发框，只有离开整个字段、显式调用 `blur()`，或切换为 disabled/readonly 时才发布一次 blur。

## RenderDropTreeEdit 构造参数

`new RenderDropTreeEdit<T>(options)` 的 `options`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `roots` | `TreeNode<T>[]` | 必填 | 根节点数组。 |
| `value` | `string` | `''` | 当前选中节点 key。 |
| `placeholder` | `string` | `'请选择...'` | 未选中时显示的提示文本。 |
| `onChange` | `(value: string, node: TreeNode<T> \| null) => void` | `undefined` | 选中或清除时触发。清除时 `node` 为 `null`。 |
| `searchable` | `boolean` | `true` | 是否允许输入关键字查询，并在 popup 顶部显示搜索框。 |
| `maxVisibleItems` | `number` | `8` | popup 树最多按多少个可见节点计算自然高度。 |
| `readonly` | `boolean` | `false` | 只读。不可聚焦、不可打开、不可清除，显示锁图标。 |
| `disabled` | `boolean` | `false` | 禁用。不可聚焦、不可打开、不可清除。 |
| `status` | `FormFieldStatus` | `'default'` | 表单状态。可选 `'default'`、`'success'`、`'warning'`、`'error'`。 |
| `helperText` | `string` | `''` | 字段下方帮助或错误文案。会增加组件高度。 |
| `prefixText` | `string` | `''` | 输入区域左侧固定文本。 |
| `suffixText` | `string` | `''` | 输入区域右侧固定文本。 |
| `clearable` | `boolean` | `false` | 有值、非禁用、非只读时显示清除按钮，并允许 Backspace/Delete 清除。 |
| `expandAllOnOpen` | `boolean` | `false` | 打开 popup 时是否展开所有可展开节点。 |
| `expandedKeysOnOpen` | `readonly string[] \| DropTreeEditExpandedKeysResolver<T>` | `undefined` | 打开 popup 时默认展开的节点 key。会自动合并当前选中节点的祖先 key。 |
| `queryTextBuilder` | `DropTreeEditQueryTextBuilder<T>` | `node => [node.key, node.label]` | 默认查询时每个节点参与匹配的文本。 |
| `queryProcessor` | `DropTreeEditQueryProcessor<T>` | `defaultDropTreeEditQueryProcessor(queryTextBuilder)` | 自定义查询函数。 |

```ts
const categoryRoots: TreeNode[] = [
  {
    key: 'template-root',
    label: '文档模板',
    selectable: false,
    children: [{ key: 'template-start', label: '开始记录' }],
  },
]
const categoryTree = new RenderDropTreeEdit({
  roots: categoryRoots,
  value: '',
  placeholder: '选择模板分类',
  searchable: true,
  maxVisibleItems: 10,
  clearable: true,
  expandedKeysOnOpen: ['template-root'],
  prefixText: '分类',
  onChange: (value, node) => {
    state.templateCategoryKey = value
    state.templateCategoryName = node?.label ?? ''
  },
})
```

## RenderDropTreeEdit 属性

| 属性 | 类型 | 可写 | 说明 |
| --- | --- | --- | --- |
| `roots` | `TreeNode<T>[]` | 是 | 当前根节点。popup 打开时重新赋值会刷新 popup 树。 |
| `value` | `string` | 是 | 当前选中节点 key。赋值会转成字符串并重绘；popup 打开时会同步 selectedKey。 |
| `placeholder` | `string` | 是 | 提示文本。公开字段。 |
| `onChange` | `(value: string, node: TreeNode<T> \| null) => void \| undefined` | 是 | 值变化回调。 |
| `searchable` | `boolean` | 是 | 是否允许搜索。公开字段；修改后下一次打开 popup 生效。 |
| `maxVisibleItems` | `number` | 是 | popup 最大可见节点数。公开字段；修改后下一次打开 popup 生效。 |
| `readonly` | `boolean` | 是 | 只读状态。设为 `true` 会关闭 popup、清理 query、失焦并注销焦点。 |
| `disabled` | `boolean` | 是 | 禁用状态。设为 `true` 会关闭 popup、清理 query、失焦并注销焦点。 |
| `status` | `FormFieldStatus` | 是 | 状态色。赋值会重绘。 |
| `helperText` | `string` | 是 | 帮助文案。赋值会重新 layout。 |
| `prefixText` | `string` | 是 | 前缀文本。赋值会重绘。 |
| `suffixText` | `string` | 是 | 后缀文本。赋值会重绘。 |
| `clearable` | `boolean` | 是 | 是否显示清除按钮。赋值会重绘。 |
| `expandAllOnOpen` | `boolean` | 是 | 打开时是否展开所有可展开节点。公开字段。 |
| `expandedKeysOnOpen` | `readonly string[] \| DropTreeEditExpandedKeysResolver<T> \| undefined` | 是 | 打开时展开 key。公开字段。 |
| `queryTextBuilder` | `DropTreeEditQueryTextBuilder<T> \| undefined` | 是 | 默认查询文本构造器。公开字段。 |
| `queryProcessor` | `DropTreeEditQueryProcessor<T> \| undefined` | 是 | 自定义查询函数。公开字段。 |
| `isFocused` | `boolean` | 否 | 触发器或自有树 popup 处于编辑焦点时为 `true`。 |

公开字段不是 setter 时，运行时修改后如果影响当前画面，应由业务触发重绘或在下一次打开 popup 前修改。

## RenderDropTreeEdit 方法

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `focusIn()` | `void` | 进入焦点。通常由 `FocusManager` 调用。 |
| `focusOut()` | `void` | 退出焦点。通常由 `FocusManager` 调用。 |
| `requestFocus()` / `blur()` | `void` | 进入或离开整个逻辑编辑焦点；`blur()` 同时关闭自有 popup。 |
| `getValue()` / `setValue(value)` | `string` / `void` | 读取或静默写入正式值。 |
| `debugState()` | `DropTreeEditDebugState` | 返回当前 popup、query、显示文本、过滤节点数和展开 keys。 |
| `dispose()` | `void` | 关闭并释放 popup、注销焦点、清理 query 和 hover。 |

`RenderDropTreeEdit` 没有公开 `open()` 方法。打开行为由点击、Enter、Space、ArrowDown 或可搜索状态下的字符输入触发。

## DropTreeEditDebugState

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
| `filteredCount` | `number` | popup 打开时为过滤树节点总数；关闭时为全部节点总数。 |
| `expandedKeys` | `string[]` | popup 当前展开 keys。 |

```ts
const debugTree = new RenderDropTreeEdit({
  roots: [
    {
      key: 'root',
      label: '根节点',
      children: [{ key: 'leaf', label: '叶子节点' }],
    },
  ],
})
const treeState = debugTree.debugState()
if (treeState.popupVisible) {
  notificationManager.show(`展开节点数: ${treeState.expandedKeys.length}`)
}
```

## 查询行为

### 默认查询

默认查询由 `defaultDropTreeEditQueryProcessor(queryTextBuilder)` 创建：

- query 会 trim 后转小写。
- query 为空时返回原始 roots 的浅拷贝。
- 每个节点通过 `queryTextBuilder(node)` 生成多个待匹配文本。
- 任一文本包含 query 即认为该节点匹配。
- 子节点匹配时，会保留祖先节点，并只保留匹配路径下的 children。
- 查询状态下 popup 会展开所有可展开节点，方便看到匹配结果。

```ts
const searchableDepartmentRoots: TreeNode<{ py?: string }>[] = [
  {
    key: 'dept-internal',
    label: '组织结构',
    children: [{ key: 'dept-design', label: '设计部', data: { py: 'sjb' } }],
  },
]
const queryProcessor = defaultDropTreeEditQueryProcessor<{ py?: string }>(
  node => [node.key, node.label, node.data?.py ?? ''],
)
const filteredRoots = queryProcessor({
  query: 'sjb',
  roots: searchableDepartmentRoots,
  selectedValue: '',
})

state.filteredDepartmentCount = filteredRoots.length
```

### 自定义查询

`queryProcessor` 接收 `DropTreeEditQueryContext<T>`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `query` | `string` | 当前查询文本。 |
| `roots` | `readonly TreeNode<T>[]` | 原始根节点。 |
| `selectedValue` | `string` | 当前已选 key。 |

返回 `TreeNode<T>[]`，即过滤后的根节点。

```ts
const customDepartmentRoots: TreeNode<{ py: string }>[] = [
  {
    key: 'dept-internal',
    label: '组织结构',
    data: { py: 'nkxt' },
    children: [{ key: 'dept-design', label: '设计部', data: { py: 'sjb' } }],
  },
]
const customTree = new RenderDropTreeEdit<{ py: string }>({
  roots: customDepartmentRoots,
  queryProcessor: context => {
    const query = context.query.trim().toLowerCase()
    if (!query) return [...context.roots]
    return context.roots
      .map(root => ({
        ...root,
        children: root.children?.filter(child =>
          child.label.includes(context.query) ||
          child.data?.py.includes(query),
        ),
      }))
      .filter(root => root.label.includes(context.query) || (root.children?.length ?? 0) > 0)
  },
  onChange: value => {
    state.departmentKey = value
  },
})
```

`queryProcessor` 是同步函数。远程树查询应由业务层异步更新 `roots`：输入时先返回当前缓存结果，请求完成后给 `field.roots` 重新赋值；popup 打开时会刷新树。

## 展开策略

打开 popup 时的展开 keys 按下面顺序处理：

1. 如果 `expandAllOnOpen === true`，展开所有有 children 的节点。
2. 否则如果 `expandedKeysOnOpen` 是函数，调用它取得展开 keys。
3. 否则如果 `expandedKeysOnOpen` 是数组，使用该数组。
4. 最后都会合并当前选中节点的祖先 keys，保证当前选中值可见。

```ts
const resolverRoots: TreeNode[] = [
  {
    key: 'template-root',
    label: '文档模板',
    children: [{ key: 'template-start', label: '开始记录' }],
  },
]
const resolverTree = new RenderDropTreeEdit({
  roots: resolverRoots,
  value: 'template-start',
  expandedKeysOnOpen: context => {
    return context.selectedValue ? ['template-root'] : []
  },
})
```

用户在非搜索状态下展开/折叠树，popup 关闭时会记录展开 keys；下次正常打开会恢复。搜索状态下为了展示匹配路径会自动展开，不会把搜索时的展开状态写回正常展开状态。

## 鼠标行为

| 操作 | 行为 |
| --- | --- |
| 点击字段主体 | 获得焦点并打开 popup；popup 已打开时关闭并恢复已选 label。 |
| 点击清除按钮 | 清空 `value`，触发 `onChange('', null)`，字段保持焦点。 |
| 点击可选树节点 | 提交该节点，触发 `onChange(node.key, node)` 并关闭 popup。 |
| 点击 `selectable: false` 节点 | 不提交，popup 保持当前状态。 |
| 点击展开图标 | 展开或折叠该节点。 |
| 点击 popup 搜索框 | 聚焦搜索输入。 |
| 在 popup 树区域滚轮 | 滚动树，并消费滚轮事件，避免透传到外层滚动容器。 |

文本过长的省略和 tooltip 行为由内部 `RenderTreeView` 负责。

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
| ArrowDown / ArrowUp | 由内部 `RenderTreeView` 移动焦点节点。 |
| ArrowLeft / ArrowRight | 由内部 `RenderTreeView` 折叠或展开节点。 |
| Enter | 激活当前焦点节点。可选节点会提交；不可选节点不会提交。 |
| Escape | 关闭 popup。 |
| Tab | 关闭 popup，并让焦点继续移动。 |
| 搜索框输入 | 更新 query，刷新过滤树，并在触发字段里临时显示 query。 |

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
const clearableDepartmentRoots: TreeNode[] = [
  {
    key: 'dept-internal',
    label: '组织结构',
    children: [{ key: 'dept-engineering', label: '研发部' }],
  },
]
const clearableTree = new RenderDropTreeEdit({
  roots: clearableDepartmentRoots,
  value: 'dept-engineering',
  clearable: true,
  onChange: (value, node) => {
    state.departmentId = value
    state.departmentName = node?.label ?? ''
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

## roots / value 动态更新

- `roots` 重新赋值时，如果 popup 打开，会调用内部刷新并保留当前 query。
- `roots` 变化不会自动清空 `value`，也不会触发 `onChange`。
- `value` 重新赋值时，如果 popup 打开，会同步 popup 的 selectedValue 和树选中态。
- 如果新 roots 不包含当前 value，触发字段会显示 placeholder。

```ts
const dynamicTree = new RenderDropTreeEdit({
  roots: [
    { key: 'old', label: '旧节点' },
  ],
  value: 'old',
})

dynamicTree.roots = [
  { key: 'new', label: '新节点' },
]
if (!dynamicTree.debugState().displayText) {
  dynamicTree.value = ''
}
```

## Popup 布局

popup 宽高规则：

- 宽度不小于 260，也不小于触发字段宽度。
- 宽度不会超出视口左右 8px 内边距。
- 高度按搜索框高度、树可见节点数和主题 padding 计算。
- `maxVisibleItems` 参与自然高度计算。
- 下方空间不足时，当前实现会把 popup 限制在视口内，而不是强制翻到上方。

大树滚动和可见行处理由内部 `RenderTreeView` 承担。树数据非常大时，应配合业务查询或懒加载，避免一次性把全量深树放进 popup。

## 生命周期

- `RenderDropTreeEdit.dispose()` 会关闭并释放 popup、注销焦点、清理 query 和 hover。
- `readonly` / `disabled` 变为 `true` 会关闭 popup、清理 query、失焦并从焦点顺序中移除。
- popup 关闭会结束搜索输入 session，并销毁内部 `RenderTreeView`。
- `debugState()` 在 popup 关闭时不会执行 `queryProcessor`，避免调试面板触发额外业务查询。

## 表单组合建议

```ts
const requiredDepartmentRoots: TreeNode<{ py?: string }>[] = [
  {
    key: 'dept-internal',
    label: '组织结构',
    children: [{ key: 'dept-engineering', label: '研发部', data: { py: 'yfb' } }],
  },
]
const requiredDepartmentTree = new RenderDropTreeEdit({
  roots: requiredDepartmentRoots,
  value: state.departmentId,
  placeholder: '选择部门',
  prefixText: '部门',
  clearable: true,
  status: state.departmentId ? 'default' : 'error',
  helperText: state.departmentId ? '' : '请选择部门',
  expandedKeysOnOpen: ['dept-internal'],
  queryTextBuilder: node => [node.key, node.label, node.data?.py ?? ''],
  onChange: value => {
    state.departmentId = value
  },
})
```

布局注意：

- 组件宽度由父布局约束决定；无限宽度下默认使用 220。
- `helperText` 会增加组件总高度。
- 已选 label 只在单行内裁剪，不会自动换行。
- 分类父节点建议设置 `selectable: false`，避免用户误选分类容器。

## 常见问题

### 为什么点击父节点没有提交？

检查节点是否设置了 `selectable: false`。这种节点只作为分类容器，不会触发 `onChange`。

### 为什么搜索后树会全部展开？

搜索状态下组件会展开过滤后的所有可展开节点，目的是让匹配节点立即可见。搜索时的展开状态不会保存为正常展开状态。

### 为什么设置了 `value` 但显示 placeholder？

`value` 必须能在 `roots` 中找到相同 key 的节点。找不到时组件没有可显示 label，会显示 placeholder。

### 远程树查询怎么做？

当前 `queryProcessor` 是同步函数。推荐业务层维护缓存 roots：用户输入 query 时先返回当前缓存，请求完成后更新 `field.roots`。如果 popup 仍打开，组件会刷新过滤树。

## 相关组件

- [TreeView](../data/tree-view.md)
- [ComboBox](./combo-box.md)
- [DropCheckTreeEdit](./drop-check-tree-edit.md)
- [DropTreeGridEdit](./drop-tree-grid-edit.md)
- [LookupEdit](./lookup-edit.md)
