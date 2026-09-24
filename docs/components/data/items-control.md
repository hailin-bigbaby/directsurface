# ItemsControl 项容器

> **通用布局能力**：`RenderItemsControl` 的 options 组合 `RenderBoxOptions`，可直接配置 `width`、`height`、min/max、`margin` 和槽位对齐；item 内部 padding 是 item 外观配置。详见[组件通用布局属性](../common-layout-properties.md)。

DirectSurface UI 的模板项容器公共类名是 `RenderItemsControl`。它按业务数据数组生成一组 `RenderItemContainer`，每个 item 通过 `itemTemplate(item, state, index)` 返回一个子组件。它支持纵向/横向排列、可变尺寸 item、单选、激活、hover、键盘焦点、内部滚动条、滚动定位和虚拟化。

`RenderItemsControl` 是“数据项到组件树”的通用容器。标准文本列表优先用 [ListView](./list-view.md)，多列表格用 [DataGrid](./data-grid.md)，树形数据用 [TreeView](./tree-view.md)，纯布局组合用 [StackPanel](../../layouts.md)、[Wrap](../../layouts.md) 或 [Masonry](../../layouts.md)。


## API 总览

```ts
import {
  RenderItemsControl,
  RenderText,
  rgba,
  type ItemContainerState,
  type ItemContainerStyleOverrides,
  type ItemTemplate,
  type ItemsControlItemMetrics,
  type ItemsControlOrientation,
  type ItemsControlScrollAlign,
  type ItemsControlScrollMode,
  type ItemsControlSelectionChange,
  type ItemsControlSelectionMode,
  type ItemsControlVirtualizationOptions,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderItemsControl<T>` | class | 按数据项生成 item 容器和模板子树，支持选择、激活、滚动和虚拟化。 |
| `ItemTemplate<T>` | type | `itemTemplate(item, state, index)` 的模板函数类型。 |
| `ItemContainerState` | type | item 模板收到的视觉状态，包含 selected、hovered、focused、disabled。 |
| `ItemContainerStyleOverrides` | type | item 容器实例级样式覆盖，只覆盖传入字段，其余继续使用 `itemAppearance` 的主题规则。 |
| `ItemsControlSelectionChange<T>` | type | 用户交互导致选中变化时的回调 payload。 |
| `ItemsControlItemMetrics` | type | 已布局 item 的 key、索引、主轴位置和尺寸。 |
| `ItemsControlVirtualizationOptions` | type | 虚拟化开关、估算尺寸和 overscan 配置。 |
| `ItemsControlOrientation` | type | 主轴方向：`vertical` 或 `horizontal`。 |
| `ItemsControlSelectionMode` | type | 选择模式：`single` 或 `none`。 |
| `ItemsControlScrollMode` / `ItemsControlScrollAlign` | type | 内部滚动和滚动定位配置。 |

最小装配顺序是：准备稳定 key 的 `items`，提供 `getKey` 和 `itemTemplate`，再创建 `RenderItemsControl<T>`。模板必须为每个 item 返回新的 `RenderBox` 实例，不要复用同一个子组件。

## 何时使用

- 每一项都需要业务模板，例如条目卡片、任务卡片、消息卡片、搜索结果卡片。
- 行高或卡片尺寸可能不同。
- 需要在 item 上统一绘制 selected、hovered、focused、disabled 状态。
- 需要大数据虚拟化，但每项仍由模板组件绘制。
- 需要横向列表、横向滚动或纵向列表内部滚动。
- 需要 `scrollToIndex()`、`scrollToKey()` 和 item metrics 支持外部定位。

不适合：

- 只是简单文本行，使用 [ListView](./list-view.md)。
- 有列头、排序、列宽和单元格编辑，使用 [DataGrid](./data-grid.md)。
- 数据有父子层级，使用 [TreeView](./tree-view.md) 或 [TreeGrid](./tree-grid.md)。
- item 模板很重但未开启虚拟化。大数据下应开启 `virtualization.enabled`。

## 最小示例

