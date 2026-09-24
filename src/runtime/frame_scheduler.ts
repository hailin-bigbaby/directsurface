export type RequestFrame = (callback: FrameRequestCallback) => number
export type CancelFrame = (handle: number) => void

export class FrameScheduler {
  private _frameScheduled = false
  private _layoutNeeded = true
  private _frameHandle: number | null = null

  constructor(
    private readonly _onFrame: () => void,
    private readonly _requestFrame: RequestFrame = callback => requestAnimationFrame(callback),
    private readonly _cancelFrame: CancelFrame = handle => cancelAnimationFrame(handle),
  ) {}

  get frameScheduled(): boolean {
    return this._frameScheduled
  }

  get layoutNeeded(): boolean {
    return this._layoutNeeded
  }

  scheduleFrame(): void {
    if (this._frameScheduled) return
    this._frameScheduled = true
    this._frameHandle = this._requestFrame(() => {
      this._frameScheduled = false
      this._frameHandle = null
      this._onFrame()
    })
  }

  scheduleLayout(): void {
    this.markLayoutNeeded()
    this.scheduleFrame()
  }

  markLayoutNeeded(): void {
    this._layoutNeeded = true
  }

  cancelFrame(): void {
    if (this._frameHandle !== null) {
      this._cancelFrame(this._frameHandle)
      this._frameHandle = null
    }
    this._frameScheduled = false
  }

  consumeLayoutNeeded(): boolean {
    const needed = this._layoutNeeded
    this._layoutNeeded = false
    return needed
  }

  dispose(): void {
    this.cancelFrame()
  }
}
