import type { ProcurementRepository } from '../../application/ports'
import { ProcurementError, copy, type OrderRecord, type ReadyData, type RequestAvailability, type SeedData, type WriteCommand, type WriteResult } from '../../domain/model'
import { decimal, scaled } from '../../domain/decimal'
import { assertDraft, resolveDraft, validateAvailability } from '../../domain/order_rules'
import { validateSeed } from '../../domain/seed'
import { SqlConnection } from './connection'

const SCHEMA = `
CREATE TABLE app_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE suppliers(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE catalog_items(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE request_lines(id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES catalog_items(id), data TEXT NOT NULL);
CREATE TABLE quote_lines(id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id), item_id TEXT NOT NULL REFERENCES catalog_items(id), data TEXT NOT NULL);
CREATE TABLE orders(id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, status TEXT NOT NULL CHECK(status IN ('draft','submitted')), revision INTEGER NOT NULL CHECK(revision>0), data TEXT NOT NULL);
CREATE TABLE order_lines(id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, request_id TEXT NOT NULL REFERENCES request_lines(id), base_milli INTEGER, gross_cents INTEGER, UNIQUE(order_id,request_id));
CREATE INDEX source_orders ON order_lines(request_id,order_id);
CREATE TABLE write_operations(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, data TEXT NOT NULL);
`
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}'
  return JSON.stringify(value)
}
export class SqliteProcurementRepository implements ProcurementRepository {
  private seed!: SeedData
  private generation = ''
  private disposed = false
  /** Injected only by unit tests; never selected by a URL or production RPC. */
  constructor(private readonly sql: SqlConnection, private readonly mode: 'opfs' | 'memory', private readonly sqliteVersion: string,
    private readonly environment: { id: () => string; now: () => string } = { id: () => crypto.randomUUID(), now: () => new Date().toISOString() },
    private readonly beforeCommit?: () => void) {}

