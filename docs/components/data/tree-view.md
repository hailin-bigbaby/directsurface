# TreeView 树组件

> **通用布局能力**：`RenderTreeView` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；原有独立高度状态已经并入 `RenderBox` 契约。详见[组件通用布局属性](../common-layout-properties.md)。


`RenderTreeView` 用于展示单列层级数据，支持展开折叠、单选、复选、半选、虚拟滚动、键盘导航、复制、文本省略和 tooltip。它适合导航树、目录树、分类树、模板树、对象结构浏览等场景。

## 何时使用

- 左侧导航树、文档目录、分类目录、组织结构。
- 只需要显示一个主 label，可附带 icon、tooltip 或 label token 着色。
- 需要节点单选或勾选，并支持父子半选。
- 需要大树虚拟滚动。
- 需要复制当前选中节点文本。

## 何时不要使用

- 每个节点需要显示多列字段，使用 [TreeGrid](./tree-grid.md)。
- 没有层级结构，只是普通列表，使用 [ListView](./list-view.md)。
- 需要弹出树形选择，使用 [DropTreeEdit](../selector/drop-tree-edit.md)。
- 需要弹出树形多选，使用 [DropCheckTreeEdit](../selector/drop-check-tree-edit.md)。
- 需要查看任意对象属性树，优先使用 ObjectInspector 相关组件，而不是业务层手写 TreeView。

## API 总览

```ts
import {
  RenderTreeView,
  type TreeCheckChange,
  type TreeContextMenuRequest,
  type TreeLabelToken,
  type TreeLabelTokenKind,
  type TreeNode,
  type TreeSelectionMode,
  type TreeViewDebugState,
  type TreeVisibleNodeDebugTarget,
  type SurfaceAppearance,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderTreeView<T>` | class | 单列层级树，支持展开折叠、单选、复选、半选、虚拟滚动和复制。 |
| `TreeNode<T>` | type | 树节点配置，保存稳定 key、label、children 和业务 data。 |
| `TreeSelectionMode` | type | 选择模式：`single` 或 `check`。 |
| `TreeCheckChange<T>` | type | 勾选变化回调 payload。 |
| `TreeContextMenuRequest<T>` | type | 节点右键或键盘菜单请求，包含节点、全局位置和触发来源。 |
| `TreeViewDebugState` | type | TreeView 调试快照。 |
| `TreeVisibleNodeDebugTarget` | type | 最后一次真实绘制中可点击节点的全局矩形。 |
| `TreeLabelToken` | type | 分段着色 label token。 |
| `TreeLabelTokenKind` | type | label token 语义类型。 |

最小装配顺序是：准备稳定 key 的 `TreeNode<T>[]`，创建 `RenderTreeView({ roots })`，再按需配置选择、勾选、展开和回调。业务代码应只从 `ds-ui` 包入口导入这些类型，不要从 `src/widgets/tree` 等内部路径导入。

## 最小示例

```ts
import { RenderTreeView, type TreeNode } from 'ds-ui'

interface DocEntry {
  path: string
}

const docTreeRoots: TreeNode<DocEntry>[] = [
  {
    key: 'guide',
    label: '开发指南',
    icon: 'folder',
    children: [
      { key: 'quick-start', label: '快速开始', data: { path: 'quick-start.md' } },
    ],
  },
]

const docTree = new RenderTreeView<DocEntry>({
  roots: docTreeRoots,
  appearance: 'framed',
  defaultExpandedKeys: ['guide'],
  onSelect: node => {
    console.log(node.key, node.data?.path)
  },
})
```

## 构造参数

