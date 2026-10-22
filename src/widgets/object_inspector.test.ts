// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClipboardController } from '../core/clipboard'
import { FocusManager } from '../core/focus_manager'
import { RenderObjectInspector, type ObjectInspectorDebugNode } from './object_inspector'

function keyEvent(key: string, opts?: Partial<KeyboardEventInit>): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, ...opts, bubbles: true, cancelable: true })
}

function findNodeByPath(nodes: readonly ObjectInspectorDebugNode[], path: string): ObjectInspectorDebugNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node
    const child = node.children ? findNodeByPath(node.children, path) : undefined
    if (child) return child
  }
  return undefined
}

afterEach(() => {
  vi.useRealTimers()
  ClipboardController.instance.resetWriter()
  FocusManager.disposeInstance()
  vi.restoreAllMocks()
})

describe('RenderObjectInspector', () => {
  it('enumerates nested object properties lazily', () => {
    const value = {
      patient: {
        name: '张三',
        visit: { id: 'V001' },
      },
    }
    const inspector = new RenderObjectInspector({ value, label: 'state' })

    const root = inspector.debugState().roots[0]!
    expect(root.label).toContain('state: Object')
    expect(root.loaded).toBe(true)
    const patient = root.children?.find(node => node.path === 'state.patient')
    expect(patient?.loaded).toBe(false)

    expect(inspector.expandNode('state.patient')).toBe(true)

    const expandedPatient = inspector.debugState().roots[0]!.children?.find(node => node.path === 'state.patient')
    expect(expandedPatient?.loaded).toBe(true)
    expect(expandedPatient?.children?.map(node => node.path)).toContain('state.patient.name')
    expect(expandedPatient?.children?.map(node => node.path)).toContain('state.patient.visit')
  })

  it('preserves expanded paths and selection while refreshing displayed values', () => {
    const inspector = new RenderObjectInspector({ value: { nested: { value: 1 }, other: {} }, includePrototype: false })
    inspector.expandNode('root.nested')
    const tree = (inspector as any)._tree
    tree.selectedKey = findNodeByPath(inspector.debugState().roots, 'root.nested.value')!.key
    inspector.setValue({ other: {}, nested: { value: 2 } }, 'root', { preserveState: true })
    const state = inspector.debugState()
    const nested = findNodeByPath(state.roots, 'root.nested')!
    expect(state.expandedKeys).toContain(nested.key)
    expect(state.detailRows).toMatchObject({ path: 'root.nested.value', value: '2' })
    expect(findNodeByPath(state.roots, 'root.other')!.loaded).toBe(false)
    inspector.setValue({ other: {} }, 'root', { preserveState: true })
    expect(inspector.debugState().expandedKeys).toEqual([inspector.debugState().roots[0]!.key])
    expect(inspector.debugState().detailRows.path).toBe('root')
    inspector.dispose()
  })

  it('keeps default replacement and label changes as explicit view resets', () => {
    const inspector = new RenderObjectInspector({ value: { nested: {} }, includePrototype: false })
    inspector.expandNode('root.nested')
    inspector.setValue({ nested: {} })
    expect(inspector.debugState().expandedKeys).toHaveLength(1)
    inspector.expandNode('root.nested')
    inspector.setValue({ nested: {} }, 'other', { preserveState: true })
    expect(inspector.debugState().expandedKeys).toHaveLength(1)
    expect(inspector.debugState().detailRows.path).toBe('other')
    inspector.dispose()
  })

  it('restores deep paths after batched loading and repeated refreshes without invoking accessors', () => {
    vi.useFakeTimers()
    const getter = vi.fn(() => 'must not run')
    const value = (version: number) => Object.defineProperty({ first: 0, second: 0, nested: { deeper: { version } } }, 'accessor', { get: getter })
    const inspector = new RenderObjectInspector({ value: value(1), expansionBatchSize: 1, includePrototype: false })
    vi.runAllTimers()
    inspector.expandNode('root.nested'); vi.runAllTimers()
    inspector.expandNode('root.nested.deeper'); vi.runAllTimers()
    const tree = (inspector as any)._tree
    tree.selectedKey = findNodeByPath(inspector.debugState().roots, 'root.nested.deeper.version')!.key
    inspector.setValue(value(2), 'root', { preserveState: true })
    inspector.setValue(value(3), 'root', { preserveState: true })
    vi.runAllTimers()
    const state = inspector.debugState()
    expect(state.expandedKeys).toContain(findNodeByPath(state.roots, 'root.nested.deeper')!.key)
    expect(state.detailRows).toMatchObject({ path: 'root.nested.deeper.version', value: '3' })
    expect(getter).not.toHaveBeenCalled()
    inspector.setValue(value(4), 'root', { preserveState: true })
    inspector.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not transfer expansion to colliding symbol paths or override manual collapse during refresh', () => {
    vi.useFakeTimers()
    const first = Symbol('same'), second = Symbol('same')
    const inspector = new RenderObjectInspector({ value: { [first]: { a: 1 }, [second]: { b: 2 } }, includePrototype: false })
    const firstNode = inspector.debugState().roots[0]!.children![0]!
    inspector.expandNode(firstNode.key)
    inspector.setValue({ [second]: { b: 3 }, [first]: { a: 4 } }, 'root', { preserveState: true })
    expect(inspector.debugState().expandedKeys).toHaveLength(1)
    inspector.dispose()

    const batched = new RenderObjectInspector({ value: { nested: { a: 1, b: 2, c: 3 } }, expansionBatchSize: 1, includePrototype: false })
    vi.runAllTimers(); batched.expandNode('root.nested'); vi.runAllTimers()
    ;(batched as any)._tree.selectedKey = findNodeByPath(batched.debugState().roots, 'root.nested.a')!.key
    batched.setValue({ nested: { a: 4, b: 5, c: 6 } }, 'root', { preserveState: true })
    vi.runOnlyPendingTimers()
    const tree = (batched as any)._tree
    const node = tree.roots[0].children.find((child: any) => child.data?.path === 'root.nested')
    tree.expandedKeys = tree.expandedKeys.filter((key: string) => key !== node.key)
    tree.onExpand(node, false)
    vi.runAllTimers()
    expect(batched.debugState().expandedKeys).not.toContain(node.key)
    expect(batched.debugState().detailRows.path).not.toBe('root.nested.a')
    batched.dispose()
  })

  it('generates semantic label tokens for devtools-style coloring', () => {
    const inspector = new RenderObjectInspector({
      value: {
        name: '张三',
        age: 42,
        active: true,
        empty: null,
        nested: { visit: 'V001' },
      },
    })
    const children = inspector.debugState().roots[0]!.children ?? []

    expect(children.find(node => node.path === 'root.name')?.labelTokens).toEqual([
      { text: 'name', kind: 'name' },
      { text: ': ', kind: 'punctuation' },
      { text: "'张三'", kind: 'string' },
    ])
    expect(children.find(node => node.path === 'root.age')?.labelTokens?.at(2)).toEqual({ text: '42', kind: 'number' })
    expect(children.find(node => node.path === 'root.active')?.labelTokens?.at(2)).toEqual({ text: 'true', kind: 'boolean' })
    expect(children.find(node => node.path === 'root.empty')?.labelTokens?.at(2)).toEqual({ text: 'null', kind: 'null' })
    expect(children.find(node => node.path === 'root.nested')?.labelTokens?.at(2)?.kind).toBe('type')
    expect(children.find(node => node.path === 'root.nested')?.labelTokens?.at(3)).toEqual({ text: ' {...}', kind: 'meta' })
  })

  it('exposes structured detail rows for the selected node', () => {
    const inspector = new RenderObjectInspector({
      value: { patient: '张三' },
      label: 'state',
    })

    expect(inspector.debugState().detailRows).toMatchObject({
      title: 'state',
      path: 'state',
      type: 'Object',
      value: 'Object',
    })
    expect(inspector.debugState().detailText).toContain('Path: state')
    expect(inspector.debugState().detailText).toContain('Type: Object')
  })

  it('copies selected node path and value preview', () => {
    const copied: string[] = []
    ClipboardController.instance.setWriter(text => { copied.push(text) })
    const inspector = new RenderObjectInspector({
      value: { patient: '张三' },
      label: 'state',
    })
    inspector.expandNode('state')
    const tree = (inspector as any)._tree
    tree.selectedKey = findNodeByPath(inspector.debugState().roots, 'state.patient')!.key
    FocusManager.instance.register(tree)
    FocusManager.instance.setFocus(tree)

    expect(FocusManager.instance.handleKeyDownEvent(keyEvent('c', { ctrlKey: true }))).toBe(true)

    expect(copied).toEqual(["state.patient: '张三'"])

    inspector.dispose()
  })

  it('copies expandable object and array nodes as structured values', () => {
    const copied: string[] = []
    ClipboardController.instance.setWriter(text => { copied.push(text) })
    const inspector = new RenderObjectInspector({
      value: {
        patient: {
          tags: ['住院', '过敏史已核对'],
        },
      },
      label: 'demoState',
    })
    inspector.expandNode('demoState.patient')
    const tree = (inspector as any)._tree
    tree.selectedKey = findNodeByPath(inspector.debugState().roots, 'demoState.patient.tags')!.key
    FocusManager.instance.setFocus(tree)

    expect(FocusManager.instance.handleKeyDownEvent(keyEvent('c', { ctrlKey: true }))).toBe(true)

    expect(copied[0]).toBe([
      'demoState.patient.tags: [',
      '  "住院",',
      '  "过敏史已核对"',
      ']',
    ].join('\n'))

    inspector.dispose()
  })

  it('formats array item paths with bracket notation', () => {
    const inspector = new RenderObjectInspector({
      value: { tags: ['住院'] },
      label: 'demoState',
    })
    inspector.expandNode('demoState.tags')

    const tagsNode = inspector.debugState().roots[0]!.children?.find(node => node.path === 'demoState.tags')
    expect(tagsNode?.children?.map(node => node.path)).toContain('demoState.tags[0]')

    inspector.dispose()
  })

  it('does not create placeholder nodes for sparse array holes', () => {
    const tags: string[] = []
    tags[2] = '补录'
    const inspector = new RenderObjectInspector({
      value: { tags },
      label: 'demoState',
      maxProperties: 10,
    })
    inspector.expandNode('demoState.tags')

    const tagsNode = inspector.debugState().roots[0]!.children?.find(node => node.path === 'demoState.tags')
    expect(tagsNode?.children?.map(node => node.path)).not.toContain('demoState.tags[0]')
    expect(tagsNode?.children?.map(node => node.path)).not.toContain('demoState.tags[1]')
    expect(tagsNode?.children?.map(node => node.path)).toContain('demoState.tags[2]')

    inspector.dispose()
  })

  it('keeps internal node keys unique when symbol display paths collide', () => {
    const first = Symbol('x')
    const second = Symbol('x')
    const value = {
      [first]: 1,
      [second]: 2,
    }
    const inspector = new RenderObjectInspector({ value })
    const symbolNodes = inspector.debugState().roots[0]!.children?.filter(node => node.path === 'root[Symbol(x)]') ?? []

    expect(symbolNodes).toHaveLength(2)
    expect(new Set(symbolNodes.map(node => node.key)).size).toBe(2)

    inspector.dispose()
  })

  it('shows accessors without invoking getters', () => {
    let getterCalls = 0
    const value = {}
    Object.defineProperty(value, 'danger', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'side-effect'
      },
    })

    const inspector = new RenderObjectInspector({ value })
    const child = inspector.debugState().roots[0]!.children?.find(node => node.path === 'root.danger')

    expect(getterCalls).toBe(0)
    expect(child?.preview).toBe('[Getter]')
    expect(child?.expandable).toBe(false)
  })

  it('handles circular references and non-enumerable properties', () => {
    const value: { self?: unknown } = {}
    Object.defineProperty(value, 'hidden', {
      value: 42,
      enumerable: false,
    })
    value.self = value

    const inspector = new RenderObjectInspector({ value })

    expect(inspector.expandNode('root.self')).toBe(false)
    const children = inspector.debugState().roots[0]!.children ?? []
    expect(children.find(node => node.path === 'root.hidden')?.preview).toBe('42')
    expect(children.find(node => node.path === 'root.self')?.preview).toBe('[Circular]')
    expect(children.find(node => node.path === 'root.self')?.expandable).toBe(false)
  })

  it('limits very large property lists', () => {
    const value: Record<string, number> = {}
    for (let i = 0; i < 5; i += 1) value[`p${i}`] = i

    const inspector = new RenderObjectInspector({ value, maxProperties: 2 })
    const labels = inspector.debugState().roots[0]!.children?.map(node => node.label) ?? []

    expect(labels.some(label => label.includes('... 3 more properties'))).toBe(true)
  })

  it('loads large child lists in batches', () => {
    vi.useFakeTimers()
    const value: Record<string, number> = {}
    for (let i = 0; i < 10; i += 1) value[`p${i}`] = i

    const inspector = new RenderObjectInspector({
      value,
      maxProperties: 10,
      expansionBatchSize: 3,
      includePrototype: false,
    })

    let root = inspector.debugState().roots[0]!
    expect(root.loaded).toBe(false)
    expect(root.loading).toBe(true)
    expect(root.children?.filter(node => node.path.startsWith('root.p'))).toHaveLength(3)
    expect(root.children?.some(node => node.type === 'loading')).toBe(true)

    vi.runOnlyPendingTimers()

    root = inspector.debugState().roots[0]!
    expect(root.loaded).toBe(false)
    expect(root.loading).toBe(true)
    expect(root.children?.filter(node => node.path.startsWith('root.p'))).toHaveLength(6)

    vi.runAllTimers()

    root = inspector.debugState().roots[0]!
    expect(root.loaded).toBe(true)
    expect(root.loading).toBe(false)
    expect(root.children?.filter(node => node.path.startsWith('root.p'))).toHaveLength(10)
    expect(root.children?.some(node => node.type === 'loading')).toBe(false)

    inspector.dispose()
  })

  it('groups very large property lists before expanding individual properties', () => {
    const value: Record<string, number> = {}
    for (let i = 0; i < 25; i += 1) value[`p${i}`] = i

    const inspector = new RenderObjectInspector({
      value,
      maxProperties: 25,
      propertyGroupSize: 10,
      expansionBatchSize: 20,
      includePrototype: false,
    })

    const root = inspector.debugState().roots[0]!
    expect(root.loaded).toBe(true)
    expect(root.children?.map(node => node.type)).toEqual(['group', 'group', 'group'])
    expect(root.children?.map(node => node.path)).toEqual([
      'root.[[Properties 0-9]]',
      'root.[[Properties 10-19]]',
      'root.[[Properties 20-24]]',
    ])
    expect(root.children?.some(node => node.path === 'root.p0')).toBe(false)

    inspector.dispose()
  })

  it('falls back to finite option defaults for invalid numeric options', () => {
    vi.useFakeTimers()
    const value: Record<string, number> = {}
    for (let i = 0; i < 170; i += 1) value[`p${i}`] = i

    const inspector = new RenderObjectInspector({
      value,
      maxProperties: Number.NaN,
      copyMaxProperties: Number.POSITIVE_INFINITY,
      expansionBatchSize: Number.NaN,
      propertyGroupSize: Number.POSITIVE_INFINITY,
      stringMaxLength: Number.NaN,
      includePrototype: false,
    })

    const root = inspector.debugState().roots[0]!
    expect(root.children?.filter(node => node.path.startsWith('root.p'))).toHaveLength(80)
    expect(root.children?.some(node => node.type === 'loading')).toBe(true)

    vi.runAllTimers()

    expect(inspector.debugState().roots[0]!.children?.filter(node => node.path.startsWith('root.p'))).toHaveLength(160)

    inspector.dispose()
  })

  it('loads property group children on demand', () => {
    vi.useFakeTimers()
    const value: Record<string, number> = {}
    for (let i = 0; i < 25; i += 1) value[`p${i}`] = i

    const inspector = new RenderObjectInspector({
      value,
      maxProperties: 25,
      propertyGroupSize: 10,
      expansionBatchSize: 4,
      includePrototype: false,
    })

    expect(inspector.expandNode('root.[[Properties 10-19]]')).toBe(true)

    let group = findNodeByPath(inspector.debugState().roots, 'root.[[Properties 10-19]]')!
    expect(group.loaded).toBe(false)
    expect(group.loading).toBe(true)
    expect(group.children?.filter(node => node.path.startsWith('root.p'))).toHaveLength(4)
    expect(group.children?.some(node => node.type === 'loading')).toBe(true)

    vi.runAllTimers()

    group = findNodeByPath(inspector.debugState().roots, 'root.[[Properties 10-19]]')!
    expect(group.loaded).toBe(true)
    expect(group.loading).toBe(false)
    expect(group.children?.map(node => node.path)).toEqual([
      'root.p10',
      'root.p11',
      'root.p12',
      'root.p13',
      'root.p14',
      'root.p15',
      'root.p16',
      'root.p17',
      'root.p18',
      'root.p19',
    ])

    inspector.dispose()
  })
})
