# Text 文本

> **通用布局能力**：`RenderText`、`RenderParagraph` 等可布局文本组件实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；构造器未列出的布局字段在创建后赋值。详见[组件通用布局属性](../common-layout-properties.md)。


DirectSurface UI 的基础文本组件包括 `RenderText` 和 `RenderParagraph`。

- `RenderText`：单行文本，用于标题、标签、状态值、列表行文本、按钮旁说明等。
- `RenderParagraph`：多行段落文本，用于说明文字、帮助提示、详情描述和较长只读文本。

两者都只负责只读绘制，不是输入控件，也不内建浏览器式文字选择和复制。可编辑文本使用 [TextBox](../input/text-box.md)、[TextArea](../input/text-area.md) 或 [PlainTextEditor](../visualization/plain-text-editor.md)。

## API 总览

```ts
import {
  RenderParagraph,
  RenderText,
  type RenderTextFit,
  type RenderTextOptions,
  type RenderTextOverflow,
  type RenderTextRole,
  type RenderTextSize,
  type RenderTextWeight,
} from 'directsurface'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderText` | class | 单行只读文本，支持语义角色、字号、字重、颜色、单行省略和 shrink。 |
| `RenderParagraph` | class | 多行只读段落，按宽度自动换行并保留 `\n`。 |
| `RenderTextOptions` | type | `RenderText` 的角色、字号、字重、颜色和溢出配置。 |
| `RenderTextRole` / `RenderTextSize` / `RenderTextWeight` | type | 文本语义、字号和字重配置。 |
| `RenderTextOverflow` / `RenderTextFit` | type | 单行溢出和缩放策略。 |

最小装配顺序是：短文本使用 `new RenderText(text, options?)`，说明段落使用 `new RenderParagraph(text)`。二者都是只读绘制组件，不提供输入、文本选择或复制能力。

## 何时使用

使用 `RenderText`：

- 一行标题、标签、状态值。
- 列表项主文本和辅助文本。
- 需要 `overflow: 'ellipsis'` 的单行文本。
- 需要 `fit: 'shrink'` 在固定区域内压缩字号的短文本。

使用 `RenderParagraph`：

- 说明段落、帮助文本、空状态描述。
- 需要按容器宽度自动换行的只读文本。
- 文本中包含 `\n`，需要保留段落换行。

不要使用：

- 输入框或可编辑文本。
- 代码编辑器或几十万行文本。
- Markdown 文档渲染。
- 需要逐字符选择和复制的内容区域。

## RenderText 最小示例

```ts
const title = new RenderText('条目列表', {
  role: 'title',
  weight: 'bold',
})
```

```ts
const status = new RenderText('已归档', {
  role: 'secondary',
  size: 'small',
  overflow: 'ellipsis',
})
```

## RenderParagraph 最小示例

```ts
const paragraph = new RenderParagraph(
  'Popover 适合承载轻量说明和快捷操作。内容会按可用宽度自动换行。',
)
```

```ts
const multiLine = new RenderParagraph('第一行说明\n第二行说明')
```

## RenderText 构造参数

`RenderText` 支持两个构造签名：

```ts
const legacyText = new RenderText('旧式颜色参数', { r: 255, g: 255, b: 255, a: 1 })

const optionText = new RenderText('选项参数', {
  role: 'accent',
  size: 'large',
  weight: 'semibold',
})
```

`RenderTextOptions`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `role` | `RenderTextRole` | `'default'` | 语义角色，影响默认颜色和部分字号。 |
| `size` | `RenderTextSize` | `'default'` | 字号。可传 `'small'`、`'large'` 或具体数字。 |
| `weight` | `RenderTextWeight` | `undefined` | 字重。 |
| `color` | `Color` | `undefined` | 颜色覆盖。优先级高于 `role`。 |
| `overflow` | `'visible' \| 'ellipsis'` | `'visible'` | 单行溢出策略。 |
| `fit` | `'none' \| 'shrink'` | `'none'` | 是否在宽度不足时降低字号。 |
| `minSize` | `number` | `max(8, fontSize - 8)` | `fit: 'shrink'` 的最小字号。 |

## RenderTextRole

| 值 | 默认颜色 |
| --- | --- |
| `'default'` | `deriveTextStyle(theme).text`，通常是 `theme.textPrimary`。 |
| `'title'` | `theme.textPrimary`，字号、行高和字重来自 `theme.typography.title*`。 |
| `'secondary'` | `theme.textSecondary`。 |
| `'accent'` | `theme.textAccent`。 |
| `'onAccent'` | `theme.textOnAccent`。 |
| `'disabled'` | `theme.textDisabled`。 |

