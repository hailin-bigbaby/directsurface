import { afterEach, describe, expect, it, vi } from 'vitest'
import { PipelineOwner, type BoxConstraints } from '../core/render_object'
import { PaintContext } from '../rendering/paint_context'
import { FocusManager, type Focusable } from '../core/focus_manager'
import { KeyboardBindingController } from '../core/keyboard_binding_controller'
import { PopupManager } from '../core/popup_manager'
import { GET_POPUP_ANCHOR_RECT } from '../core/popup_anchor'
import { TextMeasurer } from '../core/text_measurer'
import { ImGuiDarkTheme, ImGuiLightTheme } from '../theme/default_theme'
import { colorToCSS } from '../theme/theme'
import { deriveDatePickerStyle, deriveTextInputStyle, resolveBgColor } from '../theme/component_styles'
import { DatePickerPopup, RenderDatePicker } from './date_picker'
import { layoutFormFieldInlineContent } from './form_field_shell'

it('owner date-time segments receive numeric keys but confirmation-only mode retains the draft until OK', () => {
  const popup = new DatePickerPopup(), onSelect = vi.fn()
  popup.open({ anchor: { [GET_POPUP_ANCHOR_RECT]: () => ({ x: 10, y: 10, width: 120, height: 24 }) }, selected: { year: 2024, month: 2, day: 29 }, selectedTime: { hour: 9, minute: 30, second: 10 }, showTime: true,
    ownerInput: true, confirmOnEnter: false, onSelect, onClose: vi.fn() })
  const key = (value: string) => popup.onKeyDown(new KeyboardEvent('keydown', { key: value, cancelable: true }))
  expect(key('1')).toBe(false); expect(popup.ownsTextInput).toBe(false)
  const p = popup.debugState(), hour = p.segments.hour!
  popup.onPointerDown({ type: 'down', pointerId: 1, pointerType: 'mouse', position: { x: hour.x + hour.w / 2, y: hour.y + hour.h / 2 }, button: 0, buttons: 1 })
  expect(popup.ownsTextInput).toBe(true)
  for (const k of ['1', '5', 'ArrowRight', '4', '2', 'Enter']) expect(key(k)).toBe(true)
  expect(popup.debugState().selectedTime).toEqual({ hour: 15, minute: 42, second: 10 })
  expect(onSelect).not.toHaveBeenCalled(); expect(popup.visible).toBe(true)
  popup.onPointerDown({ type: 'down', pointerId: 1, pointerType: 'mouse', position: { x: p.panelX + p.padding + (p.panelW - p.padding * 2) / 2, y: p.panelY + p.panelH - p.footerHeight / 2 }, button: 0, buttons: 1 })
  expect(onSelect).toHaveBeenCalledOnce(); expect(onSelect).toHaveBeenCalledWith({ year: 2024, month: 2, day: 29 }, { hour: 15, minute: 42, second: 10 })
  expect(popup.visible).toBe(false); popup.dispose()
})

const constraints: BoxConstraints = {
  minWidth: 0,
  maxWidth: 220,
  minHeight: 0,
  maxHeight: 40,
}

function paintDatePickerShell(
  picker: RenderDatePicker,
  theme = ImGuiDarkTheme,
): { fillStyles: string[]; strokeStyles: string[] } {
  const fillStyles: string[] = []
  const strokeStyles: string[] = []
  let fillStyle = ''
  let strokeStyle = ''
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(() => {
      if (fillStyle) fillStyles.push(fillStyle)
    }),
    stroke: vi.fn(() => {
      if (strokeStyle) strokeStyles.push(strokeStyle)
    }),
    fillText: vi.fn(),
    strokeRect: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    set fillStyle(value: string) { fillStyle = value },
    get fillStyle() { return fillStyle },
    set strokeStyle(value: string) { strokeStyle = value },
    get strokeStyle() { return strokeStyle },
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D
  picker.performPaint(new PaintContext(ctx, theme), { x: 0, y: 0 })
  return { fillStyles, strokeStyles }
}

function paintDatePickerPopup(
  popup: DatePickerPopup,
  theme = ImGuiDarkTheme,
): { fillStyles: string[]; strokeStyles: string[] } {
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
    set fillStyle(value: unknown) { fillStyle = value },
    get fillStyle() { return fillStyle as string },
    set strokeStyle(value: unknown) { strokeStyle = value },
    get strokeStyle() { return strokeStyle as string },
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D
  popup.paint(new PaintContext(ctx, theme))
  return { fillStyles, strokeStyles }
}

function createTextRecordingPaintContext(theme = ImGuiDarkTheme): { context: PaintContext; fillText: ReturnType<typeof vi.fn> } {
  const fillText = vi.fn()
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText,
    measureText: vi.fn(text => ({ width: String(text).length * 8 }) as TextMetrics),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    set fillStyle(_value: unknown) {},
    get fillStyle() { return '' },
    set strokeStyle(_value: unknown) {},
    get strokeStyle() { return '' },
    lineWidth: 1,
    font: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'middle' as CanvasTextBaseline,
  } as unknown as CanvasRenderingContext2D
  return { context: new PaintContext(ctx, theme), fillText }
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
  FocusManager.instance.dispose()
  vi.restoreAllMocks()
})

