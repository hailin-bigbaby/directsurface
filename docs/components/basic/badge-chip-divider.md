# Badge / Chip / Divider

> **通用布局能力**：本页中的可布局 `Render*` 组件实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；构造器是否接收这些字段以参数表为准。详见[组件通用布局属性](../common-layout-properties.md)。


`RenderBadge`、`RenderChip` 和 `RenderDivider` 是轻量视觉组件：

- `RenderBadge`：状态、数量、紧凑提示。
- `RenderChip`：标签、筛选条件、已选择项。
- `RenderDivider`：水平或垂直分割线。

它们都不承载复杂业务状态。业务状态应在页面、controller 或 command 层计算完成，再投影成组件的 `status`、`selected`、`disabled` 等属性。

## API 总览

```ts
import {
  RenderBadge,
  RenderChip,
  RenderDivider,
  measureBadgeLayout,
  measureChipLayout,
  paintBadge,
  paintChip,
  type BadgeAppearance,
  type BadgeLayoutMetrics,
  type BadgeStatus,
  type ChipLayoutMetrics,
  type DividerAxis,
  type MeasureBadgeOptions,
  type MeasureChipOptions,
  type PaintBadgeOptions,
  type PaintChipOptions,
} from 'directsurface'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderBadge` | class | 数量、状态点和紧凑状态徽标。 |
| `RenderChip` | class | 标签、筛选条件和可移除短标签。 |
| `RenderDivider` | class | 水平或垂直分割线。 |
| `measureBadgeLayout()` / `paintBadge()` | function | 在自绘组件中复用 Badge 测量和绘制规则。 |
| `measureChipLayout()` / `paintChip()` | function | 在自绘组件中复用 Chip 测量和绘制规则。 |
| `BadgeStatus` / `BadgeAppearance` | type | Badge 状态语义和外观强度。 |
| `DividerAxis` | type | Divider 方向。 |

最小装配顺序是：状态由业务先计算，再创建对应轻量视觉组件。Badge、Chip helper 适合在表格单元格、状态栏或菜单中复用外观，不需要额外创建 render object。

## 何时使用

使用 `RenderBadge`：

- 未读数、告警数、待处理数。
- 成功、警告、错误等状态提示。
- 导航项、状态栏、表单校验旁的紧凑标记。
- 只需要状态点，不需要文字时的 dot badge。

使用 `RenderChip`：

- 筛选条件，例如“运营部”“未归档”。
- 选择结果，例如多选下拉框中的已选项。
- 可点击、可移除的短标签。

使用 `RenderDivider`：

- 工具栏分组。
- 表单区块分隔。
- 弹窗 footer 和内容之间的分隔。
- 横向布局中的垂直分隔线。

不要使用：

- 用 `Badge` 代替按钮。
- 用大量 `Chip` 承载长文本详情。
- 用空白 `RenderBox` 或 margin 伪造分割线。
- 用 `Divider` 表达可拖动分割，拖动分割应使用明确的 splitter 类组件。

## Badge 最小示例

```ts
const badge = new RenderBadge({
  value: 128,
  max: 99,
  status: 'danger',
  appearance: 'filled',
})
```

```ts
const online = new RenderBadge({
  dot: true,
  status: 'success',
})
```

## RenderBadge 构造参数

