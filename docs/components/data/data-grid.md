# DataGrid 数据表格

> **通用布局能力**：`DataGridOptions` 继承 `RenderBoxOptions`，表格可直接配置 `width`、`height`、min/max、`margin` 和槽位对齐，也可在创建后赋值；这些属性不再由 DataGrid 维护第二套状态。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderDataGrid` 用于展示、选择、编辑和管理结构化行列数据。它是数据类页面的主力组件，适合查询结果、明细表、可编辑表格、分组汇总、大数据虚拟滚动和列状态持久化。

## 何时使用

- 需要展示二维表格数据，并支持行选择、单元格选择或范围选择。
- 需要可编辑单元格、下拉编辑、日期编辑、树形下拉、树表下拉或校验。
- 需要排序、过滤、快速过滤、分组、汇总和列菜单。
- 需要固定列、拖拽调整列宽、列顺序调整、列显示状态持久化。
- 需要在大量数据下保持可视行绘制和滚动性能。

## 何时不要使用

- 只展示少量静态表格，优先使用 [Table](./table.md)。
- 数据有父子层级并且要在表格中展开折叠，优先使用 [TreeGrid](./tree-grid.md)。
- 只需要键值型表单布局，优先使用 [EntryGrid](./entry-grid.md) 或 FormPanel。
- 单列列表、菜单或卡片列表，优先使用 [ListView](./list-view.md) 或 [ItemsControl](./items-control.md)。

## API 总览

主类：

- `RenderDataGrid<T extends Record<string, any>>`

核心配置类型：

- `DataGridOptions<T>`
- `GridColumnDef<T>`
- `GridColumnEditorDef<T>`
- `GridSelectionState<T>`
- `GridSelectionChangeEvent<T>`
- `GridSelectionOptions`
- `GridViewPreset`
- `DataGridEditSession<T>`
- `DataGridChangeSet<T>`
- `GridDataChangeEvent<T>`

常用辅助类型：

- `GridColumnBase`
- `GridColumnText`
- `GridColumnNumber`
- `GridColumnCheckbox`
- `GridColumnSelect`
- `GridColumnSelectGrid`
- `GridColumnDate`
- `GridColumnTime`
- `GridColumnCustom`
- `GridSortDescriptor`
- `GridFilterRule`
- `GridGroupDef`
- `GridSummaryDef`
- `GridColumnState`
- `GridColumnFilterState`
- `GridCellValidationArgs`
- `GridCellValidationResult`
- `GridRowValidationArgs`
- `GridRowValidationResult`
- `GridValidationResult`
- `GridRowStyleArgs`
- `GridCellStyleArgs`
- `GridCellDisplayTextArgs`
- `GridCellContext<T>`
- `GridCellEditPolicy`
- `GridCellEditState`

这些类型都从 `ds-ui` 包入口导出。

## 最小示例

```ts
import { RenderDataGrid, type GridColumnDef } from 'ds-ui'

interface ItemRow {
  id: string
  name: string
  gender: string
  age: number
}

const columns: GridColumnDef<ItemRow>[] = [
  { key: 'name', title: '姓名', type: 'text', width: 120, sortable: true, filterable: true },
  { key: 'gender', title: '性别', type: 'select', width: 80, sortable: true, filterable: true, options: [
    { value: 'M', label: '男' },
    { value: 'F', label: '女' },
  ] },
  { key: 'age', title: '年龄', type: 'number', width: 80, align: 'right', sortable: true, filterable: true },
]

