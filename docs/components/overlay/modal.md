# Modal 模态框

> **通用布局能力**：`RenderModal` 实例继承 `RenderBox` 的尺寸、min/max、`margin` 和槽位对齐属性；作为 popup 打开时，实际位置仍由 modal/viewport 规则决定。详见[组件通用布局属性](../common-layout-properties.md)。


`RenderModal` 是阻断式确认对话框。它基于 [Popup](./popup.md) 管理器显示在 overlay 层，打开后遮罩整个 viewport，消费鼠标、滚轮和键盘事件，适合要求用户明确确认或取消的短流程。

当前 `RenderModal` 的内容区是 `string`，不是任意 `RenderBox` 容器。需要复杂表单、列表或自定义布局时，优先使用 [Drawer](./drawer.md)、`RenderWindow`，或在业务层封装一个新的 popup 组件。

## API 总览

```ts
import {
  AppOverlayService,
  RenderModal,
  type AppAlertDialogOptions,
  type AppConfirmDialogOptions,
  type AppModalOptions,
  type ModalButton,
} from 'directsurface'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderModal` | class | 阻断式确认对话框。直接创建时需要调用 `show()` 打开，并在关闭后自行 `dispose()`。 |
| `ModalButton` | type | 底部按钮定义，决定显示文本、返回 key、主按钮和危险按钮样式。 |
| `AppOverlayService` | class | 应用级 overlay 服务。`showModal()`、`alert()` 和 `confirm()` 会托管 modal 的打开、关闭和释放。 |
| `AppModalOptions` | type | `AppOverlayService.showModal()` 的配置对象。 |
| `AppAlertDialogOptions` | type | `AppOverlayService.alert()` 的配置对象。 |
| `AppConfirmDialogOptions` | type | `AppOverlayService.confirm()` 的配置对象。 |

短流程优先使用 `AppOverlayService`；只有需要精确控制 modal 实例、上下文或测试状态时才直接创建 `RenderModal`。

## 何时使用

使用 Modal：

- 删除、作废、提交、签名等必须二次确认的操作。
- 操作结果会影响数据状态，用户需要明确选择“确认/取消”。
- 需要临时阻断底层页面交互。

不要使用：

- 普通说明文字，使用 TooltipService 或 [Popover](./popover.md)。
- 轻量快捷操作，使用 [Popover](./popover.md)。
- 长表单、复杂编辑器或带滚动内容的侧栏，使用 [Drawer](./drawer.md) 或窗口。
- 非阻断消息，使用 [Notification](./notification.md)。

## 最小示例

```ts
const modal = new RenderModal({
  title: '确认删除',
  content: '删除后不可恢复。',
  buttons: [
    { key: 'cancel', label: '取消' },
    { key: 'delete', label: '删除', danger: true },
  ],
  onClose: key => {
    if (key === 'delete') remove()
  },
})

modal.show()
```

`show()` 会把 modal 注册到 `PopupManager`，并使用 `closeExisting: true` 关闭已有的普通 popup。关闭后应调用 `dispose()`，或通过 `AppOverlayService.showModal()` 让服务自动释放。

## AppOverlayService 示例

业务页面通常不直接持有 `RenderModal`，而是通过应用 overlay 服务打开：

```ts
const overlayService = new AppOverlayService()

const modal = overlayService.showModal({
  title: '确认提交',
  content: '提交后将进入审核流程。',
  buttons: [
    { key: 'cancel', label: '取消' },
    { key: 'submit', label: '提交', primary: true },
  ],
  onClose: key => {
    if (key === 'submit') save()
  },
})

modal.hide('cancel')
```

`AppOverlayService.showModal()` 会在 `onClose` 后自动 `dispose()` modal，并清理当前 active modal 引用。`alert()` 和 `confirm()` 是基于 `showModal()` 的 Promise 封装：

```ts
const overlayService = new AppOverlayService()

overlayService.alert({
  title: '保存完成',
  content: '文档已保存。',
}).then(() => {
  reload()
})

overlayService.confirm({
  title: '确认作废',
  content: '是否作废当前记录？',
  confirmText: '作废',
  danger: true,
}).then(confirmed => {
  if (confirmed) remove()
})
```

## ModalButton

```ts
interface ModalButton {
  label: string
  key: string
  primary?: boolean
  danger?: boolean
}
```

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `label` | `string` | 必填 | 按钮显示文本。 |
| `key` | `string` | 必填 | 关闭回调返回的按钮标识。 |
| `primary` | `boolean` | `false` | 主按钮样式。按 Enter 时会触发第一个 `primary` 按钮。 |
| `danger` | `boolean` | `false` | 危险操作样式。优先级高于 `primary` 的视觉样式。 |

