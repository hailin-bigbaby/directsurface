# ContextMenu 上下文菜单

> **与统一布局属性的关系**：`ContextMenuManager` 和菜单 surface 不是父布局中的 `RenderBox` 子节点，不使用通用 `margin` 或 alignment；菜单尺寸、padding 和定位由菜单项、主题与 popup viewport 共同决定。详见[组件通用布局属性](../common-layout-properties.md)。

`ContextMenuManager` 用于打开右键菜单或“更多”菜单。它把 `ContextMenuEntry[]` 转成 overlay popup，支持图标、快捷键文本、禁用项、危险项、分隔线、子菜单、键盘导航和边界内自动避让。

[MenuBar](../navigation/menu-bar.md)、[Toolbar](../command/toolbar.md)、[Tabs](../navigation/tabs.md)、[TabbedWorkspace](../navigation/tabbed-workspace.md) 和 [DockWorkspace](../navigation/dock-workspace.md) 使用同一套 `ContextMenuEntry` 数据结构。业务代码应使用 `ContextMenuManager` 或应用的 overlay service。


## API 总览

```ts
import {
  ContextMenuManager,
  createCommandContextMenu,
  CommandManager,
  RenderText,
  type ContextMenuEntry,
  type ContextMenuItemDebugTarget,
  type ContextMenuItem,
  type ContextMenuManagerDebugState,
  type ContextMenuSeparator,
} from 'directsurface'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `ContextMenuManager` | class | 打开、关闭和释放上下文菜单 popup。 |
| `ContextMenuEntry` | type | 菜单数组元素，可能是普通项或分隔线。 |
| `ContextMenuItem` | type | 普通菜单项，可配置图标、快捷键文本、禁用、危险和子菜单。 |
| `ContextMenuSeparator` | type | 分隔线菜单项。 |
| `ContextMenuItemDebugTarget` | type | 最后一次真实菜单 paint 中的可点击项矩形和稳定 key path。 |
| `ContextMenuManagerDebugState` | type | 菜单几何、可见性与真实绘制目标快照。 |
| `createCommandContextMenu` | function | 从命令配置生成 `ContextMenuEntry[]` 和 `onSelect`，用于复用命令系统。 |
| `CommandManager` | class | 命令注册与执行管理器，常与菜单、工具栏共用。 |

最小装配顺序是：创建 `ContextMenuManager`，调用 `show(items, position, onSelect)`。页面或服务销毁时调用 `dispose()` 关闭当前菜单。

## 何时使用

使用 ContextMenu：

- 表格行、树节点、编辑器区域需要局部操作。
- 菜单项依赖当前选中对象或命中对象。
- 需要分组、禁用、危险操作、子菜单或快捷键提示。
- 同一个命令要同时出现在右键菜单、菜单栏和工具栏中。

不要使用：

- 页面主操作按钮，使用 [Button](../basic/button.md) 或 [Toolbar](../command/toolbar.md)。
- 顶部应用菜单栏，使用 [MenuBar](../navigation/menu-bar.md)。
- 长时间驻留的浮层或工具窗口，使用 [Popover](./popover.md)、[Drawer](./drawer.md) 或 [DockWorkspace](../navigation/dock-workspace.md)。
- 确认、输入和阻断式流程，使用 [Modal](./modal.md) 或 [Prompt](./prompt.md)。

## 最小示例

```ts
const contextMenu = new ContextMenuManager()
const selectedRow = { id: 'row-1', locked: false }

contextMenu.show(
  [
    { key: 'copy', label: '复制', shortcut: 'Ctrl+C' },
    { key: 'paste', label: '粘贴', shortcut: 'Ctrl+V' },
    { separator: true },
    { key: 'delete', label: '删除', danger: true, disabled: selectedRow.locked },
  ],
  { x: 160, y: 96 },
  key => {
    void key
  },
)
```

`show()` 会先关闭已有菜单，再打开新的根菜单。选择叶子项后会执行 `onSelect(key)` 并关闭整个菜单。

## 构造参数

`new ContextMenuManager()` 不接收 options。菜单内容、打开位置和选择回调都通过 `show(items, pos, onSelect?)` 传入。

`show()` 的参数：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `items` | `ContextMenuEntry[]` | 必填 | 菜单项数组。可以混合普通项和分隔线，普通项可包含 `items` 子菜单。 |
| `pos` | `Offset` | 必填 | 菜单期望打开的全局位置，通常来自鼠标右键位置或按钮全局矩形。 |
| `onSelect` | `(key: string) => void` | `undefined` | 叶子菜单项被选择时触发。disabled 项和 separator 不会触发。 |

如果通过 `AppOverlayService.showContextMenu(items, position, onSelect)` 打开菜单，参数语义相同，只是 manager 的持有和释放由 overlay service 统一处理。

## 子菜单示例

```ts
const contextMenu = new ContextMenuManager()

