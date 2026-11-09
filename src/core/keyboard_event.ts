import type { RenderObject } from './render_object'
import { DispatchPhase } from '../gestures/hit_test'

export type KeyboardEventType = 'keydown' | 'keyup'
export interface KeyboardEventListenerOptions {
  capture?: boolean
  once?: boolean
}

/** Component-tree keyboard input. Existing control handlers run as default actions. */
export interface RoutedKeyboardEvent {
  readonly type: KeyboardEventType
  readonly target: RenderObject
  readonly currentTarget: RenderObject
  readonly phase: DispatchPhase
  readonly key: string
  readonly code: string
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
  readonly repeat: boolean
  readonly isComposing: boolean
  readonly location: number
  readonly timeStamp: number
  readonly defaultPrevented: boolean
  preventDefault(): void
  stopPropagation(): void
  stopImmediatePropagation(): void
}
export type KeyboardEventListener = (event: RoutedKeyboardEvent) => void

interface Registration {
  type: KeyboardEventType
  listener: KeyboardEventListener
  capture: boolean
  once: boolean
}
const listeners = new WeakMap<RenderObject, Registration[]>()
const disposed = new WeakSet<RenderObject>()

export function addKeyboardListener(
  node: RenderObject, type: KeyboardEventType, listener: KeyboardEventListener,
  options: KeyboardEventListenerOptions = {},
): () => void {
  if (disposed.has(node)) return () => {}
  const entries = listeners.get(node) ?? []
  const capture = options.capture === true
  let entry = entries.find(item => item.type === type && item.listener === listener && item.capture === capture)
  if (!entry) {
    entry = { type, listener, capture, once: options.once === true }
    entries.push(entry)
    listeners.set(node, entries)
  }
  const registered = entry
  return () => removeRegistration(node, registered)
}

function removeRegistration(node: RenderObject, entry: Registration): void {
  const entries = listeners.get(node)
  const index = entries?.indexOf(entry) ?? -1
  if (index >= 0) entries!.splice(index, 1)
  if (entries?.length === 0) listeners.delete(node)
}

export function removeKeyboardListener(
  node: RenderObject, type: KeyboardEventType, listener: KeyboardEventListener,
  options: Pick<KeyboardEventListenerOptions, 'capture'> = {},
): void {
  const entry = listeners.get(node)?.find(item => item.type === type &&
    item.listener === listener && item.capture === (options.capture === true))
  if (entry) removeRegistration(node, entry)
}

export function disposeKeyboardListeners(node: RenderObject): void {
  disposed.add(node)
  listeners.delete(node)
}

/** @internal Dispatch once on a fixed path; never traverse window ownership links. */
export function dispatchKeyboardEvent(
  target: RenderObject, native: KeyboardEvent, boundary?: RenderObject,
): { defaultPrevented: boolean; propagationStopped: boolean; invalidated: boolean } {
  const path: RenderObject[] = []
  for (let node: RenderObject | undefined = target; node; node = node.parent) {
    path.push(node)
    if (node.isKeyboardEventBoundary || node === boundary) break
  }
  const snapshots = new Map(path.map(node => [node, [...(listeners.get(node) ?? [])]]))
  let stopped = false
  let immediate = false
  let prevented = native.defaultPrevented
  const valid = (): boolean => path.every((node, index) => !disposed.has(node) && node.visible &&
    (index === path.length - 1 || node.parent === path[index + 1]))
  let invalidated = !valid()
  const invoke = (node: RenderObject, capture: boolean, phase: DispatchPhase): void => {
    immediate = false
    const entries = snapshots.get(node)!
    if (!entries.some(entry => entry.type === native.type && entry.capture === capture)) return
    const event: RoutedKeyboardEvent = {
      type: native.type as KeyboardEventType, target, currentTarget: node, phase,
      key: native.key, code: native.code, ctrlKey: native.ctrlKey, shiftKey: native.shiftKey,
      altKey: native.altKey, metaKey: native.metaKey, repeat: native.repeat,
      isComposing: native.isComposing, location: native.location, timeStamp: native.timeStamp,
      get defaultPrevented() { return prevented || native.defaultPrevented },
      preventDefault() { prevented = true; native.preventDefault() },
      stopPropagation() { stopped = true },
      stopImmediatePropagation() { stopped = true; immediate = true },
    }
    for (const entry of entries) {
      if (invalidated || immediate) break
      if (entry.type !== native.type || entry.capture !== capture || !listeners.get(node)?.includes(entry)) continue
      if (entry.once) removeRegistration(node, entry)
      entry.listener(event)
      invalidated = !valid()
    }
  }
  for (let index = path.length - 1; index > 0 && !stopped && !invalidated; index--) {
    invoke(path[index]!, true, DispatchPhase.Capture)
  }
  if (!stopped && !invalidated) {
    invoke(target, true, DispatchPhase.Target)
    if (!immediate && !invalidated) invoke(target, false, DispatchPhase.Target)
  }
  for (let index = 1; index < path.length && !stopped && !invalidated; index++) {
    invoke(path[index]!, false, DispatchPhase.Bubble)
  }
  return { defaultPrevented: prevented || native.defaultPrevented, propagationStopped: stopped, invalidated }
}
