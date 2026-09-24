import { RenderGridPanel, gridAuto, gridFr } from '../layout/render_grid_panel'
import { RenderStackPanel } from '../layout/render_flex'
import { RenderButton } from '../widgets/button'
import { RenderCheckbox } from '../widgets/checkbox'
import { RenderListView, type ListViewItem } from '../widgets/list_view'
import { RenderObjectInspector } from '../widgets/object_inspector'
import { RenderParagraph, RenderText } from '../widgets/basic'
import { RenderSearchBox } from '../widgets/search_box'
import { RenderSegmentedControl } from '../widgets/segmented_control'
import { RenderWindow } from '../widgets/window'
import type { RuntimeDiagnosticsSnapshot, RuntimePaintRequestKind, RuntimePaintRequestRecord, RuntimePaintRequestSource } from '../runtime/runtime_host'

export interface RuntimeDiagnosticsState {
  paintRequestDebugEnabled: boolean
  paintRequests: RuntimePaintRequestRecord[]
}

export interface RuntimeDiagnosticsPanelDebugState {
  requestCount: number
  filteredRequestCount: number
  aggregateCount: number
  selectedSeq: number | null
  selectedAggregateKey: string | null
  paintRequestDebugEnabled: boolean
  viewMode: RuntimeDiagnosticsViewMode
  kindFilter: RuntimeDiagnosticsKindFilter
  sourceFilter: RuntimeDiagnosticsSourceFilter
  queryFilter: string
  listLabels: string[]
  detailRoots: string[]
  summaryText: string
}

export interface RenderRuntimeDiagnosticsPanelOptions {
  state: RuntimeDiagnosticsState
  onRefresh?: () => RuntimeDiagnosticsState
  onTogglePaintRequestDebug?: () => RuntimeDiagnosticsState
  onClearPaintRequestHistory?: () => RuntimeDiagnosticsState
  onExportDiagnosticsSnapshot?: () => RuntimeDiagnosticsSnapshot
}

interface RuntimeRequestListData {
  kind: 'request'
  record: RuntimePaintRequestRecord
}

interface RuntimeAggregateListData {
  kind: 'aggregate'
  aggregate: RuntimeRequestAggregate
}

type RuntimeDiagnosticsListData = RuntimeRequestListData | RuntimeAggregateListData

interface RuntimeRequestAggregate {
  key: string
  target: string
  kind: RuntimePaintRequestKind
  source: RuntimePaintRequestSource
  reason: string
  count: number
  firstSeq: number
  lastSeq: number
  firstTime: number
  lastTime: number
  alreadyScheduledCount: number
  layoutNeededCount: number
  dirtyLayerCount: number
  layoutTargets: string[]
  paintTargets: string[]
  transientPaintTargets: string[]
}

export type RuntimeDiagnosticsKindFilter = 'all' | RuntimePaintRequestKind
export type RuntimeDiagnosticsSourceFilter = 'all' | RuntimePaintRequestSource
export type RuntimeDiagnosticsViewMode = 'requests' | 'hotspots'

export class RenderRuntimeDiagnosticsView extends RenderGridPanel {
  static override debugTypeName = 'RenderRuntimeDiagnosticsView'
  private readonly _toolbar: RenderStackPanel
  private readonly _filterBar: RenderGridPanel
  private readonly _summary = new RenderParagraph('')
  private readonly _list: RenderListView<RuntimeDiagnosticsListData>
  private readonly _detailInspector: RenderObjectInspector
  private readonly _stackCheckbox: RenderCheckbox
  private readonly _refreshButton: RenderButton
  private readonly _clearButton: RenderButton
  private readonly _exportButton: RenderButton
  private readonly _viewMode: RenderSegmentedControl
  private readonly _kindFilter: RenderSegmentedControl
  private readonly _sourceFilter: RenderSegmentedControl
  private readonly _queryFilter: RenderSearchBox
  private _state: RuntimeDiagnosticsState
  private _stateSignature: string
  private _viewModeValue: RuntimeDiagnosticsViewMode = 'requests'
  private _kindFilterValue: RuntimeDiagnosticsKindFilter = 'all'
  private _sourceFilterValue: RuntimeDiagnosticsSourceFilter = 'all'
  private _queryFilterValue = ''
  private _selectedSeq: number | null = null
  private _selectedAggregateKey: string | null = null
  private readonly _onRefresh?: () => RuntimeDiagnosticsState
  private readonly _onTogglePaintRequestDebug?: () => RuntimeDiagnosticsState
  private readonly _onClearPaintRequestHistory?: () => RuntimeDiagnosticsState
  private readonly _onExportDiagnosticsSnapshot?: () => RuntimeDiagnosticsSnapshot

