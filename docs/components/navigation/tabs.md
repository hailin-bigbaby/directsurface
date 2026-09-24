# Tabs 标签

> **通用布局能力**：`RenderTabs` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；单个 tab 的文本、图标和内部 padding 仍由 Tabs 自身测量。详见[组件通用布局属性](../common-layout-properties.md)。


`RenderTabs` 是标签条组件，用于同一区域内多个同级视图的切换。它只负责标签头的展示和交互，不负责内容区创建、销毁、缓存或页面生命周期。

当前实现支持：选中、hover、关闭按钮、dirty 标记、图标、tooltip、右键上下文菜单回调、拖拽重排回调、overflow 下拉菜单和键盘导航。

## API 总览

```ts
import {
  RenderTabs,
  type TabContextMenuHandler,
  type TabDragHandler,
  type TabItem,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderTabs` | class | 标签条，只管理标签头展示、切换、关闭请求、拖拽回调和 overflow 菜单。 |
| `TabItem` | type | 标签数据，包含稳定 `key`、`label`、closable、dirty、tooltip 和 icon。 |
| `TabContextMenuHandler` | type | 标签右键菜单回调类型。 |
| `TabDragHandler` | type | 标签拖拽生命周期回调类型。 |

最小装配顺序是：准备 `TabItem[]`，创建 `RenderTabs({ tabs, activeKey, onTabChange })`，再由业务根据 active key 渲染内容区。Tabs 不创建、不销毁、不缓存内容页。

## 何时使用

使用 Tabs：

- 一个页面内有多个同级视图。
- 需要一个轻量标签条，内容区由业务自己切换。
- 需要可关闭、可拖拽重排或右键菜单的标签头。
- 标签数量可能超过可视宽度，需要 overflow 菜单。

不要使用：

- 需要完整 tab 内容生命周期管理，使用 [TabView](./tab-view.md)。
- 需要多文档工作区、关闭保护、持久化和文档管理，使用 [TabbedWorkspace](./tabbed-workspace.md)。
- 需要停靠、拆分、浮动窗口，使用 [DockWorkspace](./dock-workspace.md)。
- 少量状态切换按钮，使用 [Toolbar](../command/toolbar.md) 的 toggle 或 [RadioGroup](../input/checkbox-switch-radio.md)。

## 最小示例

```ts
const tabs = new RenderTabs({
  tabs: [
    { key: 'summary', label: '摘要' },
    { key: 'detail', label: '明细' },
  ],
  activeKey: 'summary',
  onTabChange: key => {
    state.activeTab = key
  },
})
```

业务根据 `state.activeTab` 决定内容区显示什么。Tabs 不会自动切换子页面。

## 可关闭和脏标记示例

```ts
const documentTabs = new RenderTabs({
  tabs: [
    { key: 'home', label: '首页', icon: 'window' },
    { key: 'record-a', label: '文档 A', icon: 'document', closable: true, dirty: true },
    { key: 'record-b', label: '文档 B', icon: 'document', closable: true },
  ],
  activeKey: 'record-a',
  onTabChange: key => {
    state.activeTab = key
  },
  onTabClose: key => {
    state.closedTab = key
  },
})
```

关闭按钮只负责触发 `onTabClose(key)`，不会自动从 `tabs` 数组删除该项。业务应在回调中更新 tabs 数据并重新布局或重绘。

## 拖拽重排示例

```ts
const reorderableTabs = new RenderTabs({
  tabs: [
    { key: 'a', label: 'A' },
    { key: 'b', label: 'B' },
    { key: 'c', label: 'C' },
  ],
  activeKey: 'a',
  onTabReorder: (key, targetIndex) => {
    state.reorderedTab = key
    state.reorderTargetIndex = targetIndex
  },
})
```

拖拽距离达到阈值后才进入拖拽状态。拖拽过程中组件绘制插入线和 ghost；松开鼠标后触发 `onTabReorder(key, targetIndex)`。组件不会自己重排 `tabs` 数组。

