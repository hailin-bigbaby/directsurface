# NavigationMenu 导航菜单

> **通用布局能力**：`RenderNavigationMenu` 继承 `RenderBorder`，除 `RenderBox` 的尺寸、margin 和槽位对齐外，还原生支持容器 `padding`。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderNavigationMenu` 是应用左侧模块导航组件，适合工作台、后台管理、App 等多模块系统。它支持分组、搜索、选中项、组折叠、整栏折叠、状态标记、徽标、禁用/加载项，以及折叠 rail 模式下的分组浮层。

组件内部由 `RenderBorder`、`RenderSearchBox`、`RenderIconButton` 和 `RenderItemsControl` 组合而成；业务只需要提供 `NavigationMenuGroup[]` 和选中项状态。


## API 总览

```ts
import {
  RenderNavigationMenu,
  type NavigationMenuEntry,
  type NavigationMenuGroup,
  type NavigationMenuItem,
  type NavigationMenuItemStatus,
} from 'directsurface'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderNavigationMenu` | class | 左侧模块导航，支持分组、搜索、折叠 rail、选中状态、徽标和状态点。 |
| `NavigationMenuGroup` | type | 导航分组配置，包含 `key`、`title`、`children` 和折叠配置。 |
| `NavigationMenuItem` | type | 导航项配置，包含 `key`、`title`、icon、status、badge、disabled/loading。 |
| `NavigationMenuItemStatus` | type | 状态点语义：`none`、`opened`、`success`、`warning`、`danger`。 |
| `NavigationMenuEntry` | type | 内部可见扁平项，调试和测试时可读取。 |

最小装配顺序是：准备 `NavigationMenuGroup[]`，创建 `RenderNavigationMenu`，用 `selectedKey` 表示当前模块，并在 `onItemActivate` 中切换业务页面或打开工作区文档。

## 何时使用

使用 NavigationMenu：

- 应用有稳定左侧模块导航。
- 导航需要分组，例如“业务模块 / 数据中心 / 系统管理”。
- 需要折叠成窄 rail，节省横向空间。
- 需要搜索导航项。
- 需要显示已打开、成功、警告、危险、加载、徽标等状态。

不要使用：

- 顶部全局菜单，使用 [MenuBar](./menu-bar.md)。
- 页面内少量同级视图切换，使用 [Tabs](./tabs.md)。
- 文档工作区、多标签页、浮动窗口，使用 [TabbedWorkspace](./tabbed-workspace.md) 或 [DockWorkspace](./dock-workspace.md)。
- 树形对象浏览器，使用 [TreeView](../data/tree-view.md) 或 [TreeGrid](../data/tree-grid.md)。

## 最小示例

```ts
const navigation = new RenderNavigationMenu({
  title: '业务导航',
  groups: [
    {
      key: 'example',
      title: '业务模块',
      children: [
        { key: 'orders', title: '订单', icon: 'copy' },
        { key: 'records', title: '文档', icon: 'window' },
      ],
    },
  ],
  selectedKey: 'records',
  onItemActivate: item => openModule(item.key),
})
```

## 复杂状态示例

```ts
const navigationGroups: NavigationMenuGroup[] = [
  {
    key: 'example',
    title: '业务模块',
    icon: 'window',
    children: [
      { key: 'orders', title: '订单', icon: 'copy', opened: true },
      { key: 'record', title: '文档', icon: 'document', badge: 3 },
      { key: 'audit', title: '质控问题', icon: 'bell', status: 'warning' },
      { key: 'closed', title: '归档文档', icon: 'lock', disabled: true },
    ],
  },
  {
    key: 'admin',
    title: '系统管理',
    icon: 'settings',
    collapsed: true,
    children: [
      { key: 'users', title: '用户管理', icon: 'settings' },
      { key: 'roles', title: '角色权限', icon: 'lock' },
    ],
  },
]

const sideNav = new RenderNavigationMenu({
  title: 'App 工作台',
  subtitle: '演示环境',
  groups: navigationGroups,
  selectedKey: 'orders',
  searchPlaceholder: '搜索模块...',
  onItemActivate: item => openModule(item.key),
})
```

## 数据类型总览

```ts
const status: NavigationMenuItemStatus = 'warning'

const item: NavigationMenuItem = {
  key: 'quality',
  title: '质控问题',
  icon: 'bell',
  status,
  badge: 8,
  tooltip: '待处理质控问题',
}

