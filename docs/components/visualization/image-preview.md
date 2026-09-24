# ImagePreview 图片预览

> **通用布局能力**：`RenderImagePreviewOptions` 继承 `RenderBoxOptions`，可直接配置尺寸、min/max、`margin` 和槽位对齐；`size` 是同时提供默认宽高的便捷参数，不是可直接改写的布局结果。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderImagePreview` 是轻量图片展示控件，用于头像、缩略图、列表图片、空状态占位和业务卡片中的图片预览。它负责加载 URL 或接收已有 `CanvasImageSource`，并按 `fit` 与 `shape` 绘制到自身矩形内。

它不是完整图片查看器：不内置缩放、拖拽、旋转、裁剪、手势平移、工具栏或大图浏览状态。需要大图查看、标注或缩放交互时，应在页面或弹窗中组合专门的查看器能力，而不是把 `ImagePreview` 当作重型编辑控件。


## API 总览

```ts
import {
  RenderImagePreview,
  type IconName,
  type ImagePreviewDebugState,
  type ImagePreviewFit,
  type ImagePreviewLoadState,
  type ImagePreviewShape,
  type ImagePreviewSource,
} from 'directsurface'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderImagePreview` | class | 轻量图片预览控件，加载 URL 或绘制已有 `CanvasImageSource`。 |
| `ImagePreviewSource` | type | 图片来源：URL、CanvasImageSource、null 或 undefined。 |
| `ImagePreviewFit` | type | 图片适配方式：cover、contain、fill、none。 |
| `ImagePreviewShape` | type | 裁剪形状：rectangle、rounded、circle。 |
| `ImagePreviewLoadState` | type | 加载状态：empty、loading、loaded、error。 |
| `ImagePreviewDebugState` | type | 调试状态，包含来源类型、加载状态、显示 rect 和图片尺寸。 |

最小装配顺序是：传入 `src` 或 `source`，同时给定稳定 `size` 或 `width/height`。列表和表格中应优先使用缩略图和固定尺寸，避免图片加载后改变行高。

## 适用场景

- 用户头像、用户头像、部门图标、条目缩略图。
- 图片附件、报告截图、扫码图片的列表预览。
- 卡片、表格行、树节点详情中的固定尺寸图片。
- 图片为空、加载中或加载失败时显示统一占位。

不适合：

- 影像阅片、报告大图、可拖拽缩放的图片查看。
- 图片裁剪、涂鸦、标注、旋转和保存。
- 大量原图直接铺满列表。列表仍应使用外层虚拟滚动，并尽量提供缩略图资源。

## 基本用法

```ts
const avatar = new RenderImagePreview({
  src: '/assets/avatar.png',
  size: 48,
  shape: 'circle',
  placeholderText: 'HL',
})
```

`src` 是 URL 的便捷写法。也可以使用 `source` 传入 URL、`HTMLCanvasElement`、`HTMLImageElement`、`ImageBitmap` 等 `CanvasImageSource`。

```ts
const canvas = document.createElement('canvas')
const preview = new RenderImagePreview({
  source: canvas,
  width: 160,
  height: 96,
  fit: 'contain',
  shape: 'rounded',
  borderWidth: 1,
})
```

动态切换图片时，使用 `setSource()` 或 `source` 属性。旧 URL 图片的事件回调会被清理，迟到的 `load/error` 不会污染当前图片状态。

```ts
const preview = new RenderImagePreview({
  size: 56,
  placeholderIcon: 'window',
})

