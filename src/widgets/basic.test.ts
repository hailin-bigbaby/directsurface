import { describe, expect, it, vi } from 'vitest'
import { PipelineOwner, type BoxConstraints } from '../core/render_object'
import { PaintContext } from '../rendering/paint_context'
import { deriveTextStyle } from '../theme/component_styles'
import { ImGuiDarkTheme, ImGuiLightTheme } from '../theme/default_theme'
import { colorToCSS } from '../theme/theme'
import { RenderParagraph, RenderText } from './basic'

const constraints: BoxConstraints = {
  minWidth: 0,
  maxWidth: 400,
  minHeight: 0,
  maxHeight: 200,
}

describe('RenderText style adapter', () => {
  it('derives layout typography from the owner theme', () => {
    const owner = new PipelineOwner({}, ImGuiDarkTheme)
    const text = new RenderText('Hello')
    text.attach(owner)
    text.layout(constraints)

    expect(text.size.height).toBe(deriveTextStyle(ImGuiDarkTheme).lineHeight)

    const nextTheme = { ...ImGuiLightTheme, fontSize: ImGuiLightTheme.fontSize + 3 }
    owner.setTheme(nextTheme)
    text.markNeedsLayout()
    owner.flushLayout()

    expect(text.size.height).toBe(deriveTextStyle(nextTheme).lineHeight)
  })

  it('uses token-derived text color and font when painting without an override', () => {
    const style = deriveTextStyle(ImGuiDarkTheme)
    let fillStyle = ''
    let font = ''
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      fillText: vi.fn(),
      set fillStyle(value: string) { fillStyle = value },
      get fillStyle() { return fillStyle },
      set font(value: string) { font = value },
      get font() { return font },
      textAlign: 'left' as CanvasTextAlign,
      textBaseline: 'middle' as CanvasTextBaseline,
    } as unknown as CanvasRenderingContext2D

    const text = new RenderText('Hello')
    text.layout(constraints, false, { theme: ImGuiDarkTheme })
    text.paint(new PaintContext(ctx), { x: 0, y: 0 })

    expect(fillStyle).toBe(colorToCSS(style.text))
    expect(font).toBe(`${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`)
  })

  it('keeps legacy color override and supports role size weight options', () => {
    const legacyColor = { r: 1, g: 2, b: 3, a: 1 }
    const legacy = new RenderText('Legacy', legacyColor)
    const styled = new RenderText('Styled', { role: 'onAccent', size: 'large', weight: 'semibold' })
    let fillStyle = ''
    let font = ''
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      fillText: vi.fn(),
      set fillStyle(value: string) { fillStyle = value },
      get fillStyle() { return fillStyle },
      set font(value: string) { font = value },
      get font() { return font },
      textAlign: 'left' as CanvasTextAlign,
      textBaseline: 'middle' as CanvasTextBaseline,
    } as unknown as CanvasRenderingContext2D

    legacy.layout(constraints, false, { theme: ImGuiDarkTheme })
    legacy.paint(new PaintContext(ctx), { x: 0, y: 0 })

    expect(fillStyle).toBe(colorToCSS(legacyColor))

    styled.layout(constraints, false, { theme: ImGuiDarkTheme })
    styled.paint(new PaintContext(ctx, ImGuiDarkTheme), { x: 0, y: 0 })

    const style = deriveTextStyle(ImGuiDarkTheme)
    expect(styled.size.height).toBe(style.lineHeight * (style.fontSize + 2) / style.fontSize)
    expect(fillStyle).toBe(colorToCSS(ImGuiDarkTheme.textOnAccent))
    expect(font).toBe(`600 ${style.fontSize + 2}px ${style.fontFamily}`)

    const title = new RenderText('Title', { role: 'title' })
    title.layout(constraints, false, { theme: ImGuiDarkTheme })
    title.paint(new PaintContext(ctx, ImGuiDarkTheme), { x: 0, y: 0 })

    expect(fillStyle).toBe(colorToCSS(ImGuiDarkTheme.textPrimary))
    expect(font).toBe(`${style.titleFontWeight} ${style.titleFontSize}px ${style.fontFamily}`)
  })

  it('can shrink and ellipsize single-line text within the provided width', () => {
    const text = new RenderText('12345678901234567890', {
      size: 26,
      minSize: 18,
      fit: 'shrink',
      overflow: 'ellipsis',
    })

    text.layout({ ...constraints, maxWidth: 80 }, false, { theme: ImGuiDarkTheme })

    expect(text.size.width).toBeLessThanOrEqual(80)
    expect(text.paintFontSize).toBeLessThanOrEqual(26)
    expect(text.paintText.length).toBeGreaterThan(0)
  })

  it('uses fitted text color and weight when painting', () => {
    let fillStyle = ''
    let font = ''
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      fillText: vi.fn(),
      set fillStyle(value: string) { fillStyle = value },
      get fillStyle() { return fillStyle },
      set font(value: string) { font = value },
      get font() { return font },
      textAlign: 'left' as CanvasTextAlign,
      textBaseline: 'middle' as CanvasTextBaseline,
    } as unknown as CanvasRenderingContext2D
    const text = new RenderText('128', {
      role: 'accent',
      size: 26,
      minSize: 18,
      fit: 'shrink',
      overflow: 'ellipsis',
      weight: 'bold',
    })

    text.layout({ ...constraints, maxWidth: 240 }, false, { theme: ImGuiDarkTheme })
    text.paint(new PaintContext(ctx, ImGuiDarkTheme), { x: 0, y: 0 })

    expect(fillStyle).toBe(colorToCSS(ImGuiDarkTheme.textAccent))
    expect(font).toBe(`bold ${text.paintFontSize}px ${ImGuiDarkTheme.fontFamily}`)
  })

  it('wraps paragraph text within the provided width constraint', () => {
    const paragraph = new RenderParagraph('Popover 适合承载轻量说明和快捷操作。')
    paragraph.layout({ ...constraints, maxWidth: 80 }, false, { theme: ImGuiDarkTheme })

    expect(paragraph.size.height).toBeGreaterThan(deriveTextStyle(ImGuiDarkTheme).lineHeight)
    expect(paragraph.size.width).toBeLessThanOrEqual(80)
  })
})
