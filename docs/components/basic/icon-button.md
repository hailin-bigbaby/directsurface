# IconButton 图标按钮

> **通用布局能力**：`RenderIconButton` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐。构造参数 `options.size` 是图标按钮边长配置；实例的 `button.size` 是布局完成后的 `Size` 结果，不能用数字覆盖。详见[组件通用布局属性](../common-layout-properties.md)。


DirectSurface UI 的图标按钮公共类名是 `RenderIconButton`。它用于只通过图标表达一个操作，例如刷新、关闭、复制、删除、展开、折叠、搜索、撤销、重做等。组件绘制正方形按钮外壳和居中的内置 icon，并处理 hover、pressed、focused、disabled、tooltip、鼠标点击和键盘激活。

`RenderIconButton` 适合紧凑操作区、窗口标题栏、表格行操作和少量独立工具按钮。完整工具栏场景优先使用 [Toolbar](../command/toolbar.md) 或 [CommandToolbar](../command/command-toolbar.md)。

## API 总览

```ts
import {
  PaintContext,
  RenderIcon,
  RenderIconButton,
  RenderStackPanel,
  RenderToolbar,
  paintIconGlyph,
  rgba,
  type IconName,
  type PaintIconGlyphOptions,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderIconButton` | class | icon-only 操作按钮，支持 hover、pressed、focused、disabled、tooltip 和键盘激活。 |
| `RenderIcon` | class | 只展示图标、不响应点击。 |
| `paintIconGlyph()` | function | 在自定义组件的 `performPaint()` 中绘制内置 icon glyph。 |
| `IconName` | type | 内置图标名称。 |
| `PaintIconGlyphOptions` | type | `paintIconGlyph()` 的绘制参数。 |

最小装配顺序是：选择一个 `IconName`，创建 `RenderIconButton({ icon, tooltip, onClick })`。没有文字 label 的图标按钮应提供 `tooltip`；一组按钮需要分组或溢出菜单时使用 `RenderToolbar`。

## 何时使用

- 操作含义可以用一个通用图标表达。
- 空间不足，不适合显示文字按钮。
- 需要在 hover 时显示 tooltip。
- 操作只是局部 UI 行为，不需要命令系统统一管理。
- 表格行、卡片右上角、弹窗标题栏等位置需要紧凑按钮。

不适合：

- 操作很重要或图标含义不明确，使用 [Button](./button.md) 或 `RenderButton` 的文字按钮。
- 权限、可执行状态、菜单和快捷键要统一，使用 [CommandButton](../command/command-button.md) 或 [CommandToolbar](../command/command-toolbar.md)。
- 一组工具按钮需要分组、分隔符、溢出菜单和 icon-only tooltip，使用 [Toolbar](../command/toolbar.md)。
- 只是展示图标，不可点击，使用 `RenderIcon`。

## 最小示例

```ts
const refreshButton = new RenderIconButton({
  icon: 'refresh',
  tooltip: '刷新',
  onClick: () => {
    reload()
  },
})
```

图标按钮应尽量提供 `tooltip`。如果没有文字说明，用户很难准确理解图标含义。

## 构造参数

`new RenderIconButton(options)` 的 `options`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `icon` | `IconName` | 必填 | 内置图标名称。 |
| `onClick` | `() => void` | `undefined` | 点击或键盘激活时调用。 |
| `tooltip` | `string` | `''` | hover 时显示的提示文本。 |
| `disabled` | `boolean` | `false` | 是否禁用。禁用时不可点击、不可键盘激活。 |
| `size` | `number` | 根据主题按钮字体和 padding 计算 | 按钮整体边长。 |
| `iconSize` | `number` | `max(12, fontSize * 0.95)` | 图标绘制尺寸。 |
| `variant` | `'default' \| 'text'` | `'default'` | `text` 使用透明普通态和轻量 hover/pressed 背景，适合关闭等弱操作。 |

```ts
const closeButton = new RenderIconButton({
  icon: 'close',
  tooltip: '关闭',
  size: 28,
  iconSize: 16,
  variant: 'text',
  onClick: () => {
    state.closed = true
  },
})
```

`size` 和 `iconSize` 是独立参数。通常只需要设置 `size`，让图标尺寸跟随主题默认值；只有在标题栏、紧凑表格行或特殊视觉需求中才需要设置 `iconSize`。

## 属性

| 属性 | 类型 | 可写 | 说明 |
| --- | --- | --- | --- |
| `icon` | `IconName` | 是 | 当前图标名称。修改后应触发重绘。 |
| `onClick` | `() => void \| undefined` | 是 | 点击回调。`dispose()` 时会被清空。 |
| `tooltip` | `string` | 是 | tooltip 文本。空字符串表示不显示 tooltip。 |
| `disabled` | `boolean` | 是 | 禁用状态。赋值会同步焦点和交互状态。 |
| `variant` | `'default' \| 'text'` | 是 | 普通按钮外壳或轻量透明外壳。 |