未传 `buttons` 时，默认按钮为：

```ts
[
  { label: '取消', key: 'cancel' },
  { label: '确认', key: 'ok', primary: true },
]
```

## RenderModal 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `title` | `string` | 必填 | 标题栏文本。 |
| `content` | `string` | 必填 | 内容文本。当前只绘制单行字符串。 |
| `buttons` | `ModalButton[]` | 取消/确认 | 底部按钮列表。 |
| `visible` | `boolean` | `false` | 初始可见状态。直接传 `true` 只设置状态，不等同于调用 `show()` 注册 popup。 |
| `modalWidth` | `number` | `360` | 面板宽度。 |
| `modalHeight` | `number` | `180` | 面板高度。 |
| `appContext` | `AppContextRegistry` | `undefined` | modal 局部上下文。 |
| `disposeAppContextOnDispose` | `boolean` | `false` | `dispose()` 时是否释放 `appContext`。 |
| `onClose` | `(buttonKey: string \| null) => void` | `undefined` | 关闭回调。按钮关闭返回按钮 `key`，Escape、`close()` 返回 `null`。 |

`visible: true` 适合测试或由外部 popup 管理器手动接管的场景。业务代码通常应创建后调用 `show()`。

## 属性和方法

| API | 类型 | 说明 |
| --- | --- | --- |
| `title` | `string` | 标题文本。 |
| `content` | `string` | 内容文本。 |
| `buttons` | `ModalButton[]` | 当前按钮列表。 |
| `visible` | `boolean` | 是否可见。 |
| `modalWidth` | `number` | 面板宽度。 |
| `modalHeight` | `number` | 面板高度。 |
| `overlayLayer` | `'overlay'` | popup 绘制层。 |
| `appContext` | `AppContextRegistry \| undefined` | 当前局部上下文。 |
| `setAppContext(context?, options?)` | `void` | 替换局部上下文。旧上下文若由 modal 持有，会在替换时释放。 |
| `show()` | `void` | 打开 modal，注册到 `PopupManager`，启动淡入动画。 |
| `hide(buttonKey?)` | `void` | 关闭 modal，注销 popup，触发 `onClose`。默认 `buttonKey` 为 `null`。 |
| `close()` | `void` | Popup 协议关闭入口，等同于 `hide(null)`。 |
| `onKeyDown(event)` | `boolean` | 处理 Tab、Enter、Escape。 |
| `onEscape(event)` | `boolean` | 关闭 modal 并返回 `true`。 |
| `onOutsidePointerDown(event)` | `boolean` | 消费外部点击，但不会关闭 modal。 |
| `onWheel(event)` | `boolean` | 消费滚轮，避免底层滚动。 |
| `hitTest(point, popupContext?)` | `boolean` | 可见时整个 viewport 命中。 |
| `dispose()` | `void` | 关闭 popup、释放动画和可选上下文。 |

修改 `title`、`content`、`buttons`、`modalWidth` 或 `modalHeight` 后，需要由调用方请求重绘或重新布局。通过 `AppOverlayService` 打开的短生命周期 modal 通常不需要动态修改。

## 键盘和鼠标行为

| 操作 | 行为 |
| --- | --- |
| 点击遮罩 | 被 modal 消费，modal 保持打开。 |
| 点击按钮 | 指针按下和抬起都在同一按钮上时关闭，并返回该按钮 `key`。 |
| 鼠标移入按钮 | 更新 hover 状态并重绘 overlay。 |
| `Enter` | 触发第一个 `primary` 按钮；没有主按钮时不关闭。 |
| `Escape` | 关闭并返回 `null`。 |
| `Tab` | 被消费，用于阻断焦点离开当前阻塞层；当前实现没有内部焦点巡航。 |
| 滚轮 | 被消费，底层滚动容器不响应。 |

Modal 的遮罩点击不会自动关闭，这是为了避免危险确认被误触关闭。需要轻量点击外部关闭的浮层时使用 [Popover](./popover.md) 或 [ContextMenu](./context-menu.md)。

## App Context

Modal 可以提供局部 App Context：

```ts
const messageKey = createAppContextKey<string>('modal.message')
const modalContext = new AppContextRegistry(undefined, [
  [messageKey, '本次提交需要复核。'],
])

const modal = new RenderModal({
  title: '复核提示',
  content: modalContext.require(messageKey),
  appContext: modalContext,
  disposeAppContextOnDispose: true,
})

modal.show()
```

