/** Bounded, JSON-safe diagnostics. Accessors and user-defined toJSON methods are never invoked. */
export function sanitizeDiagnosticValue(value: unknown, depth = 0, ancestors = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return value.length > 20000 ? `${value.slice(0, 20000)}...[truncated]` : value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function') return '[Function]'
  if (typeof value !== 'object') return String(value)
  if (ancestors.has(value)) return '[Circular]'
  ancestors.add(value)
  try {
    if (value instanceof Date) return Number.isNaN(Date.prototype.getTime.call(value)) ? '[Invalid Date]' : Date.prototype.toISOString.call(value)
    if (Array.isArray(value)) {
      const length = Object.getOwnPropertyDescriptor(value, 'length')?.value as number
      if (depth >= 3) return `[Array(${length})]`
      return Array.from({ length: Math.min(length, 24) }, (_, index) => readProperty(value, String(index), depth, ancestors))
    }
    if (value instanceof Map) return `[Map(${Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!.call(value)})]`
    if (value instanceof Set) return `[Set(${Object.getOwnPropertyDescriptor(Set.prototype, 'size')!.get!.call(value)})]`
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value
      const name = typeof constructor === 'function' ? Object.getOwnPropertyDescriptor(constructor, 'name')?.value : undefined
      return `[${typeof name === 'string' && name ? name : 'Object'}]`
    }
    if (depth >= 3) return '[Object]'
    const keys = Object.keys(value)
    const result: Record<string, unknown> = {}
    for (const key of keys.slice(0, 24)) {
      Object.defineProperty(result, key, { enumerable: true, configurable: true, writable: true,
        value: readProperty(value, key, depth, ancestors) })
    }
    if (keys.length > 24) result.__truncated__ = keys.length - 24
    return result
  } catch {
    return '[Uninspectable]'
  } finally {
    ancestors.delete(value)
  }
}

function readProperty(value: object, key: string, depth: number, ancestors: WeakSet<object>): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor) return undefined
    if (!('value' in descriptor)) return descriptor.get ? (descriptor.set ? '[Getter/Setter]' : '[Getter]') : '[Setter]'
    return sanitizeDiagnosticValue(descriptor.value, depth + 1, ancestors)
  } catch { return '[Uninspectable property]' }
}