`new RenderTreeView<T>(opts)`

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `roots` | `TreeNode<T>[]` | 必填 | 根节点数组。 |
| `selectionMode` | `'single' \| 'check'` | `'single'` | 选择模式。 |
| `checkedKeys` | `readonly string[]` | `undefined` | 受控或初始化勾选 key。优先级高于 `defaultCheckedKeys`。 |
| `defaultCheckedKeys` | `readonly string[]` | `[]` | 非受控初始勾选 key。 |
| `defaultExpandedKeys` | `string[]` | `[]` | 初始展开节点 key。 |
| `width` / `height` | `number` | `undefined` | 来自 `RenderBoxOptions` 的期望尺寸。 |
| `minWidth` / `maxWidth` | `number` | `undefined` | 水平方向尺寸边界。 |
| `minHeight` / `maxHeight` | `number` | `undefined` | 垂直方向尺寸边界。 |
| `margin` | `EdgeInsetsInput` | `0` | 组件外部留白。 |
| `horizontalAlignment` / `verticalAlignment` | `BoxAlignment` | `undefined` | 组件在父布局槽位中的对齐方式。 |
| `disabled` | `boolean` | `false` | 整体禁用。禁用后不进入焦点顺序，不响应鼠标、键盘、滚轮和复制。 |
| `appearance` | `SurfaceAppearance` | `'flush'` | 表面边界。`flush` 适合导航 pane、popup 和已有边界的容器；独立树面板显式设为 `framed`。 |
| `onSelect` | `(node) => void` | `undefined` | 节点被单选选中后触发。 |
| `onExpand` | `(node, expanded) => void` | `undefined` | 节点展开或折叠后触发。 |
| `onActivate` | `(node) => void` | `undefined` | 节点被激活后触发。 |
| `onCheck` | `(payload) => void` | `undefined` | 勾选状态变化后触发。 |
| `onContextMenuRequest` | `(request) => boolean \| void` | `undefined` | 节点上下文菜单请求。返回 `false` 表示未处理；未配置时不改变 Tree 状态。 |
| `copyable` | `boolean` | `true` | 是否允许复制当前节点。 |
| `copyText` | `(node) => string \| null \| undefined` | `undefined` | 自定义复制文本。 |

## 节点配置

`TreeNode<T>`：

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `key` | `string` | 必填 | 节点唯一 key。展开、选中、勾选、定位都依赖它。 |
| `label` | `string` | 必填 | 主显示文本。 |
| `labelTokens` | `readonly TreeLabelToken[]` | `undefined` | 分段着色文本。存在时优先按 token 绘制。 |
| `tooltip` | `string` | `undefined` | 节点 tooltip。未设置时，文本被省略才使用完整 label 作为 tooltip。 |
| `icon` | `string` | `undefined` | 内置 `IconName`、emoji 或单字符图标。内置名称使用统一的 Canvas icon painter。 |
| `selectable` | `boolean` | `true` | 是否允许单选选中。`false` 的父节点点击时会优先展开折叠。 |
| `checkable` | `boolean` | `true` | 是否允许复选。`false` 的节点不会作为勾选目标。 |
| `data` | `T` | `undefined` | 业务数据。组件不解析它，只在回调中原样返回。 |
| `children` | `TreeNode<T>[]` | `undefined` | 子节点。存在子节点时显示展开箭头。 |

`TreeLabelToken`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `text` | `string` | 当前分段文本。 |
| `kind` | `TreeLabelTokenKind` | 分段语义，用于主题决定颜色。 |

`labelTokens` 适合 ObjectInspector、搜索结果、语法着色等场景。普通树只使用 `label` 即可。

`TreeLabelTokenKind` 当前支持：

- `key`：对象 key、字段名或路径片段。
- `string`：字符串值。
- `number`：数字值。
- `boolean`：布尔值。
- `null`：空值。
- `type`：类型说明。
- `punctuation`：括号、逗号、冒号等结构符号。
- `muted`：弱化说明文本。
- `warning`：警告文本。
- `error`：错误文本。
- `match`：搜索命中文本。

## 可读写属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `selectionMode` | `TreeSelectionMode` | 当前选择模式。 |
| `roots` | `TreeNode<T>[]` | 根节点数组。替换或重新设置会重建扁平节点和勾选状态。 |
| `indentWidth` | `number` | 只读。当前缩进宽度，由主题字体尺寸决定。 |
| `expandedKeys` | `string[]` | 展开的节点 key。设置后会重建扁平节点。 |
| `selectedKey` | `string` | 当前选中节点 key。按完整 roots 校验；折叠祖先不会清空 selection。设置可见节点后会在下一次布局时滚动到该节点。 |
| `checkedKeys` | `string[]` | 当前勾选的叶子目标 key。设置后会重新计算全选和半选。 |
| `halfCheckedKeys` | `string[]` | 只读。当前半选 key。 |
| `disabled` | `boolean` | 整体禁用状态。动态设置为 `true` 会退出焦点、清理 hover/focused/scrollbar dragging 和 tooltip，并请求重绘。 |
| `appearance` | `SurfaceAppearance` | 可读写外观模式。切换只请求重绘，不改变布局尺寸。 |
| `width` / `height` | `number \| undefined` | 期望尺寸。赋值后请求 layout。 |
| `minWidth` / `maxWidth` | `number \| undefined` | 水平方向尺寸边界。赋值后请求 layout。 |
| `minHeight` / `maxHeight` | `number \| undefined` | 垂直方向尺寸边界。赋值后请求 layout。 |
| `margin` | `EdgeInsets` | 组件外部留白。赋值后请求 layout。 |
| `horizontalAlignment` / `verticalAlignment` | `BoxAlignment \| undefined` | 组件在父布局槽位中的对齐方式。 |
| `isFocused` | `boolean` | 只读。当前是否持有焦点。 |