```ts
const secondary = new RenderText('辅助说明', { role: 'secondary', size: 'small' })
const accent = new RenderText('重点数值', { role: 'accent', weight: 'bold' })
```

## RenderTextSize

| 值 | 行为 |
| --- | --- |
| `'default'` | 使用当前 `role` 的角色字号。 |
| `'small'` | `max(11, roleSize - 1)`。 |
| `'large'` | `roleSize + 2`。 |
| `number` | 直接使用该数字作为字号。 |

`roleSize` 来自当前文字角色：`title` 使用 `theme.typography.titleFontSize`，`secondary` 使用
`secondaryFontSize`，其他角色使用 `bodyFontSize`。因此 `size` 是角色字号的修饰符，而不是重新回到根级
`fontSize`。对应行高和默认字重也来自同一角色的 `*LineHeight` 与 `*FontWeight`；显式数字字号会按角色
lineHeight 比例同步缩放行高。

## RenderTextWeight

| 值 | 绘制字重 |
| --- | --- |
| `'normal'` | `'normal'`。 |
| `'medium'` | `500`。 |
| `'semibold'` | `600`。 |
| `'bold'` | `'bold'`。 |
| `number` | 直接传给 canvas font。 |

```ts
const metric = new RenderText('128', {
  role: 'accent',
  size: 26,
  weight: 'bold',
})
```

## RenderText 属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `text` | `string` | 原始文本。赋值后请求 layout。 |
| `paintText` | `string` | 当前实际绘制文本，只读。可能是省略后的文本。 |
| `paintFontSize` | `number` | 当前实际绘制字号，只读。可能是 shrink 后的字号。 |
| `color` | `Color \| undefined` | 颜色覆盖。 |
| `role` | `RenderTextRole \| undefined` | 文本角色。 |
| `sizeOption` | `RenderTextSize \| undefined` | 字号配置。 |
| `weight` | `RenderTextWeight \| undefined` | 字重配置。 |
| `overflow` | `RenderTextOverflow` | 溢出策略。 |
| `fit` | `RenderTextFit` | 字号适配策略。 |
| `minSize` | `number \| undefined` | shrink 最小字号。 |

```ts
const label = new RenderText('初始文本', { overflow: 'ellipsis' })
label.text = '新的文本'
label.role = 'secondary'
```

修改 `role`、`sizeOption`、`weight`、`overflow`、`fit`、`minSize` 这类公开字段时，当前实现不会自动调用 `markNeedsLayout()`。如果组件已经挂载，建议在状态变化处重建 `RenderText`，或显式触发布局刷新。

## 单行溢出和缩放

`RenderText` 布局流程：

1. 从主题和 `role/size` 计算字号。
2. 如果 `fit === 'shrink'`，从当前字号逐步减小到 `minSize`，直到原始文本能放进 `constraints.maxWidth`。
3. 如果仍放不下，且 `overflow === 'ellipsis'`，用 `...` 省略。
4. `size.width` 为实际绘制文本宽度和 `constraints.maxWidth` 的较小值。
5. `size.height` 为 `paintFontSize * 1.4`。

```ts
const compactValue = new RenderText('12345678901234567890', {
  size: 26,
  minSize: 18,
  fit: 'shrink',
  overflow: 'ellipsis',
})
```

`overflow: 'visible'` 不会主动 clip，也不会省略。是否被裁剪取决于父容器是否设置 clip。

如果 `maxWidth` 小到连 `...` 都放不下，`paintText` 会是空字符串。

## RenderParagraph 构造参数和属性

`RenderParagraph` 构造签名：

```ts
const note = new RenderParagraph('这是说明文字。')
const coloredNote = new RenderParagraph('错误说明', { r: 220, g: 80, b: 80, a: 1 })
```

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `text` | `string` | 段落文本。赋值后请求 layout。 |
| `color` | `Color \| undefined` | 文本颜色。未传时使用主题文本色。 |

`RenderParagraph` 不支持 `role`、`size`、`weight`、`overflow`、`fit`。它始终使用 `deriveTextStyle(theme)` 的 `fontSize`、`fontFamily`、`lineHeight`。

## RenderParagraph 换行规则

