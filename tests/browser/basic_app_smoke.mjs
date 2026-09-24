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
  detached: process.platform !== 'win32',
})
let serverOutput = ''
for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { serverOutput += chunk.toString() })

const geometry = {
  projectAtlas: [94, 274],
  newTask: [274, 247],
  drawerTitle: [984, 138],
  drawerCreate: [925, 451],
  drawerDateClear: [1216, 379],
  drawerCalendar: [1235, 379],
  calendarToday: [914, 634],
  calendarConfirm: [978, 634],
  firstTask: [432, 639],
  drawerStatus: [1100, 318],
  statusDone: [919, 405],
  drawerSave: [931, 451],
  settings: [1210, 36],
  darkTheme: [1181, 150],
  controlsTab: [139, 91],
  workbenchTab: [65, 91],
  dataTab: [218, 91],
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

async function hash(page, area) { return page.evaluate(canvasHash, area) }

async function expectCanvasChange(page, area, before) {
  await page.waitForFunction(({ area, before }) => {
    const canvas = document.querySelector('canvas#app')
    if (!(canvas instanceof HTMLCanvasElement)) return false
    const pixels = canvas.getContext('2d')?.getImageData(area.x, area.y, area.width, area.height).data
    if (!pixels) return false
    let next = 2166136261
    for (const byte of pixels) next = Math.imul(next ^ byte, 16777619)
    return (next >>> 0) !== before
  }, { area, before })
}

async function backgroundRed(page) {
  return page.evaluate(() => document.querySelector('canvas#app')?.getContext('2d')?.getImageData(500, 20, 1, 1).data[0])
}

let browser
try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Showcase server exited early: ${serverOutput}`)
    try { if ((await fetch(url)).ok) { ready = true; break } } catch {}
    await sleep(100)
  }
  if (!ready) throw new Error(`Showcase server did not start: ${serverOutput}`)

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.querySelector('canvas#app')?.width >= 1280)

  const totalArea = { x: 215, y: 421, width: 72, height: 44 }
  const initialTotal = await hash(page, totalArea)
  await page.mouse.click(...geometry.projectAtlas)
  await expectCanvasChange(page, totalArea, initialTotal)

  const filteredTotal = await hash(page, totalArea)
  await page.mouse.click(...geometry.newTask)
  await page.waitForTimeout(350)
  const dueArea = { x: 904, y: 366, width: 145, height: 27 }
  const dueBeforeClear = await hash(page, dueArea)
  await page.mouse.click(...geometry.drawerDateClear)
  await expectCanvasChange(page, dueArea, dueBeforeClear)
  const dueCleared = await hash(page, dueArea)
  await page.mouse.click(...geometry.drawerTitle)
  await page.keyboard.type('Launch readiness review')
  const errorArea = { x: 882, y: 397, width: 185, height: 28 }
  const beforeError = await hash(page, errorArea)
  await page.mouse.click(...geometry.drawerCreate)
  await expectCanvasChange(page, errorArea, beforeError)
  await page.mouse.click(...geometry.drawerCalendar)
  await page.waitForTimeout(180)
  await page.mouse.click(...geometry.calendarToday)
  await page.mouse.click(...geometry.calendarConfirm)
  await expectCanvasChange(page, dueArea, dueCleared)
  await page.mouse.click(...geometry.drawerCreate)
  await page.waitForTimeout(350)
  await expectCanvasChange(page, totalArea, filteredTotal)
  await page.waitForTimeout(350)

  const doneArea = { x: 475, y: 421, width: 65, height: 46 }
  const beforeDone = await hash(page, doneArea)
  await page.mouse.move(1170, 620)
  for (let index = 0; index < 10; index++) await page.mouse.wheel(0, 500)
  await page.mouse.click(...geometry.firstTask)
  await page.waitForTimeout(350)
  await page.mouse.click(...geometry.drawerStatus)
  await page.mouse.click(...geometry.statusDone)
  await page.mouse.click(...geometry.drawerSave)
  await page.waitForTimeout(350)
  await page.mouse.move(1170, 620)
  for (let index = 0; index < 10; index++) await page.mouse.wheel(0, -500)
  await expectCanvasChange(page, doneArea, beforeDone)

  assert.ok((await backgroundRed(page)) > 180, 'light theme expected before switch')
  await page.waitForTimeout(5500) // Let success toasts clear the settings trigger.
  await page.mouse.click(...geometry.settings)
  await page.waitForTimeout(200)
  await page.mouse.click(...geometry.darkTheme)
  await page.waitForFunction(() => document.querySelector('canvas#app')?.getContext('2d')?.getImageData(500, 20, 1, 1).data[0] < 80)
  await page.mouse.click(...geometry.controlsTab)
  await page.mouse.click(...geometry.dataTab)
  await page.mouse.click(...geometry.workbenchTab)
  const beforeReload = await hash(page, totalArea)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.querySelector('canvas#app')?.width >= 1280)
  await expectCanvasChange(page, totalArea, beforeReload)
  assert.ok((await backgroundRed(page)) < 80, 'dark theme should persist after reload')
  assert.deepEqual(errors, [])
  await page.close()

  for (const width of [768, 390]) {
    const responsive = await browser.newPage({ viewport: { width, height: 760 }, deviceScaleFactor: 1 })
    responsive.on('pageerror', error => errors.push(error.message))
    await responsive.goto(url, { waitUntil: 'networkidle' })
    await responsive.waitForFunction(() => document.querySelector('canvas#app')?.width >= 300)
    const responsiveMetric = width === 390
      ? { x: 82, y: 653, width: 50, height: 42 }
      : { x: 79, y: 492, width: 50, height: 42 }
    const beforeCreate = await hash(responsive, responsiveMetric)
    await responsive.mouse.click(width === 390 ? 126 : 137, width === 390 ? 293 : 245)
    await responsive.waitForTimeout(350)
    const calendarArea = width === 390
      ? { x: 66, y: 399, width: 188, height: 250 }
      : { x: 372, y: 399, width: 188, height: 250 }
    const beforeCalendar = await hash(responsive, calendarArea)
    await responsive.mouse.click(width === 390 ? 345 : 724, 379)
    await responsive.waitForTimeout(180)
    await expectCanvasChange(responsive, calendarArea, beforeCalendar)
    await responsive.mouse.click(width === 390 ? 220 : 528, 634) // Cancel calendar selection.
    await responsive.mouse.click(width === 390 ? 170 : 590, 138)
    await responsive.keyboard.type(`Responsive task ${width}`)
    await responsive.mouse.click(width === 390 ? 106 : 410, 451)
    await responsive.waitForTimeout(500)
    await expectCanvasChange(responsive, responsiveMetric, beforeCreate)
    await responsive.close()
  }
  assert.deepEqual(errors, [])
  console.log('Workbench browser smoke passed: DatePicker validation and calendar, filters, create, edit, metrics, theme, tabs and responsive drawer')
} finally {
  try { await browser?.close() } finally {
    try {
      if (server.pid && process.platform !== 'win32') process.kill(-server.pid, 'SIGTERM')
      else server.kill('SIGTERM')
    } catch (error) { if (error.code !== 'ESRCH') throw error }
    server.stdout.destroy()
    server.stderr.destroy()
  }
}
