# Table 表格

> **通用布局能力**：`RenderTable` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；原有独立高度状态已经并入 `RenderBox` 契约。详见[组件通用布局属性](../common-layout-properties.md)。


DirectSurface UI 的轻量表格公共类名是 `RenderTable`。它用于展示结构稳定的二维数据，支持表头、固定/弹性列宽、列排序、行 hover、行选择、范围选择、键盘选择、列宽拖拽、横纵滚动条、固定行高虚拟绘制、单元格文本省略和溢出 tooltip。

`RenderTable` 面向“轻量展示表格”。需要单元格编辑、筛选、列菜单、分组、汇总、复杂选择和值域编辑时，使用 [DataGrid](./data-grid.md) 中的 `RenderDataGrid`。

## API 总览

```ts
import {
  RenderTable,
  resolveContrastText,
  type SortOrder,
  type TableCellColorContext,
  type TableColumn,
  type TableSortOrder,
  type TableSortState,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderTable<T>` | class | 轻量只读二维表，支持表头、排序、选择、滚动、列宽拖拽和虚拟绘制。 |
| `TableCellColorContext` | type | 自定义文字颜色上下文，包含当前主题、实际行背景和交互状态。 |
| `TableColumn<T>` | type | 列配置，定义 key、title、宽度、对齐、排序和显示文本。 |
| `TableSortState` | type | 当前排序列和排序方向。 |
| `TableSortOrder` / `SortOrder` | type | 排序方向类型。 |

最小装配顺序是：准备 `TableColumn<T>[]` 和 `rows: T[]`，创建 `RenderTable<T>`。选择模型基于排序后的可见行索引，不基于业务 row id；需要按业务 key 维护复杂选择时使用 `RenderDataGrid`。

## 何时使用

- 小型或中型只读数据表。
- 分析结果、状态清单、说明性二维信息。
- 只需要行选择、点击、排序和简单自定义文本颜色。
- 行高固定，适合虚拟绘制可视行。
- 表格结构稳定，不需要单元格编辑。

不适合：

- 需要编辑单元格、校验、下拉、日期、lookup 等表格编辑能力。
- 需要列冻结、列菜单、复杂筛选、分组、汇总或树形多列。
- 每行高度不同，或单元格内容是复杂组件。
- 需要按业务 key 维护选择。`RenderTable` 的选择是可见行索引模型。

## 最小示例

```ts
import { RenderTable, type TableColumn } from 'ds-ui'

interface ProjectRow {
  id: number
  name: string
  stars: number
}

const projectRows: ProjectRow[] = [
  { id: 1, name: 'DirectSurface UI', stars: 1280 },
  { id: 2, name: 'General Editor', stars: 860 },
]

const projectColumns: TableColumn<ProjectRow>[] = [
  { key: 'id', title: 'ID', width: 64, align: 'center', sortable: true },
  { key: 'name', title: '名称', sortable: true },
  { key: 'stars', title: 'Stars', width: 100, align: 'right' },
]

const table = new RenderTable<ProjectRow>({
  columns: projectColumns,
  rows: projectRows,
  onRowClick: (row, index) => {
    state.selectedProject = `${index}:${row.name}`
  },
})
```

## 构造参数

`new RenderTable(options)` 的 `options`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `columns` | `TableColumn<T>[]` | 必填 | 列配置。 |
| `rows` | `T[]` | 必填 | 行数据。 |
| `rowHeight` | `number` | 主题 `dataRowHeight` | 行高。未传时随主题重新 layout。 |
| `headerHeight` | `number` | 主题 `dataHeaderHeight` | 表头高度。未传时随主题重新 layout。 |
| `width` / `height` | `number` | `undefined` | 来自 `RenderBoxOptions` 的期望尺寸。 |
| `minWidth` / `maxWidth` | `number` | `undefined` | 水平方向尺寸边界。 |
| `minHeight` / `maxHeight` | `number` | `undefined` | 垂直方向尺寸边界。 |
| `margin` | `EdgeInsetsInput` | `0` | 组件外部留白。 |
| `horizontalAlignment` / `verticalAlignment` | `BoxAlignment` | `undefined` | 组件在父布局槽位中的对齐方式。 |
| `cellTextOverflow` | `'clip' \| 'ellipsis'` | `'ellipsis'` | 默认单元格文本溢出策略。 |
| `onRowClick` | `(row, index) => void` | `undefined` | 点击可见行时触发。 |
| `onSortChange` | `(sort) => void` | `undefined` | 点击 sortable 表头改变排序时触发。 |

