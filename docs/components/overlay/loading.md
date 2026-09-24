# Loading 加载

> **通用布局能力**：`RenderLoadingHost` 是普通 `RenderBox`，实例支持 `width`、`height`、min/max、`margin` 和槽位对齐；独立的 loading modal 属于 popup 协议，不作为父布局中的盒子使用。详见[组件通用布局属性](../common-layout-properties.md)。


Loading 用于表达异步任务进行中。框架提供两类能力：

- `RenderLoadingHost`：局部 loading，包裹一个内容组件，在内容上方绘制遮罩、spinner 和文案。
- `RenderLoadingModal`：全局阻塞 loading，作为 persistent [Popup](./popup.md) 覆盖整个 viewport。

业务页面通常使用 `RenderLoadingHost` 处理局部查询、局部保存；使用 `AppOverlayService.showLoading()` 或 `withLoading()` 处理全局阻塞任务。

## API 总览

```ts
import {
  AppOverlayService,
  RenderLoadingHost,
  RenderLoadingModal,
  RenderText,
  type AppLoadingHandle,
  type AppLoadingOptions,
  type AppLoadingTask,
  type RenderLoadingHostOptions,
  type RenderLoadingModalOptions,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderLoadingHost` | class | 局部 loading 宿主，包裹一个内容 child，在其上方绘制遮罩和 spinner。 |
| `RenderLoadingHostOptions` | type | 局部 loading 构造参数。 |
| `RenderLoadingModal` | class | 全局阻塞 loading popup。直接使用时需手动 close/dispose。 |
| `RenderLoadingModalOptions` | type | 全局 loading 构造参数。 |
| `AppOverlayService` | class | 应用级 loading 推荐入口，提供 `showLoading()` 和 `withLoading()`。 |
| `AppLoadingHandle` / `AppLoadingOptions` / `AppLoadingTask` | type | 应用级 loading handle、配置和任务类型。 |

最小装配顺序有两种：局部区域用 `RenderLoadingHost({ child, loading })`；全局阻塞任务优先用 `AppOverlayService.showLoading()` 或 `withLoading()`，由服务托管并发和释放。

## 何时使用

使用局部 LoadingHost：

- 表格、树、表单区块正在查询或保存。
- 页面其他区域仍然可以继续查看或操作。
- 希望 loading 遮罩只影响一个容器。

使用全局 LoadingModal：

- 登录、切换模块、加载远程页面、提交关键流程。
- 操作过程中必须阻断整个应用的鼠标、键盘和滚动。
- 需要跨页面统一管理 loading 生命周期。

不要使用：

- 只提示操作结果，使用 [Notification](./notification.md)。
- 需要用户确认，使用 [Modal](./modal.md)。
- 长时间后台任务且用户可继续工作，应使用状态栏、通知或任务中心，而不是长期阻塞全局 UI。

## 局部 LoadingHost 示例

```ts
const host = new RenderLoadingHost({
  child: content,
  loading: state.loading,
  text: '加载中...',
})

host.setLoading(true, '正在查询...')
host.setLoading(false)
```

`RenderLoadingHost` 的尺寸完全来自 `child`。loading 开启时，默认阻断子内容命中；关闭后恢复原内容交互。

## 全局 LoadingModal 示例

```ts
const modal = new RenderLoadingModal({
  text: '正在上传...',
  progress: 0.25,
})

modal.show()
modal.setProgress(0.75)
modal.setText('正在保存结果...')
modal.close()
modal.dispose()
```

直接使用 `RenderLoadingModal` 时，调用方要负责关闭和释放。业务代码更推荐使用 `AppOverlayService`。

## AppOverlayService 示例

```ts
const overlayService = new AppOverlayService()
const handle = overlayService.showLoading({
  text: '正在保存...',
  progress: 0,
})

handle.setProgress(0.5)
handle.setText('正在提交审核...')
handle.close()
```

`withLoading()` 会在任务 resolve 或 reject 后自动关闭 loading，并保留原始返回值或异常：

```ts
const overlayService = new AppOverlayService()

void overlayService.withLoading('正在保存...', async handle => {
  handle.setProgress(0.2)
  await save()
  handle.setProgress(1)
  return true
}).catch(error => {
  console.error(error)
})
```

## RenderLoadingHostOptions

