import {
  DockWindowManager,
  RenderButton,
  RenderCard,
  RenderDataGrid,
  RenderDockWorkspace,
  RenderLineChart,
  RenderParagraph,
  RenderProgressBar,
  RenderSegmentedControl,
  RenderSlider,
  RenderStackPanel,
  RenderText,
  RenderTextBox,
  RenderWindow,
  RenderWrapPanel,
  type RenderBox,
} from 'directsurface'

interface WorkItem extends Record<string, string | number> {
  id: string
  name: string
  team: string
  state: string
  points: number
}

const teams = ['Core', 'Design', 'Platform', 'Docs']
const states = ['Ready', 'In progress', 'Review', 'Done']
const rows: WorkItem[] = Array.from({ length: 10_000 }, (_, index) => ({
  id: `ITEM-${String(index + 1).padStart(5, '0')}`,
  name: `Workspace item ${index + 1}`,
  team: teams[index % teams.length]!,
  state: states[Math.floor(index / 3) % states.length]!,
  points: 1 + (index * 7) % 13,
}))

function column(children: RenderBox[], spacing = 10): RenderStackPanel {
  const panel = new RenderStackPanel({ orientation: 'vertical', spacing, crossAxisAlignment: 'stretch' })
  for (const child of children) panel.addChild(child)
  return panel
}

export function createCanvasWorkspacePage(hostWindow: RenderWindow): RenderBox {
  const manager = new DockWindowManager()
  manager.setWindowHost(hostWindow)
  const compact = window.innerWidth < 700

  const grid = new RenderDataGrid<WorkItem>({
    rowKey: 'id',
    columns: [
      { key: 'id', title: 'ID', type: 'text', width: 130, sortable: true },
      { key: 'name', title: 'Item', type: 'text', width: 250, sortable: true },
      { key: 'team', title: 'Team', type: 'text', width: 120, sortable: true },
      { key: 'state', title: 'State', type: 'text', width: 130, sortable: true },
      { key: 'points', title: 'Points', type: 'number', width: 100, align: 'right', sortable: true },
    ],
    rows,
    selectionMode: 'row',
    sortable: true,
  })
  const dataContent = column([
    new RenderText('10,000 local sample rows', { role: 'accent', weight: 'semibold' }),
    new RenderTextBox({ placeholder: 'Filter rows by item or team', onChange: value => grid.setQuickFilter(value) }),
    grid,
  ], 8)
  dataContent.padding = 12
  manager.openDocument({ tabId: 'items', title: 'Data explorer', content: dataContent, closable: false })

  const progress = new RenderProgressBar({ value: 0.68 })
  const inspector = column([
    new RenderText('Inspector', { role: 'title' }),
    new RenderParagraph('Change controls in this panel, then drag its tab to rearrange the workspace.'),
    new RenderText('Display name', { role: 'secondary' }),
    new RenderTextBox({ value: 'Sample project', onChange: () => {} }),
    new RenderText('View density', { role: 'secondary' }),
    new RenderSegmentedControl({
      options: [{ value: 'compact', label: 'Compact' }, { value: 'standard', label: 'Standard' }],
      value: 'standard',
    }),
    new RenderSlider({ label: 'Progress', value: 68, min: 0, max: 100, showValue: true, onChange: value => { progress.value = value / 100 } }),
    progress,
  ], 12)
  inspector.padding = 14
  manager.openDocument({ tabId: 'inspector', title: 'Inspector', content: inspector, closable: false })
  const inspectorRecord = manager.getDocument('inspector')
  if (!compact && inspectorRecord && manager.root.type === 'tabs') manager.dockWindow(inspectorRecord.window, manager.root, 'right')

  const trend = new RenderLineChart({
    series: [
      { name: 'Active', data: [18, 23, 28, 26, 34, 38, 42].map((y, index) => ({ x: `Day ${index + 1}`, y })) },
      { name: 'Done', data: [9, 12, 14, 19, 22, 27, 33].map((y, index) => ({ x: `Day ${index + 1}`, y })) },
    ],
    xAxisType: 'category',
    area: true,
    height: 260,
    legendMode: 'toggle',
  })
  const trendContent = column([
    new RenderText('Delivery trend', { role: 'title' }),
    new RenderParagraph('Hover points and toggle series in the legend.'),
    trend,
  ], 10)
  trendContent.padding = 14
  manager.openDocument({ tabId: 'trend', title: 'Trend', content: trendContent, closable: false })
  manager.activateDocument('items')

  const workspace = new RenderDockWorkspace({ manager, disposeManagerOnDispose: true })
  workspace.height = 480
  const actions = new RenderWrapPanel({ spacing: 8, runSpacing: 8 })
  if (!compact) {
    actions.addChild(new RenderButton({
      label: 'Float inspector',
      onClick: () => {
        const record = manager.getDocument('inspector')
        if (record) manager.floatWindow(record.window, { x: 340, y: 150, width: 380, height: 330 })
      },
    }))
    actions.addChild(new RenderButton({
      label: 'Dock inspector',
      onClick: () => {
        const record = manager.getDocument('inspector')
        if (!record) return
        const root = manager.root
        const rightGroup = root.type === 'split' && root.second.type === 'tabs' ? root.second : undefined
        if (rightGroup) manager.dockWindow(record.window, rightGroup, 'center')
        else manager.dockWindow(record.window)
      },
    }))
  }

  const page = column([
    new RenderCard({
      title: 'A workspace built on Canvas',
      description: compact ? 'Explore tabs and a large data grid.' : 'Docking, tabbed documents and a virtual data grid.',
      child: column([
        new RenderParagraph(compact
          ? 'Switch tabs to explore the data grid, trend and inspector. Open a wider window to try docking and floating panels.'
          : 'Drag tabs to split or float panels. Use the buttons to move the inspector, and filter 10,000 local rows in the data explorer.'),
        actions,
      ], 14),
    }),
    workspace,
    new RenderText('All records are generated locally. This page demonstrates public directsurface APIs.', { role: 'secondary' }),
  ], 16)
  page.padding = 24
  return page
}