  constructor(options: RenderRuntimeDiagnosticsPanelOptions) {
    super({
      columns: [gridFr()],
      rows: [gridAuto(), gridAuto(), gridAuto(), gridAuto(), gridFr()],
      rowGap: 8,
    })
    this._state = normalizeState(options.state)
    this._stateSignature = stateSignature(this._state)
    this._onRefresh = options.onRefresh
    this._onTogglePaintRequestDebug = options.onTogglePaintRequestDebug
    this._onClearPaintRequestHistory = options.onClearPaintRequestHistory
    this._onExportDiagnosticsSnapshot = options.onExportDiagnosticsSnapshot
    this._toolbar = new RenderStackPanel({
      orientation: 'horizontal',
      spacing: 8,
      crossAxisAlignment: 'center',
    })
    this._stackCheckbox = new RenderCheckbox({
      checked: this._state.paintRequestDebugEnabled,
      label: 'Stack 日志',
      onChange: () => this._applyState(this._onTogglePaintRequestDebug?.() ?? {
        ...this._state,
        paintRequestDebugEnabled: !this._state.paintRequestDebugEnabled,
      }),
    })
    this._refreshButton = new RenderButton({
      label: '刷新',
      onClick: () => this._applyState(this._onRefresh?.() ?? this._state),
    })
    this._clearButton = new RenderButton({
      label: '清空',
      onClick: () => this._applyState(this._onClearPaintRequestHistory?.() ?? {
        ...this._state,
        paintRequests: [],
      }),
    })
    this._exportButton = new RenderButton({
      label: '导出',
      disabled: !this._onExportDiagnosticsSnapshot,
      onClick: () => {
        const snapshot = this._onExportDiagnosticsSnapshot?.()
        if (!snapshot) return
        this._detailInspector.setValue(snapshot, 'runtime.snapshot')
      },
    })
    this._viewMode = new RenderSegmentedControl({
      value: this._viewModeValue,
      options: [
        { value: 'requests', label: 'Requests' },
        { value: 'hotspots', label: 'Hotspots' },
      ],
      onChange: value => this.setViewMode(value as RuntimeDiagnosticsViewMode),
    })
    this._toolbar.addChild(this._stackCheckbox)
    this._toolbar.addChild(this._viewMode)
    this._toolbar.addChild(this._refreshButton)
    this._toolbar.addChild(this._clearButton)
    this._toolbar.addChild(this._exportButton)
    this._kindFilter = new RenderSegmentedControl({
      value: this._kindFilterValue,
      options: [
        { value: 'all', label: 'All' },
        { value: 'layout', label: 'Layout' },
        { value: 'frame', label: 'Frame' },
      ],
      onChange: value => this.setKindFilter(value as RuntimeDiagnosticsKindFilter),
    })
    this._sourceFilter = new RenderSegmentedControl({
      value: this._sourceFilterValue,
      options: [
        { value: 'all', label: 'All' },
        { value: 'pipeline', label: 'Pipe' },
        { value: 'overlay', label: 'Overlay' },
        { value: 'runtime', label: 'Runtime' },
        { value: 'window', label: 'Window' },
        { value: 'debug', label: 'Debug' },
      ],
      onChange: value => this.setSourceFilter(value as RuntimeDiagnosticsSourceFilter),
    })
    this._queryFilter = new RenderSearchBox({
      value: this._queryFilterValue,
      placeholder: 'Target / reason',
      onChange: value => this.setQueryFilter(value),
    })
    this._filterBar = new RenderGridPanel({
      columns: [gridAuto(), gridAuto(), gridFr()],
      rows: [gridAuto()],
      columnGap: 8,
    })
    this._filterBar.addChild(this._kindFilter, { row: 0, column: 0 })
    this._filterBar.addChild(this._sourceFilter, { row: 0, column: 1 })
    this._filterBar.addChild(this._queryFilter, { row: 0, column: 2 })
    this._list = new RenderListView<RuntimeDiagnosticsListData>({
      items: [],
      minHeight: 120,
      onSelect: item => {
        this._selectListItem(item)
        this._syncDetail()
      },
      onActivate: item => {
        this._selectListItem(item)
        this._syncDetail()
      },
      copyText: item => item.data ? formatListItemCopyText(item.data) : item.label,
    })
    this._detailInspector = new RenderObjectInspector({
      value: null,
      label: 'runtime.request',
      adaptiveTreeHeight: true,
      includePrototype: false,
    })
    const body = new RenderGridPanel({
      columns: [gridFr(0.4, { min: 180, max: 320 }), gridFr(0.6, { min: 220 })],
      rows: [gridFr()],
      columnGap: 10,
    })
    body.addChild(this._list, { row: 0, column: 0 })
    body.addChild(this._detailInspector, { row: 0, column: 1 })
    this.addChild(new RenderText('Paint / Layout Requests', { role: 'title', weight: 'semibold' }), { row: 0, column: 0 })
    this.addChild(this._toolbar, { row: 1, column: 0 })
    this.addChild(this._filterBar, { row: 2, column: 0 })
    this.addChild(this._summary, { row: 3, column: 0 })
    this.addChild(body, { row: 4, column: 0 })
    this._syncFromState()
  }

