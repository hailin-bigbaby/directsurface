# Notification 通知

`NotificationManager` 是应用内非阻塞 Toast 管理器。它在 viewport 右上角显示结果反馈，最多保留 3 条，并支持自动关闭、显式 key 替换、更新、关闭按钮和一个业务操作。


## 选择边界

适合使用 Toast：

- 保存、提交、同步等操作的结果反馈；
- 不阻断当前录入流程的警告或错误；
- 提供一次“重试”或“查看详情”操作。

不要使用 Toast：

- 需要用户确认或必须阅读的内容，使用 [Modal](./modal.md)；
- 字段校验错误，在字段附近展示；
- 持续任务进度，使用 [Loading](./loading.md) 或页面状态；
- 不能丢失的业务消息，应进入页面状态或专用消息系统。

## API 总览

```ts
import {
  AppOverlayService,
  NotificationManager,
  type NotificationHandle,
  type NotificationOptions,
} from 'ds-ui'
```

应用应复用一个 `NotificationManager`，业务页面通常优先使用宿主的 `AppOverlayService`。

## 兼容 API

旧入口保持不变：

```ts
const id = notificationManager.show(
  'success',
  '保存成功',
  '文档内容已保存。',
)

notificationManager.close(id)
```

`show(type, title, message?, duration?)` 返回 number id，默认 3000ms；`duration <= 0` 表示持续显示。旧入口没有关闭按钮和业务操作。

## Options API

```ts
const overlayService = new AppOverlayService()
const retrySave = async (): Promise<void> => {}
const reportActionError = (_error: unknown): void => {}

const handle = overlayService.notify({
  type: 'error',
  title: '保存失败',
  message: '网络连接异常，请重试。',
  key: 'general-record-save',
  action: {
    label: '重试',
    onInvoke: () => retrySave(),
  },
  onActionError: error => reportActionError(error),
})
```

```ts
interface NotificationOptions {
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  message?: string
  key?: string
  duration?: number
  dismissible?: boolean
  action?: {
    label: string
    onInvoke: () => void | Promise<void>
    closeOnInvoke?: boolean
  }
  onClose?: (reason: NotificationCloseReason) => void
  onActionError?: (error: unknown) => void
}
```

新入口默认时间：

| 场景 | 默认时间 |
| --- | ---: |
| `success` | 5000ms |
| `info` | 6000ms |
| `warning` | 8000ms |
| `error` | 持续显示 |
| 含 action | 持续显示 |

显式 `duration` 优先于默认值。新通知默认可关闭；action 最多一个，执行成功后默认以 `action` 原因关闭。`closeOnInvoke: false` 可让通知在操作成功后继续显示。

## Handle 与更新

```ts
interface NotificationHandle {
  readonly id: number
  readonly closed: boolean
  update(patch: NotificationPatch): boolean
  close(): boolean
}
```

```ts
const overlayService = new AppOverlayService()

const handle = overlayService.notify({
  type: 'info',
  title: '正在同步',
  key: 'item-sync',
  duration: 0,
  dismissible: false,
})

handle.update({
  type: 'success',
  title: '同步完成',
  duration: 5000,
  dismissible: true,
  restartDuration: true,
})
```

`update()` 和 `close()` 只对当前 generation 生效。使用同一 key 再次 `notify()` 会创建新 generation，并让旧 handle 永久失效；框架不会根据标题或正文自动去重。

## 容量与布局

- 新消息位于最上方；
- 最多显示 3 条，超出时完成最旧项；
- 卡片高度根据“仅标题、一行正文、两行正文”自适应，并受主题最小高度和最大高度约束；
- 正文超过两行时省略，不继续增高；不存在的 action 不占用横向或纵向空间；
- 不同高度的 Toast 按各自实际高度堆叠，viewport 较矮时只保留从最新消息开始能够连续完整放下的卡片；
- 卡片会在窄 viewport 中收窄，不绘制到 viewport 外；
- 标题最多一行，正文最多两行，超出部分省略；
- 标题避让关闭图标，正文按实际存在的操作和关闭控件宽度避让，不使用固定大块留白；
- 常见 ASCII 标识符优先整体换行，中文标点不单独留在第二行行首；
- 不存在隐藏等待队列，避免过期反馈稍后重新出现。

## 交互与焦点

可操作 Toast 使用 `nonmodal` overlay：卡片和按钮能够接收 pointer，但不会成为 `PopupManager.current`，Toast 出现时不会主动改变编辑器焦点。

新 `notify()` Toast 使用原位淡入，使视觉位置与 pointer 命中几何在进入动画期间保持一致。旧 `show()` 的纯信息 Toast 保留滑入动画。操作使用轻量文字按钮，关闭使用稳定命中尺寸的 `close` IconButton。

- hover、内部焦点和页面不可见期间暂停自动关闭计时；
- action Promise pending 时按钮禁用，避免重复执行；
- Enter 和 Space 执行当前按钮；
- Escape 只在焦点已进入 Toast 时关闭该 Toast；
- Modal 活跃时 Toast 不接收 pointer；
- Toast 关闭后，在焦点仍属于该 Toast 时恢复先前有效的页面焦点。

## 关闭原因

```ts
type NotificationCloseReason =
  | 'timeout'
  | 'dismiss'
  | 'action'
  | 'programmatic'
  | 'overflow'
  | 'replaced'
  | 'dispose'
```

每条逻辑通知只完成一次。`overflow`、`replaced` 和 `dispose` 立即释放；正常关闭播放退出动画。manager `dispose()` 后不可再次 `show()`、`notify()` 或 `update()`。

## 错误详情

Framework 只接收已经适合展示的字符串，不解析业务 Error，也不自动 stringify 异常。业务层应先整理并脱敏用户文案、错误编号和详情内容。

“查看详情”通常通过 action 打开现有 Modal：action 回调触发 Modal 后立即返回，让当前 Toast 关闭；同栈其他 Toast 保留。Modal 活跃期间其他 Toast 不响应输入，Modal 关闭后恢复先前稳定的页面焦点。不要把堆栈、请求体、token、SQL、服务器路径或条目敏感信息直接传给 Toast。

## AppOverlayService

| API | 说明 |
| --- | --- |
| `showNotification(type, title, message?, duration?)` | 兼容旧入口，返回 number id。 |
| `notify(options)` | 新入口，返回 `NotificationHandle`。 |
| `updateNotification(idOrKey, patch)` | 更新当前通知。 |
| `closeNotification(idOrKey)` | 关闭指定通知并返回是否开始关闭。 |
| `closeNotification()` | 立即关闭全部通知。 |
