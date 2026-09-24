import { RenderGridPanel, gridAuto, gridFr } from '../layout/render_grid_panel'
import { RenderListView, type ListViewItem } from '../widgets/list_view'
import { RenderObjectInspector } from '../widgets/object_inspector'
import { RenderParagraph, RenderText } from '../widgets/basic'
import { RenderWindow } from '../widgets/window'
import type { RuntimeDiagnosticsSnapshot } from '../runtime/runtime_host'

export interface RuntimeDiagnosticsSnapshotViewerDebugState {
  valid: boolean
  title: string
  summaryText: string
  selectedSection: string
  sectionLabels: string[]
  detailRoots: string[]
}

export interface RuntimeDiagnosticsSnapshotSectionData {
  key: string
  label: string
  value: unknown
}

export class RuntimeDiagnosticsSnapshotValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeDiagnosticsSnapshotValidationError'
  }
}

export class RenderRuntimeDiagnosticsSnapshotViewer extends RenderWindow {
  static override debugTypeName = 'RenderRuntimeDiagnosticsSnapshotViewer'
  private readonly _summary = new RenderParagraph('')
  private readonly _sections: RenderListView<RuntimeDiagnosticsSnapshotSectionData>
  private readonly _inspector: RenderObjectInspector
  private _snapshot: RuntimeDiagnosticsSnapshot
  private _selectedSectionKey = 'overview'

  constructor(snapshot: unknown) {
    const validated = validateRuntimeDiagnosticsSnapshot(snapshot)
    const content = new RenderGridPanel({
      columns: [gridFr()],
      rows: [gridAuto(), gridAuto(), gridFr()],
      rowGap: 8,
    })
    super({
      title: 'Diagnostics Snapshot',
      x: 124,
      y: 88,
      width: 820,
      height: 560,
      minWidth: 580,
      minHeight: 380,
      contentPadding: 12,
      contentSpacing: 0,
    })
    this._snapshot = validated
    this._sections = new RenderListView<RuntimeDiagnosticsSnapshotSectionData>({
      items: [],
      minHeight: 160,
      onSelect: item => {
        this._selectedSectionKey = item.data?.key ?? 'overview'
        this._syncDetail()
      },
      onActivate: item => {
        this._selectedSectionKey = item.data?.key ?? 'overview'
        this._syncDetail()
      },
      copyText: item => item.data ? JSON.stringify(item.data.value, null, 2) : item.label,
    })
    this._inspector = new RenderObjectInspector({
      value: null,
      label: 'snapshot.overview',
      adaptiveTreeHeight: true,
      includePrototype: false,
    })
    const body = new RenderGridPanel({
      columns: [gridFr(0.34, { min: 180, max: 300 }), gridFr(0.66, { min: 260 })],
      rows: [gridFr()],
      columnGap: 10,
    })
    body.addChild(this._sections, { row: 0, column: 0 })
    body.addChild(this._inspector, { row: 0, column: 1 })
    content.addChild(new RenderText('Diagnostics Snapshot', { role: 'title', weight: 'semibold' }), { row: 0, column: 0 })
    content.addChild(this._summary, { row: 1, column: 0 })
    content.addChild(body, { row: 2, column: 0 })
    this.setChildren([content])
    this.setSnapshot(validated)
  }

  setSnapshot(snapshot: unknown): void {
    this._snapshot = validateRuntimeDiagnosticsSnapshot(snapshot)
    this._summary.text = formatSnapshotSummary(this._snapshot)
    const items = snapshotSections(this._snapshot).map(sectionToListItem)
    this._sections.items = items
    if (!items.some(item => item.key === this._selectedSectionKey)) this._selectedSectionKey = 'overview'
    this._sections.selectedItem = items.find(item => item.key === this._selectedSectionKey) ?? items[0] ?? null
    this._syncDetail()
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  debugState(): RuntimeDiagnosticsSnapshotViewerDebugState {
    return {
      valid: true,
      title: this.title,
      summaryText: this._summary.text,
      selectedSection: this._selectedSectionKey,
      sectionLabels: this._sections.items.map(item => item.label),
      detailRoots: this._inspector.debugState().roots.map(root => root.path),
    }
  }

  debugSectionList(): RenderListView<RuntimeDiagnosticsSnapshotSectionData> {
    return this._sections
  }

  debugInspector(): RenderObjectInspector {
    return this._inspector
  }

  private _syncDetail(): void {
    const section = snapshotSections(this._snapshot).find(item => item.key === this._selectedSectionKey) ?? snapshotSections(this._snapshot)[0]
    this._inspector.setValue(section?.value ?? null, `snapshot.${section?.key ?? 'empty'}`)
  }
}

export function parseRuntimeDiagnosticsSnapshotJson(text: string): RuntimeDiagnosticsSnapshot {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new RuntimeDiagnosticsSnapshotValidationError(error instanceof Error
      ? `Invalid diagnostics snapshot JSON: ${error.message}`
      : 'Invalid diagnostics snapshot JSON.')
  }
  return validateRuntimeDiagnosticsSnapshot(parsed)
}

