import { RenderStackPanel } from '../layout/render_flex'
import type { BoxConstraints, LayoutContext } from '../core/render_object'
import { RenderGridPanel, gridAuto, gridFr, gridPx } from '../layout/render_grid_panel'
import { RenderParagraph, RenderText } from './basic'
import { RenderCard } from './card'
import { RenderTreeView, type TreeLabelToken, type TreeLabelTokenKind, type TreeNode } from './tree'

export interface ObjectInspectorOptions {
  value: unknown
  label?: string
  treeHeight?: number
  adaptiveTreeHeight?: boolean
  maxProperties?: number
  copyMaxProperties?: number
  expansionBatchSize?: number
  propertyGroupSize?: number
  stringMaxLength?: number
  includePrototype?: boolean
}

export interface ObjectInspectorDebugNode {
  key: string
  label: string
  labelTokens?: TreeLabelToken[]
  path: string
  type: string
  preview: string
  expandable: boolean
  loaded: boolean
  loading?: boolean
  children?: ObjectInspectorDebugNode[]
}

interface InspectorNodeData {
  path: string
  name: string
  value: unknown
  type: string
  preview: string
  expandable: boolean
  loaded: boolean
  loading?: boolean
  descriptor?: PropertyDescriptor
  error?: string
  ancestors: object[]
  propertyGroup?: InspectorPropertyGroup
}

interface InspectorPropertyGroup {
  owner: object
  keys: Array<string | symbol>
  parentPath: string
  ancestors: object[]
  startIndex: number
  endIndex: number
}

interface ChildLoadTask {
  version: number
  node: TreeNode<InspectorNodeData>
  data: InspectorNodeData
  iterator: Generator<TreeNode<InspectorNodeData>>
}

const pendingNodeKey = '__canvas_object_inspector_pending__'
const detailLabelWidth = 86
const horizontalBreakpoint = 720

export interface ObjectInspectorDetailState {
  title: string
  path: string
  type: string
  value: string
  descriptor: string
  error: string
}

export class RenderObjectInspector extends RenderStackPanel {
  static override debugTypeName = 'RenderObjectInspector'
  private readonly _tree: RenderTreeView<InspectorNodeData>
  private readonly _detail: RenderCard
  private readonly _detailContent: RenderStackPanel
  private readonly _pathDetailValue: RenderParagraph
  private readonly _typeDetailValue: RenderParagraph
  private readonly _previewDetailValue: RenderParagraph
  private readonly _descriptorDetailValue: RenderParagraph
  private readonly _errorDetailValue: RenderParagraph
  private readonly _maxProperties: number
  private readonly _copyMaxProperties: number
  private readonly _expansionBatchSize: number
  private readonly _propertyGroupSize: number
  private readonly _stringMaxLength: number
  private readonly _includePrototype: boolean
  private readonly _adaptiveTreeHeight: boolean
  private readonly _loadTimers = new Set<ReturnType<typeof setTimeout>>()
  private _roots: TreeNode<InspectorNodeData>[] = []
  private _value: unknown
  private _label: string
  private _detailText = ''
  private _nextNodeId = 0
  private _loadVersion = 0

