# ListView 列表

> **通用布局能力**：`RenderListView` 的 options 组合 `RenderBoxOptions`，列表实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；原有独立高度状态已经并入该契约。详见[组件通用布局属性](../common-layout-properties.md)。


DirectSurface UI 的列表组件公共类名是 `RenderListView`。它用于展示一维、固定行高的数据项，支持图标、尾部文本、禁用项、单选、激活、键盘焦点、复制当前项、纵向滚动条和固定行高虚拟绘制。

`RenderListView` 是轻量列表控件，不负责多列布局、树形层级、单元格编辑或复杂模板。多列数据使用 [DataGrid](./data-grid.md)，层级数据使用 [TreeView](./tree-view.md) 或 [TreeGrid](./tree-grid.md)，自由组合的列表区域使用 [ItemsControl](./items-control.md)。

## API 总览

```ts
import {
  RenderListView,
  type ListViewItem,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderListView<T>` | class | 固定行高单列列表，支持图标、尾部文本、单选、激活、复制和虚拟绘制。 |
| `ListViewItem<T>` | type | 列表项数据，包含稳定 `key`、`label`、可选 icon/trailingText/disabled/data。 |

最小装配顺序是：准备 `ListViewItem<T>[]`，创建 `RenderListView({ items })`，按需配置 `selectedItem`、`onSelect`、`onActivate` 和 `copyText`。`selectedItem` 必须是当前 `items` 数组中的对象引用，不是 key 字符串。

## 何时使用

- 诊断列表、日志列表、消息列表、搜索结果列表。
- 左侧导航中需要单选和激活的简单列表。
- 对象查看器、运行时诊断、开发工具面板中的条目列表。
- 数据量较大但每行高度固定，且只需要绘制可视行。
- 需要复制当前选中项的文本，方便调试和业务排查。

不适合：

- 每行高度不同，或行内容是复杂子组件树。
- 需要多列、排序、列宽调整或单元格编辑。
- 需要树形展开、复选框父子联动或层级缩进。
- 需要横向滚动。`RenderListView` 只做纵向滚动，文本超出会被裁剪。

## 最小示例

```ts
const items: ListViewItem[] = [
  { key: 'inbox', label: '收件箱', icon: 'bell', trailingText: '12' },
  { key: 'today', label: '今日任务', icon: 'calendar' },
  { key: 'archive', label: '归档', disabled: true },
]

const list = new RenderListView({
  items,
  selectedItem: items[0],
  onSelect: item => {
    state.selectedListKey = item.key
  },
  onActivate: item => {
    state.activatedListKey = item.key
  },
})
```

## 构造参数

`new RenderListView(options)` 的 `options`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `items` | `ListViewItem<T>[]` | 必填 | 列表数据。构造函数会复制一份数组引用。 |
| `selectedItem` | `ListViewItem<T> \| null` | `null` | 受控初始选中项。必须是 `items` 数组里的对象引用，且不能是 disabled 项。 |
| `defaultSelectedItem` | `ListViewItem<T> \| null` | `null` | 非受控初始选中项。只有 `selectedItem` 为空时使用。 |
| `width` / `height` | `number` | `undefined` | 来自 `RenderBoxOptions` 的期望尺寸。 |
| `minWidth` / `maxWidth` | `number` | `undefined` | 水平方向尺寸边界。 |
| `minHeight` / `maxHeight` | `number` | `undefined` | 垂直方向尺寸边界。 |
| `margin` | `EdgeInsetsInput` | `0` | 组件外部留白。 |
| `horizontalAlignment` / `verticalAlignment` | `BoxAlignment` | `undefined` | 组件在父布局槽位中的对齐方式。 |
| `disabled` | `boolean` | `false` | 整体禁用。禁用后不进入焦点顺序，不响应鼠标、键盘、滚轮和复制。 |
| `onSelect` | `(item, index) => void` | `undefined` | 选中项变化时触发。 |
| `onActivate` | `(item, index) => void` | `undefined` | 已选中项被激活时触发，例如鼠标 up 或 Enter。 |
| `copyable` | `boolean` | `true` | 是否允许通过统一复制系统复制当前项。 |
| `copyText` | `(item, index) => string \| null \| undefined` | `undefined` | 自定义复制文本。未提供时复制 `item.label`。 |

