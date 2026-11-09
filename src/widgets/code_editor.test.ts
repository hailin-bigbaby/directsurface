// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FocusManager } from '../core/focus_manager'
import { InputComposer } from '../core/input_composer'
import { PipelineOwner, type BoxConstraints, type RenderObject } from '../core/render_object'
import { PopupManager } from '../core/popup_manager'
import { PaintContext } from '../rendering/paint_context'
import { DrawList } from '../rendering/draw_list'
import { TextMeasurer } from '../core/text_measurer'
import { ImGuiDarkTheme } from '../theme/default_theme'
import {
  RenderCodeEditor,
  type CodeEditorCompletionItem,
  type CodeEditorContextMenuRequest,
  type CodeEditorDiagnostic,
  type CodeEditorHover,
  type CodeEditorLanguageAdapter,
  type CodeEditorLocation,
} from './code_editor'
import { PlainTextEditorController } from './plain_text_editor_controller'
import { TooltipManager } from './tooltip'

const constraints: BoxConstraints = {
  minWidth: 0,
  maxWidth: 320,
  minHeight: 0,
  maxHeight: 120,
}
const COMPLETION_TEST_POPUP_PADDING = 6

afterEach(() => {
  FocusManager.instance.dispose()
  InputComposer.instance.dispose()
  PopupManager.disposeInstance()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('RenderCodeEditor signature help integration', () => {
  it('triggers and retriggers signature help through the real InputComposer path', async () => {
    const contexts: Array<{ triggerKind: string; triggerCharacter?: string; isRetrigger: boolean }> = []
    const editor = new RenderCodeEditor({
      value: 'fn',
      signatureTriggerCharacters: ['(', ','],
      signatureRetriggerCharacters: [',', ')'],
      languageAdapter: {
        getSignatureHelp: (source, _position, _context, signatureContext) => {
          contexts.push({
            triggerKind: signatureContext.triggerKind,
            triggerCharacter: signatureContext.triggerCharacter,
            isRetrigger: signatureContext.isRetrigger,
          })
          const activeParameter = (source.match(/,/g) ?? []).length
          return {
            signatures: [{ label: 'fn(a, b)', parameters: [{ label: 'a' }, { label: 'b' }] }],
            activeSignature: 0,
            activeParameter,
          }
        },
      },
    })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setCursor({ line: 0, column: 2 })
    editor.focusIn()
    const input = inputElement()

    input.value = 'fn('
    input.setSelectionRange(3, 3)
    input.dispatchEvent(new Event('input'))
    await Promise.resolve()
    await Promise.resolve()
    expect(editor.signatureHelpInfo).toMatchObject({ activeParameter: 0 })
    expect(contexts[0]).toEqual({ triggerKind: 'trigger-character', triggerCharacter: '(', isRetrigger: false })

    input.value = 'fn(a,'
    input.setSelectionRange(5, 5)
    input.dispatchEvent(new Event('input'))
    await Promise.resolve()
    await Promise.resolve()
    expect(editor.signatureHelpInfo).toMatchObject({ activeParameter: 1 })
    expect(contexts[1]).toEqual({ triggerKind: 'retrigger-character', triggerCharacter: ',', isRetrigger: true })

    editor.dispose()
  })

  it('aborts pending signature requests on continued input and rejects stale results', async () => {
    let resolveFirst: ((value: any) => void) | undefined
    const signals: AbortSignal[] = []
    const editor = new RenderCodeEditor({
      value: 'fn',
      signatureTriggerCharacters: ['('],
      languageAdapter: {
        getSignatureHelp: (source, _position, _context, signatureContext) => {
          signals.push(signatureContext.signal)
          if (source === 'fn(') {
            return new Promise(resolve => {
              resolveFirst = resolve
            })
          }
          return {
            signatures: [{ label: `latest:${source}`, parameters: [] }],
            activeSignature: 0,
            activeParameter: 0,
          }
        },
      },
    })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setCursor({ line: 0, column: 2 })
    editor.focusIn()
    const input = inputElement()

    input.value = 'fn('
    input.setSelectionRange(3, 3)
    input.dispatchEvent(new Event('input'))
    await Promise.resolve()
    input.value = 'fn(a'
    input.setSelectionRange(4, 4)
    input.dispatchEvent(new Event('input'))
    await Promise.resolve()
    await Promise.resolve()

    expect(signals[0]?.aborted).toBe(true)
    expect(editor.signatureHelpInfo?.signatures[0]?.label).toBe('latest:fn(a')
    resolveFirst?.({
      signatures: [{ label: 'stale', parameters: [] }],
      activeSignature: 0,
      activeParameter: 0,
    })
    await Promise.resolve()
    expect(editor.signatureHelpInfo?.signatures[0]?.label).toBe('latest:fn(a')

    editor.dispose()
  })

  it('suppresses signature help for completion and retriggers from the current version', async () => {
    let signatureCalls = 0
    const editor = new RenderCodeEditor({
      value: 'fn(',
      languageAdapter: {
        getSignatureHelp: () => {
          signatureCalls += 1
          return {
            signatures: [{ label: `fn(a)#${signatureCalls}`, parameters: [{ label: 'a' }] }],
            activeSignature: 0,
            activeParameter: 0,
          }
        },
        getCompletions: () => [{ label: 'argument' }],
      },
    })
    editor.controller.setCursor({ line: 0, column: 3 })
    await editor.triggerSignatureHelp()
    expect(editor.signatureHelpVisible).toBe(true)

    await editor.triggerCompletion()
    expect(editor.completionVisible).toBe(true)
    expect(editor.signatureHelpActive).toBe(true)
    expect(editor.signatureHelpVisible).toBe(false)
    expect(editor.signatureHelpInfo).toBeNull()

    editor.closeCompletion()
    await Promise.resolve()
    await Promise.resolve()
    expect(signatureCalls).toBe(2)
    expect(editor.signatureHelpInfo?.signatures[0]?.label).toBe('fn(a)#2')

    editor.dispose()
  })

  it('gives the manual signature chord priority over completion without a double request', async () => {
    let signatureCalls = 0
    const editor = new RenderCodeEditor({
      value: 'fn(',
      languageAdapter: {
        getSignatureHelp: () => {
          signatureCalls += 1
          return {
            signatures: [{ label: 'fn(a)', parameters: [{ label: 'a' }] }],
            activeSignature: 0,
            activeParameter: 0,
          }
        },
        getCompletions: () => [{ label: 'argument' }],
      },
    })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setCursor({ line: 0, column: 3 })
    editor.focusIn()
    await editor.triggerCompletion()
    const event = new KeyboardEvent('keydown', {
      key: ' ',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })

    inputElement().dispatchEvent(event)
    await Promise.resolve()
    await Promise.resolve()

    expect(event.defaultPrevented).toBe(true)
    expect(editor.completionVisible).toBe(false)
    expect(signatureCalls).toBe(1)
    expect(editor.signatureHelpVisible).toBe(true)
    editor.dispose()
  })

  it('closes active signature help at IME composition start', async () => {
    const editor = new RenderCodeEditor({
      value: 'fn(',
      languageAdapter: {
        getSignatureHelp: () => ({
          signatures: [{ label: 'fn(a)', parameters: [{ label: 'a' }] }],
          activeSignature: 0,
          activeParameter: 0,
        }),
      },
    })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setCursor({ line: 0, column: 3 })
    editor.focusIn()
    await editor.triggerSignatureHelp()

    inputElement().dispatchEvent(new CompositionEvent('compositionstart'))

    expect(editor.signatureHelpActive).toBe(false)
    expect(editor.signatureHelpInfo).toBeNull()
    editor.dispose()
  })

  it('invalidates a pending signature request when the caret moves', async () => {
    let resolveFirst: ((value: any) => void) | undefined
    const signals: AbortSignal[] = []
    let calls = 0
    const editor = new RenderCodeEditor({
      value: 'fn(a)',
      languageAdapter: {
        getSignatureHelp: (_source, position, _context, signatureContext) => {
          calls += 1
          signals.push(signatureContext.signal)
          if (calls === 1) return new Promise(resolve => { resolveFirst = resolve })
          return {
            signatures: [{ label: `at:${position.column}`, parameters: [] }],
            activeSignature: 0,
            activeParameter: 0,
          }
        },
      },
    })
    editor.controller.setCursor({ line: 0, column: 3 })
    const first = editor.triggerSignatureHelp()
    editor.controller.setCursor({ line: 0, column: 4 })
    await Promise.resolve()
    await Promise.resolve()

    expect(signals[0]?.aborted).toBe(true)
    expect(editor.signatureHelpInfo?.signatures[0]?.label).toBe('at:4')
    resolveFirst?.({ signatures: [{ label: 'stale', parameters: [] }], activeSignature: 0, activeParameter: 0 })
    await first
    expect(editor.signatureHelpInfo?.signatures[0]?.label).toBe('at:4')
    editor.dispose()
  })

  it('uses two-level Escape to cancel completion and then a pending signature retrigger', async () => {
    let resolveRetrigger: ((value: any) => void) | undefined
    let retriggerSignal: AbortSignal | undefined
    let calls = 0
    const editor = new RenderCodeEditor({
      value: 'fn(',
      languageAdapter: {
        getSignatureHelp: (_source, _position, _context, signatureContext) => {
          calls += 1
          if (calls === 1) {
            return {
              signatures: [{ label: 'fn(a)', parameters: [{ label: 'a' }] }],
              activeSignature: 0,
              activeParameter: 0,
            }
          }
          retriggerSignal = signatureContext.signal
          return new Promise(resolve => { resolveRetrigger = resolve })
        },
        getCompletions: () => [{ label: 'argument' }],
      },
    })
    editor.controller.setCursor({ line: 0, column: 3 })
    await editor.triggerSignatureHelp()
    await editor.triggerCompletion()
    const preventDefault = vi.fn()

    expect((editor as any).onEditorKeyDown({ key: 'Escape', preventDefault } as unknown as KeyboardEvent, {})).toBe(true)
    expect(editor.signatureHelpActive).toBe(true)
    expect(editor.signatureHelpVisible).toBe(false)
    expect((editor as any).onEditorKeyDown({ key: 'Escape', preventDefault } as unknown as KeyboardEvent, {})).toBe(true)
    expect(retriggerSignal?.aborted).toBe(true)
    resolveRetrigger?.({
      signatures: [{ label: 'stale', parameters: [] }],
      activeSignature: 0,
      activeParameter: 0,
    })
    await Promise.resolve()
    expect(editor.signatureHelpActive).toBe(false)
    expect(editor.signatureHelpInfo).toBeNull()
    editor.dispose()
  })

  it('hides the signature tooltip before publishing completion suppression', async () => {
    const callbackStates: Array<{ help: boolean; popupOpen: boolean }> = []
    let editor!: RenderCodeEditor
    editor = new RenderCodeEditor({
      value: 'fn(',
      onSignatureHelpChange: help => {
        callbackStates.push({
          help: help !== null,
          popupOpen: ((editor as any)._signatureTooltip as TooltipManager).debugState().popupOpen,
        })
      },
      languageAdapter: {
        getSignatureHelp: () => ({
          signatures: [{ label: 'fn(value)', parameters: [{ label: 'value' }] }],
          activeSignature: 0,
          activeParameter: 0,
        }),
        getCompletions: () => [{ label: 'value' }],
      },
    })
    editor.attach(new PipelineOwner({}, ImGuiDarkTheme))
    editor.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 300 }, false, { theme: ImGuiDarkTheme })
    editor.controller.setCursor({ line: 0, column: 3 })
    await editor.triggerSignatureHelp()
    expect(((editor as any)._signatureTooltip as TooltipManager).debugState().popupOpen).toBe(true)

    await editor.triggerCompletion()

    expect(editor.signatureHelpActive).toBe(true)
    expect(editor.signatureHelpVisible).toBe(false)
    expect(callbackStates.at(-1)).toEqual({ help: false, popupOpen: false })
    editor.dispose()
  })

  it('refreshes overload selection in the same anchored presentation', async () => {
    const editor = new RenderCodeEditor({
      value: 'fn(',
      languageAdapter: {
        getSignatureHelp: () => ({
          signatures: [
            { label: 'fn(value)', parameters: [{ label: 'value' }] },
            { label: 'fn(value, count)', parameters: [{ label: 'value' }, { label: 'count' }] },
          ],
          activeSignature: 0,
          activeParameter: 0,
        }),
      },
    })
    editor.attach(new PipelineOwner({}, ImGuiDarkTheme))
    editor.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 300 }, false, { theme: ImGuiDarkTheme })
    await editor.triggerSignatureHelp({ line: 0, column: 3 })
    const tooltip = (editor as any)._signatureTooltip as TooltipManager

    expect(editor.moveSignatureSelection(1)).toBe(true)
    expect(editor.signatureHelpInfo?.activeSignature).toBe(1)
    expect(tooltip.debugState()).toMatchObject({ mode: 'anchored', popupOpen: true })
    expect(PopupManager.instance.stack.filter(candidate => candidate === tooltip)).toHaveLength(1)
    editor.dispose()
  })

  it('closes semantic signature state when PopupManager dismisses its owner', async () => {
    const onSignatureHelpChange = vi.fn()
    const editor = new RenderCodeEditor({
      value: 'fn(',
      onSignatureHelpChange,
      languageAdapter: {
        getSignatureHelp: () => ({
          signatures: [{ label: 'fn(value)', parameters: [{ label: 'value' }] }],
          activeSignature: 0,
          activeParameter: 0,
        }),
      },
    })
    editor.attach(new PipelineOwner({}, ImGuiDarkTheme))
    editor.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 300 }, false, { theme: ImGuiDarkTheme })
    await editor.triggerSignatureHelp({ line: 0, column: 3 })

    expect(PopupManager.instance.closeOwnedBy(editor)).toBe(true)

    expect(editor.signatureHelpActive).toBe(false)
    expect(onSignatureHelpChange).toHaveBeenLastCalledWith(null)
    expect(editor.debugState()).toMatchObject({ signatureHelpLines: [], signatureHelpRect: null })
    editor.dispose()
  })

  it('does not restore signature presentation after an active callback closes it', async () => {
    let editor!: RenderCodeEditor
    editor = new RenderCodeEditor({
      value: 'fn(',
      onSignatureHelpChange: help => {
        if (help) editor.closeSignatureHelp()
      },
      languageAdapter: {
        getSignatureHelp: () => ({
          signatures: [{ label: 'fn(value)', parameters: [{ label: 'value' }] }],
          activeSignature: 0,
          activeParameter: 0,
        }),
      },
    })
    editor.attach(new PipelineOwner({}, ImGuiDarkTheme))
    editor.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 300 }, false, { theme: ImGuiDarkTheme })

    await editor.triggerSignatureHelp({ line: 0, column: 3 })

    expect(editor.signatureHelpActive).toBe(false)
    expect(((editor as any)._signatureTooltip as TooltipManager).debugState()).toMatchObject({ mode: 'none', popupOpen: false })
    editor.dispose()
  })

  it('reports pre-paint and post-paint signature debug truth without leaking cached values', async () => {
    vi.useFakeTimers()
    const editor = new RenderCodeEditor({
      value: 'fn(',
      languageAdapter: {
        getSignatureHelp: () => ({
          signatures: [{
            label: 'fn(first, second)',
            documentation: 'Function documentation',
            parameters: [{ label: 'first' }, { label: 'second' }],
          }],
          activeSignature: 0,
          activeParameter: 1,
        }),
      },
    })
    editor.attach(new PipelineOwner({}, ImGuiDarkTheme))
    editor.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 300 }, false, { theme: ImGuiDarkTheme })
    PopupManager.instance.setContextProvider(() => ({
      theme: ImGuiDarkTheme,
      viewport: { width: 360, height: 300, dpr: 1 },
    }))
    editor.controller.setCursor({ line: 0, column: 3 })
    await editor.triggerSignatureHelp()

    expect(editor.debugState()).toMatchObject({
      signatureHelpActive: true,
      signatureHelpVisible: true,
      signatureHelpLabel: 'fn(first, second)',
      signatureHelpActiveParameter: 1,
      signatureHelpLines: [],
      signatureHelpRect: null,
    })

    const mainContext = mockCanvasContext()
    editor.paint(new PaintContext(mainContext, ImGuiDarkTheme), { x: 0, y: 0 })
    expect(mainContext.fillText).not.toHaveBeenCalledWith(
      'Function documentation',
      expect.any(Number),
      expect.any(Number),
    )
    vi.advanceTimersByTime(200)
    const tooltip = (editor as any)._signatureTooltip as TooltipManager
    tooltip.paint(new PaintContext(mockCanvasContext(), ImGuiDarkTheme), { x: 0, y: 0 })
    const painted = editor.debugState()
    expect(painted.signatureHelpLines).toEqual(expect.arrayContaining([
      expect.stringContaining('fn(first, second)'),
      'Parameter 2: second',
    ]))
    expect(painted.signatureHelpRect).not.toBeNull()
    ;(painted.signatureHelpLines as string[])[0] = 'mutated'
    if (painted.signatureHelpRect) painted.signatureHelpRect.x = -999
    expect(editor.debugState().signatureHelpLines[0]).not.toBe('mutated')
    expect(editor.debugState().signatureHelpRect?.x).not.toBe(-999)

    editor.dispose()
  })

  it('paints compact-editor signature help in the host viewport when opted in', async () => {
    vi.useFakeTimers()
    const editor = new RenderCodeEditor({
      value: 'fn(',
      signatureHelpBoundary: 'viewport',
      languageAdapter: {
        getSignatureHelp: () => ({
          signatures: [{ label: 'fn(value)', parameters: [{ label: 'value' }] }],
          activeSignature: 0,
          activeParameter: 0,
        }),
      },
    })
    editor.attach(new PipelineOwner({}, ImGuiDarkTheme))
    editor.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 96 }, false, { theme: ImGuiDarkTheme })
    PopupManager.instance.setContextProvider(() => ({
      theme: ImGuiDarkTheme, viewport: { width: 600, height: 400, dpr: 1 },
    }))
    editor.controller.setCursor({ line: 0, column: 3 })
    await editor.triggerSignatureHelp()
    vi.advanceTimersByTime(200)
    ;((editor as any)._signatureTooltip as TooltipManager).paint(
      new PaintContext(mockCanvasContext(), ImGuiDarkTheme), { x: 0, y: 0 },
    )
    const state = editor.debugState()
    expect(state.signatureHelpLines).toContain('Parameter 1: value')
    expect(state.signatureHelpRect).not.toBeNull()
    expect(state.signatureHelpRect!.y + state.signatureHelpRect!.height).toBeLessThanOrEqual(400)
    editor.dispose()
    expect(PopupManager.instance.stack).toHaveLength(0)
  })

  it('keeps semantic signature state active when the editor is too small to paint', async () => {
    vi.useFakeTimers()
    const editor = new RenderCodeEditor({
      value: 'fn(',
      languageAdapter: {
        getSignatureHelp: () => ({
          signatures: [{ label: 'fn(value)', parameters: [{ label: 'value' }] }],
          activeSignature: 0,
          activeParameter: 0,
        }),
      },
    })
    editor.attach(new PipelineOwner({}, ImGuiDarkTheme))
    editor.layout({ minWidth: 0, maxWidth: 30, minHeight: 0, maxHeight: 18 }, false, { theme: ImGuiDarkTheme })
    PopupManager.instance.setContextProvider(() => ({
      theme: ImGuiDarkTheme,
      viewport: { width: 30, height: 18, dpr: 1 },
    }))
    editor.controller.setCursor({ line: 0, column: 3 })
    await editor.triggerSignatureHelp()
    vi.advanceTimersByTime(200)
    ;((editor as any)._signatureTooltip as TooltipManager).paint(
      new PaintContext(mockCanvasContext(), ImGuiDarkTheme),
      { x: 0, y: 0 },
    )

    expect(editor.debugState()).toMatchObject({
      signatureHelpActive: true,
      signatureHelpVisible: true,
      signatureHelpLines: [],
      signatureHelpRect: null,
    })
    editor.dispose()
  })

  it('closes signature help on wheel even when scrolling is already at a boundary', async () => {
    const editor = new RenderCodeEditor({
      value: 'fn(',
      languageAdapter: {
        getSignatureHelp: () => ({
          signatures: [{ label: 'fn(value)', parameters: [{ label: 'value' }] }],
          activeSignature: 0,
          activeParameter: 0,
        }),
      },
    })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setCursor({ line: 0, column: 3 })
    await editor.triggerSignatureHelp()

    editor.onWheel({ type: 'wheel', pointerId: 1, position: { x: 10, y: 10 }, deltaX: 0, deltaY: -30 })

    expect(editor.signatureHelpActive).toBe(false)
    expect(editor.debugState().signatureHelpRect).toBeNull()
    editor.dispose()
  })

  it('closes signature help on focus out, reveal, hidden, and detach lifecycle boundaries', async () => {
    const editor = new RenderCodeEditor({
      value: 'fn(value)',
      languageAdapter: {
        getSignatureHelp: () => ({
          signatures: [{ label: 'fn(value)', parameters: [{ label: 'value' }] }],
          activeSignature: 0,
          activeParameter: 0,
        }),
      },
    })
    editor.controller.setCursor({ line: 0, column: 4 })

    await editor.triggerSignatureHelp()
    editor.focusOut()
    expect(editor.signatureHelpActive).toBe(false)

    await editor.triggerSignatureHelp()
    editor.revealPosition({ line: 0, column: 3 })
    expect(editor.signatureHelpActive).toBe(false)

    await editor.triggerSignatureHelp()
    editor.visible = false
    expect(editor.signatureHelpActive).toBe(false)

    editor.visible = true
    await editor.triggerSignatureHelp()
    editor.detach()
    expect(editor.signatureHelpActive).toBe(false)
    editor.dispose()
  })

  it('invalidates signature geometry but preserves semantic state across editor size changes', async () => {
    vi.useFakeTimers()
    const editor = new RenderCodeEditor({
      value: 'fn(value)',
      languageAdapter: {
        getSignatureHelp: () => ({
          signatures: [{ label: 'fn(value)', parameters: [{ label: 'value' }] }],
          activeSignature: 0,
          activeParameter: 0,
        }),
      },
    })
    editor.attach(new PipelineOwner({}, ImGuiDarkTheme))
    let viewport = { width: 360, height: 300, dpr: 1 }
    PopupManager.instance.setContextProvider(() => ({ theme: ImGuiDarkTheme, viewport }))
    editor.layout({ minWidth: 0, maxWidth: 360, minHeight: 0, maxHeight: 300 }, false, { theme: ImGuiDarkTheme })
    editor.controller.setCursor({ line: 0, column: 4 })
    await editor.triggerSignatureHelp()
    vi.advanceTimersByTime(200)
    const tooltip = (editor as any)._signatureTooltip as TooltipManager
    tooltip.paint(new PaintContext(mockCanvasContext(), ImGuiDarkTheme), { x: 0, y: 0 })
    expect(editor.debugState().signatureHelpRect).not.toBeNull()

    viewport = { width: 240, height: 200, dpr: 1 }
    editor.layout({ minWidth: 0, maxWidth: 240, minHeight: 0, maxHeight: 200 }, false, { theme: ImGuiDarkTheme })
    expect(editor.debugState()).toMatchObject({
      signatureHelpActive: true,
      signatureHelpVisible: true,
      signatureHelpLines: [],
      signatureHelpRect: null,
    })
    tooltip.paint(new PaintContext(mockCanvasContext(), ImGuiDarkTheme), { x: 0, y: 0 })
    expect(editor.debugState().signatureHelpRect).not.toBeNull()
    editor.dispose()
  })

})

