# Popup 弹出层

> **与统一布局属性的关系**：`Popup` / `PopupManager` 是浮层生命周期和定位协议，不是普通 `RenderBox`。锚点或内容如果是 `RenderBox`，仍使用统一尺寸、margin 和对齐属性；popup 自身使用 viewport、anchor 和 open options。详见[组件通用布局属性](../common-layout-properties.md)。

Popup 是所有浮层能力的底层机制。`PopupManager` 负责 popup 栈、事件路由、外部点击关闭、Escape 关闭、焦点作用域、overlay 重绘和运行时上下文；具体业务通常使用 [ContextMenu](./context-menu.md)、[Popover](./popover.md)、[ComboBox](../selector/combo-box.md)、[DatePicker](../input/date-picker.md)、[ColorPicker](../input/color-picker.md)、[Modal](./modal.md)、[Drawer](./drawer.md)、[Loading](./loading.md) 等组件。

需要由 hover 打开、但允许鼠标进入并点击、复制或滚动的富内容，应使用 [HoverCard](./hover-card.md)。

核心边界：

- `PopupManager`、`Popup`、`PopupContext`、`PopupOpenOptions`、`PopupAnchor` 等是公共 API。
- 未从 `directsurface` 包入口导出的 popup 基础类型属于内部实现，外部业务不应依赖。
- 业务组件需要自定义浮层时，优先组合公共 popup API；应用特有行为应封装在业务模块中，不要自行复制一套 popup 管线。


## API 总览

```ts
import {
  GET_POPUP_ANCHOR_RECT,
  ImGuiLightTheme,
  OverlayInvalidator,
  PopupManager,
  TooltipManager,
  TooltipService,
  TooltipTarget,
  resolveAnchoredPopupRect,
  resolvePopupAnchorRect,
  resolvePopupAnchorTarget,
  type AnchoredPopupLayoutInput,
  type AnchoredPopupLayoutResult,
  type AnchoredPopupOverflowPreference,
  type AnchoredPopupPlacement,
  type Popup,
  type PopupAnchor,
  type PopupAnchorMode,
  type PopupAnchorPlacement,
  type PopupAnchorTarget,
  type PopupContext,
  type PopupContextProvider,
  type PopupOpenOptions,
  type PopupViewport,
  type TooltipContent,
  type TooltipPresenter,
} from 'directsurface'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `PopupManager` | class | popup 栈、事件路由、焦点作用域、外部点击关闭和 owner 关闭。 |
| `Popup` | type | popup 协议，定义 hit test、close、pointer、wheel、keyboard 等回调。 |
| `PopupContext` / `PopupViewport` | type | popup 绘制和定位所需的主题、视口、dpr 和 cursor 能力。 |
| `PopupAnchorMode` / `PopupContextProvider` | type | popup 的稳定/动态根锚定模式，以及按根创建上下文的 provider。 |
| `PopupOpenOptions` | type | 打开 popup 时的根锚定、closeExisting、closeOnTransient、interactionMode、owner、parent、persistent 配置。 |
| `GET_POPUP_ANCHOR_RECT` | symbol | 锚点目标暴露当前矩形的协议。 |
| `PopupAnchor` / `PopupAnchorPlacement` / `PopupAnchorTarget` | type | 锚点对象、携带 data 的锚点定位和目标协议。 |
| `resolvePopupAnchorRect()` / `resolvePopupAnchorTarget()` | function | 解析锚点矩形和原始 target。 |
| `resolveAnchoredPopupRect()` | function | 纯函数计算 top/bottom/left/right、start/end、fallback、overflow 和边界 clamp。 |
| `OverlayInvalidator` | class | overlay 重绘失效器。业务通常间接通过 `PopupManager.requestPaint()` 使用。 |
| `TooltipManager` | class | tooltip overlay 管理器。 |
| `TooltipService` | class | 当前 tooltip presenter 的全局安装和查找入口。 |
| `TooltipTarget` | class | 包装 tooltip 内容，供组件 hover 时调用当前 tooltip service。 |
| `TooltipContent` / `TooltipPresenter` | type | tooltip 内容和 presenter 协议。 |

最小装配顺序是：实现一个可重复关闭的 `Popup`，通过 `PopupManager.instance.open(popup, options)` 打开，在页面或 owner 销毁时调用 `closeOwnedBy(owner)` 或 `dismiss(popup)`。

## 何时关注 Popup

需要理解 Popup：

- 你在实现一个新的可复用浮层组件。
- 浮层需要跟随锚点滚动、缩放或布局变化。
- 页面关闭时需要统一关闭该页面打开的 popup。
- 需要处理 popup 内滚轮、键盘、焦点恢复或外部点击。
- 需要诊断“弹窗不跟随、点击外部不关闭、焦点无法恢复、内存没释放”等问题。

普通业务页面优先使用上层组件，不直接操作 `PopupManager`。

## 最小 Popup 协议示例

```ts
const popup: Popup = {
  hitTest(point) {
    return point.x >= 20 && point.x <= 180 && point.y >= 20 && point.y <= 120
  },
  close() {
    // 释放 popup 持有的临时状态
  },
}

