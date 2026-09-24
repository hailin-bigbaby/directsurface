# CommandButton 命令按钮

> **通用布局能力**：`RenderCommandButton` 继承按钮的统一 `RenderBox` 布局属性，实例支持 `width`、`height`、min/max、`margin` 和槽位对齐；未列入构造参数表的字段在创建后赋值。详见[组件通用布局属性](../common-layout-properties.md)。


DirectSurface UI 的命令按钮公共类名是 `RenderCommandButton`。它把普通文字按钮绑定到 `CommandManager` 中的命令 id，让按钮的标题、tooltip、禁用态、loading 态和执行入口都从命令系统统一取得。

`RenderCommandButton` 适合页面上的普通操作按钮，例如保存、提交、删除、刷新。它继承 `RenderButton` 的布局和视觉能力，但执行逻辑来自命令系统。命令本身由 `AppCommand` 描述，注册在 `CommandManager` 的根作用域或局部 `CommandScope` 中。

## API 总览

```ts
import {
  AppContextRegistry,
  CommandManager,
  RenderCommandButton,
  RenderCommandScope,
  commandManagerContextKey,
  createAppContextKey,
  type AppCommand,
  type CommandState,
  type RenderCommandButtonOptions,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderCommandButton` | class | 绑定单个 `commandId` 的按钮，从命令状态同步 label、tooltip、disabled 和 loading。 |
| `RenderCommandButtonOptions` | type | 命令按钮构造参数。 |
| `CommandManager` | class | 命令注册、状态求值、执行、权限和订阅。 |
| `RenderCommandScope` | class | 把局部命令作用域挂入 render tree，页面释放时可自动释放局部命令。 |
| `commandManagerContextKey` | const | app context 中传递 `CommandManager` 的 key。 |
| `AppCommand` | type | 命令定义。 |
| `CommandState` | type | 命令当前可见、可用、执行中、禁用原因等求值结果。 |

最小装配顺序是：创建或取得 `CommandManager`，注册 `AppCommand`，再创建 `RenderCommandButton({ commandId, commandManager })`。页面级命令推荐放在 `RenderCommandScope` 中，而不是全部注册到根 manager。

## 何时使用

- 同一个动作需要被按钮、菜单、右键菜单、快捷键复用。
- 按钮的 enabled 状态依赖页面状态，例如当前记录是否有改动、表格是否有选中行。
- 按钮需要统一接入权限服务。
- 页面关闭时，页面命令要随页面作用域释放。
- 希望调试时能通过命令 id、权限、作用域和禁用原因检查按钮状态。

不适合：

- 只是一个没有业务命令含义的普通按钮，使用 [Button](../basic/button.md)。
- 需要一组命令自动生成工具栏、分组和分隔符，使用 [CommandToolbar](./command-toolbar.md)。
- 需要菜单结构、子菜单或右键菜单，使用 `createCommandContextMenu`，参考 Commands API。

## 最小示例

```ts
const commandManager = new CommandManager()

commandManager.register({
  id: 'record.save',
  title: '保存',
  description: '保存当前记录',
  execute: () => {
    save()
  },
})

const saveButton = new RenderCommandButton({
  commandId: 'record.save',
  commandManager,
})
```

按钮会从命令定义里读取 `title` 作为文字，并在点击时执行 `record.save`。

## 推荐页面级写法

页面级命令通常放在 `RenderCommandScope` 中。按钮不必直接持有 manager，只要页面树上方的 app context 提供了 `commandManagerContextKey`，按钮会自动解析当前作用域里的命令。

```ts
const dirtyKey = createAppContextKey<boolean>('record.dirty')
const commandManager = new CommandManager({
  permissionService: {
    has: permission => permission === 'record.save',
  },
})

const appContext = new AppContextRegistry(undefined, [
  [commandManagerContextKey, commandManager],
  [dirtyKey, true],
])

const saveButton = new RenderCommandButton({
  commandId: 'record.save',
})

const pageScope = new RenderCommandScope({
  commandManager,
  debugLabel: 'record-page',
  commands: [{
    id: 'record.save',
    title: '保存文档',
    description: '保存当前文档内容',
    permission: 'record.save',
    canExecute: context => context.appContext.require(dirtyKey) === true,
    disabledReason: () => '没有未保存内容',
    execute: () => {
      save()
      appContext.set(dirtyKey, false)
      commandManager.invalidate()
    },
  }],
  child: saveButton,
})
```

