export const drawableImageBrand = Symbol('directsurface.drawable-image')

export interface EncodedImage {
  readonly bytes: Uint8Array
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/svg+xml'
}
export interface ImageCancellation {
  readonly cancelled: boolean
  onCancel(callback: () => void): () => void
}
export interface DrawableImage {
  readonly [drawableImageBrand]: true
  readonly width: number
  readonly height: number
  readonly source: CanvasImageSource
  readonly released: boolean
  borrow(): DrawableImage
  release(): void
}
export type ImageLoadSource = string | EncodedImage
export type ImageSource = ImageLoadSource | CanvasImageSource | DrawableImage
export type ImageLoadResult = { readonly image: DrawableImage; readonly error?: undefined } | { readonly image?: undefined; readonly error: Error }
export interface ImageRequest { cancel(): void }
export interface ImageLoadOptions { readonly crossOrigin?: string }
export interface ImageLoader {
  load(source: ImageLoadSource, options: ImageLoadOptions, complete: (result: ImageLoadResult) => void): ImageRequest
  borrow(source: CanvasImageSource | DrawableImage): DrawableImage
}
export type ImageByteProvider = (source: string, cancellation: ImageCancellation) => Promise<EncodedImage>
export function isDrawableImage(value: unknown): value is DrawableImage {
  return !!value && typeof value === 'object' && (value as DrawableImage)[drawableImageBrand] === true
}
export function isEncodedImage(value: unknown): value is EncodedImage {
  return !!value && typeof value === 'object' && (value as EncodedImage).bytes instanceof Uint8Array && typeof (value as EncodedImage).mediaType === 'string'
}
