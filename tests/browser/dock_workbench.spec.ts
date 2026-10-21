import { test, expect } from 'playwright/test'

// Internal render handles are inspected only to assert ownership and hit geometry.
declare const dockUnderTest: any

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => 'renderingUnderTest' in window)
  await page.evaluate(() => { (globalThis as any).dockUnderTest = (globalThis as any).renderingUnderTest })
})

test('RuntimeHost keeps measurement from altering rendered pane positions',async({page},info)=>{
  await page.setViewportSize({width:1100,height:700});await page.evaluate(() => { document.body.style.margin = '0' })
  const result=await page.evaluate(()=>{
    const {DockWorkbenchManager,RenderDockWorkbench,RenderText,RuntimeHost,ImGuiLightTheme}=dockUnderTest
    const canvas=document.createElement('canvas');document.body.append(canvas)
    const host=new RuntimeHost({canvas,dpr:1,getViewportSize:()=>({width:1000,height:600})});host.setTheme(ImGuiLightTheme)
    const manager=new DockWorkbenchManager()
    manager.openDocument({itemId:'doc',title:'Document',content:new RenderText('Document')})
    for(const region of ['left','right','bottom'])manager.openTool({itemId:region,title:region,region,content:new RenderText(region)})
    const view=new RenderDockWorkbench({manager,disposeManagerOnDispose:true})
    const roots=new Set([view]);host.addRoot(view)
    host.registerLayer({layer:'main',paint:({context}:any)=>host.paintRoots(context),shouldPaint:()=>host.isLayerDirty('main')||host.hasDirtyPaintForRoots(roots),dirtyRect:()=>host.getDirtyPaintRectForRoots(roots)})
    try {
      host.renderFrame();host.renderFrame()
      const getRegions=()=>[...view._groupViews.values()].map((g:any)=>({kind:g.group.kind,ids:g.group.items.map((w:any)=>w.title),x:g.globalOffset.x,y:g.globalOffset.y,width:g.size.width,height:g.size.height}))
      const before=getRegions(),pixels=canvas.toDataURL()
      view.measure({minWidth:0,maxWidth:400,minHeight:0,maxHeight:300})
      host.renderFrame();host.renderFrame()
      return {before,after:getRegions(),samePixels:pixels===canvas.toDataURL(),model:{...manager.regionLayout}}
    }finally{host.dispose();view.dispose()}
  })
  await page.screenshot({path:info.outputPath('measured-workbench.png')})
  expect(result.after).toEqual(result.before)
  expect(result.samePixels).toBe(true)
})


test('native pin preserves the currently selected hidden group tab',async({page})=>{
  await page.evaluate(() => { document.body.style.margin = '0' })
  const pin=await page.evaluate(()=>{
    const {DockWorkbenchManager,RenderDockWorkbench,RenderText,RuntimeHost,ImGuiLightTheme}=dockUnderTest
    const canvas=document.createElement('canvas');document.body.append(canvas)
    const host=new RuntimeHost({canvas,dpr:1,getViewportSize:()=>({width:800,height:500})});host.setTheme(ImGuiLightTheme)
    const manager=new DockWorkbenchManager()
    for(const id of ['a','b'])manager.openTool({itemId:id,title:id,region:'left',content:new RenderText('Content '+id)})
    manager.autoHideGroup(manager.regions.left);manager.showAutoHideItem('a')
    const view=new RenderDockWorkbench({manager,disposeManagerOnDispose:true})
    host.addRoot(view);const roots=new Set([view])
    host.registerLayer({layer:'main',paint:({context}:any)=>host.paintRoots(context),shouldPaint:()=>host.isLayerDirty('main')||host.hasDirtyPaintForRoots(roots),dirtyRect:()=>host.getDirtyPaintRectForRoots(roots)})
    host.renderFrame();host.renderFrame()
    ;(globalThis as any).testWorkbench={host,manager,view}
    const rect=view._autoHidePinButtonRect
    return {x:rect.x+rect.width/2,y:rect.y+rect.height/2,active:manager.activeItemId}
  })
  expect(pin.active).toBe('a')
  await page.mouse.click(pin.x,pin.y)
  const result=await page.evaluate(()=>{
    const {host,manager,view}=(globalThis as any).testWorkbench
    host.renderFrame()
    const result={active:manager.activeItemId,mode:manager.getItem('a').placement.mode,hiddenGroups:manager.autoHideGroups.length}
    host.dispose();view.dispose();return result
  })

  expect(result).toEqual({active:'a',mode:'docked',hiddenGroups:0})
})

