# CommandToolbar 命令工具栏

> **通用布局能力**：`RenderCommandToolbar` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；工具栏内部视觉 padding 不等同于 `RenderPanel.padding`。详见[组件通用布局属性](../common-layout-properties.md)。


DirectSurface UI 的命令工具栏公共类名是 `RenderCommandToolbar`。它把一组命令配置转换成底层 `RenderToolbar` 的按钮和分隔符，统一处理命令标题、图标、tooltip、权限、可见性、启用状态、执行中 loading 和点击执行。

`RenderCommandToolbar` 适合页面顶部操作栏、表格操作区、编辑器工具栏等“多个业务动作并列展示”的场景。命令本身仍由 `AppCommand` 定义并注册到 `CommandManager`；工具栏只负责把当前命令状态投影成可交互 UI。

## API 总览

```ts
import {
  AppContextRegistry,
  CommandManager,
  RenderCommandScope,
  RenderCommandToolbar,
  commandManagerContextKey,
  createAppContextKey,
  type CommandToolbarCommandItem,
  type CommandToolbarGroup,
  type CommandToolbarItem,
  type CommandToolbarSeparatorItem,
  type RenderCommandToolbarOptions,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderCommandToolbar` | class | 把命令分组投影到底层 `RenderToolbar`，并同步命令状态。 |
| `RenderCommandToolbarOptions` | type | 命令工具栏构造参数。 |
| `CommandToolbarGroup` | type | 命令工具栏分组配置。 |
| `CommandToolbarItem` | type | 命令工具栏项联合类型。 |
| `CommandToolbarCommandItem` | type | 绑定单个命令的工具栏项。 |
| `CommandToolbarSeparatorItem` | type | 命令工具栏分隔符项。 |
| `CommandManager` | class | 命令注册、求值、执行和状态通知来源。 |
| `RenderCommandScope` | class | 页面级或组件级命令作用域。 |
| `commandManagerContextKey` | const | 没有显式 `commandManager` 时用于从 app context 解析 manager。 |

最小装配顺序是：注册命令，创建 `CommandToolbarGroup[]`，再创建 `RenderCommandToolbar`。工具栏 item 只写 `commandId`，按钮文本、icon、tooltip、禁用和 loading 都来自命令求值结果。

## 何时使用

- 一个页面有多组操作按钮，例如新建、保存、提交、删除、导出。
- 同一动作还要出现在菜单、右键菜单或快捷键中。
- 按钮标题、icon、tooltip 和 disabled 状态要来自命令系统。
- 命令需要按应用级、页面级、组件级作用域查找。
- 容器宽度不足时需要工具栏溢出菜单。

不适合：

- 只有一个普通按钮，使用 [CommandButton](./command-button.md) 或 [Button](../basic/button.md)。
- 需要手工组合普通按钮、下拉按钮和开关按钮，直接使用 [Toolbar](./toolbar.md)。
- 需要复杂菜单层级，使用 `createCommandContextMenu` 或 `createCommandMenuBarItems`，参考 Commands API。

## 最小示例

```ts
const commandManager = new CommandManager()

commandManager.register({
  id: 'record.save',
  title: '保存',
  icon: 'document',
  execute: () => {
    save()
  },
})

commandManager.register({
  id: 'record.refresh',
  title: '刷新',
  icon: 'refresh',
  execute: () => {
    reload()
  },
})

const toolbar = new RenderCommandToolbar({
  commandManager,
  groups: [{
    id: 'record',
    slot: 'leading',
    items: [
      { kind: 'command', commandId: 'record.save' },
      { kind: 'separator', id: 'record-separator' },
      { kind: 'command', commandId: 'record.refresh' },
    ],
  }],
})
```

工具栏布局时会读取命令状态，生成两个命令按钮和一个分隔符。

## 页面级作用域示例

更常见的写法是把页面命令注册在 `RenderCommandScope`，并把 manager 放入 app context。工具栏只写 command id：