describe('DatePickerPopup lifecycle', () => {
  it('keeps the popup open when opt-in Tab confirmation is rejected', () => {
    const popup = new DatePickerPopup()
    const onTab = vi.fn()
    popup.open({
      anchor: staticAnchor(10, 10, 120, 24),
      selected: { year: 2026, month: 4, day: 14 },
      onSelect: vi.fn(() => false),
      onTab,
      onClose: vi.fn(),
    })

    const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })
    expect(popup.onKeyDown(event)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(onTab).not.toHaveBeenCalled()
    expect(popup.visible).toBe(true)
  })

  it('supports clear rejection for clearable date popups', () => {
    const popup = new DatePickerPopup()
    const onClear = vi.fn(() => false)
    popup.open({
      anchor: staticAnchor(10, 10, 120, 24),
      selected: { year: 2026, month: 4, day: 14 },
      onSelect: vi.fn(),
      clearable: true,
      onClear,
      onClose: vi.fn(),
    })

    expect((popup as any)._clearAndClose()).toBe(false)
    expect(onClear).toHaveBeenCalledOnce()
    expect(popup.visible).toBe(true)
  })

  it('unbinds keyboard routing and clears PopupManager on dispose', () => {
    const popup = new DatePickerPopup()
    const onClose = vi.fn()

    popup.open({
      anchor: staticAnchor(10, 10, 120, 24),
      selected: { year: 2026, month: 4, day: 14 },
      onSelect: vi.fn(),
      onClose,
    })

    expect(popup.visible).toBe(true)
    expect(PopupManager.instance.current).toBe(popup)

    popup.dispose()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(popup.visible).toBe(false)
    expect(PopupManager.instance.current).toBe(null)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('restores previous focus when closed', () => {
    const previous = focusable()
    FocusManager.instance.register(previous)
    FocusManager.instance.setFocus(previous)
    const popup = new DatePickerPopup()

    popup.open({
      anchor: staticAnchor(10, 10, 120, 24),
      selected: { year: 2026, month: 4, day: 14 },
      onSelect: vi.fn(),
      onClose: vi.fn(),
    })

    expect(FocusManager.instance.current).toBe(previous)
    expect(previous.isFocused).toBe(true)

    popup.close()

    expect(FocusManager.instance.current).toBe(previous)
    expect(previous.isFocused).toBe(true)
  })

  it('recomputes panel layout when popup context changes', () => {
    const popup = new DatePickerPopup()

    popup.open({
      anchor: staticAnchor(10, 10, 120, 24),
      selected: { year: 2026, month: 4, day: 14 },
      onSelect: vi.fn(),
      onClose: vi.fn(),
    })
    const before = popup.debugState()

    setPopupTestContext({
      ...ImGuiLightTheme,
      fontSize: ImGuiLightTheme.fontSize + 2,
      controlHeight: ImGuiLightTheme.controlHeight + 4,
    })
    const after = popup.debugState()

    expect(after.panelW).toBeGreaterThan(before.panelW)
    expect(after.panelH).toBeGreaterThan(before.panelH)
  })

  it('uses token-derived nav and footer hover backgrounds in popup chrome', () => {
    const popup = new DatePickerPopup()
    const style = deriveDatePickerStyle(ImGuiDarkTheme)
    popup.open({
      anchor: staticAnchor(10, 10, 120, 24),
      selected: { year: 2026, month: 4, day: 14 },
      onSelect: vi.fn(),
      onClose: vi.fn(),
    })
    ;(popup as any)._hoveredBtn = 'prev'
    ;(popup as any)._hoveredFooter = 'today'

    const painted = paintDatePickerPopup(popup)
    const hoveredCss = colorToCSS(resolveBgColor(style.navBg, 'hovered'))

    expect(painted.fillStyles.filter(value => value === hoveredCss).length).toBeGreaterThanOrEqual(2)

    popup.dispose()
  })

  it('treats pointer leave as hover cleanup without requiring cancel', () => {
    const popup = new DatePickerPopup()

    popup.open({
      anchor: staticAnchor(10, 10, 120, 24),
      selected: { year: 2026, month: 4, day: 14 },
      onSelect: vi.fn(),
      onClose: vi.fn(),
    })

    ;(popup as any)._hoveredBtn = 'prev'
    ;(popup as any)._hoveredFooter = 'today'
    ;(popup as any)._hovered = { year: 2026, month: 4, day: 15 }
    ;(popup as any)._handleSurfaceHoverExit({
      pointerId: 1,
      position: { x: 0, y: 0 },
      type: 'move',
    })

    expect((popup as any)._hoveredBtn).toBe(null)
    expect((popup as any)._hoveredFooter).toBe(null)
    expect((popup as any)._hovered).toBe(null)
  })

  it('still treats pointer cancel as a real sequence abort', () => {
    const popup = new DatePickerPopup()

    popup.open({
      anchor: staticAnchor(10, 10, 120, 24),
      selected: { year: 2026, month: 4, day: 14 },
      onSelect: vi.fn(),
      onClose: vi.fn(),
    })

    ;(popup as any)._hoveredBtn = 'prev'
    ;(popup as any)._hoveredFooter = 'today'
    ;(popup as any)._hovered = { year: 2026, month: 4, day: 15 }
    ;(popup as any)._handleSurfaceSequenceCancel({
      pointerId: 1,
      position: { x: 0, y: 0 },
      type: 'cancel',
    })

    expect((popup as any)._hoveredBtn).toBe(null)
    expect((popup as any)._hoveredFooter).toBe(null)
    expect((popup as any)._hovered).toBe(null)
  })

  it('navigates the calendar with arrow keys and confirms through Enter', () => {
    const popup = new DatePickerPopup()
    const onSelect = vi.fn()

    popup.open({
      anchor: staticAnchor(10, 10, 120, 24),
      selected: { year: 2026, month: 4, day: 14 },
      onSelect,
      onClose: vi.fn(),
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))

    expect(onSelect).toHaveBeenCalledWith({ year: 2026, month: 4, day: 22 })
    expect(popup.visible).toBe(false)
    expect(PopupManager.instance.current).toBe(null)
  })

  it('returns minute-precision time when the popup time editor is enabled', () => {
    const popup = new DatePickerPopup()
    const onSelect = vi.fn()

    popup.open({
      anchor: staticAnchor(10, 10, 120, 24),
      selected: { year: 2026, month: 4, day: 14 },
      selectedTime: { hour: 9, minute: 8, second: 7 },
      showTime: true,
      timePrecision: 'minute',
      onSelect,
      onClose: vi.fn(),
    })

    const state = popup.debugState()
    expect(state.showTime).toBe(true)
    expect(state.timePrecision).toBe('minute')
    expect(state.selectedTime).toEqual({ hour: 9, minute: 8, second: 0 })

    ;(popup as any)._activateTimeSegment('hour')
    popup.onKeyDown(new KeyboardEvent('keydown', { key: '2', cancelable: true }))
    popup.onKeyDown(new KeyboardEvent('keydown', { key: '3', cancelable: true }))
    ;(popup as any)._activateTimeSegment('minute')
    popup.onKeyDown(new KeyboardEvent('keydown', { key: '4', cancelable: true }))
    popup.onKeyDown(new KeyboardEvent('keydown', { key: '5', cancelable: true }))
    expect(popup.debugState().activeTimeSegment).toBe('minute')
    ;(popup as any)._confirmAndClose()

    expect(onSelect).toHaveBeenCalledWith(
      { year: 2026, month: 4, day: 14 },
      { hour: 23, minute: 45, second: 0 },
    )
  })

  it('returns second-precision time and paints the seconds field', () => {
    const popup = new DatePickerPopup()
    const onSelect = vi.fn()

    popup.open({
      anchor: staticAnchor(10, 10, 120, 24),
      selected: { year: 2026, month: 4, day: 14 },
      selectedTime: { hour: 9, minute: 8, second: 7 },
      showTime: true,
      timePrecision: 'second',
      onSelect,
      onClose: vi.fn(),
    })

    const { context, fillText } = createTextRecordingPaintContext()
    popup.paint(context)

    expect(fillText.mock.calls.some(call => call[0] === '07')).toBe(true)

    ;(popup as any)._activateTimeSegment('second')
    popup.onKeyDown(new KeyboardEvent('keydown', { key: '5', cancelable: true }))
    popup.onKeyDown(new KeyboardEvent('keydown', { key: '9', cancelable: true }))
    ;(popup as any)._confirmAndClose()

    expect(onSelect).toHaveBeenCalledWith(
      { year: 2026, month: 4, day: 14 },
      { hour: 9, minute: 8, second: 59 },
    )
  })

  it('keeps popup time focus on the last segment after numeric completion', () => {
    const popup = new DatePickerPopup()
    const onSelect = vi.fn()

    popup.open({
      anchor: staticAnchor(10, 10, 120, 24),
      selected: { year: 2026, month: 4, day: 14 },
      selectedTime: { hour: 9, minute: 8, second: 7 },
      showTime: true,
      timePrecision: 'second',
      onSelect,
      onClose: vi.fn(),
    })

    ;(popup as any)._activateTimeSegment('second')
    popup.onKeyDown(new KeyboardEvent('keydown', { key: '5', cancelable: true }))
    popup.onKeyDown(new KeyboardEvent('keydown', { key: '9', cancelable: true }))

    expect(popup.debugState().activeTimeSegment).toBe('second')

    ;(popup as any)._confirmAndClose()
    expect(onSelect).toHaveBeenCalledWith(
      { year: 2026, month: 4, day: 14 },
      { hour: 9, minute: 8, second: 59 },
    )
  })

  it('does not automatically advance popup time segments after numeric completion', () => {
    const popup = new DatePickerPopup()

    popup.open({
      anchor: staticAnchor(10, 10, 120, 24),
      selected: { year: 2026, month: 4, day: 14 },
      selectedTime: { hour: 9, minute: 8, second: 7 },
      showTime: true,
      timePrecision: 'second',
      onSelect: vi.fn(),
      onClose: vi.fn(),
    })

    ;(popup as any)._activateTimeSegment('hour')
    popup.onKeyDown(new KeyboardEvent('keydown', { key: '1', cancelable: true }))
    popup.onKeyDown(new KeyboardEvent('keydown', { key: '4', cancelable: true }))

    expect(popup.debugState().activeTimeSegment).toBe('hour')

    popup.onKeyDown(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }))
    expect(popup.debugState().activeTimeSegment).toBe('minute')
    popup.onKeyDown(new KeyboardEvent('keydown', { key: '3', cancelable: true }))
    popup.onKeyDown(new KeyboardEvent('keydown', { key: '0', cancelable: true }))

    expect(popup.debugState().activeTimeSegment).toBe('minute')
  })

  it('edits popup year month and day before the time fields', () => {
    const popup = new DatePickerPopup()

    popup.open({
      anchor: staticAnchor(10, 10, 120, 24),
      selected: { year: 2026, month: 4, day: 14 },
      selectedTime: { hour: 9, minute: 8, second: 7 },
      showTime: true,
      timePrecision: 'second',
      onSelect: vi.fn(),
      onClose: vi.fn(),
    })

    ;(popup as any)._activateSegment('year')
    for (const key of ['2', '0', '2', '7']) {
      popup.onKeyDown(new KeyboardEvent('keydown', { key, cancelable: true }))
    }
    expect(popup.debugState().activeSegment).toBe('month')
    expect(popup.debugState().viewYear).toBe(2027)

    for (const key of ['1', '2']) {
      popup.onKeyDown(new KeyboardEvent('keydown', { key, cancelable: true }))
    }
    expect(popup.debugState().activeSegment).toBe('day')
    expect(popup.debugState().viewMonth).toBe(12)

    for (const key of ['3', '1']) {
      popup.onKeyDown(new KeyboardEvent('keydown', { key, cancelable: true }))
    }
    expect(popup.debugState().activeSegment).toBe('day')
    expect(popup.debugState().activeTimeSegment).toBeNull()
    expect(popup.debugState().selected).toEqual({ year: 2027, month: 12, day: 31 })
  })

  it('moves across month and year views with keyboard navigation and closes on Escape', () => {
    const popup = new DatePickerPopup()
    const onSelect = vi.fn()

    popup.open({
      anchor: staticAnchor(10, 10, 120, 24),
      selected: { year: 2026, month: 4, day: 14 },
      onSelect,
      onClose: vi.fn(),
    })
    ;(popup as any)._viewMode = 'month'

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(popup.debugState().viewMonth).toBe(5)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(popup.debugState().viewMode).toBe('day')

    ;(popup as any)._viewMode = 'year'
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    expect(popup.debugState().viewYear).toBe(2030)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onSelect).not.toHaveBeenCalled()
    expect(popup.visible).toBe(false)
  })

  it('closes on Tab without consuming focus movement', () => {
    const popup = new DatePickerPopup()

    popup.open({
      anchor: staticAnchor(0, 0, 160, 24),
      selected: { year: 2026, month: 4, day: 14 },
      onSelect: vi.fn(),
      onClose: vi.fn(),
    })

    expect(popup.onKeyDown(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }))).toBe(false)
    expect(popup.visible).toBe(false)
    expect(PopupManager.instance.current).toBe(null)
  })

  it('consumes trigger clicks as toggle-close when the popup is already open', () => {
    setPopupTestContext()
    const popup = new DatePickerPopup()

    popup.open({
      anchor: staticAnchor(0, 0, 160, 24),
      selected: { year: 2026, month: 4, day: 14 },
      onSelect: vi.fn(),
      onClose: vi.fn(),
    })

    const consumed = PopupManager.instance.handlePointerDown({
      pointerId: 0,
      position: { x: 12, y: 12 },
      type: 'down',
    })

    expect(consumed).toBe(true)
    expect(popup.visible).toBe(false)
  })
})

