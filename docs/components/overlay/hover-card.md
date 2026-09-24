# HoverCard 交互式悬浮信息卡

`HoverCardPopup` 是由指针悬停触发、允许用户进入并操作的 anchored rich popup。它适合语义说明、文档链接、可复制代码和可滚动详情；普通短提示仍应使用 [Tooltip](./tooltip.md)，主动打开的操作面板使用 [Popover](./popover.md)。

```ts
import { HoverCardPopup, RenderMarkdownViewer } from 'directsurface'

const card = new HoverCardPopup()
card.show({
  anchor: tokenAnchor,
  anchorRoot: editorRoot,
  owner: editor,
  placement: 'right-start',
  fallbackPlacements: ['left-start', 'bottom-start', 'top-start'],
  content: new RenderMarkdownViewer({
    markdown: 'Details',
    appearance: 'embedded',
    shrinkWrap: 'both',
  }),
})
```

## 交互合同

- popup 以 `interactionMode: 'nonmodal'` 打开，不建立 Popup focus scope。
- Card 可接收 pointer、wheel 和 focus；Card 外的 pointer 仍路由到主 Render Tree。
- `notifyAnchorEnter()` / `notifyAnchorLeave()` 与 Card 自身 enter/leave 共同形成默认 150ms 的关闭缓冲。
- Card 内有 pointer capture、文本拖选或辅助焦点时，关闭计时不会销毁内容。
- 普通 `close()`、Escape 和延迟关闭恢复进入 Card 前的非辅助焦点。
- owner 永久销毁时调用 `disposePopup({ restoreFocus: false })`，避免重新聚焦已失效控件。
- Modal、Prompt 或 `PopupManager.closeTransient()` 会关闭 Card；旧 nonmodal popup 的默认行为保持不变。

## 主要 API

```ts
interface HoverCardPopupOptions {
  anchor: PopupAnchor
  boundary?: PopupAnchor
  content: RenderBox
  owner?: object
  anchorRoot?: RenderObject
  anchorMode?: PopupAnchorMode
  placement?: AnchoredPopupPlacement
  fallbackPlacements?: readonly AnchoredPopupPlacement[]
  overflowPreference?: AnchoredPopupOverflowPreference
  gap?: number
  inset?: number
  minWidth?: number
  maxWidth?: number
  maxHeight?: number
  closeDelayMs?: number
  onDismiss?: () => void
}
```

默认几何为 `bottom-start`、`largest-space`、`gap=6`、`inset=4`、`minWidth=220`、`maxWidth=560`、`maxHeight=360`。`fallbackPlacements` 按顺序声明备选位置；未传时保持“首选侧→对侧”的兼容行为。完整 popup shadow 会被限制在 boundary 内；未传 boundary 时使用所属 `anchorRoot` 的 Popup viewport。选定侧面空间不足时，Card 会收缩对应主轴尺寸，长内容由 Card 内部滚动承载，避免 clamp 回锚定内容上方。`debugState().rect` 只在真实 tooltip-layer paint 后提供；anchor、boundary、theme 或 viewport 改变后会立即失效，等待下一次 paint 重算。

## Wheel 与焦点

Card 内容消费 wheel 时，底层控件不会滚动。可滚动内容即使已到顶部或底部，也应继续消费对应纵向 wheel，避免滚动穿透。内容不具备 overflow 且返回 `false` 时，事件才回退到主 Render Tree。

Card 的 focusable 子项通过 `FocusManager.registerAuxiliaryRoot()` 进入普通焦点序列，不改变 Modal/Popup scope。Card 关闭时由 FocusManager 验证并恢复可用的原焦点。

## 释放

替换内容时，旧内容会解除 parent 并释放。永久释放必须调用：

```ts
card.disposePopup({ restoreFocus: false })
```

释放后 Card 不可再次打开，timer、pointer capture、辅助焦点根和内容回调都会被清理。
