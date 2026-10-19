import { drawableImageBrand, isDrawableImage, type DrawableImage, type ImageLoader, type ImageLoadOptions, type ImageLoadResult, type ImageLoadSource, type ImageRequest } from './image_loader'

class WebImageUse implements DrawableImage {
  readonly [drawableImageBrand] = true as const
  private closed = false
  constructor(private value: CanvasImageSource | null) {}
  get released(): boolean { return this.closed }
  get source(): CanvasImageSource {
    if (this.closed || !this.value) throw new Error('Image use is released')
    return this.value
  }
  get width(): number { const value = this.value as { naturalWidth?: number; videoWidth?: number; width?: number } | null; return value?.naturalWidth ?? value?.videoWidth ?? value?.width ?? 0 }
  get height(): number { const value = this.value as { naturalHeight?: number; videoHeight?: number; height?: number } | null; return value?.naturalHeight ?? value?.videoHeight ?? value?.height ?? 0 }
  borrow(): DrawableImage { return new WebImageUse(this.source) }
  release(): void { this.closed = true; this.value = null }
}
interface Subscriber { active: boolean; complete: (result: ImageLoadResult) => void }
interface PendingImage { image: HTMLImageElement; subscribers: Set<Subscriber>; objectUrl?: string }

/** Browser behavior stays native to Image; only in-flight requests are shared. */
export class WebImageLoader implements ImageLoader {
  private readonly pending = new Map<string, PendingImage>()
  borrow(source: CanvasImageSource | DrawableImage): DrawableImage {
    return isDrawableImage(source) ? source.borrow() : new WebImageUse(source)
  }
  load(source: ImageLoadSource, options: ImageLoadOptions, complete: (result: ImageLoadResult) => void): ImageRequest {
    if (typeof Image === 'undefined') { complete({ error: new Error('Browser Image is unavailable') }); return { cancel() {} } }
    let objectUrl: string | undefined
    const url = typeof source === 'string' ? source : (objectUrl = URL.createObjectURL(new Blob([source.bytes.slice().buffer], { type: source.mediaType })))
    const key = `${options.crossOrigin ?? ''}\0${url}`
    const subscriber: Subscriber = { active: true, complete }
    let entry = this.pending.get(key)
    if (!entry) {
      const image = new Image()
      entry = { image, subscribers: new Set(), objectUrl }
      this.pending.set(key, entry)
      const pending = entry
      const finish = (error?: Error) => {
        if (this.pending.get(key) !== pending) return
        this.pending.delete(key); image.onload = null; image.onerror = null
        if (pending.objectUrl) URL.revokeObjectURL(pending.objectUrl)
        for (const item of pending.subscribers) {
          if (!item.active) continue
          item.active = false
          const use = error ? undefined : new WebImageUse(image)
          try { item.complete(error ? { error } : { image: use! }) } catch (failure) { use?.release(); queueMicrotask(() => { throw failure }) }
        }
        pending.subscribers.clear()
      }
      if (options.crossOrigin) image.crossOrigin = options.crossOrigin
      image.onload = () => finish()
      image.onerror = () => finish(new Error('Image load failed'))
      entry.subscribers.add(subscriber)
      image.src = url
    } else {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      entry.subscribers.add(subscriber)
    }
    const pending = entry
    return { cancel: () => {
      if (!subscriber.active) return
      subscriber.active = false; pending.subscribers.delete(subscriber)
      if (pending.subscribers.size === 0 && this.pending.get(key) === pending) {
        this.pending.delete(key); pending.image.onload = null; pending.image.onerror = null
        if (pending.objectUrl) URL.revokeObjectURL(pending.objectUrl)
      }
    } }
  }
}