```ts
const badge = new RenderBadge({
  value: 'Beta',
  status: 'primary',
  appearance: 'subtle',
  compact: true,
})
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `value` | `string \| number` | `undefined` | 显示文本或数字。空值不会绘制文字。 |
| `status` | `BadgeStatus` | `'normal'` | 状态语义，决定颜色。 |
| `appearance` | `BadgeAppearance` | `'subtle'` | 外观强度。 |
| `dot` | `boolean` | `false` | 是否作为状态点测量和绘制。只有 `value` 为空时才呈现为点。 |
| `max` | `number` | `99` | 数字超过该值时显示为 `${max}+`。 |
| `compact` | `boolean` | `false` | 是否使用更紧凑的尺寸。状态栏、小型列表可使用。 |

## BadgeStatus

```ts
type BadgeStatus = 'normal' | 'primary' | 'success' | 'warning' | 'danger'
```

| 值 | 语义 |
| --- | --- |
| `'normal'` | 普通数量或中性状态。 |
| `'primary'` | 主要状态、当前状态、强调信息。 |
| `'success'` | 成功、在线、通过。 |
| `'warning'` | 警告、待确认、需要关注。 |
| `'danger'` | 错误、失败、严重告警。 |

## BadgeAppearance

```ts
type BadgeAppearance = 'subtle' | 'filled'
```

| 值 | 说明 |
| --- | --- |
| `'subtle'` | 低强调背景、边框和状态色文字。适合列表、导航、状态栏。 |
| `'filled'` | 实色背景和高对比文字。适合严重告警或需要明显识别的数量。 |

## RenderBadge 属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `value` | `string \| number \| undefined` | 当前显示值。 |
| `status` | `BadgeStatus` | 当前状态色。 |
| `appearance` | `BadgeAppearance` | 当前外观强度。 |
| `dot` | `boolean` | 是否允许点状显示。 |
| `max` | `number` | 数字封顶值。 |
| `compact` | `boolean` | 是否使用紧凑尺寸。 |

这些字段是公开字段。组件已经挂载后直接修改字段不会自动触发布局或绘制，建议在上层状态变化时重建 `RenderBadge`，或显式触发布局刷新。

## Badge 测量和绘制 helper

`Badge` 暴露了底层 helper，方便状态栏、菜单、表格单元格等组件在自己的 `performPaint()` 中直接复用同一套视觉规则。

```ts
const theme: any = {}
const metrics = measureBadgeLayout(theme, 120, {
  max: 99,
  status: 'danger',
  appearance: 'filled',
})
```

```ts
const context: any = {}
paintBadge(context, {
  value: 120,
  max: 99,
  status: 'danger',
  appearance: 'filled',
  rect: { x: 8, y: 8, width: 36, height: 20 },
})
```

`MeasureBadgeOptions`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `status` | `BadgeStatus` | `'normal'` | 测量时不影响尺寸，和绘制 options 保持一致。 |
| `appearance` | `BadgeAppearance` | `'subtle'` | 测量时不影响尺寸，和绘制 options 保持一致。 |
| `dot` | `boolean` | `false` | 空值时按点状尺寸测量。 |
| `max` | `number` | `99` | 用于把超限数字测量为 `${max}+`。 |
| `compact` | `boolean` | `false` | 使用紧凑高度、宽度、padding 和点尺寸。 |

`PaintBadgeOptions` 继承 `MeasureBadgeOptions`，并增加：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `value` | `string \| number \| undefined` | 绘制值。 |
| `rect` | `Rect` | 绘制区域。 |

## Badge 布局规则

- 普通 badge 使用主题的 `minWidth`、`minHeight` 和 `paddingX`。
- `value` 为空且 `dot: true` 时，宽高等于主题 `dotSize`。
- `compact: true` 会降低最小宽高、padding 和点尺寸，但不会低于内部保护值。
- `value` 是有限数字且大于 `max` 时，显示和测量都按 `${max}+`。
- 文本宽度使用 `TextMeasurer.measureWidth()` 计算。

## Chip 最小示例

```ts
const chip = new RenderChip({
  label: '运营部',
  selected: true,
  removable: true,
  onClick: () => {},
  onRemove: () => {},
})
```

## RenderChip 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `label` | `string` | 必填 | 标签文本。 |
| `selected` | `boolean` | `false` | 是否绘制为选中态。 |
| `removable` | `boolean` | `false` | 是否显示 close 图标并支持移除。 |
| `disabled` | `boolean` | `false` | 是否禁用交互。 |
| `onClick` | `() => void` | `undefined` | 点击 chip 主体或按 Enter/Space 时触发。 |
| `onRemove` | `() => void` | `undefined` | 点击 close 图标或按 Backspace/Delete 时触发。 |

## RenderChip 属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `label` | `string` | 当前文本。 |
| `selected` | `boolean` | 当前选中态。 |
| `removable` | `boolean` | 是否显示移除图标。 |
| `disabled` | `boolean` | 是否禁用。赋值会同步焦点控制的 disabled 状态。 |
| `onClick` | `() => void \| undefined` | 点击或键盘激活回调。 |
| `onRemove` | `() => void \| undefined` | 移除回调。 |

`disabled` setter 会重置内部 hover/pressed 状态并触发绘制。其他公开字段直接修改后不会自动触发布局或绘制，建议重建组件，或由父组件统一刷新。

## Chip 交互行为

鼠标：

- 主按钮按下时请求焦点。
- 在 chip 主体按下并抬起，触发 `onClick`。
- 在 close 图标按下并抬起，且 `removable === true`，触发 `onRemove`。
- hover、pressed、removeHovered、removePressed 都有独立绘制状态。
- 指针取消或离开时清理 hover/pressed 状态。

键盘：

- `Enter` / `Space`：触发 `onClick`。
- `Backspace` / `Delete`：当 `removable === true` 时触发 `onRemove`。
- `disabled === true` 时不处理键盘和鼠标交互。

焦点：

- `RenderChip` 继承 `FocusableControl`。
- 聚焦时绘制 focus ring。
- 禁用时不绘制 focus ring。

## Chip 测量和绘制 helper

`Chip` 同样暴露 helper，适合多选下拉框、状态栏、表格单元格在自绘流程里复用 chip 外观。

```ts
const theme: any = {}
const metrics = measureChipLayout(theme, 'TypeScript', {
  removable: true,
})
```

```ts
const context: any = {}
paintChip(context, {
  label: 'TypeScript',
  rect: { x: 12, y: 12, width: 96, height: 24 },
  removable: true,
  selected: true,
  hovered: false,
})
```

`MeasureChipOptions`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `removable` | `boolean` | `false` | 是否为 close 图标预留宽度。 |
| `height` | `number` | 主题 chip 高度 | 自定义测量高度。常用于触发器内部 chip。 |

`ChipLayoutMetrics`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `width` | `number` | chip 总宽度。 |
| `height` | `number` | chip 总高度。 |
| `removeRect` | `Rect \| null` | close 图标本地矩形。不可移除时为 `null`。 |

`PaintChipOptions`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `label` | `string` | 必填 | 绘制文本。 |
| `rect` | `Rect` | 必填 | 绘制区域。 |
| `removable` | `boolean` | `false` | 是否绘制 close 图标。 |
| `selected` | `boolean` | `false` | 是否使用选中背景。 |
| `disabled` | `boolean` | `false` | 是否使用禁用态。 |
| `hovered` | `boolean` | `false` | 是否使用 hover 态。 |
| `pressed` | `boolean` | `false` | 是否使用 pressed 态。 |
| `removeHovered` | `boolean` | `false` | close 图标是否 hover。 |
| `removePressed` | `boolean` | `false` | close 图标是否 pressed。 |
| `centerLabel` | `boolean` | `false` | 文本是否居中。 |
| `focused` | `boolean` | `false` | 是否绘制 focus ring。 |

`paintChip()` 返回 `{ removeRect }`，其中 `removeRect` 是全局绘制坐标中的 close 图标矩形。

## Chip 布局和文本规则

- 宽度 = 文本测量宽度 + 左右 padding + 可选 close 图标宽度。
- 高度来自主题或 `MeasureChipOptions.height`。
- `RenderChip` 当前不会自动省略 label，也不会 clip 文本。
- 长标签应由业务侧截断，或放在可滚动/可换行容器中。
- 大量 chip 推荐放入 wrap 类布局，避免横向无限增长。

## Divider 最小示例

```ts
const horizontal = new RenderDivider({
  axis: 'horizontal',
  thickness: 1,
  inset: 8,
})
```

```ts
const vertical = new RenderDivider({
  axis: 'vertical',
  extent: 28,
})
```

## RenderDivider 构造参数

```ts
const divider = new RenderDivider()
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `axis` | `DividerAxis` | `'horizontal'` | 分割线方向。 |
| `extent` | `number` | 取约束最大宽/高 | 主轴尺寸。水平线表示宽度，垂直线表示高度。 |
| `thickness` | `number` | 主题 thickness | 线宽。 |
| `inset` | `number` | 主题 inset | 线段两端内缩距离。 |

