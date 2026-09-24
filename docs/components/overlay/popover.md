# Popover 浮窗

> **通用布局能力**：`RenderPopover` 触发组件继承 `RenderBox` 的尺寸、min/max、`margin` 和槽位对齐属性；popover content 也是 `RenderBox`，但浮层外壳的位置和边界由 popup 协议决定。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderPopover` 是一个“按钮触发器 + 锚点浮层”的组合控件，适合在某个控件附近展示轻量说明、快捷操作或小型表单。`PopoverPopup` 是对应的独立 popup 实现，可在已有自定义触发器或复杂组件内部复用。

Popover 基于 [Popup](./popup.md) 机制：内容脱离主布局流显示，位置由锚点矩形、placement、viewport 和 popup 主题共同决定。

Popover 由 click/keyboard 主动打开并使用 popup focus scope；[HoverCard](./hover-card.md) 由 pointer hover 打开，使用 nonmodal 路由和 auxiliary focus root。语义说明、文档链接和可复制代码优先使用 HoverCard。


## API 总览

```ts
import {
  GET_POPUP_ANCHOR_RECT,
  PopoverPopup,
  RenderButton,
  RenderPopover,
  RenderStackPanel,
  RenderText,
  type PopoverPlacement,
  type PopupAnchorTarget,
} from 'directsurface'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderPopover` | class | 自带按钮触发器的锚点浮层控件。适合直接放进页面布局。 |
| `PopoverPopup` | class | 独立 popup。适合已有自定义触发器或复杂组件复用 popup 外壳。 |
| `PopoverPlacement` | type | 首选显示位置：`bottom-start`、`bottom-end`、`top-start`、`top-end`。 |
| `PopupAnchorTarget` | interface | 独立 popup 的锚点协议。 |
| `GET_POPUP_ANCHOR_RECT` | symbol | 锚点对象实现该 symbol 方法，返回当前全局 rect。 |

最小装配顺序有两种：普通页面使用 `RenderPopover` 并传入 `content`；自定义触发器实现 `PopupAnchorTarget`，再创建 `PopoverPopup` 并调用 `open()`。

## 何时使用

使用 Popover：

- 内容比 tooltip 复杂，需要按钮、徽标、小表单或多行说明。
- 内容应贴近触发元素显示。
- 用户可以点击外部、按 Escape 或再次点击触发器关闭。
- 不需要阻断整个页面操作。

不要使用：

- 只显示一句短提示，使用 Tooltip。
- 需要用户必须确认/取消，使用 [Modal](./modal.md)。
- 需要右侧/左侧完整属性面板，使用 [Drawer](./drawer.md)。
- 需要菜单层级和快捷键提示，使用 [ContextMenu](./context-menu.md)。
- 需要长期浮动窗口，使用 [DockWorkspace](../navigation/dock-workspace.md) 或 `RenderWindow`。

## 最小示例

```ts
const content = new RenderStackPanel({ orientation: 'vertical', spacing: 8 })
content.addChild(new RenderText('当前条目本次预约信息'))
content.addChild(new RenderButton({ label: '刷新' }))

const popover = new RenderPopover({
  label: '预约信息',
  content,
  placement: 'bottom-start',
  popoverWidth: 260,
})
```

`RenderPopover` 自身绘制为按钮样式，右侧带 chevron。点击按钮会打开或关闭 popup。

## 构造参数

Popover 有两组构造参数：

| 构造方式 | 参数对象 | 使用场景 |
| --- | --- | --- |
| `new RenderPopover(options)` | `label`、`content`、`placement?`、`fallbackPlacements?`、`popoverWidth?`、`disabled?`、`onOpenChange?` | 直接使用内置按钮触发器。 |
| `new PopoverPopup(options)` | `anchor`、`content`、`placement?`、`fallbackPlacements?`、`width?`、`closeOnTab?`、`onClose?` | 已有自定义触发器或组件内部需要复用 popup 外壳。 |

下面分别列出两组 options。普通页面优先使用 `RenderPopover`；只有需要自定义锚点和触发器时才直接使用 `PopoverPopup`。

## 独立 PopoverPopup 示例

```ts
class PopoverAnchor implements PopupAnchorTarget {
  [GET_POPUP_ANCHOR_RECT]() {
    return { x: 40, y: 80, width: 120, height: 28 }
  }
}

