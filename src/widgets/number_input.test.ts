// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { FocusManager } from '../core/focus_manager'
import { InputComposer } from '../core/input_composer'
import { PopupManager } from '../core/popup_manager'
import { FormSession } from '../core/form_session'
import { bindFormField } from './form_field_binding'
import { RenderNumberInput } from './number_input'

const constraints = { minWidth: 0, maxWidth: 240, minHeight: 0, maxHeight: 120 }
function inputElement(): HTMLTextAreaElement {
  const input = document.getElementById('__ds_ui_input__') as HTMLTextAreaElement | null
  if (!input) throw new Error('Input composer not created')
  return input
}
afterEach(() => {
  PopupManager.disposeInstance()
  FocusManager.disposeInstance()
  InputComposer.disposeInstance()
  vi.restoreAllMocks()
})

describe('NumberInput editing and wheel regressions', () => {
  it.each([
    ['Infinity', 0], ['-Infinity', 0], ['1e309', 0], ['-1e309', 0], ['1e308', 2],
  ] as const)('keeps non-finite submission %s as a correctable draft', (text, decimals) => {
    const onChange = vi.fn()
    const listener = vi.fn()
    const input = new RenderNumberInput({ value: 3, decimals, onChange })
    input.subscribeValueChange(listener)
    input.focusIn()
    const ta = inputElement()
    ta.value = text
    ta.dispatchEvent(new Event('input'))
    expect(input.commitEdit()).toBe(false)
    expect(input.commitEdit()).toBe(false)
    expect(input.value).toBe(3)
    expect(ta.value).toBe(text)
    expect(input.isFocused).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
    ta.value = '1e2'
    ta.dispatchEvent(new Event('input'))
    expect(input.commitEdit()).toBe(true)
    expect(input.value).toBe(100)
    expect(onChange).toHaveBeenCalledOnce()
    input.dispose()
  })

  it('blocks a non-finite form submission even when finite bounds could clamp it', async () => {
    const input = new RenderNumberInput({ value: 3, min: 0, max: 10 })
    const form = new FormSession({ count: 3 })
    const unbind = bindFormField(form, 'count', input, { validateOn: [] })
    const submit = vi.fn()
    input.requestFocus()
    inputElement().value = '1e309'
    inputElement().dispatchEvent(new Event('input'))
    expect((await form.runSubmit(submit)).status).toBe('invalid')
    expect(submit).not.toHaveBeenCalled()
    expect(form.getValue('count')).toBe(3)
    expect(inputElement().value).toBe('1e309')
    unbind()
    form.dispose()
    input.dispose()
  })

  it.each(['button', 'keyboard', 'wheel'] as const)('steps from the pending draft through %s with one notification', trigger => {
    const onChange = vi.fn()
    const listener = vi.fn()
    const input = new RenderNumberInput({ value: 1, step: 0.5, decimals: 1, max: 13, onChange })
    input.subscribeValueChange(listener)
    input.layout(constraints)
    input.focusIn()
    const ta = inputElement()
    ta.value = '12.4'
    ta.setSelectionRange(4, 4)
    ta.dispatchEvent(new Event('input'))
    if (trigger === 'wheel') input.onWheel({ pointerId: 1, type: 'wheel', position: { x: 20, y: 10 }, deltaX: 0, deltaY: -1 })
    else if (trigger === 'keyboard') ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }))
    else input.onPointerDown({ pointerId: 1, type: 'down', position: { x: input.size.width - input.btnWidth / 2, y: 5 } })
    expect(input.value).toBe(12.9)
    expect(ta.value).toBe('12.9')
    expect(input.isFocused).toBe(true)
    expect(onChange).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ previousValue: 1, value: 12.9, reason: 'step' }))
    input.onWheel({ pointerId: 1, type: 'wheel', position: { x: 20, y: 10 }, deltaX: 0, deltaY: -1 })
    expect(input.value).toBe(13)
    input.dispose()
  })

  it.each(['', '-', '.', 'invalid', 'Infinity'])('preserves invalid draft %s through every step trigger', draft => {
    const onChange = vi.fn()
    const input = new RenderNumberInput({ value: 3, onChange })
    input.layout(constraints)
    input.focusIn()
    const ta = inputElement()
    ta.value = draft
    ta.dispatchEvent(new Event('input'))
    input.onWheel({ pointerId: 1, type: 'wheel', position: { x: 20, y: 10 }, deltaX: 0, deltaY: 1 })
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }))
    input.onPointerDown({ pointerId: 1, type: 'down', position: { x: input.size.width - input.btnWidth / 2, y: 5 } })
    expect(input.value).toBe(3)
    expect(ta.value).toBe(draft)
    expect(input.isFocused).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
    input.dispose()
  })

  it('does not step over an active IME composition', () => {
    const onChange = vi.fn()
    const input = new RenderNumberInput({ value: 3, onChange })
    input.layout(constraints)
    input.focusIn()
    const ta = inputElement()
    ta.dispatchEvent(new CompositionEvent('compositionstart'))
    ta.dispatchEvent(new CompositionEvent('compositionupdate', { data: '中' }))
    input.onWheel({ pointerId: 1, type: 'wheel', position: { x: 20, y: 10 }, deltaX: 0, deltaY: -1 })
    const arrow = new KeyboardEvent('keydown', { key: 'ArrowUp', isComposing: true, cancelable: true })
    ta.dispatchEvent(arrow)
    input.onPointerDown({ pointerId: 1, type: 'down', position: { x: input.size.width - input.btnWidth / 2, y: 5 } })
    expect(input.value).toBe(3)
    expect(onChange).not.toHaveBeenCalled()
    expect(arrow.defaultPrevented).toBe(false)
    expect((input as any)._textInput.composing).toBe(true)
    input.dispose()
  })

  it('defaults to parent scrolling without changing the value until focused, and again after blur', () => {
    const onChange = vi.fn()
    const input = new RenderNumberInput({ value: 3, onChange })
    input.layout(constraints)
    const event = { pointerId: 1, position: { x: 20, y: 10 }, type: 'wheel' as const, deltaX: 0, deltaY: -1 }

    expect(input.onWheel(event)).toBe(false)
    expect(input.onWheel({ ...event, deltaY: 1 })).toBe(false)
    expect(input.value).toBe(3)
    expect(onChange).not.toHaveBeenCalled()
    input.focusIn()
    expect(input.onWheel(event)).toBeUndefined()
    expect(input.value).toBe(4)
    expect(InputComposer.instance.value).toBe('4')
    input.onWheel({ ...event, position: { x: 500, y: 500 } })
    expect(input.value).toBe(4)
    input.focusOut()
    onChange.mockClear()
    expect(input.onWheel(event)).toBe(false)
    expect(input.value).toBe(4)
    expect(onChange).not.toHaveBeenCalled()
    input.dispose()
  })
})