const group: NavigationMenuGroup = {
  key: 'example',
  title: '业务模块',
  icon: 'window',
  collapsible: true,
  collapsed: false,
  children: [item],
}
```

## NavigationMenuItem

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | `string` | 是 | 导航项稳定标识。用于选中、激活、搜索和业务路由。 |
| `title` | `string` | 是 | 显示文本。 |
| `icon` | `IconName` | 否 | 左侧图标。展开和折叠模式都会使用。 |
| `status` | `NavigationMenuItemStatus` | 否 | 状态。可选 `'none'`、`'opened'`、`'success'`、`'warning'`、`'danger'`。 |
| `opened` | `boolean` | 否 | 是否表示已打开。等价于状态上的 opened 语义，会绘制细小圆点。 |
| `loading` | `boolean` | 否 | 加载态。会显示 warning dot，并视为不可交互。 |
| `disabled` | `boolean` | 否 | 禁用态。不可选择、不可激活。 |
| `badge` | `string \| number` | 否 | 右侧徽标值。优先级高于状态 dot。 |
| `tooltip` | `string` | 否 | 当前数据字段保留。当前实现没有在 NavigationMenu 内部直接读取它显示 tooltip。 |

状态绘制规则：

- `badge` 存在时绘制数值徽标。
- `loading` 为 true 时绘制 warning dot。
- `status: 'success' | 'warning' | 'danger'` 时绘制状态 dot。
- `opened` 或 `status: 'opened'` 时绘制一个低强调圆点，不使用 Badge。
- `disabled` 或 `loading` 会让 item 在 ItemsControl 中不可交互。

## NavigationMenuGroup

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | `string` | 是 | 分组稳定标识。用于折叠状态和折叠 rail popup。 |
| `title` | `string` | 是 | 分组标题。展开模式显示完整标题，折叠模式无 icon 时显示首字。 |
| `icon` | `IconName` | 否 | 分组图标。折叠模式优先显示图标。 |
| `children` | `NavigationMenuItem[]` | 是 | 分组下的导航项。构造和 setter 会复制 children 数组。 |
| `collapsible` | `boolean` | 否 | 是否允许该分组折叠。`false` 时 `setGroupCollapsed()` 无效。 |
| `collapsed` | `boolean` | 否 | 初始分组折叠状态。 |

## NavigationMenuEntry

`visibleEntries` 和内部 `itemsControl` 使用扁平化后的 `NavigationMenuEntry`：

| 形态 | 说明 |
| --- | --- |
| `{ kind: 'group', group }` | 分组行。展开模式用于组标题；折叠模式用于 rail 上的分组入口。 |
| `{ kind: 'item', groupKey, item }` | 可导航项。 |

业务一般不需要自己构造 `NavigationMenuEntry`，但调试和测试可以读取 `visibleEntries`。

## 构造参数

```ts
const nav = new RenderNavigationMenu({
  title: '工作台',
  subtitle: '当前区域',
  groups: [
    {
      key: 'example',
      title: '业务模块',
      children: [
        { key: 'orders', title: '订单', icon: 'copy' },
        { key: 'records', title: '文档', icon: 'document' },
      ],
    },
  ],
  selectedKey: 'orders',
  searchPlaceholder: '搜索模块...',
  collapsed: false,
  disabled: false,
  onItemActivate: item => {
    state.activeModule = item.key
  },
  onCollapsedChange: collapsed => {
    state.navigationCollapsed = collapsed
  },
})
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `title` | `string` | 必填 | 展开模式顶部标题。 |
| `subtitle` | `string` | `undefined` | 展开模式顶部副标题。 |
| `groups` | `NavigationMenuGroup[]` | 必填 | 导航分组。构造时会复制 group 和 children 数组。 |
| `selectedKey` | `string \| null` | `''` | 初始选中 item key。 |
| `searchPlaceholder` | `string` | `'搜索导航...'` | 搜索框 placeholder。 |
| `collapsed` | `boolean` | `false` | 初始是否折叠为 rail。 |
| `disabled` | `boolean` | `false` | 整体禁用。会同步禁用内部搜索框、折叠按钮和导航列表，并关闭折叠分组 popup。 |
| `onItemActivate` | `(item: NavigationMenuItem) => void` | `undefined` | item 激活回调。分组折叠/展开不会触发。 |
| `onCollapsedChange` | `(collapsed: boolean) => void` | `undefined` | 整栏折叠状态变化回调。 |

## 公开子控件

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `searchBox` | `RenderSearchBox` | 展开模式显示的搜索框。 |
| `itemsControl` | `RenderItemsControl<NavigationMenuEntry>` | 导航列表。滚动、选择、hover 和虚拟容器由它处理。 |
| `collapseButton` | `RenderIconButton` | 折叠/展开按钮。 |

这些对象用于组合和调试。业务通常通过 `groups/selectedKey/searchValue/collapsed` 控制导航，不应绕过 NavigationMenu 直接改内部 ItemsControl 的 items。

