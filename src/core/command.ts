import {
  APP_CONTEXT_PROVIDER,
  AppContextRegistry,
  createAppContextKey,
  isAppContextProvider,
  type AppContextLookupKey,
} from './app_context'
import type { Disposable, DisposeFn } from './disposable'
import type { RenderObject } from './render_object'

export type CommandTrigger = 'api' | 'click' | 'keyboard' | 'menu'
export type CommandPredicate = (context: CommandExecutionContext) => boolean
export type CommandReasonResolver = (context: CommandExecutionContext) => string | undefined
export type CommandExecutor<TResult = unknown> = (context: CommandExecutionContext) => TResult | Promise<TResult>

export interface CommandExecutionContext {
  appContext: AppContextRegistry
  commandManager: CommandManager
  source?: RenderObject
  trigger: CommandTrigger
  event?: unknown
}

export interface AppCommand<TResult = unknown> {
  id: string
  title: string
  description?: string
  icon?: string
  shortcut?: string | readonly string[]
  permission?: string | readonly string[]
  visible?: CommandPredicate
  enabled?: CommandPredicate
  canExecute?: CommandPredicate
  checked?: CommandPredicate
  disabledReason?: CommandReasonResolver
  execute: CommandExecutor<TResult>
}

export interface CommandState {
  id: string
  title: string
  description?: string
  icon?: string
  visible: boolean
  enabled: boolean
  checked: boolean
  executing: boolean
  reason?: string
  command?: AppCommand
}

export interface CommandExecuteOptions {
  source?: RenderObject
  trigger?: CommandTrigger
  event?: unknown
}

export interface CommandEvaluateOptions {
  source?: RenderObject
  trigger?: CommandTrigger
  event?: unknown
}

export interface CommandInspectOptions extends CommandEvaluateOptions {}

export interface CommandScopeDiagnostic {
  id: number
  label: string
  ownCommandIds: string[]
  activeCommandIds: string[]
  isSourceScope: boolean
  isOwnerScope: boolean
}

export interface CommandInspection {
  commandId: string
  exists: boolean
  state: CommandState
  command?: AppCommand
  sourceScopeId: number
  sourceScopeLabel: string
  ownerScopeId?: number
  ownerScopeLabel?: string
  scopeChain: CommandScopeDiagnostic[]
  permissions: string[]
  shortcuts: string[]
  overridesParent: boolean
}

export interface PermissionService {
  has(permission: string, context: CommandExecutionContext): boolean
}

export interface CommandInterceptor {
  beforeExecute?(command: AppCommand, context: CommandExecutionContext): boolean | void | Promise<boolean | void>
  afterExecute?(command: AppCommand, context: CommandExecutionContext, result: unknown): void | Promise<void>
  onError?(command: AppCommand, context: CommandExecutionContext, error: unknown): void | Promise<void>
}

export const commandManagerContextKey = createAppContextKey<CommandManager>('ds-ui.command-manager')

export const allowAllPermissionService: PermissionService = {
  has: () => true,
}

export const COMMAND_SCOPE_PROVIDER: unique symbol = Symbol('ds-ui.command-scope-provider')

export interface CommandScopeProvider {
  [COMMAND_SCOPE_PROVIDER](): CommandScope
}

export function isCommandScopeProvider(value: unknown): value is CommandScopeProvider {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as Partial<CommandScopeProvider>)[COMMAND_SCOPE_PROVIDER] === 'function',
  )
}

let nextCommandScopeId = 1

export class CommandScope implements Disposable {
  readonly debugId = nextCommandScopeId++
  debugLabel?: string

  private readonly _commands = new Map<string, AppCommand>()
  private readonly _disposers = new Map<string, DisposeFn>()
  private _disposed = false

  constructor(readonly parent?: CommandScope, debugLabel?: string) {
    this.debugLabel = debugLabel
  }

  get disposed(): boolean {
    return this._disposed
  }

  register(command: AppCommand): DisposeFn {
    this._assertActive()
    this.unregister(command.id)
    this._commands.set(command.id, command)
    const dispose = (): void => {
      if (this._disposed) return
      if (this._commands.get(command.id) === command) this.unregister(command.id)
    }
    this._disposers.set(command.id, dispose)
    return dispose
  }

  unregister(commandId: string): boolean {
    this._assertActive()
    this._disposers.delete(commandId)
    return this._commands.delete(commandId)
  }

  get(commandId: string): AppCommand | undefined {
    return this._commands.get(commandId) ?? this.parent?.get(commandId)
  }

  getOwn(commandId: string): AppCommand | undefined {
    return this._commands.get(commandId)
  }

  hasOwn(commandId: string): boolean {
    return this._commands.has(commandId)
  }

  ids(): IterableIterator<string> {
    return this._commands.keys()
  }

  ownCommands(): AppCommand[] {
    return [...this._commands.values()]
  }

  commands(): AppCommand[] {
    const entries = this.parent ? this.parent.commands() : []
    const byId = new Map(entries.map(command => [command.id, command]))
    for (const command of this._commands.values()) byId.set(command.id, command)
    return [...byId.values()]
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this._commands.clear()
    this._disposers.clear()
  }

