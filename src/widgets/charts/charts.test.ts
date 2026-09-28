import { describe, expect, it, vi } from 'vitest'
import { GestureArenaManager } from '../../gestures/gesture_arena'
import type { PointerEvent, WheelPointerEvent } from '../../gestures/hit_test'
import { DrawList } from '../../rendering/draw_list'
import { PaintContext } from '../../rendering/paint_context'
import { ImGuiDarkTheme } from '../../theme/default_theme'
import { createTheme, rgba, type ResolvedTheme } from '../../theme/theme'
import { chartColor, chartPalette } from './chart_palette'
import { clampChartDomain, niceTicks, niceTimeTicks, normalizeLinearDomain } from './chart_scale'
import { RenderBarChart } from './bar_chart'
import { RenderChartRangeSlider } from './range_slider'
import { RenderDonutChart } from './donut_chart'
import { RenderLineChart } from './line_chart'
import { RenderSparkline } from './sparkline'
import { paintFramePerformanceTimelineChart, resolveFramePerformanceTimelineChartState } from './performance_timeline_chart'

function createPaintContext(): PaintContext {
  return createRecordingPaintContext().context
}

function createRecordingPaintContext(): {
  context: PaintContext
  arc: ReturnType<typeof vi.fn>
  fillText: ReturnType<typeof vi.fn>
  roundRect: ReturnType<typeof vi.fn>
} {
  const gradient = { addColorStop: vi.fn() } as unknown as CanvasGradient
  const arc = vi.fn()
  const fillText = vi.fn()
  const roundRect = vi.fn()
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc,
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    roundRect,
    fillText,
    measureText: vi.fn(text => ({ width: String(text).length * 7 }) as TextMetrics),
    createLinearGradient: vi.fn(() => gradient),
    getTransform: vi.fn(() => ({ a: 1, d: 1 }) as DOMMatrix),
    setLineDash: vi.fn(),
  } as unknown as CanvasRenderingContext2D
  return { context: new PaintContext(ctx, ImGuiDarkTheme), arc, fillText, roundRect }
}

function pointer(type: PointerEvent['type'], x: number, y: number): PointerEvent {
  return {
    pointerId: 1,
    type,
    position: { x, y },
  }
}

function wheel(x: number, y: number, deltaY: number, modifiers: Partial<WheelPointerEvent> = {}): WheelPointerEvent {
  return {
    pointerId: 1,
    type: 'wheel',
    position: { x, y },
    deltaX: 0,
    deltaY,
    ...modifiers,
  }
}

function key(key: string): KeyboardEvent {
  return { key, preventDefault: vi.fn() } as unknown as KeyboardEvent
}

