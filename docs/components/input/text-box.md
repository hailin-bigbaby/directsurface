# TextBox 文本输入

> **通用布局能力**：`RenderTextBox`、`RenderPasswordField` 和 `RenderSearchBox` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；`fieldHeight` 只表示输入主体高度，不再代表组件总高度。详见[组件通用布局属性](../common-layout-properties.md)。

DirectSurface UI 的单行文本输入公共类名是 `RenderTextBox`。本页同时说明基于它封装的 `RenderPasswordField` 和 `RenderSearchBox`。

`RenderTextBox` 适合表单字段、查询条件、简短文本编辑、带前后缀的单行输入。它通过框架统一的 `InputComposer` 承接键盘、粘贴和中文 IME 输入，使用共享的输入焦点、选区、光标和剪贴板机制。

## API 总览

主类：

- `RenderTextBox`
- `RenderPasswordField`
- `RenderSearchBox`

相关 public type：

- `FormFieldStatus`
- `IconName`
- `TextBoxAction`
- `TextBoxInputAdapter`
- `TextBoxEditContext`
- `TextBoxEditResult`
- `TextBoxEditSource`

导入：

```ts
import {
  RenderPasswordField,
  RenderSearchBox,
  RenderTextBox,
  type FormFieldStatus,
  type IconName,
  type TextBoxAction,
  type TextBoxInputAdapter,
} from 'directsurface'
```

`RenderTextBox`、`RenderPasswordField` 和 `RenderSearchBox` 的构造参数是公开 options 对象，但当前没有单独导出的 options 类型。业务代码直接按本文的参数表传入对象。

## 何时使用

- 单行文本输入，例如姓名、编码、关键字、备注短文本。
- 查询条件输入。
- 带前缀、后缀、清除按钮或尾部图标的输入框。
- 密码输入，使用 `RenderPasswordField`。
- 搜索输入，使用 `RenderSearchBox`。

不适合：

- 多行文本，使用 [TextArea](./text-area.md)。
- 几十万行源码、JSON、日志，使用 [PlainTextEditor](../visualization/plain-text-editor.md)。
- 数字输入，使用 [NumberInput](./number-input.md)。
- 日期时间输入，使用 [DatePicker](./date-picker.md)。
- 下拉选择，使用 [ComboBox](../selector/combo-box.md) 或相关 selector 组件。

## 最小示例

```ts
import { RenderTextBox } from 'directsurface'

const itemFormState = {
  itemName: '',
}

const itemNameField = new RenderTextBox({
  value: itemFormState.itemName,
  placeholder: '输入姓名',
  onChange: value => {
    itemFormState.itemName = value
  },
})
```


## 组件关系

| 组件 | 用途 | 继承关系 |
| --- | --- | --- |
| `RenderTextBox` | 通用单行文本输入。 | 直接继承 `RenderBox`。 |
| `RenderPasswordField` | 密码输入，提供眼睛图标和显示/隐藏密码。 | 继承 `RenderTextBox`。 |
| `RenderSearchBox` | 搜索输入，内置搜索图标、默认 clearable、Enter 搜索后保留焦点。 | 继承 `RenderTextBox`。 |

## RenderFormField 字段壳

`RenderFormField` 不是输入控件，而是输入控件外层的字段语义壳。它把 label、必填标记、编辑器、单位、meta 文本和校验反馈排在稳定的字段行中；实际值、输入事件和提交逻辑仍由 `child` 维护。

完整字段配置、校验展示、label 布局和动态字段 API 统一见 [FormPanel 与 FormField](./form-panel.md)。本页只说明 TextBox 与字段壳的组合关系，不重复维护 FormField 参数表。


## RenderTextBox 构造参数

