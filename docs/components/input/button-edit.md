# ButtonEdit 带动作按钮的文本输入

> **通用布局能力**：`RenderButtonEdit` 支持 `width`、`height`、min/max、`margin` 和槽位对齐；`fieldHeight` 只控制输入主体高度。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderButtonEdit` 是尾部带一个或多个动作按钮的单行文本输入。它适合“值仍然是文本，但需要从外部选择、查找、生成或打开”的业务字段，例如文件路径、项目编码、模板名称和对象引用。

组件继承 `RenderTextBox`，输入、选区、粘贴、IME、状态和清除行为都与 [TextBox](./text-box.md) 一致。尾部按钮是同一 Canvas 控件中的轻量动作区域，不会为每个按钮创建独立 DOM 或独立输入组件。

## API 总览

主类：

- `RenderButtonEdit`

相关 public type：

- `RenderButtonEditOptions`
- `ButtonEditButton`
- `IconName`
- `FormFieldStatus`

导入：

```ts
import {
  RenderButtonEdit,
  type ButtonEditButton,
} from 'directsurface'
```

## 何时使用

适合：

- 输入文件路径，并提供“浏览”按钮。
- 输入业务编码，并提供“查找”和“清除条件”按钮。
- 展示对象名称，并通过按钮打开选择器或详情页。
- 在保持高密度单行布局的同时，为字段附加一到多个明确动作。

不适合：

- 只有一个与文本值无关的普通命令，使用 [Button](../basic/button.md) 或工具栏。
- 需要在下拉列表中选择固定选项，使用 [ComboBox](../selector/combo-box.md)。
- 需要上传文件并显示进度、失败和重试，使用 [Upload](./upload.md)。
- 需要 token、树或表格选择模型，使用对应 selector 组件。

## 最小示例

```ts
import { RenderButtonEdit } from 'directsurface'

const openTemplatePicker = (): void => {}
const pathState = {
  value: '',
}

const pathEdit = new RenderButtonEdit({
  value: pathState.value,
  placeholder: '选择或输入模板路径',
  clearable: true,
  buttons: [
    {
      key: 'browse',
      icon: 'folder-open',
      tooltip: '浏览文件',
      onClick: () => {
        openTemplatePicker()
      },
    },
  ],
  onChange: value => {
    pathState.value = value
  },
})
```

多个动作按数组顺序从左到右排列：

```ts
const openCategoryLookup = (): void => {}
const openCategoryDetail = (): void => {}
const categoryEdit = new RenderButtonEdit({
  value: '',
  placeholder: '输入或选择项目',
  buttons: [
    {
      key: 'search',
      icon: 'search',
      tooltip: '查找项目',
      onClick: openCategoryLookup,
    },
    {
      key: 'detail',
      label: '详情',
      disabled: !state.categoryId,
      onClick: openCategoryDetail,
    },
  ],
  onChange: value => {
    state.categoryText = value
  },
})
```

## ButtonEditButton

```ts
interface ButtonEditButton {
  readonly key?: string
  readonly label?: string
  readonly icon?: IconName
  readonly tooltip?: string
  readonly disabled?: boolean
  readonly width?: number
  readonly onClick?: () => void
}
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `key` | `undefined` | 业务标识。首版不参与内部状态寻址，但建议为动态按钮提供稳定 key。 |
| `label` | `undefined` | 按钮文字。 |
| `icon` | `undefined` | 内置图标名称。 |
| `tooltip` | `undefined` | 鼠标悬停提示。单个按钮禁用时仍可显示；整个字段禁用时不显示。 |
| `disabled` | `false` | 只禁用当前按钮，不影响文本输入和其他按钮。 |
| `width` | 自动计算 | 按钮命中区域宽度。有限值会限制为不小于 0。 |
| `onClick` | `undefined` | 有效点击完成时触发。 |

按钮可以只有图标、只有文字，或者同时包含图标和文字：

```ts
const buttons: ButtonEditButton[] = [
  { icon: 'search', tooltip: '查询' },
  { label: '选择' },
  { icon: 'open', label: '打开' },
]
```

