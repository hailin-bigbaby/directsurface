import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const example = resolve(root, 'examples/basic-app')
const packs = resolve(root, '.packs')
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const archive = resolve(packs, `${manifest.name}-${manifest.version}.tgz`)
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

mkdirSync(packs, { recursive: true })
execFileSync(npm, ['pack', '--pack-destination', packs], { cwd: root, stdio: 'inherit' })
if (!existsSync(archive)) throw new Error(`Package archive is missing: ${archive}`)
copyFileSync(archive, resolve(packs, 'ds-ui.tgz'))
rmSync(resolve(example, 'node_modules/ds-ui'), { recursive: true, force: true })
execFileSync(npm, ['install', '--no-package-lock', '--no-audit', '--no-fund'], {
  cwd: example,
  stdio: 'inherit',
})