  setDiagnosticsState(state: RuntimeDiagnosticsState): void {
    this._applyState(state)
  }

  setViewMode(value: RuntimeDiagnosticsViewMode): void {
    if (!isViewMode(value) || this._viewModeValue === value) return
    this._viewModeValue = value
    this._viewMode.value = value
    this._syncFilteredView()
  }

  setKindFilter(value: RuntimeDiagnosticsKindFilter): void {
    if (!isKindFilter(value) || this._kindFilterValue === value) return
    this._kindFilterValue = value
    this._kindFilter.value = value
    this._syncFilteredView()
  }

  setSourceFilter(value: RuntimeDiagnosticsSourceFilter): void {
    if (!isSourceFilter(value) || this._sourceFilterValue === value) return
    this._sourceFilterValue = value
    this._sourceFilter.value = value
    this._syncFilteredView()
  }

  setQueryFilter(value: string): void {
    const nextValue = value.trim()
    if (this._queryFilterValue === nextValue) return
    this._queryFilterValue = nextValue
    this._queryFilter.value = value
    this._syncFilteredView()
  }

  clearFilters(): void {
    if (this._kindFilterValue === 'all' && this._sourceFilterValue === 'all' && this._queryFilterValue === '') return
    this._kindFilterValue = 'all'
    this._sourceFilterValue = 'all'
    this._queryFilterValue = ''
    this._kindFilter.value = 'all'
    this._sourceFilter.value = 'all'
    this._queryFilter.value = ''
    this._syncFilteredView()
  }

  debugState(): RuntimeDiagnosticsPanelDebugState {
    return {
      requestCount: this._state.paintRequests.length,
      filteredRequestCount: this._filteredRequests().length,
      aggregateCount: aggregateRequests(this._filteredRequests()).length,
      selectedSeq: this._selectedSeq,
      selectedAggregateKey: this._selectedAggregateKey,
      paintRequestDebugEnabled: this._state.paintRequestDebugEnabled,
      viewMode: this._viewModeValue,
      kindFilter: this._kindFilterValue,
      sourceFilter: this._sourceFilterValue,
      queryFilter: this._queryFilterValue,
      listLabels: this._list.items.map(item => item.label),
      detailRoots: this._detailInspector.debugState().roots.map(root => root.path),
      summaryText: this._summary.text,
    }
  }

  debugRequestList(): RenderListView<RuntimeDiagnosticsListData> {
    return this._list
  }

  debugDetailInspector(): RenderObjectInspector {
    return this._detailInspector
  }

  private _applyState(state: RuntimeDiagnosticsState): void {
    const normalized = normalizeState(state)
    const nextSignature = stateSignature(normalized)
    if (nextSignature === this._stateSignature) return
    this._state = normalized
    this._stateSignature = nextSignature
    this._syncFromState()
  }

  private _syncFromState(): void {
    if (this._selectedSeq !== null && !this._state.paintRequests.some(request => request.seq === this._selectedSeq)) {
      this._selectedSeq = null
    }
    if (this._selectedAggregateKey !== null && !aggregateRequests(this._filteredRequests()).some(aggregate => aggregate.key === this._selectedAggregateKey)) {
      this._selectedAggregateKey = null
    }
    this._syncFilteredView()
  }

