# Toolbar 工具栏

> **通用布局能力**：`RenderToolbar` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；工具栏内部 token padding 不是通用容器 padding。详见[组件通用布局属性](../common-layout-properties.md)。


DirectSurface UI 的手工工具栏公共类名是 `RenderToolbar`。它用于展示一组页面或编辑器操作，支持 `button`、`toggle`、`dropdown`、`separator` 四类 item，支持 leading/trailing 插槽、分组、整组溢出菜单、tooltip、键盘焦点、dropdown popup、`itemRect()` 和 `debugState()`。

`RenderToolbar` 只负责 UI 组合和交互，不负责命令权限、`canExecute`、快捷键或页面命令生命周期。需要命令系统时使用 [CommandToolbar](./command-toolbar.md)。

## API 总览

```ts
import {
  RenderToolbar,
  type ToolbarGroup,
  type ToolbarItem,
  type ToolbarSlot,
} from 'directsurface'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderToolbar` | class | 手工工具栏。负责分组、leading/trailing 插槽、按钮绘制、溢出菜单、tooltip 和键盘交互。 |
| `ToolbarGroup` | type | 工具栏分组配置，包含 `id`、`slot`、`visible` 和 `items`。 |
| `ToolbarItem` | type | 工具栏项配置，支持 `button`、`toggle`、`dropdown` 和 `separator`。 |
| `ToolbarSlot` | type | 分组所在插槽：`leading` 或 `trailing`。 |

最小装配顺序是：创建 `RenderToolbar`，传入或后续设置 `ToolbarGroup[]`。如果动作需要权限、快捷键、命令复用或页面级命令生命周期，应改用 `RenderCommandToolbar`。

## 何时使用

- 页面顶部或局部区域有一组静态操作按钮。
- 编辑器工具条需要 icon、文字、toggle、dropdown 和分隔符混合。
- 操作状态由页面自己维护，不需要统一命令系统。
- 容器宽度不足时需要自动放入“更多命令”溢出菜单。
- 需要通过 `itemRect()` 获取按钮位置作为测试或浮层锚点。

不适合：

- 单个普通按钮，使用 [Button](../basic/button.md)。
- 单个 icon-only 按钮，使用 [IconButton](../basic/icon-button.md)。
- 权限、可见性、enabled、快捷键和菜单要统一管理，使用 [CommandToolbar](./command-toolbar.md)。
- 右键菜单或菜单栏结构，使用 [ContextMenu](../overlay/context-menu.md) 或 [MenuBar](../navigation/menu-bar.md)。

## 最小示例

```ts
const toolbar = new RenderToolbar({
  groups: [
    {
      id: 'file',
      slot: 'leading',
      items: [
        { id: 'save', kind: 'button', label: '保存', icon: 'document', onClick: () => save() },
        { id: 'refresh', kind: 'button', label: '刷新', icon: 'refresh', onClick: () => reload() },
      ],
    },
  ],
})
```

## 构造参数

`new RenderToolbar(options?)` 的 `options`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `groups` | `ToolbarGroup[]` | `[]` | 初始工具栏分组。 |

```ts
const emptyToolbar = new RenderToolbar()
emptyToolbar.addGroup({
  id: 'actions',
  slot: 'leading',
  items: [{ id: 'copy', kind: 'button', label: '复制', icon: 'copy', onClick: copySelection }],
})
```

## ToolbarGroup

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 分组 id。用于调试、溢出菜单分组标题和动态删除。 |
| `slot` | `'leading' \| 'trailing'` | 插槽。leading 在左侧，trailing 在右侧。 |
| `visible` | `boolean` | 设为 `false` 时整组不参与布局。 |
| `items` | `ToolbarItem[]` | 分组内项目。 |

```ts
const groups: ToolbarGroup[] = [
  {
    id: 'edit',
    slot: 'leading',
    items: [
      { id: 'undo', kind: 'button', label: '撤销', icon: 'undo', showLabel: false },
      { id: 'redo', kind: 'button', label: '重做', icon: 'redo', showLabel: false },
    ],
  },
  {
    id: 'status',
    slot: 'trailing',
    items: [
      { id: 'notify', kind: 'button', label: '通知', icon: 'bell' },
    ],
  },
]
```

`slot` 只决定显示位置，不表示命令作用域。需要命令作用域时使用 `RenderCommandScope` 和 `RenderCommandToolbar`。

## ToolbarItem 公共字段