```ts
interface TaskItem {
  id: string
  title: string
}

const taskItems: TaskItem[] = [
  { id: 'task-1', title: '核对文档' },
  { id: 'task-2', title: '提交审核' },
]

const taskList = new RenderItemsControl<TaskItem>({
  items: taskItems,
  getKey: item => item.id,
  itemTemplate: (item, state) => new RenderText(state.selected ? `* ${item.title}` : item.title),
  onSelectionChange: change => {
    state.selectedTaskId = change.item.id
  },
})
```

`itemTemplate` 返回的是组件实例。不要在模板里复用同一个 `RenderBox` 实例，每个 item 都应该返回新的子组件。

`ItemContainerState` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `selected` | `boolean` | 当前 item 是否被选中。 |
| `hovered` | `boolean` | 鼠标是否悬停在 item 容器上。 |
| `focused` | `boolean` | item 容器是否拥有键盘焦点。 |
| `disabled` | `boolean` | 当前 item 是否禁用。禁用项不能被选择或激活。 |

## 构造参数

`new RenderItemsControl(options)` 的 `options`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `items` | `T[]` | 必填 | 数据项。构造函数会复制数组。 |
| `getKey` | `(item, index) => string` | 必填 | 返回稳定 key。用于 diff、选择、hover、focus、虚拟化和滚动定位。 |
| `itemTemplate` | `ItemTemplate<T>` | 必填 | 为每个 materialized item 创建子组件。 |
| `selectedItem` | `T \| null` | `null` | 初始选中项。必须是 `items` 中的同一对象引用。 |
| `defaultSelectedItem` | `T \| null` | `null` | 非受控初始选中项。只有 `selectedItem` 为空时使用。 |
| `onSelectionChange` | `(change) => void` | `undefined` | 用户交互导致选中变化时触发。 |
| `onActivate` | `(item, index) => void` | `undefined` | item 被激活时触发。 |
| `onItemHover` | `(item \| null, index) => void` | `undefined` | hover item 变化时触发。离开时 `item` 为 `null`，`index` 为 `-1`。 |
| `orientation` | `'vertical' \| 'horizontal'` | `'vertical'` | 主轴方向。 |
| `selectionMode` | `'none' \| 'single'` | `'single'` | 是否启用单选。 |
| `scrollMode` | `'none' \| 'auto'` | `'auto'` | 是否允许内部滚动条。 |
| `spacing` | `number` | 主题 `itemSpacing` | item 之间的主轴间距。 |
| `itemMinHeight` | `number` | `undefined` | 传给每个 `RenderItemContainer` 的最小高度。 |
| `itemPaddingY` | `number` | `undefined` | 传给每个 `RenderItemContainer` 的垂直 padding。 |
| `itemShowAccent` | `boolean` | `true` | 选中时是否绘制左侧 accent。 |
| `itemAppearance` | `ItemContainerAppearance` | `'default'` | item 容器外观：`'default'`、`'navigation'`、`'row'`。 |
| `itemStyle` | `ItemContainerStyleOverrides` | `undefined` | 传给每个 `RenderItemContainer` 的实例级样式覆盖。未传字段继续使用 `itemAppearance` 的主题样式。 |
| `width` / `height` | `number` | `undefined` | 来自 `RenderBoxOptions` 的期望尺寸。 |
| `minWidth` / `maxWidth` | `number` | `undefined` | 尺寸边界；`maxWidth` 常用于限制横向滚动列表的视口宽度。 |
| `minHeight` / `maxHeight` | `number` | `undefined` | 垂直方向尺寸边界。 |
| `margin` | `EdgeInsetsInput` | `0` | 组件外部留白。 |
| `horizontalAlignment` / `verticalAlignment` | `BoxAlignment` | `undefined` | 组件在父布局槽位中的对齐方式。 |
| `disabled` | `boolean` | `false` | 禁用整个容器。 |
| `virtualization` | `ItemsControlVirtualizationOptions` | 关闭 | 虚拟化配置。 |
| `isItemDisabled` | `(item, index) => boolean` | `undefined` | 判断单项是否禁用。 |
| `isItemSelectable` | `(item, index) => boolean` | `undefined` | 判断单项是否可选中。不可选项仍可激活。 |

