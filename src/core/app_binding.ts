// BindingBag: app/demo 层响应式数据绑定容器
// 将 Store selector 结果同步到 widget setter，由 widget setter 自身触发 markNeedsLayout / markNeedsPaint
// framework widget 不直接依赖 Store，绑定逻辑留在 app/demo 层

import { DisposableBag } from './disposable'
import type { Store } from './store'

export type ScheduleFn = () => void

export type ScheduleMode = 'frame' | 'layout' | 'none'

export class BindingBag extends DisposableBag {
  private readonly _scheduleFrame?: ScheduleFn
  private readonly _scheduleLayout?: ScheduleFn

  constructor(options?: { scheduleFrame?: ScheduleFn; scheduleLayout?: ScheduleFn }) {
    super()
    this._scheduleFrame = options?.scheduleFrame
    this._scheduleLayout = options?.scheduleLayout
  }

  bindSelector<S extends object, T>(
    store: Store<S>,
    selector: (state: S) => T,
    apply?: (value: T, state: Readonly<S>) => void,
    schedule?: ScheduleMode,
  ): void {
    const listener = (): void => {
      const state = store.state
      if (apply) apply(selector(state), state)
      if (schedule === 'layout') this._scheduleLayout?.()
      else if (schedule === 'frame') this._scheduleFrame?.()
    }
    this.add(store.subscribeSelector(selector, listener))
  }
}

export function bindSelector<S extends object, T>(
  store: Store<S>,
  selector: (state: S) => T,
  apply: (value: T, state: Readonly<S>) => void,
): () => void {
  const listener = (): void => {
    const state = store.state
    apply(selector(state), state)
  }
  return store.subscribeSelector(selector, listener)
}