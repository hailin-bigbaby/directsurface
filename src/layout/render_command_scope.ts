import {
  COMMAND_SCOPE_PROVIDER,
  CommandScope,
  type AppCommand,
  type CommandManager,
} from '../core/command'
import { constrainSize, type BoxConstraints, type LayoutContext, type Offset, type RenderObject } from '../core/render_object'
import type { PaintContext } from '../rendering/paint_context'
import { RenderBox, resolveChildLayout } from './render_box'

export interface RenderCommandScopeOptions {
  commandManager?: CommandManager
  scope?: CommandScope
  debugLabel?: string
  commands?: AppCommand[]
  child?: RenderBox
  disposeScopeOnDispose?: boolean
}

export class RenderCommandScope extends RenderBox {
  static override debugTypeName = 'RenderCommandScope'
  readonly commandScope: CommandScope
  child?: RenderBox

  private readonly _commandManager?: CommandManager
  private readonly _disposeScopeOnDispose: boolean

  constructor(options: RenderCommandScopeOptions = {}) {
    super()
    this._commandManager = options.commandManager
    this.commandScope = options.scope ?? new CommandScope(options.commandManager?.rootScope, options.debugLabel)
    if (options.scope && options.debugLabel) this.commandScope.debugLabel = options.debugLabel
    for (const command of options.commands ?? []) this.commandScope.register(command)
    this.child = options.child
    this._disposeScopeOnDispose = options.disposeScopeOnDispose ?? options.scope === undefined
    if (this.child) this.child.parent = this
  }

  [COMMAND_SCOPE_PROVIDER](): CommandScope {
    return this.commandScope
  }

  register(command: AppCommand): () => void {
    const dispose = this.commandScope.register(command)
    this._invalidateCommandManager()
    return () => {
      dispose()
      this._invalidateCommandManager()
    }
  }

  setChild(child?: RenderBox): void {
    if (this.child === child) return
    const previous = this.child
    this.child = child
    if (previous) previous.parent = undefined
    if (child) {
      child.parent = this
      if (this.owner && child.owner !== this.owner) child.attach(this.owner)
    }
    this.markNeedsLayout()
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    if (this.child) visitor(this.child)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    if (!this.child) {
      this.size = constrainSize(constraints, { width: 0, height: 0 })
      return
    }
    const layout = resolveChildLayout(this.child, constraints, 'stretch', 'stretch')
    this.child.layout(layout.constraints, true, context)
    this.size = constrainSize(constraints, this.child.outerSize)
    this.child.positionInSlot(
      { x: 0, y: 0, width: this.size.width, height: this.size.height },
      layout.horizontalAlignment,
      layout.verticalAlignment,
    )
  }

  performPaint(context: PaintContext, offset: Offset): void {
    if (!this.child) return
    this.child.paint(context, {
      x: offset.x + this.child.offset.x,
      y: offset.y + this.child.offset.y,
    })
  }

  override dispose(): void {
    try {
      super.dispose()
    } finally {
      if (this._disposeScopeOnDispose) this.commandScope.dispose()
    }
  }

  private _invalidateCommandManager(): void {
    if (!this._commandManager || this._commandManager.disposed) return
    this._commandManager.invalidate()
  }
}
