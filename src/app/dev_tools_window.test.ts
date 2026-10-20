// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { RenderBox } from '../layout/render_box'
import type { BoxConstraints, LayoutContext, Offset, RenderDebugInfo, RenderObject } from '../core/render_object'
import type { LayoutInspectorDebugState } from '../runtime/layout_inspector_service'
import type { RuntimePaintRequestRecord } from '../runtime/runtime_host'
import type { PaintContext } from '../rendering/paint_context'
import { RenderText } from '../widgets/basic'
import { RenderDevToolsWindow } from './dev_tools_window'

class TestDevToolsTabContent extends RenderBox {
  disposed = false

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(_constraints: BoxConstraints, _context: LayoutContext): void {
    this.size = { width: 120, height: 32 }
  }

  performPaint(_context: PaintContext, _offset: Offset): void {}

  override dispose(): void {
    this.disposed = true
    super.dispose()
  }
}

class ThrowingDevToolsTabContent extends TestDevToolsTabContent {
  override dispose(): void {
    this.disposed = true
    throw new Error('custom tab dispose failed')
  }
}

function debugInfo(debugId: number, typeName: string): RenderDebugInfo {
  return {
    debugId,
    typeName,
    visible: true,
    offset: { x: 0, y: 0 },
    globalOffset: { x: debugId, y: debugId },
    size: { width: 120, height: 32 },
    needsLayout: false,
    needsPaint: false,
  }
}

function layoutState(): LayoutInspectorDebugState {
  const root = debugInfo(1, 'RenderWindow')
  const selected = debugInfo(2, 'RenderText')
  return {
    enabled: true,
    overlayVisible: true,
    hoverPathLength: 2,
    selectedPathLength: 2,
    selectedPathIndex: 1,
    hoverPathInfo: [root, selected],
    selectedPathInfo: [root, selected],
    selected,
    selectedAppContext: [],
    renderTree: {
      info: root,
      children: [{ info: selected, children: [] }],
    },
  }
}

function request(seq: number): RuntimePaintRequestRecord {
  return {
    seq,
    time: seq * 10,
    kind: 'frame',
    source: 'pipeline',
    reason: 'pipeline:paint',
    detail: { type: 'paint', target: 'RenderText' },
    alreadyScheduled: false,
    layoutNeeded: false,
    dirtyLayers: [],
    pipeline: {
      layoutCount: 0,
      paintCount: 1,
      transientPaintCount: 0,
      layoutTargets: [],
      paintTargets: ['RenderText'],
      transientPaintTargets: [],
    },
  }
}

describe('RenderDevToolsWindow', () => {
  it('hosts layout and runtime tools as switchable tabs', () => {
    const window = new RenderDevToolsWindow({
      runtimeDiagnostics: {
        state: {
          paintRequestDebugEnabled: false,
          paintRequests: [],
        },
      },
    })

    expect(window.debugDevToolsState().activeTab).toBe('layout-inspector')
    expect(window.debugDevToolsState().tabs).toEqual(['layout-inspector', 'runtime'])

    window.activateTab('runtime')

    expect(window.debugDevToolsState().activeTab).toBe('runtime')
    expect(window.debugState().selectedTypeName).toBe('')
  })

  it('syncs layout inspector and runtime diagnostics state into pages', () => {
    const window = new RenderDevToolsWindow({
      runtimeDiagnostics: {
        state: {
          paintRequestDebugEnabled: false,
          paintRequests: [],
        },
      },
    })

    window.setLayoutInspectorState(layoutState())
    window.setLayoutRuntimeDebugState({
      paintRequestDebugEnabled: true,
      paintRequests: [request(1)],
    })
    window.setRuntimeDiagnosticsState({
      paintRequestDebugEnabled: true,
      paintRequests: [request(1), request(2)],
    })

    expect(window.debugDevToolsState().layoutInspector.selectedTypeName).toBe('RenderText')
    expect(window.debugDevToolsState().layoutInspector.paintRequestCount).toBe(1)
    expect(window.debugDevToolsState().runtimeDiagnostics.requestCount).toBe(2)
    expect(window.debugLayoutInspectorState().selectedTypeName).toBe('RenderText')
    expect(window.debugRuntimeDiagnosticsState().requestCount).toBe(2)
  })

  it('hosts custom DevTools tabs and falls back when they are removed', () => {
    const network = new TestDevToolsTabContent()
    const logs = new RenderText('Logs')
    const window = new RenderDevToolsWindow({
      activeTab: 'network',
      runtimeDiagnostics: {
        state: {
          paintRequestDebugEnabled: false,
          paintRequests: [],
        },
      },
      extraTabs: [
        { key: 'network', label: 'Network', icon: 'server', content: network },
      ],
    })

    expect(window.debugDevToolsState().activeTab).toBe('network')
    expect(window.debugDevToolsState().tabs).toEqual(['layout-inspector', 'runtime', 'network'])

    window.setExtraTabs([
      { key: 'logs', label: 'Logs', icon: 'document', content: logs },
    ])

    expect(network.disposed).toBe(true)
    expect(window.debugDevToolsState().activeTab).toBe('layout-inspector')
    expect(window.debugDevToolsState().tabs).toEqual(['layout-inspector', 'runtime', 'logs'])

    window.activateTab('logs')

    expect(window.debugDevToolsState().activeTab).toBe('logs')
  })

  it('disposes inactive custom tab content when the window is disposed', () => {
    const network = new TestDevToolsTabContent()
    const window = new RenderDevToolsWindow({
      activeTab: 'layout-inspector',
      runtimeDiagnostics: {
        state: {
          paintRequestDebugEnabled: false,
          paintRequests: [],
        },
      },
      extraTabs: [
        { key: 'network', label: 'Network', icon: 'server', content: network },
      ],
    })

    window.dispose()

    expect(network.disposed).toBe(true)
  })

  it('finishes disposing every tab and the window when custom content disposal throws', () => {
    const disposeError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const throwing = new ThrowingDevToolsTabContent()
    const logs = new TestDevToolsTabContent()
    const window = new RenderDevToolsWindow({
      activeTab: 'throwing',
      runtimeDiagnostics: {
        state: {
          paintRequestDebugEnabled: false,
          paintRequests: [],
        },
      },
      extraTabs: [
        { key: 'throwing', label: 'Throwing', content: throwing },
        { key: 'logs', label: 'Logs', content: logs },
      ],
    })

    expect(() => window.dispose()).not.toThrow()
    expect(throwing.disposed).toBe(true)
    expect(logs.disposed).toBe(true)
    expect(window.disposed).toBe(true)
    expect(disposeError).toHaveBeenCalledWith(
      'RenderDevToolsWindow failed to dispose tab content.',
      expect.any(Error),
    )
  })
})
