import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const output = resolve(root, '.runtime/site')
for (const name of ['basic-app', 'procurement-workbench']) if (!existsSync(resolve(root, `examples/${name}/dist/index.html`))) throw Error(`Build ${name} before assembling the site`)
rmSync(output, { recursive: true, force: true }); mkdirSync(output, { recursive: true })
cpSync(resolve(root, 'examples/basic-app/dist'), output, { recursive: true })
cpSync(resolve(root, 'examples/procurement-workbench/dist'), resolve(output, 'procurement'), { recursive: true })
console.log('Site assembled with / and /procurement/ demos.')
