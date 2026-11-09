// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoxConstraints } from '../core/render_object'
import { PaintContext } from '../rendering/paint_context'
import { InputComposer } from '../core/input_composer'
import { FocusManager } from '../core/focus_manager'
import { FormSession } from '../core/form_session'
import { PopupManager } from '../core/popup_manager'
import { TextMeasurer } from '../core/text_measurer'
import { GET_POPUP_ANCHOR_RECT } from '../core/popup_anchor'
import { GestureArenaManager, type GestureArenaMember } from '../gestures/gesture_arena'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { colorToCSS } from '../theme/theme'
import { deriveCheckboxStyle, deriveDropdownStyle, derivePopupStyle, deriveTextInputStyle, deriveTreeStyle, resolveBgColor, resolveTextColor } from '../theme/component_styles'
import { bindFormField } from './form_field_binding'
import { layoutFormFieldInlineContent } from './form_field_shell'
import { MultiSelectDropdownPopup, RenderMultiSelectDropdown } from './multi_select_dropdown'

const constraints: BoxConstraints = {
  minWidth: 0,
  maxWidth: 180,
  minHeight: 0,
  maxHeight: 40,
}

function createTextRecordingPaintContext(): { context: PaintContext; fillText: ReturnType<typeof vi.fn> } {
  const fillText = vi.fn()
  const gradient = { addColorStop: vi.fn() }
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
    createLinearGradient: vi.fn(() => gradient),
    set fillStyle(_value: unknown) {},
    get fillStyle() { return '' },
    set strokeStyle(_value: unknown) {},
    get strokeStyle() { return '' },
    lineWidth: 1,
    font: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'middle' as CanvasTextBaseline,
    lineCap: 'round' as CanvasLineCap,
    lineJoin: 'round' as CanvasLineJoin,
  } as unknown as CanvasRenderingContext2D
  return { context: new PaintContext(ctx, ImGuiDarkTheme), fillText }
}

function createArrowRecordingPaintContext(): {
  context: PaintContext
  moveTo: ReturnType<typeof vi.fn>
  lineTo: ReturnType<typeof vi.fn>
} {
  const moveTo = vi.fn()
  const lineTo = vi.fn()
  const gradient = { addColorStop: vi.fn() }
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
    fillText: vi.fn(),
    measureText: vi.fn(text => ({ width: String(text).length * 8 }) as TextMetrics),
    moveTo,
    lineTo,
    closePath: vi.fn(),
    arc: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    set fillStyle(_value: unknown) {},
    get fillStyle() { return '' },
    set strokeStyle(_value: unknown) {},
    get strokeStyle() { return '' },
    lineWidth: 1,
    font: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'middle' as CanvasTextBaseline,
    lineCap: 'round' as CanvasLineCap,
    lineJoin: 'round' as CanvasLineJoin,
  } as unknown as CanvasRenderingContext2D
  return { context: new PaintContext(ctx, ImGuiDarkTheme), moveTo, lineTo }
}

function createStyleRecordingPaintContext(): {
  context: PaintContext
  fillStyles: string[]
  strokeStyles: string[]
} {
  const fillStyles: string[] = []
  const strokeStyles: string[] = []
  let fillStyle = ''
  let strokeStyle = ''
  const gradient = { addColorStop: vi.fn() }
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(() => fillStyles.push(fillStyle)),
    stroke: vi.fn(() => strokeStyles.push(strokeStyle)),
    fillRect: vi.fn(() => fillStyles.push(fillStyle)),
    strokeRect: vi.fn(() => strokeStyles.push(strokeStyle)),
    fillText: vi.fn(),
    measureText: vi.fn(text => ({ width: String(text).length * 8 }) as TextMetrics),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    set fillStyle(value: string) { fillStyle = value },
    get fillStyle() { return fillStyle },
    set strokeStyle(value: string) { strokeStyle = value },
    get strokeStyle() { return strokeStyle },
    lineWidth: 1,
    font: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'middle' as CanvasTextBaseline,
    lineCap: 'round' as CanvasLineCap,
    lineJoin: 'round' as CanvasLineJoin,
  } as unknown as CanvasRenderingContext2D
  return { context: new PaintContext(ctx, ImGuiDarkTheme), fillStyles, strokeStyles }
}

function setPopupTestContext(viewport = { width: 320, height: 240, dpr: 1 }): void {
  PopupManager.instance.setContextProvider(() => ({ theme: ImGuiDarkTheme, viewport }))
}

function staticAnchor(x: number, y: number, width: number, height: number) {
  return {
    [GET_POPUP_ANCHOR_RECT]: () => ({ x, y, width, height }),
  }
}

function triggerClearPoint(dropdown: RenderMultiSelectDropdown): { x: number; y: number } {
  const rect = (dropdown as any)._triggerLayout().clearRect as
    | { x: number; y: number; w: number; h: number }
    | null
  if (!rect) throw new Error('Expected clear affordance')
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
}

function firstChipRemovePoint(dropdown: RenderMultiSelectDropdown): { x: number; y: number } {
  const layout = (dropdown as any)._triggerLayout()
  const chips = (dropdown as any)._chipLayouts(layout.valueRect)
  const rect = chips[0]?.removeRect as
    | { x: number; y: number; w: number; h: number }
    | null
  if (!rect) throw new Error('Expected chip remove affordance')
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
}

afterEach(() => {
  PopupManager.disposeInstance()
  FocusManager.disposeInstance()
  InputComposer.disposeInstance()
  vi.restoreAllMocks()
})