建议每个按钮至少提供 `icon` 或 `label`。只提供 `onClick` 的空按钮虽然可以生成命中区域，但用户无法理解其用途。

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `value` | `string` | `''` | 初始文本值。 |
| `placeholder` | `string` | `''` | 空值提示。 |
| `buttons` | `readonly ButtonEditButton[]` | 必填 | 尾部动作按钮，按数组顺序排列。可以传空数组。 |
| `onChange` | `(value: string) => void` | `undefined` | 普通输入、IME 确认、粘贴、剪切、撤销同步或清除时触发。 |
| `onSubmit` | `(value: string) => void` | `undefined` | 按 Enter 时触发。 |
| `onBlur` | `(value: string) => void` | `undefined` | 输入框失去焦点时触发。 |
| `onKeyDown` | `(event: KeyboardEvent) => boolean \| void` | `undefined` | 自定义字段按键处理；返回 `true` 时消费按键。 |
| `readonly` | `boolean` | `false` | 文本只读；尾部动作仍然可以使用。 |
| `disabled` | `boolean` | `false` | 禁用整个字段，包括文本和全部动作按钮。 |
| `status` | `FormFieldStatus` | `'default'` | 字段状态色。 |
| `helperText` | `string` | `''` | 字段下方的帮助或错误文字。 |
| `prefixText` | `string` | `''` | 输入区域左侧固定文本。 |
| `suffixText` | `string` | `''` | 输入区域右侧固定文本。 |
| `clearable` | `boolean` | `false` | 有值、非只读、非禁用时显示清除按钮。 |
| `maxLength` | `number` | `undefined` | 最大文本长度。 |
| `fieldHeight` | `number` | 主题默认高度 | 输入主体高度，不包含 `helperText`。 |

`buttons` 是必填配置，但可以传入 `[]`。如果确定不需要任何尾部动作，应直接使用 `RenderTextBox`，避免让组件名称误导维护者。

## 属性和方法

`RenderButtonEdit` 继承 `RenderTextBox`，所以 `value`、`placeholder`、`readonly`、`disabled`、`status`、`helperText`、`clearable`、`maxLength`、`isFocused`、`reset()`、`focusIn()` 和 `focusOut()` 等 API 与 TextBox 一致。

新增的公开属性：

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `buttons` | `readonly ButtonEditButton[]` | 当前动作数组，可读写。重新赋值会重新计算布局并重绘。 |

动态更新按钮时，优先替换数组：

```ts
const openCategoryLookup = (): void => {}
const openCategoryDetail = (): void => {}
const categoryEdit = new RenderButtonEdit({ buttons: [] })

categoryEdit.buttons = [
  {
    key: 'search',
    icon: 'search',
    tooltip: '查找项目',
    onClick: openCategoryLookup,
  },
  {
    key: 'detail',
    label: '详情',
    disabled: !state.categoryId,
    onClick: openCategoryDetail,
  },
]
```

不要只原地修改已有按钮对象的 `disabled` 或 `label` 后等待界面自动更新。按钮定义是普通对象，不是响应式模型；重新设置 `buttons` 才会明确触发布局和重绘。

程序直接写 `edit.value`、调用 `reset()` 或重新设置 `buttons` 都不会触发 `onChange`。

## 按钮布局

- 按钮占用输入框尾部空间，文本 viewport 会自动缩小。
- 多个按钮按 `buttons` 数组从左到右排列。
- 未指定 `width` 时，图标按钮按字段高度计算，文字按钮按文字宽度和内边距计算。
- 同时提供图标和文字时，两者在同一个动作区域内水平排列。
- `suffixText`、清除按钮和动作区都存在时，文本区域会为它们分别预留空间。
- 字段很窄或按钮很多时，文本区域可能接近 0；已聚焦文本仍使用 TextBox 的横向滚动，但业务应给字段配置合理宽度。

`width` 控制的是按钮命中区域，不是整个 `ButtonEdit` 宽度：

```ts
const openCodePicker = (): void => {}
const codeEdit = new RenderButtonEdit({
  width: 320,
  value: '',
  buttons: [
    {
      label: '选择',
      width: 56,
      onClick: openCodePicker,
    },
  ],
})
```

## 指针和回调行为

一个按钮点击按以下顺序处理：

1. 主指针在按钮命中区域按下。
2. 非禁用按钮让字段保持或获得输入焦点，并进入 pressed 状态。
3. 主指针在同一个按钮区域释放。
4. pressed 状态清理后触发 `onClick`。

动作按钮和清除按钮都参与框架的 `GestureArena`。按下只建立候选点击；外层滚动容器赢得手势、指针被取消或组件在过程中禁用/释放时，本次动作会被取消。一个指针已经持有动作后，其他指针的 move、leave、up 不会代替它提交或取消。

因此：

