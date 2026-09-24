# ColorPicker 颜色选择

> **通用布局能力**：`RenderColorPicker` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；popup 面板尺寸和内部 padding 使用颜色选择器自己的浮层配置。详见[组件通用布局属性](../common-layout-properties.md)。


`RenderColorPicker` 用于选择 `Color` 值，适合主题配置、图表配色、标注颜色、批注颜色、文本或背景色配置。

它由一个触发器和一个独立弹窗组成：

- 触发器使用和下拉框一致的表单外壳，文本区域显示当前颜色的十六进制代码，右侧显示当前颜色 swatch。
- 弹窗提供 HSV 色板、色相条、透明度条、原色/当前色预览、十六进制输入、确认和取消。
- 拖动色板只更新弹窗内的当前色，点击“确认”才提交到触发器并触发 `onChange`。
- 点击“取消”、按 `Escape`、点击外部或再次点击触发器关闭弹窗时，不更新触发器颜色。

## API 总览

主类：

- `RenderColorPicker`
- `ColorPickerPopup`

相关 public type：

- `Color`
- `FormFieldStatus`

导入：

```ts
import {
  ColorPickerPopup,
  RenderColorPicker,
  type Color,
  type FormFieldStatus,
} from 'directsurface'
```

`RenderColorPicker` 的构造参数是公开 options 对象，但当前没有单独导出的 ColorPicker options 类型。业务代码直接按本文参数表传入对象。

`RenderColorPicker` 实现 `ValueEditor<Color>`，可以直接绑定颜色字段。外部 `setValue()` 会复制颜色值并静默更新；只有在 popup 中确认颜色时才发布 `reason: 'confirm'`。触发器和颜色 popup 共同组成一个逻辑焦点会话，打开 popup 不会触发表单 blur 校验，离开整个控件后才会发布一次 blur。

## 何时使用

使用 `RenderColorPicker`：

- 颜色值需要由用户选择。
- 需要同时支持透明度。
- 需要预览原色和当前修改值。
- 需要确认/取消模型，避免拖动过程中立即提交。
- 需要表单状态、辅助文本、前缀或后缀。

不要使用：

- 只展示颜色，不需要选择。使用 [Badge / Chip / Divider](../basic/badge-chip-divider.md)、自绘 swatch 或只读文本组合。
- 只需要从少量固定颜色中选择。可以使用 [ComboBox](../selector/combo-box.md)、[RadioGroup](./checkbox-switch-radio.md) 或业务色板组件。
- 需要复杂调色盘、收藏色、品牌色库、色彩对比检查。这些应在业务层封装。

## 最小示例

```ts
import { RenderColorPicker, type Color } from 'directsurface'

const colorState: { color: Color } = {
  color: { r: 47, g: 111, b: 237, a: 1 },
}

const picker = new RenderColorPicker({
  color: colorState.color,
  label: '强调色',
  onChange: value => {
    colorState.color = value
  },
})
```

带透明度和辅助文本：

```ts
const markerColor = new RenderColorPicker({
  color: { r: 255, g: 168, b: 0, a: 0.65 },
  label: '标注',
  suffixText: 'RGBA',
  helperText: '支持透明度。',
})
```

只读展示：

```ts
const readonlyColor = new RenderColorPicker({
  color: { r: 100, g: 149, b: 237, a: 1 },
  label: '主题色',
  readonly: true,
})
```

## Color 值格式

颜色使用框架统一的 `Color` 类型：

```ts
import type { Color } from 'directsurface'

const color: Color = {
  r: 47,
  g: 111,
  b: 237,
  a: 1,
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `r` | `number` | 红色通道，通常为 `0-255`。 |
| `g` | `number` | 绿色通道，通常为 `0-255`。 |
| `b` | `number` | 蓝色通道，通常为 `0-255`。 |
| `a` | `number` | 透明度，通常为 `0-1`。 |

弹窗内部会把 RGB 转为 HSV 编辑，并在确认时转回 `Color`。

十六进制输入使用 `#RRGGBBAA`：