`RenderCommandScope` 销毁时会释放它创建的局部 `CommandScope`。页面关闭后，页面命令不会继续影响其他页面。

## 组件关系

| 组件 / 类型 | 用途 | 说明 |
| --- | --- | --- |
| `RenderCommandButton` | 命令按钮。 | 继承 `RenderButton`，通过 `commandId` 绑定命令。 |
| `CommandManager` | 命令管理器。 | 负责注册、求值、执行、权限、拦截器和状态通知。 |
| `CommandScope` | 命令作用域。 | 支持应用级、页面级、组件级命令覆盖。 |
| `RenderCommandScope` | 可放入 render tree 的命令作用域。 | 页面或组件销毁时释放局部命令。 |
| `AppCommand` | 命令定义。 | 描述标题、权限、可见性、启用状态、快捷键和执行函数。 |
| `CommandState` | 命令求值结果。 | 按钮用它同步 label、tooltip、visible、disabled 和 loading。 |
| `PermissionService` | 权限服务。 | 由业务提供，命令求值和执行前都会检查。 |
| `commandManagerContextKey` | 上下文 key。 | 用于让按钮从 app context 中取得 `CommandManager`。 |

## RenderCommandButton 构造参数

`new RenderCommandButton(options)` 的 `options`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `commandId` | `string` | 必填 | 绑定的命令 id。必须和 `AppCommand.id` 一致。 |
| `commandManager` | `CommandManager` | 从 app context 解析 | 显式指定命令管理器。未指定时读取 `commandManagerContextKey`。 |
| `label` | `string` | `commandId`，随后同步命令 `title` | 显式按钮文字。设置后优先于命令 `title`。 |
| `tooltip` | `string` | `''`，随后同步命令状态 | 显式 tooltip。设置后优先于禁用原因和命令描述。 |
| `variant` | `ButtonVariant` | `'default'` | 传给 `RenderButton` 的按钮视觉类型。 |

```ts
const auditButton = new RenderCommandButton({
  commandId: 'record.audit',
  commandManager,
  label: '审核',
  tooltip: '执行审核操作',
  variant: 'primary',
})
```

如果传入 `label` 或 `tooltip`，按钮不会再用命令 `title` 或命令状态覆盖对应文本。

## AppCommand 关键字段

`RenderCommandButton` 不直接定义业务逻辑，业务逻辑在 `AppCommand`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 命令 id。按钮通过 `commandId` 引用。 |
| `title` | `string` | 默认按钮文字。 |
| `description` | `string` | 默认 tooltip 候选。命令可用时常用于说明动作。 |
| `icon` | `string` | 命令元数据。`RenderCommandButton` 当前不绘制 icon；工具栏、菜单可使用。 |
| `shortcut` | `string \| readonly string[]` | 快捷键元数据。按钮本身不注册快捷键，快捷键由 `CommandShortcutController` 处理。 |
| `permission` | `string \| readonly string[]` | 功能权限。所有权限都通过才可用。 |
| `visible` | `(context) => boolean` | 命令是否可见。对于 `RenderCommandButton`，不可见会同步到按钮 `visible=false`，按钮折叠为 0 尺寸并从布局中移除。 |
| `enabled` | `(context) => boolean` | 业务启用状态。返回 `false` 时按钮 disabled。 |
| `canExecute` | `(context) => boolean` | 执行前条件。返回 `false` 时按钮 disabled，执行前也会再次检查。 |
| `checked` | `(context) => boolean` | 勾选状态元数据。普通 `RenderCommandButton` 不绘制 checked。 |
| `disabledReason` | `(context) => string \| undefined` | 不可用原因。会作为 tooltip 候选。 |
| `execute` | `(context) => unknown \| Promise<unknown>` | 命令执行函数。 |