`new RenderTextBox(options)` 的 `options`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `value` | `string` | `''` | 初始值。会按 `maxLength` 截断。 |
| `placeholder` | `string` | `''` | 空值时显示的提示文本。 |
| `onChange` | `(value: string) => void` | `undefined` | 值变化时触发。普通输入、中文输入确认、粘贴、清除按钮都会触发。 |
| `onSubmit` | `(value: string) => void` | `undefined` | 按 Enter 时触发。基础 TextBox 触发后默认失焦。 |
| `onKeyDown` | `(event: KeyboardEvent) => boolean \| void` | `undefined` | 焦点系统派发按键时先调用。返回 `true` 会消费事件，阻止输入框默认 Enter/Escape 等处理。 |
| `password` | `boolean` | `false` | 是否按密码模式显示。密码模式用圆点显示，内部真实 `value` 不变。 |
| `readonly` | `boolean` | `false` | 只读。可获得焦点和选择文本，但不会接受输入、粘贴或清除。 |
| `disabled` | `boolean` | `false` | 禁用。不可聚焦、不可输入、不可清除。 |
| `status` | `FormFieldStatus` | `'default'` | 状态边框颜色。可选 `'default'`、`'success'`、`'warning'`、`'error'`。 |
| `helperText` | `string` | `''` | 输入框下方帮助或错误文案。会增加组件高度。 |
| `prefixText` | `string` | `''` | 输入区域左侧固定文本，例如 `@`、`http://`。 |
| `suffixText` | `string` | `''` | 输入区域右侧固定文本，例如 `.com`、单位。 |
| `clearable` | `boolean` | `false` | 有值、非禁用、非只读时显示清除按钮。 |
| `maxLength` | `number` | `undefined` | 最大字符数。非有限数字表示不限制；传入小数会向下取整；小于 0 按 0 处理。 |
| `trailingIcon` | `IconName` | `undefined` | 尾部图标，例如 `search`、`eye`。 |
| `onTrailingIconClick` | `() => void` | `undefined` | 点击尾部图标时触发。 |
| `actions` | `readonly TextBoxAction[]` | `[]` | 尾部动作区域。适合底层组件复用；一般业务字段优先使用 [ButtonEdit](./button-edit.md)。 |
| `inputAdapter` | `TextBoxInputAdapter` | `undefined` | 高级值适配器，可在输入、粘贴、IME 确认和键盘编辑后统一规范值与选区。 |
| `fieldHeight` | `number` | 主题默认高度 | 输入框主体高度。不包含 `helperText` 增加的高度。组件总高度统一使用 `RenderBox.height`。 |

```ts
const emailField = new RenderTextBox({
  value: '',
  placeholder: 'name',
  prefixText: '@',
  suffixText: '.organization.local',
  clearable: true,
  maxLength: 40,
  status: 'default',
  helperText: '',
  onChange: value => {
    state.emailName = value
  },
})
```

## RenderTextBox 属性

| 属性 | 类型 | 可写 | 说明 |
| --- | --- | --- | --- |
| `value` | `string` | 是 | 当前值。赋值会按 `maxLength` 截断；聚焦中会同步到共享输入器。 |
| `placeholder` | `string` | 是 | 提示文本。直接修改后如需立即刷新，应触发重绘。 |
| `onChange` | `(value: string) => void \| undefined` | 是 | 值变化回调。 |
| `onSubmit` | `(value: string) => void \| undefined` | 是 | Enter 提交回调。 |
| `onKeyDown` | `(event: KeyboardEvent) => boolean \| void \| undefined` | 是 | 自定义按键拦截。返回 `true` 表示已处理。 |
| `password` | `boolean` | 是 | 是否用密码圆点绘制。直接修改后如需立即刷新，应触发重绘。 |
| `disabled` | `boolean` | 是 | 禁用状态。设为 `true` 会清理 hover、按下态并失焦。 |
| `readonly` | `boolean` | 是 | 只读状态。聚焦中设为 `true` 会清理中文组合输入并恢复真实值。 |
| `status` | `FormFieldStatus` | 是 | 状态色。赋值会重绘。 |
| `helperText` | `string` | 是 | 帮助文案。赋值会重新 layout。 |
| `prefixText` | `string` | 是 | 前缀文本。赋值会重绘。 |
| `suffixText` | `string` | 是 | 后缀文本。赋值会重绘。 |
| `clearable` | `boolean` | 是 | 是否显示清除按钮。赋值会重绘。 |
| `maxLength` | `number \| null` | 是 | 最大长度。设为 `null` 表示不限制；修改时会重新截断当前值。 |
| `trailingIcon` | `IconName \| null` | 是 | 尾部图标。赋值会重绘。 |
| `onTrailingIconClick` | `() => void \| undefined` | 是 | 尾部图标点击回调。 |
| `actions` | `readonly TextBoxAction[]` | 是 | 当前尾部动作数组。重新赋值会重新计算布局并重绘。 |
| `inputAdapter` | `TextBoxInputAdapter \| undefined` | 是 | 当前输入适配器。替换时会清空组件维护的撤销/重做历史。 |
| `fieldHeight` | `number \| undefined` | 是 | 输入框主体高度。赋值会重新 layout。 |
| `isFocused` | `boolean` | 否 | 当前是否拥有焦点。 |