  private _syncFilteredView(): void {
    const filteredRequests = this._filteredRequests()
    const aggregates = aggregateRequests(filteredRequests)
    if (this._selectedAggregateKey !== null && !aggregates.some(aggregate => aggregate.key === this._selectedAggregateKey)) {
      this._selectedAggregateKey = null
    }
    if (this._viewModeValue === 'requests' && this._selectedSeq === null && filteredRequests.length > 0) {
      this._selectedSeq = filteredRequests[filteredRequests.length - 1]!.seq
    }
    if (this._viewModeValue === 'hotspots' && this._selectedAggregateKey === null && aggregates.length > 0) {
      this._selectedAggregateKey = aggregates[0]!.key
    }
    const selectedRequest = this._selectedRequest()
    const selectedAggregate = this._viewModeValue === 'hotspots'
      ? this._selectedAggregate(aggregates)
      : null
    const items = this._viewModeValue === 'requests'
      ? filteredRequests
        .slice()
        .reverse()
        .map(requestToListItem)
      : aggregates.map(aggregateToListItem)
    this._list.items = items
    this._list.selectedItem = this._selectedListItem(items, selectedRequest, selectedAggregate)
    this._stackCheckbox.checked = this._state.paintRequestDebugEnabled
    this._viewMode.value = this._viewModeValue
    this._summary.text = formatSummary(this._state, filteredRequests, aggregates, selectedRequest, selectedAggregate)
    this._syncDetail()
    this.markNeedsLayout()
    this.markNeedsPaint()
  }

  private _syncDetail(): void {
    if (this._viewModeValue === 'hotspots') {
      const selectedAggregate = this._selectedAggregate(aggregateRequests(this._filteredRequests()))
      this._detailInspector.setValue(selectedAggregate ? createAggregateDetail(selectedAggregate) : null, 'runtime.hotspot')
      return
    }
    const selectedRequest = this._selectedRequest()
    this._detailInspector.setValue(selectedRequest ? createRequestDetail(selectedRequest) : null, 'runtime.request')
  }

  private _selectListItem(item: ListViewItem<RuntimeDiagnosticsListData>): void {
    if (item.data?.kind === 'aggregate') {
      this._selectedAggregateKey = item.data.aggregate.key
      return
    }
    this._selectedSeq = item.data?.record.seq ?? null
  }

  private _selectedRequest(): RuntimePaintRequestRecord | null {
    if (this._selectedSeq === null) return null
    return this._state.paintRequests.find(request => request.seq === this._selectedSeq) ?? null
  }

  private _selectedAggregate(aggregates: RuntimeRequestAggregate[]): RuntimeRequestAggregate | null {
    if (this._selectedAggregateKey === null) return null
    return aggregates.find(aggregate => aggregate.key === this._selectedAggregateKey) ?? null
  }

  private _selectedListItem(
    items: ListViewItem<RuntimeDiagnosticsListData>[],
    selectedRequest: RuntimePaintRequestRecord | null,
    selectedAggregate: RuntimeRequestAggregate | null,
  ): ListViewItem<RuntimeDiagnosticsListData> | null {
    if (this._viewModeValue === 'hotspots') {
      return selectedAggregate
        ? items.find(item => item.data?.kind === 'aggregate' && item.data.aggregate.key === selectedAggregate.key) ?? null
        : null
    }
    return selectedRequest
      ? items.find(item => item.data?.kind === 'request' && item.data.record.seq === selectedRequest.seq) ?? null
      : null
  }

  private _filteredRequests(): RuntimePaintRequestRecord[] {
    return this._state.paintRequests.filter(request => matchesFilters(
      request,
      this._kindFilterValue,
      this._sourceFilterValue,
      this._queryFilterValue,
    ))
  }
}

export class RenderRuntimeDiagnosticsPanel extends RenderWindow {
  static override debugTypeName = 'RenderRuntimeDiagnosticsPanel'
  private readonly _view: RenderRuntimeDiagnosticsView

  constructor(options: RenderRuntimeDiagnosticsPanelOptions) {
    super({
      title: 'Runtime Diagnostics',
      x: 92,
      y: 72,
      width: 760,
      height: 520,
      minWidth: 560,
      minHeight: 360,
      contentPadding: 12,
      contentSpacing: 0,
    })
    this._view = new RenderRuntimeDiagnosticsView(options)
    this.setChildren([this._view])
  }

  setDiagnosticsState(state: RuntimeDiagnosticsState): void {
    this._view.setDiagnosticsState(state)
  }

  setViewMode(value: RuntimeDiagnosticsViewMode): void {
    this._view.setViewMode(value)
  }

  setKindFilter(value: RuntimeDiagnosticsKindFilter): void {
    this._view.setKindFilter(value)
  }

