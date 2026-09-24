# EntryGrid 表单项网格

> **通用布局能力**：`RenderEntryGrid` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；列定义中的固定宽度只控制轨道，不替代组件自身布局属性。详见[组件通用布局属性](../common-layout-properties.md)。

DirectSurface UI 的高级表单项网格公共类名是 `RenderEntryGrid`。它用于把一组输入项、展示项或 `RenderFormField` 按精确列轨道排列，支持 `px`、`fr`、`auto` 三类轨道、列间距、行间距、`columnSpan`、`rowSpan`、行级校验反馈和 Enter 跳转到下一个焦点项。普通响应式表单优先使用 `RenderFormPanel`；只有需要精确轨道、跨行或高密度排列时才使用 EntryGrid。

`RenderEntryGrid` 不是数据表格。它不维护数据源、行对象、排序、选择或单元格编辑模型。多行多列业务数据使用 [DataGrid](./data-grid.md)，简单二维展示使用 [Table](./table.md)，对象属性查看使用 ObjectInspector。


## API 总览

```ts
import {
  RenderEntryGrid,
  RenderFormField,
  RenderText,
  RenderTextBox,
  auto,
  fieldTrack,
  fr,
  labelTrack,
  metaTrack,
  px,
  unitTrack,
  wideFieldTrack,
  type EntryGridChildData,
  type EntryGridEnterNavigation,
  type EntryGridTrack,
  type EntryGridTrackOptions,
  type EntryGridValidationPresentation,
} from 'directsurface'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderEntryGrid` | class | 表单项网格，负责列轨道、跨列、跨行、行级校验反馈和 Enter 导航。 |
| `EntryGridTrack` / `EntryGridTrackOptions` | type | 列轨道配置。 |
| `EntryGridChildData` | type | 子项跨度配置，包含 `columnSpan` 和 `rowSpan`。 |
| `EntryGridValidationPresentation` | type | 校验展示方式。 |
| `EntryGridEnterNavigation` | type | Enter 焦点移动策略。 |
| `px()` / `fr()` / `auto()` | function | 创建固定、弹性和自适应轨道。 |
| `labelTrack()` / `fieldTrack()` / `wideFieldTrack()` / `unitTrack()` / `metaTrack()` | function | 稳定公开的高级表单轨道快捷函数。 |

最小装配顺序是：定义 `columns`，创建 `RenderEntryGrid`，再按视觉顺序 `addChild(child, data?)`。它只负责布局和焦点导航，字段值、校验状态和提交逻辑都由业务或子控件维护。

## 何时使用

- 表单录入页：多列字段、字段标签、输入框和单位。
- 查询条件区：搜索框、下拉框、日期范围、树选择。
- 详情页属性区：姓名、年龄、部门、分组编号等键值型字段。
- 需要某些字段跨列或跨行，例如标题、分类、备注、多行文本。
- 需要把字段错误/警告集中绘制到当前行下方。
- 需要 Enter 在字段之间按视觉顺序移动焦点。

不适合：

- 需要滚动、排序或选择行的数据表格。
- 需要对象树展开查看的调试工具。
- 需要自动 label/value 语义的数据结构映射。`RenderEntryGrid` 只负责布局，字段值和校验由业务维护。
- 父容器不给明确宽度的场景。`RenderEntryGrid` 的列宽计算依赖 `constraints.maxWidth`。

## 最小示例

```ts
const nameInput = new RenderTextBox({ value: '', placeholder: '姓名' })
const ageInput = new RenderTextBox({ value: '', placeholder: '年龄' })

const entryGrid = new RenderEntryGrid({
  columns: [labelTrack(), fieldTrack(), labelTrack(), fieldTrack()],
  enterNavigation: 'next-focusable',
})

entryGrid.addChild(new RenderText('姓名'))
entryGrid.addChild(nameInput)
entryGrid.addChild(new RenderText('年龄'))
entryGrid.addChild(ageInput)
```

更常见的写法是每个字段都使用 `RenderFormField`，让 label、必填标记、单位、meta 和校验状态由字段壳处理：

```ts
const formGrid = new RenderEntryGrid({
  columns: [fieldTrack(), fieldTrack()],
  columnGap: 12,
  rowGap: 8,
})

formGrid.addChild(new RenderFormField({
  label: '条目姓名',
  required: true,
  child: new RenderTextBox({ value: '', placeholder: '请输入' }),
}))

formGrid.addChild(new RenderFormField({
  label: '联系电话',
  child: new RenderTextBox({ value: '', placeholder: '请输入手机号' }),
}))
```

## 构造参数

