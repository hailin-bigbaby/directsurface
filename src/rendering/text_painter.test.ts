import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { TextMeasurer } from '../core/text_measurer'
import { loadDirectSurfaceFonts } from '../app/font_loader'
import { fitSingleLineText } from './text_painter'

beforeEach(() => TextMeasurer.clearCache())
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('fitted text cache', () => {
  it('reuses the fitted result and protects the cache from caller mutation', () => {
    const measure = vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const first = fitSingleLineText('abcdefgh', 48, 12, 'Arial')
    const expected = { ...first }
    first.text = 'mutated'
    first.width = -1
    measure.mockClear()
    expect(fitSingleLineText('abcdefgh', 48, 12, 'Arial')).toEqual(expected)
    expect(measure).not.toHaveBeenCalled()
  })

  it('invalidates on width, typography and font reload while retaining Unicode behavior', () => {
    let unit = 8
    const measure = vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => Array.from(text).length * unit)
    const fit = (width = 48, size = 12, family = 'Arial', weight?: number, style?: 'italic') =>
      fitSingleLineText('🙂🙂🙂🙂🙂🙂', width, size, family, weight, style)
    fit()
    for (const next of [() => fit(56), () => fit(48, 14), () => fit(48, 12, 'serif'), () => fit(48, 12, 'Arial', 700), () => fit(48, 12, 'Arial', 700, 'italic')]) {
      measure.mockClear()
      next()
      expect(measure).toHaveBeenCalled()
    }
    unit = 10
    TextMeasurer.clearCache()
    expect(fit().text).toBe('🙂...')
  })

  it('evicts old results without clearing recently used labels', () => {
    const measure = vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    for (let i = 0; i < 2048; i++) fitSingleLineText(`label-${i}`, 100, 12, 'Arial')
    fitSingleLineText('label-0', 100, 12, 'Arial')
    fitSingleLineText('new label', 100, 12, 'Arial')
    measure.mockClear()
    fitSingleLineText('label-0', 100, 12, 'Arial')
    expect(measure).not.toHaveBeenCalled()
    fitSingleLineText('label-1', 100, 12, 'Arial')
    expect(measure).toHaveBeenCalled()
  })


  it('invalidates when the measurement function is replaced', () => {
    const first = vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    expect(fitSingleLineText('abcdef', 40, 12, 'Arial').text).toBe('ab...')
    first.mockRestore()
    const next = vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 10)
    expect(fitSingleLineText('abcdef', 40, 12, 'Arial')).toEqual({ text: 'a...', width: 40 })
    expect(next).toHaveBeenCalled()
  })

  it('invalidates fitted results through the public font loader', async () => {
    let unit = 8
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * unit)
    expect(fitSingleLineText('abcdef', 40, 12, 'Arial').text).toBe('ab...')
    vi.stubGlobal('document', { fonts: { ready: Promise.resolve() } })
    unit = 10
    await loadDirectSurfaceFonts()
    expect(fitSingleLineText('abcdef', 40, 12, 'Arial').text).toBe('a...')
  })

  it('bounds long-label retention without changing fitted output', () => {
    const measure = vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const retained = 'a'.repeat(4096)
    const long = retained + 'a'
    const first = fitSingleLineText(retained, 48, 12, 'Arial')
    measure.mockClear()
    expect(fitSingleLineText(retained, 48, 12, 'Arial')).toEqual(first)
    expect(measure).not.toHaveBeenCalled()
    expect(fitSingleLineText(long, 48, 12, 'Arial')).toEqual(first)
    measure.mockClear()
    expect(fitSingleLineText(long, 48, 12, 'Arial')).toEqual(first)
    expect(measure).toHaveBeenCalled()
  })

  it('keeps text keys, finite widths, unbounded widths and empty output distinct', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    expect(fitSingleLineText('abcdef', Infinity, 12, 'Arial')).toEqual({ text: 'abcdef', width: 48 })
    expect(fitSingleLineText('abcdef', 40, 12, 'Arial')).toEqual({ text: 'ab...', width: 40 })
    expect(fitSingleLineText('uvwxyz', 40, 12, 'Arial')).toEqual({ text: 'uv...', width: 40 })
    expect(fitSingleLineText('abcdef', Infinity, 12, 'Arial')).toEqual({ text: 'abcdef', width: 48 })
    expect(fitSingleLineText('', 40, 12, 'Arial')).toEqual({ text: '', width: 0 })
    expect(fitSingleLineText('abcdef', 0, 12, 'Arial')).toEqual({ text: '', width: 0 })
    expect(fitSingleLineText('abcdef', 12, 12, 'Arial')).toEqual({ text: '', width: 0 })
  })
})
