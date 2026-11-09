# Common controls

These examples use only the public `directsurface` package entry. All controls may be composed inside a layout panel such as `RenderStackPanel`.

## Text and buttons

`RenderText` displays content. Updating its `text` property schedules layout when the text changes. `RenderButton` accepts a label, an action, and an optional visual variant:

```ts
import { RenderButton, RenderText } from 'directsurface'

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
import { RenderText, RenderTextBox } from 'directsurface'

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
import { RenderDataGrid, type GridColumnDef } from 'directsurface'

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

Set `autoRowHeight: true` on a text column to wrap its display text and measure each row from its content. `rowHeight` supplies the minimum and `maxRowHeight` limits growth; `wrapText: true` alone wraps inside a fixed row height. See [automatic row height](components/data/data-grid.md#自动行高与换行) for merged cells, editing and scroll behavior.

The first layout measures the display projection to establish exact scroll extents; only visible rows are painted. Data, width and font changes remeasure the projection, while hover, focus and selection changes remeasure affected rows and update connected merged spans. For large datasets, limit participating columns and use paging. Without `rowKey`, row objects provide identity; configure stable keys when replacing those objects.

The grid has more selection, sorting, filtering, and editing options. Use TypeScript completion on `DataGridOptions` and `GridColumnDef` for the full contracts. See the [component catalog](components.md) for related table and tree controls.

## Additional state and interaction options

Existing controls support the following optional behavior without adding new component families:

- `RenderColorPicker.valueState` accepts `'value'`, `'empty'`, and `'mixed'`. Empty and mixed states retain their visual distinction until the user chooses a color.
- `RenderListView.onHover` receives the hovered enabled item, or `null` on exit. Hover does not change selection or keyboard focus.
- `RenderTabs.onTabActivateRequest` can return `false` to reject an activation or `'defer'` when the owner will publish `activeKey` later.
- `CommandManager.execute` accepts `signal` and `canContinue`. Guarded execution rechecks the source and command state after asynchronous interceptors, so an obsolete target does not execute later.
- Date and time popup `ownerInput` mode lets the owning input retain text entry. Confirmation requires an activated candidate, and composition keys remain with the input. Date popup `datePrecision` selects year, month, or day precision.
- Multi-select popup `preserveSelectionOrder` retains the order of selected values; `onDraftChange` reports the changed option before confirmation. Defaults preserve existing behavior.

See [Event routing](event-routing.md), [NumberInput](components/input/number-input.md), and [CodeEditor](components/visualization/code-editor.md) for the related input and editor contracts.