```ts
const lockButton = new RenderIconButton({
  icon: 'lock',
  tooltip: '锁定',
})

lockButton.disabled = state.readonly
lockButton.tooltip = state.readonly ? '当前只读' : '锁定'
```

`RenderIconButton` 继承 `FocusableControl`，因此也具备焦点相关能力，例如 `focusIn()`、`focusOut()`、`requestFocus()` 和 `isFocused`。

## 内置图标

`icon` 类型为 `IconName`。当前公共图标由图标 Manifest 生成：

See the [icon manifest](../../../scripts/icon_manifest.json) for current names, categories, and source metadata.

需要构建图标检索或分类界面时，可读取 `builtInIconCatalog`，并通过 `builtInIconCategoryLabels` 获取分类显示名称；无需在业务代码中重复维护分类集合。

内置图标使用 Canvas `Path2D` 绘制。运行复杂图标的浏览器或 Canvas 宿主应提供 `Path2D`；基础兼容图标仍保留旧的手绘回退。图标 Path 来源和许可证见随包发布的 `THIRD_PARTY_NOTICES.md`。

紧凑界面中的常用 Fluent 图标带有 optical-size path。`paintIconGlyph()` 会根据传入的逻辑 CSS `size` 选择最接近的 12、16 或 20px 官方变体，再只做必要的小范围缩放；DPR 不参与变体选择。这样 12px Toolbar 图标不会再把 20px path 直接压缩成过细笔画。未提供 optical variant 的图标继续使用原有默认 path，行为保持兼容。

```ts
const copyButton = new RenderIconButton({
  icon: 'copy',
  tooltip: '复制',
  onClick: () => {
    copySelection()
  },
})
```

如果要绘制不可点击图标，使用：

```ts
const documentIcon = new RenderIcon({
  name: 'document',
  size: 18,
})
```

需要在自定义组件里直接绘制内置 icon 时，可以使用低层 helper：

```ts
import { paintIconGlyph, rgba, type PaintContext } from 'ds-ui'

function paintSearchIcon(context: PaintContext, x: number, y: number): void {
  paintIconGlyph(context, {
    name: 'search',
    x: x + 4,
    y: y + 4,
    size: 16,
    color: rgba(90, 99, 115, 1),
  })
}
```

`PaintIconGlyphOptions`：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `IconName` | 内置 icon 名称。 |
| `x` | `number` | 绘制区域左上角 x。 |
| `y` | `number` | 绘制区域左上角 y。 |
| `size` | `number` | icon 方形尺寸。 |
| `color` | `Color` | 绘制颜色。 |
| `strokeWidth` | `number` | 可选描边宽度；未传时按 size 推导。 |

## 布局和尺寸

布局规则：

- 默认是正方形。
- 默认边长来自当前主题的按钮字体和 padding。
- `size` 会覆盖默认边长。
- 最终宽高仍会受父布局传入的 `BoxConstraints` 限制。
- 图标始终按 `iconSize` 居中绘制。
- 组件没有子节点，也不显示文字。

```ts
const compactDeleteButton = new RenderIconButton({
  icon: 'trash',
  tooltip: '删除当前行',
  size: 24,
  iconSize: 14,
  onClick: () => remove(),
})
```

多个图标按钮不要手工计算坐标，使用布局组件组合：

```ts
const actionRow = new RenderStackPanel({
  orientation: 'horizontal',
  spacing: 4,
})

actionRow.addChild(new RenderIconButton({ icon: 'copy', tooltip: '复制', onClick: copySelection }))
actionRow.addChild(new RenderIconButton({ icon: 'trash', tooltip: '删除', onClick: remove }))
```

需要分组、分隔符、溢出菜单时使用 `RenderToolbar`：

```ts
const toolbar = new RenderToolbar({
  groups: [{
    id: 'edit',
    slot: 'leading',
    items: [
      { kind: 'button', id: 'undo', icon: 'undo', label: '撤销', showLabel: false },
      { kind: 'button', id: 'redo', icon: 'redo', label: '重做', showLabel: false },
    ],
  }],
})
```

## 绘制和主题

`RenderIconButton` 复用按钮主题 token：

- 背景色来自 `deriveButtonStyle(theme)`。
- hover 和 pressed 使用动画过渡。
- disabled 使用按钮禁用色。
- focused 时绘制 focus ring。
- `default` 的 icon 颜色来自按钮文本色 token。
- `text` 普通态使用次要文本色，hover/pressed/focused 增强为主文本色，且普通态不绘制边框。
- 外壳使用按钮 border、borderRadius 和渐变高光。