`placeholder`、`onChange`、`onSubmit`、`password` 是公开字段，不是 setter。运行时直接改这些字段时，框架不会自动知道视觉发生变化；如果改的是会影响绘制的字段，业务应重新触发一次布局或重绘，或者优先在构造阶段确定。

## RenderTextBox 方法

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `reset(newValue = '')` | `void` | 重置值、清空横向滚动、把光标放到末尾；聚焦中会同步输入器。 |
| `focusIn()` | `void` | 请求进入焦点。通常由 `FocusManager` 调用，业务一般不直接调用。 |
| `focusOut()` | `void` | 退出焦点并结束输入 session。通常由 `FocusManager` 调用。 |
| `dispose()` | `void` | 释放指针捕获、结束输入、注销焦点、释放输入控制器。 |

```ts
const resettableField = new RenderTextBox({
  value: 'old',
})

resettableField.reset('new')
```

## 输入和键盘行为

| 操作 | 行为 |
| --- | --- |
| 点击输入框 | 获得焦点，把光标定位到点击字符附近。 |
| 水平拖动 | 建立或扩展选区。 |
| 垂直拖动 | 让出手势，不捕获滚动容器的垂直滚动。 |
| 普通输入 | 更新 `value`，触发 `onChange`。 |
| 中文 IME 输入 | composition update 只刷新显示；composition end 后写入最终值并触发 `onChange`。 |
| 粘贴 | 读取剪贴板文本，阻止浏览器原生大文本落入 textarea，将换行转换为空格后替换当前选区。 |
| `Ctrl/Cmd + A` | 全选文本。 |
| `Ctrl/Cmd + C` | 复制选区。 |
| `Ctrl/Cmd + X` | 剪切选区；非只读时同步 `value` 并触发 `onChange`。 |
| `Ctrl/Cmd + Z` | 普通 TextBox 同步浏览器 textarea 的撤销结果；配置 `inputAdapter` 后由组件撤销最近一次已生效编辑。 |
| `Ctrl/Cmd + Shift + Z`、`Ctrl + Y` | 配置 `inputAdapter` 后重做最近一次撤销。 |
| Enter | 触发 `onSubmit`。基础 `RenderTextBox` 默认提交后失焦。 |
| Escape | 清除当前焦点。 |
| Tab / Shift+Tab | 由 `FocusManager` 在焦点范围内移动焦点。 |

如果设置了 `onKeyDown`，焦点系统会先调用它。返回 `true` 时会调用 `preventDefault()` / `stopImmediatePropagation()`，输入框自己的 Enter 提交、Escape 失焦等默认处理不会继续执行。输入法组字期间的按键会先被识别并让给原生输入法，不会调用业务 `onKeyDown`，也不会误触发 `onSubmit`。典型用途是搜索框结果列表的 `ArrowUp` / `ArrowDown` / `Enter` 导航。普通提交仍优先使用 `onSubmit`；页面级快捷键优先放在父级 render object 的 `handleUnhandledKeyDownFromDescendant` / `handleUnhandledEnterFromDescendant` 中。

配置 `inputAdapter` 后，TextBox 会维护最多 100 个编辑快照。一次粘贴、剪切、清除或完整 IME composition 各记为一次事务；适配后值没有实际变化时，不写历史也不触发 `onChange`。业务直接写入 `value`、调用 `reset()` 或替换 `inputAdapter` 会建立新的外部基线并清空撤销/重做历史，避免撤销回到已经失效的业务状态。

## 清除按钮和尾部图标

清除按钮显示条件：

- `clearable === true`
- `value.length > 0`
- 非 `disabled`
- 非 `readonly`

点击清除按钮会：

- 获得焦点。
- 把 `value` 设为空字符串。
- 光标定位到 0。
- 触发 `onChange('')`。

