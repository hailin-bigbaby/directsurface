# PropertyGrid 属性表

> **通用布局能力**：`RenderPropertyGrid` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；构造器是否接收这些字段以参数表为准。详见[组件通用布局属性](../common-layout-properties.md)。


`RenderPropertyGrid` 用于展示和编辑对象属性。它适合导出设计器、报表设计器、控件检查器、配置面板等场景：左侧是属性名，右侧是当前值，并按 group 分组显示。

属性表本身不反射业务对象，也不直接保存业务模型。推荐做法是由业务层提供 `PropertyGridRow[]`，或者使用轻量 schema API 把对象状态转换成 rows。提交时仍由业务层通过 `onValueCommit` 决定是否接受变更。

## API 总览

```ts
import {
  RenderPropertyGrid,
  buildPropertyGridRows,
  definePropertyGridSchema,
  type PropertyGridField,
  type PropertyGridRow,
  type PropertyGridSchema,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderPropertyGrid` | class | 属性表控件，负责分组绘制、滚动、选中、键盘导航和编辑请求。 |
| `PropertyGridRow` | type | 单个属性行。 |
| `PropertyGridEditorKind` | type | 编辑器类型，例如 text、number、boolean、enum、color、date、image-source。 |
| `PropertyGridEditingState` | type | 当前内联或 Popup 编辑会话的只读快照。 |
| `PropertyGridEditContext` | type | 自定义 editor 的当前行、提交、显示更新和错误上报上下文。 |
| `PropertyGridEditorHandler` / `PropertyGridEditRequest` | type | `editorHandlers` 和 `onEditRequested` 的同步接管协议。 |
| `PropertyGridValueCommitRequest` / `PropertyGridValueCommitOptions` | type | 业务值提交门禁及单次提交覆盖选项。 |
| `buildPropertyGridRows()` | function | 根据 schema 和上下文生成 `PropertyGridRow[]`。 |
| `definePropertyGridSchema()` | function | 定义属性 schema，主要用于保留泛型上下文。 |
| `PropertyGridSchema` / `PropertyGridField` | type | 属性描述模型。 |

## 何时使用

- 设计器右侧属性面板。
- 对象检查器、调试面板、配置面板。
- 需要按分组展示大量键值属性。
- 需要 enum、boolean、color、date 等不同编辑入口。
- 需要键盘上下移动选中行，并通过 Enter 或 F2 打开编辑。

不适合：

- 多行业务数据维护。使用 [DataGrid](./data-grid.md)。
- 常规表单录入。使用 [EntryGrid](./entry-grid.md) 或表单组件。
- 树形对象结构浏览。使用 [TreeView](./tree-view.md) 或专用对象检查器。

## 最小示例

```ts
const grid = new RenderPropertyGrid({
  rows: [
    { group: 'Text', name: 'Text', value: '姓名', editable: true, editor: 'text', propPath: 'object.text' },
    { group: 'Text', name: 'Color', value: '#111827', editable: true, editor: 'color', propPath: 'object.color' },
    { group: 'Text', name: 'Wrap', value: 'true', editable: true, editor: 'boolean', propPath: 'object.wrap' },
  ],
  onValueCommit: (row, nextValue) => {
    // 更新业务对象；返回 false 可拒绝提交。
    return true
  },
})
```

`nameColumnWidth` 用于设置属性名列的初始宽度，也可以在运行时通过同名属性读写。用户可直接拖动属性名与属性值之间的分隔线调整宽度；组件会为两侧保留最小可用宽度。

## Schema 生成 rows

schema 是一个轻量适配层。它不要求业务对象有 attribute，也不做运行时反射；每个字段显式声明如何从当前上下文取值、显示、编辑和分组。

```ts
interface TextObjectContext {
  object: {
    text: string
    color?: string
    wrap?: boolean
  }
}

const textObjectSchema = definePropertyGridSchema<TextObjectContext>([
  {
    group: 'Text',
    name: 'Text',
    propPath: 'object.text',
    value: (context: TextObjectContext) => context.object.text,
    editor: 'text',
    editable: true,
  },
  {
    group: 'Text',
    name: 'Color',
    propPath: 'object.color',
    value: (context: TextObjectContext) => context.object.color ?? '#111827',
    editor: 'color',
    editable: true,
  },
  {
    group: 'Text',
    name: 'Wrap',
    propPath: 'object.wrap',
    value: (context: TextObjectContext) => context.object.wrap !== false,
    editor: 'boolean',
    editable: true,
  },
])

const object = {
  text: '姓名',
  color: '#111827',
  wrap: true,
}

const rows = buildPropertyGridRows({ object }, textObjectSchema)
```

`PropertyGridField` 常用字段：