```ts
interface ItemCard {
  id: string
  name: string
  groupCode: string
}

const itemCards: ItemCard[] = [
  { id: 'p1', name: 'Alice', groupCode: 'A-12' },
  { id: 'p2', name: 'Bob', groupCode: 'B-18' },
]

const items = new RenderItemsControl<ItemCard>({
  items: itemCards,
  getKey: item => item.id,
  itemAppearance: 'row',
  itemMinHeight: 36,
  itemTemplate: item => new RenderText(`${item.groupCode} ${item.name}`),
})
```

## Item 容器样式覆盖

`itemAppearance` 选择一套主题外观，`itemStyle` 在单个 `RenderItemsControl` 实例上覆盖其中一部分 token。覆盖是按字段合并的：`background`、`border`、`text` 会深合并状态 token，`paddingX`、`paddingY`、`minHeight`、`borderRadius`、`borderWidth`、`borderPlacement`、`accentWidth`、`accentColor` 和 `focusColor` 会按传入值替换。

`itemStyle: undefined` 表示完全使用 `itemAppearance` 的主题样式。

```ts
import { RenderItemsControl, RenderText, rgba } from 'ds-ui'

interface MenuItem {
  id: string
  title: string
}

const lightLinkList = new RenderItemsControl<MenuItem>({
  items: menus,
  getKey: item => item.id,
  itemAppearance: 'navigation',
  itemShowAccent: false,
  itemMinHeight: 26,
  itemPaddingY: 0,
  itemStyle: {
    background: { normalBg: rgba(0, 0, 0, 0) },
    borderWidth: 0,
  },
  itemTemplate: item => new RenderText(item.title, {
    role: 'accent',
    overflow: 'ellipsis',
  }),
  onActivate: item => openMenu(item.id),
})
```

上例只把 normal 背景改成透明并关闭边框，hover、selected、focused、disabled 的背景和文字状态仍来自 `navigation` 外观。模板里只放展示内容，让 `RenderItemsControl` 继续统一负责 pointer、selection、activate、hover、滚动和键盘导航。

## ItemTemplate

`ItemTemplate<T>` 的签名：

```ts
interface TaskItem {
  id: string
  title: string
}

const taskTemplate: ItemTemplate<TaskItem> = (item, itemState, index) => {
  const prefix = itemState.focused ? `${index + 1}. ` : ''
  return new RenderText(`${prefix}${item.title}`)
}
```

`itemState` 包含：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `selected` | `boolean` | 当前 item 是否被选中。 |
| `hovered` | `boolean` | 当前 item 是否 hover。 |
| `focused` | `boolean` | 当前 item 是否键盘焦点项。 |
| `disabled` | `boolean` | 当前 item 是否禁用。 |

模板会在这些情况下重新执行：

- item 数据引用变化或 index 变化。
- disabled 状态变化。
- selected、hovered、focused 状态变化。
- `itemMinHeight`、`itemPaddingY`、`itemShowAccent`、`itemAppearance` 等容器选项变化。

模板里可以返回交互子组件。`RenderItemsControl` 会检查 hit test path，如果事件已经命中 item 内部的交互子组件，就不会抢占 pointer down/up。

## 选择模型

`selectionMode`：

| 值 | 行为 |
| --- | --- |
| `'single'` | 点击可选 item 或按 Space/Enter 会选中单项。 |
| `'none'` | 不维护选中项，但仍支持 hover 和 `onActivate`。 |

```ts
interface TaskItem {
  id: string
  title: string
}

const taskItems: TaskItem[] = [
  { id: 'task-1', title: '核对文档' },
  { id: 'task-2', title: '提交审核' },
]

const actionList = new RenderItemsControl<TaskItem>({
  items: taskItems,
  getKey: item => item.id,
  selectionMode: 'none',
  itemTemplate: item => new RenderText(item.title),
  onActivate: item => {
    state.lastActionId = item.id
  },
})
```

`selectedItem` 必须是当前 `items` 数组中的对象引用。只传相同 key 的新对象不会选中：

