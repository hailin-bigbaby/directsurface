import { beforeAll, afterEach, describe, expect, it } from 'vitest'
import sqlite3InitModule, {type Sqlite3Static} from '@sqlite.org/sqlite-wasm'
import { readFileSync } from 'node:fs'
import type { SeedData, WriteCommand } from '../../domain/model'
import { copy } from '../../domain/model'
import { SqlConnection } from './connection'
import { SqliteProcurementRepository } from './repository'

const seed:SeedData=JSON.parse(readFileSync(new URL('../../../public/data/seed.json',import.meta.url),'utf8'))
let sqlite:Sqlite3Static
const repos:SqliteProcurementRepository[]=[]
beforeAll(async()=>{sqlite=await sqlite3InitModule()})
afterEach(()=>{for(const r of repos.splice(0))r.dispose()})
async function create(fault?:()=>void,customSeed=seed){
  const connection=new SqlConnection(new sqlite.oo1.DB(':memory:','c'))
  let id=0
  const repo=new SqliteProcurementRepository(connection,'memory',sqlite.version.libVersion,{id:()=>`generation-${++id}`,now:()=> '2026-10-21T00:00:00.000Z'},fault)
  repos.push(repo);await repo.initialize(async()=>copy(customSeed));return{repo,connection}
}
async function command(repo:SqliteProcurementRepository,orderId='new-order',quantity='2'):Promise<WriteCommand>{
 return{operationId:crypto.randomUUID(),generation:(await repo.ready()).generation,expectedRevision:null,draft:{id:orderId,supplierId:'s1',conditionProfileId:'office',receiptSiteId:'hq',remark:'',lines:[{id:`line-${orderId}`,requestId:'r1',quoteId:'q-paper-s1',quantity,deliveryDate:'2026-10-28',remark:''}]}}
}
describe('real SQLite order transactions',()=>{
 it('creates on first direct submit, computes prices, persists immutable state and returns an idempotent result',async()=>{
  const{repo}=await create();const c=await command(repo)
  const result=await repo.submitOrder(c)
  expect(result.record.status).toBe('submitted');expect(result.record.revision).toBe(1)
  expect(result.record.resolvedLines[0].baseQuantity).toBe('10')
  expect(result.record.totals.grossCents).toBe('24000')
  expect(await repo.submitOrder(c)).toEqual(result)
  expect(await repo.getOperationResult(c.generation,c.operationId)).toEqual(result)
  await expect(repo.saveDraft({...c,operationId:'another',expectedRevision:1})).rejects.toMatchObject({code:'READONLY'})
 })
 it('rejects changed payload under the same operation and separates generation from revision',async()=>{
  const{repo}=await create();const c=await command(repo);await repo.saveDraft(c)
  const changed=copy(c);changed.draft.remark='different'
  await expect(repo.saveDraft(changed)).rejects.toMatchObject({code:'OPERATION_MISMATCH'})
  await expect(repo.saveDraft({...c,operationId:'new'})).rejects.toMatchObject({code:'REVISION_CONFLICT'})
  await repo.resetDemo(c.generation)
  await expect(repo.saveDraft(c)).rejects.toMatchObject({code:'DATASET_CHANGED'})
 })
 it('checks competing source allocations in base units rather than purchasing units',async()=>{
  const{repo}=await create();const a=await command(repo,'a','6');const b=await command(repo,'b','5')
  await repo.saveDraft(a);await repo.saveDraft(b)
  await repo.submitOrder({...a,operationId:'submit-a',expectedRevision:1})
  await expect(repo.submitOrder({...b,operationId:'submit-b',expectedRevision:1})).rejects.toMatchObject({code:'SOURCE_CONFLICT'})
  expect((await repo.getOrder('b'))?.status).toBe('draft');expect((await repo.getOrder('b'))?.revision).toBe(1)
  expect((await repo.availability()).find(r=>r.requestId==='r1')?.submittedBaseQuantity).toBe('30')
 })
 it('allows missing quote in a draft, rejects submit, and never pre-saves a failing new submission',async()=>{
  const{repo}=await create();const c=await command(repo);c.draft.lines[0].quoteId=null
  const saved=await repo.saveDraft(c);expect(saved.record.incomplete).toBe(true)
  expect(saved.record.resolvedLines[0].amounts).toBeNull()
  const next=copy(c);next.operationId='submit';next.expectedRevision=1;next.draft.remark='not saved'
  await expect(repo.submitOrder(next)).rejects.toMatchObject({code:'VALIDATION'})
  expect((await repo.getOrder(c.draft.id))?.draft.remark).toBe('')
  const absent=await command(repo,'absent','11')
  await expect(repo.submitOrder(absent)).rejects.toMatchObject({code:'SOURCE_CONFLICT'})
  expect(await repo.getOrder('absent')).toBeNull()
 })
 it('rolls back all data, numbering and operation result if a statement phase fails',async()=>{
  let fail=false;const{repo}=await create(()=>{if(fail)throw Error('injected failure')});const c=await command(repo)
  const before=await repo.exportData();fail=true
  await expect(repo.submitOrder(c)).rejects.toThrow('injected failure')
  expect(await repo.exportData()).toBe(before);expect(await repo.getOperationResult(c.generation,c.operationId)).toBeNull()
  fail=false;expect((await repo.submitOrder(c)).record.number).toMatch(/0009$/)
 })
 it('reopens an existing database without downloading seed or overwriting edits',async()=>{
  const{repo}=await create();const c=await command(repo);c.draft.remark='persisted';await repo.saveDraft(c)
  await repo.initialize(async()=>{throw Error('must not load seed')})
  expect((await repo.getOrder(c.draft.id))?.draft.remark).toBe('persisted')
 })
 it('preserves foreign databases and invalid metadata',async()=>{
  const{repo,connection}=await create();connection.exec("UPDATE app_meta SET value='99' WHERE key='schema'")
  await expect(repo.initialize(async()=>seed)).rejects.toMatchObject({code:'DATABASE_VERSION'})
  expect(connection.rows<{value:string}>("SELECT value FROM app_meta WHERE key='schema'")[0].value).toBe('99')
 })
 it('rejects forged derived fields, incompatible quotation and excess approval amount',async()=>{
  const custom=copy(seed);custom.requests[0].initialGrossCents='10000';const{repo}=await create(undefined,custom)
  const c=await command(repo)
  await expect(repo.submitOrder(c)).rejects.toMatchObject({code:'SOURCE_CONFLICT'})
  await expect(repo.saveDraft({...c,draft:{...c.draft,totals:{grossCents:'0'}}} as unknown as WriteCommand)).rejects.toMatchObject({code:'INVALID_INPUT'})
  c.draft.lines[0].quoteId='q-paper-s2'
  await expect(repo.saveDraft(c)).rejects.toMatchObject({code:'CONDITIONS'})
 })
})