PopupManager.instance.open(popup)
PopupManager.instance.closeTop()
```

这个示例只说明协议形状。真实组件还需要绘制、事件处理、定位和资源释放，通常不应在业务页面里直接写。

## PopupManager 生命周期

`PopupManager` 是单例：

```ts
const manager = PopupManager.instance
manager.setContextProvider(() => ({
  theme: ImGuiLightTheme,
  viewport: { width: 1280, height: 720, dpr: 1 },
}))

manager.requestPaint()
manager.closeAll()
```

运行时会设置 context provider 和 paint invalidator。测试或销毁运行时时可以调用：

```ts
PopupManager.disposeInstance()
```

`disposeInstance()` 会关闭所有 popup、释放 popup focus scope、清理 context provider 和 overlay invalidator。

## Popup 接口

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `hitTest(point, context)` | `boolean` | 判断全局点是否落在 popup 内。事件路由和外部点击关闭依赖它。 |
| `close()` | `void` | 关闭并释放 popup。必须可重复安全调用。 |
| `ownsCursor?()` | `boolean` | 当前 popup 是否拥有鼠标 cursor。用于避免 manager 自动恢复 default cursor。 |
| `onPointerDown?(event, context)` | `void` | popup 内 primary pointer down。 |
| `onPointerMove?(event, context)` | `void` | popup 内 pointer move。 |
| `onPointerUp?(event, context)` | `void` | popup 内 primary pointer up。 |
| `onPointerCancel?(event, context)` | `void` | 当前 interactive popup 的 pointer cancel。 |
| `onWheel?(event, context)` | `boolean \| void` | 命中 popup 的滚轮事件。返回 `false` 表示不消费。 |
| `onOutsidePointerDown?(event, context)` | `boolean \| void` | 外部点击关闭前调用。返回 `true` 表示消费该外部点击。 |
| `onEscape?(event)` | `boolean \| void` | Escape 处理。返回 `false` 阻止默认关闭，返回 `true` 表示已处理。 |
| `onKeyDown?(event)` | `boolean \| void` | 普通键盘事件处理。返回 `true` 表示已处理。 |

`PopupManager` 不知道 popup 如何绘制。具体 popup 通常通过内部 popup shell 或已有组件实现绘制。

## PopupContext

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `theme` | `ResolvedTheme` | 当前主题。popup 尺寸、颜色、字体由框架内部配方从这里派生。 |
| `viewport` | `PopupViewport` | 当前 popup 视口，包含 `width`、`height`、`dpr`。 |
| `setCursor` | `(cursor: string) => void` | 可选 cursor 设置函数。可调整大小的 popup 会用它切换 cursor。 |

`PopupManager.context` 每次从 `setContextProvider()` 读取最新快照，所以滚动、缩放、窗口尺寸变化后，popup 可以按最新 viewport 和主题重新布局。多根窗口环境中，provider 同时接收该 popup 保存的 `anchorRoot` 和 `anchorMode`。主窗口使用应用内容 viewport，Host Dock 使用自己的分配区域，独立/owned 浮动 `RenderWindow` 使用其窗口矩形与应用内容区的交集；因此浮动窗口内的 popup 不会越出当前可见窗口边界。

## PopupOpenOptions

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `anchorMode` | `'stable' \| 'dynamic'` | `'stable'` | `stable` 在打开时捕获根窗口；`dynamic` 每次读取实时 pointer/focus 根，Tooltip 使用此模式。 |
| `anchorRoot` | `RenderObject` | `undefined` | 显式指定稳定根。优先级高于 parent、当前 Popup 执行上下文和默认根 provider。 |
| `closeExisting` | `boolean` | `false` | 打开新 popup 前关闭已有非 persistent 的 `passive/popup` 项；`nonmodal` 保留。Modal 常用。 |
| `closeOnTransient` | `boolean` | 按 interaction mode | 是否参与 `closeTransient()` / `closeExisting`；passive/popup 默认 `true`，nonmodal 默认 `false`。 |
| `interactionMode` | `'passive' \| 'nonmodal' \| 'popup'` | `'popup'` | 分别表示不参与输入、只命中实际区域但不建立焦点域、完整 Popup 交互。 |
| `interactive` | `boolean` | `undefined` | 兼容字段；`false/true` 分别映射为 `passive/popup`。不得与 `interactionMode` 同时传入。 |
| `owner` | `object` | `undefined` | popup 所属对象。页面 dispose 时可用 `closeOwnedBy(owner)` 批量关闭。 |
| `parent` | `Popup` | `undefined` | 父 popup。子菜单、级联浮层应传 parent，形成关闭子树。 |
| `persistent` | `boolean` | `false` | 持久 overlay。`closeExisting` 不会关闭它，并且它会保持在栈顶区域。 |

## PopupManager 属性

| API | 类型 | 说明 |
| --- | --- | --- |
| `context` | `PopupContext` | 当前 popup 上下文。没有 provider 时使用安全默认值。 |
| `activeAnchorRoot` | `RenderObject \| null` | 当前 interactive popup 保存的稳定根。 |
| `current` | `Popup \| null` | 当前最上层 interactive popup。 |
| `top` | `Popup \| null` | popup 栈最顶层 popup，包含非交互 overlay。 |
| `hasOpen` | `boolean` | 是否存在 interactive popup。 |
| `hasOverlays` | `boolean` | 栈中是否存在任何 popup 或 overlay。 |
| `stack` | `readonly Popup[]` | 当前 popup 栈快照。 |

`current` 和 `top` 的区别很重要：非交互 overlay 可以在 `top`，但键盘和 pointer 事件仍路由到 `current`。

## PopupManager 方法

| API | 返回值 | 说明 |
| --- | --- | --- |
| `setPaintInvalidator(invalidator?)` | `void` | 设置 overlay 重绘回调。 |
| `setContextProvider(provider?)` | `void` | 设置按 `anchorRoot` 和 `anchorMode` 创建 `PopupContext` 的提供者。 |
| `setAnchorRootProvider(provider?)` | `void` | 设置 stable popup 打开时使用的默认根提供者。 |
| `contextFor(popup)` | `PopupContext` | 读取指定 popup 的根作用域上下文。 |
| `withContextFor(popup, action, ...)` | `T` | 在指定 popup 的根作用域中执行回调；框架和高级扩展用于 paint/事件/关闭链路。 |
| `requestPaint(fallback?)` | `void` | 请求 overlay 重绘。没有 invalidator 时执行 fallback。 |
| `open(popup, options?)` | `void` | 打开 popup。重复打开同一 popup 会把它移到栈顶并关闭其旧子树。 |
| `closeAll()` | `void` | 关闭所有 popup。 |
| `closeTransient()` | `void` | 关闭非 persistent 且 `closeOnTransient=true` 的项；旧 nonmodal 默认仍保留。 |
| `handlePointerDown(event)` | `boolean` | 路由 primary pointer down；命中 popup 时返回 true。 |
| `handlePointerMove(event)` | `boolean` | 路由 pointer move 到命中 popup 或 current popup。 |
| `handlePointerUp(event)` | `void` | 路由 pointer up 到命中 popup 或 current popup。 |
| `handlePointerCancel(event)` | `boolean` | 路由 pointer cancel 到 current popup。 |
| `handleWheel(event)` | `boolean` | 路由滚轮到命中 popup；返回是否消费。 |
| `handleKeyDown(event)` | `boolean` | 路由键盘到 current popup；Escape 走专门逻辑。 |
| `handleEscape(event)` | `boolean` | 调用 popup `onEscape` 或默认关闭 top interactive popup。 |
| `dismiss(popup)` | `void` | 移除指定 popup 及其子树。子 popup 会从叶到根关闭。 |
| `closeOwnedBy(owner)` | `boolean` | 关闭指定 owner 拥有的 popup root 子树。 |
| `closeAnchoredTo(root)` | `boolean` | 关闭锚定到指定 render root 的 popup；根窗口卸载时由 runtime 调用。 |
| `bringToFront(popup)` | `void` | 将 popup 所属 root 子树移动到栈顶。 |
| `closeTop()` | `boolean` | 关闭当前 interactive popup。 |
| `dispose()` | `void` | 关闭所有 popup、释放焦点作用域、清理 provider 和 invalidator。 |

## Popup 栈和父子关系

```ts
const rootPopup: Popup = {
  hitTest: point => point.x >= 0 && point.x <= 200 && point.y >= 0 && point.y <= 200,
  close: () => undefined,
}