const grid = new RenderDataGrid<ItemRow>({
  rowKey: 'id',
  columns,
  rows: [
    { id: 'p1', name: 'Alice', gender: 'F', age: 36 },
  ],
  selectionMode: 'row',
  sortable: true,
  editable: true,
  onCellChange: (row, key, value) => {
    console.log('已提交单元格', row.id, key, value)
  },
})
```


## 构造参数

`new RenderDataGrid<T>(options: DataGridOptions<T>)`

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `columns` | `GridColumnDef<T>[]` | 必填 | 列定义。列的顺序决定默认显示顺序。 |
| `rows` | `T[]` | 必填 | 源数据行。排序、过滤、分组会生成可视行，但不会复制业务对象；替换 `rows` 会按重新绑定处理。 |
| `rowKey` | `keyof T & string \| (row: T) => GridRowId \| null \| undefined` | `undefined` | 可选行唯一键。默认按行对象引用识别行；只有在替换 `rows` 且行对象会被重建时，才需要 `rowKey` 用于恢复选择和校验错误。 |
| `groupBy` | `GridGroupDef<T>[]` | `[]` | 分组配置。支持多级分组。 |
| `defaultGroupExpanded` | `boolean` | `true` | 初始分组是否展开。 |
| `sort` | `GridSortDescriptor[]` | `[]` | 初始多列排序。 |
| `filters` | `GridFilterRule[]` | `[]` | 初始结构化过滤规则。 |
| `quickFilter` | `string` | `''` | 初始快速过滤文本。 |
| `summary` | `GridSummaryDef<T>[]` | `[]` | 页脚汇总定义。 |
| `dataState` | `'ready' \| 'loading' \| 'empty' \| 'error'` | `'ready'` | 数据状态。非 ready 时停止主体交互并显示状态信息。 |
| `stateMessage` | `string` | `''` | loading、empty、error 状态下显示的文本。 |
| `selectionMode` | `'row' \| 'cell' \| 'range'` | `'row'` | 选择模式。 |
| `rangeSelectionAutoScroll` | `boolean` | `true` | 范围拖选到边缘时是否自动滚动。 |
| `width` / `height` | `number` | `undefined` | 来自 `RenderBoxOptions` 的期望尺寸。 |
| `minWidth` / `maxWidth` | `number` | `undefined` | 水平方向尺寸边界。 |
| `minHeight` / `maxHeight` | `number` | `undefined` | 垂直方向尺寸边界。 |
| `margin` | `EdgeInsetsInput` | `0` | 组件外部留白。 |
| `horizontalAlignment` / `verticalAlignment` | `BoxAlignment` | `undefined` | 组件在父布局槽位中的对齐方式。 |
| `footerHeight` | `number` | 有汇总时 `28`，否则 `0` | 页脚高度。显式设置后不再随 summary 自动切换。 |
| `filterRowVisible` | `boolean` | `false` | 是否显示过滤行。 |
| `filterRowHeight` | `number` | `28` | 过滤行高度。 |
| `rowHeight` | `number` | viewport 默认值 | 数据行高度。 |
| `headerHeight` | `number` | viewport 默认值 | 表头高度。 |
| `cellTextOverflow` | `'clip' \| 'ellipsis'` | `'ellipsis'` | 单元格文本溢出策略。 |
| `validateCell` | `(args) => GridCellValidationResult` | `undefined` | 单元格提交时校验。返回 false、字符串或 `{ valid:false }` 会阻止提交。 |
| `validateRow` | `(args) => GridRowValidationResult<T>` | `undefined` | 全表验证时执行行级字段关联校验；返回以列 key 为键、错误文本为值的对象。 |
| `editorValidationMessages` | `Partial<GridEditorValidationMessages>` | 中文内置文案 | 覆盖 number、date、time 编辑器的格式错误文案；未传字段继续使用默认值。 |
| `onCellChange` | `(row, key, value) => void` | `undefined` | 单元格值提交成功后触发。通常在这里写回业务状态。 |
| `onRowClick` | `(row, event) => void` | `undefined` | 行被点击后触发。 |
| `onRowActivate` | `(row, event) => void` | `undefined` | 行被激活后触发，通常来自双击或键盘确认。 |
| `onSelectionChange` | `(event) => void` | `undefined` | 选择状态变化后触发。 |
| `onCurrentCellChange` | `(cell) => void` | `undefined` | 当前单元格变化后触发。 |
| `onFocusedCellChange` | `(cell) => void` | `undefined` | 焦点单元格变化后触发。 |
| `onScrollChange` | `(scrollY) => void` | `undefined` | 纵向滚动变化后触发。 |
| `disabled` | `boolean` | `false` | 是否整体禁用。禁用后不参与焦点导航，并阻断 pointer、keyboard、popup、drag 和复制。 |
| `readonly` | `boolean` | `false` | 是否只读。只读仍允许选择、复制、滚动、排序和过滤，但阻止编辑、粘贴和删除。 |
| `editable` | `boolean` | `false` | 全局是否允许编辑。必须为 `true` 才能进入编辑；列可用 `editable:false` 进一步禁用。 |
| `resizableColumns` | `boolean` | `true` | 是否允许拖拽列宽。 |
| `autoFitColumns` | `boolean` | `false` | 是否允许双击列边界自动适配列宽。 |
| `sortable` | `boolean` | `true` | 是否启用排序。列仍需配置 `sortable: true` 才可点击表头排序。 |
| `reorderableColumns` | `boolean` | `true` | 是否允许拖拽调整列顺序。固定列不能被拖拽，也不能与非固定列互换区域。 |
| `reserveScrollbars` | `boolean` | viewport 默认值 | 是否预留滚动条空间，避免滚动条出现时布局跳动。 |
| `getCellDisplayText` | `(args) => string \| null \| undefined` | `undefined` | 自定义单元格显示文本。返回空值时使用默认文本。 |
| `getGroupDisplayText` | `(args) => string \| null \| undefined` | `undefined` | 自定义分组行文本。 |
| `resolveRowStyle` | `(args) => GridRowStyleOverride \| null \| undefined` | `undefined` | 自定义行样式。 |
| `resolveCellStyle` | `(args) => GridCellStyleOverride \| null \| undefined` | `undefined` | 自定义单元格样式。 |
| `resolveCellEditPolicy` | `(context: GridCellContext<T>) => GridCellEditPolicy \| null \| undefined` | `undefined` | 按当前行和列解析用户编辑权限、Tab 停靠和不可编辑原因。 |

## 列配置

所有列共享 `GridColumnBase` 字段：

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `key` | `string` | 必填 | 数据字段名，也是列状态、排序、过滤、编辑定位的关键字段。 |
| `title` | `string` | 必填 | 表头显示文本。 |
| `width` | `number` | 内部默认宽度 | 初始列宽。 |
| `minWidth` | `number` | checkbox 为 `52`，其他为 `40` | 最小列宽，用于拖拽和自动列宽。 |
| `fixed` | `boolean` | `false` | 兼容字段。`true` 等价于左固定列。 |
| `pinned` | `'left' \| 'right' \| false` | `fixed ? 'left' : false` | 固定列位置。 |
| `hidden` | `boolean` | `false` | 是否隐藏。隐藏列仍保留在 `columns` 中。 |
| `widthMode` | `'fixed' \| 'interactive' \| 'stretch' \| 'autoContent'` | `'interactive'` | 列宽模式。`autoContent` 会测量内容，需注意性能。 |
| `align` | `'left' \| 'center' \| 'right'` | 按列类型决定 | 单元格文本对齐。 |
| `cellTextOverflow` | `'clip' \| 'ellipsis'` | 继承表格配置 | 当前列文本溢出策略。 |
| `editable` | `boolean` | 继承表格配置 | 当前列是否可编辑。 |
| `sortable` | `boolean` | `false` | 当前列是否可排序。表格的 `sortable` 是全局开关，列仍需显式设置 `sortable: true`。 |
| `filterable` | `boolean` | `false` | 当前列是否显示过滤入口或参与过滤行。 |
| `filterValueFormatter` | `(value, row, defaultDisplayText) => string \| null \| undefined` | `undefined` | 自定义值筛选候选项文本。默认使用列类型的无装饰显示文本，不复用 `getCellDisplayText` 添加的图标或状态前缀。 |
| `editor` | `GridColumnEditorDef` | 根据 `type` 推断 | 显式指定编辑器，覆盖列类型默认编辑器。 |

列类型：

| 类型 | 额外字段 | 说明 |
| --- | --- | --- |
| `GridColumnText` | `type:'text'`, `placeholder?: string` | 文本列，默认使用文本输入编辑器。 |
| `GridColumnNumber` | `type:'number'`, `min?`, `max?`, `step?`, `decimals?` | 数字列。编辑态显示上下步进按钮，`step` 默认按 `1` 处理。 |
| `GridColumnCheckbox` | `type:'checkbox'` | 布尔列。 |
| `GridColumnSelect` | `type:'select'`, `options`, `searchable?` | 下拉选择列，`options` 使用 [ComboBox](../selector/combo-box.md) 选项结构。 |
| `GridColumnSelectGrid` | `type:'select-grid'`, `columns`, `rows`, `valueKey`, `labelKey`, `searchable?` | 表格下拉选择。简单场景可直接使用；复杂场景建议使用 `editor.kind='lookup'`。 |
| `GridColumnDate` | `type:'date'`, `showTime?`, `timePrecision?` | 日期或日期时间列；`showTime:true` 时按本地日期时间编辑，时间精度可设为 `minute` 或 `second`。 |
| `GridColumnTime` | `type:'time'`, `precision?` | 纯时间列，值使用 `HH:mm` 或 `HH:mm:ss`；精度统一约束显示和全部数据操作。 |
| `GridColumnCustom` | `type:'custom'`, `render`, `renderColor?` | 自定义显示列。默认没有内置编辑器。 |

左、右固定列与普通滚动列之间会持续绘制强分隔线和轻阴影。横向滚动使内容进入固定区域下方时，对应方向的阴影会自动增强；滚动到边缘后恢复为轻阴影。该视觉覆盖表头、过滤行、数据区和汇总区，不需要额外配置。


## 编辑器配置

`GridColumnEditorDef` 用于覆盖列的默认编辑器。

| kind | 字段 | 说明 |
| --- | --- | --- |
| `text` | `placeholder?` | 文本输入。 |
| `number` | 无额外字段 | 数字输入。编辑态右侧显示上下步进按钮，也可使用 `ArrowUp`、`ArrowDown` 调整。 |
| `checkbox` | 无额外字段 | 布尔值编辑。 |
| `select` | `options`, `searchable?` | 单选下拉。 |
| `lookup` | `columns`, `rows`, `valueKey`, `labelKey`, `searchable?`, `queryKeys?`, `metaKey?`, `queryProcessor?` | 表格查找下拉。 |
| `date` | `showTime?`, `timePrecision?` | 日期或日期时间选择。 |
| `time` | `precision?` | 纯时间输入；`precision` 可设为 `minute` 或 `second`。 |
| `drop-tree` | `roots`, `searchable?`, `expandAllOnOpen?`, `expandedKeysOnOpen?`, `queryTextBuilder?`, `queryProcessor?` | 树形下拉。关联 [DropTreeEdit](../selector/drop-tree-edit.md)。 |
| `drop-tree-grid` | `columns`, `roots`, `treeColumnKey`, `labelKey`, `searchable?`, `metaKey?`, `metaFormatter?`, `expandAllOnOpen?`, `expandedKeysOnOpen?`, `queryTextBuilder?`, `queryProcessor?` | 树表下拉。关联 [DropTreeGridEdit](../selector/drop-tree-grid-edit.md)。 |

### 日期与时间列的值语义

`type:'time'` 的有效精度取显式 `editor:{ kind:'time', precision }` 或列的 `precision`，均未配置时为 `'second'`。该精度会一致用于显示、编辑提交、排序、条件筛选、值筛选去重和分组：

- 分钟精度统一为 `HH:mm`，秒精度统一为 `HH:mm:ss`。
- 分钟精度下，`08:30`、`08:30:00` 和 `08:30:59` 的比较值相同；它们只产生一个值筛选候选项，并进入同一个分组。
- 绘制和数据投影不会改写源行；用户提交编辑后，单元格才写回当前精度的规范字符串。

`type:'date', showTime:true` 的弹层接受多种常见输入，但确认后统一写回不带时区的本地 ISO 字符串：

| 输入 | 打开弹层时的解释 | 确认后的值 |
| --- | --- | --- |
| `YYYY-MM-DDTHH:mm[:ss[.SSS]]` 或以空格分隔日期和时间，且无 `Z` 或 offset | 按字符串中的本地日历和时刻字段直接显示。 | 分钟精度写回 `YYYY-MM-DDTHH:mm`；秒精度写回 `YYYY-MM-DDTHH:mm:ss`。 |
| `YYYY-MM-DD` | 按该本地日期的 `00:00:00` 打开，不使用打开弹层时的当前时刻。 | 按当前 `timePrecision` 写回本地日期时间字符串。 |
| 带 `Z` 或 `+08:00` 等 offset 的 ISO 字符串 | 先按时间点解析，再换算为运行环境的本地日历和时刻字段。 | 写回换算后的本地 ISO 字符串，不保留原时区后缀。 |
| 有效的 JavaScript `Date` | 使用该时间点在运行环境中的本地日历和时刻字段。 | 写回本地 ISO 字符串，不保留 `Date` 类型。 |
| 有限 `number` | 作为 Unix 毫秒时间戳处理，再换算为本地字段。 | 写回本地 ISO 字符串，不保留数值类型。 |

对于 `Z`、offset、`Date` 和时间戳输入，弹层先按真实时间点换算本地字段；在普通、无夏令时歧义的本地时间中重新解析提交结果，会得到按 `timePrecision` 截断后的同一时间点。分钟精度会舍去秒和毫秒，秒精度会舍去毫秒。提交结果没有时区标记，也不保留原 offset；夏令时重复或跳过的本地时刻不能只靠该字符串恢复原时区身份。接口要求 UTC、固定时区或保留 offset 时，应由业务数据层在表格提交前后明确转换。`showTime:false` 仍只写回 `YYYY-MM-DD`。

编辑流程：

1. 鼠标双击、键盘编辑或 API 调用 `beginEdit()` 进入编辑。
2. 输入控件修改临时文本或临时值。
3. `commitEdit()` 或编辑器确认时触发校验。
4. 校验通过后触发 `onCellChange(row, key, value)`。
5. 业务代码在 `onCellChange` 中更新源对象或外部状态。

### 数字步进

`number` 编辑器在当前单元格进入编辑状态后显示上下步进按钮。步进只更新当前编辑草稿，仍然在 Enter、Tab、失焦或显式 `commitEdit()` 时统一校验和提交，不会在每次点击按钮时直接触发 `onCellChange`。

```ts
interface OrderRow {
  quantity: number
}

