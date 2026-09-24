# Checkbox / Switch / RadioGroup

> **通用布局能力**：本页中的输入组件实例统一支持 `width`、`height`、min/max、`margin` 和槽位对齐；选项间距和控件内部 padding 仍属于组件自己的视觉配置。详见[组件通用布局属性](../common-layout-properties.md)。

`RenderCheckbox`、`RenderSwitch` 和 `RenderRadioGroup` 都用于选择状态，但语义不同：

- `RenderCheckbox`：独立勾选项，可表达 true/false，也支持 indeterminate。
- `RenderSwitch`：立即生效的开关。
- `RenderRadioGroup`：一组选项中选择一个。当前没有单独导出的 radio 项组件，单选必须通过 group 管理。

它们都是 canvas render object，不是浏览器原生 input。业务状态应由外部 model/controller 管理，组件通过 `checked/value` 和 `onChange` 进行投影和回写。

## API 总览

主类：

- `RenderCheckbox`
- `RenderSwitch`
- `RenderRadioGroup`

相关 public type：

- `RadioOption`

导入：

```ts
import {
  RenderCheckbox,
  RenderRadioGroup,
  RenderSwitch,
  type RadioOption,
} from 'directsurface'
```

三个组件的构造参数都是公开 options 对象；`RadioOption` 从包入口导出，可用于声明单选项数组。

三个组件都直接实现 `ValueEditor`：Checkbox 和 Switch 的正式值是 `boolean`，RadioGroup 的正式值是 `string`。可以直接传给 `FormBindingBag.bindField()`；`setValue()`、`checked` 或 `value` 的外部赋值保持静默，只有用户点击或键盘切换才发布值事件并调用原有 `onChange`。它们没有内置错误文案区域，表单校验通常配合 `RenderFormField` 展示。

## 选择规则

| 场景 | 推荐组件 |
| --- | --- |
| 多个互不影响的选项 | `RenderCheckbox` |
| 配置项开/关，点击后立即生效 | `RenderSwitch` |
| 少量互斥选项 | `RenderRadioGroup` |
| 选项很多或需要搜索 | [ComboBox](../selector/combo-box.md) |
| 多选且需要显示已选结果 | [MultiSelectDropdown](../selector/multi-select-dropdown.md) |
| 表格内布尔列 | [DataGrid](../data/data-grid.md) 的 checkbox column |

文案应描述状态含义，不要只写“是/否”而没有上下文。

## Checkbox 最小示例

```ts
import { RenderCheckbox } from 'directsurface'

const checkboxState = {
  enabled: false,
}

const checkbox = new RenderCheckbox({
  label: '启用自动保存',
  checked: checkboxState.enabled,
  onChange: value => {
    checkboxState.enabled = value
  },
})
```

indeterminate：

```ts
const checkbox = new RenderCheckbox({
  label: '选择全部',
  checked: false,
  indeterminate: true,
  onChange: checked => {
    state.allSelected = checked
  },
})
```

## RenderCheckbox 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `checked` | `boolean` | 必填 | 是否勾选。 |
| `indeterminate` | `boolean` | `false` | 是否显示半选态。 |
| `disabled` | `boolean` | `false` | 是否禁用。 |
| `label` | `string` | 必填 | 文本标签。 |
| `onChange` | `(value: boolean) => void` | `undefined` | 用户切换后触发。 |

## RenderCheckbox 属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `checked` | `boolean` | 当前勾选值。赋值会同步动画并请求重绘。 |
| `indeterminate` | `boolean` | 当前半选态。赋值会同步动画并请求重绘。 |
| `disabled` | `boolean` | 当前禁用态。赋值会同步 focusable disabled 状态。 |
| `label` | `string` | 标签文本。直接修改不会自动触发布局。 |
| `onChange` | `(value: boolean) => void \| undefined` | 用户切换回调。 |

`checked`、`indeterminate`、`disabled` 有 setter，会触发对应刷新。`label` 是公开字段，动态修改后需要由父组件触发布局或重建组件。

## Checkbox 交互行为

鼠标：

- 只响应主按钮。
- pointer down 命中组件时请求焦点并进入 pressed。
- pointer up 仍命中组件时切换值。
- pointer leave 会退出 hover，但保留 pending press；如果最后在组件外抬起，不会切换。
- pointer cancel 或手势被滚动容器等祖先赢走时，会取消 pending press，不触发 `onChange`。

键盘：

- 聚焦后 `Enter` 或 `Space` 切换值。
- 禁用时不响应键盘。

半选态：

- 当前为 `indeterminate === true` 时，第一次用户切换会把 `indeterminate` 置为 `false`，并把 `checked` 置为 `true`。
- `onChange` 收到的是最终 `checked` 值。

生命周期：

- `dispose()` 会取消 pending gesture、释放动画，并清空 `onChange`。

## Checkbox 布局和绘制