describe('NumberInput wheel policies', () => {
  it('allows hover wheel stepping only when explicitly enabled', () => {
    const onChange = vi.fn()
    const input = new RenderNumberInput({ value: 1, step: 0.5, decimals: 1, max: 2, wheelMode: 'hover', onChange })
    input.layout(constraints)
    const event = { pointerId: 1, position: { x: 20, y: 10 }, type: 'wheel' as const, deltaX: 0, deltaY: -1 }

    expect(input.wheelMode).toBe('hover')
    expect(input.onWheel(event)).toBeUndefined()
    expect(input.value).toBe(1.5)
    input.onWheel(event)
    input.onWheel(event)
    expect(input.value).toBe(2)
    expect(onChange).toHaveBeenCalledWith(1.5)
    expect(input.isFocused).toBe(false)
    input.dispose()
  })

  it('changes wheel modes at runtime without disabling keyboard or button stepping', () => {
    const onChange = vi.fn()
    const input = new RenderNumberInput({ value: 1, wheelMode: 'none', onChange })
    input.layout(constraints)
    input.focusIn()
    const event = { pointerId: 1, position: { x: 20, y: 10 }, type: 'wheel' as const, deltaX: 0, deltaY: -1 }

    expect(input.onWheel(event)).toBe(false)
    expect(input.value).toBe(1)
    expect(onChange).not.toHaveBeenCalled()
    inputElement().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
    expect(input.value).toBe(2)
    const position = { x: input.size.width - input.btnWidth / 2, y: 5 }
    input.onPointerDown({ pointerId: 1, position, type: 'down' })
    input.onPointerUp({ pointerId: 1, position, type: 'up' })
    expect(input.value).toBe(3)
    input.wheelMode = 'hover'
    input.onWheel({ ...event, deltaY: 1 })
    expect(input.value).toBe(2)
    input.wheelMode = 'none'
    expect(input.onWheel(event)).toBe(false)
    expect(input.value).toBe(2)
    input.dispose()
  })
  it('defaults the wheel policy to focus', () => {
    const input = new RenderNumberInput({ value: 1 })
    expect(input.wheelMode).toBe('focus')
    input.dispose()
  })
})

