# Breadcrumb 面包屑

> **通用布局能力**：`RenderBreadcrumb` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；面包屑项间距和内部 padding 属于组件视觉规格。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderBreadcrumb` 用于展示当前位置在业务层级中的路径，例如“首页 / 条目列表 / 文档编辑”。它是轻量导航组件，只负责横向路径展示、当前项视觉、前序节点点击和键盘导航，不负责页面生命周期或路由管理。


## API 总览

```ts
import {
  RenderBreadcrumb,
  RenderPageHeader,
  type BreadcrumbItem,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderBreadcrumb` | class | 横向路径导航，负责路径展示、前序项激活、焦点和键盘导航。 |
| `BreadcrumbItem` | type | 路径项配置，包含稳定 `key`、`label` 和可选 `disabled`。 |
| `RenderPageHeader` | class | Breadcrumb 最常见的宿主，可通过 `setBreadcrumb()` 管理父子关系。 |

最小装配顺序是：准备 `BreadcrumbItem[]`，创建 `RenderBreadcrumb({ items, onNavigate })`，再放入 `RenderPageHeader` 或页面布局。最后一项被视为当前项，不会触发导航。

## 何时使用

使用 Breadcrumb：

- 页面有清晰层级，例如工作台、模块、对象详情。
- 用户需要回到上级页面或上级对象。
- 页头需要展示当前对象所在路径。
- 路径项数量较少，通常不超过 4 到 5 项。

不要使用：

- 主导航、侧边栏或模块菜单。使用 [NavigationMenu](./navigation-menu.md)。
- 多文档标签页。使用 [Tabs](./tabs.md)、[TabbedWorkspace](./tabbed-workspace.md) 或 [DockWorkspace](./dock-workspace.md)。
- 需要下拉子菜单的路径导航。当前 Breadcrumb 没有内建下拉菜单。
- 需要完整路由管理的导航系统。Breadcrumb 只通过 `onNavigate` 把点击项交给业务。

## 最小示例

```ts
const breadcrumb = new RenderBreadcrumb({
  items: [
    { key: 'home', label: '首页' },
    { key: 'item', label: '条目' },
    { key: 'record', label: '文档编辑' },
  ],
  onNavigate: item => {
    if (item.key === 'home') goHome()
    else openModule(item.key)
  },
})
```

最后一项被视为“当前项”，只展示选中视觉，不触发 `onNavigate`。

## PageHeader 组合

Breadcrumb 最常见的位置是 [PageHeader](../basic/card-section-page-header.md) 顶部：

```ts
const breadcrumb = new RenderBreadcrumb({
  items: [
    { key: 'home', label: '首页' },
    { key: 'orders', label: '订单' },
    { key: 'detail', label: currentName },
  ],
  onNavigate: item => openModule(item.key),
})

const pageHeader = new RenderPageHeader({
  title: '订单详情',
  description: '查看订单执行状态和审计信息。',
  breadcrumb,
})
```

动态替换 PageHeader 上的面包屑时，应使用 `RenderPageHeader.setBreadcrumb()`，不要直接改 `pageHeader.breadcrumb` 字段。

## BreadcrumbItem

```ts
const breadcrumbItems: BreadcrumbItem[] = [
  { key: 'home', label: '首页' },
  { key: 'item', label: '条目' },
  { key: 'record', label: '文档编辑', disabled: true },
]
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | `string` | 是 | 稳定标识。用于业务路由、状态比较或日志。组件内部不强制唯一，但业务应保证同一 Breadcrumb 内唯一。 |
| `label` | `string` | 是 | 显示文本。 |
| `disabled` | `boolean` | 否 | 禁用该项。禁用项不响应鼠标和键盘激活。 |

当前组件没有 `icon`、`tooltip`、`href`、`children` 或下拉菜单配置。需要这些能力时，应在业务层组合独立导航控件，或扩展 Breadcrumb API 后再使用。

## 构造参数

```ts
const breadcrumb = new RenderBreadcrumb({
  items: [
    { key: 'home', label: '首页' },
    { key: 'item', label: '条目' },
    { key: 'record', label: '文档编辑' },
  ],
  disabled: false,
  onNavigate: (item, index) => {
    state.lastBreadcrumb = `${index}:${item.key}`
  },
})
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `items` | `BreadcrumbItem[]` | 必填 | 路径项。构造函数会复制一份数组。 |
| `disabled` | `boolean` | `false` | 是否禁用整个 Breadcrumb。禁用后不响应鼠标和键盘导航，并退出焦点顺序。 |
| `onNavigate` | `(item: BreadcrumbItem, index: number) => void` | `undefined` | 激活前序可交互项时触发。最后一项和禁用项不会触发。 |

## 属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `items` | `BreadcrumbItem[]` | 当前路径项数组。构造时会复制传入数组，后续可整体替换。 |
| `disabled` | `boolean` | 整体禁用状态。设为 `true` 会释放焦点、清理 hover 和键盘焦点项。 |
| `onNavigate` | `(item, index) => void \| undefined` | 导航回调。 |
| `isFocused` | `boolean` | 当前 Breadcrumb 是否持有焦点。 |

动态更新路径：

```ts
const breadcrumb = new RenderBreadcrumb({
  items: [
    { key: 'home', label: '首页' },
    { key: 'item', label: '条目' },
    { key: 'record', label: '文档编辑' },
  ],
})

breadcrumb.items = [
  { key: 'home', label: '首页' },
  { key: 'item', label: '条目' },
  { key: 'detail', label: currentName },
]
breadcrumb.markNeedsLayout()
```

如果只修改某个 `label` 或 `disabled`，也需要请求布局或重绘。`label` 可能影响宽度，应优先调用 `markNeedsLayout()`。

## 方法

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `focusIn()` | `void` | 进入焦点状态。若当前没有焦点项，会聚焦第一个可交互项。 |
| `focusOut()` | `void` | 退出焦点状态。 |
| `onKeyDown(event)` | `boolean` | 处理方向键、Home、End、Enter 和 Space。通常由焦点系统调用。 |
| `dispose()` | `void` | 从 `FocusManager` 注销，并清空 `onNavigate` 引用。 |

它还实现了 `InteractiveRenderObject` 的指针事件方法，由手势和 hit-test 系统调用。

## 鼠标行为

| 操作 | 行为 |
| --- | --- |
| hover 路径项 | 非当前项根据主题切换 hover 文本色。 |
| 主按钮点击前序项 | 设置焦点，更新内部焦点项，并触发 `onNavigate(item, index)`。 |
| 主按钮点击最后一项 | 设置焦点和焦点项，但不触发导航。 |
| 主按钮点击禁用项 | 设置焦点和焦点项，但不触发导航。 |
| 整体 `disabled = true` | 不设置焦点，不响应点击，不触发 `onNavigate`。 |
| 指针离开或取消 | 清除 hover 状态并重绘。 |
| 点击组件外部 | 如果事件分发到该组件且 hit-test 不命中，不触发导航。 |

只有主按钮会被处理。组件不处理右键菜单、拖拽或双击。

## 键盘行为

Breadcrumb 注册到 `FocusManager`，获得焦点后支持：

| 按键 | 行为 |
| --- | --- |
| `ArrowLeft` / `ArrowUp` | 聚焦上一个可交互项。 |
| `ArrowRight` / `ArrowDown` | 聚焦下一个可交互项。 |
| `Home` | 聚焦第一个可交互项。 |
| `End` | 聚焦最后一个可交互项。 |
| `Enter` / `Space` | 激活当前聚焦项，触发 `onNavigate`。 |

可交互项定义为：

- 不是最后一项。
- 没有 `disabled: true`。

如果所有前序项都禁用，焦点索引会保持为 `-1`，激活不会触发回调。

当 `disabled = true` 时，Breadcrumb 会从焦点顺序中移除，方向键、Home、End、Enter 和 Space 都返回 `false`。

## 布局和绘制

- Breadcrumb 没有子 render object，所有文字、分隔符和焦点环都由自身绘制。
- 宽度按所有 `label` 文本宽度、分隔符宽度和间距累加。
- 高度来自主题的 breadcrumb 高度。
- 绘制时会裁剪到自身 `size`，超出宽度的文本不会继续画到外部。
- 分隔符使用 `chevron-right` 图标。
- 最后一项使用 selected 文本色，表示当前路径。
- 禁用项或整体 disabled 使用 disabled 文本色。
- 当前实现不自动省略单个 item，也不自动显示 tooltip。容器宽度不足时只是整体 clip。

如果需要“过长 label 省略 + hover 展示完整文本”，应在 Breadcrumb API 中增加明确的测量和 tooltip 能力，不能只依赖当前 clip 行为。

## 主题来源

样式来自 `deriveBreadcrumbStyle(theme)`：

| 样式 | 来源语义 |
| --- | --- |
| 普通文字 | `theme.textSecondary` |
| hover / focused / selected 文字 | `theme.textPrimary` |
| disabled 文字 | `theme.textDisabled` |
| 分隔符 | `theme.textDisabled` |
| 字号 | `theme.fontSize - 1`，下限 11 |
| 高度 | `theme.controlHeight`，下限 20 |
| 间距 | `theme.itemSpacing` |
| 焦点圆角 | `theme.frameRounding - 1`，下限 2 |

Breadcrumb 不绘制背景，通常由 PageHeader、Toolbar 或页面容器提供背景。

## 生命周期

- 构造时在可见且未禁用状态下注册到 `FocusManager`。
- 设置 `visible = false` 或 `disabled = true` 时会退出焦点顺序。
- `dispose()` 时注销焦点并释放回调引用。
- Breadcrumb 没有子节点，因此 `visitChildren()` 为空。
- 放入 PageHeader 时，PageHeader 会在 attach/detach 过程中管理它的父子关系。

页面销毁或替换 Breadcrumb 时，应确保旧实例被 detach/dispose，避免保留 `onNavigate` 里的业务对象引用。

## 性能边界

- Breadcrumb 每次 layout 会测量所有 item 文本宽度。
- 一般路径项很少，开销可以忽略。
- 不适合展示几十级路径，也不适合频繁每帧更新 label。
- 如果路径来自大对象树，应先在业务层折叠为少量关键层级。

## 常见问题

### 为什么最后一项点击没有反应？

最后一项是当前页面或当前对象，组件把它作为 selected 状态，不作为导航入口。

### disabled 的最后一项有什么区别？

最后一项本来就不可导航；设置 `disabled` 只会改变文字颜色。通常不需要给最后一项设置 disabled。

### 为什么长文本没有省略号？

当前 Breadcrumb 只做整体裁剪，不做单项省略。需要省略和 tooltip 时应扩展组件或在上层压缩路径文案。

### 可以在每一项里放 icon 吗？

当前 `BreadcrumbItem` 只支持 `key/label/disabled`。需要图标时，应先扩展通用 Breadcrumb API，而不是在业务页里复制一套绘制逻辑。

### onNavigate 里应该做什么？

只做业务导航或状态切换，例如打开上级模块、切换 workspace tab、定位对象列表。不要在 Breadcrumb 内部直接管理页面生命周期。

## 相关文档

- [PageHeader / Section / Card](../basic/card-section-page-header.md)
- [NavigationMenu 导航菜单](./navigation-menu.md)
- [Tabs 标签](./tabs.md)
- [TabbedWorkspace 标签工作区](./tabbed-workspace.md)
- [DockWorkspace 停靠工作区](./dock-workspace.md)
- [焦点与输入](../../lifecycle.md)
