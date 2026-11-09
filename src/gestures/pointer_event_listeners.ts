import type { Offset } from '../core/render_object'
import {
  DispatchPhase, HitTestResult, resolveHitTestLocalPosition,
  type HitTestEntry, type HitTestTarget, type PointerEvent, type PointerType,
} from './hit_test'

export type PointerEventType = 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel'
  | 'pointerenter' | 'pointerleave' | 'pointeractivate' | 'wheel' | 'contextmenu' | 'dblclick'
export interface PointerEventListenerOptions {
  capture?: boolean
  once?: boolean
}
export interface RoutedPointerEvent {
  readonly type: PointerEventType
  readonly target: HitTestTarget
  readonly currentTarget: HitTestTarget
  readonly targetEntry: HitTestEntry
  readonly currentEntry: HitTestEntry
  readonly phase: DispatchPhase
  readonly path: HitTestResult
  readonly position: Offset
  readonly localPosition: Offset
  readonly pointerId: number
  readonly pointerType: PointerType
  readonly button: number
  readonly buttons: number
  readonly clickCount: number
  readonly deltaX: number
  readonly deltaY: number
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
  readonly timeStamp: number
  readonly defaultPrevented: boolean
  preventDefault(): void
  stopPropagation(): void
  stopImmediatePropagation(): void
  preventActivation(): void
  setPointerCapture(): void
  releasePointerCapture(): void
  hasPointerCapture(): boolean
}
export type PointerEventListener = (event: RoutedPointerEvent) => void

interface Registration {
  type: PointerEventType
  listener: PointerEventListener
  capture: boolean
  once: boolean
}
const listeners = new WeakMap<HitTestTarget, Registration[]>()
const disposed = new WeakSet<HitTestTarget>()

export function addPointerListener(
  target: HitTestTarget, type: PointerEventType, listener: PointerEventListener,
  options: PointerEventListenerOptions = {},
): () => void {
  if (disposed.has(target)) return () => {}
  const entries = listeners.get(target) ?? []
  const capture = options.capture === true
  let entry = entries.find(item => item.type === type && item.listener === listener && item.capture === capture)
  if (!entry) {
    entry = { type, listener, capture, once: options.once === true }
    entries.push(entry)
    listeners.set(target, entries)
  }
  const registered = entry
  return () => removeRegistration(target, registered)
}
function removeRegistration(target: HitTestTarget, entry: Registration): void {
  const entries = listeners.get(target)
  const index = entries?.indexOf(entry) ?? -1
  if (index >= 0) entries!.splice(index, 1)
  if (entries?.length === 0) listeners.delete(target)
}
export function removePointerListener(
  target: HitTestTarget, type: PointerEventType, listener: PointerEventListener,
  options: Pick<PointerEventListenerOptions, 'capture'> = {},
): void {
  const entry = listeners.get(target)?.find(item => item.type === type &&
    item.listener === listener && item.capture === (options.capture === true))
  if (entry) removeRegistration(target, entry)
}
export function hasPointerListeners(target: HitTestTarget, types?: readonly PointerEventType[]): boolean {
  const entries = listeners.get(target)
  return !!entries?.some(entry => !types || types.includes(entry.type))
}
export function disposePointerListeners(target: HitTestTarget): void {
  disposed.add(target)
  listeners.delete(target)
}

/** Keep the nearest window and its descendants, preserving logical hit entries. */
export function pointerWindowPath(path: HitTestResult): HitTestResult {
  const entries = path.path
  let start = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]!.target.isPointerEventBoundary) { start = i; break }
  }
  if (start === 0) return path.snapshot()
  const result = new HitTestResult()
  for (const entry of entries.slice(start)) result.add(entry)
  return result.seal()
}

/** Build an ancestor path for direct capture and hover notifications. */
export function pointerTargetPath(target: HitTestTarget, entry?: HitTestEntry): HitTestResult {
  const ancestors: HitTestTarget[] = []
  let node: HitTestTarget | undefined = target
  while (node) {
    ancestors.push(node)
    if (node.isPointerEventBoundary) break
    node = (node as { parent?: HitTestTarget }).parent
  }
  const path = new HitTestResult()
  for (const ancestor of ancestors.reverse()) {
    path.add(ancestor === target && entry ? entry : { target: ancestor, localPosition: { x: 0, y: 0 } })
  }
  return path.seal()
}

