# Tooltip 提示层

Tooltip 用于展示不参与焦点和 pointer 命中的轻量信息。它基于 `PopupManager` 的 passive entry，统一绘制在 tooltip compositor layer，并复用主题的 popup 背景、边框、圆角、阴影和淡入动画。

包含真实链接、代码复制、文本选区或内部滚动的内容应使用 [HoverCard](./hover-card.md)，不要改变 Tooltip 的 pointer 穿透合同。CodeEditor 的 Signature Help 仍使用 passive Tooltip；Semantic Hover 使用 HoverCard。


## API 总览

```ts
import {
  GET_POPUP_ANCHOR_RECT,
  TooltipManager,
  TooltipService,
  TooltipTarget,
  type AnchoredTooltipOptions,
  type PopupAnchorTarget,
  type TooltipContent,
} from 'directsurface'
```

| API | 用途 |
| --- | --- |
| `RenderBox.tooltip` / `tooltipDelay` | 声明式 pointer tooltip。 |
| `TooltipService` | 当前 AppHost 的全局 pointer tooltip presenter 栈。 |
| `TooltipTarget` | 在虚拟命中等场景中主动调用全局 presenter。 |
| `TooltipManager.show()` | 兼容的 pointer-positioned 文本或 Rich Tooltip。 |
| `TooltipManager.showAnchored()` | 由矩形锚点定位的 owned passive Rich Tooltip。 |
| `TooltipManager.debugState()` | 返回状态及最后一次真实 tooltip-layer paint 的矩形。 |

## 声明式 Tooltip

所有 `RenderBox` 都可以设置：

```ts
button.tooltip = '刷新当前 Schema'
button.tooltipDelay = 600
```

EventDispatcher 会选择命中路径中最深的 tooltip target，通过当前 `TooltipService` 展示；pointer leave、wheel、root 清理或命中路径不再含 tooltip 时自动隐藏。

`TooltipContent` 可以是字符串，也可以是惰性 Rich RenderBox factory：

```ts
type TooltipContent = string | (() => RenderBox)
```

Rich factory 只在首次真实绘制时创建内容，并在替换、隐藏或 manager dispose 时释放。

## Pointer API

```ts
const tooltip = new TooltipManager()

tooltip.show('字段说明', { x: 120, y: 80 })
tooltip.updatePos({ x: 124, y: 82 })
tooltip.hide()
tooltip.dispose()
```

旧 pointer API 保持以下合同：默认延迟 600ms、锚点根为 dynamic、位置在 pointer 右下方并自动 flip/clamp；Rich Tooltip 最大宽度为 360px。`TooltipPresenter` 仍只要求 `show()`、`hide()` 和 `updatePos()`。

## Anchored Rich Tooltip

需要跟随 caret、单元格或任意矩形，并绑定 owner/root 生命周期时使用 `showAnchored()`：

```ts
class FieldAnchor implements PopupAnchorTarget {
  [GET_POPUP_ANCHOR_RECT]() {
    return { x: 120, y: 80, width: 1, height: 20 }
  }
}

const anchor = new FieldAnchor()
const tooltip = new TooltipManager()

tooltip.showAnchored(
  () => new RenderText('字段：created_at'),
  {
    anchor,
    owner: anchor,
    anchorRoot: windowRoot,
    anchorMode: 'stable',
    placement: 'bottom-start',
    fallbackPlacements: ['top-start'],
    overflowPreference: 'largest-space',
    maxWidth: 460,
    onDismiss: () => {
      // 同步调用方 Session
    },
  },
)
```

Anchored 内容只接受 `() => RenderBox`。需要纯文本时显式返回 `RenderText`，避免在核心中引入另一套文本换行规则。

## AnchoredTooltipOptions

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `anchor` | 必填 | 动态解析的矩形锚点。必须具有正宽高并与有效边界相交才会绘制。 |
| `boundary` | Popup viewport | 可选的动态布局边界。 |
| `placement` | `'bottom-start'` | 首选 top/bottom/left/right 侧和 start/end 对齐。 |
| `fallbackPlacements` | 对侧 placement | 按顺序尝试的备选位置；未传时保持原有对侧 flip。 |
| `overflowPreference` | `'largest-space'` | 两侧都放不下时选择首选侧或空间更大侧。 |
| `delay` | `0` | Anchored 展示延迟，归一为非负整数毫秒。 |
| `gap` | `6` | 面板与 anchor 的间距。 |
| `inset` | `4` | 面板完整视觉外壳与 boundary 的额外边距。 |
| `maxWidth` / `maxHeight` | boundary 限制 | 面板矩形上限，不包含外部阴影。 |
| `owner` | anchor target | owner hidden、detach 或 dispose 时关闭。 |
| `anchorRoot` | PopupManager 默认 root | 多窗口场景应显式传入所属 mounted render root。 |
| `anchorMode` | `'stable'` | stable root 不随之后的 pointer/focus 改变。 |
| `onDismiss` | `undefined` | popup 真正关闭后调用一次；内容 refresh 不调用。 |

`owner` 和 `anchorRoot` 是两个独立合同：owner 管理释放，anchorRoot 决定 PopupContext viewport 与根卸载生命周期。不能用 owner 推断 root。

## 更新、关闭和调试

相同 manager、owner、anchorMode 和 anchorRoot 的 `showAnchored()` 调用会刷新内容和锚点，不重复注册 popup，也不调用 `onDismiss`。pending 状态会使用最新 delay 重新计时；已显示或淡入中的内容保持当前 alpha。

`debugState()` 返回：

```ts
interface TooltipManagerDebugState {
  disposed: boolean
  mode: 'none' | 'pointer' | 'anchored'
  popupOpen: boolean
  pending: boolean
  visible: boolean
  rect: Rect | null
  placement: AnchoredPopupPlacement | null
  contentKind: 'text' | 'rich' | null
}
```

Anchored `rect` 只来自最后一次真实 tooltip-layer paint。如果 anchor、boundary、viewport、root identity、theme 或 options 已变化而下一次 paint 尚未发生，`rect` 会立即变回 `null`，不会泄露旧几何。

## 生命周期

- Tooltip 是 passive popup，不建立焦点域、不命中 pointer，也不处理 Escape。
- `owner` hidden/detach、`closeAnchoredTo(root)`、modal `closeExisting`、`hide()` 和 `dispose()` 都会释放惰性 Rich content。
- CodeEditor 等键盘驱动组件应持有独立 `TooltipManager`，不要安装到全局 `TooltipService`，否则普通 pointer move/leave 可能误关闭键盘提示。
- `dispose()` 幂等；dispose 后所有展示和更新方法均为 no-op。
- `onDismiss` 可能重入，调用方应先更新自身 Session，再主动隐藏 Tooltip。

## 与 Popover 的区别

| 组件 | 交互模型 | 适用内容 |
| --- | --- | --- |
| Tooltip | passive，不接收 pointer/focus | 短说明、语义 Hover、Signature Help。 |
| Popover | interactive，支持 outside click、Escape、Tab | 按钮、表单、可点击内容。 |

需要可交互链接或操作按钮时使用 [Popover](./popover.md)，不要把交互内容放入 Tooltip。

## 相关文档

- [Popup](./popup.md)
- [Popover](./popover.md)
- [CodeEditor](../visualization/code-editor.md)
