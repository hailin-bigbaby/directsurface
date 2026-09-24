export type TaskStatus = 'todo' | 'progress' | 'done'
export type Period = 'week' | 'month' | 'all'

export interface Task {
  id: string
  projectId: string
  title: string
  ownerId: string
  status: TaskStatus
  dueAt: string
}

export interface Filters {
  projectId: string
  status: TaskStatus | 'all'
  period: Period
  query: string
}

export interface Dashboard {
  tasks: Task[]
  total: number
  done: number
  completionRate: number
  overdue: number
  categories: string[]
  totalTrend: number[]
  doneTrend: number[]
}

export const projects = [
  { id: 'atlas', name: 'Atlas Platform' },
  { id: 'northstar', name: 'Northstar App' },
  { id: 'orbit', name: 'Orbit Studio' },
] as const

export const owners = [
  { id: 'alex', name: 'Alex Morgan' },
  { id: 'sam', name: 'Sam Rivera' },
  { id: 'jordan', name: 'Jordan Lee' },
  { id: 'taylor', name: 'Taylor Chen' },
] as const

export const statusLabels: Record<TaskStatus, string> = {
  todo: 'To do',
  progress: 'In progress',
  done: 'Done',
}

function localDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year!, month! - 1, day!, 12)
}

export function dateKey(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}

export function shiftDate(date: Date, days: number): string {
  const shifted = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12)
  return dateKey(shifted)
}

function sameWeek(iso: string, today: Date): boolean {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7), 12)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7, 12)
  const value = localDate(iso)
  return value >= start && value < end
}

function inPeriod(iso: string, period: Period, today: Date): boolean {
  if (period === 'all') return true
  if (period === 'week') return sameWeek(iso, today)
  const value = localDate(iso)
  return value.getFullYear() === today.getFullYear() && value.getMonth() === today.getMonth()
}

function trendKeys(period: Period, today: Date, tasks: Task[]): Array<{ key: string; label: string }> {
  if (period === 'week') {
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7), 12)
    return Array.from({ length: 7 }, (_, i) => ({ key: shiftDate(monday, i), label: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i]! }))
  }
  if (period === 'month') {
    const count = Math.ceil(new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() / 7)
    return Array.from({ length: count }, (_, i) => ({ key: String(i), label: `Week ${i + 1}` }))
  }
  const months = [...new Set(tasks.map(task => task.dueAt.slice(0, 7)))].sort()
  return (months.length ? months : [dateKey(today).slice(0, 7)]).map(key => ({ key, label: key }))
}

function trendKey(iso: string, period: Period): string {
  if (period === 'week') return iso
  if (period === 'month') return String(Math.floor((Number(iso.slice(8, 10)) - 1) / 7))
  return iso.slice(0, 7)
}

export function deriveDashboard(tasks: Task[], filters: Filters, today: Date): Dashboard {
  const query = filters.query.trim().toLowerCase()
  const visible = tasks.filter(task =>
    (filters.projectId === 'all' || task.projectId === filters.projectId) &&
    (filters.status === 'all' || task.status === filters.status) &&
    inPeriod(task.dueAt, filters.period, today) &&
    (!query || `${task.title} ${task.id} ${owners.find(owner => owner.id === task.ownerId)?.name ?? ''}`.toLowerCase().includes(query)),
  )
  const keys = trendKeys(filters.period, today, visible)
  const totalTrend = keys.map(({ key }) => visible.filter(task => trendKey(task.dueAt, filters.period) === key).length)
  const doneTrend = keys.map(({ key }) => visible.filter(task => trendKey(task.dueAt, filters.period) === key && task.status === 'done').length)
  const done = visible.filter(task => task.status === 'done').length
  return {
    tasks: visible,
    total: visible.length,
    done,
    completionRate: visible.length ? Math.round(done / visible.length * 100) : 0,
    overdue: visible.filter(task => task.status !== 'done' && task.dueAt < dateKey(today)).length,
    categories: keys.map(item => item.label),
    totalTrend,
    doneTrend,
  }
}