const popup = new PopoverPopup({
  anchor: new PopoverAnchor(),
  content: new RenderText('独立 Popover 内容'),
  placement: 'bottom-end',
  width: 240,
  onClose: () => {
    // 同步触发器状态
  },
})

popup.open()
```

独立 popup 适合已有触发器不想使用 `RenderPopover` 按钮外观时使用。`anchor` 必须实现 `GET_POPUP_ANCHOR_RECT`。

## PopoverPlacement

```ts
type PopoverPlacement =
  | 'bottom-start'
  | 'bottom-end'
  | 'top-start'
  | 'top-end'
  | 'right-start'
  | 'right-end'
  | 'left-start'
  | 'left-end'
```

| 值 | 说明 |
| --- | --- |
| `bottom-start` | 优先显示在锚点下方，左边缘对齐锚点左边缘。默认值。 |
| `bottom-end` | 优先显示在锚点下方，右边缘对齐锚点右边缘。 |
| `top-start` | 优先显示在锚点上方，左边缘对齐锚点左边缘。 |
| `top-end` | 优先显示在锚点上方，右边缘对齐锚点右边缘。 |
| `right-start` / `right-end` | 显示在锚点右侧，按顶部/底部对齐。 |
| `left-start` / `left-end` | 显示在锚点左侧，按顶部/底部对齐。 |

如果首选方向空间不足，会按 `fallbackPlacements` 尝试；未传时自动翻转到对侧。最终位置会夹在 viewport 内，并保留 8px inset。`RenderPopover.setFallbackPlacements()` 和 `PopoverPopup.setFallbackPlacements()` 可在运行时更新回退顺序。

## RenderPopover 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `label` | `string` | 必填 | 触发按钮文本。 |
| `content` | `RenderBox` | 必填 | popup 内容。 |
| `placement` | `PopoverPlacement` | `'bottom-start'` | popup 首选位置。 |
| `fallbackPlacements` | `readonly PopoverPlacement[]` | 对侧 placement | popup 备选位置顺序。 |
| `popoverWidth` | `number` | `undefined` | popup 固定/期望宽度。未传时按内容测量，最小约 180。 |
| `disabled` | `boolean` | `false` | 禁用触发器。禁用时关闭 popup。 |
| `onOpenChange` | `(open: boolean) => void` | `undefined` | 打开和关闭状态变化回调。 |

## RenderPopover 属性和方法

| API | 类型 | 说明 |
| --- | --- | --- |
| `label` | `string` | 触发按钮文本。运行时修改后应触发布局或重绘。 |
| `content` | `RenderBox` | 当前 popup 内容。 |
| `placement` | `PopoverPlacement` | 当前 placement。 |
| `fallbackPlacements` | `readonly PopoverPlacement[] \| undefined` | 当前备选位置顺序。 |
| `popoverWidth` | `number \| undefined` | 当前宽度覆盖。 |
| `onOpenChange` | `(open: boolean) => void` | 状态变化回调。 |
| `open` | `boolean` | 当前 popup 是否打开。 |
| `disabled` | `boolean` | 禁用状态。设为 `true` 会关闭 popup。 |
| `setContent(content)` | `void` | 替换 popup 内容。旧 content 只解除 parent，不自动 dispose。 |
| `setPlacement(placement)` | `void` | 更新 placement，并请求 popup 重绘。 |
| `setFallbackPlacements(placements?)` | `void` | 更新备选位置顺序，并请求 popup 重绘。 |
| `setPopoverWidth(width?)` | `void` | 更新 popup 宽度，并请求 popup 重绘。 |
| `openPopover()` | `void` | 打开 popup。禁用或已打开时无效。 |
| `closePopover()` | `void` | 关闭 popup。 |
| `togglePopover()` | `void` | 打开/关闭切换。 |
| `debugState()` | `{ open, panelRect }` | 返回 popup 打开状态和当前面板 rect。 |
| `dispose()` | `void` | 关闭 popup、释放 popup surface、dispose 当前 content。 |

`openPopover()` 会在 popup 打开后恢复打开前的焦点，避免普通点击 popover 触发器时破坏页面已有焦点状态。

## PopoverPopup 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `anchor` | `PopupAnchorTarget` | 必填 | 定位锚点。必须实现 `GET_POPUP_ANCHOR_RECT`。 |
| `content` | `RenderBox` | 必填 | popup 内容。 |
| `placement` | `PopoverPlacement` | `'bottom-start'` | popup 首选位置。 |
| `fallbackPlacements` | `readonly PopoverPlacement[]` | 对侧 placement | popup 备选位置顺序。 |
| `width` | `number` | `undefined` | popup 宽度覆盖。 |
| `closeOnTab` | `boolean` | `true` | popup 自身收到 Tab 时是否关闭。多字段表单可设为 `false`，把焦点移动继续交给 FocusManager。 |
| `onClose` | `() => void` | `undefined` | popup 关闭后回调。 |

## PopoverPopup 方法

| API | 返回值 | 说明 |
| --- | --- | --- |
| `setContent(content)` | `void` | 替换内容并请求重绘。旧内容解除 parent，不自动 dispose。 |
| `setPlacement(placement)` | `void` | 替换 placement 并请求重绘。 |
| `setFallbackPlacements(placements?)` | `void` | 替换备选位置顺序并请求重绘。 |
| `setWidth(width?)` | `void` | 替换宽度覆盖并请求重绘。 |
| `debugState(popupContext?)` | `{ panelRect, open }` | 读取当前布局结果和打开状态。 |
| `open()` | `void` | 打开 popup。重复打开无效。 |
| `close()` | `void` | 关闭 popup。来自 popup shell。 |
| `disposePopup()` | `void` | 关闭 popup、解除 content parent、释放 popup surface。 |

`PopoverPopup.open()` 会把 popup owner 设置为锚点 target。锚点对象销毁时，可通过 `PopupManager.instance.closeOwnedBy(anchor)` 关闭相关 popup。

## 触发器交互

| 操作 | 行为 |
| --- | --- |
| 鼠标按下触发器 | 请求焦点，进入 pressed。 |
| 鼠标在触发器内抬起 | 切换 popup 打开/关闭。 |
| 鼠标取消或离开 | 清理 pressed/hover 状态。 |
| `Enter` | 切换 popup。 |
| `Space` | 切换 popup。 |
| `ArrowDown` | 切换 popup。 |
| `Escape` | popup 已打开时关闭并消费事件。 |
| `Tab` | 由焦点系统处理。独立 `PopoverPopup` 默认关闭但不消费焦点移动；`closeOnTab: false` 时保持打开。 |

`RenderPopover` 禁用时不响应鼠标和键盘；禁用状态变为 `true` 会立即关闭 popup。

## 关闭条件

Popover 会在以下场景关闭：

- 再次点击触发器。
- 点击 popup 外部。
- 点击锚点区域。`PopoverPopup.onOutsidePointerDown()` 命中锚点时关闭并返回 `true`，避免同一次点击继续穿透。
- 按 Escape。
- popup 收到 Tab 且 `closeOnTab` 为 `true` 时关闭，但返回 `false` 让焦点继续移动。
- `disabled` 变为 `true`。
- `RenderPopover.dispose()` 或 `PopoverPopup.disposePopup()`。

## 定位规则

`PopoverPopup` 每次布局都会读取锚点当前 rect：

```ts
class LayoutAnchor implements PopupAnchorTarget {
  [GET_POPUP_ANCHOR_RECT]() {
    return { x: 40, y: 80, width: 120, height: 28 }
  }
}

