# DropCheckTreeEdit 树形多选下拉

> **通用布局能力**：`RenderDropCheckTreeEdit` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；下拉 popup 的面板尺寸使用选择器浮层配置。详见[组件通用布局属性](../common-layout-properties.md)。


`RenderDropCheckTreeEdit` 是“触发输入框 + popup check tree”的组合控件。它用于从树形数据中选择多个叶子节点，例如多部门范围、多目录授权、多分类过滤。

控件内部复用 [TreeView](../data/tree-view.md) 的 `selectionMode: 'check'` 行为。触发框负责展示摘要、搜索文本和清除按钮；popup 内负责搜索、展开折叠、checkbox 勾选和滚动。

## API 总览

主类：

- `RenderDropCheckTreeEdit`

相关 public API：

- `TreeNode`
- `defaultDropCheckTreeEditQueryProcessor`
- `DropCheckTreeEditQueryContext`
- `DropCheckTreeEditQueryProcessor`
- `DropCheckTreeEditQueryTextBuilder`
- `DropCheckTreeEditExpandedKeysResolver`
- `DropCheckTreeEditExpandOnOpenContext`
- `DropCheckTreeEditSummaryBuilder`
- `DropCheckTreeEditSummaryContext`
- `DropCheckTreeEditDebugState`
- `FormFieldStatus`

导入：

```ts
import {
  RenderDropCheckTreeEdit,
  defaultDropCheckTreeEditQueryProcessor,
  type DropCheckTreeEditDebugState,
  type DropCheckTreeEditExpandOnOpenContext,
  type DropCheckTreeEditExpandedKeysResolver,
  type DropCheckTreeEditQueryContext,
  type DropCheckTreeEditQueryProcessor,
  type DropCheckTreeEditQueryTextBuilder,
  type DropCheckTreeEditSummaryBuilder,
  type DropCheckTreeEditSummaryContext,
  type FormFieldStatus,
  type TreeNode,
} from 'ds-ui'
```

`RenderDropCheckTreeEdit` 的构造参数是公开 options 对象，但当前没有单独导出的 DropCheckTreeEdit options 类型。业务代码直接按本文参数表传入对象。

## 何时使用

使用 DropCheckTreeEdit：

- 需要在树形目录中多选。
- 选项有父子层级，父节点用于分组。
- 需要搜索树节点。
- 表单字段中只需要显示一个简短摘要。

不要使用：

- 单选树，使用 [DropTreeEdit](./drop-tree-edit.md)。
- 平铺多选列表，使用 [MultiSelectDropdown](./multi-select-dropdown.md)。
- 需要多列表格列展示和筛选，使用 [DropTreeGridEdit](./drop-tree-grid-edit.md)。
- 需要长期展示大树，直接使用 [TreeView](../data/tree-view.md)。

## 最小示例

```ts
import { RenderDropCheckTreeEdit, type TreeNode } from 'ds-ui'

const departmentCheckRoots: TreeNode[] = [
  {
    key: 'internal',
    label: '组织结构',
    children: [
      { key: 'engineering', label: '研发部' },
      { key: 'design', label: '设计部' },
    ],
  },
]

const checkTreeState = {
  keys: [] as string[],
  labels: [] as string[],
}

const field = new RenderDropCheckTreeEdit({
  roots: departmentCheckRoots,
  checkedKeys: checkTreeState.keys,
  placeholder: '选择适用部门范围',
  clearable: true,
  onChange: (checkedKeys, nodes) => {
    checkTreeState.keys = checkedKeys
    checkTreeState.labels = nodes.map(node => node.label)
  },
})
```

`checkedKeys` 表示已勾选的叶子 key。`onChange` 返回当前 leaf checked keys 和对应节点。

## TreeNode 数据结构

DropCheckTreeEdit 使用 TreeView 的 `TreeNode<T>`：

```ts
interface TreeNode<T = any> {
  key: string
  label: string
  labelTokens?: readonly TreeLabelToken[]
  tooltip?: string
  icon?: string
  selectable?: boolean
  checkable?: boolean
  data?: T
  children?: TreeNode<T>[]
}
```

常用字段：

| 字段 | 说明 |
| --- | --- |
| `key` | 节点唯一标识。必须稳定。 |
| `label` | 展示文本，也是默认搜索文本之一。 |
| `children` | 子节点。存在子节点时该节点可展开。 |
| `checkable` | 是否显示/响应 checkbox。`false` 时节点本身不可勾选，但子节点仍可勾选。 |
| `selectable` | TreeView 单选语义字段；check 模式下主要由 checkbox 控制。 |
| `data` | 业务数据，可用于搜索、摘要和回调。 |
| `tooltip` | TreeView 节点自身 tooltip。 |
| `labelTokens` | TreeView 支持的分段着色文本。 |

## 表单绑定