- 宽度 = boxSize + itemSpacing + label 文本测量宽度。
- 高度至少为 boxSize。
- 文本宽度使用 `TextMeasurer.measureWidth()`。
- 勾选和半选使用同一条 check 动画。
- hover 使用独立动画。
- 聚焦时在 checkbox 方框上绘制 focus ring。
- label 不自动换行、不省略；长文本应由业务侧控制。

## Switch 最小示例

```ts
import { RenderSwitch } from 'directsurface'

const switchState = {
  debugVisible: false,
}

const switcher = new RenderSwitch({
  label: '显示调试信息',
  checked: switchState.debugVisible,
  onChange: checked => {
    switchState.debugVisible = checked
  },
})
```

禁用态：

```ts
const switcher = new RenderSwitch({
  label: '启用归档同步',
  checked: false,
  disabled: true,
})
```

## RenderSwitch 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `checked` | `boolean` | `false` | 是否开启。 |
| `label` | `string` | `''` | 文本标签。为空时只显示开关。 |
| `disabled` | `boolean` | `false` | 是否禁用。 |
| `onChange` | `(checked: boolean) => void` | `undefined` | 用户切换后触发。 |

## RenderSwitch 属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `checked` | `boolean` | 当前开关值。赋值会同步动画并请求重绘。 |
| `disabled` | `boolean` | 当前禁用态。赋值会同步 focusable disabled 状态。 |
| `label` | `string` | 标签文本。直接修改不会自动触发布局。 |
| `onChange` | `(checked: boolean) => void \| undefined` | 用户切换回调。 |

## Switch 交互行为

鼠标：

- 只响应主按钮。
- pointer down 命中组件时请求焦点并进入 pressed。
- pointer up 仍命中组件时切换 `checked`。
- pointer leave 退出 hover；如果最后在组件外抬起，不会切换。
- 手势被滚动容器等祖先赢走时，会清理 pressed，不触发 `onChange`。

键盘：

- 聚焦后 `Enter` 或 `Space` 切换值。
- 禁用时不响应键盘。

生命周期：

- `dispose()` 会取消 pending gesture、释放 toggle/hover 动画，并清空 `onChange`。

## Switch 布局和绘制

- 宽度 = trackWidth + 可选 labelWidth + itemSpacing。
- 高度使用主题 `controlHeight`。
- track 背景从 off/on 颜色按 toggle 动画插值。
- thumb 使用圆形绘制并带阴影。
- hover 使用独立动画。
- 聚焦时在整个 switch 区域绘制 focus ring。
- label 不自动换行、不省略。

## RadioGroup 最小示例

```ts
import { RenderRadioGroup, type RadioOption } from 'directsurface'

const shiftOptions: RadioOption[] = [
  { value: 'day', label: '日间' },
  { value: 'night', label: '夜间' },
]

const radioState = {
  shift: 'day',
}

const group = new RenderRadioGroup({
  options: shiftOptions,
  value: radioState.shift,
  onChange: value => {
    radioState.shift = value
  },
})
```

垂直排列：

```ts
const group = new RenderRadioGroup({
  direction: 'vertical',
  options: [
    { value: 'scenario-b', label: '场景 B' },
    { value: 'scenario-a', label: '场景 A' },
    { value: 'emergency', label: '运营部', disabled: true },
  ],
  value: 'scenario-b',
})
```


## RadioOption

```ts
const option: RadioOption = {
  value: 'normal',
  label: '普通',
  disabled: false,
}
```

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `value` | `string` | 必填 | 选项值。必须在 group 内保持唯一。 |
| `label` | `string` | 必填 | 显示文本。 |
| `disabled` | `boolean` | `false` | 是否禁用该选项。 |

## RenderRadioGroup 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `options` | `RadioOption[]` | 必填 | 单选项列表。 |
| `value` | `string` | `''` | 当前选中值。 |
| `disabled` | `boolean` | `false` | 是否禁用整个 group。 |
| `direction` | `'horizontal' \| 'vertical'` | `'horizontal'` | 排列方向。 |
| `onChange` | `(value: string) => void` | `undefined` | 用户切换后触发。 |

## RenderRadioGroup 属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `options` | `RadioOption[]` | 当前选项。赋值会重建选项动画、请求 layout 和 paint。 |
| `value` | `string` | 当前选中值。赋值会同步动画并请求重绘，不触发 `onChange`。 |
| `disabled` | `boolean` | 当前禁用态。赋值会同步 focusable disabled 状态。 |
| `direction` | `'horizontal' \| 'vertical'` | 当前排列方向。直接修改后需要触发布局。 |
| `onChange` | `(value: string) => void \| undefined` | 用户切换回调。 |

## RadioGroup 交互行为

鼠标：

- 只响应主按钮。
- pointer down 命中可用选项时立即选中该项。
- 选中 disabled 选项不会生效。
- pointer cancel 不会回滚已经选中的值。
- hover 按选项记录。

键盘：