describe('RenderMultiSelectDropdown', () => {
  it('accepts common RenderBox options and applies them to layout', () => {
    const dropdown = new RenderMultiSelectDropdown({
      options: [],
      width: 160,
      height: 44,
      minWidth: 120,
      maxWidth: 180,
      minHeight: 30,
      maxHeight: 50,
      margin: { left: 7, right: 9, top: 3, bottom: 5 },
      horizontalAlignment: 'end',
      verticalAlignment: 'center',
    })

    expect(dropdown.width).toBe(160)
    expect(dropdown.height).toBe(44)
    expect(dropdown.minWidth).toBe(120)
    expect(dropdown.maxWidth).toBe(180)
    expect(dropdown.minHeight).toBe(30)
    expect(dropdown.maxHeight).toBe(50)
    expect(dropdown.margin).toEqual({ left: 7, right: 9, top: 3, bottom: 5 })
    expect(dropdown.horizontalAlignment).toBe('end')
    expect(dropdown.verticalAlignment).toBe('center')

    dropdown.layout(
      { minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 100 },
      false,
      { theme: ImGuiDarkTheme },
    )
    expect(dropdown.size).toEqual({ width: 160, height: 44 })
    expect(dropdown.outerSize).toEqual({ width: 176, height: 52 })

    dropdown.positionInSlot(
      { x: 10, y: 20, width: 300, height: 100 },
      dropdown.resolveHorizontalAlignment('start'),
      dropdown.resolveVerticalAlignment('start'),
    )
    expect(dropdown.offset).toEqual({ x: 141, y: 47 })

    dropdown.dispose()
  })

  it('focuses through keyboard navigation without auto-opening the popup', () => {
    setPopupTestContext()
    const dropdown = new RenderMultiSelectDropdown({
      options: [{ value: 'ts', label: 'TypeScript' }],
      values: ['ts'],
    })

    dropdown.layout(constraints, false, { theme: ImGuiDarkTheme })
    FocusManager.instance.setFocus(dropdown)

    expect(dropdown.isFocused).toBe(true)
    expect((dropdown as any)._popup.visible).toBe(false)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))

    expect((dropdown as any)._popup.visible).toBe(true)

    dropdown.dispose()
  })

  it('opens on the first click after the control is already focused', () => {
    setPopupTestContext()
    const dropdown = new RenderMultiSelectDropdown({
      options: [{ value: 'ts', label: 'TypeScript' }],
      values: ['ts'],
    })

    dropdown.layout(constraints, false, { theme: ImGuiDarkTheme })
    FocusManager.instance.setFocus(dropdown)

    dropdown.onPointerDown({ pointerId: 1, position: { x: 10, y: 10 }, type: 'down' })

    expect((dropdown as any)._popup.visible).toBe(true)

    dropdown.dispose()
  })

  it('lets ArrowDown move the popup selection after keyboard open', () => {
    setPopupTestContext()
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
      ],
      values: ['ts'],
    })

    dropdown.layout(constraints, false, { theme: ImGuiDarkTheme })
    FocusManager.instance.setFocus(dropdown)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))

    expect(((dropdown as any)._popup as MultiSelectDropdownPopup).debugState().keyboardIndex).toBe(1)

    dropdown.dispose()
  })

  it('toggles items without closing the popup', () => {
    setPopupTestContext()
    const onChange = vi.fn()
    const valueListener = vi.fn()
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
        { value: 'rust', label: 'Rust' },
      ],
      values: ['ts'],
      onChange,
    })
    dropdown.subscribeValueChange(valueListener)
    dropdown.setValue(['js'])
    dropdown.setValue(['ts'])
    expect(valueListener).not.toHaveBeenCalled()
    const dropdownStyle = deriveDropdownStyle(ImGuiDarkTheme)
    const popupStyle = derivePopupStyle(ImGuiDarkTheme)

    dropdown.layout(constraints, false, { theme: ImGuiDarkTheme })
    dropdown.onPointerDown({ pointerId: 1, position: { x: 10, y: 10 }, type: 'down' })

    const popup = (dropdown as any)._popup as MultiSelectDropdownPopup
    expect(popup.visible).toBe(true)

    popup.onPointerDown({
      pointerId: 0,
      position: {
        x: 10,
        y: dropdown.size.height + 2 + popupStyle.padding + dropdownStyle.itemHeight * 1.5,
      },
      type: 'down',
    }, PopupManager.instance.context)

    expect(dropdown.values).toEqual(['ts', 'js'])
    expect(onChange).toHaveBeenLastCalledWith(
      ['ts', 'js'],
      [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
      ],
    )
    expect(valueListener).toHaveBeenLastCalledWith({
      value: ['ts', 'js'],
      previousValue: ['ts'],
      reason: 'selection',
      detail: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
      ],
    })
    expect(popup.visible).toBe(true)

    popup.onPointerDown({
      pointerId: 0,
      position: {
        x: 10,
        y: dropdown.size.height + 2 + popupStyle.padding + dropdownStyle.itemHeight * 0.5,
      },
      type: 'down',
    }, PopupManager.instance.context)

    expect(dropdown.values).toEqual(['js'])
    expect(popup.visible).toBe(true)

    dropdown.dispose()
  })

  it('clears through the shared trigger clear affordance only on accepted pointer up', () => {
    const onChange = vi.fn()
    const preventActivation = vi.fn()
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
      ],
      values: ['ts', 'js'],
      clearable: true,
      onChange,
    })
    dropdown.layout(constraints, false, { theme: ImGuiDarkTheme })
    const point = triggerClearPoint(dropdown)

    dropdown.onPointerDown({
      pointerId: 1,
      position: point,
      type: 'down',
      preventActivation,
    })

    expect(preventActivation).toHaveBeenCalledOnce()
    expect(dropdown.values).toEqual(['ts', 'js'])
    expect(onChange).not.toHaveBeenCalled()

    dropdown.onPointerUp({
      pointerId: 1,
      position: point,
      type: 'up',
    })

    expect(dropdown.values).toEqual([])
    expect(onChange).toHaveBeenCalledWith([], [])

    dropdown.dispose()
  })

  it('treats its open popup as focused and publishes blur only after explicit blur', () => {
    setPopupTestContext()
    const blurListener = vi.fn()
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
      ],
      values: ['ts'],
      searchable: true,
    })
    dropdown.subscribeBlur(blurListener)
    dropdown.layout(constraints, false, { theme: ImGuiDarkTheme })

    dropdown.requestFocus()
    dropdown.onKeyDown(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      cancelable: true,
    }))

    expect((dropdown as any)._popup.visible).toBe(true)
    expect(dropdown.isFocused).toBe(true)
    expect(blurListener).not.toHaveBeenCalled()

    dropdown.blur()
    dropdown.blur()

    expect((dropdown as any)._popup.visible).toBe(false)
    expect(dropdown.isFocused).toBe(false)
    expect(blurListener).toHaveBeenCalledOnce()

    dropdown.dispose()
  })

  it('does not clear when a scroll competitor wins the gesture arena', () => {
    const arena = new GestureArenaManager()
    const scrollMember: GestureArenaMember = {
      acceptGesture: vi.fn(),
      rejectGesture: vi.fn(),
    }
    const onChange = vi.fn()
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
      ],
      values: ['ts', 'js'],
      clearable: true,
      onChange,
    })
    dropdown.layout(constraints, false, { theme: ImGuiDarkTheme })
    const point = triggerClearPoint(dropdown)

    dropdown.onPointerDown({
      pointerId: 1,
      position: point,
      type: 'down',
      joinGestureArena: member => arena.add(1, member),
    })
    const scrollEntry = arena.add(1, scrollMember)
    arena.close(1)
    scrollEntry.resolve('accepted')
    dropdown.onPointerUp({ pointerId: 1, position: point, type: 'up' })

    expect(scrollMember.acceptGesture).toHaveBeenCalledWith(1)
    expect(dropdown.values).toEqual(['ts', 'js'])
    expect(onChange).not.toHaveBeenCalled()
    expect((dropdown as any)._pressedClear).toBe(false)
    expect((dropdown as any)._pendingGesture.hasOwner).toBe(false)

    dropdown.dispose()
  })

  it('keeps readonly dropdowns unfocused, closed, and non-clearable', () => {
    const onChange = vi.fn()
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
      ],
      values: ['ts', 'js'],
      readonly: true,
      clearable: true,
      onChange,
    })
    const style = deriveTextInputStyle(ImGuiDarkTheme)
    const dropdownStyle = deriveDropdownStyle(ImGuiDarkTheme)

    dropdown.layout(constraints, false, { theme: ImGuiDarkTheme })
    dropdown.focusIn()
    dropdown.onPointerMove({ pointerId: 1, position: { x: 10, y: 10 }, type: 'move' })
    dropdown.onPointerDown({ pointerId: 1, position: { x: 10, y: 10 }, type: 'down' })

    expect(dropdown.isFocused).toBe(false)
    expect((dropdown as any)._hovered).toBe(false)
    expect((dropdown as any)._hoveredChipValue).toBe(null)
    expect((dropdown as any)._popup.visible).toBe(false)

    const layout = layoutFormFieldInlineContent(style, { x: 0, y: 0 }, dropdown.size.width, style.height, {
      showClearButton: true,
      reserveTrailingWidth: dropdownStyle.fontSize,
    })
    dropdown.onPointerDown({
      pointerId: 1,
      position: {
        x: layout.clearRect!.x + layout.clearRect!.w / 2,
        y: layout.clearRect!.y + layout.clearRect!.h / 2,
      },
      type: 'down',
    })

    expect(dropdown.values).toEqual(['ts', 'js'])
    expect(dropdown.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
    expect(FocusManager.instance.scopeStack[0]?.focusables.includes(dropdown)).toBe(false)

    dropdown.dispose()
  })

  it('closes popup and clears chip pointer state when readonly is enabled dynamically', () => {
    setPopupTestContext()
    const blurListener = vi.fn()
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
      ],
      values: ['ts', 'js'],
    })
    dropdown.subscribeBlur(blurListener)

    dropdown.layout(constraints, false, { theme: ImGuiDarkTheme })
    FocusManager.instance.setFocus(dropdown)
    dropdown.onPointerDown({ pointerId: 1, position: { x: 10, y: 10 }, type: 'down' })

    expect((dropdown as any)._popup.visible).toBe(true)
    expect(dropdown.isFocused).toBe(true)

    ;(dropdown as any)._hovered = true
    ;(dropdown as any)._hoveredChipValue = 'ts'
    ;(dropdown as any)._hoveredChipRemoveValue = 'ts'
    ;(dropdown as any)._pressedChipRemoveValue = 'ts'

    dropdown.readonly = true

    expect((dropdown as any)._popup.visible).toBe(false)
    expect(dropdown.isFocused).toBe(false)
    expect(FocusManager.instance.current).not.toBe(dropdown)
    expect(FocusManager.instance.scopeStack[0]?.focusables.includes(dropdown)).toBe(false)
    expect((dropdown as any)._hovered).toBe(false)
    expect((dropdown as any)._hoveredChipValue).toBe(null)
    expect((dropdown as any)._hoveredChipRemoveValue).toBe(null)
    expect((dropdown as any)._pressedChipRemoveValue).toBe(null)
    expect(blurListener).toHaveBeenCalledOnce()

    dropdown.dispose()
  })

  it('closes popup and clears chip pointer state when disabled dynamically', () => {
    setPopupTestContext()
    const blurListener = vi.fn()
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
      ],
      values: ['ts', 'js'],
    })
    dropdown.subscribeBlur(blurListener)

    dropdown.layout(constraints, false, { theme: ImGuiDarkTheme })
    FocusManager.instance.setFocus(dropdown)
    dropdown.onPointerDown({ pointerId: 1, position: { x: 10, y: 10 }, type: 'down' })

    expect((dropdown as any)._popup.visible).toBe(true)
    expect(dropdown.isFocused).toBe(true)

    ;(dropdown as any)._hovered = true
    ;(dropdown as any)._hoveredChipValue = 'ts'
    ;(dropdown as any)._hoveredChipRemoveValue = 'ts'
    ;(dropdown as any)._pressedChipRemoveValue = 'ts'

    dropdown.disabled = true

    expect((dropdown as any)._popup.visible).toBe(false)
    expect(dropdown.isFocused).toBe(false)
    expect(FocusManager.instance.current).not.toBe(dropdown)
    expect(FocusManager.instance.scopeStack[0]?.focusables.includes(dropdown)).toBe(false)
    expect((dropdown as any)._hovered).toBe(false)
    expect((dropdown as any)._hoveredChipValue).toBe(null)
    expect((dropdown as any)._hoveredChipRemoveValue).toBe(null)
    expect((dropdown as any)._pressedChipRemoveValue).toBe(null)
    expect(blurListener).toHaveBeenCalledOnce()

    dropdown.dispose()
  })

  it('cancels a pending chip action when disabled before pointer up', () => {
    const arena = new GestureArenaManager()
    const onChange = vi.fn()
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
      ],
      values: ['ts', 'js'],
      onChange,
    })
    dropdown.layout(constraints, false, { theme: ImGuiDarkTheme })
    const point = firstChipRemovePoint(dropdown)

    dropdown.onPointerDown({
      pointerId: 3,
      position: point,
      type: 'down',
      joinGestureArena: member => arena.add(3, member),
    })
    expect((dropdown as any)._pendingGesture.hasOwner).toBe(true)

    dropdown.disabled = true
    dropdown.onPointerUp({ pointerId: 3, position: point, type: 'up' })

    expect(arena.members(3)).toEqual([])
    expect((dropdown as any)._pendingGesture.hasOwner).toBe(false)
    expect((dropdown as any)._pressedChipRemoveValue).toBeNull()
    expect(dropdown.values).toEqual(['ts', 'js'])
    expect(onChange).not.toHaveBeenCalled()

    dropdown.dispose()
  })

  it('rejects and clears a pending clear gesture during dispose', () => {
    const arena = new GestureArenaManager()
    const onChange = vi.fn()
    const dropdown = new RenderMultiSelectDropdown({
      options: [{ value: 'ts', label: 'TypeScript' }],
      values: ['ts'],
      clearable: true,
      onChange,
    })
    dropdown.layout(constraints, false, { theme: ImGuiDarkTheme })
    const point = triggerClearPoint(dropdown)

    dropdown.onPointerDown({
      pointerId: 4,
      position: point,
      type: 'down',
      joinGestureArena: member => arena.add(4, member),
    })
    expect((dropdown as any)._pendingGesture.hasOwner).toBe(true)

    dropdown.dispose()
    dropdown.onPointerUp({ pointerId: 4, position: point, type: 'up' })

    expect(arena.members(4)).toEqual([])
    expect((dropdown as any)._pendingGesture.hasOwner).toBe(false)
    expect((dropdown as any)._pressedClear).toBe(false)
    expect(dropdown.values).toEqual(['ts'])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('normalizes selected values and synchronizes an open popup when options are rebound', () => {
    setPopupTestContext()
    const onChange = vi.fn()
    const reconciliationListener = vi.fn()
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
      ],
      values: ['ts', 'js'],
      onChange,
    })
    dropdown.subscribeValueChange(reconciliationListener)

    dropdown.layout(constraints, false, { theme: ImGuiDarkTheme })
    dropdown.onPointerDown({ pointerId: 1, position: { x: 10, y: 10 }, type: 'down' })

    expect((dropdown as any)._popup.visible).toBe(true)

    dropdown.options = [{ value: 'js', label: 'JavaScript' }]

    const popup = (dropdown as any)._popup as MultiSelectDropdownPopup
    expect(popup.visible).toBe(true)
    expect(popup.debugState()).toMatchObject({
      filteredOptions: [{ value: 'js', label: 'JavaScript' }],
      selectedValues: ['js'],
    })
    expect(dropdown.values).toEqual(['js'])
    expect(onChange).not.toHaveBeenCalled()
    expect(reconciliationListener).toHaveBeenCalledOnce()
    expect(reconciliationListener).toHaveBeenCalledWith({
      value: ['js'],
      previousValue: ['ts', 'js'],
      reason: 'options-reconcile',
      detail: [{ value: 'js', label: 'JavaScript' }],
      userInitiated: false,
    })

    dropdown.dispose()
  })

  it('reconciles a bound form draft without marking the field touched', () => {
    const onChange = vi.fn()
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
      ],
      values: ['ts', 'js'],
      onChange,
    })
    const form = new FormSession({ languages: ['ts', 'js'] })
    const disposeBinding = bindFormField(form, 'languages', dropdown, {
      validateOn: [],
    })

    dropdown.options = [{ value: 'js', label: 'JavaScript' }]

    expect(dropdown.values).toEqual(['js'])
    expect(form.getValue('languages')).toEqual(['js'])
    expect(form.isFieldTouched('languages')).toBe(false)
    expect(onChange).not.toHaveBeenCalled()

    disposeBinding()
    dropdown.dispose()
    form.dispose()
  })

  it('synchronizes controlled values into an open popup before the next toggle', () => {
    setPopupTestContext()
    const onChange = vi.fn()
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
        { value: 'rust', label: 'Rust' },
      ],
      values: ['ts'],
      onChange,
    })

    dropdown.layout(constraints, false, { theme: ImGuiDarkTheme })
    dropdown.onPointerDown({ pointerId: 1, position: { x: 10, y: 10 }, type: 'down' })
    const popup = (dropdown as any)._popup as MultiSelectDropdownPopup

    dropdown.values = ['js']

    expect(popup.visible).toBe(true)
    expect(popup.debugState().selectedValues).toEqual(['js'])
    expect(onChange).not.toHaveBeenCalled()

    popup.onKeyDown(new KeyboardEvent('keydown', { key: 'End', cancelable: true }))
    popup.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))

    expect(onChange).toHaveBeenLastCalledWith(
      ['js', 'rust'],
      [
        { value: 'js', label: 'JavaScript' },
        { value: 'rust', label: 'Rust' },
      ],
    )

    dropdown.dispose()
  })

  it('renders placeholder text when no values are selected', () => {
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
        { value: 'rust', label: 'Rust' },
      ],
      values: [],
      placeholder: '选择技术栈...',
    })
    const painted = createTextRecordingPaintContext()

    dropdown.layout(constraints, false, { theme: ImGuiDarkTheme })
    dropdown.performPaint(painted.context, { x: 0, y: 0 })

    expect(painted.fillText.mock.calls.some(call => call[0] === '选择技术栈...')).toBe(true)

    dropdown.dispose()
  })

  it('keeps all selected labels visible when the summary field has enough width', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => Array.from(text).length * 8)
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'submitted', label: '已提交' },
        { value: 'executing', label: '执行中' },
        { value: 'stopped', label: '已停止' },
      ],
      values: ['submitted', 'executing', 'stopped'],
      displayMode: 'summary',
    })
    const painted = createTextRecordingPaintContext()

    dropdown.layout({ ...constraints, maxWidth: 400 }, false, { theme: ImGuiDarkTheme })
    dropdown.performPaint(painted.context, { x: 0, y: 0 })

    expect(painted.fillText.mock.calls.some(call => call[0] === '已提交, 执行中, 已停止')).toBe(true)

    dropdown.dispose()
  })

  it('prefers a fitting complete label list when it is narrower than the +N candidate', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => {
      if (text === 'WWW, i') return 70
      if (text === 'WWW +1') return 90
      return Array.from(text).length * 8
    })
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'wide', label: 'WWW' },
        { value: 'narrow', label: 'i' },
      ],
      values: ['wide', 'narrow'],
      displayMode: 'summary',
    })
    const painted = createTextRecordingPaintContext()

    dropdown.layout({ ...constraints, maxWidth: 120 }, false, { theme: ImGuiDarkTheme })
    dropdown.performPaint(painted.context, { x: 0, y: 0 })

    expect(painted.fillText.mock.calls.some(call => call[0] === 'WWW, i')).toBe(true)
    expect(painted.fillText.mock.calls.some(call => call[0] === '已选择 2 项')).toBe(false)

    dropdown.dispose()
  })

  it('keeps visible labels and appends the hidden count as summary width shrinks', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => Array.from(text).length * 8)
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'submitted', label: '已提交' },
        { value: 'executing', label: '执行中' },
        { value: 'stopped', label: '已停止' },
      ],
      values: ['submitted', 'executing', 'stopped'],
      displayMode: 'summary',
    })
    const painted = createTextRecordingPaintContext()

    dropdown.layout({ ...constraints, maxWidth: 100 }, false, { theme: ImGuiDarkTheme })
    dropdown.performPaint(painted.context, { x: 0, y: 0 })

    expect(painted.fillText.mock.calls.some(call => call[0] === '已提交 +2')).toBe(true)

    dropdown.dispose()
  })

  it('falls back to a count when no selected label can share the available width', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => Array.from(text).length * 8)
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'submitted', label: '非常漫长的已提交状态' },
        { value: 'executing', label: '非常漫长的执行中状态' },
        { value: 'stopped', label: '非常漫长的已停止状态' },
      ],
      values: ['submitted', 'executing', 'stopped'],
      displayMode: 'summary',
    })
    const painted = createTextRecordingPaintContext()

    dropdown.layout({ ...constraints, maxWidth: 100 }, false, { theme: ImGuiDarkTheme })
    dropdown.performPaint(painted.context, { x: 0, y: 0 })

    expect(painted.fillText.mock.calls.some(call => call[0] === '已选择 3 项')).toBe(true)

    dropdown.dispose()
  })

  it('recomputes responsive summary text after resizing and reserving adornment space', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => Array.from(text).length * 8)
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'submitted', label: '已提交' },
        { value: 'executing', label: '执行中' },
        { value: 'stopped', label: '已停止' },
      ],
      values: ['submitted', 'executing', 'stopped'],
      displayMode: 'summary',
      prefixText: '状态',
      suffixText: '范围',
      clearable: true,
    })
    const painted = createTextRecordingPaintContext()

    dropdown.layout({ ...constraints, maxWidth: 400 }, false, { theme: ImGuiDarkTheme })
    dropdown.performPaint(painted.context, { x: 0, y: 0 })
    expect(painted.fillText.mock.calls.some(call => call[0] === '已提交, 执行中, 已停止')).toBe(true)

    painted.fillText.mockClear()
    dropdown.layout({ ...constraints, maxWidth: 150 }, false, { theme: ImGuiDarkTheme })
    dropdown.performPaint(painted.context, { x: 0, y: 0 })

    expect(painted.fillText.mock.calls.some(call => call[0] === '已提交 +2')).toBe(true)
    expect(painted.fillText.mock.calls.some(call => call[0] === '状态')).toBe(true)
    expect(painted.fillText.mock.calls.some(call => call[0] === '范围')).toBe(true)

    dropdown.dispose()
  })

  it('refreshes responsive summary text after values and options change', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => Array.from(text).length * 8)
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'submitted', label: '已提交' },
        { value: 'executing', label: '执行中' },
        { value: 'stopped', label: '已停止' },
      ],
      values: ['submitted'],
      displayMode: 'summary',
    })
    const painted = createTextRecordingPaintContext()

    dropdown.layout({ ...constraints, maxWidth: 100 }, false, { theme: ImGuiDarkTheme })
    dropdown.performPaint(painted.context, { x: 0, y: 0 })
    expect(painted.fillText.mock.calls.some(call => call[0] === '已提交')).toBe(true)

    painted.fillText.mockClear()
    dropdown.values = ['submitted', 'executing', 'stopped']
    dropdown.performPaint(painted.context, { x: 0, y: 0 })
    expect(painted.fillText.mock.calls.some(call => call[0] === '已提交 +2')).toBe(true)

    painted.fillText.mockClear()
    dropdown.options = [
      { value: 'submitted', label: '非常漫长的已提交状态' },
      { value: 'executing', label: '非常漫长的执行中状态' },
      { value: 'stopped', label: '非常漫长的已停止状态' },
    ]
    dropdown.performPaint(painted.context, { x: 0, y: 0 })
    expect(painted.fillText.mock.calls.some(call => call[0] === '已选择 3 项')).toBe(true)

    dropdown.dispose()
  })

  it('ellipsizes placeholder text using Unicode-safe width measurement', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => Array.from(text).length * 8)
    const dropdown = new RenderMultiSelectDropdown({
      options: [],
      placeholder: '✅请选择执行状态',
      displayMode: 'summary',
    })
    const painted = createTextRecordingPaintContext()

    dropdown.layout({ ...constraints, maxWidth: 70 }, false, { theme: ImGuiDarkTheme })
    dropdown.performPaint(painted.context, { x: 0, y: 0 })

    expect(painted.fillText.mock.calls.some(call => call[0] === '✅...')).toBe(true)

    dropdown.dispose()
  })

  it('builds removable chips and an overflow chip for the trigger', () => {
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
        { value: 'rust', label: 'Rust' },
      ],
      values: ['ts', 'js', 'rust'],
    })
    dropdown.layout({ ...constraints, maxWidth: 220 }, false, { theme: ImGuiDarkTheme })
    const layout = (dropdown as any)._triggerLayout()
    const chips = (dropdown as any)._chipLayouts(layout.valueRect)

    expect(chips.map((chip: { label: string }) => chip.label)).toEqual(['TypeScript', '+2'])
    expect(chips[0].removeRect).not.toBeNull()
    expect(chips[1].removeRect).toBeNull()

    dropdown.dispose()
  })

  it('removes a single selected value from the trigger chip close affordance', () => {
    const onChange = vi.fn()
    const preventActivation = vi.fn()
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
      ],
      values: ['ts', 'js'],
      onChange,
    })

    dropdown.layout(constraints, false, { theme: ImGuiDarkTheme })
    const removePosition = firstChipRemovePoint(dropdown)

    dropdown.onPointerDown({
      pointerId: 1,
      position: removePosition,
      type: 'down',
      preventActivation,
    })

    expect(preventActivation).toHaveBeenCalledOnce()
    expect(dropdown.values).toEqual(['ts', 'js'])

    dropdown.onPointerUp({
      pointerId: 1,
      position: removePosition,
      type: 'up',
    })

    expect(dropdown.values).toEqual(['js'])
    expect(onChange).toHaveBeenCalledWith(['js'], [
      { value: 'js', label: 'JavaScript' },
    ])
    expect(FocusManager.instance.current).toBe(dropdown)

    dropdown.dispose()
  })

  it('does not remove a chip when a scroll competitor wins the gesture arena', () => {
    const arena = new GestureArenaManager()
    const scrollMember: GestureArenaMember = {
      acceptGesture: vi.fn(),
      rejectGesture: vi.fn(),
    }
    const onChange = vi.fn()
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
      ],
      values: ['ts', 'js'],
      onChange,
    })
    dropdown.layout(constraints, false, { theme: ImGuiDarkTheme })
    const removePosition = firstChipRemovePoint(dropdown)

    dropdown.onPointerDown({
      pointerId: 1,
      position: removePosition,
      type: 'down',
      joinGestureArena: member => arena.add(1, member),
    })
    const scrollEntry = arena.add(1, scrollMember)
    arena.close(1)
    scrollEntry.resolve('accepted')
    dropdown.onPointerUp({ pointerId: 1, position: removePosition, type: 'up' })

    expect(scrollMember.acceptGesture).toHaveBeenCalledWith(1)
    expect(dropdown.values).toEqual(['ts', 'js'])
    expect(onChange).not.toHaveBeenCalled()
    expect((dropdown as any)._pressedChipRemoveValue).toBeNull()
    expect((dropdown as any)._pendingGesture.hasOwner).toBe(false)

    dropdown.dispose()
  })

  it('keeps a chip remove press owned by touch zero when mouse zero sends foreign events', () => {
    const arena = new GestureArenaManager()
    const touchIdentity = { pointerId: 0, pointerType: 'touch' as const }
    const onChange = vi.fn()
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
      ],
      values: ['ts', 'js'],
      onChange,
    })
    dropdown.layout(constraints, false, { theme: ImGuiDarkTheme })
    const removePosition = firstChipRemovePoint(dropdown)

    dropdown.onPointerDown({
      ...touchIdentity,
      position: removePosition,
      type: 'down',
      button: 0,
      joinGestureArena: member => arena.add(touchIdentity, member),
    })
    arena.close(touchIdentity)
    dropdown.onPointerDown({
      pointerId: 0,
      pointerType: 'mouse',
      position: removePosition,
      type: 'down',
      button: 0,
    })
    dropdown.onPointerMove({
      pointerId: 0,
      pointerType: 'mouse',
      position: { x: 0, y: 0 },
      type: 'move',
    })
    dropdown.onPointerUp({
      pointerId: 0,
      pointerType: 'mouse',
      position: removePosition,
      type: 'up',
      button: 0,
    })
    dropdown.onPointerCancel({
      pointerId: 0,
      pointerType: 'mouse',
      position: removePosition,
      type: 'cancel',
    })
    dropdown.onPointerLeave({
      pointerId: 0,
      pointerType: 'mouse',
      position: { x: 0, y: 0 },
      type: 'move',
    })

    expect(dropdown.values).toEqual(['ts', 'js'])
    expect(onChange).not.toHaveBeenCalled()
    expect((dropdown as any)._pressedChipRemoveValue).toBe('ts')
    expect((dropdown as any)._pendingGesture.hasOwner).toBe(true)

    dropdown.onPointerUp({
      ...touchIdentity,
      position: removePosition,
      type: 'up',
      button: 0,
    })

    expect(dropdown.values).toEqual(['js'])
    expect(onChange).toHaveBeenCalledTimes(1)
    expect((dropdown as any)._pressedChipRemoveValue).toBeNull()
    expect((dropdown as any)._pendingGesture.hasOwner).toBe(false)

    dropdown.dispose()
  })

  it('opens the popup when clicking the overflow chip body', () => {
    setPopupTestContext()
    const dropdown = new RenderMultiSelectDropdown({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
        { value: 'rust', label: 'Rust' },
      ],
      values: ['ts', 'js', 'rust'],
    })

    dropdown.layout({ ...constraints, maxWidth: 220 }, false, { theme: ImGuiDarkTheme })
    const layout = (dropdown as any)._triggerLayout()
    const chips = (dropdown as any)._chipLayouts(layout.valueRect)
    const overflowChip = chips[1]

    dropdown.onPointerDown({
      pointerId: 1,
      position: {
        x: overflowChip.x + overflowChip.w / 2,
        y: overflowChip.y + overflowChip.h / 2,
      },
      type: 'down',
    })

    expect((dropdown as any)._popup.visible).toBe(true)

    dropdown.dispose()
  })

  it('flips the trigger arrow while the popup is open', () => {
    setPopupTestContext()
    const dropdown = new RenderMultiSelectDropdown({
      options: [{ value: 'ts', label: 'TypeScript' }],
      values: ['ts'],
    })

    dropdown.layout(constraints, false, { theme: ImGuiDarkTheme })

    const closedPaint = createArrowRecordingPaintContext()
    dropdown.performPaint(closedPaint.context, { x: 0, y: 0 })
    const closedMoveY = Number(closedPaint.moveTo.mock.calls.at(-1)?.[1])

    dropdown.onPointerDown({ pointerId: 1, position: { x: 10, y: 10 }, type: 'down' })

    const openPaint = createArrowRecordingPaintContext()
    dropdown.performPaint(openPaint.context, { x: 0, y: 0 })
    const openMoveY = Number(openPaint.moveTo.mock.calls.at(-1)?.[1])

    expect(openMoveY).toBeLessThan(closedMoveY)

    dropdown.dispose()
  })

  it('filters options through the popup search input session', () => {
    setPopupTestContext()
    const popup = new MultiSelectDropdownPopup()

    popup.open({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'rust', label: 'Rust' },
      ],
      selectedValues: [],
      anchor: staticAnchor(0, 0, 160, 24),
      searchable: true,
      maxVisibleItems: 8,
      onChange: vi.fn(),
      onClose: vi.fn(),
    })

    const input = document.getElementById('__ds_ui_input__') as HTMLTextAreaElement
    input.value = 'ru'
    input.dispatchEvent(new Event('input'))

    expect(popup.debugState().filteredOptions).toEqual([
      { value: 'rust', label: 'Rust' },
    ])
    expect(popup.debugState()).toMatchObject({
      searchText: 'ru',
      searchable: true,
    })

    popup.dispose()
  })

  it('does not start a hidden input session when search is disabled', () => {
    setPopupTestContext()
    const popup = new MultiSelectDropdownPopup()
    const onChange = vi.fn()

    popup.open({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
      ],
      selectedValues: ['ts'],
      anchor: staticAnchor(0, 0, 160, 24),
      searchable: false,
      maxVisibleItems: 8,
      onChange,
      onClose: vi.fn(),
    })

    expect(InputComposer.instance.hasSession).toBe(false)
    expect(popup.debugState()).toMatchObject({
      searchable: false,
      searchText: '',
      keyboardIndex: 0,
    })

    expect(popup.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }))).toBe(true)
    expect(popup.debugState().keyboardIndex).toBe(1)
    expect(popup.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))).toBe(true)

    expect(onChange).toHaveBeenCalledWith(
      ['ts', 'js'],
      [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
      ],
    )
    expect(popup.visible).toBe(true)

    popup.dispose()
  })

  it('does not consume IME composition control keys', () => {
    setPopupTestContext()
    const onChange = vi.fn()
    const popup = new MultiSelectDropdownPopup()
    popup.open({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
      ],
      selectedValues: ['ts'],
      anchor: staticAnchor(0, 0, 160, 24),
      searchable: true,
      maxVisibleItems: 8,
      onChange,
      onClose: vi.fn(),
    })
    const initialKeyboardIndex = popup.debugState().keyboardIndex
    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      isComposing: true,
      cancelable: true,
    })
    const legacyArrow = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      cancelable: true,
    })
    Object.defineProperty(legacyArrow, 'keyCode', { value: 229 })

    expect(popup.onKeyDown(enter)).toBe(false)
    expect(popup.onKeyDown(legacyArrow)).toBe(false)
    expect(enter.defaultPrevented).toBe(false)
    expect(legacyArrow.defaultPrevented).toBe(false)
    expect(popup.debugState().keyboardIndex).toBe(initialKeyboardIndex)
    expect(onChange).not.toHaveBeenCalled()

    popup.dispose()
  })

  it('closes on Tab without consuming focus movement in non-search mode', () => {
    setPopupTestContext()
    const popup = new MultiSelectDropdownPopup()

    popup.open({
      options: [{ value: 'ts', label: 'TypeScript' }],
      selectedValues: ['ts'],
      anchor: staticAnchor(0, 0, 160, 24),
      searchable: false,
      maxVisibleItems: 8,
      onChange: vi.fn(),
      onClose: vi.fn(),
    })

    expect(popup.onKeyDown(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }))).toBe(false)
    expect(popup.visible).toBe(false)
  })

  it('builds grouped popup rows and ignores group header clicks', () => {
    setPopupTestContext()
    const onChange = vi.fn()
    const popup = new MultiSelectDropdownPopup()
    const dropdownStyle = deriveDropdownStyle(ImGuiDarkTheme)
    const popupStyle = derivePopupStyle(ImGuiDarkTheme)

    popup.open({
      options: [
        { value: 'ts', label: 'TypeScript', group: '前端' },
        { value: 'js', label: 'JavaScript', group: '前端' },
        { value: 'go', label: 'Go', group: '服务端' },
      ],
      selectedValues: [],
      anchor: staticAnchor(0, 0, 160, 24),
      searchable: false,
      maxVisibleItems: 8,
      onChange,
      onClose: vi.fn(),
    })

    expect(popup.debugState().rows).toEqual([
      { kind: 'group', label: '前端' },
      { kind: 'option', option: { value: 'ts', label: 'TypeScript', group: '前端' } },
      { kind: 'option', option: { value: 'js', label: 'JavaScript', group: '前端' } },
      { kind: 'group', label: '服务端' },
      { kind: 'option', option: { value: 'go', label: 'Go', group: '服务端' } },
    ])

    const headerCenterY = 24 + 2 + popupStyle.padding + dropdownStyle.itemHeight * 0.5
    popup.onPointerDown({
      pointerId: 0,
      position: { x: 12, y: headerCenterY },
      type: 'down',
    }, PopupManager.instance.context)

    expect(onChange).not.toHaveBeenCalled()

    popup.dispose()
  })

  it('renders grouped headers with a different text lane from selectable options', () => {
    setPopupTestContext()
    const popup = new MultiSelectDropdownPopup()
    const painted = createTextRecordingPaintContext()

    popup.open({
      options: [
        { value: 'ts', label: 'TypeScript', group: '前端' },
        { value: 'js', label: 'JavaScript', group: '前端' },
      ],
      selectedValues: [],
      anchor: staticAnchor(0, 0, 160, 24),
      searchable: false,
      maxVisibleItems: 8,
      onChange: vi.fn(),
      onClose: vi.fn(),
    })

    popup.paint(painted.context)

    const groupCall = painted.fillText.mock.calls.find(call => call[0] === '前端')
    const optionCall = painted.fillText.mock.calls.find(call => call[0] === 'TypeScript')

    expect(groupCall).toBeDefined()
    expect(optionCall).toBeDefined()
    expect(Number(optionCall?.[1])).toBeGreaterThan(Number(groupCall?.[1]))

    popup.dispose()
  })

  it('paints checkbox affordances before selectable popup options', () => {
    setPopupTestContext()
    const popup = new MultiSelectDropdownPopup()
    const painted = createStyleRecordingPaintContext()
    const checkboxStyle = deriveCheckboxStyle(ImGuiDarkTheme)
    const dropdownStyle = deriveDropdownStyle(ImGuiDarkTheme)
    const treeStyle = deriveTreeStyle(ImGuiDarkTheme)

    popup.open({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
      ],
      selectedValues: ['ts'],
      anchor: staticAnchor(0, 0, 160, 24),
      searchable: false,
      maxVisibleItems: 8,
      onChange: vi.fn(),
      onClose: vi.fn(),
    })

    popup.paint(painted.context)

    expect(painted.fillStyles).toContain(colorToCSS(treeStyle.panelBg))
    expect(painted.fillStyles).toContain(colorToCSS(resolveBgColor(checkboxStyle.checkedBoxBg, 'normal')))
    expect(painted.fillStyles).toContain(colorToCSS(resolveBgColor(checkboxStyle.boxBg, 'normal')))
    expect(painted.strokeStyles).toContain(colorToCSS(resolveBgColor(checkboxStyle.boxBorder, 'normal')))
    expect(painted.strokeStyles).toContain(colorToCSS(resolveTextColor(checkboxStyle.checkMark, 'normal')))
    expect(painted.strokeStyles).toContain(colorToCSS(dropdownStyle.separator))

    popup.dispose()
  })

  it('does not paint the first option as hovered after the pointer leaves the popup list', () => {
    setPopupTestContext()
    const popup = new MultiSelectDropdownPopup()
    const popupStyle = derivePopupStyle(ImGuiDarkTheme)
    const dropdownStyle = deriveDropdownStyle(ImGuiDarkTheme)
    const painted = createStyleRecordingPaintContext()

    popup.open({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
      ],
      selectedValues: [],
      anchor: staticAnchor(0, 0, 160, 24),
      searchable: false,
      maxVisibleItems: 8,
      onChange: vi.fn(),
      onClose: vi.fn(),
    })

    popup.onPointerMove({
      pointerId: 0,
      position: {
        x: 12,
        y: 24 + 2 + popupStyle.padding + dropdownStyle.itemHeight * 0.5,
      },
      type: 'move',
    }, PopupManager.instance.context)
    popup.onPointerMove({
      pointerId: 0,
      position: { x: 220, y: 24 + 2 + popupStyle.padding + dropdownStyle.itemHeight * 0.5 },
      type: 'move',
    }, PopupManager.instance.context)

    popup.paint(painted.context)

    expect((popup as any)._hoveredRowKind).toBe('none')
    expect((popup as any)._hoveredValue).toBe('')
    expect(painted.fillStyles).not.toContain(colorToCSS(resolveBgColor(dropdownStyle.itemBg, 'hovered')))

    popup.dispose()
  })

  it('keeps keyboard-focused rows visible when viewport height reduces visible rows', () => {
    setPopupTestContext({ width: 240, height: 128, dpr: 1 })
    const popup = new MultiSelectDropdownPopup()

    popup.open({
      options: Array.from({ length: 8 }, (_, index) => ({
        value: `value-${index}`,
        label: `Option ${index}`,
      })),
      selectedValues: [],
      anchor: staticAnchor(10, 84, 160, 24),
      searchable: false,
      maxVisibleItems: 8,
      onChange: vi.fn(),
      onClose: vi.fn(),
    })

    popup.onKeyDown(new KeyboardEvent('keydown', { key: 'End', cancelable: true }))
    const state = popup.debugState()
    const visibleRows = (popup as any)._popupLayout(PopupManager.instance.context).visibleRows as number

    expect(state.keyboardIndex).toBe(7)
    expect(state.scrollOffset).toBeGreaterThan(0)
    expect(state.scrollOffset).toBeLessThanOrEqual(7)
    expect(7).toBeLessThan(state.scrollOffset + visibleRows)

    popup.dispose()
  })

  it('paints footer buttons with hover state and outlines', () => {
    setPopupTestContext()
    const popup = new MultiSelectDropdownPopup()
    const painted = createStyleRecordingPaintContext()
    const popupStyle = derivePopupStyle(ImGuiDarkTheme)
    const dropdownStyle = deriveDropdownStyle(ImGuiDarkTheme)

    popup.open({
      options: [{ value: 'ts', label: 'TypeScript' }],
      selectedValues: [],
      anchor: staticAnchor(0, 0, 180, 24),
      searchable: false,
      maxVisibleItems: 8,
      showFooter: true,
      commitOnChange: false,
      onChange: vi.fn(),
      onConfirm: vi.fn(),
      onClear: vi.fn(),
      onClose: vi.fn(),
    })

    const metrics = (popup as any)._listMetrics(PopupManager.instance.context) as {
      rect: { x: number; w: number }
      contentY: number
      listHeight: number
    }
    popup.onPointerMove({
      pointerId: 0,
      position: {
        x: metrics.rect.x + metrics.rect.w / 2,
        y: metrics.contentY + metrics.listHeight + popupStyle.padding + dropdownStyle.itemHeight / 2,
      },
      type: 'move',
    }, PopupManager.instance.context)
    popup.paint(painted.context)

    expect(popup.debugState().hoveredFooterAction).toBe('cancel')
    expect(painted.fillStyles).toContain(colorToCSS(resolveBgColor(dropdownStyle.itemBg, 'hovered')))
    expect(painted.strokeStyles).toContain(colorToCSS(dropdownStyle.separator))

    popup.dispose()
  })

  it('closes after a footer confirm callback throws', () => {
    setPopupTestContext()
    const error = new Error('multi-select confirm failed')
    const popup = new MultiSelectDropdownPopup()
    popup.open({
      options: [{ value: 'ts', label: 'TypeScript' }],
      selectedValues: ['ts'],
      anchor: staticAnchor(0, 0, 180, 24),
      searchable: false,
      maxVisibleItems: 8,
      showFooter: true,
      commitOnChange: false,
      onChange: vi.fn(),
      onConfirm: () => { throw error },
      onClose: vi.fn(),
    })

    expect(() => (popup as any)._confirmSelection()).toThrow(error)
    expect(popup.visible).toBe(false)
    expect(PopupManager.instance.current).toBe(null)

    popup.dispose()
  })

  it('clears footer selection and closes the popup', () => {
    setPopupTestContext()
    const popup = new MultiSelectDropdownPopup()
    const onClear = vi.fn()

    popup.open({
      options: [
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
      ],
      selectedValues: ['ts'],
      anchor: staticAnchor(0, 0, 180, 24),
      searchable: false,
      maxVisibleItems: 8,
      showFooter: true,
      commitOnChange: false,
      onChange: vi.fn(),
      onConfirm: vi.fn(),
      onClear,
      onClose: vi.fn(),
    })

    const metrics = (popup as any)._listMetrics(PopupManager.instance.context) as {
      rect: { x: number; w: number }
      contentY: number
      listHeight: number
      itemHeight: number
    }
    const clearPoint = {
      x: metrics.rect.x + metrics.rect.w * 5 / 6,
      y: metrics.contentY + metrics.listHeight + derivePopupStyle(ImGuiDarkTheme).padding + metrics.itemHeight / 2,
    }
    expect((popup as any)._footerActionAt(clearPoint, PopupManager.instance.context)).toBe('clear')

    popup.onPointerDown({
      pointerId: 0,
      position: clearPoint,
      type: 'down',
      button: 0,
      buttons: 1,
      pointerType: 'mouse',
    }, PopupManager.instance.context)

    expect(onClear).toHaveBeenCalledTimes(1)
    expect(popup.visible).toBe(false)
  })

  it('does not fall back to highlighting the first option when hovering a group header', () => {
    setPopupTestContext()
    const popup = new MultiSelectDropdownPopup()
    const popupStyle = derivePopupStyle(ImGuiDarkTheme)
    const dropdownStyle = deriveDropdownStyle(ImGuiDarkTheme)

    popup.open({
      options: [
        { value: 'ts', label: 'TypeScript', group: '前端' },
        { value: 'js', label: 'JavaScript', group: '前端' },
      ],
      selectedValues: [],
      anchor: staticAnchor(0, 0, 160, 24),
      searchable: false,
      maxVisibleItems: 8,
      onChange: vi.fn(),
      onClose: vi.fn(),
    })

    popup.onPointerMove({
      pointerId: 0,
      position: {
        x: 12,
        y: 24 + 2 + popupStyle.padding + dropdownStyle.itemHeight * 0.5,
      },
      type: 'move',
    }, PopupManager.instance.context)

    expect((popup as any)._hoveredRowKind).toBe('group')
    expect((popup as any)._hoveredValue).toBe('')
    expect((popup as any)._activeIndex()).toBe(-1)

    popup.dispose()
  })

  it('supports wheel scrolling and scrollbar track clicks when rows overflow', () => {
    setPopupTestContext()
    const popup = new MultiSelectDropdownPopup()

    popup.open({
      options: Array.from({ length: 12 }, (_, index) => ({
        value: `value-${index}`,
        label: `Option ${index}`,
        group: index < 6 ? '前端' : '后端',
      })),
      selectedValues: [],
      anchor: staticAnchor(0, 0, 160, 24),
      searchable: false,
      maxVisibleItems: 4,
      onChange: vi.fn(),
      onClose: vi.fn(),
    })

    expect(popup.onWheel({
      pointerId: 0,
      position: { x: 12, y: 40 },
      type: 'wheel',
      deltaX: 120,
      deltaY: 0,
    }, PopupManager.instance.context)).toBe(false)

    expect(popup.onWheel({
      pointerId: 0,
      position: { x: 12, y: 40 },
      type: 'wheel',
      deltaX: 0,
      deltaY: 120,
    }, PopupManager.instance.context)).toBe(true)

    expect(popup.debugState().scrollOffset).toBe(3)

    const scrollbar = (popup as any)._scrollbarMetrics(PopupManager.instance.context) as {
      x: number
      y: number
      w: number
      h: number
    }

    popup.onPointerDown({
      pointerId: 0,
      position: {
        x: scrollbar.x + scrollbar.w / 2,
        y: scrollbar.y + scrollbar.h - 2,
      },
      type: 'down',
    }, PopupManager.instance.context)

    expect(popup.debugState().scrollOffset).toBeGreaterThan(1)

    popup.dispose()
  })

  it('clears scrollbar drag state when closed mid-drag', () => {
    setPopupTestContext()
    const popup = new MultiSelectDropdownPopup()

    popup.open({
      options: Array.from({ length: 12 }, (_, index) => ({
        value: `value-${index}`,
        label: `Option ${index}`,
        group: index < 6 ? '前端' : '后端',
      })),
      selectedValues: [],
      anchor: staticAnchor(0, 0, 160, 24),
      searchable: false,
      maxVisibleItems: 4,
      onChange: vi.fn(),
      onClose: vi.fn(),
    })

    const scrollbar = (popup as any)._scrollbarMetrics(PopupManager.instance.context) as {
      x: number
      thumbY: number
      thumbH: number
    }

    popup.onPointerDown({
      pointerId: 4,
      position: {
        x: scrollbar.x + 2,
        y: scrollbar.thumbY + scrollbar.thumbH / 2,
      },
      type: 'down',
    }, PopupManager.instance.context)

    expect((popup as any)._scrollbarDragging).toBe(true)

    popup.close()

    expect((popup as any)._scrollbarDragging).toBe(false)
    expect((popup as any)._scrollbarPointerKey).toBeUndefined()

    popup.dispose()
  })

  it('does not let mouse zero terminate a touch zero scrollbar drag', () => {
    setPopupTestContext()
    const popup = new MultiSelectDropdownPopup()
    popup.open({
      options: Array.from({ length: 12 }, (_, index) => ({
        value: `value-${index}`,
        label: `Option ${index}`,
      })),
      selectedValues: [],
      anchor: staticAnchor(0, 0, 160, 24),
      searchable: false,
      maxVisibleItems: 4,
      onChange: vi.fn(),
      onClose: vi.fn(),
    })
    const scrollbar = (popup as any)._scrollbarMetrics(PopupManager.instance.context) as {
      x: number
      thumbY: number
      thumbH: number
    }
    const downY = scrollbar.thumbY + scrollbar.thumbH / 2

    popup.onPointerDown({
      pointerId: 0,
      pointerType: 'touch',
      position: { x: scrollbar.x + 2, y: downY },
      type: 'down',
    }, PopupManager.instance.context)
    popup.onPointerCancel({
      pointerId: 0,
      pointerType: 'mouse',
      position: { x: scrollbar.x + 2, y: downY },
      type: 'cancel',
    })

    expect((popup as any)._scrollbarDragging).toBe(true)

    popup.onPointerCancel({
      pointerId: 0,
      pointerType: 'touch',
      position: { x: scrollbar.x + 2, y: downY },
      type: 'cancel',
    })

    expect((popup as any)._scrollbarDragging).toBe(false)
    popup.dispose()
  })

  it('consumes trigger clicks as toggle-close when the popup is already open', () => {
    setPopupTestContext()
    const popup = new MultiSelectDropdownPopup()

    popup.open({
      options: [{ value: 'ts', label: 'TypeScript' }],
      selectedValues: ['ts'],
      anchor: staticAnchor(0, 0, 160, 24),
      searchable: false,
      maxVisibleItems: 8,
      onChange: vi.fn(),
      onClose: vi.fn(),
    })

    const consumed = PopupManager.instance.handlePointerDown({
      pointerId: 0,
      position: { x: 12, y: 12 },
      type: 'down',
    })

    expect(consumed).toBe(true)
    expect(popup.visible).toBe(false)

    popup.dispose()
  })
})


