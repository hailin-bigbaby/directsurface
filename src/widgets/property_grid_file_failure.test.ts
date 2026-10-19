import { afterEach, expect, it, vi } from 'vitest'
import { RenderPropertyGrid } from './property_grid'
import { InputComposer } from '../core/input_composer'
import { FocusManager } from '../core/focus_manager'
afterEach(() => { vi.restoreAllMocks(); InputComposer.instance.dispose(); FocusManager.disposeInstance(); document.body.innerHTML = '' })
it('reports failed file selection without leaking an input or changing a value', async () => {
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => { throw new Error('picker unavailable') })
  const onEditError = vi.fn(), onValueCommit = vi.fn()
  const grid = new RenderPropertyGrid({ rows: [{ group: 'Image', name: 'Source', value: '', editor: 'image-source', editable: true }], onEditError, onValueCommit })
  try {
    expect(() => grid.requestEdit('Image', 'Source')).not.toThrow()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(onEditError).toHaveBeenCalledTimes(1)
    expect(String(onEditError.mock.calls[0]?.[1])).toContain('picker unavailable')
    expect(document.querySelector('input[type=file]')).toBeNull()
    expect(onValueCommit).not.toHaveBeenCalled()
    expect(grid.rows[0]!.value).toBe('')
  } finally { grid.dispose() }
})
it('treats a cancelled image selection as no change', async () => {
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function(this: HTMLInputElement) { this.dispatchEvent(new Event('cancel')) })
  const onEditError = vi.fn(), onValueCommit = vi.fn()
  const grid = new RenderPropertyGrid({ rows: [{ group: 'Image', name: 'Source', value: '', editor: 'image-source', editable: true }], onEditError, onValueCommit })
  try {
    expect(grid.requestEdit('Image', 'Source')).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(onEditError).not.toHaveBeenCalled(); expect(onValueCommit).not.toHaveBeenCalled()
    expect(document.querySelector('input[type=file]')).toBeNull()
  } finally { grid.dispose() }
})