```ts
type DividerAxis = 'horizontal' | 'vertical'
```

## RenderDivider 属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `axis` | `DividerAxis` | 分割线方向。 |
| `extent` | `number \| undefined` | 主轴尺寸。 |
| `thickness` | `number \| undefined` | 线宽。 |
| `inset` | `number \| undefined` | 两端内缩。 |

这些字段直接修改后不会自动触发布局或绘制。动态切换方向、长度或线宽时，建议由上层重建 divider 或触发布局。

## Divider 布局规则

水平：

- `size.width = extent ?? constraints.maxWidth`。
- `size.height = max(thickness, theme.inset * 2 + thickness)`。
- 绘制线段位于垂直居中位置。
- x 方向从 `offset.x + inset` 绘制到 `offset.x + width - inset`。

垂直：

- `size.width = max(thickness, theme.inset * 2 + thickness)`。
- `size.height = extent ?? constraints.maxHeight`。
- 绘制线段位于水平居中位置。
- y 方向从 `offset.y + inset` 绘制到 `offset.y + height - inset`。

## 主题来源

Badge 使用 `deriveBadgeStyle(theme)`：

- 字号和字体来自主题字号、字体族。
- `normal`、`primary`、`success`、`warning`、`danger` 各有 subtle 和 filled 色组。
- `filled` 文本色会按背景计算高对比颜色。
- 尺寸由 `minHeight`、`minWidth`、`dotSize`、`paddingX`、`radius` 控制。

