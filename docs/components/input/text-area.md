# TextArea 多行文本

> **通用布局能力**：`RenderTextArea` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；文本内容 padding 是输入框内部视觉属性。详见[组件通用布局属性](../common-layout-properties.md)。


`RenderTextArea` 是 DirectSurface UI 的多行文本输入组件。它支持自动折行、垂直滚动、光标定位、拖选、选区替换、中文 IME 组字、粘贴多行文本、清除按钮、只读/禁用和失焦提交。

TextArea 适合备注、批注、说明、短文档片段等中等长度文本。它不是大文本编辑器。

## API 总览

主类：

- `RenderTextArea`

相关 public type：

- `FormFieldStatus`

导入：

```ts
import { RenderTextArea, type FormFieldStatus } from 'directsurface'
```

`RenderTextArea` 的构造参数是公开 options 对象，但当前没有单独导出的 TextArea options 类型。业务代码直接按本文参数表传入对象。

## 何时使用

- 备注、说明、批注、审批意见。
- 多行描述字段。
- 弹窗中的中等长度文本输入。
- 需要自动折行和内部滚动的文本框。
- 需要区分“实时变化”和“失焦提交”的多行输入。

不适合：

- 单行文本，使用 [TextBox](./text-box.md)。
- 大文本、源码、JSON、日志和几十万行文本，使用 [PlainTextEditor](../visualization/plain-text-editor.md)。
- Markdown 阅读，使用 [MarkdownViewer](../visualization/markdown-viewer.md)。
- 结构化表单，优先拆成多个字段，不要把所有业务数据塞入一个 TextArea。

## 最小示例

```ts
import { RenderTextArea } from 'directsurface'

const noteState = {
  note: '',
}

const noteTextArea = new RenderTextArea({
  value: noteState.note,
  placeholder: '输入备注',
  onChange: value => {
    noteState.note = value
  },
})
```

## 构造参数

`new RenderTextArea(options)` 的 `options`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `value` | `string` | `''` | 初始文本。支持 `\n` 多行；会按 `maxLength` 截断。 |
| `placeholder` | `string` | `''` | 空值时显示的提示文本。 |
| `readonly` | `boolean` | `false` | 只读。可聚焦和选择文本，但不能输入、粘贴、清除。 |
| `onChange` | `(value: string) => void` | `undefined` | 文本内容变化时触发。输入、Enter、粘贴、删除选区、清除都会触发。 |
| `onCommit` | `(value: string) => void` | `undefined` | 失焦时触发，用于保存批注、备注等完整编辑结果。只读状态失焦不会触发。 |
| `disabled` | `boolean` | `false` | 禁用。不可聚焦、不可输入、不可滚动内部内容。 |
| `status` | `FormFieldStatus` | `'default'` | 状态边框颜色。可选 `'default'`、`'success'`、`'warning'`、`'error'`。 |
| `helperText` | `string` | `''` | 下方帮助或错误文案。会增加组件高度。 |
| `clearable` | `boolean` | `false` | 有值、非禁用、非只读时显示清除按钮。 |
| `maxLength` | `number` | `undefined` | 最大字符数。非有限数字表示不限制；传入小数向下取整；小于 0 按 0 处理。 |

```ts
const reviewTextArea = new RenderTextArea({
  value: '',
  placeholder: '输入审核意见',
  status: 'default',
  helperText: '支持多行输入',
  clearable: true,
  maxLength: 500,
  onChange: value => {
    state.reviewDraft = value
  },
  onCommit: value => {
    state.reviewText = value
  },
})
```

## 属性

| 属性 | 类型 | 可写 | 说明 |
| --- | --- | --- | --- |
| `value` | `string` | 是 | 当前文本。赋值会按 `maxLength` 截断、重建逻辑行、清理折行缓存、校正光标和滚动位置。 |
| `placeholder` | `string` | 是 | 提示文本。公开字段，动态修改后业务需要触发重绘。 |
| `readonly` | `boolean` | 是 | 只读状态。聚焦中设为 `true` 会清理中文组字、拖选和滚动条拖动。 |
| `onChange` | `(value: string) => void \| undefined` | 是 | 实时变化回调。 |
| `onCommit` | `(value: string) => void \| undefined` | 是 | 失焦提交回调。 |
| `disabled` | `boolean` | 是 | 禁用状态。设为 `true` 会清理 hover 并失焦。 |
| `status` | `FormFieldStatus` | 是 | 状态色。赋值会重绘。 |
| `helperText` | `string` | 是 | 帮助文案。赋值会重新 layout。 |
| `clearable` | `boolean` | 是 | 是否显示清除按钮。赋值会重新 layout 并重绘。 |
| `maxLength` | `number \| null` | 是 | 最大长度。设为 `null` 表示不限制；修改时会重新截断当前文本。 |
| `isFocused` | `boolean` | 否 | 当前是否拥有焦点。 |