  constructor(options: ObjectInspectorOptions) {
    super({ orientation: 'horizontal', spacing: 8, crossAxisAlignment: 'stretch' })
    this._value = options.value
    this._label = options.label ?? 'root'
    this._maxProperties = normalizePositiveInteger(options.maxProperties, 160, 1)
    this._copyMaxProperties = normalizePositiveInteger(options.copyMaxProperties, this._maxProperties, 1)
    this._expansionBatchSize = normalizePositiveInteger(options.expansionBatchSize, 80, 1)
    this._propertyGroupSize = normalizePositiveInteger(options.propertyGroupSize, 500, 1)
    this._stringMaxLength = normalizePositiveInteger(options.stringMaxLength, 160, 12)
    this._includePrototype = options.includePrototype ?? true
    this._adaptiveTreeHeight = options.adaptiveTreeHeight ?? false
    this._roots = [this._createNode(this._label, this._value, this._label, [])]
    this._detailContent = new RenderStackPanel({
      orientation: 'vertical',
      spacing: 6,
      crossAxisAlignment: 'stretch',
    })
    const pathRow = this._createDetailRow('Path')
    const typeRow = this._createDetailRow('Type')
    const previewRow = this._createDetailRow('Value')
    const descriptorRow = this._createDetailRow('Descriptor')
    const errorRow = this._createDetailRow('Error')
    this._pathDetailValue = pathRow.value
    this._typeDetailValue = typeRow.value
    this._previewDetailValue = previewRow.value
    this._descriptorDetailValue = descriptorRow.value
    this._errorDetailValue = errorRow.value
    this._detailContent.addChild(pathRow.row)
    this._detailContent.addChild(typeRow.row)
    this._detailContent.addChild(previewRow.row)
    this._detailContent.addChild(descriptorRow.row)
    this._detailContent.addChild(errorRow.row)
    this._detail = new RenderCard({
      title: 'Selected',
      description: 'Object detail',
      child: this._detailContent,
      variant: 'translucent',
    })
    this._tree = new RenderTreeView<InspectorNodeData>({
      roots: this._roots,
      height: this._adaptiveTreeHeight ? undefined : options.treeHeight ?? 280,
      defaultExpandedKeys: [this._roots[0]!.key],
      copyText: node => this._copyTextForNode(node),
      onSelect: node => this._selectNode(node),
      onExpand: (node, expanded) => {
        if (expanded) this._ensureChildren(node)
      },
    })
    this.addChild(this._tree, 3)
    this.addChild(this._detail, 2)
    this._ensureChildren(this._roots[0]!)
    this._tree.selectedKey = this._roots[0]!.key
    this._selectNode(this._roots[0]!)
  }

  get value(): unknown {
    return this._value
  }

  set value(value: unknown) {
    this.setValue(value)
  }

  get label(): string {
    return this._label
  }

  set label(label: string) {
    this.setValue(this._value, label)
  }

  get selectedKey(): string {
    return this._tree.selectedKey
  }

  setValue(value: unknown, label = this._label): void {
    this._cancelPendingLoads()
    this._value = value
    this._label = label
    this._nextNodeId = 0
    this._roots = [this._createNode(this._label, this._value, this._label, [])]
    this._tree.setRoots(this._roots)
    this._tree.expandedKeys = [this._roots[0]!.key]
    this._ensureChildren(this._roots[0]!)
    this._tree.selectedKey = this._roots[0]!.key
    this._selectNode(this._roots[0]!)
    this.markNeedsLayout()
  }

  override dispose(): void {
    this._cancelPendingLoads()
    super.dispose()
  }