| 字段 | 说明 |
| --- | --- |
| `group` / `name` | 分组和属性名。 |
| `id` | 稳定行 id。存在同名属性时建议提供。 |
| `propPath` | 业务属性路径，提交、定位、错误映射常用。 |
| `value` | 静态值或 `(context) => value`。 |
| `format` | 把原始值格式化为显示文本，例如 `210 mm`。 |
| `editor` | 指定编辑器类型。 |
| `editable` | 是否可编辑，可根据上下文动态计算。 |
| `enumItems` | enum 编辑器的候选项。 |
| `visibleWhen` | 条件显示字段。 |
| `description` / `status` / `errorText` | 辅助说明和状态提示。 |
| `unit` / `step` | 数字编辑的单位和步进元数据。unit 不进入编辑草稿。 |
| `min` / `max` / `decimals` | 数字编辑的范围和精度；未指定 decimals 时根据 step 和当前值推导。 |
| `clearable` | enum、color、date 是否允许提交空值，默认 false。 |

## 交互行为

- 单击属性行会选中当前行。
- 拖动属性名列与属性值列之间的分隔线可调整两列宽度。
- 属性名或属性值被截断时，悬浮会显示完整文本；未截断的内容不会显示冗余提示。
- 单击 text/number 的 value 单元格会进入 Canvas 内联编辑，并按点击位置放置光标；双击选择单词。
- enum、color、date 分别复用 ComboBox、ColorPicker、DatePicker 的 Popup。
- boolean 行可通过鼠标或 Space 直接切换。
- ArrowUp 和 ArrowDown 在属性行之间移动选中项。
- Enter 或 F2 对当前选中可编辑行发起编辑，并全选 text/number 初始草稿。
- 内联编辑时 Enter 提交，Escape 取消，Tab/Shift+Tab 提交成功后继续编辑下一个/上一个可编辑属性。
- text/number 内联编辑复用统一 `InputComposer`，中文等 IME composition 期间不会把 Enter、Escape 或方向键误判为 PropertyGrid 命令；composition 完成后再进入正常提交和导航流程。
- number 支持 ArrowUp/ArrowDown 和单元格右侧步进按钮；步进只修改草稿，结束编辑时才提交。
- `onValueCommit` 返回 false 时保持草稿和当前编辑位置，不移动 Tab 目标。
- `rowRectById()` 可用稳定 id 获取弹窗锚点，避免同组同名属性定位错误。

编辑会话 API：

| API | 说明 |
| --- | --- |
| `isEditing` | 是否存在内联或 Popup 编辑会话。 |
| `editingState` | 当前编辑行、editor、模式、草稿或错误的只读快照。 |
| `commitEdit()` | 提交当前内联编辑；Popup editor 需要在自身面板中确认。 |
| `cancelEdit()` | 取消当前内联或 Popup 草稿。 |

## 属性说明面板

设置 `showDescriptionPanel: true` 后，PropertyGrid 会在底部显示当前选中属性的名称、`description` 和状态信息。鼠标点击属性或通过 ArrowUp、ArrowDown 切换属性时，说明同步更新；悬浮只负责属性名和值的截断提示，不会改变说明内容。

```ts
const grid = new RenderPropertyGrid({
  showDescriptionPanel: true,
  descriptionEmptyText: '选择属性查看用途和取值规则。',
  selectedRowId: 'maximum-decimals',
  rows: [{
    id: 'maximum-decimals',
    group: 'Format',
    name: 'Maximum Decimals',
    value: '2',
    description: '格式化结果最多保留的小数位数。超过的部分会按照当前数值格式执行四舍五入。',
  }],
})
```

说明面板按可用宽度对标题、说明和 `errorText` 完整换行，并根据实际行数自动调整高度，不使用省略号或依赖 Tooltip。PropertyGrid 高度不足时会优先保留可操作的属性列表区域；只有完整说明确实无法同时放下时，说明正文才启用独立滚动。

属性列表与说明面板之间的横向分隔条支持拖动：

- 默认使用自动高度。
- 拖动分隔条后进入当前实例的手动高度模式。
- 双击分隔条或调用 `resetDescriptionPanelHeight()` 恢复自动高度。
- 宽度、选中属性或 rows 变化后，自动模式会重新测量完整说明。

`showDescriptionPanel` 默认为 `false`，因此现有 PropertyGrid 不会因为升级而改变布局。属性密集、业务含义复杂的设计器和检查器应显式开启。

## 编辑器协议

`PropertyGrid` 不依赖 JS attribute，也不反射业务对象。text、number、boolean、enum、color、date 是通用内建 editor；复杂业务 editor 继续由 `editorHandlers` 或 `onEditRequested` 接管。

```ts
const grid = new RenderPropertyGrid({
  rows: [
    { group: 'Image', name: 'Source', value: '', editable: true, editor: 'image-source', propPath: 'object.source' },
    { group: 'Advanced', name: 'Expression', value: '', editable: true, editor: 'expression', propPath: 'object.expression' },
  ],
  editorHandlers: {
    'image-source': context => {
      // 可覆盖内建图片选择行为，例如接入资源库。
      context.commit('data:image/png;base64,...')
    },
  },
  onEditRequested: (row, context) => {
    if (context.editor !== 'expression') return false
    // 打开表达式语言专用窗口；完成后调用 context.commit()。
  },
  onEditError: (row, message) => {
    // 把编辑错误映射回业务状态或属性行错误。
  },
})
```

为兼容既有宿主，编辑请求处理优先级是：