`placeholder`、`onChange`、`onCommit` 是公开字段，不是 setter。动态修改视觉相关字段时，业务应确保页面发生重绘。

## 方法

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `focusIn()` | `void` | 进入焦点并启动输入 session。通常由 `FocusManager` 调用。 |
| `focusOut()` | `void` | 退出焦点，结束输入 session，并在非只读时触发 `onCommit(value)`。 |
| `dispose()` | `void` | 结束输入、释放指针捕获、注销焦点、释放内部输入控制器。 |

`RenderTextArea` 当前没有公开的 `reset()` 方法；需要重置内容时直接设置 `value`。

```ts
const resettableTextArea = new RenderTextArea({
  value: '旧内容',
})

resettableTextArea.value = ''
```

## onChange 与 onCommit

`onChange` 是实时变化事件，适合更新草稿状态、启用保存按钮、实时校验。

`onCommit` 是失焦提交事件，适合批注框、备注框这类“用户编辑一段内容后再统一保存”的场景。它只在组件从聚焦变为失焦时触发；只读状态下失焦不会触发。

```ts
const commentTextArea = new RenderTextArea({
  value: '',
  placeholder: '输入批注',
  onChange: value => {
    state.commentDraft = value
  },
  onCommit: value => {
    state.commentSaved = value
  },
})
```

## 输入行为

| 操作 | 行为 |
| --- | --- |
| 点击文本区域 | 获得焦点，把光标定位到点击位置。 |
| 拖选文本 | 建立或扩展多行选区。 |
| 普通输入 | 更新当前逻辑行，触发 `onChange`。 |
| Enter | 在当前光标位置插入换行；如有选区，先删除选区再插入换行。 |
| Backspace / Delete | 有选区时删除选区；无选区时交给共享输入器处理当前行。 |
| 中文 IME composition start | 如有选区，先删除选区，但暂不触发 `onChange`。 |
| 中文 IME composition update | 绘制拼音预览并参与折行，尚不提交真实值。 |
| 中文 IME composition end | 写入最终文本，折叠选区，触发 `onChange`。 |
| 粘贴 | 读取剪贴板文本，保留换行，替换当前选区或插入到光标位置。 |
| `Ctrl/Cmd + A` | 选择全部文本。 |
| `Ctrl/Cmd + C` | 复制选区。 |
| `Ctrl/Cmd + X` | 剪切选区并同步内容。 |
| `Ctrl/Cmd + Z` | 依赖共享输入器的撤销结果同步当前行。 |
| Escape | 失焦。 |
| Tab / Shift+Tab | 由 `FocusManager` 在焦点范围内移动焦点。 |

TextArea 支持“拖选后直接输入替换选区”。普通字符、Enter、中文输入和粘贴都会先处理当前选区，再写入新内容。

## 中文输入

TextArea 使用行模式输入：聚焦时共享输入器只承接当前逻辑行，而不是把整个多行文本塞进隐藏 textarea。这避免长文本导致浏览器 textarea 同步成本过高。

中文输入过程中的拼音预览会参与当前行布局和折行：

- 组字开始前如果有选区，会先删除选区。
- 组字预览期间 placeholder 会隐藏。
- 预览文本会按当前宽度折行显示。
- 组字结束后才写入最终文本并触发 `onChange`。

## 粘贴

TextArea 的粘贴行为和 TextBox 不同：

- TextArea 保留换行。
- TextBox 会把换行转换为空格。
- TextArea 粘贴时会 `preventDefault()`，不等待浏览器把文本原生插入 textarea。
- 粘贴内容会替换当前选区；没有选区时插入到光标位置。
- 粘贴后会把共享输入器同步为当前光标所在逻辑行。

```ts
const pasteTextArea = new RenderTextArea({
  value: '',
  placeholder: '粘贴多行说明',
  onChange: value => {
    state.description = value
  },
})
```

## 自动折行和滚动

TextArea 内部区分：

- 逻辑行：`value` 按 `\n` 拆分得到的真实行。
- 视觉行：逻辑行按当前可用宽度折行后的绘制行。

当前折行是按宽度寻找能够放入视觉行的最长 UTF-16 substring，属于字符级软换行，不按单词边界、中文标点禁则或完整 grapheme cluster 规则断行。包含 Emoji、组合字符或 ZWJ 序列且要求严格字符边界的专业排版场景，不应依赖 TextArea 的当前折行算法。

布局行为：

- 父级给无限高度时，默认主体高度约为 6 行文本高度加上下 padding。
- 父级给有限高度时，TextArea 使用父级高度，并扣除 `helperText` 高度。
- 宽度变化会失效折行缓存并重新折行。
- 始终预留垂直滚动条宽度，避免“出现滚动条后宽度变窄，又导致重新折行”的循环。
- 内容超出视口时显示内部垂直滚动条。

滚动行为：