```ts
import { RenderTable, type TableColumn } from 'ds-ui'

interface ProjectRow {
  id: number
  name: string
  stars: number
}

const projectColumns: TableColumn<ProjectRow>[] = [
  { key: 'id', title: 'ID', width: 64, align: 'center', sortable: true },
  { key: 'name', title: '名称', sortable: true },
  { key: 'stars', title: 'Stars', width: 100, align: 'right' },
]

const projectRows: ProjectRow[] = [
  { id: 1, name: 'DirectSurface UI', stars: 1280 },
  { id: 2, name: 'General Editor', stars: 860 },
]

const compactTable = new RenderTable<ProjectRow>({
  columns: projectColumns,
  rows: projectRows,
  rowHeight: 24,
  headerHeight: 28,
  maxHeight: 360,
  cellTextOverflow: 'ellipsis',
})
```

## TableColumn

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `key` | `string` | 列 key。默认从 `row[key]` 取值，也用于排序字段。 |
| `title` | `string` | 表头文本。 |
| `width` | `number` | 固定列宽。不传则参与弹性平均分配。 |
| `minWidth` | `number` | 拖拽调整列宽时的最小宽度，默认下限为 `40`。 |
| `align` | `'left' \| 'center' \| 'right'` | 单元格文本对齐。默认 `'left'`。 |
| `cellTextOverflow` | `'clip' \| 'ellipsis'` | 覆盖当前列的文本溢出策略。 |
| `sortable` | `boolean` | 是否允许点击表头排序。 |
| `render` | `(value, row, rowIndex) => string` | 自定义单元格显示文本。 |
| `renderColor` | `(value, row, context) => Color` | 自定义单元格文字颜色；context 提供主题、实际背景、行列索引和选中/悬浮/焦点状态。旧的两参数回调仍兼容。 |

```ts
import { resolveContrastText, type TableColumn } from 'ds-ui'

interface ProjectRow {
  id: number
  name: string
  stars: number
}

const scoreColumns: TableColumn<ProjectRow>[] = [
  {
    key: 'name',
    title: '项目',
    minWidth: 120,
    cellTextOverflow: 'ellipsis',
  },
  {
    key: 'stars',
    title: 'Stars',
    width: 96,
    align: 'right',
    sortable: true,
    render: value => Number(value).toLocaleString(),
    renderColor: (value, _row, { theme, backgroundColor }) => resolveContrastText(
      theme,
      backgroundColor,
      Number(value) > 1000 ? theme.accentSuccess : theme.textSecondary,
    ),
  },
]
```

`TableCellColorContext` 包含 `theme`、`backgroundColor`、`rowIndex`、`columnKey`、`columnIndex`、`selected`、`hovered` 和 `focused`。当前行仍由 `renderColor` 的第二个参数提供。自定义状态色应结合 `backgroundColor` 使用 `resolveContrastText()`，不要返回只适用于单一明暗主题的固定浅色。

未设置 `width` 的列会平均分配剩余宽度，且单列弹性宽度不小于 `60`。总列宽超过视口宽度时显示水平滚动条。

## 属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `columns` | `TableColumn<T>[]` | 当前列配置。赋值会重置列宽拖拽状态并同步排序状态。 |
| `rows` | `T[]` | 当前行数据。赋值会夹取滚动、hover、focus 和选择范围。 |
| `sortState` | `TableSortState` | 当前排序状态。赋值会校验列是否存在且 sortable。 |
| `width` / `height` | `number \| undefined` | 期望尺寸。赋值后请求 layout。 |
| `minWidth` / `maxWidth` | `number \| undefined` | 水平方向尺寸边界。赋值后请求 layout。 |
| `minHeight` / `maxHeight` | `number \| undefined` | 垂直方向尺寸边界。赋值后请求 layout。 |
| `margin` | `EdgeInsets` | 组件外部留白。赋值后请求 layout。 |
| `horizontalAlignment` / `verticalAlignment` | `BoxAlignment \| undefined` | 组件在父布局槽位中的对齐方式。 |
| `cellTextOverflow` | `'clip' \| 'ellipsis'` | 全局单元格文本溢出策略。 |
| `rowHeight` | `number` | 当前行高。未显式传入时由主题更新。 |
| `headerHeight` | `number` | 当前表头高度。未显式传入时由主题更新。 |
| `selectedRows` | `Set<number>` | 当前选中可见行索引集合。 |
| `onRowClick` | `(row, index) => void` | 行点击回调，可在构造后替换。 |
| `onSortChange` | `(sort) => void` | 排序变化回调，可在构造后替换。 |
| `isFocused` | `boolean` | 是否有 focused row。 |

