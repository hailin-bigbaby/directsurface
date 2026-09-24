# Card / Section / PageHeader

> **通用布局能力**：本页中的可布局 `Render*` 组件实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；`RenderCard`、`RenderSection` 可在 options 中传入，其他构造器以参数表为准。详见[组件通用布局属性](../common-layout-properties.md)。



`RenderCard`、`RenderSection` 和 `RenderPageHeader` 用于组织页面结构：

- `RenderPageHeader`：页面顶部标题、说明、面包屑和页面级操作区。
- `RenderSection`：页面内部的无边框逻辑分组。
- `RenderCard`：带背景、边框和可选阴影的信息块。

这三类组件都负责结构和视觉层级，不负责业务数据获取、权限判断和命令状态。页面应先把业务状态计算好，再把标题、描述、操作按钮和内容 child 投影给这些组件。

## API 总览

```ts
import {
  RenderBreadcrumb,
  RenderButton,
  RenderCard,
  RenderEmpty,
  RenderGroupBox,
  RenderPage,
  RenderPageHeader,
  RenderSection,
  RenderText,
  type CardVariant,
  type RenderCardStyleOverrides,
  type RenderPageOptions,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderPageHeader` | class | 页面顶部标题、说明、面包屑和页面级 actions。 |
| `RenderSection` | class | 页面内部无边框逻辑分组，适合表单区、查询区和详情区。 |
| `RenderCard` | class | 带背景、边框和可选视觉变体的信息块。 |
| `RenderPage` | class | 页面内容宿主，可接入 loaded、activated、deactivated、beforeClose 和 tab document context。 |
| `RenderEmpty` | class | 空状态占位，适合列表、查询结果和面板无内容状态。 |
| `RenderGroupBox` | class | 有标题的边框分组框，适合需要明确框线的紧凑配置区。 |
| `RenderCardStyleOverrides` | type | `RenderCard` 局部样式覆盖。 |
| `RenderPageOptions` | type | `RenderPage` 构造和生命周期选项。 |
| `CardVariant` | type | 卡片视觉变体：`default` 或 `translucent`。 |

最小装配顺序是：页面顶部用 `RenderPageHeader`，页面主体用 `RenderSection` 分组，独立信息块才用 `RenderCard`。动态替换 child/actions 时使用组件的 setter 方法，让 parent、attach/detach 和 layout 状态保持一致。

## 何时使用

使用 `RenderPageHeader`：

- 页面、tab 页、工具窗口顶部。
- 需要展示标题、页面说明、面包屑。
- 需要放置页面级命令，例如新增、刷新、保存。

使用 `RenderSection`：

- 表单分组、详情分组、查询条件区。
- 页面内多个逻辑区域之间需要标题和说明。
- 希望页面安静、少框体、避免卡片过多。

使用 `RenderCard`：

- 仪表盘指标卡。
- 独立信息块。
- 登录、欢迎页、对象详情、调试信息。
- 需要背景、边框、translucent 视觉或局部 style 覆盖。

不要使用：

- 不要用 `Card` 包住所有内容，业务系统页面优先使用 `Section`。
- 不要让 `Card` 嵌套 `Card`。
- 不要把局部行操作塞进 `PageHeader.actions`。
- 不要用 `PageHeader` 作为普通列表项标题。

## PageHeader 最小示例

```ts
const header = new RenderPageHeader({
  title: '条目查询',
  description: '按姓名、场景 A号或部门查询条目',
  actions: new RenderButton({ label: '刷新', onClick: () => {} }),
})
```

带面包屑：

```ts
const breadcrumb = new RenderBreadcrumb({
  items: [
    { key: 'home', label: '首页' },
    { key: 'items', label: '条目' },
  ],
})

const header = new RenderPageHeader({
  title: '条目详情',
  description: '查看条目本次预约信息',
  breadcrumb,
  actions: new RenderButton({ label: '保存', onClick: () => {} }),
})
```

