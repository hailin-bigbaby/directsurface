# TabView 标签视图

> **通用布局能力**：`RenderTabItem` 和 `RenderTabControl` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；标签 chrome 的高度和 padding 属于组件内部规格。详见[组件通用布局属性](../common-layout-properties.md)。


`RenderTabControl` 是“标签条 + 当前内容页”的组合控件。它内部持有一个 [RenderTabs](./tabs.md) 作为标签头，并使用 `RenderTabItem` 承载每个 tab 对应的内容。

它适合页面内部的轻量 tab 内容切换：所有页面实例由业务创建，TabView 只显示当前 active page，切换时 detach 旧 active page、attach 新 active page。它不提供文档工作区、关闭确认、持久化、浮动窗口或分屏布局。

## API 总览

```ts
import {
  RenderTabControl,
  RenderTabItem,
  RenderText,
  type RenderTabControlOptions,
  type RenderTabItemOptions,
} from 'directsurface'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderTabControl` | class | 标签头和当前内容页容器。负责 active page 的 attach/detach、标签投影和关闭 fallback。 |
| `RenderTabItem` | class | 单个内容页。保存稳定 `key`、`title`、`closable` 和 `content`。 |
| `RenderTabControlOptions` | type | `RenderTabControl` 构造参数。 |
| `RenderTabItemOptions` | type | `RenderTabItem` 构造参数。 |

最小装配顺序是：创建 `RenderTabControl`，创建一个或多个 `RenderTabItem`，再用 `addPage()` 或 `addChild()` 加入 control。业务不需要直接创建内部 `RenderTabs`。

## 何时使用

使用 TabView：

- 一个页面内部有几个固定或动态内容页。
- 需要 `RenderTabs` 标签头，同时需要框架帮你布局当前内容。
- 希望 inactive page 不参与当前渲染树，但仍保留实例。
- 关闭 tab 时只需要简单移除 page。

不要使用：

- 只需要标签头，不需要内容管理。使用 [Tabs](./tabs.md)。
- 多文档工作区、关闭保护、最近文档、生命周期钩子。使用 [TabbedWorkspace](./tabbed-workspace.md)。
- 停靠、拆分、浮动窗口。使用 [DockWorkspace](./dock-workspace.md)。
- 大量页面懒加载、权限路由和缓存策略复杂的系统。建议业务显式管理页面生命周期，再组合 Tabs 或 Workspace。

## 最小示例

```ts
const tabView = new RenderTabControl({
  activeKey: 'summary',
  onTabChange: key => {
    state.activeTab = key
  },
})

tabView.addPage(new RenderTabItem({
  key: 'summary',
  title: '摘要',
  content: new RenderText('摘要内容'),
}))

tabView.addPage(new RenderTabItem({
  key: 'detail',
  title: '明细',
  content: new RenderText('明细内容'),
}))
```

## 可关闭页示例

```ts
const documents = new RenderTabControl({
  activeKey: 'record-a',
  onTabChange: key => {
    state.activeTab = key
  },
  onTabClose: key => {
    state.closedTab = key
  },
})

documents.addPage(new RenderTabItem({
  key: 'record-a',
  title: '文档 A',
  closable: true,
  content: new RenderText('文档 A 内容'),
}))

documents.addPage(new RenderTabItem({
  key: 'record-b',
  title: '文档 B',
  closable: true,
  content: new RenderText('文档 B 内容'),
}))
```

`RenderTabControl.closePage(key)` 会移除 page 并触发 `onTabClose(key)`。如果关闭的是 active page，会根据相邻 page 选择新的 active key，并在 active key 变化时触发 `onTabChange(nextKey)`。

## RenderTabItemOptions