  async initialize(loadSeed: () => Promise<SeedData>): Promise<ReadyData> {
    this.sql.exec('PRAGMA foreign_keys = ON')
    const tables = this.sql.rows<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    if (tables.length === 0) {
      const seed = validateSeed(await loadSeed())
      const generation = this.environment.id()
      this.sql.transaction(() => { this.sql.exec(SCHEMA); this.populate(seed, generation) })
    } else {
      if (!tables.some(t => t.name === 'app_meta')) throw new ProcurementError('DATABASE_INVALID', '已有数据库缺少身份标记，已保留原数据')
      if (this.meta('application') !== 'directsurface-procurement-demo' || this.meta('schema') !== '1' || this.meta('initialized') !== 'yes') throw new ProcurementError('DATABASE_VERSION', '数据库身份或结构版本不兼容，已停止写入')
      this.seed = validateSeed(JSON.parse(this.meta('seed')))
      this.generation = this.meta('generation')
      if (!this.generation || this.sql.rows('PRAGMA foreign_key_check').length) throw new ProcurementError('DATABASE_INVALID', '数据库关联校验失败，已保留原数据')
    }
    return this.ready()
  }
  private populate(seed: SeedData, generation: string): void {
    this.seed = copy(seed); this.generation = generation
    for (const [key,value] of Object.entries({ application:'directsurface-procurement-demo',schema:'1',seed:JSON.stringify(seed),generation,nextNumber:'1',initialized:'yes' })) this.setMeta(key,value)
    for (const r of seed.suppliers) this.sql.exec('INSERT INTO suppliers VALUES(?,?)',[r.id,JSON.stringify(r)])
    for (const r of seed.items) this.sql.exec('INSERT INTO catalog_items VALUES(?,?)',[r.id,JSON.stringify(r)])
    for (const r of seed.requests) this.sql.exec('INSERT INTO request_lines VALUES(?,?,?)',[r.id,r.itemId,JSON.stringify(r)])
    for (const r of seed.quotes) this.sql.exec('INSERT INTO quote_lines VALUES(?,?,?,?)',[r.id,r.supplierId,r.itemId,JSON.stringify(r)])
    for (const initial of seed.initialOrders) {
      const resolved = resolveDraft(initial.draft,seed,initial.status==='submitted')
      if (initial.status==='submitted') validateAvailability(resolved.lines,this.readAvailability(),seed)
      this.persist({ id:initial.draft.id,number:this.nextNumber(),status:initial.status,revision:1,updatedAt:this.environment.now(),businessDate:seed.businessDate,draft:copy(initial.draft),resolvedLines:resolved.lines,totals:resolved.totals,incomplete:resolved.incomplete })
    }
  }
  private ensure(): void { if(this.disposed) throw new ProcurementError('DISPOSED','数据库已关闭') }
  private meta(key: string): string { return this.sql.rows<{value:string}>('SELECT value FROM app_meta WHERE key=?',[key])[0]?.value ?? '' }
  private setMeta(key: string,value: string): void { this.sql.exec('INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[key,value]) }
  private nextNumber(): string {
    const n=Number(this.meta('nextNumber')); if(!Number.isSafeInteger(n)||n<1) throw new ProcurementError('DATABASE_INVALID','单号序列无效')
    this.setMeta('nextNumber',String(n+1)); return `CG-${this.seed.businessDate.replaceAll('-','')}-${String(n).padStart(4,'0')}`
  }
  async ready(): Promise<ReadyData> { this.ensure(); return {generation:this.generation,storageMode:this.mode,sqliteVersion:this.sqliteVersion,seed:copy(this.seed)} }
  async listOrders(): Promise<OrderRecord[]> { this.ensure(); return this.sql.rows<{data:string}>('SELECT data FROM orders ORDER BY number DESC').map(r=>JSON.parse(r.data) as OrderRecord) }
  async getOrder(id: string): Promise<OrderRecord|null> { this.ensure(); return this.readOrder(id) }
  private readOrder(id: string): OrderRecord|null { const row=this.sql.rows<{data:string}>('SELECT data FROM orders WHERE id=?',[id])[0]; return row ? JSON.parse(row.data) as OrderRecord : null }
  private readAvailability(): RequestAvailability[] {
    return this.sql.rows<{request_id:string;qty:string;gross:string}>(`SELECT l.request_id,CAST(SUM(l.base_milli) AS TEXT) AS qty,CAST(SUM(l.gross_cents) AS TEXT) AS gross FROM order_lines l JOIN orders o ON o.id=l.order_id WHERE o.status='submitted' GROUP BY l.request_id`).map(r=>({requestId:r.request_id,submittedBaseQuantity:decimal(BigInt(r.qty),3),submittedGrossCents:r.gross}))
  }
  async availability(): Promise<RequestAvailability[]> { this.ensure(); return this.readAvailability() }
  async saveDraft(command: WriteCommand): Promise<WriteResult> { return this.write(command,'draft') }
  async submitOrder(command: WriteCommand): Promise<WriteResult> { return this.write(command,'submitted') }
  private write(command: WriteCommand,status: 'draft'|'submitted'): WriteResult {
    this.ensure()
    if(!command || typeof command.operationId!=='string' || !/^[\w.-]{1,120}$/.test(command.operationId)) throw new ProcurementError('INVALID_INPUT','操作标识无效')
    assertDraft(command.draft)
    const fingerprint=canonical({status,command})
    return this.sql.transaction(()=>{
      this.checkGeneration(command.generation)
      const previous=this.sql.rows<{fingerprint:string;data:string}>('SELECT fingerprint,data FROM write_operations WHERE id=?',[command.operationId])[0]
      if(previous) {
        if(previous.fingerprint!==fingerprint) throw new ProcurementError('OPERATION_MISMATCH','同一操作标识不能用于不同请求')
        return JSON.parse(previous.data) as WriteResult
      }
      const existing=this.readOrder(command.draft.id)
      if(existing ? existing.revision!==command.expectedRevision : command.expectedRevision!==null) throw new ProcurementError('REVISION_CONFLICT','订单版本已变化，请重新打开')
      if(existing?.status==='submitted') throw new ProcurementError('READONLY','已提交订单为只读，不能再次修改')
      const resolved=resolveDraft(command.draft,this.seed,status==='submitted')
      if(status==='submitted') validateAvailability(resolved.lines,this.readAvailability(),this.seed)
      const record:OrderRecord={id:command.draft.id,number:existing?.number??this.nextNumber(),status,revision:(existing?.revision??0)+1,updatedAt:this.environment.now(),businessDate:this.seed.businessDate,draft:copy(command.draft),resolvedLines:resolved.lines,totals:resolved.totals,incomplete:resolved.incomplete}
      this.persist(record)
      const result:WriteResult={generation:this.generation,operationId:command.operationId,record}
      this.sql.exec('INSERT INTO write_operations VALUES(?,?,?)',[command.operationId,fingerprint,JSON.stringify(result)])
      this.beforeCommit?.()
      return result
    })
  }
  private persist(record:OrderRecord): void {
    if(this.readOrder(record.id)) this.sql.exec('UPDATE orders SET status=?,revision=?,data=? WHERE id=?',[record.status,record.revision,JSON.stringify(record),record.id])
    else this.sql.exec('INSERT INTO orders VALUES(?,?,?,?,?)',[record.id,record.number,record.status,record.revision,JSON.stringify(record)])
    this.sql.exec('DELETE FROM order_lines WHERE order_id=?',[record.id])
    for(const line of record.resolvedLines) this.sql.exec('INSERT INTO order_lines VALUES(?,?,?,?,?)',[line.id,record.id,line.requestId,line.baseQuantity===null?null:String(scaled(line.baseQuantity,3)),line.amounts?.grossCents??null])
  }
  private checkGeneration(generation:string):void { if(generation!==this.generation) throw new ProcurementError('DATASET_CHANGED','数据集已重置，请重新打开工作台') }
  async getOperationResult(generation:string,operationId:string):Promise<WriteResult|null> {
    this.ensure();this.checkGeneration(generation)
    const row=this.sql.rows<{data:string}>('SELECT data FROM write_operations WHERE id=?',[operationId])[0]
    return row ? JSON.parse(row.data) as WriteResult : null
  }
  async exportData():Promise<string> {
    this.ensure()
    return this.sql.transaction(()=>JSON.stringify({format:'directsurface-procurement-export',version:1,generation:this.generation,seed:this.seed,orders:this.sql.rows<{data:string}>('SELECT data FROM orders ORDER BY number').map(r=>JSON.parse(r.data))},null,2))
  }
  async resetDemo(generation:string):Promise<ReadyData> {
    this.ensure();this.checkGeneration(generation)
    const previous=this.generation;const next=this.environment.id();const seed=copy(this.seed)
    try {
      this.sql.transaction(()=>{
        for(const table of ['write_operations','order_lines','orders','quote_lines','request_lines','catalog_items','suppliers','app_meta']) this.sql.exec(`DELETE FROM ${table}`)
        this.populate(seed,next);this.beforeCommit?.()
      })
    }catch(error){this.generation=previous;this.seed=seed;throw error}
    return this.ready()
  }
  dispose():void { if(!this.disposed){this.disposed=true;this.sql.db.close()} }
}