const columns: GridColumnDef<OrderRow>[] = [
  {
    key: 'quantity',
    title: '数量',
    type: 'number',
    min: 0,
    max: 100,
    step: 0.5,
    decimals: 1,
  },
]
```

- 点击上、下按钮分别增加或减少一个 `step`；`step` 只有在有限且大于 `0` 时生效，否则统一按 `1` 处理。配置 `decimals` 后，`step` 会先对齐到相同的小数精度；如果结果为 `0`，则使用一个最小显示单位（`10^-decimals`），保证每次点击都能产生可见且可逆的变化。
- `decimals` 会先截断为整数，再限制在 `0` 到 `100`；非有限值按未配置处理。`min`、`max` 也只接受有限值，非有限边界会被忽略；当同时配置且 `min > max` 时，这组冲突边界不会参与归一化。
- 按钮步进和最终提交共用同一套数值归一化。命中或越过有效的 `min`、`max` 时，边界值本身是稳定结果；其余数值先按 `decimals` 取小数位，再限制到有效边界内。即使边界无法用指定小数位精确表示，按钮显示的草稿在提交时也不会再次变成另一个值。
- 一次按压只属于发起它的指针和当时的编辑会话。只有同一指针在同一会话、同一按钮内完成释放才会步进；在原按钮外释放、滚动表格、取消指针或切换编辑会话都不会修改草稿。
- 连续快速点击步进按钮只按点击次数步进，不会触发单元格双击编辑，也不会因单元格双击逻辑重新全选输入文本；步进后光标位于新文本末尾。
- 数字编辑状态下，`ArrowUp`、`ArrowDown` 与按钮行为一致；非编辑状态下仍用于表格行导航。
- 空草稿从 `0` 开始步进，再应用小数位和边界；当前文本不是完整有效数字时不会执行步进，也不会覆盖用户正在修正的内容。
- 有效小数步进使用十进制定点加减，避免 `0.2 + 0.1` 一类常见浮点残差。
- 数字步进不响应鼠标滚轮，避免滚动表格时意外修改业务数据。

### 输入校验

Grid 校验只负责输入值是否合法，不负责业务提交、后台保存或服务端状态。

- number 编辑器会拒绝 `12abc`、`NaN`、`Infinity` 等非完整有限数字，不会截取数字前缀或静默写回旧值。
- date 编辑器会拒绝无法解析或不存在的 ISO 日期。
- time 编辑器会拒绝超出 `00:00:00` 到 `23:59:59` 范围的值，并按列配置统一为 `HH:mm` 或 `HH:mm:ss`。
- 三类内置错误默认分别为“请输入有效数字”“请输入有效日期”“请输入有效时间”。可以通过当前 Grid 的 `editorValidationMessages` 覆盖；空字符串不会关闭校验，而会回退到默认文案。
- `validateCell` 负责单字段规则，在单元格提交、程序化 `setCellValue()` 和全表 `validate()` 时执行。
- `validateRow` 负责同一行字段之间的关联规则，只在显式调用 `validate()` 时执行。返回对象的 key 必须对应列 key，错误会显示在对应单元格。
- `GridRowValidationArgs.sourceRowIndex` 是该行在原始 `rows` 数组中的索引，不是排序、过滤或分组后的可视索引；业务身份优先使用 `row` 或 `rowId`。
- `validate()` 会先尝试提交活动编辑器，然后验证全部源数据行和全部列，包括被筛选掉的行与隐藏列；不会修改合法数据。
- 校验错误沿用单元格错误边框，hover 显示错误文本。`focusFirstError()` 只定位当前可见且列未隐藏的第一个错误。

```ts
import { RenderDataGrid, type GridColumnDef } from 'ds-ui'