  private _assertActive(): void {
    if (this._disposed) throw new Error('Command scope has been disposed.')
  }
}

export class CommandManager implements Disposable {
  readonly rootScope: CommandScope

  private _permissionService: PermissionService
  private readonly _listeners = new Set<() => void>()
  private readonly _interceptors = new Set<CommandInterceptor>()
  private readonly _executing = new Set<AppCommand>()
  private _version = 0
  private _disposed = false

  constructor(options: { rootScope?: CommandScope; permissionService?: PermissionService } = {}) {
    this.rootScope = options.rootScope ?? new CommandScope()
    this._permissionService = options.permissionService ?? allowAllPermissionService
  }

  get version(): number {
    return this._version
  }

  get permissionService(): PermissionService {
    return this._permissionService
  }

  setPermissionService(service: PermissionService): void {
    this._assertActive()
    if (this._permissionService === service) return
    this._permissionService = service
    this.invalidate()
  }

  register(command: AppCommand): DisposeFn {
    this._assertActive()
    const dispose = this.rootScope.register(command)
    this.invalidate()
    return () => {
      dispose()
      this._safeInvalidate()
    }
  }

  addInterceptor(interceptor: CommandInterceptor): DisposeFn {
    this._assertActive()
    this._interceptors.add(interceptor)
    return () => this._interceptors.delete(interceptor)
  }

  evaluate(commandId: string, options: CommandEvaluateOptions = {}): CommandState {
    this._assertActive()
    const scope = this.resolveScope(options.source)
    const command = scope?.get(commandId)
    if (!command) {
      return {
        id: commandId,
        title: commandId,
        visible: false,
        enabled: false,
        checked: false,
        executing: false,
        reason: '命令不存在',
      }
    }
    const context = this.createExecutionContext({
      source: options.source,
      trigger: options.trigger ?? 'api',
      event: options.event,
    })
    try {
      return this._evaluateCommand(command, context)
    } finally {
      context.appContext.dispose()
    }
  }

  inspect(commandId: string, options: CommandInspectOptions = {}): CommandInspection {
    this._assertActive()
    const sourceScope = this.resolveScope(options.source)
    const ownerScope = this._findOwningScope(sourceScope, commandId)
    const command = ownerScope?.getOwn(commandId)
    const state = this.evaluate(commandId, options)
    return {
      commandId,
      exists: Boolean(command),
      state,
      command,
      sourceScopeId: sourceScope.debugId,
      sourceScopeLabel: this._scopeLabel(sourceScope),
      ownerScopeId: ownerScope?.debugId,
      ownerScopeLabel: ownerScope ? this._scopeLabel(ownerScope) : undefined,
      scopeChain: this._buildScopeDiagnostics(sourceScope, ownerScope),
      permissions: command ? normalizeCommandStringList(command.permission) : [],
      shortcuts: command ? normalizeCommandStringList(command.shortcut) : [],
      overridesParent: Boolean(ownerScope && this._findOwningScope(ownerScope.parent, commandId)),
    }
  }

  inspectAll(options: CommandInspectOptions = {}): CommandInspection[] {
    this._assertActive()
    const sourceScope = this.resolveScope(options.source)
    return sourceScope.commands().map(command => this.inspect(command.id, options))
  }

  async execute<TResult = unknown>(
    commandId: string,
    options: CommandExecuteOptions = {},
  ): Promise<TResult | undefined> {
    this._assertActive()
    const scope = this.resolveScope(options.source)
    const command = scope?.get(commandId)
    if (!command) return undefined
    const context = this.createExecutionContext({
      source: options.source,
      trigger: options.trigger ?? 'api',
      event: options.event,
    })
    const state = this._evaluateCommand(command, context)
    if (!state.visible || !state.enabled) {
      context.appContext.dispose()
      return undefined
    }
    try {
      const shouldContinue = await this._runBeforeExecute(command, context)
      if (!shouldContinue) return undefined
      this._executing.add(command)
      this.invalidate()
      try {
        const result = await command.execute(context) as TResult
        await this._runAfterExecute(command, context, result)
        return result
      } finally {
        this._executing.delete(command)
        this._safeInvalidate()
      }
    } catch (error) {
      await this._runExecuteError(command, context, error)
      throw error
    } finally {
      context.appContext.dispose()
    }
  }

  createExecutionContext(options: Required<Pick<CommandExecuteOptions, 'trigger'>> & {
    source?: RenderObject
    event?: unknown
  }): CommandExecutionContext {
    return {
      appContext: this.createAppContextSnapshot(options.source),
      commandManager: this,
      source: options.source,
      trigger: options.trigger,
      event: options.event,
    }
  }

  resolveScope(source?: RenderObject): CommandScope {
    let current = source
    while (current) {
      if (isCommandScopeProvider(current)) return current[COMMAND_SCOPE_PROVIDER]()
      current = current.parent
    }
    return this.rootScope
  }

