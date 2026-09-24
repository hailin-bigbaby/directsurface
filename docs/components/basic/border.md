# Border 视觉容器

> **通用布局能力**：`RenderBorder` 继承 `RenderPanel`，支持 width、height、min/max、margin、槽位对齐和 `padding`。详见[组件通用布局属性](../common-layout-properties.md)。


`RenderBorder` 是单子节点视觉容器，用于在内容外绘制主题背景、边框、圆角和可选 accent。主题语义和必要的显式颜色覆盖统一由这一个组件承载。

## API 总览

```ts
import {
  RenderBorder,
  type BorderAccentSide,
  type RenderBorderOptions,
} from 'ds-ui'
```

## 何时使用

使用 `RenderBorder`：

- 内容确实需要背景、边框、圆角或 accent。
- 为工具区域、状态摘要、滚动内容或浮层内容提供视觉边界。
- 需要一个带 padding 的单子节点视觉容器。

不要使用：

- 只需要内部留白时，直接设置现有父容器的 `padding`。
- 只需要兄弟节点间距时，使用父布局的 `spacing`、`rowGap` 或 `columnGap`。
- 页面内所有区域都套框；普通业务分组优先使用 `RenderSection`。
- 需要标题、说明和 actions 的信息块；这种场景使用 `RenderCard` 或 `RenderSection`。

## 最小示例

```ts
const panel = new RenderBorder({
  background: 'panel',
  padding: 12,
  child: new RenderText('条目摘要'),
})
```

带 accent：

```ts
const details = new RenderText('当前条目已选中')
const selected = new RenderBorder({
  background: 'selected',
  accentSide: 'left',
  accentWidth: 3,
  padding: 12,
  child: details,
})
```

## RenderBorderOptions

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `child` | `RenderBox` | `undefined` | 唯一内容子节点。动态替换时使用 `setChild()`。 |
| `background` | `BorderBackground \| Color` | `'panel'` | 主题背景语义或显式颜色。业务页面优先使用主题语义。 |
| `borderColor` | `Color` | 主题值 | 显式覆盖边框颜色。 |
| `borderWidth` | `number` | 主题值 | 显式覆盖边框宽度；负数归一化为 `0`。 |
| `cornerRadius` | `number` | 主题值 | 显式覆盖圆角；负数归一化为 `0`。 |
| `accentSide` | `BorderAccentSide` | `undefined` | 可选 accent 所在边。 |
| `accentWidth` | `number` | `3` | accent 宽度；负数归一化为 `0`。 |
| `padding` | `EdgeInsetsInput` | `0` | 边界与内容槽位之间的内部留白。 |

`BorderBackground` 的主题语义为：

```ts
type BorderBackground = 'panel' | 'muted' | 'selected' | 'primary'
```

显式 `Color` 适合品牌色、数据可视化或无法由现有主题语义表达的业务颜色。普通面板、选中态和主色区域应优先使用语义值，避免页面散落硬编码颜色。

## 属性和方法

| 成员 | 说明 |
| --- | --- |
| `background` | 当前主题背景语义或显式颜色；修改后自动请求重绘。 |
| `borderColor` | 当前边框颜色覆盖；修改后自动请求重绘。 |
| `borderWidth` | 当前边框宽度覆盖；修改后自动请求重绘。 |
| `cornerRadius` | 当前圆角覆盖；修改后自动请求重绘。 |
| `accentSide` | 当前 accent 边；修改后自动请求重绘。 |
| `accentWidth` | 当前 accent 宽度；修改后自动请求重绘。 |
| `child` | 当前内容子节点。不要直接替换。 |
| `setChild(child?)` | 替换内容，并处理旧节点 detach、新节点 attach 和重新布局。 |

## 样式解析顺序

1. 根据当前主题和语义背景调用 `deriveBorderStyle()`。
2. `background` 为显式 `Color` 时覆盖主题背景色。
3. `borderColor`、`borderWidth` 和 `cornerRadius` 覆盖对应主题值。
4. accent 默认继续使用当前主题语义的 accent color。

因此主题切换会自动影响未显式覆盖的部分；显式颜色保持业务指定值。

## 布局规则

- `padding` 先从父约束中扣除，再布局 child。
- child 的 `margin` 计入内容所需尺寸。
- child 的水平和垂直 alignment 在内容槽位中生效。
- Border 的最终尺寸由 child `outerSize`、padding 和父约束共同决定。
- 没有 child 时，尺寸由 padding、显式尺寸和父级最小约束决定，不会自动填满父级最大尺寸。
- 背景、accent 和边框绘制在 child 之前；Adorner 绘制在内容之后。

## 生命周期

构造时可以传入 `child`。运行时替换必须使用：

```ts
const panel = new RenderBorder({ child: new RenderText('旧内容') })
const nextContent = new RenderText('新内容')
panel.setChild(nextContent)
```

`setChild()` 会解除旧 child 的 parent，必要时 detach；再为新 child 设置 parent，并在 Border 已挂载时 attach 到同一 owner，最后触发重新布局。

## 性能和设计约束

- Border 只增加一次背景和可选边框/accent 绘制，适合普通页面区域。
- 大型虚拟列表不要为每行无条件叠加多层 Border。
- 圆角 accent 会建立裁剪路径；只在确实需要视觉强调时启用。
- 颜色、边框和圆角默认来自主题 token。显式颜色应有清晰业务语义，不作为随意美化入口。

## 相关文档

- [组件通用布局属性](../common-layout-properties.md)
- [布局系统总览](../../layouts.md)
- [Card / Section / PageHeader](./card-section-page-header.md)
- [颜色使用模式](../../themes.md)
