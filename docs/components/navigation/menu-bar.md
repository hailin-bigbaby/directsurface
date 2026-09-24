# MenuBar 菜单栏

> **通用布局能力**：`RenderMenuBar` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；菜单项 padding 和主题高度是内部视觉规格。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderMenuBar` 是桌面式应用顶部菜单栏，用于承载“文件、编辑、视图、调试、帮助”等全局菜单。顶层菜单由 `MenuBarItem` 描述，展开后的下拉菜单复用 [ContextMenu](../overlay/context-menu.md) 的 `ContextMenuEntry` 数据结构和 `MenuPopup` 绘制逻辑。

MenuBar 负责展示、打开、切换、关闭菜单和把最终选择回调给业务；它不负责路由、权限、命令执行或全局快捷键注册。


## API 总览

```ts
import {
  CommandManager,
  RenderMenuBar,
  createCommandMenuBarItems,
  type ContextMenuEntry,
  type MenuBarItem,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderMenuBar` | class | 顶部菜单栏。负责顶层菜单布局、打开/切换/关闭下拉菜单和选择回调。 |
| `MenuBarItem` | type | 顶层菜单项配置。 |
| `ContextMenuEntry` | type | 下拉菜单项结构，和 ContextMenu 共用。 |
| `createCommandMenuBarItems` | function | 从命令菜单配置生成 `RenderMenuBar` 可用的 items 和 onSelect。 |
| `CommandManager` | class | 使用命令适配器时的状态和执行来源。 |

最小装配顺序是：创建 `MenuBarItem[]`，再创建 `RenderMenuBar({ items, onSelect })`。如果菜单项来自命令系统，用 `createCommandMenuBarItems()` 生成 `items` 和 `onSelect`。

## 何时使用

使用 MenuBar：

- 桌面式业务系统需要稳定顶部菜单。
- 命令很多，需要按业务域分组。
- 需要多级子菜单、分隔线、禁用项、危险项、快捷键显示。
- 需要和 [Command](../command/command-button.md) 体系组合，由命令状态统一生成菜单。

不要使用：

- 页面局部操作按钮。使用 [Toolbar](../command/toolbar.md) 或 [CommandToolbar](../command/command-toolbar.md)。
- 侧边主导航。使用 [NavigationMenu](./navigation-menu.md)。
- 右键菜单。使用 [ContextMenu](../overlay/context-menu.md)。
- 少量同级视图切换。使用 [Tabs](./tabs.md)。

## 最小示例

```ts
const menuBar = new RenderMenuBar({
  items: [
    {
      key: 'file',
      label: '文件',
      items: [
        { key: 'open', label: '打开', shortcut: 'Ctrl+O' },
        { key: 'save', label: '保存', shortcut: 'Ctrl+S', disabled: !canSave() },
      ],
    },
  ],
  onSelect: (menuKey, itemKey) => {
    if (menuKey === 'file' && itemKey === 'open') openFile()
    if (menuKey === 'file' && itemKey === 'save') save()
  },
})
```

## 多级菜单示例

```ts
const editMenu = new RenderMenuBar({
  items: [
    {
      key: 'edit',
      label: '编辑',
      items: [
        { key: 'undo', label: '撤销', shortcut: 'Ctrl+Z' },
        { key: 'redo', label: '重做', shortcut: 'Ctrl+Y', disabled: true },
        { separator: true },
        {
          key: 'copy-as',
          label: '复制为',
          items: [
            { key: 'copy-text', label: '纯文本' },
            { key: 'copy-json', label: 'JSON' },
          ],
        },
        { separator: true },
        { key: 'delete', label: '删除', danger: true, shortcut: 'Del' },
      ],
    },
  ],
  onSelect: (_menuKey, itemKey) => {
    state.lastMenuAction = itemKey
  },
})
```

## 命令体系组合

复杂系统推荐用 `createCommandMenuBarItems()` 把命令菜单配置转换成 `RenderMenuBar` 可用的结构：

```ts
const resolvedMenu = createCommandMenuBarItems(commandManager, content, [
  {
    key: 'file',
    label: '文件',
    items: [
      { kind: 'command', commandId: 'file.open' },
      { kind: 'command', commandId: 'file.save' },
      { kind: 'separator' },
      {
        kind: 'submenu',
        key: 'export',
        label: '导出',
        items: [
          { kind: 'command', commandId: 'file.exportPdf' },
        ],
      },
    ],
  },
])

const commandMenuBar = new RenderMenuBar({
  items: resolvedMenu.items,
  onSelect: resolvedMenu.onSelect,
})
```

这种方式会由 `CommandManager` 计算 visible、enabled、title、icon 和快捷键显示，MenuBar 只负责呈现和选择。

## MenuBarItem

顶层菜单项：

```ts
const topLevelMenu: MenuBarItem = {
  key: 'view',
  label: '视图',
  disabled: false,
  items: [
    { key: 'toggle-sidebar', label: '显示侧边栏', shortcut: 'Ctrl+B' },
  ],
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | `string` | 是 | 顶层菜单稳定标识。用于打开状态、hover 状态和 `onSelect(menuKey, itemKey)`。 |
| `label` | `string` | 是 | 顶层菜单显示文本。 |
| `items` | `ContextMenuEntry[]` | 是 | 下拉菜单项。复用 ContextMenu 数据结构。 |
| `disabled` | `boolean` | 否 | 禁用顶层菜单。禁用后不可 hover、不可打开、键盘导航会跳过。 |

`items` 为空的顶层菜单仍可传入，但没有可选择内容。命令适配器会把空菜单转为 disabled。

## 下拉菜单项

MenuBar 下拉项复用 `ContextMenuEntry`：

```ts
const menuItems: ContextMenuEntry[] = [
  { key: 'new', label: '新建', icon: 'plus', shortcut: 'Ctrl+N' },
  { key: 'open', label: '打开', icon: 'folder-open', shortcut: 'Ctrl+O' },
  { separator: true },
  {
    key: 'recent',
    label: '最近打开',
    items: [
      { key: 'recent-a', label: '文档模板 A' },
      { key: 'recent-b', label: '文档模板 B' },
    ],
  },
  { separator: true },
  { key: 'delete', label: '删除', danger: true, shortcut: 'Del' },
]
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | `string` | 普通项必填 | 叶子项或子菜单项标识。叶子项被选中时作为 `itemKey` 回调。 |
| `label` | `string` | 普通项必填 | 下拉菜单显示文本。 |
| `icon` | `string` | 否 | 图标。支持框架内置 icon name，也支持普通字符串作为文本图标。 |
| `shortcut` | `string` | 否 | 右侧快捷键文本。只负责显示，不注册快捷键。 |
| `disabled` | `boolean` | 否 | 禁用该项。禁用项不可点击，不参与 popup 内键盘选择。 |
| `danger` | `boolean` | 否 | 危险操作文本色，例如删除。 |
| `items` | `ContextMenuEntry[]` | 否 | 子菜单项。存在非空数组时，该项作为子菜单分支。 |
| `separator` | `true` | 分隔线必填 | 分隔线项。不能和普通菜单字段混用。 |

分隔线、子菜单、禁用、危险文本和快捷键的绘制规则与 ContextMenu 一致。

## 构造参数

```ts
const appMenuBar = new RenderMenuBar({
  items: [
    {
      key: 'file',
      label: '文件',
      items: [
        { key: 'open', label: '打开' },
        { key: 'save', label: '保存', disabled: !canSave() },
      ],
    },
  ],
  disabled: false,
  onSelect: (menuKey, itemKey) => {
    state.lastMenu = `${menuKey}.${itemKey}`
  },
})
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `items` | `MenuBarItem[]` | 必填 | 顶层菜单项。构造函数保留该数组引用。 |
| `disabled` | `boolean` | `false` | 整个菜单栏是否禁用。 |
| `onSelect` | `(menuKey: string, itemKey: string) => void` | `undefined` | 选择叶子菜单项时触发。选择子菜单分支不会触发。 |

## 属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `items` | `MenuBarItem[]` | 顶层菜单。可整体替换，也可由业务更新后请求布局/重绘。 |
| `disabled` | `boolean` | 整体禁用状态。设为 `true` 会关闭当前下拉菜单。 |
| `isFocused` | `boolean` | 继承自 `FocusableControl`，表示菜单栏是否持有焦点。 |

动态更新菜单：

```ts
const menuBar = new RenderMenuBar({
  items: [
    {
      key: 'file',
      label: '文件',
      items: [{ key: 'open', label: '打开' }],
    },
  ],
})

menuBar.items = [
  {
    key: 'file',
    label: '文件',
    items: [
      { key: 'open', label: '打开' },
      { key: 'save', label: '保存', disabled: !canSave() },
    ],
  },
]
menuBar.markNeedsLayout()
```

如果只是切换某个菜单项的 `disabled/danger/shortcut`，通常请求重绘即可；如果改变顶层 `label` 或菜单项结构，建议请求布局。

## 方法

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `onPointerDown(event)` | `void` | 处理顶层菜单点击、打开、关闭和切换。 |
| `onPointerMove(event)` | `void` | 处理顶层 hover；打开菜单时移动到其他顶层菜单会切换分支。 |
| `onPointerLeave(event)` | `void` | 清除顶层 hover。 |
| `onPointerCancel(event)` | `void` | 清除顶层 hover。 |
| `onKeyDown(event)` | `boolean` | 处理顶层键盘导航和打开关闭。 |
| `paintDropdown(context)` | `void` | 兼容性方法，委托当前 root popup 绘制。一般无需手动调用。 |
| `dispose()` | `void` | 关闭下拉菜单、释放 popup 引用并清空回调。 |

`RenderMenuBar` 还继承 `focusIn/focusOut/requestFocus` 等焦点能力。

## 顶层鼠标行为

| 操作 | 行为 |
| --- | --- |
| 点击启用的顶层菜单 | 请求焦点；如果未打开则打开；如果该菜单已打开则关闭。 |
| 点击另一个启用的顶层菜单 | 关闭原分支并打开新分支。 |
| 打开菜单后在顶层菜单之间移动 | 移动到另一个启用菜单时切换下拉分支。 |
| 点击禁用顶层菜单 | 不打开；如果已有菜单打开，会关闭。 |
| 点击菜单栏空白区域 | 如果已有菜单打开，会关闭。 |
| 指针离开菜单栏 | 清除顶层 hover，但不主动关闭已打开菜单。 |

只有主按钮会被处理。右键菜单和拖拽不属于 MenuBar 职责。

## 顶层键盘行为

菜单栏获得焦点后：

| 按键 | 行为 |
| --- | --- |
| `ArrowLeft` | 移到上一个启用顶层菜单，循环。 |
| `ArrowRight` | 移到下一个启用顶层菜单，循环。 |
| `Home` | 移到第一个启用顶层菜单。 |
| `End` | 移到最后一个启用顶层菜单。 |
| `ArrowDown` / `Enter` / `Space` | 打开当前顶层菜单。 |
| `Escape` | 关闭已打开的顶层菜单；如果没有打开菜单则不处理。 |

如果某个顶层菜单 disabled，键盘导航会跳过它。

## 下拉菜单行为

下拉菜单由 `MenuPopup` 承担：

- 鼠标移动到子菜单项时，会打开子菜单 popup。
- 鼠标从父项移入子菜单时，父项保持 hover 高亮。
- 点击叶子项会触发 `onSelect(menuKey, itemKey)`，然后关闭整条菜单分支。
- 点击禁用项不会触发回调。
- 点击子菜单分支只打开子菜单，不触发回调。
- 如果 `onSelect` 抛错，MenuBar 仍会关闭当前菜单分支，然后把异常向外抛出。
- popup 吞掉滚轮事件，避免滚动穿透。

下拉菜单键盘：

| 按键 | 行为 |
| --- | --- |
| `ArrowDown` | 移到下一个可选下拉项。 |
| `ArrowUp` | 移到上一个可选下拉项。 |
| `ArrowRight` | 当前项有子菜单时打开子菜单。 |
| `ArrowLeft` | 在子菜单中返回父菜单。 |
| `Enter` | 叶子项触发选择；子菜单项打开子菜单。 |
| `Escape` | 关闭整条菜单分支。 |
| `Tab` | 关闭整条菜单分支，并返回 false，让外层焦点系统继续处理 Tab。 |

## 快捷键说明

`shortcut` 只是显示在菜单右侧的文本，不会自动监听键盘。

真正的全局快捷键应通过：

- `CommandShortcutController`
- `CommandManager`
- `createCommandMenuBarItems()`

统一注册和执行。这样菜单栏、工具栏、按钮和快捷键可以共享同一套权限、enabled 和执行逻辑。

## Popup 和定位

- 顶层菜单打开时，MenuBar 会先向 `PopupManager` 注册一个顶层 proxy popup，用于处理菜单栏区域点击和 hover。
- 实际下拉菜单由 `MenuPopup` 打开为 proxy 的子 popup。
- 子菜单继续作为 `MenuPopup` 的子 popup 打开。
- 下拉菜单默认显示在顶层菜单下方。
- 弹窗边界优先取最近的 `RenderWindow`，没有窗口时使用当前 viewport。
- 菜单位置会被限制在边界内，避免溢出窗口或视口。
- MenuBar detach 或 dispose 时，owner 相关 popup 会关闭。

## 布局和绘制

顶层菜单栏：

- 高度来自主题 `controlHeight`。
- 宽度使用父布局给定的 `maxWidth`；如果是无限宽，默认使用 `800`。
- 顶层菜单宽度按 `label` 文本测量宽度加左右 padding。
- 背景绘制菜单栏 chrome surface。
- 底部绘制一条分隔线。
- hover、focused、selected 使用 item 背景色。
- 禁用顶层菜单使用 disabled 文本色。

下拉菜单：

- 使用 ContextMenu 主题 tokens。
- 宽度来自 ContextMenu 默认菜单宽度。
- 每个普通项使用固定 itemHeight；分隔线使用 separatorHeight。
- label 会在快捷键或子菜单箭头前裁剪。
- 内置 icon name 使用 icon glyph 绘制；普通 `icon` 字符串按文本绘制。

## 主题来源

顶层菜单来自 `deriveMenuBarStyle(theme)`：

| 样式 | 来源语义 |
| --- | --- |
| `barBg` | chrome strip surface |
| `separator` | `theme.borderSubtle` |
| `fontSize/fontFamily` | 当前主题字体 |
| `padding` | `theme.framePadding` |
| `height` | `theme.controlHeight` |
| `itemRadius` | `theme.frameRounding` |
| hover 背景 | `barBg` 与 `theme.selectionMuted` 混合 |
| selected 背景 | `theme.selectionMuted` |
| disabled 文本 | `theme.textDisabled` |

下拉菜单使用 [ContextMenu](../overlay/context-menu.md) 的主题来源。

## 与命令体系的职责边界

MenuBar 不做：

- 权限判断。
- 命令 enabled 求值。
- 命令执行调度。
- 快捷键监听。
- 菜单 visible 过滤。

这些职责应由 `CommandManager`、`CommandShortcutController` 和 `createCommandMenuBarItems()` 完成。MenuBar 只拿到已经适配好的 `items` 和 `onSelect`。

## 生命周期

- 构造时不会复制 `items`，业务应避免在无通知的情况下原地频繁修改。
- 打开菜单会创建 popup proxy 和 `MenuPopup`。
- 切换顶层菜单会关闭旧 popup 分支并打开新分支。
- `disabled = true` 会关闭当前菜单。
- `dispose()` 会关闭下拉菜单，清空 hover/open 状态和 `onSelect` 引用。
- 如果 MenuBar 挂在 `RenderWindow` 下，弹窗边界会跟随该窗口。

## 性能边界

- 顶层 layout 和 hit-test 会测量顶层 label 文本宽度。
- 下拉菜单打开时根据当前主题和条目数量计算 popup 尺寸。
- 菜单树通常很小，性能开销低。
- 权限、visible、enabled 等业务状态不要每帧重建菜单树，应在上下文变化、页面激活或命令状态刷新时更新。
- 大型系统推荐命令体系生成菜单，避免多个入口重复维护状态。

## 常见问题

### 为什么设置了 shortcut 但快捷键没有执行？

`shortcut` 只是显示文本。快捷键执行要使用 `CommandShortcutController` 或业务自己的键盘路由。

### 顶层菜单 disabled 后，下拉项还会响应吗？

不会。disabled 顶层菜单无法打开，也会被键盘导航跳过。

### 为什么点击子菜单项没有触发 onSelect？

带 `items` 的项是分支项，点击或回车只打开子菜单。只有叶子项会触发 `onSelect`。

### 可以动态隐藏菜单项吗？

`MenuBarItem` 和 `ContextMenuEntry` 本身没有 `visible` 字段。需要隐藏时，由业务重新生成 `items`。命令适配器的 `CommandMenuBarItem` 和 `CommandMenuItem` 支持 `visible`，会在生成时过滤。

### MenuBar 可以放在页面内部吗？

技术上可以，但不推荐。MenuBar 表达应用级菜单；页面级操作优先使用 Toolbar 或 CommandToolbar。

## 相关文档

- [ContextMenu 右键菜单](../overlay/context-menu.md)
- [Toolbar 工具栏](../command/toolbar.md)
- [CommandToolbar 命令工具栏](../command/command-toolbar.md)
- [CommandButton 命令按钮](../command/command-button.md)
- Commands API
- [NavigationMenu 导航菜单](./navigation-menu.md)
- [Popup 和 Overlay](../../lifecycle.md)
