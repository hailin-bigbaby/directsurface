# ProgressBar 进度条

> **通用布局能力**：`RenderProgressBarOptions` 继承 `RenderBoxOptions`，可直接配置 `width`、`height`、min/max、`margin` 和槽位对齐，也可在创建后赋值。详见[组件通用布局属性](../common-layout-properties.md)。


`RenderProgressBar` 用于展示确定进度或不确定进行中状态。它适合文件上传、导入导出、后台任务、批处理和加载步骤，不负责启动任务、轮询任务状态或取消任务。

## API 总览

```ts
import {
  RenderProgressBar,
  type Color,
} from 'directsurface'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderProgressBar` | class | 胶囊形进度条。支持 `0..1` 确定进度、`-1` 不确定动画、自定义颜色和标签。 |
| `Color` | type | 自定义进度颜色。 |

最小装配顺序是：创建 `RenderProgressBar({ value })`，任务进度变化时设置 `value` 或调用 `setValue()`。传入负数会进入 indeterminate 模式。

## 何时使用

使用 ProgressBar：

- 有明确百分比进度，例如上传、下载、批量处理。
- 任务正在运行但没有准确进度，需要不确定动画。
- 需要在页面、状态栏、卡片或 loading 面板中展示进度。

不要使用：

- 只是表达开关状态，使用 Switch 或 Checkbox。
- 需要阻断整个应用，使用 [Loading](../overlay/loading.md)。
- 只提示任务完成结果，使用 [Notification](../overlay/notification.md)。

## 最小示例

```ts
import { RenderProgressBar } from 'directsurface'

const progress = new RenderProgressBar({
  value: 0.35,
  label: '正在导入',
})

progress.setValue(0.8)
```

## 不确定进度

```ts
import { RenderProgressBar } from 'directsurface'

const progress = new RenderProgressBar({
  value: -1,
  label: '正在连接...',
})

progress.stopIndeterminate(1)
```

`value < 0` 会调用 `startIndeterminate()`，显示滑动光条。任务结束后调用 `stopIndeterminate(finalValue)` 或把 `value` 设置为 `0..1`。

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `value` | `number` | `0` | 进度值。`0..1` 为确定进度，负数为不确定进度。 |
| `label` | `string` | `''` | 居中显示的文本。为空时确定进度会显示百分比。 |
| `color` | `Color` | 主题进度色 | 自定义进度填充色。 |
| `height` | `number` | 主题高度 | 进度条高度。未传时跟随主题。 |

## 属性和方法

| API | 类型 / 返回值 | 说明 |
| --- | --- | --- |
| `value` | `number` | 当前进度。赋负数进入不确定模式；赋 `0..1` 停止不确定动画。 |
| `label` | `string` | 居中文本。为空时显示百分比。 |
| `color` | `Color \| undefined` | 自定义进度色。 |
| `height` | `number` | 当前高度。 |
| `setValue(value)` | `void` | 设置进度，等同于给 `value` 赋值。 |
| `startIndeterminate()` | `void` | 启动不确定动画。 |
| `stopIndeterminate(finalValue?)` | `void` | 停止不确定动画，并设置最终进度。 |
| `dispose()` | `void` | 停止动画 timer 并释放资源。 |

## 布局和绘制

- 宽度填满父级给定的 `constraints.maxWidth`。
- 当父级未给有限宽度时，默认宽度为 200。
- 高度来自构造参数或主题。
- 确定进度会把 `value` 限制到 `0..1`。
- 没有 `label` 时显示四舍五入百分比。
- 不确定进度会启动约 16ms 间隔动画，请在不再使用时调用 `dispose()`。

## 相关组件

- [Loading 加载](../overlay/loading.md)
- [StatusBar 状态栏](../navigation/status-bar.md)
- [Notification 通知](../overlay/notification.md)
