import { describe, expect, it } from 'vitest'
import { WorkbenchStore, createSeedTasks, dateKey, deriveDashboard, projects, shiftDate } from './workbench_model'

const today = new Date(2026, 8, 24, 12)

describe('project delivery workbench state', () => {
  it('derives metrics and trend from the same filtered task set', () => {
    const tasks = createSeedTasks(today)
    const result = deriveDashboard(tasks, { projectId: 'atlas', status: 'all', period: 'month', query: '' }, today)
    expect(result.total).toBe(result.tasks.length)
    expect(result.totalTrend.reduce((a, b) => a + b, 0)).toBe(result.total)
    expect(result.doneTrend.reduce((a, b) => a + b, 0)).toBe(result.done)
    expect(result.overdue).toBe(result.tasks.filter(task => task.status !== 'done' && task.dueAt < dateKey(today)).length)
    expect(result.tasks.every(task => task.projectId === 'atlas')).toBe(true)
  })

  it('updates the visible set and indicates when an edited task leaves a filter', () => {
    const store = new WorkbenchStore(today)
    store.setFilters({ projectId: 'atlas', status: 'todo', period: 'all' })
    const task = store.dashboard.tasks[0]!
    store.select(task.id)
    expect(store.updateTask(task.id, { ...task, status: 'done' })).toBe(false)
    expect(store.dashboard.tasks.some(item => item.id === task.id)).toBe(false)
    expect(store.selectedId).toBeNull()
  })

  it('keeps a newly created task visible and selected', () => {
    const store = new WorkbenchStore(today)
    store.setFilters({ projectId: 'northstar', status: 'done', query: 'impossible' })
    const task = store.createTask({ title: 'Prepare launch checklist', projectId: projects[0].id, ownerId: 'alex', status: 'todo', dueAt: dateKey(today) })
    expect(store.dashboard.tasks.some(item => item.id === task.id)).toBe(true)
    expect(store.selectedId).toBe(task.id)
    expect(store.filters.status).toBe('all')
  })

  it('returns an empty result without invalid percentages', () => {
    const store = new WorkbenchStore(today)
    store.setFilters({ query: 'no matching task' })
    expect(store.dashboard.total).toBe(0)
    expect(store.dashboard.completionRate).toBe(0)
    expect(store.dashboard.totalTrend.every(value => value === 0)).toBe(true)
  })

  it('generates dates from the injected clock', () => {
    expect(shiftDate(today, 0)).toBe('2026-09-24')
    expect(shiftDate(today, 7)).toBe('2026-10-01')
  })
})