```ts
const page = new RenderTabItem({
  key: 'settings',
  title: '设置',
  closable: true,
  content: new RenderText('设置内容'),
})
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `key` | `string` | 必填 | 页面的稳定标识，同时投影为标签 key。 |
| `title` | `string` | 必填 | 标签显示标题。 |
| `closable` | `boolean` | `false` | 是否投影为 `RenderTabs` 的 closable。 |
| `content` | `RenderBox` | `undefined` | 页面内容。 |

`RenderTabItem` 不是单纯数据对象，它本身是 `RenderBox`，用于包裹内容并参与 attach/detach/layout。

## RenderTabItem 属性和方法

| API | 类型 | 说明 |
| --- | --- | --- |
| `key` | `string` | 只读。页面 key。 |
| `title` | `string` | 可写。标签标题。修改后需要调用父级同步或重新布局。 |
| `closable` | `boolean` | 可写。是否可关闭。修改后需要让 TabControl 同步 tabs。 |
| `content` | `RenderBox \| undefined` | 当前内容。 |
| `setContent(content?)` | `void` | 替换内容，并处理旧内容 parent/detach、新内容 parent/attach，然后请求布局。 |

示例：

```ts
const page = new RenderTabItem({
  key: 'preview',
  title: '预览',
  content: new RenderText('加载中'),
})

page.setContent(new RenderText('预览内容'))
```

## RenderTabControlOptions

```ts
const control = new RenderTabControl({
  activeKey: 'first',
  onTabChange: key => {
    state.activeTab = key
  },
  onTabClose: key => {
    state.closedTab = key
  },
})
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `activeKey` | `string` | 必填 | 初始 active page key。 |
| `onTabChange` | `(key: string) => void` | `undefined` | 用户通过标签头切换，或关闭 active page 后 fallback 到新 page 时触发。 |
| `onTabClose` | `(key: string) => void` | `undefined` | 成功关闭 page 后触发。 |

## RenderTabControl 属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `tabs` | `RenderTabs` | 内部标签头。可用于读取状态或接入低层 tab 交互。 |
| `pages` | `readonly RenderTabItem[]` | 当前全部页面。 |
| `activeKey` | `string` | 当前 active key。setter 会同步 `tabs.activeKey` 和 active page，但不会触发 `onTabChange`。 |
| `activePage` | `RenderTabItem \| undefined` | 当前 active page。 |
| `activeContent` | `RenderBox \| undefined` | 当前 active page 的 content。 |

`tabs.tabs` 由 TabControl 根据 `pages` 自动生成，格式为 `{ key, label: title, closable }`。不要手工修改内部 `tabs.tabs`，否则会和 `pages` 不一致。

## RenderTabControl 方法

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `addChild(page)` | `void` | 添加页面。key 重复会抛错。 |
| `addPage(page)` | `void` | `addChild()` 的别名。 |
| `hasPage(key)` | `boolean` | 是否存在指定 key。 |
| `getPage(key)` | `RenderTabItem \| undefined` | 查找 page。 |
| `removeChild(page)` | `void` | 移除指定 page。若是 active page，会选择 fallback active key。 |
| `removePage(page)` | `void` | `removeChild()` 的别名。 |
| `closePage(key)` | `boolean` | 按 key 关闭 page。成功返回 true，不存在返回 false。 |
| `clearChildren()` | `void` | 清空全部 pages、active 状态和标签头。 |
| `dispose()` | `void` | 释放 inactive pages，再释放自身和 active 子树。 |

## 内容生命周期

TabView 的生命周期策略很明确：

- 所有 page 实例由业务创建并传入。
- `pages` 中可以保留 inactive page 实例。
- `visitChildren()` 只访问 `tabs` 和当前 `activePage`。
- 切换 active page 时，旧 active page 会 detach，新 active page 会 attach。
- inactive page 不在当前渲染树中，不参与布局和绘制。
- `dispose()` 会主动 dispose inactive pages；active page 随父级 dispose 流程释放。

这意味着 TabView 是“保留实例、只挂载当前页”的策略。它不是“每次切换销毁重建”，也不是“所有页面都同时挂载”。

## active 和 fallback 规则

设置 active：

```ts
const tabView = new RenderTabControl({
  activeKey: 'summary',
})
tabView.addPage(new RenderTabItem({
  key: 'summary',
  title: '摘要',
  content: new RenderText('摘要内容'),
}))
tabView.addPage(new RenderTabItem({
  key: 'detail',
  title: '明细',
  content: new RenderText('明细内容'),
}))

tabView.activeKey = 'detail'
```

直接设置 `activeKey`：

- 同步内部 `tabs.activeKey`。
- 切换 active page。
- 不触发 `onTabChange`。

用户点击标签头：