  override performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const horizontal = constraints.maxWidth >= horizontalBreakpoint
    this.orientation = horizontal ? 'horizontal' : 'vertical'
    const adaptiveVerticalFlex = this._adaptiveTreeHeight && !horizontal
    this.childFlexData.set(this._tree, { flex: horizontal ? 3 : adaptiveVerticalFlex ? 1 : 0 })
    this.childFlexData.set(this._detail, { flex: horizontal ? 2 : adaptiveVerticalFlex ? 1 : 0 })
    super.performLayout(constraints, context)
  }

  private _createDetailRow(label: string): { row: RenderGridPanel; value: RenderParagraph } {
    const row = new RenderGridPanel({
      columns: [gridPx(detailLabelWidth), gridFr()],
      rows: [gridAuto()],
      columnGap: 8,
    })
    const labelText = new RenderText(label, {
      role: 'secondary',
      size: 'small',
      weight: 'medium',
      overflow: 'ellipsis',
    })
    const value = new RenderParagraph('')
    labelText.verticalAlignment = 'start'
    value.verticalAlignment = 'start'
    row.addChild(labelText, { row: 0, column: 0 })
    row.addChild(value, { row: 0, column: 1 })
    return { row, value }
  }

  expandNode(key: string): boolean {
    const node = this._findNodeByKeyOrPath(key, this._roots)
    if (!node || !node.data?.expandable) return false
    this._ensureChildren(node)
    if (!this._tree.expandedKeys.includes(node.key)) this._tree.expandedKeys = [...this._tree.expandedKeys, node.key]
    return true
  }

  debugState(): {
    selectedKey: string
    expandedKeys: string[]
    detailText: string
    roots: ObjectInspectorDebugNode[]
    detailRows: ObjectInspectorDetailState
  } {
    return {
      selectedKey: this._tree.selectedKey,
      expandedKeys: this._tree.expandedKeys,
      detailText: this._detailText,
      roots: this._roots.map(node => this._debugNode(node)),
      detailRows: this._detailForNode(this._findNode(this._tree.selectedKey, this._roots)?.data),
    }
  }

  private _selectNode(node: TreeNode<InspectorNodeData>): void {
    const data = node.data
    if (!data) return
    const detail = this._detailForNode(data)
    this._applyDetail(detail)
  }

  private _applyDetail(detail: ObjectInspectorDetailState): void {
    this._detail.title = detail.title
    this._detail.description = detail.type
    this._pathDetailValue.text = detail.path
    this._typeDetailValue.text = detail.type
    this._previewDetailValue.text = detail.value
    this._descriptorDetailValue.text = detail.descriptor || '-'
    this._errorDetailValue.text = detail.error || '-'
    this._detailText = this._detailTextFor(detail)
    this._detail.markNeedsLayout()
  }

  private _detailForNode(data: InspectorNodeData | undefined): ObjectInspectorDetailState {
    if (!data) {
      return {
        title: 'No selection',
        path: '-',
        type: '-',
        value: '-',
        descriptor: '',
        error: '',
      }
    }
    const descriptorText = data.descriptor
      ? [
          data.descriptor.enumerable ? 'enumerable' : 'non-enumerable',
          data.descriptor.configurable ? 'configurable' : 'non-configurable',
          'writable' in data.descriptor
            ? data.descriptor.writable ? 'writable' : 'readonly'
            : 'accessor',
        ].join(', ')
      : ''
    return {
      title: data.name,
      path: data.path,
      type: data.type,
      value: data.preview,
      descriptor: descriptorText,
      error: data.error ?? '',
    }
  }

  private _detailTextFor(detail: ObjectInspectorDetailState): string {
    return [
      `Path: ${detail.path}`,
      `Type: ${detail.type}`,
      `Value: ${detail.value}`,
      detail.descriptor ? `Descriptor: ${detail.descriptor}` : '',
      detail.error ? `Error: ${detail.error}` : '',
    ].filter(Boolean).join('\n')
  }

  private _copyTextForNode(node: TreeNode<InspectorNodeData>): string {
    const data = node.data
    if (!data) return node.label
    return `${data.path}: ${this._copyValueForData(data)}`
  }

  private _copyValueForData(data: InspectorNodeData): string {
    if (data.propertyGroup) {
      return `[${data.propertyGroup.startIndex} ... ${data.propertyGroup.endIndex}]`
    }
    if (!isObjectLike(data.value) || data.preview === '[Circular]' || data.type === 'accessor') return data.preview
    return safeCopyString(data.value, this._copyMaxProperties) ?? data.preview
  }

  private _ensureChildren(node: TreeNode<InspectorNodeData>): void {
    const data = node.data
    if (!data || data.loaded || data.loading || !data.expandable) return
    const iterator = this._childNodeIterator(data)
    const batch = this._readChildBatch(iterator, this._expansionBatchSize)
    node.children = batch.children
    if (batch.done) {
      data.loaded = true
    } else {
      data.loading = true
      node.children.push(this._loadingNode(data.path))
      this._scheduleChildLoad({
        version: this._loadVersion,
        node,
        data,
        iterator,
      })
    }
    node.label = this._labelForData(data)
    node.labelTokens = this._labelTokensForData(data)
    this._tree.setRoots(this._roots)
  }

  private _readChildBatch(
    iterator: Generator<TreeNode<InspectorNodeData>>,
    limit: number,
  ): { children: TreeNode<InspectorNodeData>[]; done: boolean } {
    const children: TreeNode<InspectorNodeData>[] = []
    while (children.length < limit) {
      const next = iterator.next()
      if (next.done) return { children, done: true }
      children.push(next.value)
    }
    return { children, done: false }
  }

  private _scheduleChildLoad(task: ChildLoadTask): void {
    const timer = setTimeout(() => {
      this._loadTimers.delete(timer)
      this._appendChildBatch(task)
    }, 0)
    this._loadTimers.add(timer)
  }

  private _appendChildBatch(task: ChildLoadTask): void {
    if (task.version !== this._loadVersion) return
    const existingChildren = task.node.children ?? []
    const withoutLoading = existingChildren.filter(child => child.data?.type !== 'loading')
    const batch = this._readChildBatch(task.iterator, this._expansionBatchSize)
    task.node.children = [...withoutLoading, ...batch.children]

    if (batch.done) {
      task.data.loaded = true
      task.data.loading = false
    } else {
      task.node.children.push(this._loadingNode(task.data.path))
      this._scheduleChildLoad(task)
    }

    task.node.label = this._labelForData(task.data)
    task.node.labelTokens = this._labelTokensForData(task.data)
    this._tree.setRoots(this._roots)
    this.markNeedsLayout()
  }

  private _cancelPendingLoads(): void {
    this._loadVersion += 1
    for (const timer of this._loadTimers) clearTimeout(timer)
    this._loadTimers.clear()
  }

  private *_childNodeIterator(data: InspectorNodeData): Generator<TreeNode<InspectorNodeData>> {
    if (data.propertyGroup) {
      for (const key of data.propertyGroup.keys) {
        yield this._propertyNode(
          data.propertyGroup.owner,
          key,
          data.propertyGroup.parentPath,
          data.propertyGroup.ancestors,
        )
      }
      return
    }

    const value = data.value
    if (!isObjectLike(value)) return
    if (data.ancestors.includes(value)) {
      yield this._infoNode(`${data.path}.[[Circular]]`, '[Circular reference]')
      return
    }

    const nextAncestors = [...data.ancestors, value]
    let emitted = 0
    if (value instanceof Map) {
      let index = 0
      for (const [entryKey, entryValue] of value.entries()) {
        if (index >= this._maxProperties) break
        const entryPath = `${data.path}.[[Entries]].${index}`
        yield this._createNode(
          `[${index}]`,
          { key: entryKey, value: entryValue },
          entryPath,
          nextAncestors,
        )
        index += 1
        emitted += 1
      }
      if (value.size > index) {
        yield this._infoNode(`${data.path}.[[Entries]].more`, `... ${value.size - index} more entries`)
        emitted += 1
      }
    } else if (value instanceof Set) {
      let index = 0
      for (const entryValue of value.values()) {
        if (index >= this._maxProperties) break
        yield this._createNode(`[${index}]`, entryValue, `${data.path}.[[Values]].${index}`, nextAncestors)
        index += 1
        emitted += 1
      }
      if (value.size > index) {
        yield this._infoNode(`${data.path}.[[Values]].more`, `... ${value.size - index} more values`)
        emitted += 1
      }
    }

    const ownKeys = limitedOwnKeys(value, this._maxProperties)
    if (ownKeys.length > this._propertyGroupSize) {
      let index = 0
      while (index < ownKeys.length) {
        const keys = ownKeys.slice(index, index + this._propertyGroupSize)
        yield this._propertyGroupNode(value, keys, data.path, nextAncestors, index)
        index += keys.length
        emitted += 1
      }
    } else {
      for (const key of ownKeys) {
        yield this._propertyNode(value, key, data.path, nextAncestors)
        emitted += 1
      }
    }
    const remainingProperties = remainingOwnKeyCount(value, this._maxProperties)
    if (remainingProperties > 0) {
      yield this._infoNode(`${data.path}.[[Properties]].more`, `... ${remainingProperties} more properties`)
      emitted += 1
    }

    if (this._includePrototype) {
      const prototype = Object.getPrototypeOf(value)
      if (prototype) {
        yield this._createNode('[[Prototype]]', prototype, `${data.path}.[[Prototype]]`, nextAncestors)
        emitted += 1
      }
    }

    if (emitted === 0) yield this._infoNode(`${data.path}.[[Empty]]`, '(no properties)')
  }

  private _propertyNode(
    owner: object,
    key: string | symbol,
    parentPath: string,
    ancestors: object[],
  ): TreeNode<InspectorNodeData> {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key)
    const name = propertyLabel(owner, key)
    const path = propertyPath(owner, key, parentPath)
    if (!descriptor) return this._infoNode(path, `${name}: <missing descriptor>`)
    if (!('value' in descriptor)) {
      const preview = accessorPreview(descriptor)
      const data: InspectorNodeData = {
        path,
        name,
        value: undefined,
        type: 'accessor',
        preview,
        expandable: false,
        loaded: true,
        descriptor,
        ancestors,
      }
      return this._nodeFromData(data)
    }
    return this._createNode(name, descriptor.value, path, ancestors, descriptor)
  }

  private _propertyGroupNode(
    owner: object,
    keys: Array<string | symbol>,
    parentPath: string,
    ancestors: object[],
    startIndex: number,
  ): TreeNode<InspectorNodeData> {
    const endIndex = startIndex + keys.length - 1
    const name = `[${startIndex} ... ${endIndex}]`
    const path = `${parentPath}.[[Properties ${startIndex}-${endIndex}]]`
    const preview = `${keys.length} properties`
    const data: InspectorNodeData = {
      path,
      name,
      value: undefined,
      type: 'group',
      preview,
      expandable: true,
      loaded: false,
      ancestors,
      propertyGroup: {
        owner,
        keys,
        parentPath,
        ancestors,
        startIndex,
        endIndex,
      },
    }
    return this._nodeFromData(data)
  }

  private _createNode(
    name: string,
    value: unknown,
    path: string,
    ancestors: object[],
    descriptor?: PropertyDescriptor,
  ): TreeNode<InspectorNodeData> {
    const preview = valuePreview(value, this._stringMaxLength)
    const expandable = isExpandableValue(value) && !(isObjectLike(value) && ancestors.includes(value))
    const data: InspectorNodeData = {
      path,
      name,
      value,
      type: valueType(value),
      preview: isObjectLike(value) && ancestors.includes(value) ? '[Circular]' : preview,
      expandable,
      loaded: false,
      descriptor,
      ancestors,
    }
    return this._nodeFromData(data)
  }

  private _pendingNode(parentPath: string): TreeNode<InspectorNodeData> {
    return {
      key: this._allocateNodeKey(),
      label: '(expand to inspect)',
      labelTokens: [{ text: '(expand to inspect)', kind: 'meta' }],
      selectable: false,
    }
  }

  private _loadingNode(parentPath: string): TreeNode<InspectorNodeData> {
    const data: InspectorNodeData = {
      path: `${parentPath}.[[Loading]]`,
      name: '(loading more...)',
      value: undefined,
      type: 'loading',
      preview: '(loading more...)',
      expandable: false,
      loaded: true,
      ancestors: [],
    }
    return {
      key: this._allocateNodeKey(),
      label: '(loading more...)',
      labelTokens: [{ text: '(loading more...)', kind: 'meta' }],
      selectable: false,
      data,
    }
  }

  private _infoNode(key: string, label: string): TreeNode<InspectorNodeData> {
    const data: InspectorNodeData = {
      path: key,
      name: label,
      value: undefined,
      type: 'info',
      preview: label,
      expandable: false,
      loaded: true,
      ancestors: [],
    }
    return { key: this._allocateNodeKey(), label, labelTokens: [{ text: label, kind: label.startsWith('[Circular') ? 'error' : 'meta' }], selectable: false, data }
  }

  private _nodeFromData(data: InspectorNodeData): TreeNode<InspectorNodeData> {
    return {
      key: this._allocateNodeKey(),
      label: this._labelForData(data),
      labelTokens: this._labelTokensForData(data),
      data,
      children: data.expandable ? [this._pendingNode(data.path)] : undefined,
    }
  }

  private _allocateNodeKey(): string {
    const id = this._nextNodeId
    this._nextNodeId += 1
    return `inspector-node:${id}`
  }

  private _labelForData(data: InspectorNodeData): string {
    const suffix = data.expandable
      ? data.loading ? ' {loading...}' : !data.loaded ? ' {...}' : ''
      : ''
    return `${data.name}: ${data.preview}${suffix}`
  }

  private _labelTokensForData(data: InspectorNodeData): TreeLabelToken[] {
    const tokens: TreeLabelToken[] = [
      { text: data.name, kind: 'name' },
      { text: ': ', kind: 'punctuation' },
      { text: data.preview, kind: this._previewTokenKind(data) },
    ]
    if (data.expandable && data.loading) tokens.push({ text: ' {loading...}', kind: 'meta' })
    else if (data.expandable && !data.loaded) tokens.push({ text: ' {...}', kind: 'meta' })
    return tokens
  }

  private _previewTokenKind(data: InspectorNodeData): TreeLabelTokenKind {
    if (data.error) return 'error'
    if (data.preview === '[Circular]') return 'error'
    if (data.type === 'group') return 'meta'
    if (data.preview.startsWith('[Getter') || data.preview.startsWith('[Setter') || data.preview.startsWith('[Accessor')) return 'meta'
    switch (data.type) {
      case 'string':
        return 'string'
      case 'number':
      case 'bigint':
        return 'number'
      case 'boolean':
        return 'boolean'
      case 'null':
        return 'null'
      case 'undefined':
        return 'undefined'
      case 'function':
        return 'function'
      default:
        return isObjectLike(data.value) ? 'type' : 'text'
    }
  }

  private _findNode(key: string, nodes: TreeNode<InspectorNodeData>[]): TreeNode<InspectorNodeData> | undefined {
    for (const node of nodes) {
      if (node.key === key) return node
      const child = node.children ? this._findNode(key, node.children) : undefined
      if (child) return child
    }
    return undefined
  }

  private _findNodeByKeyOrPath(keyOrPath: string, nodes: TreeNode<InspectorNodeData>[]): TreeNode<InspectorNodeData> | undefined {
    for (const node of nodes) {
      if (node.key === keyOrPath || node.data?.path === keyOrPath) return node
      const child = node.children ? this._findNodeByKeyOrPath(keyOrPath, node.children) : undefined
      if (child) return child
    }
    return undefined
  }

  private _debugNode(node: TreeNode<InspectorNodeData>): ObjectInspectorDebugNode {
    const data = node.data
    return {
      key: node.key,
      label: node.label,
      labelTokens: node.labelTokens ? [...node.labelTokens] : undefined,
      path: data?.path ?? node.key,
      type: data?.type ?? 'info',
      preview: data?.preview ?? node.label,
      expandable: data?.expandable ?? false,
      loaded: data?.loaded ?? true,
      loading: data?.loading,
      children: node.children?.map(child => this._debugNode(child)),
    }
  }
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

