import { beforeAll, afterEach, expect, it } from 'vitest'
import sqlite3InitModule, { type Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import { readFileSync } from 'node:fs'
import { ProcurementWorkbench } from './workbench'
import { SqliteProcurementRepository } from '../infrastructure/sqlite/repository'
import { SqlConnection } from '../infrastructure/sqlite/connection'
import { ProcurementError, type SeedData } from '../domain/model'
const seed: SeedData = JSON.parse(readFileSync(new URL('../../public/data/seed.json', import.meta.url), 'utf8'))
let sqlite: Sqlite3Static
const apps: ProcurementWorkbench[] = []
beforeAll(async () => { sqlite = await sqlite3InitModule() })
afterEach(() => { apps.splice(0).forEach(a => a.dispose()) })
async function setup() {
  const repo = new SqliteProcurementRepository(new SqlConnection(new sqlite.oo1.DB(':memory:', 'c')), 'memory', sqlite.version.libVersion)
  await repo.initialize(async () => seed)
  const app = new ProcurementWorkbench(repo, { next: () => crypto.randomUUID() }); apps.push(app); await app.start()
  return { app, repo }
}
it('isolates documents, reuses an open document, and clears supplier quotations atomically', async () => {
  const { app } = await setup(); const a = app.create(['r1', 'r2']); const b = app.create(['r3'])
  app.changeLine(a.draft.id, a.draft.lines[0].id, { quantity: '2' }); app.chooseQuote(a.draft.id, a.draft.lines[0].id, 'q-paper-s1')
  expect(await app.open(a.draft.id)).toBe(a); expect(b.draft.lines[0].quantity).toBeNull()
  app.changeSupplier(a.draft.id, 's2'); expect(a.draft.lines[0].quoteId).toBeNull(); expect(a.draft.lines[0].quantity).toBe('2')
  expect(app.close(a.draft.id)).toBe(false)
  await app.write(a.draft.id, 'save'); expect(app.close(a.draft.id)).toBe(true)
})
it('rejects incompatible source grouping without opening a partial document', async () => {
  const { app } = await setup()
  expect(() => app.create(['r1', 'r5'])).toThrow('分别制单'); expect(app.documents.size).toBe(0)
  expect(() => app.create(['missing'])).toThrow()
})
it('freezes a lost-reply submission, blocks edits/close/reset, then recovers exactly once', async () => {
  const { app, repo } = await setup(); const doc = app.create(['r1']); const id = doc.draft.id
  app.changeLine(id, doc.draft.lines[0].id, { quantity: '2' }); app.chooseQuote(id, doc.draft.lines[0].id, 'q-paper-s1')
  const submit = repo.submitOrder.bind(repo)
  repo.submitOrder = async command => { await submit(command); throw new ProcurementError('REQUEST_TIMEOUT', 'reply lost') }
  await app.write(id, 'submit')
  expect(doc.uncertain).toBe(true); expect(app.close(id, true)).toBe(false)
  expect(() => app.changeRemark(id, 'bad')).toThrow(); await expect(app.reset(true)).rejects.toThrow()
  await app.reconcile(id)
  expect(doc.pending).toBeNull(); expect(doc.record?.status).toBe('submitted'); expect(app.orders.filter(o => o.id === id)).toHaveLength(1)
  expect(app.remaining('r1')).toBe('40')
})
it('retains a failed submit as unsaved without allocating a number', async () => {
  const { app } = await setup(); const doc = app.create(['r5'])
  app.changeLine(doc.draft.id, doc.draft.lines[0].id, { quantity: '1' })
  await app.write(doc.draft.id, 'submit')
  expect(doc.error?.code).toBe('VALIDATION'); expect(doc.record).toBeNull(); expect(doc.pending).toBeNull()
  await app.write(doc.draft.id, 'save'); expect(doc.record?.number).toMatch(/0009$/)
})
it('recovers a reset whose reply was lost and does not reapply old drafts', async () => {
  const { app, repo } = await setup(); const doc = app.create(['r1']); const reset = repo.resetDemo.bind(repo)
  repo.resetDemo = async generation => { await reset(generation); throw new ProcurementError('REQUEST_TIMEOUT', 'reply lost') }
  await expect(app.reset(true)).rejects.toThrow(); expect(app.hasPending).toBe(true)
  expect(() => app.changeRemark(doc.draft.id, 'old')).toThrow()
  await app.reconcileReset(); expect(app.hasPending).toBe(false); expect(app.documents.size).toBe(0)
})

it('reuses the same document when overlapping reads finish after editing has begun', async () => {
  const { app, repo } = await setup()
  const read = repo.getOrder.bind(repo)
  let finish!: () => void
  let calls = 0
  repo.getOrder = async id => {
    const record = await read(id)
    if (++calls === 2) await new Promise<void>(resolve => { finish = resolve })
    return record
  }
  const first = app.open('sample-order-8'); const second = app.open('sample-order-8')
  const a = await first; app.changeRemark(a.draft.id, '并发打开不能覆盖这次编辑')
  finish(); const b = await second
  expect(b).toBe(a); expect(b.draft.remark).toBe('并发打开不能覆盖这次编辑')
})
it('does not classify a failed refresh after a committed reset as an unknown reset', async () => {
  const { app, repo } = await setup(); const previous = app.readyData.generation
  app.create(['r1'])
  repo.listOrders = async () => { throw new ProcurementError('REQUEST_TIMEOUT', 'list timed out') }
  await expect(app.reset(true)).rejects.toThrow('list timed out')
  expect(app.readyData.generation).not.toBe(previous)
  expect(app.resetPending).toBe(false); expect(app.documents.size).toBe(0)
})
it('uses the same quotation eligibility and line validation outside the UI', async () => {
  const { app } = await setup(); const doc = app.create(['r5'])
  expect(app.validateLineChange(doc.draft.id, doc.draft.lines[0].id, { quantity: '0.5' })).not.toBe(true)
  app.readyData.seed.suppliers.find(s => s.id === 's1')!.enabled = false
  expect(app.quotesFor(doc, doc.draft.lines[0].id).some(q => q.supplierId === 's1')).toBe(false)
  expect(() => app.chooseQuote(doc.draft.id, doc.draft.lines[0].id, 'q-monitor-s1')).toThrow('有效报价')
})
it('ignores a delayed list response from before reset', async () => {
  const { app, repo } = await setup()
  const doc = app.create(['r1']); await app.write(doc.draft.id, 'save')
  const original = repo.listOrders.bind(repo)
  let finish!: () => void
  let first = true
  repo.listOrders = async () => {
    const rows = await original()
    if (first) { first = false; await new Promise<void>(resolve => { finish = resolve }) }
    return rows
  }
  const stale = app.refresh()
  await Promise.resolve(); await app.reset(true)
  finish(); await stale
  expect(app.orders).toHaveLength(8)
  expect(app.orders.some(o => o.id === doc.draft.id)).toBe(false)
})
it('does not clear quotations when setting the same supplier', async () => {
  const { app } = await setup(); const doc = await app.open('sample-order-8')
  app.changeSupplier(doc.draft.id, doc.draft.supplierId)
  expect(app.dirty(doc)).toBe(false)
  expect(() => app.changeSupplier(doc.draft.id, 's6')).toThrow('启用')
})
it('keeps a recovered write confirmed when the subsequent list refresh fails', async () => {
  const { app, repo } = await setup(); const doc = app.create(['r1']); const save = repo.saveDraft.bind(repo)
  repo.saveDraft = async command => { await save(command); throw new ProcurementError('REQUEST_TIMEOUT', 'reply lost') }
  await app.write(doc.draft.id, 'save')
  repo.listOrders = async () => { throw new ProcurementError('REQUEST_TIMEOUT', 'list unavailable') }
  await app.reconcile(doc.draft.id)
  expect(doc.pending).toBeNull(); expect(doc.error).toBeNull(); expect(doc.record?.status).toBe('draft')
  expect(app.refreshError).toContain('列表刷新失败')
})
