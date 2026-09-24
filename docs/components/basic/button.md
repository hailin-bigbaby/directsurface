# Button 按钮

> **通用布局能力**：`RenderButton` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；当前按钮构造器不接收这些字段，应在创建后赋值。详见[组件通用布局属性](../common-layout-properties.md)。

DirectSurface UI 的普通按钮公共类名是 `RenderButton`。它用于触发明确动作，例如保存、查询、确认、取消、打开弹窗、执行局部操作。组件绘制文字按钮外壳，支持 `default`、`primary`、`danger`、`text`、`link` 五种视觉类型，并处理 hover、pressed、focused、disabled、loading、tooltip、鼠标点击、键盘激活和手势取消。

`RenderButton` 适合“一个可读文字动作”。如果动作只用图标表达，使用 [IconButton](./icon-button.md)；如果动作需要权限、命令状态、快捷键和菜单复用，使用 [CommandButton](../command/command-button.md) 或 [CommandToolbar](../command/command-toolbar.md)。

## API 总览

主类：

- `RenderButton`

相关 public type：

- `ButtonVariant`

导入：

```ts
import { RenderButton, type ButtonVariant } from 'ds-ui'
```

`RenderButton` 的构造参数是公开 options 对象，但当前没有单独导出的按钮 options 类型。业务代码直接按本文的参数表传入对象。

## 何时使用

- 用户点击后执行明确动作。
- 表单提交、保存、查询、重置。
- 弹窗确认、取消、关闭。
- 卡片、抽屉、页面局部区域内的文字操作。
- loading 期间需要禁用按钮并显示执行中状态。

不适合：

- 只展示图标的紧凑工具按钮，使用 [IconButton](./icon-button.md)。
- 一组工具按钮需要分组、分隔符、溢出菜单，使用 [Toolbar](../command/toolbar.md)。
- 按钮状态来自命令系统、权限系统或页面命令作用域，使用 [CommandButton](../command/command-button.md)。
- 只是展示文本，不可点击，使用 [Text](./text.md)。

## 最小示例

```ts
import { RenderButton } from 'ds-ui'

const saveButton = new RenderButton({
  label: '保存',
  variant: 'primary',
  onClick: () => {
    // 执行业务保存
  },
})
```


## 构造参数

`new RenderButton(options)` 的 `options`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `label` | `string` | 必填 | 按钮显示文本。 |
| `onClick` | `() => void` | `undefined` | 鼠标点击或键盘激活时调用。 |
| `disabled` | `boolean` | `false` | 是否禁用。禁用时不响应鼠标和键盘。 |
| `loading` | `boolean` | `false` | 是否显示 loading spinner。loading 时按钮不可交互。 |
| `variant` | `ButtonVariant` | `'default'` | 视觉类型。 |
| `tooltip` | `string` | `''` | hover 时显示的提示文本。 |

```ts
const queryButton = new RenderButton({
  label: '查询',
  tooltip: '按当前条件重新查询',
  variant: 'default',
  onClick: () => {
    reload()
  },
})
```

## ButtonVariant

`variant` 类型为：

```ts
type ButtonVariant = 'default' | 'primary' | 'danger' | 'text' | 'link'
```

| variant | 用途 | 视觉说明 |
| --- | --- | --- |
| `default` | 普通操作。 | 使用普通控件背景和边框。 |
| `primary` | 页面主操作，例如保存、确认、提交。 | 使用主题主色和强调文本色。 |
| `danger` | 危险操作，例如删除、作废、清空。 | 使用主题危险色。 |
| `text` | 弱操作、轻量文字按钮。 | 透明背景，hover/pressed 时显示交互背景。 |
| `link` | 链接式动作，例如查看详情。 | 使用强调文字色，并绘制下划线。 |

```ts
const primaryButton = new RenderButton({
  label: '提交',
  variant: 'primary',
  onClick: () => {
    state.submitted = true
  },
})

const dangerButton = new RenderButton({
  label: '删除',
  variant: 'danger',
  onClick: () => {
    remove()
  },
})

const linkButton = new RenderButton({
  label: '查看详情',
  variant: 'link',
  onClick: () => {
    state.detailVisible = true
  },
})
```

不要为了颜色随意使用 `primary` 或 `danger`。视觉类型应表达操作语义。

