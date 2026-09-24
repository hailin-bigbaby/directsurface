# TabbedWorkspace 标签工作区

> **通用布局能力**：`RenderTabbedWorkspace` 及其 `RenderBox` 内容实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；文档管理器只负责生命周期和切换。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderTabbedWorkspace` 是多文档 tab 工作区视图，`TabbedDocumentManager` 是对应的文档状态和生命周期管理器。它们适合复杂业务系统中“多个页面/文档同时打开、可切换、可关闭、可重排、各自有局部上下文”的场景。

核心分工：

- `TabbedDocumentManager`：文档记录、active 状态、打开、激活、更新、关闭、关闭保护、生命周期通知、局部 app context。
- `RenderTabbedWorkspace`：订阅 manager，把 documents 投影到 [RenderTabs](./tabs.md)，布局当前 active document content，提供 tab 右键菜单和常用快捷键。


## API 总览

```ts
import {
  RenderTabbedWorkspace,
  TabbedDocumentManager,
  RenderText,
  type TabbedDocumentContext,
  type TabbedDocumentContextAware,
  type TabbedDocumentDefinition,
  type TabbedDocumentLifecycle,
  type TabbedDocumentPatch,
  type TabbedDocumentRecord,
} from 'directsurface'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `TabbedDocumentManager` | class | 文档状态、active tab、打开/关闭、关闭保护、上下文和订阅。 |
| `RenderTabbedWorkspace` | class | 把 manager 状态渲染为 tabbed 工作区，并处理当前 active content 的布局。 |
| `TabbedDocumentDefinition` | type | `openDocument()` 和 `setDocuments()` 的输入定义。 |
| `TabbedDocumentRecord` | type | manager 保存的只读文档记录。 |
| `TabbedDocumentPatch` | type | `updateDocument()` 和 document context 更新字段。 |
| `TabbedDocumentContext` | type | 传给页面内容的文档上下文。 |
| `TabbedDocumentContextAware` | interface | 页面内容可实现，用于接收/释放 document context。 |
| `TabbedDocumentLifecycle` | interface | 页面内容可实现，用于关闭保护和激活/失活通知。 |

最小装配顺序是：创建 `TabbedDocumentManager`，用 `openDocument()` 注册内容，再把 manager 传给 `RenderTabbedWorkspace`。文档内容由 manager 持有，关闭文档时才释放对应 context 和 content host。

## 何时使用

使用 TabbedWorkspace：

- 工作台支持多个业务页面同时打开。
- 每个 tab 需要自己的页面实例和页面上下文。
- 关闭 tab 需要执行 `beforeClose` 或页面生命周期保护。
- 页面需要知道自己所属 tab，并能更新标题、dirty、tooltip、icon 或请求关闭。
- 需要右键菜单：关闭、关闭其他、关闭右侧、关闭全部。
- 需要 Ctrl/Meta + Tab 切换，Ctrl/Meta + W 关闭 active tab。

不要使用：

- 只需要标签头，使用 [Tabs](./tabs.md)。
- 页面内轻量“标签 + 当前内容”，使用 [TabView](./tab-view.md)。
- 需要停靠、拆分、浮动窗口，使用 [DockWorkspace](./dock-workspace.md)。
- 需要浏览器级路由和缓存策略完全由业务掌控时，可以自己组合 Tabs 和页面容器。

## 最小示例

```ts
const manager = new TabbedDocumentManager()

manager.openDocument({
  tabId: 'item-list',
  title: '条目列表',
  content: new RenderText('条目列表'),
})

const workspace = new RenderTabbedWorkspace({
  manager,
})
```

`openDocument()` 会打开新文档并激活它；如果 `tabId` 已存在，则更新标题、closable、dirty、tooltip、icon 并激活已有 tab，不替换原 content。

## 页面上下文示例

```ts
const itemIdKey = createAppContextKey<string>('item-id')
const manager = new TabbedDocumentManager()

manager.openDocument({
  tabId: 'orders',
  title: '订单录入',
  content: new RenderText('订单内容'),
  contextValues: [[itemIdKey, 'enc-001']],
})

const workspace = new RenderTabbedWorkspace({
  manager,
  disposeManagerOnDispose: true,
})
```

如果打开文档时没有传 `context`，manager 会为该文档创建独立 `AppContextRegistry`，并在文档关闭时随 content host 一起释放。

## 更新文档状态示例