`RenderParagraph` 的换行规则：

- 先按 `\n` 分段。
- 空段落会保留为空行。
- 每段按字符逐个测量。
- 当前行加上下一个字符超过 `constraints.maxWidth` 时换行。
- 遇到空格导致换行时，该空格不会成为新行开头。
- 宽度为所有行测量宽度的最大值，但不超过 `maxWidth`。
- 高度为 `max(1, lines.length) * lineHeight`。

```ts
const help = new RenderParagraph(
  '第一段说明较长，会根据容器宽度自动折行。\n第二段保留显式换行。',
)
```

`RenderParagraph` 没有省略号模式。需要单行省略时用 `RenderText`；需要大段 Markdown、标题层级、代码块或表格时用 [MarkdownViewer](../visualization/markdown-viewer.md)。

## 测量和性能

两者都使用 `TextMeasurer.measureWidth()` 做宽度测量。

`RenderText`：

- 单次布局通常只测量一行文本。
- `fit: 'shrink'` 会按字号递减多次测量。
- `overflow: 'ellipsis'` 会逐字符截断测量。

`RenderParagraph`：

- 按字符逐步测量每一行。
- 长段落频繁更新会带来测量成本。
- 不适合承载超大文本或高频编辑内容。

性能建议：

- 列表、表格、树节点中的短文本优先用 `RenderText`。
- 大量行内文本需要省略时，尽量减少文本内容和布局宽度的频繁变化。
- 长文档、日志、代码、JSON 使用 [PlainTextEditor](../visualization/plain-text-editor.md)。
- Markdown 文档使用 [MarkdownViewer](../visualization/markdown-viewer.md)。

## 复制和选择

`RenderText` 和 `RenderParagraph` 都不是 `CopyableSelection`，也不实现拖选文本。

如果调试面板或列表项需要复制文本，应由父组件提供复制能力，例如：

- [ListView](../data/list-view.md) 的 `copyText`。
- ObjectInspector 的节点复制。
- [MarkdownViewer](../visualization/markdown-viewer.md) 的文档选区复制。
- [PlainTextEditor](../visualization/plain-text-editor.md) 的文本选择复制。

不要期望用户像浏览器 DOM 文本一样直接拖选 `RenderText`。

## 与输入和文档组件的区别

| 能力 | `RenderText` | `RenderParagraph` | `RenderTextBox` | `RenderTextArea` | `RenderMarkdownViewer` |
| --- | --- | --- | --- | --- | --- |
| 是否可编辑 | 否 | 否 | 是 | 是 | 否 |
| 行数 | 单行 | 多行 | 单行 | 多行 | 多块文档 |
| 省略号 | 支持 | 不支持 | 输入框内部行为 | 输入框内部行为 | 由块渲染决定 |
| 自动换行 | 不支持 | 支持 | 不支持 | 支持 | 支持 |
| 文字选择复制 | 不支持 | 不支持 | 支持输入选择 | 支持输入选择 | 支持文档选区 |
| 适合场景 | 标签、标题、短值 | 说明段落 | 表单输入 | 多行输入 | 文档阅读 |

## 常见问题

### 为什么修改 role 后界面没变？

`role` 是公开字段，直接修改不会自动 mark layout。建议状态变化时重建 `RenderText`，或在上层触发布局/绘制刷新。

### 为什么 RenderText 没有自动换行？

`RenderText` 是单行组件。需要换行使用 `RenderParagraph`。

### 为什么 RenderParagraph 没有省略号？

`RenderParagraph` 是多行段落组件，当前没有 ellipsis 策略。需要单行省略用 `RenderText`。

### 为什么文本无法用鼠标拖选复制？

DirectSurface UI 的基础文本是 canvas 绘制对象，不是 DOM 文本。复制能力需要由具体组件实现。

### 为什么中文长文本换行看起来是逐字换行？

当前 `RenderParagraph` 的换行算法按字符测量，不做复杂分词、断词和标点禁则。适合说明文本，不适合专业排版。

## 相关文档

- [Button](./button.md)
- [IconButton](./icon-button.md)
- [TextBox](../input/text-box.md)
- [TextArea](../input/text-area.md)
- [ListView](../data/list-view.md)
- [MarkdownViewer](../visualization/markdown-viewer.md)
- [PlainTextEditor](../visualization/plain-text-editor.md)
- [主题与状态](../../themes.md)
- [布局与约束](../../lifecycle.md)
