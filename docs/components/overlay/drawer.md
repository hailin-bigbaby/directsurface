# Drawer 抽屉

> **与统一布局属性的关系**：`RenderDrawer` 是独立 popup shell，不是普通 `RenderBox` 子节点；抽屉宽度和位置使用 Drawer options。它承载的 `child: RenderBox` 仍支持统一尺寸、margin 和槽位对齐。详见[组件通用布局属性](../common-layout-properties.md)。


`RenderDrawer` 是从 viewport 左侧或右侧打开的 overlay 面板，适合承载详情、属性、过滤条件、审计信息和轻量编辑区。它基于 [Popup](./popup.md) surface 绘制，打开后显示遮罩，面板内容由一个 `RenderBox` 子树提供。

Drawer 比 [Popover](./popover.md) 更重，可以承载复杂控件；比 [Modal](./modal.md) 更适合保留当前页面上下文。但它仍是临时浮层，不适合作为长期驻留的主工作区。

## API 总览

```ts
import {
  RenderButton,
  RenderDrawer,
  RenderStackPanel,
  RenderText,
  type DrawerSide,
} from 'directsurface'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderDrawer` | class | 左侧或右侧 overlay 面板。承载一个 `RenderBox` 内容根节点。 |
| `DrawerSide` | type | 抽屉方向，当前只支持 `left` 和 `right`。 |

最小装配顺序是：创建内容 `RenderBox` 子树，作为 `child` 传给 `RenderDrawer`，调用 `show()` 打开。直接使用时由持有者负责在页面释放时调用 `dispose()`。

## 何时使用

使用 Drawer：

- 右侧详情、属性检查器、筛选条件和审计记录。
- 用户需要对当前页面中的对象做补充查看或轻量编辑。
- 内容需要组件组合，而不是 Modal 的短文本确认。
- 打开后应阻断底层页面滚动和点击。

不要使用：

- 必须确认/取消的短流程，使用 [Modal](./modal.md)。
- 紧贴触发元素的小浮层，使用 [Popover](./popover.md)。
- 菜单、右键菜单和多级操作列表，使用 [ContextMenu](./context-menu.md)。
- 长期停靠的工具窗口，使用 [DockWorkspace](../navigation/dock-workspace.md) 或 `RenderWindow`。
- 顶部/底部抽屉；当前 `DrawerSide` 只支持 `left` 和 `right`。

## 最小示例

```ts
const drawerContent = new RenderStackPanel({
  orientation: 'vertical',
  spacing: 8,
})
drawerContent.addChild(new RenderText('条目详情'))
drawerContent.addChild(new RenderButton({
  label: '刷新',
  onClick: () => reload(),
}))

const drawer = new RenderDrawer({
  title: '条目详情',
  side: 'right',
  width: 420,
  child: drawerContent,
})

drawer.show()
```

`child` 是普通 `RenderBox`，可以组合文本、按钮、表格、树、表单、滚动容器等已有组件。

## DrawerSide

```ts
type DrawerSide = 'left' | 'right'
```

| 值 | 说明 |
| --- | --- |
| `left` | 面板贴左侧打开。 |
| `right` | 面板贴右侧打开。默认值。 |

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `title` | `string` | 必填 | 标题栏文本。 |
| `child` | `RenderBox` | `undefined` | 内容区根组件。 |
| `side` | `DrawerSide` | `'right'` | 打开方向。 |
| `width` | `number` | `320` | 期望宽度。实际宽度会被 viewport 限制。 |
| `overlayClosable` | `boolean` | `true` | 点击遮罩是否关闭。为 `false` 时遮罩点击只消费事件。 |
| `onOpenChange` | `(open: boolean) => void` | `undefined` | 打开/关闭状态变化回调。 |

实际面板宽度计算规则：

```text
const panelWidth = Math.min(drawerWidth, Math.max(200, viewportWidth - 32))
```