```ts
const manager = new TabbedDocumentManager()
manager.openDocument({
  tabId: 'record',
  title: '文档',
  content: new RenderText('文档内容'),
})

manager.updateDocument('record', {
  title: '文档 *',
  dirty: true,
  tooltip: '有未保存修改',
  icon: 'document',
})
```

`updateDocument()` 只更新 tab 元数据，不替换 content。

## 关闭保护示例

```ts
const manager = new TabbedDocumentManager()

manager.openDocument({
  tabId: 'editor',
  title: '编辑器',
  content: new RenderText('编辑内容'),
  dirty: true,
  beforeClose: () => {
    return canSave()
  },
})
```

`beforeClose` 返回 `false` 或抛出异常时，关闭会被取消。异步返回 `Promise<boolean>` 也支持。

## TabbedDocumentDefinition

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tabId` | `string` | 是 | 文档稳定 ID。用于去重、激活、关闭和排序。 |
| `title` | `string` | 是 | tab 标题。 |
| `content` | `RenderBox` | 是 | 文档内容实例。manager 会把它包入文档 context host。 |
| `context` | `AppContextRegistry` | 否 | 外部传入的页面上下文。 |
| `contextValues` | `AppContextInitialValues` | 否 | 创建文档上下文时注入的初始值。 |
| `disposeContextOnClose` | `boolean` | 否 | 关闭文档时是否释放 context。未传 context 时默认释放；传入外部 context 时默认不释放。 |
| `closable` | `boolean` | 否 | 是否可关闭，默认 `true`。 |
| `dirty` | `boolean` | 否 | 是否显示未保存 dirty dot，默认 `false`。 |
| `tooltip` | `string` | 否 | tab tooltip。 |
| `icon` | `IconName` | 否 | tab icon。 |
| `beforeClose` | `() => boolean \| Promise<boolean>` | 否 | 显式关闭保护。优先级高于 content 上的 lifecycle。 |

同一 `tabId` 重复打开时：

- 不替换已有 content。
- 更新 title、closable、dirty、tooltip、icon。
- 激活已有 tab。
- 调用方传入的 replacement content 不会被 manager 自动 dispose，所有权仍属于调用方。

## TabbedDocumentRecord

manager 内部保存的记录：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `tabId` | `string` | 文档 ID。 |
| `title` | `string` | 当前标题。 |
| `content` | `RenderBox` | 原始内容实例。 |
| `contentHost` | `RenderBox` | 包装后的 app context scope host。workspace 实际挂载它。 |
| `appContext` | `AppContextRegistry` | 文档上下文。 |
| `closable` | `boolean` | 是否可关闭。 |
| `dirty` | `boolean` | dirty 状态。 |
| `tooltip` | `string \| undefined` | tooltip。 |
| `icon` | `IconName \| undefined` | icon。 |
| `beforeClose` | `() => boolean \| Promise<boolean>` | 显式关闭保护。 |
| `context` | `TabbedDocumentContext` | 传给内容的文档上下文对象。 |

业务通常读取 `documents`、`activeDocument`、`getDocument()`，不要直接修改 record 字段；修改状态应使用 `updateDocument()` 或 document context。

## TabbedDocumentManager API

| API | 返回值 | 说明 |
| --- | --- | --- |
| `documents` | `readonly TabbedDocumentRecord[]` | 当前文档列表。 |
| `activeTabId` | `string \| null` | 当前 active tabId。 |
| `activeDocument` | `TabbedDocumentRecord \| undefined` | 当前 active 文档。 |
| `hasDocument(tabId)` | `boolean` | 是否存在文档。 |
| `getDocument(tabId)` | `TabbedDocumentRecord \| undefined` | 获取文档。 |
| `subscribe(listener)` | `() => void` | 订阅 manager 状态变化。返回取消订阅函数。 |
| `openDocument(definition)` | `void` | 打开或激活文档。 |
| `activateDocument(tabId)` | `boolean` | 激活文档。不存在或已经 active 返回 false。 |
| `closeDocument(tabId)` | `Promise<boolean>` | 关闭文档。会执行关闭保护。 |
| `closeActiveDocument()` | `Promise<boolean>` | 关闭 active 文档。 |
| `activateRelativeDocument(dir)` | `boolean` | 相对切换文档。`1` 向后，`-1` 向前，循环。 |
| `moveDocument(tabId, targetIndex)` | `boolean` | 调整文档顺序。 |
| `setDocuments(definitions)` | `void` | 用一组定义重置所有文档。重复 tabId 会抛错。 |
| `updateDocument(tabId, patch)` | `boolean` | 更新 tab 元数据。无变化或不存在返回 false。 |
| `dispose()` | `void` | 释放所有文档、context、contentHost、订阅和 closing 状态。 |

## TabbedDocumentPatch

`updateDocument()` 和 `TabbedDocumentContext.update()` 支持的字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `title` | `string` | 标题。传 `undefined` 时保留旧值。 |
| `closable` | `boolean` | 是否可关闭。传 `undefined` 时保留旧值。 |
| `dirty` | `boolean` | dirty 状态。传 `undefined` 时保留旧值。 |
| `tooltip` | `string \| undefined` | tooltip。显式传 `undefined` 会清除。 |
| `icon` | `IconName \| undefined` | icon。显式传 `undefined` 会清除。 |

## TabbedDocumentContext

如果 content 实现 `TabbedDocumentContextAware`，manager 打开文档时会调用 `attachDocumentContext(context)`，关闭或重置时会调用 `detachDocumentContext()`。

| API | 类型 | 说明 |
| --- | --- | --- |
| `tabId` | `string` | 当前文档 ID。 |
| `isActive` | `boolean` | 当前文档是否 active。 |
| `appContext` | `AppContextRegistry` | 当前文档上下文。 |
| `activateSelf()` | `boolean` | 激活当前文档。 |
| `requestClose()` | `Promise<boolean>` | 请求关闭当前文档。 |
| `update(patch)` | `boolean` | 更新当前文档元数据。 |
| `setTitle(title)` | `boolean` | 更新标题。 |
| `setDirty(dirty)` | `boolean` | 更新 dirty。 |
| `setTooltip(tooltip?)` | `boolean` | 更新或清除 tooltip。 |
| `setIcon(icon?)` | `boolean` | 更新或清除 icon。 |

[RenderPage](../basic/card-section-page-header.md) 已支持 document context，可直接使用 `setDirty()`、`setTitle()`、`requestClose()` 等页面级方法。

## 生命周期接口

内容可以实现 `TabbedDocumentLifecycle`：

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `beforeDocumentClose()` | `boolean \| Promise<boolean>` | 关闭保护。没有 definition.beforeClose 时才会使用。 |
| `onDocumentActivated()` | `void` | 文档变为 active 时调用。 |
| `onDocumentDeactivated()` | `void` | 文档从 active 切走或关闭时调用。 |

关闭保护优先级：

1. `TabbedDocumentDefinition.beforeClose`
2. content 的 `beforeDocumentClose()`
3. 默认允许关闭

如果关闭保护抛异常，manager 会按拒绝关闭处理。

## RenderTabbedWorkspace Options

```ts
const manager = new TabbedDocumentManager()
const workspace = new RenderTabbedWorkspace({
  manager,
  emptyTitle: '暂无页面',
  emptyDescription: '从左侧导航打开一个模块。',
  disposeManagerOnDispose: false,
})
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `manager` | `TabbedDocumentManager` | 必填 | 文档状态源。 |
| `emptyTitle` | `string` | `'暂无打开的模块'` | 无 active content 时居中显示的标题。 |
| `emptyDescription` | `string` | 默认业务提示 | 无 active content 时居中显示的说明。 |
| `disposeManagerOnDispose` | `boolean` | `false` | workspace dispose 时是否一并 dispose manager。 |

