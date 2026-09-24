# CodeEditor 代码编辑器

> **通用布局能力**：`RenderCodeEditor` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；编辑器内容 padding、行高和 gutter 是内部编辑规格。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderCodeEditor` 是基于 [PlainTextEditor 大文本编辑器](./plain-text-editor.md) 的代码编辑器外壳。它复用 PlainTextEditor 的文本模型、光标、选区、滚动、行号、IME 和虚拟绘制能力，并增加通用语言服务接入点。

核心原则：

```text
CodeEditor 管输入、选择、绘制和应用 edit。
LanguageAdapter 管语言语义、诊断、语义 token、补全、hover 和格式化。
```

CodeEditor 不内置业务语言语义，也不硬编码字段、关键字或操作符。业务 DSL 应通过 `CodeEditorLanguageAdapter` 接入。


## 何时使用

- 需要在业务系统内编辑 DSL、脚本、表达式、配置或规则。
- 需要展示诊断波浪线、语义高亮、格式化和后续补全/hover。
- 需要和 DirectSurface UI 的主题、焦点、Overlay、DevTools、布局检查保持一致。
- 已有独立语言服务，不希望编辑器直接依赖 parser/semantic/compiler 内部实现。

## 何时不要使用

- 只编辑普通备注，使用 [TextArea](../input/text-area.md)。
- 只展示日志或大文本，使用 [PlainTextEditor](./plain-text-editor.md)。
- 需要富文本、表格、图片、文档数据元，使用专业业务编辑器。

## API 总览

```ts
import {
  RenderCodeEditor,
  type CodeEditorLanguageAdapter,
  type CodeEditorDiagnostic,
  type CodeEditorSemanticToken,
  type CodeEditorTextEdit,
  type CodeEditorAcceptSuggestionOnEnter,
  type CodeEditorCompletionActivation,
  type CodeEditorCompletionContext,
  type CodeEditorCompletionItem,
  type CodeEditorCompletionList,
  type CodeEditorCompletionResult,
  type CodeEditorCompletionTriggerKind,
  type CodeEditorHover,
  type CodeEditorSignature,
  type CodeEditorSignatureHelp,
  type CodeEditorSignatureHelpContext,
  type CodeEditorSignatureHelpTriggerKind,
  type CodeEditorSignatureParameter,
  type CodeEditorCodeAction,
  type CodeEditorContextMenuRequest,
  type CodeEditorLocation,
  type CodeEditorReference,
  type CodeEditorSelectionRange,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderCodeEditor` | class | 通用代码编辑器 render object。 |
| `CodeEditorLanguageAdapter` | interface | 语言服务适配器。 |
| `CodeEditorDiagnostic` | type | 诊断信息。 |
| `CodeEditorSemanticToken` | type | 语义高亮 token。 |
| `CodeEditorTextEdit` | type | 文本编辑。 |
| `CodeEditorAcceptSuggestionOnEnter` | type | Enter 接受策略：`on`、`off` 或 `smart`；兼容 `always`、`never` 和 `explicit` 别名。 |
| `CodeEditorCompletionActivation` | type | 补全触发来源，`manual` 或 `auto`。 |
| `CodeEditorCompletionContext` | interface | 自动/手动、trigger kind、trigger character 和取消信号。 |
| `CodeEditorCompletionItem` | type | 补全项。 |
| `CodeEditorCompletionList` | interface | 结构化候选列表，支持 `isIncomplete`、`validFor` 和共享 range。 |
| `CodeEditorCompletionResult` | type | 旧数组或结构化 CompletionList。 |
| `CodeEditorCompletionTriggerKind` | type | `invoked`、`trigger-character` 或 `incomplete`。 |
| `CodeEditorHover` | type | Hover 信息。 |
| `CodeEditorSignatureHelp` | type | 函数签名、当前重载和当前参数。 |
| `CodeEditorSignatureHelpContext` | interface | Signature 触发原因、字符、retrigger 标记和取消信号。 |
| `CodeEditorCodeAction` | type | 快速修复或源码操作。 |
| `CodeEditorContextMenuRequest` | type | 右键菜单请求上下文。 |
| `CodeEditorLocation` | type | 跳转定义位置。 |
| `CodeEditorReference` | type | 引用位置。 |
| `CodeEditorSelectionRange` | type | 智能选区候选。 |
| `MaybePromise` | type | 同步或异步返回值。 |

## 最小示例

```ts
const editor = new RenderCodeEditor({
  value: '规则 儿童禁用\n如果 条目.年龄 小于 18',
  languageAdapter: {
    getDiagnostics: (source: string) => validateRule(source),
    getSemanticTokens: (source: string) => tokenizeRule(source),
    formatDocument: (source: string) => formatRule(source),
  },
})
```

## LanguageAdapter

`CodeEditorLanguageAdapter` 的 position/range 使用 DirectSurface UI 文本模型约定：`line` 和 `column` 都是 0-based，`range.end` 是右开区间。

```ts
interface CodeEditorLanguageAdapter<
  TContext = unknown,
  TCompletionResult extends CodeEditorCompletionResult = CodeEditorCompletionItem[],
> {
  completionTriggerCharacters?: readonly string[]
  completionQuickSuggestionCharacters?: readonly string[]
  completionWordPattern?: RegExp
  signatureTriggerCharacters?: readonly string[]
  signatureRetriggerCharacters?: readonly string[]
  getDiagnostics?(source: string, context: TContext | undefined): MaybePromise<CodeEditorDiagnostic[]>
  getSemanticTokens?(source: string, context: TContext | undefined): MaybePromise<CodeEditorSemanticToken[]>
  getCompletions?(
    source: string,
    position: TextPosition,
    context: TContext | undefined,
    completionContext?: CodeEditorCompletionContext,
  ): MaybePromise<TCompletionResult>
  getHover?(source: string, position: TextPosition, context: TContext | undefined): MaybePromise<CodeEditorHover | null>
  getSignatureHelp?(
    source: string,
    position: TextPosition,
    context: TContext | undefined,
    signatureContext: CodeEditorSignatureHelpContext,
  ): MaybePromise<CodeEditorSignatureHelp | null>
  formatDocument?(source: string, context: TContext | undefined): MaybePromise<string | CodeEditorTextEdit[]>
  getCodeActions?(source: string, diagnostic: CodeEditorDiagnostic | undefined, context: TContext | undefined): MaybePromise<CodeEditorCodeAction[]>
  getDefinition?(source: string, position: TextPosition, context: TContext | undefined): MaybePromise<CodeEditorLocation | null>
  getReferences?(source: string, position: TextPosition, context: TContext | undefined): MaybePromise<CodeEditorReference[]>
  getRenameEdits?(source: string, position: TextPosition, newName: string, context: TContext | undefined): MaybePromise<CodeEditorTextEdit[]>
  getSelectionRanges?(source: string, position: TextPosition, context: TContext | undefined): MaybePromise<CodeEditorSelectionRange[]>
}
```

旧 Adapter 默认仍返回 `CodeEditorCompletionItem[]`，不需要修改。需要 CompletionList 的 Adapter 显式指定第二个泛型参数。Editor options 的 trigger、quick-suggestion character 和 word-pattern 分别覆盖 Adapter capability。

当前版本已经接入：

- `getDiagnostics()`：显示错误、警告、提示装饰。
- `getSemanticTokens()`：作为外部 line token provider 驱动语义高亮。
- `getCompletions()`：打开补全列表、键盘选择并应用补全。
- `getHover()`：显示可交互 Semantic Hover Card。
- `getSignatureHelp()`：显示函数重载、当前参数和函数说明。
- `formatDocument()`：可返回完整格式化文本或 edit 列表。
- `getCodeActions()`：返回快速修复或源码操作，业务可通过按钮、命令或诊断列表触发。
- `getDefinition()`：返回当前位置的定义位置，`Ctrl` / `Meta` 点击也会触发。
- `getReferences()`：返回当前位置符号的引用列表。
- `getRenameEdits()`：返回重命名需要应用的 edit 列表。
- `getSelectionRanges()`：返回从小到大的结构化选区候选。

## 构造参数

`RenderCodeEditorOptions` 继承 `RenderPlainTextEditorOptions`，额外支持：

因此代码编辑器也继承 `appearance: 'framed' | 'flush'`，默认为 `framed`。独立编辑器保留默认边界；放入已绘制边框的 pane、tab 内容区或设计器内嵌区时，可设为 `flush` 避免双重边框。切换外观不会改变编辑器布局尺寸。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `languageAdapter` | `CodeEditorLanguageAdapter` | `undefined` | 语言服务适配器。 |
| `languageContext` | `unknown` | `undefined` | 传给语言服务的业务上下文。 |
| `diagnosticsDebounceMs` | `number` | `300` | 文本变化后的诊断防抖时间。 |
| `completionTriggerCharacters` | `string[]` | `['.', ' ', '\n']` | 自动触发补全的字符。 |
| `completionQuickSuggestionCharacters` | `string[]` | Adapter capability 或 `[]` | `quickSuggestions:true` 时，允许输入该字符后延迟询问 Provider；Provider 可以用空结果拒绝展示。 |
| `completionWordPattern` | `RegExp` | `/[\p{L}\p{N}_$]/u` | quick suggestions 判断标识符字符的模式。 |
| `signatureTriggerCharacters` | `string[]` | Adapter capability 或 `[]` | 输入后自动请求 Signature Help 的字符。 |
| `signatureRetriggerCharacters` | `string[]` | Adapter capability 或 `[]` | 已有 Signature Session 中重新请求的字符。 |
| `signatureHelpDelayMs` | `number` | `0` | 自动 Signature Help 请求延迟。 |
| `quickSuggestions` | `boolean` | `false` | 是否在输入标识符时自动启动补全。 |
| `quickSuggestionsDelayMs` | `number` | `100` | quick suggestions 的防抖时间。 |
| `acceptSuggestionOnEnter` | `'on' \| 'off' \| 'smart' \| 'always' \| 'never' \| 'explicit'` | `'on'` | Enter 是否接受当前候选。`always` / `never` / `explicit` 分别是 `on` / `off` / `smart` 的兼容别名。 |
| `hoverDelayMs` | `number` | `300` | 鼠标停留后触发 hover 的延迟。 |
| `hoverCardCloseDelayMs` | `number` | `150` | pointer 在 token 与 HoverCard 之间移动时的关闭缓冲。 |
| `onDiagnosticsChange` | `(diagnostics) => void` | `undefined` | 诊断更新回调。 |
| `onSemanticTokensChange` | `(tokens) => void` | `undefined` | 语义 token 更新回调。 |
| `onCompletionsChange` | `(items) => void` | `undefined` | 补全列表更新回调。 |
| `onHoverChange` | `(hover) => void` | `undefined` | Hover 信息更新回调。 |
| `onHoverLinkClick` | `(link: CodeEditorHoverLink) => void` | `undefined` | 点击结构化 Hover 链接时回调；CodeEditor 不验证协议、不导航。 |
| `onSignatureHelpChange` | `(help) => void` | `undefined` | Signature Help 语义结果更新回调；pending/suppressed 发布 `null`。 |
| `onContextMenuRequest` | `(request) => void` | `undefined` | 编辑器右键菜单请求回调，业务可接入 AppOverlay 或 Shell 菜单。 |

## 诊断

诊断使用 0-based range：

```ts
interface CodeEditorDiagnostic {
  range: TextRange
  message: string
  severity?: 'error' | 'warning' | 'info'
  source?: string
  code?: string
}
```

CodeEditor 会把诊断转换为 PlainTextEditor decoration：

- `error`：错误下划线。
- `warning`：警告下划线。
- `info`：提示下划线。

业务可通过 `editor.diagnostics` 获取当前诊断副本，也可以调用：

```ts
await editor.validateNow()
editor.setDiagnostics(diagnostics)
```

异步诊断会绑定内部版本号。旧请求返回时，如果文本已更新，结果会被忽略。

## 语义高亮

语义 token 使用同样的 0-based range：

```ts
interface CodeEditorSemanticToken {
  range: TextRange
  type: string
  modifiers?: string[]
}
```

常用 `type`：

- `keyword`
- `variable`
- `field`
- `type`
- `operator`
- `action`
- `dataset`
- `rule`
- `string`
- `number`
- `quantity`
- `punctuation`

CodeEditor 会将这些 token 转换为 PlainTextEditor 的行级 token provider。没有语义 token 的行会退回到 PlainTextEditor 自身 tokenizer。

## 补全

补全项由 `getCompletions()` 返回：

```ts
interface CodeEditorCompletionItem {
  label: string
  filterText?: string
  kind?: CodeEditorCompletionKind
  insertText?: string
  detail?: string
  documentation?: string
  range?: TextRange
  sortText?: string
  commitCharacters?: string[]
}
```

结构化结果：

```ts
interface CodeEditorCompletionList {
  items: CodeEditorCompletionItem[]
  isIncomplete?: boolean
  validFor?: RegExp
  range?: TextRange
}
```

Provider 可以通过补全上下文区分普通输入与上下文边界：

```ts
interface CodeEditorCompletionContext {
  activation: 'manual' | 'auto'
  triggerKind: 'invoked' | 'trigger-character' | 'incomplete'
  triggerCharacter?: string
  invocationReason?: 'typing' | 'context-boundary'
  signal: AbortSignal
}
```

`invocationReason` 是可选的向后兼容字段。`context-boundary` 表示编辑器只在该位置询问 Provider，语言适配器仍需根据语法与语义决定返回候选或空列表。

- `validFor` 匹配时，继续输入会本地过滤候选。
- `isIncomplete:true` 时，继续输入会取消旧请求并重新请求。
- 新请求会通过 `AbortSignal` 主动取消旧请求；文档与上下文版本隔离仍然保留。
- 候选列表超过紧急保护数量时会被裁剪并视为 incomplete。

触发方式：

- 调用 `editor.triggerCompletion()` 手动触发。
- 输入 `completionTriggerCharacters` 中的字符后自动触发。
- 默认触发字符是 `.`、空格和换行。
- `quickSuggestions:true` 时，输入符合 `completionWordPattern` 的标识符字符会在 delay 后自动请求。
- `quickSuggestions:true` 且输入 `completionQuickSuggestionCharacters` 中的字符时，会共用同一 delay 询问 Provider；该列表默认为空。
- `Ctrl+Space` / `Meta+Space` 触发补全。

键盘交互：

- `ArrowDown` / `ArrowUp` 切换选中项。
- `PageUp` / `PageDown`、`Home` / `End` 按页或边界移动。
- 鼠标滚轮滚动大候选列表；弹窗默认绘制 8 行可见窗口。
- `Tab` 在存在当前选中项时应用它。
- `acceptSuggestionOnEnter: 'on'` 是默认策略：候选列表打开时，`Enter` 应用当前高亮项。
- `acceptSuggestionOnEnter: 'smart'` 仅在手动触发或用户导航过自动候选时接受；未导航的自动候选会在 `Enter` 时关闭并正常换行。`'off'` 始终关闭补全并正常换行。
- `Escape` 关闭补全。
- 输入当前项 `commitCharacters` 中的字符，会应用补全并同时插入该字符。
- 上下文边界返回空前缀列表时会“软打开”：列表可见但不预选首项，Enter/Tab 不会被补全会话消费。方向键或继续输入前缀后才建立选中。

补全弹层最多显示 8 项。项目更多时，方向键会自动滚动可视窗口，保证当前选中项始终可见；弹层宽高会限制在编辑器可交互边界内，窄小编辑器也不会产生组件外的不可点击项目。

应用规则：

- 如果 completion item 提供 `range`，替换该 range。
- 如果没有 `range`，在当前光标处插入 `insertText || label`。
- 补全结果绑定当前 source version，旧异步结果不会覆盖新文本。

常用 API：

```ts
await editor.triggerCompletion()
await editor.triggerCompletion(undefined, {
  activation: 'auto',
  triggerKind: 'trigger-character',
  triggerCharacter: '.',
})
editor.moveCompletionSelection(1)
editor.acceptSelectedCompletion()
editor.closeCompletion()
```

## Signature Help

Signature Help 由 Adapter 返回通用 DTO，CodeEditor 不解析函数名或签名 label：

```ts
interface CodeEditorSignatureParameter {
  label: string
  documentation?: string
}

interface CodeEditorSignature {
  label: string
  documentation?: string
  parameters: readonly CodeEditorSignatureParameter[]
}

interface CodeEditorSignatureHelp {
  signatures: readonly CodeEditorSignature[]
  activeSignature: number
  activeParameter: number
  range?: TextRange
}
```

触发和交互：

- 输入 `signatureTriggerCharacters` 自动请求；已有 Session 中输入 `signatureRetriggerCharacters` 重新请求。
- `Ctrl+Shift+Space` / `Meta+Shift+Space` 手动触发，优先于普通 Completion 快捷键。
- 多重载时 `ArrowUp` / `ArrowDown` 切换当前重载；`Enter` / `Tab` 不由 Signature Help 消费。
- `Escape` 关闭 pending、active 或 suppressed Session，并取消在途请求。
- Completion 打开时 Signature 进入 suppressed；Completion 关闭后只基于当前 source/caret 重新请求，不恢复旧结果。
- 自动 Hover 不会覆盖 pending/active Signature；显式 `triggerHover()` 会先关闭 Signature。
- IME composition 开始、失焦、wheel、实际滚动、`revealPosition()`、hidden、detach 和 dispose 都会关闭 Session。

每次请求都带独立 `AbortSignal`，并同时校验 request sequence、document version、language-context version 和 cursor/selection generation。Provider 结果会深复制、移除空 label，并把 `activeSignature` 从原始数组坐标重映射到过滤后数组。`activeParameter` 只归一为非负整数，不把固定签名的超量参数错误绑到末参。

面板最大宽度 460px、最多 8 行和 3 个重载，当前重载始终位于可见窗口中。参数使用独立行，说明最多 3 行；面板优先放在 caret 上方，空间不足时改到下方。

Signature 的语义 Session、取消和快捷键仍由 CodeEditor 管理；可见内容通过 CodeEditor 自有的 anchored `TooltipManager` 绘制到 tooltip compositor layer。它使用 caret `PopupAnchor`、编辑器 boundary、显式 stable render root 和 editor owner，不会被全局 pointer `TooltipService.hide()` 误关闭。Completion suppression、外部 modal/root dismiss 和 editor dispose 会同步清理 Session 与 Rich Tooltip content。

```ts
await editor.triggerSignatureHelp()
editor.moveSignatureSelection(1)
editor.closeSignatureHelp()
editor.signatureHelpInfo
```

## Hover

Hover 信息由 `getHover()` 返回：

```ts
interface CodeEditorHover {
  range: TextRange
  label: string
  detail?: string
  type?: string
  documentation?: string
  sections?: readonly CodeEditorHoverSection[]
  links?: readonly CodeEditorHoverLink[]
}

interface CodeEditorHoverLink {
  label: string
  href: string
  title?: string
}

type CodeEditorHoverSectionKind =
  | 'text'
  | 'code'
  | 'list'
  | 'warning'
  | 'reference'

type CodeEditorHoverSectionPriority = 'required' | 'normal' | 'optional'

interface CodeEditorHoverSection {
  kind: CodeEditorHoverSectionKind
  lines: readonly string[]
  priority?: CodeEditorHoverSectionPriority
  language?: string
  text?: string
  copyText?: string
}
```

`documentation` 保持向后兼容，并在内部转为一个 `normal/text` section。结构化 `sections` 适合展示代码、列表、警告和引用文本；`reference` 仍是非交互 accent 文本，不会自动解析其中的 URL。只有 `links` 创建真实 hit region。

Section 会在保存时深复制和归一化：普通文本会 trim 并移除空行，`code` 的 `text/copyText` 按原字符串保留；未传 `text` 时使用 `lines.join('\n')`，未传 `copyText` 时复制最终 `text`。`language` 用于代码语法着色。

触发方式：

- 调用 `editor.triggerHover(position)` 手动触发。
- 鼠标停留在文本位置超过 `hoverDelayMs` 后自动触发。
- 文本变化、点击编辑器、Completion/Signature 打开时会立即关闭 Hover。
- 鼠标仍在当前 `hover.range` 内时复用当前 Hover，不重启计时器或重复请求；range end 使用排他语义。
- 鼠标拖选文本或拖动编辑器滚动条时不调度 Hover；释放后也不补触发，等待下一次无按键 pointer move 重新开始延迟。
- 鼠标可从当前 range 穿过间隙进入 Card；只有同时离开 range、Card、Card focus 和 pointer capture 后，才按关闭缓冲结束。
- Card 内链接、代码 Copy、文本拖选、`Ctrl/Cmd+C` 和内部滚动不会关闭 Hover。
- editor 自身 wheel、滚动或 `revealPosition()` 改变视口时立即关闭 Hover；Card 有纵向 overflow 时，即使滚到边界也消费 wheel，避免穿透到底层 editor。
- 编辑器被隐藏或从渲染树 detach 时，同样取消延迟请求并关闭 Hover，重新显示或挂载不会恢复旧面板。
- 补全列表打开时，HoverCard 会自动关闭，避免两个浮层互相遮挡。
- Card 以当前 `hover.range` 的完整可见 token 矩形为锚点，优先显示在 token 末尾右侧；空间不足时按左侧、下方、上方回退，不覆盖锚定 token。
- Semantic Hover 的面板边界是编辑器所属 stable `anchorRoot` 的 Popup viewport，不是 Editor 自身矩形。Card 可覆盖同一窗口内的结果、消息或其他 Dock 区域，但不越出应用/浮动窗口 viewport。
- 锚定 token 是否可见仍由 CodeEditor 判断；紧凑 viewport 中 Card 可缩小主轴尺寸并在内部滚动，不通过 clamp 回压到 token 上。

面板使用 [HoverCard](../overlay/hover-card.md) 和 embedded `RenderMarkdownViewer`：默认宽度 220～560px、最大高度 360px；短内容按自然宽高收缩，长文档、DDL、代码和表格在 Card 内滚动。

Hover 与 Signature 仍互斥，但使用不同 presentation：Semantic Hover 是 CodeEditor-owned nonmodal HoverCard，Signature Help 是 CodeEditor-owned passive Tooltip。通用 CodeEditor 不包含 SQL、URL protocol 或 `window.open()` 规则。

`debugState().hoverRect/signatureHelpRect` 只在真实 tooltip-layer paint 完成且当前 anchor、root viewport、theme 和 presentation 仍匹配时返回矩形；Signature Help 还会校验自己的 editor boundary。语义结果已 active 但尚未绘制或空间不足时，`visible` 仍反映语义状态，而 `lines=[]`、`rect=null`。

常用 API：

```ts
await editor.triggerHover({ line: 0, column: 4 })
editor.closeHover()
editor.hoverInfo
```

Hover 结果同样绑定当前 source version，旧异步结果不会覆盖新文本。

## 格式化和 Edit

格式化可以返回完整文本：

```ts
formatDocument: (source: string) => formatDsl(source)
```

也可以返回 edit 列表：

```ts
formatDocument: (source: string) => [
  {
    range: { start: { line: 0, column: 0 }, end: { line: 0, column: 2 } },
    newText: '规则',
  },
]
```

CodeEditor 应用多个 edit 时会从后往前执行，避免前一个 edit 改变后续 range。

```ts
await editor.formatDocument()
editor.applyTextEdits(edits)
```

## 快速修复、导航和重构

快速修复由 `getCodeActions()` 返回：

```ts
interface CodeEditorCodeAction {
  title: string
  kind: 'quickfix' | 'source.format' | string
  edits: CodeEditorTextEdit[]
  diagnostics?: CodeEditorDiagnostic[]
}
```

常用 API：

```ts
const actions = await editor.triggerCodeActions(editor.diagnostics[0])
editor.applyCodeAction(actions[0])
```

定义和引用：

```ts
interface CodeEditorLocation {
  name: string
  kind?: string
  range: TextRange
  selectionRange?: TextRange
}

interface CodeEditorReference {
  name: string
  kind?: string
  role?: 'declaration' | 'reference'
  range: TextRange
}
```

常用 API：

```ts
await editor.goToDefinition()
const references = await editor.findReferences()
```

`goToDefinition()` 会自动跳转到返回的 `selectionRange ?? range`。`findReferences()` 只返回位置列表，不会改变编辑器选区，业务页面可以把结果放入侧栏、底部面板或命令面板。

Definition 和 References 各自维护请求序号，并共享 cursor/selection generation。新 Definition 只取消旧 Definition，新 References 只取消旧 References；请求开始后如果光标或选区变化，旧结果会被忽略。显式传入的 position 不需要与当前 caret 相同，因此 `Ctrl` / `Meta` 点击仍可安全导航。

重命名和智能选区：

```ts
await editor.renameSymbol('新名称')
await editor.expandSelection()
```

`renameSymbol()` 会应用 language adapter 返回的 edits。`expandSelection()` 会从 `getSelectionRanges()` 返回值中选择比当前选区更大的下一个 range，并把它设置为当前选区。`selectSelectionRangeAt()` 用于双击场景，会选择包含当前位置的最小 selection range。

快捷键和鼠标交互：

- `Shift+Alt+F` 格式化。
- `Shift+Alt+ArrowRight` 扩大选区。
- `Alt+Enter` 触发 code actions。
- `Ctrl` / `Meta` 点击触发跳转定义。
- 双击优先使用 `getSelectionRanges()` 选择语义 token，没有语言服务结果时保留 PlainTextEditor 的默认 token 选择。
- 右键会触发 `onContextMenuRequest`，回调里包含右键位置、文本位置、命中的诊断和已加载的 code actions；编辑器不直接持有业务 overlay。

## 和 PlainTextEditor 的关系

`RenderCodeEditor` 继承 `RenderPlainTextEditor`。PlainTextEditor 新增了两个通用扩展点：

```ts
editor.setLineTokenProvider(provider)
editor.setDecorations(decorations)
```

这些扩展点不依赖 CodeEditor，也可以被日志查看器、配置编辑器或自定义脚本编辑器复用。

## 业务 DSL 接入建议

业务 DSL 应提供薄适配层，把自身 Language Service 的位置模型转换为 DirectSurface UI 的 0-based 模型：

```ts
const adapter: CodeEditorLanguageAdapter<DslContext> = {
  getDiagnostics(source, context) {
    return getDslDiagnostics(source, { context }).map(fromDslDiagnostic)
  },
  getSemanticTokens(source, context) {
    return getDslSemanticTokens(source, { context }).map(fromDslSemanticToken)
  },
  formatDocument(source) {
    return formatDsl(source)
  },
}
```

编辑器层不应直接引用 DSL 的 lexer、parser、checker、compiler 内部源码。

## 状态和调试

`debugState()` 在 PlainTextEditor 的基础上增加：

| 字段 | 说明 |
| --- | --- |
| `languageFeatureVersion` | 当前语言服务调度版本。 |
| `diagnosticsCount` | 当前诊断数量。 |
| `semanticTokenCount` | 当前语义 token 数量。 |
| `completionCount` | 当前补全项数量。 |
| `completionVisible` | 补全列表是否打开。 |
| `selectedCompletionLabel` | 当前选中的补全项 label。 |
| `hoverVisible` | Hover tooltip 是否打开。 |
| `hoverLabel` | 当前 hover 的标题。 |
| `hoverLines` | 当前实际绘制的 Hover 行，返回脱离副本；首次 paint 前为空。 |
| `hoverRect` | 当前实际 Hover 全局矩形；首次 paint 或缓存失效时为 `null`。 |
| `hoverTruncated` | 当前实际布局是否发生裁剪。 |
| `diagnosticsDebounceMs` | 诊断防抖时间。 |
| `hoverDelayMs` | Hover 延迟时间。 |
| `hasLanguageAdapter` | 是否设置语言适配器。 |

## 相关组件

- [PlainTextEditor 大文本编辑器](./plain-text-editor.md)
- [CommandToolbar 命令工具栏](../command/command-toolbar.md)
- [Popup 弹出层](../overlay/popup.md)
- DevTools 开发工具
