// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { FocusManager } from '../core/focus_manager'
import { PopupManager } from '../core/popup_manager'
import { GET_POPUP_ANCHOR_RECT } from '../core/popup_anchor'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { RenderTimePicker, TimePickerPopup } from './time_picker'

afterEach(() => {
  PopupManager.instance.dispose()
  FocusManager.instance.dispose()
})

function layoutPicker(picker: RenderTimePicker): void {
  picker.layout(
    { minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: 100 },
    false,
    { theme: ImGuiDarkTheme },
  )
}

describe('TimePickerPopup', () => {
  it('clicked clock column owns numeric keys while confirmOnEnter false keeps all changes provisional', () => {
    const popup = new TimePickerPopup(), onSelect = vi.fn()
    popup.open({ anchor: { [GET_POPUP_ANCHOR_RECT]: () => ({ x: 10, y: 10, width: 120, height: 24 }) }, value: '09:30', precision: 'minute', hourStep: 1, minuteStep: 1, secondStep: 1, ownerInput: true, confirmOnEnter: false, onSelect, onClose: vi.fn() })
    const p = popup.debugState()
    popup.onPointerDown({ type: 'down', pointerId: 1, pointerType: 'mouse', position: { x: p.panelX + p.panelW / 4, y: p.panelY + (p.panelH - p.footerHeight) * .58 }, button: 0, buttons: 1 })
    expect(popup.ownsTextInput).toBe(true)
    for (const key of ['1', '5', 'Enter']) expect(popup.onKeyDown(new KeyboardEvent('keydown', { key }))).toBe(true)
    expect(popup.debugState().value).toMatch(/^15:/); expect(onSelect).not.toHaveBeenCalled(); expect(popup.visible).toBe(true)
    expect(popup.commitSelection()).toBe(true); expect(onSelect).toHaveBeenCalledOnce(); popup.dispose()
  })
  it('owner-input mode leaves digits, caret keys and IME to the owner, and requires candidate activation before Enter', () => {
    const popup = new TimePickerPopup(), onSelect = vi.fn()
    popup.open({ anchor: { [GET_POPUP_ANCHOR_RECT]: () => ({ x: 10, y: 10, width: 120, height: 24 }) }, value: '09:30', precision: 'minute', hourStep: 1, minuteStep: 1, secondStep: 1, ownerInput: true, onSelect, onClose: vi.fn() })
    for (const key of ['1', 'Backspace', 'ArrowLeft', 'ArrowRight', 'Enter']) expect(popup.onKeyDown(new KeyboardEvent('keydown', { key }))).toBe(false)
    expect(popup.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown', isComposing: true }))).toBe(false)
    expect(onSelect).not.toHaveBeenCalled()
    popup.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    expect(popup.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(true); expect(onSelect).toHaveBeenCalledTimes(1)
    popup.dispose()
  })
  it('opens with normalized precision and commits the draft', () => {
    const popup = new TimePickerPopup()
    const onSelect = vi.fn(() => true)
    const anchor = {
      [GET_POPUP_ANCHOR_RECT]: () => ({ x: 10, y: 10, width: 120, height: 24 }),
    }
    popup.open({
      anchor,
      value: '08:09:10',
      precision: 'minute',
      hourStep: 1,
      minuteStep: 5,
      secondStep: 1,
      onSelect,
      onClose: vi.fn(),
    })

    expect(popup.debugState().value).toBe('08:09')
    expect(popup.commitSelection()).toBe(true)
    expect(onSelect).toHaveBeenCalledWith('08:09')
    expect(popup.visible).toBe(false)
    popup.dispose()
  })

  it('commits a one-digit buffered segment before Enter submits the popup', () => {
    const popup = new TimePickerPopup()
    const onSelect = vi.fn(() => true)
    popup.open({
      anchor: {
        [GET_POPUP_ANCHOR_RECT]: () => ({ x: 10, y: 10, width: 120, height: 24 }),
      },
      value: '08:09',
      precision: 'minute',
      hourStep: 1,
      minuteStep: 1,
      secondStep: 1,
      onSelect,
      onClose: vi.fn(),
    })

    popup.onKeyDown(new KeyboardEvent('keydown', { key: '1', cancelable: true }))
    popup.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))

    expect(onSelect).toHaveBeenCalledWith('01:09')
    popup.dispose()
  })

  it('materializes the displayed fallback for an empty draft', () => {
    const popup = new TimePickerPopup()
    const onSelect = vi.fn(() => true)
    popup.open({
      anchor: {
        [GET_POPUP_ANCHOR_RECT]: () => ({ x: 10, y: 10, width: 120, height: 24 }),
      },
      value: '',
      precision: 'second',
      hourStep: 1,
      minuteStep: 1,
      secondStep: 1,
      onSelect,
      onClose: vi.fn(),
    })
    const displayedValue = popup.debugState().value

    expect(displayedValue).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    popup.commitSelection()
    expect(onSelect).toHaveBeenCalledWith(displayedValue)
    popup.dispose()
  })

  it('keeps the popup open and exposes validation feedback for a rejected value', () => {
    const popup = new TimePickerPopup()
    const onSelect = vi.fn(() => true)
    popup.open({
      anchor: {
        [GET_POPUP_ANCHOR_RECT]: () => ({ x: 10, y: 10, width: 120, height: 24 }),
      },
      value: '08:09',
      precision: 'minute',
      hourStep: 1,
      minuteStep: 1,
      secondStep: 1,
      validate: value => value < '09:00' ? '时间不能早于09:00' : '',
      onSelect,
      onClose: vi.fn(),
    })

    expect(popup.commitSelection()).toBe(false)
    expect(popup.visible).toBe(true)
    expect(popup.debugState().validationMessage).toBe('时间不能早于09:00')
    expect(popup.debugState().panelW).toBeGreaterThanOrEqual(220)
    expect(onSelect).not.toHaveBeenCalled()

    popup.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }))
    expect(popup.debugState().validationMessage).toBe('')
    popup.dispose()
  })

  it('submits an explicit clear only when the popup is clearable', () => {
    const popup = new TimePickerPopup()
    const onSelect = vi.fn(() => true)
    popup.open({
      anchor: {
        [GET_POPUP_ANCHOR_RECT]: () => ({ x: 10, y: 10, width: 120, height: 24 }),
      },
      value: '08:09',
      precision: 'minute',
      hourStep: 1,
      minuteStep: 1,
      secondStep: 1,
      clearable: true,
      onSelect,
      onClose: vi.fn(),
    })

    expect(popup.debugState().clearable).toBe(true)
    expect(popup.clearSelection()).toBe(true)
    expect(onSelect).toHaveBeenCalledWith('')
    expect(popup.visible).toBe(false)
    popup.dispose()
  })

  it('shows a submission error returned by the owner', () => {
    const popup = new TimePickerPopup()
    popup.open({
      anchor: {
        [GET_POPUP_ANCHOR_RECT]: () => ({ x: 10, y: 10, width: 120, height: 24 }),
      },
      value: '08:09',
      precision: 'minute',
      hourStep: 1,
      minuteStep: 1,
      secondStep: 1,
      onSelect: () => '字段值已发生变化，请重新打开后编辑',
      onClose: vi.fn(),
    })

    expect(popup.commitSelection()).toBe(false)
    expect(popup.visible).toBe(true)
    expect(popup.debugState().validationMessage).toBe('字段值已发生变化，请重新打开后编辑')
    popup.dispose()
  })

  it('keeps the shared popup width inside the right viewport edge', () => {
    PopupManager.instance.setContextProvider(() => ({
      theme: ImGuiDarkTheme,
      viewport: { width: 240, height: 400, dpr: 1 },
    }))
    const popup = new TimePickerPopup()
    popup.open({
      anchor: {
        [GET_POPUP_ANCHOR_RECT]: () => ({ x: 210, y: 10, width: 24, height: 24 }),
      },
      value: '08:09',
      precision: 'minute',
      hourStep: 1,
      minuteStep: 1,
      secondStep: 1,
      onSelect: vi.fn(() => true),
      onClose: vi.fn(),
    })

    const { panelX, panelW } = popup.debugState()
    expect(panelX + panelW).toBeLessThanOrEqual(236)
    popup.dispose()
  })

  it('discards the draft when an outside pointer closes the popup', () => {
    const popup = new TimePickerPopup()
    const onSelect = vi.fn(() => true)
    const onClose = vi.fn()
    popup.open({
      anchor: {
        [GET_POPUP_ANCHOR_RECT]: () => ({ x: 10, y: 10, width: 120, height: 24 }),
      },
      value: '08:09',
      precision: 'minute',
      hourStep: 1,
      minuteStep: 1,
      secondStep: 1,
      onSelect,
      onClose,
    })

    PopupManager.instance.handlePointerDown({
      type: 'down',
      pointerId: 1,
      button: 0,
      buttons: 1,
      position: { x: 400, y: 400 },
    })

    expect(popup.visible).toBe(false)
    expect(onSelect).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
    popup.dispose()
  })
})