```ts
const saveCommand: AppCommand = {
  id: 'record.save',
  title: '保存',
  description: '保存当前记录',
  permission: ['record.edit', 'record.save'],
  canExecute: () => canSave(),
  disabledReason: () => '当前记录没有变化',
  execute: () => {
    save()
  },
}

const disposeSaveCommand = commandManager.register(saveCommand)
disposeSaveCommand()
```

`enabled` 和 `canExecute` 都会影响按钮是否可用。推荐约定：

- `permission`：登录用户有没有这个功能权限。
- `visible`：当前业务场景是否应该展示这个动作。
- `enabled`：页面状态是否允许点击，例如页面未锁定。
- `canExecute`：执行条件是否满足，例如有选中行、有未保存内容。

## 状态求值流程

按钮刷新状态时调用 `CommandManager.evaluate(commandId, { source: button })`。求值顺序：

1. 从按钮所在 render tree 向上查找最近的 `CommandScope`。
2. 在该作用域及父作用域中按 id 查找命令；局部命令会覆盖父级同 id 命令。
3. 创建 `CommandExecutionContext`，其中包含 app context 快照、manager、source、trigger 和 event。
4. 依次判断 `visible`、`permission`、executing、`enabled`、`canExecute`、`checked`。
5. 返回 `CommandState`，按钮据此更新自身状态。

`CommandState` 常用字段：

| 字段 | 说明 |
| --- | --- |
| `title` | 命令标题。未显式传 `label` 时会作为按钮文字。 |
| `visible` | 命令是否可见。按钮会同步为自身 `visible`，不可见时不占布局。 |
| `enabled` | 命令是否可执行。 |
| `checked` | 命令 checked 状态。普通按钮不绘制。 |
| `executing` | 命令是否正在执行。按钮会显示 loading 并禁用。 |
| `reason` | 不可用原因。未显式传 `tooltip` 时会作为 tooltip。 |
| `description` | 命令描述。没有 `reason` 时作为 tooltip 候选。 |

## RenderCommandButton 属性和方法

| API | 类型 / 返回值 | 说明 |
| --- | --- | --- |
| `commandId` | `string` | 只读。绑定的命令 id。 |
| `commandState` | `CommandState \| undefined` | getter。读取时会先刷新命令状态。 |
| `executeCommand(trigger?, event?)` | `Promise<unknown>` | 主动执行命令。默认 trigger 为 `'api'`。没有 manager 或命令不可执行时返回 `undefined`。 |
| `refreshCommandState(force?)` | `boolean` | 刷新按钮状态。返回当前命令是否 visible 且 enabled。 |
| `onKeyDown(event)` | `boolean` | Enter / Space 触发命令。通常由运行时调用。 |
| `dispose()` | `void` | 取消 manager 订阅并释放普通按钮资源。 |

```ts
const submitButton = new RenderCommandButton({
  commandId: 'record.submit',
  commandManager,
})

if (submitButton.refreshCommandState()) {
  void submitButton.executeCommand('api')
}

const stateSnapshot = submitButton.commandState
notificationManager.show(stateSnapshot?.reason ?? stateSnapshot?.title ?? '')
```

## CommandManager 解析规则

`RenderCommandButton` 通过下面顺序取得 manager：

1. 构造参数 `commandManager`。
2. 当前 render tree / app context 中的 `commandManagerContextKey`。
3. 找不到 manager 时，按钮保持 disabled，执行命令返回 `undefined`。

```ts
const manager = new CommandManager()
const rootContext = new AppContextRegistry(undefined, [
  [commandManagerContextKey, manager],
])

const buttonFromContext = new RenderCommandButton({
  commandId: 'record.save',
})

const buttonWithExplicitManager = new RenderCommandButton({
  commandId: 'record.save',
  commandManager: manager,
})

state.buttons = [buttonFromContext, buttonWithExplicitManager]
state.rootContext = rootContext
```

如果业务系统只有一个应用级 manager，推荐放入 app context；如果一个独立测试或浮层需要隔离命令，可以显式传 `commandManager`。

## 权限、可见性和 disabled

权限服务由业务提供：