  createAppContextSnapshot(source?: RenderObject): AppContextRegistry {
    const snapshot = new AppContextRegistry()
    const seen = new Set<AppContextLookupKey>()
    let current = source
    while (current) {
      if (isAppContextProvider(current)) this._copyContextOwnValues(snapshot, current[APP_CONTEXT_PROVIDER](), seen)
      current = current.parent
    }
    const rootContext = source?.owner?.appContext
    let currentContext: AppContextRegistry | undefined = rootContext
    while (currentContext) {
      this._copyContextOwnValues(snapshot, currentContext, seen)
      currentContext = currentContext.parent
    }
    return snapshot
  }

  subscribe(listener: () => void): DisposeFn {
    this._assertActive()
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  invalidate(): void {
    this._assertActive()
    this._version++
    for (const listener of [...this._listeners]) listener()
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this._listeners.clear()
    this._interceptors.clear()
    this._executing.clear()
    this.rootScope.dispose()
  }

  private _evaluateCommand(command: AppCommand, context: CommandExecutionContext): CommandState {
    const executing = this._executing.has(command)
    const baseState: CommandState = {
      id: command.id,
      title: command.title,
      description: command.description,
      icon: command.icon,
      visible: true,
      enabled: true,
      checked: false,
      executing,
      command,
    }
    if (command.visible && !command.visible(context)) return { ...baseState, visible: false, enabled: false }
    if (!this._hasPermission(command, context)) {
      return { ...baseState, enabled: false, reason: '权限不足' }
    }
    if (executing) return { ...baseState, enabled: false, reason: '正在执行' }
    if (command.enabled && !command.enabled(context)) {
      return { ...baseState, enabled: false, reason: this._resolveDisabledReason(command, context) }
    }
    if (command.canExecute && !command.canExecute(context)) {
      return { ...baseState, enabled: false, reason: this._resolveDisabledReason(command, context) }
    }
    if (command.checked) return { ...baseState, checked: command.checked(context) }
    return baseState
  }

  private _hasPermission(command: AppCommand, context: CommandExecutionContext): boolean {
    if (!command.permission) return true
    const permissions = Array.isArray(command.permission) ? command.permission : [command.permission]
    return permissions.every(permission => this._permissionService.has(permission, context))
  }

  private _resolveDisabledReason(command: AppCommand, context: CommandExecutionContext): string | undefined {
    return command.disabledReason?.(context) ?? '当前状态不可用'
  }

  private async _runBeforeExecute(command: AppCommand, context: CommandExecutionContext): Promise<boolean> {
    for (const interceptor of [...this._interceptors]) {
      const result = await interceptor.beforeExecute?.(command, context)
      if (result === false) return false
    }
    return true
  }

  private async _runAfterExecute(
    command: AppCommand,
    context: CommandExecutionContext,
    result: unknown,
  ): Promise<void> {
    for (const interceptor of [...this._interceptors]) {
      await interceptor.afterExecute?.(command, context, result)
    }
  }

  private async _runExecuteError(
    command: AppCommand,
    context: CommandExecutionContext,
    error: unknown,
  ): Promise<void> {
    for (const interceptor of [...this._interceptors]) {
      await interceptor.onError?.(command, context, error)
    }
  }

  private _copyContextOwnValues(
    target: AppContextRegistry,
    source: AppContextRegistry,
    seen: Set<AppContextLookupKey>,
  ): void {
    for (const key of source.keys()) {
      if (seen.has(key)) continue
      seen.add(key)
      target.set(key as never, source.getOwn(key as never))
    }
  }

  private _assertActive(): void {
    if (this._disposed) throw new Error('Command manager has been disposed.')
  }

  private _safeInvalidate(): void {
    if (this._disposed) return
    this.invalidate()
  }

  get disposed(): boolean {
    return this._disposed
  }

  private _findOwningScope(scope: CommandScope | undefined, commandId: string): CommandScope | undefined {
    let current = scope
    while (current) {
      if (current.hasOwn(commandId)) return current
      current = current.parent
    }
    return undefined
  }

  private _buildScopeDiagnostics(sourceScope: CommandScope, ownerScope?: CommandScope): CommandScopeDiagnostic[] {
    const diagnostics: CommandScopeDiagnostic[] = []
    let current: CommandScope | undefined = sourceScope
    while (current) {
      diagnostics.push({
        id: current.debugId,
        label: this._scopeLabel(current),
        ownCommandIds: [...current.ids()],
        activeCommandIds: current.commands().map(command => command.id),
        isSourceScope: current === sourceScope,
        isOwnerScope: current === ownerScope,
      })
      current = current.parent
    }
    return diagnostics
  }

  private _scopeLabel(scope: CommandScope): string {
    if (scope === this.rootScope) return scope.debugLabel ?? 'root'
    return scope.debugLabel ?? `scope-${scope.debugId}`
  }
}

function normalizeCommandStringList(value?: string | readonly string[]): string[] {
  if (!value) return []
  if (typeof value === 'string') return [value]
  return [...value]
}
