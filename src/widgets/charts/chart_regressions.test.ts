import { describe, expect, it, vi } from 'vitest'
import { TextMeasurer } from '../../core/text_measurer'
import { ImGuiDarkTheme } from '../../theme/default_theme'
import { createTheme } from '../../theme/theme'
import { clampChartDomain, formatChartNumber, niceTicks, niceTimeTicks } from './chart_scale'
import { RenderLineChart } from './line_chart'
import { RenderBarChart } from './bar_chart'
import { RenderDonutChart } from './donut_chart'
import { RenderSparkline } from './sparkline'
import { RenderChartRangeSlider } from './range_slider'
import { layoutChartTooltip } from './chart_tooltip'
import { fitHorizontalChartLabels, layoutCartesianChart, measureChartText } from './chart_text_layout'

const bounds = { minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 220 }
const hover = (chart: RenderLineChart, x: number, y: number) => {
  chart.onPointerMove({ pointerId: 1, type: 'move', position: { x, y } })
  return chart.debugState().crosshair!
}

describe('chart scale regression contracts', () => {
  it.each([[1e16, 1e16 + 2], [0, 1e-7], [-1e-7, 1e-7], [1e-100, 5e-100], [0, 5e-200]])(
    'generates finite, distinct, bounded ticks for %s..%s', (min, max) => {
      const ticks = niceTicks(min!, max!, 4)
      expect(ticks.length).toBeGreaterThan(0)
      expect(ticks.length).toBeLessThanOrEqual(1000)
      for (let i = 0; i < ticks.length; i += 1) {
        expect(Number.isFinite(ticks[i])).toBe(true)
        expect(ticks[i]!).toBeGreaterThanOrEqual(min!)
        expect(ticks[i]!).toBeLessThanOrEqual(max!)
        if (i > 0) expect(ticks[i]!).toBeGreaterThan(ticks[i - 1]!)
      }
      expect(ticks.some(value => value !== 0)).toBe(true)
    },
  )

  it('completes component layout for a large baseline and narrow interval', () => {
    const chart = new RenderLineChart({ series: [{ name: 'A', data: [{ x: 0, y: 1e16 }, { x: 1, y: 1e16 + 2 }] }] })
    chart.layout(bounds)
    expect(chart.debugState().points).toHaveLength(2)
    expect(chart.debugState().yTicks.length).toBeLessThan(10)
  })

  it('bounds tick work and rejects non-finite counts', () => {
    expect(niceTicks(0, 1, Infinity)).toEqual([])
    expect(niceTicks(0, 1, NaN)).toEqual([])
    expect(niceTicks(0, 1, 1e12).length).toBeLessThanOrEqual(1000)
  })

  it('keeps decimal-boundary ticks and distributes a capped count across the whole domain', () => {
    expect(niceTicks(0.28, 0.38, 5)).toEqual([0.28, 0.3, 0.32, 0.34, 0.36, 0.38])
    const ticks = niceTicks(0, 1.4, 1e12)
    expect(ticks.length).toBeLessThanOrEqual(1000)
    expect(ticks[0]).toBe(0)
    expect(ticks.at(-1)).toBe(1.4)
  })

  it('keeps small non-zero values readable by default', () => {
    expect([0.001, 0.002, 0.004, 0.01].map(formatChartNumber)).toEqual(['0.001', '0.002', '0.004', '0.01'])
  })

  it('respects sub-unit min/max spans and ignores invalid span options', () => {
    expect(clampChartDomain({ min: .2, max: .3 }, { min: 0, max: 1 }, { minSpan: .01 })).toEqual({ min: .2, max: .3 })
    const capped = clampChartDomain({ min: .2, max: .8 }, { min: 0, max: 1 }, { maxSpan: .2 })
    expect(capped.max - capped.min).toBeCloseTo(.2)
    expect(clampChartDomain({ min: .2, max: .3 }, { min: 0, max: 1 }, { minSpan: NaN, maxSpan: Infinity })).toEqual({ min: .2, max: .3 })
  })

  it.each([500, 1000, 2000, 10000, 49000, 90000])('keeps time ticks inside a %s ms interval with distinct labels', span => {
    const min = new Date(2026, 0, 1, 8, 0, 10).getTime()
    const ticks = niceTimeTicks(min, min + span, 4)
    expect(ticks.length).toBeGreaterThan(1)
    expect(new Set(ticks.map(tick => tick.label)).size).toBe(ticks.length)
    for (const tick of ticks) {
      expect(tick.value).toBeGreaterThanOrEqual(min)
      expect(tick.value).toBeLessThanOrEqual(min + span)
    }
  })

  it('keeps linked line/range viewports synchronized below the former absolute epsilon', () => {
    const series = [{ name: 'A', data: [{ x: 0, y: 0 }, { x: 1e-6, y: 1 }] }]
    const chart = new RenderLineChart({ series, xViewport: { min: 2e-7, max: 4e-7 } })
    const slider = new RenderChartRangeSlider({ series, viewport: chart.getXViewport() })
    chart.onViewportChange = event => slider.setViewport(event.viewport)
    slider.onViewportChange = event => chart.setXViewport(event.viewport)
    chart.layout(bounds)
    slider.layout(bounds)
    slider.setViewport({ min: 3e-7, max: 5e-7 })
    expect(chart.getXViewport()).toEqual(slider.getViewport())
    expect(chart.getXViewport().min).toBe(3e-7)
  })
})