`new RenderEntryGrid(options)` 的 `options`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `columns` | `EntryGridTrack[]` | 必填 | 列轨道配置。 |
| `columnGap` | `number` | 主题 `columnGap` | 列间距。 |
| `rowGap` | `number` | 主题 `rowGap` | 行间距。 |
| `validationPresentation` | `'none' \| 'row-feedback'` | `'none'` | 校验信息展示方式。 |
| `enterNavigation` | `'none' \| 'next-focusable'` | `'none'` | Enter 未被子控件处理时是否移动焦点。 |

```ts
const queryGrid = new RenderEntryGrid({
  columns: [fieldTrack(), fieldTrack(), fieldTrack(), fieldTrack()],
  columnGap: 10,
  rowGap: 8,
  validationPresentation: 'row-feedback',
  enterNavigation: 'next-focusable',
})
```

## Track 类型

`EntryGridTrack` 有三种：

| 类型 | 创建函数 | 行为 |
| --- | --- | --- |
| `px` | `px(value, options?)` | 固定宽度。默认 min/max 都等于该宽度。 |
| `fr` | `fr(value, options?)` | 弹性轨道。按 grow 分配剩余空间，按 shrink 收缩。 |
| `auto` | `auto(options?)` | 根据单列 child 的自然宽度计算。 |

`EntryGridTrackOptions`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `min` | `number` | 轨道最小宽度。会同时考虑 child 的最小布局宽度提示。 |
| `max` | `number` | 轨道最大宽度。 |
| `grow` | `number` | 分配额外空间的权重。 |
| `shrink` | `number` | 宽度不足时收缩的权重。 |

```ts
const tracks: EntryGridTrack[] = [
  px(72),
  fr(1, { min: 120, shrink: 1 }),
  auto({ min: 48, max: 96 }),
]
```

## Track 快捷函数

这些 helper 是稳定 public API，不是内部布局细节。需要精确轨道时可以直接使用；普通表单不需要理解它们，使用 [FormPanel](../input/form-panel.md) 即可。

| 函数 | 等价配置 | 适用场景 |
| --- | --- | --- |
| `labelTrack(options?)` | `auto({ min: 56, shrink: 1, ...options })` | 独立 label 列。 |
| `fieldTrack(flex?, options?)` | `fr(flex, { min: 96, shrink: flex, ...options })` | 普通输入字段列。 |
| `wideFieldTrack(flex?, options?)` | `fr(flex, { min: 128, shrink: flex, ...options })` | 更宽的输入字段列。 |
| `unitTrack(options?)` | `auto({ min: 24, max: 72, shrink: 0, ...options })` | 单位列。 |
| `metaTrack(options?)` | `auto({ min: 40, max: 120, shrink: 1, ...options })` | 状态、meta、短提示列。 |

```ts
const vitalSignGrid = new RenderEntryGrid({
  columns: [
    labelTrack(),
    fieldTrack(),
    unitTrack(),
    labelTrack(),
    fieldTrack(),
    unitTrack(),
  ],
})
```

## 子项和跨度

`addChild(child, data?)` 的 `data` 类型是 `EntryGridChildData`：

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `columnSpan` | `number` | `1` | 横跨列数。会被限制在 `1..columns.length`。 |
| `rowSpan` | `number` | `1` | 横跨行数。小于 1 会规整为 1。 |

```ts
const summaryGrid = new RenderEntryGrid({
  columns: [fieldTrack(), fieldTrack(), fieldTrack(), fieldTrack()],
})

summaryGrid.addChild(new RenderFormField({
  label: '主诉',
  child: new RenderTextBox({ value: '', placeholder: '请输入主诉' }),
}), { columnSpan: 2 })

summaryGrid.addChild(new RenderFormField({
  label: '项目摘要',
  child: new RenderTextBox({ value: '', placeholder: '请输入摘要' }),
}), { columnSpan: 2, rowSpan: 2 })
```

布局采用从左到右、从上到下的 first-fit 算法。后添加的 child 会寻找第一个能放下 `columnSpan/rowSpan` 的空位。复杂跨行布局里，child 添加顺序会影响最终位置。

## 属性和方法

