import { test, expect } from 'playwright/test'
declare const popupAudit: any
for (const dark of [false, true]) test(`popup confirmation and input ownership (${dark ? 'dark' : 'light'})`, async ({ page }, info) => {
  await page.goto('/')
  await page.waitForFunction(() => !!(window as any).renderingUnderTest)
  await page.evaluate(html => { document.body.innerHTML = html; (window as any).popupAudit = (window as any).renderingUnderTest }, '<canvas width="900" height="650" style="position:fixed;inset:0"></canvas>')
  await page.evaluate(dark => {
    const a = popupAudit, manager = a.PopupManager.instance
    const theme = dark ? a.ImGuiDarkTheme : a.ModernCompactLightTheme
    const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!
    manager.setContextProvider(() => ({ theme, viewport: { width: 900, height: 650, dpr: 1 } }))
    const paint = () => { ctx.fillStyle = dark ? '#20242b' : '#ffffff'; ctx.fillRect(0, 0, 900, 650); manager.current?.paint(new a.PaintContext(ctx, theme)) }
    manager.setPaintInvalidator(() => requestAnimationFrame(paint))
    for (const [native, method, type] of [['pointermove', 'handlePointerMove', 'move'], ['pointerdown', 'handlePointerDown', 'down'], ['pointerup', 'handlePointerUp', 'up']]) {
      canvas.addEventListener(native, (e: any) => { manager[method]({ pointerId: e.pointerId, pointerType: e.pointerType, button: e.button, buttons: e.buttons, type, position: { x: e.clientX, y: e.clientY } }); paint() })
    }
    const anchor = { [a.GET_POPUP_ANCHOR_RECT]: () => ({ x: 30, y: 20, width: 240, height: 28 }) }
    const t: any = { result: null, popup: null, open(kind: string) {
      manager.current?.close(); t.result = null
      const onSelect = (value: unknown) => { t.result = value; return true }
      const base = { anchor, onSelect, onClose() {} }
      if (kind === 'dropdown') { t.popup = new a.DropdownPopup(); t.popup.open({ ...base, options: ['Alpha', 'Beta', 'Gamma'].map(value => ({value, label:value})), selectedValue:'Alpha', searchable:false, maxVisibleItems:8 }) }
      if (kind === 'color') { t.popup = new a.ColorPickerPopup(); t.popup.open({ ...base, color:{r:29,g:95,b:191,a:1}, onConfirm:onSelect, onCancel(){} }) }
      if (kind === 'time') { t.popup = new a.TimePickerPopup(); t.popup.open({ ...base, value:'08:30', precision:'minute', hourStep:1, minuteStep:1, secondStep:1 }) }
      if (kind === 'range') { t.popup = new a.TimeRangePickerPopup(); t.popup.open({ ...base, value:{start:'08:30',end:'17:30'}, precision:'minute', hourStep:1, minuteStep:1, secondStep:1, allowOvernight:false }) }
      if (kind === 'date') { t.popup = new a.DatePickerPopup(); t.popup.open({ ...base, selected: {year:2026,month:4,day:14} }) }
      if (kind === 'dates') { t.popup = new a.DateRangePickerPopup(); t.popup.open({ ...base, value:{start:'2026-10-22',end:'2026-10-23'} }) }
      if (kind === 'tree') { t.popup = (new a.RenderDropTreeEdit({ roots: [] }))._popup; t.popup.open({ ...base, selectedValue:'a', searchable:false, maxVisibleItems:8, initialQuery:'', resolveRoots:()=>[{key:'a',label:'Office'},{key:'b',label:'Equipment'}] }) }
      paint()
    } }; (window as any).audit = t; paint()
  }, dark)
  const open = async (kind: string) => page.evaluate(kind => (window as any).audit.open(kind), kind)
  const visible = () => page.evaluate(() => (window as any).audit.popup.visible)
  const result = () => page.evaluate(() => (window as any).audit.result)
  await open('dropdown')
  await page.keyboard.press('Enter')
  expect(await result()).toBe('Alpha'); expect(await visible()).toBe(false)
  await open('dropdown')
  await page.mouse.move(100, 120)
  await page.screenshot({ path: info.outputPath('dropdown-hover.png') })
  await page.keyboard.press('ArrowDown')
  await page.screenshot({ path: info.outputPath('dropdown-keyboard.png') })
  await page.keyboard.press('Enter')
  expect(await result()).toBe('Beta'); expect(await visible()).toBe(false)
  for (const kind of ['color', 'time', 'range', 'tree']) {
    await open(kind)
    await page.screenshot({ path: info.outputPath(`${kind}-default.png`) })
    await page.keyboard.press('Enter')
    expect(await visible(), kind).toBe(false); expect(await result(), kind).not.toBeNull()
    await open(kind); await page.keyboard.press('Escape'); expect(await visible()).toBe(false)
  }
  await open('range'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab')
  await page.screenshot({ path: info.outputPath('range-focus-end.png') })
  await page.keyboard.press('Escape')
  await open('date')
  const calendar = await page.evaluate(() => (window as any).audit.popup.debugState())
  const header = { x: calendar.panelX + calendar.panelW / 2, y: calendar.panelY + 18 }
  await page.mouse.click(header.x, header.y)
  await page.keyboard.press('ArrowRight')
  expect(await page.evaluate(() => (window as any).audit.popup.debugState().viewMonth)).toBe(5)
  await page.screenshot({ path: info.outputPath('month-keyboard-focus.png') })
  await page.mouse.move(calendar.panelX + 30, calendar.panelY + 55)
  await page.screenshot({ path: info.outputPath('month-mouse-hover.png') })
  await page.mouse.move(600, 400)
  await page.screenshot({ path: info.outputPath('month-after-leave.png') })
  await page.mouse.click(header.x, header.y)
  await page.keyboard.press('ArrowRight')
  expect(await page.evaluate(() => (window as any).audit.popup.debugState().viewYear)).toBe(2027)
  await page.screenshot({ path: info.outputPath('year-keyboard-focus.png') })
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => (window as any).audit.popup.debugState().viewMode)).toBe('month')
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => (window as any).audit.popup.debugState().viewMode)).toBe('day')
  await page.keyboard.press('Enter')
  expect(await result()).toEqual({year:2027,month:5,day:14})
  expect(await visible()).toBe(false)
  await open('dates')
  const rect = await page.evaluate(() => (window as any).audit.popup.debugState())
  await page.mouse.click(rect.panelX + rect.panelW / 2, rect.panelY + rect.panelH - 14)
  expect(await visible()).toBe(false)
  expect(await result()).toEqual({start:'2026-10-22',end:'2026-10-23'})
})