```ts
const dirtyKey = createAppContextKey<boolean>('record.dirty')
const commandManager = new CommandManager({
  permissionService: {
    has: permission => permission === 'record.save' || permission === 'record.submit',
  },
})

const appContext = new AppContextRegistry(undefined, [
  [commandManagerContextKey, commandManager],
  [dirtyKey, true],
])

const recordToolbar = new RenderCommandToolbar({
  groups: [{
    id: 'record',
    slot: 'leading',
    items: [
      { kind: 'command', commandId: 'record.save', showLabel: true },
      { kind: 'command', commandId: 'record.submit', showLabel: true },
    ],
  }],
})

const recordPageScope = new RenderCommandScope({
  commandManager,
  debugLabel: 'record-page',
  commands: [
    {
      id: 'record.save',
      title: '保存',
      icon: 'document',
      permission: 'record.save',
      canExecute: context => context.appContext.require(dirtyKey) === true,
      disabledReason: () => '没有未保存内容',
      execute: () => {
        save()
        appContext.set(dirtyKey, false)
        commandManager.invalidate()
      },
    },
    {
      id: 'record.submit',
      title: '提交',
      icon: 'chevron-right',
      permission: 'record.submit',
      canExecute: context => context.appContext.require(dirtyKey) === false,
      disabledReason: () => '提交前需要先保存',
      execute: () => {
        state.submitted = true
      },
    },
  ],
  child: recordToolbar,
})
```

`recordToolbar` 会从自身向上解析最近的 `CommandScope`，因此页面命令可以覆盖应用级同名命令。`recordPageScope` 销毁后，它创建的页面命令也会释放。

## 组件关系

| 组件 / 类型 | 用途 | 说明 |
| --- | --- | --- |
| `RenderCommandToolbar` | 命令工具栏。 | 把 `CommandToolbarGroup[]` 转成 `RenderToolbar` 分组。 |
| `RenderToolbar` | 底层工具栏。 | 提供 leading/trailing 插槽、按钮绘制、tooltip、键盘焦点、溢出菜单。 |
| `CommandManager` | 命令管理器。 | 负责注册、求值、执行、权限、订阅和拦截器。 |
| `CommandScope` / `RenderCommandScope` | 命令作用域。 | 支持应用级、页面级和组件级命令覆盖与生命周期释放。 |
| `AppCommand` | 命令定义。 | 提供 `title`、`icon`、权限、状态求值和执行函数。 |
| `CommandToolbarGroup` | 命令工具栏分组配置。 | 描述组 id、插槽和组内命令项。 |
| `CommandToolbarItem` | 命令项配置。 | 当前支持 command 和 separator。 |
| `commandManagerContextKey` | 上下文 key。 | 工具栏没有显式 manager 时从 app context 取 manager。 |

## RenderCommandToolbar 构造参数

`new RenderCommandToolbar(options)` 的 `options`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `groups` | `CommandToolbarGroup[]` | 必填 | 命令工具栏分组。 |
| `commandManager` | `CommandManager` | 从 app context 解析 | 显式指定命令管理器。未指定时读取 `commandManagerContextKey`。 |

```ts
const commandToolbar = new RenderCommandToolbar({
  commandManager,
  groups: [{
    id: 'primary-actions',
    slot: 'leading',
    items: [{ kind: 'command', commandId: 'record.save' }],
  }],
})
```

## CommandToolbarGroup

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 分组 id。用于调试、布局和溢出归属。 |
| `slot` | `'leading' \| 'trailing'` | 分组所在插槽。leading 在左侧，trailing 在右侧。 |
| `visible` | `boolean` | 组是否可见。传给底层 `RenderToolbar`。 |
| `items` | `CommandToolbarItem[]` | 分组内项目。 |

```ts
const toolbarGroups: CommandToolbarGroup[] = [
  {
    id: 'edit',
    slot: 'leading',
    items: [
      { kind: 'command', commandId: 'edit.undo', showLabel: false },
      { kind: 'command', commandId: 'edit.redo', showLabel: false },
    ],
  },
  {
    id: 'workflow',
    slot: 'trailing',
    items: [
      { kind: 'command', commandId: 'record.submit', showLabel: true },
    ],
  },
]
```

插槽只决定工具栏内的左右分区，不代表命令作用域。命令作用域仍由 render tree 上的 `RenderCommandScope` 决定。

## CommandToolbarItem

`CommandToolbarItem` 当前有两类：

```ts
type CommandToolbarItem = CommandToolbarCommandItem | CommandToolbarSeparatorItem
```

### CommandToolbarCommandItem

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `kind` | `'command'` | 必填 | 命令项标记。 |
| `commandId` | `string` | 必填 | 绑定的命令 id。 |
| `id` | `string` | `commandId` | 工具栏项 id。用于 `itemRect()`、调试和溢出。 |
| `label` | `string` | 命令 `title` | 覆盖按钮显示文本。 |
| `tooltip` | `string` | 命令 `reason` 或 `description` | 覆盖 tooltip。 |
| `showLabel` | `boolean` | 由底层 toolbar 决定 | 是否显示文字。设为 `false` 且命令有 icon 时表现为 icon-only。 |

