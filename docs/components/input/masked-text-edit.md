# MaskedTextEdit 固定格式输入

> **通用布局能力**：`RenderMaskedTextEdit` 支持 `width`、`height`、min/max、`margin` 和槽位对齐；`fieldHeight` 只控制输入主体高度。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderMaskedTextEdit` 用于录入结构固定、但不参与数值运算的文本，例如档案号、固定长度编号、电话号码和自定义业务编码。

它在 `RenderTextBox` 的输入、选区、粘贴和 IME 会话之上增加 `MaskEngine`。业务保存的是不含分隔符的 raw value，界面绘制的是包含固定字符的 display value。


## API 总览

主类：

- `RenderMaskedTextEdit`
- `MaskEngine`

相关 public type：

- `RenderMaskedTextEditOptions`
- `MaskPromptMode`
- `MaskOverwriteMode`
- `MaskBlockDefinition`
- `MaskBlockDefinitions`
- `MaskBlockState`
- `MaskTokenDefinition`
- `MaskTokenDefinitions`
- `MaskValue`
- `MaskEditResult`

导入：

```ts
import {
  MaskEngine,
  RenderMaskedTextEdit,
  type MaskBlockDefinitions,
  type MaskTokenDefinitions,
  type MaskValue,
} from 'directsurface'
```

## 何时使用

适合：

- 档案号、预约号、设备编号等固定格式字符串。
- 电话号码、邮政编码等需要自动插入分隔符的字段。
- 只允许数字、字母或字母数字组合的业务编码。
- 需要业务自定义字符规则和大小写转换的输入。

不适合：

- 普通自由文本，使用 [TextBox](./text-box.md)。
- 需要数值运算、范围和步进的字段，使用 [NumberInput](./number-input.md)。
- 日期、时间和持续时长，分别使用 [DatePicker](./date-picker.md)、[TimeEdit](./time-edit.md) 和 [TimeSpanEdit](./time-span-edit.md)。
- 格式会根据上下文大幅变化，或者需要在同一字段中任意跳过中间段的输入。这类规则应由专用编辑器承担。

## 最小示例

```ts
import { RenderMaskedTextEdit } from 'directsurface'

const itemState = {
  phone: '',
}

const phone = new RenderMaskedTextEdit({
  mask: '000-0000-0000',
  value: itemState.phone,
  placeholder: '输入手机号',
  clearable: true,
  onChange: (value, details) => {
    itemState.phone = value
    console.log(details.display, details.complete)
  },
})
```

输入 `13800138000` 后：

```text
phone.value        // '13800138000'
phone.displayValue // '138-0013-8000'
phone.complete     // true
```

## 值模型

组件同时维护两种值：

| 值 | 示例 | 用途 |
| --- | --- | --- |
| raw value | `'13800138000'` | `value`、业务状态和回调的第一参数，不包含 mask 固定字符。 |
| display value | `'138-0013-8000'` | `displayValue` 和界面文本，包含自动插入的固定字符。 |

构造参数和运行时属性 `value` 都接收 raw value。写入时会：

1. 按 mask 槽位逐个 Unicode code point 检查。
2. 丢弃不符合当前槽位的字符。
3. 超过 mask 容量的字符会被截断。
4. 重新生成 `displayValue` 和 `complete`。

程序直接写入 `edit.value` 或调用 `reset()` 不会触发 `onChange`。

```ts
const code = new RenderMaskedTextEdit({
  mask: 'AA-0000',
  value: 'ab12x34',
})