```ts
const permissionsKey = createAppContextKey<readonly string[]>('auth.permissions')
const managerWithPermission = new CommandManager({
  permissionService: {
    has: (permission, context) => {
      return context.appContext.get(permissionsKey)?.includes(permission) === true
    },
  },
})
```

`permission` 可以是一个字符串，也可以是字符串数组。数组表示全部权限都必须满足。

`RenderCommandButton` 对不可执行状态的表现：

| 状态来源 | 按钮表现 | tooltip 候选 |
| --- | --- | --- |
| 命令不存在 | disabled | `'命令不存在'` |
| `visible()` 返回 `false` | `visible=false`，折叠隐藏，不占布局 | 通常为空 |
| 权限不足 | disabled | `'权限不足'` |
| 命令正在执行 | loading + disabled | `'正在执行'` |
| `enabled()` 返回 `false` | disabled | `disabledReason()` 或 `'当前状态不可用'` |
| `canExecute()` 返回 `false` | disabled | `disabledReason()` 或 `'当前状态不可用'` |

`visible=false` 和 disabled 是不同语义：前者表示当前业务场景不展示该入口，后者表示入口存在但当前不可点。需要保留占位但隐藏内容时，不要用命令 `visible`，应在组合层使用 `RenderVisibility({ mode: 'hidden' })`。

## 执行行为

点击、键盘和手动调用最终都走 `CommandManager.execute()`：

- 点击按钮时 trigger 为 `'click'`。
- Enter / Space 时 trigger 为 `'keyboard'`，原始键盘事件会传入 context。
- 业务手动调用 `executeCommand()` 时默认 trigger 为 `'api'`，也可以显式传入。
- 执行前会重新求值，防止按钮状态过期后仍然执行。
- 执行期间命令进入 `executing` 集合，按钮显示 loading 并禁用。
- `CommandInterceptor.beforeExecute()` 可以取消执行。
- 执行异常会传给 `CommandInterceptor.onError()`，然后继续抛出。

```ts
const deleteButton = new RenderCommandButton({
  commandId: 'record.delete',
  commandManager,
})

void deleteButton.executeCommand('api', {
  reason: 'delete-from-detail-panel',
})
```

## 刷新命令状态

`canExecute`、`enabled`、`visible` 和权限通常依赖业务状态。业务状态变化后应调用 `commandManager.invalidate()`：

```ts
let selectedRecordId = ''

commandManager.register({
  id: 'record.delete',
  title: '删除',
  canExecute: () => selectedRecordId.length > 0,
  disabledReason: () => '请先选择一条记录',
  execute: () => {
    remove()
  },
})

function selectRecord(recordId: string): void {
  selectedRecordId = recordId
  commandManager.invalidate()
}
```

按钮订阅 manager 的状态变化。manager 失效后，按钮会清理内部缓存、刷新状态并请求重新 layout。

实现要求：

- `canExecute`、`enabled`、`visible`、`disabledReason` 必须保持轻量、同步。
- 不要在这些函数里请求接口、遍历超大数据或修改文档。
- 复杂状态先由业务维护成派生状态，再让命令求值读取派生状态。

## 作用域和生命周期

命令可以注册在应用级 manager，也可以注册在页面/组件局部 scope：

```ts
const globalManager = new CommandManager()
globalManager.register({
  id: 'app.refresh',
  title: '刷新',
  execute: () => reload(),
})

const localScope = new RenderCommandScope({
  commandManager: globalManager,
  debugLabel: 'item-list',
  commands: [{
    id: 'record.delete',
    title: '删除当前行',
    canExecute: () => canDelete(),
    execute: () => remove(),
  }],
  child: new RenderCommandButton({ commandId: 'record.delete' }),
})
```

查找命令时，按钮从自身向上找到最近的 `CommandScope`，再向父 scope 查找。局部命令可以覆盖同 id 的全局命令。

生命周期规则：

- `CommandManager.register()` 返回 disposer；应用级动态命令需要手动调用 disposer。
- `RenderCommandScope.register()` 返回 disposer，并自动触发 manager invalidate。
- `RenderCommandScope` 默认销毁自己创建的 `CommandScope`。
- `RenderCommandButton.dispose()` 会取消 manager 订阅，但不会销毁 manager 或命令。