## RenderTabbedWorkspace 属性和能力

| API | 类型 | 说明 |
| --- | --- | --- |
| `manager` | `TabbedDocumentManager` | 文档状态源。 |
| `tabs` | `RenderTabs` | 内部标签条。由 manager documents 投影生成。 |
| `handleUnhandledKeyDownFromDescendant(target, event)` | `boolean` | 从子树向上冒泡的快捷键处理。 |
| `dispose()` | `void` | 关闭右键菜单、取消订阅，并根据配置决定是否释放 manager。 |

Workspace 会订阅 manager。manager 变化时：

- 更新 `tabs.tabs`。
- 更新 `tabs.activeKey`。
- 切换 active contentHost。
- 关闭已不存在 tab 的右键菜单。
- 请求布局。

## 标签右键菜单

右键 tab 会打开内置菜单：

| 操作 | 说明 |
| --- | --- |
| `关闭` | 关闭当前 tab。不可关闭时禁用。快捷键文本显示 `Ctrl+W`。 |
| `关闭其他标签页` | 依次关闭其他 closable tabs。 |
| `关闭右侧标签页` | 依次关闭右侧 closable tabs。 |
| `关闭所有标签页` | 依次关闭所有 closable tabs。 |

批量关闭会按顺序执行 `closeDocument()`。如果某个文档关闭保护拒绝，后续批量关闭会停止。

