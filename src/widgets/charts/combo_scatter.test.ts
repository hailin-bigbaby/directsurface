import { describe, expect, it, vi } from 'vitest'
import { RenderComboChart } from './combo_chart'
import { RenderScatterChart } from './scatter_chart'
import type { ComboChartSeries, ScatterChartSeries } from './chart_types'

const bounds = { minWidth: 0, maxWidth: 420, minHeight: 0, maxHeight: 260 }
const pointer = (type: 'move' | 'down', x: number, y: number) => ({ pointerId: 1, type, position: { x, y } })
const comboSeries = (): ComboChartSeries[] => [
  { id: 'actual', name: '实际', type: 'bar', data: [10, 20, 30] },
  { id: 'target', name: '目标', type: 'line', data: [10, 30, 50] },
]
const scatterSeries = (): ScatterChartSeries[] => [{ id: 'a', name: 'A', data: [{ id: 'p0', x: 10, y: 20 }, { id: 'p1', label: '观测', x: 20, y: 40 }] }]

describe('same-axis combination chart', () => {
  it('centers line values on category bands and uses the same y scale as bars', () => {
    const chart = new RenderComboChart({ categories: ['A', 'B', 'C'], series: comboSeries() })
    chart.layout(bounds)
    const { points, bars, plot, yDomain } = chart.debugState()
    expect(yDomain.min).toBeLessThanOrEqual(0)
    expect(yDomain.max).toBeGreaterThanOrEqual(50)
    expect(points[0]!.x).toBeCloseTo(bars[0]!.x + bars[0]!.width / 2)
    expect(points[0]!.y).toBeCloseTo(bars[0]!.y)
    expect(points[0]!.x).toBeCloseTo(plot.x + plot.width / 6)
    expect(points[2]!.x).toBeCloseTo(plot.x + plot.width * 5 / 6)
  })

  it('centers grouped bars around line markers including a single category', () => {
    const chart = new RenderComboChart({ categories: ['Only'], series: [
      { name: 'A', type: 'bar', data: [10] }, { name: 'B', type: 'bar', data: [20] }, { name: 'L', type: 'line', data: [15] },
    ], maxBarThickness: 12 })
    chart.layout(bounds)
    const { points, bars, plot } = chart.debugState()
    expect(points[0]!.x).toBeCloseTo(plot.x + plot.width / 2)
    expect(points[0]!.x).toBeCloseTo((bars[0]!.x + bars[1]!.x + bars[1]!.width) / 2)
    expect(bars.every(bar => bar.width <= 12)).toBe(true)
  })

  it('keeps missing line gaps and excludes missing/trailing data from the domain', () => {
    const chart = new RenderComboChart({ categories: ['A', 'B', 'C'], series: [
      { name: 'L', type: 'line', data: [10, null, 20, 999999] },
      { name: 'B', type: 'bar', data: [NaN, Infinity] },
    ] })
    chart.layout(bounds)
    const state = chart.debugState()
    expect(state.points.map(point => point.pointIndex)).toEqual([0, 2])
    expect(state.points.every(point => point.breakBefore)).toBe(true)
    expect(state.bars).toEqual([])
    expect(state.yDomain.max).toBeLessThan(30)
  })

  it('aggregates both types by category without activating on whitespace', () => {
    const click = vi.fn()
    const chart = new RenderComboChart({ categories: ['A', 'B', 'C'], series: comboSeries(), onItemClick: click })
    chart.layout(bounds)
    const { plot } = chart.debugState()
    const x = plot.x + plot.width / 2
    chart.onPointerMove(pointer('move', x, plot.y + 1))
    expect(chart.debugState().tooltip!.items.map(item => item.value)).toEqual(['20', '30'])
    chart.onPointerDown(pointer('down', x, plot.y + 1))
    expect(click).not.toHaveBeenCalled()
    const line = chart.debugState().points[1]!
    chart.onPointerDown(pointer('down', line.x, line.y))
    expect(click).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'line', value: 30, categoryIndex: 1 }))
    const bar = chart.debugState().bars[1]!
    chart.onPointerDown(pointer('down', bar.x + bar.width / 2, bar.y + bar.height / 2))
    expect(click).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'bar', value: 20, categoryIndex: 1 }))
  })

  it('uses direct item hits in item tooltip mode and clears hover when data changes', () => {
    const chart = new RenderComboChart({ categories: ['A', 'B', 'C'], series: comboSeries(), tooltipMode: 'item' })
    chart.layout(bounds)
    const { plot, points } = chart.debugState()
    chart.onPointerMove(pointer('move', plot.x, plot.y))
    expect(chart.debugState().tooltip).toBeNull()
    chart.onPointerMove(pointer('move', points[1]!.x, points[1]!.y))
    expect(chart.debugState().tooltip!.items).toHaveLength(1)
    chart.setData([], [])
    chart.layout(bounds)
    expect(chart.debugState().state.state).toBe('empty')
    expect(chart.debugState().tooltip).toBeNull()
  })

  it('clones inputs, preserves hidden IDs on reordering and recomputes the shared domain', () => {
    const data = comboSeries()
    const categories = ['A', 'B', 'C']
    const chart = new RenderComboChart({ categories, series: data })
    data[0]!.data[0] = 9000
    categories[0] = 'changed'
    chart.layout(bounds)
    expect(chart.debugState().bars[0]!.value).toBe(10)
    expect(chart.debugState().bars[0]!.category).toBe('A')
    chart.setVisibleSeries([0])
    chart.layout(bounds)
    expect(chart.debugState().points).toHaveLength(0)
    expect(chart.debugState().yDomain.max).toBeLessThan(40)
    const next = comboSeries().reverse()
    chart.setData(['A', 'B', 'C'], next)
    chart.layout(bounds)
    expect(chart.getVisibleSeries()).toEqual([1])
    expect(chart.debugState().bars).toHaveLength(3)
  })

  it('clips negative and positive bars to a forced domain without clickable zero bars', () => {
    const chart = new RenderComboChart({ categories: ['A', 'B', 'C'], series: [{ name: 'B', type: 'bar', data: [-50, 0, 50] }], yAxis: { min: -10, max: 10 } })
    chart.layout(bounds)
    const { bars, plot } = chart.debugState()
    expect(bars[0]!.height).toBeCloseTo(plot.height / 2)
    expect(bars[1]!.height).toBe(0)
    expect(bars[2]!.height).toBeCloseTo(plot.height / 2)
    expect(bars[0]!.y + bars[0]!.height).toBeCloseTo(plot.y + plot.height)
    expect(bars[2]!.y).toBeCloseTo(plot.y)
  })

  it('applies category and shared value formatters to tooltips', () => {
    const chart = new RenderComboChart({ categories: ['A'], series: [{ name: 'B', type: 'bar', data: [10] }],
      xAxis: { labelFormatter: (_value, context) => `分类:${context.label}` }, yAxis: { unit: '项' } })
    chart.layout(bounds)
    const { plot } = chart.debugState()
    chart.onPointerMove(pointer('move', plot.x + plot.width / 2, plot.y + 1))
    expect(chart.debugState().tooltip).toMatchObject({ title: '分类:A', items: [{ value: '10项' }] })
  })
})