code.value        // 'ab1234'
code.displayValue // 'ab-1234'
```

默认 `promptMode: 'never'` 时，固定字符按输入进度显示，不会为尚未填写的槽位绘制 prompt character。例如 mask 为 `000-000` 时：

| raw value | display value |
| --- | --- |
| `''` | `''` |
| `'1'` | `'1'` |
| `'123'` | `'123-'` |
| `'1234'` | `'123-4'` |

## 内置 mask token

| Token | 是否必填 | 接受字符 |
| --- | --- | --- |
| `0` | 是 | 数字。 |
| `9` | 否 | 数字。 |
| `L` | 是 | Unicode 字母，包括中文等 `\p{L}` 字符。 |
| `?` | 否 | Unicode 字母。 |
| `A` | 是 | Unicode 字母或数字。 |
| `a` | 否 | Unicode 字母或数字。 |

其他字符按固定文本处理：

```ts
const dateLikeCode = new RenderMaskedTextEdit({
  mask: '0000-00-00',
})
```

这里的两个 `-` 由组件自动插入，不属于 raw value。

### 转义 token

反斜杠 `\` 会把下一个字符转成固定文本。因为 TypeScript 字符串本身也使用反斜杠转义，代码中通常需要写成 `\\`：

```ts
const prefixedCode = new RenderMaskedTextEdit({
  // 界面格式：A-BF；第一个 A 是固定字符，两个 X 是自定义槽位。
  mask: '\\A-XX',
  definitions: {
    X: {
      pattern: /[A-F]/i,
      transform: character => character.toUpperCase(),
    },
  },
  value: 'bf',
})
```

如果希望数字 `0`、字母 `A` 等内置 token 作为固定字符显示，也必须转义。

## 自定义 token

`definitions` 会与内置 token 合并；相同 key 会覆盖内置定义。

```ts
interface MaskTokenDefinition {
  readonly pattern: RegExp
  readonly required?: boolean
  readonly transform?: (character: string) => string
}

type MaskTokenDefinitions =
  Readonly<Record<string, MaskTokenDefinition>>
```

示例：

```ts
const upperHexDefinitions: MaskTokenDefinitions = {
  X: {
    pattern: /[0-9a-f]/i,
    required: true,
    transform: character => character.toUpperCase(),
  },
}

const colorCode = new RenderMaskedTextEdit({
  mask: '\\#XXXXXX',
  definitions: upperHexDefinitions,
  value: '12abef',
})

colorCode.value        // '12ABEF'
colorCode.displayValue // '#12ABEF'
```

自定义定义的约束：

- `pattern` 应检查单个 Unicode code point。
- `required` 省略时按 `true` 处理。
- `transform` 必须返回一个 Unicode code point。
- 转换后的字符仍必须通过 `pattern`，否则会被丢弃。
- 可选 token 是顺序槽位，不能跳过中间可选槽位后继续填写后面的必填槽位。因此可选 token 优先放在 mask 尾部。

## 格式提示

`promptMode` 可以把未填写的槽位作为浅色 guide 绘制出来：

```ts
const phone = new RenderMaskedTextEdit({
  mask: '000-0000-0000',
  promptMode: 'focused',
  promptCharacter: '_',
})
```

| `promptMode` | 行为 |
| --- | --- |
| `'never'` | 默认值，不绘制 guide。 |
| `'focused'` | 仅聚焦时绘制。 |
| `'always'` | 始终绘制。 |

输入过程示例：

```text
空值       ___-____-____
输入 138   138-____-____
```

guide 只是 Canvas 绘制内容，不进入隐藏 textarea、`value`、`displayValue`、复制内容、回调或提交值。启用并显示 guide 时，guide 优先于普通 `placeholder`。

`promptCharacter` 必须恰好是一个 Unicode code point。block 可以使用自己的 `placeholderCharacter` 覆盖全局字符。

## 插入与覆盖输入

```ts
const code = new RenderMaskedTextEdit({
  mask: '000-000',
  value: '123456',
  overwriteMode: 'replace',
})
```

| `overwriteMode` | 光标位于第二个槽位并输入 `9` 的结果 |
| --- | --- |
| `'insert'` | `192-345`：插入并推移后续槽位，超出容量的尾部被截断。 |
| `'replace'` | `193-456`：覆盖当前槽位，未触及的后缀保持不变。 |

存在选区时，两种模式都替换选中的值槽位。粘贴在 `'replace'` 模式下会连续覆盖后续槽位。固定分隔符不是可编辑槽位；仅选中分隔符后按 Backspace/Delete 不会误删相邻值。

## Named block 规则

block 把一段连续 mask 声明为可验证的业务单元，但不会创建可独立聚焦的 UI 分段。使用 `{name}` 引用：

```ts
const blocks: MaskBlockDefinitions = {
  region: {
    kind: 'enum',
    values: ['CN', 'US', 'JP'],
  },
  month: {
    kind: 'range',
    length: 2,
    min: 1,
    max: 12,
  },
  serial: {
    kind: 'pattern',
    mask: 'LL00',
    placeholderCharacter: '·',
  },
}