interface OrderRow {
  itemCode: string
  amount: number
  unitCode: string
}

const columns: GridColumnDef<OrderRow>[] = [
  { key: 'itemCode', title: '项目', type: 'text', editable: true },
  { key: 'amount', title: '数量', type: 'number', editable: true },
  { key: 'unitCode', title: '单位', type: 'text', editable: true },
]
const rows: OrderRow[] = []

const grid = new RenderDataGrid<OrderRow>({
  columns,
  rows,
  editorValidationMessages: {
    invalidNumber: '数量必须是数字',
    invalidDate: '请输入正确的业务日期',
    invalidTime: '请输入正确的执行时间',
  },
  validateCell: ({ key, value }) => {
    if (key === 'itemCode' && !value) return '请选择项目'
    return true
  },
  validateRow: ({ row }) => {
    if (row.amount > 0 && !row.unitCode) {
      return { unitCode: '请输入单位' }
    }
    return undefined
  },
})

const result = grid.validate()
if (!result.valid) grid.focusFirstError()
```

`GridValidationResult<T>` 返回 `{ valid, errors }`；`errors` 与 `getCellErrors()` 使用同一个 `GridCellErrorState<T>[]` 数据源。

### 逐单元格编辑策略

列的 `editor` 和 `key` 仍然固定；需要让同一列在不同行具有不同权限时，使用 `resolveCellEditPolicy`，不要动态切换编辑器或字段绑定。

```ts
import { RenderDataGrid, type GridColumnDef } from 'ds-ui'

interface OrderRow {
  itemCode: string
  quantity: number
  approved: boolean
  orderType: 'goods' | 'service'
}

const columns: GridColumnDef<OrderRow>[] = [
  { key: 'itemCode', title: '订单项目', type: 'text' },
  { key: 'quantity', title: '数量', type: 'number' },
]
const rows: OrderRow[] = []

const grid = new RenderDataGrid<OrderRow>({
  columns,
  rows,
  editable: true,
  resolveCellEditPolicy: ({ row, column }) => {
    if (row.approved) {
      return {
        state: 'readonly',
        reason: '订单已审核，不能再修改',
      }
    }
    if (column.key === 'quantity' && row.orderType !== 'goods') {
      return {
        state: 'disabled',
        reason: '非商品订单不使用数量',
      }
    }
    return { state: 'inherit' }
  },
})
```

`GridCellContext<T>` 包含 `row`、可视 `rowIndex`、`column`、可视 `columnIndex` 和当前 `value`。`GridCellEditPolicy` 字段：

| 字段 | 类型 | 默认语义 |
| --- | --- | --- |
| `state` | `'inherit' \| 'editable' \| 'readonly' \| 'disabled'` | `inherit`，继续使用 Grid 与列的编辑能力。 |
| `tabStop` | `boolean` | editable 和显式 readonly 为 `true`；disabled 为 `false`。继承自 `column.editable:false` 或无有效 editor 的 readonly 列保持原有跳过行为。 |
| `reason` | `string` | 无；readonly/disabled 单元格 hover 时作为原因提示。 |

- `readonly` 保持正常阅读、焦点、选择和复制能力，但不会启动编辑器。
- `disabled` 使用弱化视觉，默认从 Tab 路径跳过；显式设置 `tabStop:true` 可让它参与导航。
- 未配置 resolver 时，`editable:false` 和没有有效 editor 的列继续从默认 Tab 编辑路径跳过；需要让这类列参与导航时，显式返回 `state:'readonly', tabStop:true`。
- 策略覆盖鼠标、Enter/F2/Space、checkbox、弹出编辑器、粘贴和编辑中的提交；策略运行时变化为不可编辑时，当前编辑会取消而不写回。
- Grid 的 `disabled`、`readonly`、`editable:false` 和列的 `editable:false` 是最终边界，回调不能把这些边界重新提升为 editable。
- `setCellValue()` 是程序化数据 API，不受逐单元格用户编辑策略阻断，仍会执行标准化和校验。

### Lookup 感知当前单元格

Grid 列的 `lookup.queryProcessor` 除了查询选项，还会收到 `context.cell`。可用它根据当前订单行过滤候选项，而不需要为每一行创建不同编辑器：

```ts
import type { GridLookupQueryProcessor } from 'ds-ui'

interface OrderRow {
  orderType: 'goods' | 'service'
  itemCode: string
}

interface OrderOption {
  code: string
  name: string
  orderType: OrderRow['orderType']
}

