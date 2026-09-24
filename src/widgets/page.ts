import { RenderBox } from '../layout/render_box'
import { constrainSize, type BoxConstraints, type LayoutContext, type RenderLifecycleAware, type RenderLoadedContext, type RenderObject } from '../core/render_object'
import type { IconName } from './icon'
import type {
  TabbedDocumentContext,
  TabbedDocumentContextAware,
  TabbedDocumentLifecycle,
  TabbedDocumentPatch,
} from './tabbed_workspace'

export interface RenderPageOptions {
  child?: RenderBox
  disposeChild?: boolean
  onLoaded?: (context: RenderLoadedContext) => void
  onActivated?: () => void
  onDeactivated?: () => void
  beforeClose?: () => boolean | Promise<boolean>
}

export class RenderPage extends RenderBox implements RenderLifecycleAware, TabbedDocumentLifecycle, TabbedDocumentContextAware {
  static override debugTypeName = 'RenderPage'
  private _child?: RenderBox
  private _documentContext?: TabbedDocumentContext
  private readonly _onLoaded?: (context: RenderLoadedContext) => void
  private readonly _onActivated?: () => void
  private readonly _onDeactivated?: () => void
  private readonly _beforeClose?: () => boolean | Promise<boolean>
  private readonly _disposeChild: boolean

  constructor(options: RenderPageOptions = {}) {
    super()
    this._child = options.child
    this._disposeChild = options.disposeChild ?? true
    this._onLoaded = options.onLoaded
    this._onActivated = options.onActivated
    this._onDeactivated = options.onDeactivated
    this._beforeClose = options.beforeClose
    if (this._child) this._child.parent = this
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  get child(): RenderBox | undefined {
    return this._child
  }

  get documentContext(): TabbedDocumentContext | undefined {
    return this._documentContext
  }

  setChild(child?: RenderBox): void {
    if (this._child === child) return
    if (this._child) {
      const previous = this._child
      if (this._disposeChild) {
        previous.dispose()
      } else {
        previous.parent = undefined
        if (previous.owner) previous.detach()
      }
    }
    this._child = child
    if (child) {
      child.parent = this
      if (this.owner && child.owner !== this.owner) child.attach(this.owner)
    }
    this.markNeedsLayout()
  }

  activateSelf(): boolean {
    return this._documentContext?.activateSelf() ?? false
  }

  requestClose(): Promise<boolean> {
    return this._documentContext?.requestClose() ?? Promise.resolve(false)
  }

  updateDocument(patch: TabbedDocumentPatch): boolean {
    return this._documentContext?.update(patch) ?? false
  }

  setTitle(title: string): boolean {
    return this._documentContext?.setTitle(title) ?? false
  }

  setDirty(dirty: boolean): boolean {
    return this._documentContext?.setDirty(dirty) ?? false
  }

  setTooltip(tooltip?: string): boolean {
    return this._documentContext?.setTooltip(tooltip) ?? false
  }

  setIcon(icon?: IconName): boolean {
    return this._documentContext?.setIcon(icon) ?? false
  }

  onLoaded(context: RenderLoadedContext): void {
    this._onLoaded?.(context)
  }

  onDocumentActivated(): void {
    this._onActivated?.()
  }

  onDocumentDeactivated(): void {
    this._onDeactivated?.()
  }

  beforeDocumentClose(): boolean | Promise<boolean> {
    return this._beforeClose?.() ?? true
  }

  attachDocumentContext(context: TabbedDocumentContext): void {
    this._documentContext = context
  }

  detachDocumentContext(): void {
    this._documentContext = undefined
  }

  override dispose(): void {
    this._documentContext = undefined
    if (!this._disposeChild && this._child) {
      const child = this._child
      this._child = undefined
      child.parent = undefined
      if (child.owner) child.detach()
    }
    super.dispose()
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      if (this._child) visitor(this._child)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    if (this._child) visitor(this._child)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const fillsWidth = constraints.maxWidth !== Infinity
    const fillsHeight = constraints.maxHeight !== Infinity
    const targetWidth = fillsWidth ? constraints.maxWidth : constraints.minWidth
    const targetHeight = fillsHeight ? constraints.maxHeight : constraints.minHeight

    if (!this._child) {
      this.size = constrainSize(constraints, { width: targetWidth, height: targetHeight })
      return
    }

    const horizontalAlignment = this._child.resolveHorizontalAlignment('stretch')
    const verticalAlignment = this._child.resolveVerticalAlignment('stretch')
    this._child.layout({
      minWidth: fillsWidth && horizontalAlignment === 'stretch' && this._child.width === undefined ? targetWidth : 0,
      maxWidth: fillsWidth ? targetWidth : Infinity,
      minHeight: fillsHeight && verticalAlignment === 'stretch' && this._child.height === undefined ? targetHeight : 0,
      maxHeight: fillsHeight ? targetHeight : Infinity,
    }, true, context)

    this.size = constrainSize(constraints, {
      width: fillsWidth ? targetWidth : this._child.outerSize.width,
      height: fillsHeight ? targetHeight : this._child.outerSize.height,
    })
    this._child.positionInSlot({ x: 0, y: 0, width: this.size.width, height: this.size.height }, horizontalAlignment, verticalAlignment)
  }
}