preview.setSource('/assets/report-thumb.png')
preview.setSource(null)
```

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `source` | `ImagePreviewSource` | `undefined` | 图片来源。可以是 URL、`CanvasImageSource`、`null` 或 `undefined`。 |
| `src` | `string` | `undefined` | URL 便捷参数。`source` 为 `null/undefined` 时才使用 `src`。 |
| `size` | `number` | `undefined` | 同时设置默认宽高，常用于头像和方形缩略图。 |
| `width` | `number` | `undefined` | 期望宽度。优先级高于 `size`。 |
| `height` | `number` | `undefined` | 期望高度。优先级高于 `size`。 |
| `fit` | `ImagePreviewFit` | `'cover'` | 图片如何放入控件矩形。 |
| `shape` | `ImagePreviewShape` | `'rounded'` | 裁剪和背景形状。 |
| `cornerRadius` | `number` | 自动 | `shape: 'rounded'` 时的圆角半径。未传时按尺寸取不超过 `8` 的自动圆角。 |
| `backgroundColor` | `Color` | 主题空态背景 | 图片未覆盖区域、占位和圆角背景色。 |
| `borderColor` | `Color` | 主题弱边框 | 边框颜色。 |
| `borderWidth` | `number` | `0` | 边框宽度。为 `0` 时不绘制边框。 |
| `placeholderText` | `string` | `undefined` | 占位文本。绘制前两个字符并转大写，优先级高于 `placeholderIcon`。 |
| `placeholderIcon` | `IconName` | `undefined` | 占位图标。没有 `placeholderText` 时使用。 |
| `crossOrigin` | `string` | `undefined` | URL 图片的 `Image.crossOrigin`。会在设置 `src` 前写入。 |

## 类型

`ImagePreviewSource`：

```text
string | CanvasImageSource | null | undefined
```

| 值 | 行为 |
| --- | --- |
| `string` | 作为 URL 异步创建 `Image` 加载。 |
| `CanvasImageSource` | 直接绘制已有图片源，状态立即为 `loaded`。 |
| `null` / `undefined` | 清空图片，状态为 `empty`，绘制占位。 |

`ImagePreviewFit`：

| 值 | 行为 | 典型场景 |
| --- | --- | --- |
| `'cover'` | 保持比例填满控件，可能裁剪图片边缘。 | 头像、封面、统一缩略图。 |
| `'contain'` | 保持比例完整显示，可能留白。 | 报告截图、条码图、不能裁剪的附件图。 |
| `'fill'` | 拉伸到控件宽高，不保持比例。 | 明确允许变形的装饰图。 |
| `'none'` | 按图片原始尺寸居中，不缩放。 | 小图标、像素图预览。 |

`ImagePreviewShape`：

| 值 | 行为 |
| --- | --- |
| `'rectangle'` | 矩形，不使用圆角。 |
| `'rounded'` | 圆角矩形，默认自动圆角。 |
| `'circle'` | 圆形裁剪。应优先使用等宽高尺寸。 |

`ImagePreviewLoadState`：

| 值 | 含义 | 视觉表现 |
| --- | --- | --- |
| `'empty'` | 没有图片来源。 | 绘制占位。 |
| `'loading'` | URL 正在加载。 | 绘制占位。 |
| `'loaded'` | 图片可绘制。 | 绘制图片。 |
| `'error'` | URL 加载失败或运行环境没有 `Image`。 | 绘制占位。 |

## 属性和方法

| API | 类型 | 说明 |
| --- | --- | --- |
| `source` | get/set `ImagePreviewSource` | 当前图片来源。赋值等价于调用 `setSource()`。 |
| `loadState` | get `ImagePreviewLoadState` | 当前加载状态。 |
| `fit` | `ImagePreviewFit` | 图片适配方式。修改后影响后续布局和绘制。 |
| `shape` | `ImagePreviewShape` | 裁剪形状。 |
| `cornerRadius` | `number \| undefined` | 圆角半径。 |
| `width` / `height` | `number \| undefined` | 期望宽高。 |
| `backgroundColor` | `Color \| undefined` | 背景和占位底色。 |
| `borderColor` | `Color \| undefined` | 边框颜色。 |
| `borderWidth` | `number` | 边框宽度。 |
| `placeholderText` | `string \| undefined` | 占位文本。 |
| `placeholderIcon` | `IconName \| undefined` | 占位图标。 |
| `crossOrigin` | `string \| undefined` | 后续 URL 加载使用的跨域设置。 |
| `setSource(source)` | `void` | 切换图片来源，并清理旧 URL 图片回调。 |
| `debugState()` | `ImagePreviewDebugState` | 返回 source 类型、加载状态、fit、shape、显示矩形和图片尺寸。 |
| `dispose()` | `void` | 清理待加载图片回调并释放渲染对象。 |

`debugState()` 返回结构：

```text
{
  sourceType: 'none' | 'url' | 'canvas'
  loadState: 'empty' | 'loading' | 'loaded' | 'error'
  fit: 'cover' | 'contain' | 'fill' | 'none'
  shape: 'rectangle' | 'rounded' | 'circle'
  displayRect: { x: number; y: number; width: number; height: number }
  imageSize: Size | null
}
```

## 尺寸和布局规则

`RenderImagePreview` 是 `RenderBox`，最终尺寸受父布局约束影响。

- 同时传 `width` 和 `height`：控件优先使用这两个尺寸。
- 传 `size`：相当于同时给默认 `width` 和 `height`，适合固定方形。
- 不传尺寸：默认使用 `40 x 40`。
- 只传 `width` 或只传 `height`：图片自然尺寸未知前，另一边先按默认值计算；URL 图片加载完成并拿到自然尺寸后，可能按图片比例重新布局。
- `shape: 'circle'` 不会强制控件变成正方形，只会按当前矩形内的最大圆绘制。头像应显式给等宽高。

列表、表格、树节点和虚拟滚动场景中，建议总是给固定 `size` 或固定 `width/height`，避免 URL 图片加载完成后触发行高变化。

## 绘制顺序

绘制顺序固定为：

1. 背景。圆形绘制圆形背景，矩形/圆角绘制对应矩形背景。
2. 图片或占位。图片会被裁剪到当前 `shape`。
3. 边框。`borderWidth > 0` 时绘制。

`empty`、`loading`、`error` 都使用占位绘制。当前没有内置 loading spinner 或错误图标；如果业务需要区分加载中和失败，可以通过外层状态、不同 `placeholderText` 或自定义组合控件表达。

## URL 加载和生命周期

URL 图片通过浏览器 `Image` 对象异步加载：

- `crossOrigin` 会在设置 URL 前写入。
- 每次切换 source 都会递增加载 token，旧图片迟到的 `load/error` 会被忽略。
- 切换 source 或 `dispose()` 时会清空旧 `Image.onload/onerror`。
- 控件不维护全局图片缓存；浏览器自身缓存是否命中由浏览器和服务端缓存头决定。
- 传入 `CanvasImageSource` 时，控件只引用并绘制它，不拥有外部 canvas、image、video 或 bitmap 的生命周期。

## 交互边界

`ImagePreview` 自身没有点击、键盘、焦点、拖拽或选择行为。需要点击打开大图、右键菜单、复制图片地址、删除附件时，应该用外层容器或按钮组合。

```ts
const preview = new RenderImagePreview({
  src: '/assets/report-thumb.png',
  width: 120,
  height: 80,
  fit: 'contain',
})
```

上例只负责绘制缩略图；“点击打开报告图片”应由包裹它的行、卡片或按钮处理。

## 性能建议

- 大列表中使用固定尺寸，避免图片加载后反复布局。
- 给列表或表格使用外层虚拟滚动，不要一次创建和绘制大量图片控件。
- 尽量提供缩略图 URL，而不是把原始大图交给每个预览控件缩放。
- 对频繁切换的图片，业务层应控制 source 更新频率，避免每帧创建新的 URL 图片。
- `CanvasImageSource` 由业务层复用时，要明确其生命周期；控件销毁不会释放外部资源。

## 常见问题

### 为什么传了 `src` 但显示空白？

URL 图片加载失败时会进入 `error` 状态并显示占位。可以通过 `debugState().loadState` 确认。跨域图片如果后续需要读取像素或导出，应正确设置 `crossOrigin` 和服务端 CORS。

### 为什么图片加载后控件尺寸变了？

通常是只设置了 `width` 或只设置了 `height`。图片加载前自然尺寸未知，另一边会用默认值；加载后会按自然比例重新计算。列表中建议同时设置宽高或使用 `size`。

### `source` 和 `src` 同时传时谁生效？

构造时使用 `source ?? src ?? null`。也就是说 `source` 不是 `null/undefined` 时优先生效；否则使用 `src`。运行时清空图片请调用 `setSource(null)` 或设置 `source = null`。

### 可以做缩放拖拽吗？

不可以。`RenderImagePreview` 的职责是轻量预览和占位绘制。缩放拖拽应由专门图片查看器或页面组合实现。

## 相关文档

- [Barcode / QRCode 条码二维码](./barcode-qrcode.md)
- [DataGrid 数据表格](../data/data-grid.md)
- [ListView 列表](../data/list-view.md)
- [Card / Section / PageHeader](../basic/card-section-page-header.md)
- [Popup 基础设施](../overlay/popup.md)