const childPopup: Popup = {
  hitTest: point => point.x >= 160 && point.x <= 320 && point.y >= 40 && point.y <= 160,
  close: () => undefined,
}

PopupManager.instance.open(rootPopup)
PopupManager.instance.open(childPopup, { parent: rootPopup })
```

父子关系用于子菜单、级联选择器和弹窗内再弹出的局部浮层：

- `closeTop()` 只关闭当前 interactive popup。
- `dismiss(rootPopup)` 会关闭 root 及其所有 descendants。
- 外部点击嵌套子树时，会关闭当前 active root branch。
- 点击父 popup 时，会先关闭命中点上方的子 popup，再把事件路由给父 popup。
- 未显式传 `parent`、但在某个 Popup 回调中同步打开的新 Popup，会继承正在执行的 stable 根，避免串联弹框迁移到其他顶层窗口。

## 多根窗口锚定

普通 Popup 和 Notification 等 passive overlay 默认使用 `anchorMode: 'stable'`。根选择优先级如下：

1. 显式 `anchorRoot`。
2. `parent` 保存的根。
3. 当前正在执行的 Popup 回调根。
4. `setAnchorRootProvider()` 返回的根。

Tooltip 需要跟随鼠标跨顶层窗口移动，因此显式使用 `anchorMode: 'dynamic'`。`interactive` 只决定事件和焦点路由，不再隐式决定是否捕获根。

Runtime 移除顶层 render root 时会调用 `closeAnchoredTo(root)`。关闭回调按叶到根执行；单个自定义 `close()` 抛错会记录到控制台，但不会阻止其他 Popup、焦点作用域和根窗口继续清理。

## Owner 和页面销毁

```ts
const owner = {}
const popup: Popup = {
  hitTest: () => true,
  close: () => undefined,
}