```ts
interface TaskItem {
  id: string
  title: string
}

const taskItems: TaskItem[] = [
  { id: 'task-1', title: '核对文档' },
  { id: 'task-2', title: '提交审核' },
]

const taskList = new RenderItemsControl<TaskItem>({
  items: taskItems,
  getKey: item => item.id,
  itemTemplate: item => new RenderText(item.title),
})

const selectedTask = taskList.items.find(item => item.id === 'task-2') ?? null
taskList.selectedItem = selectedTask
```

程序设置 `selectedItem` 不触发 `onSelectionChange`。只有用户交互导致选中变化时才触发回调。

## 可选、禁用和激活

`isItemDisabled(item, index)` 用于禁用 item：

- 禁用项不响应选中、激活和键盘确认。
- disabled 状态会传给模板。
- 容器整体 `disabled = true` 时，所有 item 都视为 disabled。

`isItemSelectable(item, index)` 用于把某些 item 从选择模型里排除：

- 不可选项不会替换当前选中项。
- 如果提供了 `onActivate`，不可选项仍可以被激活。
- 适合分组标题、快捷操作行、说明行。

```ts
interface TaskItem {
  id: string
  title: string
}

const taskItems: TaskItem[] = [
  { id: 'group', title: '待办任务' },
  { id: 'task-1', title: '核对文档' },
]

const mixedList = new RenderItemsControl<TaskItem>({
  items: taskItems,
  getKey: item => item.id,
  isItemSelectable: (_item, index) => index !== 0,
  itemTemplate: item => new RenderText(item.title),
  onActivate: item => {
    state.activatedTaskId = item.id
  },
})
```

## 属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `items` | `T[]` | 当前数据。赋值时复制数组、同步 key、diff 容器并请求 layout。 |
| `selectedItem` | `T \| null` | 当前选中项。赋值会自动滚动到可见。 |
| `orientation` | `ItemsControlOrientation` | 主轴方向。修改后请求 layout。 |
| `selectionMode` | `ItemsControlSelectionMode` | 选择模式。设为 `'none'` 会清空选中。 |
| `scrollMode` | `ItemsControlScrollMode` | 滚动模式。`'none'` 会把 `scrollX/scrollY` 夹到 0。 |
| `virtualization` | `ItemsControlVirtualizationOptions` | 虚拟化配置。修改后重建虚拟器并重新 materialize。 |
| `spacing` | `number \| undefined` | item 间距。 |
| `itemMinHeight` | `number \| undefined` | item 容器最小高度。 |
| `itemPaddingY` | `number \| undefined` | item 容器垂直 padding。 |
| `itemShowAccent` | `boolean` | 选中 accent 开关。 |
| `itemAppearance` | `ItemContainerAppearance` | item 容器外观。 |
| `itemStyle` | `ItemContainerStyleOverrides \| undefined` | item 容器实例级样式覆盖。赋值后会同步已有容器并请求 layout/paint。 |
| `width` / `height` | `number \| undefined` | 期望尺寸。赋值后请求 layout。 |
| `minWidth` / `maxWidth` | `number \| undefined` | 水平方向尺寸边界。赋值后请求 layout。 |
| `minHeight` / `maxHeight` | `number \| undefined` | 垂直方向尺寸边界。赋值后请求 layout。 |
| `margin` | `EdgeInsets` | 组件外部留白。赋值后请求 layout。 |
| `horizontalAlignment` / `verticalAlignment` | `BoxAlignment \| undefined` | 组件在父布局槽位中的对齐方式。 |
| `scrollX` | `number` | 横向滚动偏移。 |
| `scrollY` | `number` | 纵向滚动偏移。 |
| `disabled` | `boolean` | 整体禁用。 |
| `isFocused` | `boolean` | 是否有焦点，只读。 |

```ts
const taskList = new RenderItemsControl({
  items: [{ id: 'task-1', title: '核对文档' }],
  getKey: item => item.id,
  itemTemplate: item => new RenderText(item.title),
})

taskList.spacing = 6
taskList.itemAppearance = 'row'
taskList.maxHeight = 360
taskList.scrollY = 0
```

