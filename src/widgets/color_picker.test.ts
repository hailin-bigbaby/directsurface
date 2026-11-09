import { afterEach, describe, expect, it, vi } from 'vitest'
import { PipelineOwner, type BoxConstraints } from '../core/render_object'
import { PaintContext } from '../rendering/paint_context'
import { FocusManager, type Focusable } from '../core/focus_manager'
import { TextMeasurer } from '../core/text_measurer'
import { KeyboardBindingController } from '../core/keyboard_binding_controller'
import { PopupManager } from '../core/popup_manager'
import { GET_POPUP_ANCHOR_RECT } from '../core/popup_anchor'
import { ImGuiDarkTheme, ImGuiLightTheme } from '../theme/default_theme'
import { deriveColorPickerStyle, deriveTextInputStyle, resolveBgColor } from '../theme/component_styles'
import { colorToCSS } from '../theme/theme'
import { ColorPickerPopup, RenderColorPicker } from './color_picker'

const constraints: BoxConstraints = {
  minWidth: 0,
  maxWidth: 180,
  minHeight: 0,
  maxHeight: 40,
}

function createRecordingPaintContext(theme = ImGuiDarkTheme): { context: PaintContext; fillStyles: string[]; strokeStyles: string[] } {
  const fillStyles: string[] = []
  const strokeStyles: string[] = []
  let fillStyle: unknown = ''
  let strokeStyle: unknown = ''
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(() => {
      if (typeof fillStyle === 'string' && fillStyle) fillStyles.push(fillStyle)
    }),
    stroke: vi.fn(() => {
      if (typeof strokeStyle === 'string' && strokeStyle) strokeStyles.push(strokeStyle)
    }),
    fillRect: vi.fn(() => {
      if (typeof fillStyle === 'string' && fillStyle) fillStyles.push(fillStyle)
    }),
    strokeRect: vi.fn(() => {
      if (typeof strokeStyle === 'string' && strokeStyle) strokeStyles.push(strokeStyle)
    }),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    set fillStyle(value: unknown) { fillStyle = value },
    get fillStyle() { return fillStyle as string },
    set strokeStyle(value: unknown) { strokeStyle = value },
    get strokeStyle() { return strokeStyle as string },
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D
  return { context: new PaintContext(ctx, theme), fillStyles, strokeStyles }
}

function paintColorPicker(picker: RenderColorPicker, theme = ImGuiDarkTheme): { fillStyles: string[]; strokeStyles: string[] } {
  const painted = createRecordingPaintContext(theme)
  picker.performPaint(painted.context, { x: 0, y: 0 })
  return painted
}

function paintColorPickerPopup(popup: ColorPickerPopup, theme = ImGuiDarkTheme): { fillStyles: string[]; strokeStyles: string[] } {
  const painted = createRecordingPaintContext(theme)
  popup.paint(painted.context)
  return painted
}

function setPopupTestContext(theme = ImGuiDarkTheme, viewport = { width: 320, height: 240, dpr: 1 }): void {
  PopupManager.instance.setContextProvider(() => ({ theme, viewport }))
}

function focusable(): Focusable {
  let focused = false
  return {
    focusIn: vi.fn(() => { focused = true }),
    focusOut: vi.fn(() => { focused = false }),
    get isFocused() { return focused },
  }
}

function staticAnchor(x: number, y: number, w: number, h: number) {
  return {
    [GET_POPUP_ANCHOR_RECT]: () => ({ x, y, width: w, height: h }),
  }
}

afterEach(() => {
  KeyboardBindingController.disposeInstance()
  PopupManager.instance.dispose()
  FocusManager.disposeInstance()
  vi.restoreAllMocks()
})

