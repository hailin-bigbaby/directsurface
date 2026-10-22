import { copy, ProcurementError, type OrderDraft, type OrderRecord, type ReadyData, type RequestAvailability, type WriteCommand, type WriteResult, type LineDraft } from '../domain/model'
import { availableQuotes, isAvailableQuote } from '../domain/quotation_rules'
import { resolveDraft } from '../domain/order_rules'
import { decimal, scaled } from '../domain/decimal'
import type { ProcurementRepository, RuntimeIds } from './ports'

export interface OrderDocument {
  draft: OrderDraft
  record: OrderRecord | null
  baseline: string
  pending: { kind: 'save' | 'submit'; command: WriteCommand } | null
  uncertain: boolean
  error: ProcurementError | null
}
const uncertainCodes = new Set(['REQUEST_TIMEOUT', 'WORKER_GONE', 'PROTOCOL'])
/** Application state and use cases. No canvas, browser storage or transport dependency. */
export class ProcurementWorkbench {
  readyData!: ReadyData
  orders: OrderRecord[] = []
  availability: RequestAvailability[] = []
  readonly documents = new Map<string, OrderDocument>()
  activeId: string | null = null
  resetPending = false
  resetError: ProcurementError | null = null
  refreshError: string | null = null
  private refreshSequence = 0
  private disposed = false
  private listeners = new Set<() => void>()
  constructor(private readonly repository: ProcurementRepository, private readonly ids: RuntimeIds) {}
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private emit(): void { for (const listener of this.listeners) listener() }
  async start(): Promise<void> { this.readyData = await this.repository.ready(); await this.refresh() }
  async refresh(): Promise<void> {
    const sequence = ++this.refreshSequence; const generation = this.readyData.generation
    let orders: OrderRecord[]; let availability: RequestAvailability[]
    try { [orders, availability] = await Promise.all([this.repository.listOrders(), this.repository.availability()]) }
    catch (error) {
      if (!this.disposed && sequence === this.refreshSequence && generation === this.readyData.generation) { this.refreshError = '列表刷新失败，请重试刷新；已确认的保存或提交结果不受影响。'; this.emit() }
      throw error
    }
    if (this.disposed || sequence !== this.refreshSequence || generation !== this.readyData.generation) return
    this.refreshError = null; this.orders = orders; this.availability = availability; this.emit()
  }
  get active(): OrderDocument | null { return this.activeId ? this.documents.get(this.activeId) ?? null : null }
  dirty(doc: OrderDocument): boolean { return JSON.stringify(doc.draft) !== doc.baseline }
  changes(doc: OrderDocument): string[] {
    if (!doc.record) return ['新建订单']
    const before = doc.record.draft; const after = doc.draft; const changed = new Set<string>()
    if (before.supplierId !== after.supplierId) changed.add('供应商')
    if (before.remark !== after.remark) changed.add('整单备注')
    for (const line of after.lines) {
      const old = before.lines.find(l => l.id === line.id)
      if (!old) { changed.add('明细'); continue }
      for (const [key, label] of [['quantity', '采购数量'], ['quoteId', '报价'], ['deliveryDate', '到货日期'], ['remark', '明细备注']] as const) if (old[key] !== line[key]) changed.add(label)
    }
    return [...changed]
  }
  get hasUnsaved(): boolean { return this.resetPending || [...this.documents.values()].some(d => this.dirty(d) || !!d.pending) }
  get hasPending(): boolean { return this.resetPending || [...this.documents.values()].some(d => !!d.pending) }
  remaining(requestId: string): string {
    const request = this.readyData.seed.requests.find(r => r.id === requestId)!
    return decimal(scaled(request.initialBaseQuantity, 3) - scaled(this.availability.find(a => a.requestId === requestId)?.submittedBaseQuantity ?? '0', 3), 3)
  }
  create(requestIds: string[]): OrderDocument {
    if (this.resetPending) throw new ProcurementError('PENDING', '请先确认重置结果')
    const seed = this.readyData.seed
    const requests = [...new Set(requestIds)].map(id => seed.requests.find(r => r.id === id))
    if (!requests.length || requests.some(r => !r)) throw new ProcurementError('VALIDATION', '请先选择申购需求')
    const receiptSiteId = requests[0]!.receiptSiteId
    if (requests.some(r => r!.receiptSiteId !== receiptSiteId)) throw new ProcurementError('CONDITIONS', '收货地点不同，请分别制单')
    if (requests.some(r => scaled(this.remaining(r!.id), 3) <= 0n)) throw new ProcurementError('SOURCE_CONFLICT', '所选需求已无可采购量')
    const offerSets = requests.map(r => new Set(availableQuotes(seed, r!.itemId).map(q => `${q.supplierId}:${q.conditionProfileId}`)))
    if (!offerSets[0].size || ![...offerSets[0]].some(key => offerSets.every(set => set.has(key)))) throw new ProcurementError('CONDITIONS', '所选需求没有相容的供应商及报价条款，请分别制单')
    const draft: OrderDraft = { id: this.ids.next(), supplierId: null, conditionProfileId: null, receiptSiteId, remark: '', lines: requests.map(r => ({ id: this.ids.next(), requestId: r!.id, quoteId: null, quantity: null, deliveryDate: r!.neededOn, remark: '' })) }
    const doc: OrderDocument = { draft, record: null, baseline: '', pending: null, uncertain: false, error: null }
    this.documents.set(draft.id, doc); this.activeId = draft.id; this.emit(); return doc
  }
  async open(id: string): Promise<OrderDocument> {
    if (this.resetPending) throw new ProcurementError('PENDING', '请先确认重置结果')
    const generation = this.readyData.generation
    const existing = this.documents.get(id)
    if (existing) { this.activate(id); return existing }
    const record = await this.repository.getOrder(id)
    if (generation !== this.readyData.generation || this.resetPending) throw new ProcurementError('DATASET_CHANGED', '数据集已变化，请重新打开订单')
    if (!record) throw new ProcurementError('NOT_FOUND', '订单不存在')
    // Another open may have completed while the repository read was pending.
    const opened = this.documents.get(id)
    if (opened) { this.activate(id); return opened }
    const doc: OrderDocument = { draft: copy(record.draft), record, baseline: JSON.stringify(record.draft), pending: null, uncertain: false, error: null }
    this.documents.set(id, doc); this.activeId = id; this.emit(); return doc
  }
  activate(id: string): void { if (this.documents.has(id)) { this.activeId = id; this.emit() } }
  close(id: string, discard = false): boolean {
    const doc = this.documents.get(id)
    if (this.resetPending || !doc || doc.pending || (this.dirty(doc) && !discard)) return false
    this.documents.delete(id)
    if (this.activeId === id) this.activeId = [...this.documents.keys()].at(-1) ?? null
    this.emit(); return true
  }
  private editable(id: string): OrderDocument {
    const doc = this.documents.get(id)
    if (this.resetPending || !doc || doc.pending || doc.record?.status === 'submitted') throw new ProcurementError('READONLY', '当前订单不可修改')
    return doc
  }
  private update(id: string, mutate: (draft: OrderDraft) => void): void {
    const doc = this.editable(id); const draft = copy(doc.draft); mutate(draft)
    resolveDraft(draft, this.readyData.seed, false)
    doc.draft = draft; doc.error = null; this.emit()
  }
  describe(doc: OrderDocument) { return resolveDraft(doc.draft, this.readyData.seed, false) }
  quotesFor(doc: OrderDocument, lineId: string) {
    const line = doc.draft.lines.find(l => l.id === lineId)
    const request = this.readyData.seed.requests.find(r => r.id === line?.requestId)
    return request ? availableQuotes(this.readyData.seed, request.itemId, doc.draft) : []
  }
  validateLineChange(id: string, lineId: string, values: Partial<Pick<LineDraft, 'quantity' | 'deliveryDate' | 'remark'>>): true | string {
    try {
      const draft = copy(this.editable(id).draft)
      const line = draft.lines.find(l => l.id === lineId)
      if (!line) throw new ProcurementError('NOT_FOUND', '明细不存在')
      Object.assign(line, values); resolveDraft(draft, this.readyData.seed, false)
      return true
    } catch (error) {
      return error instanceof ProcurementError ? error.issues[0]?.message ?? error.message : String(error)
    }
  }
  changeSupplier(id: string, supplierId: string | null): void {
    const doc = this.editable(id)
    if (doc.draft.supplierId === supplierId) return
    if (supplierId && !this.readyData.seed.suppliers.some(s => s.id === supplierId && s.enabled)) throw new ProcurementError('REFERENCE', '请选择启用的供应商')
    this.update(id, d => { d.supplierId = supplierId; d.conditionProfileId = null; for (const l of d.lines) l.quoteId = null })
  }
  changeLine(id: string, lineId: string, values: Partial<Pick<LineDraft, 'quantity' | 'deliveryDate' | 'remark'>>): void {
    this.update(id, d => { const line = d.lines.find(l => l.id === lineId); if (!line) throw new ProcurementError('NOT_FOUND', '明细不存在'); Object.assign(line, values) })
  }
  changeRemark(id: string, remark: string): void { this.update(id, d => { d.remark = remark }) }
  chooseQuote(id: string, lineId: string, quoteId: string): void {
    const quote = this.readyData.seed.quotes.find(q => q.id === quoteId)
    if (!quote || !isAvailableQuote(quote, this.readyData.seed)) throw new ProcurementError('VALIDATION', '请选择有效报价')
    this.update(id, d => {
      if (d.supplierId && d.supplierId !== quote.supplierId) throw new ProcurementError('CONDITIONS', '请先确认变更供应商')
      if (d.conditionProfileId && d.conditionProfileId !== quote.conditionProfileId) throw new ProcurementError('CONDITIONS', '付款条款不同，请另行制单')
      d.supplierId = quote.supplierId; d.conditionProfileId = quote.conditionProfileId
      const line = d.lines.find(l => l.id === lineId); if (!line) throw new ProcurementError('NOT_FOUND', '明细不存在'); line.quoteId = quoteId
    })
  }
  async write(id: string, kind: 'save' | 'submit'): Promise<void> {
    const doc = this.editable(id)
    doc.error = null
    doc.pending = { kind, command: { generation: this.readyData.generation, operationId: this.ids.next(), expectedRevision: doc.record?.revision ?? null, draft: copy(doc.draft) } }
    this.emit(); await this.execute(doc)
  }
  private async execute(doc: OrderDocument): Promise<void> {
    const pending = doc.pending!
    try {
      const result = await (pending.kind === 'save' ? this.repository.saveDraft(pending.command) : this.repository.submitOrder(pending.command))
      this.accept(doc, result)
    } catch (error) {
      doc.error = error instanceof ProcurementError ? error : new ProcurementError('UNKNOWN', String(error))
      doc.uncertain = uncertainCodes.has(doc.error.code) || doc.error.code === 'UNKNOWN'
      if (!doc.uncertain) doc.pending = null
    }
    this.emit()
    // A refresh failure must not turn a confirmed commit into an unknown write.
    if (!doc.pending) await this.refresh().catch(() => {})
  }
  private accept(doc: OrderDocument, result: WriteResult): void {
    doc.record = result.record; doc.draft = copy(result.record.draft); doc.baseline = JSON.stringify(doc.draft)
    doc.pending = null; doc.uncertain = false; doc.error = null
  }
  async reconcile(id: string): Promise<void> {
    const doc = this.documents.get(id)
    if (!doc?.pending || !doc.uncertain) return
    let confirmed = false
    try {
      const result = await this.repository.getOperationResult(doc.pending.command.generation, doc.pending.command.operationId)
      if (result) { this.accept(doc, result); confirmed = true }
      else { doc.uncertain = false; await this.execute(doc) }
    } catch (error) { doc.error = error instanceof ProcurementError ? error : new ProcurementError('UNKNOWN', String(error)) }
    this.emit()
    if (confirmed) await this.refresh().catch(() => {})
  }
  async exportData(): Promise<string> {
    if (this.hasPending) throw new ProcurementError('PENDING', '请先确认正在进行的操作')
    return this.repository.exportData()
  }
  async reset(discard: boolean): Promise<void> {
    if (this.hasPending || (this.hasUnsaved && !discard)) throw new ProcurementError('PENDING', '请先处理未保存订单')
    this.resetPending = true; this.resetError = null; this.emit()
    try {
      this.readyData = await this.repository.resetDemo(this.readyData.generation)
      this.documents.clear(); this.activeId = null; this.resetPending = false; this.emit()
    } catch (error) {
      this.resetError = error instanceof ProcurementError ? error : new ProcurementError('UNKNOWN', String(error))
      this.resetPending = uncertainCodes.has(this.resetError.code) || this.resetError.code === 'UNKNOWN'
      this.emit(); throw error
    }
    await this.refresh()
  }
  async reconcileReset(): Promise<void> {
    if (!this.resetPending) return
    // A queued read observes completion of the previous reset, even if its reply was lost.
    const ready = await this.repository.ready()
    const committed = ready.generation !== this.readyData.generation
    this.resetPending = false; this.resetError = null
    if (committed) { this.readyData = ready; this.documents.clear(); this.activeId = null; await this.refresh() }
    else this.emit()
  }
  dispose(): void { this.disposed = true; this.listeners.clear(); this.repository.dispose() }
}
