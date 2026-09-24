import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const example = resolve(root, 'examples/basic-app')
const url = 'http://127.0.0.1:4174/'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const server = spawn(npm, ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], {
  cwd: example,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverOutput = ''
for (const stream of [server.stdout, server.stderr]) {
  stream.on('data', chunk => { serverOutput += chunk.toString() })
}

function canvasHash(area) {
  const canvas = document.querySelector('canvas#app')
  if (!(canvas instanceof HTMLCanvasElement)) return null
  const pixels = canvas.getContext('2d')?.getImageData(area.x, area.y, area.width, area.height).data
  if (!pixels) return null
  let hash = 2166136261
  for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619)
  return hash >>> 0
}

let browser
try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Example server exited early: ${serverOutput}`)
    try {
      const response = await fetch(url)
      if (response.ok) { ready = true; break }
    } catch {}
    await sleep(100)
  }
  if (!ready) throw new Error(`Example server did not start: ${serverOutput}`)

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas#app')
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 100) return false
    const pixels = canvas.getContext('2d')?.getImageData(20, 20, 200, 55).data
    return pixels && Array.from(pixels).some((value, index) => index % 4 !== 3 && value < 150)
  })

  const counterArea = { x: 28, y: 219, width: 160, height: 40 }
  const beforeClick = await page.evaluate(canvasHash, counterArea)
  await page.mouse.click(68, 197)
  await page.mouse.move(900, 600)
  await page.waitForFunction(({ area, previous }) => {
    const canvas = document.querySelector('canvas#app')
    if (!(canvas instanceof HTMLCanvasElement)) return false
    const pixels = canvas.getContext('2d')?.getImageData(area.x, area.y, area.width, area.height).data
    if (!pixels) return false
    let hash = 2166136261
    for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619)
    return (hash >>> 0) !== previous
  }, { area: counterArea, previous: beforeClick })

  const greetingArea = { x: 28, y: 140, width: 190, height: 40 }
  const beforeInput = await page.evaluate(canvasHash, greetingArea)
  await page.mouse.click(95, 118)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await page.keyboard.type('Ada')
  await page.mouse.move(900, 600)
  await page.waitForFunction(({ area, previous }) => {
    const canvas = document.querySelector('canvas#app')
    if (!(canvas instanceof HTMLCanvasElement)) return false
    const pixels = canvas.getContext('2d')?.getImageData(area.x, area.y, area.width, area.height).data
    if (!pixels) return false
    let hash = 2166136261
    for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619)
    return (hash >>> 0) !== previous
  }, { area: greetingArea, previous: beforeInput })

  assert.deepEqual(errors, [])
  console.log('Basic app browser smoke passed: Canvas rendered, button and input updated')
} finally {
  await browser?.close()
  server.kill('SIGTERM')
}
