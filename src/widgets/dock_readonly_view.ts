const proxyByTarget = new WeakMap<object, object>()
const targetByProxy = new WeakMap<object, object>()

export function dockReadonlyView<T>(value: T): T {
  if (!isDockDataObject(value)) return value
  const existing = proxyByTarget.get(value)
  if (existing) return existing as T
  const proxy = new Proxy(value, {
    get(target, key, receiver) {
      return dockReadonlyView(Reflect.get(target, key, receiver))
    },
    set() {
      throw new TypeError('Dock state is readonly; use the manager API to modify it')
    },
    deleteProperty() {
      throw new TypeError('Dock state is readonly; use the manager API to modify it')
    },
    defineProperty() {
      throw new TypeError('Dock state is readonly; use the manager API to modify it')
    },
    setPrototypeOf() {
      throw new TypeError('Dock state is readonly; use the manager API to modify it')
    },
    preventExtensions() {
      throw new TypeError('Dock state is readonly; use the manager API to modify it')
    },
  })
  proxyByTarget.set(value, proxy)
  targetByProxy.set(proxy, value)
  return proxy as T
}

export function unwrapDockReadonlyView<T>(value: T): T {
  if (!isObject(value)) return value
  return (targetByProxy.get(value) ?? value) as T
}

function isDockDataObject(value: unknown): value is object {
  if (!isObject(value)) return false
  if (Array.isArray(value)) return true
  return Object.getPrototypeOf(value) === Object.prototype
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}