## 属性和方法

| API | 类型 / 返回值 | 说明 |
| --- | --- | --- |
| `label` | `string` | 按钮文本。修改后需要重新 layout 才能更新尺寸。 |
| `onClick` | `() => void \| undefined` | 点击回调。`dispose()` 时会被清空。 |
| `loading` | `boolean` | 当前 loading 状态。建议通过 `setLoading()` 修改。 |
| `tooltip` | `string` | tooltip 文本。空字符串表示不显示。 |
| `disabled` | `boolean` | 禁用状态。赋值会同步交互禁用状态。 |
| `setDisabled(value)` | `void` | 设置禁用状态。 |
| `variant` | `ButtonVariant` | 视觉类型。修改只触发重绘，不改变布局尺寸。 |
| `setLoading(value)` | `void` | 设置 loading 状态，启动/停止 spinner，并重新 layout。 |
| `onKeyDown(event)` | `boolean` | Enter / Space 触发 `onClick()`。 |
| `dispose()` | `void` | 停止 spinner、释放动画和定时器、清空 `onClick`。 |

```ts
const submitButton = new RenderButton({
  label: '提交',
  variant: 'primary',
  onClick: () => {
    submitButton.setLoading(true)
    service.search(state)
    submitButton.setLoading(false)
  },
})

submitButton.disabled = !canSave()
submitButton.tooltip = submitButton.disabled ? '请先填写必填项' : ''
```

## 布局和尺寸

布局规则：

- 按钮没有子节点。
- 宽度由 `label` 文本宽度、loading spinner 宽度和主题水平 padding 决定。
- 高度由主题字体大小和垂直 padding 决定。
- 父布局传入的 `BoxConstraints` 会限制最终宽高。
- loading 时内容宽度为 `spinner + gap + label`。
- `variant` 不影响布局尺寸，只影响绘制。

```ts
const actionRow = new RenderStackPanel({
  orientation: 'horizontal',
  spacing: 8,
})

actionRow.addChild(new RenderButton({ label: '取消', onClick: () => {} }))
actionRow.addChild(new RenderButton({ label: '保存', variant: 'primary', onClick: save }))
```

按钮文案应短、明确。不要把解释性长文本塞进按钮；说明文字应放到按钮附近的 `RenderText` 或 tooltip。

## Loading 状态

```ts
const loadingButton = new RenderButton({
  label: '保存',
  variant: 'primary',
  onClick: () => {
    loadingButton.setLoading(true)
    state.saving = true
  },
})
```

loading 行为：

- 显示 spinner。
- 保留 label 可见。
- loading 时按钮不可交互。
- 每 16ms 更新 spinner 角度并请求重绘。
- `setLoading(false)` 停止 spinner 定时器。
- `dispose()` 会停止 spinner，避免定时器泄漏。

如果 loading 代表异步业务操作，业务应在 promise 完成或失败时调用 `setLoading(false)`。异常处理和通知不属于按钮内部职责。

## 禁用状态

```ts
const deleteButton = new RenderButton({
  label: '删除',
  variant: 'danger',
  disabled: true,
  tooltip: '请先选择记录',
  onClick: () => remove(),
})
```

禁用后：

- 不响应 pointer down/up/move。
- Enter / Space 不触发 `onClick()`。
- 如果此前 hover，会隐藏 tooltip。
- 如果此前 pressed，会释放 pressed 状态。
- 会取消 pending gesture。
- 使用 disabled 背景和 disabled 文本色。

`loading` 也会让按钮进入不可交互状态，但 `disabled` 属性仍表示业务禁用状态本身。

## 鼠标行为

| 操作 | 行为 |
| --- | --- |
| 主按钮 pointer down 命中按钮 | 进入 pressed，获得焦点，加入手势处理。 |
| pointer up 仍在按钮内 | 释放 pressed，再调用 `onClick()`。 |
| pointer up 已移出按钮 | 释放 pressed，不调用 `onClick()`。 |
| pointer down 在按钮外 | 忽略。 |
| 非主按钮点击 | 忽略。 |
| hover 进入 | 播放 hover 动画；有 tooltip 时显示 tooltip。 |
| hover 移动 | 更新 tooltip 位置。 |
| pointer leave | 退出 hover，但不主动取消已经开始的 press；如果最终 up 在外部，不触发点击。 |
| pointer cancel | 清理 hover、pressed、tooltip 和 pending gesture。 |
| 其他手势胜出 | 释放 pressed，不触发点击。 |

