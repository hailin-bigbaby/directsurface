# Upload

`RenderUpload` 用于选择本地文件，并在 Canvas 界面中展示待上传、上传中、成功、失败和取消状态。组件负责文件选择、校验、进度和重试交互；HTTP 地址、鉴权、分片、业务返回值和服务端错误由业务提供的 `upload` 回调处理。

文件选择必须借助浏览器原生 `input[type=file]`。该 DOM 节点只在打开文件选择器时临时创建，不参与页面布局和组件绘制。

## 基本使用

```ts
import { RenderUpload } from 'ds-ui'

const uploadAttachment = async (
  _file: File,
  options: {
    signal: AbortSignal
    onProgress: (progress: number) => void
  },
): Promise<{ fileId: string }> => {
  if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError')
  options.onProgress(1)
  return { fileId: 'file-1' }
}

const upload = new RenderUpload<{ fileId: string }>({
  accept: '.pdf,image/*',
  multiple: true,
  maxFiles: 5,
  maxFileSize: 20 * 1024 * 1024,
  upload: async (file, { signal, reportProgress }) => {
    const result = await uploadAttachment(file, {
      signal,
      onProgress: reportProgress,
    })
    return { fileId: result.fileId }
  },
  onReject: rejections => {
    console.log(rejections)
  },
  onError: error => {
    console.error('文件选择或校验失败', error)
  },
})
```

`autoUpload` 默认为 `true`。如果希望业务先确认文件，再统一开始：

```ts
const uploadAttachment = async (_file: File): Promise<{ fileId: string }> => ({
  fileId: 'file-1',
})

const upload = new RenderUpload({
  multiple: true,
  autoUpload: false,
  upload: uploadAttachment,
})

await upload.start()
```

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `accept` | `string` | `''` | 原生文件类型过滤规则，例如 `.json,image/*`。组件仍会在文件写入列表前再次校验。 |
| `multiple` | `boolean` | `false` | 是否允许一次选择多个文件。 |
| `maxFiles` | `number` | 单文件为 `1`，多文件不限制 | 文件列表允许保留的最大数量。 |
| `maxFileSize` | `number` | `undefined` | 单个文件最大字节数。 |
| `autoUpload` | `boolean` | `true` | 选择成功后是否自动调用 `upload`。 |
| `disabled` | `boolean` | `false` | 禁止用户选择和全部行内操作；`selectFiles()`、`addFiles()`、`start()`、`retry()` 也不启动新任务。业务仍可调用 `cancel()`、`remove()`、`clear()` 做清理。 |
| `selectLabel` | `string` | `'选择文件'` | 文件选择按钮文字。 |
| `upload` | `UploadHandler<TResult>` | `undefined` | 业务上传函数。未提供时，文件保持 `ready` 状态。 |
| `filePicker` | `FilePickerBridge` | 浏览器默认实现 | 注入文件选择桥，主要用于宿主适配和测试。 |
| `validateFile` | `(file) => string \| null \| undefined` | `undefined` | 自定义文件校验。返回文字时拒绝该文件。 |
| `onChange` | `(items) => void` | `undefined` | 文件列表、进度或状态变化回调。每次收到的数组和条目外壳都是只读浅快照。 |
| `onReject` | `(rejections) => void` | `undefined` | 文件类型、大小、数量或业务校验不通过时调用。 |
| `onError` | `(error: unknown) => void` | `undefined` | 通过组件按钮执行文件选择或业务校验时发生异常后调用。上传 Promise 失败仍写入对应条目的 `error` 状态。 |

一批文件会先完成无副作用预检，再统一写入任务列表。`validateFile` 抛出异常时，本批文件不会留下半加入的条目、行控件、`onChange` 或 `onReject` 通知；业务直接调用 `addFiles()` 时异常同步抛出，通过组件按钮选择时由 `onError` 接收。

如果 `validateFile` 中发生重入操作，例如加入或移除其他文件、调整 `maxFiles`，这些操作会作为独立变更保留。外层批次在提交前会按最新文件列表和约束重新计算剩余容量；校验过程中组件被禁用或释放时，外层批次直接取消。

## 上传回调

```ts
type UploadHandler<TResult> = (
  file: File,
  context: {
    signal: AbortSignal
    reportProgress(progress: number): void
  },
) => Promise<TResult>
```

- `signal` 在用户取消、移除文件或组件释放时触发。
- `reportProgress()` 接受 `0` 到 `1`；越界值会被截断。
- Promise 完成后文件进入 `success`。
- Promise 失败后文件进入 `error`，可以点击重试。
- 返回结果保存在对应 `UploadFileItem.result` 中。

## 文件状态

| 状态 | 说明 |
| --- | --- |
| `ready` | 已选择，尚未开始上传。 |
| `uploading` | 正在执行业务上传函数。 |
| `success` | 上传完成，`result` 可用。 |
| `error` | 上传失败，保留错误信息并允许重试。 |
| `cancelled` | 用户或业务取消，允许重新上传。 |

`UploadFileItem` 保留原始 `File`，不会自动读取为 Base64。大文件上传不应先通过 `FileReader` 完整载入内存。

`items` 属性和 `onChange` 参数都返回当前状态的浅快照。数组和 `UploadFileItem` 外壳与组件内部状态隔离，但原始 `File` 和泛型 `result` 载荷保持同一对象引用，应当按不可变载荷使用。修改条目外壳不会反向改写组件；需要改变任务状态时，应调用 `start()`、`retry()`、`cancel()`、`remove()` 或 `clear()`。

## 方法

| 方法 | 说明 |
| --- | --- |
| `selectFiles()` | 打开原生文件选择器并把有效文件加入列表。业务直接调用时应处理文件选择或校验异常产生的 Promise rejection；组件按钮触发的异常交给 `onError`。 |
| `addFiles(files)` | 直接加入已有 `File` 对象，仍执行数量、类型、大小和业务校验；返回本次接收条目的快照。 |
| `start(id?)` | 上传一个文件；省略 id 时只上传 `ready`、`error` 或 `cancelled` 状态的文件。 |
| `retry(id)` | 重试失败或已取消的文件。 |
| `cancel(id)` | 取消正在上传的文件。 |
| `remove(id)` | 移除文件，同时取消其未完成请求。 |
| `clear()` | 原子地取消并清空全部文件，只触发一次空列表 `onChange`。 |
| `debugState()` | 返回适合测试和诊断的文件名、状态、进度和错误摘要。 |

取消、移除、清空或释放组件后，旧上传 Promise 即使稍后完成，也不会再覆盖当前条目或重复触发状态通知。`dispose()` 会中止未完成任务并释放内部 `File`、结果、回调和行控件引用。

## 当前边界

- 首版使用点击选择文件，不支持拖放。框架后续建立统一的 drag/drop 事件路由后再增加拖放。
- 组件不内置 HTTP 客户端、请求地址、鉴权、分片或断点续传。
- `accept` 只提供客户端筛选和提示，服务端仍必须检查真实文件内容和权限。
- 组件不会把 `File` 序列化进页面状态；页面关闭或刷新后的续传由业务实现。

## 相关组件

- [ButtonEdit](button-edit.md)
- [ProgressBar](../basic/progress-bar.md)
- [Loading](../overlay/loading.md)