```ts
import { RenderTable } from 'ds-ui'

interface ProjectRow {
  id: number
  name: string
  stars: number
}

const projectRows: ProjectRow[] = [
  { id: 1, name: 'DirectSurface UI', stars: 1280 },
  { id: 2, name: 'General Editor', stars: 860 },
]

const table = new RenderTable<ProjectRow>({
  columns: [
    { key: 'name', title: '名称' },
    { key: 'stars', title: 'Stars', sortable: true },
  ],
  rows: projectRows,
})

table.rows = projectRows.filter(row => row.stars > 500)
table.sortState = { key: 'stars', order: 'desc' }
table.cellTextOverflow = 'clip'
```

`selectedRows` 是公开的 `Set<number>`，但直接改它只影响集合内容，不会自动触发重绘。业务代码建议使用 `setSelectedRows()`。

## 方法

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `setSelectedRows(rows)` | `void` | 替换选中行索引集合，并触发重绘。无效索引会被忽略。 |
| `debugState()` | 对象 | 返回滚动、hover、focus、排序、行高、表头高度和列宽。 |
| `focusIn()` | `void` | 当前为空实现。焦点通常由 pointer down 设置。 |
| `focusOut()` | `void` | 清除 focused row 和范围选择。 |
| `onKeyDown(event)` | `boolean` | 处理 ArrowUp/ArrowDown、Shift 选择、Ctrl/Meta+A。 |
| `dispose()` | `void` | 注销焦点、清理滚动条 drag/hover、hover/focus 和选择范围。 |

```ts
import { RenderTable } from 'ds-ui'

const table = new RenderTable({
  columns: [{ key: 'name', title: '名称' }],
  rows: [{ name: 'DirectSurface UI' }],
})

table.setSelectedRows([0, 2, 3])
state.tableDebug = table.debugState()
```

## TableSortState

```ts
const sort: TableSortState = {
  key: 'stars',
  order: 'asc',
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `key` | `string` | 排序列 key。 |
| `order` | `'asc' \| 'desc' \| null` | 排序方向。`null` 表示不排序。 |

排序规则：

- 只有 `column.sortable === true` 的列能排序。
- 点击同一 sortable 表头按 `asc -> desc -> null` 循环。
- 点击新的 sortable 表头从 `asc` 开始。
- 设置无效列或非 sortable 列时，会归一化为 `{ key: '', order: null }`。
- 数字按数值比较；其他值用 `String(value).localeCompare(..., { numeric: true, sensitivity: 'base' })` 比较。
- 相等值保持原始顺序。

`onRowClick(row, index)` 和 `selectedRows` 中的 `index` 都是排序后的可见行索引，不是原始 `rows` 数组索引。

## debugState

`debugState()` 返回：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `scrollX` | `number` | 横向滚动偏移。 |
| `scrollY` | `number` | 纵向滚动偏移。 |
| `hoveredRow` | `number` | 当前 hover 的可见行索引。无 hover 为 `-1`。 |
| `focusedRow` | `number` | 当前键盘焦点行索引。无焦点为 `-1`。 |
| `sortState` | `TableSortState` | 当前排序状态。 |
| `rowHeight` | `number` | 当前行高。 |
| `headerHeight` | `number` | 当前表头高度。 |
| `colWidths` | `number[]` | 当前列宽，包含拖拽后的状态。 |

```ts
import { RenderTable } from 'ds-ui'

const table = new RenderTable({
  columns: [{ key: 'name', title: '名称' }],
  rows: [{ name: 'DirectSurface UI' }],
})