```ts
const commandItem: CommandToolbarCommandItem = {
  kind: 'command',
  commandId: 'record.audit',
  id: 'audit-main',
  label: '审核通过',
  tooltip: '执行当前文档审核',
  showLabel: true,
}
```

命令项的 icon 来自 `AppCommand.icon`。`RenderCommandToolbar` 不在 item 上单独定义 icon 覆盖字段；需要不同 icon 时应在命令定义中配置。

### CommandToolbarSeparatorItem

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `kind` | `'separator'` | 必填 | 分隔符标记。 |
| `id` | `string` | `` `${group.id}:separator` `` | 分隔符 id。 |

```ts
const separatorItem: CommandToolbarSeparatorItem = {
  kind: 'separator',
  id: 'edit-separator-before-format',
}
```

同一组内有多个分隔符时建议显式传 `id`，否则默认 id 会重复，不利于调试和 `itemRect()` 查询。

## AppCommand 字段如何投影到工具栏

| `AppCommand` 字段 | 工具栏表现 |
| --- | --- |
| `title` | 默认按钮 label。 |
| `description` | 没有禁用原因时作为 tooltip 候选。 |
| `icon` | 按钮 icon。必须是框架支持的 `IconName`。 |
| `permission` | 权限不足时按钮 disabled，tooltip 为 `'权限不足'`。 |
| `visible` | 返回 `false` 时该命令项从工具栏中移除。 |
| `enabled` | 返回 `false` 时按钮 disabled。 |
| `canExecute` | 返回 `false` 时按钮 disabled；点击前也会重新求值。 |
| `disabledReason` | disabled 时作为 tooltip 候选。 |
| `execute` | 点击按钮后执行。 |

```ts
commandManager.register({
  id: 'record.delete',
  title: '删除',
  icon: 'trash',
  permission: 'record.delete',
  visible: () => state.mode === 'edit',
  canExecute: () => state.selectedIds.length > 0,
  disabledReason: () => '请先选择记录',
  execute: () => {
    remove()
  },
})
```

`visible=false` 与 [CommandButton](./command-button.md) 一样表示入口不展示，不占用布局空间。区别是 `RenderCommandToolbar` 会在生成工具栏项时过滤该命令；`RenderCommandButton` 会把按钮自身同步为 `visible=false`。

## 状态同步流程

工具栏 layout 前会同步命令状态：

1. 解析 `CommandManager`。
2. 如果 manager 不存在，底层 toolbar groups 置空。
3. 根据 manager `version` 判断是否需要重新求值。
4. 遍历 `CommandToolbarGroup[]`。
5. separator 映射成底层 toolbar separator。
6. command item 调用 `manager.evaluate(commandId, { source: toolbar })`。
7. `state.visible === false` 的命令项被过滤。
8. 其余命令项映射成底层 toolbar button。

按钮点击后执行：

```ts
const commandId = 'record.save'
void commandManager.execute(commandId, {
  source: toolbar,
  trigger: 'click',
})
```

执行前 `CommandManager` 会再次求值，避免状态过期导致非法执行。

## RenderCommandToolbar 属性和方法

`RenderCommandToolbar` 自身新增：

| API | 类型 / 返回值 | 说明 |
| --- | --- | --- |
| `commandGroups` | `readonly CommandToolbarGroup[]` | 当前命令分组配置。 |
| `setCommandGroups(groups)` | `void` | 替换命令分组，清理命令状态缓存并重新 layout。 |
| `dispose()` | `void` | 取消 manager 订阅并释放底层 toolbar 资源。 |

继承自 `RenderToolbar` 的常用 API：

| API | 类型 / 返回值 | 说明 |
| --- | --- | --- |
| `groups` | `readonly ToolbarGroup[]` | 当前已经投影后的底层 toolbar 分组。 |
| `itemRect(id)` | `Rect \| null` | 获取已布局项的矩形。可用于测试、浮层锚点或调试。 |
| `debugState()` | 对象 | 返回可见 leading/trailing 组、溢出组、可见 item id 和当前打开项。 |
| `clearGroups()` / `setGroups()` | `void` | 底层 toolbar API。通常不建议直接用于 `RenderCommandToolbar`，应使用 `setCommandGroups()`。 |