## 属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `groups` | `NavigationMenuGroup[]` | 当前分组。setter 会复制 group 和 children，并重新生成 entries。 |
| `selectedKey` | `string \| null` | 当前选中 key。设置为 null 会清空选中。 |
| `selectedItem` | `NavigationMenuItem \| null` | 当前可见选中项。若搜索过滤后选中项不可见，返回 null。 |
| `selectedGlobalItem` | `NavigationMenuItem \| null` | 在全部 groups 中查找的选中项。即使被搜索过滤也可返回。 |
| `searchValue` | `string` | 当前搜索文本。setter 会同步搜索框并重建 entries。 |
| `visibleEntries` | `readonly NavigationMenuEntry[]` | 当前实际显示的扁平 entries。 |
| `collapsed` | `boolean` | 是否折叠为 rail。setter 会重建 shell、切换按钮图标并触发动画。 |
| `disabled` | `boolean` | 整体禁用状态。设置为 `true` 会禁用 `searchBox`、`collapseButton`、`itemsControl`，并关闭当前折叠分组 popup。 |
| `currentWidth` | `number` | 当前动画宽度，介于 `collapsedWidth` 和 `expandedWidth` 之间。 |

静态宽度：

| 静态属性 | 值 | 说明 |
| --- | --- | --- |
| `RenderNavigationMenu.expandedWidth` | `248` | 展开目标宽度。 |
| `RenderNavigationMenu.collapsedWidth` | `56` | 折叠目标宽度。 |

## 方法

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `isGroupCollapsed(groupKey)` | `boolean` | 查询分组是否处于折叠状态。 |
| `setGroupCollapsed(groupKey, collapsed)` | `void` | 设置分组折叠。不存在的组或 `collapsible: false` 的组会被忽略。 |
| `toggleGroup(groupKey)` | `void` | 切换分组折叠。 |
| `dispose()` | `void` | 关闭折叠分组 popup，释放折叠动画并释放子控件。 |

## 动态更新

替换导航数据：

```ts
const nav = new RenderNavigationMenu({
  title: '工作台',
  groups: [
    {
      key: 'example',
      title: '业务模块',
      children: [
        { key: 'orders', title: '订单', icon: 'copy' },
      ],
    },
  ],
})

nav.groups = [
  {
    key: 'example',
    title: '业务模块',
    children: [
      { key: 'orders', title: '订单', icon: 'copy' },
      { key: 'records', title: '文档', icon: 'document' },
    ],
  },
]
nav.selectedKey = 'orders'
```

`groups` setter 会根据新定义重新同步分组折叠状态：

- 默认读取新 group 的 `collapsed`。
- 若内部调用保留旧状态，会保留已存在的折叠组。
- `collapsible: false` 的分组不会进入折叠集合。

当前实现不提供单项增删 API。业务应重新生成 groups 后整体赋值。

## 展开模式行为

展开模式下 shell 结构：

1. 标题和副标题。
2. 折叠按钮。
3. 搜索框。
4. `itemsControl` 导航列表。

展开模式 entries：

- 每个有可见 child 的组先显示 group 行。
- 如果组未折叠，再显示 child item。
- 如果存在搜索文本，则显示匹配 item 所在的 group 和匹配 item，并忽略组折叠状态。
- 搜索没有匹配 children 的 group 不显示。

激活行为：

- 激活 group 行会折叠/展开该 group。
- 激活 item 会设置 `selectedKey`，然后触发 `onItemActivate(item)`。
- selection change 只更新 selectedKey，不触发 `onItemActivate`。

## 折叠 rail 行为

折叠模式下：

- 宽度目标为 `56`。
- 顶部只显示展开按钮。
- 不显示 title、subtitle 和 searchBox。
- 主列表只显示 group entry，不直接显示 child item。
- 分组有 icon 时显示 icon；没有 icon 时显示 title 首字。
- 当前选中 item 所在 group 会高亮。
- 激活或 hover group 会打开 `NavigationCollapsedGroupPopup`，展示该 group 的 children。

折叠分组 popup：

- 宽度约 `196`。
- 高度最多 `320`，根据 children 数量和 viewport 限制。
- popup 中复用导航 item 行，支持 selected、hover、badge、opened dot。
- 在 rail group 之间移动指针时，会切换到对应 group popup。
- 在 popup 中激活 item 会关闭 popup、设置 `selectedKey` 并触发 `onItemActivate(item)`。
- 从折叠切回展开时，会关闭当前 popup。

## 搜索行为

搜索匹配字段：

- item.title
- item.key
- group.title

匹配使用 `toLocaleLowerCase()` 后的包含判断。

搜索时：

- `searchBox.onChange` 和 `searchBox.onSearch` 都会更新 `searchValue`。
- 搜索会重建 `visibleEntries`。
- 折叠的 group 在搜索时仍会展示匹配 children。
- 如果当前 `selectedKey` 被搜索过滤掉，`selectedItem` 为 null，但 `selectedGlobalItem` 仍可返回原 item。

## 状态和视觉

