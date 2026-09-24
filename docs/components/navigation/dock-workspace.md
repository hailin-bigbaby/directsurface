# DockWorkspace 停靠工作区

> **通用布局能力**：`RenderDockWorkspace` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；文档内容自身也按其 `RenderBox` 属性参与工作区布局。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderDockWorkspace` 是可停靠、可拆分、可浮动的多窗口工作区视图，`DockWindowManager` 是对应的窗口记录、布局树和生命周期管理器。它适合 IDE、App 工作台、调试工具台、文档工作区这类“多个业务窗口长期并存，并且允许用户把窗口拖出、拖回、左右/上下分屏”的界面。

当前 `RenderDockWorkspace` 管理的是一棵单一 dock tree。`left`、`right`、`top`、`bottom` 停靠会在这棵 tree 内创建 split；它还不是完整的 workbench-level dock manager，不提供左侧/右侧/底部工具区与中心文档区的同级 region、auto-hide tool strip 或多 tab floating group。

核心分工：

- `DockWindowManager`：打开文档、打开已有窗口、激活、关闭、关闭保护、浮动、停靠、拆分、拖拽状态、布局树和局部 App Context。
- `RenderDockWorkspace`：订阅 manager，把 `DockLayoutNode` 渲染为 tab group 与 splitter，绘制 dock guide、drop preview、空状态，并处理工作区级快捷键。
- `RenderWindow`：实际文档窗口外壳。停靠时用 tabbed presentation，浮动时作为 host window 的 owned window。

Dock guide、拖放预览及其激活状态使用 `DockWorkbench` 主题配方，不绑定固定的蓝色或深色面板；切换浅色、深色或高对比度主题时会同步更新。


## API 总览

```ts
import {
  DockWindowManager,
  RenderDockWorkspace,
  RenderText,
  RenderWindow,
  type DockDropScope,
  type DockDropTarget,
  type DockDropZone,
  type DockLayoutNode,
  type DockOpenWindowOptions,
  type DockSplitNode,
  type DockTabGroupNode,
  type DockWindowRecord,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `DockWindowManager` | class | 窗口记录、dock 布局树、浮动窗口、拖拽状态、关闭保护和订阅。 |
| `RenderDockWorkspace` | class | 把 manager 的 dock tree 渲染为可拖拽、可拆分、可浮动的工作区。 |
| `RenderWindow` | class | 被 manager 管理的窗口外壳。`openDocument()` 会自动创建，`openWindow()` 可接管已有窗口。 |
| `DockWindowRecord` | type | 已打开文档或窗口的记录。 |
| `DockLayoutNode` | type | dock 布局树节点，可能是 tab group 或 split。 |
| `DockTabGroupNode` | type | tab group 节点，保存一组停靠窗口和 active window。 |
| `DockSplitNode` | type | split 节点，保存方向、比例和两个子节点。 |
| `DockDropZone` | type | 停靠区域：`center`、`left`、`right`、`top`、`bottom`。 |
| `DockDropTarget` / `DockDropScope` | type | 拖拽命中结果和命中范围。 |
| `DockOpenWindowOptions` | type | `openWindow()` 接管已有 `RenderWindow` 时的元数据。 |

最小装配顺序是：创建 `DockWindowManager`，用 `openDocument()` 或 `openWindow()` 注册窗口，再把 manager 传给 `RenderDockWorkspace`。需要浮动窗口时，还要通过 `setWindowHost()` 绑定顶层 `RenderWindow`。

## 何时使用

使用 DockWorkspace：

- 页面需要像 IDE 一样支持左右/上下拆分。
- tab 可以拖出成为 floating window，也可以拖回工作区。
- 检查器、文档、订单、时间轴等窗口可以在同一棵 dock tree 内并排工作。
- 浮动窗口仍要保留原文档上下文、命令状态和关闭保护。
- 需要右键菜单：浮动窗口、新建垂直标签组、新建水平标签组、关闭、关闭其他、关闭右侧、关闭全部。

不要使用：

- 只需要标签头，使用 [Tabs](./tabs.md)。
- 只需要“标签 + 当前内容页”，使用 [TabView](./tab-view.md)。
- 需要普通多文档 tab，但不允许浮动和拆分，使用 [TabbedWorkspace](./tabbed-workspace.md)。
- 只是一个普通左右布局，使用 [DockPanel](../../layouts.md)。
- 需要 Visual Studio 风格的左/右工具区、中心文档区、底部输出区、pin/auto-hide 和多工具 floating group，应使用后续 workbench-level dock 组件。

## 最小示例

```ts
const manager = new DockWindowManager()

manager.openDocument({
  tabId: 'item-chart',
  title: '条目总览',
  content: new RenderText('条目总览内容'),
})

const workspace = new RenderDockWorkspace({
  manager,
})
```

`openDocument()` 会把业务内容包入文档上下文 host，再创建一个内部 `RenderWindow`。该窗口默认以 tabbed presentation 停靠到当前 active group。

## 使用宿主窗口承载浮窗

如果工作区允许浮动窗口，应把应用当前顶层窗口传给 manager。浮动窗口会作为 host window 的 owned window 管理，这样才能保持层级、置顶和统一释放。

```ts
const hostWindow = new RenderWindow({ title: '工作台' })
const manager = new DockWindowManager()
manager.setWindowHost(hostWindow)

const workspace = new RenderDockWorkspace({
  manager,
  disposeManagerOnDispose: true,
})
```

如果没有调用 `setWindowHost()`，manager 仍会维护 `floatingWindows`，但浮窗不会自动加入某个顶层窗口的 owned window 集合。业务工作台通常应在页面或 shell 初始化时设置 host。

## 打开已有 RenderWindow

`openWindow()` 用于把已经创建好的 `RenderWindow` 纳入 dock 管理。它适合工具窗口、运行时诊断窗口、对象检查器窗口等场景。

```ts
const manager = new DockWindowManager()
const inspector = new RenderWindow({
  title: '对象查看器',
  width: 420,
  height: 320,
})

inspector.setChildren([
  new RenderText('检查器内容'),
])

manager.openWindow(inspector, {
  tabId: 'inspector',
  title: '对象查看器',
  icon: 'search',
})
```

注意：`openWindow()` 的生命周期和上下文 hook 从 `RenderWindow` 本身读取，不会把 window 的子节点当作文档 content。业务页面通常用 `openDocument()`；工具窗口可以用 `openWindow()`。

## 程序化拆分

```ts
const manager = new DockWindowManager()

manager.openDocument({
  tabId: 'chart',
  title: '条目总览',
  content: new RenderText('条目总览'),
})

manager.openDocument({
  tabId: 'orders',
  title: '订单录入',
  content: new RenderText('订单录入'),
})

const orders = manager.getDocument('orders')
if (orders && manager.root.type === 'tabs') {
  manager.dockWindow(orders.window, manager.root, 'right')
}
```

`dockWindow(window, group, 'right')` 会创建 horizontal split。`left/top` 的新 group 放在 first，`right/bottom` 的新 group 放在 second。

## 浮动和拖回

```ts
const manager = new DockWindowManager()
manager.openDocument({
  tabId: 'timeline',
  title: '项目时间轴',
  content: new RenderText('项目时间轴'),
})

const record = manager.getDocument('timeline')
if (record) {
  manager.floatWindow(record.window, {
    x: 80,
    y: 60,
    width: 420,
    height: 260,
  })

  manager.dockWindow(record.window)
}
```

浮动不会释放 content，也不会重建上下文。拖回中心区域等价于 `dockWindow(window, targetGroup, 'center')`；拖到工作区边缘等价于 `dockWindowToWorkspace(window, zone)`。

floating document 作为 runtime root 时仍保留完整交互合同：内部输入控件保持焦点和 InputComposer / IME 会话，工作区快捷键通过窗口转发回 `RenderDockWorkspace`，剪枝 split 时会释放 splitter 和任何活跃 pointer capture。lifecycle、focus、owned-window 和 state callback 的嵌套操作不会递归发送通知，也不能暴露半提交布局。

`root`、`documents` 和 `DockWindowRecord` 是只读运行时视图。它们保留 window / group handle 身份，但布局修改必须通过 `DockWindowManager` API；完整性修改同样会被拒绝。

## 文档上下文

DockWorkspace 复用 [TabbedWorkspace](./tabbed-workspace.md) 的文档上下文模型：

```ts
const itemIdKey = createAppContextKey<string>('item-id')
const manager = new DockWindowManager()

manager.openDocument({
  tabId: 'orders',
  title: '订单录入',
  content: new RenderText('订单内容'),
  contextValues: [[itemIdKey, 'enc-001']],
})

const record = manager.getDocument('orders')
const itemId = record?.context.appContext.get(itemIdKey)
```

上下文规则：

- `openDocument()` 会创建 `RenderAppContextScope` 包裹业务 content。
- 未传 `context` 时，manager 创建私有 `AppContextRegistry`，关闭文档时默认释放。
- 传入外部 `context` 时，默认不释放外部 context。
- 传入 `contextValues` 时，会注入到文档 context。
- `floatWindow()` 和 `dockWindow()` 只迁移窗口，不替换文档 context。
- content 实现 `TabbedDocumentContextAware` 时，打开时调用 `attachDocumentContext(context)`，关闭或 dispose 时调用 `detachDocumentContext()`。

## 关闭保护

```ts
let saved = false
const manager = new DockWindowManager()

manager.openDocument({
  tabId: 'editor',
  title: '编辑器',
  dirty: true,
  content: new RenderText('编辑内容'),
  beforeClose: () => saved,
})
```

关闭保护优先级：

1. `TabbedDocumentDefinition.beforeClose`
2. content 上的 `beforeDocumentClose()`
3. 默认允许关闭

`beforeClose` 和 `beforeDocumentClose()` 支持同步或异步返回 `boolean`。返回 `false` 或抛出异常时关闭会被取消。`closable: false` 的文档不会被 `closeDocument()`、右键关闭和 `Ctrl/Meta + W` 关闭。

## Tab Tooltip

`tooltip` 会投影到 docked tab 和 floating window 的 tab 元信息。它当前是字符串字段，适合展示页面来源、业务对象摘要或未保存说明；字符串中可以使用 `\n` 显示多行短文本。

```ts
manager.openDocument({
  tabId: 'system-role-permission',
  title: '角色权限管理',
  content: new RenderText('角色权限内容'),
  tooltip: [
    '菜单路径：系统设置 / 平台管理 / 角色权限管理',
    '页面路径：/platform/roles',
  ].join('\n'),
})
```

如果需要可交互说明或复杂排版，不要塞进 tab tooltip；使用 [Popover](../overlay/popover.md)、侧栏或页面内详情区承载。

## DockWindowManager 属性

| API | 类型 | 说明 |
| --- | --- | --- |
| `root` | `DockLayoutNode` | 当前 dock 布局树根节点。可能是 `tabs` 或 `split`。 |
| `documents` | `readonly DockWindowRecord[]` | 所有已注册文档，包含 docked 和 floating。顺序为打开顺序。 |
| `activeTabId` | `string \| null` | 当前 active 文档 ID。 |
| `activeDocument` | `DockWindowRecord \| undefined` | 当前 active 文档。active floating window 优先。 |
| `floatingWindows` | `readonly RenderWindow[]` | 当前浮动窗口列表。 |
| `hasDockedDocuments` | `boolean` | 是否存在停靠在工作区里的文档。 |
| `dropTarget` | `DockDropTarget \| null` | 拖拽中命中的停靠目标。 |
| `dragPosition` | `Offset \| null` | 当前拖拽位置副本。 |
| `isDragging` | `boolean` | 是否正在 dock 拖拽。 |
| `isDraggingFloatingWindow` | `boolean` | 当前拖拽是否来自浮动窗口。 |

## DockWindowManager 方法

| API | 返回值 | 说明 |
| --- | --- | --- |
| `subscribe(listener)` | `() => void` | 订阅 manager 变化。返回取消订阅函数。 |
| `setWindowHost(host?)` | `void` | 设置浮动窗口所属顶层窗口。切换 host 时会迁移已有 floating windows。 |
| `setDropResolver(resolver?)` | `void` | 设置拖拽命中解析器。通常由 `RenderDockWorkspace` 构造时自动设置。 |
| `hasDocument(tabId)` | `boolean` | 判断文档是否已打开。 |
| `getDocument(tabId)` | `DockWindowRecord \| undefined` | 获取文档记录。 |
| `openDocument(definition)` | `void` | 打开业务文档。重复 `tabId` 时只更新元数据并激活已有文档，不替换 content。 |
| `openWindow(window, options?)` | `void` | 打开已有 `RenderWindow`。重复 window 时重新停靠到目标 group。 |
| `activateDocument(tabId)` | `boolean` | 激活文档。 |
| `activateWindow(window)` | `boolean` | 激活指定窗口。浮窗会 bring-to-front 并设置焦点。 |
| `closeDocument(tabId)` | `Promise<boolean>` | 关闭文档，执行 closable 和关闭保护。 |
| `closeActiveDocument()` | `Promise<boolean>` | 关闭当前 active 文档。 |
| `activateRelativeDocument(dir)` | `boolean` | 按打开顺序激活上一个或下一个文档，`dir` 为 `1` 或 `-1`。 |
| `closeWindow(window)` | `Promise<boolean>` | 关闭指定窗口。 |
| `moveDocument(tabId, targetIndex)` | `boolean` | 在当前 tab group 内移动文档。 |
| `moveWindowInGroup(group, window, targetIndex)` | `boolean` | 在指定 group 内移动窗口。 |
| `updateDocument(tabId, patch)` | `boolean` | 更新标题、closable、dirty、tooltip、icon。 |
| `dockWindow(window, targetGroup?, zone?)` | `boolean` | 把窗口停靠到指定 tab group。默认停靠到 active group 的 center。 |
| `dockWindowToWorkspace(window, zone)` | `boolean` | 把窗口停靠到整个 workspace 的边缘。`zone` 不能是 center。 |
| `floatWindow(window, rect?)` | `boolean` | 把窗口变为 floating，并可设置初始 rect。 |
| `beginDrag(window, position)` | `void` | 开始 dock 拖拽。通常由 tab 或 floating window 交互触发。 |
| `updateDrag(position)` | `void` | 更新拖拽位置和 drop target。 |
| `endDrag(position)` | `void` | 结束拖拽，根据 drop target 停靠、拆分或浮动。 |
| `cancelDrag(window?)` | `void` | 取消拖拽。浮窗拖拽取消时恢复起始 rect。 |
| `isDraggingWindow(window)` | `boolean` | 判断某个窗口是否正在拖拽。 |
| `dispose()` | `void` | 释放所有文档、窗口、上下文、订阅和拖拽状态，并重置为空 root group。 |

## TabbedDocumentDefinition

`openDocument()` 使用 `TabbedDocumentDefinition`。这和 TabbedWorkspace 是同一套定义。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tabId` | `string` | 是 | 文档稳定 ID。 |
| `title` | `string` | 是 | tab 和窗口标题。 |
| `content` | `RenderBox` | 是 | 业务内容。manager 会把它包入文档 context host。 |
| `context` | `AppContextRegistry` | 否 | 外部传入的页面上下文。 |
| `contextValues` | `AppContextInitialValues` | 否 | 创建上下文时注入的初始值。 |
| `disposeContextOnClose` | `boolean` | 否 | 关闭文档时是否释放 context。 |
| `closable` | `boolean` | 否 | 是否可关闭，默认 `true`。 |
| `dirty` | `boolean` | 否 | 是否显示 dirty dot，默认 `false`。 |
| `tooltip` | `string` | 否 | tab tooltip，支持 `\n` 多行短文本。 |
| `icon` | `IconName` | 否 | tab icon。 |
| `beforeClose` | `() => boolean \| Promise<boolean>` | 否 | 显式关闭保护。 |

## DockOpenWindowOptions

`openWindow(window, options)` 使用 `DockOpenWindowOptions`。

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `tabId` | `string` | 自动生成 | dock 文档 ID。 |
| `title` | `string` | `window.title` | tab 标题和记录标题。 |
| `closable` | `boolean` | `true` | 是否可关闭。 |
| `dirty` | `boolean` | `false` | 是否显示 dirty dot。 |
| `tooltip` | `string` | `undefined` | tab tooltip，支持 `\n` 多行短文本。 |
| `icon` | `IconName` | `undefined` | tab icon。 |
| `beforeClose` | `() => boolean \| Promise<boolean>` | `undefined` | 关闭保护。 |
| `targetGroup` | `DockTabGroupNode` | active group | 初始停靠目标。 |
| `context` | `AppContextRegistry` | 新建 context | window 使用的 app context。 |
| `contextValues` | `AppContextInitialValues` | `undefined` | 注入 context 的初始值。 |
| `disposeContextOnClose` | `boolean` | 取决于 context 来源 | 关闭 window 时是否释放 context。 |

## DockWindowRecord

manager 内部保存的文档记录：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `tabId` | `string` | 文档 ID。 |
| `title` | `string` | 当前标题。 |
| `content` | `RenderBox` | 业务内容。`openWindow()` 时为 window 自身。 |
| `contentHost` | `RenderBox` | 实际挂载进 window 的 host。`openDocument()` 时为 context scope。 |
| `appContext` | `AppContextRegistry` | 文档上下文。 |
| `window` | `RenderWindow` | 文档窗口。 |
| `closable` | `boolean` | 是否可关闭。 |
| `dirty` | `boolean` | 是否有 dirty 标记。 |
| `tooltip` | `string \| undefined` | tab tooltip。 |
| `icon` | `IconName \| undefined` | tab icon。 |
| `beforeClose` | `() => boolean \| Promise<boolean>` | 关闭保护。 |
| `context` | `TabbedDocumentContext` | 文档上下文对象，供页面更新自身 tab 状态。 |

## 布局节点

`DockLayoutNode` 是 manager 的布局树：

```ts
type DockLayoutNode = DockTabGroupNode | DockSplitNode
```

| 类型 | 字段 | 说明 |
| --- | --- | --- |
| `DockTabGroupNode` | `type: 'tabs'` | 一个 tab group。包含 `id`、`windows`、`activeWindow`。 |
| `DockSplitNode` | `type: 'split'` | 一个分割节点。包含 `id`、`direction`、`ratio`、`first`、`second`。 |

拆分方向：

- `zone: 'left' | 'right'` 创建 `direction: 'horizontal'`。
- `zone: 'top' | 'bottom'` 创建 `direction: 'vertical'`。
- 新 pane 默认占比为 `0.32` 或 `0.68`，取决于停靠方向。

## Drop Target

拖拽时 `RenderDockWorkspace.hitTestDrop(position)` 返回 `DockDropTarget | null`。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `group` | `DockTabGroupNode` | 命中的 tab group。 |
| `zone` | `DockDropZone` | `center`、`left`、`right`、`top`、`bottom`。 |
| `rect` | `Rect` | 命中区域。 |
| `scope` | `DockDropScope` | `pane` 表示 pane 内停靠，`workspace` 表示整个工作区边缘停靠。 |
| `previewRect` | `Rect` | 绘制 drop preview 的区域。 |

通常不需要业务手动设置 drop resolver。`RenderDockWorkspace` 构造时会调用 `manager.setDropResolver(position => this.hitTestDrop(position))`。

## RenderDockWorkspace Options

```ts
const manager = new DockWindowManager()
const workspace = new RenderDockWorkspace({
  manager,
  disposeManagerOnDispose: false,
})
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `manager` | `DockWindowManager` | 必填 | 窗口状态源。 |
| `disposeManagerOnDispose` | `boolean` | `false` | workspace dispose 时是否一并 dispose manager。 |

## RenderDockWorkspace 属性和方法

| API | 类型 | 说明 |
| --- | --- | --- |
| `manager` | `DockWindowManager` | 当前工作区使用的 manager。 |
| `handleUnhandledKeyDownFromDescendant(target, event)` | `boolean` | 处理从后代冒泡来的未处理快捷键。 |
| `hitTestDrop(position)` | `DockDropTarget \| null` | 根据全局位置命中 dock guide 或 tab header。 |
| `dispose()` | `void` | 取消订阅、清理 resolver、释放 group/splitter render 缓存，并按配置决定是否释放 manager。 |

## 右键菜单

tab 右键菜单包含：

| 操作 | 说明 |
| --- | --- |
| `浮动窗口` | 把当前 tab 转为 floating window。 |
| `新建垂直标签组` | 把当前 tab 停靠到当前 group 右侧，形成左右拆分。group 只有一个 tab 时禁用。 |
| `新建水平标签组` | 把当前 tab 停靠到当前 group 底部，形成上下拆分。group 只有一个 tab 时禁用。 |
| `关闭` | 关闭当前 tab。不可关闭时禁用。 |
| `关闭其他标签页` | 关闭除当前 tab 外的 closable 文档。 |
| `关闭右侧标签页` | 关闭当前 group 中位于当前 tab 右侧的 closable 文档。 |
| `关闭所有标签页` | 关闭所有 closable 文档。 |

批量关闭按顺序调用 `closeDocument()`。如果某个文档被关闭保护拒绝，后续关闭会停止。

## 快捷键

`RenderDockWorkspace.handleUnhandledKeyDownFromDescendant()` 支持：

| 快捷键 | 行为 |
| --- | --- |
| `Ctrl + Tab` / `Meta + Tab` | 按打开顺序激活下一个文档，包含 floating documents。 |
| `Ctrl + Shift + Tab` / `Meta + Shift + Tab` | 激活上一个文档。 |
| `Ctrl + W` / `Meta + W` | 关闭 active 文档。active 文档 `closable === false` 时不处理。 |

它处理从 docked 后代冒泡的未处理快捷键，floating document 则由其 `RenderWindow` 转发到同一处理器。因此 `Ctrl/Meta+Tab` 和 `Ctrl/Meta+W` 在 docked / floating 状态共享同一合同。全局命令、菜单快捷键和业务按钮权限仍应通过命令系统管理。

## 拖拽和停靠行为

- 在 tab strip 内拖动，只执行 tab 重排。
- tab 指针离开 header strip 后，才进入 dock drag。
- 拖到另一个 group 的 tab header，会合并到该 group center。
- 拖到 pane 的中心/边缘 guide，会在 pane 内合并或拆分。
- 拖到 workspace 边缘 guide，会把窗口停靠到整个工作区边缘。
- 拖出工作区且没有 drop target，会变成 floating window。
- 浮窗拖拽取消时恢复开始拖拽前的 rect。

## 布局和绘制

- workspace 客户区背景使用 `theme.surfaceContent`。
- root 为 tab group 时，绘制 tab header 和 active `RenderWindow`。
- root 为 split 时，递归渲染 `RenderSplitter`。
- 没有 docked documents 时，绘制空状态文本：`暂无 Dock 文档`。
- 拖拽中绘制 drop preview 和 dock guide button。
- 无限约束下 workspace 默认尺寸为 `720 x 420`。
- 停靠状态下 `RenderWindow` 使用 tabbed presentation，不绘制独立窗口 chrome。
- 浮动状态下 `RenderWindow` 使用 floating presentation，由 host window owned windows 绘制。

## 生命周期和释放

默认 `disposeManagerOnDispose: false`：

- workspace 释放时取消订阅 manager。
- 清理 drop resolver。
- 释放内部 tab group view 和 splitter view。
- 不关闭 manager 中的 documents。
- 适合 manager 生命周期由外层工作台 controller 管理。

设置 `disposeManagerOnDispose: true`：

- workspace dispose 时调用 `manager.dispose()`。
- manager 会释放所有 records、windows、content、context、订阅和拖拽状态。
- 适合简单页面或 demo 中 workspace 独占 manager 的场景。

关闭单个文档时：

1. 检查 `closable`。
2. 防止同一个 tabId 重入关闭。
3. 执行关闭保护。
4. 从 floating set、layout tree、recordOrder 中移除。
5. detach 文档上下文。
6. 触发 active 文档 deactivated/activated。
7. dispose `RenderWindow`。

## 与 Tabs / TabView / TabbedWorkspace 的区别

| 组件 | 用途 |
| --- | --- |
| `RenderTabs` | 只负责标签头、关闭按钮、重排、overflow 和右键菜单入口。 |
| `RenderTabControl` / `RenderTabItem` | 轻量 tab view，适合局部组件内部切页。 |
| `RenderTabbedWorkspace` | 多文档 tab 工作区，不支持浮动和拆分。 |
| `RenderDockWorkspace` | 多窗口工作区，支持 tabbed、floating、split docked。 |

## 性能边界

- DockWorkspace 只布局当前布局树中的 group、splitter 和 active windows。
- 每个 group 只挂载 active window；同组非 active window 不参与内容布局绘制。
- floating windows 由 host window owned windows 管理，仍会参与顶层窗口布局/绘制。
- 大型业务页面失活后应暂停数据轮询、动画和高频刷新。
- 不要把业务状态绑定到当前停靠位置；位置只是用户工作台布局状态。
- 大型系统如需持久化布局，应在业务层序列化 `DockLayoutNode` 所需信息，不要直接持久化 render object。

## 常见问题

### 重复打开同一个 tabId 会替换内容吗？

不会。`openDocument()` 遇到重复 `tabId` 时只更新标题、closable、dirty、tooltip、icon 并激活已有文档，不替换原 content。新传入的 replacement content 不会被 manager 接管。

### 浮动窗口还能读取原页面上下文吗？

可以。`floatWindow()` 只改变 presentation 和宿主关系，不改变文档 `appContext`。前提是文档创建时通过 `context` 或 `contextValues` 正确注入上下文。

### closeDocument 为什么返回 false？

常见原因：

- `tabId` 不存在。
- 文档 `closable` 是 `false`。
- 同一个文档正在关闭中。
- `beforeClose` 返回 `false` 或抛异常。
- content 的 `beforeDocumentClose()` 返回 `false` 或抛异常。

### 为什么浮窗没有显示？

检查是否给 manager 设置了顶层 host：

```ts
const manager = new DockWindowManager()
const hostWindow = new RenderWindow({ title: '工作台' })
manager.setWindowHost(hostWindow)
```

没有 host 时，manager 仍知道哪些窗口是 floating，但不会自动把它们加入某个顶层窗口的 owned windows。

### 可以直接操作 root 布局树吗？

只读分析可以。业务代码不要直接改 `manager.root` 内部节点，应通过 `dockWindow()`、`dockWindowToWorkspace()`、`floatWindow()`、`closeDocument()` 等方法修改，保证 record、parent、owner、active 状态和生命周期同步。

## 相关文档

- [TabbedWorkspace](./tabbed-workspace.md)
- [Tabs](./tabs.md)
- [TabView](./tab-view.md)
- [DockPanel](../../layouts.md)
- Floating Window 指南
- App Context
- 命令与权限
