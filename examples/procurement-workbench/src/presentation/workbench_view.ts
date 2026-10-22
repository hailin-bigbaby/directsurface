import { FocusManager, CommandManager, CommandShortcutController, RenderCommandToolbar, RenderToolbar, RenderFormPanel, RenderFormField, RenderSearchBox, RenderScrollViewer, RenderWrapPanel, AppOverlayService, DockWorkbenchManager, RenderDockWorkbench, RenderStackPanel, RenderButton, RenderText, RenderParagraph, RenderTextBox, RenderComboBox, RenderDataGrid, type GridColumnDef } from 'directsurface'
import { CompactWorkspace, type WorkspacePreference } from './compact_workspace'
import { ProcurementWorkbench, type OrderDocument } from '../application/workbench'
import { type Quote } from '../domain/model'
import { money } from '../domain/decimal'

type Row = Record<string, string>
type RequestRow = { id: string; mark: boolean; name: string; department: string; remaining: string; number: string }
interface DocumentView { grid: RenderDataGrid<Row>; supplier: RenderComboBox; remark: RenderTextBox; summary: RenderParagraph; heading: RenderText; lineHeading: RenderText; quoteAction: RenderButton; root: RenderStackPanel; version: string }
export interface ViewServices { download(text: string): void; isComposing(): boolean }
const priceText = (value: string): string => { const [whole, fraction = ''] = value.split('.'); return `${whole}.${fraction.padEnd(2, '0')}` }
const stack = (padding = 10) => new RenderStackPanel({ orientation: 'vertical', crossAxisAlignment: 'stretch', spacing: 8, padding })
const column = <T extends Record<string, any> = Row>(key: string, title: string, width: number, editable = false): GridColumnDef<T> => ({ key, title, width, type: 'text', editable, sortable: !['price', 'gross', 'tax', 'rate', 'quantity', 'remaining', 'base'].includes(key), align: ['price', 'gross', 'tax', 'quantity'].includes(key) ? 'right' : 'left' })

