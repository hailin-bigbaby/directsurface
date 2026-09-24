import {
  RenderAdaptiveGridPanel,
  RenderAdaptiveSidebarPanel,
  RenderBadge,
  RenderButton,
  RenderCard,
  RenderComboBox,
  RenderDataGrid,
  RenderDatePicker,
  RenderDrawer,
  RenderLineChart,
  RenderParagraph,
  RenderScrollViewer,
  RenderSegmentedControl,
  RenderStackPanel,
  RenderText,
  RenderTextBox,
  RenderWrapPanel,
  type AppHost,
  type RenderBox,
} from 'directsurface'
import {
  WorkbenchStore,
  dateKey,
  owners,
  projects,
  statusLabels,
  type Task,
  type TaskStatus,
} from './workbench_model'

interface TaskRow extends Record<string, string> {
  id: string
  title: string
  project: string
  owner: string
  status: string
  due: string
}

function column(children: RenderBox[], spacing = 10): RenderStackPanel {
  const panel = new RenderStackPanel({ orientation: 'vertical', spacing, crossAxisAlignment: 'stretch' })
  for (const child of children) panel.addChild(child)
  return panel
}

function taskRow(task: Task): TaskRow {
  return {
    id: task.id,
    title: task.title,
    project: projects.find(project => project.id === task.projectId)?.name ?? task.projectId,
    owner: owners.find(owner => owner.id === task.ownerId)?.name ?? task.ownerId,
    status: statusLabels[task.status],
    due: task.dueAt,
  }
}

