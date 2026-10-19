import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClipboardController } from './clipboard'

afterEach(() => vi.unstubAllGlobals())

it('distinguishes empty clipboard text from unavailable or rejected reads', async () => {
  const controller = new ClipboardController()
  vi.stubGlobal('navigator', undefined)
  expect(await controller.readText()).toBeNull()
  vi.stubGlobal('navigator', {})
  expect(await controller.readText()).toBeNull()
  vi.stubGlobal('navigator', { clipboard: { readText: () => Promise.reject(new Error('denied')) } })
  expect(await controller.readText()).toBeNull()
  vi.stubGlobal('navigator', { clipboard: { readText: () => { throw new Error('unavailable') } } })
  expect(await controller.readText()).toBeNull()
  vi.stubGlobal('navigator', { clipboard: { readText: async () => '' } })
  expect(await controller.readText()).toBe('')
  vi.stubGlobal('navigator', { clipboard: { readText: async () => 'Alpha' } })
  expect(await controller.readText()).toBe('Alpha')
})

describe('shared clipboard port', () => {
  it('preserves empty text and writer override/reset', async () => {
    const writeText = vi.fn(() => true)
    const clipboard = new ClipboardController({ writeText, readText: () => '' })
    expect(await clipboard.readText()).toBe('')
    clipboard.setWriter(() => false)
    expect(await clipboard.writeText('原文本')).toBe(false)
    expect(writeText).not.toHaveBeenCalled()
    clipboard.resetWriter()
    expect(await clipboard.writeText('原文本')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('原文本')
  })

  it('distinguishes unavailable reads from empty strings and catches port failures', async () => {
    const clipboard = new ClipboardController({ writeText: () => { throw Error('locked') }, readText: () => { throw Error('locked') } })
    expect(await clipboard.readText()).toBeNull()
    expect(await clipboard.writeText('text')).toBe(false)
  })

  it('rejects late results and does not reopen disposed ports', async () => {
    let resolveRead!: (text: string) => void
    let resolveWrite!: (value: boolean) => void
    const readText = vi.fn(() => new Promise<string>(resolve => { resolveRead = resolve }))
    const writeText = vi.fn(() => new Promise<boolean>(resolve => { resolveWrite = resolve }))
    const clipboard = new ClipboardController({ writeText, readText })
    const read = clipboard.readText(), write = clipboard.writeText('before')
    clipboard.dispose()
    resolveRead('late'); resolveWrite(true)
    expect(await read).toBeNull(); expect(await write).toBe(false)
    clipboard.resetWriter()
    expect(await clipboard.readText()).toBeNull(); expect(await clipboard.writeText('after')).toBe(false)
    expect(readText).toHaveBeenCalledTimes(1); expect(writeText).toHaveBeenCalledTimes(1)
  })
})
