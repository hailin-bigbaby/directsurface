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

const repositoryUrl = 'https://github.com/hailin-bigbaby/directsurface'
const guidesUrl = `${repositoryUrl}/tree/main/docs/components`

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

function featureCard(title: string, description: string, detail: string): RenderCard {
  return new RenderCard({
    title,
    description,
    child: new RenderText(detail, { role: 'accent', size: 'large', weight: 'semibold' }),
  })
}

function overviewPage(): RenderStackPanel {
  const links = new RenderWrapPanel({ spacing: 8, runSpacing: 8 })
  links.addChild(new RenderButton({
    label: 'View source on GitHub',
    variant: 'primary',
    onClick: () => window.open(repositoryUrl, '_blank', 'noopener,noreferrer'),
  }))
  links.addChild(new RenderButton({
    label: 'Browse component guides',
    onClick: () => window.open(guidesUrl, '_blank', 'noopener,noreferrer'),
  }))

  const highlights = new RenderAdaptiveGridPanel({
    minColumnWidth: 190,
    maxColumns: 3,
    columnGap: 12,
    rowGap: 12,
  })
  highlights.addChild(featureCard('Layout', 'Compose responsive surfaces', 'Flex, grid & scroll'))
  highlights.addChild(featureCard('Controls', 'Build interactive workflows', 'Input, select & overlay'))
  highlights.addChild(featureCard('Data', 'Explore dense information', 'Grid, tree & charts'))

  const chart = new RenderLineChart({
    series: [
      { name: 'Visits', data: [
        { x: 'Mon', y: 32 }, { x: 'Tue', y: 45 }, { x: 'Wed', y: 39 },
        { x: 'Thu', y: 58 }, { x: 'Fri', y: 54 }, { x: 'Sat', y: 72 }, { x: 'Sun', y: 68 },
      ] },
      { name: 'Signups', data: [
        { x: 'Mon', y: 18 }, { x: 'Tue', y: 25 }, { x: 'Wed', y: 22 },
        { x: 'Thu', y: 35 }, { x: 'Fri', y: 31 }, { x: 'Sat', y: 43 }, { x: 'Sun', y: 40 },
      ] },
    ],
    xAxisType: 'category',
    area: true,
    legendMode: 'toggle',
    height: 250,
  })
  const sample = new RenderAdaptiveGridPanel({
    minColumnWidth: 320,
    maxColumns: 2,
    columnGap: 12,
    rowGap: 12,
  })
  sample.addChild(new RenderCard({
    title: 'Interactive chart',
    description: 'Hover points and toggle a series in the legend.',
    child: chart,
  }))
  sample.addChild(new RenderCard({
    title: 'Made for real applications',
    description: 'A small sample of the public component library.',
    child: column([
      new RenderText('Canvas rendering with keyboard and pointer input'),
      new RenderText('Theme-aware controls and reusable layout primitives'),
      new RenderText('Data views, charts and developer-facing guides'),
      new RenderBadge({ value: 'MIT licensed', status: 'success' }),
    ], 14),
  }))

  return page([
    new RenderCard({
      title: 'Build interfaces directly on Canvas',
      description: 'DirectSurface is a TypeScript GUI framework and component library.',
      child: column([
        new RenderParagraph('This live app uses the packed public ds-ui package. Open the tabs to try controls, switch themes, sort data and explore charts.'),
        links,
      ], 16),
      style: { padding: 24 },
    }),
    highlights,
    sample,
  ])
}

interface ShowcaseState {
  darkTheme: boolean
  name: string
  area: string
  period: string
  progress: number
  actionCount: number
}

function controlsPage(state: ShowcaseState, getHost: () => AppHost | undefined): RenderStackPanel {
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
      new RenderSwitch({
        label: 'Dark theme',
        checked: state.darkTheme,
        onChange: checked => {
          state.darkTheme = checked
          getHost()?.setTheme(checked ? ImGuiDarkTheme : ImGuiLightTheme)
          document.body.style.background = checked ? '#171a21' : '#f6f7fb'
        },
      }),
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
    { id: 'p5', name: 'Accessibility', owner: 'Taylor', status: 'Active', tasks: 31 },
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
  const state: ShowcaseState = {
    darkTheme: false,
    name: 'visitor',
    area: 'Design',
    period: 'week',
    progress: 56,
    actionCount: 0,
  }
  const pages = {
    overview: overviewPage,
    controls: () => controlsPage(state, () => appHost),
    data: dataPage,
  }
  const viewer = new RenderScrollViewer({ direction: 'vertical', child: pages.overview() })
  const tabs = new RenderTabs({
    tabs: [
      { key: 'overview', label: 'Overview' },
      { key: 'controls', label: 'Controls' },
      { key: 'data', label: 'Data & charts' },
    ],
    activeKey: 'overview',
    onTabChange: key => {
      const create = pages[key as keyof typeof pages]
      if (create) {
        const previous = viewer.child
        viewer.setChild(create())
        previous?.dispose()
      }
    },
  })
  tabs.margin = { left: 24, right: 24 }

  const brand = column([
    new RenderText('DirectSurface  /  ds-ui', { role: 'title', size: 'large', weight: 'bold' }),
    new RenderText('Interactive component showcase', { role: 'secondary' }),
  ], 4)
  brand.padding = { left: 24, right: 24, top: 18, bottom: 12 }

  const root = new RenderStackPanel({ orientation: 'vertical', spacing: 0, crossAxisAlignment: 'stretch' })
  root.addChild(brand)
  root.addChild(tabs)
  root.addChild(viewer, 1)

  const mainWindow = new RenderWindow({ title: 'DirectSurface showcase', chrome: 'none' })
  mainWindow.setChildren([new RenderPage({ child: root })])
  appHost = Application.mount('#app').run(mainWindow, { theme: ImGuiLightTheme })
  return appHost
}

let host: AppHost | undefined
void loadDirectSurfaceFonts().then(() => { host = createApp() })
window.addEventListener('pagehide', () => host?.dispose(), { once: true })
import.meta.hot?.dispose(() => host?.dispose())