describe('RenderCodeEditor navigation request isolation', () => {
  it('rejects async definition and references after cursor-only changes', async () => {
    let resolveDefinition: ((value: CodeEditorLocation) => void) | undefined
    let resolveReferences: ((value: any[]) => void) | undefined
    const editor = new RenderCodeEditor({
      value: 'alias usage',
      languageAdapter: {
        getDefinition: () => new Promise(resolve => { resolveDefinition = resolve }),
        getReferences: () => new Promise(resolve => { resolveReferences = resolve }),
      },
    })
    const definitionPromise = editor.goToDefinition({ line: 0, column: 1 })
    const referencesPromise = editor.findReferences({ line: 0, column: 7 })
    editor.controller.setSelection({ line: 0, column: 2 }, { line: 0, column: 5 })
    resolveDefinition?.({
      name: 'alias',
      range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
    })
    resolveReferences?.([{
      name: 'alias',
      kind: 'alias',
      role: 'declaration',
      range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
    }])

    expect(await definitionPromise).toBeNull()
    expect(await referencesPromise).toEqual([])
    editor.dispose()
  })

  it('accepts an explicit navigation position that differs from the current cursor', async () => {
    const editor = new RenderCodeEditor({
      value: 'alias usage',
      languageAdapter: {
        getDefinition: (_source, position) => ({
          name: `at:${position.column}`,
          range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
        }),
        getReferences: (_source, position) => [{
          name: `at:${position.column}`,
          role: 'reference',
          range: { start: { line: 0, column: 6 }, end: { line: 0, column: 11 } },
        }],
      },
    })
    editor.controller.setCursor({ line: 0, column: 10 })

    const references = await editor.findReferences({ line: 0, column: 1 })
    const definition = await editor.goToDefinition({ line: 0, column: 1 })

    expect(references[0]).toMatchObject({ name: 'at:1', role: 'reference' })
    expect(definition).toMatchObject({ name: 'at:1' })
    editor.dispose()
  })

  it('cancels requests only within the same navigation operation kind', async () => {
    let resolveFirstDefinition: ((value: CodeEditorLocation) => void) | undefined
    let resolveSecondDefinition: ((value: CodeEditorLocation) => void) | undefined
    let resolveReferences: ((value: any[]) => void) | undefined
    let definitionCalls = 0
    const editor = new RenderCodeEditor({
      value: 'alias usage',
      languageAdapter: {
        getDefinition: () => {
          definitionCalls += 1
          if (definitionCalls === 1) return new Promise(resolve => { resolveFirstDefinition = resolve })
          return new Promise(resolve => { resolveSecondDefinition = resolve })
        },
        getReferences: () => new Promise(resolve => { resolveReferences = resolve }),
      },
    })
    const staleDefinition = editor.goToDefinition({ line: 0, column: 1 })
    const references = editor.findReferences({ line: 0, column: 1 })
    const currentDefinition = editor.goToDefinition({ line: 0, column: 1 })
    resolveFirstDefinition?.({
      name: 'stale',
      range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
    })
    resolveReferences?.([{
      name: 'alias',
      role: 'reference',
      range: { start: { line: 0, column: 6 }, end: { line: 0, column: 11 } },
    }])

    expect(await staleDefinition).toBeNull()
    expect(await references).toHaveLength(1)
    resolveSecondDefinition?.({
      name: 'latest',
      range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
    })
    expect(await currentDefinition).toMatchObject({ name: 'latest' })
    editor.dispose()
  })

  it('invalidates pending navigation when hidden or detached', async () => {
    let resolveDefinition: ((value: CodeEditorLocation) => void) | undefined
    let resolveReferences: ((value: any[]) => void) | undefined
    const editor = new RenderCodeEditor({
      value: 'alias usage',
      languageAdapter: {
        getDefinition: () => new Promise(resolve => { resolveDefinition = resolve }),
        getReferences: () => new Promise(resolve => { resolveReferences = resolve }),
      },
    })
    const definition = editor.goToDefinition({ line: 0, column: 1 })
    editor.visible = false
    resolveDefinition?.({
      name: 'alias',
      range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
    })
    expect(await definition).toBeNull()

    editor.visible = true
    const references = editor.findReferences({ line: 0, column: 1 })
    editor.detach()
    resolveReferences?.([{
      name: 'alias',
      range: { start: { line: 0, column: 6 }, end: { line: 0, column: 11 } },
    }])
    expect(await references).toEqual([])
    editor.dispose()
  })
})

function inputElement(): HTMLTextAreaElement {
  const ta = document.getElementById('__ds_ui_input__') as HTMLTextAreaElement | null
  if (!ta) throw new Error('InputComposer textarea was not created')
  return ta
}

function mockCanvasContext(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    clip: vi.fn(),
    rect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    arc: vi.fn(),
    setLineDash: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 7 })),
    set fillStyle(_value: string | CanvasGradient | CanvasPattern) {},
    get fillStyle() { return '' },
    set strokeStyle(_value: string | CanvasGradient | CanvasPattern) {},
    get strokeStyle() { return '' },
    set font(_value: string) {},
    get font() { return '' },
    set textAlign(_value: CanvasTextAlign) {},
    get textAlign() { return 'left' as CanvasTextAlign },
    set textBaseline(_value: CanvasTextBaseline) {},
    get textBaseline() { return 'middle' as CanvasTextBaseline },
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D
}