1. `editorHandlers[editor]`：开发者显式接管某类编辑器。
2. 既有 `image-source` 内建编辑器。
3. `onEditRequested(row, context)`：既有宿主编辑入口。
4. text、number、boolean、enum、color、date 通用内建 fallback。

编辑处理函数是同步接管协议：返回 `false` 表示当前处理器不处理，PropertyGrid 会继续尝试后续处理器；返回 `true` 或不返回值表示已经接管。需要异步工作的编辑器，例如文件选择、资源库弹窗或外部对话框，应在处理器内部启动异步流程，并在完成后调用 `context.commit()` 或 `context.setError()`。

`PropertyGridEditContext` 提供：

| 字段 | 说明 |
| --- | --- |
| `row` / `editor` | 当前属性行和编辑器类型。 |
| `commit(nextValue)` | 提交值，会继续走 `onValueCommit` 校验。 |
| `updateDisplayValue(value)` | 只更新属性表显示值，不提交业务对象。 |
| `setError(message)` | 通知宿主编辑失败。 |

### 提交、校验和焦点边界

`onValueCommit` 是同步业务提交门禁。返回 `false` 表示拒绝本次值；返回 `true` 或不返回值表示接受。业务校验异常不应从回调中抛出，应在宿主边界捕获并转换为 `false`，同时通过日志、通知或下一轮 rows 的 `errorText` 展示详细原因：

```ts
const grid = new RenderPropertyGrid({
  rows: buildRows(currentObject),
  onValueCommit: (row, nextValue) => {
    try {
      updateBusinessObject(currentObject, row.propPath, nextValue)
      grid.rows = buildRows(currentObject)
      return true
    } catch (error) {
      showPropertyError(row, error)
      return false
    }
  },
})
```

回调执行时，当前 inline/Popup 会话还没有完成收尾。不要在 `onValueCommit` 内同步调用 `FocusManager.setFocus()`、`requestFocus()` 或强制聚焦另一个组件，否则外部组件的 `focusOut()` 可能重入同一次提交。正常提交应让 PropertyGrid 或 Popup 自己完成关闭和来源焦点恢复；确有业务跳转需求时，应由提交完成后的外层命令执行。

当 rows 跟随 TreeView、列表或设计画布的当前选择变化时，提交必须绑定“生成当前 rows 的对象”，不能在提交发生后重新猜测目标。切换对象前先处理活动编辑：

```ts
let rowsTarget: DesignerObject | null = null

function showObject(target: DesignerObject | null): void {
  rowsTarget = target
  grid.rows = target ? buildRows(target) : []
}

function selectObject(next: DesignerObject): boolean {
  const state = grid.editingState
  if (state?.mode === 'inline') {
    // 外部 focusOut 校验失败后草稿处于 suspended；不要再次提交。
    if (state.suspended || !grid.commitEdit()) return false
  } else if (state?.mode === 'popup') {
    grid.cancelEdit()
  }
  showObject(next)
  return true
}

grid.onValueCommit = (row, nextValue) => {
  if (!rowsTarget) return false
  return updateDesignerObject(rowsTarget, row.propPath, nextValue)
}
```

### 可清空数字

内建 number editor 要求草稿是有效数字，空草稿会被拒绝。如果业务把空值解释为“删除约束”或 `undefined`，不要改变所有 number 行的通用语义；为该属性声明业务 editor，并通过 `editorHandlers` 复用现有 Prompt、NumberEdit 或业务窗口：

```ts
const grid = new RenderPropertyGrid({
  rows: [{
    group: 'Constraints',
    name: 'Maximum',
    value: maximum == null ? '' : String(maximum),
    editor: 'nullable-number',
    editable: true,
  }],
  editorHandlers: {
    'nullable-number': editContext => {
      void openNullableNumberDialog(editContext.row.value)
        .then(input => {
          if (input == null) return
          if (!input.trim()) {
            editContext.commit(undefined)
            return
          }
          const value = Number(input)
          if (!Number.isFinite(value)) {
            editContext.setError('请输入有效数字')
            return
          }
          editContext.commit(value)
        })
        .catch(error => editContext.setError(String(error)))
      return true
    },
  },
  onValueCommit: (row, nextValue) => updateConstraint(row.name, nextValue),
})
```

`image-source` 的内建行为只负责本地文件选择和 `FileReader.readAsDataURL()` 转换。它提交的是 `data:image/...;base64,...`；业务层仍应在 `onValueCommit` 中决定是否接受该值。远程 URL 不属于这个内建编辑器的默认契约。

`activateValue(group, name)` 保持立即动作语义：boolean 直接切换，enum 循环到下一项；它不会打开 Popup。`requestEdit(group, name)` 才进入完整编辑请求路由。

## 设计边界

`RenderPropertyGrid` 只处理通用交互和展示。业务应该负责：

- 根据当前对象生成 rows。
- 根据 `propPath` 或 `id` 提交变更。
- 为 expression、options、border 等业务专用类型提供编辑器。
- 校验输入并把错误映射回属性行。

这种边界让属性表可以同时服务导出设计器、业务编辑器和普通业务配置面板，而不需要引入语言级 attribute 或业务反射模型。