describe('strict optional numeric values',()=>{
  it('keeps mixed and empty separate from zero without publishing untouched focus',()=>{
    const changed=vi.fn(),input=new RenderNumberInput({value:7,valueState:'mixed',allowEmpty:true,commitMode:'strict',onValueStateChange:changed})
    expect(input.getNullableValue()).toBeUndefined();input.focusIn();input.focusOut();expect(input.valueState).toBe('mixed');expect(changed).not.toHaveBeenCalled()
    input.setDraftText('');expect(input.commitEdit()).toBe(true);expect(input.getNullableValue()).toBeNull();expect(changed).toHaveBeenLastCalledWith('empty',undefined)
    input.setDraftText('0');expect(input.commitEdit()).toBe(true);expect(input.getNullableValue()).toBe(0);expect(input.valueState).toBe('value');input.dispose()
  })
  it.each(['12mm','1e','0x10','Infinity','1e309','1e-999','11','-1','1.25'])('rejects complete invalid integer/range input %s without clamping or changing committed state',raw=>{
    const changed=vi.fn(),input=new RenderNumberInput({value:3,integer:true,min:0,max:10,commitMode:'strict',onValueStateChange:changed})
    input.setDraftText(raw);expect(input.validateEdit()).toBe(false);expect(input.commitEdit()).toBe(false);expect(input.value).toBe(3);expect(input.draftText).toBe(raw);expect(changed).not.toHaveBeenCalled();input.dispose()
  })
  it('preserves decimal values and supports a complete custom font-size parser',()=>{
    const input=new RenderNumberInput({value:1,commitMode:'strict'});input.setDraftText('0.3333333333333333');expect(input.commitEdit()).toBe(true);expect(input.value).toBe(.3333333333333333)
    input.parseText=s=>s==='小四'?12:undefined;input.setDraftText('小四');expect(input.commitEdit()).toBe(true);expect(input.value).toBe(12);input.dispose()
  })
  it('strict disable cancels a pending draft and external value/state updates stay silent',()=>{
    const onChange=vi.fn(),state=vi.fn(),input=new RenderNumberInput({value:2,commitMode:'strict',allowEmpty:true,onChange,onValueStateChange:state})
    input.setDraftText('5');input.disabled=true;expect(input.value).toBe(2);expect(input.isEditing).toBe(false);expect(onChange).not.toHaveBeenCalled();input.setNullableValue(null);input.setNullableValue(undefined);input.setValue(0);expect(input.getNullableValue()).toBe(0);expect(state).not.toHaveBeenCalled();input.dispose()
  })
})

it('strict stepping preserves decimal precision and establishes an explicit value from mixed state',()=>{
 const input=new RenderNumberInput({value:.3333333333333333,step:.1,commitMode:'strict'});input.focusIn();inputElement().dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp'}));expect(input.value).toBe(.4333333333333333);input.dispose()
 const mixed=new RenderNumberInput({value:19,valueState:'mixed',min:10,max:20,commitMode:'strict'});mixed.focusIn();inputElement().dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp'}));expect(mixed.getNullableValue()).toBe(10);mixed.dispose()
})
it('explicit deletion of a mixed placeholder clears it, and stepping a blank optional draft starts a value',()=>{
 const input=new RenderNumberInput({value:8,valueState:'mixed',allowEmpty:true,commitMode:'strict'});input.focusIn();inputElement().dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace'}));expect(input.commitEdit()).toBe(true);expect(input.getNullableValue()).toBeNull()
 input.focusIn();inputElement().dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp'}));expect(input.getNullableValue()).toBe(1);input.dispose()
})