const queryProcessor: GridLookupQueryProcessor<OrderOption, OrderRow> = context => ({
  rows: context.rows.filter(option =>
    option.orderType === context.cell.row.orderType &&
    String(option.name).includes(context.query)
  ),
})
```

`cell` 在 popup 打开和每次搜索时均指向外层 Grid 单元格；它不是下拉候选行。列声明为 `GridColumnDef<Row>` 时，内联 `queryProcessor` 的 `context.cell.row` 会沿用该 `Row` 类型；单独复用处理器时可显式声明 `GridLookupQueryProcessor<Option, Row>`。


## 排序、过滤、分组和汇总

### 排序

`GridSortDescriptor`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `key` | `string` | 列 key。 |
| `order` | `'asc' \| 'desc'` | 排序方向。 |

`sortState` 是兼容单列排序状态，`sort` 是当前多列排序描述。业务优先使用 `sort`。

### 过滤

`GridFilterRule`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `key` | `string` | 列 key。 |
| `operator` | `GridFilterOperator` | 过滤操作符。 |
| `value` | `unknown` | 起始值或单值。 |
| `valueTo` | `unknown` | `between` 的结束值。 |
| `values` | `unknown[]` | `in`、`notIn` 的值集合。空值使用 `null`。 |

`GridFilterOperator` 支持：

- `contains`
- `equals`
- `startsWith`
- `endsWith`
- `gt`
- `gte`
- `lt`
- `lte`
- `between`
- `empty`
- `notEmpty`
- `in`
- `notIn`

默认交互采用表头下拉筛选：将列设置为 `filterable:true` 后，表头右侧显示下拉图标。点击图标或在当前列按 `Alt+ArrowDown` 打开弹窗。

- “值筛选”列出当前列的唯一值、搜索和全选状态；选项保留原始数据值，显示文本沿用列编辑器的 label 解析。候选项计数不一致时显示计数，全部一致时自动隐藏低信息量的计数列。
- 数组和普通对象等复杂候选值按稳定的结构语义去重和匹配，不受对象属性声明顺序影响；循环引用等不可序列化值退回同一对象实例语义。
- `time` 列先按列的 `precision` 归一化，再执行排序、条件比较、值筛选去重和分组。分钟精度不会把显示相同但原始秒数不同的值拆成多个候选项或分组。
- “条件筛选”提供文本、数值、日期等列适用的操作符；操作符通过下拉列表直接选择，不依赖重复点击轮换。
- `equals`、`in` 和 `notIn` 按字段原始值比较；`contains`、`startsWith` 和 `endsWith` 按列的显示文本比较。Select、Lookup、Tree 等带 label 的列不会把 label 当成持久化规则值；已有原始值等值规则或 `in` / `notIn` 规则始终回到“值筛选”页编辑，避免切换入口时隐式改写规则。
- 数值和日期条件执行严格类型校验；非法数字、非法日历日期、不完整或反向的 `between` 区间不会提交，也不会借由“确定”静默清除已有规则。
- `showTime:false` 的日期列按本地日历日期比较和去重：纯 `YYYY-MM-DD` 保留字面日期，`Date`、时间戳以及包含时间或时区的字符串先还原时间点，再取本地日历日期，因此经 JSON / ViewPreset 转换后仍保持同一天；`showTime:true` 的日期时间列按时间点比较，纯日期输入按本地零点解释。
- 弹窗中的修改是草稿，只有“确定”或在输入区按 `Enter` 才提交；“取消”、`Escape` 和点击外部均放弃草稿。
- IME 组合输入期间的 `Enter` 只用于确认候选文本，不提交或关闭筛选弹窗。
- `Tab` / `Shift+Tab` 在清除动作、筛选页签、输入区、值列表、条件操作符和底部按钮之间循环；页签和操作符支持方向键，`Enter` / `Space` 激活当前动作。
- 没有生效规则时“清除筛选”处于禁用状态，并从键盘焦点路径中排除；值列表的“全选”和普通候选项都可以通过键盘到达。
- 唯一值默认最多收集 10,000 项；超过限制时搜索仅覆盖已加载项。此时从默认全选状态取消值会生成 `notIn` 规则，未展示的值仍保持包含。
- 已生效的列显示筛选图标，弹窗打开时表头入口保持选中反馈。
- 筛选弹窗的间距、控件高度、列表行高、按钮尺寸和视口边距跟随主题密度，并复用 popup、输入框、复选框与滚动条的明暗主题状态样式。
- 筛选弹窗使用独立于列宽的首选宽度和最大宽度；宽列不会把弹窗横向拉伸，弹窗右侧与表头筛选入口保持对齐。
- 值筛选会按初始候选数量收缩高度，超过 6 个可见行后再启用滚动；搜索过程中高度保持稳定。条件筛选使用独立的紧凑高度，切换操作符时不会上下抖动。
- 弹窗优先在表头下方打开；下方能容纳基本操作区时会在下方压缩列表高度，否则紧贴表头上方打开，并按该方向的可用空间限制高度。
- 弹窗以表头筛选入口的右边缘为锚点；窄列会向左展开并限制在当前 Popup viewport 内，不会因为列宽小于弹窗宽度而脱离入口。
- `readonly:true` 只禁止数据修改，仍允许排序和筛选等数据视图操作；`disabled:true` 会关闭并阻止筛选弹窗交互。
- 隐藏列不会自动丢失其筛选规则；列真正从 `columns` 中移除时，对应规则才会被清理。弹窗打开期间如果列结构、数据或外部筛选状态发生变化，当前草稿会关闭，避免提交到过期列或候选集合。

过滤仍保留两套数据入口：

- `filters`：表头弹窗使用的结构化规则，也适合业务持久化。
- `columnFilters`：可选过滤行的文本值，适合需要始终可见的简单输入式过滤。通过 `filterRowVisible:true` 显式启用；不建议作为默认视觉方案。

### 快速过滤

`quickFilter` 会在数据模型中执行全局文本匹配。大数据场景中，不要在每次输入时同步构造新 `rows`，应通过防抖后设置 `grid.quickFilter` 或 `grid.setQuickFilter()`。

### 分组

`GridGroupDef<T>`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `key` | `keyof T & string` | 分组字段。 |
| `order` | `'asc' \| 'desc'` | 当前分组层级的排序方向。 |

分组列头使用 `G1`、`G2` 等徽标明确标识分组层级；该徽标不是排序优先级或筛选数量。分组行不是源数据行，事件和选择只会把数据行转换为业务行。

### 汇总

`GridSummaryDef<T>`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `key` | `keyof T & string` | 汇总字段。 |
| `aggregate` | `'sum' \| 'avg' \| 'min' \| 'max' \| 'count'` | 汇总方式。 |
| `label` | `string` | 页脚标签。 |
| `formatter` | `(value, rows, def) => string` | 自定义显示文本。 |


## 可读写属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `columns` | `GridColumnDef<T>[]` | 获取或替换全部列。替换前取消活动编辑，随后重置列宽并重新布局。 |
| `visibleColumns` | `GridColumnDef<T>[]` | 只读。按左固定、普通、右固定排序后的可见列。 |
| `rows` | `T[]` | 获取或替换源数据行。 |
| `dataState` | `GridDataState` | 数据状态。 |
| `stateMessage` | `string` | 状态提示文本。 |
| `selectionMode` | `GridSelectionMode` | 选择模式。 |
| `cellTextOverflow` | `GridCellTextOverflow` | 全局单元格文本溢出策略。 |
| `footerHeight` | `number` | 页脚高度。 |
| `filterRowVisible` | `boolean` | 是否显示过滤行。 |
| `filterRowHeight` | `number` | 过滤行高度。 |
| `groupBy` | `GridGroupDef<T>[]` | 当前分组配置。 |
| `disabled` | `boolean` | 整体禁用状态。切换为 `true` 会取消编辑、拖拽、popup、hover 和焦点。 |
| `readonly` | `boolean` | 只读状态。切换为 `true` 会取消当前编辑，但保留选择、复制和数据视图操作。 |
| `rowHeight` | `number` | 行高。 |
| `headerHeight` | `number` | 表头高度。 |
| `sortState` | `GridSortState` | 单列排序状态。 |
| `sort` | `GridSortDescriptor[]` | 多列排序状态。 |
| `filters` | `GridFilterRule[]` | 结构化过滤规则。 |
| `quickFilter` | `string` | 快速过滤文本。 |
| `summary` | `GridSummaryDef<T>[]` | 汇总配置。 |
| `editingCell` | `{ row; key; column; text } \| null` | 只读。当前正在编辑的单元格。 |
| `getCellDisplayText` | 函数或 `undefined` | 自定义单元格文本。 |
| `getGroupDisplayText` | 函数或 `undefined` | 自定义分组文本。 |
| `resolveRowStyle` | 函数或 `undefined` | 自定义行样式。 |
| `resolveCellStyle` | 函数或 `undefined` | 自定义单元格样式。 |
| `resolveCellEditPolicy` | 函数或 `undefined` | 按单元格解析编辑、只读、禁用、Tab 和原因提示。 |
| `validateCell` | 函数或 `undefined` | 单元格校验函数。设置新函数会清理旧错误。 |
| `validateRow` | 函数或 `undefined` | 行字段关联校验函数。设置新函数会清理旧错误。 |
| `width` / `height` | `number \| undefined` | 期望尺寸。赋值后请求 layout。 |
| `minWidth` / `maxWidth` | `number \| undefined` | 水平方向尺寸边界。赋值后请求 layout。 |
| `minHeight` / `maxHeight` | `number \| undefined` | 垂直方向尺寸边界。赋值后请求 layout。 |
| `margin` | `EdgeInsets` | 组件外部留白。赋值后请求 layout。 |
| `horizontalAlignment` / `verticalAlignment` | `BoxAlignment \| undefined` | 组件在父布局槽位中的对齐方式。 |
| `isFocused` | `boolean` | 只读。当前表格是否持有焦点。 |

`disabled`、`readonly`、`editable`、`resizableColumns`、`autoFitColumns`、`rangeSelectionAutoScroll`、`sortable` 可以在运行时直接修改。setter 会同步清理不再合法的临时状态：例如关闭编辑会取消当前编辑，关闭列宽调整会取消 resize，关闭排序会清空当前排序，禁用组件会关闭自身 popup 并释放焦点。

运行时设置 `rowHeight` 或 `headerHeight` 会转为显式尺寸，并触发布局、滚动范围和编辑器几何同步；后续主题切换不会覆盖显式值。

替换 `grid.rows` 表示重新绑定数据源。DataGrid 会结束当前编辑并关闭自身 popup；未配置 `rowKey` 时会清空选择、焦点、悬停和校验错误。配置 `rowKey` 时，选择和校验错误会按行 id 尝试恢复，但编辑状态仍会结束。

## 方法

### 编辑

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `beginEdit(row, key)` | `boolean` | 开始编辑，并按 `nearest` 将目标单元格横纵向滚入视口。`row` 可传可视行索引或行对象；`key` 可传可视列索引或列 key。 |
| `commitEdit()` | `boolean` | 提交当前编辑。校验失败时返回 `false`。 |
| `cancelEdit()` | `void` | 取消当前编辑。 |
| `setCellValue(row, key, value, options?)` | `boolean` | 通过 API 设置单元格值。`row` 可传源行对象或可视行索引；不受列和逐单元格用户编辑权限限制，但仍执行列标准化和校验。 |
| `validate()` | `GridValidationResult<T>` | 验证活动编辑器以及全部源数据行、列，并返回完整错误集合。 |
| `focusFirstError()` | `boolean` | 定位第一个可见错误单元格；没有可定位错误时返回 `false`。 |
| `getCellErrors()` | `GridCellErrorState<T>[]` | 获取单元格错误。 |
| `clearCellErrors()` | `void` | 清除所有单元格错误。 |
| `clearCellError(row, key)` | `boolean` | 清除指定源数据行、指定字段的错误；其他字段错误保持不变。 |

`beginEdit()` 只定位当前排序、过滤和分组投影中的可视数据行。目标行被过滤排除、目标列被隐藏或当前编辑策略不允许编辑时返回 `false`，不会自动清除筛选条件。编辑器或弹层定位前，普通列会按 `nearest` 调整横向和纵向滚动；左、右固定列始终可见，因此不会改变横向滚动位置。

### 过滤和搜索

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `getFilterValue(key)` | `string` | 获取过滤行文本。 |
| `setFilterValue(key, value)` | `void` | 设置过滤行文本。 |
| `getFilters()` | `GridFilterRule[]` | 获取结构化过滤规则。 |
| `setFilters(filters)` | `void` | 设置结构化过滤规则。 |
| `getQuickFilter()` | `string` | 获取快速过滤文本。 |
| `setQuickFilter(value)` | `void` | 设置快速过滤文本。 |
| `clearAllFilters()` | `void` | 清除过滤行、结构化过滤和快速过滤。 |
| `clearColumnFilter(key)` | `void` | 清除某列过滤。 |
| `getColumnFilters()` | `GridColumnFilterState[]` | 获取过滤行状态。 |
| `setColumnFilters(filters)` | `void` | 设置过滤行状态。 |

### 分组

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `expandAllGroups()` | `void` | 展开全部分组。 |
| `collapseAllGroups()` | `void` | 折叠全部分组。 |

### 选择和定位

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `getVisibleRows()` | `readonly T[]` | 获取当前排序、过滤、分组后的可视数据行。 |
| `focusRow(row, options?)` | `boolean` | 聚焦某行。`options.select` 默认 `true`；`options.scroll` 只控制是否纵向滚动到行。 |
| `setSelectedRows(rows)` | `void` | 设置选中行。元素可为行对象或可视行索引。 |
| `setSelectedRowIds(rowIds)` | `void` | 按行 id 设置选中行。需要配置 `rowKey`。 |
| `getSelectionState()` | `GridSelectionState<T>` | 获取完整选择状态。 |
| `getSelectedRows()` | `readonly T[]` | 获取选中行。 |
| `getSelectedRow()` | `T \| null` | 获取第一条选中行。 |
| `getSelectedRowIds()` | `GridRowId[]` | 获取选中行 id。 |
| `getCurrentCell()` | `GridSelectionCell<T> \| null` | 获取当前单元格。 |
| `getCurrentRow()` | `T \| null` | 获取当前行。 |
| `getCurrentColumn()` | `GridColumnDef<T> \| null` | 获取当前列。 |
| `getCurrentKey()` | `keyof T & string \| null` | 获取当前列 key。 |
| `getFocusedCell()` | `GridSelectionCell<T> \| null` | 获取焦点单元格。 |
| `getFocusedRow()` | `T \| null` | 获取焦点行。 |
| `getFocusedColumn()` | `GridColumnDef<T> \| null` | 获取焦点列。 |
| `getFocusedKey()` | `keyof T & string \| null` | 获取焦点列 key。 |
| `clearSelection()` | `void` | 清除选择。 |
| `selectCell(row, key, options?)` | `boolean` | 选择单元格。 |
| `selectRange(range, options?)` | `boolean` | 选择范围。 |

`GridSelectionOptions`：

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `scroll` | `boolean` | `true` | 程序化选择后是否按 `nearest` 横纵向滚动到目标单元格或范围终点；设为 `false` 时两个方向都不滚动。 |

Tab、Shift+Tab、方向键以及 Home/End 改变活动单元格时，也会按 `nearest` 将目标单元格滚入中央可滚动区域。已经完整可见的单元格不会触发额外滚动；左、右固定列不参与横向滚动。

### 数据行

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `addRows(rows, sourceIndex?, options?)` | `boolean` | 添加行。`sourceIndex` 是源数据索引，不是可视索引。 |
| `addRowsAtSourceIndex(rows, sourceIndex, options?)` | `boolean` | 按源数据索引插入。 |
| `insertRowsBefore(referenceRow, rows, options?)` | `boolean` | 在指定业务行前插入。 |
| `insertRowsAfter(referenceRow, rows, options?)` | `boolean` | 在指定业务行后插入。 |
| `removeRows(rows, options?)` | `boolean` | 删除行。元素可为行对象或源数据索引。 |
| `subscribeDataChange(listener)` | `DisposeFn` | 订阅单元格、增行、删行和整批 rows 替换事件。取消函数可重复调用。 |
| `refreshRow(row)` | `boolean` | 刷新指定行显示。 |
| `refreshData()` | `void` | 刷新全部数据呈现。 |
| `refreshLookup(columnKey?)` | `boolean` | 重建指定 Lookup 列或全部 Lookup 列的值索引并刷新呈现；没有匹配列时返回 `false`。同一候选数组保持相同长度但原地替换内容后应调用此方法。 |

### 列状态

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `moveColumn(fromIndex, toIndex)` | `boolean` | 移动可见非固定列。移动前提交活动编辑；校验失败或固定列不能移动时返回 `false`。 |
| `openColumnMenu(column, position?)` | `boolean` | 打开列菜单。`column` 可传列 key 或可见列索引。 |
| `getViewPreset()` | `GridViewPreset` | 导出列状态、排序、过滤和快速过滤。 |
| `applyViewPreset(preset)` | `void` | 恢复视图预设。 |
| `resetColumnState()` | `void` | 恢复初始列状态。 |
| `autoFitColumn(column)` | `boolean` | 自动适配单列宽度。 |
| `autoFitAllColumns()` | `void` | 自动适配所有可见列宽。 |
| `resetColumnWidths()` | `void` | 恢复初始列宽。 |
| `getColumnState()` | `GridColumnState[]` | 获取列宽、隐藏、固定和宽度模式。 |
| `setColumnState(state)` | `void` | 取消活动编辑，然后设置列状态和列顺序。 |

### 焦点、复制和调试

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `focusIn()` | `void` | 通知组件获得焦点。通常由焦点系统调用。 |
| `focusOut()` | `void` | 通知组件失去焦点。通常由焦点系统调用。 |
| `getCopyText()` | `string \| null` | 获取当前选择可复制文本。 |
| `debugState()` | `GridDebugState` | 获取滚动、选择、排序、过滤、列、错误等调试状态。 |
| `dispose()` | `void` | 释放焦点注册、编辑器、popup 控制器、指针控制器和滚动状态。 |

## 事件与回调

| 回调 | 触发时机 | 参数说明 |
| --- | --- | --- |
| `onCellChange(row, key, value)` | 单元格提交且校验通过后 | `row` 是源行对象；`key` 是列 key；`value` 是标准化后的值。 |
| `onRowClick(row, event)` | 用户点击数据行 | `event` 包含 `rowId`、`key`、`column`、输入来源和组合键状态。 |
| `onRowActivate(row, event)` | 用户激活数据行 | 常见来源是双击或键盘确认。 |
| `onSelectionChange(event)` | 行、单元格或范围选择变化 | `event.state` 是完整选择状态；`selectedRow` 是第一条选中行。 |
| `onCurrentCellChange(cell)` | 当前单元格变化 | `cell` 为 `null` 表示当前单元格被清空。 |
| `onFocusedCellChange(cell)` | 焦点单元格变化 | 焦点单元格可不同于当前选择。 |
| `onScrollChange(scrollY)` | 纵向滚动位置变化 | 只回传纵向滚动偏移。 |

### 结构化数据变更事件

`onCellChange` 适合已有页面处理一次单元格提交。需要实现编辑会话、审计摘要或统一数据桥接时，使用 `subscribeDataChange()`：

```ts
const observedGrid = new RenderDataGrid({
  columns: [{ key: 'quantity', title: '数量', type: 'number' }],
  rows: [{ quantity: 1 }],
})
const stopDataChanges = observedGrid.subscribeDataChange(event => {
  if (event.kind === 'cell') {
    console.log(
      event.row,
      event.key,
      event.previousValue,
      event.value,
      event.sourceRowIndex,
    )
    return
  }
  if (event.kind === 'rows-added' || event.kind === 'rows-removed') {
    console.log(event.entries)
    return
  }
  console.log(event.previousRows, event.rows)
})