function isExpandableValue(value: unknown): boolean {
  if (!isObjectLike(value)) return false
  if (value instanceof Date || value instanceof RegExp) return false
  return true
}

function valueType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (value instanceof Map) return 'map'
  if (value instanceof Set) return 'set'
  if (value instanceof Date) return 'date'
  if (value instanceof RegExp) return 'regexp'
  if (value instanceof Error) return 'error'
  return typeof value === 'object' || typeof value === 'function'
    ? Object.prototype.toString.call(value).slice(8, -1)
    : typeof value
}

function valuePreview(value: unknown, maxStringLength: number): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'undefined':
      return 'undefined'
    case 'string':
      return `'${truncate(value, maxStringLength)}'`
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value)
    case 'symbol':
      return String(value)
    case 'function':
      return `[Function${value.name ? `: ${value.name}` : ''}]`
    case 'object':
      if (Array.isArray(value)) return `Array(${value.length})`
      if (value instanceof Map) return `Map(${value.size})`
      if (value instanceof Set) return `Set(${value.size})`
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
      if (value instanceof RegExp) return String(value)
      if (value instanceof Error) return `${value.name}: ${value.message}`
      return objectConstructorName(value)
    default:
      return String(value)
  }
}

function objectConstructorName(value: object): string {
  const name = value.constructor?.name
  return name && name !== 'Object' ? name : 'Object'
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value
}