- 聚焦后 `ArrowLeft` / `ArrowUp` 选择上一个可用选项。
- `ArrowRight` / `ArrowDown` 选择下一个可用选项。
- `Home` 选择第一个可用选项。
- `End` 选择最后一个可用选项。
- `Enter` / `Space` 选择当前 focus value。
- disabled 选项会在键盘导航中被跳过。

注意：当前方向键会直接改变选中值并触发 `onChange`，不是只移动焦点。

生命周期：

- `options` 重新赋值会 dispose 旧选项动画并重建动画。
- `dispose()` 会释放所有选项动画。

## RadioGroup 布局和绘制

水平：

- 每个选项宽度 = radio 直径 + padding + labelWidth + itemSpacing * 3。
- 总宽度为所有选项宽度相加，并受 `constraints.maxWidth` 限制。
- 高度为单个 itemHeight。

垂直：

- 宽度使用 `constraints.maxWidth`；当 maxWidth 为 Infinity 时使用 200。
- 高度 = itemHeight * options.length。

绘制：

- 每个选项绘制圆形控制、选中圆点和 label。
- 当前选中项有 dot 动画。
- group 聚焦时，focus ring 绘制在当前 focus option 的 item 区域。
- label 不自动换行、不省略。

## 主题来源

`RenderCheckbox` 使用 `deriveCheckboxStyle(theme)`：

- `boxBg`、`checkedBoxBg`、`boxBorder` 控制方框背景和边框。
- `checkMark` 控制勾选和半选线条颜色。
- `labelText` 控制 label 颜色。
- `boxSize = theme.fontSize + 4`。
- `borderRadius = theme.frameRounding`。

`RenderSwitch` 使用 `deriveSwitchStyle(theme)`：

- `offTrackBg`、`onTrackBg` 控制关闭/开启轨道。
- `trackBorder` 控制轨道边框。
- `thumbBg` 控制滑块。
- `thumbShadowColor` 从主题 elevation 派生滑块阴影颜色。
- `height = theme.controlHeight`。
- `trackWidth = theme.fontSize * 2.2`。
- `trackHeight = theme.fontSize * 1.1`。

`RenderRadioGroup` 使用 `deriveRadioGroupStyle(theme)`：

- `controlBg` 控制圆形底色。
- `controlBorder` 控制圆形边框。
- `dotBg` 控制选中圆点。
- `labelText` 控制 label 文本。
- `itemHeight = max(theme.controlHeight - 2, theme.fontSize + theme.framePadding * 1.5)`。
- `radioRadius = theme.fontSize * 0.5`。

## 表单组合建议

- 查询条件区里，少量布尔条件使用 `RenderCheckbox`。
- 设置面板里，立即生效的功能开关使用 `RenderSwitch`。
- 互斥模式切换使用 `RenderRadioGroup`；超过 5-7 个选项建议换成 [ComboBox](../selector/combo-box.md)。
- 表单行布局可使用 [EntryGrid](../data/entry-grid.md) 或布局组件组合。
- 批量勾选父节点可使用 checkbox 的 `indeterminate` 表达半选。

## 性能边界

- 三个组件布局时都会测量 label 宽度。
- Checkbox/Switch 使用动画控制 hover 和 checked 状态，频繁创建销毁时要确保调用 `dispose()`。
- RadioGroup 每个 option 都有选中动画，频繁替换大量 options 会重建动画。
- 大量布尔项列表应使用 [ListView](../data/list-view.md)、[DataGrid](../data/data-grid.md) 或虚拟化容器，而不是一次性创建大量控件。

## 常见问题

### Checkbox 和 Switch 怎么选？

Checkbox 表示“是否选择这个条件或选项”；Switch 表示“这个功能现在是否开启”。Switch 通常点击后立即生效。

### 为什么 Radio 不是单独控件？

单选的核心是同组互斥。当前框架把互斥逻辑放在 `RenderRadioGroup` 内，避免业务侧手动维护多个独立 radio 的排他关系。

### 为什么修改 label 后尺寸没变？

`label` 是公开字段，直接修改不会自动 `markNeedsLayout()`。动态 label 建议重建组件或由父级触发布局。

### 为什么 RadioGroup 重新设置 value 没有触发 onChange？

直接设置 `value` 是外部状态投影，不视为用户操作，所以不会触发 `onChange`。用户点击或键盘切换才会触发。

### disabled option 会被键盘选中吗？

不会。方向键、Home、End 都只在可用选项之间移动并选择。

## 相关文档

- [TextBox 文本输入](./text-box.md)
- [TextArea 多行输入](./text-area.md)
- [ComboBox 下拉框](../selector/combo-box.md)
- [MultiSelectDropdown 多选下拉](../selector/multi-select-dropdown.md)
- [EntryGrid 表单网格](../data/entry-grid.md)
- [DataGrid 数据表格](../data/data-grid.md)
- [ListView 列表](../data/list-view.md)
- [主题与状态](../../themes.md)
- [焦点与输入](../../lifecycle.md)
