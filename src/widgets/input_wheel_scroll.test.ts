// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { FocusManager } from '../core/focus_manager'
import { InputComposer } from '../core/input_composer'
import { PopupManager } from '../core/popup_manager'
import { EventDispatcher } from '../gestures/recognizers'
import { RenderSpacer, RenderStackPanel } from '../layout/render_flex'
import { RenderNumberInput } from './number_input'
import { RenderSlider } from './slider'
import { RenderTimeEdit } from './time_edit'
import { RenderTimeSpanEdit } from './time_span_edit'
import { RenderTimePicker } from './time_picker'
import { RenderTimeRangeEdit } from './time_range_edit'
import { RenderDatePicker } from './date_picker'
import { RenderDateRangeEdit } from './date_range_edit'
import { RenderDateTimeRangeEdit } from './date_time_range_edit'
import { RenderTextBox } from './text_field'
import { RenderTextArea } from './text_area'
import { RenderMaskedTextEdit } from './masked_text_edit'
import { RenderComboBox } from './dropdown'
import { RenderTokenEdit } from './token_edit'
import { RenderLookupEdit } from './lookup_edit'
import { RenderColorPicker } from './color_picker'
import { RenderScrollViewer } from './scroll_view'

afterEach(() => {
  PopupManager.disposeInstance()
  FocusManager.disposeInstance()
  InputComposer.disposeInstance()
  vi.restoreAllMocks()
})

const cases = [
  { name: 'NumberInput', create: (onChange: () => void) => new RenderNumberInput({ value: 3, onChange }) },
  { name: 'Slider', create: (onChange: () => void) => new RenderSlider({ value: 30, onChange }) },
  { name: 'TimeEdit', create: (onChange: () => void) => new RenderTimeEdit({ value: '09:30:00', onChange }) },
  { name: 'TimeSpanEdit', create: (onChange: () => void) => new RenderTimeSpanEdit({ value: 3600, onChange }) },
  { name: 'TimePicker', create: (onChange: () => void) => new RenderTimePicker({ value: '09:30:00', onChange }) },
  { name: 'TimeRangeEdit', create: (onChange: () => void) => new RenderTimeRangeEdit({ value: { start: '09:00', end: '10:00' }, onChange }) },
  { name: 'DatePicker', create: (onChange: () => void) => new RenderDatePicker({ value: '2026-10-16', onChange }) },
  { name: 'DateRangeEdit', create: (onChange: () => void) => new RenderDateRangeEdit({ value: { start: '2026-10-16', end: '2026-10-17' }, onChange }) },
  { name: 'DateTimeRangeEdit', create: (onChange: () => void) => new RenderDateTimeRangeEdit({ value: { start: '2026-10-16T09:00', end: '2026-10-16T10:00' }, onChange }) },
  { name: 'TextBox', create: (onChange: () => void) => new RenderTextBox({ value: '原文本', onChange }) },
  { name: 'TextArea', create: (onChange: () => void) => new RenderTextArea({ value: '第一行\n第二行', onChange }) },
  { name: 'MaskedTextEdit', create: (onChange: () => void) => new RenderMaskedTextEdit({ mask: '000-000', value: '123456', onChange }) },
  { name: 'ComboBox', create: (onChange: () => void) => new RenderComboBox({ options: [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }], value: 'a', onChange }) },
  { name: 'TokenEdit', create: (onChange: () => void) => new RenderTokenEdit({ allowCustomTokens: true, values: ['甲'], onChange }) },
  { name: 'LookupEdit', create: (onChange: () => void) => new RenderLookupEdit({ rows: [{ id: 'a', name: '甲' }], columns: [{ key: 'name', title: '名称' }], valueKey: 'id', labelKey: 'name', value: 'a', onChange }) },
  { name: 'ColorPicker', create: (onChange: () => void) => new RenderColorPicker({ color: { r: 30, g: 60, b: 90, a: 1 }, onChange }) },
]

describe('unfocused input wheel routing', () => {
  it.each(cases)('$name preserves its value and lets the page scroll while hovered', ({ create }) => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 260, bottom: 120,
      width: 260, height: 120, toJSON: () => ({}),
    })
    const onChange = vi.fn()
    const onValueChange = vi.fn()
    const input = create(onChange)
    const original = structuredClone(input.getValue())
    input.subscribeValueChange(onValueChange)
    const content = new RenderStackPanel({ orientation: 'vertical' })
    content.addChild(input)
    content.addChild(new RenderSpacer({ height: 500 }))
    const view = new RenderScrollViewer({ child: content, direction: 'vertical' })
    view.layout({ minWidth: 0, maxWidth: 260, minHeight: 0, maxHeight: 120 })
    const dispatcher = new EventDispatcher(canvas)
    dispatcher.addRoot(view)
    try {
      for (const deltaY of [120, -120]) {
        view.scrollY = deltaY > 0 ? 0 : 5
        const before = view.scrollY
        const clientX = input.globalOffset.x + Math.min(20, input.size.width / 2)
        const clientY = input.globalOffset.y + Math.min(15, input.size.height / 2)
        canvas.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY, bubbles: true }))
        canvas.dispatchEvent(new WheelEvent('wheel', { clientX, clientY, deltaY, bubbles: true, cancelable: true }))

        expect(input.getValue()).toEqual(original)
        expect(onChange).not.toHaveBeenCalled()
        expect(onValueChange).not.toHaveBeenCalled()
        expect(FocusManager.instance.current).toBe(null)
        if (deltaY > 0) expect(view.scrollY).toBeGreaterThan(before)
        else expect(view.scrollY).toBeLessThan(before)
      }
    } finally {
      dispatcher.dispose()
      view.dispose()
    }
  })
})