describe('ColorPickerPopup lifecycle', () => {
  it('keeps the popup open when confirmation is rejected', () => {
    const popup = new ColorPickerPopup()
    const onConfirm = vi.fn(() => false)
    popup.open({
      color: { r: 255, g: 0, b: 0, a: 1 },
      anchor: staticAnchor(10, 10, 40, 24),
      onConfirm,
      onCancel: vi.fn(),
      onClose: vi.fn(),
    })

    expect(popup.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))).toBe(true)
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(popup.visible).toBe(true)
  })

  it('supports opt-in Tab confirmation and navigation without changing the default mode', () => {
    const popup = new ColorPickerPopup()
    const onTab = vi.fn()
    popup.open({
      color: { r: 255, g: 0, b: 0, a: 1 },
      anchor: staticAnchor(10, 10, 40, 24),
      onConfirm: vi.fn(() => true),
      onCancel: vi.fn(),
      onTab,
      onClose: vi.fn(),
    })

    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true })
    expect(popup.onKeyDown(event)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(onTab).toHaveBeenCalledWith(-1)
    expect(popup.visible).toBe(false)
  })

  it('keeps a clearable popup open when clearing is rejected', () => {
    const popup = new ColorPickerPopup()
    const onClear = vi.fn(() => false)
    popup.open({
      color: { r: 255, g: 0, b: 0, a: 1 },
      anchor: staticAnchor(10, 10, 40, 24),
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
      clearable: true,
      onClear,
      onClose: vi.fn(),
    })

    expect((popup as any)._clear()).toBe(false)
    expect(onClear).toHaveBeenCalledOnce()
    expect(popup.visible).toBe(true)
  })

  it('unbinds keyboard routing and clears PopupManager on dispose', () => {
    const popup = new ColorPickerPopup()
    const onCancel = vi.fn()

    popup.open({
      color: { r: 255, g: 0, b: 0, a: 1 },
      anchor: staticAnchor(10, 10, 40, 24),
      onConfirm: vi.fn(),
      onCancel,
      onClose: vi.fn(),
    })

    expect(popup.visible).toBe(true)
    expect(PopupManager.instance.current).toBe(popup)

    popup.dispose()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(onCancel).not.toHaveBeenCalled()
  })

  it('cancels through the popup manager outside-click route', () => {
    const popup = new ColorPickerPopup()
    const onCancel = vi.fn()

    popup.open({
      color: { r: 255, g: 0, b: 0, a: 1 },
      anchor: staticAnchor(10, 10, 40, 24),
      onConfirm: vi.fn(),
      onCancel,
      onClose: vi.fn(),
    })

    expect(PopupManager.instance.handlePointerDown({
      pointerId: 0,
      position: { x: 490, y: 390 },
      type: 'down',
    })).toBe(false)

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(popup.visible).toBe(false)
    expect(PopupManager.instance.current).toBe(null)
  })

  it('consumes trigger clicks as toggle-close when the popup is already open', () => {
    const popup = new ColorPickerPopup()
    const onCancel = vi.fn()

    popup.open({
      color: { r: 255, g: 0, b: 0, a: 1 },
      anchor: staticAnchor(10, 10, 40, 24),
      onConfirm: vi.fn(),
      onCancel,
      onClose: vi.fn(),
    })

    const consumed = PopupManager.instance.handlePointerDown({
      pointerId: 0,
      position: { x: 20, y: 20 },
      type: 'down',
    })

    expect(consumed).toBe(true)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(popup.visible).toBe(false)
    expect(PopupManager.instance.current).toBe(null)
  })

  it('restores previous focus when closed', () => {
    const previous = focusable()
    FocusManager.instance.register(previous)
    FocusManager.instance.setFocus(previous)
    const popup = new ColorPickerPopup()

    popup.open({
      color: { r: 255, g: 0, b: 0, a: 1 },
      anchor: staticAnchor(10, 10, 40, 24),
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
      onClose: vi.fn(),
    })

    expect(FocusManager.instance.current).toBe(previous)
    expect(previous.isFocused).toBe(true)

    popup.close()

    expect(FocusManager.instance.current).toBe(previous)
    expect(previous.isFocused).toBe(true)
  })

  it('uses popup context changes on the next paint while open', () => {
    const popup = new ColorPickerPopup()

    popup.open({
      color: { r: 255, g: 0, b: 0, a: 1 },
      anchor: staticAnchor(10, 10, 40, 24),
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
      onClose: vi.fn(),
    })
    setPopupTestContext(ImGuiLightTheme)

    const painted = paintColorPickerPopup(popup, ImGuiLightTheme)

    expect(painted.fillStyles.length).toBeGreaterThan(0)
  })

  it('sizes popup width to the color controls without trailing empty space', () => {
    const popup = new ColorPickerPopup()
    setPopupTestContext(ImGuiLightTheme)
    popup.open({
      color: { r: 255, g: 0, b: 0, a: 1 },
      anchor: staticAnchor(10, 10, 40, 24),
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
      onClose: vi.fn(),
    })

    const style = deriveColorPickerStyle(ImGuiLightTheme)
    const rect = (popup as any)._popupRect(PopupManager.instance.context)
    const hexRect = (popup as any)._hexRect(PopupManager.instance.context)

    expect(rect.w).toBe(style.svSize + style.padding * 2)
    expect(hexRect.x + hexRect.w).toBe(rect.x + rect.w - style.padding)

    popup.dispose()
  })

  it('clamps hue drag at the bar edges', () => {
    const popup = new ColorPickerPopup()
    setPopupTestContext(ImGuiLightTheme)
    popup.open({
      color: { r: 255, g: 0, b: 0, a: 1 },
      anchor: staticAnchor(10, 10, 40, 24),
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
      onClose: vi.fn(),
    })

    const layout = (popup as any)._layout(PopupManager.instance.context)
    ;(popup as any)._dragging = 'hue'
    ;(popup as any)._applyDrag({
      x: layout.svX + layout.style.svSize * 3,
      y: layout.hueY + layout.style.barHeight / 2,
    }, PopupManager.instance.context)
    expect((popup as any)._hsv.h).toBe(360)

    ;(popup as any)._applyDrag({
      x: layout.svX - layout.style.svSize,
      y: layout.hueY + layout.style.barHeight / 2,
    }, PopupManager.instance.context)
    expect((popup as any)._hsv.h).toBe(0)

    popup.dispose()
  })

  it('treats pointer leave as hover cleanup without aborting drag state', () => {
    const popup = new ColorPickerPopup()

    popup.open({
      color: { r: 255, g: 0, b: 0, a: 1 },
      anchor: staticAnchor(10, 10, 40, 24),
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
      onClose: vi.fn(),
    })

    ;(popup as any)._hoveredBtn = 'ok'
    ;(popup as any)._dragging = 'sv'
    ;(popup as any)._handleSurfaceHoverExit({
      pointerId: 1,
      position: { x: 0, y: 0 },
      type: 'move',
    })

    expect((popup as any)._hoveredBtn).toBe(null)
    expect((popup as any)._dragging).toBe('sv')
  })

  it('treats pointer cancel as a real drag abort', () => {
    const popup = new ColorPickerPopup()

    popup.open({
      color: { r: 255, g: 0, b: 0, a: 1 },
      anchor: staticAnchor(10, 10, 40, 24),
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
      onClose: vi.fn(),
    })

    ;(popup as any)._hoveredBtn = 'ok'
    ;(popup as any)._dragging = 'sv'
    ;(popup as any)._handleSurfaceSequenceCancel({
      pointerId: 1,
      position: { x: 0, y: 0 },
      type: 'cancel',
    })

    expect((popup as any)._hoveredBtn).toBe(null)
    expect((popup as any)._dragging).toBe(null)
  })

  it('cycles keyboard focus zones with Tab and nudges channel values with arrows', () => {
    const popup = new ColorPickerPopup()

    popup.open({
      color: { r: 255, g: 0, b: 0, a: 1 },
      anchor: staticAnchor(10, 10, 40, 24),
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
      onClose: vi.fn(),
    })

    expect(popup.debugState().focusZone).toBe('sv')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    expect(popup.debugState().color.g).toBeGreaterThan(0)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    expect(popup.debugState().focusZone).toBe('hue')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    expect(popup.debugState().focusZone).toBe('alpha')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    expect(popup.debugState().focusZone).toBe('hex')

    popup.dispose()
  })

  it('edits the hex input from the keyboard and confirms on Enter', () => {
    const popup = new ColorPickerPopup()
    const onConfirm = vi.fn()

    popup.open({
      color: { r: 255, g: 0, b: 0, a: 1 },
      anchor: staticAnchor(10, 10, 40, 24),
      onConfirm,
      onCancel: vi.fn(),
      onClose: vi.fn(),
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))

    expect(popup.debugState().focusZone).toBe('hex')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }))
    expect(popup.debugState().hexValue.startsWith('#0F')).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm.mock.calls[0]![0].r).toBe(15)
    expect(popup.visible).toBe(false)
  })

  it('cancels keyboard edits on Escape', () => {
    const popup = new ColorPickerPopup()
    const onCancel = vi.fn()
    const onConfirm = vi.fn()

    popup.open({
      color: { r: 255, g: 0, b: 0, a: 1 },
      anchor: staticAnchor(10, 10, 40, 24),
      onConfirm,
      onCancel,
      onClose: vi.fn(),
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(popup.visible).toBe(false)
  })
})

