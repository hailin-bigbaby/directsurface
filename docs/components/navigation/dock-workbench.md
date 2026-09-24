# DockWorkbench 工作台停靠区

> **通用布局能力**：`RenderDockWorkbench` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；region、浮动窗口和 auto-hide 尺寸仍由工作台模型管理。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderDockWorkbench` 是 workbench-level dock 组件。它把左侧工具区、中心文档区、右侧工具区和底部工具区作为同级区域管理，适合构建 Visual Studio 风格的应用工作台骨架。

当前版本面向业务工作台的常用场景：打开文档、打开工具面板、关闭、浮动单个 item、浮动 tab group、基础 split floating group、调整 region splitter，并支持 region-aware dock guide、document-area guide cluster、拖拽停靠、工具区 auto-hide/pin 和 tab 右键命令。它不是完整的 Visual Studio 或 DevExpress Dock Manager 克隆；高级停靠向导、跨多浮窗复杂布局和布局持久化不属于当前组件边界。

## API 总览

```ts
import {
  DockWorkbenchManager,
  type DockWorkbenchBeforeEvent,
  type DockWorkbenchCloseRejectReason,
  type DockWorkbenchEvent,
  type DockWorkbenchCommandSource,
  type DockWorkbenchAdjacentDirection,
  RenderDockWorkbench,
  RenderText,
  RenderWindow,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `DockWorkbenchManager` | class | 管理 document/tool item、left/center/right/bottom regions、运行时尺寸和浮窗宿主。 |
| `RenderDockWorkbench` | class | 渲染 workbench-level regions 和 splitter。 |
| `DockDocumentDefinition` | type | `openDocument()` 的输入定义。 |
| `DockToolDefinition` | type | `openTool()` 的输入定义。 |
| `DockItemRecord` | type | 已打开 document/tool item 的运行时记录。 |
| `DockRegion` | type | region 名称：`left`、`center`、`right`、`bottom`。 |
| `DockWorkbenchDropTarget` | type | 拖拽停靠命中的 region、group、zone 和 preview rect。 |
| `DockWorkbenchFloatingGroup` | type | 浮动 tab group 的运行时宿主窗口和 tab group。 |
| `DockWorkbenchAutoHideItem` | type | 自动隐藏工具项的运行时记录。 |
| `DockWorkbenchAutoHideGroup` | type | 自动隐藏工具组的运行时记录。 |
| `DockWorkbenchBeforeEvent` | type | `subscribeBeforeEvent()` 发出的同步可取消事件。 |
| `DockWorkbenchBeforeEventType` | type | before 事件类型联合。 |
| `DockWorkbenchCloseRejectReason` | type | 关闭被拒绝时的原因联合。 |
| `DockWorkbenchEvent` | type | `subscribeEvent()` 发出的结构化运行时事件。 |
| `DockWorkbenchEventType` | type | 事件类型联合。 |
| `DockWorkbenchCommandSource` | type | 事件来源：`api`、`drag`、`menu`、`keyboard`、`hover`、`button`。 |
| `DockWorkbenchAdjacentDirection` | type | 相邻标签组方向：`previous` 或 `next`。 |

## 何时使用

使用 DockWorkbench：

- 需要左侧工具区、中心文档区、右侧工具区、底部输出区这样的工作台拓扑。
- 工具面板和文档需要有不同语义：document 默认进入 center，tool 默认进入 left/right/bottom。
- 需要证明工具区和文档区是同级区域，而不是中心文档区内部 split。
- 需要工具区支持 auto-hide/pin：收起到工作台边栏，点击边栏临时展开，再固定回原工具区。
- 需要工具区在窄宽度下仍直接展示多个 item 的图标入口，而不是把工具项折叠到 overflow 下拉菜单。

不要使用：

- 只需要普通多文档 tab，使用 [TabbedWorkspace](./tabbed-workspace.md)。
- 需要兼容现有单一 dock tree 语义和右键命令，使用 [DockWorkspace](./dock-workspace.md)。
- 需要跨多个 floating window 的高级 guide 体验或完整 Visual Studio 级别的 guide 视觉细节。
- 需要保存/恢复用户布局；当前方案明确不提供 `captureLayout()`、`restoreLayout()` 或 `resetLayout()`。

## 区域模型

DockWorkbench 的根布局由四类 region 组成：

| Region | Item 类型 | 典型用途 | 布局层级 |
| --- | --- | --- | --- |
| `left` | tool | 模块树、导航、Solution Explorer、工具箱。 | 与 center 同级。 |
| `center` | document | 编辑器、设计器、业务主文档。 | 工作台中心文档区。 |
| `right` | tool | 属性、检查器、上下文信息。 | 与 center 同级。 |
| `bottom` | tool | 输出、日志、问题列表、调试信息。 | 与 center 同级。 |

left/right/bottom 不是 center 文档区内部的 tab group。它们和 center 一起由 `RenderDockWorkbench` 管理，因此 splitter、auto-hide rail、workbench edge guide 都以工作台根区域为目标。

一个 region 内部可以有一个或多个 tab group；group 内部由 item tab 组成。document 默认只能进入 center，tool 默认只能进入 left/right/bottom。只有显式设置 `mixedDockingAllowed: true` 的 item 才允许跨越默认语义。

## 最小示例

```ts
const manager = new DockWorkbenchManager()

manager.openDocument({
  itemId: 'chart',
  title: '条目总览',
  content: new RenderText('中心文档内容'),
})

manager.openTool({
  itemId: 'solution',
  title: 'Solution Explorer',
  region: 'left',
  content: new RenderText('左侧工具内容'),
})

manager.openTool({
  itemId: 'properties',
  title: 'Properties',
  region: 'right',
  content: new RenderText('右侧工具内容'),
})

manager.openTool({
  itemId: 'output',
  title: 'Output',
  region: 'bottom',
  content: new RenderText('底部输出内容'),
})

const workbench = new RenderDockWorkbench({
  manager,
})
```


结果拓扑是：

```text
left tool region | center document region | right tool region
bottom tool region
```

## 打开文档

`openDocument()` 只创建 document item，并默认进入 `center`。

```ts
manager.openDocument({
  itemId: 'orders',
  title: '订单录入',
  content: new RenderText('订单录入内容'),
  dirty: true,
})
```

重复打开相同 `itemId` 时，只更新 title、closable、dirty、tooltip、icon 等元数据并激活已有 item，不替换原 content。

## 打开工具面板

`openTool()` 只创建 tool item，并要求显式指定 `region`：

```ts
manager.openTool({
  itemId: 'output',
  title: 'Output',
  region: 'bottom',
  content: new RenderText('日志输出'),
})
```

可用 tool region：

| Region | 用途 |
| --- | --- |
| `left` | 导航、模块树、Solution Explorer。 |
| `right` | 属性面板、对象检查器。 |
| `bottom` | 输出、日志、问题列表。 |

同一 tool region 内可以拆分多个 tab group；关闭某个空 group 后会折叠，关闭某个 tool region 的最后一个 item 后，该 region 会折叠。同一运行时内记录的 region 尺寸不会被清空。

当 active tool group 因关闭、移动、浮动或 auto-hide 被剪枝时，如果同一 tool region 仍有其他 group，active item 会优先回退到该 region 的剩余 group，而不是直接跳回 center document region。

## 浮动和宿主窗口

当前版本支持单个 item floating，也支持把整个 tab group 浮动为一个 floating tab host。floating tab host 内可以通过新建垂直/水平标签组或拖拽 tab 到内部 pane guide 形成基础 split tree；split floating group dock 回 workbench region 时会保留 split 结构。

```ts
const hostWindow = new RenderWindow({ title: '工作台' })
manager.setWindowHost(hostWindow)
manager.floatItem('output', { x: 80, y: 80, width: 420, height: 260 })
manager.dockItem('output')
```

`dockItem()` 不传 region 时，会优先回到该 item 当前运行时记录的上一个 dock region。

```ts
const group = manager.regions.left
if (group?.type === 'tabs') {
  manager.floatGroup(group, { x: 120, y: 90, width: 460, height: 300 })
}
```

### Floating 交互合同

single floating item 和 floating tab group 都是完整的 runtime root，不是只负责绘制的镜像。它们必须保持：

- 内部 Tab、DataGrid、CodeEditor、TextBox、右键菜单和 pane guide 的全局命中坐标。
- 子控件已获得的焦点和 InputComposer / IME 会话；激活窗口不得把焦点抢回窗口根。
- floating group 提取为 single floating 时，tab drag 不会先清空当前输入焦点；正在进行的 composition 和 DataGrid cell editor 会随 Item 迁移。
- 与 docked 状态相同的工作台快捷键路由。
- Item 在 docked、single floating、floating group 和 auto-hide 之间恰好一处归属。
- 重新停靠、提取单项、拆分和关闭时的唯一 dispose 和 pointer capture 清理。

`regions`、`regionLayout`、`state`、`items` 和 `documents` 是只读运行时视图。它们保留 group / window handle 身份，但结构修改必须通过 Manager API；直接写入以及 `preventExtensions`、`freeze`、`seal` 等完整性修改都会抛出 `TypeError`，且不会改变底层 Manager 状态。

## Auto-Hide 与 Pin

tool item 或 tool tab group 可以从 `left`、`right` 或 `bottom` region 自动隐藏到边缘 tab strip。自动隐藏后的 item/group 不再占用 tool region split 空间，点击或短暂停留在边缘 tab 上会以临时 overlay 展开内容，点击 overlay 外部或指针离开 tab/overlay 后会收起当前展开项。overlay 右上角提供固定按钮，可把当前 item/group 固定回 dock region。

docked tool tab group 的标题栏也提供固定按钮。点击该按钮会把当前 tool item 或整个 tool tab group 收起到对应的 left/right/bottom 边缘 tab strip；边缘 tab strip 是工作台布局的一条停靠边栏，会为主内容区预留空间，不是覆盖在内容上的浮动按钮。left/right 边栏 tab 会显示图标和竖排标题，bottom 边栏 tab 横向显示图标和标题。之后点击边缘 tab 可以临时展开，overlay 固定按钮可以恢复停靠。tool tab group 在宽度不足时会保持直接可见的 compact icon strip，不切换到 overflow 下拉菜单。

docked tool group 和 auto-hide overlay group 使用一致的 tab header、close、pin 交互语义；差异只在父级容器：docked group 占用 region 尺寸，auto-hide overlay 由 workbench 外层管理并覆盖在内容上方。

```ts
manager.openTool({
  itemId: 'solution',
  title: 'Solution Explorer',
  region: 'left',
  content: new RenderText('解决方案树'),
  autoHideAllowed: true,
})

manager.autoHideItem('solution')
manager.showAutoHideItem('solution')
manager.hideAutoHideItem('solution')
manager.dockAutoHideItem('solution')

const group = manager.regions.left?.type === 'tabs' ? manager.regions.left : null
if (group) {
  manager.autoHideGroup(group)
  manager.dockAutoHideGroup(group.id)
}
```

规则：

- auto-hide 只适用于 tool item 或 tool tab group；document 默认不参与 auto-hide。
- `autoHideAllowed: false` 的 tool 不能自动隐藏。
- 同一运行时可以同时维护多个 left/right/bottom auto-hide item，点击不同边缘 tab 会切换临时展开项。
- auto-hide group 展开时会复原为临时多 tab overlay；固定 group 时会作为一个 tool tab group 回到目标 region。
- 边缘 tab 支持 hover 延迟展开；指针离开边缘 tab 和 overlay 后会延迟自动收回。
- docked tool tab group 标题栏的固定按钮会把当前 group 直接收起到边缘 tab strip；如果 group 只有一个 item，则只自动隐藏该 item。
- left/right/bottom auto-hide tab strip 会作为边栏参与 workbench 布局，主内容区会让出对应 rail 空间。
- left/right auto-hide tab 使用竖排文字标签；bottom auto-hide tab 使用横向文字标签。
- auto-hide overlay 内的固定按钮会固定当前 active item；如果 active item 属于 auto-hide group，则固定整个 group。
- auto-hide overlay 固定回 dock region 时，会优先恢复到 auto-hide 前的 region，并沿用该 region 当前运行时尺寸。
- tool tab group 窄宽度下使用 icon strip 展示所有 item；普通 document tab group 仍使用 overflow menu。
- auto-hide overlay 支持键盘操作：`Esc` 收起，`Ctrl/Meta+PageUp/PageDown` 切换 group tab，`Ctrl/Meta+Shift+P` 固定当前 item/group。
- `dockAutoHideItem()` 不传 region 时，会回到 auto-hide 前所在的 tool region。
- 关闭 auto-hide item 会清理对应边缘 tab、auto-hide group 记录和 active overlay 状态。
- auto-hide 当前是运行时状态，不提供布局保存、恢复或重置 API。

## 推荐业务工作台写法

业务工作台通常只需要持有一个 `DockWorkbenchManager`，由页面入口负责打开文档和工具面板。工具面板建议稳定使用业务无关的 `itemId`，这样重复打开时会激活并更新已有 item，而不是创建重复面板。

```ts
const manager = new DockWorkbenchManager()

function openItemOverview(): void {
  manager.openDocument({
    itemId: 'item-overview',
    title: '条目总览',
    content: new RenderText('条目总览文档'),
    icon: 'document',
  })
}

function openWorkbenchTools(): void {
  manager.openTool({
    itemId: 'solution',
    title: 'Solution Explorer',
    region: 'left',
    content: new RenderText('左侧工具'),
    icon: 'folder',
  })

  manager.openTool({
    itemId: 'toolbox',
    title: 'Toolbox',
    region: 'left',
    content: new RenderText('工具箱'),
    icon: 'toolbox',
  })

  manager.openTool({
    itemId: 'properties',
    title: 'Properties',
    region: 'right',
    content: new RenderText('属性面板'),
    icon: 'settings',
  })

  manager.openTool({
    itemId: 'output',
    title: 'Output',
    region: 'bottom',
    content: new RenderText('输出面板'),
    icon: 'document',
  })
}

openWorkbenchTools()
openItemOverview()

const workbench = new RenderDockWorkbench({ manager })
```

建议：

- document 用稳定业务页面 id，例如 `item-overview`、`order-entry`。
- tool 用稳定工具 id，例如 `solution`、`toolbox`、`properties`、`output`。
- 不需要 auto-hide 的工具设置 `autoHideAllowed: false`，例如必须常驻的关键导航区。
- 不希望被拖成浮窗的工具设置 `floatable: false`。
- 不要在业务层直接保存 `manager.regions` 作为持久化布局；它是当前运行时结构。

## Region Splitter 尺寸

left、right 和 bottom tool region 的 splitter 可以直接拖拽调整。调整结果写入 `manager.regionLayout.leftWidth`、`rightWidth` 和 `bottomHeight`，并触发 `region-layout-changed` 事件；用户拖拽 splitter 时事件 `source` 为 `drag`。

`regionLayout` 是当前运行时尺寸状态，不是跨会话布局快照。renderer 会按当前 workbench 尺寸、嵌套 splitter 的实际可用空间和中心区域最小尺寸做 clamp，避免 left/right/bottom tool region 把 center document area 挤到不可用。关闭或折叠某个 tool region 时，不会清空对应的运行时尺寸；同一会话内再次打开该 region 会继续使用之前记录的尺寸。

## 拖拽停靠

`RenderDockWorkbench` 支持基础 dock guide：

- 在同一个 region 的 tab group 内，拖动 tab 到 `center` 会合并为 tab，拖到 `left`、`right`、`top`、`bottom` 会拆分出新的 group。
- 在中心文档区域内，额外提供 `document-area` guide cluster，用于把 document 停靠到整个 center region，而不是只围绕当前 pane。
- floating group 拖回 pane 或 document-area guide 时，会消费对应 `center/left/right/top/bottom` zone；`center` 合并 tab，其他 zone 拆分 group。
- pane、document-area 和 workbench edge guide 使用不同的 cluster 背板和按钮尺寸，便于在拖拽时识别目标层级。
- 当前激活 pane 会使用更强的标题条和边框状态；非激活 pane 使用较弱边框，用于区分当前命令和键盘操作的作用范围。
- 拖动 tool 到 workbench 边缘 guide，可停靠到 `left`、`right` 或 `bottom` 工具区。
- Workbench 边缘 guide 的 preview 使用当前运行时 `leftWidth`、`rightWidth` 和 `bottomHeight`，更接近实际停靠后的区域尺寸。
- 拖拽位置落在 auto-hide 边缘 tab 或临时 overlay 上时，不会显示或命中 dock guide。
- 普通 document 默认只能停靠在 `center` region；普通 tool 默认只能停靠在 `left`、`right`、`bottom` region。
- 只有显式设置 `mixedDockingAllowed: true` 的 item 才能跨越 document/tool 默认区域约束。
- 拖拽过程中按 `Esc` 会取消当前拖拽；floating item 会恢复到拖拽开始时的位置和尺寸。

无合法 drop target 时，拖出的 docked item 会转为单个 floating item。

## Tab 右键命令

tab 右键菜单提供基础工作台命令：

| 命令 | 行为 |
| --- | --- |
| `自动隐藏` | 把当前 tool item 收起到所在 tool region 的边缘 tab strip。 |
| `固定停靠` | 把 auto-hide item 固定回原 tool region。 |
| `浮动窗口` | 把当前 item 变成单个 floating window。 |
| `浮动标签组` | 把当前 tab group 变成一个 floating tab host。 |
| `新建垂直标签组` | 在当前 region 内把当前 item 拆到右侧 group。 |
| `新建水平标签组` | 在当前 region 内把当前 item 拆到底部 group。 |
| `移动到上一个标签组` | 把当前 item 移到同一区域前一个 tab group。 |
| `移动到下一个标签组` | 把当前 item 移到同一区域后一个 tab group。 |
| `移动到左侧工具区` | 把当前 tool item 移到 `left` tool region。 |
| `移动到右侧工具区` | 把当前 tool item 移到 `right` tool region。 |
| `移动到底部工具区` | 把当前 tool item 移到 `bottom` tool region。 |
| `关闭` | 关闭当前 item，并执行 `beforeClose`。 |
| `关闭其他标签页` | 关闭当前 tab group 内除当前 item 外的可关闭 item。 |
| `关闭右侧标签页` | 关闭当前 group 内当前 tab 右侧的可关闭 item。 |
| `关闭当前标签组` | 关闭当前 group 内所有可关闭 item。 |

批量关闭会按顺序执行关闭保护；如果某个 item 拒绝关闭，后续 item 不会继续关闭。右键菜单里的 `关闭其他标签页`、`关闭右侧标签页` 和 `关闭当前标签组` 都限定在当前 tab group 内。`closeGroup()` 只关闭当前 group 内可关闭的 item；如果 group 内没有任何可关闭 item，会返回 `false`。

菜单可用性会跟随当前 placement 收紧：

- `自动隐藏` 和 `自动隐藏标签组` 只对 docked tool region 中的 tool item/group 可用。
- `浮动标签组` 只对 docked tab group 可用；floating group 已经处于浮动宿主内，不会再次整组浮动。
- `新建垂直标签组` 和 `新建水平标签组` 可用于 docked group 和 floating group 的内部拆分，但不会作用于 auto-hide overlay 的临时 tab group。
- auto-hide overlay 中主要提供 `固定停靠`、`固定标签组` 和关闭类命令；移动 region、再次 auto-hide、整组浮动和新建标签组会禁用。

## 信息密度和页面组合

DockWorkbench 面向传统后台主工作区，推荐作为页面 shell 的剩余空间容器，而不是放在 Card、说明面板或大留白区里。典型组合是：顶部使用紧凑 Toolbar/MenuBar 承载全局命令，左/右/底部 tool region 承载模块树、属性、输出、日志等工具面板，center region 承载业务文档、表格、编辑器或设计器。

默认 region 尺寸和 auto-hide rail 都按 dense 后台工作页设计。工具区在空间不足时优先使用 auto-hide/pin 和 icon-strip tab，而不是扩大 padding、堆叠卡片或把入口折叠成大面积空状态。业务页面需要更高密度时，应通过主题和组件 token 调整 DockWorkbench chrome 尺寸，而不是在页面局部覆盖绘制常量。

## 键盘命令

`RenderDockWorkbench` 提供基础工作台快捷键：

| 快捷键 | 行为 |
| --- | --- |
| `Esc` | 取消当前拖拽；如果 auto-hide overlay 已展开，则收起 overlay。 |
| `Ctrl/Meta+Alt+ArrowLeft` | 把当前 active tool item 移到 `left` tool region。 |
| `Ctrl/Meta+Alt+ArrowRight` | 把当前 active tool item 移到 `right` tool region。 |
| `Ctrl/Meta+Alt+ArrowDown` | 把当前 active tool item 移到 `bottom` tool region。 |
| `Ctrl/Meta+PageUp/PageDown` | 在当前 auto-hide group 内切换 active tab。 |
| `Ctrl/Meta+Shift+P` | 固定当前 auto-hide item 或 auto-hide group。 |
| `Ctrl/Meta+W` | 关闭当前 active item，并执行 `beforeClose`。 |

键盘移动只作用于 tool item；普通 document 仍默认限制在 center region。键盘触发的 dock、close、auto-hide show/hide 和 pin 事件都会带 `source: 'keyboard'`。

## 生命周期语义

`DockWorkbenchManager` 会在 active item 变化时调用内容上的 `onDocumentActivated()` 和 `onDocumentDeactivated()`。

规则：

- 打开新 document/tool 并成为 active item 时，会触发 activate；原 active item 会触发 deactivate。
- active item 切出时会记录该 item 内最后聚焦的 child；再次激活时，如果该 child 仍在当前 window 内且仍注册在 `FocusManager` 中，会恢复焦点。
- active group 被剪枝时，会优先把 active 回退到同一区域的剩余 group；只有该区域已空时才回退到 center document region。
- 在 dock、float、auto-hide、pin 回 dock 之间迁移时，不会 dispose content。
- close item 时才会 detach document context 并 dispose content。
- auto-hide overlay 激活后，再切回 docked item 会清理 `activeAutoHideItemId` 并触发对应 activate/deactivate。

## 事件订阅

`subscribeEvent()` 用于观察结构化运行时变化，适合业务工作台写日志、更新外部菜单状态或联动权限。它不同于 `subscribe()`；`subscribe()` 只是给渲染层订阅任意状态变化。

```ts
const unsubscribe = manager.subscribeEvent((event: DockWorkbenchEvent) => {
  if (event.type === 'item-docked') {
    console.log(event.itemId, event.region, event.source)
  }
})

unsubscribe()
```

`subscribeBeforeEvent()` 用于在状态改变前做同步 guard。listener 返回 `false` 时，本次操作会被取消，不会改变 workbench 状态，也不会发出对应的 after event。

```ts
const unsubscribeBefore = manager.subscribeBeforeEvent((event: DockWorkbenchBeforeEvent) => {
  if (event.type === 'before-item-float' && event.itemId === 'solution') {
    return false
  }
  return undefined
})

unsubscribeBefore()
```

before 事件是同步 API，适合权限、锁定面板、禁止拖出或禁止区域尺寸变化这类即时判断。异步关闭保护仍应使用 document/tool definition 上的 `beforeClose`。

before listener 内发起的普通布局 mutation 会被拒绝；`dispose()` 可以执行，并会使原操作失效。lifecycle、owned-window、focus、after-event 和 state 通知使用非递归 FIFO，嵌套操作会先完成原子提交，再在当前通知批次结束后发送自己的通知。

所有 after 事件和 before 事件都会携带 `source`，用于区分动作来源。业务层直接调用 manager API 时默认为 `api`；内置拖拽停靠和 Tab 重排为 `drag`；tab 右键菜单为 `menu`；workbench 快捷键为 `keyboard`；auto-hide hover 展开/收起为 `hover`；Tab 激活/关闭、floating chrome close、auto-hide 边缘 tab 点击、点击外部收起和 overlay 固定按钮为 `button`。这让外部日志、权限策略和遥测可以区分“用户交互导致的变更”和“业务代码调用导致的变更”。

内置 UI 操作不得回退为 `api`；`api` 只表示业务层直接调用 Manager。

当前事件类型包括：

| 类型 | 触发时机 |
| --- | --- |
| `item-opened` | 新 document/tool item 打开后。 |
| `item-updated` | item 元数据更新后。 |
| `item-activated` / `item-deactivated` | active item 变化时。 |
| `item-docked` / `item-floated` | 单个 item dock 或 float 后。 |
| `group-floated` / `group-docked` | tab group float 或 dock 回 workbench 后。 |
| `item-auto-hidden` | tool item 收起到 auto-hide tab strip 后；group auto-hide 会为 group 内每个 item 各发一次。 |
| `group-auto-hidden` | tool tab group 整组收起到 auto-hide tab strip 后。 |
| `auto-hide-shown` / `auto-hide-hidden` | auto-hide overlay 展开或收起后。 |
| `region-layout-changed` | `leftWidth`、`rightWidth` 或 `bottomHeight` 改变后。 |
| `item-closed` | item 通过关闭保护并完成关闭后。 |
| `item-close-rejected` | item 因 `closable: false`、重复关闭或 `beforeClose` 拒绝而未关闭。事件会携带 `closeRejectReason`。 |

当前 before 事件类型包括：

| 类型 | 可取消的操作 |
| --- | --- |
| `before-item-dock` | 单个 item dock 到 workbench region 或 group。 |
| `before-item-float` | 单个 item 转为 floating window。 |
| `before-group-float` | tab group 转为 floating group。 |
| `before-group-dock` | floating group dock 回 workbench region。 |
| `before-item-auto-hide` | tool item 收起到 auto-hide tab strip；group auto-hide 会对 group 内每个 item 各触发一次。 |
| `before-group-auto-hide` | tool tab group 整组收起到 auto-hide tab strip。 |
| `before-region-layout-change` | `leftWidth`、`rightWidth` 或 `bottomHeight` 改变。 |

## 与 DockWorkspace 的区别

| 组件 | 职责 |
| --- | --- |
| `RenderDockWorkspace` | 单一 dock tree；left/right/top/bottom 是同一棵 tree 内的 split。 |
| `RenderDockWorkbench` | workbench-level regions；left/right/bottom tools 与 center documents 是同级区域。 |

当前组件不会替换 `RenderDockWorkspace`。旧组件继续承载已有 demo 和调试面板，新 workbench 独立演进。

## 当前限制

- auto-hide/pin 支持多个 tool item 和 tool tab group 的 left/right/bottom 边缘 tab strip 和临时 overlay；不支持 auto-hide group split tree。
- Dock guide 已区分 pane group、center document area 和 workbench edge；active/inactive pane 有基础视觉状态，但不追求完整 Visual Studio 视觉细节。
- 支持多 tab floating group、基础 split floating group 和 floating 内部 pane guide；不覆盖跨多个 floating window 的高级 guide 体验。
- 不支持布局保存、恢复或重置，也不会新增 `captureLayout()`、`restoreLayout()` 或 `resetLayout()`。
- 不迁移主 demo 工作台和 Layout Inspector。

## 相关链接

- [DockWorkspace 停靠工作区](./dock-workspace.md)
- [TabbedWorkspace 标签工作区](./tabbed-workspace.md)
- [Splitter](../../layouts.md)