export function createWorkbenchPage(store: WorkbenchStore, getHost: () => AppHost | undefined): { root: RenderBox; dispose: () => void } {
  let activeDrawer: RenderDrawer | undefined
  let disposed = false
  const totalText = new RenderText('0', { role: 'accent', size: 28, weight: 'bold' })
  const doneText = new RenderText('0', { role: 'accent', size: 28, weight: 'bold' })
  const rateText = new RenderText('0%', { role: 'accent', size: 28, weight: 'bold' })
  const overdueText = new RenderText('0', { role: 'accent', size: 28, weight: 'bold' })
  const resultText = new RenderText('', { role: 'secondary' })
  const sidebarSelection = new RenderText('All projects', { role: 'accent', weight: 'semibold' })

  const chart = new RenderLineChart({
    series: [],
    xAxisType: 'category',
    area: true,
    height: 220,
    showTooltip: true,
    legendMode: 'toggle',
  })

  function closeDrawer(): void {
    const drawer = activeDrawer
    activeDrawer = undefined
    drawer?.dispose()
  }

  function openDrawer(task?: Task): void {
    closeDrawer()
    const isNew = !task
    const draft = {
      title: task?.title ?? '',
      projectId: task?.projectId ?? (store.filters.projectId === 'all' ? projects[0].id : store.filters.projectId),
      ownerId: task?.ownerId ?? owners[0].id,
      status: task?.status ?? 'todo' as TaskStatus,
      dueAt: task?.dueAt ?? dateKey(store.today),
    }
    const error = new RenderText('', { role: 'accent' })
    const fields = column([
      new RenderText('Task title', { role: 'secondary' }),
      new RenderTextBox({ value: draft.title, placeholder: 'Describe the work', onChange: value => { draft.title = value; error.text = '' } }),
      new RenderText('Project', { role: 'secondary' }),
      new RenderComboBox({
        options: projects.map(project => ({ value: project.id, label: project.name })),
        value: draft.projectId,
        onChange: value => { draft.projectId = value },
      }),
      new RenderText('Owner', { role: 'secondary' }),
      new RenderComboBox({
        options: owners.map(owner => ({ value: owner.id, label: owner.name })),
        value: draft.ownerId,
        onChange: value => { draft.ownerId = value },
      }),
      new RenderText('Status', { role: 'secondary' }),
      new RenderComboBox({
        options: Object.entries(statusLabels).map(([value, label]) => ({ value, label })),
        value: draft.status,
        onChange: value => { draft.status = value as TaskStatus },
      }),
      new RenderText('Due date', { role: 'secondary' }),
      new RenderDatePicker({
        value: draft.dueAt,
        placeholder: 'Choose a due date',
        clearable: true,
        onChange: value => { draft.dueAt = value; error.text = '' },
      }),
      error,
    ], 8)
    const buttons = new RenderWrapPanel({ spacing: 8, runSpacing: 8 })
    buttons.addChild(new RenderButton({
      label: isNew ? 'Create task' : 'Save changes',
      variant: 'primary',
      onClick: () => {
        const title = draft.title.trim()
        const parsedDue = new Date(`${draft.dueAt}T12:00:00`)
        if (!title) { error.text = 'Enter a task title.'; return }
        if (!Number.isFinite(parsedDue.getTime()) || dateKey(parsedDue) !== draft.dueAt) {
          error.text = 'Choose a valid due date.'
          return
        }
        if (!projects.some(project => project.id === draft.projectId) || !owners.some(owner => owner.id === draft.ownerId)) {
          error.text = 'Choose a project and owner.'
          return
        }
        let message: string
        if (task) {
          const visible = store.updateTask(task.id, { ...draft, title })
          message = visible ? `${task.id} updated.` : `${task.id} updated and hidden by the current filters.`
        } else {
          const created = store.createTask({ ...draft, title })
          message = `${created.id} created and selected.`
        }
        activeDrawer?.hide()
        getHost()?.uiServices.notify({ type: 'success', title: isNew ? 'Task created' : 'Changes saved', message })
      },
    }))
    buttons.addChild(new RenderButton({ label: 'Cancel', onClick: () => activeDrawer?.hide() }))
    const body = column([
      new RenderParagraph(isNew ? 'Create a task in this sample workspace.' : `Update ${task.id}. Changes stay in this browser session.`),
      fields,
      buttons,
    ], 18)
    body.padding = 20
    const drawer = new RenderDrawer({
      title: isNew ? 'New task' : `Task ${task.id}`,
      side: 'right',
      width: 430,
      child: new RenderScrollViewer({ direction: 'vertical', child: body }),
      onOpenChange: open => {
        if (!open && activeDrawer === drawer) {
          activeDrawer = undefined
          queueMicrotask(() => drawer.dispose())
        }
      },
    })
    activeDrawer = drawer
    drawer.show()
  }

  const grid = new RenderDataGrid<TaskRow>({
    rowKey: 'id',
    columns: [
      { key: 'id', title: 'ID', type: 'text', width: 96, sortable: true },
      { key: 'title', title: 'Task', type: 'text', width: 290, sortable: true },
      { key: 'project', title: 'Project', type: 'text', width: 170, sortable: true },
      { key: 'owner', title: 'Owner', type: 'text', width: 150, sortable: true },
      { key: 'status', title: 'Status', type: 'text', width: 120, sortable: true },
      { key: 'due', title: 'Due', type: 'text', width: 110, sortable: true },
    ],
    rows: [],
    selectionMode: 'row',
    sortable: true,
    height: 318,
    onSelectionChange: event => {
      const row = event.selectedRow
      if (!row || disposed || activeDrawer?.visible) return
      store.select(row.id)
      const task = store.tasks.find(item => item.id === row.id)
      if (task) openDrawer(task)
    },
  })

  const projectFilter = new RenderComboBox({
    options: [{ value: 'all', label: 'All projects' }, ...projects.map(project => ({ value: project.id, label: project.name }))],
    value: store.filters.projectId,
    onChange: value => store.setFilters({ projectId: value }),
  })
  const statusFilter = new RenderComboBox({
    options: [{ value: 'all', label: 'All statuses' }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))],
    value: store.filters.status,
    onChange: value => store.setFilters({ status: value as TaskStatus | 'all' }),
  })
  const periodFilter = new RenderSegmentedControl({
    options: [{ value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }, { value: 'all', label: 'All' }],
    value: store.filters.period,
    onChange: value => store.setFilters({ period: value as 'week' | 'month' | 'all' }),
  })
  const search = new RenderTextBox({
    placeholder: 'Search tasks or people',
    value: store.filters.query,
    onChange: value => store.setFilters({ query: value }),
  })

  function metric(title: string, text: RenderText, detail: string): RenderCard {
    return new RenderCard({ title, description: detail, child: text })
  }
  const metrics = new RenderAdaptiveGridPanel({ minColumnWidth: 170, maxColumns: 4, columnGap: 12, rowGap: 12 })
  metrics.addChild(metric('Total tasks', totalText, 'In the current view'))
  metrics.addChild(metric('Completed', doneText, 'Shipped work'))
  metrics.addChild(metric('Completion', rateText, 'Share of visible work'))
  metrics.addChild(metric('Overdue', overdueText, 'Open past due date'))

  const filters = new RenderAdaptiveGridPanel({ minColumnWidth: 220, maxColumns: 4, columnGap: 12, rowGap: 12 })
  filters.addChild(column([new RenderText('Project', { role: 'secondary' }), projectFilter], 5))
  filters.addChild(column([new RenderText('Time range', { role: 'secondary' }), periodFilter], 5))
  filters.addChild(column([new RenderText('Status', { role: 'secondary' }), statusFilter], 5))
  filters.addChild(column([new RenderText('Find a task', { role: 'secondary' }), search], 5))

  const actions = new RenderWrapPanel({ spacing: 8, runSpacing: 8 })
  actions.addChild(new RenderButton({ label: '+ New task', variant: 'primary', onClick: () => openDrawer() }))
  const content = column([
    new RenderCard({
      title: 'Delivery command center',
      description: 'Track work across three projects.',
      child: column([new RenderText('PROJECT PULSE  /  LIVE', { role: 'accent', weight: 'bold' }), actions], 14),
      style: { padding: 22 },
    }),
    filters,
    metrics,
    new RenderCard({ title: 'Delivery trend', description: 'Tasks due in the selected period', child: chart }),
    new RenderCard({ title: 'Task queue', description: 'Select a row to view and edit its details', child: column([resultText, grid], 10) }),
  ], 16)
  content.padding = 20

  const sidebar = column([
    new RenderText('WORKSPACE', { role: 'secondary', weight: 'bold' }),
    sidebarSelection,
    new RenderText('PROJECTS', { role: 'secondary', weight: 'bold' }),
    new RenderButton({ label: 'All projects', onClick: () => store.setFilters({ projectId: 'all' }) }),
    ...projects.map(project => new RenderButton({ label: project.name, onClick: () => store.setFilters({ projectId: project.id }) })),
    new RenderBadge({ value: 'Sample data', status: 'primary' }),
  ], 14)
  sidebar.padding = 16
  const compact = column([
    new RenderText('DS', { role: 'accent', weight: 'bold' }),
    new RenderButton({ label: 'All', onClick: () => store.setFilters({ projectId: 'all' }) }),
    ...projects.map(project => new RenderButton({ label: project.name.slice(0, 1), onClick: () => store.setFilters({ projectId: project.id }) })),
  ], 8)
  compact.padding = 5
  const root = new RenderAdaptiveSidebarPanel({
    sidebar,
    collapsedSidebar: compact,
    content,
    sidebarWidth: 192,
    collapsedSidebarWidth: 54,
    breakpoint: 850,
    gap: 0,
  })

  const refresh = (): void => {
    if (disposed) return
    const dashboard = store.dashboard
    totalText.text = String(dashboard.total)
    doneText.text = String(dashboard.done)
    rateText.text = `${dashboard.completionRate}%`
    overdueText.text = String(dashboard.overdue)
    resultText.text = `${dashboard.total} matching tasks  ·  ${store.selectedId ? `Selected ${store.selectedId}` : 'Select a row to open details'}`
    sidebarSelection.text = projects.find(project => project.id === store.filters.projectId)?.name ?? 'All projects'
    projectFilter.value = store.filters.projectId
    statusFilter.value = store.filters.status
    periodFilter.value = store.filters.period
    grid.rows = dashboard.tasks.map(taskRow)
    chart.setSeries([
      { name: 'Total', data: dashboard.categories.map((x, index) => ({ x, y: dashboard.totalTrend[index] ?? 0 })) },
      { name: 'Completed', data: dashboard.categories.map((x, index) => ({ x, y: dashboard.doneTrend[index] ?? 0 })) },
    ])
  }
  const unsubscribe = store.subscribe(refresh)
  refresh()
  return {
    root,
    dispose: () => { disposed = true; unsubscribe(); closeDrawer() },
  }
}