it('rolls back a failed reset and retains generation, user orders and idempotent receipts', async () => {
  let fail = false
  const { repo } = await create(() => { if (fail) throw Error('reset failure') })
  const c = await command(repo); await repo.saveDraft(c)
  const before = await repo.exportData(); fail = true
  await expect(repo.resetDemo(c.generation)).rejects.toThrow('reset failure')
  expect(await repo.exportData()).toBe(before)
  expect((await repo.getOperationResult(c.generation, c.operationId))?.record.id).toBe(c.draft.id)
})
it('does not create partial schema when initial seed validation fails', async () => {
  const sql = new SqlConnection(new sqlite.oo1.DB(':memory:', 'c'))
  const repo = new SqliteProcurementRepository(sql, 'memory', sqlite.version.libVersion); repos.push(repo)
  const invalid = copy(seed); invalid.quotes[0].itemId = 'absent'
  await expect(repo.initialize(async () => invalid)).rejects.toThrow()
  expect(sql.rows("SELECT name FROM sqlite_master WHERE type='table'")).toHaveLength(0)
  await repo.initialize(async () => seed); expect(await repo.listOrders()).toHaveLength(8)
})
it('requires late-delivery explanation and rejects expired quotation for submission', async () => {
  const { repo } = await create(); const c = await command(repo)
  c.draft.lines[0].deliveryDate = '2026-11-01'
  await expect(repo.submitOrder(c)).rejects.toMatchObject({ code: 'VALIDATION' })
  c.draft.lines[0].remark = '需求部门已确认延期（演示）'
  expect((await repo.submitOrder(c)).record.status).toBe('submitted')
  const expired = await command(repo, 'expired'); expired.draft.supplierId = 's4'; expired.draft.lines[0].quoteId = 'q-paper-expired'
  await expect(repo.submitOrder(expired)).rejects.toMatchObject({ code: 'VALIDATION' })
})
it('exports only committed snapshots and preserves a foreign database on initialization', async () => {
  const { repo } = await create(); const c = await command(repo); await repo.saveDraft(c)
  const snapshot = JSON.parse(await repo.exportData())
  expect(snapshot.orders.find((o: any) => o.id === c.draft.id).draft).toEqual(c.draft)
  const sql = new SqlConnection(new sqlite.oo1.DB(':memory:', 'c'))
  sql.exec('CREATE TABLE unrelated(value TEXT)'); sql.exec("INSERT INTO unrelated VALUES('keep')")
  const other = new SqliteProcurementRepository(sql, 'memory', sqlite.version.libVersion); repos.push(other)
  await expect(other.initialize(async () => seed)).rejects.toMatchObject({ code: 'DATABASE_INVALID' })
  expect(sql.rows('SELECT value FROM unrelated')).toEqual([{ value: 'keep' }])
})