const tableState = table.debugState()
state.tableScrollY = tableState.scrollY
state.tableColumns = tableState.colWidths.length
```

## 布局和列宽

布局规则：

- 无限宽约束下默认宽度为 `400`。
- 无限高约束下默认高度为 `300`。
- 表头固定在顶部，不随纵向滚动滚走。
- 表体视口高度为 `size.height - headerHeight - scrollbarWidth`。
- 表体视口宽度为 `size.width - scrollbarWidth`。
- 垂直和水平滚动条区域始终预留。
- 固定宽度列按 `width` 使用。
- 未设置 `width` 的列平均分配剩余宽度，且每列至少 `60`。
- 拖拽表头列分隔线可调整该列宽度。

```ts
import { RenderTable, type TableColumn } from 'ds-ui'

interface ProjectRow {
  id: number
  name: string
  stars: number
}

const wideColumns: TableColumn<ProjectRow>[] = [
  { key: 'id', title: 'ID', width: 80 },
  { key: 'name', title: '名称', width: 180 },
  { key: 'stars', title: 'Stars', width: 140 },
]

const wideRows: ProjectRow[] = [
  { id: 1, name: 'DirectSurface UI', stars: 1280 },
  { id: 2, name: 'General Editor', stars: 860 },
]

const wideTable = new RenderTable({
  columns: wideColumns,
  rows: wideRows,
  maxHeight: 280,
})
```

拖拽列宽只存在于当前 `RenderTable` 实例的内部状态。重新设置 `columns` 会清空 `_colWidthsState`，列宽回到列配置计算结果。

## 滚动和虚拟绘制

`RenderTable` 使用固定行高虚拟绘制：

- 按 `rowHeight` 和 `scrollY` 计算可视行范围。
- 默认 overscan 为 1 行。
- 只绘制可视行和少量缓冲行。
- 横向滚动通过 `scrollX` 裁剪列内容。
- wheel 支持 `deltaY` 纵向滚动和 `deltaX` 横向滚动。
- 当表格内容溢出时，即使滚动到边界，也会消费对应方向 wheel，避免事件传给外层容器导致跳动。

这套虚拟绘制只适用于固定行高。需要可变行高或复杂单元格组件时，不应使用 `RenderTable`。

## 文本溢出和 tooltip

`cellTextOverflow` 支持：

| 值 | 行为 |
| --- | --- |
| `'ellipsis'` | 用 `ellipsizeText()` 根据文本测量结果绘制省略文本。默认值。 |
| `'clip'` | 原文绘制，但通过 cell clip 裁剪。 |

列级 `column.cellTextOverflow` 优先于表格级 `cellTextOverflow`。

hover 单元格时，如果完整文本宽度超过可用列宽，会把 `table.tooltip` 设置为完整文本。离开、滚动或取消 pointer 时会清空 tooltip。

## 鼠标行为

| 操作 | 行为 |
| --- | --- |
| 点击 sortable 表头 | 切换该列排序，触发 `onSortChange`。 |
| 点击非 sortable 表头 | 不排序。 |
| 拖拽表头列分隔线 | 调整左侧列宽，最小宽度为 `column.minWidth ?? 40`。 |
| 点击行 | 选中该行，设置 focused row，触发 `onRowClick(row, index)`。 |
| Shift + 点击行 | 从 anchor 扩展连续范围选择。 |
| Ctrl/Meta + 点击行 | 切换该行选中状态。 |
| hover 行 | 更新 hover row。 |
| hover 溢出单元格 | 显示完整文本 tooltip。 |
| 拖拽滚动条 | 捕获指针并阻止父级滚动手势。 |
| pointer leave / cancel | 清理 hover、tooltip 和滚动条状态。 |

滚动条 gutter 不会被当作表头或行处理。

## 键盘行为

键盘选择在表格已有 focused row 后生效。

| 按键 | 行为 |
| --- | --- |
| ArrowUp | 焦点移动到上一行。 |
| ArrowDown | 焦点移动到下一行。 |
| Shift + ArrowUp/Down | 扩展范围选择。 |
| Ctrl/Meta + ArrowUp/Down | 移动焦点但保留原选择。 |
| Ctrl/Meta + A | 选中全部可见行。 |

普通 ArrowUp/ArrowDown 会调用 `onRowClick(visibleRows[next], next)`，并滚动到 focused row 可见。

## 动态更新

```ts
import { RenderTable } from 'ds-ui'