for(const region of ['left','bottom'])test(`overflow in ${region} auto-hide rail remains accessible`,async({page},info)=>{
  await page.setViewportSize({width:800,height:500});await page.evaluate(() => { document.body.style.margin = '0' })
  const initial=await page.evaluate(region=>{
    const {DockWorkbenchManager,RenderDockWorkbench,RenderText,RuntimeHost,ImGuiLightTheme}=dockUnderTest
    const canvas=document.createElement('canvas');document.body.append(canvas)
    const host=new RuntimeHost({canvas,dpr:1,getViewportSize:()=>({width:400,height:240})});host.setTheme(ImGuiLightTheme)
    const manager=new DockWorkbenchManager()
    for(let i=0;i<10;i++) {const id='tool-'+i;manager.openTool({itemId:id,title:id,region,content:new RenderText(id)});manager.autoHideItem(id)}
    const view=new RenderDockWorkbench({manager,disposeManagerOnDispose:true});host.addRoot(view)
    const roots=new Set([view]);host.registerLayer({layer:'main',paint:({context}:any)=>host.paintRoots(context),shouldPaint:()=>host.isLayerDirty('main')||host.hasDirtyPaintForRoots(roots),dirtyRect:()=>host.getDirtyPaintRectForRoots(roots)})
    host.renderFrame();host.renderFrame();(globalThis as any).testWorkbench={host,manager,view}
    const rect=view._autoHideTabRects.get('tool-0')
    return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}
  },region)
  await page.mouse.click(initial.x,initial.y)
  const opened=await page.evaluate(()=>{const {host,manager}=(globalThis as any).testWorkbench;const id=manager.activeAutoHideItemId;manager.hideAutoHideItem();host.renderFrame();return id})
  expect(opened).toBe('tool-0')
  await page.mouse.move(initial.x,initial.y)
  for(let i=0;i<5;i++)await page.mouse.wheel(region==='bottom'?240:0,region==='left'?240:0)
  const result=await page.evaluate(()=>{
    const {host,view}=(globalThis as any).testWorkbench;host.renderFrame()
    const last=view._autoHideTabRects.get('tool-9')
    return {last,viewport:{...view.size},inside:last.x>=0&&last.y>=0&&last.x+last.width<=view.size.width&&last.y+last.height<=view.size.height}
  })

  await page.screenshot({path:info.outputPath('rail-overflow.png')})
  await page.evaluate(()=>{const {host,view}=(globalThis as any).testWorkbench;host.dispose();view.dispose()})
  expect(result.inside).toBe(true)
})

