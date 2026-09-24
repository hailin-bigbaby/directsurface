# 组件通用布局属性

本文示例统一从 `.tgz` 安装后的包入口导入：

```ts
import {
  RenderButton,
  RenderDataGrid,
  RenderStackPanel,
  type GridColumnDef,
} from 'directsurface'
```

所有继承 `RenderBox` 的可布局组件都直接拥有尺寸、外边距和槽位对齐能力。业务代码不再需要为了 size、constraints、margin、alignment 或 center 额外包裹单子节点容器。

## RenderBox 实例属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `width` / `height` | `number \| undefined` | 组件期望尺寸；父级 tight 约束优先。 |
| `minWidth` / `maxWidth` | `number \| undefined` | 水平方向尺寸边界。 |
| `minHeight` / `maxHeight` | `number \| undefined` | 垂直方向尺寸边界。 |
| `margin` | `EdgeInsetsInput` | 组件绘制区域之外、由直接父布局保留的空间。 |
| `horizontalAlignment` | `'start' \| 'center' \| 'end' \| 'stretch'` | 组件在父布局分配槽位中的水平位置。 |
| `verticalAlignment` | `'start' \| 'center' \| 'end' \| 'stretch'` | 组件在父布局分配槽位中的垂直位置。 |
| `size` | `Size` | 布局完成后的组件绘制尺寸；由布局系统计算，不要作为业务输入直接修改。 |
| `outerSize` | `Size` | 只读布局结果；参与布局时等于 `size + margin`，不可见或不参与外部布局时为零尺寸。 |

负数尺寸归一化为 `0`，非有限数字按未指定处理。父布局仍负责最终约束，因此设置 `width = 400` 不代表组件可以突破父级提供的最大宽度。

## 构造参数和实例赋值

通用布局属性始终存在于组件实例上，但并非每个历史构造器都接收这些字段：

- options 类型继承或组合 `RenderBoxOptions` 时，可以在构造时传入，也可以在构造后赋值。
- 构造参数表没有列出这些字段时，应先创建组件，再设置实例属性。

```ts
const columns: GridColumnDef<Record<string, unknown>>[] = []
const rows: Record<string, unknown>[] = []
const grid = new RenderDataGrid({
  columns,
  rows,
  minHeight: 240,
  maxHeight: 600,
  margin: { top: 12 },
})

const saveButton = new RenderButton({ label: '保存', onClick: save })
saveButton.width = 120
saveButton.horizontalAlignment = 'end'
```

不要因为组件实例拥有 `width`、`height` 等属性，就推断其构造器一定接受同名字段；以具体组件文档的构造参数表和公开 options 类型为准。

## RenderPanel 容器属性

继承 `RenderPanel` 的容器在 `RenderBox` 属性之外原生支持 `padding: EdgeInsetsInput`。主要包括：

- `RenderStackPanel`
- `RenderGridPanel`
- `RenderDockPanel`
- `RenderWrapPanel`
- `RenderUniformGrid`
- `RenderAdaptiveGridPanel`
- `RenderMasonryPanel`
- `RenderAnchor` / `RenderCanvas`
- `RenderBorder`

```ts
const content = new RenderStackPanel({
  orientation: 'vertical',
  spacing: 12,
  padding: 24,
})
```

普通叶子组件没有通用 `padding` 属性。某些组件文档中的 `padding`、`paddingX`、`contentPadding` 或主题 padding 是该组件内部视觉规格，不等同于 `RenderPanel.padding`。

## 约束优先级

尺寸按以下顺序解析：

1. 父布局的 tight 约束。
2. 组件的 `width` / `height`。
3. `minWidth`、`maxWidth`、`minHeight`、`maxHeight`。
4. 未指定期望尺寸时的组件自然尺寸。

`margin` 属于子组件，`padding` 属于容器。兄弟节点的常规间距优先使用父容器的 `spacing`、`rowGap` 或 `columnGap`；只有单个子节点需要例外间距时才设置该节点的 `margin`。

## Popup 和服务型 API

`PopupManager`、`ContextMenuManager`、`NotificationManager`、`RenderDrawer` 这类独立浮层协议或 popup shell 不是普通父布局中的 `RenderBox` 子节点，不自动拥有上述盒模型属性。它们承载或引用的 `RenderBox` 内容仍遵循本页契约；浮层自身尺寸和定位使用对应 API 的 viewport、panel、anchor 或 open options。

完整布局算法和容器选择见[布局系统总览](../layouts.md)与布局 API 参考。