| 状态 | 视觉 |
| --- | --- |
| selected | item 文本使用 accent 语义，并由 ItemsControl 绘制选中背景。 |
| hover | 由 ItemsControl 的 navigation appearance 处理。 |
| opened | 右侧细小圆点，低强调。 |
| success/warning/danger | 右侧状态 dot。 |
| badge | 右侧数值徽标。 |
| loading | warning dot，并禁用交互。 |
| item disabled | 单个导航项禁用交互。 |
| 整体 disabled | 整个导航菜单禁用搜索、折叠按钮、列表选择、item 激活和折叠 rail popup。 |

`opened` 用于表达“模块已经打开但不是当前选中”。它不是错误或通知，因此使用 subtle dot 而不是普通 Badge。

整体 `disabled` 优先级高于 item disabled/loading。业务可以继续通过 `groups`、`selectedKey`、`searchValue` 和 `collapsed` 做程序化更新，但用户输入不会触发搜索、折叠、分组展开、popup 打开或 `onItemActivate`。

## 布局和绘制

- 根节点继承 `RenderBorder`，背景为 muted，padding 为 `{ left: 8, right: 8, top: 10, bottom: 8 }`。
- `performLayout()` 会把宽度限制为 `currentWidth`。
- `performPaint()` 绘制阴影、背景、边框和右侧分隔线，然后绘制内容和 adorner。
- 展开宽度通过内部折叠动画在 `56` 与 `248` 之间插值。
- 没有 `requestAnimationFrame` / `cancelAnimationFrame` 时，折叠动画会直接跳到目标值。

## 主题来源

NavigationMenu 本身使用：

- `deriveBorderStyle(theme, 'muted')` 获取背景和边框。
- `theme.surfacePanel` 与 muted 背景混合。
- `theme.elevation.cardShadowColor` 提供导航面板外部阴影颜色。
- `theme.accentPrimary` 绘制 opened dot。
- `RenderItemsControl` 的 `itemAppearance: 'navigation'` 绘制 item 背景、hover、selected 和滚动。
- `RenderBadge` 绘制 badge 和状态 dot。
- `RenderSearchBox` 和 `RenderIconButton` 使用各自组件主题。

## 权限和路由职责

NavigationMenu 不做：

- 权限判断。
- 路由解析。
- 模块生命周期管理。
- workspace tab 打开/关闭。
- 租户、条目、区域等业务上下文判断。

这些应由业务层或命令/工作区层完成。推荐流程：

1. 业务根据权限和上下文生成 `NavigationMenuGroup[]`。
2. NavigationMenu 展示并触发 `onItemActivate`。
3. 业务在回调中打开模块、切换 workspace 或更新路由。
4. 业务把当前模块 key 写回 `selectedKey`。

## 性能边界

- `groups` setter 和搜索都会重新生成扁平 `visibleEntries`。
- 列表渲染由 `RenderItemsControl` 承担，支持滚动容器和可见项管理。
- 导航数量通常应保持有限；不要把大对象树直接塞进左侧导航。
- 大型系统应先按权限、租户、角色过滤，再传给组件。
- 高频状态，例如消息数量或加载状态，应合并更新后再整体刷新 groups，避免每帧重建。

## 常见问题

### 为什么 selectedKey 还在，但 selectedItem 是 null？

当前搜索或分组过滤后，选中的 item 可能不在 `visibleEntries` 中。此时 `selectedItem` 返回 null，`selectedGlobalItem` 仍会在全量 groups 中查找。

### 为什么点击 group 没有触发 onItemActivate？

group 只是分组控制。展开模式点击 group 切换组折叠；折叠模式点击 group 打开该组 popup。只有 item 激活才触发 `onItemActivate`。

### loading 和 disabled 有什么区别？

两者都不可交互。`loading` 额外显示 warning dot，用于表达该模块正在加载或状态未完成。

### tooltip 字段为什么没有显示？

`NavigationMenuItem.tooltip` 是数据字段，但当前组件没有内置 tooltip 展示逻辑。需要统一 tooltip 行为时，应在 ItemsControl 或 NavigationMenu 中明确扩展。

### collapsed 状态应该由谁保存？

组件会触发 `onCollapsedChange`。业务如果希望跨页面或跨会话保留折叠状态，应在回调中保存到 app context、store 或用户配置。

## 相关文档

- [ItemsControl 项集合](../data/items-control.md)
- [SearchBox 搜索框](../input/text-box.md)
- [Badge / Chip / Divider](../basic/badge-chip-divider.md)
- [IconButton 图标按钮](../basic/icon-button.md)
- [MenuBar 菜单栏](./menu-bar.md)
- [Tabs 标签](./tabs.md)
- [TabbedWorkspace 标签工作区](./tabbed-workspace.md)
- [DockWorkspace 停靠工作区](./dock-workspace.md)
