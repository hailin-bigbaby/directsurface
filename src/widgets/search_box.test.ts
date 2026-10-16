// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { InputComposer } from '../core/input_composer'
import { FocusManager } from '../core/focus_manager'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { RenderSearchBox } from './search_box'
import { RenderTextBox } from './text_field'

const constraints = {
  minWidth: 0,
  maxWidth: 240,
  minHeight: 0,
  maxHeight: 40,
}

afterEach(() => {
  FocusManager.disposeInstance()
  InputComposer.disposeInstance()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function inputElement(): HTMLTextAreaElement {
  const ta = document.getElementById('__ds_ui_input__') as HTMLTextAreaElement | null
  if (!ta) throw new Error('InputComposer textarea was not created')
  return ta
}

describe('RenderSearchBox', () => {
  it.each([true, false])('uses the latest onSearch for Enter and icon clicks (initial callback=%s)', initiallyBound => {
    const original = vi.fn()
    const current = vi.fn()
    const field = new RenderSearchBox({ value: 'current query', onSearch: initiallyBound ? original : undefined })
    field.layout(constraints, false, { theme: ImGuiDarkTheme })
    field.onSearch = current
    FocusManager.instance.setFocus(field)
    inputElement().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    const rect = (field as any)._inlineLayout().trailingRect
    const point = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
    field.onPointerDown({ pointerId: 1, type: 'down', position: point })
    field.onPointerUp({ pointerId: 1, type: 'up', position: point })
    expect(original).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledTimes(2)
    expect(current).toHaveBeenNthCalledWith(1, 'current query')
    expect(current).toHaveBeenNthCalledWith(2, 'current query')
    expect(field.isFocused).toBe(true)
    field.onSearch = undefined
    inputElement().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    field.onTrailingIconClick?.()
    field.search()
    expect(original).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledTimes(2)
    field.dispose()
  })
  it('defaults to a search placeholder, clearable input, and search icon', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const field = new RenderSearchBox({ value: '' })

    expect(field.placeholder).toBe('搜索...')
    expect(field.clearable).toBe(true)
    expect(field.trailingIcon).toBe('search')

    field.dispose()
  })

  it('invokes onSearch when the trailing search icon is clicked', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const onSearch = vi.fn()
    const field = new RenderSearchBox({
      value: 'grid view',
      onSearch,
    })
    field.layout(constraints, false, { theme: ImGuiDarkTheme })

    const trailingRect = (field as any)._inlineLayout().trailingRect as {
      x: number
      y: number
      w: number
      h: number
    }
    const point = {
      x: trailingRect.x + trailingRect.w / 2,
      y: trailingRect.y + trailingRect.h / 2,
    }

    field.onPointerDown({ pointerId: 1, position: point, type: 'down' })
    field.onPointerUp({ pointerId: 1, position: point, type: 'up' })

    expect(onSearch).toHaveBeenCalledWith('grid view')

    field.dispose()
  })

  it('reuses text field submit semantics for search', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const onSearch = vi.fn()
    const field = new RenderSearchBox({
      value: 'toolbar',
      onSearch,
    })

    field.onSubmit?.('toolbar')

    expect(onSearch).toHaveBeenCalledWith('toolbar')

    field.dispose()
  })

  it('keeps focus after pressing Enter to search', () => {
    vi.useFakeTimers()
    const onSearch = vi.fn()
    const field = new RenderSearchBox({
      value: 'toolbar',
      onSearch,
    })
    field.layout(constraints, false, { theme: ImGuiDarkTheme })

    FocusManager.instance.setFocus(field)
    inputElement().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))

    expect(onSearch).toHaveBeenCalledWith('toolbar')
    expect(field.isFocused).toBe(true)
    expect(InputComposer.instance.hasSession).toBe(true)

    field.dispose()
  })

  it('lets callers intercept keyboard navigation before default text submit handling', () => {
    vi.useFakeTimers()
    const onSearch = vi.fn()
    const onKeyDown = vi.fn((event: KeyboardEvent) => {
      if (event.key === 'Enter') return true
      return false
    })
    const field = new RenderSearchBox({
      value: 'toolbar',
      onSearch,
      onKeyDown,
    })
    field.layout(constraints, false, { theme: ImGuiDarkTheme })

    FocusManager.instance.setFocus(field)
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    inputElement().dispatchEvent(event)

    expect(onKeyDown).toHaveBeenCalledWith(event)
    expect(onSearch).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
    expect(field.isFocused).toBe(true)

    field.dispose()
  })

  it('can regain focus by clicking itself after Escape clears focus', () => {
    vi.useFakeTimers()
    const field = new RenderSearchBox({
      value: 'toolbar',
    })
    field.layout(constraints, false, { theme: ImGuiDarkTheme })

    FocusManager.instance.setFocus(field)
    inputElement().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

    expect(field.isFocused).toBe(false)
    expect(FocusManager.instance.current).toBeNull()

    field.onPointerDown({ pointerId: 1, position: { x: 12, y: 12 }, type: 'down', button: 0 })

    expect(field.isFocused).toBe(true)
    expect(FocusManager.instance.current).toBe(field)

    field.dispose()
  })

  it('allows Tab to move focus to the next focusable widget', () => {
    const search = new RenderSearchBox({ value: '' })
    const next = new RenderTextBox({ value: 'next' })
    search.layout(constraints, false, { theme: ImGuiDarkTheme })
    next.layout(constraints, false, { theme: ImGuiDarkTheme })

    FocusManager.instance.setFocus(search)
    inputElement().dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))

    expect(search.isFocused).toBe(false)
    expect(next.isFocused).toBe(true)

    search.dispose()
    next.dispose()
  })
})
