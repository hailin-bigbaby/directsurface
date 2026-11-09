import { describe, expect, it, vi } from 'vitest'
import { ModernCompactLightTheme } from '../theme/modern_theme'
import { TextMeasurer } from '../core/text_measurer'
import { resolveDialogLayout } from './dialog_layout'

const buttons = [{ key: 'cancel', label: '取消操作' }, { key: 'later', label: '稍后再处理' }, { key: 'ok', label: '确认提交采购审批', primary: true }]
const content = Array.from({ length: 80 }, (_, i) => `第${i + 1}条说明：提交后将占用申购数量。`).join('\n')
describe('shared dialog layout', () => {
  for (const height of [220, 480, 900]) for (const input of [0, 28]) {
    it(`keeps all text and reachable controls at 320x${height}, input=${input}`, () => {
      const measure = vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => Array.from(text).length * 13)
      try {
        const context = { theme: ModernCompactLightTheme, viewport: { x: 40, y: 20, width: 320, height, dpr: 1 } }
        const first = resolveDialogLayout(context, 420, 0, content, buttons, input)
        expect(first.panelX).toBeGreaterThanOrEqual(40)
        expect(first.panelX + first.panelW).toBeLessThanOrEqual(360)
        expect(first.panelY).toBeGreaterThanOrEqual(20)
        expect(first.panelY + first.panelH).toBeLessThanOrEqual(height + 20)
        expect(first.contentLines.join('')).toContain('第80条说明')
        expect(first.stacked).toBe(true)
        expect(first.maxScroll).toBeGreaterThan(0)
        const last = resolveDialogLayout(context, 420, 0, content, buttons, input, first.maxScroll)
        for (const b of last.buttons) {
          expect(b.x).toBeGreaterThanOrEqual(last.panelX)
          expect(b.x + b.w).toBeLessThanOrEqual(last.panelX + last.panelW)
          expect(b.y + b.h).toBeLessThanOrEqual(last.panelY + last.panelH)
        }
        if (input) expect(last.inputRect.y + last.inputRect.h).toBeLessThanOrEqual(last.buttons[0]!.y)
      } finally { measure.mockRestore() }
    })
  }
})

it('uses one 16/8 spacing rhythm for both dialog types', () => {
  const context = { theme: ModernCompactLightTheme, viewport: { width: 900, height: 650, dpr: 1 } }
  const actions = [{key:'cancel',label:'取消'}, {key:'ok',label:'确认',primary:true}]
  for (const inputHeight of [0,28]) {
    const layout = resolveDialogLayout(context,420,0,'说明',actions,inputHeight)
    expect(layout.padding).toBeCloseTo(16)
    expect(layout.body.x - layout.panelX).toBeCloseTo(16)
    expect(layout.buttons[1]!.x - layout.buttons[0]!.x - layout.buttons[0]!.w).toBeCloseTo(8)
    expect(layout.panelX + layout.panelW - layout.buttons[1]!.x - layout.buttons[1]!.w).toBeCloseTo(16)
    if (inputHeight) {
      expect(layout.inputRect.x).toBeCloseTo(layout.body.x)
      expect(layout.inputRect.x + layout.inputRect.w).toBeCloseTo(layout.buttons[1]!.x + layout.buttons[1]!.w)
      expect(layout.inputRect.y - layout.contentY - layout.contentLines.length * layout.lineHeight).toBeCloseTo(8)
      expect(layout.buttonY - layout.inputRect.y - layout.inputRect.h).toBeCloseTo(16)
    }
  }
})
