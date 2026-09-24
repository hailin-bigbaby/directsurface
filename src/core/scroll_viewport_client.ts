export interface ScrollViewport {
  viewWidth: number
  viewHeight: number
  scrollX: number
  scrollY: number
}

export interface ScrollViewportClient {
  setScrollViewport(viewport: ScrollViewport): void
}

export function isScrollViewportClient(value: unknown): value is ScrollViewportClient {
  return typeof (value as ScrollViewportClient | null)?.setScrollViewport === 'function'
}
