# PlainTextEditor 大文本编辑器

> **通用布局能力**：`RenderPlainTextEditor` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；文本 viewport、gutter 和内容 padding 属于编辑器内部布局。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderPlainTextEditor` 是面向纯文本、日志、JSON、脚本和配置文件的高性能文本编辑器。它不提供富文本能力，但支持语法着色、行号、JSON 折叠、缩进引导线、搜索命中、当前命中高亮、选区、复制、中文输入、超大文本粘贴、横向滚动和纵向虚拟滚动。

## 何时使用

- 需要查看或编辑几十万行级别的纯文本。
- 需要 JSON、JavaScript、Shell 等轻量语法着色。
- 需要代码类文本的行号、缩进引导线、折叠和搜索。
- 普通 [TextArea](../input/text-area.md) 承载不了大文件、长行或大量粘贴。
- 业务需要一个可控的文本模型，用于外部搜索、跳转、替换或持久化。

## 何时不要使用

- 需要富文本排版、表格、图片、数据元、文档留痕时，不要用 PlainTextEditor 模拟，应使用对应业务编辑器。
- 只需要单行输入，使用 [TextBox](../input/text-box.md)。
- 只需要多行备注输入且数据很小，使用 [TextArea](../input/text-area.md)。
- 需要 Markdown 排版预览，使用 [MarkdownViewer](./markdown-viewer.md)。

## API 总览

```ts
import {
  FoldingModel,
  LineArrayTextDocument,
  PlainTextEditorController,
  RenderPlainTextEditor,
  findJsonFoldRange,
  javascriptTextTokenizer,
  jsonTextTokenizer,
  logTextTokenizer,
  plainTextTokenizer,
  shellTextTokenizer,
  tokenizerForLanguage,
  type FoldRange,
  type PlainTextEditorChange,
  type PlainTextEditorChangeListener,
  type PlainTextEditorControllerOptions,
  type PlainTextFindOptions,
  type PlainTextSearchMatch,
  type PlainTextSearchOptions,
  type RenderPlainTextEditorOptions,
  type SurfaceAppearance,
  type TextDocumentModel,
  type TextEditResult,
  type TextPosition,
  type TextRange,
  type TextToken,
  type TextTokenizer,
} from 'directsurface'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderPlainTextEditor` | class | 高性能纯文本编辑器 render object。 |
| `PlainTextEditorController` | class | 外部控制器，管理文档、语言、光标、选区、搜索和折叠。 |
| `LineArrayTextDocument` | class | 默认文本模型，按行数组管理大文本。 |
| `FoldingModel` | class | 折叠状态模型。 |
| `RenderPlainTextEditorOptions` / `PlainTextEditorControllerOptions` | type | editor 和 controller 构造参数。 |
| `TextDocumentModel` / `TextPosition` / `TextRange` / `TextEditResult` | type | 文档模型、位置、范围和编辑结果。 |
| `PlainTextEditorChange` / `PlainTextEditorChangeListener` / `PlainTextSearchOptions` / `PlainTextFindOptions` / `PlainTextSearchMatch` | type | 变更与搜索相关类型。 |
| tokenizer 和 folding 函数 | function | 内置语言分词器和 JSON 折叠范围查找。 |

最小装配顺序是：简单场景直接创建 `RenderPlainTextEditor({ value, language })`；复杂场景先创建 `PlainTextEditorController`，再传给 editor，并在页面释放时明确处理 controller 所有权。

## 最小示例

```ts
import { RenderPlainTextEditor } from 'directsurface'

const jsonEditor = new RenderPlainTextEditor({
  value: '{\n  "name": "directsurface"\n}',
  language: 'json',
  showLineNumbers: true,
  folding: true,
  tabSize: 4,
  onChange: value => {
    console.log(value)
  },
})
```


## Controller 示例

复杂场景建议显式创建 `PlainTextEditorController`。这样业务可以控制文档、语言、光标、选区、搜索、折叠和外部跳转。

```ts
import {
  PlainTextEditorController,
  RenderPlainTextEditor,
} from 'directsurface'

