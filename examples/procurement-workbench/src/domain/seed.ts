import { scaled } from './decimal'
import { ProcurementError, type SeedData } from './model'
import { assertDraft, resolveDraft, validDate } from './order_rules'

export function validateSeed(input: unknown): SeedData {
  const fail = (message: string): never => { throw new ProcurementError('SEED_INVALID', message) }
  if (!input || typeof input !== 'object') fail('样本结构无效')
  const s = input as SeedData
  if (s.schemaVersion !== 1 || typeof s.seedVersion !== 'string' || !validDate(s.businessDate) || typeof s.company !== 'string') fail('样本版本或业务日期无效')
  const collections = [s.suppliers, s.items, s.requests, s.quotes, s.conditions, s.receiptSites]
  for (const rows of collections) {
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 10_000) fail('样本记录数量无效')
    const ids = rows.map(r => r?.id)
    if (ids.some(v => typeof v !== 'string' || !/^[\w.-]{1,120}$/.test(v)) || new Set(ids).size !== ids.length) fail('样本标识重复或无效')
  }
  const strings = (o: object, names: string[]) => {
    for (const name of names) { const v = (o as Record<string, unknown>)[name]; if (typeof v !== 'string' || v.length > 2000) fail(`样本字段 ${name} 无效`) }
  }
  for (const supplier of s.suppliers) { strings(supplier, ['name', 'code']); if (typeof supplier.enabled !== 'boolean') fail('供应商状态无效') }
  for (const c of s.conditions) strings(c, ['name', 'paymentTerms'])
  for (const r of s.receiptSites) strings(r, ['name', 'address', 'contact'])
  for (const item of s.items) {
    strings(item, ['code', 'name', 'specification', 'purchaseUnit', 'baseUnit'])
    if (!['supply', 'equipment'].includes(item.kind) || !Number.isInteger(item.quantityScale) || item.quantityScale < 0 || item.quantityScale > 3 || scaled(item.basePerPurchase, 3) <= 0n) fail('品目单位或精度无效')
  }
  for (const r of s.requests) {
    strings(r, ['number', 'department', 'purpose', 'stockReview', 'approvedBy'])
    if (!s.items.some(i => i.id === r.itemId) || !s.receiptSites.some(i => i.id === r.receiptSiteId) || !validDate(r.neededOn)) fail('申购引用或日期无效')
    scaled(r.initialBaseQuantity, 3)
    if (r.initialGrossCents !== null && (typeof r.initialGrossCents !== 'string' || !/^\d{1,16}$/.test(r.initialGrossCents))) fail('批准金额无效')
  }
  for (const q of s.quotes) {
    strings(q, ['specification', 'warranty', 'reference'])
    if (!s.items.some(i => i.id === q.itemId) || !s.suppliers.some(i => i.id === q.supplierId) || !s.conditions.some(i => i.id === q.conditionProfileId)) fail('报价引用无效')
    if (!validDate(q.validFrom) || !validDate(q.validTo) || q.validFrom > q.validTo || typeof q.enabled !== 'boolean' || !Number.isInteger(q.taxBps) || q.taxBps < 0 || q.taxBps > 10000 || scaled(q.unitPrice, 4) <= 0n) fail('报价数值/有效期无效')
  }
  if (!Array.isArray(s.initialOrders) || s.initialOrders.length > 100) fail('初始订单无效')
  const orderIds = new Set<string>()
  for (const order of s.initialOrders) {
    if (!['draft', 'submitted'].includes(order.status) || orderIds.has(order.draft?.id)) fail('初始订单重复或状态无效')
    assertDraft(order.draft); resolveDraft(order.draft, s, order.status === 'submitted'); orderIds.add(order.draft.id)
  }
  return s
}
