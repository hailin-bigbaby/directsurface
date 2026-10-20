// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { RuntimeDiagnosticsSnapshot } from '../runtime/runtime_host'
import {
  RenderRuntimeDiagnosticsSnapshotViewer,
  RuntimeDiagnosticsSnapshotValidationError,
  parseRuntimeDiagnosticsSnapshotJson,
  validateRuntimeDiagnosticsSnapshot,
} from './runtime_diagnostics_snapshot_viewer'

function snapshot(): RuntimeDiagnosticsSnapshot {
  return {
    version: 1,
    createdAt: '2026-05-13T00:00:00.000Z',
    environment: {
      userAgent: 'test',
      viewport: { width: 320, height: 240, dpr: 1 },
      canvas: { width: 320, height: 240, styleWidth: '320px', styleHeight: '240px' },
      dpr: 1,
    },
    runtime: {
      disposed: false,
      rootCount: 1,
      mountedWindowCount: 1,
      performanceOverlayVisible: true,
      paintRequestDebugEnabled: true,
      frameScheduled: false,
      layoutNeeded: false,
    },
    layers: {
      registered: ['main'],
      dirty: [],
    },
    pipeline: {
      layoutCount: 0,
      paintCount: 0,
      transientPaintCount: 0,
      layoutTargets: [],
      paintTargets: [],
      transientPaintTargets: [],
    },
    paintRequests: [{
      seq: 1,
      time: 10,
      kind: 'frame',
      source: 'runtime',
      reason: 'manual',
      alreadyScheduled: false,
      layoutNeeded: false,
      dirtyLayers: [],
      pipeline: {
        layoutCount: 0,
        paintCount: 1,
        transientPaintCount: 0,
        layoutTargets: [],
        paintTargets: ['RenderWindow'],
        transientPaintTargets: [],
      },
    }],
    hotspots: [{
      key: 'RenderWindow\nframe\nruntime\nmanual',
      target: 'RenderWindow',
      kind: 'frame',
      source: 'runtime',
      reason: 'manual',
      count: 1,
      firstSeq: 1,
      lastSeq: 1,
      layoutTargets: [],
      paintTargets: ['RenderWindow'],
      transientPaintTargets: [],
    }],
    performance: {
      state: {
        visible: true,
        minimized: false,
        sampleCount: 0,
        averageTotalMs: 0,
        slowFrameCount: 0,
        bounds: { x: 0, y: 0, width: 100, height: 80 },
        headerRect: { x: 0, y: 0, width: 100, height: 32 },
        toggleButtonRect: { x: 80, y: 6, width: 20, height: 20 },
      },
      samples: [],
    },
    layoutInspector: {
      enabled: false,
      overlayVisible: false,
      hoverPathLength: 0,
      selectedPathLength: 0,
      selectedPathIndex: -1,
      hoverPathInfo: [],
      selectedPathInfo: [],
    },
    appContext: [],
    roots: [],
    windows: [],
  }
}

describe('RenderRuntimeDiagnosticsSnapshotViewer', () => {
  it('shows validated snapshot sections and details', () => {
    const viewer = new RenderRuntimeDiagnosticsSnapshotViewer(snapshot())

    expect(viewer.debugState()).toMatchObject({
      valid: true,
      selectedSection: 'overview',
      sectionLabels: [
        'Overview',
        'Environment',
        'Runtime',
        'Layers (1)',
        'Pipeline',
        'Requests (1)',
        'Hotspots (1)',
        'Performance (0)',
        'Layout Inspector',
        'App Context (0)',
        'Render Roots (0)',
        'Windows (0)',
      ],
    })
    expect(viewer.debugState().summaryText).toContain('requests 1')
    expect(viewer.debugInspector().debugState().roots[0]?.path).toBe('snapshot.overview')
  })

  it('parses and validates snapshot json', () => {
    const parsed = parseRuntimeDiagnosticsSnapshotJson(JSON.stringify(snapshot()))

    expect(parsed.version).toBe(1)
    expect(validateRuntimeDiagnosticsSnapshot(parsed)).toBe(parsed)
  })

  it('rejects malformed or unsupported snapshots with explicit errors', () => {
    expect(() => parseRuntimeDiagnosticsSnapshotJson('{bad')).toThrow(RuntimeDiagnosticsSnapshotValidationError)
    expect(() => validateRuntimeDiagnosticsSnapshot({ version: 2 })).toThrow('Unsupported diagnostics snapshot version: 2')
    expect(() => validateRuntimeDiagnosticsSnapshot({ version: 1 })).toThrow('missing "createdAt"')
    expect(() => validateRuntimeDiagnosticsSnapshot({
      ...snapshot(),
      appContext: {},
    })).toThrow('"appContext" must be an array')
    expect(() => validateRuntimeDiagnosticsSnapshot({
      ...snapshot(),
      performance: { state: {}, samples: {} },
    })).toThrow('"performance.samples" must be an array')
  })
})