所有 item 都有这些字段：

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 必填 | item id。用于 hover、keyboard、`itemRect()` 和 debug。 |
| `kind` | 字符串字面量 | 必填 | item 类型。 |
| `visible` | `boolean` | `true` | 设为 `false` 时该 item 不参与布局。 |
| `disabled` | `boolean` | `false` | 禁用。不可点击、不可键盘激活。 |
| `tooltip` | `string` | 自动推导 | hover tooltip。 |
| `showLabel` | `boolean` | `true` | 是否显示 label。`false` 且有 icon 时为 icon-only。 |

icon-only item 如果没有显式 `tooltip`，工具栏会使用 `label` 作为 tooltip，并设置 `tooltipDelay = 250`。

## Button Item

`ToolbarItem` 的 `kind: 'button'` 分支用于普通点击动作：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `kind` | `'button'` | 按钮项。 |
| `label` | `string` | 显示文本，也可作为 icon-only tooltip。 |
| `icon` | `IconName` | 可选 icon。 |
| `onClick` | `() => void` | 点击回调。 |

```ts
const saveItem: ToolbarItem = {
  id: 'save',
  kind: 'button',
  label: '保存',
  icon: 'document',
  onClick: () => save(),
}
```

## Toggle Item

`ToolbarItem` 的 `kind: 'toggle'` 分支用于开关型动作：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `kind` | `'toggle'` | toggle 项。 |
| `label` | `string` | 显示文本。 |
| `icon` | `IconName` | 可选 icon。 |
| `checked` | `boolean` | 当前是否选中。选中时使用 selected 状态绘制。 |
| `onChange` | `(checked: boolean) => void` | 激活时传入反转后的 checked 值。 |

```ts
let compactMode = false

const compactItem: ToolbarItem = {
  id: 'compact',
  kind: 'toggle',
  label: '紧凑',
  icon: 'check',
  checked: compactMode,
  onChange: checked => {
    compactMode = checked
  },
}
```

`RenderToolbar` 不会自动改写 `item.checked`。业务应更新状态后调用 `setGroups()` 或触发布局刷新，让下一次绘制使用新值。

## ComboBox Item

`ToolbarItem` 的 `kind: 'dropdown'` 分支用于打开菜单：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `kind` | `'dropdown'` | 下拉项。 |
| `label` | `string` | 显示文本。 |
| `icon` | `IconName` | 可选 icon。 |
| `items` | `ContextMenuEntry[]` | 菜单项。 |
| `onSelect` | `(key: string) => void` | 菜单选中回调。 |

```ts
const insertItem: ToolbarItem = {
  id: 'insert',
  kind: 'dropdown',
  label: '插入',
  icon: 'plus',
  items: [
    { key: 'insert:table', label: '表格' },
    { key: 'insert:image', label: '图片' },
  ],
  onSelect: key => {
    state.lastInsertKey = key
  },
}
```

点击 dropdown 会打开 `MenuPopup`。如果 popup 右侧空间不足，菜单会尽量右对齐到当前 item。

## Separator Item

`ToolbarItem` 的 `kind: 'separator'` 分支用于视觉分隔：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `kind` | `'separator'` | 分隔符。 |
| `id` | `string` | 分隔符 id。 |

```ts
const separator: ToolbarItem = {
  id: 'edit-separator',
  kind: 'separator',
}
```

分隔符不可点击，不参与键盘顺序。多个分隔符应给出稳定且唯一的 `id`。

## 属性和方法

| API | 类型 / 返回值 | 说明 |
| --- | --- | --- |
| `groups` | `readonly ToolbarGroup[]` | 当前分组配置。 |
| `addGroup(group)` | `void` | 追加分组并重新 layout。 |
| `removeGroup(id)` | `void` | 按 id 删除分组。会同步 hover、pressed、keyboard 和 open 状态。 |
| `setGroups(groups)` | `void` | 替换全部分组。 |
| `clearGroups()` | `void` | 清空分组。 |
| `itemRect(id)` | `Rect \| null` | 返回已布局 item 的本地矩形。找不到返回 `null`。 |
| `debugState()` | 对象 | 返回可见分组、溢出分组、可见 item 和打开项。 |
| `onKeyDown(event)` | `boolean` | 处理键盘导航和激活。 |
| `dispose()` | `void` | 隐藏 tooltip、关闭菜单并释放组件。 |

```ts
const editorToolbar = new RenderToolbar()

editorToolbar.setGroups([
  {
    id: 'paragraph',
    slot: 'leading',
    items: [
      { id: 'indent', kind: 'button', label: '增加缩进', icon: 'indent-increase', showLabel: false },
    ],
  },
])

const indentRect = editorToolbar.itemRect('indent')
state.visibleItems = editorToolbar.debugState().visibleItemIds
state.indentRect = indentRect
```