const anchor = new LayoutAnchor()
const rect = resolvePopupAnchorRect(anchor)
```

布局规则：

- viewport inset 固定为 8px。
- popup 与锚点间距为 4px。
- 最大宽度为 `viewport.width - 16`，且不小于 120。
- 最大高度为 `viewport.height - 16`，且不小于 40。
- 未指定宽度时，按内容测量宽度，最低约 180。
- 指定 `popoverWidth`/`width` 时，仍会受 viewport 最大宽度约束。
- 首选 top/bottom 空间不足时会尝试翻转。
- x/y 最终会夹在 viewport 内。

因此滚动或窗口大小变化后，只要锚点返回最新全局 rect，popover 会在下一次 popup 布局/绘制时跟随位置。

## 内容布局和绘制

- popup 外壳使用 `derivePopupStyle()` 的 padding、背景、边框和阴影。
- content 最大宽度为 panel width 减去左右 padding。
- content 最大高度为 panel height 减去上下 padding。
- content offset 固定为 popup padding。
- 触发按钮使用 `deriveButtonStyle()`，打开时进入 selected 视觉态。
- 触发按钮右侧绘制 `chevron-down` 或 `chevron-up`。

Popover 不提供内部滚动容器。内容如果可能超过可视高度，应自行组合 [ScrollView](../../layouts.md) 或使用更合适的 Drawer/Modal。

## 滚轮行为

`PopoverPopup` 使用 popup surface 路由滚轮。如果内容实现了 `onWheel()`：

- 返回 `false` 时，`PopupManager.handleWheel()` 返回 `false`，外层滚动可以继续。
- 返回 `true` 或 `undefined` 时，滚轮被 popup 消费。

因此，带内部滚动的 popover 内容应明确消费滚轮，避免滚动穿透。

## 动态内容

```ts
const popover = new RenderPopover({
  label: '详情',
  content: new RenderText('旧内容'),
})

