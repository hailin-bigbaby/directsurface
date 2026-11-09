import { test, expect } from 'playwright/test'
declare const dialogAudit: any
for (const dark of [false, true]) test(`Modal and Prompt responsive interaction ${dark ? 'dark' : 'light'}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 480 })
  await page.goto('/')
  await page.waitForFunction(() => !!(window as any).renderingUnderTest)
  await page.evaluate(html => { document.body.innerHTML = html; (window as any).dialogAudit = (window as any).renderingUnderTest }, '<canvas style="position:fixed;inset:0"></canvas>')
  await page.evaluate(dark => {
    const a = dialogAudit, canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!, manager = a.PopupManager.instance
    const theme = dark ? a.ImGuiDarkTheme : a.ModernCompactLightTheme
    manager.setContextProvider(() => ({ theme, viewport: { width: innerWidth, height: innerHeight, dpr: 1 } }))
    const paint = () => {
      if (canvas.width !== innerWidth || canvas.height !== innerHeight) { canvas.width = innerWidth; canvas.height = innerHeight }
      ctx.fillStyle = dark ? '#20242b' : '#f3f5f8'; ctx.fillRect(0, 0, innerWidth, innerHeight)
      manager.current?.paint(new a.PaintContext(ctx, theme))
    }
    manager.setPaintInvalidator(() => requestAnimationFrame(paint))
    window.addEventListener('resize', paint)
    for (const [native, method, type] of [['pointerdown', 'handlePointerDown', 'down'], ['pointermove', 'handlePointerMove', 'move'], ['pointerup', 'handlePointerUp', 'up']]) {
      canvas.addEventListener(native, (e: any) => { const handled = manager[method]({ pointerId:e.pointerId, pointerType:e.pointerType, button:e.button, buttons:e.buttons, type, position:{x:e.clientX,y:e.clientY} }); if (handled) e.preventDefault(); paint() })
    }
    canvas.addEventListener('wheel', e => { manager.handleWheel({ pointerId: 1, type:'wheel', position:{x:e.clientX,y:e.clientY}, deltaY:e.deltaY, deltaX:0 }); paint() })
    const t: any = { result: null, popup: null, layout: () => t.popup instanceof a.RenderModal ? t.popup._resolveLayout(manager.context,{x:0,y:0},1) : t.popup._layout(manager.context), open(prompt: boolean, longContent = true, intent = prompt ? undefined : 'info') {
      t.popup?.dispose(); t.result=null
      t.popup = new (prompt ? a.RenderPromptModal : a.RenderModal)({title:prompt?'填写提交说明':'提交审批',intent,content:longContent ? Array.from({length:40},(_,i)=>`第${i+1}条说明：订单提交后将占用申购数量。`).join('\n') : '提交后订单将不可修改，并占用对应申购需求的可采购量。', value:'原说明', buttons:longContent ? [{key:'cancel',label:'取消操作'},{key:'later',label:'稍后再处理'},{key:'ok',label:'确认提交采购审批',primary:true}] : [{key:'cancel',label:'取消'},{key:'ok',label:'确认提交',primary:true}],onClose:(key:string,value:string)=>{t.result={key,value}}})
      t.popup.show(); paint()
    } }; (window as any).dialogTest=t
  }, dark)
  for (const prompt of [false, true]) {
    await page.evaluate(prompt => (window as any).dialogTest.open(prompt), prompt)
    await page.waitForTimeout(250)
    const initial = await page.evaluate(() => {const l=(window as any).dialogTest.layout();return {body:l.body,buttons:l.buttons,max:l.maxScroll,input:l.inputRect}})
    expect(initial.max).toBeGreaterThan(0)
    await page.mouse.move(initial.body.x + 20, initial.body.y + 20)
    await page.mouse.wheel(0, 10000)
    await expect.poll(() => page.evaluate(() => {const l=(window as any).dialogTest.layout();return l.scrollOffset===l.maxScroll})).toBe(true)
    await page.keyboard.press('PageUp')
    await expect.poll(() => page.evaluate(() => {const l=(window as any).dialogTest.layout();return l.scrollOffset<l.maxScroll})).toBe(true)
    await page.keyboard.press('PageDown')
    const scrollbar = await page.evaluate(() => {
      const t=(window as any).dialogTest
      return t.popup._scroller.geometry(t.layout(), dialogAudit.PopupManager.instance.context)
    })
    await page.mouse.move(scrollbar.thumbRect.x+scrollbar.thumbRect.width/2,scrollbar.thumbRect.y+scrollbar.thumbRect.height/2)
    await page.mouse.down()
    await page.mouse.move(scrollbar.thumbRect.x+scrollbar.thumbRect.width/2,scrollbar.trackRect.y,{steps:8})
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => (window as any).dialogTest.layout().scrollOffset)).toBe(0)
    await page.mouse.move(initial.body.x+20,initial.body.y+20)
    await page.mouse.wheel(0,10000)
    await page.screenshot({path:info.outputPath(`${prompt?'prompt':'modal'}-long-narrow.png`)})
    if(prompt) {
      await page.mouse.click(initial.input.x+25,initial.input.y+14)
      await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText('实际输入说明')
    }
    const last = await page.evaluate(() => (window as any).dialogTest.layout().buttons.at(-1))
    await page.mouse.click(last.x+last.w/2,last.y+last.h/2)
    expect(await page.evaluate(() => (window as any).dialogTest.result.key)).toBe('ok')
    if(prompt)expect(await page.evaluate(() => (window as any).dialogTest.result.value)).toBe('实际输入说明')
  }
  await page.setViewportSize({width:320,height:220})
  await page.evaluate(() => (window as any).dialogTest.open(true))
  await page.waitForTimeout(250)
  expect(await page.evaluate(() => (window as any).dialogTest.layout().scrollAll)).toBe(true)
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab')
  await page.screenshot({path:info.outputPath('prompt-short-viewport.png')})
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => (window as any).dialogTest.result.key)).toBe('ok')
  await page.setViewportSize({width:900,height:650})
  for (const intent of ['info','warning','success','error']) {
    await page.evaluate(intent => (window as any).dialogTest.open(false,false,intent),intent)
    await page.waitForTimeout(250)
    await page.screenshot({path:info.outputPath(`semantic-${intent}.png`)})
    await page.keyboard.press('Escape')
  }
  for (const prompt of [false,true]) {
    await page.evaluate(prompt => (window as any).dialogTest.open(prompt,false),prompt)
    await page.waitForTimeout(250)
    await page.screenshot({path:info.outputPath(`${prompt?'prompt':'modal'}-short-wide.png`)})
    if (prompt) {
      await page.keyboard.press('Escape')
      expect(await page.evaluate(() => (window as any).dialogTest.result.key)).toBeNull()
    } else {
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Enter')
      expect(await page.evaluate(() => (window as any).dialogTest.result.key)).toBe('ok')
    }
  }
})