function normalizePositiveInteger(value: number | undefined, fallback: number, min: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.floor(value!))
}

function propertyName(key: string | symbol): string {
  return typeof key === 'symbol' ? `[${String(key)}]` : key
}

function propertyLabel(owner: object, key: string | symbol): string {
  if (Array.isArray(owner) && typeof key === 'string' && isArrayIndexKey(key)) return `[${key}]`
  return propertyName(key)
}

function propertyPath(owner: object, key: string | symbol, parentPath: string): string {
  if (typeof key === 'symbol') return `${parentPath}[${String(key)}]`
  if (Array.isArray(owner) && isArrayIndexKey(key)) return `${parentPath}[${key}]`
  if (isIdentifierKey(key)) return `${parentPath}.${key}`
  return `${parentPath}[${JSON.stringify(key)}]`
}

function limitedOwnKeys(value: object, maxKeys: number): Array<string | symbol> {
  if (!Array.isArray(value)) return Reflect.ownKeys(value).slice(0, maxKeys)
  const keys: Array<string | symbol> = []
  const scanLimit = Math.min(value.length, maxKeys)
  for (let index = 0; index < scanLimit; index += 1) {
    const key = String(index)
    if (Object.prototype.hasOwnProperty.call(value, key)) keys.push(key)
  }
  if (keys.length >= maxKeys) return keys

  if (value.length <= maxKeys * 4) {
    for (let index = scanLimit; index < value.length && keys.length < maxKeys; index += 1) {
      const key = String(index)
      if (Object.prototype.hasOwnProperty.call(value, key)) keys.push(key)
    }
    if (keys.length >= maxKeys) return keys
  }

  const seen = new Set(keys)
  for (const key of arrayOwnKeys(value)) {
    if (key === 'length') continue
    if (seen.has(key)) continue
    seen.add(key)
    keys.push(key)
    if (keys.length >= maxKeys) break
  }
  return keys
}