PopupManager.instance.open(popup, { owner })
PopupManager.instance.closeOwnedBy(owner)
```

页面、tab、窗口或编辑器持有 popup 时，应使用 owner 关联。页面关闭或组件 dispose 时调用 `closeOwnedBy(owner)`，避免 popup 持有旧页面对象和大数据。

## 外部点击关闭

外部点击处理流程：

1. 查找 topmost hit popup。
2. 如果命中某个 popup，关闭它上方的 interactive popup，再把事件发给命中 popup。
3. 如果没有命中，取 current popup 所在 root branch。
4. 对 branch 的 active leaf 调用 `onOutsidePointerDown(event, context)`。
5. 如果返回 `true`，表示外部点击已被消费。
6. 如果返回 `false` 或 `undefined`，默认关闭该 popup。
7. 再关闭 branch 中其他 popup。

适合在 `onOutsidePointerDown` 中处理“点击触发器时切换关闭”等特殊规则。

## 键盘和焦点

- 第一个 interactive popup 打开时，`PopupManager` 会 push 一个 Popup focus scope，并清空当前焦点。
- 最后一个 interactive popup 关闭后，恢复之前焦点。
- `handleKeyDown()` 只发给 `current`。
- `Escape` 会优先调用 `onEscape()`；返回 `false` 时阻止默认关闭；返回 `true` 时表示已处理；未返回时默认 `closeTop()`。
- 非交互 overlay 不会成为 `current`，因此不接收键盘。

## 滚轮和滚动穿透

`handleWheel()` 只路由到命中的 popup：

- popup 没有 `onWheel`，返回 `false`。
- `onWheel()` 返回 `false`，表示不消费，外层滚动容器可以继续处理。
- 返回 `true` 或 `undefined`，表示消费滚轮。

下拉列表、树、表格类 popup 应在内部滚动时消费滚轮；如果已经滚到顶部或底部且希望阻止外层滚动，也应保持消费。

## Cursor 所有权

可调整大小的 popup 或特殊拖拽 popup 可以临时设置 cursor。`PopupManager.handlePointerMove()` 在 popup 不拥有 cursor 时会把 cursor 恢复为 `default`。

内部 popup shell 通过 `ownsCursor()`、`setPopupCursor()` 和 `resetPopupCursor()` 管理这一点。外部业务通常不需要直接实现。

## 锚点协议

锚点 popup 使用 `GET_POPUP_ANCHOR_RECT` 暴露当前锚点矩形：

```ts
class FieldAnchor implements PopupAnchorTarget {
  [GET_POPUP_ANCHOR_RECT]() {
    return { x: 20, y: 40, width: 160, height: 28 }
  }
}

