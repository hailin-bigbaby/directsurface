export interface Supplier { id: string; name: string; code: string; enabled: boolean }
export interface CatalogItem {
  id: string; code: string; name: string; specification: string; kind: 'supply' | 'equipment'
  purchaseUnit: string; baseUnit: string; basePerPurchase: string; quantityScale: number
}
export interface RequestLine {
  id: string; number: string; department: string; purpose: string; itemId: string; receiptSiteId: string
  initialBaseQuantity: string; initialGrossCents: string | null; neededOn: string; stockReview: string; approvedBy: string
}
export interface Quote {
  id: string; supplierId: string; itemId: string; conditionProfileId: string; unitPrice: string; taxBps: number
  validFrom: string; validTo: string; enabled: boolean; specification: string; warranty: string; reference: string
}
export interface ConditionProfile { id: string; name: string; paymentTerms: string }
export interface ReceiptSite { id: string; name: string; address: string; contact: string }
export interface LineDraft { id: string; requestId: string; quoteId: string | null; quantity: string | null; deliveryDate: string; remark: string }
export interface OrderDraft {
  id: string; supplierId: string | null; conditionProfileId: string | null; receiptSiteId: string
  remark: string; lines: LineDraft[]
}
export interface SeedData {
  schemaVersion: 1; seedVersion: string; businessDate: string; company: string
  suppliers: Supplier[]; items: CatalogItem[]; requests: RequestLine[]; quotes: Quote[]
  conditions: ConditionProfile[]; receiptSites: ReceiptSite[]
  initialOrders: { draft: OrderDraft; status: 'draft' | 'submitted' }[]
}
export interface Amounts { grossCents: string; netCents: string; taxCents: string }
export interface ResolvedLine {
  id: string; requestId: string; itemId: string; code: string; name: string; specification: string
  department: string; purchaseUnit: string; baseUnit: string; basePerPurchase: string
  baseQuantity: string | null; unitPrice: string | null; taxBps: number | null; quoteReference: string | null
  amounts: Amounts | null
}
export interface OrderRecord {
  id: string; number: string; status: 'draft' | 'submitted'; revision: number; updatedAt: string
  businessDate: string; draft: OrderDraft; resolvedLines: ResolvedLine[]; totals: Amounts; incomplete: boolean
}
export interface RequestAvailability { requestId: string; submittedBaseQuantity: string; submittedGrossCents: string }
export interface FieldIssue { field: string; message: string }
export class ProcurementError extends Error {
  constructor(public readonly code: string, message: string, public readonly issues: FieldIssue[] = []) { super(message); this.name = 'ProcurementError' }
}
export interface WriteCommand {
  operationId: string; generation: string; expectedRevision: number | null; draft: OrderDraft
}
export interface WriteResult { generation: string; operationId: string; record: OrderRecord }
export interface ReadyData {
  generation: string; storageMode: 'opfs' | 'memory'; sqliteVersion: string; seed: SeedData
}
export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