## 方法

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `getItemMetrics()` | `readonly ItemsControlItemMetrics[]` | 返回 item 主轴位置、尺寸和横轴尺寸。虚拟化开启时返回全量虚拟 metrics。 |
| `getItemMetricsForKey(key)` | `ItemsControlItemMetrics \| undefined` | 按 key 查询 metrics。 |
| `scrollToIndex(index, align?)` | `boolean` | 滚动到指定索引。无效索引或滚动位置未变化时返回 `false`。 |
| `scrollToKey(key, align?)` | `boolean` | 滚动到指定 key。找不到 key 返回 `false`。 |
| `focusIn()` | `void` | 设置焦点，并初始化 focused key。 |
| `focusOut()` | `void` | 清除焦点。 |
| `onKeyDown(event)` | `boolean` | 处理方向键、Home/End、Space、Enter。 |
| `debugContainers()` | `readonly RenderItemContainer<T>[]` | 返回当前 materialized 容器。测试和诊断使用。 |
| `debugState()` | 对象 | 返回滚动、选中、hover、focus、虚拟化和 materialized 状态。 |
| `dispose()` | `void` | 从 `FocusManager` 注销并释放组件。 |

`align` 类型为 `ItemsControlScrollAlign`，可取：

| 值 | 行为 |
| --- | --- |
| `'nearest'` | 只在目标不可见时滚动，尽量少移动。 |
| `'start'` | 目标贴近视口起点。 |
| `'center'` | 目标居中。 |
| `'end'` | 目标贴近视口末端。 |

```ts
const taskList = new RenderItemsControl({
  items: Array.from({ length: 10000 }, (_, index) => ({
    id: `task-${index}`,
    title: `任务 ${index}`,
  })),
  getKey: item => item.id,
  height: 320,
  virtualization: { enabled: true, estimatedItemMainSize: 36 },
  itemTemplate: item => new RenderText(item.title),
})

taskList.scrollToIndex(3000, 'start')
taskList.scrollToKey('task-9000', 'center')
```

## ItemsControlItemMetrics

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `key` | `string` | item key。 |
| `index` | `number` | item 索引。 |
| `mainOffset` | `number` | item 在主轴上的起始位置。 |
| `mainSize` | `number` | item 主轴尺寸。 |
| `crossSize` | `number` | item 横轴尺寸。 |

纵向列表中，`mainOffset/mainSize` 表示 y/height；横向列表中表示 x/width。

```ts
const taskList = new RenderItemsControl({
  items: [
    { id: 'task-1', title: '核对文档' },
    { id: 'task-2', title: '提交审核' },
  ],
  getKey: item => item.id,
  itemTemplate: item => new RenderText(item.title),
})

const taskMetric = taskList.getItemMetricsForKey('task-2')
if (taskMetric) {
  state.taskTop = taskMetric.mainOffset
}
```

## debugState

`debugState()` 返回：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `selectedKey` | `string` | 当前选中 key。 |
| `selectedItem` | `T \| null` | 当前选中 item。 |
| `hoveredKey` | `string` | 当前 hover key。 |
| `focusedKey` | `string` | 当前焦点 key。 |
| `scrollX` / `scrollY` | `number` | 当前滚动偏移。 |
| `contentWidth` / `contentHeight` | `number` | 内容总尺寸。 |
| `viewportWidth` / `viewportHeight` | `number` | 扣除滚动条后的视口尺寸。 |
| `containerKeys` | `string[]` | 当前容器 key。非虚拟化时为全部；虚拟化时为 materialized 范围。 |
| `itemMetrics` | `ItemsControlItemMetrics[]` | 当前记录的 metrics。 |
| `virtualized` | `boolean` | 是否开启虚拟化。 |
| `virtualRange` | 对象或 `null` | 当前虚拟范围。 |
| `materializedKeys` | `string[]` | 当前实际创建的 item key。 |

```ts
const taskList = new RenderItemsControl({
  items: [{ id: 'task-1', title: '核对文档' }],
  getKey: item => item.id,
  itemTemplate: item => new RenderText(item.title),
})

const itemsState = taskList.debugState()
state.materializedCount = itemsState.materializedKeys.length
state.itemsViewportHeight = itemsState.viewportHeight
```

