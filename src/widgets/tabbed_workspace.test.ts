// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { FocusManager } from '../core/focus_manager'
import { InputComposer } from '../core/input_composer'
import { PopupManager } from '../core/popup_manager'
import { RenderBox } from '../layout/render_box'
import { TabbedDocumentManager, type TabbedDocumentContext, type TabbedDocumentContextAware } from './tabbed_workspace'

afterEach(() => {
  PopupManager.disposeInstance()
  FocusManager.disposeInstance()
  InputComposer.disposeInstance()
  vi.restoreAllMocks()
})
class TestDocumentBox extends RenderBox {
  disposed = false
  visitChildren(): void {}
  performLayout(): void { this.size = { width: 240, height: 180 } }
  performPaint(): void {}
  override dispose(): void { this.disposed = true; super.dispose() }
}
class ContextAwareDocumentBox extends TestDocumentBox implements TabbedDocumentContextAware {
  context?: TabbedDocumentContext
  attachDocumentContext(context: TabbedDocumentContext): void { this.context = context }
  detachDocumentContext(): void { this.context = undefined }
}

describe('Document close guards', () => {
  it.each(['replace', 'dispose-and-reopen'] as const)('does not close a new same-id document after %s', async replacement => {
    const manager = new TabbedDocumentManager()
    const oldContent = new TestDocumentBox()
    const newContent = new TestDocumentBox()
    let resolveOld!: (allowed: boolean) => void
    let resolveNew!: (allowed: boolean) => void
    const oldGuard = vi.fn(() => new Promise<boolean>(resolve => { resolveOld = resolve }))
    const newGuard = vi.fn(() => new Promise<boolean>(resolve => { resolveNew = resolve }))
    manager.openDocument({ tabId: 'same', title: 'Old', content: oldContent, beforeClose: oldGuard })
    const oldClosing = manager.closeDocument('same')
    await expect(manager.closeDocument('same')).resolves.toBe(false)
    const definition = { tabId: 'same', title: 'New', content: newContent, beforeClose: newGuard }
    if (replacement === 'replace') manager.setDocuments([definition])
    else { manager.dispose(); manager.openDocument(definition) }
    const newClosing = manager.closeDocument('same')
    expect(newGuard).toHaveBeenCalledOnce()
    resolveOld(true)
    await expect(oldClosing).resolves.toBe(false)
    expect(oldContent.disposed).toBe(true)
    expect(newContent.disposed).toBe(false)
    expect(manager.activeDocument?.content).toBe(newContent)
    await expect(manager.closeDocument('same')).resolves.toBe(false)
    expect(newGuard).toHaveBeenCalledOnce()
    resolveNew(true)
    await expect(newClosing).resolves.toBe(true)
    expect(newContent.disposed).toBe(true)
    expect(manager.hasDocument('same')).toBe(false)
    manager.dispose()
  })

  it('honors closable=false through direct, active and context close APIs', async () => {
    const manager = new TabbedDocumentManager()
    const content = new ContextAwareDocumentBox()
    const beforeClose = vi.fn(() => true)
    manager.openDocument({ tabId: 'fixed', title: 'Fixed', content, closable: false, beforeClose })
    await expect(manager.closeDocument('fixed')).resolves.toBe(false)
    await expect(manager.closeActiveDocument()).resolves.toBe(false)
    await expect(content.context!.requestClose()).resolves.toBe(false)
    expect(beforeClose).not.toHaveBeenCalled()
    expect(content.disposed).toBe(false)
    expect(manager.activeTabId).toBe('fixed')
    manager.updateDocument('fixed', { closable: true })
    await expect(manager.closeDocument('fixed')).resolves.toBe(true)
    expect(beforeClose).toHaveBeenCalledOnce()
    expect(content.disposed).toBe(true)
    manager.dispose()
  })

  it('rechecks closable after an asynchronous close guard', async () => {
    const manager = new TabbedDocumentManager()
    const content = new TestDocumentBox()
    let release!: (allowed: boolean) => void
    const beforeClose = vi.fn(() => new Promise<boolean>(resolve => { release = resolve }))
    manager.openDocument({ tabId: 'document', title: 'Document', content, beforeClose })
    const pending = manager.closeDocument('document')
    manager.updateDocument('document', { closable: false })
    release(true)
    await expect(pending).resolves.toBe(false)
    expect(content.disposed).toBe(false)
    expect(manager.hasDocument('document')).toBe(true)
    manager.updateDocument('document', { closable: true })
    beforeClose.mockResolvedValue(true)
    await expect(manager.closeDocument('document')).resolves.toBe(true)
    manager.dispose()
  })

  it('closes the correct document even if order changes while beforeClose is pending', async () => {
    let resolveClose: ((value: boolean) => void) | undefined
    const manager = new TabbedDocumentManager()
    const first = new TestDocumentBox()
    const second = new TestDocumentBox()
    const third = new TestDocumentBox()

    manager.openDocument({ tabId: 'a', title: 'A', content: first })
    manager.openDocument({
      tabId: 'b',
      title: 'B',
      content: second,
      beforeClose: () => new Promise<boolean>(resolve => {
        resolveClose = resolve
      }),
    })
    manager.openDocument({ tabId: 'c', title: 'C', content: third })

    const closing = manager.closeDocument('b')
    expect(manager.moveDocument('c', 0)).toBe(true)

    resolveClose?.(true)
    await expect(closing).resolves.toBe(true)
    expect(manager.documents.map(document => document.tabId)).toEqual(['c', 'a'])
    expect(second.disposed).toBe(true)
    expect(first.disposed).toBe(false)
    expect(third.disposed).toBe(false)
  })
})