`itemRect()` 返回的是工具栏本地坐标，不是全局坐标。需要全局位置时加上 `toolbar.globalOffset`。

## debugState

`debugState()` 返回：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `visibleLeadingGroupIds` | `string[]` | 当前可见 leading 分组 id。 |
| `visibleTrailingGroupIds` | `string[]` | 当前可见 trailing 分组 id。 |
| `overflowGroupIds` | `string[]` | 当前进入溢出菜单的分组 id。 |
| `visibleItemIds` | `string[]` | 当前已布局的 item id，包含溢出按钮 id。 |
| `openItemId` | `string` | 当前打开 dropdown 或 overflow 的 item id。 |

溢出按钮的内部 id 是 `__toolbar_overflow__`，可通过 `itemRect('__toolbar_overflow__')` 查询。

## 布局和溢出

布局规则：

- 工具栏整体绘制背景、边框和圆角。
- leading 分组从左向右排列。
- trailing 分组从右侧区域排列。
- leading 和 trailing 同时存在时，中间保留 section gap。
- item 间使用 item spacing。
- 宽度足够时显示所有分组。
- 宽度不足时以“整组”为单位进入 overflow。
- leading 从末尾分组开始进入 overflow。
- 如果仍放不下，再从 trailing 开始进入 overflow。
- overflow 按分组生成菜单，组名作为 disabled 菜单标题。

```ts
const narrowToolbar = new RenderToolbar({
  groups: [
    {
      id: 'file',
      slot: 'leading',
      items: [{ id: 'new', kind: 'button', label: '新建文档', icon: 'plus' }],
    },
    {
      id: 'edit',
      slot: 'leading',
      items: [{ id: 'replace', kind: 'button', label: '批量替换', icon: 'refresh' }],
    },
    {
      id: 'status',
      slot: 'trailing',
      items: [{ id: 'notify', kind: 'button', label: '通知', icon: 'bell' }],
    },
  ],
})
```

在窄宽度下，`edit` 可能进入 overflow，而 `status` 仍保留在 trailing 区域。

## icon-only 和 tooltip

当 item 有 `icon` 且 `showLabel === false` 时：

- button/toggle 会使用紧凑正方形命中区域。
- 不显示 label。
- 如果没有显式 `tooltip`，使用 `label` 作为 tooltip。
- `tooltipDelay` 为 250ms。

```ts
const paragraphToolbar = new RenderToolbar({
  groups: [{
    id: 'paragraph',
    slot: 'leading',
    items: [
      { id: 'indent-increase', kind: 'button', label: '增加缩进', icon: 'indent-increase', showLabel: false },
      { id: 'indent-decrease', kind: 'button', label: '减少缩进', icon: 'indent-decrease', showLabel: false },
    ],
  }],
})
```

图标语义不够清晰时，不要省略 tooltip 或 label。用户需要 hover 后知道按钮含义。

## 鼠标行为

| 操作 | 行为 |
| --- | --- |
| pointer down 命中可交互 item | 工具栏获得焦点，item 进入 pressed。 |
| pointer up 仍在 pressed item 上 | 激活该 item。 |
| 点击 button | 调用 `onClick()`。 |
| 点击 toggle | 调用 `onChange(!checked)`。 |
| 点击 dropdown | 打开 dropdown 菜单。 |
| 点击 overflow | 打开 overflow 菜单。 |
| 点击 disabled item | 不激活。 |
| hover item | 更新 hover 状态和 tooltip。 |
| pointer leave / cancel | 清理 pressed 和 hover。 |
| 已打开 dropdown 时 hover 到另一个 dropdown/overflow | 自动切换打开的菜单。 |

popup 打开时，工具栏会注册一个 popup proxy，用于处理工具栏区域内的 pointer down/move。点击工具栏外部由 popup 系统关闭。

## 键盘行为

`RenderToolbar` 继承焦点能力。键盘顺序只包含可交互 item，不包含 separator 和 disabled item。

| 按键 | 行为 |
| --- | --- |
| ArrowLeft | 移动到上一个可交互 item，循环。 |
| ArrowRight | 移动到下一个可交互 item，循环。 |
| Home | 移动到第一个可交互 item。 |
| End | 移动到最后一个可交互 item。 |
| Enter | 激活当前键盘 item。 |
| Space | 激活当前键盘 item。 |
| ArrowDown | 激活当前键盘 item，常用于打开 dropdown/overflow。 |
| Escape | 如果菜单已打开则关闭菜单；否则返回 `false`。 |