describe('raw-data axis hover', () => {
  it.each(['none', 'minMax'] as const)('aggregates exact x across dense series with %s sampling', decimation => {
    const series = ['A', 'B'].map((name, i) => ({ name,
      data: Array.from({ length: 10000 }, (_, x) => ({ x, y: i ? 30 - x % 31 : x % 31 })),
    }))
    const chart = new RenderLineChart({ series, decimation, showLegend: false })
    chart.layout(bounds)
    const plot = chart.debugState().plot
    const axis = hover(chart, plot.x, plot.y + plot.height / 2)
    expect(axis.points.map(point => [point.seriesName, point.pointIndex, point.value])).toEqual([['A', 0, 0], ['B', 0, 30]])
    if (decimation === 'minMax') expect(chart.debugState().points.length).toBeLessThan(20000)
    chart.setXViewport({ min: 500, max: 1000 })
    chart.layout(bounds)
    const next = hover(chart, chart.debugState().plot.x, chart.debugState().plot.y + 10)
    expect(next.points.map(point => point.pointIndex)).toEqual([500, 500])
    chart.setVisibleSeries([1])
    chart.layout(bounds)
    expect(hover(chart, chart.debugState().plot.x, chart.debugState().plot.y + 10).points.map(p => p.seriesName)).toEqual(['B'])
  })

  it('preserves repeated observations and missing values without borrowing nearby x', () => {
    const chart = new RenderLineChart({ series: [
      { name: 'A', data: [{ x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: null }] },
      { name: 'B', data: [{ x: 0, y: 3 }, { x: .001, y: 4 }, { x: 1, y: 5 }] },
    ] })
    chart.layout(bounds)
    const { plot } = chart.debugState()
    expect(hover(chart, plot.x, plot.y + plot.height / 2).points.map(point => point.value)).toEqual([1, 2, 3])
    expect(hover(chart, plot.x + plot.width, plot.y + plot.height / 2).points.map(point => point.value)).toEqual([5])
  })

  it('keeps duplicate stack occurrences and their totals paired', () => {
    const chart = new RenderLineChart({ stackMode: 'stacked', series: [
      { name: 'A', data: [{ x: 0, y: 10 }, { x: 0, y: 40 }, { x: 1, y: 10 }] },
      { name: 'B', data: [{ x: 0, y: 20 }, { x: 0, y: 50 }, { x: 1, y: 20 }] },
    ] })
    chart.layout(bounds)
    const point = chart.debugState().points.find(point => point.seriesIndex === 1 && point.pointIndex === 1)!
    const axis = hover(chart, point.x, point.y)
    expect(axis.points.map(point => point.value)).toEqual([40, 50])
    expect(axis.points.every(point => point.stackTotal === 90)).toBe(true)
    expect(chart.debugState().tooltip!.items.at(-1)!.value).toBe('90')
  })

  it('reports raw values and stack totals after dense percent-stack sampling', () => {
    const series = ['A', 'B'].map((name, i) => ({ name,
      data: Array.from({ length: 2000 }, (_, x) => ({ x, y: i ? 100 - x % 31 : x % 31 })),
    }))
    const chart = new RenderLineChart({ series, stackMode: 'percent', area: true })
    chart.layout(bounds)
    const { plot } = chart.debugState()
    const points = hover(chart, plot.x, plot.y + plot.height / 2).points
    expect(points.map(point => point.value)).toEqual([0, 100])
    expect(points.every(point => point.stackTotal === 100)).toBe(true)
  })
})