contextMenu.show(
  [
    {
      key: 'transform',
      label: '转换',
      items: [
        { key: 'upper', label: '转大写' },
        { key: 'lower', label: '转小写' },
      ],
    },
    { separator: true },
    {
      key: 'inspect',
      label: '检查',
      icon: 'search',
      items: [
        { key: 'inspect-node', label: '检查节点' },
        { key: 'inspect-layout', label: '检查布局' },
      ],
    },
  ],
  { x: 240, y: 140 },
  key => {
    void key
  },
)
```

有 `items` 且非空的菜单项是子菜单分支。鼠标 hover 或键盘 `ArrowRight` 会打开子菜单，子菜单选择叶子项后复用根菜单的 `onSelect`。

## App Overlay Service 用法

复杂业务页面通常不直接保存 `ContextMenuManager`，而是通过应用服务打开菜单。这样右键菜单和 modal、notification、window 等 overlay 能共享宿主窗口、popup 管理和释放策略。

```ts
function openRowMenu(showContextMenu: (items: ContextMenuEntry[], position: { x: number; y: number }, onSelect: (key: string) => void) => void): void {
  showContextMenu(
    [
      { key: 'open', label: '打开' },
      { key: 'copy-id', label: '复制 ID' },
    ],
    { x: 120, y: 80 },
    key => {
      void key
    },
  )
}
```

在 demo app 中，对应入口是 `AppOverlayService.showContextMenu(items, position, onSelect)`。

## ContextMenuEntry

```ts
type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator
```

菜单数组可以混合普通项和分隔线。

## ContextMenuItem

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | `string` | 是 | 菜单项稳定 ID。选择叶子项时传给 `onSelect(key)`。 |
| `label` | `string` | 是 | 菜单显示文本。 |
| `icon` | `string` | 否 | 左侧图标。内置 icon name 会绘制为图标 glyph；其他字符串会按文本绘制。 |
| `shortcut` | `string` | 否 | 右侧快捷键提示文本，只负责显示，不注册快捷键。 |
| `disabled` | `boolean` | 否 | 禁用项不能点击，键盘导航会跳过。 |
| `danger` | `boolean` | 否 | 危险操作文本使用 danger token。 |
| `items` | `ContextMenuEntry[]` | 否 | 子菜单项。存在非空数组时，该项作为子菜单分支。 |
| `separator` | `false` | 否 | 类型区分字段。普通项不需要传。 |

## ContextMenuSeparator

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `separator` | `true` | 是 | 绘制分隔线。 |

分隔线不可 hover、不可键盘聚焦、不会传给 `onSelect`。当前实现不会自动去除连续分隔线或首尾分隔线，业务生成菜单时应自行规整。

## ContextMenuManager 属性

| API | 类型 | 说明 |
| --- | --- | --- |
| `itemHeight` | `number` | 当前主题下单个菜单项高度。来自 `deriveContextMenuStyle()`。 |
| `separatorHeight` | `number` | 当前主题下分隔线占用高度。 |
| `menuWidth` | `number` | 当前主题下菜单宽度。默认主题为 `200`。 |
| `visible` | `boolean` | 根菜单是否可见。 |

这些尺寸会读取 `PopupManager.instance.context.theme`。切换主题或 viewport 后，菜单布局会按新的 popup context 重新计算。

## ContextMenuManager 方法

| API | 返回值 | 说明 |
| --- | --- | --- |
| `show(items, pos, onSelect?)` | `void` | 关闭旧菜单并在 `pos` 附近打开新菜单。 |
| `hide()` | `void` | 关闭当前根菜单。 |
| `close()` | `void` | `hide()` 的别名。 |
| `paint(context, offset?)` | `void` | 兼容旧 overlay 绘制入口。实际菜单已由 popup surface 管理。 |
| `debugState(popupContext?)` | `ContextMenuManagerDebugState` | 返回当前菜单位置、尺寸、可见性和真实绘制项。 |
| `dispose()` | `void` | 关闭菜单。 |

## debugState

`debugState()` 返回：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `pos` | `Offset` | 菜单左上角位置。 |
| `totalHeight` | `number` | 菜单总高度。 |
| `menuWidth` | `number` | 菜单宽度。 |
| `itemHeight` | `number` | 菜单项高度。 |
| `separatorHeight` | `number` | 分隔线高度。 |
| `hoveredKey` | `string` | 当前 hover 或键盘聚焦项 key。 |
| `childParentKey` | `string` | 当前打开子菜单所属父项 key。 |
| `visible` | `boolean` | 根菜单当前是否可见。 |
| `visibleItems` | `readonly ContextMenuItemDebugTarget[]` | 最后一次真实 paint 的 root/submenu 菜单项；separator 不产生 target。 |

`ContextMenuItemDebugTarget` 包含稳定 `key`、从 root 到当前项的 `path`、全局 `rect`、`disabled` 和 `hasSubmenu`。菜单打开但尚未真实绘制时数组为空；show/hide、子菜单变化、主题、viewport、关闭或 dispose 会让旧目标失效。返回值是脱离副本，适合 Canvas 自动化按真实矩形点击，不应作为业务状态 authority。

调试菜单定位、主题尺寸和子菜单状态时可以读取它。业务逻辑不要依赖 `debugState()` 做状态管理。

## 鼠标行为

- `show()` 的 `pos` 是菜单期望打开位置，通常来自右键事件位置或按钮全局位置。
- 菜单会限制在当前 popup viewport bounds 内，四周保留 4px 边距。
- hover 普通项会更新 hover 背景。
- hover 子菜单项会打开子菜单。
- 点击 disabled 项无效。
- 点击普通叶子项会执行 `onSelect(key)` 并关闭根菜单。
- 点击子菜单分支会打开子菜单，不会触发 `onSelect`。
- 指针离开父菜单但子菜单仍打开时，父菜单会保持子菜单分支的 hover 状态。

## 键盘行为

| 按键 | 行为 |
| --- | --- |
| `ArrowDown` | 聚焦下一个可选项，跳过 disabled 和 separator。 |
| `ArrowUp` | 聚焦上一个可选项，跳过 disabled 和 separator。 |
| `ArrowRight` | 当前项有子菜单时打开子菜单。 |
| `ArrowLeft` | 在子菜单中返回父菜单。 |
| `Enter` | 执行当前叶子项；当前项有子菜单时打开子菜单。 |
| `Escape` | 关闭根菜单。 |
| `Tab` | 关闭菜单，但不消费焦点移动。 |

菜单打开时会暂时清空当前焦点，关闭后由 popup/focus 管理恢复之前焦点。

## 定位和边界

`ContextMenuManager.show()` 使用整个 popup viewport 作为 bounds：

- `x` 超出右侧时向左夹取。
- `y` 超出底部时向上夹取。
- 左上角不会小于 bounds 的 4px 内边距。
- 子菜单默认从父菜单项右侧打开；右侧空间不足时改到左侧。

需要自定义锚点或菜单位置时，业务项目仍应通过 `ContextMenuManager` 或 overlay service 提供的公共能力完成；不要从包内路径导入未公开的菜单实现。

## 绘制和主题

ContextMenu 使用主题派生 token：

- 面板背景、阴影和边框来自 popup style。
- 行高、padding、圆角、字体来自 context menu style。
- hover、disabled、danger 状态通过 `resolveBgColor()` 和 `resolveTextColor()` 解析。
- label 会裁剪在 shortcut 和子菜单箭头之前，避免长文本覆盖右侧区域。
- submenu 使用右侧 `chevron-right` 内置图标指示。
- 分隔线使用 `separator` token。

## 与命令体系组合

如果菜单项来自命令权限和 enable 状态，优先用命令适配器生成 `ContextMenuEntry[]`：

```ts
const commandManager = new CommandManager()
commandManager.register({
  id: 'record.open',
  title: '打开',
  execute: () => undefined,
})
commandManager.register({
  id: 'record.delete',
  title: '删除',
  execute: () => undefined,
})

