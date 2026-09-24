import {
  Application,
  ImGuiDarkTheme,
  ImGuiLightTheme,
  RenderAdaptiveGridPanel,
  RenderBadge,
  RenderButton,
  RenderCard,
  RenderComboBox,
  RenderDataGrid,
  RenderLineChart,
  RenderPage,
  RenderParagraph,
  RenderProgressBar,
  RenderPopover,
  RenderScrollViewer,
  RenderSegmentedControl,
  RenderSlider,
  RenderStackPanel,
  RenderSwitch,
  RenderTabs,
  RenderText,
  RenderTextBox,
  RenderWindow,
  RenderWrapPanel,
  loadDirectSurfaceFonts,
  type AppHost,
  type RenderBox,
} from 'ds-ui'
import { createWorkbenchPage } from './workbench_page'
import { createCanvasWorkspacePage } from './canvas_workspace_page'
import { WorkbenchStore } from './workbench_model'

function column(children: RenderBox[], spacing = 12): RenderStackPanel {
  const panel = new RenderStackPanel({ orientation: 'vertical', spacing, crossAxisAlignment: 'stretch' })
  for (const child of children) panel.addChild(child)
  return panel
}

function page(children: RenderBox[]): RenderStackPanel {
  const content = new RenderStackPanel({
    orientation: 'vertical',
    padding: 24,
    spacing: 20,
    crossAxisAlignment: 'stretch',
  })
  for (const child of children) content.addChild(child)
  return content
}

interface ShowcaseState {
  darkTheme: boolean
  name: string
  area: string
  period: string
  progress: number
  actionCount: number
  themeSwitch?: RenderSwitch
}

function controlsPage(state: ShowcaseState, setTheme: (dark: boolean) => void): RenderStackPanel {
  const greeting = new RenderText(`Hello, ${state.name || 'visitor'}!`, { role: 'accent', size: 'large' })
  const progress = new RenderProgressBar({ value: state.progress / 100 })
  const selection = new RenderText(`Selected: ${state.area}`, { role: 'secondary' })
  const actionStatus = new RenderText(`Actions run: ${state.actionCount}`, { role: 'secondary' })

  const actions = new RenderWrapPanel({ spacing: 8, runSpacing: 8 })
  actions.addChild(new RenderButton({
    label: 'Run action',
    variant: 'primary',
    onClick: () => { actionStatus.text = `Actions run: ${++state.actionCount}` },
  }))
  actions.addChild(new RenderButton({
    label: 'Reset count',
    onClick: () => { state.actionCount = 0; actionStatus.text = 'Actions run: 0' },
  }))

  const themeSwitch = new RenderSwitch({ label: 'Dark theme', checked: state.darkTheme, onChange: setTheme })
  state.themeSwitch = themeSwitch

  const cards = new RenderAdaptiveGridPanel({
    minColumnWidth: 320,
    maxColumns: 2,
    columnGap: 12,
    rowGap: 12,
  })
  cards.addChild(new RenderCard({
    title: 'Input & selection',
    description: 'Edit values and see the Canvas view update.',
    child: column([
      new RenderText('Your name', { role: 'secondary' }),
      new RenderTextBox({
        value: state.name,
        placeholder: 'Type a name',
        onChange: value => { state.name = value; greeting.text = `Hello, ${value || 'visitor'}!` },
      }),
      greeting,
      new RenderText('Project area', { role: 'secondary' }),
      new RenderComboBox({
        options: [
          { value: 'design', label: 'Design' },
          { value: 'engineering', label: 'Engineering' },
          { value: 'content', label: 'Content' },
        ],
        value: state.area.toLowerCase(),
        onChange: (_value, option) => { state.area = option?.label ?? 'None'; selection.text = `Selected: ${state.area}` },
      }),
      selection,
      new RenderSegmentedControl({
        options: [
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
        ],
        value: state.period,
        onChange: value => { state.period = value },
      }),
    ], 10),
  }))
  cards.addChild(new RenderCard({
    title: 'Feedback & appearance',
    description: 'Try theme, progress and button states.',
    child: column([
      themeSwitch,
      new RenderSlider({
        label: 'Progress',
        value: state.progress,
        min: 0,
        max: 100,
        step: 1,
        showValue: true,
        onChange: value => { state.progress = value; progress.value = value / 100 },
      }),
      progress,
      actions,
      actionStatus,
    ], 16),
  }))

  return page([
    new RenderText('Controls playground', { role: 'title', size: 'large' }),
    new RenderParagraph('Each control below is drawn by DirectSurface. Try typing, selecting, dragging and clicking.'),
    cards,
  ])
}

interface ProjectRow {
  id: string
  name: string
  owner: string
  status: string
  tasks: number
}