describe('RenderColorPicker contexts', () => {
  it('implements the value editor contract across popup confirmation and logical blur', () => {
    setPopupTestContext(ImGuiLightTheme)
    const onChange = vi.fn()
    const valueChange = vi.fn()
    const blur = vi.fn()
    const picker = new RenderColorPicker({
      color: { r: 255, g: 0, b: 0, a: 1 },
      onChange,
    })
    picker.layout(constraints, false, { theme: ImGuiLightTheme })
    picker.subscribeValueChange(valueChange)
    picker.subscribeBlur(blur)

    picker.setValue({ r: 0, g: 0, b: 255, a: 1 })

    expect(picker.getValue()).toEqual({ r: 0, g: 0, b: 255, a: 1 })
    expect(onChange).not.toHaveBeenCalled()
    expect(valueChange).not.toHaveBeenCalled()

    picker.requestFocus()
    picker.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))
    const popup = (picker as any)._popup
    popup._hsv = { h: 120, s: 1, v: 1, a: 0.5 }
    popup._confirm()

    expect(picker.getValue()).toEqual({ r: 0, g: 255, b: 0, a: 0.5 })
    expect(onChange).toHaveBeenCalledOnce()
    expect(valueChange).toHaveBeenCalledWith({
      value: { r: 0, g: 255, b: 0, a: 0.5 },
      previousValue: { r: 0, g: 0, b: 255, a: 1 },
      reason: 'confirm',
      detail: undefined,
    })
    expect(blur).not.toHaveBeenCalled()

    picker.blur()
    picker.blur()

    expect(blur).toHaveBeenCalledOnce()
    picker.dispose()
  })

  it('keeps legacy confirmation while suppressing unchanged formal value events', () => {
    setPopupTestContext(ImGuiLightTheme)
    const onChange = vi.fn()
    const valueChange = vi.fn()
    const picker = new RenderColorPicker({
      color: { r: 255, g: 0, b: 0, a: 1 },
      onChange,
    })
    picker.layout(constraints, false, { theme: ImGuiLightTheme })
    picker.subscribeValueChange(valueChange)

    picker.requestFocus()
    picker.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))
    const popup = (picker as any)._popup
    popup._confirm()

    expect(onChange).toHaveBeenCalledOnce()
    expect(valueChange).not.toHaveBeenCalled()
    expect(picker.getValue()).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(popup.visible).toBe(false)
    expect(picker.isFocused).toBe(true)

    picker.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))
    popup._hsv = { h: 120, s: 1, v: 1, a: 1 }
    popup._confirm()

    expect(onChange).toHaveBeenCalledTimes(2)
    expect(valueChange).toHaveBeenCalledOnce()
    expect(valueChange).toHaveBeenCalledWith({
      value: { r: 0, g: 255, b: 0, a: 1 },
      previousValue: { r: 255, g: 0, b: 0, a: 1 },
      reason: 'confirm',
      detail: undefined,
    })
    picker.dispose()
  })

  it.each(['disabled', 'readonly'] as const)(
    'publishes one logical blur when an open color picker becomes %s',
    state => {
      setPopupTestContext(ImGuiLightTheme)
      const blur = vi.fn()
      const picker = new RenderColorPicker({})
      picker.layout(constraints, false, { theme: ImGuiLightTheme })
      picker.subscribeBlur(blur)

      picker.requestFocus()
      picker.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))
      expect((picker as any)._popup.visible).toBe(true)

      picker[state] = true
      picker[state] = true

      expect(picker.isFocused).toBe(false)
      expect((picker as any)._popup.visible).toBe(false)
      expect(blur).toHaveBeenCalledOnce()
      picker.dispose()
    },
  )

  it('measures label width with TextMeasurer during trigger layout', () => {
    const picker = new RenderColorPicker({
      label: '强调色',
    })
    const inputStyle = deriveTextInputStyle(ImGuiDarkTheme)
    const measureWidth = vi.spyOn(TextMeasurer, 'measureWidth').mockReturnValue(88)

    picker.layout(constraints, false, { theme: ImGuiDarkTheme })

    expect(measureWidth).toHaveBeenCalledWith('强调色', inputStyle.fontSize, inputStyle.fontFamily)
    expect(measureWidth).toHaveBeenCalledWith('#6495EDFF', inputStyle.fontSize, inputStyle.fontFamily)
    expect(picker.size.width).toBe(constraints.maxWidth)
  })

  it('re-derives trigger metrics from the pipeline theme context', () => {
    const owner = new PipelineOwner({}, ImGuiDarkTheme)
    const picker = new RenderColorPicker({
      label: 'Accent',
    })

    picker.attach(owner)
    picker.layout({ ...constraints, maxWidth: Infinity })
    const before = { ...picker.size }

    const nextTheme = { ...ImGuiLightTheme, fontSize: ImGuiLightTheme.fontSize + 2, itemSpacing: ImGuiLightTheme.itemSpacing + 2 }
    owner.setTheme(nextTheme)
    picker.markNeedsLayout()
    owner.flushLayout()

    expect(picker.size.height).toBe(deriveTextInputStyle(nextTheme).height)
    expect(picker.size.width).toBeGreaterThan(before.width)

    picker.dispose()
  })

  it('closes its owned popup when detached', () => {
    const picker = new RenderColorPicker({})
    const popup = (picker as any)._popup as ColorPickerPopup

    picker.layout({ minWidth: 0, maxWidth: 120, minHeight: 0, maxHeight: 24 })
    picker.onPointerDown({ pointerId: 1, position: { x: 10, y: 10 }, type: 'down' })

    expect(popup.visible).toBe(true)
    expect(PopupManager.instance.current).toBe(popup)

    picker.detach()

    expect(popup.visible).toBe(false)
    expect(PopupManager.instance.current).toBe(null)
  })

  it('recomputes trigger size when relaid out with a new theme context', () => {
    const picker = new RenderColorPicker({
      label: 'Accent',
    })

    picker.layout({ ...constraints, maxWidth: Infinity }, false, { theme: ImGuiDarkTheme })
    const before = { ...picker.size }

    picker.layout({ ...constraints, maxWidth: Infinity }, false, { theme: { ...ImGuiLightTheme, itemSpacing: ImGuiLightTheme.itemSpacing + 2 } })

    expect(picker.size.width).toBeGreaterThan(before.width)
  })

  it('uses token-derived focused shell colors when open', () => {
    const picker = new RenderColorPicker({
      label: 'Accent',
    })
    const inputStyle = deriveTextInputStyle(ImGuiLightTheme)
    picker.layout(constraints, false, { theme: ImGuiLightTheme })
    picker.onPointerDown({ pointerId: 1, position: { x: 10, y: 10 }, type: 'down' })

    const painted = paintColorPicker(picker, ImGuiLightTheme)

    expect(painted.fillStyles[0]).toBe(colorToCSS(resolveBgColor(inputStyle.inputBg, 'focused')))
    expect(painted.strokeStyles[0]).toBe(colorToCSS(resolveBgColor(inputStyle.inputBorder, 'focused')))
    picker.dispose()
  })

  it('uses helper text and status in the trigger shell contract', () => {
    const picker = new RenderColorPicker({
      label: 'Accent',
      status: 'error',
      helperText: 'Required',
      prefixText: '#',
      suffixText: 'RGBA',
    })
    const inputStyle = deriveTextInputStyle(ImGuiDarkTheme)

    picker.layout(constraints, false, { theme: ImGuiDarkTheme })

    expect(picker.size.height).toBe(inputStyle.height + inputStyle.helperGap + inputStyle.helperLineHeight)

    const painted = createRecordingPaintContext(ImGuiDarkTheme)
    picker.performPaint(painted.context, { x: 0, y: 0 })

    expect((painted.context.ctx as any).fillText).toHaveBeenCalledWith('Required', expect.any(Number), expect.any(Number))
    picker.dispose()
  })

  it('shows empty and mixed states without presenting the candidate color as a stored value', () => {
    const picker = new RenderColorPicker({ color: { r: 47, g: 111, b: 237, a: 1 }, valueState: 'empty' })
    for (const [state, text] of [['empty', '无颜色'], ['mixed', '混合颜色（未修改）']] as const) {
      picker.valueState = state
      picker.layout({ ...constraints, maxWidth: 300 }, false, { theme: ImGuiLightTheme })
      const painted = createRecordingPaintContext(ImGuiLightTheme)
      picker.performPaint(painted.context, { x: 0, y: 0 })
      expect((painted.context.ctx as any).fillText).toHaveBeenCalledWith(text, expect.any(Number), expect.any(Number))
      expect(painted.fillStyles).not.toContain('rgba(47,111,237,1)')
    }
    picker.dispose()
  })

  it('renders the selected hex value in the form field value area', () => {
    const picker = new RenderColorPicker({
      label: 'Accent',
      color: { r: 47, g: 111, b: 237, a: 0.5 },
    })

    picker.layout(constraints, false, { theme: ImGuiLightTheme })

    const painted = createRecordingPaintContext(ImGuiLightTheme)
    picker.performPaint(painted.context, { x: 0, y: 0 })

    expect((painted.context.ctx as any).fillText).toHaveBeenCalledWith('#2F6FED80', expect.any(Number), expect.any(Number))
    expect(painted.fillStyles).toContain('rgba(47,111,237,0.5)')

    picker.dispose()
  })

  it('keeps the swatch visible and ellipsizes hex text in a fixed narrow width', () => {
    const picker = new RenderColorPicker({
      color: { r: 47, g: 111, b: 237, a: 0.5 },
    })

    picker.layout({ minWidth: 96, maxWidth: 96, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiLightTheme })

    expect(picker.size.width).toBe(96)

    const painted = createRecordingPaintContext(ImGuiLightTheme)
    picker.performPaint(painted.context, { x: 0, y: 0 })
    const textCalls = ((painted.context.ctx as any).fillText as any).mock.calls as unknown[][]
    const valueText = textCalls.map(call => call[0]).find(value => typeof value === 'string' && value.startsWith('#'))

    expect(valueText).toContain('...')
    expect(painted.fillStyles).toContain('rgba(47,111,237,0.5)')

    picker.dispose()
  })

  it('does not open while readonly and closes an open popup when readonly is set', () => {
    const picker = new RenderColorPicker({
      label: 'Accent',
    })
    setPopupTestContext(ImGuiLightTheme)
    picker.layout(constraints, false, { theme: ImGuiLightTheme })

    picker.onPointerDown({ pointerId: 1, position: { x: 10, y: 10 }, type: 'down' })
    expect((picker as any)._popup.visible).toBe(true)

    picker.readonly = true
    expect((picker as any)._popup.visible).toBe(false)

    picker.onPointerDown({ pointerId: 1, position: { x: 10, y: 10 }, type: 'down' })
    expect((picker as any)._popup.visible).toBe(false)
    expect(picker.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false)

    picker.dispose()
  })

  it('keeps readonly color pickers out of the focus order', () => {
    const picker = new RenderColorPicker({
      label: 'Accent',
      readonly: true,
    })

    picker.layout(constraints, false, { theme: ImGuiLightTheme })
    picker.focusIn()

    expect(picker.isFocused).toBe(false)
    expect(FocusManager.instance.scopeStack[0]?.focusables.includes(picker)).toBe(false)

    picker.readonly = false
    expect(FocusManager.instance.scopeStack[0]?.focusables.includes(picker)).toBe(true)

    FocusManager.instance.setFocus(picker)
    expect(picker.isFocused).toBe(true)

    picker.readonly = true

    expect(picker.isFocused).toBe(false)
    expect(FocusManager.instance.current).not.toBe(picker)
    expect(FocusManager.instance.scopeStack[0]?.focusables.includes(picker)).toBe(false)

    picker.dispose()
  })

  it('opens from keyboard activation and closes on Escape', () => {
    const picker = new RenderColorPicker({
      label: 'Accent',
    })
    setPopupTestContext(ImGuiLightTheme)
    picker.layout(constraints, false, { theme: ImGuiLightTheme })
    picker.focusIn()

    expect(picker.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(true)
    expect((picker as any)._popup.visible).toBe(true)
    expect(picker.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(true)
    expect((picker as any)._popup.visible).toBe(false)

    picker.dispose()
  })

  it('uses token-derived popup button backgrounds on hover', () => {
    const popup = new ColorPickerPopup()
    const style = deriveColorPickerStyle(ImGuiLightTheme)
    setPopupTestContext(ImGuiLightTheme)

    popup.open({
      color: { r: 255, g: 0, b: 0, a: 1 },
      anchor: staticAnchor(10, 10, 40, 24),
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
      onClose: vi.fn(),
    })
    ;(popup as any)._hoveredBtn = 'ok'

    let painted = paintColorPickerPopup(popup, ImGuiLightTheme)
    expect(painted.fillStyles).toContain(colorToCSS(resolveBgColor(style.confirmButtonBg, 'hovered')))

    ;(popup as any)._hoveredBtn = 'cancel'
    painted = paintColorPickerPopup(popup, ImGuiLightTheme)
    expect(painted.fillStyles).toContain(colorToCSS(resolveBgColor(style.cancelButtonBg, 'hovered')))

    popup.dispose()
  })
})