`RenderDropCheckTreeEdit<T>` 实现 `ValueEditor<string[], ..., TreeNode<T>[]>`，可以直接绑定 key 数组字段。值事件的 `detail` 是当前勾选节点数组；`getValue()`、`setValue()` 和事件载荷都使用数组副本，页面不能通过修改回调参数绕过控件更新。

触发框、popup 搜索框和勾选树共同组成一次逻辑焦点会话。焦点进入 popup 不会提前发布 blur；只有离开整个字段、显式调用 `blur()`，或切换为 disabled/readonly 时才发布一次 blur。数组字段需要“恢复为相同集合即不再 dirty”时，应按业务顺序或集合语义为 `FormSession` 配置相等函数。

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `roots` | `TreeNode<T>[]` | 必填 | 树根节点。 |
| `checkedKeys` | `readonly string[]` | `[]` | 初始勾选 key。会去重并过滤空值。 |
| `placeholder` | `string` | `'请选择...'` | 未选择时的提示文本。 |
| `onChange` | `(checkedKeys, nodes) => void` | `undefined` | 勾选变化和清除时触发。 |
| `searchable` | `boolean` | `true` | 是否显示 popup 搜索框，并允许触发框键入打开搜索。 |
| `maxVisibleItems` | `number` | `8` | popup 中最多按多少个可见树节点计算高度。 |
| `readonly` | `boolean` | `false` | 只读。不能聚焦、不能打开 popup、不能清除。 |
| `disabled` | `boolean` | `false` | 禁用。不能交互。 |
| `status` | `FormFieldStatus` | `'default'` | 表单字段状态。 |
| `helperText` | `string` | `''` | 字段下方辅助/错误文本。影响整体高度。 |
| `prefixText` | `string` | `''` | 触发框前缀文本。 |
| `suffixText` | `string` | `''` | 触发框后缀文本。 |
| `clearable` | `boolean` | `false` | 有值且非只读/禁用时显示清除按钮。 |
| `expandAllOnOpen` | `boolean` | `false` | 打开时展开所有可展开节点。 |
| `expandedKeysOnOpen` | `readonly string[] \| resolver` | `undefined` | 打开时使用的展开 key。会自动合并已选节点祖先。 |
| `queryTextBuilder` | `(node) => string[]` | `key + label` | 默认查询处理器使用的节点文本构造器。 |
| `queryProcessor` | `(context) => TreeNode<T>[]` | 默认处理器 | 自定义查询过滤逻辑。 |
| `summaryBuilder` | `(context) => string` | 默认摘要 | 自定义触发框摘要。 |
| `maxSummaryItems` | `number` | `2` | 默认摘要最多展示多少个标签，至少为 1。 |

## 属性和方法

| API | 类型 | 说明 |
| --- | --- | --- |
| `roots` | `TreeNode<T>[]` | 当前根节点。赋值后若 popup 打开会刷新 popup roots。 |
| `checkedKeys` | `string[]` | 当前勾选 key 副本。赋值会同步 popup 并重绘。 |
| `placeholder` | `string` | placeholder 文本。 |
| `onChange` | `(checkedKeys, nodes) => void` | 变化回调。 |
| `searchable` | `boolean` | 是否可搜索。 |
| `maxVisibleItems` | `number` | popup 可见行数上限。 |
| `readonly` | `boolean` | 只读状态。设为 `true` 会关闭 popup、清理查询展示并取消焦点。 |
| `disabled` | `boolean` | 禁用状态。设为 `true` 会关闭 popup、清理查询展示并取消焦点。 |
| `status` | `FormFieldStatus` | 字段状态。 |
| `helperText` | `string` | 辅助文本。修改会请求布局。 |
| `prefixText`、`suffixText` | `string` | 触发框前后缀。 |
| `clearable` | `boolean` | 是否显示清除按钮。 |
| `expandAllOnOpen` | `boolean` | 打开时是否展开全部。 |
| `expandedKeysOnOpen` | `readonly string[] \| resolver \| undefined` | 打开时展开策略。 |
| `queryTextBuilder` | `DropCheckTreeEditQueryTextBuilder<T>` | 默认搜索文本构造器。 |
| `queryProcessor` | `DropCheckTreeEditQueryProcessor<T>` | 自定义搜索处理器。 |
| `summaryBuilder` | `DropCheckTreeEditSummaryBuilder<T>` | 自定义摘要。 |
| `maxSummaryItems` | `number` | 默认摘要数量上限。 |
| `isFocused` | `boolean` | 触发器或自有勾选树 popup 处于编辑焦点时为 `true`。 |
| `requestFocus()` / `blur()` | `() => void` | 进入或离开整个逻辑编辑焦点；`blur()` 同时关闭自有 popup。 |
| `getValue()` / `setValue(value)` | `() => string[]` / `(value: string[]) => void` | 读取副本或静默写入正式值。 |
| `debugState()` | `DropCheckTreeEditDebugState` | 返回 popup、查询、展示、勾选、展开等调试状态。 |
| `dispose()` | `void` | 关闭并释放 popup，注销焦点。 |