describe('RenderCodeEditor', () => {
  it('does not refresh document language features for cursor-only controller changes', async () => {
    const getDiagnostics = vi.fn(() => [])
    const getSemanticTokens = vi.fn(() => [])
    const editor = new RenderCodeEditor({
      value: 'alpha\nbeta',
      languageAdapter: { getDiagnostics, getSemanticTokens },
    })
    await Promise.resolve()
    const diagnosticsCalls = getDiagnostics.mock.calls.length
    const semanticCalls = getSemanticTokens.mock.calls.length

    editor.controller.setCursor({ line: 1, column: 2 })
    await Promise.resolve()

    expect(getDiagnostics).toHaveBeenCalledTimes(diagnosticsCalls)
    expect(getSemanticTokens).toHaveBeenCalledTimes(semanticCalls)
    editor.dispose()
  })

  it('inherits the plain text editor surface appearance contract', () => {
    const framed = new RenderCodeEditor({ value: 'alpha' })
    const flush = new RenderCodeEditor({ value: 'beta', appearance: 'flush' })

    expect(framed.appearance).toBe('framed')
    expect(flush.appearance).toBe('flush')

    framed.dispose()
    flush.dispose()
  })

  it('subscribes to controller changes without replacing the external callback and unsubscribes on dispose', () => {
    const onDocumentChange = vi.fn()
    const getSemanticTokens = vi.fn(() => [])
    const controller = new PlainTextEditorController({ value: 'alpha', onDocumentChange })
    const editor = new RenderCodeEditor({
      controller,
      languageAdapter: { getSemanticTokens },
    })

    expect(controller.onDocumentChange).toBe(onDocumentChange)
    onDocumentChange.mockClear()
    getSemanticTokens.mockClear()
    controller.insertText('x')
    expect(onDocumentChange).toHaveBeenCalledTimes(1)
    expect(getSemanticTokens).toHaveBeenCalledTimes(1)

    editor.dispose()
    onDocumentChange.mockClear()
    getSemanticTokens.mockClear()
    controller.insertText('y')

    expect(onDocumentChange).toHaveBeenCalledTimes(1)
    expect(getSemanticTokens).not.toHaveBeenCalled()
  })

  it('loads diagnostics from the language adapter and exposes them as decorations', async () => {
    const editor = new RenderCodeEditor({
      value: 'bad rule',
      diagnosticsDebounceMs: 0,
      languageAdapter: {
        getDiagnostics: source => [{
          range: { start: { line: 0, column: 0 }, end: { line: 0, column: source.length } },
          severity: 'error',
          message: 'Bad rule',
          source: 'test',
        }],
      },
    })

    const diagnostics = await editor.validateNow()

    expect(diagnostics).toHaveLength(1)
    expect(editor.decorations).toMatchObject([{
      kind: 'error',
      message: 'Bad rule',
      range: { start: { line: 0, column: 0 }, end: { line: 0, column: 8 } },
    }])
    expect(editor.debugState()).toMatchObject({
      diagnosticsCount: 1,
      decorationCount: 1,
      hasLanguageAdapter: true,
    })

    editor.dispose()
  })

  it('uses semantic tokens as the editor token provider without changing text', async () => {
    const editor = new RenderCodeEditor({
      value: '规则 儿童禁用',
      languageAdapter: {
        getSemanticTokens: () => [{
          range: { start: { line: 0, column: 0 }, end: { line: 0, column: 2 } },
          type: 'keyword',
        }],
      },
    })

    await editor.refreshSemanticTokens()

    expect(editor.semanticTokens).toEqual([{
      range: { start: { line: 0, column: 0 }, end: { line: 0, column: 2 } },
      type: 'keyword',
      modifiers: undefined,
    }])
    expect(editor.value).toBe('规则 儿童禁用')
    expect(editor.debugState().semanticTokenCount).toBe(1)

    editor.dispose()
  })

  it('preserves scroll while typing with diagnostics and semantic tokens enabled', async () => {
    vi.useFakeTimers()
    const lines = Array.from({ length: 120 }, (_, index) => `line ${index}`)
    const editor = new RenderCodeEditor({
      value: lines.join('\n'),
      lineHeight: 16,
      fontSize: 12,
      folding: false,
      diagnosticsDebounceMs: 0,
      languageAdapter: {
        getDiagnostics: source => source.includes('x')
          ? [{
              range: { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } },
              severity: 'error',
              message: 'Bad token',
            }]
          : [],
        getSemanticTokens: source => [{
          range: { start: { line: 0, column: 0 }, end: { line: 0, column: Math.min(4, source.length) } },
          type: 'keyword',
        }],
      },
    })

    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.focusIn()
    editor.scrollY = 60 * 16
    const before = editor.scrollY
    const ta = inputElement()
    ta.value = `${lines[0]}x`
    ta.setSelectionRange(ta.value.length, ta.value.length)
    ta.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(1)
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })

    expect(editor.value.split('\n')[0]).toBe(`${lines[0]}x`)
    expect(editor.diagnostics).toHaveLength(1)
    expect(editor.scrollY).toBe(before)

    editor.dispose()
  })

  it('applies multiple edits from back to front', () => {
    const editor = new RenderCodeEditor({ value: 'alpha beta gamma' })

    editor.applyTextEdits([
      {
        range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
        newText: 'ALPHA',
      },
      {
        range: { start: { line: 0, column: 11 }, end: { line: 0, column: 16 } },
        newText: 'GAMMA',
      },
    ])

    expect(editor.value).toBe('ALPHA beta GAMMA')
    expect(editor.controller.undo()).toBe(true)
    expect(editor.value).toBe('alpha beta gamma')

    editor.dispose()
  })

  it('keeps formatted string results undoable', async () => {
    const editor = new RenderCodeEditor({
      value: '规则  A',
      languageAdapter: {
        formatDocument: () => '规则 A',
      },
    })

    expect(await editor.formatDocument()).toBe(true)

    expect(editor.value).toBe('规则 A')
    expect(editor.controller.undo()).toBe(true)
    expect(editor.value).toBe('规则  A')

    editor.dispose()
  })

  it('turns format adapter failures into a false result', async () => {
    const editor = new RenderCodeEditor({
      value: '规则  A',
      languageAdapter: {
        formatDocument: () => {
          throw new Error('formatter unavailable')
        },
      },
    })

    await expect(editor.formatDocument()).resolves.toBe(false)
    expect(editor.value).toBe('规则  A')

    editor.dispose()
  })

  it('ignores stale async diagnostics after the document changes', async () => {
    vi.useFakeTimers()
    let resolveFirst: ((value: CodeEditorDiagnostic[]) => void) | undefined
    const adapter: CodeEditorLanguageAdapter = {
      getDiagnostics: source => {
        if (source === 'first') {
          return new Promise(resolve => {
            resolveFirst = resolve
          })
        }
        return [{
          range: { start: { line: 0, column: 0 }, end: { line: 0, column: source.length } },
          severity: 'warning',
          message: `Current: ${source}`,
        }]
      },
    }
    const editor = new RenderCodeEditor({
      value: 'first',
      diagnosticsDebounceMs: 0,
      languageAdapter: adapter,
    })

    const firstPromise = editor.validateNow()
    editor.value = 'second'
    await vi.runAllTimersAsync()
    await editor.validateNow()
    resolveFirst?.([{
      range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
      severity: 'error',
      message: 'Stale',
    }])
    await firstPromise

    expect(editor.diagnostics).toMatchObject([{ severity: 'warning', message: 'Current: second' }])

    editor.dispose()
  })

  it('turns language adapter diagnostic failures into editor diagnostics', async () => {
    const editor = new RenderCodeEditor({
      value: 'x',
      languageAdapter: {
        getDiagnostics: () => {
          throw new Error('language service unavailable')
        },
      },
    })

    const diagnostics = await editor.validateNow()

    expect(diagnostics).toMatchObject([{
      severity: 'error',
      message: 'language service unavailable',
      source: 'language-adapter',
    }])

    editor.dispose()
  })

  it('opens completions from the language adapter and accepts the selected item', async () => {
    const editor = new RenderCodeEditor({
      value: '患',
      languageAdapter: {
        getCompletions: () => [
          {
            label: '患者',
            kind: 'variable',
            range: { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } },
          },
          {
            label: '医嘱',
            kind: 'variable',
            sortText: 'z',
          },
        ],
      },
    })

    const items = await editor.triggerCompletion({ line: 0, column: 1 })

    expect(items.map(item => item.label)).toEqual(['患者', '医嘱'])
    expect(editor.debugState()).toMatchObject({
      completionVisible: true,
      completionCount: 2,
      selectedCompletionLabel: '患者',
    })

    expect(editor.acceptSelectedCompletion()).toBe(true)
    expect(editor.value).toBe('患者')
    expect(editor.debugState().completionVisible).toBe(false)
    expect(editor.controller.undo()).toBe(true)
    expect(editor.value).toBe('患')

    editor.dispose()
  })

  it('passes completion context and accepts a structured completion list', async () => {
    let capturedContext: Parameters<NonNullable<CodeEditorLanguageAdapter['getCompletions']>>[3]
    const editor = new RenderCodeEditor({
      value: 'obj.',
      quickSuggestions: true,
      quickSuggestionsDelayMs: 75,
      acceptSuggestionOnEnter: 'smart',
      languageAdapter: {
        getCompletions: (_source, _position, _languageContext, completionContext) => {
          capturedContext = completionContext
          return {
            items: [{ label: 'field', filterText: 'field-value', kind: 'field' }],
            range: { start: { line: 0, column: 4 }, end: { line: 0, column: 4 } },
            validFor: /[a-z]*/gy,
          }
        },
      },
    })
    editor.controller.setCursor({ line: 0, column: 4 })

    const items = await editor.triggerCompletion(undefined, {
      activation: 'auto',
      triggerKind: 'trigger-character',
      triggerCharacter: '.',
    })

    expect(capturedContext).toMatchObject({
      activation: 'auto',
      triggerKind: 'trigger-character',
      triggerCharacter: '.',
    })
    expect(capturedContext?.signal.aborted).toBe(false)
    expect(items).toEqual([expect.objectContaining({
      label: 'field',
      filterText: 'field-value',
      range: { start: { line: 0, column: 4 }, end: { line: 0, column: 4 } },
    })])
    expect(editor.debugState()).toMatchObject({
      quickSuggestions: true,
      quickSuggestionsDelayMs: 75,
      acceptSuggestionOnEnter: 'smart',
    })
    editor.dispose()
  })

  it('aborts the previous completion request when a new request starts', async () => {
    let firstSignal: AbortSignal | undefined
    let resolveFirst: ((items: CodeEditorCompletionItem[]) => void) | undefined
    let requestCount = 0
    const editor = new RenderCodeEditor({
      value: 'a',
      languageAdapter: {
        getCompletions: (_source, _position, _context, completionContext) => {
          requestCount += 1
          if (requestCount === 1) {
            firstSignal = completionContext?.signal
            return new Promise<CodeEditorCompletionItem[]>(resolve => {
              resolveFirst = resolve
            })
          }
          return [{ label: 'active' }]
        },
      },
    })

    const first = editor.triggerCompletion()
    const second = editor.triggerCompletion()

    expect(firstSignal?.aborted).toBe(true)
    await expect(second).resolves.toEqual([expect.objectContaining({ label: 'active' })])
    resolveFirst?.([{ label: 'stale' }])
    await first
    expect(editor.completionItems.map(item => item.label)).toEqual(['active'])
    editor.dispose()
  })

  it('starts quick suggestions after a delay and filters a complete list locally', async () => {
    vi.useFakeTimers()
    let requestCount = 0
    const editor = new RenderCodeEditor({
      value: '',
      quickSuggestions: true,
      quickSuggestionsDelayMs: 50,
      languageAdapter: {
        completionTriggerCharacters: ['.'],
        completionWordPattern: /[a-z]/i,
        getCompletions: () => {
          requestCount += 1
          return {
            items: [
              { label: 'SELECT' },
              { label: 'SESSION' },
              { label: 'INSERT' },
            ],
            validFor: /^[a-z]*$/i,
          }
        },
      },
    })

    editor.controller.insertText('s')
    await vi.advanceTimersByTimeAsync(49)
    expect(requestCount).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(requestCount).toBe(1)
    expect(editor.completionItems.map(item => item.label)).toEqual(['SELECT', 'SESSION', 'INSERT'])

    editor.controller.insertText('e')
    await Promise.resolve()
    expect(requestCount).toBe(1)
    expect(editor.completionItems.map(item => item.label)).toEqual(['SELECT', 'SESSION', 'INSERT'])

    editor.controller.insertText('l')
    await Promise.resolve()
    expect(requestCount).toBe(1)
    expect(editor.completionItems.map(item => item.label)).toEqual(['SELECT'])

    editor.controller.insertText(';')
    await Promise.resolve()
    expect(editor.completionVisible).toBe(false)
    expect(requestCount).toBe(1)
    editor.dispose()
  })

  it('uses editor, adapter, and empty defaults for contextual quick-suggestion characters', async () => {
    vi.useFakeTimers()
    const withoutCapability = vi.fn(() => [{ label: 'users' }])
    const legacy = new RenderCodeEditor({
      value: '',
      quickSuggestions: true,
      quickSuggestionsDelayMs: 10,
      languageAdapter: {
        completionTriggerCharacters: ['.'],
        getCompletions: withoutCapability,
      },
    })
    legacy.controller.insertText(' ')
    await vi.advanceTimersByTimeAsync(20)
    expect(withoutCapability).not.toHaveBeenCalled()

    const adapterRequest = vi.fn(() => [{ label: 'users' }])
    const adapterCapability = new RenderCodeEditor({
      value: '',
      quickSuggestions: true,
      quickSuggestionsDelayMs: 10,
      languageAdapter: {
        completionTriggerCharacters: ['.'],
        completionQuickSuggestionCharacters: [' '],
        getCompletions: adapterRequest,
      },
    })
    adapterCapability.controller.insertText(' ')
    await vi.advanceTimersByTimeAsync(10)
    expect(adapterRequest).toHaveBeenCalledTimes(1)

    const overrideRequest = vi.fn(() => [{ label: 'users' }])
    const override = new RenderCodeEditor({
      value: '',
      quickSuggestions: true,
      quickSuggestionsDelayMs: 10,
      completionQuickSuggestionCharacters: [';'],
      languageAdapter: {
        completionTriggerCharacters: ['.'],
        completionQuickSuggestionCharacters: [' '],
        getCompletions: overrideRequest,
      },
    })
    override.controller.insertText(' ')
    await vi.advanceTimersByTimeAsync(20)
    expect(overrideRequest).not.toHaveBeenCalled()
    override.controller.insertText(';')
    await vi.advanceTimersByTimeAsync(10)
    expect(overrideRequest).toHaveBeenCalledTimes(1)

    const disabledRequest = vi.fn(() => [{ label: 'users' }])
    const disabled = new RenderCodeEditor({
      value: '',
      quickSuggestions: false,
      languageAdapter: {
        completionTriggerCharacters: ['.'],
        completionQuickSuggestionCharacters: [' '],
        getCompletions: disabledRequest,
      },
    })
    disabled.controller.insertText(' ')
    await vi.advanceTimersByTimeAsync(20)
    expect(disabledRequest).not.toHaveBeenCalled()

    legacy.dispose()
    adapterCapability.dispose()
    override.dispose()
    disabled.dispose()
  })

  it('soft-opens contextual completion through InputComposer without consuming Enter or Tab', async () => {
    vi.useFakeTimers()
    const contexts: Array<{ activation?: string; invocationReason?: string }> = []
    const editor = new RenderCodeEditor({
      value: 'SELECT * FROM',
      quickSuggestions: true,
      quickSuggestionsDelayMs: 20,
      languageAdapter: {
        completionTriggerCharacters: ['.'],
        completionQuickSuggestionCharacters: [' '],
        completionWordPattern: /[a-z]/i,
        getCompletions: (_source, position, _context, completionContext) => {
          contexts.push({
            activation: completionContext?.activation,
            invocationReason: completionContext?.invocationReason,
          })
          return {
            items: [{ label: 'users' }, { label: 'orders' }],
            range: { start: { ...position }, end: { ...position } },
            validFor: /^[a-z]*$/i,
          }
        },
      },
    })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setCursor({ line: 0, column: editor.value.length })
    editor.focusIn()
    const input = inputElement()

    input.value = 'SELECT * FROM '
    input.setSelectionRange(input.value.length, input.value.length)
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(20)

    expect(contexts).toEqual([{ activation: 'auto', invocationReason: 'context-boundary' }])
    expect(editor.completionVisible).toBe(true)
    expect(editor.debugState().selectedCompletionLabel).toBeNull()
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })
    const tabPreventDefault = vi.spyOn(tabEvent, 'preventDefault')
    expect((editor as any).onEditorKeyDown(tabEvent, {}))
      .toBe(false)
    expect(tabPreventDefault).not.toHaveBeenCalled()
    expect(editor.value).toBe('SELECT * FROM ')

    input.value = 'SELECT * FROM  '
    input.setSelectionRange(input.value.length, input.value.length)
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(20)
    expect(editor.debugState().selectedCompletionLabel).toBeNull()
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    input.dispatchEvent(enter)
    expect(editor.value).toBe('SELECT * FROM  \n')
    expect(editor.completionVisible).toBe(false)

    editor.dispose()
  })

  it('filters a contextual session locally and accepts the first match through InputComposer', async () => {
    vi.useFakeTimers()
    let requestCount = 0
    const editor = new RenderCodeEditor({
      value: 'SELECT * FROM',
      quickSuggestions: true,
      quickSuggestionsDelayMs: 20,
      languageAdapter: {
        completionTriggerCharacters: ['.'],
        completionQuickSuggestionCharacters: [' '],
        completionWordPattern: /[a-z]/i,
        getCompletions: (_source, position) => {
          requestCount += 1
          return {
            items: [{ label: 'orders' }, { label: 'users' }],
            range: { start: { ...position }, end: { ...position } },
            validFor: /^[a-z]*$/i,
          }
        },
      },
    })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setCursor({ line: 0, column: editor.value.length })
    editor.focusIn()
    const input = inputElement()

    input.value = 'SELECT * FROM '
    input.setSelectionRange(input.value.length, input.value.length)
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(20)
    input.value = 'SELECT * FROM u'
    input.setSelectionRange(input.value.length, input.value.length)
    input.dispatchEvent(new Event('input'))

    expect(requestCount).toBe(1)
    expect(editor.completionItems.map(item => item.label)).toEqual(['users'])
    expect(editor.debugState().selectedCompletionLabel).toBe('users')
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    input.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(editor.value).toBe('SELECT * FROM users')
    expect(input.value).toBe('SELECT * FROM users')

    editor.dispose()
  })

  it('preserves the contextual invocation reason for incomplete requery', async () => {
    vi.useFakeTimers()
    const reasons: Array<string | undefined> = []
    const editor = new RenderCodeEditor({
      value: 'SELECT * FROM',
      quickSuggestions: true,
      quickSuggestionsDelayMs: 10,
      languageAdapter: {
        completionTriggerCharacters: ['.'],
        completionQuickSuggestionCharacters: [' '],
        completionWordPattern: /[a-z]/i,
        getCompletions: (_source, position, _context, completionContext) => {
          reasons.push(completionContext?.invocationReason)
          return {
            items: [{ label: 'users' }],
            isIncomplete: true,
            range: { start: { line: 0, column: 14 }, end: { ...position } },
            validFor: /^[a-z]*$/i,
          }
        },
      },
    })
    editor.controller.setCursor({ line: 0, column: editor.value.length })
    editor.controller.insertText(' ')
    await vi.advanceTimersByTimeAsync(10)
    expect(editor.debugState().selectedCompletionLabel).toBeNull()

    editor.controller.insertText('u')
    await Promise.resolve()
    await Promise.resolve()

    expect(reasons).toEqual(['context-boundary', 'context-boundary'])
    expect(editor.debugState().selectedCompletionLabel).toBe('users')
    editor.dispose()
  })

  it('replaces an open completion session with a deferred contextual request after space', async () => {
    vi.useFakeTimers()
    const reasons: Array<string | undefined> = []
    const editor = new RenderCodeEditor({
      value: 'u',
      quickSuggestions: true,
      quickSuggestionsDelayMs: 10,
      languageAdapter: {
        completionTriggerCharacters: ['.'],
        completionQuickSuggestionCharacters: [' '],
        completionWordPattern: /[a-z]/i,
        getCompletions: (_source, position, _context, completionContext) => {
          reasons.push(completionContext?.invocationReason)
          return {
            items: [{ label: 'users' }],
            range: { start: { ...position }, end: { ...position } },
          }
        },
      },
    })
    editor.controller.setCursor({ line: 0, column: 1 })
    await editor.triggerCompletion(undefined, { activation: 'auto' })
    expect(editor.debugState().selectedCompletionLabel).toBe('users')

    expect((editor as any).onEditorKeyDown(new KeyboardEvent('keydown', { key: ' ', cancelable: true }), {})).toBe(false)
    editor.controller.insertText(' ')
    await vi.advanceTimersByTimeAsync(10)

    expect(reasons).toEqual([undefined, 'context-boundary'])
    expect(editor.completionVisible).toBe(true)
    expect(editor.debugState().selectedCompletionLabel).toBeNull()
    editor.dispose()
  })

  it('does not request a contextual quick suggestion while IME composition is active', async () => {
    vi.useFakeTimers()
    const reasons: Array<string | undefined> = []
    const editor = new RenderCodeEditor({
      value: '',
      quickSuggestions: true,
      quickSuggestionsDelayMs: 10,
      languageAdapter: {
        completionTriggerCharacters: ['.'],
        completionQuickSuggestionCharacters: [' '],
        getCompletions: (_source, _position, _context, completionContext) => {
          reasons.push(completionContext?.invocationReason)
          return [{ label: 'users' }]
        },
      },
    })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.focusIn()
    const input = inputElement()

    input.dispatchEvent(new CompositionEvent('compositionstart'))
    input.value = ' '
    input.setSelectionRange(1, 1)
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(20)
    expect(reasons).toEqual([])

    input.dispatchEvent(new CompositionEvent('compositionend', { data: ' ' }))
    await vi.advanceTimersByTimeAsync(10)
    expect(reasons).toEqual(['context-boundary'])
    editor.dispose()
  })

  it('extends the completion replacement range through real InputComposer input', async () => {
    vi.useFakeTimers()
    let requestCount = 0
    const editor = new RenderCodeEditor({
      value: '',
      quickSuggestions: true,
      quickSuggestionsDelayMs: 20,
      languageAdapter: {
        completionWordPattern: /[a-z]/i,
        getCompletions: source => {
          requestCount += 1
          return {
            items: [{ label: 'SELECT', kind: 'keyword' }],
            range: {
              start: { line: 0, column: 0 },
              end: { line: 0, column: source.length },
            },
            validFor: /^[a-z]*$/i,
          }
        },
      },
    })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.focusIn()
    const input = inputElement()

    input.value = 's'
    input.setSelectionRange(1, 1)
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(20)
    expect(editor.completionVisible).toBe(true)
    expect(requestCount).toBe(1)

    input.value = 'se'
    input.setSelectionRange(2, 2)
    input.dispatchEvent(new Event('input'))
    input.value = 'sel'
    input.setSelectionRange(3, 3)
    input.dispatchEvent(new Event('input'))

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    input.dispatchEvent(tab)

    expect(tab.defaultPrevented).toBe(true)
    expect(editor.value).toBe('SELECT')
    expect(input.value).toBe('SELECT')
    expect(editor.controller.cursor).toEqual({ line: 0, column: 6 })
    expect(requestCount).toBe(1)
    expect(editor.controller.undo()).toBe(true)
    expect(editor.value).toBe('sel')
    editor.dispose()
  })

  it('requests immediately for adapter trigger characters and retries incomplete lists', async () => {
    vi.useFakeTimers()
    const contexts: Array<{ triggerKind?: string; triggerCharacter?: string }> = []
    let requestCount = 0
    const editor = new RenderCodeEditor({
      value: 'obj',
      quickSuggestions: true,
      quickSuggestionsDelayMs: 100,
      languageAdapter: {
        completionTriggerCharacters: ['.'],
        completionWordPattern: /[a-z]/i,
        getCompletions: (_source, _position, _context, completionContext) => {
          requestCount += 1
          contexts.push({
            triggerKind: completionContext?.triggerKind,
            triggerCharacter: completionContext?.triggerCharacter,
          })
          return {
            items: [{ label: requestCount === 1 ? 'field' : 'fieldName' }],
            isIncomplete: true,
            validFor: /^[a-z]*$/i,
          }
        },
      },
    })
    editor.controller.setCursor({ line: 0, column: 3 })

    editor.controller.insertText('.')
    await Promise.resolve()
    await Promise.resolve()
    expect(requestCount).toBe(1)
    expect(contexts[0]).toEqual({ triggerKind: 'trigger-character', triggerCharacter: '.' })

    editor.controller.insertText('f')
    await Promise.resolve()
    await Promise.resolve()
    expect(requestCount).toBe(2)
    expect(contexts[1]).toEqual({ triggerKind: 'incomplete', triggerCharacter: undefined })
    editor.dispose()
  })

  it('uses smart Enter for automatic and manual completion sessions', async () => {
    const editor = new RenderCodeEditor({
      value: '',
      acceptSuggestionOnEnter: 'smart',
      languageAdapter: {
        getCompletions: () => [{ label: 'SELECT' }],
      },
    })
    const autoPreventDefault = vi.fn()
    await editor.triggerCompletion(undefined, { activation: 'auto' })

    expect((editor as any).onEditorKeyDown({ key: 'Enter', preventDefault: autoPreventDefault } as unknown as KeyboardEvent, {})).toBe(false)
    expect(autoPreventDefault).not.toHaveBeenCalled()
    expect(editor.value).toBe('')

    const manualPreventDefault = vi.fn()
    await editor.triggerCompletion(undefined, { activation: 'manual' })
    expect((editor as any).onEditorKeyDown({ key: 'Enter', preventDefault: manualPreventDefault } as unknown as KeyboardEvent, {})).toBe(true)
    expect(manualPreventDefault).toHaveBeenCalled()
    expect(editor.value).toBe('SELECT')
    editor.dispose()
  })

  it('closes an open completion session when the caret moves', async () => {
    const editor = new RenderCodeEditor({
      value: 'abc',
      languageAdapter: { getCompletions: () => [{ label: 'abcd' }] },
    })
    editor.controller.setCursor({ line: 0, column: 3 })
    await editor.triggerCompletion()

    editor.controller.setCursor({ line: 0, column: 1 })

    expect(editor.completionVisible).toBe(false)
    editor.dispose()
  })

  it('waits for IME composition to finish before starting quick suggestions', async () => {
    vi.useFakeTimers()
    let requestCount = 0
    const editor = new RenderCodeEditor({
      value: '',
      quickSuggestions: true,
      quickSuggestionsDelayMs: 20,
      completionWordPattern: /[a-z]/i,
      languageAdapter: {
        getCompletions: () => {
          requestCount += 1
          return [{ label: 'SELECT' }]
        },
      },
    })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.focusIn()
    const input = inputElement()

    input.dispatchEvent(new CompositionEvent('compositionstart'))
    input.value = 's'
    input.setSelectionRange(1, 1)
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(30)
    expect(requestCount).toBe(0)

    input.dispatchEvent(new CompositionEvent('compositionend', { data: 's' }))
    await vi.advanceTimersByTimeAsync(20)
    expect(editor.value).toBe('s')
    expect(requestCount).toBe(1)
    editor.dispose()
  })

  it('paints completion label and long detail on separate fitted lines', async () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const fillText = vi.fn()
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText,
      measureText: vi.fn((text: string) => ({ width: String(text).length * 8 })),
      set fillStyle(_value: string) {},
      get fillStyle() { return '' },
      set strokeStyle(_value: string) {},
      get strokeStyle() { return '' },
      set font(_value: string) {},
      get font() { return '' },
      set textAlign(_value: CanvasTextAlign) {},
      get textAlign() { return 'left' as CanvasTextAlign },
      set textBaseline(_value: CanvasTextBaseline) {},
      get textBaseline() { return 'middle' as CanvasTextBaseline },
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D
    const editor = new RenderCodeEditor({
      value: '医嘱.药品 属于 ',
      lineHeight: 16,
      fontSize: 12,
      languageAdapter: {
        getCompletions: () => [{
          label: '内酰胺常用抗菌药集合',
          kind: 'dataset',
          detail: '药品集合 | PHARM:PHARM_BETALACTAM_COMMON | 内酰胺常用抗菌药 | 药品 128 个',
        }],
      },
    })
    editor.layout({ minWidth: 0, maxWidth: 520, minHeight: 0, maxHeight: 240 }, false, { theme: ImGuiDarkTheme })

    await editor.triggerCompletion({ line: 0, column: '医嘱.药品 属于 '.length })
    ;(editor as any)._paintCompletionPopup(new PaintContext(ctx, ImGuiDarkTheme), { x: 0, y: 0 })

    const textCalls = fillText.mock.calls.map(call => ({
      text: String(call[0]),
      y: Number(call[2]),
      align: String(ctx.textAlign),
    }))
    const labelCall = textCalls.find(call => call.text.includes('内酰胺常用抗菌药集合'))
    const detailCall = textCalls.find(call => call.text.includes('药品集合'))
    expect(labelCall).toBeTruthy()
    expect(detailCall).toBeTruthy()
    expect(detailCall!.y).toBeGreaterThan(labelCall!.y)
    expect(detailCall!.text.length).toBeLessThan('药品集合 | PHARM:PHARM_BETALACTAM_COMMON | 内酰胺常用抗菌药 | 药品 128 个'.length)

    editor.dispose()
  })

  it('scrolls large completion lists and maps visible rows to provider items', async () => {
    const editor = new RenderCodeEditor({
      value: '',
      languageAdapter: {
        getCompletions: () => Array.from({ length: 12 }, (_, index) => ({ label: `item-${index}` })),
      },
    })
    editor.layout({ minWidth: 0, maxWidth: 640, minHeight: 0, maxHeight: 420 }, false, { theme: ImGuiDarkTheme })
    await editor.triggerCompletion()

    const preventDefault = vi.fn()
    expect((editor as any).onEditorKeyDown({ key: 'End', preventDefault } as unknown as KeyboardEvent, {})).toBe(true)
    expect(editor.debugState().selectedCompletionLabel).toBe('item-11')
    expect((editor as any)._completionSession.debugState().visibleStart).toBe(4)

    const rect = (editor as any)._completionPopupRect()
    expect(editor.onWheel({
      type: 'wheel',
      pointerId: 1,
      position: { x: rect.x + 20, y: rect.y + 20 },
      deltaX: 0,
      deltaY: -40,
    })).toBe(true)
    expect((editor as any)._completionSession.debugState().visibleStart).toBe(3)
    expect((editor as any)._completionIndexAt({
      x: rect.x + 20,
      y: rect.y + COMPLETION_TEST_POPUP_PADDING + 1,
    })).toBe(3)
    editor.dispose()
  })

  it('navigates and accepts completion with keyboard handling', async () => {
    const editor = new RenderCodeEditor({
      value: '',
      languageAdapter: {
        getCompletions: () => [
          { label: '如果', kind: 'keyword' },
          { label: '规则', kind: 'keyword' },
        ],
      },
    })

    await editor.triggerCompletion()

    const preventDefault = vi.fn()
    expect((editor as any).onEditorKeyDown({ key: 'ArrowDown', preventDefault } as unknown as KeyboardEvent, {})).toBe(true)
    expect(editor.debugState().selectedCompletionLabel).toBe('规则')
    expect((editor as any).onEditorKeyDown({ key: 'Enter', preventDefault } as unknown as KeyboardEvent, {})).toBe(true)
    expect(editor.value).toBe('规则')
    expect(preventDefault).toHaveBeenCalled()

    editor.dispose()
  })

  it('accepts the highlighted auto completion on enter by default', async () => {
    const getCompletions = vi.fn(() => [
      { label: '数据集', kind: 'keyword' as const },
      { label: '规则', kind: 'keyword' as const },
    ])
    const editor = new RenderCodeEditor({
      value: '',
      languageAdapter: {
        getCompletions,
      },
    })

    await editor.triggerCompletion(undefined, { activation: 'auto' })

    const preventDefault = vi.fn()
    const refresh = vi.fn()
    ;(editor as any)._handleKeyDown({ key: 'Enter', preventDefault } as unknown as KeyboardEvent, { refresh })
    await Promise.resolve()
    await Promise.resolve()

    expect(preventDefault).toHaveBeenCalled()
    expect(editor.value).toBe('数据集')
    expect(editor.debugState().completionVisible).toBe(false)
    expect(getCompletions).toHaveBeenCalledTimes(1)

    editor.dispose()
  })

  it('supports always and never policies for accepting completion on enter', async () => {
    const always = new RenderCodeEditor({
      value: '',
      acceptSuggestionOnEnter: 'always',
      languageAdapter: { getCompletions: () => [{ label: '数据集' }] },
    })
    await always.triggerCompletion(undefined, { activation: 'auto' })
    expect((always as any).onEditorKeyDown({
      key: 'Enter',
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent, {})).toBe(true)
    expect(always.value).toBe('数据集')

    const never = new RenderCodeEditor({
      value: '',
      acceptSuggestionOnEnter: 'never',
      languageAdapter: { getCompletions: () => [{ label: '规则' }] },
    })
    await never.triggerCompletion()
    ;(never as any)._handleKeyDown({
      key: 'Enter',
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent, { refresh: vi.fn() })
    expect(never.value).toBe('\n')
    expect(never.completionVisible).toBe(false)

    always.dispose()
    never.dispose()
  })

  it('accepts auto completion after keyboard navigation', async () => {
    const editor = new RenderCodeEditor({
      value: '',
      languageAdapter: {
        getCompletions: () => [
          { label: '数据集', kind: 'keyword' },
          { label: '规则', kind: 'keyword' },
        ],
      },
    })

    await editor.triggerCompletion(undefined, { activation: 'auto' })

    const preventDefault = vi.fn()
    expect((editor as any).onEditorKeyDown({ key: 'ArrowDown', preventDefault } as unknown as KeyboardEvent, {})).toBe(true)
    expect((editor as any).onEditorKeyDown({ key: 'Enter', preventDefault } as unknown as KeyboardEvent, {})).toBe(true)
    expect(editor.value).toBe('规则')
    expect(preventDefault).toHaveBeenCalled()

    editor.dispose()
  })

  it('applies completion commit characters in the same edit', async () => {
    const editor = new RenderCodeEditor({
      value: '患者',
      languageAdapter: {
        getCompletions: () => [
          {
            label: '患者',
            commitCharacters: ['.'],
            range: { start: { line: 0, column: 0 }, end: { line: 0, column: 2 } },
          },
        ],
      },
    })

    await editor.triggerCompletion({ line: 0, column: 2 })

    expect((editor as any).onEditorKeyDown({
      key: '.',
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent, {})).toBe(true)
    expect(editor.value).toBe('患者.')

    editor.dispose()
  })

  it('triggers member completions after accepting an item ending with a trigger character', async () => {
    let requestCount = 0
    const editor = new RenderCodeEditor({
      value: '患',
      languageAdapter: {
        getCompletions: source => {
          requestCount += 1
          return source.endsWith('患者.')
            ? [{ label: '年龄', kind: 'field' }]
            : [{
                label: '患者',
                insertText: '患者.',
                kind: 'variable',
                range: { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } },
              }]
        },
      },
    })

    await editor.triggerCompletion({ line: 0, column: 1 }, { activation: 'auto' })
    expect((editor as any).onEditorKeyDown({ key: 'Tab', preventDefault: vi.fn() } as unknown as KeyboardEvent, {})).toBe(true)
    await Promise.resolve()
    await Promise.resolve()

    expect(editor.value).toBe('患者.')
    expect(requestCount).toBeGreaterThanOrEqual(2)
    expect(editor.debugState()).toMatchObject({
      completionVisible: true,
      selectedCompletionLabel: '年龄',
    })

    editor.dispose()
  })

  it('syncs the input composer after accepting a completion from key handling', async () => {
    const editor = new RenderCodeEditor({
      value: '患者.',
      languageAdapter: {
        getCompletions: () => [{
          label: '年龄',
          kind: 'field',
          range: { start: { line: 0, column: 3 }, end: { line: 0, column: 3 } },
        }],
      },
    })
    const refresh = vi.fn()

    editor.controller.setCursor({ line: 0, column: 3 })
    await editor.triggerCompletion({ line: 0, column: 3 })
    ;(editor as any)._handleKeyDown({ key: 'Enter', preventDefault: vi.fn() } as unknown as KeyboardEvent, { refresh })

    expect(editor.value).toBe('患者.年龄')
    expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ syncComposer: true }))

    editor.dispose()
  })

  it('keeps the keyboard-selected completion visible in a bounded popup window', async () => {
    const editor = new RenderCodeEditor({
      value: '',
      languageAdapter: {
        getCompletions: () => Array.from({ length: 10 }, (_, index) => ({ label: `item-${index}` })),
      },
    })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    await editor.triggerCompletion()

    for (let index = 0; index < 8; index += 1) editor.moveCompletionSelection(1)
    const rect = (editor as any)._completionPopupRect()

    expect(editor.debugState().selectedCompletionLabel).toBe('item-8')
    expect(rect).toMatchObject({ width: 312, height: 92, rowCount: 2, rowHeight: 40 })
    expect(rect.x).toBeGreaterThanOrEqual(4)
    expect(rect.x + rect.width).toBeLessThanOrEqual(316)
    expect(rect.y).toBeGreaterThanOrEqual(4)
    expect(rect.y + rect.height).toBeLessThanOrEqual(116)
    expect((editor as any)._completionVisibleStartIndex).toBe(7)
    expect((editor as any)._completionIndexAt({
      x: rect.x + 8,
      y: rect.y + 6 + rect.rowHeight / 2,
    })).toBe(7)

    editor.dispose()
  })

  it('closes completion and preserves typed text when whitespace is entered', async () => {
    let requestCount = 0
    const editor = new RenderCodeEditor({
      value: '患者.年龄',
      languageAdapter: {
        getCompletions: () => {
          requestCount += 1
          return [{
            label: '姓名',
            kind: 'field',
            commitCharacters: [' '],
            range: { start: { line: 0, column: 3 }, end: { line: 0, column: 5 } },
          }]
        },
      },
    })

    editor.controller.setCursor({ line: 0, column: 5 })
    await editor.triggerCompletion({ line: 0, column: 5 }, { activation: 'auto' })
    const preventDefault = vi.fn()
    expect((editor as any).onEditorKeyDown({ key: ' ', preventDefault } as unknown as KeyboardEvent, {})).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(editor.debugState().completionVisible).toBe(false)

    editor.controller.insertText(' ')
    await Promise.resolve()
    await Promise.resolve()

    expect(editor.value).toBe('患者.年龄 ')
    expect(editor.debugState().completionVisible).toBe(false)
    expect(requestCount).toBe(1)

    editor.dispose()
  })

  it('ignores stale async completions after the document changes', async () => {
    let resolveFirst: ((value: CodeEditorCompletionItem[]) => void) | undefined
    const editor = new RenderCodeEditor({
      value: 'first',
      languageAdapter: {
        getCompletions: source => {
          if (source === 'first') {
            return new Promise(resolve => {
              resolveFirst = resolve
            })
          }
          return [{ label: `current:${source}` }]
        },
      },
    })

    const firstPromise = editor.triggerCompletion()
    editor.value = 'second'
    await editor.triggerCompletion()
    resolveFirst?.([{ label: 'stale' }])
    await firstPromise

    expect(editor.completionItems).toMatchObject([{ label: 'current:second' }])

    editor.dispose()
  })

  it('does not reopen completions after a pending request is closed', async () => {
    let resolveItems: ((value: CodeEditorCompletionItem[]) => void) | undefined
    const editor = new RenderCodeEditor({
      value: '患者.',
      languageAdapter: {
        getCompletions: () => new Promise(resolve => {
          resolveItems = resolve
        }),
      },
    })

    const promise = editor.triggerCompletion({ line: 0, column: 3 })
    editor.closeCompletion()
    resolveItems?.([{ label: '患者.年龄' }])
    await promise

    expect(editor.completionVisible).toBe(false)
    expect(editor.completionItems).toEqual([])

    editor.dispose()
  })

  it('loads hover information from the language adapter', async () => {
    const onHoverChange = vi.fn()
    const editor = new RenderCodeEditor({
      value: '患者.年龄',
      onHoverChange,
      languageAdapter: {
        getHover: () => ({
          label: '年龄',
          type: 'number',
          detail: '患者字段',
          documentation: '当前患者年龄',
          range: { start: { line: 0, column: 3 }, end: { line: 0, column: 5 } },
        }),
      },
    })

    const hover = await editor.triggerHover({ line: 0, column: 4 })

    expect(hover).toMatchObject({
      label: '年龄',
      type: 'number',
      range: { start: { line: 0, column: 3 }, end: { line: 0, column: 5 } },
    })
    expect(editor.debugState()).toMatchObject({
      hoverVisible: true,
      hoverLabel: '年龄',
      hoverDelayMs: 300,
    })
    expect(onHoverChange).toHaveBeenCalledWith(expect.objectContaining({ label: '年龄' }))

    editor.closeHover()
    expect(editor.hoverInfo).toBeNull()
    expect(onHoverChange).toHaveBeenLastCalledWith(null)

    editor.dispose()
  })

  it('normalizes and deep-clones structured hover sections and legacy documentation', async () => {
    const lines = ['  first  \r\n', ' second ']
    const sections = [
      { kind: 'text' as const, lines },
      { kind: 'code' as const, priority: 'required' as const, lines: ['  SELECT 1  \r\n\r\n  FROM users  '] },
      { kind: 'warning' as const, lines: ['  '] },
    ]
    const editor = new RenderCodeEditor({
      value: 'users',
      languageAdapter: {
        getHover: () => ({
          label: 'users',
          documentation: ' legacy docs\r\nnext line ',
          sections,
          range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
        }),
      },
    })

    await editor.triggerHover({ line: 0, column: 2 })
    lines.push('provider mutation')
    const first = editor.hoverInfo!
    expect(first.sections).toEqual([
      { kind: 'text', priority: 'normal', lines: ['first', 'second'] },
      {
        kind: 'code',
        priority: 'required',
        lines: ['  SELECT 1', '', '  FROM users'],
        language: undefined,
        text: '  SELECT 1\n\n  FROM users',
        copyText: '  SELECT 1\n\n  FROM users',
      },
      { kind: 'text', priority: 'normal', lines: ['legacy docs', 'next line'] },
    ])
    ;(first.sections![0]!.lines as string[]).push('consumer mutation')
    expect(editor.hoverInfo?.sections?.[0]?.lines).toEqual(['first', 'second'])

    editor.dispose()
  })

  it('keeps a hover session stable inside its exclusive range and closes immediately outside it', async () => {
    vi.useFakeTimers()
    const getHover = vi.fn((_source: string, position: { line: number; column: number }) => ({
      label: `at-${position.column}`,
      range: { start: { line: 0, column: position.column }, end: { line: 0, column: position.column + 3 } },
    }))
    const editor = new RenderCodeEditor({ value: 'abcdefghij', hoverDelayMs: 20, languageAdapter: { getHover } })

    await editor.triggerHover({ line: 0, column: 1 })
    ;(editor as any)._scheduleHover({ line: 0, column: 3 })
    await vi.advanceTimersByTimeAsync(40)
    expect(getHover).toHaveBeenCalledTimes(1)
    expect(editor.hoverInfo?.label).toBe('at-1')

    ;(editor as any)._scheduleHover({ line: 0, column: 4 })
    expect(editor.hoverInfo?.label).toBe('at-1')
    await vi.advanceTimersByTimeAsync(19)
    expect(getHover).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(getHover).toHaveBeenCalledTimes(2)
    expect(editor.hoverInfo?.label).toBe('at-4')

    editor.dispose()
  })

  it('does not schedule hover while dragging a text selection or after pointer release', async () => {
    vi.useFakeTimers()
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const getHover = vi.fn(() => ({
      label: 'orders',
      range: { start: { line: 0, column: 6 }, end: { line: 0, column: 12 } },
    }))
    const editor = new RenderCodeEditor({
      value: 'users orders',
      hoverDelayMs: 20,
      languageAdapter: { getHover },
    })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    const start = editor.positionToGlobalRect({ line: 0, column: 0 })!
    const end = editor.positionToGlobalRect({ line: 0, column: 8 })!

    editor.onPointerDown({
      pointerId: 17,
      pointerType: 'mouse',
      type: 'down',
      button: 0,
      buttons: 1,
      position: { x: start.x + 1, y: start.y + start.height / 2 },
      setPointerCapture: vi.fn(),
    })
    editor.onPointerMove({
      pointerId: 17,
      pointerType: 'mouse',
      type: 'move',
      buttons: 1,
      position: { x: end.x + 1, y: end.y + end.height / 2 },
    })
    await vi.advanceTimersByTimeAsync(40)
    expect(getHover).not.toHaveBeenCalled()

    editor.onPointerUp({
      pointerId: 17,
      pointerType: 'mouse',
      type: 'up',
      button: 0,
      buttons: 0,
      position: { x: end.x + 1, y: end.y + end.height / 2 },
      releasePointerCapture: vi.fn(),
    })
    await vi.advanceTimersByTimeAsync(40)
    expect(getHover).not.toHaveBeenCalled()

    const orders = editor.positionToGlobalRect({ line: 0, column: 8 })!
    editor.onPointerMove({
      pointerId: 17,
      pointerType: 'mouse',
      type: 'move',
      buttons: 0,
      position: { x: orders.x + 1, y: orders.y + orders.height / 2 },
    })
    await vi.advanceTimersByTimeAsync(20)
    expect(getHover).toHaveBeenCalledTimes(1)
    editor.dispose()
  })

  it('publishes hover debug geometry only after paint and rejects stale geometry', async () => {
    vi.useFakeTimers()
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 7)
    const editor = new RenderCodeEditor({
      value: 'users\n'.repeat(30),
      languageAdapter: {
        getHover: () => ({
          label: 'users',
          detail: 'table main.users',
          sections: [{ kind: 'list', lines: ['id INTEGER PRIMARY KEY', 'name TEXT NOT NULL'] }],
          range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
        }),
      },
    })
    const owner = new PipelineOwner({}, ImGuiDarkTheme)
    editor.attach(owner)
    editor.layout({ ...constraints, maxHeight: 300 }, false, { theme: ImGuiDarkTheme })
    PopupManager.instance.setContextProvider(() => ({
      theme: ImGuiDarkTheme,
      viewport: { width: 320, height: 300, dpr: 1 },
    }))
    await editor.triggerHover({ line: 0, column: 2 })

    expect(editor.debugState()).toMatchObject({ hoverVisible: true, hoverLines: [], hoverRect: null })
    const mainContext = mockCanvasContext()
    editor.paint(new PaintContext(mainContext, ImGuiDarkTheme), { x: 0, y: 0 })
    expect(mainContext.fillText).not.toHaveBeenCalledWith(
      'table main.users',
      expect.any(Number),
      expect.any(Number),
    )
    vi.advanceTimersByTime(200)
    const hoverCard = (editor as any)._hoverCard
    hoverCard.paint(
      new PaintContext(mockCanvasContext(), ImGuiDarkTheme),
      PopupManager.instance.contextFor(hoverCard),
    )
    const painted = editor.debugState()
    expect(painted.hoverLines).toEqual([
      'users',
      'table main.users',
      'id INTEGER PRIMARY K',
      'EY',
      'name TEXT NOT NULL',
    ])
    expect(painted.hoverRect).not.toBeNull()
    expect(painted.hoverRect!.x).toBeGreaterThanOrEqual(4)
    expect(painted.hoverRect!.x + painted.hoverRect!.width).toBeLessThanOrEqual(editor.size.width - 4)

    editor.offset = { x: 20, y: 10 }
    expect(editor.debugState()).toMatchObject({ hoverVisible: true, hoverLines: [], hoverRect: null })
    hoverCard.paint(
      new PaintContext(mockCanvasContext(), ImGuiDarkTheme),
      PopupManager.instance.contextFor(hoverCard),
    )
    expect(editor.debugState().hoverRect?.x).toBeGreaterThanOrEqual(24)

    editor.scrollY = 24
    expect(editor.hoverInfo).toBeNull()
    expect(editor.debugState()).toMatchObject({ hoverLines: [], hoverRect: null, hoverTruncated: false })
    editor.dispose()
  })

  it('anchors semantic hover after the token and allows the card to cross editor bounds', async () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 7)
    const editor = new RenderCodeEditor({
      value: 'orders',
      languageAdapter: {
        getHover: () => ({
          label: 'orders',
          detail: 'table main.orders',
          sections: [{
            kind: 'list',
            lines: Array.from({ length: 10 }, (_, index) => `column_${index} TEXT NOT NULL`),
          }],
          range: { start: { line: 0, column: 0 }, end: { line: 0, column: 6 } },
        }),
      },
    })
    editor.attach(new PipelineOwner({}, ImGuiDarkTheme))
    editor.layout({ minWidth: 0, maxWidth: 180, minHeight: 0, maxHeight: 96 }, false, { theme: ImGuiDarkTheme })
    editor.offset = { x: 20, y: 20 }
    PopupManager.instance.setContextProvider(() => ({
      theme: ImGuiDarkTheme,
      viewport: { width: 500, height: 320, dpr: 1 },
    }))
    const tokenEnd = editor.positionToGlobalRect({ line: 0, column: 6 })!

    await editor.triggerHover({ line: 0, column: 2 })
    const hoverCard = (editor as any)._hoverCard
    hoverCard.paint(
      new PaintContext(mockCanvasContext(), ImGuiDarkTheme),
      PopupManager.instance.contextFor(hoverCard),
    )

    const rect = editor.debugState().hoverRect!
    expect(hoverCard.debugState().placement).toBe('right-start')
    expect(rect.x).toBeGreaterThanOrEqual(tokenEnd.x + tokenEnd.width + 6)
    expect(rect.x).toBeGreaterThan(editor.paintBounds.x)
    expect(rect.x + rect.width).toBeGreaterThan(editor.paintBounds.x + editor.paintBounds.width)
    expect(rect.y + rect.height).toBeGreaterThan(editor.paintBounds.y + editor.paintBounds.height)
    expect(rect.x + rect.width).toBeLessThanOrEqual(500)
    expect(rect.y + rect.height).toBeLessThanOrEqual(320)
    editor.dispose()
  })

  it.each([
    { y: 20, height: 500, lines: 4, placement: 'bottom-start' },
    { y: 350, height: 500, lines: 4, placement: 'top-start' },
    { y: 110, height: 300, lines: 30, placement: 'bottom-start' },
  ])('keeps below-mode hover off the source line at y=$y', async ({ y, height, lines, placement }) => {
    const editor = new RenderCodeEditor({ value: 'ROUND(12.346,2)', hoverPlacement: 'below',
      languageAdapter: { getHover: () => ({ label: 'ROUND',
        sections: [{ kind: 'list', lines: Array.from({length:lines},(_,i)=>`Parameter ${i}`) }],
        range: { start: {line:0,column:0}, end: {line:0,column:5} },
      }) },
    })
    editor.attach(new PipelineOwner({},ImGuiDarkTheme))
    editor.layout({...constraints,maxWidth:400,maxHeight:96},false,{theme:ImGuiDarkTheme})
    editor.offset={x:80,y}
    PopupManager.instance.setContextProvider(()=>({theme:ImGuiDarkTheme,viewport:{width:640,height,dpr:1}}))
    await editor.triggerHover({line:0,column:2})
    const card=(editor as any)._hoverCard
    card.paint(new PaintContext(mockCanvasContext(),ImGuiDarkTheme),PopupManager.instance.contextFor(card))
    const anchor=editor.positionToGlobalRect({line:0,column:0})!,rect=editor.debugState().hoverRect!
    expect(rect).not.toBeNull();expect(card.debugState().placement).toBe(placement)
    expect(rect.x).toBeCloseTo(anchor.x)
    expect(rect.y>=anchor.y+anchor.height+6 || rect.y+rect.height<=anchor.y-6).toBe(true)
    expect(rect.y).toBeGreaterThanOrEqual(0);expect(rect.y+rect.height).toBeLessThanOrEqual(height)
    expect(editor.value).toBe('ROUND(12.346,2)');expect(editor.controller.canUndo).toBe(false)
    editor.closeHover();expect(editor.debugState().hoverRect).toBeNull();editor.dispose()
  })

  it('anchors a multiline hover to the complete visible segment containing the pointer', async () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 7)
    const editor = new RenderCodeEditor({
      value: 'alpha\nbeta gamma',
      languageAdapter: {
        getHover: () => ({
          label: 'multiline',
          range: { start: { line: 0, column: 2 }, end: { line: 1, column: 4 } },
        }),
      },
    })
    editor.attach(new PipelineOwner({}, ImGuiDarkTheme))
    editor.layout({ ...constraints, maxHeight: 160 }, false, { theme: ImGuiDarkTheme })
    PopupManager.instance.setContextProvider(() => ({
      theme: ImGuiDarkTheme,
      viewport: { width: 500, height: 260, dpr: 1 },
    }))
    const segmentEnd = editor.positionToGlobalRect({ line: 1, column: 4 })!

    await editor.triggerHover({ line: 1, column: 2 })
    const hoverCard = (editor as any)._hoverCard
    hoverCard.paint(
      new PaintContext(mockCanvasContext(), ImGuiDarkTheme),
      PopupManager.instance.contextFor(hoverCard),
    )

    expect(hoverCard.debugState().placement).toBe('right-start')
    expect(editor.debugState().hoverRect!.x).toBeGreaterThanOrEqual(segmentEnd.x + segmentEnd.width + 6)
    editor.dispose()
  })

  it('binds hover popup ownership and stable root to the editor render tree', async () => {
    vi.useFakeTimers()
    const editor = new RenderCodeEditor({
      value: 'users',
      languageAdapter: {
        getHover: () => ({
          label: 'users',
          range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
        }),
      },
    })
    editor.attach(new PipelineOwner({}, ImGuiDarkTheme))
    editor.layout({ ...constraints, maxHeight: 300 }, false, { theme: ImGuiDarkTheme })
    const unrelatedRoot = new RenderCodeEditor()
    PopupManager.instance.setAnchorRootProvider(() => unrelatedRoot)
    let resolvedRoot: RenderObject | undefined
    PopupManager.instance.setContextProvider(anchorRoot => {
      resolvedRoot = anchorRoot
      return { theme: ImGuiDarkTheme, viewport: { width: 320, height: 300, dpr: 1 } }
    })
    await editor.triggerHover({ line: 0, column: 2 })
    const hoverCard = (editor as any)._hoverCard
    PopupManager.instance.contextFor(hoverCard)

    expect(resolvedRoot).toBe(editor)
    expect(PopupManager.instance.stack).toContain(hoverCard)
    expect(PopupManager.instance.closeOwnedBy(editor)).toBe(true)
    expect(editor.hoverInfo).toBeNull()
    expect(editor.debugState()).toMatchObject({ hoverVisible: false, hoverLines: [], hoverRect: null })
    editor.dispose()
  })

  it('does not restore a hover presentation after an active callback closes it', async () => {
    let editor!: RenderCodeEditor
    editor = new RenderCodeEditor({
      value: 'users',
      onHoverChange: hover => {
        if (hover) editor.closeHover()
      },
      languageAdapter: {
        getHover: () => ({
          label: 'users',
          range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
        }),
      },
    })
    editor.attach(new PipelineOwner({}, ImGuiDarkTheme))
    editor.layout({ ...constraints, maxHeight: 300 }, false, { theme: ImGuiDarkTheme })

    await editor.triggerHover({ line: 0, column: 2 })

    expect(editor.hoverInfo).toBeNull()
    expect((editor as any)._hoverCard.debugState()).toMatchObject({ open: false })
    editor.dispose()
  })

  it('routes real popup pointer input to structured hover links and keeps card focus alive', async () => {
    const onHoverLinkClick = vi.fn()
    const editor = new RenderCodeEditor({
      value: 'coalesce',
      onHoverLinkClick,
      languageAdapter: {
        getHover: () => ({
          label: 'coalesce',
          links: [{
            label: 'SQLite docs',
            href: 'https://sqlite.org/lang_corefunc.html#coalesce',
            title: 'coalesce documentation',
          }],
          range: { start: { line: 0, column: 0 }, end: { line: 0, column: 8 } },
        }),
      },
    })
    editor.attach(new PipelineOwner({}, ImGuiDarkTheme))
    editor.layout({ ...constraints, maxHeight: 300 }, false, { theme: ImGuiDarkTheme })
    PopupManager.instance.setContextProvider(() => ({
      theme: ImGuiDarkTheme,
      viewport: { width: 320, height: 300, dpr: 1 },
    }))
    FocusManager.instance.setFocus(editor)
    await editor.triggerHover({ line: 0, column: 2 })
    const hoverCard = (editor as any)._hoverCard
    hoverCard.paint(
      new PaintContext(mockCanvasContext(), ImGuiDarkTheme),
      PopupManager.instance.contextFor(hoverCard),
    )
    const target = editor.debugState().hoverLinkTargets[0]!

    expect(PopupManager.instance.handlePointerDown({
      pointerId: 7,
      pointerType: 'mouse',
      type: 'down',
      button: 0,
      buttons: 1,
      position: {
        x: target.rect.x + target.rect.width / 2,
        y: target.rect.y + target.rect.height / 2,
      },
    })).toBe(true)
    PopupManager.instance.handlePointerUp({
      pointerId: 7,
      pointerType: 'mouse',
      type: 'up',
      button: 0,
      buttons: 0,
      position: {
        x: target.rect.x + target.rect.width / 2,
        y: target.rect.y + target.rect.height / 2,
      },
    })
    await Promise.resolve()

    expect(onHoverLinkClick).toHaveBeenCalledWith({
      label: 'SQLite docs',
      href: 'https://sqlite.org/lang_corefunc.html#coalesce',
      title: 'coalesce documentation',
    })
    expect(editor.hoverInfo?.label).toBe('coalesce')
    expect(editor.debugState().hoverCardFocusInside).toBe(true)
    editor.dispose()
  })

  it('keeps hover open while the pointer crosses the gap into the card', async () => {
    vi.useFakeTimers()
    const editor = new RenderCodeEditor({
      value: 'users',
      hoverCardCloseDelayMs: 150,
      languageAdapter: {
        getHover: () => ({
          label: 'users',
          range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
        }),
      },
    })
    editor.attach(new PipelineOwner({}, ImGuiDarkTheme))
    editor.layout({ ...constraints, maxHeight: 300 }, false, { theme: ImGuiDarkTheme })
    PopupManager.instance.setContextProvider(() => ({
      theme: ImGuiDarkTheme,
      viewport: { width: 320, height: 300, dpr: 1 },
    }))
    await editor.triggerHover({ line: 0, column: 2 })
    const hoverCard = (editor as any)._hoverCard
    hoverCard.paint(
      new PaintContext(mockCanvasContext(), ImGuiDarkTheme),
      PopupManager.instance.contextFor(hoverCard),
    )
    const rect = editor.debugState().hoverRect!

    editor.onPointerLeave({
      pointerId: 1,
      pointerType: 'mouse',
      type: 'move',
      position: { x: 0, y: 0 },
    })
    vi.advanceTimersByTime(100)
    PopupManager.instance.handlePointerMove({
      pointerId: 1,
      pointerType: 'mouse',
      type: 'move',
      position: { x: rect.x + 8, y: rect.y + 8 },
    })
    vi.advanceTimersByTime(200)

    expect(editor.hoverInfo?.label).toBe('users')
    expect(editor.debugState().hoverCardPointerInside).toBe(true)

    PopupManager.instance.handlePointerMove({
      pointerId: 1,
      pointerType: 'mouse',
      type: 'move',
      position: { x: 310, y: 290 },
    })
    vi.advanceTimersByTime(150)
    expect(editor.hoverInfo).toBeNull()
    editor.dispose()
  })

  it('invalidates a pending gap hover request when the pointer enters the card', async () => {
    vi.useFakeTimers()
    let requestCount = 0
    let resolveGapRequest: ((hover: CodeEditorHover | null) => void) | undefined
    const editor = new RenderCodeEditor({
      value: 'users orders',
      hoverDelayMs: 0,
      languageAdapter: {
        getHover: () => {
          requestCount += 1
          if (requestCount === 1) {
            return {
              label: 'users',
              range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
            }
          }
          return new Promise(resolve => {
            resolveGapRequest = resolve
          })
        },
      },
    })
    editor.attach(new PipelineOwner({}, ImGuiDarkTheme))
    editor.layout({ ...constraints, maxHeight: 300 }, false, { theme: ImGuiDarkTheme })
    PopupManager.instance.setContextProvider(() => ({
      theme: ImGuiDarkTheme,
      viewport: { width: 320, height: 300, dpr: 1 },
    }))
    await editor.triggerHover({ line: 0, column: 2 })
    const hoverCard = (editor as any)._hoverCard
    hoverCard.paint(
      new PaintContext(mockCanvasContext(), ImGuiDarkTheme),
      PopupManager.instance.contextFor(hoverCard),
    )
    const rect = editor.debugState().hoverRect!

    ;(editor as any)._scheduleHover({ line: 0, column: 7 })
    await vi.advanceTimersByTimeAsync(0)
    expect(requestCount).toBe(2)
    PopupManager.instance.handlePointerMove({
      pointerId: 11,
      pointerType: 'mouse',
      type: 'move',
      position: { x: rect.x + 8, y: rect.y + 8 },
    })
    resolveGapRequest?.({
      label: 'orders',
      range: { start: { line: 0, column: 6 }, end: { line: 0, column: 12 } },
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(editor.hoverInfo?.label).toBe('users')
    editor.dispose()
  })

  it('consumes hover card overflow wheel at its boundary without scrolling the editor', async () => {
    const editor = new RenderCodeEditor({
      value: `${'users\n'.repeat(60)}`,
      languageAdapter: {
        getHover: () => ({
          label: 'users',
          sections: [{
            kind: 'text',
            lines: Array.from({ length: 80 }, (_, index) => `column ${index}`),
          }],
          range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
        }),
      },
    })
    editor.attach(new PipelineOwner({}, ImGuiDarkTheme))
    editor.layout({ ...constraints, maxHeight: 300 }, false, { theme: ImGuiDarkTheme })
    PopupManager.instance.setContextProvider(() => ({
      theme: ImGuiDarkTheme,
      viewport: { width: 320, height: 300, dpr: 1 },
    }))
    await editor.triggerHover({ line: 0, column: 2 })
    const hoverCard = (editor as any)._hoverCard
    hoverCard.paint(
      new PaintContext(mockCanvasContext(), ImGuiDarkTheme),
      PopupManager.instance.contextFor(hoverCard),
    )
    const rect = editor.debugState().hoverRect!

    for (let index = 0; index < 30; index += 1) {
      expect(PopupManager.instance.handleWheel({
        pointerId: 3,
        pointerType: 'mouse',
        type: 'wheel',
        position: { x: rect.x + 20, y: rect.y + 20 },
        deltaX: 0,
        deltaY: 240,
      })).toBe(true)
    }

    expect(editor.scrollY).toBe(0)
    expect(editor.hoverInfo?.label).toBe('users')
    editor.dispose()
  })

  it('closes hover for any wheel inside the editor even at a scroll boundary', async () => {
    const editor = new RenderCodeEditor({
      value: 'users',
      languageAdapter: {
        getHover: () => ({
          label: 'users',
          range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
        }),
      },
    })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    await editor.triggerHover({ line: 0, column: 2 })

    editor.onWheel({
      pointerId: 1,
      type: 'wheel',
      position: { x: 20, y: 20 },
      deltaX: 0,
      deltaY: -100,
      shiftKey: false,
    })

    expect(editor.hoverInfo).toBeNull()
    editor.dispose()
  })

  it('closes hover and cancels delayed requests when hidden or detached', async () => {
    vi.useFakeTimers()
    const getHover = vi.fn(() => ({
      label: 'users',
      range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
    }))
    const editor = new RenderCodeEditor({
      value: 'users',
      hoverDelayMs: 20,
      languageAdapter: { getHover },
    })

    await editor.triggerHover({ line: 0, column: 2 })
    expect(editor.hoverInfo).not.toBeNull()
    editor.visible = false
    expect(editor.hoverInfo).toBeNull()

    editor.visible = true
    ;(editor as any)._scheduleHover({ line: 0, column: 2 })
    editor.detach()
    await vi.advanceTimersByTimeAsync(30)
    expect(getHover).toHaveBeenCalledTimes(1)
    expect(editor.hoverInfo).toBeNull()

    editor.dispose()
  })

  it('ignores stale async hover results after the document changes', async () => {
    let resolveFirst: ((value: CodeEditorHover | null) => void) | undefined
    const editor = new RenderCodeEditor({
      value: 'first',
      languageAdapter: {
        getHover: source => {
          if (source === 'first') {
            return new Promise(resolve => {
              resolveFirst = resolve
            })
          }
          return {
            label: `current:${source}`,
            range: { start: { line: 0, column: 0 }, end: { line: 0, column: source.length } },
          }
        },
      },
    })

    const firstPromise = editor.triggerHover({ line: 0, column: 1 })
    editor.value = 'second'
    await editor.triggerHover({ line: 0, column: 1 })
    resolveFirst?.({
      label: 'stale',
      range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
    })
    await firstPromise

    expect(editor.hoverInfo).toMatchObject({ label: 'current:second' })

    editor.dispose()
  })

  it('does not reopen hover after a pending request is closed', async () => {
    let resolveHover: ((value: CodeEditorHover | null) => void) | undefined
    const editor = new RenderCodeEditor({
      value: '患者.年龄',
      languageAdapter: {
        getHover: () => new Promise(resolve => {
          resolveHover = resolve
        }),
      },
    })

    const promise = editor.triggerHover({ line: 0, column: 4 })
    editor.closeHover()
    resolveHover?.({
      label: '患者.年龄',
      range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
    })
    await promise

    expect(editor.hoverInfo).toBeNull()

    editor.dispose()
  })

  it('closes hover when the document changes', async () => {
    const editor = new RenderCodeEditor({
      value: '患者',
      languageAdapter: {
        getHover: () => ({
          label: '患者',
          range: { start: { line: 0, column: 0 }, end: { line: 0, column: 2 } },
        }),
      },
    })

    await editor.triggerHover({ line: 0, column: 1 })
    editor.value = '医嘱'

    expect(editor.hoverInfo).toBeNull()

    editor.dispose()
  })

  it('clears transient completion and hover state when switching language adapters', async () => {
    const editor = new RenderCodeEditor({
      value: '患者.年龄',
      languageAdapter: {
        getCompletions: () => [{ label: '患者.年龄' }],
        getHover: () => ({
          label: '患者.年龄',
          range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
        }),
      },
    })

    await editor.triggerCompletion({ line: 0, column: 5 })
    await editor.triggerHover({ line: 0, column: 3 })
    editor.languageAdapter = {}

    expect(editor.completionVisible).toBe(false)
    expect(editor.completionItems).toEqual([])
    expect(editor.hoverInfo).toBeNull()

    editor.dispose()
  })

  it('loads and applies code actions from the language adapter', async () => {
    const editor = new RenderCodeEditor({
      value: '规则 测试',
      languageAdapter: {
        getCodeActions: () => [{
          title: '追加提示',
          kind: 'quickfix',
          edits: [{
            range: { start: { line: 0, column: 5 }, end: { line: 0, column: 5 } },
            newText: '\n提示 "TODO"',
          }],
        }],
      },
    })

    const actions = await editor.triggerCodeActions()

    expect(actions).toHaveLength(1)
    expect(editor.applyCodeAction(actions[0]!)).toBe(true)
    expect(editor.value).toBe('规则 测试\n提示 "TODO"')

    editor.dispose()
  })

  it('jumps to definition and selects the returned selection range', async () => {
    const editor = new RenderCodeEditor({
      value: '规则 基础\n引用 基础',
      languageAdapter: {
        getDefinition: () => ({
          name: '基础',
          kind: 'rule',
          range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
          selectionRange: { start: { line: 0, column: 3 }, end: { line: 0, column: 5 } },
        }),
      },
    })

    const location = await editor.goToDefinition({ line: 1, column: 4 })

    expect(location).toMatchObject({ name: '基础', kind: 'rule' })
    expect(editor.controller.selection).toEqual({
      start: { line: 0, column: 3 },
      end: { line: 0, column: 5 },
    })

    editor.dispose()
  })

  it('ignores stale definition results after the document changes', async () => {
    let resolveDefinition: ((value: CodeEditorLocation) => void) | undefined
    const editor = new RenderCodeEditor({
      value: 'first',
      languageAdapter: {
        getDefinition: source => {
          if (source === 'first') {
            return new Promise(resolve => {
              resolveDefinition = resolve
            })
          }
          return {
            name: 'current',
            range: { start: { line: 0, column: 0 }, end: { line: 0, column: source.length } },
          }
        },
      },
    })

    const firstPromise = editor.goToDefinition({ line: 0, column: 1 })
    editor.value = 'second'
    resolveDefinition?.({
      name: 'stale',
      range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
    })
    const result = await firstPromise

    expect(result).toBeNull()
    expect(editor.controller.selection).toEqual({
      start: { line: 0, column: 0 },
      end: { line: 0, column: 0 },
    })

    editor.dispose()
  })

  it('returns references without mutating the editor selection', async () => {
    const editor = new RenderCodeEditor({
      value: '数据集 高危药\n如果 医嘱.药品 属于 高危药',
      languageAdapter: {
        getReferences: () => [{
          name: '高危药',
          kind: 'dataset',
          range: { start: { line: 1, column: 13 }, end: { line: 1, column: 16 } },
        }],
      },
    })

    const references = await editor.findReferences({ line: 0, column: 5 })

    expect(references).toEqual([{
      name: '高危药',
      kind: 'dataset',
      range: { start: { line: 1, column: 13 }, end: { line: 1, column: 16 } },
    }])
    expect(editor.controller.selection).toEqual({
      start: { line: 0, column: 0 },
      end: { line: 0, column: 0 },
    })

    editor.dispose()
  })

  it('renames a symbol by applying returned edits from back to front', async () => {
    const editor = new RenderCodeEditor({
      value: '规则 基础\n引用 基础',
      languageAdapter: {
        getRenameEdits: (_source, _position, newName) => [
          {
            range: { start: { line: 0, column: 3 }, end: { line: 0, column: 5 } },
            newText: newName,
          },
          {
            range: { start: { line: 1, column: 3 }, end: { line: 1, column: 5 } },
            newText: newName,
          },
        ],
      },
    })

    const edits = await editor.renameSymbol('基础年龄', { line: 0, column: 4 })

    expect(edits).toHaveLength(2)
    expect(editor.value).toBe('规则 基础年龄\n引用 基础年龄')

    editor.dispose()
  })

  it('expands selection to the next language-provided range', async () => {
    const editor = new RenderCodeEditor({
      value: '如果 患者.年龄 小于 18',
      languageAdapter: {
        getSelectionRanges: () => [
          {
            kind: 'token',
            range: { start: { line: 0, column: 6 }, end: { line: 0, column: 8 } },
            text: '年龄',
          },
          {
            kind: 'member',
            range: { start: { line: 0, column: 3 }, end: { line: 0, column: 8 } },
            text: '患者.年龄',
          },
        ],
      },
    })
    editor.controller.setSelection({ line: 0, column: 6 }, { line: 0, column: 8 })

    const range = await editor.expandSelection({ line: 0, column: 7 })

    expect(range).toMatchObject({ kind: 'member' })
    expect(editor.controller.selection).toEqual({
      start: { line: 0, column: 3 },
      end: { line: 0, column: 8 },
    })

    editor.dispose()
  })

  it('selects the smallest language-provided range on double click', async () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const editor = new RenderCodeEditor({
      value: '如果 患者.年龄 小于 18',
      lineHeight: 16,
      fontSize: 12,
      languageAdapter: {
        getSelectionRanges: () => [
          {
            kind: 'member',
            range: { start: { line: 0, column: 3 }, end: { line: 0, column: 8 } },
          },
          {
            kind: 'token',
            range: { start: { line: 0, column: 6 }, end: { line: 0, column: 8 } },
          },
        ],
      },
    })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    const gutterWidth = (editor as any)._gutterWidth()
    const foldLaneWidth = (editor as any)._foldLaneWidth()

    editor.onDoubleClick({
      x: gutterWidth + foldLaneWidth + 8 * 7,
      y: 8,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(editor.controller.selection).toEqual({
      start: { line: 0, column: 6 },
      end: { line: 0, column: 8 },
    })

    editor.dispose()
  })

  it('does not request a language range when double clicking line-end whitespace', async () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const getSelectionRanges = vi.fn(() => [{
      kind: 'line',
      range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
    }])
    const editor = new RenderCodeEditor({
      value: 'alpha',
      lineHeight: 16,
      fontSize: 12,
      languageAdapter: { getSelectionRanges },
    })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    const textX = (editor as any)._gutterWidth() + (editor as any)._foldLaneWidth()

    editor.onDoubleClick({ x: textX + 8 * 7, y: 8 })
    await Promise.resolve()

    expect(getSelectionRanges).not.toHaveBeenCalled()
    expect(editor.controller.hasSelection).toBe(false)

    editor.dispose()
  })

  it('routes right click through the code editor context menu request', async () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    let request: CodeEditorContextMenuRequest | undefined
    const editor = new RenderCodeEditor({
      value: '错误规则',
      lineHeight: 16,
      fontSize: 12,
      languageAdapter: {
        getCodeActions: (_source, diagnostic) => diagnostic
          ? [{
              title: '修复错误',
              kind: 'quickfix',
              diagnostics: [diagnostic],
              edits: [],
            }]
          : [],
      },
      onContextMenuRequest: next => {
        request = next
      },
    })
    editor.setDiagnostics([{
      range: { start: { line: 0, column: 0 }, end: { line: 0, column: 2 } },
      severity: 'error',
      message: '错误',
    }])
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    const gutterWidth = (editor as any)._gutterWidth()
    const foldLaneWidth = (editor as any)._foldLaneWidth()

    expect(editor.onContextMenu({
      x: gutterWidth + foldLaneWidth + 8,
      y: 8,
    })).toBe(true)
    await Promise.resolve()
    await Promise.resolve()

    expect(request?.textPosition).toEqual({ line: 0, column: 1 })
    expect(request?.diagnostic?.message).toBe('错误')
    expect(request?.codeActions).toHaveLength(1)

    editor.dispose()
  })

  it('does not invoke the context menu callback for an older code action request', async () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const resolvers: Array<(value: []) => void> = []
    const onContextMenuRequest = vi.fn()
    const editor = new RenderCodeEditor({
      value: 'alpha beta',
      lineHeight: 16,
      fontSize: 12,
      languageAdapter: {
        getCodeActions: () => new Promise<[]>(resolve => resolvers.push(resolve)),
      },
      onContextMenuRequest,
    })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    const textX = (editor as any)._gutterWidth() + (editor as any)._foldLaneWidth()

    editor.onContextMenu({ x: textX + 8, y: 8 })
    editor.onContextMenu({ x: textX + 8 * 7, y: 8 })
    resolvers[1]!([])
    await Promise.resolve()
    await Promise.resolve()
    resolvers[0]!([])
    await Promise.resolve()
    await Promise.resolve()

    expect(onContextMenuRequest).toHaveBeenCalledTimes(1)
    expect(onContextMenuRequest).toHaveBeenCalledWith(expect.objectContaining({
      textPosition: { line: 0, column: 7 },
    }))

    editor.dispose()
  })

  it('treats diagnostic and selection range ends as exclusive', async () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const onContextMenuRequest = vi.fn()
    const editor = new RenderCodeEditor({
      value: 'alpha',
      lineHeight: 16,
      fontSize: 12,
      onContextMenuRequest,
    })
    editor.setDiagnostics([{
      range: { start: { line: 0, column: 0 }, end: { line: 0, column: 2 } },
      message: 'first two characters',
    }])
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setSelection({ line: 0, column: 0 }, { line: 0, column: 2 })
    const textX = (editor as any)._gutterWidth() + (editor as any)._foldLaneWidth()

    editor.onContextMenu({ x: textX + 8 * 2, y: 8 })
    await Promise.resolve()
    await Promise.resolve()

    expect(onContextMenuRequest).toHaveBeenCalledWith(expect.objectContaining({
      textPosition: { line: 0, column: 2 },
      diagnostic: undefined,
    }))
    expect(editor.controller.hasSelection).toBe(false)
    expect(editor.controller.cursor).toEqual({ line: 0, column: 2 })

    editor.dispose()
  })

  it('keeps the current selection when opening context menu inside it', async () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    let request: CodeEditorContextMenuRequest | undefined
    const editor = new RenderCodeEditor({
      value: '如果 患者.年龄 小于 18',
      lineHeight: 16,
      fontSize: 12,
      onContextMenuRequest: next => {
        request = next
      },
    })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setSelection({ line: 0, column: 3 }, { line: 0, column: 8 })
    const gutterWidth = (editor as any)._gutterWidth()
    const foldLaneWidth = (editor as any)._foldLaneWidth()

    expect(editor.onContextMenu({
      x: gutterWidth + foldLaneWidth + 8 * 6,
      y: 8,
    })).toBe(true)
    await Promise.resolve()
    await Promise.resolve()

    expect(request?.textPosition).toEqual({ line: 0, column: 6 })
    expect(editor.controller.selection).toEqual({
      start: { line: 0, column: 3 },
      end: { line: 0, column: 8 },
    })

    editor.dispose()
  })

  it('moves the cursor when opening context menu outside the current selection', async () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const editor = new RenderCodeEditor({
      value: '如果 患者.年龄 小于 18',
      lineHeight: 16,
      fontSize: 12,
      onContextMenuRequest: () => {},
    })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setSelection({ line: 0, column: 3 }, { line: 0, column: 8 })
    const gutterWidth = (editor as any)._gutterWidth()
    const foldLaneWidth = (editor as any)._foldLaneWidth()

    expect(editor.onContextMenu({
      x: gutterWidth + foldLaneWidth + 8 * 11,
      y: 8,
    })).toBe(true)
    await Promise.resolve()

    expect(editor.controller.hasSelection).toBe(false)
    expect(editor.controller.cursor).toEqual({ line: 0, column: 11 })

    editor.dispose()
  })
})


