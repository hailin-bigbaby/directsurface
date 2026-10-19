import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { InputComposer } from '../core/input_composer'
import { TextInputController } from '../core/text_input_controller'
import { FocusManager } from '../core/focus_manager'
import { TextMeasurer } from '../core/text_measurer'
import { RenderTextBox } from './text_field'

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
})
afterEach(() => {
  FocusManager.disposeInstance()
  InputComposer.instance.dispose()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
const input = () => document.querySelector<HTMLTextAreaElement>('#__ds_ui_input__')!

it.each([true, false])('applies initial readonly=%s before native focus while retaining text selection', readonly => {
  const focusStates: boolean[] = []
  vi.spyOn(HTMLTextAreaElement.prototype, 'focus').mockImplementation(function(this: HTMLTextAreaElement) {
    focusStates.push(this.readOnly)
  })
  const field = new RenderTextBox({ value: 'selectable', readonly })
  try {
    field.focusIn()
    expect(focusStates.length).toBeGreaterThan(0)
    expect(focusStates.every(state => state === readonly)).toBe(true)
    expect(input().readOnly).toBe(readonly)
    input().setSelectionRange(0, 4)
    expect(input().selectionEnd).toBe(4)
  } finally { field.dispose() }
})

it('updates native readonly in both directions and only emits accepted edits', () => {
  const onChange = vi.fn()
  const field = new RenderTextBox({ value: 'original', onChange })
  try {
    field.focusIn()
    field.readonly = true
    expect(input().readOnly).toBe(true)
    input().value = 'blocked'
    input().dispatchEvent(new Event('input'))
    expect(field.value).toBe('original')
    expect(onChange).not.toHaveBeenCalled()
    field.readonly = false
    expect(input().readOnly).toBe(false)
    input().value = 'accepted'
    input().dispatchEvent(new Event('input'))
    expect(field.value).toBe('accepted')
    expect(onChange).toHaveBeenCalledTimes(1)
  } finally { field.dispose() }
})

it('does not carry readonly into the next editable input session', () => {
  const locked = new RenderTextBox({ value: 'locked', readonly: true })
  const editable = new RenderTextBox({ value: 'editable' })
  try {
    locked.focusIn()
    expect(input().readOnly).toBe(true)
    locked.focusOut()
    editable.focusIn()
    expect(input().readOnly).toBe(false)
    input().value = 'updated'
    input().dispatchEvent(new Event('input'))
    expect(editable.value).toBe('updated')
  } finally { locked.dispose(); editable.dispose() }
})

it('honors readonly without forcing focus and resets the default on a later session', () => {
  const focus = vi.spyOn(HTMLTextAreaElement.prototype, 'focus')
  const controller = new TextInputController()
  try {
    controller.beginSession({}, 'locked', { focus: false, readOnly: true })
    expect(input().readOnly).toBe(true)
    expect(focus).not.toHaveBeenCalled()
    controller.beginSession({}, 'editable', { focus: false })
    expect(input().readOnly).toBe(false)
  } finally { controller.dispose() }
})


it('keeps readonly set before restoring focus when a large textarea is recycled', () => {
  const controller = new TextInputController()
  try {
    controller.beginSession({}, 'x'.repeat(1_000_000))
    const previous = input()
    expect(document.activeElement).toBe(previous)
    const originalFocus = HTMLTextAreaElement.prototype.focus
    const states: boolean[] = []
    vi.spyOn(HTMLTextAreaElement.prototype, 'focus').mockImplementation(function(this: HTMLTextAreaElement, options?: FocusOptions) {
      states.push(this.readOnly)
      originalFocus.call(this, options)
    })
    controller.beginSession({}, 'locked', { readOnly: true })
    expect(input()).not.toBe(previous)
    expect(states.length).toBeGreaterThan(0)
    expect(states.every(Boolean)).toBe(true)
  } finally { controller.dispose() }
})