interface ProjectRow {
  id: number
  name: string
  stars: number
}

const table = new RenderTable<ProjectRow>({
  columns: [
    { key: 'id', title: 'ID' },
    { key: 'name', title: '名称' },
  ],
  rows: [],
})

function applyRows(nextRows: ProjectRow[]): void {
  table.rows = nextRows
  table.setSelectedRows([])
}
```

更新 `rows` 时：

- 归一化排序状态。
- 夹取横纵滚动范围。
- hover 超出行数时清空。
- focused row 超出行数时夹到最后一行。
- 选中集合会夹取到当前行数范围内。

更新 `columns` 时：

- 重置列宽拖拽状态。
- 清空正在 resize 的列。
- 归一化排序状态。
- 请求重绘。

如果业务依赖稳定行 id，不要长期保存 `selectedRows` 的索引。排序、过滤或替换 rows 后，索引语义会变化，应由业务根据行 key 重新计算选中索引并调用 `setSelectedRows()`。

## 绘制和主题

`RenderTable` 使用 `deriveTableRowStyle(theme)` 和 `deriveScrollbarStyle(theme)`：

- 表格背景、边框、圆角。
- 表头背景、已排序表头背景、表头文本、排序箭头颜色。
- 行 normal/hovered/selected 背景。
- 奇偶行 stripe 背景。
- focused row 边框。
- 单元格分隔线和行分隔线。
- 字体、行高、表头高度、单元格 padding。
- 横纵滚动条样式。

绘制顺序：

1. 表格背景和边框。
2. 表头背景、表头 cell、标题、排序箭头、resize 指示线。
3. 表头底部分隔线。
4. 表体 clip。
5. 可视行背景、focused 边框、单元格边框、单元格文本。
6. 行分隔线。
7. 垂直滚动条和水平滚动条。

## 与 DataGrid 的区别

| 能力 | `RenderTable` | `RenderDataGrid` |
| --- | --- | --- |
| 主要用途 | 轻量展示表格 | 业务数据表格 |
| 单元格内容 | 文本和颜色 | 多类型列、编辑器、格式化、校验 |
| 编辑 | 不支持 | 支持 |
| 筛选/列菜单 | 不支持 | 支持更复杂的数据行为 |
| 选择模型 | 可见行索引 `Set<number>` | 更完整的表格选择状态 |
| 行高 | 固定 | 数据表格语义下的行布局 |
| 虚拟绘制 | 固定行高可视行 | 表格级滚动和数据能力 |
| 适合场景 | 说明表、状态表、分析表 | 业务维护、录入、查询结果 |

## 常见问题

### 为什么 onRowClick 的 index 不是原始 rows 下标？

因为表格会先根据 `sortState` 计算 visible rows。回调里的 index 是排序后的可见行索引。

### 为什么 selectedRows 在排序后指向了不同数据？

`selectedRows` 存的是可见行索引，不是业务 key。排序、过滤或替换 rows 后，业务应按行 id 重新设置选中索引。

### 为什么没有显示完整长文本？

默认 `cellTextOverflow` 是 `'ellipsis'`。hover 到溢出的单元格会显示完整 tooltip。需要直接裁剪时设置为 `'clip'`。

### 为什么列宽拖拽后重新设置 columns 又还原了？

`columns` setter 会清空内部列宽状态。拖拽列宽不是持久化配置，业务要持久化列宽时应更新自己的列配置，并重新传入带 `width` 的 columns。

### 为什么表格内容不适合放复杂组件？

`RenderTable` 直接 canvas 绘制文本，不创建单元格子组件。复杂交互内容应使用 `RenderDataGrid` 或 `RenderItemsControl` 组合。

## 相关文档

- [DataGrid](./data-grid.md)
- [TreeGrid](./tree-grid.md)
- [ListView](./list-view.md)
- [ItemsControl](./items-control.md)
- [MarkdownViewer](../visualization/markdown-viewer.md)
- 虚拟化
- 大数据表格
- [主题与状态](../../themes.md)
