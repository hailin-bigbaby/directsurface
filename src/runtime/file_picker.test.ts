// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserFilePickerBridge } from './file_picker'

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('BrowserFilePickerBridge', () => {
  it('aborts selection and removes the temporary input',async()=>{
    vi.spyOn(HTMLInputElement.prototype,'click').mockImplementation(()=>{})
    const signal=new AbortController(),picker=new BrowserFilePickerBridge(document)
    const pending=picker.pickFiles({signal:signal.signal}),rejected=expect(pending).rejects.toMatchObject({name:'AbortError'})
    signal.abort();await rejected
    expect(document.querySelector('input')).toBeNull()
    await expect(picker.pickFiles({signal:signal.signal})).rejects.toMatchObject({name:'AbortError'})
  })
  it('configures the native input and resolves selected files', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const picker = new BrowserFilePickerBridge(document)
    const pending = picker.pickFiles({
      accept: '.json,application/json',
      multiple: true,
      capture: 'environment',
    })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['{}'], 'patient.json', { type: 'application/json' })

    expect(input.accept).toBe('.json,application/json')
    expect(input.multiple).toBe(true)
    expect(input.getAttribute('capture')).toBe('environment')
    expect(click).toHaveBeenCalledTimes(1)

    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file],
    })
    input.dispatchEvent(new Event('change'))

    await expect(pending).resolves.toEqual([file])
    expect(document.body.contains(input)).toBe(false)
  })

  it('resolves an empty selection when the picker is cancelled', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const picker = new BrowserFilePickerBridge(document)
    const pending = picker.pickFiles()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    input.dispatchEvent(new Event('cancel'))

    await expect(pending).resolves.toEqual([])
    expect(document.body.contains(input)).toBe(false)
  })

  it('rejects outside a browser document', async () => {
    const picker = new BrowserFilePickerBridge(null)

    await expect(picker.pickFiles()).rejects.toThrow('browser document')
  })

  it('removes the temporary input when opening the native picker throws', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {
      throw new Error('picker blocked')
    })
    const picker = new BrowserFilePickerBridge(document)

    await expect(picker.pickFiles()).rejects.toThrow('picker blocked')
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })
})