popover.setContent(new RenderText('新内容'))
popover.setPlacement('top-end')
popover.setPopoverWidth(320)
```

`setContent()` 只切换 parent 和 popup 内容，不 dispose 旧内容。如果旧内容不再使用，应由调用方负责释放。`RenderPopover.dispose()` 只 dispose 当前 `content`。

## 与其他浮层的区别

| 组件 | 用途 |
| --- | --- |
| Tooltip | 短文本提示，不承载复杂交互。 |
| `RenderPopover` | 轻量可交互锚点浮层，自带按钮触发器。 |
| `PopoverPopup` | 独立 popup，给自定义触发器复用。 |
| `ContextMenuManager` | 命令菜单、子菜单、快捷键提示。 |
| `RenderModal` | 阻断式确认或编辑。 |
| `RenderDrawer` | 较大的侧边面板。 |

## 性能和生命周期

- 不要为列表每一行常驻一个 popover content。
- 大内容应打开时创建，关闭或页面销毁时释放。
- 页面 dispose 时，如果使用独立 `PopoverPopup`，应调用 `disposePopup()`。
- 如果通过锚点 owner 打开 popup，锚点销毁时应关闭 owner 关联 popup。
- 替换 content 时注意旧 content 的 dispose 所有权。
- popover 不适合承载大表格、大树或长期编辑器。

## 常见问题

### 为什么 popover 没有跟随滚动？

检查锚点 `GET_POPUP_ANCHOR_RECT` 是否每次返回当前全局 rect。不要缓存打开时的位置。

### 为什么点击触发器会关闭而不是重新打开？

这是当前设计：点击锚点区域属于外部点击特殊分支，会关闭 popup 并消费本次点击，避免关闭后同一次点击又重新打开。

### 为什么 Tab 会关闭 popup？

Tab 是焦点移动。Popover 默认收到 Tab 时关闭并返回 `false`，让焦点系统继续移动到下一个可聚焦控件。直接使用 `PopoverPopup` 承载多字段表单时可传入 `closeOnTab: false`，Popup 会保持打开，焦点移动仍由 FocusManager 处理。

### 可以在 Popover 内放复杂页面吗？

不建议。Popover 定位和尺寸面向轻量内容。复杂页面、属性面板或长期编辑请使用 Drawer、Modal 或 DockWorkspace。

## 相关文档

- [Popup](./popup.md)
- [Tooltip](./tooltip.md)
- [ContextMenu](./context-menu.md)
- [Modal](./modal.md)
- [Drawer](./drawer.md)
- [Button](../basic/button.md)
- [ScrollView](../../layouts.md)
