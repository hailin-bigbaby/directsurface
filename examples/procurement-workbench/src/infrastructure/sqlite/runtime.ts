import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { ProcurementError } from '../../domain/model'
import type { InitOptions } from '../protocol'
import { loadSeed } from '../seed_loader'
import { SqlConnection } from './connection'
import { SqliteProcurementRepository } from './repository'

async function holdLock(namespace: string): Promise<void> {
  if (!navigator.locks) throw new ProcurementError('STORAGE_UNSUPPORTED','当前浏览器不支持所需的本地存储互斥能力')
  await new Promise<void>((resolve,reject)=>{
    void navigator.locks.request(`directsurface-procurement:${namespace}`,{ifAvailable:true},async lock=>{
      if(!lock){reject(new ProcurementError('DATABASE_BUSY','另一标签正在使用此工作台，请关闭它后重试'));return}
      resolve()
      // The Worker owns this lock for its entire lifetime, including pending I/O.
      await new Promise<void>(()=>{})
    }).catch(reject)
  })
}
export async function openRepository(options: InitOptions): Promise<SqliteProcurementRepository> {
  if(!options || !['memory','opfs'].includes(options.mode) || !/^[a-z0-9-]{1,60}$/.test(options.namespace)) throw new ProcurementError('INVALID_INPUT','存储配置无效')
  if(options.mode==='opfs') {
    if(!self.isSecureContext || !navigator.storage?.getDirectory || typeof FileSystemFileHandle==='undefined' || !('createSyncAccessHandle' in FileSystemFileHandle.prototype)) throw new ProcurementError('STORAGE_UNSUPPORTED','当前环境不能保存到浏览器，请使用支持OPFS的浏览器及HTTPS')
    await holdLock(options.namespace)
  }
  const sqlite = await sqlite3InitModule()
  const db = options.mode==='memory' ? new sqlite.oo1.DB(':memory:','c') : new (await sqlite.installOpfsSAHPoolVfs({
    name:`procurement-${options.namespace}`, directory:`/directsurface-procurement/${options.namespace}`,
    clearOnInit:false, preserveOnInitFailure:true, initialCapacity:6,
  })).OpfsSAHPoolDb('/procurement.sqlite3')
  const repository=new SqliteProcurementRepository(new SqlConnection(db),options.mode,sqlite.version.libVersion)
  try {await repository.initialize(()=>loadSeed(options.manifestUrl));return repository}
  catch(error){repository.dispose();throw error}
}
