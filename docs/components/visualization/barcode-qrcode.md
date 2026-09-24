# Barcode / QRCode 条码二维码

> **通用布局能力**：`RenderBarcode` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；条码绘制使用布局后的实际 `size`，不要直接修改该结果。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderBarcode` 用于在 DirectSurface UI 中绘制一维条码和二维码。它不依赖 DOM 组件，编辑模式可直接绘制到 Canvas；导出或 SVG 输出可使用同一套编码逻辑生成 SVG vnode。

当前支持：

- `code128`
- `code39`
- `ean13`
- `qrcode`

历史拼写 `ena13` 会被兼容归一化为 `ean13`。


## API 总览

```ts
import {
  RenderBarcode,
  barcodeToSvgVNode,
  measureBarcode,
  normalizeBarcodeType,
  paintBarcode,
  type BarcodeMetrics,
  type BarcodeOptions,
  type BarcodeType,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderBarcode` | class | 在 DirectSurface UI 中绘制一维条码或二维码的 render object。 |
| `BarcodeOptions` | type | 条码/二维码配置。 |
| `BarcodeType` | type | 支持的编码类型：code128、code39、ean13、ena13、qrcode。 |
| `BarcodeMetrics` | type | 测量和有效性结果。 |
| `measureBarcode()` | function | 不绘制，仅测量尺寸和校验有效性。 |
| `paintBarcode()` | function | 直接向 CanvasRenderingContext2D 绘制。 |
| `barcodeToSvgVNode()` | function | 生成导出/SVG 场景可用的 vnode。 |
| `normalizeBarcodeType()` | function | 归一化编码类型，未知值回退到 code128。 |

最小装配顺序是：创建 `RenderBarcode({ type, text, width, height })`。业务文档、标签和表单中应明确宽高，避免条码内容变化引起排版跳动。

## 何时使用

使用 Barcode / QRCode：

- 业务腕带、标本标签、申请单号、文档号等一维条码。
- 移动端扫码、URL、文档定位、条目标识等二维码。
- 需要在 Canvas 编辑模式和 SVG/导出模式保持一致编码结果。

不要使用：

- 大量富图形、Logo 二维码、渐变彩色码。当前只支持基础黑白编码绘制。
- 需要交互识别的扫码器组件。`RenderBarcode` 只负责显示。
- 不稳定宽高的表单行内内容。业务文档中条码区域应给定明确宽高，避免排版跳动。

## 最小示例

```ts
const barcode = new RenderBarcode({
  type: 'code128',
  text: 'MR202605130001',
  width: 180,
  height: 56,
  showText: true,
})
```

二维码：

```ts
const qrcode = new RenderBarcode({
  type: 'qrcode',
  text: 'https://example.com/item/123',
  width: 96,
  height: 96,
})
```

更新值：

```ts
const barcode = new RenderBarcode({ type: 'code39', text: 'ABC123' })
barcode.setValue('XYZ789')
```

`setValue()` 会请求布局，因为不同内容可能改变编码有效性和推荐尺寸。

## BarcodeType

```ts
type BarcodeType = 'ean13' | 'ena13' | 'code39' | 'code128' | 'qrcode'
```

| 类型 | 说明 | 内容限制 |
| --- | --- | --- |
| `code128` | 默认类型。自动选择 Code Set B/C。 | ASCII 32-127；空字符串和中文等非 ASCII 内容无效。 |
| `code39` | Code 39。 | `0-9`、`A-Z`、空格、`- . $ / + %`。输入会转大写。 |
| `ean13` | EAN-13 商品码。 | 12 或 13 位数字；13 位时校验位必须正确。 |
| `ena13` | 兼容历史拼写。 | 等同 `ean13`。 |
| `qrcode` | 二维码。 | 使用内置 `qrcodegen` 编码，纠错等级固定为 `MEDIUM`。 |

未知 `type` 会归一化为 `code128`：

```ts
const type = normalizeBarcodeType('unknown')
```

## BarcodeOptions

```ts
interface BarcodeOptions {
  type?: BarcodeType | string
  text?: string
  width?: number
  height?: number
  foreground?: string
  background?: string
  showText?: boolean
  quietZone?: number
  moduleWidth?: number
  barHeight?: number
}
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `type` | `BarcodeType \| string` | `'code128'` | 编码类型。未知值按 `code128` 处理。 |
| `text` | `string` | `''` | 待编码文本。 |
| `width` | `number` | 一维 120，二维码 48 | 绘制宽度。最小归一化为 1。 |
| `height` | `number` | 一维 48，二维码跟随宽度 | 绘制高度。最小归一化为 1。 |
| `foreground` | `string` | `'#000'` | 条/模块颜色。 |
| `background` | `string` | `'#fff'` | 背景颜色。 |
| `showText` | `boolean` | `true` | 一维码是否在底部绘制可读文本。二维码忽略该项。 |
| `quietZone` | `number` | `10` | 一维码左右静区模块数。二维码固定内部 border 为 2 个模块。 |
| `moduleWidth` | `number` | 自适应占位宽度 | 一维码单模块固定宽度，单位为 CSS px。显式设置后不会随占位宽度压缩。二维码忽略该项。 |
| `barHeight` | `number` | 按 `height/showText` 推导 | 一维码条高，单位为 CSS px。二维码忽略该项。 |

`foreground` 和 `background` 当前是 Canvas/SVG 可接受的颜色字符串，不做主题 token 解析。

`moduleWidth`、`barHeight` 显式提供时必须是大于 0 的有限数字。固定模块宽度或条高放不进 `width/height` 时，结果为 `valid: false`，`message` 为 `条码空间不足`，不会压缩或裁剪条纹。

## RenderBarcode 属性和方法

| API | 类型 | 说明 |
| --- | --- | --- |
| `type` | `BarcodeOptions['type']` | 当前类型。 |
| `text` | `string` | 当前编码文本。 |
| `barcodeWidth` | `number \| undefined` | 显式宽度。来自 `options.width`。 |
| `barcodeHeight` | `number \| undefined` | 显式高度。来自 `options.height`。 |
| `foreground` | `string \| undefined` | 前景色。 |
| `background` | `string \| undefined` | 背景色。 |
| `showText` | `boolean \| undefined` | 是否显示一维码文本。 |
| `quietZone` | `number \| undefined` | 一维码静区。 |
| `moduleWidth` | `number \| undefined` | 一维码固定模块宽度。 |
| `barHeight` | `number \| undefined` | 一维码固定条高。 |
| `setValue(text)` | `void` | 更新文本并请求布局。 |
| `debugState()` | `BarcodeMetrics` | 返回当前测量和有效性信息。 |

如果运行时直接改 `type`、`barcodeWidth`、`barcodeHeight` 等属性，应由调用方请求布局或重绘；只有 `setValue()` 内置了布局请求。

## BarcodeMetrics

```ts
interface BarcodeMetrics {
  width: number
  height: number
  valid: boolean
  type: 'ean13' | 'code39' | 'code128' | 'qrcode'
  message?: string
}
```

`measureBarcode(options)` 会返回同样结构，适合在排版前预估尺寸和有效性：

```ts
const metrics = measureBarcode({
  type: 'ean13',
  text: '690123456789',
  width: 120,
  height: 48,
})

if (!metrics.valid) {
  console.warn(metrics.message)
}
```

注意：`BarcodeMetrics` 不暴露内部 `modules`，避免业务依赖编码内部结构。

## Canvas 绘制

底层绘制函数：

```ts
const canvas = document.createElement('canvas')
const ctx = canvas.getContext('2d')!

const metrics = paintBarcode(ctx, 10, 20, {
  type: 'code128',
  text: 'MR-001',
  width: 180,
  height: 48,
})
```

行为：

- 返回 `BarcodeMetrics`。
- 有效内容绘制背景和条/模块。
- 一维码内容无效或空间不足时绘制占位框，并显示 `metrics.message`；二维码继续显示 `QR` 占位。
- 不抛出编码异常；错误信息放在 `metrics.message`。

`RenderBarcode.performPaint()` 会把当前布局尺寸作为 `width/height` 传给底层绘制逻辑，因此 Canvas 绘制结果和实际布局尺寸一致。无效内容的组件内占位框使用当前主题的 Empty 状态配方；直接调用 `paintBarcode()` 或生成 SVG 时仍使用确定性的独立输出颜色，避免导出结果随应用主题变化。

## SVG / 导出输出

导出或 SVG 场景使用：

```ts
const vnode = barcodeToSvgVNode({
  type: 'qrcode',
  text: 'MR-001',
  width: 40,
  height: 40,
})
```

`barcodeToSvgVNode()` 返回 snabbdom 风格 vnode：

- 有效一维码生成 `path`，可选 `text`。
- 有效二维码生成 `path`。
- 无效内容生成占位 `svg`。
- `viewBox`、`width`、`height` 与测量结果一致。

业务编辑器的 Canvas 模式使用 `paintBarcode()`，导出/SVG 模式使用 `barcodeToSvgVNode()`，两者共享编码和测量逻辑。

## 尺寸和排版

默认尺寸：

| 类型 | 默认宽度 | 默认高度 |
| --- | --- | --- |
| 一维码 | `120` | `48` |
| 二维码 | `48` | `width` 或 `height` 推导 |

尺寸规则：

- `width`、`height` 最小归一化为 1。
- 一维码 `showText !== false` 时，底部预留约 14px 绘制可读文本。
- 未设置 `moduleWidth` 时，一维码继续按占位宽度自适应；设置后按固定模块宽度水平居中，不压缩、不裁剪。
- 未设置 `barHeight` 时继续按 `height/showText` 推导条高；设置后会校验条高和文本区能否放入占位高度。
- 二维码使用 `min(width, height)` 计算方形模块区域，并在剩余空间中居中。
- 二维码内部 border 固定为 2 个模块。
- `RenderBarcode.performLayout()` 会先 `measureBarcode()`，再通过父约束 `constrainSize()` 得到最终尺寸。

业务文档中建议显式设置条码/二维码宽高。二维码在文档数据元中通常应采用等比 resize；一维码可以允许宽高分别调整。

## 错误处理

常见无效情况：

| 类型 | 无效原因 |
| --- | --- |
| `ean13` | 不是 12/13 位数字，或 13 位校验位不正确。 |
| `code39` | 包含 Code 39 不支持的字符。 |
| `code128` | 内容为空，或包含 ASCII 32-127 以外字符，例如中文。 |
| `qrcode` | 文本无法由内置 qrcodegen 编码。 |
| 固定一维码 | `moduleWidth/barHeight` 非法，或条码放不进占位区域。 |

示例：

```ts
const canvas = document.createElement('canvas')
const ctx = canvas.getContext('2d')!

const metrics = paintBarcode(ctx, 0, 0, {
  type: 'code128',
  text: '中文',
  width: 90,
  height: 32,
})

if (!metrics.valid) {
  state.error = metrics.message
}
```

无效内容会绘制占位，不会抛异常。这能保证文档编辑器和导出流程不中断，但业务层仍应提前校验关键码值。

## 缓存策略

编码计划内部使用 LRU 缓存：

- 最大缓存 256 个 plan。
- 缓存 key 包含类型、文本、宽高、`showText`、`quietZone`、`moduleWidth` 和 `barHeight`。
- 命中后会更新最近使用顺序。
- 超过上限会删除最旧项。

这个缓存属于组件内部优化，不提供公开清理 API。它不缓存 Canvas、图片或 DOM 资源。

## 性能边界

- 一维码编码和绘制复杂度与文本长度、模块数相关。
- 二维码编码复杂度由 `qrcodegen` 决定，绘制复杂度与二维码模块数相关。
- 大量重复码值会受益于内部 plan 缓存。
- 高频更新 `text` 会触发布局，应避免在动画或输入过程中不断重建条码。
- 大批量导出建议复用测量结果或让文档布局缓存承担重复计算。

## 常见问题

### 为什么 code128 不能显示中文？

Code 128 只支持 ASCII 32-127。中文文本应使用二维码，或先由业务编码成 ASCII 标识。

### Code 128 如何选择 B/C？

- 偶数位纯数字直接使用 Code Set C。
- 1 位纯数字使用 Code Set B。
- 大于等于 3 位的奇数纯数字先用 B 编码首位，再切换到 C；13 位保健号属于该规则。
- 混合 ASCII 内容全部使用 Code Set B。

### 为什么 ean13 输入 12 位也有效？

12 位输入会自动计算第 13 位校验码；13 位输入会校验最后一位。

### 二维码纠错等级能配置吗？

当前固定使用 `qrcodegen.QrCode.Ecc.MEDIUM`，没有公开配置项。

### quietZone 对二维码有效吗？

`quietZone` 只影响一维码左右静区。二维码使用固定 2 模块 border。

### 无效内容会不会抛异常？

不会。测量和绘制都会返回 `valid: false`，并绘制占位提示。业务可以读取 `message` 做校验提示。

### Canvas 和 SVG 会不会不一致？

不会刻意走两套规则。`paintBarcode()` 和 `barcodeToSvgVNode()` 都基于同一个 `createBarcodePlan()` 结果。

## 相关文档

- [ImagePreview 图片预览](./image-preview.md)
- [MarkdownViewer 文档查看器](./markdown-viewer.md)
- 文档编辑器性能和虚拟绘制