也就是说，Drawer 至少按 200px 目标宽度计算；当 viewport 很窄时，会保留约 32px 的遮罩边距。

## 属性和方法

| API | 类型 | 说明 |
| --- | --- | --- |
| `title` | `string` | 标题文本。 |
| `child` | `RenderBox \| undefined` | 内容区根组件。 |
| `side` | `DrawerSide` | 当前打开方向。 |
| `drawerWidth` | `number` | 当前期望宽度。 |
| `overlayClosable` | `boolean` | 遮罩点击是否关闭。 |
| `onOpenChange` | `(open: boolean) => void` | 状态变化回调。 |
| `visible` | `boolean` | 来自 popup shell，表示当前是否打开。 |
| `setChild(child?)` | `void` | 替换内容区根组件。旧 child 只解除 parent，不自动 dispose。 |
| `show()` | `void` | 打开 Drawer。重复打开无效。 |
| `hide()` | `void` | 关闭 Drawer。 |
| `close()` | `void` | Popup 协议关闭入口。 |
| `debugState(popupContext?)` | `{ open, viewportRect, panelRect, contentRect, closeRect }` | 返回当前布局调试信息。 |
| `onEscape(event)` | `boolean` | 关闭 Drawer 并消费 Escape。 |
| `onKeyDown(event)` | `boolean` | 处理 Tab 和 Escape。 |
| `onOutsidePointerDown(event)` | `boolean` | 根据 `overlayClosable` 关闭或仅消费。 |
| `onWheel(event, context?)` | `boolean` | 先把 wheel 转发给内容树，再消费事件阻止底层滚动。 |
| `dispose()` | `void` | 关闭 Drawer、释放动画、dispose 当前 child 和 popup surface。 |

修改 `title`、`side`、`drawerWidth`、`overlayClosable` 后，应由调用方请求 popup 重绘或重新打开。短生命周期 Drawer 通常在创建时一次性传入这些配置。

## 动态替换内容

`setChild()` 适合选中对象变化后刷新抽屉内容：

```ts
const drawer = new RenderDrawer({
  title: '已选择项目',
  width: 420,
})

function refreshSelectionPanel() {
  const content = new RenderStackPanel({ orientation: 'vertical', spacing: 6 })
  content.addChild(new RenderText(`当前选择：${currentName}`))
  content.addChild(new RenderButton({
    label: '复制',
    onClick: () => copySelection(),
  }))
  drawer.setChild(content)
}

refreshSelectionPanel()
drawer.show()
```

注意：`setChild()` 不会 dispose 旧 child。如果旧内容持有订阅、定时器或大对象，应由业务在替换前自行释放。

## 鼠标、键盘和关闭行为

| 操作 | 行为 |
| --- | --- |
| 点击内容区 | 事件路由到 `child` 子树。 |
| 点击标题栏关闭图标 | 按下和抬起都在关闭图标内时关闭。 |
| 点击遮罩 | `overlayClosable === true` 时关闭；否则只消费事件。 |
| `Escape` | 关闭并消费事件。 |
| `Tab` | 被消费，用于阻断焦点离开当前 overlay；当前实现不做内部焦点巡航。 |
| 滚轮 | 先路由给内容树；无论内容是否消费，Drawer 都返回 `true` 阻断底层滚动。 |

`show()` 使用 `openPopup({ closeExisting: false })`，不会主动关闭已有 popup。多个 overlay 同时存在时，由 `PopupManager` 按栈顺序处理命中和键盘事件。

## 内容布局

Drawer 会把内容区布局在标题栏下方：

```text
contentRect = {
  x: panelRect.x + padding,
  y: panelRect.y + titleHeight + padding,
  width: panelRect.width - padding * 2,
  height: panelRect.height - titleHeight - padding * 2,
}
```

`child.layout()` 接收的最大宽高就是 `contentRect` 的宽高。内容超出时，应该显式放入 [ScrollView](../../layouts.md) 或其他滚动容器；Drawer 本身不为内容自动创建滚动条。