export function validateRuntimeDiagnosticsSnapshot(value: unknown): RuntimeDiagnosticsSnapshot {
  if (!isRecord(value)) {
    throw new RuntimeDiagnosticsSnapshotValidationError('Diagnostics snapshot must be a JSON object.')
  }
  if (value.version !== 1) {
    throw new RuntimeDiagnosticsSnapshotValidationError(`Unsupported diagnostics snapshot version: ${String(value.version)}`)
  }
  for (const key of [
    'createdAt',
    'environment',
    'runtime',
    'layers',
    'pipeline',
    'paintRequests',
    'hotspots',
    'performance',
    'layoutInspector',
    'appContext',
    'roots',
    'windows',
  ]) {
    if (!(key in value)) {
      throw new RuntimeDiagnosticsSnapshotValidationError(`Diagnostics snapshot is missing "${key}".`)
    }
  }
  if (typeof value.createdAt !== 'string') {
    throw new RuntimeDiagnosticsSnapshotValidationError('Diagnostics snapshot "createdAt" must be a string.')
  }
  for (const key of ['environment', 'runtime', 'layers', 'pipeline', 'performance', 'layoutInspector']) {
    if (!isRecord(value[key])) {
      throw new RuntimeDiagnosticsSnapshotValidationError(`Diagnostics snapshot "${key}" must be an object.`)
    }
  }
  const layers = value.layers as Record<string, unknown>
  const performance = value.performance as Record<string, unknown>
  if (!Array.isArray(layers.registered)) {
    throw new RuntimeDiagnosticsSnapshotValidationError('Diagnostics snapshot "layers.registered" must be an array.')
  }
  if (!Array.isArray(performance.samples)) {
    throw new RuntimeDiagnosticsSnapshotValidationError('Diagnostics snapshot "performance.samples" must be an array.')
  }
  if (!Array.isArray(value.paintRequests)) {
    throw new RuntimeDiagnosticsSnapshotValidationError('Diagnostics snapshot "paintRequests" must be an array.')
  }
  if (!Array.isArray(value.hotspots)) {
    throw new RuntimeDiagnosticsSnapshotValidationError('Diagnostics snapshot "hotspots" must be an array.')
  }
  if (!Array.isArray(value.appContext)) {
    throw new RuntimeDiagnosticsSnapshotValidationError('Diagnostics snapshot "appContext" must be an array.')
  }
  if (!Array.isArray(value.roots)) {
    throw new RuntimeDiagnosticsSnapshotValidationError('Diagnostics snapshot "roots" must be an array.')
  }
  if (!Array.isArray(value.windows)) {
    throw new RuntimeDiagnosticsSnapshotValidationError('Diagnostics snapshot "windows" must be an array.')
  }
  return value as unknown as RuntimeDiagnosticsSnapshot
}

function snapshotSections(snapshot: RuntimeDiagnosticsSnapshot): RuntimeDiagnosticsSnapshotSectionData[] {
  return [
    {
      key: 'overview',
      label: 'Overview',
      value: {
        createdAt: snapshot.createdAt,
        environment: snapshot.environment,
        runtime: snapshot.runtime,
        counts: {
          requests: snapshot.paintRequests.length,
          hotspots: snapshot.hotspots.length,
          roots: snapshot.roots.length,
          windows: snapshot.windows.length,
          appContext: snapshot.appContext.length,
          performanceSamples: snapshot.performance.samples.length,
        },
      },
    },
    { key: 'environment', label: 'Environment', value: snapshot.environment },
    { key: 'runtime', label: 'Runtime', value: snapshot.runtime },
    { key: 'layers', label: `Layers (${snapshot.layers.registered.length})`, value: snapshot.layers },
    { key: 'pipeline', label: 'Pipeline', value: snapshot.pipeline },
    { key: 'requests', label: `Requests (${snapshot.paintRequests.length})`, value: snapshot.paintRequests },
    { key: 'hotspots', label: `Hotspots (${snapshot.hotspots.length})`, value: snapshot.hotspots },
    { key: 'performance', label: `Performance (${snapshot.performance.samples.length})`, value: snapshot.performance },
    { key: 'layoutInspector', label: 'Layout Inspector', value: snapshot.layoutInspector },
    { key: 'appContext', label: `App Context (${snapshot.appContext.length})`, value: snapshot.appContext },
    { key: 'roots', label: `Render Roots (${snapshot.roots.length})`, value: snapshot.roots },
    { key: 'windows', label: `Windows (${snapshot.windows.length})`, value: snapshot.windows },
  ]
}

function sectionToListItem(section: RuntimeDiagnosticsSnapshotSectionData): ListViewItem<RuntimeDiagnosticsSnapshotSectionData> {
  return {
    key: section.key,
    label: section.label,
    data: section,
  }
}

function formatSnapshotSummary(snapshot: RuntimeDiagnosticsSnapshot): string {
  return [
    `created ${snapshot.createdAt}`,
    `requests ${snapshot.paintRequests.length}  hotspots ${snapshot.hotspots.length}`,
    `roots ${snapshot.roots.length}  windows ${snapshot.windows.length}`,
  ].join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
