import type { FieldIssue } from '../domain/model'
export interface InitOptions { mode: 'opfs'|'memory'; namespace: string; manifestUrl: string }
export type Method = 'ready'|'listOrders'|'getOrder'|'availability'|'saveDraft'|'submitOrder'|'getOperationResult'|'exportData'|'resetDemo'
export interface RpcRequest { version: 1; id: number; method: Method|'initialize'; args: unknown[] }
export interface RpcResponse { version: 1; id: number; result?: unknown; error?: { code: string; message: string; issues: FieldIssue[] } }