  setSourceFilter(value: RuntimeDiagnosticsSourceFilter): void {
    this._view.setSourceFilter(value)
  }

  setQueryFilter(value: string): void {
    this._view.setQueryFilter(value)
  }

  clearFilters(): void {
    this._view.clearFilters()
  }

  debugState(): RuntimeDiagnosticsPanelDebugState {
    return this._view.debugState()
  }

  debugRequestList(): RenderListView<RuntimeDiagnosticsListData> {
    return this._view.debugRequestList()
  }

  debugDetailInspector(): RenderObjectInspector {
    return this._view.debugDetailInspector()
  }

  debugView(): RenderRuntimeDiagnosticsView {
    return this._view
  }
}

function isViewMode(value: string): value is RuntimeDiagnosticsViewMode {
  return value === 'requests' || value === 'hotspots'
}

function isKindFilter(value: string): value is RuntimeDiagnosticsKindFilter {
  return value === 'all' || value === 'frame' || value === 'layout'
}

function isSourceFilter(value: string): value is RuntimeDiagnosticsSourceFilter {
  return value === 'all' ||
    value === 'pipeline' ||
    value === 'overlay' ||
    value === 'runtime' ||
    value === 'window' ||
    value === 'debug'
}

function matchesFilters(
  request: RuntimePaintRequestRecord,
  kindFilter: RuntimeDiagnosticsKindFilter,
  sourceFilter: RuntimeDiagnosticsSourceFilter,
  queryFilter: string,
): boolean {
  if (kindFilter !== 'all' && request.kind !== kindFilter) return false
  if (sourceFilter !== 'all' && request.source !== sourceFilter) return false
  if (!queryFilter) return true
  return requestSearchText(request).includes(queryFilter.toLowerCase())
}

function requestSearchText(request: RuntimePaintRequestRecord): string {
  return [
    request.seq,
    request.kind,
    request.source,
    request.reason,
    detailTarget(request.detail),
    ...request.pipeline.layoutTargets,
    ...request.pipeline.paintTargets,
    ...request.pipeline.transientPaintTargets,
  ].filter(value => value !== undefined && value !== null)
    .join(' ')
    .toLowerCase()
}

function detailTarget(detail: unknown): string | undefined {
  if (!detail || typeof detail !== 'object') return undefined
  const target = (detail as { target?: unknown }).target
  return typeof target === 'string' ? target : undefined
}

function aggregateRequests(requests: RuntimePaintRequestRecord[]): RuntimeRequestAggregate[] {
  const aggregates = new Map<string, RuntimeRequestAggregate>()
  for (const request of requests) {
    const target = requestTarget(request)
    const key = `${target}\n${request.kind}\n${request.source}\n${request.reason}`
    let aggregate = aggregates.get(key)
    if (!aggregate) {
      aggregate = {
        key,
        target,
        kind: request.kind,
        source: request.source,
        reason: request.reason,
        count: 0,
        firstSeq: request.seq,
        lastSeq: request.seq,
        firstTime: request.time,
        lastTime: request.time,
        alreadyScheduledCount: 0,
        layoutNeededCount: 0,
        dirtyLayerCount: 0,
        layoutTargets: [],
        paintTargets: [],
        transientPaintTargets: [],
      }
      aggregates.set(key, aggregate)
    }
    aggregate.count += 1
    aggregate.firstSeq = Math.min(aggregate.firstSeq, request.seq)
    aggregate.lastSeq = Math.max(aggregate.lastSeq, request.seq)
    aggregate.firstTime = Math.min(aggregate.firstTime, request.time)
    aggregate.lastTime = Math.max(aggregate.lastTime, request.time)
    if (request.alreadyScheduled) aggregate.alreadyScheduledCount += 1
    if (request.layoutNeeded) aggregate.layoutNeededCount += 1
    aggregate.dirtyLayerCount += request.dirtyLayers.length
    aggregate.layoutTargets = mergeUnique(aggregate.layoutTargets, request.pipeline.layoutTargets)
    aggregate.paintTargets = mergeUnique(aggregate.paintTargets, request.pipeline.paintTargets)
    aggregate.transientPaintTargets = mergeUnique(aggregate.transientPaintTargets, request.pipeline.transientPaintTargets)
  }
  return Array.from(aggregates.values()).sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count
    return right.lastSeq - left.lastSeq
  })
}

function mergeUnique(left: string[], right: string[]): string[] {
  if (right.length === 0) return left
  const values = new Set(left)
  for (const value of right) values.add(value)
  return Array.from(values).sort()
}

