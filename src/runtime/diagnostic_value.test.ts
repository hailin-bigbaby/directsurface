import { describe, expect, it, vi } from 'vitest'
import { sanitizeDiagnosticValue } from './diagnostic_value'

describe('diagnostic value serialization', () => {
  it('does not execute accessors, custom toJSON or overridden Date methods', () => {
    const getter = vi.fn(() => { throw new Error('must not execute') })
    const toJSON = vi.fn(() => { throw new Error('must not execute') })
    const value = Object.defineProperty({ toJSON, good: 1 }, 'secret', { enumerable: true, get: getter })
    expect(sanitizeDiagnosticValue(value)).toEqual({ toJSON: '[Function]', good: 1, secret: '[Getter]' })
    const date = new Date('2026-01-01T00:00:00Z')
    Object.defineProperty(date, 'toISOString', { get: getter })
    expect(sanitizeDiagnosticValue(date)).toBe('2026-01-01T00:00:00.000Z')
    expect(sanitizeDiagnosticValue(new Date(NaN))).toBe('[Invalid Date]')
    expect(getter).not.toHaveBeenCalled()
    expect(toJSON).not.toHaveBeenCalled()
  })

  it('handles array accessors, revoked proxies and circular objects without aborting siblings', () => {
    const getter = vi.fn(() => { throw new Error('array getter') })
    const array = [1, 2]
    Object.defineProperty(array, 1, { get: getter, enumerable: true })
    const proxy = Proxy.revocable({}, {}); proxy.revoke()
    const cycle: Record<string, unknown> = {}; cycle.self = cycle
    expect(sanitizeDiagnosticValue({ array, proxy: proxy.proxy, cycle, valid: 42 })).toEqual({
      array: [1, '[Getter]'], proxy: '[Uninspectable]', cycle: { self: '[Circular]' }, valid: 42,
    })
    expect(getter).not.toHaveBeenCalled()
  })

  it('does not execute accessors or coercion hooks when describing class names', () => {
    const getter = vi.fn(() => 'UnsafeName')
    class AccessorName {}
    Object.defineProperty(AccessorName, 'name', { get: getter })
    expect(sanitizeDiagnosticValue(new AccessorName())).toBe('[Object]')
    expect(getter).not.toHaveBeenCalled()

    const toString = vi.fn(() => 'UnsafeName')
    class ObjectName {}
    Object.defineProperty(ObjectName, 'name', { value: { toString } })
    expect(sanitizeDiagnosticValue(new ObjectName())).toBe('[Object]')
    expect(toString).not.toHaveBeenCalled()
    class NormalName {}
    expect(sanitizeDiagnosticValue(new NormalName())).toBe('[NormalName]')
  })

  it('bounds depth, entries and text while preserving shared references and special keys', () => {
    const shared = { n: 1 }
    const value = JSON.parse('{"__proto__":{"ok":true}}')
    const safe = sanitizeDiagnosticValue(value) as Record<string, unknown>
    expect(Object.getPrototypeOf(safe)).toBe(Object.prototype)
    expect(Object.hasOwn(safe, '__proto__')).toBe(true)
    expect(sanitizeDiagnosticValue({ a: shared, b: shared })).toEqual({ a: { n: 1 }, b: { n: 1 } })
    expect(sanitizeDiagnosticValue(Array.from({ length: 100 }, (_, i) => i))).toHaveLength(24)
    expect(sanitizeDiagnosticValue({ a: { b: { c: { d: 1 } } } })).toEqual({ a: { b: { c: '[Object]' } } })
    expect((sanitizeDiagnosticValue('x'.repeat(40000)) as string).length).toBeLessThan(20100)
  })
})
