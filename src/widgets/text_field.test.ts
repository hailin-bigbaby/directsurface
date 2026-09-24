import { afterEach, describe, expect, it, vi } from 'vitest'
import { PipelineOwner, type BoxConstraints } from '../core/render_object'
import { InputComposer } from '../core/input_composer'
import { FocusManager } from '../core/focus_manager'
import { TextMeasurer } from '../core/text_measurer'
import { GestureArenaManager, type GestureArenaMember } from '../gestures/gesture_arena'
import { ImGuiDarkTheme, ImGuiLightTheme } from '../theme/default_theme'
import { colorToCSS } from '../theme/theme'
import { deriveTextInputStyle, resolveBgColor } from '../theme/component_styles'
import { PaintContext } from '../rendering/paint_context'
import { RenderTextBox } from './text_field'
import type { ValueEditor } from './value_editor'

const constraints: BoxConstraints = {
  minWidth: 0,
  maxWidth: 200,
  minHeight: 0,
  maxHeight: 40,
}

function paintTextFieldShell(
  field: RenderTextBox,
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
    measureText: vi.fn(() => ({ width: 10 })),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    set fillStyle(value: string) { fillStyle = value },
    get fillStyle() { return fillStyle },
    set strokeStyle(value: string) { strokeStyle = value },
    get strokeStyle() { return strokeStyle },
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D
  field.performPaint(new PaintContext(ctx, theme), { x: 0, y: 0 })
  return { fillStyles, strokeStyles }
}

function inputElement(): HTMLTextAreaElement {
  const ta = document.getElementById('__ds_ui_input__') as HTMLTextAreaElement | null
  if (!ta) throw new Error('InputComposer textarea was not created')
  return ta
}

function pasteEvent(text: string): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) => type === 'text/plain' || type === 'text' ? text : '',
    },
  })
  return event
}