stopDataChanges()
observedGrid.dispose()
```

事件按 `kind` 分为：

| kind | 关键字段 | 说明 |
| --- | --- | --- |
| `cell` | `row`、`sourceRowIndex`、`rowId`、`previousRowId`、`key`、`previousValue`、`value` | 用户编辑或 API 单元格写入。索引始终是源数据索引。 |
| `rows-added` | `entries` | 每项包含行对象、插入后的源数据索引和可选 row id。 |
| `rows-removed` | `entries` | 每项包含被删除的行对象、删除前的源数据索引和可选 row id。 |
| `rows-replaced` | `previousRows`、`rows` | 赋值 `grid.rows` 产生的整批重新绑定。 |

每个事件都有 `origin`：用户编辑为 `editor`，公开数据 API 默认是 `api`，直接替换 `rows` 是 `external`。`session` 保留给框架在撤销和重放变更时使用；业务代码通常不应主动传入该来源。

`setCellValue()`、增删行方法的最后一个 `options` 参数可显式设置 origin。直接修改行对象再调用 `refreshRow()` 不产生数据变更事件，因为 DataGrid 无法知道修改前的值。

### DataGridEditSession

需要保存、撤销、dirty 状态和行级变更集时，创建一个 `DataGridEditSession`：

```ts
import {
  DataGridEditSession,
  RenderDataGrid,
} from 'ds-ui'