```ts
const debugToolbar = new RenderCommandToolbar({
  commandManager,
  groups: [{
    id: 'record',
    slot: 'leading',
    items: [{ kind: 'command', commandId: 'record.save' }],
  }],
})

debugToolbar.setCommandGroups([
  {
    id: 'record',
    slot: 'leading',
    items: [
      { kind: 'command', commandId: 'record.save' },
      { kind: 'command', commandId: 'record.submit' },
    ],
  },
])

state.visibleToolbarItems = debugToolbar.debugState().visibleItemIds
```

## CommandManager 解析规则

`RenderCommandToolbar` 通过下面顺序取得 manager：

1. 构造参数 `commandManager`。
2. 当前 render tree / app context 中的 `commandManagerContextKey`。
3. 找不到 manager 时，工具栏没有任何项。

```ts
const manager = new CommandManager()
const rootContext = new AppContextRegistry(undefined, [
  [commandManagerContextKey, manager],
])

const contextToolbar = new RenderCommandToolbar({
  groups: [{
    id: 'record',
    slot: 'leading',
    items: [{ kind: 'command', commandId: 'record.save' }],
  }],
})

state.rootContext = rootContext
state.contextToolbar = contextToolbar
```

如果一个页面需要隔离命令管理器，可以显式传 `commandManager`。如果整个应用共享一个命令管理器，推荐放入 app context。

## 权限、可见性和 disabled

`RenderCommandToolbar` 对命令状态的处理：

| 状态来源 | 工具栏表现 | tooltip 候选 |
| --- | --- | --- |
| 命令不存在 | 不显示该命令项 | 无 |
| `visible()` 返回 `false` | 不显示该命令项 | 无 |
| 权限不足 | 显示按钮但 disabled | `'权限不足'` |
| 命令正在执行 | 显示按钮但 disabled | `'正在执行'` |
| `enabled()` 返回 `false` | 显示按钮但 disabled | `disabledReason()` 或 `'当前状态不可用'` |
| `canExecute()` 返回 `false` | 显示按钮但 disabled | `disabledReason()` 或 `'当前状态不可用'` |

```ts
const permissionToolbarManager = new CommandManager({
  permissionService: {
    has: permission => permission === 'record.save',
  },
})

permissionToolbarManager.register({
  id: 'record.save',
  title: '保存',
  permission: 'record.save',
  execute: () => save(),
})

permissionToolbarManager.register({
  id: 'record.audit',
  title: '审核',
  permission: 'record.audit',
  execute: () => {},
})

const permissionToolbar = new RenderCommandToolbar({
  commandManager: permissionToolbarManager,
  groups: [{
    id: 'record',
    slot: 'leading',
    items: [
      { kind: 'command', commandId: 'record.save' },
      { kind: 'command', commandId: 'record.audit' },
    ],
  }],
})
```

上例中 `record.audit` 会显示为 disabled，tooltip 为 `'权限不足'`。

## 插槽、布局和溢出

`RenderCommandToolbar` 复用 [Toolbar](./toolbar.md) 的布局规则：

- `slot: 'leading'` 的组放在左侧。
- `slot: 'trailing'` 的组放在右侧。
- leading 和 trailing 同时存在时，中间保留 section gap。
- 容器宽度不足时，底层 toolbar 会把部分项目放入溢出菜单。
- 溢出菜单里的项目仍使用原来的 `onClick`，点击后执行对应命令。
- 分隔符只作为视觉分割，不可点击。

```ts
const wideToolbar = new RenderCommandToolbar({
  commandManager,
  groups: [
    {
      id: 'edit',
      slot: 'leading',
      items: [
        { kind: 'command', commandId: 'edit.undo', showLabel: false },
        { kind: 'command', commandId: 'edit.redo', showLabel: false },
      ],
    },
    {
      id: 'workflow',
      slot: 'trailing',
      items: [
        { kind: 'command', commandId: 'record.save', showLabel: true },
        { kind: 'command', commandId: 'record.submit', showLabel: true },
      ],
    },
  ],
})
```

工具栏宽度由父布局约束决定。命令项较多时，优先通过分组、`showLabel: false` 和合理 icon 减少宽度，而不是手动压缩文字。

## 动态更新命令组

当页面模式变化、选项卡切换或权限域变化时，可以替换工具栏命令组：

