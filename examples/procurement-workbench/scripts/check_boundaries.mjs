import { readdir, readFile } from 'node:fs/promises'
import { resolve, relative, dirname } from 'node:path'
const root = resolve(import.meta.dirname, '../src')
const allowed = {
  domain: new Set(['domain']),
  application: new Set(['domain', 'application']),
  infrastructure: new Set(['domain', 'application', 'infrastructure']),
  presentation: new Set(['domain', 'application', 'presentation']),
}
let count = 0
async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = resolve(dir, entry.name)
    if (entry.isDirectory()) { await check(file); continue }
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue
    const layer = relative(root, file).split('/')[0]
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)) {
      const spec = match[1]
      if (/directsurface\/src|(?:\.\.\/){3,}src/.test(spec)) throw Error(`Source deep import: ${file}`)
      if (allowed[layer]) {
        if (spec.startsWith('.')) {
          const target = relative(root, resolve(dirname(file), spec)).split('/')[0]
          if (!allowed[layer].has(target)) throw Error(`Forbidden dependency ${layer} -> ${target}: ${file}`)
        } else if (layer === 'domain' || layer === 'application') {
          throw Error(`Framework/runtime dependency in ${layer}: ${spec}`)
        } else if (layer === 'presentation' && spec !== 'directsurface') {
          throw Error(`Presentation external dependency: ${spec}`)
        } else if (layer === 'infrastructure' && spec === 'directsurface') throw Error('Storage must not import UI')
      }
    }
    if (['domain', 'application'].includes(layer) && /\b(?:window|document|localStorage|indexedDB|navigator)\./.test(source)) throw Error(`Browser global in ${layer}: ${file}`)
    count++
  }
}
await check(root)
console.log(`Layer boundaries checked (${count} files)`)