## 表面边界

TreeView 默认是 `flush`，因为树更常作为导航区、下拉树或设计器侧边栏的内容，外层容器已经承担边界。如果树直接放在页面上并需要成为可识别的独立区块，应显式使用：

```ts
const standaloneTree = new RenderTreeView({
  roots,
  appearance: 'framed',
})
```

`framed` 绘制主题面板边框并使用树的圆角裁剪；`flush` 保留数据区背景和内部交互状态，但不绘制外边框。两种模式的布局和命中区域一致。

## 方法

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `focusIn()` | `void` | 通知组件获得焦点。整体 disabled 或 invisible 时不生效。 |
| `focusOut()` | `void` | 通知组件失去焦点。 |
| `getCopyText()` | `string \| null` | 获取当前选中节点或焦点节点的复制文本。整体 disabled 或 `copyable=false` 时返回 null。 |
| `onContextMenu(position)` | `boolean` | 从全局 Canvas 坐标请求节点菜单；无回调、未命中或回调拒绝时返回 false。 |
| `debugState()` | `TreeViewDebugState` | 获取滚动、焦点、hover、勾选和真实绘制节点目标。 |
| `revealSelectedKey()` | `void` | 将当前 `selectedKey` 对应节点滚动到可视区域。 |
| `setRoots(roots)` | `void` | 替换根节点。等价于设置 `roots` 属性。 |
| `expandAll()` | `void` | 展开所有有子节点的节点。 |
| `collapseAll()` | `void` | 折叠全部节点。 |
| `dispose()` | `void` | 释放焦点注册、滚动状态和回调引用。 |

`debugState()` 返回字段：

| 字段 | 说明 |
| --- | --- |
| `scrollY` | 当前纵向滚动偏移。 |
| `focusedIndex` | 当前键盘焦点行索引。 |
| `hoveredKey` | 当前 hover 节点 key。 |
| `totalContentH` | 全部扁平节点总高度。 |
| `rowHeight` | 当前行高。 |
| `indentWidth` | 当前缩进宽度。 |
| `checkedKeys` | 当前勾选 key。 |
| `halfCheckedKeys` | 当前半选 key。 |
| `visibleNodes` | 最后一次真实 paint 中与内容 viewport 相交且可命中的节点 `{ key, rect }[]`。layout、滚动、roots、展开、主题、位置、可见性、disabled、detach 或 dispose 后在下一次真实 paint 前为空。 |

## 事件与回调

| 回调 | 触发时机 | 参数说明 |
| --- | --- | --- |
| `onSelect(node)` | 单选模式下节点被选中 | `selectable=false` 的节点不会触发。 |
| `onExpand(node, expanded)` | 节点展开或折叠后 | `expanded=true` 表示展开。 |
| `onActivate(node)` | 节点被激活后 | 当前实现主要由 `Enter` 触发。 |
| `onCheck(payload)` | 勾选状态变化后 | payload 包含勾选、半选的 key 和节点。 |
| `onContextMenuRequest(request)` | pointer 右键、`ContextMenu` 或 `Shift+F10` 命中节点 | request 包含 `node`、全局 `position` 和 `'pointer' \| 'keyboard'` source。 |

`TreeCheckChange<T>`：

| 字段 | 说明 |
| --- | --- |
| `checkedKeys` | 当前勾选 key。 |
| `halfCheckedKeys` | 当前半选 key。 |
| `checkedNodes` | 当前勾选节点。 |
| `halfCheckedNodes` | 当前半选节点。 |
| `toggledNode` | 本次被切换的节点。 |

## 单选和勾选模型

`selectionMode='single'`：