```ts
const diagnosticItems: ListViewItem<{ durationMs: number }>[] = [
  { key: 'paint', label: 'paint', trailingText: '3.2ms', data: { durationMs: 3.2 } },
  { key: 'layout', label: 'layout', trailingText: '0.8ms', data: { durationMs: 0.8 } },
]

const diagnostics = new RenderListView({
  items: diagnosticItems,
  height: 260,
  copyText: item => `${item.key}: ${item.trailingText ?? ''}`,
})
```

## ListViewItem

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `key` | `string` | 稳定唯一 key。用于选中、hover、调试和状态同步。 |
| `label` | `string` | 主文本。 |
| `icon` | `IconName` | 可选图标，绘制在主文本左侧。 |
| `trailingText` | `string` | 可选尾部文本，右对齐绘制。 |
| `disabled` | `boolean` | 禁用项不能被选中、激活或键盘确认。 |
| `data` | `T` | 业务数据。列表不读取该字段，只在回调和复制中透传。 |

```ts
const row: ListViewItem<{ route: string }> = {
  key: 'orders',
  label: '订单列表',
  icon: 'document',
  trailingText: '24',
  data: { route: '/orders' },
}
```

`key` 应保持稳定。更新 `items` 时，如果当前选中 key 仍存在且不是 disabled，选中状态会保留；否则会清空选中。

## 属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `items` | `ListViewItem<T>[]` | 当前数据。赋值时会复制数组、同步选中/hover/focus 状态并请求 layout。 |
| `selectedItem` | `ListViewItem<T> \| null` | 当前选中项。赋值时必须传入当前 `items` 中的对象引用。 |
| `width` / `height` | `number \| undefined` | 期望尺寸。赋值后请求 layout。 |
| `minWidth` / `maxWidth` | `number \| undefined` | 水平方向尺寸边界。赋值后请求 layout。 |
| `minHeight` / `maxHeight` | `number \| undefined` | 垂直方向尺寸边界。赋值后请求 layout。 |
| `margin` | `EdgeInsets` | 组件外部留白。赋值后请求 layout。 |
| `horizontalAlignment` / `verticalAlignment` | `BoxAlignment \| undefined` | 组件在父布局槽位中的对齐方式。 |
| `disabled` | `boolean` | 整体禁用状态。动态设置为 `true` 会退出焦点、清理 hover/focused/scrollbar dragging，并请求重绘。 |
| `onSelect` | `(item, index) => void` | 选中回调，可在构造后替换。 |
| `onActivate` | `(item, index) => void` | 激活回调，可在构造后替换。 |
| `isFocused` | `boolean` | 当前是否有焦点，只读。 |

```ts
function replaceListData(list: RenderListView, nextItems: ListViewItem[]): void {
  list.items = nextItems
  list.selectedItem = nextItems[0] ?? null
}
```

`selectedItem` 不是 key 字符串 API。下面这种写法不会生效：

```ts
const externalItem: ListViewItem = { key: 'inbox', label: '收件箱' }
const list = new RenderListView({
  items: [{ key: 'today', label: '今日任务' }],
})
list.selectedItem = externalItem
```

如果要根据 key 选中，应先从 `list.items` 中找到对象：

```ts
const list = new RenderListView({
  items: [
    { key: 'inbox', label: '收件箱' },
    { key: 'today', label: '今日任务' },
  ],
})
const target = list.items.find(item => item.key === 'inbox') ?? null
list.selectedItem = target
```

## 方法

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `focusIn()` | `void` | 设置焦点状态。没有 focused index 时优先使用选中项，否则使用第 0 项；整体 disabled 或 invisible 时不生效。 |
| `focusOut()` | `void` | 清除焦点状态。 |
| `getCopyText()` | `string \| null` | 返回当前可复制文本。整体 disabled、`copyable=false` 或无可复制项时返回 null。 |
| `onKeyDown(event)` | `boolean` | 处理方向键、Home/End、Space、Enter。 |
| `debugState()` | 对象 | 返回滚动、选中、hover、focus 和行高状态。 |
| `dispose()` | `void` | 从 `FocusManager` 注销并释放组件。 |

