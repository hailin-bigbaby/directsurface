// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { InputComposer } from '../core/input_composer'
import { PopupManager } from '../core/popup_manager'
import { ImGuiLightTheme } from '../theme/default_theme'
import { deriveModalStyle } from '../theme/component_styles'
import { colorToCSS } from '../theme/theme'
import { PaintContext } from '../rendering/paint_context'
import { DrawList } from '../rendering/draw_list'
import { RenderPromptModal } from './prompt_modal'
import * as icons from './icon'

function setPopupTestContext(theme = ImGuiLightTheme, viewport = { width: 800, height: 600, dpr: 1 }): void {
  PopupManager.instance.setContextProvider(() => ({ theme, viewport }))
}

function createRecordingPaintContext(theme = ImGuiLightTheme): {
  context: PaintContext
  fillStyles: string[]
  textStyles: string[]
} {
  const fillStyles: string[] = []
  const textStyles: string[] = []
  let fillStyle: unknown = ''
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(() => {
      if (typeof fillStyle === 'string' && fillStyle) fillStyles.push(fillStyle)
    }),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(() => {
      if (typeof fillStyle === 'string' && fillStyle) fillStyles.push(fillStyle)
    }),
    stroke: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillText: vi.fn(() => {
      if (typeof fillStyle === 'string' && fillStyle) textStyles.push(fillStyle)
    }),
    measureText: vi.fn(() => ({ width: 10 })),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    set fillStyle(value: unknown) { fillStyle = value },
    get fillStyle() { return fillStyle as string },
  } as unknown as CanvasRenderingContext2D
  return { context: new PaintContext(ctx, theme), fillStyles, textStyles }
}

describe('RenderPromptModal', () => {
  afterEach(() => {
    PopupManager.disposeInstance()
    InputComposer.disposeInstance()
    vi.restoreAllMocks()
  })

  it('registers with PopupManager and starts an input session on show', () => {
    const modal = new RenderPromptModal({
      title: 'Prompt',
      content: 'Name',
      value: 'Alice',
    })
    setPopupTestContext()

    modal.show()

    expect(modal.visible).toBe(true)
    expect(PopupManager.instance.stack).toContain(modal)
    expect(InputComposer.instance.hasSession).toBe(true)
    expect(InputComposer.instance.value).toBe('Alice')

    modal.dispose()
  })

  it('requests popup repaint when the prompt input caret blinks', () => {
    vi.useFakeTimers()
    const modal = new RenderPromptModal({
      title: 'Prompt',
      content: 'Name',
      value: 'Alice',
    })
    setPopupTestContext()
    const requestPaintSpy = vi.spyOn(PopupManager.instance, 'requestPaint')

    modal.show()
    requestPaintSpy.mockClear()

    vi.advanceTimersByTime(530)

    expect(requestPaintSpy).toHaveBeenCalled()

    modal.dispose()
    vi.useRealTimers()
  })

  it('paints the prompt input caret through transient paint while focused', () => {
    vi.useFakeTimers()
    const modal = new RenderPromptModal({
      title: 'Prompt',
      content: 'Name',
      value: 'Alice',
    })
    setPopupTestContext()
    const painted = createRecordingPaintContext()

    try {
      modal.show()
      DrawList.setProfiling(true)
      DrawList.resetStats()
      modal.paint(painted.context, { x: 0, y: 0 })
      const visibleLineCount = DrawList.getStats().line

      vi.advanceTimersByTime(530)
      DrawList.resetStats()
      modal.paint(painted.context, { x: 0, y: 0 })
      const hiddenLineCount = DrawList.getStats().line

      expect(hiddenLineCount).toBeLessThan(visibleLineCount)
    } finally {
      DrawList.setProfiling(false)
      modal.dispose()
      vi.useRealTimers()
    }
  })

  it('returns the edited value when confirmed', () => {
    let closed: { key: string | null; value: string } | null = null
    const modal = new RenderPromptModal({
      title: 'Prompt',
      content: 'Name',
      value: 'Alice',
      onClose: (key, value) => { closed = { key, value } },
    })
    setPopupTestContext()

    modal.show()
    const input = document.getElementById('__ds_ui_input__') as HTMLTextAreaElement
    input.value = 'Bob'
    input.dispatchEvent(new Event('input'))

    const handled = modal.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))

    expect(handled).toBe(true)
    expect(closed).toEqual({ key: 'ok', value: 'Bob' })
    expect(modal.visible).toBe(false)

    modal.dispose()
  })

  it('consumes Tab while open', () => {
    const modal = new RenderPromptModal({
      title: 'Prompt',
      content: 'Name',
    })
    setPopupTestContext()
    const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })

    modal.show()
    const handled = modal.onKeyDown(event)

    expect(handled).toBe(true)
    expect(event.defaultPrevented).toBe(true)

    modal.dispose()
  })

  it('paints the title bar with active modal chrome colors', () => {
    const modal = new RenderPromptModal({
      title: 'Prompt',
      content: 'Name',
      visible: true,
    })
    const painted = createRecordingPaintContext()
    setPopupTestContext()

    modal.paint(painted.context, { x: 0, y: 0 })

    const style = deriveModalStyle(ImGuiLightTheme)
    expect(painted.fillStyles).toContain(colorToCSS(style.titleBg))
    expect(painted.textStyles).toContain(colorToCSS(style.titleText))

    modal.dispose()
  })

  it('paints the panel shadow from shared modal elevation tokens', () => {
    const modal = new RenderPromptModal({
      title: 'Prompt',
      content: 'Name',
      visible: true,
    })
    const shadowSpy = vi.spyOn(DrawList.prototype, 'outerShadow')
    setPopupTestContext()

    modal.paint(createRecordingPaintContext().context, { x: 0, y: 0 })

    const style = deriveModalStyle(ImGuiLightTheme)
    const call = shadowSpy.mock.calls.at(-1)
    expect(call?.[4]).toBe(style.shadowBlur)
    expect(call?.[5]).toEqual(style.shadowColor)
    expect(call?.[6]).toBe(style.borderRadius)
    expect(call?.[7]).toBe(style.shadowOffsetX)
    expect(call?.[8]).toBe(style.shadowOffsetY)

    modal.dispose()
  })
})

it('shows the info icon in Prompt by default', () => {
  const glyph = vi.spyOn(icons, 'paintIconGlyph').mockImplementation(() => {})
  const prompt = new RenderPromptModal({ title: 'Name', content: 'Enter a name', visible: true })
  setPopupTestContext()
  prompt.paint(createRecordingPaintContext().context)
  expect(glyph.mock.calls.some(([, options]) => options.name === 'info-filled')).toBe(true)
  prompt.dispose()
  glyph.mockRestore()
})

it('can explicitly hide the default Prompt icon', () => {
  const glyph = vi.spyOn(icons, 'paintIconGlyph').mockImplementation(() => {})
  const prompt = new RenderPromptModal({ title: 'Name', content: 'Name', intent: null, visible: true })
  setPopupTestContext()
  prompt.paint(createRecordingPaintContext().context)
  expect(glyph.mock.calls.some(([, options]) => options.name === 'info-filled')).toBe(false)
  prompt.dispose()
  glyph.mockRestore()
})
