# MarkdownViewer

> **通用布局能力**：`RenderMarkdownViewer` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；文档内容 `padding` 是 Viewer 自己的内部排版属性，不代表通用 `RenderPanel.padding`。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderMarkdownViewer` 用于在 DirectSurface UI 内渲染只读 Markdown 文档。它负责 Markdown 解析、文档排版、滚动、目录、搜索、链接、图片、代码块复制、表格横向滚动、文本拖选和复制。

这个组件适合“开发文档中心”“帮助文档”“业务说明”“只读 Markdown 预览”。它不是富文本编辑器，也不是通用 HTML 渲染器。


## API 总览

```ts
import {
  RenderMarkdownViewer,
  collectMarkdownDocumentHeadings,
  createMarkdownHeadingSlug,
  markdownBlockToPlainText,
  markdownBlocksToPlainText,
  markdownDocumentToPlainText,
  markdownInlinesToPlainText,
  parseInlines,
  parseMarkdown,
  type MarkdownBlock,
  type MarkdownDocument,
  type MarkdownDocumentHeadingItem,
  type MarkdownFlavor,
  type MarkdownHeadingOutlineItem,
  type MarkdownInline,
  type MarkdownLinkClickEvent,
  type MarkdownParseOptions,
  type MarkdownSearchResult,
  type MarkdownViewerDebugState,
  type MarkdownViewerAppearance,
  type MarkdownViewerShrinkWrap,
  type MarkdownViewerViewportState,
  type RenderMarkdownViewerOptions,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderMarkdownViewer` | class | 只读 Markdown 阅读器，支持解析、布局、滚动、搜索、目录、链接、图片、表格和复制。 |
| `RenderMarkdownViewerOptions` | type | viewer 构造参数。 |
| `parseMarkdown()` / `parseInlines()` | function | 在业务层提前解析 Markdown 文档或行内节点。 |
| `collectMarkdownDocumentHeadings()` / `createMarkdownHeadingSlug()` | function | 生成目录和锚点。 |
| `markdownDocumentToPlainText()` 等纯文本函数 | function | 将 AST 转为纯文本，用于搜索、复制或索引。 |
| `MarkdownDocument` / `MarkdownBlock` / `MarkdownInline` | type | Markdown AST 类型。 |
| `MarkdownLinkClickEvent` / `MarkdownViewerViewportState` | type | 链接点击和 viewport 回调 payload。 |

最小装配顺序是：传入 `markdown` 字符串，或先用 `parseMarkdown()` 得到 `MarkdownDocument` 再传给 `RenderMarkdownViewer`。需要切换文档时，替换 `markdown/document` 后按业务需要调用 `scrollToTop()`。

## 何时使用

- 需要在应用内阅读 Markdown 文档。
- 需要搜索 Markdown 正文并跳转到匹配项。
- 需要根据标题生成目录树。
- 需要支持链接点击、文档内锚点跳转和图片路径解析。
- 需要复制拖选文本，或复制代码块内容。
- 需要在 DirectSurface UI 内统一主题、滚动条、焦点和剪贴板行为。

不适合：

- 需要编辑 Markdown 源码，使用 [PlainTextEditor](./plain-text-editor.md)。
- 需要富文本输入和排版编辑，使用业务编辑器或文档编辑器。
- 需要执行 HTML、CSS 或脚本。MarkdownViewer 只把 HTML 节点作为文本内容绘制，不执行 HTML。
- 需要完整浏览器排版能力。MarkdownViewer 是 Canvas 渲染组件，只实现框架内需要的 Markdown 阅读能力。

## 最小示例

```ts
const markdownViewer = new RenderMarkdownViewer({
  markdown: '# 标题\n\n正文内容',
})
```

## 已支持的 Markdown

| 类型 | 支持情况 | 说明 |
| --- | --- | --- |
| 标题 | 支持 | `#` 到 `######`，用于目录和锚点。 |
| 段落 | 支持 | 自动按可用宽度换行。 |
| 强调 | 支持 | `*em*`、`_em_`。 |
| 加粗 | 支持 | `**strong**`、`__strong__`。 |
| 删除线 | GFM 支持 | `~~delete~~`。 |
| 行内代码 | 支持 | 绘制代码背景。 |
| 代码块 | 支持 | 围栏代码块，支持语言标签、语法着色、横向滚动和复制按钮。 |
| 链接 | 支持 | 普通链接、引用链接、自动链接。 |
| 图片 | 支持 | 异步加载图片，可通过 `resolveImageSrc` 转换路径。 |
| 引用 | 支持 | 绘制左侧引用线。 |
| 有序列表 | 支持 | 支持起始编号。 |
| 无序列表 | 支持 | 使用圆点 marker。 |
| 任务列表 | GFM 支持 | `- [ ]`、`- [x]`，只读绘制。 |
| 分割线 | 支持 | 绘制水平线。 |
| 表格 | GFM 支持 | 支持列宽计算、对齐信息、横向滚动。 |
| HTML 块/行内 HTML | 文本化支持 | 不解释、不执行，只按文本绘制。 |

`parseOptions.flavor` 默认为 `'gfm'`。如果设置为 `'commonmark'`，GFM 表格、任务列表、删除线等扩展能力会受限。

## 构造参数

`RenderMarkdownViewerOptions`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `markdown` | `string` | `''` | Markdown 源字符串。未传 `document` 时会用 `parseMarkdown(markdown, parseOptions)` 解析。 |
| `document` | `MarkdownDocument` | `undefined` | 已解析的 Markdown AST。适合外部缓存解析结果，或对 AST 做预处理后再渲染。 |
| `parseOptions` | `MarkdownParseOptions` | `{}` | 解析选项。只在内部解析 `markdown` 时使用。 |
| `padding` | `number` | `14` | 文档内容内边距。影响正文、代码块、表格和滚动区域。 |
| `appearance` | `'framed' \| 'embedded'` | `'framed'` | `embedded` 不绘制 Viewer 外层背景、边框和圆角，供 HoverCard 等已有外壳的容器复用。 |
| `shrinkWrap` | `'none' \| 'height' \| 'both'` | `'none'` | 是否按文档自然高度或自然宽高收缩；长内容仍受父 constraints 限制并滚动。 |
| `minHeight` | `number` | `undefined` | 父布局给无限高度时使用的最小高度。 |
| `resolveImageSrc` | `(src: string) => string` | `undefined` | 图片路径转换函数。可把相对路径转换为 `public` 路径、静态资源 URL 或业务资源 URL。 |
| `onLinkClick` | `(event: MarkdownLinkClickEvent) => void` | `undefined` | 点击非本地锚点链接时触发。本地 `#anchor` 会优先由 viewer 自己滚动处理。 |
| `onViewportChange` | `(state: MarkdownViewerViewportState) => void` | `undefined` | 垂直滚动位置变化时触发，用于同步目录当前项、滚动位置状态或调试信息。 |

如果同时传入 `markdown` 和 `document`，viewer 使用 `document` 作为渲染数据，`markdown` 只保存在 `markdown` 属性里，不会再次解析。

## 解析选项

`MarkdownParseOptions`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `flavor` | `'commonmark' \| 'gfm'` | `'gfm'` | Markdown 方言。`gfm` 启用表格、任务列表、删除线等扩展语法。 |

```ts
const commonmarkDoc = parseMarkdown('# Title\n\n~~text~~', {
  flavor: 'commonmark',
})

const commonmarkViewer = new RenderMarkdownViewer({
  document: commonmarkDoc,
})
```

## Markdown 数据结构

`MarkdownDocument` 是解析后的根对象：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | `'document'` | 固定值。 |
| `flavor` | `MarkdownFlavor` | 本次解析使用的方言。 |
| `blocks` | `MarkdownBlock[]` | 文档块节点。 |
| `references` | `Record<string, MarkdownLinkReference>` | 引用链接定义，key 为小写 label。 |

`MarkdownBlock`：

| 类型 | 关键字段 | 说明 |
| --- | --- | --- |
| `MarkdownHeadingBlock` | `depth`、`children`、`raw` | 标题。`raw` 用于生成标题锚点。 |
| `MarkdownParagraphBlock` | `children`、`raw` | 普通段落。 |
| `MarkdownBlockquoteBlock` | `children` | 引用块，内部继续包含块节点。 |
| `MarkdownListBlock` | `ordered`、`start`、`loose`、`items` | 有序或无序列表。 |
| `MarkdownListItem` | `checked`、`children` | 列表项。`checked` 为任务列表状态。 |
| `MarkdownCodeBlock` | `language`、`meta`、`text`、`copyText?` | 围栏代码块。`copyText` 可与可见预览分离；解析器生成的普通代码块默认复制 `text`。 |
| `MarkdownThematicBreakBlock` | 无 | 分割线。 |
| `MarkdownTableBlock` | `alignments`、`header`、`rows` | GFM 表格。 |
| `MarkdownHtmlBlock` | `text` | HTML 块，作为文本绘制。 |

`MarkdownInline`：

| 类型 | 关键字段 | 说明 |
| --- | --- | --- |
| `MarkdownTextInline` | `text` | 普通文本。 |
| `MarkdownSoftBreakInline` | 无 | 软换行，转换为空格。 |
| `MarkdownHardBreakInline` | 无 | 硬换行。 |
| `MarkdownCodeInline` | `text` | 行内代码。 |
| `MarkdownEmphasisInline` | `children` | 斜体语义。 |
| `MarkdownStrongInline` | `children` | 加粗语义。 |
| `MarkdownDeleteInline` | `children` | 删除线。 |
| `MarkdownLinkInline` | `href`、`title`、`children` | 链接。 |
| `MarkdownImageInline` | `src`、`title`、`alt` | 图片。 |
| `MarkdownHtmlInline` | `text` | 行内 HTML，作为文本绘制。 |

## 解析工具

这些函数从 `ds-ui` 包入口导出，可在业务层提前解析、生成目录、做纯文本索引或测试 Markdown 结果。

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `parseMarkdown` | `(markdown: string, options?: MarkdownParseOptions) => MarkdownDocument` | 解析完整 Markdown 文档。 |
| `parseInlines` | `(text: string, options?: MarkdownParseOptions) => MarkdownInline[]` | 解析一段行内 Markdown。 |
| `markdownDocumentToPlainText` | `(document: MarkdownDocument) => string` | 将完整文档转换为纯文本。 |
| `markdownBlocksToPlainText` | `(blocks: readonly MarkdownBlock[]) => string` | 将块节点数组转换为纯文本。 |
| `markdownBlockToPlainText` | `(block: MarkdownBlock) => string` | 将单个块节点转换为纯文本。 |
| `markdownInlinesToPlainText` | `(inlines: readonly MarkdownInline[]) => string` | 将行内节点转换为纯文本。 |
| `collectMarkdownDocumentHeadings` | `(document: MarkdownDocument) => MarkdownDocumentHeadingItem[]` | 从 AST 收集标题，不依赖 viewer layout。 |
| `createMarkdownHeadingSlug` | `(title: string) => string` | 按 viewer 规则把标题文本转换为锚点 id。 |

```ts
const parsedMarkdown = parseMarkdown('# API\n\n正文', { flavor: 'gfm' })
const headingItems = collectMarkdownDocumentHeadings(parsedMarkdown)
const plainText = markdownDocumentToPlainText(parsedMarkdown)

const parsedViewer = new RenderMarkdownViewer({
  document: parsedMarkdown,
})

if (headingItems.length > 0) {
  parsedViewer.scrollToHeading(headingItems[0]!.id)
}

console.log(plainText)
```

## 属性

| 属性 | 类型 | 可写 | 说明 |
| --- | --- | --- | --- |
| `markdown` | `string` | 是 | Markdown 源字符串。赋新值会重新解析并替换文档，清空选区、代码块横向滚动、表格横向滚动、图片缓存和当前搜索命中。 |
| `document` | `MarkdownDocument` | 是 | 当前 AST。赋新值会替换文档并清空上述交互状态。 |
| `scrollY` | `number` | 否 | 当前垂直滚动位置。 |
| `isFocused` | `boolean` | 否 | 当前 viewer 是否拥有焦点。 |
| `searchQuery` | `string` | 是 | 搜索关键字。赋值会清空 `activeSearchResultId` 并重绘搜索背景。 |
| `activeSearchResultId` | `string` | 是 | 当前搜索命中的 id。用于把当前命中绘制成更强的高亮。 |
| `onLinkClick` | `(event: MarkdownLinkClickEvent) => void` | 是 | 链接点击回调。 |
| `onViewportChange` | `(state: MarkdownViewerViewportState) => void` | 是 | 滚动变化回调。 |
| `resolveImageSrc` | `(src: string) => string` | 是 | 图片路径解析函数。 |

替换 `markdown` 或 `document` 后，viewer 默认不会强制把滚动条复位到顶部。打开第二份文档时，如果业务需要顶部开始阅读，应显式调用 `scrollToTop()`。

```ts
const switchableMarkdownViewer = new RenderMarkdownViewer({
  markdown: '# 第一份文档',
})

function openMarkdownDocument(markdown: string): void {
  switchableMarkdownViewer.markdown = markdown
  switchableMarkdownViewer.scrollToTop()
}
```

## 方法

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `getHeadingOutline()` | `MarkdownHeadingOutlineItem[]` | 返回当前布局后的标题目录，包含 `id`、`title`、`depth`、`y`、`height`。返回值是拷贝，外部修改不会影响 viewer。 |
| `getActiveHeading()` | `MarkdownHeadingOutlineItem \| null` | 根据当前 `scrollY` 返回正在阅读的标题。 |
| `getViewportState()` | `MarkdownViewerViewportState` | 返回当前滚动位置和当前标题。 |
| `scrollToHeading(id)` | `boolean` | 滚动到标题 id。支持传入带 `#` 或不带 `#` 的 id。layout 尚未生成时会记录 pending anchor，后续 layout 后解析。 |
| `scrollToAnchor(anchor)` | `boolean` | `scrollToHeading` 的语义别名。 |
| `getSearchResults(query?)` | `MarkdownSearchResult[]` | 返回搜索结果。默认使用 `searchQuery`。 |
| `getPlainText()` | `string` | 返回完整 Markdown 文档纯文本。 |
| `getCopyText()` | `string` | 有拖选文本时返回选区文本，否则返回完整文档纯文本。 |
| `scrollToTop()` | `void` | 滚动到文档顶部。 |
| `scrollToSearchResult(target)` | `boolean` | 滚动到搜索结果。`target` 可以是结果下标或结果 id。 |
| `debugState()` | `MarkdownViewerDebugState` | 返回布局、绘制、搜索、图片、代码块和表格滚动调试信息。 |
| `dispose()` | `void` | 注销焦点、清理图片缓存、清空回调和交互状态。 |

`scrollToSearchResult()` 的滚动策略是“尽可能让目标结果进入视窗”。如果目标已经完整可见，不会强行把它顶到视口顶部。

`RenderMarkdownViewer` 是只读展示组件，不提供 `disabled` 或 `readonly` 属性。业务需要禁止阅读入口时应隐藏或移除外层入口；viewer 本身保持滚动、链接、搜索、选区和复制能力。设置 `visible=false` 时，viewer 会退出焦点顺序，释放焦点，并清理 hover、拖拽滚动条、代码块横向拖拽和表格横向拖拽等临时状态。

```ts
const searchableMarkdownViewer = new RenderMarkdownViewer({
  markdown: '# 搜索\n\n第一段\n\n第二段',
})

searchableMarkdownViewer.searchQuery = '段'
const markdownResults = searchableMarkdownViewer.getSearchResults()

if (markdownResults.length > 0) {
  searchableMarkdownViewer.scrollToSearchResult(0)
}
```

## 事件类型

`MarkdownLinkClickEvent`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `href` | `string` | 链接地址。 |
| `title` | `string \| undefined` | Markdown 链接 title。 |

`MarkdownViewerViewportState`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `scrollY` | `number` | 垂直滚动位置。 |
| `activeHeading` | `MarkdownHeadingOutlineItem \| null` | 当前阅读标题。 |

```ts
const linkedMarkdownViewer = new RenderMarkdownViewer({
  markdown: '[外部链接](https://example.com)\n\n# A\n\n[本页锚点](#a)',
  onLinkClick: event => {
    console.log(event.href)
  },
  onViewportChange: state => {
    console.log(state.scrollY, state.activeHeading?.title)
  },
})
```

## 标题和目录

标题 id 的生成规则：

- 去掉前后空白。
- 转小写。
- 去掉 HTML 标签。
- 保留 Unicode 字母、数字、空白、`_`、`-`。
- 空白合并为 `-`。
- 重复标题追加 `-2`、`-3`。
- 空标题使用 `heading`。

`collectMarkdownDocumentHeadings(document)` 只遍历 AST，不包含 layout 坐标。`viewer.getHeadingOutline()` 依赖 layout，包含 `y` 和 `height`，适合目录点击和当前标题同步。

```ts
const outlineMarkdownViewer = new RenderMarkdownViewer({
  markdown: '# 介绍\n\n## API\n\n正文',
  onViewportChange: state => {
    const activeTitle = state.activeHeading?.title ?? ''
    console.log(activeTitle)
  },
})

const outlineItems = outlineMarkdownViewer.getHeadingOutline()
const apiHeading = outlineItems.find(item => item.title === 'API')
if (apiHeading) outlineMarkdownViewer.scrollToHeading(apiHeading.id)
```

## 搜索

搜索规则：

- 搜索关键字会 `trim()` 并转小写。
- 匹配是大小写不敏感的文本包含匹配。
- 结果以“可搜索行”为单位，返回行号、列范围、完整行文本、片段、y 坐标和高度。
- 当前命中由 `activeSearchResultId` 控制。
- 普通命中和当前命中使用不同颜色，便于区分“所有结果”和“当前结果”。

`MarkdownSearchResult`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 结果 id，格式为内部稳定字符串。 |
| `blockIndex` | `number` | 布局块下标。 |
| `lineIndex` | `number` | 块内行下标。 |
| `startColumn` | `number` | 匹配起始列。 |
| `endColumn` | `number` | 匹配结束列。 |
| `text` | `string` | 命中文本。 |
| `lineText` | `string` | 所在行完整文本。 |
| `snippet` | `string` | 搜索结果列表使用的片段。 |
| `y` | `number` | 命中所在行文档坐标。 |
| `height` | `number` | 命中所在行高度。 |

```ts
const searchMarkdownViewer = new RenderMarkdownViewer({
  markdown: '# API\n\nAPI 文档说明\n\n第二个 API',
})

function searchMarkdownNext(): void {
  const results = searchMarkdownViewer.getSearchResults()
  if (results.length === 0) return
  const activeIndex = Math.max(0, results.findIndex(item => item.id === searchMarkdownViewer.activeSearchResultId))
  const nextIndex = (activeIndex + 1) % results.length
  searchMarkdownViewer.scrollToSearchResult(results[nextIndex]!.id)
}

searchMarkdownViewer.searchQuery = 'api'
searchMarkdownNext()
```

## 链接

链接点击行为：

- `href` 以 `#` 开头时，viewer 先按本地锚点处理。
- 本地锚点能找到标题时，内部滚动并停止。
- 本地锚点找不到，或链接不是本地锚点时，触发 `onLinkClick`。
- `onLinkClick` 不负责本地锚点的默认滚动逻辑。

```ts
const linkMarkdownViewer = new RenderMarkdownViewer({
  markdown: '[配置](settings.md)\n\n[当前页](#配置)',
  onLinkClick: event => {
    openModule(event.href)
  },
})
```

## 图片

图片加载行为：

- 初次 layout 时根据图片 Markdown 创建图片缓存项。
- 图片加载中使用默认占位尺寸。
- 图片加载成功后根据自然尺寸重新 layout。
- 图片加载失败时绘制错误占位。
- 替换文档或 dispose 时会清理图片缓存和回调。

`resolveImageSrc` 只负责路径转换，不负责加载。常见用法是把相对文档路径转换为业务项目自己的 `/docs/**` 静态资源路径。

```ts
const imageMarkdownViewer = new RenderMarkdownViewer({
  markdown: '![架构图](images/architecture.png)',
  resolveImageSrc: src => `/docs/${src.startsWith('./') ? src.slice(2) : src}`,
})
```

## 代码块

代码块能力：

- 围栏语言标签会显示在代码块顶部。
- 支持 `json`、`jsonc`、`javascript`、`typescript`、`js`、`ts`、`shell`、`bash`、`sh`、`zsh` 的基础语法着色。
- 其他语言回退为纯文本 token。
- 内容超过可视宽度时显示代码块内部横向滚动条。
- hover 代码块时显示复制按钮，点击复制代码块原始文本。
- `debugState().codeBlocks` 可查看每个代码块的横向滚动状态。

代码块的复制按钮复制的是代码块 `text`，不复制围栏标记和语言标签。

## 表格

表格能力：

- GFM 模式下解析表格。
- 列宽根据单元格内容估算。
- 内容超过 viewer 可用宽度时显示表格内部横向滚动条。
- 表头使用更强的文本权重。
- 支持列对齐数据，当前绘制以统一单元格布局为主。
- 支持表格单元格内拖选文本和跨单元格拖选。
- `debugState().tables` 可查看每个表格的横向滚动状态、内容宽度、视口宽度和列宽。

## 选区和复制

MarkdownViewer 实现 `CopyableSelection`：

- 鼠标拖选普通文本、代码块文本和表格单元格文本。
- 双击选择单词或连续中文、数字、英文片段。
- 三击选择当前行。
- `getCopyText()` 在有选区时返回选区文本。
- 没有选区时，`getCopyText()` 返回完整文档纯文本。
- 代码块 hover 的复制按钮只复制该代码块文本，不依赖当前选区。

复制行为由框架的 `ClipboardController` 统一接入，不需要业务页面直接访问浏览器剪贴板 API。

## 交互

| 操作 | 行为 |
| --- | --- |
| 鼠标滚轮 | 垂直滚动文档。 |
| 拖动右侧滚动条 | 垂直滚动文档。 |
| 在代码块上 `Shift + wheel` 或横向滚轮 | 横向滚动代码块。 |
| 拖动代码块横向滚动条 | 横向滚动代码块。 |
| 在表格上 `Shift + wheel` 或横向滚轮 | 横向滚动表格。 |
| 拖动表格横向滚动条 | 横向滚动表格。 |
| 点击本地锚点链接 | 滚动到对应标题。 |
| 点击外部链接 | 触发 `onLinkClick`。 |
| 拖选文本 | 建立选区并绘制选中背景。 |
| 双击文本 | 选择当前词。 |
| 三击文本 | 选择当前行。 |

## 调试状态

`MarkdownViewerDebugState`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `blockCount` | `number` | AST 顶层块数量。 |
| `layoutBlockCount` | `number` | layout 后的块数量。列表 marker、引用 marker 等也会形成布局块。 |
| `paintedBlockCount` | `number` | 最近一次 paint 实际绘制的块数量。用于确认虚拟绘制效果。 |
| `contentHeight` | `number` | 文档内容总高度。 |
| `scrollY` | `number` | 当前垂直滚动位置。 |
| `linkCount` | `number` | 最近一次 paint 收集的链接命中区域数量。 |
| `searchResultCount` | `number` | 当前 `searchQuery` 的结果数量。 |
| `activeSearchResultId` | `string` | 当前搜索命中 id。 |
| `imageCount` | `number` | 当前图片缓存数量。 |
| `codeBlocks` | `MarkdownViewerCodeBlockDebugState[]` | 代码块横向滚动和尺寸信息。 |
| `tables` | `MarkdownViewerTableDebugState[]` | 表格横向滚动、尺寸和列宽信息。 |

`MarkdownViewerCodeBlockDebugState`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `language` | `string \| undefined` | 代码块语言。 |
| `scrollX` | `number` | 横向滚动位置。 |
| `contentWidth` | `number` | 代码内容宽度。 |
| `viewportWidth` | `number` | 代码块可视宽度。 |

`MarkdownViewerTableDebugState`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `scrollX` | `number` | 横向滚动位置。 |
| `contentWidth` | `number` | 表格内容宽度。 |
| `viewportWidth` | `number` | 表格可视宽度。 |
| `columns` | `number[]` | 每列宽度。 |

```ts
const debugMarkdownViewer = new RenderMarkdownViewer({
  markdown: [
    '# Debug',
    '',
    '~~~json',
    '{"ok":true}',
    '~~~',
  ].join('\n'),
})

const markdownDebugState = debugMarkdownViewer.debugState()
console.log(markdownDebugState.blockCount, markdownDebugState.paintedBlockCount)
```

## 文档中心组合

典型文档中心结构：

```text
DockPanel
  left:
    CollapsiblePanelGroup
      文档树 TreeView
      本文目录 TreeView
      搜索结果 TreeView
  fill:
    MarkdownViewer
```

组合规则：

- 文档树只负责选择文档和加载 Markdown 字符串。
- Markdown 字符串从哪里来不属于 `RenderMarkdownViewer` 职责，可来自 `fetch`、本地缓存、数据库或打包资源。
- 打开新文档后，如果希望从顶部开始阅读，业务调用 `scrollToTop()`。
- 目录树可以来自 `viewer.getHeadingOutline()`，需要 layout 坐标。
- 如果只需要提前展示目录，可以对 `parseMarkdown()` 的结果调用 `collectMarkdownDocumentHeadings()`。
- 搜索框维护 `viewer.searchQuery`，搜索结果树读取 `viewer.getSearchResults()`。
- 搜索结果点击调用 `viewer.scrollToSearchResult(result.id)`。
- 外部链接通过 `onLinkClick` 交给业务路由或浏览器打开。

```ts
const docCenterViewer = new RenderMarkdownViewer({
  markdown: '# Loading',
  resolveImageSrc: src => `/docs/${src}`,
})

async function loadMarkdownDocument(path: string): Promise<void> {
  const response = await fetch(path)
  const markdown = await response.text()
  docCenterViewer.markdown = markdown
  docCenterViewer.scrollToTop()
}
```

## 性能说明

- MarkdownViewer 会在 layout 阶段把 AST 转成布局块。
- paint 阶段只绘制当前视窗附近的布局块，`debugState().paintedBlockCount` 可用于验证。
- 搜索基于已布局的可搜索行，适合文档中心和帮助文档，不适合几十万行源码级搜索。
- 大代码块和宽表格使用局部横向滚动，不扩大整个文档宽度。
- 图片尺寸加载成功后会触发一次重新 layout，这是正常行为。
- 替换文档会清理图片缓存，避免旧文档图片继续持有引用。

大文本或几十万行日志应使用 [PlainTextEditor](./plain-text-editor.md)，不要用 MarkdownViewer 承担源码编辑器或日志查看器职责。

## 生命周期

`dispose()` 会处理：

- 从 `FocusManager` 注销。
- 终止代码块、表格和文档滚动条拖动状态。
- 清理图片缓存中的 `onload`、`onerror` 回调。
- 清空 `onLinkClick`、`onViewportChange`、`resolveImageSrc`。
- 调用父类 `dispose()`。

如果业务在页面关闭时持有 viewer 引用，应随页面一起释放，避免图片、回调和文档 AST 被业务对象继续引用。

## 常见问题

### 打开第二份文档后为什么滚动条没有自动回到顶部？

这是设计行为。`markdown` 属性只是“更新内容”，viewer 无法判断这是原文档刷新还是新文档载入。需要顶部开始阅读时，业务在赋值后调用 `scrollToTop()`。

### 为什么 Markdown 字符串来源不由组件管理？

组件只负责解析和渲染。字符串可以来自网络、数据库、内存对象或本地文件。把资源加载放进 viewer 会让 UI 组件承担业务数据职责，反而降低复用性。

### 为什么 HTML 不渲染成真正 DOM？

DirectSurface UI 是 Canvas 渲染框架，MarkdownViewer 不执行 HTML，避免脚本、样式和浏览器布局能力进入组件内部。需要富 HTML 时应使用浏览器 DOM 容器，不应混进 Canvas 组件。

### 为什么 `getHeadingOutline()` 初次可能为空？

目录坐标来自 layout。刚创建对象但尚未进入布局前，`getHeadingOutline()` 还没有 layout 结果。可以在 layout 后读取，或先使用 `collectMarkdownDocumentHeadings(parseMarkdown(markdown))` 获取不带坐标的标题列表。

### 为什么搜索结果点击后没有总是顶到视口顶部？

搜索跳转会优先保证目标可见。如果目标已经在视口内，不会强行调整滚动条，这样连续“下一处/上一处”时阅读位置更稳定。

## 相关组件

- [PlainTextEditor](./plain-text-editor.md)：Markdown 源码、大文本、JSON、日志等编辑或查看。
- [TreeView](../data/tree-view.md)：文档树、目录树、搜索结果树。
- [SearchBox](../input/text-box.md)：搜索输入框。
- `RenderCollapsiblePanelGroup`：文档中心左侧折叠分组容器。
- [DockPanel](../../layouts.md)：文档中心左右布局。
- [ScrollView](../../layouts.md)：通用滚动容器。MarkdownViewer 自己管理文档滚动，不需要再包一层 ScrollView。