`checkedKeys` getter 返回副本，不能通过 `field.checkedKeys.push(...)` 修改内部状态；应整体赋值。

## 勾选规则

勾选逻辑由 TreeView check 模式提供：

- `checkedKeys` 存储的是已勾选叶子节点 key。
- 点击叶子 checkbox 会勾选/取消该叶子。
- 点击父节点 checkbox 会切换其下所有可勾选目标叶子。
- 父节点根据子节点状态自动显示全选或半选。
- `checkable: false` 的节点本身不作为勾选目标，但其可勾选子孙仍参与父子联动。
- 勾选父节点不会自动展开折叠节点，也不会改变 popup 高度。

如果父节点只是分组，建议显式设置：

```ts
const roots: TreeNode[] = [
  {
    key: 'general-tech',
    label: '支撑系统',
    checkable: false,
    children: [
      { key: 'lab', label: '检测部门' },
      { key: 'imaging', label: '影像科' },
    ],
  },
]
```

这样用户只能勾选子节点，父节点只承载展开和分组语义。

## 点击区域

当前交互边界：

| 区域 | 行为 |
| --- | --- |
| 触发框 | 打开/关闭 popup。 |
| 触发框清除按钮 | 清空 checked keys，触发 `onChange([], [])`。 |
| popup 搜索框 | 输入查询文本。 |
| 节点展开箭头 | 展开/折叠节点。 |
| 节点 checkbox | 切换勾选。 |
| 节点 label | 按 TreeView 行交互处理，不等同于 checkbox。 |
| popup 外部点击 | 关闭 popup。点击触发框本身也会关闭 popup。 |

因此，不能假设“点击 label 等于勾选”。如果业务要求 label 也勾选，应先扩展 TreeView 的 check 模式交互，而不是在 DropCheckTreeEdit 里单独处理。

## 搜索

默认搜索处理器：

```ts
const processor = defaultDropCheckTreeEditQueryProcessor()
```

默认搜索规则：

- 查询文本会 trim 并转小写。
- 默认匹配 `node.key` 和 `node.label`。
- 父节点命中时保留该节点。
- 子节点命中时保留祖先路径，并只保留匹配子树。
- 搜索时 popup 会展开过滤结果中的所有可展开节点。

自定义搜索文本：

```ts
const field = new RenderDropCheckTreeEdit({
  roots,
  queryTextBuilder: node => [
    node.key,
    node.label,
    node.data?.py ?? '',
  ],
})
```

自定义搜索处理器：

```ts
const field = new RenderDropCheckTreeEdit({
  roots,
  queryProcessor: ({ query, roots, checkedKeys }) => {
    state.lastQuery = query
    state.checked = [...checkedKeys]
    return roots.filter(node => node.label.includes(query))
  },
})
```

`debugState()` 不会执行 `queryProcessor`，避免调试读取触发昂贵查询。

## 展开策略

打开 popup 时展开 key 计算规则：

1. `expandAllOnOpen === true`：展开所有可展开节点。
2. `expandedKeysOnOpen` 是函数：使用函数返回值。
3. `expandedKeysOnOpen` 是数组：使用数组。
4. 上述结果都会合并已勾选节点的祖先 key。
5. 搜索中会展开过滤结果的所有可展开节点。
6. 用户手动展开/折叠会在非搜索状态下记忆到 popup 内部；下次打开会沿用。

示例：

```ts
const field = new RenderDropCheckTreeEdit({
  roots,
  checkedKeys: ['lab'],
  expandedKeysOnOpen: ({ checkedKeys }) => {
    return checkedKeys.length > 0 ? ['general-tech'] : []
  },
})
```

## 摘要显示

默认摘要使用已勾选节点 label：

- 勾选数量小于等于 `maxSummaryItems`：显示全部，例如 `研发部、设计部`。
- 勾选数量超出上限：显示前 N 项加数量，例如 `研发部、设计部 +1`。

自定义摘要：

```ts
const field = new RenderDropCheckTreeEdit({
  roots,
  summaryBuilder: ({ checkedNodes }) => {
    return checkedNodes.length === 0
      ? ''
      : `已选择 ${checkedNodes.length} 项`
  },
})
```

当摘要被折叠或触发框宽度不足时，控件会把完整已选 label 列表放入 tooltip。placeholder 和搜索展示状态不会生成该 tooltip。

## 键盘行为