const source = new RenderText('菜单来源')
const menu = createCommandContextMenu(commandManager, source, [
  { kind: 'command', commandId: 'record.open' },
  { kind: 'separator' },
  { kind: 'command', commandId: 'record.delete', danger: true },
])

const contextMenu = new ContextMenuManager()
contextMenu.show(menu.entries, { x: 100, y: 100 }, menu.onSelect)
```

`shortcut` 只是显示文本，不负责注册快捷键。实际快捷键应交给命令系统或页面键盘处理。

## 生命周期

- `show()` 会先 `hide()`，避免多个根菜单叠加。
- 选择叶子项后关闭根菜单。
- `hide()` / `close()` 会 dismiss 当前 root popup。
- `dispose()` 会关闭菜单，但 `ContextMenuManager` 本身不持有业务对象。
- 不要为每一行、每个树节点常驻一个 manager。推荐页面或服务层持有一个 manager，打开时动态生成 items。

## 常见问题

### 为什么 disabled 项不能被键盘选中？

当前实现的 `_selectableItems()` 会过滤 disabled 和 separator。鼠标点击 disabled 项也不会触发选择。

### shortcut 会自动绑定快捷键吗？

不会。`shortcut` 只是菜单右侧展示文本。快捷键注册应由命令系统、页面键盘处理或具体控件负责。

### 可以在菜单项上配置 visible 吗？

`ContextMenuItem` 没有 `visible` 字段。需要隐藏时，打开菜单前重新生成 `items`。命令菜单适配器可以在生成 entries 前处理 visible。

### 为什么右键菜单不会打开浏览器原生菜单？

Canvas runtime 会在 canvas bounds 内抑制浏览器原生 contextmenu，并把右键行为交给框架事件系统。业务控件或页面收到右键后再调用 `show()`。

### 菜单可以滚动吗？

当前 ContextMenu 不做内部滚动，`onWheel()` 会消费滚轮事件。菜单项过多时，应拆成子菜单、搜索弹窗或专用列表组件。

## 相关文档

- [Popup 和 Overlay 概念](../../lifecycle.md)
- Commands API
- [MenuBar](../navigation/menu-bar.md)
- [Toolbar](../command/toolbar.md)
- [Tabs](../navigation/tabs.md)
- [DockWorkspace](../navigation/dock-workspace.md)