describe('numeric scatter chart', () => {
  it('keeps duplicate observations and invalid-point source indexes without line sampling', () => {
    const chart = new RenderScatterChart({ series: [{ name: 'A', data: [
      { x: 10, y: NaN }, { x: 10, y: 20 }, { x: Infinity, y: 30 }, { x: 10, y: 40 }, { x: 10, y: 40 },
    ] }] })
    chart.layout(bounds)
    const { points } = chart.debugState()
    expect(points.map(point => point.pointIndex)).toEqual([1, 3, 4])
    expect(points[0]!.x).toBe(points[1]!.x)
    expect(points[0]!.y).not.toBe(points[1]!.y)
    chart.setSeries([{ name: 'A', data: Array.from({ length: 10000 }, (_, i) => ({ x: i % 100, y: Math.floor(i / 100) })) }])
    chart.layout(bounds)
    expect(chart.debugState().points).toHaveLength(10000)
  })

  it('uses nearest point distance and selects the topmost duplicate without prior hover', () => {
    const click = vi.fn()
    const chart = new RenderScatterChart({ series: [{ name: 'A', data: [{ id: 'under', x: 1, y: 2 }, { id: 'top', x: 1, y: 2 }] }], onPointClick: click })
    chart.layout(bounds)
    const { points, plot } = chart.debugState()
    chart.onPointerDown(pointer('down', points[0]!.x, points[0]!.y))
    expect(click).toHaveBeenCalledWith(expect.objectContaining({ id: 'top', xValue: 1, yValue: 2, pointIndex: 1 }))
    chart.onPointerMove(pointer('move', plot.x, plot.y))
    expect(chart.debugState().hover).toBeNull()
  })

  it('preserves scatter visibility by identity and clears stale hover after replacement', () => {
    const chart = new RenderScatterChart({ series: [...scatterSeries(), { id: 'b', name: 'B', data: [{ x: 100, y: 200 }] }] })
    chart.setVisibleSeries([0])
    chart.layout(bounds)
    const point = chart.debugState().points[0]!
    chart.onPointerMove(pointer('move', point.x, point.y))
    expect(chart.debugState().hover).not.toBeNull()
    chart.setSeries([{ id: 'b', name: 'renamed B', data: [{ x: 100, y: 200 }] }, ...scatterSeries()])
    chart.layout(bounds)
    expect(chart.getVisibleSeries()).toEqual([1])
    expect(chart.debugState().hover).toBeNull()
    expect(chart.debugState().xDomain.max).toBeLessThan(30)
  })

  it('formats both coordinates and keeps callback data isolated from internal state', () => {
    const chart = new RenderScatterChart({ series: scatterSeries(), xAxis: { unit: 'KB' }, yAxis: { unit: 'ms' },
      onPointClick: point => { point.xValue = 999; point.label = 'mutated' } })
    chart.layout(bounds)
    const point = chart.debugState().points[1]!
    chart.onPointerMove(pointer('move', point.x, point.y))
    expect(chart.debugState().tooltip).toMatchObject({ title: '观测', items: [{ value: '20KB' }, { value: '40ms' }] })
    chart.onPointerDown(pointer('down', point.x, point.y))
    expect(chart.debugState().points[1]!.xValue).toBe(20)
    expect(chart.debugState().points[1]!.label).toBe('观测')
  })

  it('clones points and respects explicit domains and translated input coordinates', () => {
    const data = scatterSeries()
    const click = vi.fn()
    const chart = new RenderScatterChart({ series: data, xAxis: { min: 15, max: 25 }, yAxis: { min: 30, max: 50 }, onPointClick: click })
    data[0]!.data[1]!.x = 999
    chart.offset = { x: 100, y: 200 }
    chart.layout(bounds)
    expect(chart.debugState().points).toHaveLength(1)
    const point = chart.debugState().points[0]!
    chart.onPointerDown(pointer('down', point.x + 100, point.y + 200))
    expect(click).toHaveBeenCalledWith(expect.objectContaining({ pointIndex: 1, xValue: 20 }))
  })
})