## 绘制和主题

Drawer 绘制顺序：

1. 全屏遮罩。
2. 面板阴影。
3. 面板背景和边框。
4. 标题栏背景、分隔线和标题文本。
5. 关闭图标 hover/pressed 背景。
6. 内容区 child。

样式 token 来自 `deriveDrawerStyle(context.theme)`：

| Token | 说明 |
| --- | --- |
| `overlayBg` | 遮罩颜色。 |
| `panelBg`、`panelBorder` | 面板背景和边框。 |
| `titleBg`、`titleText`、`separator` | 标题栏和分隔线。 |
| `closeText` | 关闭图标默认颜色。 |
| `padding`、`titleHeight`、`closeButtonSize` | 布局尺寸。 |
| `shadowColor`、`shadowBlur`、`shadowOffsetX/Y` | 面板阴影。 |

当前实现打开时直接显示到最终位置，没有关闭动画。代码中保留了动画控制器和位置计算扩展点，后续可在不改变 API 的情况下补滑入/滑出动画。

## 生命周期

直接使用 Drawer 时，推荐由持有它的页面在 `dispose()` 中释放：

```ts
class DetailPage extends RenderStackPanel {
  private readonly drawer = new RenderDrawer({
    title: '详情',
    child: new RenderText('内容'),
  })

  override dispose(): void {
    this.drawer.dispose()
    super.dispose()
  }
}
```

`dispose()` 会：

- `close()` 当前 popup。
- dispose 内部动画控制器。
- dispose 当前 `child`。
- dispose popup surface。

如果业务希望缓存 child，不要直接把缓存 child 交给 Drawer 持有后再让 Drawer dispose；应在关闭前 `setChild(undefined)`，或由业务重新创建 Drawer。

## 性能边界

- Drawer 只布局和绘制当前 `child` 子树，不会扫描主界面树。
- pointer 事件通过 popup surface 命中内容区，复杂内容的性能由该内容自身决定。
- 大列表、大树、审计轨迹等内容应使用已有虚拟化或滚动组件，不要把所有节点直接堆进普通 StackPanel。
- 频繁刷新内容时，优先更新子组件数据；只有内容结构整体变化时才调用 `setChild()`。
- 关闭后若不再使用，应调用 `dispose()`，避免保留内容树和业务订阅。

## 常见问题

### 为什么 Drawer 只能左右打开？

当前 `DrawerSide` 只定义了 `left` 和 `right`。顶部/底部抽屉需要新增布局规则、关闭图标位置和尺寸约束，不属于现有 API。

### 为什么点击遮罩有时不关闭？

检查 `overlayClosable`。当它为 `false` 时，遮罩点击只消费事件，不关闭 Drawer，适合必须通过面板内按钮或 Escape 关闭的场景。

### 为什么内容没有滚动条？

Drawer 只提供内容区域约束，不自动包一层滚动容器。需要滚动时，把内容放进 ScrollView、Grid、Tree 或其他自带滚动能力的组件。

### setChild 后旧内容会释放吗？

不会。`setChild()` 只解除旧 child 的 parent。这样可以支持业务缓存内容树，但也要求业务在不再使用旧 child 时主动 dispose。

### Drawer 和 Modal 如何选择？

需要用户明确确认/取消且内容短，使用 [Modal](./modal.md)。需要展示详情、属性、筛选和轻量编辑，使用 Drawer。需要长期驻留和多窗口布局，使用 [DockWorkspace](../navigation/dock-workspace.md)。

## 相关文档

- [Popup 浮层系统](./popup.md)
- [Modal 模态框](./modal.md)
- [Popover 浮窗](./popover.md)
- [ContextMenu 右键菜单](./context-menu.md)
- [DockWorkspace 停靠工作区](../navigation/dock-workspace.md)
