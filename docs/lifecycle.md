# Runtime and lifecycle

The host page owns the Canvas. `Application.mount('#app').run(window)` creates an `AppHost` that owns the runtime, event routing, overlay services, and the root render tree.

```text
HTMLCanvasElement
  → Application
  → AppHost
  → RenderWindow
  → RenderPage
  → layouts and widgets
```

Keep one active `AppHost` per Canvas. Save the value returned by `run()` and call `dispose()` when the page unmounts, a route replaces the Canvas, or hot reload recreates the app. Dispose the old host before mounting another one on the same Canvas.

A `RenderObject` receives constraints during layout, paints with the current theme, participates in hit testing when visible, and releases owned resources on disposal. Use `markNeedsLayout()` for changes that affect size or placement, and `markNeedsPaint()` for visual-only changes. See [layouts](layouts.md) for the parent-child constraint model.

For ordinary page changes, replace or update the page inside the running window; the host does not need to be recreated. The [component showcase](../examples/basic-app/src/main.ts) shows a minimal startup and disposal pattern.

## Shared animation time

Each `RuntimeHost` owns an `AnimationClock`. Frame requests are coalesced, pending state changes are committed, and active animations are sampled before layout and paint using the same frame timestamp. Moving progress indicators, loading buttons, and loading overlays calculate position from elapsed time rather than timer callback counts.

`RenderObject` extensions can use the protected `registerAnimation(tick)` method. Attachment owns the subscription; detachment and disposal cancel it. Hidden controls, inactive tabs and content outside the host or supported scroll clips pause their decorative animation time. Visible adorners are not clipped by their parent's content viewport. The document visibility lifecycle pauses and resumes the host clock.

`PopupContext.animationClock` exposes the same clock to popup extensions. Cancel subscriptions when a popup closes. Direct clock subscriptions return an idempotent unsubscribe callback. `subscriberCount` includes paused subscriptions; `hasActiveAnimations` indicates whether another animation frame is needed.

```ts
import { AnimationClock } from 'directsurface'

const clock = new AnimationClock(() => { /* request a frame from your host */ })
const stop = clock.subscribe(elapsedMs => { /* update a visual value */ })
clock.tick(0)
clock.tick(1000 / 120)
stop()
clock.dispose()
```

The standalone clock does not create browser frame callbacks itself. `RuntimeHost.renderFrame(timestamp)` advances the clock; omitting the timestamp paints current state only. Decorative animation time excludes hidden time and must not be used as a business deadline clock. Failed callbacks or activity predicates are removed and surfaced while other subscriptions can continue.

## Focus visibility

Actual focus and its navigation outline are separate. Pointer presses hide navigation focus rings without clearing focus or selection. Keyboard navigation reveals them again, including when focus remains on the same control. Pointer movement and scrolling do not hide a keyboard focus ring.

`FocusManager` records input before pointer routing and popup interception. Tab, arrows, Home/End, PageUp/PageDown, Enter, Space and Escape select keyboard visibility. Modifier-only keys, ordinary Ctrl/Meta/Alt shortcuts and input composition do not change the policy; navigation combinations such as Ctrl+Tab still count as keyboard navigation.

Programmatic focus and popup focus restoration inherit the latest input modality; the initial default is keyboard visibility. Text fields and editors retain their editing border, caret and selection after pointer focus. Selected items and active editing cells keep their own state indicators.

`FocusManager.instance.inputModality` returns `keyboard` or `pointer`. `FocusManager.keyboardFocusVisible` is a read-only drawing policy and does not instantiate a manager. Custom navigation outlines should follow that policy while preserving actual focus. Built-in focusable controls also expose `isFocusVisible`. Standard pointer dispatch already calls `notifyPointerInput()`; custom adapters can call it before dispatching pointer-down events. Keyboard events continue through `handleKeyDownEvent()`.