const anchor = new FieldAnchor()
const rect = resolvePopupAnchorRect(anchor)
rect.w
```

也可以携带 data：

```ts
class CellAnchor implements PopupAnchorTarget<number> {
  [GET_POPUP_ANCHOR_RECT](rowIndex = 0) {
    return { x: 20, y: 40 + rowIndex * 28, width: 160, height: 28 }
  }
}

const placement: PopupAnchorPlacement<number> = {
  target: new CellAnchor(),
  data: 3,
}

const rect = resolvePopupAnchorRect(placement)
rect.y
```

返回值会规范化为 `{ x, y, w, h }`。`resolvePopupAnchorTarget(anchor)` 可拿到原始 target。

## 公共 Anchored 定位

`resolveAnchoredPopupRect()` 是不持有状态的公共定位函数，供 Tooltip、Popover 和其他矩形锚点浮层复用：

```ts
const result = resolveAnchoredPopupRect({
  anchorRect: { x: 120, y: 80, width: 1, height: 20 },
  popupSize: { width: 240, height: 96 },
  viewportRect: { x: 0, y: 0, width: 800, height: 600 },
  preferredPlacement: 'bottom-start',
  fallbackPlacements: ['top-start'],
  overflowPreference: 'largest-space',
  gap: 6,
  inset: 4,
})
```

公共函数支持 top/bottom/left/right 四个侧面及 start/end 对齐。`fallbackPlacements` 按顺序表示备选位置；未传时自动使用首选位置的对侧，保持原有 top/bottom flip 行为。函数允许 point-like 和离屏 anchor，并把结果 clamp 到有效边界。需要“anchor 必须可见”的组件应在调用前自行检查。`preferred` 在所有候选侧都放不下时保留首选侧；`largest-space` 按候选顺序选择主轴可用空间最大的一侧，空间相等时保留较早候选。

## OverlayInvalidator

`OverlayInvalidator` 是 popup 重绘失效器。运行时通常把它接到 host 的 frame 调度上。

| API | 说明 |
| --- | --- |
| `OverlayInvalidator.instance.setPaintInvalidator(invalidator?)` | 设置 overlay 重绘回调。 |
| `OverlayInvalidator.instance.requestPaint(fallback?)` | 请求重绘。没有 invalidator 时走 fallback。 |
| `OverlayInvalidator.instance.suppressPaint(operation)` | 在批量关闭或 dispose 期间抑制重绘请求。 |
| `OverlayInvalidator.disposeInstance()` | 重置单例。 |

业务组件通常调用 `PopupManager.instance.requestPaint()`，不直接操作 `OverlayInvalidator`。

## 公共使用边界

业务项目应使用本页列出的公共 popup API，或优先选择下方对应的具体浮层组件。未从 `directsurface` 包入口导出的 shell、surface 和 host 类型不属于兼容性承诺，不应通过包内路径引用或继承。

## 与具体浮层组件的关系

| 组件 | 与 Popup 的关系 |
| --- | --- |
| `ContextMenuManager` | 使用 popup 栈管理根菜单和子菜单。 |
| `RenderComboBox` / `DropdownPopup` | 使用锚点 popup 显示候选项。 |
| `RenderDatePicker` / `DatePickerPopup` | 使用锚点 popup 显示日期面板。 |
| `RenderColorPicker` / `ColorPickerPopup` | 使用锚点 popup 显示颜色面板。 |
| `RenderPopover` / `PopoverPopup` | 提供通用锚点浮层。 |
| `RenderModal` | 使用 `closeExisting` 和 modal 层语义。 |
| `RenderDrawer` | 使用 overlay 语义显示抽屉。 |
| `NotificationManager` | 通常打开非交互 overlay。 |
| `TooltipManager` / `TooltipService` / `TooltipTarget` | 使用非阻塞 tooltip overlay。 |

Tooltip 相关类型的边界：

| API | 说明 |
| --- | --- |
| `TooltipContent` | `string` 或返回 `RenderBox` 的工厂函数。字符串可用换行符显示多行短文本；复杂排版或可视化内容使用 `RenderBox` 工厂。 |
| `TooltipPresenter` | 暴露 `show(content, pos, delay?)`、`hide()` 和 `updatePos(pos)` 的协议。 |
| `TooltipManager.show(content, pos, delay?)` | 在 tooltip 层延迟显示内容。 |
| `TooltipService.installCurrent(service)` | 安装当前 tooltip presenter，并返回传入的 service；卸载时调用 `TooltipService.clearCurrent(service)`。 |
| `TooltipTarget` | 保存 tooltip 内容，组件可在 hover 时调用其展示逻辑。 |

普通组件或文档元信息上的 `tooltip` 字段通常是 `string`，适合短提示或 `\n` 分隔的多行短文本。复杂排版、图标、字段和值的组合说明，应使用 rich tooltip，也就是传入 `() => RenderBox` 的 `TooltipContent`。注意不是所有组件字段都接受 rich tooltip；如果某个 API 标注为 `tooltip?: string`，只能传字符串。

## 性能和内存

- 不要为每个表格行、树节点常驻 popup 实例。
- 打开时按当前上下文生成 popup 内容，关闭时释放引用。
- 大候选列表要限制高度或虚拟化。
- popup 位置应基于锚点 rect 和 viewport 重新计算，不应触发整页重新布局。
- 页面、tab 或窗口销毁时关闭 owner 关联的 popup。
- 输入型 popup 要释放输入会话、composition 状态和临时订阅。

## 常见问题

### Popup 为什么没有跟随滚动？

通常是锚点 rect 缓存了旧位置。锚点应实现 `GET_POPUP_ANCHOR_RECT`，每次布局/绘制时返回当前全局 rect，而不是打开时保存一次。

### 为什么外部点击没有关闭？

检查 `hitTest()` 是否过大，或 `onOutsidePointerDown()` 是否返回了 `true`。返回 `true` 表示消费外部点击，不走默认关闭。

### 为什么焦点丢失后没有恢复？

检查是否绕过 `PopupManager.open()` 手动显示浮层，或关闭时没有从 manager 栈里移除。通过 manager 打开的最后一个 interactive popup 关闭后，会恢复之前焦点。

### 为什么滚轮穿透到了外层容器？

popup 的 `onWheel()` 返回了 `false` 或没有实现。需要阻止外层滚动时，popup 应消费滚轮。

### 可以从包内路径导入未公开的 popup 类型吗？

不可以。业务项目只应组合 `directsurface` 包入口导出的公共 popup API；如果公共能力不足，应提出稳定的扩展需求，而不是 deep import 包内实现。

## 相关文档

- [Popup 和 Overlay 概念](../../lifecycle.md)
- [ContextMenu](./context-menu.md)
- [Popover](./popover.md)
- [ComboBox](../selector/combo-box.md)
- [DatePicker](../input/date-picker.md)
- [ColorPicker](../input/color-picker.md)
- [Modal](./modal.md)
- [Drawer](./drawer.md)
- [生命周期和销毁](../../lifecycle.md)