- 点击可选择节点会更新 `selectedKey` 并触发 `onSelect`。
- 点击展开箭头只展开折叠，不改变选择。
- `selectable=false` 的父节点点击时会展开折叠。
- `Space` 可选择当前焦点节点。
- `Enter` 触发 `onActivate`。

`selectionMode='check'`：

- 行内显示复选框。
- 点击复选框或按 `Space` 切换勾选。
- 勾选父节点会切换它下面的可勾选叶子目标。
- 子节点部分勾选时，父节点进入半选状态。
- `checkable=false` 的节点不会作为勾选目标。

## 键盘、鼠标和滚动

- `ArrowDown` / `ArrowUp`：移动焦点行。
- `ArrowRight`：展开当前节点；如果已展开，则移动到第一个子节点。
- `ArrowLeft`：折叠当前节点；如果已折叠，则移动到父节点。
- `Space`：单选模式下选中当前节点；复选模式下切换勾选。
- `Enter`：激活当前节点。
- `ContextMenu` / `Shift+F10`：对当前焦点节点请求上下文菜单；成功时才消费按键。
- 鼠标点击节点行会设置焦点。
- 鼠标点击展开箭头会展开或折叠。
- 鼠标滚轮按固定步长滚动，滚到底部或顶部后返回是否仍可滚动，便于外层滚动容器判断是否接管。
- 拖动垂直滚动条会更新 `scrollY` 并触发重绘。
- 整体 `disabled = true` 时，树不会接收焦点，不响应选择、勾选、展开、激活、滚轮、滚动条拖动或复制。

## 文本省略和 tooltip

TreeView 会按可用宽度绘制单行文本：

- 文本能完整显示时，不自动设置 tooltip。
- 文本被省略时，如果节点设置了 `tooltip`，显示 `tooltip`。
- 文本被省略且未设置 `tooltip` 时，显示完整 `label`。
- 使用 `labelTokens` 时，tooltip 仍以 `tooltip` 或 `label` 为准。

这适合文档目录、对象查看器、模板树等长文本场景。

## 虚拟滚动和大树

TreeView 会把当前展开状态下的节点扁平化为可视节点列表，然后使用固定行高虚拟范围计算，只绘制视窗附近的节点。

性能边界：

- 替换 `roots` 会重建扁平节点、勾选状态和滚动约束。
- selection 的有效性按完整 roots 递归检查；节点仅因祖先折叠而离开扁平可视列表时仍保留，真实删除或变为不可选时才清空。
- `expandAll()` 会一次性展开所有节点，大树上会显著增加扁平节点数量。
- 大树场景不要在 hover、滚动、输入时反复创建新的 `roots` 数组。
- 异步加载子节点后，优先局部更新业务节点，再调用 `setRoots()` 或设置 `roots` 触发同步。
- 节点 `key` 必须稳定，否则展开、选中、勾选状态无法延续。

## 常见组合

- TreeView + MarkdownViewer：左侧文档树，右侧 [MarkdownViewer](../visualization/markdown-viewer.md)。
- TreeView + 详情面板：选中节点后右侧显示表单、图表或 [DataGrid](./data-grid.md)。
- TreeView + DropTreeEdit：维护页面使用 TreeView，表单选择使用 [DropTreeEdit](../selector/drop-tree-edit.md)。
- TreeView + TreeGrid：单列树用 TreeView，多列树用 [TreeGrid](./tree-grid.md)。
- TreeView + ObjectInspector：对象查看器可复用树的展开、虚拟滚动和复制思路，但业务不应直接把 ObjectInspector 写成普通 TreeView 示例。

## 相关组件

- [TreeGrid 树表](./tree-grid.md)：多列树形数据。
- [DataGrid 数据表格](./data-grid.md)：普通二维表格。
- [ListView 列表](./list-view.md)：单列列表。
- [DropTreeEdit 树形下拉](../selector/drop-tree-edit.md)：弹出树选择。
- [DropCheckTreeEdit 树形多选下拉](../selector/drop-check-tree-edit.md)：弹出树多选。
- [DropTreeGridEdit 树表下拉](../selector/drop-tree-grid-edit.md)：弹出树表选择。
- [MarkdownViewer](../visualization/markdown-viewer.md)：文档树常见搭配组件。
- [Runtime Diagnostics](../../lifecycle.md)：调试布局、绘制和事件。