describe('RenderDatePicker contexts', () => {
  it('focuses through keyboard navigation without auto-opening the popup', () => {
    setPopupTestContext()
    const picker = new RenderDatePicker({
      value: '2026-04-14',
    })

    picker.layout(constraints, false, { theme: ImGuiDarkTheme })
    FocusManager.instance.setFocus(picker)

    expect(picker.isFocused).toBe(true)
    expect((picker as any)._popup.visible).toBe(false)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))

    expect((picker as any)._popup.visible).toBe(true)

    picker.dispose()
  })

  it('publishes committed segment values while keeping external setValue silent and pending-safe', () => {
    const onChange = vi.fn()
    const first = vi.fn()
    const second = vi.fn()
    const picker = new RenderDatePicker({
      value: '2026-04-14',
      onChange,
    })
    picker.subscribeValueChange(first)
    picker.subscribeValueChange(second)

    picker.setValue('2027-04-14')

    expect(picker.getValue()).toBe('2027-04-14')
    expect(onChange).not.toHaveBeenCalled()
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()

    picker.requestFocus()
    ;(picker as any)._activateSegment('year')
    picker.onKeyDown(new KeyboardEvent('keydown', { key: '2', cancelable: true }))
    picker.onKeyDown(new KeyboardEvent('keydown', { key: '0', cancelable: true }))

    picker.setValue('2027-04-14')
    expect(picker.commitEdit()).toBe(true)

    expect(picker.value).toBe('0020-04-14')
    expect(onChange).toHaveBeenCalledOnce()
    expect(first).toHaveBeenCalledWith({
      value: '0020-04-14',
      previousValue: '2027-04-14',
      reason: 'segment',
      detail: undefined,
    })
    expect(second).toHaveBeenCalledWith({
      value: '0020-04-14',
      previousValue: '2027-04-14',
      reason: 'segment',
      detail: undefined,
    })

    picker.onKeyDown(new KeyboardEvent('keydown', { key: '9', cancelable: true }))
    picker.setValue('2030-05-06')
    picker.cancelEdit()

    expect(picker.commitEdit()).toBe(true)
    expect(picker.value).toBe('2030-05-06')
    expect(onChange).toHaveBeenCalledOnce()
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()

    picker.dispose()
  })

  it('publishes blur once to every subscriber without changing date blur semantics', () => {
    const first = vi.fn()
    const second = vi.fn()
    const picker = new RenderDatePicker({ value: '2026-04-14' })
    picker.subscribeBlur(first)
    picker.subscribeBlur(second)

    picker.requestFocus()
    ;(picker as any)._activateSegment('month')
    picker.onKeyDown(new KeyboardEvent('keydown', { key: '1', cancelable: true }))
    picker.blur()
    picker.blur()

    expect(picker.value).toBe('2026-04-14')
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()

    picker.dispose()
  })

  it('keeps its calendar popup focused and closes it before public blur', () => {
    setPopupTestContext()
    const first = vi.fn()
    const second = vi.fn()
    const picker = new RenderDatePicker({ value: '2026-04-14' })
    picker.subscribeBlur(first)
    picker.subscribeBlur(second)
    picker.layout(constraints, false, { theme: ImGuiDarkTheme })

    picker.requestFocus()
    picker.onKeyDown(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      cancelable: true,
    }))

    expect((picker as any)._popup.visible).toBe(true)
    expect(picker.isFocused).toBe(true)
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()

    picker.blur()
    picker.blur()

    expect((picker as any)._popup.visible).toBe(false)
    expect(picker.isFocused).toBe(false)
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()

    picker.dispose()
  })

  it('clears pending segment input when a commit callback throws', () => {
    const error = new Error('date commit failed')
    const valueListener = vi.fn()
    const picker = new RenderDatePicker({
      value: '2026-04-14',
      onChange: () => { throw error },
    })
    picker.subscribeValueChange(valueListener)

    picker.requestFocus()
    ;(picker as any)._activateSegment('year')
    picker.onKeyDown(new KeyboardEvent('keydown', { key: '2', cancelable: true }))
    picker.onKeyDown(new KeyboardEvent('keydown', { key: '0', cancelable: true }))

    expect(() => picker.commitEdit()).toThrow(error)
    expect(picker.value).toBe('0020-04-14')
    expect(valueListener).toHaveBeenCalledOnce()
    expect(picker.commitEdit()).toBe(true)
    expect(valueListener).toHaveBeenCalledOnce()

    picker.dispose()
  })

  it('finishes keyboard segment transitions and repaint invalidation when a value callback throws', () => {
    const error = new Error('date keyboard change failed')
    const valueListener = vi.fn()
    const picker = new RenderDatePicker({
      value: '2026-04-14',
      onChange: () => { throw error },
    })
    picker.subscribeValueChange(valueListener)
    const markNeedsPaint = vi.spyOn(picker, 'markNeedsPaint')

    picker.requestFocus()
    ;(picker as any)._activateSegment('month')
    picker.onKeyDown(new KeyboardEvent('keydown', { key: '1', cancelable: true }))
    markNeedsPaint.mockClear()

    expect(() => picker.onKeyDown(
      new KeyboardEvent('keydown', { key: '2', cancelable: true }),
    )).toThrow(error)

    expect(picker.value).toBe('2026-12-14')
    expect((picker as any)._activeSegment).toBe('day')
    expect((picker as any)._inputBuffer).toBe('')
    expect(markNeedsPaint).toHaveBeenCalled()
    expect(valueListener).toHaveBeenCalledOnce()

    markNeedsPaint.mockClear()
    expect(() => picker.onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }),
    )).toThrow(error)

    expect(picker.value).toBe('2026-12-15')
    expect((picker as any)._activeSegment).toBe('day')
    expect((picker as any)._inputBuffer).toBe('')
    expect(markNeedsPaint).toHaveBeenCalled()
    expect(valueListener).toHaveBeenCalledTimes(2)

    picker.dispose()
  })

  it('closes the calendar popup when a selection callback throws', () => {
    setPopupTestContext()
    const error = new Error('date selection failed')
    const valueListener = vi.fn()
    const picker = new RenderDatePicker({
      value: '2026-04-14',
      onChange: () => { throw error },
    })
    picker.subscribeValueChange(valueListener)
    picker.layout(constraints, false, { theme: ImGuiDarkTheme })

    picker.requestFocus()
    picker.onKeyDown(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      cancelable: true,
    }))
    const popup = (picker as any)._popup as DatePickerPopup
    ;(popup as any)._selectDate({ year: 2026, month: 4, day: 15 })

    expect(() => (popup as any)._confirmAndClose()).toThrow(error)
    expect(picker.value).toBe('2026-04-15')
    expect(valueListener).toHaveBeenCalledOnce()
    expect(popup.visible).toBe(false)
    expect(picker.isFocused).toBe(true)

    picker.dispose()
  })

  it.each(['disabled', 'readonly'] as const)(
    'publishes one logical blur when an open calendar becomes %s',
    state => {
      setPopupTestContext()
      const blurListener = vi.fn()
      const picker = new RenderDatePicker({ value: '2026-04-14' })
      picker.subscribeBlur(blurListener)
      picker.layout(constraints, false, { theme: ImGuiDarkTheme })

      picker.requestFocus()
      picker.onKeyDown(new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        cancelable: true,
      }))
      expect((picker as any)._popup.visible).toBe(true)

      picker[state] = true
      picker[state] = true

      expect((picker as any)._popup.visible).toBe(false)
      expect(picker.isFocused).toBe(false)
      expect(blurListener).toHaveBeenCalledOnce()

      picker.dispose()
    },
  )

  it('re-derives shell height from the pipeline theme context', () => {
    const owner = new PipelineOwner({}, ImGuiDarkTheme)
    const picker = new RenderDatePicker({
      value: '2026-04-14',
    })

    picker.attach(owner)
    picker.layout(constraints)

    const nextTheme = {
      ...ImGuiLightTheme,
      fontSize: ImGuiLightTheme.fontSize + 2,
      controlHeight: ImGuiLightTheme.controlHeight + 4,
    }
    owner.setTheme(nextTheme)
    picker.markNeedsLayout()
    owner.flushLayout()

    expect(picker.size.height).toBe(deriveTextInputStyle(nextTheme).height)

    picker.dispose()
  })

  it('unbinds segment keyboard routing on dispose', () => {
    const onChange = vi.fn()
    const picker = new RenderDatePicker({
      value: '2026-04-14',
      onChange,
    })

    ;(picker as any)._activateSegment('year')
    FocusManager.instance.setFocus(picker)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))

    expect(onChange).toHaveBeenCalledWith('2027-04-14')

    picker.dispose()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('closes its owned popup when detached', () => {
    const picker = new RenderDatePicker({
      value: '2026-04-14',
    })
    const popup = (picker as any)._popup as DatePickerPopup

    picker.layout({ minWidth: 0, maxWidth: 140, minHeight: 0, maxHeight: 24 })
    ;(picker as any)._openPopup()

    expect(popup.visible).toBe(true)
    expect(PopupManager.instance.current).toBe(popup)

    picker.detach()

    expect(popup.visible).toBe(false)
    expect(PopupManager.instance.current).toBe(null)
  })

  it('recomputes shell height when relaid out with a new theme context', () => {
    const picker = new RenderDatePicker({
      value: '2026-04-14',
    })

    picker.layout(constraints, false, { theme: ImGuiDarkTheme })
    const beforeHeight = picker.size.height

    picker.layout(constraints, false, {
      theme: {
        ...ImGuiLightTheme,
        fontSize: ImGuiLightTheme.fontSize + 2,
        controlHeight: ImGuiLightTheme.controlHeight + 4,
      },
    })

    expect(picker.size.height).toBeGreaterThan(beforeHeight)
  })

  it('keeps disabled pickers closed and keeps popup anchors on the field shell', () => {
    const picker = new RenderDatePicker({
      value: '2026-04-14',
      disabled: true,
      helperText: '日期已锁定',
    })
    const style = deriveTextInputStyle(ImGuiDarkTheme)

    picker.layout(constraints, false, { theme: ImGuiDarkTheme })
    picker.onPointerDown({ pointerId: 1, position: { x: 10, y: 10 }, type: 'down' })

    expect(picker.size.height).toBe(style.height + style.helperGap + style.helperLineHeight)
    expect(picker[GET_POPUP_ANCHOR_RECT]().height).toBe(style.height)
    expect((picker as any)._popup.visible).toBe(false)

    picker.dispose()
  })

  it('keeps readonly pickers unfocused, closed, inactive, and non-clearable', () => {
    const onChange = vi.fn()
    const picker = new RenderDatePicker({
      value: '2026-04-14',
      readonly: true,
      clearable: true,
      onChange,
    })
    const style = deriveTextInputStyle(ImGuiDarkTheme)

    picker.layout(constraints, false, { theme: ImGuiDarkTheme })
    picker.focusIn()
    picker.onPointerMove({ pointerId: 1, position: { x: 10, y: 10 }, type: 'move' })
    picker.onPointerDown({ pointerId: 1, position: { x: 10, y: 10 }, type: 'down' })

    expect(picker.isFocused).toBe(false)
    expect((picker as any)._hovered).toBe(false)
    expect((picker as any)._activeSegment).toBe(null)
    expect((picker as any)._popup.visible).toBe(false)

    const clearLayout = layoutFormFieldInlineContent(style, { x: 0, y: 0 }, picker.size.width, style.height, {
      leadingIcon: 'calendar',
      showClearButton: true,
      reserveTrailingWidth: style.fontSize,
    })
    picker.onPointerDown({
      pointerId: 1,
      position: {
        x: clearLayout.clearRect!.x + clearLayout.clearRect!.w / 2,
        y: clearLayout.clearRect!.y + clearLayout.clearRect!.h / 2,
      },
      type: 'down',
    })

    expect(picker.value).toBe('2026-04-14')
    expect(picker.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false)
    expect(onChange).not.toHaveBeenCalled()

    picker.dispose()
  })

  it('closes popup and deactivates segment state when a picker becomes readonly', () => {
    setPopupTestContext()
    const picker = new RenderDatePicker({
      value: '2026-04-14',
    })

    picker.layout(constraints, false, { theme: ImGuiDarkTheme })
    ;(picker as any)._openPopup()

    expect((picker as any)._popup.visible).toBe(true)

    picker.readonly = true

    expect((picker as any)._popup.visible).toBe(false)
    expect(FocusManager.instance.current).not.toBe(picker)
    expect(picker.isFocused).toBe(false)

    picker.readonly = false
    FocusManager.instance.setFocus(picker)
    ;(picker as any)._activateSegment('year')

    expect(picker.isFocused).toBe(true)
    expect((picker as any)._activeSegment).toBe('year')

    picker.readonly = true

    expect((picker as any)._activeSegment).toBe(null)
    expect(FocusManager.instance.current).not.toBe(picker)
    expect(picker.isFocused).toBe(false)

    picker.dispose()
  })

  it('closes popup and deactivates segment state when a picker becomes disabled', () => {
    setPopupTestContext()
    const picker = new RenderDatePicker({
      value: '2026-04-14',
    })

    picker.layout(constraints, false, { theme: ImGuiDarkTheme })
    picker.onPointerMove({ pointerId: 1, position: { x: 10, y: 10 }, type: 'move' })
    ;(picker as any)._openPopup()

    expect((picker as any)._popup.visible).toBe(true)
    expect((picker as any)._hovered).toBe(true)

    picker.disabled = true

    expect((picker as any)._popup.visible).toBe(false)
    expect((picker as any)._hovered).toBe(false)
    expect(FocusManager.instance.current).not.toBe(picker)
    expect(picker.isFocused).toBe(false)
    expect(FocusManager.instance.scopeStack[0]?.focusables.includes(picker)).toBe(false)

    picker.disabled = false
    FocusManager.instance.setFocus(picker)
    ;(picker as any)._activateSegment('year')

    expect(picker.isFocused).toBe(true)
    expect((picker as any)._activeSegment).toBe('year')

    picker.disabled = true

    expect((picker as any)._activeSegment).toBe(null)
    expect(FocusManager.instance.current).not.toBe(picker)
    expect(picker.isFocused).toBe(false)

    picker.dispose()
  })

  it('clears through the shared trigger clear affordance', () => {
    const onChange = vi.fn()
    const picker = new RenderDatePicker({
      value: '2026-04-14',
      clearable: true,
      onChange,
    })
    const style = deriveTextInputStyle(ImGuiDarkTheme)

    picker.layout(constraints, false, { theme: ImGuiDarkTheme })
    const layout = layoutFormFieldInlineContent(style, { x: 0, y: 0 }, picker.size.width, style.height, {
      leadingIcon: 'calendar',
      showClearButton: true,
      reserveTrailingWidth: style.fontSize,
    })

    picker.onPointerDown({
      pointerId: 1,
      position: {
        x: layout.clearRect!.x + layout.clearRect!.w / 2,
        y: layout.clearRect!.y + layout.clearRect!.h / 2,
      },
      type: 'down',
    })

    expect(picker.value).toBe('')
    expect(onChange).toHaveBeenCalledWith('')

    picker.dispose()
  })

  it('treats trailing arrow clicks as popup toggles even when the field is narrow', () => {
    setPopupTestContext()
    const picker = new RenderDatePicker({
      value: '2026-04-14',
    })
    const style = deriveTextInputStyle(ImGuiDarkTheme)

    picker.layout({ minWidth: 0, maxWidth: 110, minHeight: 0, maxHeight: 24 }, false, { theme: ImGuiDarkTheme })
    const layout = layoutFormFieldInlineContent(style, { x: 0, y: 0 }, picker.size.width, style.height, {
      leadingIcon: 'calendar',
      reserveTrailingWidth: style.fontSize,
    })

    picker.onPointerDown({
      pointerId: 1,
      position: {
        x: layout.trailingRect!.x + layout.trailingRect!.w / 2,
        y: layout.trailingRect!.y + layout.trailingRect!.h / 2,
      },
      type: 'down',
    })

    expect((picker as any)._popup.visible).toBe(true)
    expect((picker as any)._activeSegment).toBe(null)

    picker.dispose()
  })

  it('renders prefix and suffix adornments through the shared trigger shell', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => String(text).length * 8)
    const picker = new RenderDatePicker({
      value: '2026-04-14',
      prefixText: 'Start',
      suffixText: 'UTC',
    })
    const painted = createTextRecordingPaintContext()

    picker.layout(constraints, false, { theme: ImGuiDarkTheme })
    picker.performPaint(painted.context, { x: 0, y: 0 })

    expect(painted.fillText.mock.calls.some(call => call[0] === 'Start')).toBe(true)
    expect(painted.fillText.mock.calls.some(call => call[0] === 'UTC')).toBe(true)

    picker.dispose()
  })

  it('paints selected date as one compact text run when no segment is active', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation((text) => {
      const value = String(text)
      if (value === '0') return 8
      if (value === '-') return 4
      if (value === ':') return 4
      if (value === ' ') return 4
      return value.length * 8
    })
    const picker = new RenderDatePicker({
      value: '2026-04-14',
    })
    const painted = createTextRecordingPaintContext()

    picker.layout(constraints, false, { theme: ImGuiDarkTheme })
    picker.performPaint(painted.context, { x: 0, y: 0 })

    const calls = painted.fillText.mock.calls

    expect(calls.some(call => call[0] === '2026-04-14')).toBe(true)
    expect(calls.some(call => call[0] === '2026')).toBe(false)
    expect(calls.some(call => call[0] === '-')).toBe(false)

    picker.dispose()
  })

  it('supports minute-precision date time values in the trigger field', () => {
    const onChange = vi.fn()
    const picker = new RenderDatePicker({
      value: '2026-04-14T09:08:07',
      showTime: true,
      timePrecision: 'minute',
      onChange,
    })
    const painted = createTextRecordingPaintContext()

    picker.layout({ minWidth: 0, maxWidth: 190, minHeight: 0, maxHeight: 40 }, false, { theme: ImGuiDarkTheme })
    picker.performPaint(painted.context, { x: 0, y: 0 })

    expect((picker as any)._displayValue()).toBe('2026-04-14 09:08')
    expect(painted.fillText.mock.calls.some(call => call[0] === '2026-04-14 09:08')).toBe(true)
    expect(painted.fillText.mock.calls.some(call => call[0] === '2026-04-14 09:08:07')).toBe(false)

    ;(picker as any)._activateSegment('minute')
    FocusManager.instance.setFocus(picker)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }))

    expect(picker.value).toBe('2026-04-14T09:30')
    expect(onChange).toHaveBeenLastCalledWith('2026-04-14T09:30')
    expect((picker as any)._activeSegment).toBe(null)

    picker.dispose()
  })

  it('keeps active date separators adjacent to numeric segments', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation((text) => {
      const value = String(text)
      if (value === '0') return 8
      if (value === '-') return 4
      if (value === ':') return 4
      if (value === ' ') return 4
      return value.length * 8
    })
    const picker = new RenderDatePicker({
      value: '2026-04-14',
    })
    const painted = createTextRecordingPaintContext()

    picker.layout(constraints, false, { theme: ImGuiDarkTheme })
    ;(picker as any)._activeSegment = 'month'
    picker.performPaint(painted.context, { x: 0, y: 0 })

    const calls = painted.fillText.mock.calls
    const yearCall = calls.find(call => call[0] === '2026')
    const firstDashCall = calls.find(call => call[0] === '-')

    expect(yearCall).toBeDefined()
    expect(firstDashCall).toBeDefined()
    expect(Number(firstDashCall?.[1])).toBe(Number(yearCall?.[1]) + 32)

    picker.dispose()
  })

  it('uses token-derived focused shell colors when a segment is active', () => {
    const picker = new RenderDatePicker({
      value: '2026-04-14',
    })
    const style = deriveTextInputStyle(ImGuiLightTheme)
    picker.layout(constraints, false, { theme: ImGuiLightTheme })
    ;(picker as any)._activeSegment = 'year'

    const painted = paintDatePickerShell(picker, ImGuiLightTheme)

    expect(painted.fillStyles[0]).toBe(colorToCSS(resolveBgColor(style.inputBg, 'focused')))
    expect(painted.strokeStyles[0]).toBe(colorToCSS(resolveBgColor(style.inputBorder, 'focused')))

    picker.dispose()
  })

  it('clips placeholder and segment text to the field value rect when width is constrained', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => String(text).length * 8)
    const rect = vi.fn()
    const fillText = vi.fn()
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      rect,
      clip: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      fillText,
      measureText: vi.fn(text => ({ width: String(text).length * 8 }) as TextMetrics),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      arc: vi.fn(),
      set fillStyle(_value: unknown) {},
      get fillStyle() { return '' },
      set strokeStyle(_value: unknown) {},
      get strokeStyle() { return '' },
      lineWidth: 1,
      font: '',
      textAlign: 'left' as CanvasTextAlign,
      textBaseline: 'middle' as CanvasTextBaseline,
    } as unknown as CanvasRenderingContext2D
    const picker = new RenderDatePicker({
      value: '',
      placeholder: '这是一个很长的截止日期占位文本',
    })
    const theme = ImGuiLightTheme
    picker.layout({
      minWidth: 0,
      maxWidth: 96,
      minHeight: 0,
      maxHeight: 40,
    }, false, { theme })

    picker.performPaint(new PaintContext(ctx, theme), { x: 0, y: 0 })

    const style = deriveTextInputStyle(theme)
    const layout = layoutFormFieldInlineContent(style, { x: 0, y: 0 }, picker.size.width, style.height, {
      leadingIcon: 'calendar',
      reserveTrailingWidth: style.fontSize,
    })

    expect(rect).toHaveBeenCalledWith(
      Math.round(layout.valueRect.x),
      2,
      Math.round(layout.valueRect.w),
      style.height - 4,
    )
    expect(fillText.mock.calls.some(call => String(call[0]).includes('...'))).toBe(true)

    picker.dispose()
  })

  it('tabs across date segments and deactivates on Enter or Escape', () => {
    const picker = new RenderDatePicker({
      value: '2026-04-14',
      onChange: vi.fn(),
    })

    ;(picker as any)._activateSegment('year')
    FocusManager.instance.setFocus(picker)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    expect((picker as any)._activeSegment).toBe('month')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    expect((picker as any)._activeSegment).toBe('day')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect((picker as any)._activeSegment).toBe(null)

    ;(picker as any)._activateSegment('month')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect((picker as any)._activeSegment).toBe(null)

    picker.dispose()
  })
})