```ts
interface RenderLoadingHostOptions {
  child: RenderBox
  loading?: boolean
  text?: string
  blockInput?: boolean
}
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `child` | `RenderBox` | 必填 | 被包裹的内容组件。 |
| `loading` | `boolean` | `false` | 初始 loading 状态。 |
| `text` | `string` | `undefined` | loading 文案。 |
| `blockInput` | `boolean` | `true` | loading 时是否阻断 child 的鼠标命中。 |

## RenderLoadingHost 属性和方法

| API | 类型 | 说明 |
| --- | --- | --- |
| `child` | `RenderBox` | 当前内容组件。 |
| `loading` | `boolean` | 当前 loading 状态。可直接赋值。 |
| `text` | `string \| undefined` | 当前 loading 文案。可直接赋值。 |
| `blockInput` | `boolean` | loading 时是否阻断输入。 |
| `setChild(child)` | `void` | 替换内容组件。旧 child 会解除 parent 和 owner，但不会 dispose。 |
| `setLoading(loading, text?)` | `void` | 更新 loading 状态；传入 text 时同时更新文案。 |
| `setLoadingText(text?)` | `void` | 只更新 loading 文案。 |
| `dispose()` | `void` | 释放 overlay 动画资源，并通过基类 dispose 当前 child。 |

`setChild()` 不 dispose 旧 child，是为了允许业务缓存内容树。旧 child 不再使用时，应由业务主动 dispose。

## RenderLoadingModalOptions

```ts
interface RenderLoadingModalOptions {
  text?: string
  progress?: number
}
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `text` | `string` | `undefined` | 全局 loading 文案。 |
| `progress` | `number` | `undefined` | 进度值。`undefined` 表示不显示进度条；数字会被限制到 `0..1`。 |

## RenderLoadingModal 属性和方法

| API | 类型 | 说明 |
| --- | --- | --- |
| `overlayLayer` | `'overlay'` | popup 绘制层。 |
| `visible` | `boolean` | 当前是否显示。 |
| `text` | `string \| undefined` | 当前文案。 |
| `progress` | `number \| undefined` | 当前进度。 |
| `show()` | `void` | 打开全局 loading，并作为 persistent popup 注册。 |
| `setText(text?)` | `void` | 更新文案。 |
| `setProgress(progress?)` | `void` | 更新进度；`undefined` 会隐藏进度条。 |
| `close()` | `void` | 关闭并从 `PopupManager` 注销。 |
| `hitTest(point, context)` | `boolean` | 可见时整个 viewport 命中。 |
| `onWheel(event, context)` | `boolean` | 消费滚轮。 |
| `onOutsidePointerDown(event, context)` | `boolean` | 消费外部点击。 |
| `onEscape(event)` | `boolean` | 阻止 Escape 关闭，并消费事件。 |
| `onKeyDown(event)` | `boolean` | 消费所有键盘事件。 |
| `dispose()` | `void` | 关闭并释放 spinner 动画资源。 |

`show()` 会调用 `PopupManager.open(this, { persistent: true })`，随后 `bringToFront()`。这保证全局 loading 可以保持在普通 modal 之上。

## AppLoadingOptions / AppLoadingHandle

```ts
interface AppLoadingOptions {
  text?: string
  progress?: number
}

interface AppLoadingHandle {
  readonly closed: boolean
  setText(text?: string): void
  setProgress(progress?: number): void
  close(): void
}
```

| API | 说明 |
| --- | --- |
| `showLoading(options?)` | 打开或复用全局 loading modal，返回 handle。`options` 可以是字符串或对象。 |
| `withLoading(options, task)` | 打开 loading，执行异步/同步任务，并在 `finally` 中关闭 handle。 |
| `handle.closed` | handle 是否已经关闭。 |
| `handle.setText(text?)` | 更新该 handle 的文案。handle 关闭后调用无效。 |
| `handle.setProgress(progress?)` | 更新该 handle 的进度。handle 关闭后调用无效。 |
| `handle.close()` | 关闭该 handle。重复调用安全。 |

## 并发 loading 规则

`AppOverlayService` 允许多个任务同时打开 loading，但只维护一个 `RenderLoadingModal`：

```ts
const overlayService = new AppOverlayService()

const first = overlayService.showLoading('正在加载条目...')
const second = overlayService.showLoading({
  text: '正在加载文档...',
  progress: 0.3,
})

second.close()
first.close()
```

规则：