## RenderPageHeader 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `title` | `string` | 必填 | 页面标题。 |
| `description` | `string` | `''` | 页面说明。为空时不占用说明行。 |
| `descriptionMaxLines` | `number` | `2` | 说明文本最多显示行数；超出时在最后一行显示省略号。 |
| `breadcrumb` | `RenderBreadcrumb` | `undefined` | 面包屑组件。 |
| `actions` | `RenderBox` | `undefined` | 页面级操作区，可传按钮、工具栏或自定义容器。 |

## RenderPage 构造参数

`RenderPage` 是页面内容宿主，常作为 tab、workspace 或业务页面根节点。`new RenderPage(options?: RenderPageOptions)` 的 `options`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `child` | `RenderBox` | `undefined` | 页面内容根节点。构造时会设置 parent。 |
| `disposeChild` | `boolean` | `true` | `setChild()` 替换旧 child 或 page dispose 时是否一并 dispose 旧 child。设为 `false` 时只解除 parent/detach。 |
| `onLoaded` | `(context: RenderLoadedContext) => void` | `undefined` | 页面 attach 到运行时并完成 loaded 生命周期时调用。 |
| `onActivated` | `() => void` | `undefined` | 页面所在 tab/document 被激活时调用。 |
| `onDeactivated` | `() => void` | `undefined` | 页面所在 tab/document 失活时调用。 |
| `beforeClose` | `() => boolean \| Promise<boolean>` | `undefined` | 关闭前守卫。返回或解析为 `false` 时阻止关闭；未提供时允许关闭。 |

`RenderPage` 还实现 tab document context 相关方法，例如 `activateSelf()`、`requestClose()`、`setTitle()`、`setDirty()`、`setTooltip()` 和 `setIcon()`。这些方法只有在页面被 `TabbedWorkspace` 或相关 document manager 挂接后才会返回有效结果。

业务页面可以用这些方法把页面内部状态同步到工作区 tab：

```ts
class OrderEditorPage extends RenderPage {
  markChanged(): void {
    this.setDirty(true)
    this.setTooltip([
      '菜单路径：场景 A用户 / 订单管理 / 订单录入',
      '状态：有未保存订单',
    ].join('\n'))
  }

  save(): void {
    this.setDirty(false)
    this.setTooltip('订单录入 / 已保存')
  }
}
```

如果页面尚未被工作区文档挂接，`setDirty()`、`setTooltip()`、`requestClose()` 这类方法会返回 `false`。关闭保护既可以在 `RenderPage` 的 `beforeClose` options 中声明，也可以由自定义页面实现 `beforeDocumentClose()`。

## RenderEmpty 构造参数

`RenderEmpty` 是公共空状态组件。`new RenderEmpty(options?)` 的 `options`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `title` | `string` | `'暂无内容'` | 空状态主标题。 |
| `description` | `string` | `''` | 补充说明。为空时不占用说明行。 |
| `icon` | `IconName` | `'search'` | 空状态图标。 |
| `action` | `RenderBox` | `undefined` | 可选操作区，例如“新建”按钮。 |

`setAction(action?)` 可在运行时替换操作区，并处理 parent、attach/detach 和 layout 刷新。

## RenderGroupBox 构造参数

`RenderGroupBox` 是公共分组框组件。`new RenderGroupBox(options)` 的 `options`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `title` | `string` | 必填 | 分组框标题。 |
| `headerInfo` | `string` | `''` | 标题右侧或标题后的辅助信息。 |
| `child` | `RenderBox` | `undefined` | 分组内容。 |
| `headerLeading` | `RenderBox` | `undefined` | 标题前的自定义区域，例如图标或状态点。 |
| `headerActions` | `RenderBox` | `undefined` | 标题栏右侧操作区。 |

运行时替换内容时使用 `setChild()`、`setHeaderLeading()` 和 `setHeaderActions()`，不要直接改字段。

## RenderPageHeader 属性和方法

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `title` | `string` | 当前标题。 |
| `description` | `string` | 当前说明。 |
| `descriptionMaxLines` | `number` | 当前说明最大行数；赋值会触发布局。 |
| `breadcrumb` | `RenderBreadcrumb \| undefined` | 当前面包屑。 |
| `actions` | `RenderBox \| undefined` | 当前操作区。 |
| `setBreadcrumb(breadcrumb?)` | `(RenderBreadcrumb \| undefined) => void` | 替换面包屑，并处理 parent、attach/detach 和 layout 刷新。 |
| `setActions(actions?)` | `(RenderBox \| undefined) => void` | 替换操作区，并处理 parent、attach/detach 和 layout 刷新。 |