| API | 类型 / 返回值 | 说明 |
| --- | --- | --- |
| `children` | `readonly RenderBox[]` | 当前子项只读视图。 |
| `childData` | `ReadonlyMap<RenderBox, Readonly<EntryGridChildData>>` | 每个 child 的只读跨度配置。 |
| `columns` | `readonly EntryGridTrack[]` | 当前列轨道只读视图。修改列轨道使用 `setColumns()`。 |
| `columnGap` | `number \| undefined` | 列间距。赋值请求 layout。 |
| `rowGap` | `number \| undefined` | 行间距。赋值请求 layout。 |
| `validationPresentation` | `EntryGridValidationPresentation` | 校验展示方式。赋值请求 layout 和 paint。 |
| `enterNavigation` | `EntryGridEnterNavigation` | Enter 导航方式。 |
| `addChild(child, data?)` | `void` | 添加一个表单项。 |
| `insertChild(index, child, data?)` | `void` | 在指定索引插入子项。 |
| `removeChild(child)` | `boolean` | 移除子项并清理 parent/owner；未找到时返回 `false`。 |
| `moveChild(child, targetIndex)` | `boolean` | 调整子项的视觉顺序。 |
| `replaceChild(current, next, data?)` | `boolean` | 原位替换子项。 |
| `setChildData(child, data)` | `boolean` | 更新子项的 span 并请求重新布局。 |
| `getChildData(child)` | `Readonly<EntryGridChildData> \| undefined` | 读取子项的 span。 |
| `clearChildren()` | `void` | 移除所有 children，detach 已挂载子项。 |
| `setColumns(columns)` | `void` | 替换列轨道并请求 layout。 |
| `handleUnhandledEnterFromDescendant(target, event)` | `boolean` | 子控件未处理 Enter 时，由父网格尝试移动焦点。 |

```ts
const entryGrid = new RenderEntryGrid({
  columns: [fieldTrack(), fieldTrack()],
})

entryGrid.setColumns([fieldTrack(), fieldTrack(), wideFieldTrack()])
entryGrid.columnGap = 12
entryGrid.rowGap = 8
```

## 布局规则

列宽计算流程：

1. `px` 轨道以 `value` 作为自然宽度。
2. 单列 child 会先被 measure，用于推导 `auto` 和 `fr` 的自然宽度、最小宽度提示。
3. 每个轨道根据 `min/max/type` 得到 base width。
4. 如果容器有剩余宽度，按 grow 权重扩展。
5. 如果总宽度超过容器，按 shrink 权重收缩，且不低于 min。
6. `columnSpan` child 使用跨越列宽 + 中间 gap 的总宽度 layout。
7. `rowSpan` child 如果高度超过当前跨行高度，会把缺少高度平均分摊到覆盖的行。

```ts
const shrinkableGrid = new RenderEntryGrid({
  columns: [
    auto({ min: 56, shrink: 1 }),
    fr(1, { min: 96, shrink: 1 }),
    auto({ min: 56, shrink: 1 }),
    fr(2, { min: 128, shrink: 2 }),
  ],
})
```

`RenderEntryGrid` 自身不滚动。高度由内容自然撑开。如果表单很长，应把它放入 [ScrollView](../../layouts.md) 或页面滚动容器中。

## 校验展示

`validationPresentation`：

| 值 | 行为 |
| --- | --- |
| `'none'` | 不额外绘制行级反馈。`RenderFormField` 自己的状态和 adorners 仍按其自身规则工作。 |
| `'row-feedback'` | 收集当前行内 `RenderFormField` 的 error/warning message，在该行下方绘制反馈块。 |

行级反馈只收集满足以下条件的 child：

- child 是 `RenderFormField`。
- `child.message` 非空。
- `child.status` 是 `'error'` 或 `'warning'`。

```ts
const validationGrid = new RenderEntryGrid({
  columns: [fieldTrack(), fieldTrack()],
  validationPresentation: 'row-feedback',
})

validationGrid.addChild(new RenderFormField({
  label: '条目姓名',
  required: true,
  status: 'error',
  message: '条目姓名不能为空',
  child: new RenderTextBox({ value: '', placeholder: '请输入' }),
}))
```

反馈块会使用字段 label 和 message 拼成文本，例如 `条目姓名: 条目姓名不能为空`。当同一行有多个反馈块并且横向重叠时，会自动分到下一条 lane，避免互相覆盖。

当 EntryGrid 使用 `row-feedback` 时，它会在字段留在容器期间把 `RenderFormField` 的展示方式临时覆盖为 `status-only`。输入控件仍保留 error/warning 状态边框，但不再同时出现 badge tooltip 或 inline 文案。切回 `none` 或移除字段后，字段自身的 `validationDisplay` 自动恢复。

`message` 在布局后动态变化会请求 EntryGrid 重新布局。反馈块优先与字段的 editor lane 对齐，但宽度始终限制在字段实际 span 内；窄布局中如果 label 已占满 editor lane，则回退到整个字段 span，不会用固定最小宽度撑出容器。

## Enter 导航

`enterNavigation`：

| 值 | 行为 |
| --- | --- |
| `'none'` | 不处理子控件冒泡上来的 Enter。 |
| `'next-focusable'` | 普通 Enter 移动到下一个 focusable，Shift+Enter 移动到上一个。 |