- 最新未关闭 handle 决定当前 modal 的 `text` 和 `progress`。
- 关闭最新 handle 后，会回退显示上一个未关闭 handle 的状态。
- 所有 handle 都关闭后，loading modal 会 dispose 并从 popup 栈移除。
- `withLoading()` 内部使用同一套 handle 规则。
- `AppOverlayService.dispose()` 会关闭所有 loading handle 并释放 modal。

这个规则适合模块切换、页面查询和保存动作重叠发生的情况，避免创建多个全屏 loading。

## 输入阻断

`RenderLoadingHost`：

- `blockInput: true` 时，loading 区域命中到 host 本身，不再进入 child。
- `blockInput: false` 时，loading 遮罩仍绘制，但 child 仍可命中和响应。

`RenderLoadingModal`：

- 整个 viewport 命中。
- 鼠标、滚轮、Escape 和所有键盘事件都会被消费。
- 只能通过业务代码调用 `handle.close()`、`modal.close()` 或 dispose 关闭。

## 绘制和主题

Loading 的视觉 token 来自主题：

| Token | 说明 |
| --- | --- |
| `loadingMaskBg` | 遮罩颜色。 |
| `loadingSpinnerColor` | spinner 前景弧线。 |
| `loadingSpinnerTrackColor` | spinner 背景轨道。 |
| `loadingTextColor` | 文案颜色。 |
| `loadingSpinnerSize` | spinner 尺寸。 |
| `loadingSpinnerLineWidth` | spinner 线宽。 |
| `loadingTextGap` | spinner 和文案间距。 |

局部 LoadingHost 绘制顺序：

1. child 内容。
2. loading 遮罩。
3. spinner 和文案。

全局 LoadingModal 绘制顺序：

1. viewport 遮罩。
2. 居中 panel 阴影、背景、边框。
3. spinner 和文案。
4. 可选进度条和百分比。

## 生命周期建议

推荐使用 `withLoading()` 包裹异步任务：

```ts
const overlayService = new AppOverlayService()

void overlayService.withLoading('正在提交...', async handle => {
  handle.setProgress(0.1)
  await save()
  handle.setProgress(0.8)
  await reload()
})
```

手动 handle 模式必须保证在所有分支关闭：

```ts
const overlayService = new AppOverlayService()
const handle = overlayService.showLoading('正在处理...')

try {
  await save()
} finally {
  handle.close()
}
```

不要在失败分支里只显示错误而忘记关闭 loading。`withLoading()` 会在任务抛错时自动关闭并重新抛出异常。

## 性能边界

- Loading spinner 会按动画 tick 请求重绘。局部 LoadingHost 只应包裹必要区域，避免把整个复杂页面都放进一个局部 host。
- 全局 LoadingModal 的重绘发生在 overlay 层，不会触发布局。
- 长文本会被 clip 在可视区域内，但不会自动换行。loading 文案应短而明确。
- 进度值更新只应在业务进度变化时调用，不要用高频定时器模拟百分比。
- 长时间任务应考虑任务中心、状态栏或可取消交互，而不是长期占用全局 modal。

## 常见问题

### 为什么 Escape 不能关闭全局 Loading？

全局 Loading 表示业务正在进行不可中断流程。当前实现会消费 Escape 和所有键盘事件，避免用户误关闭后继续操作底层页面。可取消任务应由业务提供明确的取消入口。

### 为什么 showLoading 多次只看到一个 Modal？

`AppOverlayService` 设计为多 handle、单 modal。最新未关闭 handle 决定显示内容，最后一个 handle 关闭时释放 modal。

### progress 传 2 或 -1 会怎样？

`RenderLoadingModal` 会把数字限制在 `0..1`。`undefined` 或 `NaN` 会视为无进度条。

### LoadingHost 的 child 会被 dispose 吗？

`RenderLoadingHost.dispose()` 会通过基类 dispose 当前 child。`setChild()` 替换旧 child 时不会 dispose 旧 child。

### 局部 Loading 是否一定阻断输入？

默认阻断。需要遮罩展示但允许内容继续交互时传 `blockInput: false`。

## 相关文档

- [Popup 浮层系统](./popup.md)
- [Modal 模态框](./modal.md)
- [Notification 通知](./notification.md)
- [Button 按钮](../basic/button.md)
- [ScrollView 滚动容器](../../layouts.md)