Chip 使用 `deriveChipStyle(theme)`：

- 字号和字体来自主题。
- 背景有 normal、hovered、pressed、selected、disabled 状态。
- selected 和 default 使用不同背景色组。
- focus ring 使用 `theme.focusBorder`。
- close 图标尺寸来自 `closeIconSize`。

Divider 使用 `deriveDividerStyle(theme)`：

- 颜色为 `theme.borderSubtle`。
- 默认线宽为 `1`。
- 默认 inset 由 `theme.framePadding` 推导。

## 与相关组件的区别

| 能力 | `RenderBadge` | `RenderChip` | `RenderDivider` | `RenderButton` | `RenderText` |
| --- | --- | --- | --- | --- | --- |
| 主要用途 | 状态/数量 | 标签/筛选 | 区域分割 | 命令操作 | 只读文本 |
| 是否可点击 | 不内建 | 支持 | 不支持 | 支持 | 不支持 |
| 是否可聚焦 | 否 | 是 | 否 | 是 | 否 |
| 是否有键盘交互 | 否 | Enter/Space/Delete | 否 | Enter/Space | 否 |
| 是否测量文本 | 是 | 是 | 否 | 是 | 是 |
| 是否适合长文本 | 否 | 否 | 不适用 | 否 | 视场景 |

## 常见组合

状态栏 badge：

```ts
const status = new RenderBadge({
  value: '同步中',
  status: 'primary',
  compact: true,
})
```

筛选 chip：

```ts
const filter = new RenderChip({
  label: '只看未完成',
  selected: true,
  removable: true,
  onRemove: () => {},
})
```

工具栏分隔：

```ts
const separator = new RenderDivider({
  axis: 'vertical',
  extent: 24,
  inset: 2,
})
```

## 性能边界

- Badge 和 Chip 的文本宽度都会走 `TextMeasurer.measureWidth()`。
- 大量 badge/chip 高频变化时，应避免每帧重建所有对象。
- 自绘组件中优先复用 `measureBadgeLayout/paintBadge` 和 `measureChipLayout/paintChip`，保持视觉一致。
- Chip 不做虚拟化。成百上千个标签应交给列表、表格或虚拟滚动容器管理。
- Divider 成本很低，但不应滥用为布局占位。

## 常见问题

### 为什么 Badge 不能点击？

`RenderBadge` 是状态表达组件，不是命令组件。需要点击行为时，把 badge 放在按钮、列表项或导航项内部，由父组件处理点击。

### 为什么 dot badge 传了 value 后不是圆点？

`dot: true` 只有在 `value` 为空时才按点状尺寸和点状绘制。传入 `value` 后仍会按文本 badge 显示。

### 为什么 Chip 的长文本没有省略号？

`RenderChip` 当前不内建 ellipsis。短标签是 chip 的设计边界；长文本应由业务侧裁剪，或使用 `RenderText`、`RenderParagraph`、列表详情等组件呈现。

### 为什么修改 selected 后没有立即重绘？

`selected` 是公开字段，直接赋值不会自动 `markNeedsPaint()`。建议从状态重新构建 chip，或由父组件在状态变化后刷新。

### Divider 的 inset 为什么会影响线段长度？

`inset` 是线段两端的内缩，不改变组件自身布局尺寸，只改变实际绘制的线段起止点。

## 相关文档

- [Text 文本](./text.md)
- [Button 按钮](./button.md)
- [IconButton 图标按钮](./icon-button.md)
- [Toolbar 工具栏](../command/toolbar.md)
- [ListView 列表](../data/list-view.md)
- [MultiSelectDropdown 多选下拉](../selector/multi-select-dropdown.md)
- [主题与状态](../../themes.md)
- [布局与约束](../../lifecycle.md)
