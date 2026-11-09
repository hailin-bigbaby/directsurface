import { test, expect } from 'playwright/test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

declare const pointerProbe: any
let bundle: string

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
      contents: `
        import { Application } from './dist-lib/index.mjs'
        import { RenderWindow } from './dist-lib/index.mjs'
        import { RenderButton } from './dist-lib/index.mjs'
        const main = new RenderWindow({ title: 'Main', width: 800, height: 500 })
        const host = Application.mount('#app').run(main)
        export const popup = new RenderWindow({ title: 'Pointer routing', x: 200, y: 100, width: 360, height: 220 })
        export let clicks = 0
        export const button = new RenderButton({ label: 'Click me', onClick: () => { clicks++ } })
        popup.addChild(button)
        host.uiServices.showWindow(popup)
        export const log = []
        main.addPointerEventListener('pointerdown', e => log.push('main:' + e.type), { capture: true })
        popup.addPointerEventListener('pointerdown', e => log.push('capture:' + e.type), { capture: true })
        button.addPointerEventListener('pointerdown', e => log.push('target:' + e.type))
        export const off = popup.addPointerEventListener('pointerdown', e => log.push('bubble:' + e.type))
        export const blockUp = () => popup.addPointerEventListener('pointerup', e => e.preventDefault(), { capture: true, once: true })
        export const point = () => ({ x: button.globalOffset.x + button.size.width / 2, y: button.globalOffset.y + button.size.height / 2 })
      `,
    },
    bundle: true, write: false, format: 'iife', globalName: 'pointerProbe', platform: 'browser',
  })
  bundle = result.outputFiles[0]!.text
})

test('owned window pointer routing and listener removal preserve button clicks', async ({ page }) => {
  await page.setContent('<canvas id="app"></canvas>')
  await page.addScriptTag({ content: bundle })
  await page.waitForFunction(() => pointerProbe.button.size.width > 0)
  const point = await page.evaluate(() => pointerProbe.point())
  await page.mouse.click(point.x, point.y)
  expect(await page.evaluate(() => pointerProbe.log.splice(0))).toEqual([
    'capture:pointerdown', 'target:pointerdown', 'bubble:pointerdown',
  ])
  expect(await page.evaluate(() => pointerProbe.clicks)).toBe(1)
  await page.evaluate(() => pointerProbe.off())
  await page.mouse.click(point.x, point.y)
  expect(await page.evaluate(() => pointerProbe.log.splice(0))).toEqual(['capture:pointerdown', 'target:pointerdown'])
  expect(await page.evaluate(() => pointerProbe.clicks)).toBe(2)
  await page.evaluate(() => pointerProbe.blockUp())
  await page.mouse.click(point.x, point.y)
  expect(await page.evaluate(() => pointerProbe.clicks)).toBe(2)
  await page.mouse.click(point.x, point.y)
  expect(await page.evaluate(() => pointerProbe.clicks)).toBe(3)
  // Existing title-bar dragging still receives capture and terminal cleanup.
  const before = await page.evaluate(() => ({ x: pointerProbe.popup.windowX, y: pointerProbe.popup.windowY }))
  await page.mouse.move(before.x + 100, before.y + 15)
  await page.mouse.down()
  await page.mouse.move(before.x + 160, before.y + 55)
  await page.mouse.up()
  expect(await page.evaluate(() => ({ x: pointerProbe.popup.windowX, y: pointerProbe.popup.windowY }))).toEqual({ x: before.x + 60, y: before.y + 40 })
})


test('hiding a window during pointerup cancels dragging before it is shown again', async ({ page }) => {
  await page.setContent('<canvas id="app"></canvas>')
  await page.addScriptTag({ content: bundle })
  await page.waitForFunction(() => pointerProbe.popup.size.width > 0)
  const start = await page.evaluate(() => ({ x: pointerProbe.popup.windowX, y: pointerProbe.popup.windowY }))
  await page.evaluate(() => {
    pointerProbe.popup.addPointerEventListener('pointerup', () => {
      pointerProbe.popup.visible = false
    }, { capture: true, once: true })
  })
  await page.mouse.move(start.x + 100, start.y + 15)
  await page.mouse.down()
  await page.mouse.move(start.x + 140, start.y + 35)
  await page.mouse.up()
  expect(await page.evaluate(() => pointerProbe.popup.visible)).toBe(false)
  const released = await page.evaluate(() => ({ x: pointerProbe.popup.windowX, y: pointerProbe.popup.windowY }))
  expect(released).toEqual({ x: start.x + 40, y: start.y + 20 })
  await page.evaluate(() => { pointerProbe.popup.visible = true })
  await page.waitForFunction(() => pointerProbe.popup.size.width > 0)
  await page.mouse.move(released.x + 110, released.y + 20)
  expect(await page.evaluate(() => ({ x: pointerProbe.popup.windowX, y: pointerProbe.popup.windowY }))).toEqual(released)
  // A fresh press can still start a new drag.
  await page.mouse.down()
  await page.mouse.move(released.x + 140, released.y + 40)
  await page.mouse.up()
  expect(await page.evaluate(() => ({ x: pointerProbe.popup.windowX, y: pointerProbe.popup.windowY }))).toEqual({ x: released.x + 30, y: released.y + 20 })
})


test('hiding a button in pointerleave clears its hover before it is shown again', async ({ page }) => {
  await page.setContent('<canvas id="app"></canvas>')
  await page.addScriptTag({ content: bundle })
  await page.waitForFunction(() => pointerProbe.button.size.width > 0)
  const point = await page.evaluate(() => pointerProbe.point())
  await page.evaluate(() => {
    pointerProbe.button.addPointerEventListener('pointerleave', () => {
      pointerProbe.button.visible = false
    }, { once: true })
  })
  await page.mouse.move(point.x, point.y)
  expect(await page.evaluate(() => pointerProbe.button._interaction.isHovered)).toBe(true)
  await page.mouse.move(700, 450)
  expect(await page.evaluate(() => pointerProbe.button.visible)).toBe(false)
  expect(await page.evaluate(() => pointerProbe.button._interaction.isHovered)).toBe(false)
  await page.evaluate(() => { pointerProbe.button.visible = true })
  await page.waitForFunction(() => pointerProbe.button.size.width > 0)
  expect(await page.evaluate(() => pointerProbe.button._interaction.isHovered)).toBe(false)
  const restored = await page.evaluate(() => pointerProbe.point())
  await page.mouse.move(restored.x, restored.y)
  expect(await page.evaluate(() => pointerProbe.button._interaction.isHovered)).toBe(true)
  await page.mouse.move(700, 450)
  expect(await page.evaluate(() => pointerProbe.button._interaction.isHovered)).toBe(false)
})