- 弹窗总是显示 8 位十六进制，包含 alpha。
- 解析函数也支持 6 位 `#RRGGBB`，此时 alpha 为 `1`。
- 触发器文本区域显示 8 位 hex 文本，右侧显示当前颜色 swatch。

## RenderColorPicker 构造参数

```ts
const picker = new RenderColorPicker({
  color: { r: 100, g: 149, b: 237, a: 1 },
  label: '颜色',
  disabled: false,
  readonly: false,
  status: 'default',
  helperText: '',
  prefixText: '',
  suffixText: 'RGBA',
  onChange: color => {
    state.color = color
  },
})
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `color` | `Color` | `{ r: 100, g: 149, b: 237, a: 1 }` | 当前颜色。 |
| `label` | `string` | `''` | 触发器内的 label。 |
| `disabled` | `boolean` | `false` | 是否禁用。 |
| `readonly` | `boolean` | `false` | 是否只读。 |
| `status` | `FormFieldStatus` | `'default'` | 表单视觉状态。 |
| `helperText` | `string` | `''` | 输入框下方辅助文本。 |
| `prefixText` | `string` | `''` | hex 文本前的前缀文本。 |
| `suffixText` | `string` | `''` | hex 文本后的后缀文本。 |
| `onChange` | `(color: Color) => void` | `undefined` | 确认选择后触发。 |

## 属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `color` | `Color` | 当前触发器颜色。直接赋值不会触发 `onChange`。 |
| `label` | `string` | 当前 label。直接修改不会自动触发布局。 |
| `onChange` | `(color: Color) => void \| undefined` | 确认选择回调。 |
| `disabled` | `boolean` | 禁用态。设为 true 会关闭弹窗并同步 disabled 状态。 |
| `readonly` | `boolean` | 只读态。设为 true 会关闭弹窗、退出焦点并从焦点顺序中移除。 |
| `status` | `FormFieldStatus` | 表单状态。赋值后请求重绘。 |
| `helperText` | `string` | 辅助文本。赋值后请求布局和重绘。 |
| `prefixText` | `string` | 前缀文本。赋值后请求重绘。 |
| `suffixText` | `string` | 后缀文本。赋值后请求重绘。 |
| `isFocused` | `boolean` | 触发器或自有颜色 popup 处于编辑焦点时为 `true`。 |

动态修改 `label/prefixText/suffixText` 后，如果宽度需要变化，应由父组件触发布局或重建组件。

## 触发器行为

鼠标：

- 只响应主按钮。
- 点击触发器会请求焦点。
- 弹窗关闭时点击触发器会打开弹窗。
- 弹窗打开时再次点击触发器会关闭弹窗，并按取消处理。
- 禁用或只读时不会打开弹窗。

键盘：

- 聚焦触发器后，`Enter`、`Space`、`ArrowDown` 打开或关闭弹窗。
- 弹窗打开时，`Escape` 关闭弹窗。
- 只读时不响应打开键；如果异常存在弹窗，只处理 `Escape` 关闭。

hover：

- 只读时不会显示 hover 视觉。
- 禁用时不处理 hover。

焦点：

- 只读状态不会进入焦点顺序。
- 打开弹窗时会保留之前的焦点，不把焦点强制移入弹窗对象。

## 弹窗提交模型

弹窗中的颜色修改分两层：

- 预览值：拖动色板、色相、透明度或编辑 hex 后立即更新弹窗内当前色。
- 提交值：只有点击“确认”或按 `Enter` 时才提交给触发器。

确认：

- 调用 `onChange(color)`。
- 更新 `RenderColorPicker.color`。
- 关闭弹窗。

取消：

- 点击“取消”。
- 按 `Escape`。
- 点击弹窗外部。
- 再次点击触发器。

取消不会更新触发器颜色，也不会触发 `onChange`。

## ColorPickerPopup API

`ColorPickerPopup` 是公开导出的弹窗类，通常由 `RenderColorPicker` 内部持有。只有在你需要自己实现触发器或集成到特殊容器时，才需要直接使用。

```ts
const trigger = new RenderColorPicker({
  color: { r: 255, g: 0, b: 0, a: 1 },
})
const popup = new ColorPickerPopup()

