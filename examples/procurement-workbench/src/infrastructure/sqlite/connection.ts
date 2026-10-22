import type { Database } from '@sqlite.org/sqlite-wasm'
export type BindValue = string | number | null
export class SqlConnection {
  constructor(readonly db: Database) {}
  exec(sql: string, bind: BindValue[] = []): void { this.db.exec({ sql, bind }) }
  rows<T extends object>(sql: string, bind: BindValue[] = []): T[] {
    return this.db.exec({ sql, bind, rowMode: 'object', returnValue: 'resultRows' }) as unknown as T[]
  }
  transaction<T>(action: () => T): T {
    this.exec('BEGIN IMMEDIATE')
    try { const result = action(); this.exec('COMMIT'); return result }
    catch (error) { try { this.exec('ROLLBACK') } catch { /* preserve original transaction error */ } throw error }
  }
}