`title` 和 `description` 是公开字段，直接修改不会自动触发布局。动态替换标题时，建议重建 `RenderPageHeader`，或由父组件显式触发布局。

`setBreadcrumb()` 和 `setActions()` 是推荐的动态替换方式，因为它们会处理子节点生命周期。

## PageHeader 布局规则

- 外层有背景、边框、圆角和 padding。
- `constraints.maxWidth === Infinity` 时，默认按 `520` 作为布局宽度。
- 可用宽度会先减去左右 padding。
- `actions` 会先按内部最大宽度布局。
- 标题、说明、面包屑共享左侧文本区域。
- 当剩余文本区域过窄时，`actions` 会堆叠到标题说明下方。
- 未堆叠时，`actions` 位于右侧，并在 header 高度内垂直居中。
- 标题保持单行并被 clip 到可用文本宽度；说明文本默认最多换行两行，超出时在最后一行显示省略号。

适合放在页面顶层：

```ts
const pageHeader = new RenderPageHeader({
  title: '控件演示',
  description: '统一展示中层组件和字段能力',
  actions: new RenderButton({ label: '新建', onClick: () => {} }),
})
```

## Section 最小示例

```ts
const section = new RenderSection({
  title: '基本信息',
  description: '维护条目基础资料',
  child: new RenderText('表单区域'),
})
```

带操作区：

```ts
const section = new RenderSection({
  title: '查询条件',
  actions: new RenderButton({ label: '重置', onClick: () => {} }),
  child: new RenderText('这里放查询表单'),
})
```

## RenderSection 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `title` | `string` | 必填 | 分组标题。 |
| `description` | `string` | `''` | 分组说明。为空时不占用说明行。 |
| `child` | `RenderBox` | `undefined` | 分组内容。 |
| `actions` | `RenderBox` | `undefined` | 分组级操作区。 |

## RenderSection 属性和方法

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `title` | `string` | 当前标题。 |
| `description` | `string` | 当前说明。 |
| `child` | `RenderBox \| undefined` | 当前内容。 |
| `actions` | `RenderBox \| undefined` | 当前操作区。 |
| `setChild(child?)` | `(RenderBox \| undefined) => void` | 替换内容 child，并处理 parent、attach/detach 和 layout 刷新。 |
| `setActions(actions?)` | `(RenderBox \| undefined) => void` | 替换操作区，并处理 parent、attach/detach 和 layout 刷新。 |

`setChild()` 和 `setActions()` 是动态替换子组件的推荐方式。

## Section 布局规则

- `Section` 不绘制背景和边框，只绘制标题、说明和子内容。
- `constraints.maxWidth === Infinity` 时，默认按 `400` 作为标题操作区测量宽度。
- 有 `description` 时，标题和说明之间使用 `headerGap`。
- 内容位于 header 下方，间距为 `contentGap`。
- `actions` 默认放在 header 右侧。
- 当 `actions` 太宽导致文本区域不足时，`actions` 会堆叠到标题说明下方。
- 内容子节点的槽位从标题区和 `contentGap` 之后开始；布局使用子节点的 `outerSize`，并通过 `positionInSlot()` 应用其 `margin` 与水平对齐。当前内容槽位高度紧贴 `outerSize`，因此垂直 alignment 通常没有额外空间可供分配。
- 文本绘制会 clip 到可用文本宽度，不自动省略。
- 有限宽度约束下，`Section` 宽度通常填满 `constraints.maxWidth`。

`Section` 适合组成页面主干：

```ts
const querySection = new RenderSection({
  title: '查询条件',
  description: '输入条件后点击查询',
  actions: new RenderButton({ label: '查询', onClick: () => {} }),
  child: new RenderText('这里组合表单组件'),
})
```

## Card 最小示例

```ts
const card = new RenderCard({
  title: '今日工作量',
  description: '场景 B与场景 A合计',
  child: new RenderText('128'),
  variant: 'default',
})
```

带 actions 和 style 覆盖：