popup.open({
  color: trigger.color,
  anchor: trigger,
  onConfirm: color => {
    state.color = color
  },
  onCancel: () => {},
  onClose: () => {},
})
```

`open()` 参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `color` | `Color` | 打开时的原始颜色。 |
| `anchor` | `PopupAnchor` | 定位锚点。可以是实现弹窗锚点协议的 render object。 |
| `onConfirm` | `(color: Color) => boolean \| void` | 点击确认或按 Enter 时触发；返回 false 保持 popup 打开。 |
| `onCancel` | `() => void` | 取消关闭时触发。 |
| `clearable` | `boolean` | 是否显示“清空”，默认 false。 |
| `onClear` | `() => boolean \| void` | 清空时触发；返回 false 保持 popup 打开。 |
| `onTab` | `(direction: 1 \| -1) => void` | 可选宿主导航钩子。配置后 Tab 会先确认，再关闭并通知方向。 |
| `onClose` | `() => void` | 任意关闭后触发。 |

其他成员：

| 方法 | 说明 |
| --- | --- |
| `debugState()` | 返回当前 focus zone、hex 文本、hex 光标和当前预览颜色，主要用于测试和调试。 |
| `onEscape(event)` | 弹窗级 Escape 处理。 |
| `onKeyDown(event)` | 弹窗级键盘处理。 |
| `dispose()` | 关闭弹窗并释放弹窗表面。 |

直接使用弹窗时，必须在宿主销毁时调用 `dispose()`。

## 弹窗键盘行为

弹窗内有四个 focus zone：

1. `sv`：饱和度/明度色板。
2. `hue`：色相条。
3. `alpha`：透明度条。
4. `hex`：十六进制输入。

通用：

- `Tab`：切到下一个 focus zone。
- `Shift + Tab`：切到上一个 focus zone。
- `Enter`：确认。
- `Escape`：取消。

配置 `onTab` 后使用宿主导航模式：Tab/Shift+Tab 先走 `onConfirm`；接受后关闭并调用 `onTab`，拒绝时保持 popup。未配置时仍使用上述 focus zone 循环，现有 ColorPicker 行为不变。

`sv`：

- `ArrowLeft` / `ArrowRight`：减少/增加饱和度，步长 `0.02`。
- `ArrowUp` / `ArrowDown`：增加/减少明度，步长 `0.02`。

`hue`：

- 左/下方向键：色相减少 `2` 度。
- 右/上方向键：色相增加 `2` 度。

`alpha`：

- 左/下方向键：透明度减少 `0.02`。
- 右/上方向键：透明度增加 `0.02`。

`hex`：

- `ArrowLeft` / `ArrowRight`：移动 hex 光标。
- `ArrowUp` / `ArrowDown`：当前 hex 位增减。
- `Home` / `End`：跳到首位/末位。
- `Backspace`：前移一位并把该位设为 `0`。
- `Delete`：把当前位设为 `0`。
- `0-9` / `A-F`：替换当前位，并向后移动。

## 弹窗鼠标行为

- 点击 `sv` 色板并拖动：改变饱和度和明度。
- 点击或拖动色相条：改变 hue。
- 点击或拖动透明度条：改变 alpha。
- 点击 hex 输入框：把 focus zone 切到 `hex` 并定位 hex 光标。
- 点击确认按钮：提交当前预览色。
- 点击取消按钮：取消并恢复原色。
- 指针离开弹窗表面只清理按钮 hover，不中断拖动。
- pointer cancel 会中断拖动并清理 hover。
- 弹窗吞掉滚轮事件，避免滚动穿透。

## 弹窗定位

- 弹窗宽度由色板宽度和 padding 推导。
- 默认显示在触发器下方。
- 如果下方空间不足，且上方可容纳，则显示到触发器上方。
- 水平方向会限制在 viewport 内，并保留边距。
- 触发器移动或窗口布局变化时，弹窗通过锚点重新解析位置。

## 布局和绘制

触发器：

- 宽度由 padding、label、prefix、hex 文本、suffix、右侧 swatch 和间距计算。
- 如果父布局设置固定宽度，组件会使用该宽度；右侧 swatch 保持可见，hex 文本在剩余区域内单行省略。
- 高度来自 text input 高度；有 helperText 时增加 helper 行高度。
- 右侧 swatch 宽度为输入框高度乘以 trigger swatch width factor。
- swatch 内部先绘制透明棋盘格，再绘制当前颜色。
- disabled 和 readonly 下 swatch 会降低可视强度。

弹窗：

- 使用 popup panel 背景和边框。
- 绘制 SV 方块、色相条、透明度棋盘格与渐变。
- 绘制原色/当前色预览。
- 绘制 hex 输入框和 focus cursor。
- 绘制取消/确认按钮。

## 主题来源

触发器主要使用：

- text input 主题：字段背景、边框、padding、字体、helperText、prefix/suffix。
- trigger field shell：hover、focused、disabled、status 和 helperText 绘制。
- color picker 主题：swatch 尺寸、popup 尺寸、按钮、圆角、色板间距。

弹窗主要使用：

- popup 主题：弹窗背景、边框、阴影。
- text input 主题：hex 输入框背景、边框、字体和 focus 边框。
- color picker 主题：色板尺寸、条高度、按钮颜色、预览尺寸、文字颜色。

## 禁用和只读

`disabled`：

- 不响应鼠标和键盘打开。
- 会关闭已打开弹窗。
- 使用禁用视觉。

`readonly`：

- 不响应鼠标和键盘打开。
- 会关闭已打开弹窗。
- 从焦点顺序中移除。
- 视觉仍显示当前颜色，但降低 swatch 强度。

## 表单组合建议

- 固定颜色集合优先封装业务色板，不一定需要完整颜色选择器。
- 图表系列颜色可以使用 ColorPicker，但推荐业务侧限制默认色板，避免高饱和色过多。
- 业务、运维、CRM 等业务系统应尽量使用克制色，避免让用户随意选择影响可读性的颜色。
- 如果颜色必须满足对比度要求，应在 `onChange` 后由业务层校验并设置 `status/helperText`。

## 性能边界

- 弹窗绘制包含多个渐变、棋盘格和圆形光标，适合单个弹窗交互，不适合在列表中大量同时打开。
- 拖动色板会频繁请求 popup repaint，但不会触发 `onChange`。
- `onChange` 只在确认时触发，适合在回调中更新业务状态。
- 动态移除触发器时，`dispose()` 会释放内部弹窗。

## 常见问题

### 拖动色板为什么没有触发 onChange？

这是当前提交模型。拖动只更新弹窗预览色，点击“确认”或按 `Enter` 后才提交并触发 `onChange`。

### 点击外部为什么颜色恢复了？

点击外部按取消处理，不更新触发器颜色。这样可以避免用户误拖动后直接污染业务状态。

### 可以清除颜色吗？

当前 `RenderColorPicker` 的值类型是必填 `Color`，没有内建 `null` 清除。需要“恢复默认”或“清除”时，应由业务在外层提供按钮，并把默认颜色重新写入 `picker.color`。

### 十六进制为什么总是 8 位？

弹窗内部始终编辑 `#RRGGBBAA`，因为 `Color` 包含 alpha。6 位 hex 只作为解析兼容。

### readonly 和 disabled 有什么区别？

两者都不能打开弹窗。`disabled` 表达不可用并使用禁用视觉；`readonly` 表达只读展示，并从焦点顺序中移除。

## 相关文档

- [TextBox 文本输入](./text-box.md)
- [NumberInput 数字输入](./number-input.md)
- [ComboBox 下拉框](../selector/combo-box.md)
- [Charts 图表](../visualization/charts.md)
- [主题与状态](../../themes.md)
- [Popup 和 Overlay](../../lifecycle.md)
- [焦点与输入](../../lifecycle.md)
