// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { DrawList } from '../rendering/draw_list'
import { PaintContext } from '../rendering/paint_context'
import {
  deriveDatePickerStyle,
  derivePopupStyle,
} from '../theme/component_styles'
import { ImGuiDarkTheme } from '../theme/default_theme'
import {
  DateCalendarPanel,
  type DateCalendarPanelRect,
} from './date_calendar_panel'

const style = deriveDatePickerStyle(ImGuiDarkTheme)
const popupStyle = derivePopupStyle(ImGuiDarkTheme)
const rect: DateCalendarPanelRect = {
  x: 10,
  y: 20,
  width: DateCalendarPanel.minimumWidth(style),
}

function titlePoint(): { x: number; y: number } {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + style.padding + style.cellSize / 2,
  }
}

function headerPoint(direction: 'prev' | 'next'): { x: number; y: number } {
  return {
    x: direction === 'prev'
      ? rect.x + style.padding + style.cellSize / 2
      : rect.x + rect.width - style.padding - style.cellSize / 2,
    y: rect.y + style.padding + style.cellSize / 2,
  }
}

function choicePoint(index: number): { x: number; y: number } {
  const cellWidth = (rect.width - style.padding * 2) / 4
  const cellHeight = style.cellSize * 1.5
  return {
    x: rect.x + style.padding + (index % 4 + 0.5) * cellWidth,
    y: rect.y + style.headerHeight +
      (Math.floor(index / 4) + 0.5) * cellHeight,
  }
}

function countRoundedBackgrounds(
  panel: DateCalendarPanel,
  active: boolean,
): number {
  const roundRect = vi.fn()
  const canvasContext = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    roundRect,
    rect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    set fillStyle(_value: unknown) {},
    set strokeStyle(_value: unknown) {},
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D
  const context = new PaintContext(canvasContext, ImGuiDarkTheme)
  panel.paint(
    context,
    new DrawList(context),
    rect,
    style,
    popupStyle,
    { active },
  )
  return roundRect.mock.calls.length
}

describe('DateCalendarPanel', () => {
  it('moves through day, month, and year views without popup ownership', () => {
    const invalidate = vi.fn()
    const panel = new DateCalendarPanel(invalidate)
    panel.reset({ year: 2026, month: 7, day: 13 })

    panel.handlePointerDown(titlePoint(), rect, style)
    expect(panel.debugState().viewMode).toBe('month')

    panel.handlePointerDown(titlePoint(), rect, style)
    expect(panel.debugState().viewMode).toBe('year')

    const targetYear = panel.debugState().yearRangeStart + 8
    panel.handlePointerDown(choicePoint(8), rect, style)
    expect(panel.debugState()).toMatchObject({
      viewMode: 'month',
      viewYear: targetYear,
      viewMonth: 7,
    })

    panel.handlePointerDown(choicePoint(10), rect, style)
    expect(panel.debugState()).toMatchObject({
      viewMode: 'day',
      viewYear: targetYear,
      viewMonth: 11,
    })
    expect(invalidate).toHaveBeenCalled()
  })

  it('keeps pointer navigation inside supported calendar boundaries', () => {
    const panel = new DateCalendarPanel()
    panel.reset({ year: 1, month: 1, day: 1 })

    panel.handlePointerDown(headerPoint('prev'), rect, style)
    expect(panel.debugState()).toMatchObject({
      viewYear: 1,
      viewMonth: 1,
      focusedDate: { year: 1, month: 1, day: 1 },
    })

    panel.reset({ year: 9_999, month: 12, day: 31 })
    panel.handlePointerDown(headerPoint('next'), rect, style)
    expect(panel.debugState()).toMatchObject({
      viewYear: 9_999,
      viewMonth: 12,
      focusedDate: { year: 9_999, month: 12, day: 31 },
    })
  })

  it('uses a keyboard cursor and activates the date only on Enter', () => {
    const panel = new DateCalendarPanel()
    panel.reset({ year: 2026, month: 4, day: 14 })

    panel.handleKeyDown(new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      cancelable: true,
    }))
    panel.handleKeyDown(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      cancelable: true,
    }))

    expect(panel.debugState()).toMatchObject({
      selected: { year: 2026, month: 4, day: 14 },
      focusedDate: { year: 2026, month: 4, day: 22 },
    })

    const result = panel.handleKeyDown(new KeyboardEvent('keydown', {
      key: 'Enter',
      cancelable: true,
    }))
    expect(result).toEqual({
      handled: true,
      activatedDate: { year: 2026, month: 4, day: 22 },
    })
    expect(panel.debugState().selected).toEqual({
      year: 2026,
      month: 4,
      day: 22,
    })
  })

  it('does not paint the keyboard cursor while the panel is inactive', () => {
    const panel = new DateCalendarPanel()
    panel.reset({ year: 2026, month: 4, day: 14 })
    panel.handleKeyDown(new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      cancelable: true,
    }))

    expect(countRoundedBackgrounds(panel, true)).toBe(
      countRoundedBackgrounds(panel, false) + 2,
    )
  })
})

for (const mode of ['month', 'year'] as const) {
  it(`shows a distinct keyboard focus in ${mode} view only for the active panel`, () => {
    const panel = new DateCalendarPanel()
    panel.reset({ year: 2026, month: 4, day: 14 })
    panel.viewMode = mode
    panel.handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    const stroke = vi.spyOn(DrawList.prototype, 'strokeRect')
    try {
      countRoundedBackgrounds(panel, true)
      expect(stroke).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number), ImGuiDarkTheme.focusBorder, 2, popupStyle.borderRadius)
      stroke.mockClear()
      countRoundedBackgrounds(panel, false)
      expect(stroke).not.toHaveBeenCalled()
    } finally { stroke.mockRestore() }
    panel.handleKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(panel.viewMode).toBe(mode === 'month' ? 'day' : 'month')
  })
}

for (const mode of ['month', 'year'] as const) {
  it(`clears ${mode} mouse hover without losing the keyboard target`, () => {
    const panel = new DateCalendarPanel()
    panel.reset({ year: 2026, month: 4, day: 14 })
    panel.viewMode = mode
    panel.handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    const target = panel.focusedDate
    panel.hoveredMonth = 0
    panel.hoveredYear = 2020
    expect(panel.clearHover()).toBe(true)
    expect(panel.hoveredMonth).toBe(-1)
    expect(panel.hoveredYear).toBe(-1)
    expect(panel.clearHover()).toBe(false)
    expect(panel.focusedDate).toEqual(target)
    panel.handleKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(panel.focusedDate).toEqual(target)
  })
}

it.each(['year', 'month'] as const)('%s precision activates only the selected calendar grain without descending into days', precision => {
  const panel = new DateCalendarPanel(); panel.selectionPrecision = precision
  panel.reset({ year: 2026, month: 2, day: 28 }); expect(panel.viewMode).toBe(precision)
  panel.handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
  const out = panel.handleKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))
  expect(out.activatedDate).toBeDefined(); expect(panel.viewMode).toBe(precision)
  expect(out.activatedDate?.day).toBe(1); if (precision === 'year') expect(out.activatedDate?.month).toBe(1)
})
