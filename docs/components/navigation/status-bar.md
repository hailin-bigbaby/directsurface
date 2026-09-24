# StatusBar 状态栏

> **通用布局能力**：`RenderStatusBar` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；状态项分组和内部间距仍由状态栏配置管理。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderStatusBar` 是应用或工作区底部状态栏。它按 left/right 分组展示短文本、徽标、分隔符和自定义 child，适合连接状态、当前用户、任务进度、坐标、选中数量、版本号等低干扰信息。


## API 总览

```ts
import {
  RenderProgressBar,
  RenderStatusBar,
  type BadgeAppearance,
  type BadgeStatus,
  type StatusBarAlign,
  type StatusBarGroup,
  type StatusBarItem,
  type StatusBarTextTone,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderStatusBar` | class | 底部状态栏，管理左右分组、可见项、文本压缩和自定义 child。 |
| `StatusBarGroup` | type | 状态栏分组，包含 `id`、`align`、`visible` 和 `items`。 |
| `StatusBarItem` | type | 状态栏项联合类型，支持 text、badge、separator、custom。 |
| `StatusBarAlign` | type | 分组对齐方向：`left` 或 `right`。 |
| `StatusBarTextTone` | type | 文本语气色。 |
| `BadgeStatus` / `BadgeAppearance` | type | badge 项的状态和视觉样式。 |

最小装配顺序是：准备 `StatusBarGroup[]`，创建 `RenderStatusBar({ groups })`。需要动态替换状态时优先调用 `setGroups()`，自定义 child 的 parent 和 dispose 由状态栏管理。

## 何时使用

使用 StatusBar：

- 应用底部需要长期展示低优先级状态。
- 左侧显示上下文、选择数量、坐标，右侧显示连接、版本、用户或任务状态。
- 需要把进度条、短 badge 或自定义只读组件嵌入状态栏。

不要使用：

- 重要错误或确认流程，使用 [Modal](../overlay/modal.md) 或 [Notification](../overlay/notification.md)。
- 页面主导航或操作区，使用 NavigationMenu、Toolbar 或 PageHeader。
- 大块文本、复杂表单或可滚动内容。

## 最小示例

```ts
import { RenderStatusBar } from 'ds-ui'

const statusBar = new RenderStatusBar({
  groups: [
    {
      id: 'left',
      align: 'left',
      items: [
        { id: 'selection', kind: 'text', text: '已选择 3 项', tone: 'secondary' },
      ],
    },
    {
      id: 'right',
      align: 'right',
      items: [
        { id: 'sync', kind: 'badge', value: '在线', status: 'success' },
      ],
    },
  ],
})
```

## 构造参数

`new RenderStatusBar(options?)` 的 `options`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `groups` | `StatusBarGroup[]` | `[]` | 初始分组。构造时会复制数组，并把 `custom` 项的 child 接入状态栏管理。 |

`options` 可以省略，此时创建空状态栏，后续通过 `addGroup()`、`setGroups()` 或 `clearGroups()` 管理内容。运行时替换 groups 时优先用 `setGroups(groups)`，不要直接修改 `groups` getter 返回的只读数组。

## 自定义进度项

```ts
import { RenderProgressBar, RenderStatusBar } from 'ds-ui'

const importProgress = new RenderProgressBar({
  value: 0.42,
  label: '导入中',
  height: 14,
})

const statusBar = new RenderStatusBar({
  groups: [{
    id: 'tasks',
    align: 'right',
    items: [
      { id: 'separator', kind: 'separator' },
      { id: 'import-progress', kind: 'custom', child: importProgress },
    ],
  }],
})
```

`custom` 项的 child 会成为 StatusBar 的内容子节点。移除 group 或替换 groups 时，旧 child 会解除 parent；StatusBar dispose 时会 dispose 当前 custom children。

## 分组和项目

`StatusBarGroup`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 分组稳定标识。 |
| `align` | `StatusBarAlign` | `left` 或 `right`。 |
| `visible` | `boolean` | 设为 `false` 时整组隐藏。 |
| `items` | `StatusBarItem[]` | 分组内项目。 |

`StatusBarItem` 的 `kind` 支持：

| kind | 字段 | 说明 |
| --- | --- | --- |
| `text` | `id`、`text`、`tone?`、`visible?` | 短文本状态。左侧空间不足时会优先压缩较长文本。 |
| `badge` | `id`、`value?`、`status?`、`appearance?`、`dot?`、`max?`、`visible?` | 徽标状态。 |
| `separator` | `id`、`visible?` | 垂直分隔线。 |
| `custom` | `id`、`child`、`visible?` | 自定义只读 child。 |

## 属性和方法

| API | 类型 / 返回值 | 说明 |
| --- | --- | --- |
| `groups` | `readonly StatusBarGroup[]` | 当前分组。 |
| `addGroup(group)` | `void` | 追加分组并请求布局。 |
| `removeGroup(id)` | `void` | 按 id 删除分组。 |
| `setGroups(groups)` | `void` | 替换全部分组，并同步 custom children。 |
| `clearGroups()` | `void` | 清空分组。 |
| `itemRect(id)` | `Rect \| null` | 返回已布局项的本地矩形。 |
| `debugState()` | object | 返回可见左右分组和可见 item id。 |
| `dispose()` | `void` | dispose 当前 custom children 并释放自身。 |

## 布局和尺寸

- 状态栏高度来自主题。
- 左右分组分别贴左、贴右，中间保留 section gap。
- 右侧分组优先保留完整宽度。
- 空间不足时，左侧较长 text item 会被压缩并裁剪绘制。
- badge、separator、custom item 不会自动压缩。
- 状态栏不提供滚动，也不换行。

## 交互边界

StatusBar 是只读展示组件，本身不处理点击、键盘或焦点导航，也不触发 `onChange` 类回调。需要可点击状态项时，应把可交互控件作为 `custom` child 放入状态栏，并由该 child 自己处理鼠标、键盘和焦点。

## 相关组件

- [ProgressBar 进度条](../basic/progress-bar.md)
- [Notification 通知](../overlay/notification.md)
- [Toolbar 工具栏](../command/toolbar.md)