## 快捷键

`RenderTabbedWorkspace.handleUnhandledKeyDownFromDescendant()` 支持：

| 快捷键 | 行为 |
| --- | --- |
| `Ctrl + Tab` / `Meta + Tab` | 激活下一个文档，循环。 |
| `Ctrl + Shift + Tab` / `Meta + Shift + Tab` | 激活上一个文档，循环。 |
| `Ctrl + W` / `Meta + W` | 关闭 active 文档。active 文档 `closable === false` 时不处理。 |

它只处理从后代冒泡来的未处理快捷键。全局快捷键或命令快捷键仍应通过命令系统管理。

## App Context 策略

每个文档都会有一个 contentHost：

- contentHost 是 `RenderAppContextScope`。
- 如果 definition 提供 `context`，使用该外部 context。
- 如果只提供 `contextValues`，创建新的子 context 并注入 values。
- 如果没有提供 context，创建文档私有 context。
- 默认情况下，manager 创建的 context 会随文档关闭释放。
- 外部传入的 context 默认不释放，除非 `disposeContextOnClose: true`。

这让某个 tab 页内部的组件、弹窗和子页面可以通过上下文查到页面私有数据；tab 关闭后上下文随页面释放。

## 布局和绘制

- Workspace 顶部布局内部 `RenderTabs`。
- active contentHost 布局在标签条下方。
- 有限高度下，body 高度为 `constraints.maxHeight - tabs.height`。
- 无限高度下，body 高度至少 `260`。
- 没有 active content 时，绘制空状态标题和说明。
- 切换 active content 时，会清理旧 active content 内部焦点，避免焦点留在已 detach 子树。

## Dispose 策略

默认 `disposeManagerOnDispose: false`：

- workspace dispose 时取消订阅 manager。
- detach 当前 active contentHost。
- 不 dispose manager，也不 dispose manager 中的 documents。
- 适合 manager 生命周期由外层 app/workspace controller 管理。

设置 `disposeManagerOnDispose: true`：

- workspace dispose 时同步 dispose manager。
- manager 会释放所有 documents、context、contentHost 和订阅。
- 适合 workspace 独占 manager 的简单页面。

## 与 Tabs / TabView / DockWorkspace 的区别

| 组件 | 职责 |
| --- | --- |
| `RenderTabs` | 只绘制标签头和交互回调，不管理内容。 |
| `RenderTabControl` | 标签头 + 当前内容页，轻量 page 切换。 |
| `RenderTabbedWorkspace` | 多文档 tab 工作区，带 manager、context、关闭保护、右键菜单和快捷键。 |
| `RenderDockWorkspace` | 停靠/拆分/浮动窗口工作区。 |
| `RenderDockWorkbench` | workbench-level 左/中/右/底同级区域工作台。 |

## 性能边界

- manager 会持有所有已打开文档的 content 实例和上下文。
- inactive documents 不挂载到 workspace active content，但对象仍在内存中。
- 大量复杂页面同时打开会占用内存；业务应限制打开数量或提供关闭/释放策略。
- dirty、title、tooltip 等元数据更新只会刷新 tab strip，不应重建 content。
- 批量关闭可能执行多个异步 close guard，应避免在 close guard 中做长时间阻塞工作。

## 常见问题

### 重复 openDocument 会替换内容吗？

不会。重复 tabId 只更新元数据并激活已有文档。新传入的 replacement content 不由 manager 接管，也不会自动 dispose。

### closeDocument 为什么返回 false？

可能是文档不存在、正在关闭中、`beforeClose` 返回 false、content lifecycle 拒绝关闭，或 close guard 抛异常。

### inactive document 会被销毁吗？

不会。它只是没有挂载为 workspace 的 active content。关闭文档或 dispose manager 时才释放。

### dispose workspace 后文档为什么还在？

默认 workspace 不拥有 manager。要让 workspace 销毁时连带释放所有文档，构造时设置 `disposeManagerOnDispose: true`。

### 页面怎么更新自己的 tab 标题或 dirty 状态？

实现 `TabbedDocumentContextAware` 获取 context，或使用 `RenderPage` 内置的 document context 方法，然后调用 `setTitle()`、`setDirty()` 等。

## 相关文档

- [Tabs 标签](./tabs.md)
- [TabView 标签视图](./tab-view.md)
- [DockWorkspace 停靠工作区](./dock-workspace.md)
- App Context 与页面生命周期
- Tab Workspace 指南
- [焦点与输入](../../lifecycle.md)