const sessionRows = [{ quantity: 1 }]
const sessionGrid = new RenderDataGrid({
  columns: [{ key: 'quantity', title: '数量', type: 'number' }],
  rows: sessionRows,
})
const gridChangeSession = new DataGridEditSession(sessionGrid)

sessionGrid.setCellValue(sessionRows[0]!, 'quantity', 2)

const gridChanges = gridChangeSession.getChanges()
gridChangeSession.reset()
void gridChanges
```

默认按行对象引用识别记录，不依赖 `rowKey`。只有整体替换 `rows` 时还要把本地修改对账到新行对象，才配置 `{ rowKey, preserveChangesOnRowsReplace: true }`。详细的新增、修改、删除语义，以及与 FormSession 的接入方式见编辑会话。

`GridRowEvent<T>` 字段：

| 字段 | 说明 |
| --- | --- |
| `rowId` | 行 id。未配置 `rowKey` 时可能是 `null`。 |
| `key` | 触发事件的列 key，无法解析列时为 `null`。 |
| `column` | 触发事件的列定义。 |
| `input` | `'pointer' \| 'keyboard' \| 'api'`。 |
| `shiftKey` / `ctrlKey` / `metaKey` / `altKey` | 组合键状态。 |

## 选择模型

`selectionMode` 支持：

- `row`：行选择。适合查询列表和主从页面。
- `cell`：单元格选择。适合轻量编辑表。
- `range`：范围选择。适合复制、批量编辑和表格型录入。

`GridSelectionState<T>` 字段：

| 字段 | 说明 |
| --- | --- |
| `mode` | 当前选择模式。 |
| `selectedRows` | 选中的业务行对象。 |
| `selectedRowIds` | 选中的行 id。 |
| `currentCell` | 当前单元格。 |
| `selectedRanges` | 选区范围。 |
| `focusedRow` | 焦点行。 |
| `focusedKey` | 焦点列 key。 |
| `focusedColumn` | 焦点列定义。 |


## 键盘、鼠标和复制行为

- 鼠标点击数据行会更新焦点、当前行和选择状态。
- 鼠标双击数据行会触发 `onRowActivate`；单击只触发 `onRowClick`。表格不可编辑时，按 Enter 也会激活当前行。
- 拖拽列边界可调整列宽，前提是 `resizableColumns=true`。指针进入可调整边界时显示 `col-resize` 光标和弱预览线；按下拖动后使用更强的贯穿式指示线，离开、取消、禁用或释放能力时会清理反馈。
- 双击列边界可自动适配列宽，前提是 `autoFitColumns=true`。
- 表头右键或列菜单入口可打开列菜单。
- 鼠标滚轮滚动可视行，不会重建所有行对象。
- 选择文本溢出的单元格时，hover 会显示完整文本 tooltip。
- `getCopyText()` 返回当前选择对应的文本，供框架剪贴板逻辑使用。
- 编辑状态下键盘优先交给内置编辑器；非编辑状态下键盘用于选择和导航。
- 数字编辑状态下，上下方向键执行 `step` 步进；结束编辑后恢复为上下行导航。
- Popup 打开时，键盘优先交给 PopupManager 处理。

## 状态表现

`dataState` 为 `ready` 时显示数据。其他状态：

- `loading`：显示加载提示。
- `empty`：显示空数据提示。即使 `dataState='ready'`，可视行数为 0 时也会表现为空。
- `error`：显示错误提示。

状态文本由 `stateMessage` 控制。非 ready 且鼠标在主体区域时，主体交互会被忽略，避免在无数据状态下选中旧行。

整体状态：

- `disabled=true`：使用弱化遮罩表达不可操作状态，不显示 hover/focus，且不响应滚动、选择、复制、菜单或编辑。
- `readonly=true`：保持正常可读视觉和选择反馈；允许复制、滚动、排序、过滤和分组展开，但不允许修改业务数据。
- `editable=false`：只关闭单元格与结构编辑，不等价于整体禁用。
- 逐单元格 `disabled` 会弱化该单元格，`readonly` 保持普通可读外观；两者都允许鼠标选择，原因可通过 tooltip 查看。

## 样式和显示文本

`GridRowStyleArgs<T>` 包含 `row`、`rowId`、`theme`、`backgroundColor`、`selected`、`hovered`、`focused` 和 `editing`。其中 `backgroundColor` 是进入业务回调前已经解析出的当前状态背景；`GridCellStyleArgs<T>` 会把它更新为当前单元格实际使用的基础背景，并额外提供 `value`、`column` 和 `error`。

自定义列的 `renderColor(value, row, context)` 使用同一个 `GridCellStyleArgs<T>` 上下文。旧的两参数回调仍兼容；需要跨明暗主题和选中态保持可读时，应根据 `context.theme` 与 `context.backgroundColor` 解析颜色。

`resolveRowStyle(args)` 可返回：

| 字段 | 说明 |
| --- | --- |
| `backgroundColor` | 行背景色。 |
| `textColor` | 行文本色。 |
| `borderColor` | 行边框色。 |
| `fontSize` | 行字体大小。 |
| `fontFamily` | 行字体。 |

`resolveCellStyle(args)` 额外支持：

| 字段 | 说明 |
| --- | --- |
| `align` | 单元格对齐方式。 |

`getCellDisplayText(args)` 用于控制显示文本，不改变源数据值。典型场景：

- 枚举值显示成中文。
- 金额格式化。
- 日期格式化。
- 根据错误状态显示特殊文本。

## 持久化视图状态

使用 `getViewPreset()` 和 `applyViewPreset()` 可以保存和恢复：

- 列宽。
- 列顺序。
- 列隐藏。
- 固定列位置。
- 列宽模式。
- 排序。
- 结构化过滤。
- 过滤行文本。
- 快速过滤。

示例：

```ts
import type { RenderDataGrid } from 'ds-ui'

