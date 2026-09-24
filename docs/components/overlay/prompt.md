# Prompt 输入对话框

> **通用布局能力**：`RenderPromptModal` 继承 `RenderBox` 的尺寸、min/max、`margin` 和槽位对齐属性；作为 modal 打开时，viewport 居中和默认面板尺寸仍由 Prompt 规则控制。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderPromptModal` 是单行输入型模态对话框。它在 [Modal](./modal.md) 的阻断式遮罩和按钮区基础上内置一个 `RenderTextBox`，适合快速收集一段简短文本。

Prompt 不是通用表单容器：当前只支持一个单行输入框，没有内置校验、错误提示、多字段布局或富文本输入。复杂表单应使用 [Drawer](./drawer.md)、`RenderWindow`，或业务自定义 popup。


## API 总览

```ts
import {
  AppOverlayService,
  RenderPromptModal,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderPromptModal` | class | 单行输入型模态对话框。直接使用时需要 `show()` 打开，并在关闭后自行 `dispose()`。 |
| `AppOverlayService` | class | 应用级 prompt 推荐入口，`prompt()` 返回 `Promise<string | null>` 并自动释放 modal。 |

最小装配顺序有两种：业务流程优先调用 `AppOverlayService.prompt(options)`；需要精确控制实例时创建 `RenderPromptModal`，并在 `onClose` 或页面释放时 `dispose()`。

## 何时使用

使用 Prompt：

- 重命名。
- 输入简短备注、原因或命令参数。
- 需要用户立即输入一段短文本，并明确确认/取消。

不要使用：

- 多字段表单，使用 [Drawer](./drawer.md) 或页面级表单。
- 长文本输入，使用 TextArea 或专门编辑器。
- 需要复杂校验和错误展示的流程，使用自定义对话框。
- 只需要确认/取消而不输入文本，使用 [Modal](./modal.md)。

## 最小示例

```ts
const prompt = new RenderPromptModal({
  title: '重命名',
  content: '请输入新名称',
  value: currentName,
  placeholder: '名称',
  onClose: (key, value) => {
    if (key === 'ok') rename(value)
  },
})

prompt.show()
```

直接使用 `RenderPromptModal` 时，关闭后需要由调用方释放，或在 `onClose` 中 `dispose()`。

## AppOverlayService 示例

业务页面更常用 `AppOverlayService.prompt()`，它返回 `Promise<string | null>` 并自动释放 modal：

```ts
const overlayService = new AppOverlayService()

overlayService.prompt({
  title: '重命名',
  content: '请输入新的演示名称',
  initialValue: currentName,
  placeholder: '名称',
}).then(value => {
  if (value !== null) rename(value)
})
```

返回语义：

| 关闭方式 | Promise 结果 |
| --- | --- |
| 确认按钮 | 当前输入值。 |
| Enter | 当前输入值。 |
| 取消按钮 | `null`。 |
| Escape | `null`。 |
| `closeModal()` 默认调用 | `null`。 |

空字符串 `''` 是合法输入值，不等同于取消。业务判断应使用 `value !== null`，不要直接用 truthy 判断。

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `title` | `string` | 必填 | 标题栏文本。 |
| `content` | `string` | 必填 | 输入框上方的说明文本。 |
| `value` | `string` | `''` | 初始输入值。 |
| `placeholder` | `string` | `''` | 输入框 placeholder。 |
| `buttons` | `ModalButton[]` | 取消/确认 | 底部按钮列表。 |
| `visible` | `boolean` | `false` | 初始可见状态。直接传 `true` 不等同于调用 `show()` 注册 popup 和启动输入会话。 |
| `modalWidth` | `number` | `420` | 面板宽度。 |
| `modalHeight` | `number` | `220` | 面板高度。 |
| `appContext` | `AppContextRegistry` | `undefined` | modal 局部上下文。 |
| `disposeAppContextOnDispose` | `boolean` | `false` | dispose 时是否释放局部上下文。 |
| `onClose` | `(buttonKey: string \| null, value: string) => void` | `undefined` | 关闭回调。 |

默认按钮：

```ts
[
  { label: '取消', key: 'cancel' },
  { label: '确认', key: 'ok', primary: true },
]
```

## AppPromptDialogOptions

`AppOverlayService.prompt()` 使用的选项：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `source` | `RenderObject` | `undefined` | 用于解析局部 App Context 的来源对象。 |
| `context` | `AppContextRegistry` | `undefined` | 显式传入上下文。默认不由 prompt 释放。 |
| `contextValues` | `AppContextInitialValues` | `undefined` | 基于来源上下文派生临时值。 |
| `disposeContextOnClose` | `boolean` | `false` | 关闭后是否释放显式或派生上下文。 |
| `content` | `string` | 必填 | 输入说明文本。 |
| `title` | `string` | `'请输入'` | 标题。 |
| `placeholder` | `string` | `''` | placeholder。 |
| `initialValue` | `string` | `''` | 初始值。 |
| `confirmText` | `string` | `'确认'` | 确认按钮文本。 |
| `cancelText` | `string` | `'取消'` | 取消按钮文本。 |
| `modalWidth` | `number` | `420` | 面板宽度。 |
| `modalHeight` | `number` | `220` | 面板高度。 |

`prompt()` 会先 `closeModal()`，因此会关闭当前 active Modal/Prompt，然后打开新的 prompt。

## 属性和方法

| API | 类型 | 说明 |
| --- | --- | --- |
| `title` | `string` | 标题文本。 |
| `content` | `string` | 说明文本。 |
| `placeholder` | `string` | 输入框 placeholder。 |
| `buttons` | `ModalButton[]` | 底部按钮。 |
| `visible` | `boolean` | 是否可见。 |
| `modalWidth` | `number` | 面板宽度。 |
| `modalHeight` | `number` | 面板高度。 |
| `value` | `string` | 当前输入值，只读 getter。 |
| `overlayLayer` | `'overlay'` | popup 绘制层。 |
| `appContext` | `AppContextRegistry \| undefined` | 当前局部上下文。 |
| `setAppContext(context?, options?)` | `void` | 替换局部上下文。旧上下文若由 prompt 持有，会在替换时释放。 |
| `show()` | `void` | 打开 prompt，注册 popup，启动输入会话并聚焦输入框。 |
| `hide(buttonKey?)` | `void` | 关闭 prompt，结束输入焦点，触发 `onClose`。 |
| `close()` | `void` | 等同于 `hide(null)`。 |
| `onKeyDown(event)` | `boolean` | 处理 Tab、Enter、Escape。 |
| `onEscape(event)` | `boolean` | 关闭并返回 `null`。 |
| `onOutsidePointerDown(event)` | `boolean` | 消费遮罩点击但不关闭。 |
| `onWheel(event)` | `boolean` | 消费滚轮，阻止底层滚动。 |
| `hitTest(point, context?)` | `boolean` | 可见时整个 viewport 命中。 |
| `dispose()` | `void` | 关闭 popup、释放动画、输入框和可选上下文。 |

`value` 会随着输入框 `onChange` 更新。`hide()` 时会再次读取输入框当前值并传给 `onClose`。

## 键盘和鼠标行为

| 操作 | 行为 |
| --- | --- |
| 打开 | 同步输入框布局，聚焦输入框，开始文本输入会话。 |
| 点击输入框 | 指针事件转发给内部 `RenderTextBox`。 |
| 点击按钮 | 按下和抬起都在同一按钮上时关闭，并返回按钮 key 和当前 value。 |
| 点击遮罩 | 被消费，prompt 保持打开。 |
| `Enter` | 确认，等同于 `hide('ok')`。 |
| 输入框 submit | 确认，等同于 `hide('ok')`。 |
| `Escape` | 取消，等同于 `hide(null)`。 |
| `Tab` | 被消费，用于阻断焦点离开当前 overlay；当前实现不做内部焦点巡航。 |
| 滚轮 | 被消费，底层不滚动。 |

当前实现没有按钮级禁用，也没有内置校验失败阻止关闭的机制。业务需要校验时，应在 Promise 返回后处理，或实现自定义输入对话框。

## 绘制和布局

Prompt 使用 Modal 的视觉 token：

1. 全屏遮罩。
2. 居中面板阴影、背景和边框。
3. 标题栏和分隔线。
4. `content` 说明文本。
5. 单行输入框。
6. 底部按钮。

默认面板尺寸是 `420 x 220`。输入框位置由标题栏高度、modal padding 和 `deriveTextInputStyle(theme).height` 计算。每次 paint 前会同步 viewport 尺寸和输入框布局，因此窗口尺寸变化后仍保持居中。

## App Context

和 Modal 一样，Prompt 可以提供局部 App Context：

```ts
const reasonKey = createAppContextKey<string>('prompt.reason')
const promptContext = new AppContextRegistry(undefined, [
  [reasonKey, '默认原因'],
])

const prompt = new RenderPromptModal({
  title: '填写原因',
  content: '请输入原因',
  value: promptContext.require(reasonKey),
  appContext: promptContext,
  disposeAppContextOnDispose: true,
})

prompt.show()
```

通过 `AppOverlayService.prompt()` 时，可使用 `source`、`context`、`contextValues` 和 `disposeContextOnClose` 管理局部上下文生命周期。

## 生命周期

直接使用时：

```ts
let prompt!: RenderPromptModal

prompt = new RenderPromptModal({
  title: '重命名',
  content: '请输入新名称',
  onClose: () => {
    prompt.dispose()
  },
})

prompt.show()
```

`AppOverlayService.prompt()` 已经在内部处理关闭后的 `dispose()`，业务只需要处理 Promise 结果。

注意：

- `hide()` 只关闭并触发回调，不自动 dispose。
- `dispose()` 会先 `close()`，然后释放动画和子输入框。
- `disposeAppContextOnDispose` 为 `true` 时会释放局部上下文。
- 打开新的 prompt 前，`AppOverlayService.prompt()` 会关闭当前 active modal。

## 性能边界

- Prompt 是短生命周期组件，绘制成本低。
- 输入变化只更新内部单行输入框和 overlay 重绘，不应承载复杂页面。
- 长文本不会自动变成多行，输入框仍是单行 TextBox。
- 不要用 Prompt 实现复杂表单校验流程。

## 常见问题

### 为什么点击遮罩不关闭？

Prompt 继承阻断式对话框语义，遮罩点击只消费事件，不关闭。取消应通过取消按钮、Escape 或程序调用。

### 为什么没有校验？

当前实现没有内置校验、错误提示或禁用确认按钮能力。需要复杂校验时应使用自定义 popup 或页面级表单。

### 为什么空字符串会进入 then 分支？

`AppOverlayService.prompt()` 的确认结果是 `string`，取消结果是 `null`。空字符串是合法确认值。判断时使用 `value !== null`。

### Enter 是否总是确认？

是。Prompt 的 `onKeyDown` 和内部输入框 submit 都会以 `ok` 关闭。

### 能放多个输入框吗？

不能。当前只内置一个 `RenderTextBox`。多字段场景应使用 Drawer、窗口或自定义 popup。

## 相关文档

- [Modal 模态框](./modal.md)
- [Popup 浮层系统](./popup.md)
- [Drawer 抽屉](./drawer.md)
- [TextBox / TextBox](../input/text-box.md)
- App Context