function dataPage(): RenderStackPanel {
  const rows: ProjectRow[] = [
    { id: 'p1', name: 'Canvas runtime', owner: 'Alex', status: 'Active', tasks: 24 },
    { id: 'p2', name: 'Component library', owner: 'Morgan', status: 'Active', tasks: 42 },
    { id: 'p3', name: 'Documentation', owner: 'Sam', status: 'Review', tasks: 18 },
    { id: 'p4', name: 'Example apps', owner: 'Jamie', status: 'Planned', tasks: 12 },
    { id: 'p5', name: 'Performance', owner: 'Taylor', status: 'Active', tasks: 31 },
  ]
  const grid = new RenderDataGrid<ProjectRow>({
    rowKey: 'id',
    columns: [
      { key: 'name', title: 'Project', type: 'text', width: 220, sortable: true },
      { key: 'owner', title: 'Owner', type: 'text', width: 130, sortable: true },
      { key: 'status', title: 'Status', type: 'text', width: 130, sortable: true },
      { key: 'tasks', title: 'Tasks', type: 'number', width: 90, align: 'right', sortable: true },
    ],
    rows,
    selectionMode: 'row',
    sortable: true,
    height: 280,
  })
  const chart = new RenderLineChart({
    series: [{ name: 'Completed tasks', data: [
      { x: 'Jan', y: 12 }, { x: 'Feb', y: 19 }, { x: 'Mar', y: 27 },
      { x: 'Apr', y: 25 }, { x: 'May', y: 36 }, { x: 'Jun', y: 48 },
    ] }],
    xAxisType: 'category',
    area: true,
    height: 240,
  })

  return page([
    new RenderText('Data & charts', { role: 'title', size: 'large' }),
    new RenderParagraph('Select a row, click a column header to sort, and hover the chart to inspect values. All data on this page is sample data.'),
    new RenderCard({
      title: 'Projects',
      description: 'A compact sortable data grid.',
      child: grid,
    }),
    new RenderCard({
      title: 'Delivery trend',
      description: 'A responsive line chart with hover details.',
      child: chart,
    }),
  ])
}

function createApp(): AppHost {
  let appHost: AppHost | undefined
  let savedTheme = 'light'
  try { savedTheme = localStorage.getItem('ds-showcase-theme') ?? 'light' } catch {}
  const state: ShowcaseState = {
    darkTheme: savedTheme === 'dark',
    name: 'visitor',
    area: 'Design',
    period: 'week',
    progress: 56,
    actionCount: 0,
  }
  const store = new WorkbenchStore()
  const themeSelector = new RenderSegmentedControl({
    options: [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
    value: state.darkTheme ? 'dark' : 'light',
    onChange: value => setTheme(value === 'dark'),
  })
  function setTheme(dark: boolean): void {
    state.darkTheme = dark
    try { localStorage.setItem('ds-showcase-theme', dark ? 'dark' : 'light') } catch {}
    themeSelector.value = dark ? 'dark' : 'light'
    if (state.themeSwitch) state.themeSwitch.checked = dark
    appHost?.setTheme(dark ? ImGuiDarkTheme : ImGuiLightTheme)
    document.body.style.background = dark ? '#171a21' : '#f6f7fb'
  }

  const settingsContent = column([
    new RenderText('Appearance', { role: 'title' }),
    new RenderText('Theme', { role: 'secondary' }),
    themeSelector,
  ], 12)
  settingsContent.padding = 14
  const settings = new RenderPopover({ label: 'Settings', content: settingsContent, placement: 'bottom-end', popoverWidth: 260 })
  const brand = column([
    new RenderText('DirectSurface  /  ds-ui', { role: 'title', size: 'large', weight: 'bold' }),
    new RenderText('Project delivery workbench', { role: 'secondary' }),
  ], 4)
  const identity = column([
    new RenderText('Alex Morgan', { weight: 'semibold' }),
    new RenderText('Demo user · Project lead', { role: 'secondary', size: 'small' }),
  ], 2)
  const accountRow = new RenderStackPanel({ orientation: 'horizontal', spacing: 12, mainAxisAlignment: 'end', crossAxisAlignment: 'center' })
  accountRow.addChild(new RenderBadge({ value: 'AM', status: 'primary', appearance: 'filled' }))
  accountRow.addChild(identity)
  accountRow.addChild(settings)
  const header = new RenderAdaptiveGridPanel({ minColumnWidth: 280, maxColumns: 2, columnGap: 12, rowGap: 10, padding: { left: 24, right: 24, top: 16, bottom: 14 } })
  header.addChild(brand)
  header.addChild(accountRow)

  const mainWindow = new RenderWindow({ title: 'DirectSurface project delivery workbench', chrome: 'none' })
  let activePage = createWorkbenchPage(store, () => appHost)
  const viewer = new RenderScrollViewer({ direction: 'vertical', child: activePage.root })
  const tabs = new RenderTabs({
    tabs: [
      { key: 'workbench', label: 'Workbench' },
      { key: 'controls', label: 'Controls' },
      { key: 'data', label: 'Data & charts' },
      { key: 'workspace', label: 'Canvas workspace' },
    ],
    activeKey: 'workbench',
    onTabChange: key => {
      activePage.dispose()
      state.themeSwitch = undefined
      const previous = viewer.child
      if (key === 'workbench') activePage = createWorkbenchPage(store, () => appHost)
      else if (key === 'controls') activePage = { root: controlsPage(state, setTheme), dispose: () => {} }
      else if (key === 'data') activePage = { root: dataPage(), dispose: () => {} }
      else activePage = { root: createCanvasWorkspacePage(mainWindow), dispose: () => {} }
      viewer.setChild(activePage.root)
      previous?.dispose()
    },
  })
  tabs.margin = { left: 24, right: 24 }

  const root = new RenderStackPanel({ orientation: 'vertical', spacing: 0, crossAxisAlignment: 'stretch' })
  root.addChild(header)
  root.addChild(tabs)
  root.addChild(viewer, 1)

  mainWindow.setChildren([new RenderPage({ child: root })])
  appHost = Application.mount('#app').run(mainWindow, { theme: state.darkTheme ? ImGuiDarkTheme : ImGuiLightTheme })
  setTheme(state.darkTheme)
  window.addEventListener('pagehide', () => activePage.dispose(), { once: true })
  return appHost
}

let host: AppHost | undefined
void loadDirectSurfaceFonts().then(() => { host = createApp() })
window.addEventListener('pagehide', () => host?.dispose(), { once: true })
import.meta.hot?.dispose(() => host?.dispose())
