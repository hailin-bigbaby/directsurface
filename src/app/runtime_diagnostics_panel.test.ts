// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { RuntimePaintRequestRecord } from '../runtime/runtime_host'
import { RenderRuntimeDiagnosticsPanel } from './runtime_diagnostics_panel'

function request(seq: number): RuntimePaintRequestRecord {
  return {
    seq,
    time: seq * 10,
    kind: seq % 2 === 0 ? 'frame' : 'layout',
    source: 'pipeline',
    reason: seq % 2 === 0 ? 'pipeline:paint' : 'pipeline:layout',
    detail: { type: seq % 2 === 0 ? 'paint' : 'layout', target: 'RenderTextBox' },
    alreadyScheduled: false,
    layoutNeeded: false,
    dirtyLayers: [],
    pipeline: {
      layoutCount: seq % 2 === 0 ? 0 : 1,
      paintCount: seq % 2 === 0 ? 1 : 0,
      transientPaintCount: 0,
      layoutTargets: seq % 2 === 0 ? [] : ['RenderTextBox'],
      paintTargets: seq % 2 === 0 ? ['RenderTextBox'] : [],
      transientPaintTargets: [],
    },
  }
}

describe('RenderRuntimeDiagnosticsPanel', () => {
  it('lays out request list and detail panel from remaining window space when resized', () => {
    const panel = new RenderRuntimeDiagnosticsPanel({
      state: {
        paintRequestDebugEnabled: false,
        paintRequests: Array.from({ length: 12 }, (_, index) => request(index + 1)),
      },
    })

    panel.windowWidth = 920
    panel.windowHeight = 700
    panel.layout({ minWidth: 0, maxWidth: 1000, minHeight: 0, maxHeight: 800 })
    const initialListSize = { ...panel.debugRequestList().size }
    const initialDetailSize = { ...panel.debugDetailInspector().parent!.size }

    expect(initialListSize.height).toBeGreaterThanOrEqual(300)
    expect(initialDetailSize.height).toBe(initialListSize.height)

    panel.windowWidth = 560
    panel.windowHeight = 360
    panel.layout({ minWidth: 0, maxWidth: 1000, minHeight: 0, maxHeight: 800 })
    const resizedListSize = panel.debugRequestList().size
    const resizedDetailSize = panel.debugDetailInspector().parent!.size

    expect(panel.debugState().compact).toBe(true)
    expect(resizedListSize.width).toBeLessThanOrEqual(panel.size.width)
    expect(resizedListSize.height).toBeLessThan(initialListSize.height)
    expect(resizedListSize.height).toBeGreaterThan(60)
    expect(panel.debugDetailInspector().parent!.visible).toBe(false)
    expect(resizedDetailSize.height).toBe(0)
  })

  it('does not invalidate layout when the diagnostics state is unchanged', () => {
    const state = {
      paintRequestDebugEnabled: false,
      paintRequests: [request(1)],
    }
    const panel = new RenderRuntimeDiagnosticsPanel({ state })
    const markNeedsLayout = vi.spyOn(panel.debugView(), 'markNeedsLayout')
    const markNeedsPaint = vi.spyOn(panel.debugView(), 'markNeedsPaint')

    panel.setDiagnosticsState(state)

    expect(markNeedsLayout).not.toHaveBeenCalled()
    expect(markNeedsPaint).not.toHaveBeenCalled()

    panel.setDiagnosticsState({
      paintRequestDebugEnabled: true,
      paintRequests: state.paintRequests,
    })

    expect(markNeedsLayout).toHaveBeenCalledTimes(1)
    expect(markNeedsPaint).toHaveBeenCalledTimes(1)
  })

  it('updates when request content changes without changing list boundaries', () => {
    const panel = new RenderRuntimeDiagnosticsPanel({
      state: {
        paintRequestDebugEnabled: false,
        paintRequests: [request(1), request(2)],
      },
    })
    const markNeedsLayout = vi.spyOn(panel.debugView(), 'markNeedsLayout')

    panel.setDiagnosticsState({
      paintRequestDebugEnabled: false,
      paintRequests: [
        request(1),
        {
          ...request(2),
          reason: 'pipeline:transient-paint',
          source: 'runtime',
        },
      ],
    })

    expect(markNeedsLayout).toHaveBeenCalledTimes(1)
    expect(panel.debugState().listLabels[0]).toBe('#2 frame pipeline:transient-paint')
  })

  it('updates when request details change without changing request identity fields', () => {
    const initial = {
      ...request(2),
      dirtyLayers: [{ layer: 'main', dirty: 'full' as const }],
      stack: ['at first()'],
    }
    const panel = new RenderRuntimeDiagnosticsPanel({
      state: {
        paintRequestDebugEnabled: true,
        paintRequests: [initial],
      },
    })
    const markNeedsLayout = vi.spyOn(panel.debugView(), 'markNeedsLayout')

    panel.setDiagnosticsState({
      paintRequestDebugEnabled: true,
      paintRequests: [{
        ...initial,
        dirtyLayers: [{ layer: 'overlay', dirty: 'full' as const }],
        pipeline: {
          ...initial.pipeline,
          paintCount: initial.pipeline.paintCount + 1,
        },
        stack: ['at second()'],
      }],
    })

    expect(markNeedsLayout).toHaveBeenCalledTimes(1)
    expect(panel.debugDetailInspector().debugState().detailText).toContain('runtime.request')
  })

  it('filters requests by kind, source, and query while preserving current detail selection', () => {
    const requests: RuntimePaintRequestRecord[] = [
      request(1),
      {
        ...request(2),
        source: 'overlay',
        reason: 'performance-overlay',
        detail: { type: 'paint', target: 'RenderPerformanceOverlay' },
        pipeline: {
          ...request(2).pipeline,
          paintTargets: ['RenderPerformanceOverlay'],
        },
      },
      {
        ...request(3),
        reason: 'pipeline:layout',
        detail: { type: 'layout', target: 'RenderPlainTextEditor' },
        pipeline: {
          ...request(3).pipeline,
          layoutTargets: ['RenderPlainTextEditor'],
        },
      },
      {
        ...request(4),
        source: 'window',
        reason: 'activate-window',
        detail: 'RenderWindow',
      },
    ]
    const panel = new RenderRuntimeDiagnosticsPanel({
      state: {
        paintRequestDebugEnabled: false,
        paintRequests: requests,
      },
    })

    expect(panel.debugState()).toMatchObject({
      requestCount: 4,
      filteredRequestCount: 4,
      selectedSeq: 4,
    })

    panel.setKindFilter('layout')

    expect(panel.debugState()).toMatchObject({
      kindFilter: 'layout',
      filteredRequestCount: 2,
      selectedSeq: 4,
    })
    expect(panel.debugState().listLabels).toEqual([
      '#3 layout pipeline:layout',
      '#1 layout pipeline:layout',
    ])
    expect(panel.debugState().summaryText).toContain('selected #4 frame activate-window')

    panel.setSourceFilter('pipeline')

    expect(panel.debugState()).toMatchObject({
      sourceFilter: 'pipeline',
      filteredRequestCount: 2,
    })

    panel.setQueryFilter('plaintext')

    expect(panel.debugState()).toMatchObject({
      queryFilter: 'plaintext',
      filteredRequestCount: 1,
    })
    expect(panel.debugState().listLabels).toEqual(['#3 layout pipeline:layout'])

    panel.clearFilters()

    expect(panel.debugState()).toMatchObject({
      kindFilter: 'all',
      sourceFilter: 'all',
      queryFilter: '',
      filteredRequestCount: 4,
      selectedSeq: 4,
    })
  })

  it('aggregates filtered requests into hotspot groups', () => {
    const requests: RuntimePaintRequestRecord[] = [
      {
        ...request(1),
        detail: { type: 'layout', target: 'RenderPlainTextEditor' },
        pipeline: {
          ...request(1).pipeline,
          layoutTargets: ['RenderPlainTextEditor'],
        },
      },
      {
        ...request(3),
        detail: { type: 'layout', target: 'RenderPlainTextEditor' },
        alreadyScheduled: true,
        layoutNeeded: true,
        dirtyLayers: [{ layer: 'main', dirty: 'full' }],
        pipeline: {
          ...request(3).pipeline,
          layoutTargets: ['RenderPlainTextEditor'],
        },
      },
      {
        ...request(2),
        source: 'overlay',
        reason: 'performance-overlay',
        detail: { type: 'paint', target: 'RenderPerformanceOverlay' },
        pipeline: {
          ...request(2).pipeline,
          paintTargets: ['RenderPerformanceOverlay'],
        },
      },
    ]
    const panel = new RenderRuntimeDiagnosticsPanel({
      state: {
        paintRequestDebugEnabled: false,
        paintRequests: requests,
      },
    })

    panel.setViewMode('hotspots')

    expect(panel.debugState()).toMatchObject({
      viewMode: 'hotspots',
      aggregateCount: 2,
    })
    expect(panel.debugState().listLabels).toEqual([
      'RenderPlainTextEditor ×2',
      'RenderPerformanceOverlay ×1',
    ])
    expect(panel.debugState().summaryText).toContain('hotspot RenderPlainTextEditor ×2')
    expect(panel.debugRequestList().getCopyText()).toContain('alreadyScheduledCount')

    panel.setSourceFilter('overlay')

    expect(panel.debugState()).toMatchObject({
      filteredRequestCount: 1,
      aggregateCount: 1,
      selectedAggregateKey: 'RenderPerformanceOverlay\nframe\noverlay\nperformance-overlay',
    })
    expect(panel.debugState().listLabels).toEqual(['RenderPerformanceOverlay ×1'])
  })
})
