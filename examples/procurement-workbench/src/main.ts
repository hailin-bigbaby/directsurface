import { Application, ModernCompactLightTheme, RenderWindow, RenderTabs, PopupManager, type RenderObject, loadDirectSurfaceFonts } from 'directsurface'
import { ProcurementWorkbench } from './application/workbench'
import { WorkerProcurementRepository } from './infrastructure/worker_client'
import { createWorkbenchView } from './presentation/workbench_view'

const bootstrap = document.querySelector<HTMLDivElement>('#bootstrap')!
let cleanup: (() => void) | undefined
async function start(mode: 'opfs' | 'memory' = 'opfs'): Promise<void> {
  const namespace = __PROCUREMENT_TEST__ ? new URL(location.href).searchParams.get('namespace') ?? 'demo-v1' : 'demo-v1'
  const repository = new WorkerProcurementRepository({ mode, namespace, manifestUrl: new URL(`${import.meta.env.BASE_URL}data/manifest.json`, location.href).href })
  const app = new ProcurementWorkbench(repository, { next: () => crypto.randomUUID() })
  let composing = false
  const begin = () => { composing = true }; const end = () => { composing = false; view.updateViewport(window.innerWidth) }
  document.addEventListener('compositionstart', begin, true); document.addEventListener('compositionend', end, true)
  const view = createWorkbenchView(app, { isComposing: () => composing, download(text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'procurement-snapshot.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  } })
  const mainWindow = new RenderWindow({ title: '办公采购工作台', chrome: 'none', draggable: false, borderStyle: 'fixed', showCloseButton: false, showMaximizeButton: false, contentPadding: 0, contentSpacing: 0, autoResizeInset: 0 })
  mainWindow.addChild(view.root); view.manager.setWindowHost(mainWindow)
  await loadDirectSurfaceFonts()
  const host = Application.mount('#app').run(mainWindow, { theme: ModernCompactLightTheme })
  cleanup = () => { document.removeEventListener('compositionstart', begin, true); document.removeEventListener('compositionend', end, true); view.dispose(); host.dispose(); app.dispose() }
  try {
    await view.start(); view.updateViewport(window.innerWidth); bootstrap.hidden = true
    if (__PROCUREMENT_TEST__) Object.assign(window, { __PROCUREMENT__: { ...view.test, popupOpen: () => !!PopupManager.instance.current, manager: view.manager, showDocument: view.showDocument, flush: view.flush, tabRect(id: string) {
      let result: unknown = null
      const visit = (node: RenderObject) => { if (node instanceof RenderTabs) { const rect = node.tabRect(id); if (rect) result = rect }; node.visitChildren(visit) }
      visit(view.root); return result
    } } })
  } catch (error) {
    cleanup(); cleanup = undefined
    bootstrap.hidden = false; bootstrap.textContent = `工作台未启动：${(error as Error).message}。已有本地数据未被清除。`
    const retry = document.createElement('button'); retry.textContent = '重试'; retry.onclick = () => { bootstrap.textContent = '正在重试…'; void start(mode).catch(showFailure) }; bootstrap.append(retry)
    const temporary = document.createElement('button'); temporary.textContent = '进入临时模式（不保存）'; temporary.onclick = () => { bootstrap.textContent = '正在打开临时模式…'; void start('memory').catch(showFailure) }; bootstrap.append(temporary)
    return
  }
  const resize = () => view.updateViewport(window.innerWidth)
  window.addEventListener('resize', resize)
  const editingKeyUp = (event: KeyboardEvent) => { if (['Escape', 'Enter', 'Tab'].includes(event.key)) resize() }
  window.addEventListener('keyup', editingKeyUp)
  const unload = (event: BeforeUnloadEvent) => { if (app.hasUnsaved || view.hasUncommittedInput()) { event.preventDefault(); event.returnValue = '' } }
  window.addEventListener('beforeunload', unload)
  const oldCleanup = cleanup
  if (oldCleanup) cleanup = () => { window.removeEventListener('resize', resize); window.removeEventListener('beforeunload', unload); oldCleanup() }
}
function showFailure(error: unknown): void { bootstrap.hidden = false; bootstrap.textContent = `启动失败：${String(error)}`; cleanup?.() }
window.addEventListener('pagehide', () => cleanup?.(), { once: true })
if (import.meta.hot) import.meta.hot.dispose(() => cleanup?.())
void start().catch(showFailure)
