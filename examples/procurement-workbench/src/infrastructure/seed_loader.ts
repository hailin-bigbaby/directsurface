import { ProcurementError, type SeedData } from '../domain/model'
import { validateSeed } from '../domain/seed'
export async function loadSeed(manifestUrl: string): Promise<SeedData> {
  const response = await fetch(manifestUrl)
  if (!response.ok) throw new ProcurementError('SEED_DOWNLOAD','样本清单加载失败，请检查网络后重试')
  const manifest = await response.json() as { schemaVersion: number; seedVersion: string; file: string; sha256: string }
  if (manifest.schemaVersion !== 1 || manifest.file !== 'seed.json' || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new ProcurementError('SEED_INVALID','样本清单无效')
  const data = await fetch(new URL(manifest.file,manifestUrl))
  if (!data.ok) throw new ProcurementError('SEED_DOWNLOAD','样本数据加载失败，未修改本地数据')
  const bytes = await data.arrayBuffer()
  if (bytes.byteLength > 5_000_000) throw new ProcurementError('SEED_INVALID','样本超过容量限制')
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('')
  if (hash !== manifest.sha256) throw new ProcurementError('SEED_INVALID','样本校验失败，未修改本地数据')
  const seed = validateSeed(JSON.parse(new TextDecoder().decode(bytes)))
  if (seed.seedVersion !== manifest.seedVersion) throw new ProcurementError('SEED_INVALID','样本版本不一致')
  return seed
}
