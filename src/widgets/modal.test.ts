import { afterEach, describe, expect, it, vi } from 'vitest'
import { PopupManager } from '../core/popup_manager'
import { ImGuiLightTheme } from '../theme/default_theme'
import * as componentStyles from '../theme/component_styles'
import { colorToCSS, createTheme, rgba } from '../theme/theme'
import { DrawList } from '../rendering/draw_list'
import { PaintContext } from '../rendering/paint_context'
import { TextMeasurer } from '../core/text_measurer'
import { RenderModal } from './modal'
import * as icons from './icon'

function createPaintContext(theme = ImGuiLightTheme): PaintContext {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
  } as unknown as CanvasRenderingContext2D
  return new PaintContext(ctx, theme)
}

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
    rect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(() => {
      if (typeof fillStyle === 'string' && fillStyle) fillStyles.push(fillStyle)
    }),
    stroke: vi.fn(),
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

describe('RenderModal', () => {
  afterEach(() => {
    PopupManager.disposeInstance()
    vi.restoreAllMocks()
  })

  it('implements Popup interface: close, onEscape, onKeyDown, onOutsidePointerDown, overlayLayer', () => {
    const modal = new RenderModal({
      title: 'Confirm',
      content: 'Proceed?',
    })

    expect(modal.overlayLayer).toBe('overlay')
    expect(typeof modal.close).toBe('function')
    expect(typeof modal.onEscape).toBe('function')
    expect(typeof modal.onKeyDown).toBe('function')
    expect(typeof modal.onOutsidePointerDown).toBe('function')

    modal.dispose()
  })

  it('registers with PopupManager on show and deregisters on hide', () => {
    const modal = new RenderModal({
      title: 'Confirm',
      content: 'Proceed?',
    })
    setPopupTestContext()

    expect(PopupManager.instance.hasOverlays).toBe(false)

    modal.show()
    expect(modal.visible).toBe(true)
    expect(PopupManager.instance.stack).toContain(modal)

    modal.hide()
    expect(modal.visible).toBe(false)
    expect(PopupManager.instance.stack).not.toContain(modal)

    modal.dispose()
  })

  it('closes all other popups when showing modal', () => {
    const modal = new RenderModal({
      title: 'Confirm',
      content: 'Proceed?',
    })
    setPopupTestContext()

    const otherPopup = {
      hitTest: () => true,
      close: vi.fn(),
    }
    PopupManager.instance.open(otherPopup)
    expect(PopupManager.instance.hasOverlays).toBe(true)

    modal.show()
    expect(PopupManager.instance.stack).toContain(modal)
    expect(PopupManager.instance.stack).not.toContain(otherPopup)

    modal.dispose()
  })

  it('onEscape closes the modal and returns true', () => {
    const modal = new RenderModal({
      title: 'Confirm',
      content: 'Proceed?',
    })
    setPopupTestContext()

    modal.show()
    expect(modal.visible).toBe(true)

    const result = modal.onEscape(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(result).toBe(true)
    expect(modal.visible).toBe(false)

    modal.dispose()
  })

  it('onKeyDown handles Enter for primary button', () => {
    let closedWith: string | null = null
    const modal = new RenderModal({
      title: 'Confirm',
      content: 'Proceed?',
      onClose: (key) => { closedWith = key },
    })
    setPopupTestContext()

    modal.show()
    const result = modal.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(result).toBe(true)
    expect(closedWith).toBe('ok')

    modal.dispose()
  })

  it('re-derives paint tokens from the current paint theme', () => {
    const modal = new RenderModal({
      title: 'Confirm',
      content: 'Proceed?',
      visible: true,
    })
    const deriveSpy = vi.spyOn(componentStyles, 'deriveModalStyle')

    setPopupTestContext()
    modal.paint(createPaintContext(), { x: 0, y: 0 })

    expect(deriveSpy).toHaveBeenCalledWith(ImGuiLightTheme)

    modal.dispose()
  })

  it('wraps long content within the modal body instead of painting one overflowing line', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => Array.from(String(text)).length * 8)
    const modal = new RenderModal({
      title: 'Confirm',
      content: 'ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ',
      modalWidth: 180,
      visible: true,
    })
    const context = createPaintContext()
    const ctx = context.ctx as unknown as { fillText: ReturnType<typeof vi.fn> }

    setPopupTestContext()
    modal.paint(context, { x: 0, y: 0 })

    const contentLines = ctx.fillText.mock.calls
      .map(call => String(call[0]))
      .filter(value => value !== 'Confirm' && value !== '取消' && value !== '确认')

    const style = componentStyles.deriveModalStyle(ImGuiLightTheme)
    const contentWidth = modal.modalWidth - style.padding * 2

    expect(contentLines.length).toBeGreaterThan(1)
    expect(contentLines.every(line => TextMeasurer.measureWidth(line, style.fontSize, style.fontFamily) <= contentWidth)).toBe(true)

    modal.dispose()
  })

  it('paints the title bar with active modal chrome colors', () => {
    const modal = new RenderModal({
      title: 'Confirm',
      content: 'Proceed?',
      visible: true,
    })
    const painted = createRecordingPaintContext()

    setPopupTestContext()
    modal.paint(painted.context, { x: 0, y: 0 })

    const style = componentStyles.deriveModalStyle(ImGuiLightTheme)
    expect(painted.fillStyles).toContain(colorToCSS(style.titleBg))
    expect(painted.textStyles).toContain(colorToCSS(style.titleText))

    modal.dispose()
  })

  it('paints the panel shadow from theme elevation tokens', () => {
    const shadowColor = rgba(12, 24, 48, 0.4)
    const theme = createTheme(ImGuiLightTheme, {
      elevation: {
        windowShadowColor: shadowColor,
        windowShadowBlur: 31,
        windowShadowOffsetX: 6,
        windowShadowOffsetY: 9,
      },
    })
    const modal = new RenderModal({
      title: 'Confirm',
      content: 'Proceed?',
      visible: true,
      modalHeight: 180,
    })
    const shadowSpy = vi.spyOn(DrawList.prototype, 'outerShadow')

    setPopupTestContext(theme)
    modal.paint(createPaintContext(theme), { x: 0, y: 0 })

    expect(shadowSpy).toHaveBeenCalledWith(
      220,
      210,
      360,
      180,
      31,
      shadowColor,
      theme.windowRounding,
      6,
      9,
    )

    modal.dispose()
  })

  it('requests overlay repaint when button press state changes', () => {
    const requestPaintSpy = vi.spyOn(PopupManager.instance, 'requestPaint')
    const modal = new RenderModal({
      title: 'Confirm',
      content: 'Proceed?',
      visible: true,
    })

    const viewport = { width: 800, height: 600, dpr: 1 }
    setPopupTestContext(ImGuiLightTheme, viewport)
    modal.paint(createPaintContext(), { x: 0, y: 0 })
    const style = componentStyles.deriveModalStyle(ImGuiLightTheme)
    const mx = (viewport.width - modal.modalWidth) / 2
    const layout = (modal as any)._resolveLayout({ theme: ImGuiLightTheme, viewport }, { x: 0, y: 0 }, 1)
    const my = layout.panelY
    const buttonY = layout.buttonY + style.buttonHeight / 2
    const okButtonX = mx + modal.modalWidth - style.padding - style.buttonMinWidth / 2
    requestPaintSpy.mockClear()

    modal.onPointerDown({ pointerId: 0, position: { x: okButtonX, y: buttonY }, type: 'down' })
    modal.onPointerUp({ pointerId: 0, position: { x: mx - 10, y: my - 10 }, type: 'up' })

    expect(requestPaintSpy).toHaveBeenCalledTimes(2)

    modal.dispose()
  })
})