- 内部 `RenderTabs` 触发 `onTabChange`。
- TabControl 设置 `activeKey`。
- 再调用外部 `onTabChange(key)`。

移除或关闭 active page 时：

- 优先选择被移除项后面的 page。
- 如果没有后面的 page，则选择前一个 page。
- 如果没有 page，则 active key 变为 `''`。
- `closePage()` 关闭 active page 且 fallback key 发生变化时，会触发 `onTabChange(nextKey)`。
- `removeChild()` 是底层移除，不触发 `onTabClose`。

## 关闭行为

标签关闭来自内部 `RenderTabs.onTabClose`，最终调用 `closePage(key)`。

`closePage(key)`：

- 找不到 page 时返回 `false`。
- 找到 page 时调用 `removeChild(page)`。
- 成功后触发 `onTabClose(key)`。
- 关闭 active page 并切换到新 active key 时，先触发 `onTabChange(nextKey)`，再触发 `onTabClose(key)`。

TabView 不提供关闭确认。如果需要“未保存提醒、阻止关闭、异步保存后关闭”，应使用 [TabbedWorkspace](./tabbed-workspace.md)，或在业务层不要直接调用 `closePage()`，先完成确认流程。

## 布局和绘制

- 根宽度使用父约束 `maxWidth`；无限宽时默认 `400`。
- 顶部先布局内部 `RenderTabs`。
- active page 布局在标签条下方。
- 有有限高度时，active page 获得剩余高度，并且 TabControl 自身高度等于父约束高度。
- 无限高度时，TabControl 高度为 `tabs.height + activePage.height`。
- 没有 active page 时，如果父约束高度有限，仍占满该高度。
- `performPaint()` 走默认子树绘制：先标签头，再 active page。

如果 active page 是 `RenderScrollViewer`，滚动内容不会遮挡标签头；事件分发仍可以命中顶部标签头。

## 与 RenderTabs 的关系

`RenderTabs` 只负责标签头：

- label、icon、dirty、close button。
- hover、键盘、拖拽、overflow。
- 触发 tab change/close/reorder/context menu 回调。

`RenderTabControl` 在此基础上增加：

- page 列表。
- active page 挂载/卸载。
- 内容区域布局。
- close page 后 fallback active key。

当前 `RenderTabControl` 只把 `key/title/closable` 投影到 `RenderTabs`。`RenderTabs` 的 `icon/dirty/tooltip/drag/context menu/overflow` 等高级能力没有在 `RenderTabItemOptions` 中直接暴露。需要这些能力时，优先使用 `RenderTabs` 自行组合内容区，或扩展 `RenderTabItemOptions` 后再使用。

## 性能边界

- inactive pages 保留实例，因此会占用内存，但不参与当前布局和绘制。
- active page 切换需要 detach/attach 子树，复杂页面切换可能有成本。
- 如果页面非常重，应由业务决定是否懒加载 content、销毁 inactive content 或使用工作区管理器。
- TabView 不做虚拟化，也不适合管理大量 tab 文档。

## 常见问题

### 为什么修改 title 后标签没有变？

`RenderTabControl` 通过 `_syncTabs()` 把 pages 投影到 `RenderTabs`。公开 API 没有单独的 `refreshTabs()`，所以动态修改 title 后，建议重新组织 pages 或触发布局时确保同步。当前更适合在创建 page 时确定 title。

### 为什么关闭 tab 没有确认？

TabView 是轻量组合控件，不做业务确认。需要关闭保护时，用 TabbedWorkspace 或业务层包一层确认流程。

### inactive page 会被销毁吗？

切换时不会销毁，只会 detach。`dispose()` TabControl 时，inactive pages 会被 dispose。

### 可以直接操作 tabView.tabs 吗？

可以读取，也可以接入低层事件，但不建议直接改 `tabView.tabs.tabs`，因为它会和 `pages` 状态脱节。

## 相关文档

- [Tabs 标签](./tabs.md)
- [TabbedWorkspace 标签工作区](./tabbed-workspace.md)
- [DockWorkspace 停靠工作区](./dock-workspace.md)
- [ScrollViewer 滚动容器](../../layouts.md)
- [布局模式](../../layouts.md)