function remainingOwnKeyCount(value: object, maxKeys: number): number {
  if (!Array.isArray(value)) return Math.max(0, Reflect.ownKeys(value).length - maxKeys)
  const firstKeys = limitedOwnKeys(value, maxKeys)
  const firstWindowIsDense = firstKeys.length === maxKeys &&
    firstKeys.every((key, index) => key === String(index))
  if (firstWindowIsDense && value.length > maxKeys) return value.length - maxKeys
  return Math.max(0, arrayOwnKeys(value).filter(key => key !== 'length').length - maxKeys)
}

function arrayOwnKeys(value: unknown[]): Array<string | symbol> {
  return Reflect.ownKeys(value).filter(key => {
    if (key === 'length') return true
    if (typeof key !== 'string') return true
    return Object.prototype.hasOwnProperty.call(value, key)
  })
}

function isArrayIndexKey(key: string): boolean {
  if (!/^(0|[1-9]\d*)$/.test(key)) return false
  const index = Number(key)
  return Number.isSafeInteger(index) && index >= 0 && index < 2 ** 32 - 1
}

function isIdentifierKey(key: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
}

function accessorPreview(descriptor: PropertyDescriptor): string {
  if (descriptor.get && descriptor.set) return '[Getter/Setter]'
  if (descriptor.get) return '[Getter]'
  if (descriptor.set) return '[Setter]'
  return '[Accessor]'
}