它没有独立的 icon-button theme token。需要全局调整外观时，应调整按钮主题 token；需要局部差异时，通过 `variant`、`size`、`iconSize` 和布局上下文解决。

## 鼠标行为

| 操作 | 行为 |
| --- | --- |
| 主按钮 pointer down 命中按钮 | 进入 pressed，获得焦点，开始手势。 |
| pointer up 仍在按钮内 | 释放 pressed，调用 `onClick()`。 |
| pointer up 已移出按钮 | 取消点击，不调用 `onClick()`。 |
| pointer move 进入按钮 | 进入 hover，播放 hover 动画；有 tooltip 时显示 tooltip。 |
| pointer move 离开按钮 | 退出 hover，隐藏 tooltip。 |
| pointer cancel / leave | 清理 pressed、hover、tooltip 和 pending gesture。 |
| disabled 状态 | 忽略 pointer down/up/move，不触发点击。 |

tooltip 使用 `TooltipService.currentOrNull`。如果当前应用没有安装 tooltip service，按钮仍可正常点击，只是不显示 tooltip。

## 键盘和焦点

| 按键 | 行为 |
| --- | --- |
| Enter | 非禁用状态下调用 `onClick()`，返回 `true`，并 `preventDefault()`。 |
| Space | 非禁用状态下调用 `onClick()`，返回 `true`，并 `preventDefault()`。 |
| 其他按键 | 返回 `false`。 |
| disabled | 不处理键盘事件。 |

```ts
const searchButton = new RenderIconButton({
  icon: 'search',
  tooltip: '搜索',
  onClick: () => {
    state.searchOpened = true
  },
})

searchButton.focusIn()
```

键盘事件通常由运行时焦点系统派发，业务代码一般不需要直接调用 `onKeyDown()`。

## 禁用状态

```ts
const deleteButton = new RenderIconButton({
  icon: 'trash',
  tooltip: '删除',
  disabled: true,
  onClick: () => remove(),
})
```

禁用后：

- 不响应鼠标和键盘激活。
- 如果此前正在 hover，会隐藏 tooltip。
- 如果此前正在 pressed，会释放 pressed 状态。
- 会取消 pending gesture。
- 视觉上使用 disabled 背景和 icon 颜色。

## 生命周期

`dispose()` 会：

- 如果当前 hover 且有 tooltip，隐藏 tooltip。
- 释放 hover 和 pressed 动画控制器。
- 调用父类 dispose。
- 清空 `onClick`，避免持有页面闭包。

页面或弹层销毁时，应释放包含的 `RenderIconButton` 或让父 render tree 统一 dispose。

## 与其他按钮组件的区别

| 组件 | 适合场景 | 说明 |
| --- | --- | --- |
| `RenderIconButton` | 单个紧凑 icon 操作。 | 无文字、无命令绑定、无分组溢出。 |
| `RenderButton` | 普通文字按钮。 | 适合主操作、表单按钮、明确文字动作。 |
| `RenderCommandButton` | 单个命令按钮。 | 从命令系统同步 label、disabled、loading 和执行。 |
| `RenderToolbar` | 手工工具栏。 | 支持按钮、toggle、dropdown、separator、overflow。 |
| `RenderCommandToolbar` | 命令工具栏。 | 从命令配置生成工具栏，并统一权限和状态。 |
| `RenderIcon` | 只展示图标。 | 不可点击，不处理 hover/pressed/focus。 |

## 常见问题

### 为什么 hover 没有 tooltip？

检查：

1. 是否传入非空 `tooltip`。
2. 当前应用是否安装了 `TooltipService`。
3. 按钮是否 disabled。
4. pointer 是否真正命中按钮矩形。

### 为什么图标显示太小或太大？

默认 `iconSize` 跟随主题字体大小。紧凑行操作可以设置 `size` 和 `iconSize`；但应保持按钮可点击区域足够大，不要只缩小到图标本身。

### 为什么 icon-only 工具栏不用 RenderIconButton？

工具栏有自己的 `RenderToolbar`，内置分组、焦点项、tooltip、溢出菜单和 dropdown 支持。工具栏场景使用 `RenderToolbar` 或 `RenderCommandToolbar`，不要手工排一排 `RenderIconButton` 来模拟工具栏。

### 权限控制应该写在哪里？

简单页面可直接设置 `disabled`。复杂业务应使用命令系统，把权限和 `canExecute` 放入 `AppCommand`，再用 `RenderCommandButton` 或 `RenderCommandToolbar`。

## 相关文档

- [Button](./button.md)
- [Toolbar](../command/toolbar.md)
- [CommandButton](../command/command-button.md)
- [CommandToolbar](../command/command-toolbar.md)
- [Tooltip / Popup](../overlay/popup.md)
- [主题与状态](../../themes.md)