- 未聚焦时，滚轮事件返回 `false`，让外层滚动容器处理。
- 聚焦且内容可滚动时，滚轮滚动 TextArea 内部内容。
- 聚焦且滚动到顶部或底部时，仍消费滚轮，避免滚动穿透到外层容器。
- 失焦不会重置 `_scrollY`，用户滚动到的位置会保留。

## 清除按钮

清除按钮显示条件：

- `clearable === true`
- `value.length > 0`
- 非 `disabled`
- 非 `readonly`

点击清除按钮会：

- 获得焦点。
- 把 `value` 设为空字符串。
- 光标回到第一行第 0 列。
- 清空选区。
- 触发 `onChange('')`。

## 只读和禁用

| 状态 | 可聚焦 | 可选择 | 可输入 | 可滚动内部内容 | 可清除 | 典型用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 正常 | 是 | 是 | 是 | 聚焦后是 | 取决于 `clearable` | 普通编辑。 |
| `readonly` | 是 | 是 | 否 | 聚焦后是 | 否 | 展示可复制长说明。 |
| `disabled` | 否 | 否 | 否 | 否 | 否 | 当前业务不可操作。 |

## Placeholder 和状态颜色

placeholder 仅在以下条件同时满足时显示：

- 文本只有一个逻辑行。
- 该逻辑行为空字符串。
- `placeholder` 非空。
- 当前没有中文组字预览。

状态色通过 `status` 控制：

| 状态 | 用途 |
| --- | --- |
| `'default'` | 正常。 |
| `'success'` | 校验通过。 |
| `'warning'` | 有风险但可继续。 |
| `'error'` | 校验失败。 |

```ts
const invalidTextArea = new RenderTextArea({
  value: '',
  placeholder: '输入说明',
  status: 'error',
  helperText: '说明不能为空',
})
```

## 弹窗中的布局

TextArea 放在弹窗或批注卡片中时，推荐让正文区域滚动，底部按钮固定可见。不要让整个弹窗内容因为审计轨迹、帮助文本或长输入而把按钮挤出视口。

```text
Modal / Card
  header
  body
    TextArea 或滚动内容区
  footer
    确定 / 取消 / 清除
```

在布局容器中，应给 TextArea 明确高度或可分配空间。只设置宽度而不给高度时，父布局如果提供无限高度，TextArea 会使用默认 6 行高度。

## 性能边界

TextArea 对中等长度文本做了折行缓存：

- 折行结果按逻辑行保存，中文 composition preview 会临时重算当前行而不污染普通行缓存。
- 当前普通输入提交、整体赋值、宽度变化和重新布局都可能失效全部折行缓存。
- 插入或删除换行会失效全部折行缓存。

但 TextArea 仍然不是大文本虚拟编辑器。以下场景应使用 [PlainTextEditor](../visualization/plain-text-editor.md)：

- 几万行以上文本。
- 大型 JSON、日志、源码。
- 需要行号、代码着色、折叠、搜索定位。
- 需要高频编辑和虚拟化绘制。

## 生命周期

`dispose()` 会：

- 如果正在编辑，先失焦并结束输入 session。
- 清理文本拖选和滚动条拖动状态。
- 释放可能存在的指针捕获。
- dispose 内部输入控制器。
- 从 `FocusManager` 注销。
- 调用父类 `dispose()`。

页面、弹窗或 tab 销毁时，应一起释放 TextArea，避免焦点、输入 session 或指针捕获残留。

## 常见问题

### 为什么 TextArea 失焦时没有重置滚动条？

这是设计行为。用户在多行内容中滚动后，失焦不应该自动回到顶部，否则再次聚焦会丢失阅读上下文。

### 为什么未聚焦时滚轮不滚动 TextArea？

未聚焦时滚轮应优先交给外层滚动容器，例如弹窗、页面或 ScrollView。只有 TextArea 聚焦后，滚轮才滚动内部内容。

### 为什么 TextArea 粘贴保留换行，而 TextBox 不保留？

TextArea 是多行输入，换行是有效内容；TextBox 是单行输入，换行会被转换为空格。

### 为什么大文本不能用 TextArea？

TextArea 需要做多行折行、光标定位、选区和输入同步。大文本应交给有虚拟化能力的 PlainTextEditor。

### 为什么 onCommit 只在失焦时触发？

TextArea 常用于批注、备注等成段输入。`onChange` 用于草稿和实时校验，`onCommit` 用于用户离开输入框后的统一保存或审计。

## 相关组件

- [TextBox](./text-box.md)：单行输入、密码输入和搜索输入。
- [PlainTextEditor](../visualization/plain-text-editor.md)：大文本、代码、JSON、日志。
- [MarkdownViewer](../visualization/markdown-viewer.md)：Markdown 文档阅读。
- [Modal](../overlay/modal.md)：弹窗中承载 TextArea。
- [GridPanel](../../layouts.md)：表单布局。
- [ScrollView](../../layouts.md)：外层滚动容器。