- `onClick` 在 pointer-up 触发，不在 pointer-down 提前执行。
- 按下后移出按钮再释放，不触发 `onClick`。
- 按钮事件不会把点击继续当成文本定位或拖选。
- 双击动作按钮不会触发 TextBox 的“全选文本”行为。
- 真实双击包含两次完整点击序列，因此可能调用两次 `onClick`。保存、删除等不可重入动作应通过 Command 执行态或业务状态及时禁用，而不是依赖双击过滤。
- 点击已经聚焦的字段按钮不会先触发 `onBlur`；如果回调随后把焦点交给弹层或其他控件，才会按正常焦点链路触发 `onBlur`。

```ts
const refreshButtons = (): void => {}
const openLookup = async (): Promise<void> => {}
const lookupEdit = new RenderButtonEdit({
  value: state.name,
  buttons: [
    {
      icon: 'search',
      disabled: state.lookupLoading,
      onClick: async () => {
        state.lookupLoading = true
        refreshButtons()
        try {
          await openLookup()
        } finally {
          state.lookupLoading = false
          refreshButtons()
        }
      },
    },
  ],
})
```

## 键盘和 IME

文本区域完全复用 TextBox：

| 操作 | 行为 |
| --- | --- |
| 普通输入 | 更新 `value` 并触发 `onChange`。 |
| 中文 IME | composition update 保留组合态；composition end 后更新值。 |
| 粘贴 | 替换当前选区，把换行转换为空格，并遵守 `maxLength`。 |
| Enter | 触发 `onSubmit`，基础 ButtonEdit 随后失焦。 |
| Escape | 退出焦点。 |
| Tab / Shift+Tab | 由焦点系统移动到前后组件。 |
| `Ctrl/Cmd + A/C/X/Z` | 复用 TextBox 的全选、复制、剪切和撤销同步。 |

首版尾部动作不是独立焦点节点：

- Tab 不会逐个进入尾部按钮。
- 方向键不会在按钮之间导航。
- Enter 触发字段的 `onSubmit`，不会自动触发某个按钮。

如果动作必须可由键盘执行，应为字段配置明确的 `onKeyDown`，或者把业务动作注册为页面/窗口级 Command。不要默认把第一个按钮绑定到 Enter，因为 Enter 通常属于表单提交语义。

## 只读和禁用

| 状态 | 文本可聚焦/选择 | 文本可修改 | 单个可用按钮 | 清除按钮 |
| --- | --- | --- | --- | --- |
| 正常 | 是 | 是 | 可点击 | 取决于 `clearable` |
| `readonly` | 是 | 否 | 仍可点击 | 不显示 |
| `disabled` | 否 | 否 | 全部不可点击 | 不显示 |

`readonly` 不会自动禁用按钮。这是有意行为：只读值仍可能需要“打开详情”“复制路径”或“重新选择”。如果只读时某个动作也不应使用，应同时设置该按钮的 `disabled`。

单个 `button.disabled` 只影响该按钮，文本输入和其他按钮不受影响。

## Tooltip

有 `tooltip` 的按钮在鼠标进入自身命中区域时使用全局 Tooltip 服务显示提示，移动时更新位置，离开、取消或组件释放时隐藏。

- 单个按钮 `disabled: true` 时仍可以显示 tooltip，适合解释禁用原因。
- 整个字段 `disabled: true` 时不进入按钮 hover，也不会显示 tooltip。
- tooltip 不是按钮 label 的替代品。纯图标按钮应尽量提供 tooltip；文字已经足够明确时可以省略。

## 当前边界

- 尾部动作目前只提供指针交互，不是独立的键盘焦点节点。
- 不内置下拉弹层、文件选择器或查询服务；按钮只执行回调。需要文件上传时使用 [Upload](./upload.md)，需要选择器时在回调中打开相应 popup/window。
- 不提供每个按钮的 loading 动画。长任务应在回调开始后更新 `buttons`，把对应按钮设为禁用，并在页面合适位置显示进度。
- 不自动确认危险动作，也不负责防重入；优先复用业务 Command 的 `canExecute/executing` 状态。
- `buttons` 是普通不可观察配置，动态变化应重新赋值。
- ButtonEdit 仍然是文本输入，不负责验证“文本与按钮选中的业务对象是否一致”。如果字段同时保存 id 和显示名称，业务应在文本变化时清理或重新校验 id。

## 相关组件

- [TextBox](./text-box.md)
- [MaskedTextEdit](./masked-text-edit.md)
- [Upload](./upload.md)
- [ComboBox](../selector/combo-box.md)
- [Button](../basic/button.md)