it('owner-input drafts preserve selection order, report toggles without committing, and leave text/IME to the host', () => {
  setPopupTestContext()
  const confirm = vi.fn(), changed = vi.fn(), draft = vi.fn(), popup = new MultiSelectDropdownPopup()
  popup.open({ options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }], selectedValues: ['b', 'a'],
    anchor: staticAnchor(0, 0, 160, 20), searchable: false, maxVisibleItems: 8, ownerInput: true, preserveSelectionOrder: true, commitOnChange: false, showFooter: true,
    onChange: changed, onDraftChange: draft, onConfirm: confirm, onClose: vi.fn() })
  for (const key of ['x', ' ', 'Home', 'ArrowLeft', 'Enter']) expect(popup.onKeyDown(new KeyboardEvent('keydown', { key }))).toBe(false)
  expect(popup.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown', isComposing: true }))).toBe(false)
  expect(popup.selectedValues).toEqual(['b', 'a'])
  popup.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
  popup.onKeyDown(new KeyboardEvent('keydown', { key: ' ' }))
  expect(draft).toHaveBeenLastCalledWith(['b', 'a', 'c'], { value: 'c', selected: true }); expect(changed).not.toHaveBeenCalled()
  popup.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))
  expect(confirm.mock.calls[0]![0]).toEqual(['b', 'a', 'c']); popup.dispose()
})
