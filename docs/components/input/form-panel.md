# FormPanel 与 FormField

`RenderFormPanel` 是普通业务表单的默认布局入口。它只排列字段，不读取业务 model、不自动绑定值、不自动提交。`RenderFormField` 负责单个字段的 label、必填标记、editor、单位、meta 和校验外观。


## API 总览

```ts
import {
  RenderFormField,
  RenderFormPanel,
  type FormFieldLabelOverflow,
  type FormFieldLabelPlacement,
  type FormFieldMetaTone,
  type FormFieldValidationDisplay,
  type FormPanelChildData,
  type FormPanelColumnCount,
  type FormPanelDebugState,
  type FormPanelLabelPlacement,
  type RenderFormFieldOptions,
  type RenderFormPanelOptions,
} from 'ds-ui'
```

普通表单优先使用这两个组件。只有确实需要自定义列轨道、跨行、行级错误反馈或 Enter 导航时，才使用高级 [EntryGrid](../data/entry-grid.md)。

## 最小示例：手动状态，自动布局

```ts
import { RenderFormField, RenderFormPanel, RenderTextBox } from 'ds-ui'

const draft = {
  name: '',
  department: '',
}

const form = new RenderFormPanel({
  columns: 'auto',
  maxColumns: 2,
  minColumnWidth: 220,
  labelPlacement: 'adaptive',
})

form.addField(new RenderFormField({
  label: '姓名',
  required: true,
  child: new RenderTextBox({
    value: draft.name,
    onChange: value => {
      draft.name = value
    },
  }),
}))

form.addField(new RenderFormField({
  label: '部门',
  child: new RenderTextBox({
    value: draft.department,
    onChange: value => {
      draft.department = value
    },
  }),
}))
```

业务显式维护 `draft`；FormPanel 自动决定有效列数、字段宽度、label 位置、行高和最终高度。

## RenderFormPanel 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `columns` | `number \| 'auto'` | `'auto'` | 自动列数模式；传数字时固定列数。 |
| `maxColumns` | `number` | 数字 columns 或 `4` | `'auto'` 模式的最大列数。固定数字列模式忽略该值。 |
| `minColumnWidth` | `number` | `220` | 自动降列时每列期望的最小宽度。 |
| `labelWidth` | `number \| undefined` | 主题宽度 | 面板统一 label lane 宽度。 |
| `labelPlacement` | `'inline' \| 'top' \| 'adaptive'` | `'inline'` | 面板字段的 label 位置策略。 |
| `labelPlacementBreakpoint` | `number` | `280` | `adaptive` 根据字段实际宽度切换的位置。 |
| `columnGap` / `rowGap` | `number \| undefined` | 主题间距 | 显式列间距和行间距。 |

`labelWidth` 不接受 `'auto'`。省略时使用主题的稳定 label lane；特殊页面需要更宽标签时传数字。框架不扫描业务文案决定全局宽度，避免一条异常长 label 挤压所有 editor。

响应式数字参数会先规整：`minColumnWidth` 至少为 `1`，`labelPlacementBreakpoint` 至少为 `0`，`columnGap` / `rowGap` 的负数变为 `0`；`NaN` 和无穷值不会进入列数计算，其中尺寸、断点回退默认值，gap 回退主题值。

FormPanel 默认自动布局，最多 4 列。需要稳定列数时显式传数字，例如 `columns: 2`。API 不再提供第二个自适应布尔开关，避免同一意图出现两套配置组合。

## 字段跨度和局部覆盖

```ts
const form = new RenderFormPanel({ columns: 'auto' })

const notes = new RenderFormField({
  label: '备注',
  child: new RenderTextBox({ value: '' }),
})

form.addField(notes, {
  columnSpan: 'full',
  labelPlacement: 'top',
})
```

`FormPanelChildData`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `columnSpan` | `number \| 'full'` | 占用指定列数，或始终占满当前有效列。 |
| `labelPlacement` | `'inline' \| 'top' \| 'inherit'` | 覆盖单个字段的位置策略。 |

不可见或移除的字段不占位置，后续字段自动补位。

## 动态字段 API

| 方法 | 说明 |
| --- | --- |
| `addField(field, data?)` | 追加字段。 |
| `insertField(index, field, data?)` | 在指定位置插入字段。 |
| `removeField(field)` | 移除字段并维护 parent/owner。 |
| `moveField(field, targetIndex)` | 调整字段顺序。 |
| `replaceField(current, next, data?)` | 替换字段。 |
| `setFieldData(field, data)` | 修改跨度或 label placement。 |
| `getFieldData(field)` | 读取只读字段附加数据。 |
| `clearFields()` | 清空所有字段。 |
| `debugState()` | 返回有效列数和最近一次字段 placement。 |

`children` 和 `childData` 是只读视图。不要直接修改数组或 Map。

## RenderFormField 配置

`RenderFormFieldOptions` 的常用字段：

| 字段 | 说明 |
| --- | --- |
| `label` | 字段名称。 |
| `child` | 实际 editor 或展示组件。 |
| `required` | 只显示必填标记，不代表自动业务校验。 |
| `unit` | editor 后的单位。 |
| `metaText` / `metaTone` | 补充信息和语气。 |
| `labelWidth` / `labelGap` | 单字段 label lane 配置。FormPanel 的统一配置优先。 |
| `labelOverflow` | `expand`、`clip` 或 `ellipsis`。 |
| `labelPlacement` | `inline` 或 `top`。 |
| `status` / `message` | 手动设置字段状态和说明。 |
| `validationDisplay` | `compact`、`inline`、`status-only` 或 `none`。 |

FormPanel 默认对 label 使用 ellipsis，并且仅在真实溢出、指针位于 label 区域时显示完整 tooltip。

当 label 位于顶部或使用 inline 校验消息时，FormField 会先从可用高度中预留 label、间距和消息区域，再把剩余高度约束交给 editor。页面仍应给具有固定最小高度的 editor 足够空间；布局层不会改写 editor 自己声明的硬性最小高度。

## 校验展示

```ts
const category = new RenderFormField({
  label: '分类',
  child: new RenderTextBox({ value: '' }),
  status: 'error',
  message: '请输入分类',
  validationDisplay: 'inline',
})
```

`required`、`status` 和 `message` 都是显式视觉状态。何时校验、错误来自哪里、是否允许保存，仍由页面或可选的 FormSession 决定。

## API 命名

表单字段只使用 `RenderFormField` 与 `FormField*` 类型；表单面板只使用 `RenderFormPanel` 与 `FormPanel*` 类型。包入口不保留同义类名或类型别名。