function requestTarget(request: RuntimePaintRequestRecord): string {
  return detailTarget(request.detail) ??
    request.pipeline.layoutTargets[0] ??
    request.pipeline.paintTargets[0] ??
    request.pipeline.transientPaintTargets[0] ??
    '<unknown>'
}

function normalizeState(state: RuntimeDiagnosticsState): RuntimeDiagnosticsState {
  return {
    paintRequestDebugEnabled: state.paintRequestDebugEnabled,
    paintRequests: state.paintRequests.slice(),
  }
}

function stateSignature(state: RuntimeDiagnosticsState): string {
  const requests = state.paintRequests
  const requestSignature = requests
    .map(request => stableStringify(createRequestDetail(request)))
    .join('|')
  return `${state.paintRequestDebugEnabled ? 1 : 0}:${requests.length}:${requestSignature}`
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
  return `{${entries.join(',')}}`
}

function requestToListItem(request: RuntimePaintRequestRecord): ListViewItem<RuntimeRequestListData> {
  return {
    key: String(request.seq),
    label: `#${request.seq} ${request.kind} ${request.reason}`,
    trailingText: request.source,
    data: { kind: 'request', record: request },
  }
}

function aggregateToListItem(aggregate: RuntimeRequestAggregate): ListViewItem<RuntimeAggregateListData> {
  return {
    key: aggregate.key,
    label: `${aggregate.target} ×${aggregate.count}`,
    trailingText: `${aggregate.kind}/${aggregate.source}`,
    data: { kind: 'aggregate', aggregate },
  }
}

function createRequestDetail(request: RuntimePaintRequestRecord): Record<string, unknown> {
  return {
    seq: request.seq,
    time: request.time,
    kind: request.kind,
    source: request.source,
    reason: request.reason,
    detail: request.detail ?? null,
    scheduling: {
      alreadyScheduled: request.alreadyScheduled,
      layoutNeeded: request.layoutNeeded,
    },
    dirtyLayers: request.dirtyLayers,
    pipeline: request.pipeline,
    stack: request.stack ?? [],
  }
}

function createAggregateDetail(aggregate: RuntimeRequestAggregate): Record<string, unknown> {
  return {
    target: aggregate.target,
    count: aggregate.count,
    kind: aggregate.kind,
    source: aggregate.source,
    reason: aggregate.reason,
    seqRange: {
      first: aggregate.firstSeq,
      last: aggregate.lastSeq,
    },
    timeRange: {
      first: aggregate.firstTime,
      last: aggregate.lastTime,
    },
    scheduling: {
      alreadyScheduledCount: aggregate.alreadyScheduledCount,
      layoutNeededCount: aggregate.layoutNeededCount,
      dirtyLayerCount: aggregate.dirtyLayerCount,
    },
    pipelineTargets: {
      layout: aggregate.layoutTargets,
      paint: aggregate.paintTargets,
      transientPaint: aggregate.transientPaintTargets,
    },
  }
}

function formatSummary(
  state: RuntimeDiagnosticsState,
  filteredRequests: RuntimePaintRequestRecord[],
  aggregates: RuntimeRequestAggregate[],
  selected: RuntimePaintRequestRecord | null,
  selectedAggregate: RuntimeRequestAggregate | null,
): string {
  const counts = state.paintRequests.reduce<Record<string, number>>((acc, request) => {
    acc[request.source] = (acc[request.source] ?? 0) + 1
    return acc
  }, {})
  const bySource = Object.entries(counts)
    .map(([source, count]) => `${source}:${count}`)
    .join('  ')
  const selectedText = selected
    ? `selected #${selected.seq} ${selected.kind} ${selected.reason}`
    : 'selected <none>'
  const hotspotText = selectedAggregate
    ? `hotspot ${selectedAggregate.target} ×${selectedAggregate.count}`
    : `hotspots ${aggregates.length}`
  return [
    `requests ${filteredRequests.length}/${state.paintRequests.length}  hotspots ${aggregates.length}  stack ${state.paintRequestDebugEnabled ? 'on' : 'off'}`,
    bySource || 'source <empty>',
    `${selectedText}  ${hotspotText}`,
  ].join('\n')
}

function formatListItemCopyText(data: RuntimeDiagnosticsListData): string {
  return JSON.stringify(data.kind === 'request'
    ? createRequestDetail(data.record)
    : createAggregateDetail(data.aggregate), null, 2)
}
