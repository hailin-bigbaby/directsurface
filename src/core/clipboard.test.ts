import { afterEach, expect, it, vi } from 'vitest'
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