`handleUnhandledEnterFromDescendant(target, event)` 会忽略 Ctrl、Meta、Alt 组合键。焦点移动使用 `FocusManager.instance.moveFocusFrom(target, dir, { withinRoot: this, wrap: false })`，因此只在当前 EntryGrid 内查找，不循环。

```ts
const keyboardGrid = new RenderEntryGrid({
  columns: [fieldTrack(), fieldTrack()],
  enterNavigation: 'next-focusable',
})
```

通常业务不需要直接调用 `handleUnhandledEnterFromDescendant()`，由输入组件和焦点系统协作触发。

## 动态更新

```ts
function rebuildQueryFields(grid: RenderEntryGrid): void {
  grid.clearChildren()
  grid.setColumns([fieldTrack(), fieldTrack(), fieldTrack()])
  grid.addChild(new RenderFormField({
    label: '关键字',
    child: new RenderTextBox({ value: '', placeholder: '请输入关键字' }),
  }), { columnSpan: 2 })
}
```

动态修改建议：

- 替换列轨道用 `setColumns()`。
- 局部变化用 `insertChild()`、`removeChild()`、`moveChild()`、`replaceChild()` 和 `setChildData()`。
- 整体重建前调用 `clearChildren()`，让旧 child 正常 detach。
- 调整间距用 `columnGap` / `rowGap` setter。
- 不要绕过结构 API 修改内部集合。合法修改会自动维护 parent/owner 并请求 layout。

## 主题和绘制

`RenderEntryGrid` 使用 `deriveEntryGridStyle(theme)`：

- 默认 `columnGap`、`rowGap`。
- 行级反馈的 gap、padding、圆角、字号、行高。
- error/warning 反馈块背景、边框和文本色。

普通 child 的绘制由 child 自己完成。`RenderEntryGrid` 只在 `validationPresentation === 'row-feedback'` 且有可收集消息时，在 children 绘制之后额外绘制反馈块。

## 与相关组件的区别

| 能力 | `RenderEntryGrid` | `RenderFormPanel` | `RenderDataGrid` |
| --- | --- | --- | --- |
| 主要用途 | 表单项二维布局 | 更完整的表单面板/分组 | 数据表格 |
| 数据模型 | 无，只布局 child | 面向表单组合 | 行列数据 |
| 子内容 | 任意 `RenderBox` | 表单组件组合 | 单元格文本/编辑器 |
| 校验展示 | 可选 row feedback | 表单面板语义 | 单元格校验 |
| 排序/选择 | 不支持 | 不支持 | 支持表格能力 |
| 滚动 | 不内置 | 取决于组合 | 表格内部滚动 |

普通表单的自动列数、label placement、完整字段配置和动态增删 API 已移到独立的 [FormPanel 与 FormField](../input/form-panel.md) 文档。业务仍通过 editor 的 `value + onChange` 手动维护状态；FormPanel 只自动处理布局。

## 常见问题

### 为什么 EntryGrid 的宽度不符合预期？

列宽计算依赖父级传入的 `constraints.maxWidth`。如果父级给了无限宽，EntryGrid 只能按有限信息计算，实际页面应把它放在有明确宽度约束的容器中。

### 为什么某个跨列字段位置不对？

EntryGrid 按 child 添加顺序 first-fit 排列。`columnSpan` 和 `rowSpan` 会占用网格格子，后续 child 会跳过已占用位置。复杂布局应先添加固定位置预期更强的字段。

### 为什么 row-feedback 没显示？

检查 child 是否是 `RenderFormField`，`status` 是否为 `'error'` 或 `'warning'`，并且 `message` 是否非空。普通 `RenderTextBox` 或其他 child 不会被 row-feedback 收集。

### 为什么 Enter 没有跳到下一个字段？

需要设置 `enterNavigation: 'next-focusable'`，并且当前子控件没有自己处理该 Enter。Ctrl/Meta/Alt + Enter 不会触发 EntryGrid 的焦点移动。

### EntryGrid 会帮我管理字段值吗？

不会。字段值、校验规则、保存、清空、远程查询都由业务组件或页面状态维护。EntryGrid 只负责布局和少量交互辅助。

## 相关文档

- [TextBox](../input/text-box.md)
- [FormPanel 与 FormField](../input/form-panel.md)
- [DatePicker](../input/date-picker.md)
- [ComboBox](../selector/combo-box.md)
- [LookupEdit](../selector/lookup-edit.md)
- [DataGrid](./data-grid.md)
- [Table](./table.md)
- ObjectInspector
- 表单指南
- [布局与约束](../../lifecycle.md)
