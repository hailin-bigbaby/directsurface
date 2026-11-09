import { test, expect } from 'playwright/test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

declare const keyboardProbe: any
let bundle: string

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
      contents: `
        import { Application } from './dist-lib/index.mjs'
        import { RenderWindow } from './dist-lib/index.mjs'
        import { RenderTextBox } from './dist-lib/index.mjs'
        import { FocusManager } from './dist-lib/index.mjs'
        const main = new RenderWindow({ title: 'Main', width: 800, height: 500 })
        const mainText = new RenderTextBox({ value: 'main' })
        main.addChild(mainText)
        const host = Application.mount('#app').run(main)
        const popup = new RenderWindow({ title: 'Keyboard', x: 200, y: 100, width: 360, height: 220 })
        const text = new RenderTextBox({ value: '', blurOnSubmit: false })
        popup.addChild(text)
        host.uiServices.showWindow(popup)
        export const log = []
        export let submits = 0
        text.onSubmit = () => { submits++ }
        main.addKeyboardEventListener('keydown', e => log.push('main:' + e.key), { capture: true })
        popup.addKeyboardEventListener('keydown', e => log.push('capture:' + e.key), { capture: true })
        text.addKeyboardEventListener('keydown', e => log.push('target:' + e.key))
        export const off = popup.addKeyboardEventListener('keydown', e => log.push('bubble:' + e.key))
        popup.addKeyboardEventListener('keyup', e => log.push('up:' + e.key))
        export const focus = () => FocusManager.instance.setFocus(text)
        export const value = () => text.value
        export const blockEnter = () => popup.addKeyboardEventListener('keydown', e => {
          if (e.key === 'Enter') e.preventDefault()
        }, { capture: true, once: true })
        export const throwAfterBlockingEnter = () => popup.addKeyboardEventListener('keydown', e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            throw new Error('blocked Enter observer failure')
          }
        }, { capture: true, once: true })
        export const stopEnterPropagation = () => popup.addKeyboardEventListener('keydown', e => {
          if (e.key === 'Enter') e.stopPropagation()
        }, { capture: true, once: true })
      `,
    },
    bundle: true, write: false, format: 'iife', globalName: 'keyboardProbe', platform: 'browser',
  })
  bundle = result.outputFiles[0]!.text
})

test('owned window keyboard routing preserves editing and supports cancellation', async ({ page }) => {
  await page.setContent('<canvas id="app"></canvas>')
  await page.addScriptTag({ content: bundle })
  await page.evaluate(() => keyboardProbe.focus())
  await page.keyboard.press('F2')
  expect(await page.evaluate(() => keyboardProbe.log.splice(0))).toEqual([
    'capture:F2', 'target:F2', 'bubble:F2', 'up:F2',
  ])
  await page.evaluate(() => keyboardProbe.off())
  await page.keyboard.press('F2')
  expect(await page.evaluate(() => keyboardProbe.log.splice(0))).toEqual([
    'capture:F2', 'target:F2', 'up:F2',
  ])
  await page.keyboard.type('hello')
  expect(await page.evaluate(() => keyboardProbe.value())).toBe('hello')
  await page.evaluate(() => keyboardProbe.blockEnter())
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => keyboardProbe.submits)).toBe(0)
  await page.evaluate(() => keyboardProbe.stopEnterPropagation())
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => keyboardProbe.submits)).toBe(1)
  expect(await page.evaluate(() => keyboardProbe.log.some((entry: string) => entry.startsWith('main:')))).toBe(false)
})


test('a throwing keyboard observer cannot submit through the native input bridge', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<canvas id="app"></canvas>')
  await page.addScriptTag({ content: bundle })
  await page.evaluate(() => { keyboardProbe.focus(); keyboardProbe.throwAfterBlockingEnter() })
  await page.keyboard.press('Enter')
  expect(errors).toEqual(['blocked Enter observer failure'])
  expect(await page.evaluate(() => keyboardProbe.submits)).toBe(0)
  // Cancellation is local to the failed event; subsequent typing/submission works.
  await page.keyboard.type('after error')
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => keyboardProbe.value())).toBe('after error')
  expect(await page.evaluate(() => keyboardProbe.submits)).toBe(1)
})