function safeCopyString(value: object, maxProperties: number): string | null {
  try {
    const safeValue = safeCopyValue(value, {
      seen: new WeakSet<object>(),
      maxProperties,
      depth: 0,
      maxDepth: 8,
    })
    const text = JSON.stringify(safeValue, null, 2)
    return text ?? null
  } catch {
    return null
  }
}

interface SafeCopyContext {
  seen: WeakSet<object>
  maxProperties: number
  depth: number
  maxDepth: number
}

function safeCopyValue(value: unknown, context: SafeCopyContext): unknown {
  if (value === null) return null
  if (typeof value === 'undefined') return '[Undefined]'
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'symbol') return String(value)
  if (typeof value === 'function') return `[Function${value.name ? `: ${value.name}` : ''}]`
  if (!isObjectLike(value)) return String(value)
  if (context.seen.has(value)) return '[Circular]'
  if (context.depth >= context.maxDepth) return valuePreview(value, 80)

  context.seen.add(value)
  const childContext: SafeCopyContext = {
    ...context,
    depth: context.depth + 1,
  }
  if (Array.isArray(value)) {
    const result: unknown[] = []
    const length = Math.min(value.length, context.maxProperties)
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor) {
        result.push('[Empty]')
      } else if ('value' in descriptor) {
        result.push(safeCopyValue(descriptor.value, childContext))
      } else {
        result.push(accessorPreview(descriptor))
      }
    }
    if (value.length > length) result.push(`... ${value.length - length} more items`)
    context.seen.delete(value)
    return result
  }
  if (value instanceof Map) {
    const result: unknown[] = []
    let index = 0
    for (const [entryKey, entryValue] of value.entries()) {
      if (index >= context.maxProperties) break
      result.push([safeCopyValue(entryKey, childContext), safeCopyValue(entryValue, childContext)])
      index += 1
    }
    if (value.size > index) result.push(`... ${value.size - index} more entries`)
    context.seen.delete(value)
    return result
  }
  if (value instanceof Set) {
    const result: unknown[] = []
    let index = 0
    for (const entryValue of value.values()) {
      if (index >= context.maxProperties) break
      result.push(safeCopyValue(entryValue, childContext))
      index += 1
    }
    if (value.size > index) result.push(`... ${value.size - index} more values`)
    context.seen.delete(value)
    return result
  }
  if (value instanceof Date) {
    context.seen.delete(value)
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
  }
  if (value instanceof RegExp) {
    context.seen.delete(value)
    return String(value)
  }
  if (value instanceof Error) {
    const result = {
      name: value.name,
      message: value.message,
      stack: value.stack,
    }
    context.seen.delete(value)
    return result
  }

  const result: Record<string, unknown> = {}
  const keys = Reflect.ownKeys(value).slice(0, context.maxProperties)
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor) continue
    const outputKey = typeof key === 'symbol' ? String(key) : key
    result[outputKey] = 'value' in descriptor
      ? safeCopyValue(descriptor.value, childContext)
      : accessorPreview(descriptor)
  }
  const allKeys = Reflect.ownKeys(value)
  if (allKeys.length > keys.length) result['...'] = `${allKeys.length - keys.length} more properties`
  context.seen.delete(value)
  return result
}