通过 `AppOverlayService.showModal(options: AppModalOptions)` 打开时，可传：

| 参数 | 说明 |
| --- | --- |
| `title` | 标题。 |
| `content` | 内容文本。 |
| `buttons` | 底部按钮列表。 |
| `modalWidth` / `modalHeight` | 面板尺寸。 |
| `onClose` | 关闭回调。 |
| `context` | 显式传入已有 `AppContextRegistry`。默认不由 modal 释放。 |
| `contextValues` | 根据 `source` 或当前 provider 派生临时上下文值。 |
| `disposeContextOnClose` | 关闭并 dispose modal 时是否释放显式上下文。 |
| `source` | 用于从调用源对象向上解析上下文。 |

`AppOverlayService.alert(options: AppAlertDialogOptions)` 和 `confirm(options: AppConfirmDialogOptions)` 复用同一套上下文参数，并增加便捷文案字段：

| Options | 字段 |
| --- | --- |
| `AppAlertDialogOptions` | `content`、`title?`、`okText?`、`danger?`、`modalWidth?`、`modalHeight?`。 |
| `AppConfirmDialogOptions` | `content`、`title?`、`confirmText?`、`cancelText?`、`danger?`、`modalWidth?`、`modalHeight?`。 |

如果传入外部共享上下文，默认应保持 `disposeContextOnClose: false`，避免关闭 modal 时误释放页面或工作区上下文。

## 绘制和主题

Modal 绘制顺序：

1. 全屏遮罩。
2. 居中的面板阴影、背景和边框。
3. 标题栏背景、标题文本和分隔线。
4. 内容文本。
5. 底部按钮。

视觉 token 来自 `deriveModalStyle(context.theme)`，包括遮罩、面板、标题栏、按钮、危险按钮、hover/pressed 状态，以及 `shadowColor`、`shadowBlur`、`shadowOffsetX`、`shadowOffsetY` 四个面板阴影字段。Modal、PromptModal 和 LoadingModal 共用这组阴影语义。面板位置每次 paint 会根据 `PopupManager` viewport 居中计算，因此窗口尺寸变化时会自动重新定位。

当前内容文本只按单行绘制，没有内建换行、滚动和富内容布局。长文本应缩短文案、增大 `modalWidth/modalHeight`，或使用支持内容组件的自定义 popup。

## 生命周期

直接使用 `RenderModal` 时，推荐流程：

```ts
const modal = new RenderModal({
  title: '提示',
  content: '操作完成。',
  onClose: () => {
    modal.dispose()
  },
})

modal.show()
```

注意：

- `hide()` 只关闭并触发回调，不会自动 dispose。
- `dispose()` 会先 `close()`，再释放动画控制器。
- `disposeAppContextOnDispose` 为 `true` 时会释放 `appContext`。
- `AppOverlayService.showModal()` 已在内部处理 `onClose` 后的 `dispose()`。

## 性能边界

- Modal 每次打开只绘制一个 overlay 面板，性能成本低。
- 按钮 hover/pressed 会请求 overlay 重绘，但不会触发布局树递归。
- 不要把大文本或复杂结构塞进 `content` 字符串；当前实现不会虚拟化、换行或滚动内容。
- `show()` 使用 `closeExisting: true`，会关闭已有普通 popup。持久 loading 等特殊 overlay 由 `AppOverlayService` 维护时仍可能保留在更高层。

## 常见问题

### 为什么点击遮罩不关闭？

这是当前 `RenderModal` 的明确行为：遮罩点击被消费但不关闭。阻断式确认框应通过按钮、Escape 或程序调用关闭，避免误触导致用户丢失判断上下文。

### 为什么内容不能放输入框或表格？

当前 `RenderModal.content` 是 `string`。需要表单内容时不要强行扩展业务代码里的 modal 字符串，应该使用 [Drawer](./drawer.md)、`RenderWindow`，或新增一个可承载 `RenderBox` 内容的 popup 组件。

### Enter 为什么没有反应？

只有存在 `primary: true` 的按钮时，Enter 才会关闭并返回该按钮 `key`。自定义 `buttons` 时需要显式设置主按钮。

### 关闭回调返回 `null` 是什么含义？

`null` 表示不是由具体按钮关闭，例如 Escape、`close()` 或 `hide(null)`。业务逻辑应只在期望按钮 key 上执行提交或删除。

## 相关文档

- [Popup 浮层系统](./popup.md)
- [Popover 浮窗](./popover.md)
- [Drawer 抽屉](./drawer.md)
- [Prompt 输入对话框](./prompt.md)
- [Notification 通知](./notification.md)
- App Context