describe('RenderCodeEditor inline suggestions', () => {
  function inlineEditor(options: ConstructorParameters<typeof RenderCodeEditor>[0] = {}) {
    const editor = new RenderCodeEditor({
      value: 'SU', inlineSuggestions: true,
      languageAdapter: { getCompletions: () => [{ label: 'SUM' }, { label: 'SUMIF' }] },
      ...options,
    })
    editor.layout(constraints, false, { theme: ImGuiDarkTheme })
    editor.controller.setCursor({ line: 0, column: editor.value.length })
    editor.focusIn()
    return editor
  }

  it('paints the selected suffix in placeholder color without editing text, selection or history', async () => {
    const editor = inlineEditor()
    const selection = editor.controller.selection
    await editor.triggerCompletion()
    expect(editor.inlineSuggestionText).toBe('M')
    expect(editor.value).toBe('SU')
    expect(editor.controller.selection).toEqual(selection)
    expect(editor.controller.canUndo).toBe(false)
    const ctx = mockCanvasContext()
    const context = new PaintContext(ctx, ImGuiDarkTheme)
    const caret = editor.positionToGlobalRect(editor.controller.cursor, context)!
    const fill = vi.spyOn(DrawList.prototype, 'fillText')
    editor.paint(context, { x: 0, y: 0 })
    expect(fill).toHaveBeenCalledWith('M', caret.x, caret.y + caret.height / 2,
      ImGuiDarkTheme.textPlaceholder, expect.any(Number), expect.any(String), 'left', 'middle')
    expect(ctx.fillText).toHaveBeenCalledWith('M', Math.round(caret.x), Math.round(caret.y + caret.height / 2))
    editor.moveCompletionSelection(1)
    expect(editor.inlineSuggestionText).toBe('MIF')
    inputElement().dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(editor.value).toBe('SUMIF')
    expect(editor.inlineSuggestionText).toBeNull()
    expect(editor.controller.undo()).toBe(true)
    expect(editor.value).toBe('SU')
    expect(editor.controller.redo()).toBe(true)
    expect(editor.value).toBe('SUMIF')
    editor.dispose()
  })

  it('is opt-in and does not preview replacements or multiline candidates', async () => {
    for (const options of [
      { inlineSuggestions: false },
      { value: 'su' },
      { value: 'SU)', at: 2, languageAdapter: { getCompletions: () => [{ label: 'SUM', range: { start: { line: 0, column: 0 }, end: { line: 0, column: 3 } } }] } },
      { languageAdapter: { getCompletions: () => [{ label: 'SUM', insertText: 'SUM\nnext' }] } },
    ]) {
      const editor = inlineEditor(options)
      if ('at' in options) editor.controller.setCursor({ line: 0, column: options.at! })
      await editor.triggerCompletion()
      expect(editor.inlineSuggestionText).toBeNull()
      editor.dispose()
    }
  })

  it('displaces a middle-line suffix and maps clicks back without changing or accepting source', async () => {
    const editor = inlineEditor({ value: 'SU)+tail', folding: false })
    editor.controller.setCursor({ line: 0, column: 2 })
    const source = editor.value, selection = editor.controller.selection
    const originalEnd = editor.positionToGlobalRect({ line: 0, column: 8 })!
    await editor.triggerCompletion()
    expect(editor.inlineSuggestionText).toBe('M')
    const displacedEnd = editor.positionToGlobalRect({ line: 0, column: 8 })!
    const previewWidth = TextMeasurer.measureWidth('M', ImGuiDarkTheme.fontSize, (editor as any)._fontFamily())
    expect(displacedEnd.x - originalEnd.x).toBeCloseTo(previewWidth)
    const caret = editor.positionToGlobalRect({ line: 0, column: 2 })!
    expect(editor.globalPointToPosition({ x: caret.x + previewWidth / 2, y: caret.y + 2 })).toEqual({ line: 0, column: 2 })
    expect(editor.globalPointToPosition({ x: displacedEnd.x, y: displacedEnd.y + 2 })).toEqual({ line: 0, column: 8 })
    const draw = vi.spyOn(DrawList.prototype, 'fillText')
    const clips = vi.spyOn(DrawList.prototype, 'pushClip')
    editor.paint(new PaintContext(mockCanvasContext(), ImGuiDarkTheme), { x: 0, y: 0 })
    expect(draw).toHaveBeenCalledWith('M', caret.x, caret.y + caret.height / 2,
      ImGuiDarkTheme.textPlaceholder, expect.any(Number), expect.any(String), 'left', 'middle')
    expect(clips).toHaveBeenCalledWith(caret.x + previewWidth, 0,
      expect.any(Number), caret.height)
    expect(editor.value).toBe(source);expect(editor.controller.selection).toEqual(selection)
    expect(editor.controller.canUndo).toBe(false)
    editor.onPointerDown({ position: { x: displacedEnd.x, y: displacedEnd.y + 2 }, button: 0 } as any)
    expect(editor.controller.cursor).toEqual({ line: 0, column: 8 })
    expect(editor.inlineSuggestionText).toBeNull()
    expect(editor.value).toBe(source)
    editor.controller.setCursor({ line: 0, column: 2 })
    await editor.triggerCompletion()
    inputElement().dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(editor.value).toBe('SUM)+tail')
    expect(editor.controller.undo()).toBe(true);expect(editor.value).toBe(source)
    expect(editor.controller.redo()).toBe(true);expect(editor.value).toBe('SUM)+tail')
    editor.dispose()
  })

  it('clears on Escape, focus loss, selection and IME composition without accepting the hint', async () => {
    const editor = inlineEditor()
    await editor.triggerCompletion()
    inputElement().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(editor.inlineSuggestionText).toBeNull()
    expect(editor.value).toBe('SU')
    await editor.triggerCompletion()
    editor.focusOut()
    expect(editor.inlineSuggestionText).toBeNull()
    editor.focusIn()
    expect(editor.inlineSuggestionText).toBeNull()
    await editor.triggerCompletion()
    editor.controller.setSelection({ line: 0, column: 0 }, { line: 0, column: 2 })
    expect(editor.inlineSuggestionText).toBeNull()
    editor.controller.setCursor({ line: 0, column: 2 })
    await editor.triggerCompletion()
    inputElement().dispatchEvent(new CompositionEvent('compositionstart'))
    expect(editor.inlineSuggestionText).toBeNull()
    expect(editor.completionVisible).toBe(false)
    expect(editor.value).toBe('SU')
    editor.dispose()
  })

  it.each(['cursor', 'focus', 'readonly', 'context', 'escape', 'dispose'] as const)('rejects delayed completion after %s invalidation', async reason => {
    let resolve!: (items: CodeEditorCompletionItem[]) => void
    const editor = inlineEditor({ languageAdapter: { getCompletions: () => new Promise(done => { resolve = done }) } })
    const pending = editor.triggerCompletion()
    if (reason === 'cursor') editor.controller.setCursor({ line: 0, column: 1 })
    if (reason === 'focus') editor.focusOut()
    if (reason === 'readonly') { editor.readonly = true; editor.readonly = false }
    if (reason === 'context') editor.setLanguageContext({ revision: 2 })
    if (reason === 'escape') inputElement().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    if (reason === 'dispose') editor.dispose()
    resolve([{ label: 'SUM' }]);await pending
    expect(editor.inlineSuggestionText).toBeNull()
    expect(editor.completionVisible).toBe(false)
    expect(editor.value).toBe('SU')
    if (reason !== 'dispose') editor.dispose()
  })
})


