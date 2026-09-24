# Pagination 分页

> **通用布局能力**：`RenderPagination` 实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；分页段内部 padding 和 gap 属于组件视觉规格。详见[组件通用布局属性](../common-layout-properties.md)。


`RenderPagination` 是轻量分页控件，用于在数据列表、表格或查询结果下方切换页码。它只负责页码展示、上一页/下一页、数字页、摘要、焦点和键盘交互，不负责查询数据、分页请求或总数计算。

## API 总览

```ts
import {
  RenderPagination,
} from 'ds-ui'
```

| API | 类型 | 用途 |
| --- | --- | --- |
| `RenderPagination` | class | 分页条。根据 `currentPage`、`totalPages` 和 `maxVisiblePages` 生成上一页、数字页、省略号、下一页和摘要。 |

最小装配顺序是：业务计算 `currentPage` 和 `totalPages`，创建 `RenderPagination({ currentPage, totalPages, onChange })`，在 `onChange(page)` 中更新业务状态并重新查询或切换数据。

## 何时使用

使用 Pagination：

- 查询结果、列表或表格需要按页显示。
- 分页状态由业务或服务端维护。
- 只需要上一页、下一页、页码和当前页摘要。
- 希望支持鼠标和键盘切页。

不要使用：

- 无限滚动或虚拟列表。使用对应数据组件的滚动能力。
- 页码来自复杂服务端游标。应在业务层把游标映射为页码或使用自定义控件。
- 需要页容量选择器、跳转输入框或总记录数展示。当前组件没有内建这些能力。

## 最小示例

```ts
import { RenderPagination } from 'ds-ui'

const pager = new RenderPagination({
  currentPage: 1,
  totalPages: 12,
  onChange: page => {
    state.currentPage = page
  },
})
```

`onChange` 只在用户交互或键盘触发页码变化时调用。直接设置 `currentPage` 不触发 `onChange`。

## 构造参数

```ts
const compactPager = new RenderPagination({
  currentPage: 5,
  totalPages: 20,
  maxVisiblePages: 3,
  showSummary: false,
  disabled: false,
  onChange: page => {
    state.currentPage = page
  },
})
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `currentPage` | `number` | 必填 | 当前页。会归一化到 `1..totalPages`。 |
| `totalPages` | `number` | 必填 | 总页数。小于 1 或无效值会归一化为 1。 |
| `maxVisiblePages` | `number` | `5` | 中间连续页码数量，下限为 3。 |
| `showSummary` | `boolean` | `true` | 是否在右侧显示 `第 current / total 页` 摘要。 |
| `disabled` | `boolean` | `false` | 是否禁用整个分页控件。禁用后不响应指针和键盘切页，并退出焦点顺序。 |
| `onChange` | `(page: number) => void` | `undefined` | 用户切换到新页时触发。 |

## 属性和方法

| API | 类型 / 返回值 | 说明 |
| --- | --- | --- |
| `currentPage` | `number` | 当前页。赋值会归一化并请求布局，不触发 `onChange`。 |
| `totalPages` | `number` | 总页数。赋值会归一化，并夹取当前页。 |
| `disabled` | `boolean` | 整体禁用状态。设为 `true` 会释放焦点并清理 hover 状态。 |
| `onChange` | `(page: number) => void` | 页码变化回调，可在构造后替换。 |
| `isFocused` | `boolean` | 当前分页控件是否持有焦点。 |
| `focusIn()` | `void` | 进入焦点状态。 |
| `focusOut()` | `void` | 退出焦点状态。 |
| `onKeyDown(event)` | `boolean` | 处理方向键、Home、End。通常由焦点系统调用。 |
| `dispose()` | `void` | 从 `FocusManager` 注销并清空 `onChange`。 |

## 交互行为

| 操作 | 行为 |
| --- | --- |
| 点击上一页 | 当前页大于 1 时切到 `currentPage - 1`。 |
| 点击下一页 | 当前页小于 `totalPages` 时切到 `currentPage + 1`。 |
| 点击数字页 | 切到该页。 |
| 点击省略号或摘要 | 不响应。 |
| `ArrowLeft` / `ArrowUp` | 上一页。 |
| `ArrowRight` / `ArrowDown` | 下一页。 |
| `Home` | 第一页。 |
| `End` | 最后一页。 |

页码变化会先更新组件内部 `currentPage`，再触发 `onChange(nextPage)`。

当 `disabled = true` 时，上一页、下一页和数字页都按禁用态绘制，不响应鼠标和键盘，也不会触发 `onChange`。

## 布局和尺寸

- 宽度根据可见 segments 的文本宽度、padding 和 gap 计算。
- 高度来自主题分页样式。
- 当 `totalPages` 较大时，组件保留首页、尾页和当前页附近的连续页码，中间用省略号表示。
- 摘要文本会增加整体宽度；空间紧张时可传 `showSummary: false`。
- 组件不会自动换行或压缩页码。

## 生命周期

- 构造时在可见且未禁用状态下注册到 `FocusManager`。
- 设置 `visible = false` 或 `disabled = true` 时会退出焦点顺序。
- `dispose()` 时注销焦点并释放 `onChange` 引用。
- Pagination 没有子 render object，数据请求和分页缓存都由业务管理。

## 相关组件

- [Table 表格](../data/table.md)
- [DataGrid 数据表格](../data/data-grid.md)
- [ListView 列表](../data/list-view.md)
