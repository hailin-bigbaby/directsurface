import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'

const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
if (JSON.stringify(Object.keys(manifest.exports)) !== JSON.stringify(['.'])) {
  throw new Error('Only the package root entry may be exported')
}
const allowedFiles = ['dist-lib', 'README.md', 'THIRD_PARTY_NOTICES.md', 'LICENSE']
if (JSON.stringify(manifest.files) !== JSON.stringify(allowedFiles)) {
  throw new Error('Unexpected package files allowlist')
}
for (const path of [manifest.module, manifest.types]) {
  if (!path || !existsSync(path)) throw new Error(`Missing built package entry: ${path}`)
}
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
if (Object.entries(lock.packages).some(([path, value]) =>
  isAbsolute(path) ||
  path.startsWith('../') ||
  path.startsWith('packages/') ||
  value.link === true ||
  typeof value.resolved === 'string' && (
    value.resolved.startsWith('file:') || isAbsolute(value.resolved)
  )
)) throw new Error('Package lock contains a local or workspace dependency')
const notices = readFileSync('THIRD_PARTY_NOTICES.md', 'utf8')
for (const owner of ['Microsoft Corporation', 'Project Nayuki']) {
  if (!notices.includes(owner)) throw new Error(`Missing third-party notice: ${owner}`)
}
console.log('Package verified')