const code = new RenderMaskedTextEdit({
  mask: '{region}-{month}-{serial}',
  blocks,
  promptMode: 'always',
  overwriteMode: 'replace',
})
```

支持三种 block：

| kind | 规则 |
| --- | --- |
| `'pattern'` 或省略 | 使用 block 内的 `mask` 和全局 token definitions。 |
| `'range'` | 固定 `length` 的非负整数，必须在 `min` 与 `max` 之间；允许仍可能组成合法值的中间前缀。 |
| `'enum'` | `values` 必须非空且长度一致；输入前缀必须至少匹配一个枚举值。`caseSensitive: false` 可忽略大小写。 |

非法增量按字符拒绝。例如两位月份范围 `01–12` 接受前缀 `0`、`1`，拒绝前缀 `2`；输入 `13` 时保留可继续输入的 `1`，拒绝 `3`。

raw value 是不含分隔符的连续字符串，不能表达“前置 block 留空、后置 block 仍有值”的空洞。为避免删除时把后续 block 的字符错误前移，当后续 block 已经填写时，组件会拒绝删除前置 block 的单个槽位；此时应使用 `overwriteMode: 'replace'` 直接覆盖目标槽位，或者清空整个字段。最后一个已填写 block 内仍可正常删除。

block 名称使用 ASCII 字母开头，后续可包含字母、数字和下划线，并且只能引用一次；未知引用、重复引用、未闭合引用、零槽位 pattern 和其他不合法定义会在构造时抛错。启用 blocks 后，字面花括号写为 `\\{` 和 `\\}`。首期不支持嵌套 block、跨 block 联合校验或独立 block 焦点。

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `mask` | `string` | 必填 | 固定格式。必须非空，并至少包含一个内置或自定义 token。 |
| `value` | `string` | `''` | 初始 raw value。 |
| `definitions` | `MaskTokenDefinitions` | 内置定义 | 新增或覆盖 token 定义。 |
| `blocks` | `MaskBlockDefinitions` | `undefined` | `{name}` 引用的 pattern、range 或 enum block。 |
| `promptMode` | `'never' \| 'focused' \| 'always'` | `'never'` | 未填写槽位的视觉 guide 可见性。 |
| `promptCharacter` | `string` | `'_'` | 全局 guide 字符，必须是一个 Unicode code point。 |
| `overwriteMode` | `'insert' \| 'replace'` | `'insert'` | 无选区输入时插入还是覆盖后续槽位。 |
| `placeholder` | `string` | `''` | 空值提示。不是 mask prompt character。 |
| `readonly` | `boolean` | `false` | 可聚焦和选择，但不能修改、粘贴或清除。 |
| `disabled` | `boolean` | `false` | 不可聚焦和编辑。 |
| `status` | `FormFieldStatus` | `'default'` | 字段状态色。 |
| `helperText` | `string` | `''` | 字段下方的帮助或错误文字。 |
| `prefixText` | `string` | `''` | mask 显示区域前的装饰文本，不属于 raw/display value。 |
| `suffixText` | `string` | `''` | mask 显示区域后的装饰文本，不属于 raw/display value。 |
| `clearable` | `boolean` | `false` | 非空、非只读、非禁用时显示清除按钮。 |
| `fieldHeight` | `number` | 主题默认高度 | 输入主体高度，不包含 `helperText`。 |
| `onChange` | `(value: string, details: MaskValue) => void` | `undefined` | 用户输入、粘贴、删除或清除完成一次规范化后触发。 |
| `onSubmit` | `(value: string, details: MaskValue) => void` | `undefined` | 按 Enter 时触发。 |
| `onBlur` | `(value: string, details: MaskValue) => void` | `undefined` | 输入框失去焦点时触发。 |

构造 `MaskEngine` 时，空 mask 或不包含任何 token 的 mask 会直接抛出错误，避免生成一个看似可编辑、实际上没有输入槽位的字段。

## MaskValue

```ts
interface MaskValue {
  readonly raw: string
  readonly display: string
  readonly complete: boolean
  readonly rawToDisplay: readonly number[]
  readonly displayToRaw: readonly number[]
  readonly blocks?: Readonly<Record<string, MaskBlockState>>
}
```

| 字段 | 说明 |
| --- | --- |
| `raw` | 已接受的 raw value。 |
| `display` | 当前格式化文本。 |
| `complete` | 最后一个必填槽位是否已经填写。可选尾部槽位为空时仍可为 `true`。 |
| `rawToDisplay` | raw 光标边界到 display 光标边界的映射，索引和值都使用 JavaScript 的 UTF-16 code unit 偏移。长度为 `raw.length + 1`。 |
| `displayToRaw` | display 光标边界到 raw 光标边界的映射，索引和值都使用 JavaScript 的 UTF-16 code unit 偏移。长度为 `display.length + 1`。 |
| `blocks` | 配置 named blocks 时提供；每项包含 block 的 `raw`、`complete` 和 `valid`。 |

普通表单通常只使用 `raw`、`display` 和 `complete`。两个位置映射主要供自定义编辑宿主、诊断和精确恢复选区使用。编辑器按完整 code point 占用一个 mask 槽位；如果浏览器给出的选区落在代理对内部，替换和删除会安全地归到该槽位边界。

这里承诺的是 Unicode code point，而不是用户感知的 grapheme cluster。由多个 code point 组成的 emoji、变音组合或复杂文字簇会占用多个槽位；需要按字素簇编辑时，应使用专门的文本编辑组件。

## 属性和方法

| API | 类型 | 说明 |
| --- | --- | --- |
| `value` | `string` | 当前 raw value。可读写；写入时重新规范化，但不触发回调。 |
| `displayValue` | `string` | 当前格式化显示值，只读。 |
| `complete` | `boolean` | 当前是否已填写全部必填槽位，只读。 |
| `engine` | `MaskEngine` | 当前组件使用的 mask 引擎，只读。mask 在组件构造后不可替换。 |
| `textBox` | `RenderTextBox` | 内部文本输入对象，供诊断和高级宿主使用。普通业务不应直接改它的 `value`。 |
| `promptMode` | `MaskPromptMode` | 构造时确定的 guide 可见模式，只读。 |
| `promptCharacter` | `string` | 构造时确定的 guide 字符，只读。 |
| `overwriteMode` | `MaskOverwriteMode` | 构造时确定的编辑模式，只读。 |
| `onChange` | 回调或 `undefined` | 可在运行时替换。 |
| `onSubmit` | 回调或 `undefined` | 可在运行时替换。 |
| `onBlur` | 回调或 `undefined` | 可在运行时替换。 |
| `placeholder` | `string` | 提示文字。 |
| `readonly` | `boolean` | 只读状态。 |
| `disabled` | `boolean` | 禁用状态。 |
| `status` | `FormFieldStatus` | 字段状态。 |
| `helperText` | `string` | 帮助或错误文字。 |
| `clearable` | `boolean` | 是否允许清除。 |
| `isFocused` | `boolean` | 当前是否拥有输入焦点，只读。 |
| `reset(value = '')` | `void` | 使用新的 raw value 重置字段和选区，不触发回调。 |
| `focusIn()` | `void` | 进入输入焦点。通常由焦点系统调用。 |
| `focusOut()` | `void` | 结束输入并触发 `onBlur`。通常由焦点系统调用。 |

不要直接写 `edit.textBox.value`。这会绕过 raw/display 同步；业务应写 `edit.value` 或调用 `reset()`。

## MaskEngine

`MaskEngine` 是无界面的纯值工具，可用于 DataGrid 编辑适配、批量格式化和单元测试：

```ts
const engine = new MaskEngine('000-000')

