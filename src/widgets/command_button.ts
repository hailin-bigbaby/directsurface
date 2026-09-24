import {
  commandManagerContextKey,
  type CommandManager,
  type CommandState,
  type CommandTrigger,
} from '../core/command'
import type { BoxConstraints, LayoutContext, PipelineOwner } from '../core/render_object'
import type { DisposeFn } from '../core/disposable'
import { RenderButton } from './button'
import type { ButtonVariant } from '../theme/component_styles'

export interface RenderCommandButtonOptions {
  commandId: string
  commandManager?: CommandManager
  label?: string
  tooltip?: string
  variant?: ButtonVariant
}

export class RenderCommandButton extends RenderButton {
  static override debugTypeName = 'RenderCommandButton'
  readonly commandId: string

  private readonly _commandManager?: CommandManager
  private readonly _explicitLabel?: string
  private readonly _explicitTooltip?: string
  private _commandSubscription?: DisposeFn
  private _lastVersion = -1
  private _lastState?: CommandState

  constructor(options: RenderCommandButtonOptions) {
    super({
      label: options.label ?? options.commandId,
      tooltip: options.tooltip,
      variant: options.variant,
      disabled: true,
    })
    this.commandId = options.commandId
    this._commandManager = options.commandManager
    this._explicitLabel = options.label
    this._explicitTooltip = options.tooltip
    this.onClick = () => {
      void this.executeCommand('click')
    }
  }

  get commandState(): CommandState | undefined {
    this.refreshCommandState()
    return this._lastState
  }

  override attach(owner: PipelineOwner): void {
    super.attach(owner)
    this._syncCommandSubscription()
    this.refreshCommandState(true)
  }

  override detach(): void {
    this._commandSubscription?.()
    this._commandSubscription = undefined
    super.detach()
  }

  override performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    this.refreshCommandState()
    if (!this.visible) {
      this.size = { width: 0, height: 0 }
      return
    }
    super.performLayout(constraints, context)
  }

  override onKeyDown(event: KeyboardEvent): boolean {
    if (event.key !== 'Enter' && event.key !== ' ') return false
    if (!this.refreshCommandState()) return false
    event.preventDefault()
    void this.executeCommand('keyboard', event)
    return true
  }

  async executeCommand(trigger: CommandTrigger = 'api', event?: unknown): Promise<unknown> {
    const manager = this._resolveCommandManager()
    if (!manager) return undefined
    this.refreshCommandState(true)
    return manager.execute(this.commandId, { source: this, trigger, event })
  }

  refreshCommandState(force = false): boolean {
    const manager = this._resolveCommandManager()
    if (!manager) {
      this.visible = true
      this.setDisabled(true)
      this.setLoading(false)
      return false
    }
    if (!force && this._lastVersion === manager.version && this._lastState) return this._lastState.visible && this._lastState.enabled
    const state = manager.evaluate(this.commandId, { source: this })
    this._lastVersion = manager.version
    this._lastState = state
    const nextLabel = this._explicitLabel ?? state.title
    if (this.label !== nextLabel) this.label = nextLabel
    this.tooltip = this._explicitTooltip ?? state.reason ?? state.description ?? ''
    this.setLoading(state.executing)
    this.visible = state.visible
    this.setDisabled(!state.enabled)
    return state.visible && state.enabled
  }

  override dispose(): void {
    this._commandSubscription?.()
    this._commandSubscription = undefined
    super.dispose()
  }

  private _syncCommandSubscription(): void {
    this._commandSubscription?.()
    const manager = this._resolveCommandManager()
    if (!manager) return
    this._commandSubscription = manager.subscribe(() => {
      this._lastVersion = -1
      this.refreshCommandState(true)
      this.markNeedsLayout()
    })
  }

  private _resolveCommandManager(): CommandManager | undefined {
    return this._commandManager ?? this.getAppContext(commandManagerContextKey)
  }
}