```ts
function switchToReadonlyMode(toolbar: RenderCommandToolbar): void {
  toolbar.setCommandGroups([
    {
      id: 'readonly',
      slot: 'leading',
      items: [
        { kind: 'command', commandId: 'record.refresh' },
        { kind: 'command', commandId: 'record.export' },
      ],
    },
  ])
}
```

`setCommandGroups()` 会清理工具栏内部命令版本缓存并重新 layout。业务仍需要保证对应命令已经注册，或者允许未注册命令不显示。

## 刷新命令状态

命令状态依赖业务数据时，数据变化后调用 `commandManager.invalidate()`：

```ts
let hasSelection = false

commandManager.register({
  id: 'record.delete',
  title: '删除',
  icon: 'trash',
  canExecute: () => hasSelection,
  disabledReason: () => '请先选择记录',
  execute: () => remove(),
})

function onSelectionChanged(selected: boolean): void {
  hasSelection = selected
  commandManager.invalidate()
}
```

`RenderCommandToolbar` 订阅 manager。manager 失效后，工具栏会清理版本缓存并请求重新 layout。下一次 layout 时重新投影命令状态。

性能要求：

- `visible`、`enabled`、`canExecute`、`disabledReason` 必须同步且轻量。
- 不要在状态求值里请求接口、遍历大文档或修改 UI。
- 复杂业务状态先整理成页面级派生字段，再让命令读取这些字段。

## 点击、键盘和焦点

`RenderCommandToolbar` 的交互来自底层 `RenderToolbar`：

| 操作 | 行为 |
| --- | --- |
| 鼠标点击命令按钮 | 执行对应命令，trigger 为 `'click'`。 |
| 鼠标 hover | 显示 hover 状态；有 tooltip 时显示 tooltip。 |
| 点击禁用命令 | 不执行。 |
| 宽度不足点击溢出按钮 | 打开溢出菜单。 |
| 溢出菜单点击命令项 | 执行对应命令，trigger 仍为 `'click'`。 |
| 键盘导航 | 由底层 `RenderToolbar` 处理焦点项和激活。 |

工具栏不会注册全局快捷键。快捷键由 `CommandShortcutController` 根据命令 `shortcut` 统一处理。

## 与 CommandButton 的区别

| 能力 | `RenderCommandToolbar` | `RenderCommandButton` |
| --- | --- | --- |
| 多组命令 | 是 | 否 |
| leading / trailing 插槽 | 是 | 否 |
| 分隔符 | 是 | 否 |
| icon 展示 | 是，来自 `AppCommand.icon` | 否 |
| `visible=false` | 过滤命令项，不占布局 | 按钮自身 `visible=false`，不占布局 |
| 溢出菜单 | 是，来自底层 `RenderToolbar` | 否 |
| 适合场景 | 页面工具栏、表格操作栏、编辑器工具栏 | 单个按钮、表单底部按钮 |

## 常见问题

### 为什么命令按钮没有出现在工具栏？

检查：

1. 是否能解析到 `CommandManager`。
2. 命令是否已经注册。
3. `commandId` 是否和 `AppCommand.id` 一致。
4. `visible()` 是否返回 `false`。
5. 对应分组 `visible` 是否为 `false`。
6. 容器是否太窄，项目是否进入了溢出菜单。

### 为什么按钮显示为禁用？

检查权限服务、`enabled()`、`canExecute()` 和命令是否正在执行。可以用 `commandManager.inspect(commandId, { source: toolbar })` 查看 reason、权限和作用域。

### 为什么 command.title 或权限变化后工具栏没刷新？

调用 `commandManager.invalidate()`。工具栏依赖 manager version 判断是否重新投影命令状态。

### 为什么 showLabel=false 后文字还显示？

底层 toolbar 的规则是：当项目有 icon 且 `showLabel === false` 时可以只显示 icon。如果命令没有提供 `icon`，仍需要显示文字，否则按钮无法表达含义。

### 为什么多个分隔符的 itemRect 查不准？

没有显式 `id` 的分隔符默认使用 `` `${group.id}:separator` ``。同一组多个分隔符会重复 id。需要调试或定位时给每个分隔符单独设置 `id`。

## 相关文档

- 命令与权限
- Commands API 参考
- [CommandButton](./command-button.md)
- [Toolbar](./toolbar.md)
- [ContextMenu](../overlay/context-menu.md)
- [MenuBar](../navigation/menu-bar.md)