```ts
const list = new RenderListView({
  items: [{ key: 'inbox', label: '收件箱' }],
})
const copyText = list.getCopyText()
if (copyText) {
  state.lastCopiedText = copyText
}
```

业务通常不直接调用 `onKeyDown()`，由运行时焦点系统派发。单元测试和自定义容器接管键盘时可以调用它。

## debugState

`debugState()` 返回：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `scrollY` | `number` | 当前纵向滚动偏移。 |
| `selectedItem` | `ListViewItem<T> \| null` | 当前选中项。 |
| `selectedIndex` | `number` | 当前选中项索引，未选中为 `-1`。 |
| `hoveredKey` | `string` | 当前 hover 项 key。 |
| `focusedIndex` | `number` | 当前键盘焦点索引。 |
| `rowHeight` | `number` | 当前主题下的固定行高。 |

```ts
const list = new RenderListView({
  items: [{ key: 'inbox', label: '收件箱' }],
})
const listState = list.debugState()
state.listScrollY = listState.scrollY
state.listFocusedIndex = listState.focusedIndex
```

## 鼠标行为

| 操作 | 行为 |
| --- | --- |
| pointer down 命中列表项 | 列表获得焦点，选中该项，触发 `onSelect(item, index)`。 |
| pointer up 仍命中当前选中项 | 触发 `onActivate(item, index)`。 |
| pointer down 命中 disabled 项 | 不选中、不激活。 |
| 整体 `disabled = true` | 不接收焦点，不更新 hover，不响应点击、拖动滚动条或滚轮。 |
| pointer move 命中列表项 | 更新 hover 状态。 |
| pointer leave / cancel | 清除 hover 和滚动条 hover。 |
| pointer down 命中滚动条 | 捕获指针并开始拖动滚动条。 |
| pointer move 拖动滚动条 | 更新 `scrollY` 并阻止父级滚动手势。 |
| pointer up / cancel 滚动条拖动 | 释放指针捕获。 |

点击列表外部时，如果 pointer down 不命中列表，会清空当前焦点。

## 键盘行为

键盘只在列表获得焦点且整体未 disabled 后生效。

| 按键 | 行为 |
| --- | --- |
| ArrowDown | 焦点移动到下一个非 disabled 项。 |
| ArrowUp | 焦点移动到上一个非 disabled 项。 |
| Home | 焦点移动到第一个 item。 |
| End | 焦点移动到最后一个 item。 |
| Space | 选中 focused item，触发 `onSelect`。 |
| Enter | 选中 focused item，触发 `onSelect` 和 `onActivate`。 |

焦点移动使用 `scrollToIndex({ align: 'nearest' })`，如果 focused item 已在视口内，不会强制滚动到顶部。

## 复制行为

`RenderListView` 实现了 `CopyableSelection`：

- 整体 `disabled === true` 时，`getCopyText()` 返回 `null`。
- `copyable === false` 时，`getCopyText()` 返回 `null`。
- 有选中项时复制选中项。
- 没有选中项但有 focused item 时复制 focused item。
- 未提供 `copyText` 时复制 `item.label`。
- `copyText` 返回 `null` 或 `undefined` 时不复制。

```ts
const diagnosticItems: ListViewItem<{ durationMs: number }>[] = [
  { key: 'paint', label: 'paint', trailingText: '3.2ms', data: { durationMs: 3.2 } },
]

const requestList = new RenderListView<{ durationMs: number }>({
  items: diagnosticItems,
  copyText: (item, index) => {
    const duration = item.data?.durationMs ?? 0
    return `${index + 1}. ${item.label}: ${duration.toFixed(1)}ms`
  },
})
```

复制当前节点值、诊断项详情或业务 key 时，优先使用 `copyText`，不要把复杂对象直接拼在 `label` 中。

## 滚动和虚拟化

`RenderListView` 使用固定行高虚拟绘制：