```ts
const card = new RenderCard({
  title: '登录到主工作台',
  description: '请选择系统入口',
  actions: new RenderButton({ label: '进入', onClick: () => {} }),
  child: new RenderText('当前租户：演示机构'),
  variant: 'translucent',
  style: { padding: 26, borderRadius: 10 },
})
```

## RenderCard 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `title` | `string` | 必填 | 卡片标题。 |
| `description` | `string` | `''` | 卡片说明。为空时不占用说明行。 |
| `child` | `RenderBox` | `undefined` | 卡片内容。 |
| `actions` | `RenderBox` | `undefined` | 卡片操作区。 |
| `variant` | `CardVariant` | `'default'` | 卡片视觉变体。 |
| `style` | `RenderCardStyleOverrides` | `{}` | 局部样式覆盖。 |

## CardVariant

```ts
type CardVariant = 'default' | 'translucent'
```

| 值 | 说明 |
| --- | --- |
| `'default'` | 默认面板背景和边框，无阴影。适合普通信息块。 |
| `'translucent'` | 半透明背景、强调边框、阴影和 highlight。适合登录页、欢迎页、浮层感较强的视觉区域。 |

## RenderCardStyleOverrides

`RenderCardStyleOverrides` 是 `CardStyleTokens` 的局部覆盖子集。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `backgroundColor` | `Color` | 背景色。 |
| `borderColor` | `Color` | 边框色。 |
| `borderWidth` | `number` | 边框宽度。 |
| `borderRadius` | `number` | 圆角。 |
| `padding` | `number` | 内边距。 |
| `shadowColor` | `Color` | 阴影颜色。 |
| `shadowBlur` | `number` | 阴影模糊。 |
| `shadowOffsetX` | `number` | 阴影 x 偏移。 |
| `shadowOffsetY` | `number` | 阴影 y 偏移。 |
| `highlightColor` | `Color` | 高亮描边颜色。 |
| `highlightWidth` | `number` | 高亮描边宽度。 |

## RenderCard 属性和方法

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `title` | `string` | 当前标题。 |
| `description` | `string` | 当前说明。 |
| `child` | `RenderBox \| undefined` | 当前内容。 |
| `actions` | `RenderBox \| undefined` | 当前操作区。 |
| `variant` | `CardVariant` | 当前变体。 |
| `styleOverrides` | `RenderCardStyleOverrides` | 当前局部样式覆盖。 |
| `setChild(child?)` | `(RenderBox \| undefined) => void` | 替换内容 child，并处理 parent、attach/detach 和 layout 刷新。 |
| `setActions(actions?)` | `(RenderBox \| undefined) => void` | 替换操作区，并处理 parent、attach/detach 和 layout 刷新。 |

动态替换 `child/actions` 时使用方法；动态变更标题、说明、变体或样式时，建议重建卡片或由父级触发布局。

## Card 布局和绘制规则

- `Card` 先解析 `deriveCardStyle(theme, variant)`，再合并 `styleOverrides`。
- `constraints.maxWidth === Infinity` 时，内部可用宽度按 `400 - padding * 2` 计算。
- 标题、说明、actions 构成 header。
- `actions` 默认右对齐，空间不足时堆叠到标题说明下方。
- `child` 位于 header 下方，间距为 `contentGap`。
- 内容子节点的槽位从视觉 `padding`、标题区和 `contentGap` 之后开始；布局使用子节点的 `outerSize`，并通过 `positionInSlot()` 应用其 `margin` 与水平对齐。
- `Card` 会绘制阴影、背景、highlight、边框，再绘制标题说明和子内容。
- 标题说明绘制时会 clip 到 header 文本区域。

## 主题来源

`RenderPageHeader` 使用 `derivePageHeaderStyle(theme)`：

- 背景来自 `surfacePanel` 和 `surfaceContent` 的层级关系。
- 边框来自 `borderSubtle`。
- title 字号为 `theme.fontSize + 2`。
- description 字号为 `theme.fontSize`。
- padding 为 `theme.framePadding + 3`。

`RenderSection` 使用 `deriveSectionStyle(theme)`：