清除入口与尾部 `actions` 都按 click-on-up 处理并参与 `GestureArena`。按下只进入候选状态；外层滚动获胜、移出命中区域、指针取消、组件禁用或释放时不会执行动作。一个指针持有候选动作时，其他指针不能代替它提交或取消。

尾部图标由 `trailingIcon` 和 `onTrailingIconClick` 控制。点击尾部图标时组件会先获得焦点，再触发回调。`RenderPasswordField` 和 `RenderSearchBox` 都是基于尾部图标实现自己的行为。

```ts
const trailingIconField = new RenderTextBox({
  value: 'keyword',
  trailingIcon: 'search',
  clearable: true,
  onTrailingIconClick: () => {
    service.search(state.keyword)
  },
  onChange: value => {
    state.keyword = value
  },
})
```

## 高级输入适配器和尾部动作

`TextBoxInputAdapter` 面向 MaskedTextEdit 这类需要“值规范化 + 精确选区恢复”的底层组件。普通表单不要为了格式化显示随意接入；优先使用已经封装好的专业输入组件。

```ts
interface TextBoxInputAdapter {
  transform(
    value: string,
    context: TextBoxEditContext,
  ): TextBoxEditResult

  handleKeyDown?(
    event: KeyboardEvent,
    context: TextBoxEditContext,
  ): TextBoxEditResult | undefined
}

interface TextBoxEditContext {
  readonly value: string
  readonly selectionStart: number
  readonly selectionEnd: number
  readonly previousSelectionStart: number
  readonly previousSelectionEnd: number
  readonly source: 'input' | 'composition' | 'paste' | 'keyboard'
}

interface TextBoxEditResult {
  readonly value: string
  readonly selectionStart: number
  readonly selectionEnd: number
}
```

`transform()` 必须返回规范化后的值和选区，选区使用 JavaScript 字符串的 UTF-16 偏移。`selectionStart/End` 是浏览器编辑后的选区，`previousSelectionStart/End` 是编辑发生前的选区，适配器可据此实现覆盖输入。`handleKeyDown()` 只在适配器需要接管 Backspace、Delete 等编辑键时返回结果；返回 `undefined` 会继续执行 TextBox 默认行为。

TextBox 还提供视觉尾部 guide，主要供 MaskedTextEdit 等框架组件复用：

```ts
const field = new RenderTextBox({
  value: '12-',
  guideText: '__',
  guideVisibility: 'focused', // 'always' | 'focused'
})
```

`guideText` 只在值文本尾部绘制，不进入 `value`、共享 textarea、选区和复制内容。存在可见 guide 时不会同时绘制普通 placeholder；密码输入不会绘制 guide。普通业务表单优先使用封装了规则的专业组件，而不是自行维护 guide。

`TextBoxAction` 与 [ButtonEdit](./button-edit.md) 的 `ButtonEditButton` 字段一致，支持 `label`、`icon`、`tooltip`、`disabled`、`width` 和 `onClick`。直接给 TextBox 配置 `actions` 主要用于框架内部复用；业务需要带动作输入框时，使用语义更明确的 `RenderButtonEdit`。旧的 `trailingIcon` / `onTrailingIconClick` 仍保持兼容，并排在 `actions` 之后。

## 只读和禁用

| 状态 | 可聚焦 | 可选择 | 可输入 | 可清除 | 典型用途 |
| --- | --- | --- | --- | --- | --- |
| 正常 | 是 | 是 | 是 | 取决于 `clearable` | 普通录入。 |
| `readonly` | 是 | 是 | 否 | 否 | 展示可复制字段，或暂时禁止修改。 |
| `disabled` | 否 | 否 | 否 | 否 | 业务条件下不可操作字段。 |

如果字段需要提交表单但当前不可修改，优先使用 `readonly`；如果字段不应参与交互，使用 `disabled`。

## Placeholder 和状态颜色

placeholder 使用弱于真实值的颜色，避免和真实值混淆。状态色通过 `status` 控制：

| 状态 | 用途 |
| --- | --- |
| `'default'` | 正常。 |
| `'success'` | 校验通过。 |
| `'warning'` | 有风险但可继续。 |
| `'error'` | 校验失败。 |

`helperText` 可以和状态配合显示错误或提示。设置 `helperText` 会增加组件高度，布局容器需要给它足够空间。