## 右键菜单示例

```ts
const tabsWithMenu = new RenderTabs({
  tabs: [
    { key: 'summary', label: '摘要' },
    { key: 'detail', label: '明细', closable: true },
  ],
  activeKey: 'summary',
  onTabContextMenu: (key, position) => {
    state.contextTab = key
    state.contextX = position.x
    state.contextY = position.y
    return true
  },
})
```

`onTabContextMenu` 返回 `false` 时，组件认为没有处理该右键请求，会返回 `false` 给事件系统。

## TabItem

```ts
const tabItem: TabItem = {
  key: 'record',
  label: '文档',
  icon: 'document',
  closable: true,
  dirty: true,
  tooltip: '文档文书尚未保存',
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | `string` | 是 | 标签稳定标识。用于 active、关闭、拖拽、右键和 overflow 选择。 |
| `label` | `string` | 是 | 标签显示文本。 |
| `closable` | `boolean` | 否 | 是否显示关闭按钮。关闭按钮在 active、hover 或 close hover 时可见。 |
| `dirty` | `boolean` | 否 | 是否显示未保存圆点。 |
| `tooltip` | `string` | 否 | hover 标签或关闭按钮时写入组件 tooltip。 |
| `icon` | `IconName` | 否 | 标签左侧图标。 |

`RenderTabs` 不校验 key 唯一性，但业务必须保证同一 Tabs 内 key 唯一。

## 构造参数

```ts
const appTabs = new RenderTabs({
  tabs: [
    { key: 'overview', label: '概览', icon: 'window' },
    { key: 'settings', label: '设置', icon: 'settings', closable: true },
  ],
  activeKey: 'overview',
  disabled: false,
  onTabChange: key => {
    state.activeTab = key
  },
  onTabClose: key => {
    state.closedTab = key
  },
  onTabReorder: (key, targetIndex) => {
    state.reorderedTab = `${key}:${targetIndex}`
  },
})
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `tabs` | `TabItem[]` | 必填 | 标签数组。构造函数保留该数组引用。 |
| `activeKey` | `string` | 必填 | 当前活动标签 key。 |
| `disabled` | `boolean` | `false` | 整个标签条是否禁用。禁用后不响应指针和键盘。 |
| `onTabChange` | `(key: string) => void` | `undefined` | 用户激活新标签时触发。直接设置 `activeKey` 不触发。 |
| `onTabClose` | `(key: string) => void` | `undefined` | 点击关闭按钮，或键盘 Delete/Backspace 关闭 active closable tab 时触发。 |
| `onTabReorder` | `(key: string, targetIndex: number) => void` | `undefined` | 拖拽结束且目标位置变化时触发。 |
| `onTabContextMenu` | `(key: string, position: Offset) => boolean \| void` | `undefined` | 右键标签时触发。返回 false 表示未处理。 |
| `onTabDragStart` | `(key: string, position: Offset) => void` | `undefined` | 进入拖拽状态时触发。 |
| `onTabDragMove` | `(key: string, position: Offset) => void` | `undefined` | 拖拽移动时触发。 |
| `onTabDragEnd` | `(key: string, position: Offset) => void` | `undefined` | 拖拽释放时触发。 |
| `onTabDragCancel` | `(key: string, position: Offset) => void` | `undefined` | 拖拽取消时触发。 |

## 属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `tabs` | `TabItem[]` | 当前标签数组。可由业务整体替换。 |
| `activeKey` | `string` | 当前活动标签。setter 会同步 underline 并重绘，但不会触发 `onTabChange`。 |
| `disabled` | `boolean` | 整体禁用。设为 true 会释放拖拽捕获、清理 hover 和拖拽状态。 |
| `onTabChange` | `(key) => void \| undefined` | 标签切换回调。 |
| `onTabClose` | `(key) => void \| undefined` | 标签关闭回调。 |
| `onTabReorder` | `(key, targetIndex) => void \| undefined` | 重排回调。 |
| `onTabContextMenu` | `TabContextMenuHandler \| undefined` | 右键回调。 |
| `onTabDragStart/Move/End/Cancel` | `TabDragHandler \| undefined` | 拖拽生命周期回调。 |
| `isFocused` | `boolean` | 继承自 `FocusableControl`。 |