| 操作 | 行为 |
| --- | --- |
| `Enter` / `Space` / `ArrowDown` | 触发框聚焦且 popup 未打开时打开 popup。 |
| 输入普通字符 | `searchable === true` 且 popup 未打开时，以该字符作为初始查询打开 popup。 |
| `Backspace` / `Delete` | 有清除按钮时清空。 |
| `Escape` | popup 打开时关闭 popup 并清理查询展示。 |
| `Tab` | popup 打开时关闭 popup，返回 `false` 让焦点继续移动。 |
| popup 内方向键 / Enter | 转交给 TreeView。 |

只读或禁用状态不会注册焦点，也不会打开 popup。

## Popup 布局和滚动

popup 宽度：

```text
panelW = clamp(max(280, anchorWidth), viewportWidth - 16)
```

popup 高度：

- 按 TreeView 可见节点数计算。
- 可见节点数最多为 `maxVisibleItems`。
- 搜索框开启时额外占用一行输入框高度和 padding。
- 位置会限制在 viewport 8px inset 内。

当节点数量超过可见高度时，内部 TreeView 自己处理滚动和滚动条。popup 内滚轮会被消费，即使当前树没有溢出，也不会把滚动传递到底层页面。

## 状态、只读和禁用

| 状态 | 行为 |
| --- | --- |
| `readonly` | 显示锁图标和只读底色，不可聚焦、不可打开、不可清除。 |
| `disabled` | 禁用视觉，不可聚焦、不可打开、不可清除。 |
| `status` | 影响触发框边框/状态色，适合校验状态。 |
| `helperText` | 显示在字段下方，并影响组件布局高度。 |

设置 `readonly` 或 `disabled` 为 `true` 时，已打开 popup 会立即关闭，查询展示会清空。

## DebugState

```text
const debug = field.debugState()
```

返回字段：

| 字段 | 说明 |
| --- | --- |
| `popupVisible` | popup 是否打开。 |
| `queryText` | 当前查询文本。 |
| `showQueryInField` | 触发框是否临时展示查询文本。 |
| `displayText` | 当前触发框显示文本。 |
| `focused` | 触发框是否聚焦。 |
| `disabled` | 是否禁用。 |
| `readonly` | 是否只读。 |
| `checkedKeys` | 当前勾选 key。 |
| `checkedLabel` | 当前摘要文本。 |
| `filteredCount` | popup 打开时为过滤树节点数；关闭时为完整树节点数。 |
| `expandedKeys` | popup 当前展开 key。 |

`debugState()` 适合测试和诊断，不应作为业务数据源。

## 生命周期

`dispose()` 会：

- 关闭 popup。
- 释放 popup 内 TreeView 和搜索输入会话。
- 注销焦点。
- 清理 hover/focus 状态。

当页面卸载、表单销毁或字段不再使用时，应 dispose 该控件。`roots` 中的业务对象仍由业务持有，不由控件释放。

## 性能边界

- popup 内 TreeView 使用固定行虚拟范围绘制可见行。
- 搜索过滤会遍历当前 roots，复杂度和树节点数量相关。
- `debugState()` 不执行查询处理器，避免调试面板触发昂贵过滤。
- 大树应提供轻量 `queryTextBuilder`，避免每个节点构造大字符串。
- 远程查询或懒加载应放在业务层更新 `roots`，不要在 `queryProcessor` 中阻塞主线程。

## 常见问题

### 为什么点击 label 没有勾选？

当前勾选动作绑定在 TreeView check 模式的 checkbox 上。label 点击不是 checkbox 点击。需要改变这个交互应扩展 TreeView 的 check 行为。

### 为什么勾选父节点后没有展开？

这是预期行为。父节点 checkbox 会切换子孙可勾选目标，但不会改变展开状态，也不会改变折叠区域高度。

### checkedKeys 为什么只包含叶子？

TreeView check 模式以叶子目标作为真实值。父节点的全选/半选是根据叶子状态推导出来的展示状态。

### 搜索时为什么会展开很多节点？

搜索状态下会展开过滤结果中的所有可展开节点，方便用户看到匹配子节点。清空搜索后恢复非搜索展开策略。

### 如何清空？

设置 `clearable: true` 后，触发框显示清除按钮。点击后会设置 `checkedKeys = []` 并触发 `onChange([], [])`。也可以直接赋值 `field.checkedKeys = []`，但直接赋值不会触发 `onChange`。

### 如何显示完整已选内容？

默认摘要被折叠或宽度不足时会设置 tooltip，内容是完整 label 列表。也可以通过 `summaryBuilder` 自定义摘要。

## 相关文档

- [TreeView 树](../data/tree-view.md)
- [DropTreeEdit 树形单选下拉](./drop-tree-edit.md)
- [DropTreeGridEdit 树表下拉](./drop-tree-grid-edit.md)
- [MultiSelectDropdown 多选下拉](./multi-select-dropdown.md)
- [TextBox 文本输入](../input/text-box.md)