`onClick` 触发前 pressed 状态已经释放，因此回调中看到的按钮视觉状态不是 pressed。

## 键盘和焦点

| 按键 | 行为 |
| --- | --- |
| Enter | 非 disabled、非 loading 时触发 `onClick()`，返回 `true`。 |
| Space | 非 disabled、非 loading 时触发 `onClick()`，返回 `true`。 |
| 其他按键 | 返回 `false`。 |
| disabled / loading | 不处理键盘事件。 |

按钮继承 `FocusableControl`，会在获得焦点且非禁用时绘制 focus ring。键盘事件通常由运行时焦点系统派发，业务代码一般不直接调用 `onKeyDown()`。

## Tooltip

```ts
const helpButton = new RenderButton({
  label: '生成报告',
  tooltip: '根据当前筛选条件生成报告',
  onClick: () => {
    state.reportRequested = true
  },
})
```

tooltip 行为：

- hover 进入时调用 `TooltipService.currentOrNull?.show()`。
- hover 移动时更新 tooltip 位置。
- hover 离开、禁用、取消、dispose 时隐藏 tooltip。
- 如果应用没有安装 tooltip service，按钮仍可正常点击，只是不显示 tooltip。

`tooltip` 适合短说明，不适合放复杂可交互内容。需要可交互浮层时使用 [Popover](../overlay/popover.md)。

## 绘制和主题

`RenderButton` 使用 `deriveButtonStyle(theme, variant)` 获取样式 token：

- `normalBg`
- `hoveredBg`
- `pressedBg`
- `disabledBg`
- `focusedBorder`
- `text`
- `disabledText`
- `fontSize`
- `fontFamily`
- `borderRadius`
- `borderWidth`
- `borderColor`
- `paddingH`
- `paddingV`

绘制顺序：

1. 背景渐变高光。
2. 边框。
3. focus ring。
4. loading spinner 和文本，或居中文本。
5. `link` variant 额外绘制下划线。

浅色和深色主题下 hover / pressed 对比度由主题 token 保证。组件层不写死颜色。

## 与其他按钮组件的区别

| 组件 | 适合场景 | 说明 |
| --- | --- | --- |
| `RenderButton` | 普通文字按钮。 | 本组件，直接执行 `onClick`。 |
| `RenderIconButton` | 单个 icon-only 按钮。 | 紧凑但语义依赖 tooltip。 |
| `RenderCommandButton` | 单个命令按钮。 | 从命令系统同步 label、disabled、loading 和执行。 |
| `RenderToolbar` | 工具栏。 | 支持分组、分隔符、toggle、dropdown、溢出。 |
| `RenderCommandToolbar` | 命令工具栏。 | 从命令配置生成工具栏，统一权限和状态。 |

## 常见问题

### 为什么按钮点击没触发？

检查：

1. 是否传入 `onClick`。
2. `disabled` 是否为 `true`。
3. `loading` 是否为 `true`。
4. pointer down 是否命中按钮。
5. pointer up 是否仍在按钮内。
6. 是否被滚动容器等其他手势赢得 gesture arena。

### 为什么 loading 后按钮不能点击？

这是设计行为。loading 表示操作正在进行，按钮不可重复触发。业务完成后调用 `setLoading(false)`。

### 为什么修改 label 后尺寸没变？

`label` 是公开字段。修改后需要让按钮重新 layout，例如由父组件状态更新触发 layout，或在组件组合层调用相关 layout 刷新流程。

### 什么时候用 CommandButton？

当按钮需要权限、`canExecute`、快捷键、菜单复用、命令诊断或页面级命令生命周期时，使用 `RenderCommandButton`。`RenderButton` 适合简单局部动作。

## 相关文档

- [IconButton](./icon-button.md)
- [CommandButton](../command/command-button.md)
- [Toolbar](../command/toolbar.md)
- [CommandToolbar](../command/command-toolbar.md)
- [Modal](../overlay/modal.md)
- [Prompt](../overlay/prompt.md)
- [主题与状态](../../themes.md)