describe('measured chart text layout', () => {
  it('wraps four legends within a narrow chart and retains aligned bars/annotations', () => {
    const names = Array.from({ length: 4 }, (_, i) => `序列名称较长${i}`)
    const frame = layoutCartesianChart(280, 220, ImGuiDarkTheme, ['100人次'], names)
    expect(frame.legend).toHaveLength(4)
    expect(new Set(frame.legend.map(item => item.y)).size).toBeGreaterThan(1)
    for (const item of frame.legend) {
      expect(item.x + item.width).toBeLessThanOrEqual(280)
      expect(item.y + item.height).toBeLessThanOrEqual(frame.plot.y)
    }
    for (const orientation of ['vertical', 'horizontal'] as const) {
      const chart = new RenderBarChart({ categories: ['甲', '乙'], orientation,
        series: names.map(name => ({ name, data: [10, 20] })),
        annotations: [{ type: 'line', axis: 'value', value: 15 }],
      })
      chart.layout({ ...bounds, maxWidth: 280 })
      const state = chart.debugState()
      expect(orientation === 'horizontal' ? state.annotations[0]!.height : state.annotations[0]!.width)
        .toBe(orientation === 'horizontal' ? state.plot.height : state.plot.width)
      for (const bar of state.bars) {
        expect(bar.x).toBeGreaterThanOrEqual(state.plot.x)
        expect(bar.y).toBeGreaterThanOrEqual(state.plot.y)
        expect(bar.x + bar.width).toBeLessThanOrEqual(state.plot.x + state.plot.width + 1e-8)
        expect(bar.y + bar.height).toBeLessThanOrEqual(state.plot.y + state.plot.height + 1e-8)
      }
    }
  })

  it('uses font measurement for margins and keeps horizontal labels in separate lanes', () => {
    const spy = vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => Array.from(text).length * 18)
    try {
      const frame = layoutCartesianChart(360, 220, ImGuiDarkTheme, ['100人次'], ['A'])
      expect(frame.plot.x).toBe(102)
      const labels = fitHorizontalChartLabels([{ label: '这是较长的中文标签', x: 46 }, { label: 'Another long label', x: 346 }], 360, ImGuiDarkTheme)
      for (const item of labels) {
        const half = measureChartText(item.label, ImGuiDarkTheme) / 2
        expect(item.x - half).toBeGreaterThanOrEqual(4)
        expect(item.x + half).toBeLessThanOrEqual(356)
      }
    } finally { spy.mockRestore() }
  })

  it('does not replace committed chart geometry or hover during speculative measurement', () => {
    const series = [{ name: 'A', data: [{ x: 0, y: 1 }, { x: 1, y: 2 }] }]
    const charts = [
      new RenderLineChart({ series }),
      new RenderBarChart({ categories: ['A', 'B'], series: [{ name: 'A', data: [1, 2] }] }),
      new RenderDonutChart({ segments: [{ label: 'A', value: 1 }, { label: 'B', value: 2 }] }),
      new RenderChartRangeSlider({ series }),
      new RenderSparkline({ values: [1, 2] }),
    ]
    for (const chart of charts) {
      chart.layout(bounds)
      if (chart instanceof RenderLineChart) {
        const { plot } = chart.debugState()
        hover(chart, plot.x, plot.y + plot.height / 2)
      }
      const before = chart.debugState()
      const measured = chart.measure({ ...bounds, maxWidth: 120, maxHeight: 80 })
      expect(measured.width).toBe(120)
      expect(measured.height).toBeLessThanOrEqual(80)
      expect(chart.debugState()).toEqual(before)
      expect(chart.size.width).toBe(360)
      chart.dispose()
    }
  })

  it('grows tooltip rows with the font and suppresses tooltips that cannot fit', () => {
    const theme = createTheme(ImGuiDarkTheme, { fontSize: 28 })
    const options = { theme, title: '长标题', items: [{ label: '中文标签', value: '123456.789' }], anchorX: 100, anchorY: 100,
      boundsX: 0, boundsY: 0, boundsWidth: 180, boundsHeight: 150 }
    const tooltip = layoutChartTooltip(options)!
    expect(tooltip.height).toBeGreaterThan(54)
    expect(tooltip.x + tooltip.width).toBeLessThanOrEqual(180)
    expect(tooltip.y + tooltip.height).toBeLessThanOrEqual(150)
    expect(layoutChartTooltip({ ...options, boundsWidth: 20 })).toBeNull()
    expect(layoutChartTooltip({ ...options, boundsHeight: 20 })).toBeNull()
  })
})
