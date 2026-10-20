import { describe, expect, it } from 'vitest'
import { createChartExamples } from '../../examples/basic-app/src/chart_examples'

// Runs after packing and installing the public library into the example.
describe('packed chart example composition', () => {
  it.each([340, 960])('lays out both charts and wires clicks to the selection summary at width %s', width => {
    const sample = createChartExamples()
    try {
      sample.root.layout({ minWidth: width, maxWidth: width, minHeight: 0, maxHeight: Infinity })
      for (const chart of [sample.combo, sample.scatter]) {
        expect(chart.size.width).toBeGreaterThan(100)
        expect(chart.globalOffset.x).toBeGreaterThanOrEqual(0)
        expect(chart.globalOffset.x + chart.size.width).toBeLessThanOrEqual(width)
      }
      const combo = sample.combo.debugState()
      expect(combo.bars).toHaveLength(4)
      expect(combo.bars.some(bar => bar.categoryIndex === 2)).toBe(false)
      const bar = combo.bars[0]!
      sample.combo.onPointerDown({ pointerId: 1, type: 'down', position: {
        x: sample.combo.globalOffset.x + bar.x + bar.width / 2,
        y: sample.combo.globalOffset.y + bar.y + bar.height / 2,
      } })
      expect(sample.selection.text).toBe('Mon: Completed = 80 tasks')
      const scatter = sample.scatter.debugState()
      expect(scatter.points.filter(point => point.xValue === 20)).toHaveLength(2)
      const outlier = scatter.points.find(point => point.id === 'e')!
      sample.scatter.onPointerDown({ pointerId: 1, type: 'down', position: {
        x: sample.scatter.globalOffset.x + outlier.x, y: sample.scatter.globalOffset.y + outlier.y,
      } })
      expect(sample.selection.text).toBe('Request E: 15 KB / 130 ms')
      expect(sample.selection.tooltip).toBe(sample.selection.text)
      const legend = scatter.legend[1]!
      sample.scatter.onPointerDown({ pointerId: 1, type: 'down', position: {
        x: sample.scatter.globalOffset.x + legend.x + 4, y: sample.scatter.globalOffset.y + legend.y + legend.height / 2,
      } })
      expect(sample.scatter.getVisibleSeries()).toEqual([0])
    } finally { sample.root.dispose() }
    expect(sample.combo.onItemClick).toBeUndefined()
    expect(sample.scatter.onPointClick).toBeUndefined()
  })
})