export function pointerActivationEntry(path: HitTestResult): HitTestEntry | undefined {
  const entries = pointerWindowPath(path).path
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!
    if (entry.target.onPointerActivate || entry.target.onDoubleClick) return entry
  }
  // A listener on a window observes the actual hit, not the window as a synthetic target.
  return entries.some(entry => hasPointerListeners(entry.target, ['pointeractivate', 'dblclick']))
    ? entries[entries.length - 1] : undefined
}

export interface PointerListenerPayload {
  position: Offset
  pointerId?: number
  pointerType?: PointerType
  button?: number
  buttons?: number
  clickCount?: number
  deltaX?: number
  deltaY?: number
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  metaKey?: boolean
  timeStamp?: number
}
interface DispatchOptions {
  isCurrent?: () => boolean
  localPosition?: (entry: HitTestEntry) => Offset
  controls?: (entry: HitTestEntry) => Pick<PointerEvent,
    'preventActivation' | 'setPointerCapture' | 'releasePointerCapture' | 'hasPointerCapture'>
}

/** New listeners run before legacy default handlers, with independent propagation state. */
export function dispatchPointerListeners(
  path: HitTestResult, type: PointerEventType, payload: PointerListenerPayload,
  options: DispatchOptions = {},
): { defaultPrevented: boolean; invalidated: boolean } {
  const route = pointerWindowPath(path)
  const entries = route.path
  const targetEntry = entries[entries.length - 1]
  if (!targetEntry) return { defaultPrevented: false, invalidated: false }
  const snapshots = entries.map(entry => (listeners.get(entry.target) ?? []).filter(item => item.type === type))
  // Avoid building dispatch objects or traversing ancestry on unobserved pointer moves.
  if (!snapshots.some(items => items.length > 0)) return { defaultPrevented: false, invalidated: false }
  const parents = entries.map(entry => (entry.target as { parent?: unknown }).parent)
  const valid = (): boolean => (options.isCurrent?.() ?? true) && entries.every((entry, index) =>
    !disposed.has(entry.target) && (entry.target as { visible?: boolean }).visible !== false &&
    (entry.target as { parent?: unknown }).parent === parents[index])
  let stopped = false
  let immediate = false
  let prevented = false
  let invalidated = !valid()
  const invoke = (index: number, capture: boolean, phase: DispatchPhase): void => {
    immediate = false
    const registrations = snapshots[index]!
    if (!registrations.some(item => item.capture === capture)) return
    const entry = entries[index]!
    const controls = options.controls?.(entry)
    const localPosition = options.localPosition?.(entry) ?? resolveHitTestLocalPosition(entry, payload.position)
    if (!valid()) { invalidated = true; return }
    const event: RoutedPointerEvent = {
      type, target: targetEntry.target, currentTarget: entry.target, targetEntry, currentEntry: entry,
      phase, path: route, position: { ...payload.position }, localPosition,
      pointerId: payload.pointerId ?? 0, pointerType: payload.pointerType ?? 'mouse',
      button: payload.button ?? 0, buttons: payload.buttons ?? 0, clickCount: payload.clickCount ?? 0,
      deltaX: payload.deltaX ?? 0, deltaY: payload.deltaY ?? 0,
      ctrlKey: payload.ctrlKey ?? false, shiftKey: payload.shiftKey ?? false,
      altKey: payload.altKey ?? false, metaKey: payload.metaKey ?? false, timeStamp: payload.timeStamp ?? 0,
      get defaultPrevented() { return prevented },
      preventDefault() { prevented = true; controls?.preventActivation?.() },
      stopPropagation() { stopped = true },
      stopImmediatePropagation() { stopped = true; immediate = true },
      preventActivation() { controls?.preventActivation?.() },
      setPointerCapture() { controls?.setPointerCapture?.() },
      releasePointerCapture() { controls?.releasePointerCapture?.() },
      hasPointerCapture() { return controls?.hasPointerCapture?.() ?? false },
    }
    for (const item of registrations) {
      if (invalidated || immediate) break
      if (item.capture !== capture || !listeners.get(entry.target)?.includes(item)) continue
      if (item.once) removeRegistration(entry.target, item)
      item.listener(event)
      invalidated = !valid()
    }
  }
  for (let i = 0; i < entries.length - 1 && !stopped && !invalidated; i++) invoke(i, true, DispatchPhase.Capture)
  if (!stopped && !invalidated) {
    invoke(entries.length - 1, true, DispatchPhase.Target)
    if (!immediate && !invalidated) invoke(entries.length - 1, false, DispatchPhase.Target)
  }
  for (let i = entries.length - 2; i >= 0 && !stopped && !invalidated; i--) invoke(i, false, DispatchPhase.Bubble)
  return { defaultPrevented: prevented, invalidated }
}