动态更新：

```ts
const tabs = new RenderTabs({
  tabs: [
    { key: 'summary', label: '摘要' },
  ],
  activeKey: 'summary',
})

tabs.tabs = [
  { key: 'summary', label: '摘要' },
  { key: 'detail', label: '明细', closable: true },
  { key: 'logs', label: '日志', dirty: true },
]
tabs.activeKey = 'detail'
tabs.markNeedsLayout()
```

如果只改变 `dirty/closable/tooltip` 等不影响顶层宽度的状态，通常重绘即可；改变 label、icon、数量或 active 时建议请求布局。

## 鼠标行为

| 操作 | 行为 |
| --- | --- |
| 主按钮点击标签 | 请求焦点，激活该标签，触发 `onTabChange(key)`。 |
| 主按钮点击关闭按钮 | 触发 `onTabClose(key)`，不自动删除标签。 |
| 主按钮点击 overflow 按钮 | 打开 overflow 下拉菜单。 |
| hover 标签 | 更新 hover 状态，并把该标签 `tooltip` 写入组件 tooltip。 |
| hover 关闭区域 | 显示关闭按钮 hover 效果。 |
| 指针离开 | 非拖拽时清除 hover 和 tooltip。 |
| 拖拽标签 | 达到 4px 位移阈值后进入拖拽，绘制插入线和 ghost。 |
| pointer cancel | 取消拖拽并触发 `onTabDragCancel`。 |

关闭按钮可见规则：

- 标签 `closable === true`。
- 标签是 active，或标签处于 hover，或关闭按钮本身处于 hover。
- 标签宽度足够容纳关闭按钮。

## 键盘行为

Tabs 获得焦点后：

| 按键 | 行为 |
| --- | --- |
| `ArrowLeft` / `ArrowUp` | 激活上一个 tab，循环。 |
| `ArrowRight` / `ArrowDown` | 激活下一个 tab，循环。 |
| `Home` | 激活第一个 tab。 |
| `End` | 激活最后一个 tab。 |
| `Delete` / `Backspace` | 如果 active tab 可关闭，触发 `onTabClose(activeKey)`。 |

键盘切换会触发 `onTabChange`。禁用状态下不处理键盘。

## 右键菜单

`onContextMenu(position)` 会：

1. 判断 Tabs 是否启用且命中标签区域。
2. 找到 position 所在的可见 tab。
3. 调用 `onTabContextMenu(key, position)`。
4. 如果回调没有返回 `false`，请求焦点、更新 hover、同步 tooltip 并返回 `true`。

空白 strip、overflow 按钮和被裁剪到 overflow 的 tab 不会触发 tab 右键回调。

## 拖拽重排

拖拽流程：

1. `pointerDown` 命中标签后记录起点和 pointerId。
2. 移动距离达到 4px 后进入拖拽状态，并触发 `onTabDragStart`。
3. 拖拽期间持续触发 `onTabDragMove`，并绘制插入线。
4. `pointerUp` 时计算目标下标。
5. 如果目标下标变化，触发 `onTabReorder(key, targetIndex)`。
6. 最后触发 `onTabDragEnd` 并释放 pointer capture。

`targetIndex` 是“移除当前拖拽 tab 后”的插入位置。组件不会修改 `tabs` 顺序，业务应在 `onTabReorder` 中完成数组重排。

## Overflow 菜单

当所有 tab 的自然宽度超过组件宽度时：

