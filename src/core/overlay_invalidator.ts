export type OverlayPaintInvalidator = () => void

export class OverlayInvalidator {
  private static _instance: OverlayInvalidator | null = null

  static get instance(): OverlayInvalidator {
    if (!OverlayInvalidator._instance) OverlayInvalidator._instance = new OverlayInvalidator()
    return OverlayInvalidator._instance
  }

  static disposeInstance(): void {
    OverlayInvalidator._instance?.dispose()
  }

  private _paintInvalidator?: OverlayPaintInvalidator
  private _suppressDepth = 0

  private constructor() {}

  setPaintInvalidator(invalidator?: OverlayPaintInvalidator): void {
    this._paintInvalidator = invalidator
  }

  requestPaint(fallback?: () => void): void {
    if (this._suppressDepth > 0) return
    if (this._paintInvalidator) {
      this._paintInvalidator()
      return
    }
    fallback?.()
  }

  suppressPaint<T>(operation: () => T): T {
    this._suppressDepth++
    try {
      return operation()
    } finally {
      this._suppressDepth--
    }
  }

  dispose(): void {
    this._paintInvalidator = undefined
    this._suppressDepth = 0
    OverlayInvalidator._instance = null
  }
}