## tooltip 和文案同步

未显式传 `label` 时：

- 初始文字为 `commandId`。
- 刷新后使用命令 `title`。

未显式传 `tooltip` 时：

- 命令不可用并有 `reason` 时显示 `reason`。
- 否则使用命令 `description`。
- 都没有时为空。

```ts
commandManager.register({
  id: 'record.submit',
  title: '提交',
  description: '提交给上级审核',
  canExecute: () => false,
  disabledReason: () => '当前文档未完成',
  execute: () => {},
})

const submitCommandButton = new RenderCommandButton({
  commandId: 'record.submit',
  commandManager,
})

submitCommandButton.refreshCommandState(true)
state.submitTooltip = submitCommandButton.tooltip
```

## 键盘和焦点

`RenderCommandButton` 继承普通按钮焦点行为：

| 操作 | 行为 |
| --- | --- |
| 鼠标点击 | 调用 `executeCommand('click')`。 |
| Enter | 命令当前可用时调用 `executeCommand('keyboard', event)`。 |
| Space | 命令当前可用时调用 `executeCommand('keyboard', event)`。 |
| 命令 disabled / loading | 不执行。 |

按钮本身不会注册全局快捷键。命令快捷键应由 `CommandShortcutController` 统一处理。

## 与 CommandToolbar 的区别

| 能力 | `RenderCommandButton` | `RenderCommandToolbar` |
| --- | --- | --- |
| 单个命令按钮 | 是 | 是 |
| 自动生成一组命令按钮 | 否 | 是 |
| 分组和分隔符 | 否 | 是 |
| icon 展示 | 否 | 工具栏项可使用 |
| 根据 `visible=false` 隐藏项 | 是，按钮折叠隐藏 | 工具栏可按项处理 |
| 适合场景 | 表单按钮、页脚按钮、单个主操作 | 页面顶部工具栏、操作区工具条 |

如果页面上只有一个“保存”或“提交”按钮，使用 `RenderCommandButton` 更直接。如果是完整操作栏，使用 [CommandToolbar](./command-toolbar.md)。

## 常见问题

### 为什么按钮一直 disabled？

检查顺序：

1. 是否提供了 `CommandManager`，或 app context 是否有 `commandManagerContextKey`。
2. `commandId` 是否和注册命令的 `id` 一致。
3. 按钮是否位于正确的 `RenderCommandScope` 下。
4. 权限服务是否返回 `true`。
5. `visible`、`enabled`、`canExecute` 是否返回 `true`。
6. 业务状态变化后是否调用了 `commandManager.invalidate()`。

### 为什么按钮没有隐藏？

确认业务状态变化后是否调用了 `commandManager.invalidate()`。按钮订阅 manager 后才会重新求值并同步 `visible`。如果你需要保留原位置但不绘制按钮，应使用 `RenderVisibility({ mode: 'hidden' })` 包装，而不是让命令 `visible` 返回 `false`。

### 为什么 command.title 改了按钮没有刷新？

命令定义或业务状态变化后，需要调用 `commandManager.invalidate()`。按钮订阅 manager 后才会丢弃缓存并刷新。

### 为什么图标没有显示？

`AppCommand.icon` 是命令元数据，`RenderCommandButton` 当前不绘制 icon。需要 icon 工具栏时使用 `RenderCommandToolbar`，普通 icon-only 按钮使用 [IconButton](../basic/icon-button.md)。

### 页面关闭时命令会自动释放吗？

放在 `RenderCommandScope` 构造参数 `commands` 中的命令，会随该 scope 销毁而释放。通过 `CommandManager.register()` 注册到根作用域的命令，需要保存 disposer 并手动释放，或在 manager 销毁时统一释放。

## 相关文档

- 命令与权限
- Commands API 参考
- [CommandToolbar](./command-toolbar.md)
- [Toolbar](./toolbar.md)
- [Button](../basic/button.md)
- [IconButton](../basic/icon-button.md)