## 布局和滚动

纵向布局：

- item 依次沿 y 轴排列。
- bounded width 下 item 会拉伸到可用宽度。
- 内容高度超过视口时显示垂直滚动条。
- 垂直滚动条出现后会预留 gutter，避免内容绘制到滚动条下面。

横向布局：

- item 依次沿 x 轴排列。
- `maxWidth` 常用于限制控件宽度，从而产生横向滚动。
- 内容宽度超过视口时显示水平滚动条。
- 横向列表里，鼠标纵向滚轮会优先转换为横向滚动。

```ts
interface TaskItem {
  id: string
  title: string
}

const taskItems: TaskItem[] = [
  { id: 'task-1', title: '核对文档' },
  { id: 'task-2', title: '提交审核' },
]

const horizontalTasks = new RenderItemsControl<TaskItem>({
  items: taskItems,
  getKey: item => item.id,
  orientation: 'horizontal',
  maxWidth: 420,
  itemTemplate: item => new RenderText(item.title),
})
```

`scrollMode: 'none'` 会关闭内部滚动条，并把滚动偏移夹到 0。此时如果内容超出父约束，超出的部分不会通过内部滚动查看。

## 虚拟化

`ItemsControlVirtualizationOptions`：

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `false` | 是否开启虚拟化。 |
| `estimatedItemMainSize` | `number` | `40` | item 主轴尺寸估值。小于 1 会规整为 1。 |
| `overscan` | `number` | `2` | 视口前后额外 materialize 的 item 数。会向下取整并限制为非负。 |

```ts
interface TaskItem {
  id: string
  title: string
}

const virtualTasks = new RenderItemsControl<TaskItem>({
  items: Array.from({ length: 10000 }, (_, index) => ({
    id: `task-${index}`,
    title: `任务 ${index}`,
  })),
  getKey: item => item.id,
  height: 320,
  virtualization: {
    enabled: true,
    estimatedItemMainSize: 36,
    overscan: 2,
  },
  itemTemplate: item => new RenderText(item.title),
})
```

虚拟化行为：

- 初始只 materialize 估算视口内的 item 和 overscan。
- 滚动时根据 `VariableVirtualizer` 计算范围。
- 已测量 item 会把真实尺寸回写给 virtualizer。
- 如果测量后范围变化，会再次 reconcile 当前范围。
- `debugState().materializedKeys` 只包含实际创建的容器。
- `getItemMetrics()` 在虚拟化开启时可以返回全量虚拟 metrics，但大量调用仍有成本。

性能建议：

- 大数据列表必须提供稳定且唯一的 `getKey`。
- `estimatedItemMainSize` 应接近真实平均高度或宽度。
- `overscan` 不要过大，否则会抵消虚拟化收益。
- `itemTemplate` 不要创建过重组件或发起业务请求。
- 需要频繁更新 item 时，尽量保持对象和 key 稳定，减少模板重建。

## 鼠标行为

| 操作 | 行为 |
| --- | --- |
| pointer down 命中 item | 如果可选或可激活，列表获得焦点并设置 focused key。 |
| pointer down 命中可选 item | 选中 item，触发 `onSelectionChange`。 |
| pointer up 命中已选中 item | 触发 `onActivate`。 |
| selectionMode 为 `'none'` 的 item | 不选中，但 pointer up 可触发 `onActivate`。 |
| pointer move 命中 item | 更新 hover，触发 `onItemHover`。 |
| pointer down 命中滚动条 | 捕获指针，开始拖动滚动条。 |
| pointer move 拖动滚动条 | 更新 `scrollX` 或 `scrollY`，阻止父级滚动手势。 |
| pointer leave / cancel | 清理 hover 和滚动条 hover/drag 状态。 |

如果 pointer 事件已经命中 item 模板内部的交互子组件，`RenderItemsControl` 不会抢占该事件，也不会因为 hover 立即重建当前模板。这能避免按钮、输入框等嵌在 item 内时被父列表打断。

## 键盘行为

键盘只在容器 focused 且未 disabled 时生效。

