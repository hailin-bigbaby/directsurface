import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaintContext } from '../rendering/paint_context'
import { ImGuiLightTheme } from '../theme/default_theme'
import { colorToCSS } from '../theme/theme'
import { RenderImagePreview } from './image_preview'
import { RenderMarkdownViewer } from './markdown_viewer'

class StubImage {
  static instances: StubImage[] = []
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  crossOrigin = ''
  src = ''
  naturalWidth = 160
  naturalHeight = 96

  constructor() {
    StubImage.instances.push(this)
  }
}

function createPaintContext(): {
  context: PaintContext
  ctx: CanvasRenderingContext2D
  drawImage: ReturnType<typeof vi.fn>
  fillStyles: string[]
  strokeStyles: string[]
} {
  const fillStyles: string[] = []
  const strokeStyles: string[] = []
  const drawImage = vi.fn()
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    arc: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    drawImage,
    fillText: vi.fn(),
    set fillStyle(value: string) { fillStyles.push(value) },
    get fillStyle() { return fillStyles[fillStyles.length - 1] ?? '' },
    set strokeStyle(value: string) { strokeStyles.push(value) },
    get strokeStyle() { return strokeStyles[strokeStyles.length - 1] ?? '' },
    set font(_value: string) {},
    get font() { return '' },
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'middle' as CanvasTextBaseline,
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D
  return { context: new PaintContext(ctx, ImGuiLightTheme), ctx, drawImage, fillStyles, strokeStyles }
}

afterEach(() => {
  vi.unstubAllGlobals()
  StubImage.instances = []
})

describe('RenderImagePreview', () => {
  it('keeps a shared external image alive when the other preview switches or disposes', () => {
    const close = vi.fn(), source = { width: 96, height: 64, close } as unknown as CanvasImageSource
    const first = new RenderImagePreview({ source }), second = new RenderImagePreview({ source })
    first.source = null; first.dispose()
    second.layout({ minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: 200 })
    const painted = createPaintContext(); second.paint(painted.context, { x: 0, y: 0 })
    expect(painted.drawImage.mock.calls[0]?.[0]).toBe(source)
    second.dispose(); expect(close).not.toHaveBeenCalled()
  })

  it('shares an in-flight image with the original Markdown image branch while cancelling one subscriber', () => {
    vi.stubGlobal('Image', StubImage)
    const preview = new RenderImagePreview({ src: 'shared-image.png' })
    const viewer = new RenderMarkdownViewer({ markdown: '![Image](image.png)', resolveImageSrc: () => 'shared-image.png' })
    viewer.layout({ minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: 200 })
    expect(StubImage.instances).toHaveLength(1)
    preview.source = null; preview.dispose()
    StubImage.instances[0]!.onload!()
    viewer.layout({ minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: 200 })
    const painted = createPaintContext(); viewer.performPaint(painted.context, { x: 0, y: 0 })
    expect(painted.drawImage.mock.calls[0]?.[0]).toBe(StubImage.instances[0])
    viewer.dispose()
  })
  it('uses a stable square default size and paints a placeholder', () => {
    const preview = new RenderImagePreview({ placeholderText: 'hl' })
    const painted = createPaintContext()

    preview.layout({ minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: 100 }, false, { theme: ImGuiLightTheme })
    preview.paint(painted.context, { x: 0, y: 0 })

    expect(preview.size).toEqual({ width: 40, height: 40 })
    expect(preview.debugState().loadState).toBe('empty')
    expect(painted.fillStyles).toContain(colorToCSS(ImGuiLightTheme.surfaceDataHeader))
    expect(painted.drawImage).not.toHaveBeenCalled()
  })

  it('lays out explicit avatar size and clips image as a circle', () => {
    const image = { width: 120, height: 60 } as unknown as CanvasImageSource
    const preview = new RenderImagePreview({
      source: image,
      size: 48,
      shape: 'circle',
      fit: 'cover',
      borderWidth: 1,
    })
    const painted = createPaintContext()

    preview.layout({ minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: 200 }, false, { theme: ImGuiLightTheme })
    preview.paint(painted.context, { x: 10, y: 20 })

    expect(preview.size).toEqual({ width: 48, height: 48 })
    expect(preview.debugState()).toEqual(expect.objectContaining({
      loadState: 'loaded',
      sourceType: 'canvas',
      imageSize: { width: 120, height: 60 },
      displayRect: { x: -24, y: 0, width: 96, height: 48 },
    }))
    expect(painted.ctx.arc).toHaveBeenCalledWith(34, 44, 24, 0, Math.PI * 2)
    expect(painted.ctx.clip).toHaveBeenCalled()
    expect(painted.drawImage).toHaveBeenCalledWith(image, -14, 20, 96, 48)
    expect(painted.strokeStyles).toContain(colorToCSS(ImGuiLightTheme.borderSubtle))
  })

  it('paints circle background and border with the same centered radius as the image clip', () => {
    const preview = new RenderImagePreview({
      width: 80,
      height: 48,
      shape: 'circle',
      placeholderText: 'A',
      borderWidth: 1,
    })
    const painted = createPaintContext()

    preview.layout({ minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: 200 }, false, { theme: ImGuiLightTheme })
    preview.paint(painted.context, { x: 10, y: 20 })

    expect(painted.ctx.arc).toHaveBeenCalledWith(50, 44, 24, 0, Math.PI * 2)
    expect(painted.ctx.strokeRect).not.toHaveBeenCalled()
  })

  it('preserves aspect ratio for contain fit', () => {
    const image = { width: 100, height: 50 } as unknown as CanvasImageSource
    const preview = new RenderImagePreview({
      source: image,
      width: 80,
      height: 80,
      fit: 'contain',
      shape: 'rectangle',
    })

    preview.layout({ minWidth: 0, maxWidth: 200, minHeight: 0, maxHeight: 200 }, false, { theme: ImGuiLightTheme })

    expect(preview.debugState().displayRect).toEqual({ x: 0, y: 20, width: 80, height: 40 })
  })

  it('keeps default size stable after async image load', () => {
    vi.stubGlobal('Image', StubImage)
    const preview = new RenderImagePreview({ src: '/avatar.png' })

    preview.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 300 }, false, { theme: ImGuiLightTheme })
    expect(preview.size).toEqual({ width: 40, height: 40 })
    expect(preview.debugState().loadState).toBe('loading')

    StubImage.instances[0]!.onload?.()
    preview.layout({ minWidth: 0, maxWidth: 300, minHeight: 0, maxHeight: 300 }, false, { theme: ImGuiLightTheme })

    expect(preview.size).toEqual({ width: 40, height: 40 })
    expect(preview.debugState()).toEqual(expect.objectContaining({
      loadState: 'loaded',
      imageSize: { width: 160, height: 96 },
    }))
  })

  it('cleans pending image callbacks when changing source and disposing', () => {
    vi.stubGlobal('Image', StubImage)
    const preview = new RenderImagePreview({ src: '/first.png' })
    const first = StubImage.instances[0]!

    preview.setSource('/second.png')
    const second = StubImage.instances[1]!

    expect(first.onload).toBeNull()
    expect(first.onerror).toBeNull()
    expect(second.onload).toBeTypeOf('function')

    preview.dispose()

    expect(second.onload).toBeNull()
    expect(second.onerror).toBeNull()
  })
})