/** Canvas composition and editing adapters. All business mutations go through application use cases. */
export function createWorkbenchView(app: ProcurementWorkbench, services: ViewServices) {
  const manager = new DockWorkbenchManager()
  const overlay = new AppOverlayService()
  const root = stack(0)
  const documents = new Map<string, DocumentView>()
  let selectedRequest = ''
  let referenceRequest: string | null = null
  const selectedRequests = new Set<string>()
  let selectedLine = ''
  let selectedQuote: Quote | null = null
  let refreshing = false
  let disposed = false
  let bindingRows = false
  let quoteContext = ''
  let datasetGeneration = ''
  let viewportReady = false
  let lastPresentedError: unknown = null
  const selectedLines = new Map<string, string>()
  const rowVersions = new WeakMap<object, string>()
  function bindRows<T extends Record<string, any>>(grid: RenderDataGrid<T>, rows: T[]): void {
    const version = JSON.stringify(rows)
    if (rowVersions.get(grid) === version) return
    bindingRows = true
    try { grid.rows = rows; rowVersions.set(grid, version) } finally { bindingRows = false }
  }
  const status = new RenderText('正在载入…', { role: 'secondary' })
  status.margin = 8
  const message = new RenderParagraph('从左侧选择申购需求，建立订单。报价、税率和换算来自样本资料。')
  const reference = new RenderParagraph('选择订单明细查看申购来源。')
  const toolbar = new RenderStackPanel({ orientation: 'horizontal', spacing: 8, padding: 10, crossAxisAlignment: 'center' })
  toolbar.addChild(new RenderText('办公采购工作台', { role: 'title', weight: 'semibold' }))
  function report(error: unknown): void {
    message.text = error instanceof Error ? error.message : String(error)
    // Action failures use the same acknowledgement in both layouts.
    void overlay.alert({ title: '操作未完成', content: message.text })
  }
  function invoke(action: () => void | Promise<unknown>): void { try { void Promise.resolve(action()).catch(report) } catch (error) { report(error) } }
  function flush(): boolean {
    if (services.isComposing()) { message.text = '请先完成中文输入，再执行操作。'; return false }
    for (const view of documents.values()) if (!view.grid.commitEdit()) { message.text = '请修正当前单元格，或按 Escape 取消本次输入。'; return false }
    queueMicrotask(() => { if (!disposed) refresh() })
    return true
  }
  function hasUncommittedInput(): boolean {
    if (services.isComposing()) return true
    for (const view of documents.values()) {
      const edit = view.grid.editingCell
      if (!edit) continue
      if (edit.text !== String(edit.row[edit.key] ?? '')) return true
    }
    return false
  }
  const compactLayout = new CompactWorkspace(manager, flush, id => {
    const target = id === 'requests' ? requestGrid : id === 'orders' ? orderGrid : id === 'quotes' ? quoteGrid : manager.getItem(id)?.window
    if (target) FocusManager.instance.setFocus(target)
  })
  const commands = new CommandManager()
  const canWrite = () => !!app.active && !app.active.pending && app.active.record?.status !== 'submitted' && !app.resetPending
  commands.register({ id: 'order.save', title: '保存草稿', shortcut: ['Ctrl+S', 'Meta+S'], canExecute: canWrite, execute: async () => {
    if (flush() && app.activeId) await app.write(app.activeId, 'save')
  } })
  commands.register({ id: 'order.submit', title: '提交审批', shortcut: ['Ctrl+Enter', 'Meta+Enter'], canExecute: canWrite, execute: async () => {
    if (!flush() || !app.activeId) return
    const id = app.activeId
    if (await overlay.confirm({ title: '提交审批', content: '提交后订单不可修改，并占用对应申购需求的可采购量。此演示到提交审批为止。', confirmText: '确认提交' })) await app.write(id, 'submit')
  } })
  const shortcuts = new CommandShortcutController({ commandManager: commands, source: () => documents.get(app.activeId ?? '')?.grid ?? root, priority: 100 })
  // Register command shortcuts before creating focusable selector fields.
  const layoutPicker = new RenderComboBox({ value: 'auto', options: [{ value: 'auto', label: '自动布局' }, { value: 'focus', label: '专注编辑' }, { value: 'expanded', label: '展开工具区' }], onChange: value => {
    if (!compactLayout.setPreference(String(value) as WorkspacePreference)) layoutPicker.value = compactLayout.preference
    refresh()
  } })
  layoutPicker.width = 130
  const panelsMenu = new RenderToolbar({ groups: [{ id: '面板', slot: 'leading', items: [{
    id: 'panels', kind: 'dropdown', label: '面板', items: [
      { key: 'requests', label: '申购需求' }, { key: 'orders', label: '采购订单' },
      { key: 'quotes', label: '供应商报价' }, { key: 'context', label: '来源与收货' }, { key: 'feedback', label: '校验与操作提示' },
    ], onSelect: id => queueMicrotask(() => { if (!disposed) compactLayout.openTool(id) }),
  }] }] })
  panelsMenu.width = 74
  const runDataAction = async (action: () => Promise<unknown>) => { try { await action() } catch (error) { report(error) } }
  commands.register({ id: 'order.reconcile', title: '确认操作结果', visible: () => !!(app.resetPending || app.active?.uncertain), canExecute: () => !!(app.resetPending || app.active?.uncertain), execute: () => runDataAction(async () => {
    if (app.resetPending) await app.reconcileReset()
    else if (app.activeId) await app.reconcile(app.activeId)
  }) })
  commands.register({ id: 'data.export', title: '导出已保存数据', canExecute: () => !!app.readyData && !app.hasPending, execute: () => runDataAction(async () => services.download(await app.exportData())) })
  commands.register({ id: 'data.reset', title: '重置样本', description: '清除本演示数据并恢复样本，需要确认', canExecute: () => !!app.readyData && !app.hasPending, execute: () => runDataAction(async () => {
    if (!flush()) return
    if (!await overlay.confirm({ title: '重置演示数据', content: '将删除本演示的订单和未保存修改，恢复初始样本。需要保留已保存数据时，请先导出。', confirmText: '重置', danger: true })) return
    await app.reset(true)
    for (const id of documents.keys()) await manager.closeItem(id)
    documents.clear(); selectedLine = ''; selectedRequests.clear(); refresh()
  }) })
  const commandToolbar = new RenderCommandToolbar({ commandManager: commands, groups: [
    { id: '订单操作', slot: 'leading', items: [
      { kind: 'command', commandId: 'order.save', showLabel: true },
      { kind: 'command', commandId: 'order.submit', showLabel: true },
      { kind: 'command', commandId: 'order.reconcile', showLabel: true },
    ] },
    { id: '数据管理', slot: 'leading', items: [
      { kind: 'command', commandId: 'data.export', showLabel: true },
      { kind: 'command', commandId: 'data.reset', showLabel: true },
    ] },
  ] })
  toolbar.addChild(commandToolbar, 1)
  toolbar.addChild(panelsMenu)
  toolbar.addChild(layoutPicker)
  root.addChild(toolbar)
  const workbench = new RenderDockWorkbench({ manager, disposeManagerOnDispose: true })
  root.addChild(workbench, 1); root.addChild(status)
  manager.setRegionLayout({ leftWidth: 320, rightWidth: 320, bottomHeight: 110 })

  const requestsPanel = stack()
  requestsPanel.addChild(new RenderText('已批准申购 · 办公用品与设备', { weight: 'semibold' }))
  const selectRequest = (row: RequestRow) => { selectedRequest = row.id; referenceRequest = row.id; reference.text = requestReference(row.id) }
  const requestGrid = new RenderDataGrid<RequestRow>({ rowKey: 'id', rows: [], editable: true, columns: [
    { key: 'mark', title: '选', type: 'checkbox', width: 40, minWidth: 36, editable: true, sortable: false },
    column<RequestRow>('name', '品目', 106), column<RequestRow>('department', '部门', 64), column<RequestRow>('remaining', '可采购量', 88), column<RequestRow>('number', '申购单', 140),
  ], onCellChange: (row, key, value) => {
    if (key !== 'mark') return
    value ? selectedRequests.add(row.id) : selectedRequests.delete(row.id)
    refreshRequests()
  }, onRowClick: (row, event) => { selectRequest(row); if (event.key === 'mark') requestGrid.beginEdit(row, 'mark') }, onCurrentCellChange: cell => { if (!bindingRows && cell) selectRequest(cell.row) } })

  const search = new RenderSearchBox({ value: '', placeholder: '搜索品目、部门或申购单', onChange: value => { requestGrid.quickFilter = value } })
  requestsPanel.addChild(search)
  const requestActions = new RenderStackPanel({ orientation: 'horizontal', spacing: 6 })
  const createOrder = new RenderButton({ label: '生成订单', variant: 'primary', disabled: true, onClick: () => { if (flush()) invoke(() => { showDocument(app.create([...selectedRequests])); selectedRequests.clear(); refreshRequests(); returnToOrder('requests') }) } })
  requestActions.addChild(createOrder)
  requestsPanel.addChild(requestActions); requestsPanel.addChild(requestGrid, 1)
  requestsPanel.addChild(new RenderParagraph('勾选左侧复选框生成订单；同一订单需使用相容的收货与付款条件。'))
  manager.openTool({ itemId: 'requests', title: '申购需求', region: 'left', closable: false, content: requestsPanel })
  const orderGrid = new RenderDataGrid<Row>({ rowKey: 'id', rows: [], columns: [column('number', '采购单号', 146), { ...column('status', '状态', 62), sortable: false }, column('supplier', '供应商', 90)], onRowActivate: row => { if (flush()) invoke(async () => { showDocument(await app.open(row.id)); returnToOrder('orders') }) } })
  const ordersPanel = stack()
  ordersPanel.addChild(new RenderParagraph('双击订单打开。已提交订单只读。'))
  ordersPanel.addChild(new RenderButton({ label: '刷新列表与可采购量', onClick: () => invoke(() => app.refresh()) }))
  ordersPanel.addChild(new RenderSearchBox({ value: '', placeholder: '搜索单号、供应商或状态', onChange: value => { orderGrid.quickFilter = value } }))
  ordersPanel.addChild(orderGrid, 1)
  manager.openTool({ itemId: 'orders', title: '采购订单', region: 'left', closable: false, content: ordersPanel })
  const selectQuote = (row: Row) => {
    referenceRequest = null
    selectedQuote = app.readyData.seed.quotes.find(q => q.id === row.id) ?? null
    applyQuote.disabled = !selectedQuote || !app.active || !!app.active.pending || app.active.record?.status === 'submitted' || app.resetPending
    updateQuoteDetail()
    if (selectedQuote) reference.text = `${requestReference(app.active!.draft.lines.find(l => l.id === selectedLine)!.requestId)}\n\n报价 ${selectedQuote.reference}\n${selectedQuote.specification}\n质保：${selectedQuote.warranty}\n报价含税、含运费。`
  }
  const quoteGrid = new RenderDataGrid<Row>({ rowKey: 'id', rows: [], columns: [column('supplier', '供应商', 184), column('price', '含税单价', 94)], onRowClick: selectQuote, onCurrentCellChange: cell => { if (!bindingRows && cell) selectQuote(cell.row) } })
  const quotesPanel = stack()
  const quoteHeading = new RenderText('请选择订单明细', { weight: 'semibold', overflow: 'ellipsis' })
  quotesPanel.addChild(quoteHeading)
  const applyQuote = new RenderButton({ label: '采用所选报价', variant: 'primary', onClick: () => { if (flush() && app.activeId && selectedLine && selectedQuote) invoke(() => { app.chooseQuote(app.activeId!, selectedLine, selectedQuote!.id); returnToOrder('quotes') }) } })
  quotesPanel.addChild(applyQuote)
  quotesPanel.addChild(quoteGrid)
  const quoteDetail = new RenderParagraph('选择报价查看付款、有效期与质保。')
  const quoteDetailPanel = stack(0); quoteDetailPanel.addChild(quoteDetail)
  quotesPanel.addChild(new RenderScrollViewer({ direction: 'vertical', child: quoteDetailPanel }), 1)
  manager.openTool({ itemId: 'quotes', title: '供应商报价', region: 'right', closable: false, content: quotesPanel })
  const contextPanel = stack(); contextPanel.addChild(reference)
  manager.openTool({ itemId: 'context', title: '来源与收货', region: 'right', closable: false, content: new RenderScrollViewer({ direction: 'vertical', child: contextPanel }) })
  const feedback = stack(); feedback.addChild(message)
  const locateIssue = new RenderButton({ label: '定位首个问题', disabled: true, onClick: () => {
    const doc = app.active; const issue = doc?.error?.issues[0]
    if (!doc || !issue || !flush()) return
    const [lineId, key] = issue.field.split('.')
    if (!key) { returnToOrder('feedback'); documents.get(doc.draft.id)?.supplier.requestFocus(); return }
    const view = documents.get(doc.draft.id)!
    selectedLine = lineId; selectedLines.set(doc.draft.id, lineId); updateQuotes()
    const row = view.grid.rows.find(r => r.id === lineId)
    if (row && ['quantity', 'deliveryDate', 'remark'].includes(key)) { returnToOrder('feedback'); view.grid.beginEdit(row, key) }
    else manager.activateItem('quotes')
  } })
  locateIssue.width = 140; locateIssue.horizontalAlignment = 'start'
  feedback.addChild(locateIssue)
  manager.openTool({ itemId: 'feedback', title: '校验与操作提示', region: 'bottom', closable: false, content: new RenderScrollViewer({ direction: 'vertical', child: feedback }) })
  manager.subscribeBeforeEvent(event => {
    if (event.type === 'before-region-layout-change') return true
    // The callback must not mutate the manager; view synchronization is deferred.
    return flush()
  })
  manager.subscribeEvent(event => {
    if (event.type === 'item-activated' && event.itemId && app.documents.has(event.itemId)) { referenceRequest = null; app.activate(event.itemId) }
    if (event.type === 'item-closed' && event.itemId) { documents.delete(event.itemId); selectedLines.delete(event.itemId); app.close(event.itemId, true); if (manager.activeItemId && app.documents.has(manager.activeItemId)) app.activate(manager.activeItemId) }
  })
  function returnToOrder(toolId: string): void {
    compactLayout.dismissTool(toolId)
    const id = app.activeId; const view = id ? documents.get(id) : undefined
    if (view && id) { manager.activateItem(id); FocusManager.instance.setFocus(view.grid) }
  }
  function updateQuoteDetail(): void {
    const doc = app.active; const line = doc?.draft.lines.find(l => l.id === selectedLine)
    const quote = selectedQuote ?? app.readyData.seed.quotes.find(q => q.id === line?.quoteId)
    if (!quote) { quoteDetail.text = '选择上方报价查看付款、有效期与质保；价格含税、含运费。'; return }
    const seed = app.readyData.seed; const condition = seed.conditions.find(c => c.id === quote.conditionProfileId)!
    const supplier = seed.suppliers.find(s => s.id === quote.supplierId)!
    quoteDetail.text = `${supplier.name}\n${line?.quoteId === quote.id ? '✓ 当前采用的报价' : '待采用的报价'}\n\n规格：${quote.specification}\n含税单价：¥${priceText(quote.unitPrice)} · 税率 ${quote.taxBps / 100}%\n有效至：${quote.validTo}\n\n付款：${condition.paymentTerms}\n\n质保：${quote.warranty}\n\n依据：${quote.reference}`
  }
  function requestReference(id: string): string {
    const s = app.readyData.seed; const r = s.requests.find(r => r.id === id)!
    const item = s.items.find(i => i.id === r.itemId)!
    const site = s.receiptSites.find(site => site.id === r.receiptSiteId)!
    return `收货：${site.name} / ${site.contact}\n${site.address}\n采购员：行政采购员（演示）\n业务日期：${s.businessDate}\n\n${r.number} · ${r.department}\n${item.name} / ${item.specification}\n用途：${r.purpose}\n库存核查：${r.stockReview}\n批准人：${r.approvedBy}\n期望到货：${r.neededOn}\n可采购：${app.remaining(id)} ${item.baseUnit}\n换算：1 ${item.purchaseUnit} = ${item.basePerPurchase} ${item.baseUnit}${r.initialGrossCents ? `\n来源批准金额上限：¥${money(r.initialGrossCents)}` : ''}`
  }
  function showDocument(doc: OrderDocument): void {
    const id = doc.draft.id
    if (manager.hasItem(id)) { manager.activateItem(id); return }
    const pane = stack()
    const supplier = new RenderComboBox({ options: app.readyData.seed.suppliers.filter(s => s.enabled).map(s => ({ value: s.id, label: s.name })), value: doc.draft.supplierId ?? '', placeholder: '选择供应商（也可从报价带入）', onChange: value => invoke(async () => {
      if (refreshing || value === doc.draft.supplierId) return
      if (!flush()) { supplier.value = doc.draft.supplierId ?? ''; return }
      if (doc.draft.lines.some(l => l.quoteId) && !await overlay.confirm({ title: '变更供应商', content: '将清空当前报价与付款条款，保留申购来源、数量和交货日期。', confirmText: '变更' })) { supplier.value = doc.draft.supplierId ?? ''; return }
      app.changeSupplier(id, String(value) || null)
    }) })
    const heading = new RenderText('', { weight: 'semibold' }); pane.addChild(heading)
    const form = new RenderFormPanel({ columns: 'auto', maxColumns: 2, minColumnWidth: 280, labelWidth: 64, labelPlacement: 'adaptive', columnGap: 16, rowGap: 8 })
    form.addField(new RenderFormField({ label: '供应商', required: true, child: supplier }))
    const remark = new RenderTextBox({ value: doc.draft.remark, maxLength: 2000, placeholder: '整单备注（可选）', onChange: value => { if (!refreshing) invoke(() => app.changeRemark(id, value)) } })
    form.addField(new RenderFormField({ label: '整单备注', child: remark }))
    pane.addChild(form)
    const lineActions = new RenderWrapPanel({ spacing: 10, runSpacing: 4, crossAxisAlignment: 'center' })
    const lineHeading = new RenderText('采购明细', { weight: 'semibold' }); lineActions.addChild(lineHeading)
    const quoteAction = new RenderButton({ label: '选择报价', onClick: () => { if (flush()) { app.activate(id); compactLayout.openTool('quotes') } } })
    lineActions.addChild(quoteAction)
    lineActions.addChild(new RenderButton({ label: '来源 / 收货', variant: 'text', onClick: () => { if (flush()) { app.activate(id); compactLayout.openTool('context') } } }))
    pane.addChild(lineActions)
    // Quantity retains the original decimal text until domain validation; do not round through a floating-point editor.
    const grid = new RenderDataGrid<Row>({ rowKey: 'id', rows: [], editable: true, selectionMode: 'cell', columns: [
      { ...column('name', '品目', 128), fixed: true }, column('quantity', '数量', 86, true), { ...column('unit', '单位', 48), sortable: false }, column('price', '含税单价', 88), column('gross', '含税金额', 96), { key: 'deliveryDate', title: '到货日期', type: 'date', width: 114, editable: true }, column('remark', '备注 / 延期说明', 160, true), column('rate', '税率', 60), column('base', '基本数量', 100), column('tax', '税额', 100),
    ], validateCell: ({ row, column, value }) => app.validateLineChange(id, row.id, { [column.key]: column.key === 'quantity' ? String(value).trim() || null : String(value) }),
    onCellChange: (row, key, value) => invoke(() => app.changeLine(id, row.id, { [key]: key === 'quantity' ? String(value).trim() || null : String(value) })),
    onCurrentCellChange: cell => {
      if (bindingRows || !cell) return
      referenceRequest = null; selectedLine = cell.row.id; selectedLines.set(id, selectedLine); app.activate(id); updateQuotes()
    } })
    pane.addChild(grid, 1)
    const summary = new RenderParagraph(''); pane.addChild(summary)
    documents.set(id, { grid, supplier, remark, summary, heading, lineHeading, quoteAction, root: pane, version: '' })
    manager.openDocument({ itemId: id, title: doc.record?.number ?? '新采购订单', dirty: app.dirty(doc), content: pane, beforeClose: async () => {
      if (!app.documents.has(id)) return true
      if (app.resetPending || !flush() || doc.pending) return false
      if (!app.dirty(doc)) return true
      const choice = await new Promise<string>(resolve => overlay.showModal({ title: '未保存的订单', content: '关闭前如何处理当前修改？', buttons: [{ key: 'cancel', label: '取消' }, { key: 'discard', label: '放弃修改', danger: true }, { key: 'save', label: '保存草稿', primary: true }], onClose: key => resolve(key ?? 'cancel') }))
      if (choice === 'discard') return true
      if (choice === 'save') { await app.write(id, 'save'); return !doc.pending && !app.dirty(doc) }
      return false
    } })
    selectedLine = doc.draft.lines[0]?.id ?? ''; refresh()
  }
  function refreshRequests(): void {
    if (!app.readyData) return
    requestGrid.readonly = app.resetPending
    createOrder.disabled = selectedRequests.size === 0 || app.resetPending
    createOrder.label = selectedRequests.size ? `生成订单 (${selectedRequests.size})` : '生成订单'
    bindRows(requestGrid, app.readyData.seed.requests.map(r => {
      const item = app.readyData.seed.items.find(i => i.id === r.itemId)!
      return { id: r.id, mark: selectedRequests.has(r.id), name: item.name, remaining: `${app.remaining(r.id)} ${item.baseUnit}`, department: r.department, number: r.number }
    }))
  }
  function updateQuotes(): void {
    const doc = app.active; const seed = app.readyData.seed
    selectedLine = doc ? selectedLines.get(doc.draft.id) ?? doc.draft.lines[0]?.id ?? '' : ''
    let line = doc?.draft.lines.find(l => l.id === selectedLine)
    if (!line) { line = doc?.draft.lines[0]; selectedLine = line?.id ?? '' }
    const request = seed.requests.find(r => r.id === line?.requestId)
    const candidates = doc && line ? app.quotesFor(doc, line.id) : []
    const context = `${doc?.draft.id ?? ''}:${line?.id ?? ''}`
    if (context !== quoteContext || !candidates.some(q => q.id === selectedQuote?.id)) selectedQuote = null
    quoteContext = context
    applyQuote.disabled = !selectedQuote || !doc || !!doc.pending || doc.record?.status === 'submitted' || app.resetPending
    if (referenceRequest) reference.text = requestReference(referenceRequest)
    else if (request) {
      const chosen = selectedQuote ?? seed.quotes.find(q => q.id === line?.quoteId)
      reference.text = requestReference(request.id) + (chosen ? `\n\n报价：${chosen.reference}\n规格：${chosen.specification}\n质保：${chosen.warranty}\n税率：${chosen.taxBps / 100}% · 含运费` : '\n尚未选择报价')
    } else reference.text = '选择订单明细查看申购来源。'
    quoteHeading.text = request ? `${seed.items.find(i => i.id === request.itemId)!.name} · ${candidates.length} 个有效报价` : '请选择订单明细'
    quoteGrid.height = Math.min(240, Math.max(90, 48 + candidates.length * 29))
    updateQuoteDetail()
    bindRows(quoteGrid, candidates.map(q => ({ id: q.id, supplier: seed.suppliers.find(s => s.id === q.supplierId)!.name, price: priceText(q.unitPrice), terms: seed.conditions.find(c => c.id === q.conditionProfileId)!.name, validTo: q.validTo })))
  }
  function refresh(): void {
    if (disposed || !app.readyData || refreshing) return
    refreshing = true
    try {
      if (datasetGeneration !== app.readyData.generation) {
        datasetGeneration = app.readyData.generation; selectedRequests.clear(); selectedLines.clear()
        selectedRequest = ''; referenceRequest = null; selectedLine = ''; selectedQuote = null; quoteContext = ''
      }
      if (viewportReady) compactLayout.reconcile()
      panelsMenu.visible = compactLayout.compact
      refreshRequests()
      bindRows(orderGrid, app.orders.map(o => ({ id: o.id, number: o.number, status: o.status === 'draft' ? '草稿' : '待审批', supplier: app.readyData.seed.suppliers.find(s => s.id === o.draft.supplierId)?.name.replace('（演示）', '') ?? '未选供应商' })))
      for (const [id, view] of documents) {
        const doc = app.documents.get(id); if (!doc) { void manager.closeItem(id); continue }
        const version = JSON.stringify(doc.draft)
        view.heading.text = `${doc.record?.status === 'submitted' ? '待审批（本地演示）' : app.dirty(doc) ? '草稿 · 未保存' : '草稿 · 已保存'}  ·  ${app.readyData.seed.receiptSites.find(s => s.id === doc.draft.receiptSiteId)!.name}`
        view.lineHeading.text = `采购明细 · ${doc.draft.lines.length} 项`
        const resolved = app.describe(doc)
        const priced = resolved.lines.filter(l => l.amounts).length
        view.quoteAction.label = doc.record?.status === 'submitted' ? '查看报价' : '选择报价'
        view.summary.text = priced === 0 ? `待计价 · ${doc.draft.lines.length} 项明细，请补齐数量与报价` : `含税合计 ¥${money(resolved.totals.grossCents)}  /  税额 ¥${money(resolved.totals.taxCents)}${resolved.lines.some(l => !l.amounts) ? '（资料未齐，仅合计已计价明细）' : ''}  ·  ${doc.draft.lines.length} 项明细`
        if (view.version !== version && !view.grid.editingCell) {
          bindRows(view.grid, doc.draft.lines.map(l => { const r = resolved.lines.find(r => r.id === l.id)!; return { id: l.id, name: r.name, quantity: l.quantity ?? '', unit: r.purchaseUnit, price: r.unitPrice === null ? '未选报价' : priceText(r.unitPrice), rate: r.taxBps === null ? '—' : `${r.taxBps / 100}%`, gross: r.amounts ? money(r.amounts.grossCents) : '—', deliveryDate: l.deliveryDate, remark: l.remark, base: `${r.baseQuantity ?? '—'} ${r.baseUnit}`, tax: r.amounts ? money(r.amounts.taxCents) : '—' } }))
          view.supplier.value = doc.draft.supplierId ?? ''; if (view.remark.value !== doc.draft.remark) view.remark.value = doc.draft.remark
          view.version = version
        }
        const readonly = app.resetPending || !!doc.pending || doc.record?.status === 'submitted'
        view.grid.readonly = readonly; view.supplier.readonly = readonly; view.supplier.disabled = app.resetPending || !!doc.pending; view.remark.readonly = readonly
        manager.updateItem(id, { title: doc.record?.number ?? '新采购订单', dirty: app.dirty(doc) })
      }
      const active = app.active
      locateIssue.disabled = !active?.error?.issues.length || !!active.pending
      if (!active) message.text = '从左侧勾选申购需求生成订单，或在采购订单列表打开已有记录。'
      commands.invalidate()
      if (app.resetPending) message.text = '重置结果尚未确认，修改已暂停。请点击“确认操作结果”。'
      else if (active?.error) message.text = `${active.error.message}\n${active.error.issues.map(i => i.message).join('；')}${active.uncertain ? '\n结果尚未确认，订单已冻结。请点击“确认操作结果”，不要重新制单。' : ''}`
      else if (active?.pending) message.text = '正在保存到浏览器，请稍候…'
      else if (active?.record?.status === 'submitted') message.text = '已提交审批。此演示不包含审批执行；订单只读，来源余额已扣减。'
      else if (active) message.text = `草稿不占用来源额度；提交时重新校验。${app.dirty(active) ? `未保存修改：${app.changes(active).join('、')}。` : '当前修改已保存。'}`
      status.text = `${app.readyData.storageMode === 'opfs' ? '本地保存' : '临时模式 · 关闭即丢失'} · ${app.readyData.seed.businessDate} · ${active?.error ? active.error.message : active?.pending ? '正在处理，请稍候…' : active?.record?.status === 'submitted' ? '已提交待审批 · 订单只读' : active && app.dirty(active) ? '有未保存修改' : '已保存'} · ${app.orders.length} 张订单`
      if (active && !active.error && !active.pending) {
        const warnings = app.describe(active).warnings
        if (warnings.length) { message.text += `\n提示：${warnings.map(w => w.message).join('；')}`; status.text = `${app.readyData.storageMode === 'opfs' ? '本地保存' : '临时模式'} · ${warnings[0].message}` }
      }
      if (app.refreshError) message.text += `\n${app.refreshError}`
      updateQuotes()
      if (active?.error && active.error !== lastPresentedError) {
        lastPresentedError = active.error; compactLayout.openTool('feedback')
      }
      if (!active?.error) lastPresentedError = null
    } finally { refreshing = false }
  }
  // Defer rendering so grid commit and manager before-event stacks can finish first.
  let queued = false
  const unsubscribe = app.subscribe(() => { if (!queued) { queued = true; queueMicrotask(() => { queued = false; refresh() }) } })
  return { root, manager, updateViewport(width: number) { if (disposed) return; viewportReady = true; compactLayout.setWidth(width); refresh() }, flush, hasUncommittedInput, showDocument, refresh, async start() { await app.start(); refresh(); const first = app.orders.find(o => o.status === 'draft'); if (first) showDocument(await app.open(first.id)); manager.autoHideItem('feedback'); manager.activateItem('requests'); manager.activateItem('quotes') }, dispose() { disposed = true; unsubscribe(); shortcuts.dispose(); commands.dispose(); overlay.dispose() }, test: { quoteDetail, quoteHeading, panelsMenu, commandToolbar, compactLayout, layoutPicker, toolbar, contextPanel, locateIssue, applyQuote, createOrder, reference, message, hasUncommittedInput, commands, overlay, app, documents, requestGrid, orderGrid, quoteGrid } }
}
