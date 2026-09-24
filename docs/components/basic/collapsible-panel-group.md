# CollapsiblePanelGroup 折叠分区

> **通用布局能力**：`RenderCollapsiblePanelGroup` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；其 options 继承 `RenderBoxOptions`，可在构造时传入。详见[组件通用布局属性](../common-layout-properties.md)。


`RenderCollapsiblePanelGroup` 是 VS Code 风格的纵向折叠分区容器。它把多个区域按“标题栏 + 内容区”组织，支持展开、折叠和相邻内容区高度拖拽调整，适合开发者中心、属性面板、调试窗口和侧边栏工具区。

它是通用组件，不属于 demo 专用页面。业务页面可以直接组合已有内容组件作为每个 section 的 `child`。

## API 总览

```ts
import {
  RenderCollapsiblePanelGroup,
  RenderText,
  type CollapsiblePanelExpandedChange,
  type CollapsiblePanelGroupDebugSection,
  type CollapsiblePanelGroupResizeHandleDebugState,
  type CollapsiblePanelSection,
  type RenderCollapsiblePanelGroupOptions,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderCollapsiblePanelGroup` | class | 纵向折叠分区容器，支持展开、折叠和相邻内容区拖拽调整高度。 |
| `RenderCollapsiblePanelGroupOptions` | type | 构造参数。 |
| `CollapsiblePanelSection` | type | 分区定义，包含 key、title、child、expanded、flex。 |
| `CollapsiblePanelExpandedChange` | type | 展开状态变化回调 payload。 |
| `CollapsiblePanelGroupDebugSection` / `CollapsiblePanelGroupResizeHandleDebugState` | type | 调试状态类型。 |

最小装配顺序是：准备稳定 key 的 `CollapsiblePanelSection[]`，为每个 section 提供独立 child，再创建 `RenderCollapsiblePanelGroup`。不要把同一个 child 实例放入多个 section。

## 何时使用

- 左侧或右侧侧栏需要多个可折叠工具区。
- 开发调试窗口需要同时放对象树、上下文、日志、属性等区域。
- 工作台侧边栏需要用户手动调整上下两个区域的高度。
- 内容数量有限，所有 section 都可以常驻实例，只控制显示和高度。

## 何时不要使用

- 需要横向折叠或复杂 dock 拆分。优先使用 [DockWorkspace](../navigation/dock-workspace.md) 或专门拆分容器。
- 需要展示几千个动态分组。应使用 [TreeView](../data/tree-view.md)、[ListView](../data/list-view.md) 或虚拟化数据组件。
- 需要弹出层中的轻量分组。简单场景可用 [Section / Card](./card-section-page-header.md)。

## 最小示例

```ts
const group = new RenderCollapsiblePanelGroup({
  sections: [
    {
      key: 'outline',
      title: '目录',
      child: new RenderText('目录内容'),
      expanded: true,
      flex: 1,
    },
    {
      key: 'context',
      title: '上下文',
      child: new RenderText('上下文内容'),
      expanded: true,
      flex: 1,
    },
  ],
})
```

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `sections` | `readonly CollapsiblePanelSection[]` | 必填 | 分区定义。每个 section 持有一个 `RenderBox` 子组件。 |
| `headerHeight` | `number` | `28` | 每个标题栏高度。内部会限制不小于 `20`。 |
| `spacing` | `number` | `0` | section 之间的垂直间距。 |
| `resizeHandleSize` | `number` | `6` | 可拖拽高度调整区域大小。内部会限制不小于 `4`。 |
| `minContentHeight` | `number` | `48` | 拖拽调整时每个内容区允许的最小高度。 |
| `onExpandedChange` | `(event: CollapsiblePanelExpandedChange) => void` | `undefined` | 用户或代码切换展开状态后触发。 |

