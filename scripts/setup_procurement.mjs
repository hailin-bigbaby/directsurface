import { execFileSync } from 'node:child_process'
import { existsSync, rmSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const example = resolve(root, 'examples/procurement-workbench')
if (!existsSync(resolve(root, '.packs/directsurface.tgz'))) throw Error('Run npm run verify:consumer first to build and pack the public library.')
rmSync(resolve(example, 'node_modules/directsurface'), { recursive: true, force: true })
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-package-lock', '--no-audit', '--no-fund'], { cwd: example, stdio: 'inherit' })
const installed = realpathSync(resolve(example, 'node_modules/directsurface'))
if (!installed.startsWith(realpathSync(resolve(example, 'node_modules')))) throw Error('Example must consume the installed tarball, not a source checkout.')
// Repacked local tarballs keep the same version; Vite's lockfile hash may stay unchanged.
rmSync(resolve(example, 'node_modules/.vite'), { recursive: true, force: true })
console.log('Procurement consumes the installed public package.')