for (const [intent, name] of [['info', 'info-filled'], ['warning', 'warning-filled'], ['success', 'check-circle-filled'], ['error', 'error-circle-filled']] as const) {
  it(`uses the existing ${intent} glyph and theme color`, () => {
    const glyph = vi.spyOn(icons, 'paintIconGlyph').mockImplementation(() => {})
    const modal = new RenderModal({ title: 'Confirm', content: 'Proceed?', intent, visible: true })
    setPopupTestContext()
    const context = createPaintContext()
    modal.paint(context)
    const style = componentStyles.deriveModalStyle(ImGuiLightTheme)
    expect(glyph).toHaveBeenCalledWith(context, expect.objectContaining({ name, size: style.titleIconSize, color: style.titleIconColors[intent] }))
    const icon = glyph.mock.calls[0]![1]
    const title = vi.mocked(context.ctx.fillText).mock.calls.find(call => call[0] === 'Confirm')!
    const layout = (modal as any)._resolveLayout(PopupManager.instance.context, { x: 0, y: 0 }, 1)
    expect(icon.x - layout.panelX).toBe(16)
    expect(title[1] - icon.x - icon.size).toBe(8)
    modal.dispose()
  })
}

it('starts reverse keyboard navigation at the last action', () => {
  const onClose = vi.fn()
  const modal = new RenderModal({ title: 'Confirm', content: 'Proceed?', visible: true, onClose,
    buttons: [{ key: 'cancel', label: 'Cancel' }, { key: 'later', label: 'Later' }, { key: 'ok', label: 'Submit', primary: true }] })
  setPopupTestContext()
  modal.onKeyDown(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }))
  modal.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
  expect(onClose).toHaveBeenCalledWith('ok')
  modal.dispose()
})

for (const intent of [undefined, null]) it(`defaults to info and supports explicit null (intent=${intent})`, () => {
  const glyph = vi.spyOn(icons, 'paintIconGlyph').mockImplementation(() => {})
  const modal = new RenderModal({ title: 'Confirm', content: 'Proceed?', intent, visible: true })
  setPopupTestContext()
  modal.paint(createPaintContext())
  expect(glyph.mock.calls.some(([, options]) => options.name === 'info-filled')).toBe(intent === undefined)
  modal.dispose()
  glyph.mockRestore()
})