describe('CodeEditor live inlay hints', () => {
  it('displays multiple annotations while source, selection and history stay independent', async () => {
    const editor = new RenderCodeEditor({ value: '#a + #b\n#c', folding: false,
      languageAdapter: { getInlayHints: () => [
        { position: {line:0,column:2}, label:'患者姓名' },
        { position: {line:0,column:7}, label:'年龄' },
        { position: {line:1,column:2}, label:'性别' },
      ] },
    })
    editor.layout(constraints, false, {theme:ImGuiDarkTheme});editor.focusIn()
    await editor.refreshInlayHints()
    expect(editor.inlayHints).toHaveLength(3)
    const text=editor.value,ctx=new PaintContext(mockCanvasContext(),ImGuiDarkTheme)
    const first=editor.positionToGlobalRect({line:0,column:2})!, next=editor.positionToGlobalRect({line:0,column:3})!
    expect(next.x-first.x).toBeGreaterThan(40)
    expect(editor.globalPointToPosition({x:first.x+10,y:first.y+5})).toEqual({line:0,column:2})
    expect(editor.globalPointToPosition({x:next.x,y:next.y+5})).toEqual({line:0,column:3})
    editor.controller.setCursor({line:0,column:7})
    const caret=(editor as any)._caretGeometry()
    expect(caret.x).toBeCloseTo(editor.positionToGlobalRect(editor.controller.cursor)!.x)
    const draw=vi.spyOn(DrawList.prototype,'fillText')
    editor.paint(ctx,{x:0,y:0})
    expect(draw).toHaveBeenCalledWith(' 〈患者姓名〉 ',expect.any(Number),expect.any(Number),ImGuiDarkTheme.textPlaceholder,expect.any(Number),expect.any(String),'left','middle')
    editor.controller.selectAll();expect(editor.getCopyText()).toBe(text)
    expect(editor.value).toBe(text);expect(editor.controller.canUndo).toBe(false)
    editor.dispose()
  })

  it('refreshes immediately on text, Undo, Redo and context changes without a preview command', async () => {
    const editor = new RenderCodeEditor<{name:string}>({ value:'#a', languageContext:{name:'患者姓名'},
      languageAdapter:{ getInlayHints:(source,context)=>source==='#a'?[{position:{line:0,column:2},label:context!.name}]:[] },
    })
    await vi.waitFor(()=>expect(editor.inlayHints[0]?.label).toBe('患者姓名'))
    editor.controller.setCursor({line:0,column:2});editor.controller.insertText('x')
    expect(editor.inlayHints).toEqual([])
    await Promise.resolve();expect(editor.inlayHints).toEqual([])
    editor.controller.undo();await vi.waitFor(()=>expect(editor.inlayHints).toHaveLength(1))
    editor.controller.redo();await vi.waitFor(()=>expect(editor.inlayHints).toEqual([]))
    editor.controller.undo();editor.setLanguageContext({name:'病人姓名'})
    await vi.waitFor(()=>expect(editor.inlayHints[0]?.label).toBe('病人姓名'))
    editor.dispose()
  })

  it.each(['source','context','clear','detach','hide','dispose'] as const)('rejects a late result after %s changes', async reason => {
    const pending: Array<(items: any[])=>void> = []
    const editor = new RenderCodeEditor({value:'#a',languageAdapter:{getInlayHints:()=>new Promise(resolve=>pending.push(resolve))}})
    const resolve=pending.at(-1)!
    if(reason==='source')editor.value='#b'
    if(reason==='context')editor.setLanguageContext({version:2})
    if(reason==='clear')editor.clearInlayHints()
    if(reason==='detach')editor.detach()
    if(reason==='hide')editor.visible=false
    if(reason==='dispose')editor.dispose()
    resolve([{position:{line:0,column:2},label:'旧名称'}]);await Promise.resolve();await Promise.resolve()
    expect(editor.inlayHints).toEqual([])
    if(reason!=='dispose')editor.dispose()
  })

  it('coexists with completion without accepting or copying annotation text', async () => {
    const editor=new RenderCodeEditor({value:'SU + #a',inlineSuggestions:true,languageAdapter:{
      getInlayHints:source=>[{position:{line:0,column:source.length},label:'患者姓名'}],
      getCompletions:()=>[{label:'SUM',range:{start:{line:0,column:0},end:{line:0,column:2}}}],
    }})
    editor.layout(constraints,false,{theme:ImGuiDarkTheme});editor.focusIn();editor.controller.setCursor({line:0,column:2})
    await editor.refreshInlayHints();await editor.triggerCompletion()
    expect(editor.inlineSuggestionText).toBe('M');expect(editor.inlayHints).toHaveLength(1)
    editor.acceptSelectedCompletion();expect(editor.value).toBe('SUM + #a')
    await vi.waitFor(()=>expect(editor.inlayHints[0]?.position.column).toBe(8))
    editor.controller.selectAll();expect(editor.getCopyText()).toBe('SUM + #a')
    editor.dispose()
  })
})