describe('chart widgets', () => {
  it('uses the complete theme-provided chart palette', () => {
    const series = [rgba(1, 2, 3), rgba(4, 5, 6), rgba(7, 8, 9)]
    const theme = createTheme(ImGuiDarkTheme, { chart: { series } })

    expect(chartPalette(theme)).toEqual(series)
  })

  it('does not silently invent chart colors for an invalid empty palette', () => {
    expect(() => createTheme(ImGuiDarkTheme, {
      chart: { series: [] },
    })).toThrow('chart.series')

    const invalid = {
      ...ImGuiDarkTheme,
      chart: { ...ImGuiDarkTheme.chart, series: [] },
    } as ResolvedTheme
    expect(() => chartPalette(invalid)).toThrow('chart.series')
  })
  it('keeps generated axis ticks inside the chart domain', () => {
    expect(niceTicks(18, 86, 4)).toEqual([20, 40, 60, 80])
    expect(niceTicks(-6, 162, 4)).toEqual([0, 50, 100, 150])
  })

  it('clamps chart viewport domains and formats time ticks', () => {
    expect(clampChartDomain({ min: -10, max: 20 }, { min: 0, max: 100 })).toEqual({ min: 0, max: 30 })
    const ticks = niceTimeTicks(
      new Date(2026, 3, 1, 8).getTime(),
      new Date(2026, 3, 1, 14).getTime(),
      4,
    )

    expect(ticks.length).toBeGreaterThan(0)
    expect(ticks[0]!.label).toMatch(/^\d{2}:\d{2}$/)
  })

  it('lays out and reports sparkline point clicks', () => {
    const onPointClick = vi.fn()
    const chart = new RenderSparkline({
      values: [12, -4, 18],
      variant: 'bar',
      onPointClick,
    })

    chart.layout({ minWidth: 0, maxWidth: 180, minHeight: 0, maxHeight: 80 })
    chart.paint(createPaintContext(), { x: 0, y: 0 })

    const point = chart.debugState().points[1]!
    chart.onPointerMove(pointer('move', point.x, point.y))
    chart.onPointerDown(pointer('down', point.x, point.y))

    expect(chart.debugState().hoverIndex).toBe(1)
    expect(onPointClick).toHaveBeenCalledWith(1, -4)
  })

  it('normalizes sparkline values before layout and interaction', () => {
    const chart = new RenderSparkline({
      values: [12, Number.NaN, Number.POSITIVE_INFINITY],
    })

    chart.layout({ minWidth: 0, maxWidth: 180, minHeight: 0, maxHeight: 80 })

    expect(chart.debugState().values).toEqual([12, 0, 0])
    expect(chart.debugState().points.map(point => point.value)).toEqual([12, 0, 0])
  })

  it('shows sparkline empty state and disables point clicks', () => {
    const onPointClick = vi.fn()
    const chart = new RenderSparkline({
      values: [],
      emptyMessage: '暂无迷你趋势',
      onPointClick,
    })
    chart.layout({ minWidth: 0, maxWidth: 180, minHeight: 0, maxHeight: 80 })

    chart.onPointerMove(pointer('move', 90, 40))
    chart.onPointerDown(pointer('down', 90, 40))
    const painted = createRecordingPaintContext()
    chart.paint(painted.context, { x: 0, y: 0 })

    expect(chart.debugState().state).toEqual({ state: 'empty', message: '暂无迷你趋势' })
    expect(chart.debugState().hoverIndex).toBe(-1)
    expect(onPointClick).not.toHaveBeenCalled()
    expect(painted.fillText.mock.calls.map(call => call[0])).toContain('暂无迷你趋势')
  })

  it('shows sparkline nearest-index crosshair and tooltip', () => {
    const chart = new RenderSparkline({
      values: [12, -4, 18],
    })
    chart.layout({ minWidth: 0, maxWidth: 180, minHeight: 0, maxHeight: 80 })

    chart.onPointerMove(pointer('move', 86, 40))

    expect(chart.debugState().hoverIndex).toBe(1)
    expect(chart.debugState().crosshair).toEqual(expect.objectContaining({ x: 90 }))
    expect(chart.debugState().tooltip?.title).toBe('#2')
    expect(chart.debugState().tooltip?.items[0]?.value).toBe('-4')
    const tooltip = chart.debugState().tooltip!
    expect(tooltip.y + tooltip.height).toBeLessThanOrEqual(-6)
  })

  it('does not paint sparkline hover markers when tooltip and crosshair are hidden', () => {
    const chart = new RenderSparkline({
      values: [12, -4, 18],
      showTooltip: false,
    })
    chart.layout({ minWidth: 0, maxWidth: 180, minHeight: 0, maxHeight: 80 })

    chart.onPointerMove(pointer('move', 86, 40))
    const painted = createRecordingPaintContext()
    chart.paint(painted.context, { x: 0, y: 0 })

    expect(chart.debugState().hoverIndex).toBe(1)
    expect(chart.debugState().tooltip).toBeNull()
    expect(chart.debugState().crosshair).toBeNull()
    expect(painted.arc).not.toHaveBeenCalled()
  })

  it('paints frame performance as a phase timeline with budget state', () => {
    const painted = createRecordingPaintContext()
    const dl = new DrawList(painted.context)
    const samples = [
      { totalMs: 8, layoutMs: 1, paintMs: 5, compositeMs: 1 },
      { totalMs: 22, layoutMs: 8, paintMs: 10, compositeMs: 2 },
      { totalMs: 13, layoutMs: 2, paintMs: 8, compositeMs: 1 },
    ]

    const state = paintFramePerformanceTimelineChart(
      dl,
      painted.context,
      { x: 0, y: 0, width: 180, height: 72 },
      samples,
      { frameBudgetMs: 16.7 },
    )

    expect(state.slowFrameCount).toBe(1)
    expect(state.visibleSampleCount).toBe(3)
    expect(painted.context.ctx.fillRect).toHaveBeenCalled()
    expect(painted.context.ctx.stroke).toHaveBeenCalled()
    expect(painted.fillText).toHaveBeenCalledWith('16.7ms', expect.any(Number), expect.any(Number))
  })

  it('limits frame performance timeline samples for compact overlays', () => {
    const samples = Array.from({ length: 24 }, (_, index) => ({
      totalMs: index,
      layoutMs: 1,
      paintMs: 1,
      compositeMs: 1,
    }))

    expect(resolveFramePerformanceTimelineChartState(samples, { maxSamples: 12 }).visibleSampleCount).toBe(12)
  })

  it('lays out and reports line-chart point clicks', () => {
    const onPointClick = vi.fn()
    const chart = new RenderLineChart({
      series: [{
        name: '完成数',
        data: [
          { x: '周一', y: 21 },
          { x: '周二', y: 34 },
          { x: '周三', y: 28 },
        ],
      }],
      area: true,
      onPointClick,
    })

    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    chart.paint(createPaintContext(), { x: 0, y: 0 })

    const point = chart.debugState().points[1]!
    chart.onPointerMove(pointer('move', point.x, point.y))
    chart.onPointerDown(pointer('down', point.x, point.y))

    expect(chart.debugState().hover).toEqual(expect.objectContaining({ pointIndex: 1 }))
    expect(onPointClick).toHaveBeenCalledWith(expect.objectContaining({
      label: '周二',
      seriesName: '完成数',
      value: 34,
    }))
  })

  it('deep-clones line-chart point data and filters invalid values', () => {
    const date = new Date(2026, 0, 1)
    const point = { x: date, y: 21 }
    const chart = new RenderLineChart({
      series: [{
        name: '门诊量',
        data: [
          point,
          { x: '无效', y: Number.NaN },
        ],
      }],
    })

    point.y = 99
    date.setFullYear(2030)
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })

    expect(chart.series[0]!.data[0]).not.toBe(point)
    expect(chart.series[0]!.data[0]!.x).not.toBe(date)
    expect(chart.debugState().points).toHaveLength(1)
    expect(chart.debugState().points[0]!.value).toBe(21)
  })

  it('lays out line-chart points inside the x viewport with edge neighbors', () => {
    const chart = new RenderLineChart({
      series: [{
        name: '趋势',
        data: Array.from({ length: 10 }, (_item, index) => ({ x: index, y: index })),
      }],
      xViewport: { min: 2, max: 5 },
      decimation: 'none',
    })

    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })

    expect(chart.debugState().xViewport).toEqual({ min: 2, max: 5 })
    expect(chart.debugState().axisType).toBe('linear')
    expect(chart.debugState().points.map(point => point.pointIndex)).toEqual([1, 2, 3, 4, 5, 6])
    expect(chart.debugState().yDomain.min).toBeLessThan(2)
    expect(chart.debugState().yDomain.max).toBeGreaterThan(5)
  })

  it('formats line-chart axes and tooltip values from axis options', () => {
    const chart = new RenderLineChart({
      series: [{
        name: '完成率',
        data: [
          { x: 0, y: 0.25 },
          { x: 1, y: 0.5 },
        ],
      }],
      xAxis: {
        tickCount: 2,
        labelFormatter: value => `D${value}`,
      },
      yAxis: {
        min: 0,
        max: 1,
        tickCount: 2,
        labelFormatter: value => `${Math.round(value * 100)}%`,
      },
      decimation: 'none',
    })

    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })

    const state = chart.debugState()
    expect(state.yDomain).toEqual({ min: 0, max: 1 })
    expect(state.xLabels.map(label => label.label)).toEqual(expect.arrayContaining(['D0', 'D1']))
    expect(state.yTicks.map(tick => tick.label)).toContain('100%')

    const point = state.points[1]!
    chart.onPointerMove(pointer('move', point.x, point.y))
    expect(chart.debugState().tooltip?.title).toBe('D1')
    expect(chart.debugState().tooltip?.items[0]?.value).toBe('50%')

    const painted = createRecordingPaintContext()
    chart.paint(painted.context, { x: 0, y: 0 })
    const texts = painted.fillText.mock.calls.map(call => call[0])
    expect(texts).toContain('100%')
  })

  it('lays out stacked line areas and reports raw totals in tooltips', () => {
    const chart = new RenderLineChart({
      series: [
        { name: '线上', data: [{ x: '周一', y: 12 }, { x: '周二', y: 20 }] },
        { name: '窗口', data: [{ x: '周一', y: 8 }, { x: '周二', y: 10 }] },
      ],
      stackMode: 'stacked',
      area: true,
      yAxis: { min: 0 },
      decimation: 'none',
    })

    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const state = chart.debugState()
    const topPoint = state.points.find(point => point.seriesName === '窗口' && point.label === '周二')!
    const basePoint = state.points.find(point => point.seriesName === '线上' && point.label === '周二')!

    expect(state.stackMode).toBe('stacked')
    expect(topPoint.value).toBe(10)
    expect(topPoint.stackBase).toBe(20)
    expect(topPoint.stackValue).toBe(30)
    expect(topPoint.stackTotal).toBe(30)
    expect(topPoint.y).toBeLessThan(basePoint.y)

    chart.onPointerMove(pointer('move', topPoint.x, topPoint.y))
    const tooltip = chart.debugState().tooltip!
    expect(tooltip.items.map(item => item.label)).toEqual(['线上', '窗口', '总计'])
    expect(tooltip.items.map(item => item.value)).toEqual(['20', '10', '30'])
  })

  it('normalizes percent stacked line areas and keeps tooltip raw values unformatted by the percent axis', () => {
    const chart = new RenderLineChart({
      series: [
        { name: '线上', data: [{ x: '周一', y: 2 }] },
        { name: '窗口', data: [{ x: '周一', y: 6 }] },
      ],
      stackMode: 'percent',
      area: true,
      yAxis: { unit: '%', tickCount: 2 },
      decimation: 'none',
    })

    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const state = chart.debugState()
    const topPoint = state.points.find(point => point.seriesName === '窗口')!

    expect(state.yDomain).toEqual({ min: 0, max: 100 })
    expect(state.yTicks.map(tick => tick.label)).toContain('100%')
    expect(topPoint.stackBase).toBe(25)
    expect(topPoint.stackValue).toBe(100)
    expect(Math.round(topPoint.stackRatio ?? 0)).toBe(75)

    chart.onPointerMove(pointer('move', topPoint.x, topPoint.y))
    expect(chart.debugState().tooltip?.items.map(item => item.value)).toEqual(['2 · 25%', '6 · 75%', '8'])
  })

  it('shows line-chart loading state and suppresses data interaction', () => {
    const onPointClick = vi.fn()
    const chart = new RenderLineChart({
      series: [{ name: '完成', data: [{ x: 0, y: 10 }] }],
      dataState: 'loading',
      loadingMessage: '趋势加载中',
      onPointClick,
      decimation: 'none',
    })
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const point = chart.debugState().points[0]!

    chart.onPointerMove(pointer('move', point.x, point.y))
    chart.onPointerDown(pointer('down', point.x, point.y))
    const painted = createRecordingPaintContext()
    chart.paint(painted.context, { x: 0, y: 0 })

    expect(chart.debugState().state).toEqual({ state: 'loading', message: '趋势加载中' })
    expect(chart.debugState().hover).toBeNull()
    expect(chart.debugState().tooltip).toBeNull()
    expect(onPointClick).not.toHaveBeenCalled()
    expect(painted.fillText.mock.calls.map(call => call[0])).toContain('趋势加载中')
  })

  it('ignores line-chart hover points outside a fixed y-axis domain', () => {
    const chart = new RenderLineChart({
      series: [{
        name: '超限',
        data: [{ x: 0, y: 200 }],
      }],
      yAxis: { min: 0, max: 100 },
      decimation: 'none',
    })

    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })

    const state = chart.debugState()
    const plot = state.plot
    expect(state.points[0]!.y).toBeLessThan(plot.y)

    chart.onPointerMove(pointer('move', plot.x + plot.width / 2, plot.y + plot.height / 2))

    expect(chart.debugState().hover).toBeNull()
    expect(chart.debugState().crosshair).toBeNull()
    expect(chart.debugState().tooltip).toBeNull()
  })

  it('lays out line-chart annotations and includes y annotations in the visible domain', () => {
    const eventDate = new Date(2026, 0, 3)
    const chart = new RenderLineChart({
      series: [{
        name: '趋势',
        data: [
          { x: new Date(2026, 0, 1), y: 10 },
          { x: new Date(2026, 0, 2), y: 20 },
          { x: eventDate, y: 30 },
          { x: new Date(2026, 0, 4), y: 40 },
        ],
      }],
      xAxisType: 'time',
      annotations: [
        { type: 'line', axis: 'y', value: 80, label: '阈值' },
        { type: 'range', axis: 'x', min: new Date(2026, 0, 2), max: eventDate, label: '区间' },
        { type: 'event', x: eventDate, label: '事件' },
        { type: 'event', x: new Date(2026, 0, 8), label: '不可见' },
      ],
      decimation: 'none',
    })

    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })

    const state = chart.debugState()
    const line = state.annotations.find(annotation => annotation.label === '阈值')!
    const range = state.annotations.find(annotation => annotation.label === '区间')!
    const event = state.annotations.find(annotation => annotation.label === '事件')!

    expect(state.yDomain.max).toBeGreaterThan(80)
    expect(state.annotations.map(annotation => annotation.label)).not.toContain('不可见')
    expect(line).toEqual(expect.objectContaining({ type: 'line', axis: 'y', value: 80 }))
    expect(line.x).toBe(state.plot.x)
    expect(line.width).toBe(state.plot.width)
    expect(range).toEqual(expect.objectContaining({ type: 'range', axis: 'x' }))
    expect(range.width).toBeGreaterThan(0)
    expect(event).toEqual(expect.objectContaining({ type: 'event', axis: 'x' }))
    expect(event.x).toBeGreaterThan(range.x)
  })

  it('resolves category line-chart x annotations by label and clones annotation dates', () => {
    const date = new Date(2026, 0, 2)
    const chart = new RenderLineChart({
      series: [{
        name: '趋势',
        data: [
          { x: '周一', y: 10 },
          { x: '周二', y: 20 },
          { x: '周三', y: 30 },
        ],
      }],
      annotations: [
        { type: 'line', axis: 'x', value: '周二', label: '分类' },
        { type: 'line', axis: 'x', value: '周四', label: '缺失' },
        { type: 'event', x: '周四', label: '缺失事件' },
        { type: 'event', x: new Date(Number.NaN), label: '无效日期' },
        { type: 'event', x: date, label: '日期' },
      ],
      decimation: 'none',
    })
    const annotations = chart.getAnnotations()
    date.setFullYear(2030)

    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })

    const state = chart.debugState()
    const categoryLine = state.annotations.find(annotation => annotation.label === '分类')!
    expect(annotations.find(annotation => annotation.label === '日期')).toEqual(expect.objectContaining({ x: new Date(2026, 0, 2) }))
    expect(state.annotations.map(annotation => annotation.label)).not.toContain('缺失')
    expect(state.annotations.map(annotation => annotation.label)).not.toContain('缺失事件')
    expect(state.annotations.map(annotation => annotation.label)).not.toContain('无效日期')
    expect(categoryLine.x).toBeCloseTo(state.plot.x + state.plot.width / 2, 1)

    chart.setAnnotations([])
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    expect(chart.debugState().annotations).toEqual([])
  })

  it('shows nearest-x aggregate tooltips on line charts across multiple series', () => {
    const chart = new RenderLineChart({
      series: [
        { name: '完成', data: [{ x: 0, y: 10 }, { x: 1, y: 30 }, { x: 2, y: 20 }] },
        { name: '逾期', data: [{ x: 0, y: 3 }, { x: 1, y: 7 }, { x: 2, y: 5 }] },
      ],
      decimation: 'none',
    })
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const target = chart.debugState().points.find(point => point.seriesIndex === 0 && point.pointIndex === 1)!
    const plot = chart.debugState().plot

    chart.onPointerMove(pointer('move', target.x + 12, plot.y + plot.height - 2))

    const state = chart.debugState()
    expect(state.hover).toEqual(expect.objectContaining({ pointIndex: 1 }))
    expect(state.crosshair).toEqual(expect.objectContaining({ x: target.x }))
    expect(state.crosshair?.points).toHaveLength(2)
    expect(state.tooltip?.title).toBe('1')
    expect(state.tooltip?.items.map(item => item.label)).toEqual(['完成', '逾期'])
  })

  it('toggles line-chart series from the legend and recomputes visible data', () => {
    const onSeriesVisibilityChange = vi.fn()
    const chart = new RenderLineChart({
      series: [
        { name: '高值', data: [{ x: 0, y: 100 }, { x: 1, y: 120 }] },
        { name: '低值', data: [{ x: 0, y: 1 }, { x: 1, y: 2 }] },
      ],
      legendMode: 'toggle',
      decimation: 'none',
      onSeriesVisibilityChange,
    })
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const plot = chart.debugState().plot

    chart.onPointerDown(pointer('down', plot.x + 4, 12))
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })

    expect(chart.getVisibleSeries()).toEqual([1])
    expect(chart.debugState().hiddenSeries).toEqual([0])
    expect(chart.debugState().points.every(point => point.seriesIndex === 1)).toBe(true)
    expect(chart.debugState().yDomain.max).toBeLessThan(10)
    expect(onSeriesVisibilityChange).toHaveBeenCalledWith(expect.objectContaining({
      seriesIndex: 0,
      seriesName: '高值',
      visible: false,
      reason: 'legendToggle',
    }))

    const point = chart.debugState().points.find(item => item.pointIndex === 1)!
    chart.onPointerMove(pointer('move', point.x, point.y))
    expect(chart.debugState().tooltip?.items.map(item => item.label)).toEqual(['低值'])

    chart.setVisibleSeries([])
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    expect(chart.debugState().visibleSeries).toEqual([])
    expect(chart.debugState().points).toHaveLength(0)
  })

  it('paints chart legend swatches with square corners', () => {
    const lineChart = new RenderLineChart({
      series: [
        { name: '初诊', data: [{ x: 0, y: 12 }, { x: 1, y: 18 }] },
        { name: '复诊', data: [{ x: 0, y: 9 }, { x: 1, y: 14 }] },
      ],
    })
    lineChart.layout({ minWidth: 0, maxWidth: 320, minHeight: 0, maxHeight: 220 })
    const linePaint = createRecordingPaintContext()

    lineChart.paint(linePaint.context, { x: 0, y: 0 })

    expect(linePaint.roundRect).not.toHaveBeenCalled()

    const donutChart = new RenderDonutChart({
      segments: [
        { label: '线上', value: 52 },
        { label: '窗口', value: 31 },
      ],
    })
    donutChart.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: 220 })
    const donutPaint = createRecordingPaintContext()

    donutChart.paint(donutPaint.context, { x: 0, y: 0 })

    expect(donutPaint.roundRect).not.toHaveBeenCalled()
  })

  it('treats a line chart with all series hidden as empty and suppresses data interaction', () => {
    const onPointClick = vi.fn()
    const chart = new RenderLineChart({
      series: [{ name: '完成', data: [{ x: 0, y: 10 }] }],
      visibleSeries: [],
      emptyMessage: '暂无可见趋势',
      onPointClick,
    })

    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    chart.onPointerMove(pointer('move', 120, 120))
    chart.onPointerDown(pointer('down', 120, 120))
    const painted = createRecordingPaintContext()
    chart.paint(painted.context, { x: 0, y: 0 })

    expect(chart.debugState().visibleSeries).toEqual([])
    expect(chart.debugState().state).toEqual({ state: 'empty', message: '暂无可见趋势' })
    expect(chart.debugState().tooltip).toBeNull()
    expect(onPointClick).not.toHaveBeenCalled()
    expect(painted.fillText.mock.calls.map(call => call[0])).toContain('暂无可见趋势')
  })

  it('keeps item tooltip mode radius-based on line charts', () => {
    const chart = new RenderLineChart({
      series: [{ name: '完成', data: [{ x: 0, y: 10 }, { x: 1, y: 30 }] }],
      tooltipMode: 'item',
      decimation: 'none',
    })
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const plot = chart.debugState().plot

    chart.onPointerMove(pointer('move', plot.x + plot.width / 2, plot.y + plot.height - 2))
    expect(chart.debugState().hover).toBeNull()
    expect(chart.debugState().tooltip).toBeNull()

    const point = chart.debugState().points[1]!
    chart.onPointerMove(pointer('move', point.x, point.y))
    expect(chart.debugState().hover).toEqual(expect.objectContaining({ pointIndex: 1 }))
    expect(chart.debugState().tooltip?.items).toHaveLength(1)
  })

  it('lets line chart crosshair visibility be controlled separately from tooltip visibility', () => {
    const chart = new RenderLineChart({
      series: [{ name: '完成', data: [{ x: 0, y: 10 }, { x: 1, y: 30 }] }],
      showTooltip: false,
      decimation: 'none',
    })
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const plot = chart.debugState().plot
    chart.onPointerMove(pointer('move', plot.x + plot.width / 2, plot.y + plot.height / 2))

    expect(chart.debugState().tooltip).toBeNull()
    expect(chart.debugState().crosshair).toBeNull()

    const crosshairOnly = new RenderLineChart({
      series: [{ name: '完成', data: [{ x: 0, y: 10 }, { x: 1, y: 30 }] }],
      showTooltip: false,
      showCrosshair: true,
      decimation: 'none',
    })
    crosshairOnly.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const crosshairPlot = crosshairOnly.debugState().plot
    crosshairOnly.onPointerMove(pointer('move', crosshairPlot.x + crosshairPlot.width / 2, crosshairPlot.y + crosshairPlot.height / 2))

    expect(crosshairOnly.debugState().tooltip).toBeNull()
    expect(crosshairOnly.debugState().crosshair).not.toBeNull()
  })

  it('does not paint line-chart hover markers when tooltip and crosshair are hidden', () => {
    const chart = new RenderLineChart({
      series: [{ name: '完成', data: [{ x: 0, y: 10 }, { x: 1, y: 30 }] }],
      showTooltip: false,
      decimation: 'none',
    })
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const plot = chart.debugState().plot

    chart.onPointerMove(pointer('move', plot.x + plot.width / 2, plot.y + plot.height / 2))
    const painted = createRecordingPaintContext()
    chart.paint(painted.context, { x: 0, y: 0 })

    expect(chart.debugState().hover).not.toBeNull()
    expect(chart.debugState().tooltip).toBeNull()
    expect(chart.debugState().crosshair).toBeNull()
    expect(painted.arc).not.toHaveBeenCalled()
  })

  it('keeps narrow line-chart tooltips inside chart bounds', () => {
    const chart = new RenderLineChart({
      series: [{
        name: '非常长的序列名称',
        data: [{ x: '很长的分类标签', y: 42 }],
      }],
      showLegend: false,
      tooltipMode: 'item',
      decimation: 'none',
    })
    chart.layout({ minWidth: 0, maxWidth: 92, minHeight: 0, maxHeight: 140 })
    const point = chart.debugState().points[0]!

    chart.onPointerMove(pointer('move', point.x, point.y))
    const tooltip = chart.debugState().tooltip!

    expect(tooltip.x).toBeGreaterThanOrEqual(6)
    expect(tooltip.x + tooltip.width).toBeLessThanOrEqual(86)
    expect(tooltip.width).toBeLessThanOrEqual(80)
  })

  it('rebuilds line-chart axis hover after viewport changes', () => {
    const chart = new RenderLineChart({
      series: [
        { name: '完成', data: [{ x: 0, y: 10 }, { x: 1, y: 30 }, { x: 2, y: 20 }, { x: 3, y: 25 }] },
        { name: '逾期', data: [{ x: 0, y: 3 }, { x: 1, y: 7 }, { x: 2, y: 5 }, { x: 3, y: 6 }] },
      ],
      xViewport: { min: 0, max: 2 },
      decimation: 'none',
    })
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const hovered = chart.debugState().points.find(point => point.seriesIndex === 0 && point.pointIndex === 1)!

    chart.onPointerMove(pointer('move', hovered.x, hovered.y))
    expect(chart.debugState().tooltip?.items).toHaveLength(2)

    chart.setXViewport({ min: 1, max: 3 })
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    expect(chart.debugState().hover).toEqual(expect.objectContaining({ pointIndex: 1 }))
    expect(chart.debugState().tooltip?.items.map(item => item.label)).toEqual(['完成', '逾期'])

    chart.setXViewport({ min: 2, max: 3 })
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    expect(chart.debugState().hover).toBeNull()
    expect(chart.debugState().tooltip).toBeNull()
    expect(chart.debugState().crosshair).toBeNull()
  })

  it('ignores line-chart edge neighbor points when choosing axis hover', () => {
    const data = Array.from({ length: 101 }, (_item, index) => ({
      x: index * 10,
      y: index % 9,
    }))
    const chart = new RenderLineChart({
      series: [{ name: '趋势', data }],
      xViewport: { min: 501, max: 1000 },
      decimation: 'none',
    })
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const plot = chart.debugState().plot

    chart.onPointerMove(pointer('move', plot.x + 1, plot.y + plot.height / 2))

    expect(chart.debugState().hover).toEqual(expect.objectContaining({ pointIndex: 51 }))
    expect(chart.debugState().crosshair!.x).toBeGreaterThanOrEqual(plot.x)
  })

  it('zooms line charts with the configured wheel modifier', () => {
    const onViewportChange = vi.fn()
    const chart = new RenderLineChart({
      series: [{
        name: '趋势',
        data: Array.from({ length: 101 }, (_item, index) => ({ x: index, y: index % 7 })),
      }],
      enableWheelZoom: true,
      onViewportChange,
    })
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const plot = chart.debugState().plot
    const center = { x: plot.x + plot.width / 2, y: plot.y + plot.height / 2 }
    const before = chart.getXViewport()

    expect(chart.onWheel(wheel(center.x, center.y, -1))).toBe(false)
    expect(chart.onWheel(wheel(center.x, center.y, -1, { ctrlKey: true }))).toBe(true)

    const after = chart.getXViewport()
    expect(after.max - after.min).toBeLessThan(before.max - before.min)
    expect(onViewportChange).toHaveBeenCalledWith(expect.objectContaining({ reason: 'wheel' }))
  })

  it('pans line charts horizontally through the gesture arena', () => {
    const onViewportChange = vi.fn()
    const arena = new GestureArenaManager()
    const chart = new RenderLineChart({
      series: [{
        name: '趋势',
        data: Array.from({ length: 101 }, (_item, index) => ({ x: index, y: index % 7 })),
      }],
      xViewport: { min: 20, max: 40 },
      enablePan: true,
      onViewportChange,
    })
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const plot = chart.debugState().plot
    const start = { x: plot.x + plot.width / 2, y: plot.y + plot.height / 2 }

    chart.onPointerDown({
      ...pointer('down', start.x, start.y),
      joinGestureArena: member => arena.add(1, member),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })
    chart.onPointerMove(pointer('move', start.x - 24, start.y))
    chart.onPointerUp(pointer('up', start.x - 24, start.y))

    expect(chart.getXViewport().min).toBeGreaterThan(20)
    expect(onViewportChange).toHaveBeenCalledWith(expect.objectContaining({ reason: 'pan' }))
  })

  it('leaves vertical drag intent to outer scroll containers', () => {
    const arena = new GestureArenaManager()
    const chart = new RenderLineChart({
      series: [{
        name: '趋势',
        data: Array.from({ length: 101 }, (_item, index) => ({ x: index, y: index % 7 })),
      }],
      xViewport: { min: 20, max: 40 },
      enablePan: true,
    })
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const plot = chart.debugState().plot
    const start = { x: plot.x + plot.width / 2, y: plot.y + plot.height / 2 }

    chart.onPointerDown({
      ...pointer('down', start.x, start.y),
      joinGestureArena: member => arena.add(1, member),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })
    chart.onPointerMove(pointer('move', start.x, start.y + 24))

    expect(chart.getXViewport()).toEqual({ min: 20, max: 40 })
    expect(arena.members(1)).toHaveLength(0)
  })

  it('decimates long line series by visible pixel buckets', () => {
    const chart = new RenderLineChart({
      series: [{
        name: '趋势',
        data: Array.from({ length: 1000 }, (_item, index) => ({
          x: index,
          y: index === 500 ? 999 : Math.sin(index / 12) * 20,
        })),
      }],
    })

    chart.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: 260 })

    const state = chart.debugState()
    expect(state.points.length).toBeLessThan(1000)
    expect(state.points.length).toBeLessThanOrEqual(state.plot.width * 2 + 2)
    expect(state.points.some(point => point.value === 999)).toBe(true)
  })

  it('clones range-slider series and clamps viewport to the full domain', () => {
    const date = new Date(2026, 0, 1)
    const point = { x: date, y: 21 }
    const slider = new RenderChartRangeSlider({
      series: [{
        name: '趋势',
        data: [
          point,
          { x: new Date(2026, 0, 2), y: Number.NaN },
        ],
      }],
      fullDomain: { min: 0, max: 100 },
      viewport: { min: -10, max: 10 },
    })

    point.y = 99
    date.setFullYear(2030)
    slider.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 80 })

    expect(slider.series[0]!.data).toHaveLength(2)
    expect(slider.series[0]!.data[1]!.y).toBeNull()
    expect(slider.series[0]!.data[0]).not.toBe(point)
    expect(slider.series[0]!.data[0]!.x).not.toBe(date)
    expect(slider.debugState().fullDomain).toEqual({ min: 0, max: 100 })
    expect(slider.debugState().viewport).toEqual({ min: 0, max: 20 })
    expect(slider.debugState().previewPoints[0]!.value).toBe(21)
  })

  it('resizes range-slider viewports from both handles', () => {
    const onViewportChange = vi.fn()
    const arena = new GestureArenaManager()
    const slider = new RenderChartRangeSlider({
      series: [{
        name: '趋势',
        data: Array.from({ length: 101 }, (_item, index) => ({ x: index, y: index % 7 })),
      }],
      viewport: { min: 20, max: 60 },
      onViewportChange,
    })
    slider.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 80 })
    const state = slider.debugState()
    const y = state.track.y + state.track.height / 2

    slider.onPointerDown({
      ...pointer('down', state.leftHandleX, y),
      joinGestureArena: member => arena.add(1, member),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })
    slider.onPointerMove(pointer('move', state.leftHandleX + 30, y))
    slider.onPointerUp(pointer('up', state.leftHandleX + 30, y))

    const afterLeft = slider.getViewport()
    expect(afterLeft.min).toBeGreaterThan(20)
    expect(onViewportChange).toHaveBeenCalledWith(expect.objectContaining({ reason: 'rangeResize' }))

    const nextState = slider.debugState()
    slider.onPointerDown({
      ...pointer('down', nextState.rightHandleX, y),
      joinGestureArena: member => arena.add(1, member),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })
    slider.onPointerMove(pointer('move', nextState.rightHandleX - 30, y))
    slider.onPointerUp(pointer('up', nextState.rightHandleX - 30, y))

    expect(slider.getViewport().max).toBeLessThan(afterLeft.max)
    expect(onViewportChange).toHaveBeenCalledWith(expect.objectContaining({ reason: 'rangeResize' }))
  })

  it('pans range-slider viewports by dragging the selected window', () => {
    const onViewportChange = vi.fn()
    const arena = new GestureArenaManager()
    const slider = new RenderChartRangeSlider({
      series: [{
        name: '趋势',
        data: Array.from({ length: 101 }, (_item, index) => ({ x: index, y: index % 7 })),
      }],
      viewport: { min: 20, max: 40 },
      onViewportChange,
    })
    slider.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 80 })
    const state = slider.debugState()
    const start = {
      x: (state.leftHandleX + state.rightHandleX) / 2,
      y: state.track.y + state.track.height / 2,
    }

    slider.onPointerDown({
      ...pointer('down', start.x, start.y),
      joinGestureArena: member => arena.add(1, member),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })
    slider.onPointerMove(pointer('move', start.x + 24, start.y))
    slider.onPointerUp(pointer('up', start.x + 24, start.y))

    expect(slider.getViewport().min).toBeGreaterThan(20)
    expect(onViewportChange).toHaveBeenCalledWith(expect.objectContaining({ reason: 'rangePan' }))
  })

  it('jumps range-slider viewports when clicking unselected track', () => {
    const onViewportChange = vi.fn()
    const arena = new GestureArenaManager()
    const slider = new RenderChartRangeSlider({
      series: [{
        name: '趋势',
        data: Array.from({ length: 101 }, (_item, index) => ({ x: index, y: index % 7 })),
      }],
      viewport: { min: 20, max: 40 },
      onViewportChange,
    })
    slider.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 80 })
    const state = slider.debugState()
    const click = {
      x: state.track.x + state.track.width * 0.8,
      y: state.track.y + state.track.height / 2,
    }

    slider.onPointerDown({
      ...pointer('down', click.x, click.y),
      joinGestureArena: member => arena.add(1, member),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })
    slider.onPointerUp(pointer('up', click.x, click.y))

    expect(slider.getViewport().min).toBeGreaterThan(20)
    expect(onViewportChange).toHaveBeenCalledWith(expect.objectContaining({ reason: 'rangeJump' }))
  })

  it('keeps range-slider min and max spans inside the full domain', () => {
    const slider = new RenderChartRangeSlider({
      series: [{
        name: '趋势',
        data: Array.from({ length: 101 }, (_item, index) => ({ x: index, y: index % 7 })),
      }],
      fullDomain: { min: 0, max: 100 },
      viewport: { min: 10, max: 20 },
      minSpan: 15,
      maxSpan: 30,
    })

    slider.setViewport({ min: -50, max: -40 })
    expect(slider.getViewport()).toEqual({ min: 0, max: 15 })

    slider.setViewport({ min: 0, max: 100 })
    expect(slider.getViewport()).toEqual({ min: 35, max: 65 })

    slider.setViewport({ min: 12, max: 13 })
    const span = slider.getViewport().max - slider.getViewport().min
    expect(span).toBe(15)
    expect(slider.getViewport().min).toBeGreaterThanOrEqual(0)
    expect(slider.getViewport().max).toBeLessThanOrEqual(100)
  })

  it('leaves vertical range-slider drag intent to outer scroll containers', () => {
    const arena = new GestureArenaManager()
    const slider = new RenderChartRangeSlider({
      series: [{
        name: '趋势',
        data: Array.from({ length: 101 }, (_item, index) => ({ x: index, y: index % 7 })),
      }],
      viewport: { min: 20, max: 40 },
    })
    slider.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 80 })
    const state = slider.debugState()
    const start = {
      x: (state.leftHandleX + state.rightHandleX) / 2,
      y: state.track.y + state.track.height / 2,
    }

    slider.onPointerDown({
      ...pointer('down', start.x, start.y),
      joinGestureArena: member => arena.add(1, member),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })
    slider.onPointerMove(pointer('move', start.x, start.y + 24))

    expect(slider.getViewport()).toEqual({ min: 20, max: 40 })
    expect(arena.members(1)).toHaveLength(0)
  })

  it('updates range-slider viewports from keyboard navigation', () => {
    const onViewportChange = vi.fn()
    const slider = new RenderChartRangeSlider({
      series: [{
        name: '趋势',
        data: Array.from({ length: 101 }, (_item, index) => ({ x: index, y: index % 7 })),
      }],
      viewport: { min: 20, max: 40 },
      onViewportChange,
    })
    slider.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 80 })

    expect(slider.onKeyDown(key('ArrowRight'))).toBe(true)
    expect(slider.getViewport().min).toBeGreaterThan(20)
    expect(onViewportChange).toHaveBeenCalledWith(expect.objectContaining({ reason: 'rangePan' }))

    expect(slider.onKeyDown(key('Home'))).toBe(true)
    expect(slider.getViewport().min).toBe(0)

    expect(slider.onKeyDown(key('End'))).toBe(true)
    expect(slider.getViewport().max).toBe(100)
    expect(onViewportChange).toHaveBeenCalledWith(expect.objectContaining({ reason: 'rangeJump' }))
  })

  it('shows range-slider empty state and disables keyboard navigation', () => {
    const slider = new RenderChartRangeSlider({
      series: [],
      emptyMessage: '暂无可选范围',
    })
    slider.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 80 })

    const painted = createRecordingPaintContext()
    slider.paint(painted.context, { x: 0, y: 0 })

    expect(slider.debugState().state).toEqual({ state: 'empty', message: '暂无可选范围' })
    expect(slider.onKeyDown(key('ArrowRight'))).toBe(false)
    expect(painted.fillText.mock.calls.map(call => call[0])).toContain('暂无可选范围')
  })

  it('lays out grouped bars and supports orientation changes', () => {
    const onBarClick = vi.fn()
    const chart = new RenderBarChart({
      categories: ['内科', '外科'],
      series: [
        { name: '今日', data: [24, 30] },
        { name: '昨日', data: [20, 28] },
      ],
      onBarClick,
    })

    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    chart.paint(createPaintContext(), { x: 0, y: 0 })

    const bar = chart.debugState().bars[2]!
    chart.onPointerMove(pointer('move', bar.x + bar.width / 2, bar.y + bar.height / 2))
    chart.onPointerDown(pointer('down', bar.x + bar.width / 2, bar.y + bar.height / 2))

    expect(onBarClick).toHaveBeenCalledWith(expect.objectContaining({
      category: '外科',
      seriesName: '今日',
      value: 30,
    }))

    chart.orientation = 'horizontal'
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    expect(chart.debugState().orientation).toBe('horizontal')
    expect(chart.debugState().bars).toHaveLength(4)
  })

  it('normalizes non-finite bar values to zero', () => {
    const chart = new RenderBarChart({
      categories: ['内科', '外科', '急诊'],
      series: [{ name: '今日', data: [24, Number.NaN, Number.POSITIVE_INFINITY] }],
    })

    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })

    expect(chart.debugState().bars.map(bar => bar.value)).toEqual([24, 0, 0])
  })

  it('lays out stacked bars and includes category totals in tooltips', () => {
    const chart = new RenderBarChart({
      categories: ['门诊'],
      series: [
        { name: '线上', data: [32] },
        { name: '窗口', data: [18] },
      ],
      stackMode: 'stacked',
      valueAxis: { min: 0 },
    })

    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const state = chart.debugState()
    const first = state.bars[0]!
    const second = state.bars[1]!

    expect(state.stackMode).toBe('stacked')
    expect(first.stackBase).toBe(0)
    expect(first.stackValue).toBe(32)
    expect(second.stackBase).toBe(32)
    expect(second.stackValue).toBe(50)
    expect(second.stackTotal).toBe(50)
    expect(second.x).toBe(first.x)

    chart.onPointerMove(pointer('move', second.x + second.width / 2, second.y + second.height / 2))
    expect(chart.debugState().tooltip?.items.map(item => item.label)).toEqual(['线上', '窗口', '总计'])
    expect(chart.debugState().tooltip?.items.map(item => item.value)).toEqual(['32', '18', '50'])
  })

  it('lays out horizontal stacked bars in one category lane', () => {
    const chart = new RenderBarChart({
      categories: ['门诊'],
      series: [
        { name: '线上', data: [20] },
        { name: '窗口', data: [30] },
      ],
      stackMode: 'stacked',
      orientation: 'horizontal',
      valueAxis: { min: 0 },
    })

    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const first = chart.debugState().bars[0]!
    const second = chart.debugState().bars[1]!

    expect(second.y).toBe(first.y)
    expect(second.stackBase).toBe(20)
    expect(second.stackValue).toBe(50)
    expect(second.stackTotal).toBe(50)
  })

  it('recomputes stacked bars after legend visibility changes', () => {
    const chart = new RenderBarChart({
      categories: ['门诊'],
      series: [
        { name: '线上', data: [32] },
        { name: '窗口', data: [18] },
      ],
      stackMode: 'stacked',
      valueAxis: { min: 0 },
    })

    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    expect(chart.debugState().bars[1]!.stackValue).toBe(50)

    chart.setVisibleSeries([1])
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const bar = chart.debugState().bars[0]!

    expect(chart.debugState().visibleSeries).toEqual([1])
    expect(bar.seriesName).toBe('窗口')
    expect(bar.stackBase).toBe(0)
    expect(bar.stackValue).toBe(18)
    expect(bar.stackTotal).toBe(18)
  })

  it('stacks positive and negative bar values from separate baselines', () => {
    const chart = new RenderBarChart({
      categories: ['门诊'],
      series: [
        { name: '完成', data: [30] },
        { name: '回退', data: [-12] },
        { name: '补录', data: [8] },
      ],
      stackMode: 'stacked',
    })

    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const state = chart.debugState()
    const positiveFirst = state.bars[0]!
    const negative = state.bars[1]!
    const positiveSecond = state.bars[2]!

    expect(state.valueDomain.min).toBeLessThanOrEqual(-12)
    expect(state.valueDomain.max).toBeGreaterThanOrEqual(38)
    expect(positiveFirst.stackBase).toBe(0)
    expect(positiveFirst.stackValue).toBe(30)
    expect(negative.stackBase).toBe(0)
    expect(negative.stackValue).toBe(-12)
    expect(positiveSecond.stackBase).toBe(30)
    expect(positiveSecond.stackValue).toBe(38)
    expect(positiveSecond.stackTotal).toBe(26)
  })

  it('treats a bar chart with all series hidden as empty and suppresses data hover', () => {
    const onBarClick = vi.fn()
    const chart = new RenderBarChart({
      categories: ['门诊'],
      series: [{ name: '完成', data: [32] }],
      visibleSeries: [],
      emptyMessage: '暂无可见柱图',
      onBarClick,
    })

    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    chart.onPointerMove(pointer('move', 120, 120))
    chart.onPointerDown(pointer('down', 120, 120))
    const painted = createRecordingPaintContext()
    chart.paint(painted.context, { x: 0, y: 0 })

    expect(chart.debugState().visibleSeries).toEqual([])
    expect(chart.debugState().bars).toHaveLength(0)
    expect(chart.debugState().state).toEqual({ state: 'empty', message: '暂无可见柱图' })
    expect(chart.debugState().tooltip).toBeNull()
    expect(onBarClick).not.toHaveBeenCalled()
    expect(painted.fillText.mock.calls.map(call => call[0])).toContain('暂无可见柱图')
  })

  it('normalizes percent stacked bars to a 0-100 value domain', () => {
    const chart = new RenderBarChart({
      categories: ['门诊'],
      series: [
        { name: '线上', data: [30] },
        { name: '窗口', data: [70] },
      ],
      stackMode: 'percent',
      valueAxis: { tickCount: 2, unit: '%' },
    })

    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const state = chart.debugState()

    expect(state.valueDomain).toEqual({ min: 0, max: 100 })
    expect(state.valueTicks.map(tick => tick.label)).toContain('100%')
    expect(state.bars.map(bar => bar.stackValue)).toEqual([30, 100])
    expect(state.bars.map(bar => Math.round(bar.stackRatio ?? 0))).toEqual([30, 70])

    const bar = state.bars[0]!
    chart.onPointerMove(pointer('move', bar.x + bar.width / 2, bar.y + bar.height / 2))
    expect(chart.debugState().tooltip?.items[0]?.value).toBe('30 · 30%')
  })

  it('caps vertical stacked bar thickness and centers bars in category lanes', () => {
    const chart = new RenderBarChart({
      categories: ['初诊', '复诊', '住院', '体检'],
      series: [
        { name: '线上', data: [64, 48, 22, 78] },
        { name: '窗口', data: [24, 36, 43, 16] },
        { name: '转诊', data: [12, 16, 35, 6] },
      ],
      stackMode: 'percent',
      valueAxis: { min: 0, max: 100, tickCount: 4 },
      maxBarThickness: 34,
    })

    chart.layout({ minWidth: 0, maxWidth: 720, minHeight: 0, maxHeight: 260 })
    const state = chart.debugState()
    const groupWidth = state.plot.width / 4
    const firstBar = state.bars[0]!

    expect(firstBar.width).toBe(34)
    expect(firstBar.x).toBeCloseTo(state.plot.x + (groupWidth - 34) / 2)
  })

  it('paints stacked bar segments with square corners', () => {
    const chart = new RenderBarChart({
      categories: ['初诊'],
      series: [
        { name: '线上', data: [64] },
        { name: '窗口', data: [24] },
        { name: '转诊', data: [12] },
      ],
      stackMode: 'percent',
      showLegend: false,
      showTooltip: false,
      valueAxis: { min: 0, max: 100, tickCount: 4 },
    })
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const painted = createRecordingPaintContext()

    chart.paint(painted.context, { x: 0, y: 0 })

    expect(painted.roundRect).not.toHaveBeenCalled()
  })

  it('formats bar-chart value and category axes across orientations', () => {
    const chart = new RenderBarChart({
      categories: ['内科门诊', '外科门诊'],
      series: [{ name: '占用率', data: [82, 91] }],
      orientation: 'horizontal',
      valueAxis: { min: 0, max: 100, tickCount: 4, unit: '%' },
      categoryAxis: { maxLabelLength: 3 },
    })

    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })

    let state = chart.debugState()
    expect(state.valueDomain).toEqual({ min: 0, max: 100 })
    expect(state.valueTicks.map(tick => tick.label)).toContain('100%')
    expect(state.categoryLabels.some(label => label.label === '内科…')).toBe(true)

    const bar = state.bars[0]!
    chart.onPointerMove(pointer('move', bar.x + bar.width / 2, bar.y + bar.height / 2))
    expect(chart.debugState().tooltip?.items[0]?.value).toBe('82%')

    const painted = createRecordingPaintContext()
    chart.paint(painted.context, { x: 0, y: 0 })
    const texts = painted.fillText.mock.calls.map(call => call[0])
    expect(texts).toContain('100%')

    chart.orientation = 'vertical'
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    state = chart.debugState()
    expect(state.valueDomain).toEqual({ min: 0, max: 100 })
    expect(state.valueTicks.map(tick => tick.label)).toContain('100%')
  })

  it('limits bar-chart category labels to the requested tick count', () => {
    const chart = new RenderBarChart({
      categories: ['一病区', '二病区', '三病区', '四病区', '五病区'],
      series: [{ name: '今日', data: [12, 18, 21, 15, 19] }],
      categoryAxis: { tickCount: 2 },
    })

    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })

    expect(chart.debugState().categoryLabels.map(label => label.index)).toEqual([0, 4])
  })

  it('shows bar-chart error state and suppresses data hover', () => {
    const chart = new RenderBarChart({
      categories: ['内科'],
      series: [{ name: '今日', data: [24] }],
      dataState: 'error',
      errorMessage: '柱图加载失败',
    })
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const bar = chart.debugState().bars[0]!

    chart.onPointerMove(pointer('move', bar.x + bar.width / 2, bar.y + bar.height / 2))
    const painted = createRecordingPaintContext()
    chart.paint(painted.context, { x: 0, y: 0 })

    expect(chart.debugState().state).toEqual({ state: 'error', message: '柱图加载失败' })
    expect(chart.debugState().hover).toBeNull()
    expect(chart.debugState().tooltip).toBeNull()
    expect(painted.fillText.mock.calls.map(call => call[0])).toContain('柱图加载失败')
  })

  it('lays out bar-chart value annotations across vertical and horizontal orientations', () => {
    const chart = new RenderBarChart({
      categories: ['内科', '外科'],
      series: [{ name: '今日', data: [24, 30] }],
      annotations: [
        { type: 'line', axis: 'value', value: 80, label: '目标' },
        { type: 'range', axis: 'value', min: 20, max: 28, label: '正常' },
        { type: 'event', x: 0, label: '忽略' },
      ],
    })

    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    let state = chart.debugState()
    let line = state.annotations.find(annotation => annotation.label === '目标')!
    let range = state.annotations.find(annotation => annotation.label === '正常')!

    expect(state.valueDomain.max).toBeGreaterThan(80)
    expect(state.annotations.map(annotation => annotation.label)).not.toContain('忽略')
    expect(line).toEqual(expect.objectContaining({ type: 'line', axis: 'y', value: 80 }))
    expect(line.width).toBe(state.plot.width)
    expect(range).toEqual(expect.objectContaining({ type: 'range', axis: 'y' }))
    expect(range.height).toBeGreaterThan(0)

    chart.orientation = 'horizontal'
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    state = chart.debugState()
    line = state.annotations.find(annotation => annotation.label === '目标')!
    range = state.annotations.find(annotation => annotation.label === '正常')!

    expect(line).toEqual(expect.objectContaining({ type: 'line', axis: 'x', value: 80 }))
    expect(line.height).toBe(state.plot.height)
    expect(range).toEqual(expect.objectContaining({ type: 'range', axis: 'x' }))
    expect(range.width).toBeGreaterThan(0)
  })

  it('shows category aggregate tooltips on vertical bar chart whitespace without clicking a bar', () => {
    const onBarClick = vi.fn()
    const chart = new RenderBarChart({
      categories: ['内科', '外科'],
      series: [
        { name: '今日', data: [24, 30] },
        { name: '昨日', data: [20, 28] },
      ],
      onBarClick,
    })
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const plot = chart.debugState().plot
    const groupWidth = plot.width / 2
    const x = plot.x + groupWidth + 2
    const y = plot.y + plot.height / 2

    chart.onPointerMove(pointer('move', x, y))
    chart.onPointerDown(pointer('down', x, y))

    const state = chart.debugState()
    expect(state.hover).toBeNull()
    expect(state.hoverCategoryIndex).toBe(1)
    expect(state.tooltip?.title).toBe('外科')
    expect(state.tooltip?.items.map(item => item.label)).toEqual(['今日', '昨日'])
    expect(onBarClick).not.toHaveBeenCalled()
  })

  it('toggles bar-chart series from the legend and lays out grouped bars from visible series', () => {
    const onSeriesVisibilityChange = vi.fn()
    const chart = new RenderBarChart({
      categories: ['内科', '外科'],
      series: [
        { name: '今日', data: [24, 30] },
        { name: '昨日', data: [20, 28] },
      ],
      legendMode: 'toggle',
      onSeriesVisibilityChange,
    })
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const beforeWidth = chart.debugState().bars[0]!.width
    const plot = chart.debugState().plot

    chart.onPointerDown(pointer('down', plot.x + 4, 12))
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })

    expect(chart.getVisibleSeries()).toEqual([1])
    expect(chart.debugState().hiddenSeries).toEqual([0])
    expect(chart.debugState().bars).toHaveLength(2)
    expect(chart.debugState().bars.every(bar => bar.seriesIndex === 1)).toBe(true)
    expect(chart.debugState().bars[0]!.width).toBeGreaterThan(beforeWidth)
    expect(onSeriesVisibilityChange).toHaveBeenCalledWith(expect.objectContaining({
      seriesIndex: 0,
      seriesName: '今日',
      visible: false,
      reason: 'legendToggle',
    }))

    chart.onPointerMove(pointer('move', plot.x + plot.width / 2, plot.y + plot.height / 2))
    expect(chart.debugState().tooltip?.items.map(item => item.label)).toEqual(['昨日'])

    chart.setVisibleSeries([])
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    expect(chart.debugState().bars).toHaveLength(0)
  })

  it('shows category aggregate tooltips on horizontal bar charts', () => {
    const chart = new RenderBarChart({
      categories: ['内科', '外科'],
      series: [
        { name: '今日', data: [24, 30] },
        { name: '昨日', data: [20, 28] },
      ],
      orientation: 'horizontal',
    })
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    const plot = chart.debugState().plot
    const groupHeight = plot.height / 2

    chart.onPointerMove(pointer('move', plot.x + plot.width / 2, plot.y + groupHeight + 2))

    expect(chart.debugState().hoverCategoryIndex).toBe(1)
    expect(chart.debugState().tooltip?.title).toBe('外科')
    expect(chart.debugState().tooltip?.items).toHaveLength(2)
  })

  it('truncates tall aggregate chart tooltips to the chart bounds', () => {
    const chart = new RenderBarChart({
      categories: ['检验'],
      series: Array.from({ length: 20 }, (_item, index) => ({
        name: `系列${index + 1}`,
        data: [index + 1],
      })),
      showLegend: false,
      height: 120,
    })
    chart.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: 120 })
    const plot = chart.debugState().plot

    chart.onPointerMove(pointer('move', plot.x + plot.width / 2, plot.y + plot.height / 2))

    const tooltip = chart.debugState().tooltip!
    expect(tooltip.height).toBeLessThanOrEqual(112)
    expect(tooltip.items.at(-1)?.label).toMatch(/^\+\d+$/)
  })

  it('clicks donut segments by segment index when zero-value items are skipped', () => {
    const onSegmentClick = vi.fn()
    const chart = new RenderDonutChart({
      segments: [
        { label: '空项', value: 0 },
        { label: '已完成', value: 60 },
        { label: '处理中', value: 40 },
      ],
      onSegmentClick,
    })

    chart.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 240 })
    chart.paint(createPaintContext(), { x: 0, y: 0 })

    const segment = chart.debugState().segments[0]!
    const middleAngle = (segment.startAngle + segment.endAngle) / 2
    const hitX = chart.debugState().center.x + Math.cos(middleAngle) * chart.debugState().radius
    const hitY = chart.debugState().center.y + Math.sin(middleAngle) * chart.debugState().radius
    chart.onPointerMove(pointer('move', hitX, hitY))
    chart.onPointerDown(pointer('down', hitX, hitY))

    expect(chart.debugState().hoverIndex).toBe(1)
    expect(onSegmentClick).toHaveBeenCalledWith(expect.objectContaining({
      index: 1,
      label: '已完成',
      value: 60,
    }))
    expect(chart.debugState().tooltip?.title).toBe('已完成')
  })

  it('can hide donut tooltips without changing segment hover', () => {
    const chart = new RenderDonutChart({
      segments: [
        { label: '已完成', value: 60 },
        { label: '处理中', value: 40 },
      ],
      showTooltip: false,
    })
    chart.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 240 })
    const segment = chart.debugState().segments[0]!
    const middleAngle = (segment.startAngle + segment.endAngle) / 2
    const hitX = chart.debugState().center.x + Math.cos(middleAngle) * chart.debugState().radius
    const hitY = chart.debugState().center.y + Math.sin(middleAngle) * chart.debugState().radius

    chart.onPointerMove(pointer('move', hitX, hitY))

    expect(chart.debugState().hoverIndex).toBe(0)
    expect(chart.debugState().tooltip).toBeNull()
  })

  it('shows donut error state while preserving the legend', () => {
    const chart = new RenderDonutChart({
      segments: [
        { label: '已完成', value: 60 },
        { label: '处理中', value: 40 },
      ],
      dataState: 'error',
      errorMessage: '环图加载失败',
    })
    chart.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 240 })
    const painted = createRecordingPaintContext()

    chart.paint(painted.context, { x: 0, y: 0 })

    const texts = painted.fillText.mock.calls.map(call => call[0])
    expect(chart.debugState().state).toEqual({ state: 'error', message: '环图加载失败' })
    expect(texts).toContain('环图加载失败')
    expect(texts).toContain('已完成')
  })

  it('toggles donut segments from the legend and recomputes visible total', () => {
    const onSegmentVisibilityChange = vi.fn()
    const chart = new RenderDonutChart({
      segments: [
        { label: '已完成', value: 60 },
        { label: '处理中', value: 40 },
      ],
      legendMode: 'toggle',
      onSegmentVisibilityChange,
    })
    chart.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 240 })

    chart.onPointerDown(pointer('down', 198, 88))
    chart.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 240 })

    expect(chart.getVisibleSegments()).toEqual([1])
    expect(chart.debugState().hiddenSegments).toEqual([0])
    expect(chart.debugState().total).toBe(40)
    expect(chart.debugState().segments.map(segment => segment.index)).toEqual([1])
    expect(onSegmentVisibilityChange).toHaveBeenCalledWith(expect.objectContaining({
      segmentIndex: 0,
      label: '已完成',
      visible: false,
      reason: 'legendToggle',
    }))

    chart.setVisibleSegments([])
    chart.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 240 })
    expect(chart.debugState().total).toBe(0)
    expect(chart.debugState().segments).toHaveLength(0)

    chart.onPointerDown(pointer('down', 198, 88))
    chart.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 240 })
    expect(chart.getVisibleSegments()).toEqual([0])
    expect(chart.debugState().total).toBe(60)
  })

  it('normalizes donut values and reserves bottom legend space on compact widths', () => {
    const chart = new RenderDonutChart({
      segments: [
        { label: '线上', value: 52 },
        { label: '窗口', value: Number.NaN },
        { label: '转诊', value: Number.POSITIVE_INFINITY },
        { label: '其他', value: -12 },
      ],
      height: 170,
    })

    chart.layout({ minWidth: 0, maxWidth: 210, minHeight: 0, maxHeight: 220 })

    expect(chart.debugState().total).toBe(52)
    expect(chart.debugState().segments).toHaveLength(1)
    expect(chart.debugState().center.y).toBeLessThan(85)
  })

  it('keeps category positions and line breaks when a series has a missing value', () => {
    const chart = new RenderLineChart({
      series: [
        { name: '甲', data: [{ x: '一', y: 1 }, { x: '二', y: null }, { x: '三', y: 3 }] },
        { name: '乙', data: [{ x: '一', y: 4 }, { x: '二', y: 5 }, { x: '三', y: 6 }] },
      ],
      decimation: 'none',
    })
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })

    const points = chart.debugState().points
    const thirdA = points.find(point => point.seriesIndex === 0 && point.pointIndex === 2)!
    const thirdB = points.find(point => point.seriesIndex === 1 && point.pointIndex === 2)!
    expect(thirdA.x).toBe(thirdB.x)
    expect(thirdA.breakBefore).toBe(true)
    expect(points.some(point => point.seriesIndex === 0 && point.pointIndex === 1)).toBe(false)
    const slider = new RenderChartRangeSlider({
      series: [{ name: '甲', data: [{ x: 0, y: 1 }, { x: 1, y: null }, { x: 2, y: 3 }] }],
    })
    slider.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 80 })
    expect(slider.debugState().previewPoints.map(point => point.breakBefore)).toEqual([false, true])
  })

  it('keeps a line segment visible when its sparse endpoints straddle the viewport', () => {
    const chart = new RenderLineChart({
      series: [{ name: '稀疏趋势', data: [{ x: 0, y: 1 }, { x: 10, y: 2 }] }],
      xViewport: { min: 4, max: 6 },
      decimation: 'none',
    })
    chart.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 220 })
    expect(chart.debugState().points.map(point => point.pointIndex)).toEqual([0, 1])
    expect(chart.debugState().state.state).toBe('ready')
  })

  it('uses actual timestamps for ISO date strings and keeps numeric series in time order', () => {
    const data = [
      { x: '2026-05-04T00:00:00Z', y: 4 },
      { x: '2026-05-01T00:00:00Z', y: 1 },
      { x: '2026-05-02T00:00:00Z', y: 2 },
    ]
    const chart = new RenderLineChart({ series: [{ name: '趋势', data }], decimation: 'none' })
    const slider = new RenderChartRangeSlider({ series: [{ name: '趋势', data }] })
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })
    slider.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 80 })

    const state = chart.debugState()
    expect(state.axisType).toBe('time')
    expect(state.xDomain).toEqual({
      min: Date.parse('2026-05-01T00:00:00Z'),
      max: Date.parse('2026-05-04T00:00:00Z'),
    })
    expect(state.points.map(point => point.pointIndex)).toEqual([1, 2, 0])
    expect(state.points[1]!.x - state.points[0]!.x).toBeCloseTo((state.points[2]!.x - state.points[0]!.x) / 3)
    expect(slider.getFullDomain()).toEqual(state.xDomain)
  })

  it('retains repeated x values in stacked line series', () => {
    const chart = new RenderLineChart({
      series: [
        { name: '甲', data: [{ x: 1, y: 2 }, { x: 1, y: 3 }] },
        { name: '乙', data: [{ x: 1, y: 4 }, { x: 1, y: 5 }] },
      ],
      stackMode: 'stacked',
      decimation: 'none',
    })
    chart.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 260 })

    const points = chart.debugState().points
    expect(points).toHaveLength(4)
    expect(points.filter(point => point.seriesIndex === 1).map(point => point.stackValue)).toEqual([6, 8])
  })

  it('computes domains for data larger than the JavaScript argument limit', () => {
    const values = Array.from({ length: 200_000 }, (_item, index) => index)
    expect(normalizeLinearDomain(values)).toEqual({ min: 0, max: 199_999 })
    const chart = new RenderLineChart({
      series: [{ name: '大序列', data: values.map(value => ({ x: value, y: value % 10 })) }],
    })
    expect(() => chart.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: 260 })).not.toThrow()
    expect(chart.debugState().points.length).toBeLessThan(200_000)
  })

  it('resolves direct clicks from pointer-down coordinates without prior hover', () => {
    const lineClick = vi.fn()
    const line = new RenderLineChart({
      series: [{ name: '趋势', data: [{ x: 0, y: 1 }, { x: 1, y: 2 }] }],
      onPointClick: lineClick,
    })
    line.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 220 })
    const linePoint = line.debugState().points[1]!
    line.onPointerDown(pointer('down', linePoint.x, linePoint.y))
    expect(lineClick).toHaveBeenCalledWith(expect.objectContaining({ pointIndex: 1 }))
    lineClick.mockClear()
    const firstPoint = line.debugState().points[0]!
    line.onPointerMove(pointer('move', firstPoint.x, firstPoint.y))
    line.onPointerDown(pointer('down', linePoint.x, linePoint.y))
    expect(lineClick).toHaveBeenCalledWith(expect.objectContaining({ pointIndex: 1 }))

    const barClick = vi.fn()
    const bar = new RenderBarChart({
      categories: ['甲', '乙'], series: [{ name: '数量', data: [1, 2] }], onBarClick: barClick,
    })
    bar.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 220 })
    const barItem = bar.debugState().bars[1]!
    bar.onPointerDown(pointer('down', barItem.x + barItem.width / 2, barItem.y + barItem.height / 2))
    expect(barClick).toHaveBeenCalledWith(expect.objectContaining({ categoryIndex: 1 }))

    const donutClick = vi.fn()
    const donut = new RenderDonutChart({
      segments: [{ label: '甲', value: 1 }, { label: '乙', value: 1 }], onSegmentClick: donutClick,
    })
    donut.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 220 })
    const donutItem = donut.debugState().segments[1]!
    const angle = (donutItem.startAngle + donutItem.endAngle) / 2
    const donutX = donut.debugState().center.x + Math.cos(angle) * donut.debugState().radius
    const donutY = donut.debugState().center.y + Math.sin(angle) * donut.debugState().radius
    donut.onPointerDown(pointer('down', donutX, donutY))
    expect(donutClick).toHaveBeenCalledWith(expect.objectContaining({ index: 1 }))

    const sparkClick = vi.fn()
    const spark = new RenderSparkline({ values: [1, 2, 3], onPointClick: sparkClick })
    spark.layout({ minWidth: 0, maxWidth: 180, minHeight: 0, maxHeight: 80 })
    spark.onPointerDown(pointer('down', 90, 40))
    expect(sparkClick).toHaveBeenCalledWith(1, 2)
  })

  it('preserves legend visibility by series identity when refreshed data changes order', () => {
    const data = [{ x: 0, y: 1 }]
    const line = new RenderLineChart({
      series: [{ id: 'a', name: '甲', data }, { id: 'b', name: '乙', data }],
      visibleSeries: [0],
    })
    line.setSeries([{ id: 'b', name: '乙改名', data }, { id: 'a', name: '甲', data }])
    expect(line.getVisibleSeries()).toEqual([1])

    const bar = new RenderBarChart({
      categories: ['一'],
      series: [{ name: '甲', data: [1] }, { name: '乙', data: [2] }],
      visibleSeries: [0],
    })
    bar.setData(['一'], [{ name: '乙', data: [3] }, { name: '甲', data: [4] }])
    expect(bar.getVisibleSeries()).toEqual([1])

    const donut = new RenderDonutChart({
      segments: [{ id: 'a', label: '甲', value: 1 }, { id: 'b', label: '乙', value: 2 }],
      visibleSegments: [0],
    })
    donut.setSegments([{ id: 'b', label: '乙改名', value: 3 }, { id: 'a', label: '甲', value: 4 }])
    expect(donut.getVisibleSegments()).toEqual([1])
  })

  it('notifies linked range controls when new series clamp an existing viewport', () => {
    const onLineViewportChange = vi.fn()
    const line = new RenderLineChart({
      series: [{ name: '趋势', data: [{ x: 0, y: 1 }, { x: 100, y: 2 }] }],
      xViewport: { min: 60, max: 90 },
      onViewportChange: onLineViewportChange,
    })
    line.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 220 })
    line.setSeries([{ name: '趋势', data: [{ x: 0, y: 1 }, { x: 20, y: 2 }] }])
    expect(line.getXViewport().max).toBe(20)
    expect(onLineViewportChange).toHaveBeenCalledWith(expect.objectContaining({ reason: 'api' }))

    const onSliderViewportChange = vi.fn()
    const slider = new RenderChartRangeSlider({
      series: [{ name: '趋势', data: [{ x: 0, y: 1 }, { x: 100, y: 2 }] }],
      viewport: { min: 60, max: 90 },
      onViewportChange: onSliderViewportChange,
    })
    slider.setSeries([{ name: '趋势', data: [{ x: 0, y: 1 }, { x: 20, y: 2 }] }])
    expect(slider.getViewport().max).toBe(20)
    expect(onSliderViewportChange).toHaveBeenCalledWith(expect.objectContaining({ reason: 'api' }))
  })

  it('bounds decimation even when most valid points are separated by missing values', () => {
    const data = Array.from({ length: 20_000 }, (_item, index) => ({
      x: index,
      y: index % 2 === 0 ? index : null,
    }))
    const chart = new RenderLineChart({ series: [{ name: '趋势', data }] })
    const slider = new RenderChartRangeSlider({ series: [{ name: '趋势', data }] })
    chart.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: 220 })
    slider.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: 80 })

    const points = chart.debugState().points
    const preview = slider.debugState().previewPoints
    expect(points.length).toBeLessThanOrEqual(chart.debugState().plot.width * 2 + 2)
    expect(preview.length).toBeLessThanOrEqual(slider.debugState().track.width * 2)
    expect(points.slice(1).every(point => point.breakBefore)).toBe(true)
    expect(preview.slice(1).every(point => point.breakBefore)).toBe(true)
    const linePaint = createRecordingPaintContext()
    const sliderPaint = createRecordingPaintContext()
    chart.paint(linePaint.context, { x: 0, y: 0 })
    slider.paint(sliderPaint.context, { x: 0, y: 0 })
    expect(linePaint.arc).toHaveBeenCalled()
    expect(sliderPaint.arc).toHaveBeenCalled()
  })

  it('preserves drawable segments when decimating frequent short runs', () => {
    const data = Array.from({ length: 20_000 }, (_item, index) => ({
      x: index,
      y: index % 40 === 39 ? null : Math.sin(index / 15),
    }))
    data[12_345]!.y = 999
    const chart = new RenderLineChart({ series: [{ name: '趋势', data }] })
    const slider = new RenderChartRangeSlider({ series: [{ name: '趋势', data }] })
    chart.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: 220 })
    slider.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: 80 })
    const points = chart.debugState().points
    const preview = slider.debugState().previewPoints
    expect(points.length).toBeLessThanOrEqual(chart.debugState().plot.width * 4 + 2)
    expect(preview.length).toBeLessThanOrEqual(slider.debugState().track.width * 4)
    expect(points.some((point, index) => index > 0 && !point.breakBefore)).toBe(true)
    expect(preview.some((point, index) => index > 0 && !point.breakBefore)).toBe(true)
    expect(points.some(point => point.value === 999)).toBe(true)
  })

  it('excludes invalid numeric and Date x values from time domains', () => {
    const first = Date.parse('2026-01-01T00:00:00Z')
    const last = Date.parse('2026-01-02T00:00:00Z')
    const series = [{
      name: '趋势',
      data: [
        { x: new Date(first), y: 1 },
        { x: new Date('invalid'), y: 2 },
        { x: Number.NaN, y: 4 },
        { x: new Date(last), y: 3 },
      ],
    }]
    const chart = new RenderLineChart({ series, decimation: 'none' })
    const slider = new RenderChartRangeSlider({ series })
    chart.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 220 })
    slider.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 80 })
    expect(chart.debugState().xDomain).toEqual({ min: first, max: last })
    expect(chart.debugState().points.map(point => point.pointIndex)).toEqual([0, 3])
    expect(slider.getFullDomain()).toEqual({ min: first, max: last })
  })

  it('keeps missing occurrences aligned across stacked series with repeated x values', () => {
    const chart = new RenderLineChart({
      series: [
        { name: '甲', data: [{ x: 1, y: 1 }, { x: 1, y: null }, { x: 1, y: 3 }] },
        { name: '乙', data: [{ x: 1, y: 10 }, { x: 1, y: 20 }, { x: 1, y: 30 }] },
      ],
      stackMode: 'stacked',
      decimation: 'none',
    })
    chart.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 220 })

    expect(chart.debugState().points.filter(point => point.seriesIndex === 1).map(point => point.stackValue)).toEqual([11, 20, 33])
  })

  it('keeps linked line and range viewports aligned when the full domain expands', () => {
    const oldSeries = [{ name: '趋势', data: [{ x: 0, y: 1 }, { x: 100, y: 2 }] }]
    const nextSeries = [{ name: '趋势', data: [{ x: 0, y: 1 }, { x: 200, y: 2 }] }]
    for (const updateLineFirst of [true, false]) {
      const line = new RenderLineChart({ series: oldSeries })
      const slider = new RenderChartRangeSlider({ series: oldSeries })
      line.onViewportChange = event => slider.setViewport(event.viewport, event.reason)
      slider.onViewportChange = event => line.setXViewport(event.viewport, event.reason)
      line.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 220 })
      slider.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 80 })
      if (updateLineFirst) {
        line.setSeries(nextSeries)
        slider.setSeries(nextSeries)
      } else {
        slider.setSeries(nextSeries)
        line.setSeries(nextSeries)
      }
      expect(line.getXViewport()).toEqual({ min: 0, max: 200 })
      expect(slider.getViewport()).toEqual({ min: 0, max: 200 })
    }
  })

  it('updates range state after direct series replacement and layout', () => {
    const slider = new RenderChartRangeSlider({
      series: [{ name: '趋势', data: [{ x: 0, y: 1 }] }],
    })
    slider.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: 80 })
    slider.series = []
    slider.markNeedsLayout()
    slider.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: 80 })
    expect(slider.debugState().state.state).toBe('empty')
    expect(slider.debugState().previewPoints).toEqual([])
  })
})