engine.formatRaw('1234').display
// '123-4'

engine.normalize('123-456').raw
// '123456'

engine.guide('123')
// '123-___'
```

| API | 说明 |
| --- | --- |
| `mask` | 原始 mask 字符串。 |
| `definitions` | 合并后的 token 定义。 |
| `blockDefinitions` | 构造时传入的 block 定义；未配置时为 `undefined`。 |
| `capacity` | 可编辑槽位总数。 |
| `formatRaw(raw)` | 按 raw value 生成 `MaskValue`。 |
| `normalize(value)` | 规范化可能包含 mask 固定字符的显示文本，生成 `MaskValue`。纯 raw value 应使用 `formatRaw()`。 |
| `normalizeDisplay(display, start?, end?)` | 规范化显示文本，并返回修正后的选区。 |
| `guide(raw, promptCharacter?)` | 返回完整视觉 guide 文本，不改变 raw/display。 |
| `replace(display, start, end, text, { mode }?)` | 按 mask 槽位插入或覆盖显示选区。 |
| `delete(display, start, end, direction)` | 删除选区、前一个槽位或后一个槽位。 |

`normalizeDisplay`、`replace` 和 `delete` 返回 `MaskEditResult`，它在 `MaskValue` 基础上增加 `selectionStart` 和 `selectionEnd`。

## 键盘、粘贴和 IME

| 操作 | 行为 |
| --- | --- |
| 普通输入 | 只保留符合当前槽位和 block 前缀规则的字符；按 `overwriteMode` 插入或覆盖，并自动插入固定字符。 |
| Backspace | 删除选区；没有选区时删除前一个值槽位，不会卡在分隔符上。named block 会阻止字符跨 block 边界前移。 |
| Delete | 删除选区；没有选区时删除后一个值槽位。named block 会阻止字符跨 block 边界前移。 |
| 粘贴 | 替换当前选区，过滤无效字符，重新计算 display value 和光标。 |
| Enter | 触发 `onSubmit`，随后按基础 TextBox 行为退出焦点。 |
| Escape | 退出焦点。 |
| 方向键、全选、复制、剪切 | 复用 TextBox 的选区和共享输入器行为。 |
| `Ctrl/Cmd + Z` | 撤销最近一次已生效的 mask 编辑；最多保留 100 个历史快照。 |
| `Ctrl/Cmd + Shift + Z`、`Ctrl + Y` | 重做最近一次撤销。 |
| IME composition update | 只显示输入法组合过程，不改 raw value。 |
| IME composition end | 按当前 token 规则接收或丢弃最终字符；整个 composition 作为一次历史事务。只有 raw/display 实际变化时才触发 `onChange`。 |

`L`、`?`、`A`、`a` 使用 Unicode 字母规则，所以可以接受中文。数字 token 会在 IME 确认后拒绝中文输入。

## 回调时机

- `onChange` 的第一参数始终是 raw value。
- `details` 是同一时刻的完整 `MaskValue`。
- 固定字符插入、无效字符过滤和选区修正都在回调之前完成。
- 只有规范化后的值实际变化时才触发 `onChange`；被 mask 完全拒绝的输入不会产生不变值通知。
- 程序写入 `value` 和调用 `reset()` 不触发 `onChange`，同时会清空当前撤销/重做历史，避免撤销回到已经失效的外部状态。
- `onSubmit` 和 `onBlur` 会先根据当前显示文本刷新 raw/display，再执行回调。

## 只读和禁用

| 状态 | 可聚焦 | 可选择/复制 | 可编辑 | 可清除 |
| --- | --- | --- | --- | --- |
| 正常 | 是 | 是 | 是 | 取决于 `clearable` |
| `readonly` | 是 | 是 | 否 | 否 |
| `disabled` | 否 | 否 | 否 | 否 |

## 当前边界

- mask 是构造期配置，组件不提供运行时替换 mask 的 setter。mask 变化时应重建组件。
- blocks、`promptMode` 和 `overwriteMode` 也是构造期配置；变化时应重建组件。
- 不内置正负数、小数、千分位、日期合法性或时间范围校验；这些应由对应的专业输入组件处理。
- 可选槽位采用顺序填充，推荐只把可选 token 放在末尾。
- 未配置 blocks 时，`complete` 只表示必填槽位已填满；配置后还要求每个 block 完整且有效。跨 block 的业务关系仍需业务校验。
- 当前没有作为 DataGrid 内置列编辑类型；需要表格内使用时，应由后续明确的 Grid editor contract 接入。

## 相关组件

- [TextBox](./text-box.md)
- [NumberInput](./number-input.md)
- [TimeEdit](./time-edit.md)
- [ButtonEdit](./button-edit.md)
