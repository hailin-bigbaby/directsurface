# ReviewSidebar 审阅侧栏

> **通用布局能力**：`RenderReviewSidebar` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；构造器是否接收这些字段以参数表为准。详见[组件通用布局属性](../common-layout-properties.md)。


`RenderReviewSidebar` 是右侧审阅、批注、修订记录和诊断提示列表。它根据每个 item 的 `anchorX`、`anchorY` 绘制连接线，把文档、编辑器或主内容区域中的位置连接到侧栏卡片。

它只负责审阅卡片的布局、滚动、激活、展开、编辑输入和操作按钮。审阅数据、权限、保存、定位主内容和变更合并应由业务页面或编辑器控制器维护。

## API 总览

```ts
import {
  RenderReviewSidebar,
  type ReviewSidebarAction,
  type ReviewSidebarItem,
  type ReviewSidebarItemType,
} from 'directsurface'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderReviewSidebar` | class | 审阅侧栏，按 anchor 位置排列卡片、绘制连接线并管理内部滚动。 |
| `ReviewSidebarItem` | type | 单条批注、修订或提示卡片的数据模型。 |
| `ReviewSidebarAction` | type | 卡片底部操作按钮配置。 |
| `ReviewSidebarItemType` | type | item 类型，当前为 `'comment' \| 'track'`。 |

最小装配顺序是：业务根据主内容位置生成 `ReviewSidebarItem[]`，创建 `RenderReviewSidebar({ width, items })`，在主内容布局变化后重新计算 `anchorX/anchorY` 并调用 `setItems(items)`。

## 何时使用

- 文档编辑器、文档编辑器、审批页面需要在右侧展示批注和修订。
- 诊断或审计页面需要把主内容中的位置和侧边卡片连接起来。
- 卡片数量中等，且每条记录有标题、正文、可选详情和操作按钮。

不要使用：

- 普通业务列表。使用 [ListView](../data/list-view.md)、[ItemsControl](../data/items-control.md) 或 [Table](../data/table.md)。
- 通用通知消息。使用 [Notification](../overlay/notification.md)。
- 树形审阅结构。使用 [TreeView](../data/tree-view.md) 后自行组合详情区。

## 最小示例

```ts
const reviewItems: ReviewSidebarItem[] = [
  {
    key: 'comment-1',
    type: 'comment',
    title: 'Reviewer A',
    meta: '10:24',
    content: '建议补充过敏史。',
    anchorX: -18,
    anchorY: 96,
    colorRole: 'primary',
    active: true,
    onActivate: () => {
      state.activeReviewKey = 'comment-1'
    },
  },
]

const reviewSidebar = new RenderReviewSidebar({
  width: 280,
  items: reviewItems,
})
```

## 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `width` | `number` | `250` | 侧栏期望宽度。布局时仍会被父约束限制。 |
| `items` | `ReviewSidebarItem[]` | `[]` | 初始审阅项。组件会按 `anchorY` 从小到大排序。 |

构造后可以继续调用 `setItems()` 更新数据。不要直接修改 `items` 数组后期待自动刷新。

## ReviewSidebarItem

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | `string` | 是 | 稳定唯一键。用于复用卡片实例、识别 active 项和 debug state。 |
| `type` | `'comment' \| 'track'` | 是 | 审阅类型。当前用于语义区分，视觉主要由其他字段决定。 |
| `title` | `string` | 是 | 卡片标题。 |
| `meta` | `string` | 否 | 标题右侧或下方的补充信息，例如时间、作者、状态。 |
| `content` | `string` | 是 | 卡片正文。`editable: true` 时作为 TextArea 初始值。 |
| `reason` | `string` | 否 | 正文下方的原因或说明。 |
| `badgeLabel` | `string` | 否 | 标题区域的短徽标。 |
| `badgeColor` | `string` | 否 | 徽标的显式颜色；设置后优先于语义角色。 |
| `badgeColorRole` | `'primary' \| 'danger' \| 'warning' \| 'success' \| 'muted'` | 否 | 由当前主题解析的徽标语义色，默认 `muted`。 |
| `anchorX` / `anchorY` | `number` | 是 | 主内容中的连接点全局或同坐标系位置。 |
| `connector` | `boolean` | 否 | 是否绘制连接线。默认绘制。 |
| `color` | `string` | 否 | 卡片边框、左侧色条和连接线的显式颜色；设置后优先于语义角色。 |
| `colorRole` | `'primary' \| 'danger' \| 'warning' \| 'success' \| 'muted'` | 否 | 由当前主题解析的卡片和连接线语义色；未设置 `color` 时生效，默认 `primary`。 |
| `editable` | `boolean` | 否 | 是否把正文渲染成可编辑 TextArea。 |
| `onCommitText` | `(value: string) => void` | 否 | 编辑提交回调。 |
| `actions` | `ReviewSidebarAction[]` | 否 | 卡片底部操作按钮。 |
| `active` | `boolean` | 否 | 是否当前激活。激活项会高亮并在变化后自动滚入可见区域。 |
| `onActivate` | `() => void` | 否 | 点击非交互区域时触发。 |
| `expanded` | `boolean` | 否 | 是否展示详情和审计记录。 |
| `onToggleExpanded` | `() => void` | 否 | 点击展开按钮时触发。业务应更新 `expanded` 后重新 `setItems()`。 |
| `detailLines` | `string[]` | 否 | 展开后显示的详情文本。 |
| `auditTrail` | `{ key: string; label: string; meta?: string; detail?: string }[]` | 否 | 展开后显示的审计记录。 |