const logController = new PlainTextEditorController({
  value: 'INFO service started',
  language: 'log',
  onDocumentChange: change => {
    console.log(change.revision)
  },
})

const logEditor = new RenderPlainTextEditor({
  controller: logController,
  readonly: false,
  showLineNumbers: true,
})

logController.setLanguage('log')
logEditor.goToLine(1)
```

## 构造参数

`new RenderPlainTextEditor(options?: RenderPlainTextEditorOptions)`

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `controller` | `PlainTextEditorController` | 自动创建 | 外部控制器。传入后 editor 不拥有 controller。 |
| `value` | `string` | `''` | 初始文本。未传 controller 时用于创建默认 controller。 |
| `language` | `string` | `'plain'` | 初始语言。支持 plain、json/jsonc、javascript/js/jsx、shell/sh/bash/zsh、log/logs/logfile。 |
| `readonly` | `boolean` | `false` | 是否只读。只读时不进入输入编辑，但仍可滚动、搜索、选区和复制。 |
| `showLineNumbers` | `boolean` | `true` | 是否显示行号 gutter。 |
| `folding` | `boolean` | `true` | 是否显示折叠标记并允许折叠。当前折叠规则主要面向 JSON。 |
| `showIndentGuides` | `boolean` | `true` | 是否显示缩进引导线。 |
| `tabSize` | `number` | `4` | Tab 视觉宽度，最小为 1。 |
| `fontSize` | `number` | 主题字体大小 | 编辑器字体大小。 |
| `fontFamily` | `string` | 主题字体 | 编辑器字体。 |
| `lineHeight` | `number` | `fontSize * 1.55` 附近 | 行高。 |
| `appearance` | `SurfaceAppearance` | `'framed'` | 表面边界：`framed` 绘制外边框并按主题圆角裁剪，`flush` 用于已有容器边界的嵌入式编辑区。 |
| `onChange` | `(value: string) => void` | `undefined` | 文本内容变化后触发。会读取整份文本，大文件中谨慎使用。 |
| `onDocumentChange` | `(change) => void` | `undefined` | 文档变化后触发，提供 revision、document 和局部编辑结果。大文件优先使用。 |

如果同时传 `controller` 和 `onChange` / `onDocumentChange`，构造函数会把回调写到传入的 controller 上。

## Controller 构造参数

`new PlainTextEditorController(options?: PlainTextEditorControllerOptions)`

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `value` | `string` | `''` | 初始文本。未传 `document` 时生效。 |
| `document` | `TextDocumentModel` | `new LineArrayTextDocument(value)` | 自定义文档模型。 |
| `language` | `string` | `'plain'` | 初始语言。 |
| `onChange` | `(value: string) => void` | `undefined` | 内容变化后触发，参数是完整文本。 |
| `onDocumentChange` | `(change) => void` | `undefined` | 内容变化后触发，参数包含增量编辑结果。 |

## 文档模型

`TextDocumentModel` 是 PlainTextEditor 的底层文本模型接口：

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `lineCount` | `number` | 行数。 |
| `version` | `number` | 文档版本。 |
| `getLine(line)` | `string` | 获取某行文本。 |
| `getLineVersion(line)` | `number` | 获取某行版本，用于 token 和宽度缓存。 |
| `getLineLength(line)` | `number` | 获取某行长度。 |
| `getText(range?)` | `string` | 获取全文或指定范围文本。 |
| `replaceRange(range, text)` | `TextEditResult` | 替换范围并返回编辑结果。 |

默认实现是 `LineArrayTextDocument`：

- 按行数组管理文本。
- 自动把 `\r\n` / `\r` 规范化为 `\n`。
- 维护文档版本和行版本。
- `replaceRange()` 使用数组切片拼接，避免通过递归处理大文本。

`TextPosition`：

| 字段 | 说明 |
| --- | --- |
| `line` | 0 基逻辑行号。 |
| `column` | 0 基列号。 |

`TextRange`：

| 字段 | 说明 |
| --- | --- |
| `start` | 起始位置。 |
| `end` | 结束位置。 |

`TextEditResult`：

| 字段 | 说明 |
| --- | --- |
| `oldRange` | 被替换的旧范围。 |
| `newRange` | 替换后的新范围。 |
| `firstChangedLine` | 第一行变化的逻辑行号。 |
| `oldLineCount` | 旧范围覆盖行数。 |
| `newLineCount` | 新文本行数。 |

## Controller 属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `document` | `TextDocumentModel` | 只读文档模型。 |
| `folding` | `FoldingModel` | 只读折叠模型。 |
| `onChange` | 函数或 `undefined` | 可读写完整文本变化回调。 |
| `onDocumentChange` | 函数或 `undefined` | 可读写文档变化回调。 |
| `subscribeChange(listener)` | `() => void` | 订阅 controller 修订（包括文档、光标、选区和折叠），返回幂等的取消订阅函数；不会覆盖 `onDocumentChange`。 |
| `revision` | `number` | 只读修订号。光标、选区、折叠变化也会增加 revision。 |
| `value` | `string` | 获取或替换全文。 |
| `cursor` | `TextPosition` | 只读当前光标。 |
| `anchor` | `TextPosition` | 只读选区锚点。 |
| `selection` | `TextRange` | 只读规范化选区。 |
| `hasSelection` | `boolean` | 是否存在非空选区。 |
| `language` | `string` | 只读当前 tokenizer 语言 id。 |

## Editor 属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `controller` | `PlainTextEditorController` | 只读控制器。 |
| `ownsController` | `boolean` | 只读。是否由 editor 创建 controller。 |
| `lineWidthCache` | `Map<number, ...>` | 只读行宽缓存。调试用途，不建议业务直接依赖。 |
| `readonly` | `boolean` | 是否只读。动态设为 `true` 会停止拖选输入态、清理 IME composition，并保留滚动、搜索、定位、选区和复制能力。 |
| `appearance` | `SurfaceAppearance` | 可读写外观模式。切换只请求重绘，不改变布局尺寸。 |
| `showLineNumbers` | `boolean` | 是否显示行号。 |
| `folding` | `boolean` | 是否启用折叠 UI。 |
| `showIndentGuides` | `boolean` | 是否显示缩进引导线。 |
| `tabSize` | `number` | Tab 宽度。 |
| `fontSize` | `number \| undefined` | 字体大小。 |
| `fontFamily` | `string \| undefined` | 字体。 |
| `lineHeight` | `number \| undefined` | 行高。 |
| `value` | `string` | 获取或替换全文。 |
| `scrollX` | `number` | 横向滚动偏移。 |
| `scrollY` | `number` | 纵向滚动偏移。 |
| `isFocused` | `boolean` | 只读焦点状态。 |
| `searchQuery` | `string` | 只读当前搜索文本。 |
| `activeSearchMatch` | `PlainTextSearchMatch \| null` | 只读当前搜索命中。返回副本。 |

## 横向范围与大文档

- 编辑器在布局阶段维护分块行宽索引，绘制只读取范围，不会在 paint 中修改滚动状态。
- 首屏之外的长行也会纳入横向范围；最长行被删除或缩短后，范围会随之收缩。
- 折叠后的隐藏行不参与当前横向范围，展开后重新纳入。IME composition 宽度只作为临时范围。
- 小文档（包括超长单行）使用精确行宽；超大文档先按字形宽度建立保守上界，再精确测量最宽候选行。尚未精测的行继续保留上界，因此可能暂时留出少量额外空白，但不会让长行末尾不可达。
- 折叠范围按宽度索引块跳过完整隐藏区块，只在折叠边界所在块逐行判断，避免大范围折叠重新退化为全量扫描。

## Controller 方法

### 文档和语言

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `setValue(value)` | `void` | 替换全文，清空光标选区、折叠和 token 缓存。 |
| `setLanguage(language)` | `void` | 切换内置 tokenizer。 |
| `setTokenizer(tokenizer)` | `void` | 设置自定义 tokenizer。 |

### 光标和选区

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `setCursor(position, extendSelection?)` | `void` | 设置光标。`extendSelection=true` 时保留 anchor。 |
| `setSelection(anchor, focus)` | `void` | 设置选区。 |
| `selectAll()` | `void` | 全选。 |
| `moveCursorHorizontal(delta, extendSelection?)` | `void` | 横向移动光标。 |
| `moveCursorVertical(delta, extendSelection?)` | `void` | 纵向移动光标。 |

光标移动遵循编辑器通用合同：无 Shift 且存在非空选区时，左/上折叠到选区起点，右/下折叠到选区终点，不再额外移动；有 Shift 时保留 anchor 并移动 focus。横向移动和前后删除按 grapheme cluster 处理，不会拆开 Emoji、组合音标、肤色修饰或 ZWJ 序列。外部 API 的 `TextPosition.column` 仍保持 UTF-16 索引，兼容语言服务位置模型。

### 编辑

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `replaceRange(range, text)` | `void` | 替换指定范围。 |
| `insertText(text)` | `void` | 在光标处插入文本；有选区时替换选区。 |
| `replaceCurrentLine(value, cursorColumn)` | `void` | 替换当前行，主要服务输入会话。 |
| `deleteSelection()` | `boolean` | 删除选区，返回是否删除。 |
| `insertNewline()` | `void` | 插入换行。 |
| `deleteBackward()` | `void` | 向前删除。 |
| `deleteForward()` | `void` | 向后删除。 |

### 折叠和可视行

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `toggleFold(line)` | `boolean` | 切换某逻辑行折叠。当前主要识别 JSON 的 `{}` / `[]` 范围。 |
| `expandToLine(line)` | `boolean` | 展开包含目标逻辑行的折叠范围。 |
| `getVisibleLineCount()` | `number` | 获取折叠后的可视行数。 |
| `toLogicalLine(visibleLine)` | `number` | 可视行转逻辑行。 |
| `toVisibleLine(logicalLine)` | `number \| null` | 逻辑行转可视行；被折叠隐藏时返回 `null`。 |

### Token 和搜索

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `getLineTokens(line)` | `readonly TextToken[]` | 获取某行 token。按行版本缓存。 |
| `findNext(query, options?)` | `PlainTextSearchMatch \| null` | 从指定位置向前或向后查找。 |
| `findMatchesInLine(line, query, options?)` | `PlainTextSearchMatch[]` | 查找某行内的匹配。可限制列范围。 |

## Editor 方法

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `focusIn()` | `void` | 通知获得焦点。通常由焦点系统调用。 |
| `focusOut()` | `void` | 通知失去焦点。 |
| `getCopyText()` | `string \| null` | 返回当前选区文本。没有选区时返回 null，用于接入统一复制系统。 |
| `debugState()` | `{ paintedLineCount; visibleLineCount; totalLineCount }` | 获取绘制行数、可视行数和总行数。 |
| `setSearchQuery(query, options?)` | `void` | 设置搜索文本。`options.caseSensitive` 控制大小写敏感。 |
| `findNextSearchMatch(options?)` | `PlainTextSearchMatch \| null` | 激活下一处或上一处搜索结果，并尽量滚动到可视区域。 |
| `goToLine(lineNumber, column?)` | `TextPosition` | 跳转到 1 基行号和 0 基列号。 |
| `revealPosition(position, options?)` | `void` | 展开到目标行、设置光标或选区并滚动到可视区域。 |
| `dispose()` | `void` | 释放焦点注册、输入会话、controller 和缓存。只有 `ownsController=true` 时释放 controller。 |

`setSearchQuery()` 的 options：

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `caseSensitive` | `boolean` | 沿用上次值 | 是否大小写敏感。 |

`findNextSearchMatch()` 的 options：

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `backwards` | `boolean` | `false` | 是否查找上一处。 |

`revealPosition()` 的 options：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `selectionEnd` | `TextPosition` | 如果传入，则设置从 `position` 到 `selectionEnd` 的选区。 |

## 搜索示例

```ts
import { PlainTextEditorController, RenderPlainTextEditor } from 'directsurface'

