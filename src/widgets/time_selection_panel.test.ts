// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { ImGuiDarkTheme } from '../theme/default_theme'
import { deriveDatePickerStyle, derivePopupStyle } from '../theme/component_styles'
import { TimeSelectionPanel } from './time_selection_panel'

describe('TimeSelectionPanel', () => {
  it('selects values from minute-precision columns', () => {
    const onChange = vi.fn()
    const panel = new TimeSelectionPanel({
      value: '08:09',
      precision: 'minute',
      onChange,
    })
    const style = deriveDatePickerStyle(ImGuiDarkTheme)
    const rect = { x: 0, y: 0, width: TimeSelectionPanel.minimumWidth(style, 'minute') }
    panel.reset('08:09')

    const handled = panel.handlePointerDown({
      x: style.padding + style.cellSize,
      y: style.padding + style.headerHeight + style.cellSize * 4.5,
    }, rect, style)

    expect(handled).toBe(true)
    expect(panel.parts?.hour).not.toBe(8)
    expect(onChange).toHaveBeenCalled()
  })

  it('applies wheel changes to the column under the pointer', () => {
    const panel = new TimeSelectionPanel({
      value: '08:58:59',
      precision: 'second',
      minuteStep: 5,
    })
    const style = deriveDatePickerStyle(ImGuiDarkTheme)
    const rect = { x: 0, y: 0, width: TimeSelectionPanel.minimumWidth(style, 'second') }
    panel.reset('08:58:59')

    expect(panel.handleWheel({
      pointerId: 1,
      type: 'wheel',
      position: { x: rect.width / 2, y: style.headerHeight + style.cellSize },
      deltaX: 0,
      deltaY: 1,
    }, rect, style)).toBe(true)

    expect(panel.value).toBe('08:03:59')
  })

  it('does not repeat options when a step produces fewer than seven values', () => {
    const panel = new TimeSelectionPanel({
      value: '08:00',
      precision: 'minute',
      minuteStep: 30,
    })

    const choices = (panel as any)._visibleChoices('minute', 0)
      .filter((value: number | null) => value !== null)
    expect(choices).toEqual([30, 0])
  })

  it('generates candidates relative to an off-grid selected value', () => {
    const panel = new TimeSelectionPanel({
      value: '08:09',
      precision: 'minute',
      minuteStep: 5,
    })

    const choices = (panel as any)._visibleChoices('minute', 9)
      .filter((value: number | null) => value !== null)

    expect(choices).toEqual([54, 59, 4, 9, 14, 19, 24])
  })

  it('uses one-minute candidates when no minute step is configured', () => {
    const panel = new TimeSelectionPanel({
      value: '09:30',
      precision: 'minute',
    })

    const choices = (panel as any)._visibleChoices('minute', 30)
      .filter((value: number | null) => value !== null)

    expect(choices).toEqual([27, 28, 29, 30, 31, 32, 33])
  })

  it('can materialize an empty fallback as the popup draft', () => {
    const panel = new TimeSelectionPanel({ precision: 'minute' })

    panel.reset('', { hour: 9, minute: 10, second: 11 }, true)

    expect(panel.value).toBe('09:10')
    expect(panel.parts).toEqual({ hour: 9, minute: 10, second: 0 })
  })
})

it('marks the active time column only in the active range panel', () => {
  const panel = new TimeSelectionPanel({ value: '08:09', precision: 'minute' })
  panel.reset('08:09')
  const style = deriveDatePickerStyle(ImGuiDarkTheme)
  const dl = { fillRect: vi.fn(), fillText: vi.fn(), line: vi.fn() }
  const rect = { x: 0, y: 0, width: TimeSelectionPanel.minimumWidth(style, 'minute') }
  const paint = (active: boolean) => panel.paint({ theme: ImGuiDarkTheme } as any, dl as any, rect, style, derivePopupStyle(ImGuiDarkTheme), { active })
  paint(false)
  expect(dl.line.mock.calls.filter(args => args[5] === 2)).toHaveLength(0)
  dl.line.mockClear()
  paint(true)
  expect(dl.line.mock.calls.filter(args => args[5] === 2)).toHaveLength(1)
})
