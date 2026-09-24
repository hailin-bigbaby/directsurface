# TreeGrid 树表

> **通用布局能力**：`TreeGridOptions` 继承 `RenderBoxOptions`，树表可直接配置 `width`、`height`、min/max、`margin` 和槽位对齐；原有独立高度状态已经移除。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderTreeGrid` 用于展示树形层级数据，并在每个节点上呈现多列字段。它处在 [TreeView](./tree-view.md) 和 [DataGrid](./data-grid.md) 之间：既有树的展开折叠、节点选择、勾选半选，也有表格的列宽、排序、过滤、编辑、复制和虚拟滚动。

## 何时使用

- 目录、部门、模板、项目、权限、菜单等分层数据需要多列展示。
- 节点需要展开折叠，同时每行有编码、状态、类型、备注等字段。
- 节点需要单选或复选，并且父子节点要呈现半选状态。
- 树节点需要支持单元格编辑、下拉编辑、日期编辑或树表下拉编辑。
- 大量节点需要虚拟滚动，只绘制可视节点。

## 何时不要使用

- 只有单列 label 和图标，优先使用 [TreeView](./tree-view.md)。
- 没有层级结构，只是普通二维表格，优先使用 [DataGrid](./data-grid.md)。
- 只是静态表格展示，优先使用 [Table](./table.md)。
- 只是弹出树表选择，优先使用 [DropTreeGridEdit](../selector/drop-tree-grid-edit.md)。

## API 总览

```ts
import {
  RenderTreeGrid,
  type GridCellStyleOverride,
  type GridCellTextOverflow,
  type GridColumnDef,
  type GridColumnEditorDef,
  type GridRowStyleOverride,
  type GridSortState,
  type TreeGridCell,
  type TreeGridCellDisplayTextArgs,
  type TreeGridCheckChange,
  type TreeGridNode,
  type TreeGridNodeInput,
  type TreeGridOptions,
  type TreeGridSelectionMode,
  type TreeGridSelectionState,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderTreeGrid<T>` | class | 多列树表，结合树的展开/勾选和 DataGrid 的列、过滤、排序、编辑。 |
| `TreeGridOptions<T>` | type | 构造参数。 |
| `TreeGridNode<T>` | type | 树表节点配置，保存稳定 key、row 和 children。 |
| `TreeGridNodeInput<T>` | type | 定位节点的输入类型，支持节点、row、key、索引或 null。 |
| `TreeGridCell<T>` | type | 当前焦点或编辑单元格标识。 |
| `TreeGridSelectionMode` | type | 选择模式：`single` 或 `check`。 |
| `TreeGridSelectionState<T>` | type | 完整选择和勾选状态快照。 |
| `TreeGridCheckChange<T>` | type | 勾选变化回调 payload。 |
| `TreeGridCellDisplayTextArgs<T>` | type | `getCellDisplayText` 回调参数，包含默认显示文本和单元格上下文。 |
| `GridColumnDef<T>` / `GridColumnEditorDef<T>` | type | 复用 DataGrid 的列和编辑器配置。 |

最小装配顺序是：准备 `GridColumnDef<T>[]` 和稳定 key 的 `TreeGridNode<T>[]`，指定 `treeColumnKey`，再创建 `RenderTreeGrid<T>`。树形列必须存在于 columns 中，否则组件会回退到有效列。

## 最小示例

```ts
import { RenderTreeGrid, type GridColumnDef, type TreeGridNode } from 'ds-ui'

interface TemplateRow {
  name: string
  code: string
  category: string
}

const treeGridColumns: GridColumnDef<TemplateRow>[] = [
  { key: 'name', title: '名称', type: 'text', width: 220 },
  { key: 'code', title: '编码', type: 'text', width: 100 },
  { key: 'category', title: '分类', type: 'text', width: 120 },
]

const templateRoots: TreeGridNode<TemplateRow>[] = [
  {
    key: 'root',
    icon: 'folder',
    row: { name: '文档模板', code: 'ROOT', category: '目录' },
    children: [
      { key: 'admission', icon: 'document', row: { name: '开始记录', code: 'DOC001', category: '文书' } },
    ],
  },
]

const treeGrid = new RenderTreeGrid<TemplateRow>({
  columns: treeGridColumns,
  roots: templateRoots,
  treeColumnKey: 'name',
  defaultExpandAll: true,
  onSelect: node => {
    console.log(node.key, node.row.name)
  },
})
```


## 构造参数

`new RenderTreeGrid<T>(options: TreeGridOptions<T>)`

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `columns` | `GridColumnDef<T>[]` | 必填 | 表格列定义。字段结构和 [DataGrid](./data-grid.md) 一致。 |
| `roots` | `TreeGridNode<T>[]` | 必填 | 根节点数组。 |
| `treeColumnKey` | `keyof T & string` | 必填 | 展开箭头、缩进、复选框、图标和主文本所在列。 |
| `selectionMode` | `'single' \| 'check'` | `'single'` | 选择模式。`single` 为单选，`check` 为复选。 |
| `checkedKeys` | `readonly string[]` | `undefined` | 受控或初始化勾选 key。优先级高于 `defaultCheckedKeys`。 |
| `defaultCheckedKeys` | `readonly string[]` | `[]` | 非受控初始勾选 key。 |
| `defaultExpandedKeys` | `readonly string[]` | `[]` | 初始展开节点 key。 |
| `defaultExpandAll` | `boolean` | `false` | 是否初始展开所有有子节点的节点。 |
| `rowHeight` | `number` | viewport 默认值 | 行高。 |
| `headerHeight` | `number` | viewport 默认值 | 表头高度。 |
| `width` / `height` | `number` | `undefined` | 来自 `RenderBoxOptions` 的期望尺寸。 |
| `minWidth` / `maxWidth` | `number` | `undefined` | 水平方向尺寸边界。 |
| `minHeight` / `maxHeight` | `number` | `undefined` | 垂直方向尺寸边界。 |
| `margin` | `EdgeInsetsInput` | `0` | 组件外部留白。 |
| `horizontalAlignment` / `verticalAlignment` | `BoxAlignment` | `undefined` | 组件在父布局槽位中的对齐方式。 |
| `reserveScrollbars` | `boolean` | viewport 默认值 | 是否预留滚动条空间。 |
| `sortable` | `boolean` | `true` | 是否允许点击表头排序。 |
| `resizableColumns` | `boolean` | `true` | 是否允许拖拽列宽。 |
| `editable` | `boolean` | `false` | 是否允许单元格编辑。列仍需满足可编辑条件。 |
| `cellTextOverflow` | `'clip' \| 'ellipsis'` | `'ellipsis'` | 单元格文本溢出策略。 |
| `getCellDisplayText` | `(args) => string \| null \| undefined` | `undefined` | 自定义单元格显示文本。 |
| `copyable` | `boolean` | `true` | 是否允许框架复制当前节点或当前单元格文本。 |
| `copyText` | `(node, column) => string \| null \| undefined` | `undefined` | 自定义复制文本。 |
| `resolveRowStyle` | `(args) => GridRowStyleOverride \| null \| undefined` | `undefined` | 自定义行样式。 |
| `resolveCellStyle` | `(args) => GridCellStyleOverride \| null \| undefined` | `undefined` | 自定义单元格样式。 |
| `onCellChange` | `(node, key, value) => void` | `undefined` | 单元格提交后触发。 |
| `onSelect` | `(node) => void` | `undefined` | 节点被单选选中后触发。 |
| `onActivate` | `(node) => void` | `undefined` | 节点被激活后触发。 |
| `onExpand` | `(node, expanded) => void` | `undefined` | 节点展开或折叠后触发。 |
| `onCheck` | `(payload) => void` | `undefined` | 勾选状态变化后触发。 |

## 节点配置

`TreeGridNode<T>`：

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `key` | `string` | 必填 | 节点唯一 key。展开、选择、勾选、定位都依赖它。 |
| `row` | `T` | 必填 | 节点绑定的行数据。列的 `key` 从 `row` 取值。 |
| `children` | `TreeGridNode<T>[]` | `undefined` | 子节点。存在子节点时显示展开箭头。 |
| `icon` | `string` | `undefined` | 节点图标。内置 `IconName` 使用统一 icon painter，其他字符串保留 emoji 或单字符回退。 |
| `selectable` | `boolean` | `true` | 是否允许单选选中。`false` 时点击有子节点的行会优先展开折叠。 |
| `checkable` | `boolean` | `true` | 是否允许复选。`false` 时复选模式下不会切换该节点。 |

`key` 必须稳定。业务刷新节点时，如果 key 改变，展开、选中、勾选状态都会被视为新节点。

## 列配置

TreeGrid 复用 [DataGrid 列配置](./data-grid.md#列配置)，支持：

- `text`
- `number`
- `checkbox`
- `select`
- `select-grid`
- `date`
- `time`
- `custom`

TreeGrid 也支持 `editor: GridColumnEditorDef` 覆盖默认编辑器。编辑器配置见 [DataGrid 编辑器配置](./data-grid.md#编辑器配置)。

TreeGrid 的特殊点：

- `treeColumnKey` 对应的列会绘制缩进、展开箭头、复选框和图标。
- 其他列按普通 DataGrid 单元格绘制。
- 固定列、列宽、文本溢出、编辑器类型都沿用 DataGrid 的列语义。
- `time` 列的 `precision` 同时约束显示、提交、排序和过滤文本。分钟精度会先去掉秒，再参与这些操作。
- `date` 列使用 DataGrid 的日期弹层和值转换规则；`showTime:true` 时的本地 ISO、带时区 ISO、`Date` 和时间戳语义见 [DataGrid 日期与时间列的值语义](./data-grid.md#日期与时间列的值语义)。

## 可读写属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `editable` | `boolean` | 是否允许编辑。 |
| `width` / `height` | `number \| undefined` | 期望尺寸。赋值后请求 layout。 |
| `minWidth` / `maxWidth` | `number \| undefined` | 水平方向尺寸边界。赋值后请求 layout。 |
| `minHeight` / `maxHeight` | `number \| undefined` | 垂直方向尺寸边界。赋值后请求 layout。 |
| `margin` | `EdgeInsets` | 组件外部留白。赋值后请求 layout。 |
| `horizontalAlignment` / `verticalAlignment` | `BoxAlignment \| undefined` | 组件在父布局槽位中的对齐方式。 |
| `cellTextOverflow` | `GridCellTextOverflow` | 单元格文本溢出策略。 |
| `columns` | `GridColumnDef<T>[]` | 获取或替换列。替换后会重置列宽并校正 tree column。 |
| `roots` | `TreeGridNode<T>[]` | 获取或替换根节点。替换后会清理无效展开状态并重建可视节点。 |
| `treeColumnKey` | `keyof T & string` | 树形列 key。设置不存在的 key 时会回退到有效列。 |
| `selectionMode` | `TreeGridSelectionMode` | 当前选择模式。切换模式会结束编辑。 |
| `sortState` | `GridSortState` | 当前排序状态。 |
| `filterValues` | `ReadonlyMap<string, string>` | 只读过滤行文本状态。 |
| `expandedKeys` | `string[]` | 展开的节点 key。设置时会过滤不存在的 key。 |
| `selectedKey` | `string` | 当前单选节点 key。设置时会自动展开祖先并滚动到节点。 |
| `checkedKeys` | `string[]` | 当前叶子勾选 key。设置后会重新计算全选和半选。 |
| `halfCheckedKeys` | `string[]` | 只读半选 key。 |
| `editingCell` | `(TreeGridCell<T> & { text: string }) \| null` | 只读当前编辑单元格。 |
| `isFocused` | `boolean` | 只读焦点状态。 |

## 方法

### 焦点和复制

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `focusIn()` | `void` | 通知获得焦点，通常由焦点系统调用。 |
| `focusOut()` | `void` | 通知失去焦点。 |
| `getCopyText()` | `string \| null` | 获取当前节点或当前单元格复制文本。`copyable=false` 时返回 `null`。 |

### 过滤

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `setFilterValue(key, value)` | `boolean` | 设置某列过滤文本。返回是否发生变化。 |
| `clearAllFilters()` | `boolean` | 清除所有过滤文本。返回是否发生变化。 |

过滤采用“所有活跃列过滤都匹配”的规则。匹配时会保留命中的节点以及它的祖先路径。`time` 列按当前 `precision` 的规范显示文本匹配：分钟精度只匹配 `HH:mm`，原始值中被截断的秒不会单独参与过滤；排序也使用同一精度的时间比较值。

### 可视数据和选择

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `getVisibleNodes()` | `readonly TreeGridNode<T>[]` | 获取当前过滤、排序、展开后的可视节点。 |
| `getVisibleRows()` | `readonly T[]` | 获取当前可视节点对应的行数据。 |
| `getSelectionState()` | `TreeGridSelectionState<T>` | 获取完整选择和勾选状态。 |
| `getSelectedNode()` | `TreeGridNode<T> \| null` | 获取当前选中节点。 |
| `getSelectedRow()` | `T \| null` | 获取当前选中节点的 row。 |
| `getFocusedNode()` | `TreeGridNode<T> \| null` | 获取当前焦点节点。 |
| `getFocusedRow()` | `T \| null` | 获取当前焦点节点的 row。 |
| `getFocusedColumn()` | `GridColumnDef<T> \| null` | 获取当前焦点列。 |
| `getFocusedKey()` | `keyof T & string \| null` | 获取当前焦点列 key。 |
| `getFocusedCell()` | `TreeGridCell<T> \| null` | 获取当前焦点单元格。 |
| `focusRow(row, options?)` | `boolean` | 聚焦某行或节点。 |
| `focusCell(row, column, options?)` | `boolean` | 聚焦某个单元格。 |
| `selectNode(node)` | `boolean` | 选中节点、节点 key，或传 `null` 清空选择。 |

`TreeGridNodeInput<T>` 可为：

- `TreeGridNode<T>`
- `T`
- `string`
- `number`
- `null`

其中 `string` 按节点 key 解析，`number` 按可视节点索引解析，`T` 按 row 对象解析。

### 编辑

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `beginEdit(row, column)` | `boolean` | 开始编辑。`row` 支持 `TreeGridNodeInput`；`column` 支持列 key 或列索引。 |
| `commitEdit()` | `void` | 提交当前编辑。 |
| `cancelEdit()` | `void` | 取消当前编辑。 |
| `setCellValue(row, key, value)` | `boolean` | 设置节点单元格值。可见行和非可见节点都支持。 |
| `refreshNode(row)` | `boolean` | 刷新指定节点。 |
| `refreshData()` | `void` | 重新索引节点、计算勾选状态、同步可视节点并重绘。 |
| `refreshLookup(columnKey?)` | `boolean` | 重建指定 Lookup 列或全部 Lookup 列的值索引并刷新显示；没有匹配列时返回 `false`。 |

### 展开折叠

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `expandAll()` | `void` | 展开所有有子节点的节点。 |
| `collapseAll()` | `void` | 折叠所有节点。 |
| `revealNode(key)` | `void` | 展开目标节点祖先并滚动到该节点。 |

### 调试和释放

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `debugState()` | 对象 | 返回可视 key、滚动、焦点、选中、勾选、编辑状态。 |
| `dispose()` | `void` | 释放编辑器、弹出编辑器和焦点注册。 |

## 事件与回调

| 回调 | 触发时机 | 参数说明 |
| --- | --- | --- |
| `onCellChange(node, key, value)` | 单元格提交后 | `node` 是树节点；`key` 是列 key；`value` 是新值。 |
| `onSelect(node)` | 单选模式下节点被选中 | `selectable=false` 的节点不会触发选中。 |
| `onActivate(node)` | 双击或 Enter 激活节点 | 如果可编辑且能进入编辑，会优先编辑；否则触发激活。 |
| `onExpand(node, expanded)` | 节点展开或折叠后 | `expanded=true` 表示展开。 |
| `onCheck(payload)` | 复选状态变化后 | payload 包含 checked、halfChecked 的 key 和节点。 |

`TreeGridCheckChange<T>` 字段：

| 字段 | 说明 |
| --- | --- |
| `checkedKeys` | 当前勾选 key。 |
| `halfCheckedKeys` | 当前半选 key。 |
| `checkedNodes` | 当前勾选节点。 |
| `halfCheckedNodes` | 当前半选节点。 |
| `toggledNode` | 本次被切换的节点。 |

## 选择和勾选模型

`selectionMode='single'`：

- 点击可选择节点会更新 `selectedKey`。
- `Space` 可选择当前焦点节点。
- `Enter` 优先编辑，不能编辑时触发 `onActivate`。
- `selectable=false` 的父节点点击时优先展开折叠。

`selectionMode='check'`：

- 树形列会显示复选框。
- 点击复选框或按 `Space` 可切换勾选。
- 父节点勾选会影响可勾选子节点。
- 子节点部分勾选时父节点进入半选状态。
- `checkable=false` 的节点不会直接切换。

## 键盘、鼠标和滚动

- `ArrowDown` / `ArrowUp`：移动焦点节点。
- `ArrowRight`：优先移动到下一列；在树形列上可展开或进入子节点。
- `ArrowLeft`：优先移动到上一列；在树形列上可折叠或回到父节点。
- `Space`：单选模式下选择节点；复选模式下切换勾选。
- `Enter`：优先进入编辑；不能编辑时触发激活。
- `F2`：进入编辑。
- `Tab` / `Shift+Tab`：在可编辑单元格之间移动。
- 鼠标拖拽列边界调整列宽。
- 鼠标滚轮滚动可视节点，横向滚轮滚动列区域。
- hover 到溢出文本上会显示完整 tooltip。

## 编辑行为

TreeGrid 复用 DataGrid 的列编辑能力：

- 文本列使用文本输入。
- 数字列使用数字输入。
- time 列使用 `HH:mm` 或 `HH:mm:ss` 的纯时间输入；提交值与显示、排序和过滤使用同一 `precision`。
- checkbox 列支持布尔切换。
- select、lookup、date、drop-tree、drop-tree-grid 等列会打开对应 popup 编辑器。`date + showTime` 会把 `Z`、offset、`Date` 和毫秒时间戳换算成本地字段显示，确认后统一写回不带时区的本地 ISO 字符串；本地 ISO 输入保持其字面日期和时刻。

编辑提交流程：

1. 进入编辑后，编辑器维护临时文本或临时值。
2. 提交时通过内部结构编辑控制器写入节点 row。
3. 写入成功后触发 `onCellChange(node, key, value)`。
4. 业务方可在回调中同步外部状态、发请求或标记脏数据。

## 样式和显示文本

`getCellDisplayText(args)` 用于自定义单元格文本，不改变 row 值。

`TreeGridRowStyleArgs<T>` 字段：

| 字段 | 说明 |
| --- | --- |
| `node` | 当前树节点。 |
| `row` | 当前节点 row。 |
| `theme` | 当前生效的 `ResolvedTheme`。 |
| `backgroundColor` | 当前状态已经解析出的基础背景色；单元格回调中会反映行或编辑背景。 |
| `rowIndex` | 数据行索引。 |
| `sourceRowIndex` | 源节点索引。 |
| `itemIndex` | 可视节点索引。 |
| `selected` | 是否选中。 |
| `hovered` | 是否 hover。 |
| `focused` | 是否焦点行。 |
| `editing` | 是否正在编辑。 |

`TreeGridCellStyleArgs<T>` 额外包含：

| 字段 | 说明 |
| --- | --- |
| `value` | 当前单元格原始值。 |
| `column` | 当前列。 |
| `colIndex` | 当前列索引。 |

自定义颜色必须结合 `theme` 和 `backgroundColor` 处理选中态与明暗主题；推荐使用 `resolveContrastText(theme, backgroundColor, preferredColor)`，不要固定返回只适用于某个主题的 RGB。

样式返回值复用 `GridRowStyleOverride` 和 `GridCellStyleOverride`：

- `backgroundColor`
- `textColor`
- `borderColor`
- `fontSize`
- `fontFamily`
- `align`，仅单元格样式支持

## 状态表现

- 展开节点显示展开箭头。
- 折叠节点显示折叠箭头。
- hover 行显示 hover 背景。
- selected 行显示选中背景。
- focused 行和 focused cell 会有焦点表现。
- editing cell 绘制输入状态。
- check 模式显示 checked、unchecked、half-checked 三态复选框。
- 文本溢出时按 `cellTextOverflow` 裁剪或省略。

## 性能原则

- 每个 TreeGrid 实例独立维护 Lookup 列的值索引，单元格显示、复制和过滤不会反复遍历完整候选数组。
- 替换 Lookup 候选数组、改变数组长度或替换列配置时索引自动更新；同长度原地修改候选键后调用 `refreshLookup(columnKey)`。

- TreeGrid 会维护可视节点列表，绘制时只绘制当前视窗内的可视行。
- `roots`、`columns` 替换会重建索引和可视节点。大数据场景不要在 hover 或输入时反复重建。
- `getCellDisplayText`、`resolveRowStyle`、`resolveCellStyle` 在可视单元格绘制时调用，必须保持轻量。
- 过滤会递归判断节点并保留命中路径；超大树建议业务层做服务端过滤或延迟过滤。
- `defaultExpandAll` 在大树上会一次性展开全部节点，可能导致可视索引很多；大数据建议只展开首层或使用 `revealNode()` 定位。
- 节点 `key` 必须稳定，否则展开、选择、勾选状态无法复用。

## 常见组合

- TreeGrid + 右侧详情：左侧 TreeGrid 选节点，右侧用表单或 [DataGrid](./data-grid.md) 展示明细。
- TreeGrid + 命令工具栏：用 [CommandToolbar](../command/command-toolbar.md) 管理新增同级、添加子级、删除、刷新。
- TreeGrid + 弹窗编辑：双击节点后打开 [Modal](../overlay/modal.md) 或 [Drawer](../overlay/drawer.md) 编辑详情。
- TreeGrid + DropTreeGridEdit：维护页使用 TreeGrid，表单选择字段使用 [DropTreeGridEdit](../selector/drop-tree-grid-edit.md)。

## 相关组件

- [TreeView 树组件](./tree-view.md)：单列树。
- [DataGrid 数据表格](./data-grid.md)：普通二维表格。
- [DropTreeGridEdit 树表下拉](../selector/drop-tree-grid-edit.md)：弹出树表选择。
- [DropTreeEdit 树形下拉](../selector/drop-tree-edit.md)：弹出单列树选择。
- [Table 静态表格](./table.md)：静态数据展示。
- [CommandToolbar 命令工具栏](../command/command-toolbar.md)：树表操作区。
- [Runtime Diagnostics](../../lifecycle.md)：调试布局、绘制和事件。