declare const grid: RenderDataGrid<any>

const preset = grid.getViewPreset()
localStorage.setItem('item-grid', JSON.stringify(preset))

const saved = localStorage.getItem('item-grid')
if (saved) {
  grid.applyViewPreset(JSON.parse(saved))
}
```

## 性能原则

- `rows` 应尽量保持业务对象稳定。需要变更事件、编辑会话或撤销时使用 `setCellValue()`；只有外部状态已经直接改写对象且不需要旧值时，才调用 `refreshRow(row)` 刷新呈现。
- 每个 DataGrid 实例会按 Lookup 列维护独立的 `valueKey → row` 索引。绘制、悬停、复制、筛选和分组只查询索引，不会在交互热路径反复扫描完整候选数组。
- 替换 Lookup 的 `rows` 引用、改变候选数量或替换列配置时索引会自动重建。同一数组保持相同长度但原地修改候选键时，调用 `refreshLookup(columnKey)` 明确刷新索引。
- Lookup 索引只负责已选值的显示解析；`queryProcessor` 仍决定 popup 中本次查询的候选结果、顺序和数量。
- 大数据下不要每次 hover、输入或滚动都重建 `columns` 和 `rows` 数组。
- `autoFitColumns` 和 `widthMode:'autoContent'` 会测量文本。组件内部有采样限制，但仍不应在高频路径反复触发。
- `getCellDisplayText`、`resolveRowStyle`、`resolveCellStyle`、`resolveCellEditPolicy` 会在绘制可视单元格时调用，逻辑必须轻量，不要访问网络或做大对象遍历。
- 过滤和排序在数据模型层执行。几十万行场景应在业务层考虑分页、服务端查询或防抖。
- 固定列会增加绘制分区，但仍只绘制可视行。


## 当前限制

- 排序、过滤、分组和汇总均在客户端数据模型中执行。几十万行或远程数据源应由业务层提供分页、服务端查询和防抖，不应一次传入全部数据。
- 虚拟化使用统一 `rowHeight`，当前不支持按行动态高度、合并单元格或跨行布局。
- `GridColumnCustom` 主要用于自定义显示；需要完整自定义交互或层级行时，应分别使用显式 editor 或 [TreeGrid](./tree-grid.md)。
- 只读状态面向交互约束；业务代码仍可通过 `setCellValue()`、替换 `rows` 等公开 API 主动更新数据。

## 常见组合

- 查询表单 + DataGrid：查询条件放在 [TextBox](../input/text-box.md)、[ComboBox](../selector/combo-box.md)、[DatePicker](../input/date-picker.md) 等组件中，查询后替换 `rows`。
- DataGrid + 命令按钮：使用 [CommandButton](../command/command-button.md) 或 [CommandToolbar](../command/command-toolbar.md) 控制新增、删除、导出、刷新。
- DataGrid + 弹窗编辑：行点击后打开 [Modal](../overlay/modal.md)、[Drawer](../overlay/drawer.md) 或 [Popup](../overlay/popup.md) 编辑详细信息。
- DataGrid + TreeGrid：普通列表用 DataGrid，有层级关系时用 [TreeGrid](./tree-grid.md)。

## 相关组件

- [TreeGrid 树表](./tree-grid.md)：层级数据表格。
- [Table 静态表格](./table.md)：少量静态数据展示。
- [EntryGrid 键值表格](./entry-grid.md)：表单型键值布局。
- [ListView 列表](./list-view.md)：单列列表和选择。
- [LookupEdit 查询选择](../selector/lookup-edit.md)：独立查询选择组件。
- [DropTreeGridEdit 树表下拉](../selector/drop-tree-grid-edit.md)：树表弹出选择。
- [CommandToolbar 命令工具栏](../command/command-toolbar.md)：表格上方操作区。
- [Runtime Diagnostics](../../lifecycle.md)：调试绘制、布局和事件。