afterEach(() => {
  FocusManager.instance.dispose()
  InputComposer.instance.dispose()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('RenderTextBox input lifecycle', () => {
  it('provides adapters with the edit selection before a paste', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const transform = vi.fn((value, context) => ({
      value,
      selectionStart: context.selectionStart,
      selectionEnd: context.selectionEnd,
    }))
    const field = new RenderTextBox({
      value: 'abc',
      inputAdapter: { transform },
    })

    field.focusIn()
    const input = inputElement()
    input.setSelectionRange(1, 2)
    input.dispatchEvent(pasteEvent('X'))

    expect(field.value).toBe('aXc')
    expect(transform).toHaveBeenCalledWith('aXc', expect.objectContaining({
      value: 'abc',
      selectionStart: 2,
      selectionEnd: 2,
      previousSelectionStart: 1,
      previousSelectionEnd: 2,
      source: 'paste',
    }))
    field.dispose()
  })

  it('defaults missing values to an empty string', () => {
    const field = new RenderTextBox({})

    expect(field.value).toBe('')

    field.dispose()
  })

  it('keeps a prefilled value visible when focus precedes first layout', () => {
    vi.useFakeTimers()
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const field = new RenderTextBox({
      value: 'Pointer created 1',
      clearable: true,
    })

    field.focusIn()
    expect((field as any)._textInput.scrollX).toBe(0)

    field.layout(constraints)

    expect((field as any)._textInput.scrollX).toBe(0)
    expect((field as any)._textInput.cursorPos).toBe(field.value.length)
    expect(InputComposer.instance.value).toBe(field.value)

    field.dispose()
  })

  it('does not update readonly values from InputComposer input', () => {
    vi.useFakeTimers()
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const onChange = vi.fn()
    const field = new RenderTextBox({
      value: 'locked',
      readonly: true,
      onChange,
    })

    field.focusIn()
    const ta = inputElement()
    ta.value = 'changed'
    ta.dispatchEvent(new Event('input'))

    expect(field.value).toBe('locked')
    expect(onChange).not.toHaveBeenCalled()

    field.dispose()
  })

  it('emits blur once when focus leaves the field', () => {
    const onBlur = vi.fn()
    const field = new RenderTextBox({
      value: 'admin',
      onBlur,
    })

    field.focusIn()
    field.focusOut()
    field.focusOut()

    expect(onBlur).toHaveBeenCalledTimes(1)
    expect(onBlur).toHaveBeenCalledWith('admin')

    field.dispose()
  })

  it('implements the value-editor contract without replacing legacy callbacks', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const onChange = vi.fn()
    const onBlur = vi.fn()
    const firstChange = vi.fn()
    const secondChange = vi.fn()
    const blurListener = vi.fn()
    const field = new RenderTextBox({
      value: 'initial',
      onChange,
      onBlur,
    })
    const editor: ValueEditor<string> = field
    field.subscribeValueChange(firstChange)
    field.subscribeValueChange(secondChange)
    field.subscribeBlur(blurListener)

    editor.setValue('model')

    expect(editor.getValue()).toBe('model')
    expect(onChange).not.toHaveBeenCalled()
    expect(firstChange).not.toHaveBeenCalled()

    field.requestFocus()
    const input = inputElement()
    input.value = 'typed'
    input.setSelectionRange(5, 5)
    input.dispatchEvent(new Event('input'))

    expect(FocusManager.instance.current).toBe(field)
    expect(onChange).toHaveBeenCalledWith('typed')
    expect(firstChange).toHaveBeenCalledWith({
      value: 'typed',
      previousValue: 'model',
      reason: 'input',
      detail: undefined,
    })
    expect(secondChange).toHaveBeenCalledWith({
      value: 'typed',
      previousValue: 'model',
      reason: 'input',
      detail: undefined,
    })

    field.blur()
    field.blur()

    expect(FocusManager.instance.current).toBeNull()
    expect(onBlur).toHaveBeenCalledTimes(1)
    expect(onBlur).toHaveBeenCalledWith('typed')
    expect(blurListener).toHaveBeenCalledTimes(1)

    field.dispose()
  })

  it('publishes the structured value event even when legacy onChange throws', () => {
    const failure = new Error('legacy failed')
    const listener = vi.fn()
    const field = new RenderTextBox({
      value: 'before',
      onChange: () => { throw failure },
    })
    field.subscribeValueChange(listener)

    expect(() => (field as any)._publishUserValueChange({
      value: 'after',
      previousValue: 'before',
      selectionStart: 5,
      selectionEnd: 5,
      changed: true,
    }, 'input')).toThrow(failure)

    expect(listener).toHaveBeenCalledWith({
      value: 'after',
      previousValue: 'before',
      reason: 'input',
      detail: undefined,
    })

    field.dispose()
  })

  it('finishes disabling and notifies every blur listener when one throws', () => {
    const failure = new Error('blur failed')
    const secondBlur = vi.fn()
    const field = new RenderTextBox({ value: 'draft' })
    field.subscribeBlur(() => { throw failure })
    field.subscribeBlur(secondBlur)
    field.focusIn()

    expect(() => { field.disabled = true }).toThrow(failure)
    expect(field.disabled).toBe(true)
    expect(field.isFocused).toBe(false)
    expect(secondBlur).toHaveBeenCalledOnce()

    field.disabled = false
    field.dispose()
  })

  it('preserves the public keydown callback identity across runtime assignment', () => {
    const initial = vi.fn(() => false)
    const replacement = vi.fn(() => true)
    const field = new RenderTextBox({
      value: '',
      onKeyDown: initial,
    })

    expect(field.onKeyDown).toBe(initial)

    field.onKeyDown = replacement
    expect(field.onKeyDown).toBe(replacement)

    field.onKeyDown = undefined
    expect(field.onKeyDown).toBeUndefined()
    field.dispose()
  })

  it('allows wrapping the previous keydown callback without recursion', () => {
    const initial = vi.fn(() => false)
    const field = new RenderTextBox({
      value: '',
      onKeyDown: initial,
    })
    const previous = field.onKeyDown
    const wrapper = vi.fn((event: KeyboardEvent) => previous?.(event))
    field.onKeyDown = wrapper
    FocusManager.instance.setFocus(field)
    const event = new KeyboardEvent('keydown', {
      key: 'F2',
      bubbles: true,
      cancelable: true,
    })

    inputElement().dispatchEvent(event)

    expect(wrapper).toHaveBeenCalledOnce()
    expect(wrapper).toHaveBeenCalledWith(event)
    expect(initial).toHaveBeenCalledOnce()
    expect(initial).toHaveBeenCalledWith(event)
    expect(event.defaultPrevented).toBe(false)
    field.dispose()
  })

  it('recognizes browser and legacy IME keydown markers', () => {
    const field = new RenderTextBox({ value: '' })
    const browserEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      isComposing: true,
    })
    const legacyEvent = new KeyboardEvent('keydown', { key: 'Enter' })
    Object.defineProperty(legacyEvent, 'keyCode', { value: 229 })

    expect(field.shouldIgnoreKeyDown(browserEvent)).toBe(true)
    expect(field.shouldIgnoreKeyDown(legacyEvent)).toBe(true)
    expect(field.shouldIgnoreKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false)
    field.dispose()
  })

  it('does not call keydown or submit callbacks on Enter while IME composition is active', () => {
    const onSubmit = vi.fn()
    const onKeyDown = vi.fn(() => false)
    const field = new RenderTextBox({
      value: '',
      onSubmit,
      onKeyDown,
    })
    FocusManager.instance.setFocus(field)
    const input = inputElement()
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })

    input.dispatchEvent(enter)

    expect(enter.defaultPrevented).toBe(false)
    expect(onKeyDown).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(field.isFocused).toBe(true)

    input.dispatchEvent(new CompositionEvent('compositionend', {
      data: '',
      bubbles: true,
    }))
    const normalKey = new KeyboardEvent('keydown', {
      key: 'F2',
      bubbles: true,
      cancelable: true,
    })
    input.dispatchEvent(normalKey)
    expect(onKeyDown).toHaveBeenCalledTimes(1)
    field.dispose()
  })

  it('keeps the transient caret at the end of IME text replacing a selection', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const moveTo = vi.fn()
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      stroke: vi.fn(),
      moveTo,
      lineTo: vi.fn(),
      set strokeStyle(_value: string) {},
      get strokeStyle() { return '' },
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D
    const field = new RenderTextBox({ value: '2' })
    const style = deriveTextInputStyle(ImGuiDarkTheme)
    field.offset = { x: 0, y: 0 }
    field.layout(constraints)
    field.focusIn()
    ;(field as any)._textInput.setSelection(0, 1, { cursorPos: 1, syncComposer: true })

    const input = inputElement()
    input.dispatchEvent(new CompositionEvent('compositionstart'))
    input.dispatchEvent(new CompositionEvent('compositionupdate', { data: '中' }))

    field.performTransientPaint(new PaintContext(ctx, ImGuiDarkTheme), { x: 0, y: 0 })

    expect(moveTo).toHaveBeenLastCalledWith(style.padding + 8, 4)

    field.dispose()
  })

  it('blocks composer input after readonly is enabled dynamically', () => {
    vi.useFakeTimers()
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const onChange = vi.fn()
    const field = new RenderTextBox({
      value: 'open',
      onChange,
    })

    field.focusIn()
    field.readonly = true
    const ta = inputElement()
    ta.value = 'changed'
    ta.dispatchEvent(new Event('input'))

    expect(field.value).toBe('open')
    expect(onChange).not.toHaveBeenCalled()

    field.dispose()
  })

  it('syncs reset values to the active InputComposer session', () => {
    vi.useFakeTimers()
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const field = new RenderTextBox({
      value: 'old',
    })

    field.focusIn()
    field.reset('new')

    expect(field.value).toBe('new')
    expect(InputComposer.instance.value).toBe('new')

    field.dispose()
  })

  it('handles paste from clipboard data without waiting for native textarea insertion', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const onChange = vi.fn()
    const field = new RenderTextBox({
      value: 'hello',
      maxLength: 8,
      onChange,
    })

    field.focusIn()
    const ta = inputElement()
    const paste = pasteEvent(' world')
    ta.dispatchEvent(paste)

    expect(paste.defaultPrevented).toBe(true)
    expect(field.value).toBe('hello wo')
    expect(onChange).toHaveBeenCalledWith('hello wo')
    expect(ta.value).toBe('hello wo')

    field.dispose()
  })

  it('syncs direct value assignment to the active InputComposer session', () => {
    vi.useFakeTimers()
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const field = new RenderTextBox({
      value: 'old',
    })

    field.focusIn()
    field.value = 'new'

    expect(field.value).toBe('new')
    expect(InputComposer.instance.value).toBe('new')

    field.dispose()
  })

  it('does not let old blur close another field session', () => {
    vi.useFakeTimers()
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const first = new RenderTextBox({ value: 'one' })
    const second = new RenderTextBox({ value: 'two' })

    first.focusIn()
    second.focusIn()
    first.focusOut()

    expect(InputComposer.instance.hasSession).toBe(true)
    expect(InputComposer.instance.value).toBe('two')

    first.dispose()
    second.dispose()
  })

  it('positions the shared composer in logical pixels when devicePixelRatio is greater than 1', () => {
    vi.stubGlobal('devicePixelRatio', 2)
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const field = new RenderTextBox({
      value: 'ab',
    })
    const updatePosition = vi.spyOn(InputComposer.instance, 'updatePosition')
    const style = deriveTextInputStyle(ImGuiDarkTheme)

    field.offset = { x: 20, y: 30 }
    field.layout(constraints)
    field.focusIn()

    expect(updatePosition).toHaveBeenLastCalledWith(20 + style.padding + 16, 30 + style.padding + 5)

    field.dispose()
  })

  it('keeps pointer down editing side effects before drag acceptance', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const arena = new GestureArenaManager()
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    const field = new RenderTextBox({
      value: 'abcdef',
    })

    field.offset = { x: 0, y: 0 }
    field.layout(constraints)
    field.onPointerDown({
      pointerId: 1,
      position: { x: 16, y: 10 },
      type: 'down',
      setPointerCapture,
      releasePointerCapture,
      joinGestureArena: member => arena.add(1, member),
    })
    arena.close(1)
    field.onPointerMove({ pointerId: 1, position: { x: 17, y: 11 }, type: 'move' })

    expect(field.isFocused).toBe(true)
    expect(InputComposer.instance.hasSession).toBe(true)
    expect(setPointerCapture).not.toHaveBeenCalled()

    field.onPointerUp({ pointerId: 1, position: { x: 17, y: 11 }, type: 'up' })

    expect(field.isFocused).toBe(true)
    expect(releasePointerCapture).not.toHaveBeenCalled()

    field.dispose()
  })

  it('prevents a foreign pointer from contributing activation while selection owns the field', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const arena = new GestureArenaManager()
    const preventActivation = vi.fn()
    const field = new RenderTextBox({ value: 'abcdef' })
    field.offset = { x: 0, y: 0 }
    field.layout(constraints)

    field.onPointerDown({
      pointerId: 0,
      pointerType: 'touch',
      position: { x: 16, y: 10 },
      type: 'down',
      joinGestureArena: member =>
        arena.add({ pointerId: 0, pointerType: 'touch' }, member),
    })
    field.onPointerDown({
      pointerId: 0,
      pointerType: 'mouse',
      position: { x: 24, y: 10 },
      type: 'down',
      preventActivation,
    })

    expect(preventActivation).toHaveBeenCalledOnce()

    field.onPointerCancel({
      pointerId: 0,
      pointerType: 'touch',
      position: { x: 16, y: 10 },
      type: 'cancel',
    })
    field.dispose()
  })

  it('selects the word under the pointer when double-clicking the input area', () => {
    vi.useFakeTimers()
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const field = new RenderTextBox({ value: 'product name' })
    const style = deriveTextInputStyle(ImGuiDarkTheme)

    field.offset = { x: 0, y: 0 }
    field.layout(constraints)
    field.onDoubleClick({ x: style.padding + 8 * 9, y: style.height / 2 })

    expect(field.isFocused).toBe(true)
    expect(InputComposer.instance.selectionStart).toBe(8)
    expect(InputComposer.instance.selectionEnd).toBe(field.value.length)
    expect((field as any)._textInput.selStart).toBe(8)
    expect((field as any)._textInput.selEnd).toBe(field.value.length)

    field.dispose()
  })

  it('allows readonly text fields to select all text on double-click', () => {
    vi.useFakeTimers()
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const field = new RenderTextBox({ value: 'locked', readonly: true })
    const style = deriveTextInputStyle(ImGuiDarkTheme)

    field.offset = { x: 0, y: 0 }
    field.layout(constraints)
    field.onDoubleClick({ x: style.padding + 8, y: style.height / 2 })

    expect(field.isFocused).toBe(true)
    expect(InputComposer.instance.selectionStart).toBe(0)
    expect(InputComposer.instance.selectionEnd).toBe(field.value.length)

    field.dispose()
  })

  it('focuses but keeps an empty selection when double-clicking an empty text field', () => {
    vi.useFakeTimers()
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const field = new RenderTextBox({ value: '' })
    const style = deriveTextInputStyle(ImGuiDarkTheme)

    field.offset = { x: 0, y: 0 }
    field.layout(constraints)
    field.onDoubleClick({ x: style.padding + 8, y: style.height / 2 })

    expect(field.isFocused).toBe(true)
    expect(InputComposer.instance.selectionStart).toBe(0)
    expect(InputComposer.instance.selectionEnd).toBe(0)

    field.dispose()
  })

  it('ignores double-clicks on disabled text fields', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const field = new RenderTextBox({ value: 'disabled', disabled: true })
    const style = deriveTextInputStyle(ImGuiDarkTheme)

    field.offset = { x: 0, y: 0 }
    field.layout(constraints)
    field.onDoubleClick({ x: style.padding + 8, y: style.height / 2 })

    expect(field.isFocused).toBe(false)
    expect(InputComposer.instance.hasSession).toBe(false)
    expect((field as any)._textInput.selStart).toBe(0)
    expect((field as any)._textInput.selEnd).toBe(0)

    field.dispose()
  })

  it('does not select text when double-clicking the trailing icon', () => {
    vi.useFakeTimers()
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const onTrailingIconClick = vi.fn()
    const field = new RenderTextBox({
      value: 'search',
      trailingIcon: 'search',
      onTrailingIconClick,
    })

    field.offset = { x: 0, y: 0 }
    field.layout(constraints)
    const trailingRect = (field as any)._inlineLayout().trailingRect
    field.onDoubleClick({
      x: trailingRect.x + trailingRect.w / 2,
      y: trailingRect.y + trailingRect.h / 2,
    })

    expect(field.isFocused).toBe(false)
    expect(onTrailingIconClick).not.toHaveBeenCalled()
    expect(InputComposer.instance.hasSession).toBe(false)

    field.dispose()
  })

  it('accepts horizontal selection drag after slop and releases on up', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const arena = new GestureArenaManager()
    const competitor: GestureArenaMember = {
      acceptGesture: vi.fn(),
      rejectGesture: vi.fn(),
    }
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    const field = new RenderTextBox({
      value: 'abcdef',
    })

    field.offset = { x: 0, y: 0 }
    field.layout(constraints)
    field.onPointerDown({
      pointerId: 1,
      position: { x: 16, y: 10 },
      type: 'down',
      setPointerCapture,
      releasePointerCapture,
      joinGestureArena: member => arena.add(1, member),
    })
    arena.add(1, competitor)
    arena.close(1)
    field.onPointerMove({ pointerId: 1, position: { x: 56, y: 11 }, type: 'move' })

    expect(setPointerCapture).toHaveBeenCalledTimes(1)
    expect(competitor.rejectGesture).toHaveBeenCalledWith(1)
    expect((field as any)._dragging).toBe(true)

    field.onPointerUp({ pointerId: 1, position: { x: 56, y: 11 }, type: 'up' })
    field.onPointerMove({ pointerId: 1, position: { x: 88, y: 11 }, type: 'move' })

    expect(releasePointerCapture).toHaveBeenCalledTimes(1)
    expect((field as any)._dragging).toBe(false)

    field.dispose()
  })

  it('releases text selection capture when readonly is enabled during a drag', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const arena = new GestureArenaManager()
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    const field = new RenderTextBox({
      value: 'abcdef',
    })

    field.offset = { x: 0, y: 0 }
    field.layout(constraints)
    field.onPointerDown({
      pointerId: 1,
      position: { x: 16, y: 10 },
      type: 'down',
      setPointerCapture,
      releasePointerCapture,
      joinGestureArena: member => arena.add(1, member),
    })
    arena.close(1)
    field.onPointerMove({ pointerId: 1, position: { x: 56, y: 11 }, type: 'move' })

    expect(setPointerCapture).toHaveBeenCalledTimes(1)
    expect((field as any)._dragging).toBe(true)

    field.readonly = true

    expect(releasePointerCapture).toHaveBeenCalledTimes(1)
    expect((field as any)._dragging).toBe(false)
    expect(field.isFocused).toBe(true)

    field.dispose()
  })

  it('rejects vertical drag intent without capturing or ending editing', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const arena = new GestureArenaManager()
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    const field = new RenderTextBox({
      value: 'abcdef',
    })

    field.offset = { x: 0, y: 0 }
    field.layout(constraints)
    field.onPointerDown({
      pointerId: 1,
      position: { x: 16, y: 10 },
      type: 'down',
      setPointerCapture,
      releasePointerCapture,
      joinGestureArena: member => arena.add(1, member),
    })
    arena.close(1)
    field.onPointerMove({ pointerId: 1, position: { x: 17, y: 30 }, type: 'move' })
    field.onPointerUp({ pointerId: 1, position: { x: 17, y: 30 }, type: 'up' })

    expect(field.isFocused).toBe(true)
    expect(setPointerCapture).not.toHaveBeenCalled()
    expect(releasePointerCapture).not.toHaveBeenCalled()
    expect((field as any)._dragging).toBe(false)

    field.dispose()
  })

  it('re-derives layout metrics from the pipeline theme context', () => {
    const owner = new PipelineOwner({}, ImGuiDarkTheme)
    const field = new RenderTextBox({ value: 'text' })

    field.attach(owner)
    field.layout(constraints)

    const nextTheme = { ...ImGuiLightTheme, fontSize: ImGuiLightTheme.fontSize + 2 }
    owner.setTheme(nextTheme)
    field.markNeedsLayout()
    owner.flushLayout()

    expect(field.size.height).toBe(deriveTextInputStyle(nextTheme).height)

    field.dispose()
  })

  it('uses the paint context theme without storing it on the widget', () => {
    const field = new RenderTextBox({ value: 'text' })
    const style = deriveTextInputStyle(ImGuiLightTheme)
    field.size = { width: 200, height: style.height }

    const painted = paintTextFieldShell(field, ImGuiLightTheme)

    expect(painted.fillStyles[0]).toBe(colorToCSS(resolveBgColor(style.inputBg, 'normal')))
    expect(painted.strokeStyles[0]).toBe(colorToCSS(resolveBgColor(style.inputBorder, 'normal')))

    field.dispose()
  })

  it('uses token-derived focused shell colors when painted', () => {
    const field = new RenderTextBox({
      value: 'text',
    })
    const style = deriveTextInputStyle(ImGuiDarkTheme)
    field.size = { width: 200, height: style.height }
    ;(field as any)._focused = true

    const painted = paintTextFieldShell(field)

    expect(painted.fillStyles[0]).toBe(colorToCSS(resolveBgColor(style.inputBg, 'focused')))
    expect(painted.strokeStyles[0]).toBe(colorToCSS(resolveBgColor(style.inputBorder, 'focused')))

    field.dispose()
  })

  it('clamps composer input to maxLength', () => {
    vi.useFakeTimers()
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const onChange = vi.fn()
    const field = new RenderTextBox({
      value: '',
      maxLength: 3,
      onChange,
    })

    field.focusIn()
    const ta = inputElement()
    ta.value = 'abcdef'
    ta.dispatchEvent(new Event('input'))

    expect(field.value).toBe('abc')
    expect(InputComposer.instance.value).toBe('abc')
    expect(onChange).toHaveBeenCalledWith('abc')

    field.dispose()
  })

  it('keeps disabled fields unfocusable and expands layout for helper text', () => {
    const field = new RenderTextBox({
      value: 'text',
      disabled: true,
      helperText: '这是帮助文案',
    })
    const style = deriveTextInputStyle(ImGuiDarkTheme)

    field.layout(constraints)
    field.onPointerDown({ pointerId: 1, position: { x: 10, y: 10 }, type: 'down' })

    expect(field.size.height).toBe(style.height + style.helperGap + style.helperLineHeight)
    expect(field.isFocused).toBe(false)

    field.dispose()
  })

  it('separates the field body height from the shared total height constraint', () => {
    const style = deriveTextInputStyle(ImGuiDarkTheme)
    const field = new RenderTextBox({
      value: 'text',
      helperText: 'help',
      fieldHeight: 44,
    })
    const looseConstraints = { ...constraints, maxHeight: 100 }

    field.layout(looseConstraints)
    expect(field.size.height).toBe(44 + style.helperGap + style.helperLineHeight)

    field.height = 48
    field.layout(looseConstraints)
    expect(field.size.height).toBe(48)
    expect(field.fieldHeight).toBe(44)

    field.dispose()
  })

  it('uses status border colors from the shared field shell', () => {
    const field = new RenderTextBox({
      value: 'text',
      status: 'error',
    })
    const style = deriveTextInputStyle(ImGuiDarkTheme)
    field.size = { width: 200, height: style.height }

    const painted = paintTextFieldShell(field)

    expect(painted.strokeStyles[0]).toBe(colorToCSS(style.errorBorder))

    field.dispose()
  })

  it('renders prefix suffix and clear adornments, and clears through the clear hit target', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const fillText = vi.fn()
    const lineTo = vi.fn()
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText,
      measureText: vi.fn(text => ({ width: String(text).length * 8 }) as TextMetrics),
      moveTo: vi.fn(),
      lineTo,
      set fillStyle(_value: string) {},
      get fillStyle() { return '' },
      set strokeStyle(_value: string) {},
      get strokeStyle() { return '' },
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D
    const field = new RenderTextBox({
      value: 'text',
      prefixText: '@',
      suffixText: '.com',
      clearable: true,
    })
    const style = deriveTextInputStyle(ImGuiDarkTheme)
    field.offset = { x: 0, y: 0 }
    field.size = { width: 220, height: style.height }

    field.performPaint(new PaintContext(ctx, ImGuiDarkTheme), { x: 0, y: 0 })

    expect(fillText.mock.calls.some(call => call[0] === '@')).toBe(true)
    expect(fillText.mock.calls.some(call => call[0] === '.com')).toBe(true)
    expect(fillText.mock.calls.some(call => call[0] === '×')).toBe(false)
    expect(lineTo).toHaveBeenCalled()

    const clearRect = (field as any)._inlineLayout().clearRect
    field.onPointerDown({
      pointerId: 1,
      position: { x: clearRect.x + clearRect.w / 2, y: clearRect.y + clearRect.h / 2 },
      type: 'down',
    })

    expect(field.value).toBe('text')

    field.onPointerUp({
      pointerId: 1,
      position: { x: clearRect.x + clearRect.w / 2, y: clearRect.y + clearRect.h / 2 },
      type: 'up',
    })

    expect(field.value).toBe('')

    field.dispose()
  })

  it('keeps the value when another gesture wins after pressing the clear affordance', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const arena = new GestureArenaManager()
    const onChange = vi.fn()
    const competitor: GestureArenaMember = {
      acceptGesture: vi.fn(),
      rejectGesture: vi.fn(),
    }
    const field = new RenderTextBox({
      value: 'text',
      clearable: true,
      onChange,
    })

    field.offset = { x: 0, y: 0 }
    field.layout({ ...constraints, maxWidth: 220 })
    const clearRect = (field as any)._inlineLayout().clearRect
    const point = {
      x: clearRect.x + clearRect.w / 2,
      y: clearRect.y + clearRect.h / 2,
    }
    field.onPointerDown({
      pointerId: 1,
      position: point,
      type: 'down',
      joinGestureArena: member => arena.add(1, member),
    })
    const competitorEntry = arena.add(1, competitor)
    arena.close(1)
    competitorEntry.resolve('accepted')
    field.onPointerUp({ pointerId: 1, position: point, type: 'up' })

    expect(field.value).toBe('text')
    expect(onChange).not.toHaveBeenCalled()
    expect((field as any)._pressedClearButton).toBe(false)

    field.dispose()
  })

  it('keeps placeholder visible while focused when the value is empty', () => {
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
      fillText,
      measureText: vi.fn(() => ({ width: 10 })),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      set fillStyle(_value: string) {},
      get fillStyle() { return '' },
      set strokeStyle(_value: string) {},
      get strokeStyle() { return '' },
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D
    const field = new RenderTextBox({
      value: '',
      placeholder: '请输入关键词',
    })
    const style = deriveTextInputStyle(ImGuiDarkTheme)
    field.size = { width: 200, height: style.height }
    ;(field as any)._focused = true

    field.performPaint(new PaintContext(ctx, ImGuiDarkTheme), { x: 0, y: 0 })

    expect(fillText).toHaveBeenCalledWith('请输入关键词', style.padding, style.height / 2)

    field.dispose()
  })

  it('paints a focused visual guide instead of putting it in the field value', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 10)
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
      fillText,
      measureText: vi.fn(() => ({ width: 10 })),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      set fillStyle(_value: string) {},
      get fillStyle() { return '' },
      set strokeStyle(_value: string) {},
      get strokeStyle() { return '' },
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D
    const field = new RenderTextBox({
      value: '12-',
      placeholder: '编号',
      guideText: '__',
      guideVisibility: 'focused',
    })
    const style = deriveTextInputStyle(ImGuiDarkTheme)
    field.size = { width: 200, height: style.height }

    field.performPaint(new PaintContext(ctx, ImGuiDarkTheme), { x: 0, y: 0 })
    expect(fillText).not.toHaveBeenCalledWith('__', expect.any(Number), expect.any(Number))

    fillText.mockClear()
    ;(field as any)._focused = true
    field.performPaint(new PaintContext(ctx, ImGuiDarkTheme), { x: 0, y: 0 })

    expect(field.value).toBe('12-')
    expect(fillText).toHaveBeenCalledWith('__', style.padding + 30, style.height / 2)
    expect(fillText).not.toHaveBeenCalledWith('编号', expect.any(Number), expect.any(Number))

    field.dispose()
  })

  it('treats pointer leave as hover cleanup without aborting focused editing', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const field = new RenderTextBox({ value: 'text' })
    field.offset = { x: 0, y: 0 }
    field.layout(constraints)
    field.focusIn()
    ;(field as any)._hovered = true

    field.onPointerLeave({ pointerId: 1, position: { x: 220, y: 10 }, type: 'move' })

    expect((field as any)._hovered).toBe(false)
    expect(field.isFocused).toBe(true)

    field.onPointerCancel({ pointerId: 1, position: { x: 220, y: 10 }, type: 'cancel' })

    expect((field as any)._dragging).toBe(false)
    field.dispose()
  })

  it('keeps the original anchor while dragging selection backwards', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const field = new RenderTextBox({ value: 'abcdef' })
    const style = deriveTextInputStyle(ImGuiDarkTheme)
    field.offset = { x: 0, y: 0 }
    field.layout(constraints)

    const charX = (index: number) => style.padding + index * 8

    field.onPointerDown({
      pointerId: 1,
      position: { x: charX(5), y: style.height / 2 },
      type: 'down',
    })

    field.onPointerMove({
      pointerId: 1,
      position: { x: charX(3), y: style.height / 2 },
      type: 'move',
    })

    expect((field as any)._textInput.selStart).toBe(3)
    expect((field as any)._textInput.selEnd).toBe(5)

    field.onPointerMove({
      pointerId: 1,
      position: { x: charX(1), y: style.height / 2 },
      type: 'move',
    })

    expect((field as any)._textInput.selStart).toBe(1)
    expect((field as any)._textInput.selEnd).toBe(5)

    field.dispose()
  })
})