| 按键 | 纵向列表 | 横向列表 |
| --- | --- | --- |
| ArrowDown | 移动到下一个 enabled item | 不处理 |
| ArrowUp | 移动到上一个 enabled item | 不处理 |
| ArrowRight | 不处理 | 移动到下一个 enabled item |
| ArrowLeft | 不处理 | 移动到上一个 enabled item |
| Home | 移动到第一个 enabled item | 移动到第一个 enabled item |
| End | 移动到最后一个 enabled item | 移动到最后一个 enabled item |
| Space | 选中 focused item | 选中 focused item |
| Enter | 选中并激活 focused item | 选中并激活 focused item |

键盘移动会调用内部 ensure visible。虚拟化开启时，如果目标 item 当前未 materialized，会记录 pending key，下一次 layout 会根据 metrics 再滚动到可见。

## 动态更新

```ts
interface TaskItem {
  id: string
  title: string
}

function replaceTasks(control: RenderItemsControl<TaskItem>, nextItems: TaskItem[]): void {
  const selectedId = control.selectedItem?.id ?? ''
  control.items = nextItems
  control.selectedItem = nextItems.find(item => item.id === selectedId) ?? nextItems[0] ?? null
}
```

更新 `items` 时：

- 重新计算 `_itemKeys` 和 key 到 index 的映射。
- 按 key 复用已有 `RenderItemContainer`。
- 数据引用或 index 改变时刷新模板。
- 不再存在的容器会 detach。
- 已无效的 selected、hovered、focused key 会被清理。
- 虚拟化开启时只 reconcile 当前 materialized 范围。

`getKey` 不能返回重复 key。若重复，内部 key index 只保留第一次出现的位置，选择和滚动定位会变得不可预测。

## 与其他组件的区别

| 能力 | `RenderItemsControl` | `RenderListView` | `RenderDataGrid` |
| --- | --- | --- | --- |
| item 内容 | 自定义组件模板 | 固定文本、icon、尾部文本 | 多列单元格 |
| 行高 | 可变 | 固定 | 通常固定行高 |
| 选择 | none/single | single | 表格选择模型 |
| 虚拟化 | 可变尺寸虚拟化 | 固定行高虚拟绘制 | 表格虚拟/滚动能力 |
| 横向滚动 | 支持 | 不支持 | 支持列宽场景 |
| 适合场景 | 卡片、模板列表、复杂结果项 | 简单一维文本列表 | 业务数据表格 |

## 常见问题

### 为什么 selectedItem 设置后没有选中？

`selectedItem` 必须是当前 `items` 数组里的同一对象引用，并且 `selectionMode === 'single'`，目标项不能 disabled，`isItemSelectable` 也不能返回 `false`。

### 为什么滚动后 debugContainers 里没有全部项？

开启虚拟化后，`debugContainers()` 只返回当前 materialized 的容器。需要全量位置数据时用 `getItemMetrics()`，需要确认当前创建了哪些容器时看 `debugState().materializedKeys`。

### 为什么 hover 时模板会重新创建？

`itemTemplate` 接收 `state.hovered`。为了让模板能根据 hover 状态改变内容，父容器会刷新模板。模板里有交互子组件时，命中该子组件的 hover 会尽量保留当前模板，避免打断子组件交互。

### 为什么在滚动边界外层容器没有继续滚动？

只要 ItemsControl 自己有对应方向的滚动条，它会在滚动边界继续消费 wheel，避免内嵌滚动区域把滚动传给外层，导致页面跳动。

### 什么时候使用 itemAppearance = 'row'？

`'row'` 更像数据行：底部分割线、较小圆角、浅选中背景。用于诊断列表、明细行、数据组行。`'navigation'` 更适合左侧导航。默认外观适合卡片式 item。

## 相关文档

- [ListView](./list-view.md)
- [DataGrid](./data-grid.md)
- [TreeView](./tree-view.md)
- [TreeGrid](./tree-grid.md)
- [StackPanel](../../layouts.md)
- [ScrollView](../../layouts.md)
- 虚拟化
- 大数据表格
- [主题与状态](../../themes.md)
