import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
const root = resolve(import.meta.dirname, '../dist')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' }
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    if (!pathname.startsWith('/office/')) { response.writeHead(404).end(); return }
    const file = resolve(root, pathname.slice('/office/'.length) || 'index.html')
    if (!file.startsWith(root + '/')) { response.writeHead(403).end(); return }
    response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream')
    response.end(await readFile(file))
  } catch { response.writeHead(404).end() }
}).listen(4193, '127.0.0.1')
