import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const dist = resolve(root, 'dist-lib')
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname
  if (pathname === '/') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<html><body><script type="module">import * as api from "/dist-lib/index.mjs"; window.renderingUnderTest = api</script></body></html>')
    return
  }
  const path = resolve(root, '.' + pathname)
  if (!path.startsWith(dist + sep)) { response.writeHead(404).end(); return }
  try {
    response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
    response.end(await readFile(path))
  } catch { response.writeHead(404).end() }
})
server.listen(4176, '127.0.0.1')
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit()))