it.each(['year', 'month', 'day'] as const)('host-owned %s calendar keeps source untouched on open and text keys, and requires explicit navigation before keyboard confirmation', precision => {
  setPopupTestContext(); const onSelect = vi.fn(), popup = new DatePickerPopup()
  popup.open({ anchor: staticAnchor(10, 10, 100, 20), selected: null, datePrecision: precision, ownerInput: true, onSelect, onClose: vi.fn() })
  expect(popup.debugState().viewMode).toBe(precision); expect(popup.debugState().selected).toBeNull()
  for (const key of ['2', 'Backspace', 'ArrowLeft', 'Enter']) expect(popup.onKeyDown(new KeyboardEvent('keydown', { key }))).toBe(false)
  expect(popup.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown', isComposing: true }))).toBe(false); expect(onSelect).not.toHaveBeenCalled()
  popup.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' })); popup.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))
  expect(onSelect).toHaveBeenCalledTimes(1); popup.dispose()
})

it.each([
  ['year', false, 'second', ['year']],
  ['month', false, 'second', ['year','month']],
  ['day', false, 'second', ['year','month','day']],
  ['day', true, 'minute', ['year','month','day','hour','minute']],
  ['day', true, 'second', ['year','month','day','hour','minute','second']],
] as const)('manual popup row follows %s / showTime=%s / %s without implicit source confirmation', (datePrecision,showTime,timePrecision,segments)=>{
  const popup=new DatePickerPopup(),onSelect=vi.fn()
  popup.open({anchor:staticAnchor(10,10,120,24),selected:{year:2024,month:2,day:29},datePrecision,showTime,timePrecision,confirmOnEnter:false,onSelect,onClose:vi.fn()})
  const state=popup.debugState();expect(Object.keys(state.segments)).toEqual([...segments])
  for(const r of Object.values(state.segments)) {expect(r.x).toBeGreaterThanOrEqual(state.panelX);expect(r.x+r.w).toBeLessThanOrEqual(state.panelX+state.panelW);expect(r.y+r.h).toBeLessThanOrEqual(state.panelY+state.panelH-state.footerHeight)}
  const year=state.segments.year!
  popup.onPointerDown({type:'down',pointerId:1,pointerType:'mouse',position:{x:year.x+year.w/2,y:year.y+year.h/2},button:0,buttons:1})
  for(const key of ['2','0','2','8','Enter'])popup.onKeyDown(new KeyboardEvent('keydown',{key,cancelable:true}))
  expect(popup.debugState().selected?.year).toBe(2028);expect(onSelect).not.toHaveBeenCalled();expect(popup.visible).toBe(true)
  const paint=createTextRecordingPaintContext();popup.paint(paint.context)
  expect(paint.fillText.mock.calls.some(call=>call[0]==='2028')).toBe(true)
  popup.close();expect(onSelect).not.toHaveBeenCalled();popup.dispose()
})

it('manual date row commits a partial segment before clicking another and keeps calendar limits',()=>{
  const popup=new DatePickerPopup(),onSelect=vi.fn()
  popup.open({anchor:staticAnchor(10,10,120,24),selected:{year:2024,month:1,day:31},showTime:false,confirmOnEnter:false,onSelect,onClose:vi.fn()})
  const select=(name:string)=>{const r=popup.debugState().segments[name]!;popup.onPointerDown({type:'down',pointerId:1,pointerType:'mouse',position:{x:r.x+r.w/2,y:r.y+r.h/2},button:0,buttons:1})}
  select('month');popup.onKeyDown(new KeyboardEvent('keydown',{key:'2',cancelable:true}));select('year')
  expect(popup.debugState().selected).toEqual({year:2024,month:2,day:29})
  for(const key of ['2','0','2','5'])popup.onKeyDown(new KeyboardEvent('keydown',{key,cancelable:true}))
  expect(popup.debugState().selected).toEqual({year:2025,month:2,day:28});expect(onSelect).not.toHaveBeenCalled()
  const state=popup.debugState();popup.onPointerDown({type:'down',pointerId:1,pointerType:'mouse',position:{x:state.panelX+state.panelW/2,y:state.panelY+state.panelH-state.footerHeight/2},button:0,buttons:1})
  expect(onSelect).toHaveBeenCalledOnce();expect(onSelect).toHaveBeenCalledWith({year:2025,month:2,day:28});popup.dispose()
})

it.each([false,true])('manual popup keyboard navigation and backspace work with ownerInput=%s',ownerInput=>{
 const popup=new DatePickerPopup(),onSelect=vi.fn()
 popup.open({anchor:staticAnchor(10,10,120,24),selected:{year:2024,month:2,day:29},ownerInput,confirmOnEnter:false,onSelect,onClose:vi.fn()})
 const r=popup.debugState().segments.year!;popup.onPointerDown({type:'down',pointerId:1,pointerType:'mouse',position:{x:r.x+r.w/2,y:r.y+r.h/2},button:0,buttons:1})
 const key=(key:string,shiftKey=false)=>popup.onKeyDown(new KeyboardEvent('keydown',{key,shiftKey,cancelable:true}))
 for(const k of ['2','0','Backspace','0','2','8'])key(k)
 expect(popup.debugState().selected?.year).toBe(2028);expect(popup.debugState().activeSegment).toBe('month')
 key('ArrowRight');expect(popup.debugState().activeSegment).toBe('day')
 key('Tab',true);expect(popup.debugState().activeSegment).toBe('month')
 key('ArrowLeft');expect(popup.debugState().activeSegment).toBe('year')
 key('Tab');expect(popup.debugState().activeSegment).toBe('month')
 key('Enter');expect(onSelect).not.toHaveBeenCalled();expect(popup.visible).toBe(true);popup.dispose()
})

it.each(['today','calendar'] as const)('manual popup %s choice discards unfinished date digits before confirmation',choice=>{
 const popup=new DatePickerPopup(),onSelect=vi.fn()
 popup.open({anchor:staticAnchor(10,10,120,24),selected:{year:2024,month:2,day:29},confirmOnEnter:false,onSelect,onClose:vi.fn()})
 const p=popup.debugState(),r=p.segments.year!
 const click=(x:number,y:number)=>popup.onPointerDown({type:'down',pointerId:1,pointerType:'mouse',position:{x,y},button:0,buttons:1})
 click(r.x+r.w/2,r.y+r.h/2);for(const key of ['1','9','9'])popup.onKeyDown(new KeyboardEvent('keydown',{key,cancelable:true}))
 if(choice==='today')click(p.panelX+p.padding+(p.panelW-p.padding*2)/6,p.panelY+p.panelH-p.footerHeight/2)
 else click(p.panelX+p.padding+p.cellSize*4.5,p.panelY+p.headerHeight+p.cellSize*1.5)
 const selected=popup.debugState().selected;expect(selected).toBeTruthy();expect(selected!.year).not.toBe(199)
 expect(popup.debugState().activeSegment).toBeNull();expect(onSelect).not.toHaveBeenCalled()
 click(p.panelX+p.panelW/2,p.panelY+p.panelH-p.footerHeight/2)
 expect(onSelect).toHaveBeenCalledOnce();expect(onSelect).toHaveBeenCalledWith(selected);popup.dispose()
})

it('manual popup reopen at year precision removes old time fields and pending buffers',()=>{
 const popup=new DatePickerPopup(),onSelect=vi.fn()
 popup.open({anchor:staticAnchor(10,10,120,24),selected:{year:2024,month:2,day:29},showTime:true,timePrecision:'second',onSelect,onClose:vi.fn()})
 const r=popup.debugState().segments.second!;popup.onPointerDown({type:'down',pointerId:1,pointerType:'mouse',position:{x:r.x+r.w/2,y:r.y+r.h/2},button:0,buttons:1})
 popup.onKeyDown(new KeyboardEvent('keydown',{key:'2',cancelable:true}));popup.close()
 popup.open({anchor:staticAnchor(10,10,120,24),selected:null,datePrecision:'year',ownerInput:true,onSelect,onClose:vi.fn()})
 expect(Object.keys(popup.debugState().segments)).toEqual(['year']);expect(popup.debugState().activeSegment).toBeNull();expect(popup.debugState().selected).toBeNull()
 expect(popup.onKeyDown(new KeyboardEvent('keydown',{key:'3',cancelable:true}))).toBe(false);expect(onSelect).not.toHaveBeenCalled();popup.dispose()
})

it.each([false, true])('manual popup repeated segment clicks preserve date and time buffers with ownerInput=%s', ownerInput => {
  const popup = new DatePickerPopup(), onSelect = vi.fn()
  popup.open({ anchor: staticAnchor(10, 10, 120, 24), selected: { year: 2024, month: 2, day: 29 },
    showTime: true, timePrecision: 'second', ownerInput, confirmOnEnter: false, onSelect, onClose: vi.fn() })
  const click = (name: string) => {
    const r = popup.debugState().segments[name]!
    popup.onPointerDown({ type: 'down', pointerId: 1, pointerType: 'mouse', position: { x: r.x + r.w / 2, y: r.y + r.h / 2 }, button: 0, buttons: 1 })
  }
  const type = (text: string) => { for (const key of text) popup.onKeyDown(new KeyboardEvent('keydown', { key, cancelable: true })) }
  click('year'); type('202'); click('year'); type('8')
  expect(popup.debugState().selected).toEqual({ year: 2028, month: 2, day: 29 })
  click('hour'); type('1'); click('hour'); type('4')
  expect(popup.debugState().selectedTime.hour).toBe(14)
  click('minute'); type('3'); click('minute'); click('second')
  expect(popup.debugState().selectedTime.minute).toBe(3)
  type('4'); click('second'); type('2')
  expect(popup.debugState().selectedTime.second).toBe(42)
  expect(onSelect).not.toHaveBeenCalled()
  const p = popup.debugState()
  popup.onPointerDown({ type: 'down', pointerId: 1, pointerType: 'mouse', position: { x: p.panelX + p.panelW / 2, y: p.panelY + p.panelH - p.footerHeight / 2 }, button: 0, buttons: 1 })
  expect(onSelect).toHaveBeenCalledOnce()
  expect(onSelect).toHaveBeenCalledWith({ year: 2028, month: 2, day: 29 }, { hour: 14, minute: 3, second: 42 })
  expect(popup.visible).toBe(false); popup.dispose()
})

it.each(['mouse', 'Tab', 'ArrowRight'])('manual popup %s segment switching commits partial input and starts fresh on return', method => {
  const popup = new DatePickerPopup(), onSelect = vi.fn()
  popup.open({ anchor: staticAnchor(10, 10, 120, 24), selected: { year: 2024, month: 1, day: 31 }, confirmOnEnter: false, onSelect, onClose: vi.fn() })
  const click = (name: string) => {
    const r = popup.debugState().segments[name]!
    popup.onPointerDown({ type: 'down', pointerId: 1, pointerType: 'mouse', position: { x: r.x + r.w / 2, y: r.y + r.h / 2 }, button: 0, buttons: 1 })
  }
  const key = (key: string) => popup.onKeyDown(new KeyboardEvent('keydown', { key, cancelable: true }))
  click('month'); key('1'); click('month'); key('Backspace'); key('2'); click('month')
  if (method === 'mouse') click('day'); else key(method)
  expect(popup.debugState().selected).toEqual({ year: 2024, month: 2, day: 29 })
  expect(popup.debugState().activeSegment).toBe('day')
  click('month'); key('1'); click('month'); key('1')
  expect(popup.debugState().selected).toEqual({ year: 2024, month: 11, day: 29 })
  click('day'); key('1'); key('5'); click('day'); key('2'); key('0')
  expect(popup.debugState().selected?.day).toBe(20)
  expect(onSelect).not.toHaveBeenCalled(); popup.dispose()
})
