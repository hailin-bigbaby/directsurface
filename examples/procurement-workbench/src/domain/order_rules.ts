import { isAvailableQuote } from './quotation_rules'
import { calculateAmounts, quantityInBase, scaled, sumAmounts } from './decimal'
import { ProcurementError, type FieldIssue, type OrderDraft, type ResolvedLine, type SeedData, type RequestAvailability, type Amounts } from './model'

export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
}
const check = (condition: unknown, message: string): void => { if (!condition) throw new ProcurementError('INVALID_INPUT', message) }
const text = (value: unknown, max = 2000): value is string => typeof value === 'string' && value.length <= max
const id = (value: unknown): value is string => text(value, 120) && /^[\w.-]+$/.test(value)
function keys(value: object, allowed: string[]): void { check(Object.keys(value).every(k => allowed.includes(k)), '请求包含未允许的派生字段') }
export function assertDraft(value: unknown): asserts value is OrderDraft {
  check(value && typeof value === 'object' && !Array.isArray(value), '订单结构无效')
  const d = value as OrderDraft
  keys(d, ['id', 'supplierId', 'conditionProfileId', 'receiptSiteId', 'remark', 'lines'])
  check(id(d.id) && id(d.receiptSiteId), '订单或收货地点标识无效')
  check((d.supplierId === null || id(d.supplierId)) && (d.conditionProfileId === null || id(d.conditionProfileId)), '供应商或条款标识无效')
  check(text(d.remark) && Array.isArray(d.lines) && d.lines.length > 0 && d.lines.length <= 200, '订单需要 1–200 条来源明细')
  const seen = new Set<string>(); const seenIds = new Set<string>()
  for (const line of d.lines) {
    check(line && typeof line === 'object', '明细结构无效')
    keys(line, ['id', 'requestId', 'quoteId', 'quantity', 'deliveryDate', 'remark'])
    check(id(line.id) && id(line.requestId) && (line.quoteId === null || id(line.quoteId)), '明细标识无效')
    check(!seen.has(line.requestId) && !seenIds.has(line.id), '同一订单不能重复添加同一需求或明细标识')
    seen.add(line.requestId); seenIds.add(line.id)
    check(line.quantity === null || text(line.quantity, 24), '数量结构无效')
    check(text(line.deliveryDate, 10) && text(line.remark), '交货日期或备注格式无效')
  }
}
export function resolveDraft(draft: OrderDraft, seed: SeedData, submit: boolean): { lines: ResolvedLine[]; totals: Amounts; incomplete: boolean; warnings: FieldIssue[] } {
  assertDraft(draft)
  const issues: FieldIssue[] = []; const warnings: FieldIssue[] = []
  const required = (field: string, message: string) => issues.push({ field, message })
  const supplier = seed.suppliers.find(x => x.id === draft.supplierId)
  if (draft.supplierId !== null && !supplier) throw new ProcurementError('REFERENCE', '供应商不存在')
  if (!supplier || !supplier.enabled) required('supplierId', '请选择启用的供应商')
  const condition = seed.conditions.find(x => x.id === draft.conditionProfileId)
  if (draft.conditionProfileId !== null && !condition) throw new ProcurementError('REFERENCE', '付款条款不存在')
  if (!condition) required('conditionProfileId', '请选择相容的报价条款')
  if (!seed.receiptSites.some(x => x.id === draft.receiptSiteId)) throw new ProcurementError('REFERENCE', '收货地点不存在')
  const lines = draft.lines.map(line => {
    const request = seed.requests.find(x => x.id === line.requestId)
    if (!request) throw new ProcurementError('REFERENCE', '申购来源不存在')
    if (request.receiptSiteId !== draft.receiptSiteId) throw new ProcurementError('CONDITIONS', '收货地点不同，请分别制单')
    const item = seed.items.find(x => x.id === request.itemId)!
    let baseQuantity: string | null = null
    if (line.quantity !== null) {
      try { baseQuantity = quantityInBase(line.quantity, item.basePerPurchase, item.quantityScale) }
      catch (error) { throw new ProcurementError('VALIDATION', '请修正明细数量', [{ field: `${line.id}.quantity`, message: (error as Error).message }]) }
    } else required(`${line.id}.quantity`, '请填写采购数量')
    if (line.deliveryDate && !validDate(line.deliveryDate)) throw new ProcurementError('VALIDATION', '到货日期无效', [{ field: `${line.id}.deliveryDate`, message: '请输入有效日期' }])
    if (!line.deliveryDate || line.deliveryDate < seed.businessDate) required(`${line.id}.deliveryDate`, '到货日期不能早于演示业务日期')
    if (line.deliveryDate > request.neededOn) {
      warnings.push({ field: `${line.id}.deliveryDate`, message: '晚于申购期望日期，请说明原因' })
      if (!line.remark.trim()) required(`${line.id}.remark`, '延期到货需要填写说明')
    }
    const quote = seed.quotes.find(x => x.id === line.quoteId)
    if (line.quoteId !== null && !quote) throw new ProcurementError('REFERENCE', '报价不存在')
    if (quote && (quote.itemId !== item.id || quote.supplierId !== draft.supplierId || quote.conditionProfileId !== draft.conditionProfileId)) {
      throw new ProcurementError('CONDITIONS', '报价与供应商、品目或条款不匹配')
    }
    if (!quote) required(`${line.id}.quoteId`, '请选择有效报价')
    else if (!isAvailableQuote(quote, seed)) required(`${line.id}.quoteId`, '报价已停用或不在有效期内')
    return {
      id: line.id, requestId: request.id, itemId: item.id, code: item.code, name: item.name,
      specification: quote?.specification ?? item.specification, department: request.department,
      purchaseUnit: item.purchaseUnit, baseUnit: item.baseUnit, basePerPurchase: item.basePerPurchase,
      baseQuantity, unitPrice: quote?.unitPrice ?? null, taxBps: quote?.taxBps ?? null, quoteReference: quote?.reference ?? null,
      amounts: quote && line.quantity !== null ? calculateAmounts(line.quantity, quote.unitPrice, quote.taxBps) : null,
    }
  })
  if (submit && issues.length) throw new ProcurementError('VALIDATION', '提交前请补齐必要资料', issues)
  return { lines, totals: sumAmounts(lines.flatMap(l => l.amounts ? [l.amounts] : [])), incomplete: issues.length > 0, warnings }
}
export function validateAvailability(lines: ResolvedLine[], availability: RequestAvailability[], seed: SeedData): void {
  const issues: FieldIssue[] = []
  for (const line of lines) {
    const request = seed.requests.find(x => x.id === line.requestId)!
    const used = availability.find(x => x.requestId === request.id)
    if (scaled(used?.submittedBaseQuantity ?? '0', 3) + scaled(line.baseQuantity!, 3) > scaled(request.initialBaseQuantity, 3)) issues.push({ field: `${line.id}.quantity`, message: `${request.number} 剩余可采购量不足，请刷新需求` })
    if (request.initialGrossCents !== null && BigInt(used?.submittedGrossCents ?? '0') + BigInt(line.amounts!.grossCents) > BigInt(request.initialGrossCents)) issues.push({ field: `${line.id}.quoteId`, message: `${request.number} 超过来源批准金额上限` })
  }
  if (issues.length) throw new ProcurementError('SOURCE_CONFLICT', '来源数量或批准金额不足', issues)
}
