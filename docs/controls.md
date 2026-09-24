# Common controls

These examples use only the public `ds-ui` package entry. All controls may be composed inside a layout panel such as `RenderStackPanel`.

## Text and buttons

`RenderText` displays content. Updating its `text` property schedules layout when the text changes. `RenderButton` accepts a label, an action, and an optional visual variant:

```ts
import { RenderButton, RenderText } from 'ds-ui'

const status = new RenderText('Ready', { role: 'secondary' })
const button = new RenderButton({
  label: 'Save',
  variant: 'primary',
  onClick: () => { status.text = 'Saved' },
})
```

Set a button's `disabled` state when an action is unavailable. Use `loading` while an asynchronous action is in progress. The available variants are `default`, `primary`, `danger`, `text`, and `link`.

## Single-line input

`RenderTextBox` exposes a value and reports edits through `onChange`. The same input family also provides `RenderPasswordField` and `RenderSearchBox`:

```ts
import { RenderText, RenderTextBox } from 'ds-ui'

const greeting = new RenderText('Hello!')
const name = new RenderTextBox({
  value: '',
  placeholder: 'Your name',
  onChange: value => { greeting.text = `Hello, ${value || 'world'}!` },
})
```

The [component showcase](../examples/basic-app/src/main.ts) uses this pattern and shows how to dispose the host. Use `RenderTextArea` for multiline input.

## Data grid

`RenderDataGrid` displays structured rows and columns. Give each column a stable key and use `rowKey` when replacing row objects should preserve row identity:

```ts
import { RenderDataGrid, type GridColumnDef } from 'ds-ui'

interface ProductRow {
  id: string
  name: string
  quantity: number
}

const columns: GridColumnDef<ProductRow>[] = [
  { key: 'name', title: 'Name', type: 'text', width: 180 },
  { key: 'quantity', title: 'Quantity', type: 'number', width: 100 },
]
const grid = new RenderDataGrid<ProductRow>({
  rowKey: 'id',
  columns,
  rows: [{ id: 'p1', name: 'Notebook', quantity: 4 }],
})
```

The grid has more selection, sorting, filtering, and editing options. Use TypeScript completion on `DataGridOptions` and `GridColumnDef` for the full contracts. See the [component catalog](components.md) for related table and tree controls.