`anchorX/anchorY` 应在主内容完成布局后计算。如果主内容滚动或缩放，业务需要重新计算 item 并调用 `setItems()`，否则连接线会指向旧位置。

优先使用 `colorRole` 和 `badgeColorRole`，以便浅色、深色和高对比度主题自动解析对应的强调色。只有业务色必须固定且已经自行验证对比度时，才传入 `color` 或 `badgeColor`。

## ReviewSidebarAction

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | `string` | 是 | 稳定 action 键。 |
| `label` | `string` | 是 | 按钮文本。 |
| `disabled` | `boolean` | 否 | 是否禁用按钮。 |
| `variant` | `'default' \| 'primary' \| 'danger' \| 'text' \| 'link'` | 否 | 按钮视觉类型。 |
| `onClick` | `() => void` | 否 | 点击按钮回调。 |

操作按钮由侧栏内部创建为 `RenderButton`。权限和可见性由业务决定：没有权限时传 `disabled: true` 或不要放入对应 action。

## 属性和方法

| API | 类型 / 返回值 | 说明 |
| --- | --- | --- |
| `items` | `ReviewSidebarItem[]` | 当前已排序 item 数组。只读使用，不要直接修改。 |
| `setItems(items)` | `void` | 替换审阅项、复用同 key 卡片、释放被移除卡片并触发布局。 |
| `setWidth(width)` | `void` | 设置期望宽度。内部最小限制为 `160`。 |
| `debugState()` | object | 返回滚动位置、内容高度、视口高度和每个卡片的 offset/height。 |

没有公开的 `scrollTo()` 方法。需要定位某条记录时，把对应 item 标记为 `active: true` 后调用 `setItems()`，组件会在下一次布局中尝试滚入可见区域。

## 交互行为

| 操作 | 行为 |
| --- | --- |
| 滚轮 | 命中且卡片列表溢出时，按固定步长滚动内部列表；到达边界后继续隔离同方向滚动。无溢出或只有横向增量时返回未处理，允许父容器接管。 |
| 点击卡片非交互区域 | 调用该 item 的 `onActivate()`。 |
| 点击展开按钮 | 调用 `onToggleExpanded()`；展开状态由业务回写。 |
| 编辑正文 | `editable: true` 时使用内置 `RenderTextArea`。 |
| 提交编辑 | TextArea commit 时调用 `onCommitText(value)`。 |
| 点击 action | 调用对应 `ReviewSidebarAction.onClick()`。 |

侧栏自身不声明键盘焦点模型。键盘输入来自内部 TextArea 和按钮；卡片激活通常由主内容选中、点击卡片或业务命令驱动。

## 布局和滚动

- item 会按 `anchorY` 排序，不按传入数组顺序绘制。
- 侧栏宽度优先使用 `width`，但不能突破父约束。
- 父高度无界时，默认使用内容高度；父高度有界时形成内部滚动视口。
- 每张卡片的自然 y 会尽量靠近 `anchorY - 8`，同时避免和上一张卡片重叠。
- 连接线从 `anchorX/anchorY` 连到卡片左边缘；`connector: false` 可以关闭单项连接线。
- active 项变化后会尝试滚入视口，已有 active 项更新内容时会尽量保持它在视口中的相对位置。

## 生命周期

`setItems()` 会释放不再存在的卡片子树。侧栏 `dispose()` 时会随父类释放所有内部卡片、TextArea、按钮和滚动容器。

业务应避免在 `ReviewSidebarItem` 回调中持有已经关闭页面的大对象。页面、tab、窗口释放时，如果 item 的回调引用了页面状态，应一起释放侧栏或清空 items。

## 性能边界

ReviewSidebar 不做虚拟化。它适合几十到低百级审阅项；更多数据应先在业务层分页、分组或按可视区域筛选。

每次 `setItems()` 会计算签名、排序并同步卡片结构。高频滚动主内容时不要每一帧全量创建新对象；应只在 anchor 或审阅状态变化时更新，或在编辑器控制器里做节流。

## 业务组合示例

```ts
function buildReviewItems(records: Array<{ id: string; y: number; text: string }>): ReviewSidebarItem[] {
  return records.map(record => ({
    key: record.id,
    type: 'comment',
    title: '审阅意见',
    content: record.text,
    anchorX: -16,
    anchorY: record.y,
    color: '#2563eb',
    actions: [
      {
        key: 'resolve',
        label: '已处理',
        variant: 'primary',
        onClick: () => {
          state.resolvedReviewId = record.id
        },
      },
    ],
  }))
}

const sidebar = new RenderReviewSidebar({ width: 280 })
sidebar.setItems(buildReviewItems(data))
```

## 相关文档

- [TextArea](../input/text-area.md)
- [Button](button.md)
- [ScrollViewer](../../layouts.md)
- ObjectInspector
- 文档编辑器接入