test('pinning a visible single tool preserves native button hit testing',async({page})=>{
  await page.setViewportSize({width:1000,height:600});await page.evaluate(() => { document.body.style.margin = '0' })
  const initial=await page.evaluate(()=>{
    const {DockWorkbenchManager,RenderDockWorkbench,RenderText,RenderButton,RuntimeHost,ImGuiLightTheme}=dockUnderTest
    const canvas=document.createElement('canvas');document.body.append(canvas)
    const host=new RuntimeHost({canvas,dpr:1,getViewportSize:()=>({width:900,height:500})});host.setTheme(ImGuiLightTheme)
    let clicks=0
    const button=new RenderButton({label:'Tool action',onClick:()=>clicks++})
    const manager=new DockWorkbenchManager();manager.openDocument({itemId:'doc',title:'Doc',content:new RenderText('Doc')})
    manager.openTool({itemId:'a',title:'Tool A',region:'right',content:button})
    manager.autoHideItem('a');manager.showAutoHideItem('a')
    const view=new RenderDockWorkbench({manager,disposeManagerOnDispose:true});host.addRoot(view)
    const roots=new Set([view]);host.registerLayer({layer:'main',paint:({context}:any)=>host.paintRoots(context),shouldPaint:()=>host.isLayerDirty('main')||host.hasDirtyPaintForRoots(roots),dirtyRect:()=>host.getDirtyPaintRectForRoots(roots)})
    host.renderFrame();host.renderFrame()
    ;(globalThis as any).testWorkbench={host,manager,view,button,getClicks:()=>clicks}
    return {x:button.globalOffset.x+button.size.width/2,y:button.globalOffset.y+button.size.height/2}
  })
  await page.mouse.click(initial.x,initial.y)
  const pin=await page.evaluate(()=>{const {view,host,getClicks}=(globalThis as any).testWorkbench;host.renderFrame();const r=view._autoHidePinButtonRect;return {x:r.x+r.width/2,y:r.y+r.height/2,clicks:getClicks()}})
  expect(pin.clicks).toBe(1)
  await page.mouse.click(pin.x,pin.y)
  const position=await page.evaluate(()=>{
    const {host,manager,view,button}=(globalThis as any).testWorkbench;host.renderFrame();host.renderFrame()
    const win=manager.getItem('a').window
    const group=[...view._groupViews.values()].find((g:any)=>g.group.items.includes(win)) as any
    const clip=group._bodyClip
    return {x:button.globalOffset.x+clip.globalOffset.x+win.offset.x-win.globalOffset.x+button.size.width/2,
      y:button.globalOffset.y+clip.globalOffset.y+win.offset.y-win.globalOffset.y+button.size.height/2,
      parentCorrect:win.parent===clip,mode:manager.getItem('a').placement.mode}
  })
  await page.mouse.click(position.x,position.y)
  const clicks=await page.evaluate(()=>{const {host,view,getClicks}=(globalThis as any).testWorkbench;const n=getClicks();host.dispose();view.dispose();return n})

  expect(position.mode).toBe('docked')
  expect(position.parentCorrect).toBe(true)
  expect(clicks).toBe(2)
})

test('a second native touch cannot finish the first touch paging gesture', async ({ page }) => {
  await page.evaluate(() => { document.body.style.margin = '0' })
  const position = await page.evaluate(() => {
    const { DockWorkbenchManager, RenderDockWorkbench, RenderText, RuntimeHost } = dockUnderTest
    const canvas = document.createElement('canvas')
    document.body.append(canvas)
    const host = new RuntimeHost({ canvas, dpr: 1, getViewportSize: () => ({ width: 400, height: 240 }) })
    const manager = new DockWorkbenchManager()
    for (let i = 0; i < 10; i++) {
      const itemId = `tool-${i}`
      manager.openTool({ itemId, title: itemId, region: 'left', content: new RenderText(itemId) })
      manager.autoHideItem(itemId)
    }
    const view = new RenderDockWorkbench({ manager, disposeManagerOnDispose: true })
    const roots = new Set([view])
    host.addRoot(view)
    host.registerLayer({ layer: 'main', paint: ({ context }: any) => host.paintRoots(context),
      shouldPaint: () => host.isLayerDirty('main') || host.hasDirtyPaintForRoots(roots),
      dirtyRect: () => host.getDirtyPaintRectForRoots(roots) })
    host.renderFrame()
    const touchEvents: unknown[] = []
    for (const type of ['touchstart', 'touchend', 'touchcancel']) canvas.addEventListener(type, event => {
      const touch = event as TouchEvent
      touchEvents.push({ type, changed: Array.from(touch.changedTouches).map(point => point.identifier), current: Array.from(touch.touches).map(point => point.identifier) })
    })
    ;(globalThis as any).testWorkbench = { host, view, touchEvents }
    const rect = view._autoHideRailLayouts.get('left').after
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  })
  const client = await page.context().newCDPSession(page)
  try {
    const owner = { ...position, id: 1 }
    const other = { x: position.x + 2, y: position.y + 2, id: 2 }
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [owner] })
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [owner, other] })
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [other] })
    expect(await page.evaluate(() => (globalThis as any).testWorkbench.touchEvents.at(-1))).toEqual({ type: 'touchend', changed: [2], current: [1] })
    expect(await page.evaluate(() => (globalThis as any).testWorkbench.view._autoHideScroll.left.offset)).toBe(0)
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    expect(await page.evaluate(() => (globalThis as any).testWorkbench.view._autoHideScroll.left.offset)).toBeGreaterThan(0)
  } finally {
    await client.detach()
    await page.evaluate(() => {
      const { host, view } = (globalThis as any).testWorkbench
      host.dispose(); view.dispose()
    })
  }
})