describe('RenderTimePicker', () => {
  it('opens from the keyboard and commits a popup selection', () => {
    const onChange = vi.fn()
    const picker = new RenderTimePicker({
      value: '08:09',
      precision: 'minute',
      onChange,
    })
    layoutPicker(picker)

    expect(picker.onKeyDown(new KeyboardEvent('keydown', {
      key: 'Enter',
      cancelable: true,
    }))).toBe(true)
    expect(picker.debugState().popupVisible).toBe(true)
    expect(picker.commitEdit()).toBe(true)
    expect(picker.value).toBe('08:09')
    expect(onChange).not.toHaveBeenCalled()
    picker.dispose()
  })

  it('normalizes values and keeps external setValue silent', () => {
    const onChange = vi.fn()
    const picker = new RenderTimePicker({ precision: 'second', onChange })

    picker.setValue('12:34')
    expect(picker.value).toBe('12:34:00')
    expect(onChange).not.toHaveBeenCalled()

    picker.precision = 'minute'
    expect(picker.value).toBe('12:34')
    expect(onChange).not.toHaveBeenCalled()
    picker.dispose()
  })

  it('updates only the generated placeholder when precision changes', () => {
    const generated = new RenderTimePicker({ precision: 'minute' })
    const configured = new RenderTimePicker({
      precision: 'minute',
      placeholder: '选择营业时间',
    })

    expect(generated.placeholder).toBe('选择时间 HH:mm')
    generated.precision = 'second'
    expect(generated.placeholder).toBe('选择时间 HH:mm:ss')

    generated.placeholder = '手动选择时间'
    generated.precision = 'minute'
    expect(generated.placeholder).toBe('手动选择时间')

    configured.precision = 'second'
    expect(configured.placeholder).toBe('选择营业时间')

    generated.dispose()
    configured.dispose()
  })

  it('synchronizes an open popup when precision changes', () => {
    const picker = new RenderTimePicker({ value: '08:09', precision: 'minute' })
    layoutPicker(picker)
    picker.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    const minuteWidth = picker.debugState().popup!.panelW

    picker.precision = 'second'

    expect(picker.debugState().popup!.value).toBe('08:09:00')
    expect(picker.debugState().popup!.panelW).toBe(minuteWidth)
    picker.dispose()
  })

  it('synchronizes step changes into an already open popup', () => {
    const picker = new RenderTimePicker({
      value: '08:09',
      precision: 'minute',
      minuteStep: 5,
    })
    layoutPicker(picker)
    picker.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))

    picker.minuteStep = 7

    const choices = (picker as any)._popup._panel
      ._visibleChoices('minute', 9)
      .filter((value: number | null) => value !== null)
    expect(picker.minuteStep).toBe(7)
    expect(choices).toEqual([48, 55, 2, 9, 16, 23, 30])
    picker.dispose()
  })

  it('invalidates paint when a hovered field receives pointer leave', () => {
    const picker = new RenderTimePicker()
    layoutPicker(picker)
    const markNeedsPaint = vi.spyOn(picker, 'markNeedsPaint')
    picker.onPointerMove({ pointerId: 1, type: 'move', position: { x: 10, y: 10 } })
    markNeedsPaint.mockClear()

    picker.onPointerLeave({ pointerId: 1, type: 'move', position: { x: 220, y: 10 } })

    expect(markNeedsPaint).toHaveBeenCalled()
    picker.dispose()
  })

  it('does not open while readonly or disabled', () => {
    const readonly = new RenderTimePicker({ readonly: true })
    const disabled = new RenderTimePicker({ disabled: true })

    expect(readonly.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false)
    expect(disabled.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false)
    readonly.dispose()
    disabled.dispose()
  })
})