- 组件保留 active tab 可见。
- 其余无法放下的 tab 进入 overflow 菜单。
- 右侧绘制一个 `chevron-down` overflow 按钮。
- 点击 overflow 按钮打开 `MenuPopup`。
- overflow 中的 active tab 会显示统一的 `check` 图标并禁用，不会把选中符号拼入标题文本。
- 选择 overflow 菜单中的其他 tab 会激活该 tab 并关闭菜单。

Overflow 菜单由组件内部创建和释放，业务无需直接管理。

## 布局和绘制

- 组件没有子 render object，标签、关闭按钮、dirty dot、图标、overflow 按钮和拖拽 ghost 都由自身绘制。
- 宽度使用父布局给定的 `maxWidth`；如果是无限宽，默认 `400`。
- 高度来自主题 `panelHeaderHeight`。
- 每个 tab 宽度由 label 文本、padding、icon、dirty dot、close button 和间距累加。
- 文本绘制时会裁剪到当前 tab 可用区域。
- active tab 绘制顶部 indicator 和 active 背景。
- hover tab 绘制 hover 背景。
- focused active tab 绘制 focus ring。
- active tab 最后绘制，保证它在视觉上压过相邻 inactive tab。

## 主题来源

样式来自 `deriveTabsStyle(theme)`：

| 样式 | 来源语义 |
| --- | --- |
| `barBg` | chrome strip surface 与标题栏 surface 混合 |
| `separator` | strip 背景与 `theme.borderSubtle` 混合 |
| `indicatorBg` | `theme.accentPrimary` |
| `activeTabBg` | `theme.surfaceContent` |
| `height` | `theme.panelHeaderHeight` |
| `fontSize/fontFamily` | 当前主题字体 |
| `padding` | `theme.framePadding` 下限 6 |
| `closeButtonSize` | `fontSize + 2` 下限 16 |

当前 tab 圆角为 0，indicator 高度为 2。

## 生命周期

- 构造时创建 underline 动画。
- `activeKey` 变化会同步 underline；浏览器支持 animation frame 时可动画过渡。
- 打开 overflow 会创建 `MenuPopup`。
- 禁用时会释放 pointer capture 并清理拖拽/hover。
- `dispose()` 会关闭 overflow、释放 pointer capture、释放动画并清空所有回调引用。

## 性能边界

- layout 和 hit-test 会测量所有可管理 tab 的 label 宽度。
- 标签数量通常应保持有限。大量文档标签建议使用 TabbedWorkspace 或 DockWorkspace，并配合 overflow/搜索/最近列表。
- Tabs 只绘制标签条。真正的性能风险通常来自内容区，请由业务决定隐藏页是否保留、销毁或延迟创建。

## 常见问题

### 为什么点击关闭后标签还在？

Tabs 只触发 `onTabClose(key)`，不会修改 `tabs` 数组。业务必须在回调里删除对应 tab 并重新布局。

### 为什么直接设置 activeKey 没有触发 onTabChange？

`activeKey` setter 表示外部同步状态，不触发回调。只有用户交互激活标签时才触发 `onTabChange`。

### 为什么 inactive tab 的关闭按钮有时点不到？

关闭按钮只在 active、hover 或关闭按钮 hover 时显示。未 hover 的 inactive tab 不暴露关闭 hit target。

### Tabs 能管理内容页面吗？

不能。Tabs 只管理标签条。需要“tab + 内容 + 生命周期”时使用 TabView、TabbedWorkspace 或 DockWorkspace。

### shortcut 或 Ctrl+W 关闭由 Tabs 处理吗？

Tabs 只处理自身获得焦点后的 Delete/Backspace。全局快捷键由业务、CommandShortcutController 或工作区组件处理。

## 相关文档

- [TabView 标签视图](./tab-view.md)
- [TabbedWorkspace 标签工作区](./tabbed-workspace.md)
- [DockWorkspace 停靠工作区](./dock-workspace.md)
- [MenuBar 菜单栏](./menu-bar.md)
- [ContextMenu 右键菜单](../overlay/context-menu.md)
- [Toolbar 工具栏](../command/toolbar.md)
