import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebImageLoader } from './web_image_loader'
import type { DrawableImage } from './image_loader'

class ControlledImage {
  static images: ControlledImage[] = []
  naturalWidth = 96; naturalHeight = 64; src = ''; crossOrigin = ''
  onload: (() => void) | null = null; onerror: (() => void) | null = null
  constructor() { ControlledImage.images.push(this) }
}
afterEach(() => { vi.unstubAllGlobals(); ControlledImage.images = [] })
describe('image loader ownership and browser boundary', () => {
  it('shares an in-flight image and cancels only the corresponding subscription', () => {
    vi.stubGlobal('Image', ControlledImage)
    const loader = new WebImageLoader(), first = vi.fn(), second = vi.fn()
    const request = loader.load('/same.png', { crossOrigin: 'anonymous' }, first)
    loader.load('/same.png', { crossOrigin: 'anonymous' }, second)
    expect(ControlledImage.images).toHaveLength(1)
    expect(ControlledImage.images[0]!.crossOrigin).toBe('anonymous')
    request.cancel(); ControlledImage.images[0]!.onload?.()
    expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledTimes(1)
    const image = second.mock.calls[0]![0].image as DrawableImage
    expect([image.width, image.height]).toEqual([96, 64])
    image.release(); expect(() => image.borrow()).toThrow(/released/)
  })
  it('never closes a borrowed external source when either consumer releases', () => {
    const close = vi.fn(), source = { width: 96, height: 64, close } as unknown as CanvasImageSource
    const loader = new WebImageLoader(), first = loader.borrow(source), second = loader.borrow(first)
    first.release(); first.release(); expect(second.source).toBe(source); second.release()
    expect(close).not.toHaveBeenCalled()
  })
  it('removes load handlers on final cancellation and rejects stale completion', () => {
    vi.stubGlobal('Image', ControlledImage)
    const loader = new WebImageLoader(), complete = vi.fn(), request = loader.load('/late.png', {}, complete)
    const image = ControlledImage.images[0]!, late = image.onload
    request.cancel(); request.cancel(); expect(image.onload).toBeNull(); expect(image.onerror).toBeNull()
    late?.(); expect(complete).not.toHaveBeenCalled()
  })
  it('keeps different crossOrigin requests separate and delivers failure once', () => {
    vi.stubGlobal('Image', ControlledImage)
    const loader = new WebImageLoader(), complete = vi.fn()
    loader.load('/same.png', {}, complete); loader.load('/same.png', { crossOrigin: 'anonymous' }, vi.fn())
    expect(ControlledImage.images).toHaveLength(2)
    const image = ControlledImage.images[0]!, fail = image.onerror
    fail?.(); fail?.(); expect(complete).toHaveBeenCalledTimes(1); expect(complete.mock.calls[0]![0].error).toBeInstanceOf(Error)
  })
})