const searchController = new PlainTextEditorController({
  value: 'alpha\nbeta\nalpha',
})

const searchEditor = new RenderPlainTextEditor({
  controller: searchController,
})

searchEditor.setSearchQuery('alpha')
const firstMatch = searchEditor.findNextSearchMatch()
const secondMatch = searchEditor.findNextSearchMatch()

console.log(firstMatch?.start.line, secondMatch?.start.line)
```

## 自定义 tokenizer

`TextTokenizer`：

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `languageId` | `string` | 语言 id。 |
| `tokenizeLine(input)` | `TokenizeLineResult` | 返回当前行 token。 |

`TextToken`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `startColumn` | `number` | token 起始列。 |
| `endColumn` | `number` | token 结束列。 |
| `type` | `string` | token 类型。内置绘制会按类型映射颜色。 |

示例：

```ts
import {
  PlainTextEditorController,
  type TextTokenizer,
} from 'directsurface'

const todoTokenizer: TextTokenizer = {
  languageId: 'todo',
  tokenizeLine: input => ({
    tokens: input.line.includes('TODO')
      ? [{ startColumn: 0, endColumn: input.line.length, type: 'keyword' }]
      : [],
  }),
}

const todoController = new PlainTextEditorController({ value: 'TODO: review docs' })
todoController.setTokenizer(todoTokenizer)
```

## 折叠模型

`FoldingModel` 管理折叠范围：

| 方法/属性 | 说明 |
| --- | --- |
| `collapsedRanges` | 当前折叠范围。 |
| `effectiveCollapsedRanges` | 当前实际影响可视行映射的最外层折叠范围。 |
| `clear()` | 清空折叠。 |
| `isCollapsedStart(line)` | 判断某行是否是折叠起点。 |
| `isHidden(line)` | 判断某逻辑行是否被折叠隐藏。 |
| `visibleLineCount(document)` | 获取可视行数。 |
| `toLogicalLine(visibleLine, document)` | 可视行转逻辑行。 |
| `toVisibleLine(logicalLine)` | 逻辑行转可视行。 |
| `toggle(line, document)` | 切换折叠。 |
| `expandToLine(line)` | 展开包含目标行的范围。 |
| `invalidateFrom(line)` | 文档从某行变化后，清理受影响折叠。 |

当前内置 `findJsonFoldRange()` 解析 JSON 风格 `{}` 和 `[]`，会跳过字符串、JSONC 行注释和块注释中的括号，并拒绝不匹配的括号对。普通折叠外层范围不会删除内部折叠状态；展开外层后，内部范围恢复为折叠状态。可视行数量和逻辑/可视行映射只计算 `effectiveCollapsedRanges`，不会重复扣除嵌套范围。其他语言需要业务自定义或后续扩展折叠规则。

## 交互行为

- 单击定位光标。
- 拖拽选择文本；指针停在文本视口边缘或移出边缘时会持续自动滚动并扩展选区，pointer up/cancel、隐藏或释放组件时停止。
- 双击 JSON key 或字符串 value 时，优先选中完整 token。
- `Ctrl/Cmd + A` 全选。
- `Backspace` / `Delete` 删除选区或字符。
- `Enter` 插入换行。
- `Tab` 插入空格，数量由 `tabSize` 决定。
- 方向键移动光标；按住 Shift 扩展选区。
- 鼠标滚轮滚动纵向内容；Shift + 滚轮滚动横向内容。
- 横向滚动条用于长行。
- 折叠标记显示在 gutter 与文本之间，点击可折叠或展开。
- 折叠后的 `...` 占位符代表隐藏区间：点击可选中隐藏内容，拖选到占位符时选区会延伸到折叠末尾；上下方向键按可视行跨过整个折叠块。
- 左右方向键把折叠区间视为一个原子视觉单元；折叠包含当前 caret 的区间时，caret 会归一到可见折叠起点，不会停在隐藏逻辑行。
- 搜索命中使用普通高亮，当前命中使用更强高亮和边框。
- 文档变化会清空旧的 active search match；大小写不敏感搜索会把 Unicode 规范化结果映射回原始 UTF-16 范围，返回 range 始终能从原文取出 `match.text`。
- 只读模式下不处理文本输入，但仍允许滚动、搜索、定位、选区和复制。
- `visible=false` 时会退出焦点顺序，释放焦点，并清理 hover、拖选和滚动条拖拽等临时状态。

## 中文输入和粘贴

PlainTextEditor 接入统一文本输入会话：

- 中文 composition update 只进入临时布局和绘制状态，不修改文档模型。
- composition end 才会用最终文本替换 composition 起始范围并提交到文档模型。
- 有选区时输入会先替换选区。
- 动态只读会同步设置共享输入器的原生 `readOnly` 状态；恢复可编辑时重新从 controller 同步当前行，避免只读期间的浏览器输入泄漏回文档。空剪贴板粘贴保持文档、选区和历史不变。
- 粘贴事件会读取剪贴板文本并直接写入文档模型，避免把几十 MB 文本落入隐藏输入控件。
- 行模型会把不同换行符规范化为 `\n`。
- 已加载文本中的真实 `\t` 会按当前位置展开到下一个 `tabSize` tab stop；绘制、宽度测量、鼠标命中和横向范围使用同一规则。

大文本下不建议通过 `onChange` 每次保存完整字符串。优先使用 `onDocumentChange` 的 `result` 判断变化范围。

## 虚拟滚动和性能边界

PlainTextEditor 的性能策略：

- 文档按行存储。
- 固定行高计算虚拟范围。
- 绘制只处理可视行和 overscan 行。
- token 按行版本缓存。
- 行宽按行版本缓存。
- 长行测量会限制精确测量长度。
- 粘贴和替换使用范围编辑结果更新缓存。
- 当前行输入只记录最小局部差异，避免长行每次输入都把整行写入撤销历史。
- caret 使用 transient paint，避免每次闪烁都触发完整布局。

开发注意：

- 不要在高频输入时同步读取 `editor.value` 或 `controller.value`。
- 不要在 `getLineTokens()` 或自定义 tokenizer 中做跨全文扫描。
- 大文件搜索会跨行扫描，业务层可在输入搜索词时做防抖。
- 关闭页面时调用 `editor.dispose()`；如果 controller 是外部创建的，页面还应自己管理 controller 生命周期。
- 如果业务实现自定义 `TextDocumentModel`，必须保证 `replaceRange()` 不递归处理大文本。

## 状态和调试

`debugState()` 可用于确认当前是否真的只绘制可视行：

| 字段 | 说明 |
| --- | --- |
| `paintedLineCount` | 最近一次绘制的行数。 |
| `visibleLineCount` | 折叠后的可视行数。 |
| `totalLineCount` | 文档总逻辑行数。 |
| `decorationCount` | 当前 range decoration 数量。 |

在 40 万行文本中，`paintedLineCount` 应接近视窗行数加 overscan，而不是总行数。

## 常见组合

- PlainTextEditor + SearchBox：上方 [SearchBox](../input/text-box.md) 输入搜索词，调用 `setSearchQuery()` 和 `findNextSearchMatch()`。
- PlainTextEditor + CommandToolbar：用 [CommandToolbar](../command/command-toolbar.md) 放置格式化、查找、跳转、只读切换等命令。
- PlainTextEditor + lineTokenProvider/decorations：为更高层编辑器提供语义 token 和诊断装饰。
- PlainTextEditor + ObjectInspector：左侧对象树，右侧展示选中对象 JSON 文本。
- PlainTextEditor + Runtime Diagnostics：通过 [Runtime Diagnostics](../../lifecycle.md) 观察绘制行数和事件耗时。

## 相关组件

- [TextArea 多行文本](../input/text-area.md)：小文本输入。
- [TextBox 文本输入](../input/text-box.md)：单行输入。
- [MarkdownViewer](./markdown-viewer.md)：Markdown 渲染和文档阅读。
- [CodeEditor](./code-editor.md)：基于语言服务的代码/DSL 编辑器。
- [TreeView](../data/tree-view.md)：文件树、对象树或目录树。
- [CommandToolbar](../command/command-toolbar.md)：编辑器工具栏。
- [Runtime Diagnostics](../../lifecycle.md)：性能诊断。