for (const [name, create] of [
  ['combo', () => new RenderComboChart({ categories: ['A', 'B', 'C'], series: comboSeries(), legendMode: 'toggle' })],
  ['scatter', () => new RenderScatterChart({ series: scatterSeries(), legendMode: 'toggle' })],
] as const) {
  describe(`${name} shared contracts`, () => {
    it('toggles a measured legend, supports all-hidden empty state and restores it', () => {
      const chart = create()
      const notify = vi.fn()
      chart.onSeriesVisibilityChange = notify
      chart.layout(bounds)
      const item = chart.debugState().legend[0]!
      chart.onPointerDown(pointer('down', item.x + 2, item.y + item.height / 2))
      expect(chart.isSeriesVisible(0)).toBe(false)
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ reason: 'legendToggle', seriesIndex: 0 }))
      chart.setVisibleSeries([])
      chart.layout(bounds)
      expect(chart.debugState().state.state).toBe('empty')
      chart.onPointerDown(pointer('down', item.x + 2, item.y + item.height / 2))
      chart.layout(bounds)
      expect(chart.getVisibleSeries()).toEqual([0])
      expect(chart.debugState().state.state).toBe('ready')
    })

    it.each(['loading', 'empty', 'error'] as const)('suppresses data interaction while %s', state => {
      const chart = create()
      const click = vi.fn()
      if (chart instanceof RenderComboChart) chart.onItemClick = click
      else chart.onPointClick = click
      chart.layout(bounds)
      const point = chart.debugState().points[0]!
      chart.dataState = state
      chart.onPointerMove(pointer('move', point.x, point.y))
      chart.onPointerDown(pointer('down', point.x, point.y))
      expect(chart.debugState().tooltip).toBeNull()
      expect(click).not.toHaveBeenCalled()
    })

    it('keeps committed layout through measurement and releases callbacks on disposal', () => {
      const chart = create()
      chart.layout(bounds)
      const before = chart.debugState()
      expect(chart.measure({ ...bounds, maxWidth: 100, maxHeight: 80 }).width).toBe(100)
      expect(chart.debugState()).toEqual(before)
      chart.dispose()
      expect(chart.onSeriesVisibilityChange).toBeUndefined()
      if (chart instanceof RenderComboChart) expect(chart.onItemClick).toBeUndefined()
      else expect(chart.onPointClick).toBeUndefined()
    })
  })
}