- title 颜色为 `theme.textPrimary`。
- description 颜色为 `theme.textSecondary`。
- title 字号为 `theme.fontSize`。
- description 字号为 `max(11, theme.fontSize - 1)`。
- `headerGap` 和 `contentGap` 从主题 padding/spacing 推导。

`RenderCard` 使用 `deriveCardStyle(theme, variant)`：

- 默认变体继承 section 文本规则。
- 默认背景为 `theme.surfacePanel`。
- 默认边框为 `theme.borderPanel`。
- translucent 变体会增加半透明背景、强调边框、阴影和 highlight。
- `styleOverrides` 最后合并，优先级最高。

## 选择规则

| 场景 | 推荐组件 |
| --- | --- |
| 页面顶部标题、说明、面包屑、页面级操作 | `RenderPageHeader` |
| 页面内部业务分组 | `RenderSection` |
| 表单分组 | `RenderSection` |
| 查询条件区域 | `RenderSection` |
| 仪表盘指标块 | `RenderCard` |
| 登录页、欢迎页重点视觉区域 | `RenderCard` 的 `translucent` 变体 |
| 调试对象详情块 | `RenderCard` |
| 工具栏内部轻量分割 | [Divider](./badge-chip-divider.md) |

## 常见组合

页面骨架：

```ts
const header = new RenderPageHeader({
  title: '条目工作台',
  actions: new RenderButton({ label: '刷新', onClick: () => {} }),
})

const section = new RenderSection({
  title: '待处理条目',
  child: new RenderText('这里放列表或表格'),
})
```

卡片详情：

```ts
const card = new RenderCard({
  title: '条目摘要',
  description: '本次预约',
  child: new RenderText('高级用户，研发部'),
})
```

## 性能边界

- 三个组件布局时都会测量标题和说明文本宽度。
- `PageHeader`、`Section`、`Card` 都会对子组件执行 layout。
- 高频变化的局部数据不要直接放在标题里反复触发布局，优先放到子内容区域。
- 长标题不会自动省略，只会被 clip；业务侧应保持标题短而明确。
- `Card` 的 translucent 阴影比普通 section/card 更重，不建议在大列表每行使用。
- 大量重复结构应放在虚拟化列表、表格或 ItemsControl 中，不要一次性创建大量卡片。

## 生命周期和 Adorner

这三个组件都支持 adorners，可作为校验、浮层锚点或调试覆盖层的宿主。

动态替换子组件时：

- 使用 `setChild()`、`setActions()`、`setBreadcrumb()`。
- 旧子节点会清理 `parent`，如果已 attach 会 detach。
- 新子节点会设置 `parent`，如果父节点已经 attach，会 attach 到同一个 owner。
- 方法会调用 `markNeedsLayout()`。

## 常见问题

### 为什么标题太长没有显示省略号？

当前实现使用 clip 裁剪标题区域，没有内建 ellipsis。页面标题和分组标题应保持短文本；需要可省略的普通文本时使用 [Text](./text.md) 的 `overflow: 'ellipsis'`。

### 为什么 actions 有时会跑到标题下面？

这是自动堆叠规则。组件会估算标题/说明需要的最小文本区域，当右侧 actions 挤占过多空间时，actions 会放到下一行，避免覆盖文本和内容。

### Section 和 Card 怎么选？

业务系统的页面主干优先用 `Section`。只有需要独立框体、指标块、欢迎页重点区域或调试详情块时再用 `Card`。

### 为什么直接改 child 没有完整生命周期处理？

直接写 `child` 字段不会自动 detach 旧节点，也不会 attach 新节点。动态替换必须使用 `setChild()`。`actions` 和 `breadcrumb` 同理。

### PageHeader 可以放多个按钮吗？

可以，把多个按钮组合到 [Toolbar](../command/toolbar.md)、`RenderStackPanel` 或其他容器里，再作为 `actions` 传入。

## 相关文档

- [Text 文本](./text.md)
- [Button 按钮](./button.md)
- [Badge / Chip / Divider](./badge-chip-divider.md)
- [Toolbar 工具栏](../command/toolbar.md)
- [Breadcrumb 面包屑](../navigation/breadcrumb.md)
- [布局与约束](../../lifecycle.md)
- [主题与状态](../../themes.md)
