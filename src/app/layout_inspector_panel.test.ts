// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { RenderDebugInfo } from '../core/render_object'
import type { LayoutInspectorDebugState } from '../runtime/layout_inspector_service'
import type { RuntimePaintRequestRecord } from '../runtime/runtime_host'
import { RenderLayoutInspectorPanel } from './layout_inspector_panel'

function debugInfo(debugId: number, typeName: string): RenderDebugInfo {
  return {
    debugId,
    typeName,
    visible: true,
    offset: { x: debugId, y: debugId },
    globalOffset: { x: debugId * 2, y: debugId * 2 },
    size: { width: 100 + debugId, height: 40 + debugId },
    needsLayout: false,
    needsPaint: false,
  }
}

function selectedState(): LayoutInspectorDebugState {
  const root = debugInfo(1, 'RenderWindow')
  const content = debugInfo(2, 'RenderStackPanel')
  const selected = debugInfo(3, 'RenderText')
  return {
    enabled: true,
    overlayVisible: true,
    hoverPathLength: 3,
    selectedPathLength: 3,
    selectedPathIndex: 2,
    hoverPathInfo: [root, content, selected],
    selectedPathInfo: [root, content, selected],
    selected,
    selectedAppContext: [
      { key: 'demo.user', source: 'RenderWindow', value: '组件审查员', rawValue: { displayName: '组件审查员' } },
    ],
    renderTree: {
      info: root,
      children: [
        {
          info: content,
          children: [{ info: selected, children: [] }],
        },
      ],
    },
  }
}

function request(seq: number, reason = 'pipeline:paint'): RuntimePaintRequestRecord {
  return {
    seq,
    time: seq * 10,
    kind: 'frame',
    source: 'pipeline',
    reason,
    detail: { type: 'paint', target: 'RenderTextBox' },
    alreadyScheduled: false,
    layoutNeeded: false,
    dirtyLayers: [],
    pipeline: {
      layoutCount: 0,
      paintCount: 1,
      transientPaintCount: 0,
      layoutTargets: [],
      paintTargets: ['RenderTextBox'],
      transientPaintTargets: [],
    },
  }
}

describe('RenderLayoutInspectorPanel runtime diagnostics', () => {
  it('organizes inspector content into dockable documents', () => {
    const panel = new RenderLayoutInspectorPanel()

    panel.setInspectorState(selectedState())

    expect(panel.debugDockManager().documents.map(document => ({
      tabId: document.tabId,
      title: document.title,
      closable: document.closable,
    }))).toEqual([
      { tabId: 'render-tree', title: 'Render Tree', closable: false },
      { tabId: 'object-inspector', title: 'Object Inspector', closable: false },
      { tabId: 'selection-summary', title: 'Selection Summary', closable: false },
      { tabId: 'hit-path', title: 'Hit Path', closable: false },
      { tabId: 'app-context', title: 'App Context', closable: false },
      { tabId: 'recent-requests', title: 'Recent Requests', closable: false },
    ])
    panel.layout({ minWidth: 0, maxWidth: 1000, minHeight: 0, maxHeight: 800 })
    expect(panel.debugDockManager().root.type).toBe('split')
    expect(panel.debugState().treeNodeLabels).toEqual([
      'RenderWindow #1',
      'RenderStackPanel #2',
      'RenderText #3',
    ])
  })

  it('does not invalidate layout when runtime debug state is unchanged', () => {
    const panel = new RenderLayoutInspectorPanel()
    const state = {
      paintRequestDebugEnabled: true,
      paintRequests: [request(1)],
    }
    panel.setRuntimeDebugState(state)
    const markNeedsLayout = vi.spyOn(panel.debugView(), 'markNeedsLayout')
    const markNeedsPaint = vi.spyOn(panel.debugView(), 'markNeedsPaint')

    panel.setRuntimeDebugState(state)

    expect(markNeedsLayout).not.toHaveBeenCalled()
    expect(markNeedsPaint).not.toHaveBeenCalled()
  })

  it('updates runtime debug requests when request content changes', () => {
    const panel = new RenderLayoutInspectorPanel()
    panel.setRuntimeDebugState({
      paintRequestDebugEnabled: true,
      paintRequests: [request(1)],
    })
    const markNeedsLayout = vi.spyOn(panel.debugView(), 'markNeedsLayout')

    panel.setRuntimeDebugState({
      paintRequestDebugEnabled: true,
      paintRequests: [request(1, 'pipeline:transient-paint')],
    })

    expect(markNeedsLayout).toHaveBeenCalledTimes(1)
    expect(panel.debugState().paintRequestText).toContain('pipeline:transient-paint')
  })
})
