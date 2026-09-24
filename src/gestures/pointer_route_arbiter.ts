import { FocusManager } from '../core/focus_manager'
import { PopupManager } from '../core/popup_manager'
import type { Offset } from '../core/render_object'
import type { PointerEvent, WheelPointerEvent } from './hit_test'
import type { PointerDispatchSession, RouteScope } from './pointer_dispatch_session'

export interface PointerRouteInterceptor {
  preserveFocus?: boolean
  hitTest(pos: Offset): boolean
  onPointerDown(event: PointerEvent): boolean | void
  onPointerMove(event: PointerEvent): boolean | void
  onPointerUp?(event: PointerEvent): boolean | void
  onPointerCancel?(event: PointerEvent): boolean | void
  onWheel?(event: WheelPointerEvent): boolean | void
}

export interface PointerRouteDecision {
  scope: RouteScope
  consumed: boolean
  target?: unknown
}

export interface PointerRoutePointOptions {
  notify?: boolean
}

export type PointerRouteSelectionListener = (
  decision: PointerRouteDecision,
) => void

export class PointerRouteArbiter {
  constructor(private readonly _getInterceptors: () => PointerRouteInterceptor[]) {}

  routePointerDown(
    event: PointerEvent,
    onSelected?: PointerRouteSelectionListener,
  ): PointerRouteDecision {
    if (PopupManager.instance.hasOverlays) {
      const consumed = PopupManager.instance.handlePointerDown(event)
      if (consumed) {
        onSelected?.({ scope: 'popup', consumed: true })
        return { scope: 'popup', consumed: true }
      }
    }

    const interceptor = this._topmostInterceptorAt(event.position)
    if (interceptor) {
      const decision = {
        scope: 'interceptor' as const,
        consumed: true,
        target: interceptor,
      }
      onSelected?.(decision)
      if (!interceptor.preserveFocus) FocusManager.instance.clearFocus()
      const consumed = interceptor.onPointerDown(event)
      return { scope: 'interceptor', consumed: consumed !== false, target: interceptor }
    }

    const decision = { scope: 'main' as const, consumed: false }
    onSelected?.(decision)
    return decision
  }

  routePointerMove(event: PointerEvent, session?: PointerDispatchSession): PointerRouteDecision {
    if (session?.routeScope === 'interceptor' && session.routeTarget) {
      const interceptor = session.routeTarget as PointerRouteInterceptor
      const consumed = interceptor.onPointerMove(event)
      return { scope: 'interceptor', consumed: consumed !== false, target: interceptor }
    }
    if (session?.routeScope === 'main') {
      return { scope: 'main', consumed: false }
    }

    const popupConsumed = PopupManager.instance.handlePointerMove(event)
    if (popupConsumed) return { scope: 'popup', consumed: true }

    const interceptor = this._topmostInterceptorAt(event.position)
    if (interceptor) {
      const consumed = interceptor.onPointerMove(event)
      return { scope: 'interceptor', consumed: consumed !== false, target: interceptor }
    }

    return { scope: 'main', consumed: false }
  }

  routePointerUp(event: PointerEvent, session?: PointerDispatchSession): PointerRouteDecision {
    if (session?.routeScope === 'interceptor' && session.routeTarget) {
      const interceptor = session.routeTarget as PointerRouteInterceptor
      const consumed = interceptor.onPointerUp?.(event)
      return { scope: 'interceptor', consumed: consumed !== false, target: interceptor }
    }
    if (session?.routeScope === 'main') {
      return { scope: 'main', consumed: false }
    }

    PopupManager.instance.handlePointerUp(event)
    return session?.routeScope === 'popup'
      ? { scope: 'popup', consumed: true }
      : { scope: 'main', consumed: false }
  }

  routePointerCancel(event: PointerEvent, session?: PointerDispatchSession): PointerRouteDecision {
    if (session?.routeScope === 'interceptor' && session.routeTarget) {
      const interceptor = session.routeTarget as PointerRouteInterceptor
      const consumed = interceptor.onPointerCancel?.(event)
      return { scope: 'interceptor', consumed: consumed !== false, target: interceptor }
    }
    if (session?.routeScope === 'main') {
      return { scope: 'main', consumed: false }
    }

    const consumed = PopupManager.instance.handlePointerCancel(event)
    return consumed
      ? { scope: 'popup', consumed: true }
      : { scope: 'main', consumed: false }
  }

  routeWheel(event: WheelPointerEvent): boolean {
    if (PopupManager.instance.handleWheel(event)) return true
    const interceptor = this._topmostInterceptorAt(event.position)
    if (!interceptor) return false
    if (!interceptor.preserveFocus) FocusManager.instance.clearFocus()
    const consumed = interceptor.onWheel?.(event)
    return consumed !== false
  }

  routePoint(position: Offset, options: PointerRoutePointOptions = {}): boolean {
    if (PopupManager.instance.isInteractiveAt(position)) return true
    const interceptor = this._topmostInterceptorAt(position)
    if (!interceptor) return false
    if (!interceptor.preserveFocus) FocusManager.instance.clearFocus()
    if (options.notify === false) return true
    const consumed = interceptor.onPointerDown({
      pointerId: 0,
      position,
      type: 'down',
      button: 0,
      buttons: 0,
      pointerType: 'mouse',
    })
    return consumed !== false
  }

  private _topmostInterceptorAt(position: Offset): PointerRouteInterceptor | undefined {
    const interceptors = this._getInterceptors()
    for (let i = interceptors.length - 1; i >= 0; i--) {
      const interceptor = interceptors[i]!
      if (interceptor.hitTest(position)) return interceptor
    }
    return undefined
  }
}