## CollapsiblePanelSection

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `key` | `string` | 必填 | 稳定唯一键。展开状态、调试信息和事件都通过它识别 section。 |
| `title` | `string` | 必填 | 标题栏文本。过长会省略绘制。 |
| `child` | `RenderBox` | 必填 | 内容区子组件。折叠时不会作为内容子节点参与命中。 |
| `expanded` | `boolean` | `true` | 初始是否展开。 |
| `flex` | `number` | `1` | 有界高度下参与剩余内容高度分配的权重。`0` 表示按自然高度布局。 |

## 属性和方法

| API | 类型 / 返回值 | 说明 |
| --- | --- | --- |
| `sections` | `readonly CollapsiblePanelGroupDebugSection[]` | 当前布局后的调试快照，不应直接修改。 |
| `headerHeight` | `number` | 读写标题栏高度，修改后触发布局。 |
| `spacing` | `number` | 读写 section 间距，修改后触发布局。 |
| `setSections(sections)` | `void` | 替换全部 section，并释放旧子组件的父子关系和 attach 状态。 |
| `isSectionExpanded(key)` | `boolean` | 查询某个 section 是否展开。不存在时返回 `false`。 |
| `setSectionExpanded(key, expanded)` | `void` | 设置展开状态。状态未变化时不会触发布局。 |
| `toggleSection(key)` | `void` | 切换展开状态。 |
| `debugState()` | object | 返回 section 布局、resize handle、hover 和拖拽状态。 |

## 交互行为

| 操作 | 行为 |
| --- | --- |
| 点击标题栏 | 切换当前 section 展开/折叠。 |
| hover 标题栏 | 标题栏绘制 hover 背景。 |
| 按下标题栏 | 标题栏绘制 pressed 背景。 |
| 拖拽相邻内容区之间的 handle | 调整两块内容区的 `flex` 比例。 |
| 指针离开 | 清理 hover / pressed 状态，拖拽中不会中断。 |
| 指针取消 | 释放拖拽状态和 pointer capture。 |

只有相邻两个 section 都展开、且两者 `flex > 0` 时，才会生成可拖拽 resize handle。自然高度 section 不参与拖拽分配。

## 布局规则

- 父容器高度有限时，所有标题栏先占用固定高度，剩余高度分给展开内容区。
- `flex > 0` 的展开内容区按权重分配剩余高度。
- `flex <= 0` 或父容器高度无界时，内容区按子组件自然高度布局。
- 折叠 section 只保留标题栏，不布局内容高度。
- 标题栏始终横向占满组件宽度。
- 标题文本会 clip 并绘制省略号，不会换行。

## 生命周期

`setSections()` 会把旧 section 的 `child.parent` 清空，并在已 attach 时 detach。组件 `dispose()` 会释放 pointer capture、清理拖拽状态并调用父类释放子树。

业务代码不要复用同一个 `child` 实例到多个 section 或多个父容器中。需要移动内容时，应先从旧父级移除，或创建新的 render 对象。

## 性能边界

`RenderCollapsiblePanelGroup` 不做虚拟化。它适合几十个以内的固定工具区，不适合用作大数据分组列表。内容区如果是大树、大表格、大文本，应由子组件自己管理虚拟化和滚动。

拖拽 resize 时只更新相邻 section 的 `flex` 并触发布局；如果内容区本身布局很重，拖拽过程中仍可能卡顿。此时应优化子组件布局或限制内容区重排成本。

## 常见问题

### 为什么拖不动分隔线？

只有两个相邻 section 都展开且 `flex > 0` 才有 resize handle。检查对应 section 的 `expanded` 和 `flex`。

### 为什么折叠后内容状态还在？

折叠只是不把内容区作为可见内容参与布局和命中，子组件实例仍然保留。这样重新展开时可以保留滚动、选中和局部状态。

### 为什么标题很长时只显示省略号？

标题栏是固定高度工具区，组件不会自动换行。完整信息应放在 tooltip、详情区或内容区内。

## 相关文档

- [Card / Section / PageHeader](./card-section-page-header.md)
- [TreeView](../data/tree-view.md)
- [ListView](../data/list-view.md)
- ObjectInspector 指南
- [Runtime Diagnostics 指南](../../lifecycle.md)