const seed: Array<Omit<Task, 'dueAt'> & { offset: number }> = [
  { id: 'DS-101', projectId: 'atlas', title: 'Refresh navigation system', ownerId: 'alex', status: 'progress', offset: -8 },
  { id: 'DS-102', projectId: 'atlas', title: 'Ship design tokens', ownerId: 'sam', status: 'done', offset: -5 },
  { id: 'DS-103', projectId: 'atlas', title: 'Review API contracts', ownerId: 'jordan', status: 'todo', offset: -2 },
  { id: 'DS-104', projectId: 'atlas', title: 'Polish dashboard charts', ownerId: 'taylor', status: 'progress', offset: 0 },
  { id: 'DS-105', projectId: 'atlas', title: 'Document keyboard actions', ownerId: 'alex', status: 'todo', offset: 3 },
  { id: 'DS-106', projectId: 'northstar', title: 'Improve onboarding flow', ownerId: 'sam', status: 'done', offset: -6 },
  { id: 'DS-107', projectId: 'northstar', title: 'Test search experience', ownerId: 'jordan', status: 'progress', offset: -1 },
  { id: 'DS-108', projectId: 'northstar', title: 'Release settings panel', ownerId: 'taylor', status: 'todo', offset: 2 },
  { id: 'DS-109', projectId: 'northstar', title: 'Refine activity feed', ownerId: 'alex', status: 'done', offset: 5 },
  { id: 'DS-110', projectId: 'orbit', title: 'Build template browser', ownerId: 'jordan', status: 'progress', offset: -4 },
  { id: 'DS-111', projectId: 'orbit', title: 'Update visual language', ownerId: 'taylor', status: 'done', offset: 1 },
  { id: 'DS-112', projectId: 'orbit', title: 'Prepare release notes', ownerId: 'sam', status: 'todo', offset: 7 },
]

export function createSeedTasks(today: Date): Task[] {
  return seed.map(({ offset, ...task }) => ({ ...task, dueAt: shiftDate(today, offset) }))
}

export class WorkbenchStore {
  readonly today: Date
  readonly tasks: Task[]
  filters: Filters = { projectId: 'all', status: 'all', period: 'month', query: '' }
  selectedId: string | null = null
  private listeners = new Set<() => void>()

  constructor(today = new Date(), tasks = createSeedTasks(today)) {
    this.today = today
    this.tasks = tasks.map(task => ({ ...task }))
  }

  get dashboard(): Dashboard { return deriveDashboard(this.tasks, this.filters, this.today) }
  get selectedTask(): Task | undefined { return this.tasks.find(task => task.id === this.selectedId) }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private emit(): void { for (const listener of this.listeners) listener() }

  setFilters(patch: Partial<Filters>): void { this.filters = { ...this.filters, ...patch }; this.emit() }
  select(id: string | null): void { this.selectedId = id; this.emit() }

  updateTask(id: string, patch: Pick<Task, 'title' | 'projectId' | 'ownerId' | 'status' | 'dueAt'>): boolean {
    const task = this.tasks.find(item => item.id === id)
    if (!task) throw new Error(`Unknown task: ${id}`)
    Object.assign(task, patch)
    const visible = this.dashboard.tasks.some(item => item.id === id)
    if (!visible && this.selectedId === id) this.selectedId = null
    this.emit()
    return visible
  }

  createTask(draft: Pick<Task, 'title' | 'projectId' | 'ownerId' | 'status' | 'dueAt'>): Task {
    const nextNumber = Math.max(100, ...this.tasks.map(task => Number(task.id.slice(3)) || 0)) + 1
    const task = { id: `DS-${nextNumber}`, ...draft }
    this.tasks.push(task)
    this.filters = { ...this.filters, projectId: task.projectId, status: 'all', query: '' }
    this.selectedId = task.id
    this.emit()
    return task
  }
}
