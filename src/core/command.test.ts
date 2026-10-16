import { describe, expect, it, vi } from 'vitest'
import { AppContextRegistry, createAppContextKey } from './app_context'
import {
  COMMAND_SCOPE_PROVIDER,
  CommandManager,
  CommandScope,
  type CommandScopeProvider,
} from './command'
import { PipelineOwner, RenderObject, type BoxConstraints, type LayoutContext, type Offset } from './render_object'
import type { PaintContext } from '../rendering/paint_context'

class TestBox extends RenderObject {
  performLayout(_constraints: BoxConstraints, _context: LayoutContext): void {
    this.size = { width: 10, height: 10 }
  }

  performPaint(_context: PaintContext, _offset: Offset): void {}

  visitChildren(_visitor: (child: RenderObject) => void): void {}
}

class CommandScopeBox extends TestBox implements CommandScopeProvider {
  constructor(readonly scope: CommandScope) {
    super()
  }

  [COMMAND_SCOPE_PROVIDER](): CommandScope {
    return this.scope
  }
}

describe('CommandManager', () => {
  it('evaluates command permission and canExecute from render app context', () => {
    const dirtyKey = createAppContextKey<boolean>('dirty')
    const rootContext = new AppContextRegistry(undefined, [[dirtyKey, true]])
    const owner = new PipelineOwner({ appContext: rootContext })
    const manager = new CommandManager({
      permissionService: {
        has: permission => permission === 'record.save',
      },
    })
    const source = new TestBox()
    source.attach(owner)
    const execute = vi.fn()

    manager.register({
      id: 'save',
      title: '保存',
      permission: 'record.save',
      canExecute: ctx => ctx.appContext.require(dirtyKey) === true,
      execute,
    })

    const state = manager.evaluate('save', { source })

    expect(state.visible).toBe(true)
    expect(state.enabled).toBe(true)
    expect(state.reason).toBeUndefined()

    rootContext.set(dirtyKey, false)
    manager.invalidate()

    const disabledState = manager.evaluate('save', { source })

    expect(disabledState.enabled).toBe(false)
    expect(disabledState.reason).toBe('当前状态不可用')

    source.dispose()
    manager.dispose()
    rootContext.dispose()
  })

  it('resolves local command scopes before the application root scope', async () => {
    const manager = new CommandManager()
    const calls: string[] = []
    manager.register({
      id: 'save',
      title: '全局保存',
      execute: () => calls.push('root'),
    })
    const pageScope = new CommandScope(manager.rootScope)
    pageScope.register({
      id: 'save',
      title: '页面保存',
      execute: () => calls.push('page'),
    })
    const scopeBox = new CommandScopeBox(pageScope)
    const source = new TestBox()
    source.parent = scopeBox

    const state = manager.evaluate('save', { source })
    await manager.execute('save', { source })

    expect(state.title).toBe('页面保存')
    expect(calls).toEqual(['page'])

    source.dispose()
    scopeBox.dispose()
    manager.dispose()
  })

  it('inspects command source scope, owner scope and parent overrides', () => {
    const manager = new CommandManager()
    manager.rootScope.debugLabel = 'application'
    manager.register({
      id: 'save',
      title: '全局保存',
      shortcut: ['Ctrl+S', 'Meta+S'],
      permission: ['record.save'],
      execute: vi.fn(),
    })
    const pageScope = new CommandScope(manager.rootScope, 'page')
    pageScope.register({
      id: 'save',
      title: '页面保存',
      shortcut: 'Ctrl+Shift+S',
      permission: 'record.page-save',
      execute: vi.fn(),
    })
    const scopeBox = new CommandScopeBox(pageScope)
    const source = new TestBox()
    source.parent = scopeBox

    const inspection = manager.inspect('save', { source })

    expect(inspection.exists).toBe(true)
    expect(inspection.state.title).toBe('页面保存')
    expect(inspection.ownerScopeLabel).toBe('page')
    expect(inspection.sourceScopeLabel).toBe('page')
    expect(inspection.permissions).toEqual(['record.page-save'])
    expect(inspection.shortcuts).toEqual(['Ctrl+Shift+S'])
    expect(inspection.overridesParent).toBe(true)
    expect(inspection.scopeChain.map(scope => scope.label)).toEqual(['page', 'application'])
    expect(inspection.scopeChain[0]?.isOwnerScope).toBe(true)
    expect(inspection.scopeChain[1]?.ownCommandIds).toEqual(['save'])

    source.dispose()
    scopeBox.dispose()
    manager.dispose()
  })

  it('inspects all active commands from the source scope', () => {
    const manager = new CommandManager()
    manager.register({ id: 'root-only', title: '根命令', execute: vi.fn() })
    const pageScope = new CommandScope(manager.rootScope, 'page')
    pageScope.register({ id: 'page-only', title: '页面命令', execute: vi.fn() })
    const scopeBox = new CommandScopeBox(pageScope)
    const source = new TestBox()
    source.parent = scopeBox

    const inspections = manager.inspectAll({ source })

    expect(inspections.map(item => item.commandId).sort()).toEqual(['page-only', 'root-only'])
    expect(inspections.find(item => item.commandId === 'root-only')?.ownerScopeLabel).toBe('root')
    expect(inspections.find(item => item.commandId === 'page-only')?.ownerScopeLabel).toBe('page')

    source.dispose()
    scopeBox.dispose()
    manager.dispose()
  })

  it('rechecks canExecute before execution', async () => {
    const manager = new CommandManager()
    const execute = vi.fn()
    let allowed = true
    manager.register({
      id: 'submit',
      title: '提交',
      canExecute: () => allowed,
      execute,
    })

    expect(manager.evaluate('submit').enabled).toBe(true)

    allowed = false
    await manager.execute('submit')

    expect(execute).not.toHaveBeenCalled()
    manager.dispose()
  })

  it('tracks executing state by command instance instead of id', async () => {
    const manager = new CommandManager()
    let finishFirst!: () => void
    const firstScope = new CommandScope(manager.rootScope)
    const secondScope = new CommandScope(manager.rootScope)
    const firstSource = new TestBox()
    const secondSource = new TestBox()
    firstSource.parent = new CommandScopeBox(firstScope)
    secondSource.parent = new CommandScopeBox(secondScope)
    firstScope.register({
      id: 'save',
      title: '保存 A',
      execute: () => new Promise<void>(resolve => {
        finishFirst = resolve
      }),
    })
    secondScope.register({
      id: 'save',
      title: '保存 B',
      execute: vi.fn(),
    })

    const running = manager.execute('save', { source: firstSource })
    await Promise.resolve()

    expect(manager.evaluate('save', { source: firstSource }).executing).toBe(true)
    expect(manager.evaluate('save', { source: firstSource }).enabled).toBe(false)
    expect(manager.evaluate('save', { source: secondSource }).executing).toBe(false)
    expect(manager.evaluate('save', { source: secondSource }).enabled).toBe(true)

    finishFirst()
    await running
    manager.dispose()
  })

  it('runs command interceptors around execution and supports cancellation', async () => {
    const manager = new CommandManager()
    const events: string[] = []
    const execute = vi.fn(() => 'done')
    manager.register({ id: 'save', title: '保存', execute })
    const disposeInterceptor = manager.addInterceptor({
      beforeExecute: command => {
        events.push(`before:${command.id}`)
      },
      afterExecute: (command, _context, result) => {
        events.push(`after:${command.id}:${result}`)
      },
    })

    await expect(manager.execute('save')).resolves.toBe('done')

    disposeInterceptor()
    manager.addInterceptor({
      beforeExecute: () => false,
    })
    await expect(manager.execute('save')).resolves.toBeUndefined()

    expect(execute).toHaveBeenCalledTimes(1)
    expect(events).toEqual(['before:save', 'after:save:done'])
    manager.dispose()
  })

  it('reports command execution errors to interceptors before rethrowing', async () => {
    const manager = new CommandManager()
    const error = new Error('failed')
    const onError = vi.fn()
    manager.register({
      id: 'save',
      title: '保存',
      execute: () => {
        throw error
      },
    })
    manager.addInterceptor({ onError })

    await expect(manager.execute('save')).rejects.toThrow(error)

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ id: 'save' }), expect.any(Object), error)
    manager.dispose()
  })

  it.each(['allow', 'cancel', 'reject'] as const)('blocks duplicates throughout an async guard that will %s', async outcome => {
    const manager = new CommandManager()
    const execute = vi.fn(() => 'saved')
    let resolveGuard!: (allowed: boolean) => void
    let rejectGuard!: (error: Error) => void
    const guard = new Promise<boolean>((resolve, reject) => { resolveGuard = resolve; rejectGuard = reject })
    const beforeExecute = vi.fn(() => guard)
    manager.register({ id: 'save', title: '保存', execute })
    const removeGuard = manager.addInterceptor({ beforeExecute })
    const pending = manager.execute('save')
    expect(manager.evaluate('save')).toMatchObject({ executing: true, enabled: false })
    await expect(manager.execute('save')).resolves.toBeUndefined()
    expect(beforeExecute).toHaveBeenCalledOnce()
    if (outcome === 'reject') {
      const assertion = expect(pending).rejects.toThrow('guard failed')
      rejectGuard(new Error('guard failed'))
      await assertion
    } else {
      resolveGuard(outcome === 'allow')
      await expect(pending).resolves.toBe(outcome === 'allow' ? 'saved' : undefined)
    }
    expect(execute).toHaveBeenCalledTimes(outcome === 'allow' ? 1 : 0)
    expect(manager.evaluate('save')).toMatchObject({ executing: false, enabled: true })
    removeGuard()
    await expect(manager.execute('save')).resolves.toBe('saved')
    manager.dispose()
  })

  it.each([true, false])('cleans execution state and context when a listener throws with executing=%s', async throwWhileExecuting => {
    const manager = new CommandManager()
    const error = new Error('listener failed')
    const execute = vi.fn(() => 'saved')
    manager.register({ id: 'save', title: '保存', execute })
    const snapshots = vi.spyOn(manager, 'createAppContextSnapshot')
    const unsubscribe = manager.subscribe(() => {
      if (manager.evaluate('save').executing === throwWhileExecuting) throw error
    })
    await expect(manager.execute('save')).rejects.toThrow(error)
    expect(manager.evaluate('save')).toMatchObject({ executing: false, enabled: true })
    expect(snapshots.mock.results[0]!.value.disposed).toBe(true)
    expect(execute).toHaveBeenCalledTimes(throwWhileExecuting ? 0 : 1)
    unsubscribe()
    await expect(manager.execute('save')).resolves.toBe('saved')
    manager.dispose()
  })

  it('keeps the original failure when the cleanup notification also throws', async () => {
    const manager = new CommandManager()
    const error = new Error('business failure')
    manager.register({ id: 'save', title: '保存', execute: () => { throw error } })
    manager.subscribe(() => {
      if (!manager.evaluate('save').executing) throw new Error('cleanup listener failure')
    })
    await expect(manager.execute('save')).rejects.toBe(error)
    expect(manager.evaluate('save').executing).toBe(false)
    manager.dispose()
  })

  it('does not start business execution if disposed while the guard is pending', async () => {
    const manager = new CommandManager()
    const execute = vi.fn()
    let resolveGuard!: (value: boolean) => void
    manager.register({ id: 'save', title: '保存', execute })
    manager.addInterceptor({ beforeExecute: () => new Promise<boolean>(resolve => { resolveGuard = resolve }) })
    const pending = manager.execute('save')
    manager.dispose()
    resolveGuard(true)
    await expect(pending).resolves.toBeUndefined()
    expect(execute).not.toHaveBeenCalled()
  })

  it.each(['unregister', 'replace', 'dispose-scope'] as const)('abandons a pending command after %s', async change => {
    const manager = new CommandManager()
    const scope = new CommandScope(manager.rootScope)
    const source = new TestBox()
    const scopeBox = new CommandScopeBox(scope)
    source.parent = scopeBox
    const oldExecute = vi.fn()
    const newExecute = vi.fn()
    const rootExecute = vi.fn(() => 'root')
    manager.register({ id: 'save', title: 'Root save', execute: rootExecute })
    scope.register({ id: 'save', title: 'Page save', execute: oldExecute })
    let resolveGuard!: (allowed: boolean) => void
    let contextSnapshot!: AppContextRegistry
    const removeGuard = manager.addInterceptor({ beforeExecute: (_command, context) => {
      contextSnapshot = context.appContext
      return new Promise<boolean>(resolve => { resolveGuard = resolve })
    } })
    const pending = manager.execute('save', { source })
    if (change === 'unregister') scope.unregister('save')
    else if (change === 'replace') scope.register({ id: 'save', title: 'New save', execute: newExecute })
    else scope.dispose()
    resolveGuard(true)
    await expect(pending).resolves.toBeUndefined()
    expect(oldExecute).not.toHaveBeenCalled()
    expect(newExecute).not.toHaveBeenCalled()
    expect(rootExecute).not.toHaveBeenCalled()
    expect(contextSnapshot.disposed).toBe(true)
    removeGuard()
    if (change === 'replace') {
      await manager.execute('save', { source })
      expect(newExecute).toHaveBeenCalledOnce()
    }
    await expect(manager.execute('save')).resolves.toBe('root')
    source.dispose()
    scopeBox.dispose()
    scope.dispose()
    manager.dispose()
  })

  it('does not run an inherited command after its source scope is disposed', async () => {
    const manager = new CommandManager()
    const scope = new CommandScope(manager.rootScope)
    const source = new CommandScopeBox(scope)
    const execute = vi.fn()
    let release!: (allowed: boolean) => void
    manager.register({ id: 'save', title: 'Save', execute })
    manager.addInterceptor({ beforeExecute: () => new Promise<boolean>(resolve => { release = resolve }) })
    const pending = manager.execute('save', { source })
    scope.dispose()
    release(true)
    await pending
    expect(execute).not.toHaveBeenCalled()
    expect(manager.evaluate('save').executing).toBe(false)
    source.dispose()
    manager.dispose()
  })

  it('delivers completion to every subscriber before reporting the first listener error', async () => {
    const manager = new CommandManager()
    const firstError = new Error('first completion listener')
    const secondError = new Error('second completion listener')
    const observed: boolean[] = []
    const last = vi.fn()
    manager.register({ id: 'save', title: 'Save', execute: () => 'saved' })
    const removeFirst = manager.subscribe(() => {
      if (!manager.evaluate('save').executing) throw firstError
    })
    manager.subscribe(() => observed.push(manager.evaluate('save').executing))
    const removeSecond = manager.subscribe(() => {
      if (!manager.evaluate('save').executing) throw secondError
    })
    manager.subscribe(last)
    await expect(manager.execute('save')).rejects.toBe(firstError)
    expect(observed).toEqual([true, false])
    expect(last).toHaveBeenCalledTimes(2)
    expect(manager.evaluate('save')).toMatchObject({ enabled: true, executing: false })
    removeFirst()
    removeSecond()
    await expect(manager.execute('save')).resolves.toBe('saved')
    manager.dispose()
  })

  it('does not throw when an async command finishes after manager disposal', async () => {
    const manager = new CommandManager()
    let resolveCommand!: () => void
    const runningErrors: unknown[] = []
    manager.register({
      id: 'save',
      title: '保存',
      execute: () => new Promise<void>(resolve => {
        resolveCommand = resolve
      }),
    })

    const running = manager.execute('save').catch(error => runningErrors.push(error))
    await Promise.resolve()

    manager.dispose()
    resolveCommand()
    await running

    expect(runningErrors).toEqual([])
  })

  it('allows registered command disposers to run after manager disposal', () => {
    const manager = new CommandManager()
    const dispose = manager.register({
      id: 'save',
      title: '保存',
      execute: vi.fn(),
    })

    manager.dispose()

    expect(() => dispose()).not.toThrow()
  })

  it('notifies listeners when command state can change', () => {
    const manager = new CommandManager()
    const listener = vi.fn()
    const dispose = manager.subscribe(listener)

    manager.register({ id: 'refresh', title: '刷新', execute: vi.fn() })
    manager.invalidate()
    dispose()
    manager.invalidate()

    expect(listener).toHaveBeenCalledTimes(2)
    manager.dispose()
  })
})
