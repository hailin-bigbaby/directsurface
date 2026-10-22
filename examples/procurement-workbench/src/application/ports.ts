import type { OrderRecord, ReadyData, RequestAvailability, WriteCommand, WriteResult } from '../domain/model'

export interface ProcurementRepository {
  ready(): Promise<ReadyData>
  listOrders(): Promise<OrderRecord[]>
  getOrder(id: string): Promise<OrderRecord | null>
  availability(): Promise<RequestAvailability[]>
  saveDraft(command: WriteCommand): Promise<WriteResult>
  submitOrder(command: WriteCommand): Promise<WriteResult>
  getOperationResult(generation: string, operationId: string): Promise<WriteResult | null>
  exportData(): Promise<string>
  resetDemo(generation: string): Promise<ReadyData>
  dispose(): void
}
export interface RuntimeIds { next(): string }
