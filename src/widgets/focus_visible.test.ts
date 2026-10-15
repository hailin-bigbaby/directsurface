// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FocusManager } from '../core/focus_manager'
import { InputComposer } from '../core/input_composer'
import { PopupManager } from '../core/popup_manager'
import { TextMeasurer } from '../core/text_measurer'
import { DrawList } from '../rendering/draw_list'
import { PaintContext } from '../rendering/paint_context'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { deriveTextInputStyle } from '../theme/component_styles'
import { RenderButton } from './button'
import { RenderRadioGroup } from './radio_group'
import { RenderItemsControl } from './items_control'
import { RenderText } from './basic'
import { RenderTextBox } from './text_field'
import { RenderTextArea } from './text_area'

const constraints = { minWidth: 200, maxWidth: 200, minHeight: 40, maxHeight: 40 }

function context(): PaintContext {
  return new PaintContext({
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), closePath: vi.fn(),
    fill: vi.fn(), stroke: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
    rect: vi.fn(), roundRect: vi.fn(), clip: vi.fn(), arc: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), setLineDash: vi.fn(), fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 40 })),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  } as unknown as CanvasRenderingContext2D, ImGuiDarkTheme)
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
})

afterEach(() => {
  FocusManager.disposeInstance()
  InputComposer.disposeInstance()
  PopupManager.disposeInstance()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('focus-visible painting', () => {
  it('keeps button focus and activation while toggling only the focus ring', () => {
    const click = vi.fn()
    const button = new RenderButton({ label: 'Save', onClick: click })
    button.layout(constraints)
    const manager = FocusManager.instance
    const ring = vi.spyOn(DrawList.prototype, 'strokeRectDashed')
    manager.notifyPointerInput()
    manager.setFocus(button)
    button.paint(context(), { x: 0, y: 0 })
    expect(button.isFocused).toBe(true)
    expect(button.isFocusVisible).toBe(false)
    expect(ring).not.toHaveBeenCalled()
    manager.handleKeyDownEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    button.paint(context(), { x: 0, y: 0 })
    expect(click).toHaveBeenCalledOnce()
    expect(button.isFocusVisible).toBe(true)
    expect(ring).toHaveBeenCalledOnce()
    ring.mockClear()
    manager.notifyPointerInput()
    button.paint(context(), { x: 0, y: 0 })
    expect(ring).not.toHaveBeenCalled()
    expect(button.isFocused).toBe(true)
    button.dispose()
  })

  it('keeps the radio value on mouse focus and shows the ring for arrow-key navigation', () => {
    const radio = new RenderRadioGroup({ options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], value: 'a' })
    radio.layout(constraints)
    const manager = FocusManager.instance
    const ring = vi.spyOn(DrawList.prototype, 'strokeRectDashed')
    manager.notifyPointerInput()
    manager.setFocus(radio)
    radio.paint(context(), { x: 0, y: 0 })
    expect(radio.value).toBe('a')
    expect(ring).not.toHaveBeenCalled()
    manager.handleKeyDownEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    radio.paint(context(), { x: 0, y: 0 })
    expect(radio.value).toBe('b')
    expect(ring).toHaveBeenCalledOnce()
    radio.dispose()
  })

  it('preserves navigation selection when the focus ring is hidden', () => {
    const item = { key: 'home' }
    const list = new RenderItemsControl({ items: [item], getKey: item => item.key,
      selectedItem: item, itemAppearance: 'navigation', itemTemplate: () => new RenderText('Home') })
    list.layout(constraints)
    const manager = FocusManager.instance
    const ring = vi.spyOn(DrawList.prototype, 'strokeRectDashed')
    manager.notifyPointerInput()
    manager.setFocus(list)
    list.paint(context(), { x: 0, y: 0 })
    expect(list.selectedItem).toBe(item)
    expect(ring).not.toHaveBeenCalled()
    manager.handleKeyDownEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    list.paint(context(), { x: 0, y: 0 })
    expect(ring).toHaveBeenCalledOnce()
    expect(list.selectedItem).toBe(item)
    list.dispose()
  })

  it.each(['single', 'multiline'])('preserves the %s input editing border after a pointer click', kind => {
    const input = kind === 'single' ? new RenderTextBox({ value: 'Hello' }) : new RenderTextArea({ value: 'Hello' })
    input.layout(constraints)
    const manager = FocusManager.instance
    manager.notifyPointerInput()
    manager.setFocus(input)
    const border = vi.spyOn(DrawList.prototype, 'strokeRect')
    input.paint(context(), { x: 0, y: 0 })
    const style = deriveTextInputStyle(ImGuiDarkTheme)
    expect(FocusManager.keyboardFocusVisible).toBe(false)
    expect(input.isFocused).toBe(true)
    expect(border).toHaveBeenCalledWith(0, 0, expect.any(Number), expect.any(Number), style.focusedBorder, 1.5, style.borderRadius)
    input.dispose()
  })
})