```ts
const consumed = toolbar.onKeyDown(new KeyboardEvent('keydown', {
  key: 'ArrowRight',
  cancelable: true,
}))
state.toolbarHandledKey = consumed
```

业务通常不直接调用 `onKeyDown()`，由运行时焦点系统派发。

## ComboBox 和 overflow 菜单

dropdown 菜单：

- item 的 `items` 使用 `ContextMenuEntry[]`。
- 点击菜单项后调用 `onSelect(key)`。
- 菜单位置锚定到 item。
- 右侧空间不足时尝试右对齐。

overflow 菜单：

- 只包含进入溢出的分组。
- 每个溢出分组前插入 disabled 组标题。
- separator 保留为菜单分隔符。
- button 点击调用原 item 的 `onClick()`。
- toggle 点击调用原 item 的 `onChange(!checked)`。
- dropdown 的子菜单项会路由到原 dropdown 的 `onSelect(key)`。

## 动态更新

```ts
function enterReadonlyMode(toolbar: RenderToolbar): void {
  toolbar.setGroups([
    {
      id: 'readonly',
      slot: 'leading',
      items: [
        { id: 'refresh', kind: 'button', label: '刷新', icon: 'refresh', onClick: reload },
      ],
    },
  ])
}
```

动态更新时，工具栏会：

- 清理已经不存在 item 的 hover tooltip。
- 清理已经不存在 item 的 pressed 状态。
- 清理已经不存在 item 的 keyboard item。
- 如果打开的菜单对应 item 已不存在，关闭菜单。
- 请求重新 layout。

不要在 `paint` 中创建新的 groups。groups 应在业务状态变化时更新。

## 绘制和主题

`RenderToolbar` 使用 `deriveToolbarStyle(theme)` 获取主题 token：

- 工具栏背景、边框、圆角。
- item 高度、padding、间距、最小宽度。
- icon 尺寸、icon gap、dropdown arrow gap。
- item normal/hovered/pressed/selected/disabled 背景和文本。
- separator 颜色和 inset。
- focus ring。
- overflow label。

绘制顺序：

1. 工具栏背景和边框。
2. 每个 item 的背景 shell。
3. separator 线。
4. icon、label、dropdown arrow。
5. 当前键盘 item 的 focus ring。

## 与 CommandToolbar 的区别

| 能力 | `RenderToolbar` | `RenderCommandToolbar` |
| --- | --- | --- |
| 手工配置 button/toggle/dropdown/separator | 是 | 否，主要配置 command/separator。 |
| 权限和 canExecute | 否 | 是，来自 `CommandManager`。 |
| 从命令同步 title/icon/tooltip | 否 | 是。 |
| 快捷键元数据 | 否 | 通过命令系统支持。 |
| 适合场景 | 静态工具栏、编辑器本地状态工具条。 | 业务命令工具栏、需要权限和诊断的页面。 |

如果按钮要同时出现在菜单、右键菜单和快捷键中，应优先抽成命令并使用 `RenderCommandToolbar`。

## 常见问题

### 为什么某个 item 不显示？

检查：

1. item 的 `visible` 是否为 `false`。
2. group 的 `visible` 是否为 `false`。
3. group 是否在当前宽度下进入 overflow。
4. item 宽度是否被父约束压缩到 0。

### 为什么 icon-only 没有 tooltip？

如果 `showLabel === false` 且 item 有 icon，默认会用 `label` 作为 tooltip。若仍没有 tooltip，检查 item 是否 disabled、是否有 label、是否安装了 `TooltipService`。

### 为什么 toggle 点击后视觉没有变化？

工具栏不会自动修改 `checked`。业务需要更新状态并重新传入 groups。

### 为什么用 RenderToolbar 后还要 CommandToolbar？

`RenderToolbar` 是手工 UI 组件。`CommandToolbar` 是命令系统投影组件，能统一权限、可见性、执行状态和命令诊断。复杂业务页面通常更适合 `CommandToolbar`。

## 相关文档

- [CommandToolbar](./command-toolbar.md)
- [CommandButton](./command-button.md)
- [Button](../basic/button.md)
- [IconButton](../basic/icon-button.md)
- [ContextMenu](../overlay/context-menu.md)
- [MenuBar](../navigation/menu-bar.md)
- [主题与状态](../../themes.md)