- 总高度为 `items.length * rowHeight`。
- 绘制时用 `calcFixedVirtualRange()` 计算可视行。
- 默认 overscan 为 1 行。
- 只有可视行和少量缓冲行会被绘制。
- 纵向滚动条使用统一 scrollbar 绘制。
- 内容高度小于视口时不会消费 wheel。
- 内容溢出时，即使在顶部或底部边界，wheel 也会被消费，避免事件继续传给外层滚动容器。

这意味着 `RenderListView` 可以承载较大的简单列表，但要求每行高度一致。如果需要可变高度项，应使用支持测量缓存的专用列表，而不是在 `RenderListView` 内塞复杂内容。

## 布局尺寸

布局高度由三层共同决定：

1. 父级传入的 `BoxConstraints`。
2. `height`、`minHeight`、`maxHeight`。
3. 默认尺寸：无限宽约束下宽度为 `240`，无限高约束下高度为 `220`。

```ts
const sideItems: ListViewItem[] = [
  { key: 'inbox', label: '收件箱' },
  { key: 'today', label: '今日任务' },
]

const sideList = new RenderListView({
  items: sideItems,
  minHeight: 180,
  maxHeight: 420,
})
```

如果列表放在右侧诊断面板、弹窗或侧栏里，建议明确给 `height` 或 `maxHeight`，避免列表把父容器撑得过高。

## 绘制和主题

`RenderListView` 使用 `deriveListViewStyle(theme)` 和 `deriveScrollbarStyle(theme)`：

- panel 背景、边框、圆角。
- row normal/hovered/selected/disabled 背景。
- focused row 边框。
- label、trailingText、icon 的 normal/hovered/selected/disabled 文本色。
- font size、font family、row height、水平 padding。
- scrollbar thumb 和 track。

绘制顺序：

1. panel 背景和边框。
2. 内容区域 clip，保留滚动条 gutter。
3. 可视行背景和 focused ring。
4. icon。
5. label。
6. trailingText。
7. 垂直滚动条。

文本只裁剪，不自动换行，也不绘制省略号。需要省略号和 tooltip 的长文本列表，应使用更高层封装或专门组件。

## 动态数据更新

```ts
function applySearchResult(list: RenderListView, rows: ListViewItem[]): void {
  const previousKey = list.selectedItem?.key ?? ''
  list.items = rows
  list.selectedItem = rows.find(item => item.key === previousKey) ?? rows[0] ?? null
}
```

更新 `items` 时组件会同步内部状态：

- 当前选中 key 不存在或变成 disabled 时，清空选中。
- 当前 hover key 不存在时，清空 hover。
- focused index 超出新数组长度时，夹到最后一项。
- 重新夹取滚动范围。
- 请求 layout。

如果业务希望替换数据后滚动回顶部，目前没有公开 scroll API，应通过重新创建列表或后续扩展显式方法处理。

## 常见问题

### 为什么设置 selectedItem 后没有选中？

`selectedItem` 必须是当前 `items` 数组里的同一个对象引用，并且不能是 disabled 项。只传相同 key 的新对象不会选中。

### 为什么列表文字被裁剪？

`RenderListView` 是固定行高列表，主文本在内容区内 clip，尾部文本右对齐。它不做换行和横向滚动。长文本建议放到详情区，或改用支持 tooltip/省略号的业务封装。

### 为什么滚轮到顶部或底部后外层不滚动？

当列表内容溢出时，列表会在滚动边界继续消费 wheel。这是为了避免内嵌列表在顶部/底部把滚动传给外层容器，导致滚动体验跳变。

### 为什么 disabled 项还能成为 focused index？

`Home` 和 `End` 直接定位到首尾 item；如果首尾 item disabled，确认键不会触发选中或激活。方向键移动会跳过 disabled 项。

## 相关文档

- [DataGrid](./data-grid.md)
- [TreeView](./tree-view.md)
- [TreeGrid](./tree-grid.md)
- [ItemsControl](./items-control.md)
- [ScrollView](../../layouts.md)
- [选择与剪贴板](../../lifecycle.md)
- [主题与状态](../../themes.md)
- 大列表性能