```ts
const validatedField = new RenderTextBox({
  value: '',
  placeholder: '输入文档号',
  status: 'error',
  helperText: '文档号不能为空',
})
```

## RenderPasswordField

`RenderPasswordField` 是 `RenderTextBox` 的密码封装。它默认隐藏密码，尾部显示眼睛图标，点击后在隐藏和显示之间切换。


构造参数：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `value` | `string` | 必填 | 初始密码值。 |
| `placeholder` | `string` | `undefined` | 提示文本。 |
| `onChange` | `(value: string) => void` | `undefined` | 值变化回调。 |
| `onSubmit` | `(value: string) => void` | `undefined` | Enter 提交回调。 |
| `readonly` | `boolean` | `false` | 只读。 |
| `disabled` | `boolean` | `false` | 禁用。 |
| `status` | `FormFieldStatus` | `'default'` | 状态色。 |
| `helperText` | `string` | `''` | 帮助文案。 |
| `prefixText` | `string` | `''` | 前缀文本。 |
| `suffixText` | `string` | `''` | 后缀文本。 |
| `clearable` | `boolean` | `false` | 是否显示清除按钮。 |
| `maxLength` | `number` | `undefined` | 最大长度。 |
| `revealed` | `boolean` | `false` | 初始是否明文显示。 |
| `onRevealChange` | `(revealed: boolean) => void` | `undefined` | 显示/隐藏状态变化回调。 |
| `fieldHeight` | `number` | 主题默认高度 | 输入框主体高度。总高度、边距和对齐使用通用 `RenderBox` 属性。 |

属性和方法：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `revealed` | `boolean` | 当前是否明文显示。可读写，写入时会触发 `onRevealChange`。 |
| `onRevealChange` | `(revealed: boolean) => void \| undefined` | reveal 状态变化回调。 |
| `showPassword()` | `void` | 明文显示密码。 |
| `hidePassword()` | `void` | 隐藏密码。 |
| `toggleReveal()` | `void` | 切换显示状态。 |

```ts
const passwordField = new RenderPasswordField({
  value: '',
  placeholder: '输入密码',
  clearable: true,
  onChange: value => {
    state.password = value
  },
  onRevealChange: revealed => {
    state.passwordRevealed = revealed
  },
})
```

## RenderSearchBox

`RenderSearchBox` 是搜索场景的单行输入。它默认 placeholder 为 `搜索...`，默认 `clearable: true`，尾部图标固定为 `search`。

构造参数：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `value` | `string` | 必填 | 搜索关键字。 |
| `placeholder` | `string` | `'搜索...'` | 提示文本。 |
| `onChange` | `(value: string) => void` | `undefined` | 输入变化回调。 |
| `onSearch` | `(value: string) => void` | `undefined` | 点击搜索图标或按 Enter 时触发。 |
| `onKeyDown` | `(event: KeyboardEvent) => boolean \| void` | `undefined` | 自定义键盘导航。返回 `true` 会阻止默认搜索提交。 |
| `readonly` | `boolean` | `false` | 只读。 |
| `disabled` | `boolean` | `false` | 禁用。 |
| `status` | `FormFieldStatus` | `'default'` | 状态色。 |
| `helperText` | `string` | `''` | 帮助文案。 |
| `clearable` | `boolean` | `true` | 是否显示清除按钮。 |
| `maxLength` | `number` | `undefined` | 最大长度。 |

属性和方法：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `onSearch` | `(value: string) => void \| undefined` | 搜索回调。 |
| `search()` | `void` | 使用当前 `value` 主动触发 `onSearch`。 |

`RenderSearchBox` 覆盖了基础提交行为：按 Enter 会触发搜索，但不会自动失焦。这样连续按 Enter 可以执行“下一处搜索”等业务逻辑，除非用户主动点击其他可聚焦组件或按 Tab 移动焦点。

```ts
const orderSearchBox = new RenderSearchBox({
  value: '',
  placeholder: '搜索订单号或姓名',
  onChange: value => {
    state.orderQuery = value
  },
  onSearch: value => {
    service.search(value)
  },
})

orderSearchBox.search()
```


如果搜索框需要驱动外部结果列表，可以用 `onKeyDown` 拦截方向键和 Enter：

```ts
const menuSearchBox = new RenderSearchBox({
  value: '',
  placeholder: '搜索菜单',
  onChange: value => {
    state.query = value
    state.activeIndex = 0
  },
  onKeyDown: event => {
    if (event.key === 'ArrowDown') {
      if (state.results.length === 0) return true
      state.activeIndex = Math.min(state.activeIndex + 1, state.results.length - 1)
      return true
    }
    if (event.key === 'ArrowUp') {
      if (state.results.length === 0) return true
      state.activeIndex = Math.max(state.activeIndex - 1, 0)
      return true
    }
    if (event.key === 'Enter') {
      const result = state.results[state.activeIndex]
      if (result) openResult(result)
      return true
    }
    return false
  },
})
```

## 搜索下一处模式

对于 MarkdownViewer、PlainTextEditor、DataGrid 列搜索这类“同一个关键词连续跳转”的场景，推荐：

- `onChange` 更新关键字并重置当前结果。
- `onSearch` 执行下一处。
- Enter 不失焦，由 `RenderSearchBox` 默认行为保证。

```ts
const contentMarkdownViewer = new RenderMarkdownViewer({
  markdown: '# 文档\n\n正文',
})

const contentSearchBox = new RenderSearchBox({
  value: '',
  placeholder: '搜索当前文档',
  onChange: value => {
    state.contentQuery = value
    contentMarkdownViewer.searchQuery = value
  },
  onSearch: () => {
    const results = contentMarkdownViewer.getSearchResults()
    if (results.length === 0) return
    contentMarkdownViewer.scrollToSearchResult(results[0]!.id)
  },
})
```

## 布局和尺寸

- 默认宽度：父约束为无限宽时使用 `200`。
- 默认高度：来自主题 `TextInputStyleTokens.height`。
- `helperText` 会让整体高度增加 `helperGap + helperLineHeight`。
- `fieldHeight` 只控制输入框主体高度，不直接控制 `helperText` 高度；`height` 是所有组件一致的总高度约束。
- prefix、suffix、clear button、trailing icon 会占用输入行内空间，值文本会在剩余区域横向滚动。

在表单布局中，推荐用 [FormPanel](../../layouts.md)、[GridPanel](../../layouts.md) 或字段包装组件控制 label 和列宽，不要靠给 TextBox 写固定坐标。

## 生命周期

`dispose()` 会：

- 释放正在等待或已捕获的指针手势。
- 结束当前输入 session。
- dispose 内部输入控制器。
- 从 `FocusManager` 注销。
- 调用父类 `dispose()`。

页面关闭、弹窗关闭、tab 销毁时，应随页面一起释放输入组件，避免共享输入器或焦点管理器继续持有引用。

## 常见问题

### 为什么 SearchBox 按 Enter 后不失焦？

搜索通常需要连续按 Enter 跳转下一处。只有用户显式点击其他组件或按 Tab 移动焦点时，才应该丢失焦点。基础 `RenderTextBox` 仍保持 Enter 后失焦的表单提交行为。

### 为什么粘贴会把换行变成空格？

这是单行输入框。粘贴多行文本时，组件会把 `\r\n`、`\r`、`\n` 归一化为空格，并替换当前选区。

### 为什么大文本不能直接放 TextBox？

TextBox 是单行输入，聚焦后需要同步共享 textarea、测量光标和滚动位置。大文本会影响浏览器 textarea 和测量成本。大文本、JSON、日志应使用 [PlainTextEditor](../visualization/plain-text-editor.md)。

### readonly 和 disabled 应该怎么选？

需要用户能复制或查看完整内容时用 `readonly`。完全不可交互、不可聚焦时用 `disabled`。

### 为什么修改 `placeholder` 后没有立刻刷新？

`placeholder` 是公开字段，不是 setter。构造后动态修改时，业务需要让页面触发重绘；常规表单中更推荐在构造阶段传入固定 placeholder。

## 相关组件

- [TextArea](./text-area.md)：多行文本输入。
- [PlainTextEditor](../visualization/plain-text-editor.md)：大文本、代码、JSON、日志。
- [NumberInput](./number-input.md)：数字输入。
- [DatePicker](./date-picker.md)：日期时间输入。
- [ComboBox](../selector/combo-box.md)：单选下拉。
- [DataGrid](../data/data-grid.md)：查询结果表格。
- [MarkdownViewer](../visualization/markdown-viewer.md)：文档搜索和阅读。
