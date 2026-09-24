# Getting started

DirectSurface draws a render tree into an existing `HTMLCanvasElement`. It does not create the Canvas or render controls as DOM nodes.

## Run the example from source

```sh
npm ci
npm run example:dev
```

The command packs `ds-ui`, installs that tarball into the [basic app](../examples/basic-app/README.md), and starts Vite. Open the Controls tab to edit a field, click a button, and switch themes. The Data & charts tab demonstrates a sortable grid. Run `npm run verify:consumer` to typecheck and build the same external consumer.

## Use a built package in another application

Build a tarball with `npm pack`, then install the resulting `ds-ui-<version>.tgz` in a Vite + TypeScript application. The package exposes one import path: `ds-ui`.

Create a full-size Canvas before mounting:

```html
<canvas id="app"></canvas>
<style>
  html, body, #app { width: 100%; height: 100%; margin: 0; }
  #app { display: block; }
</style>
```

Then create a window and keep the returned host so it can be disposed:

```ts
import {
  Application,
  ImGuiLightTheme,
  RenderPage,
  RenderStackPanel,
  RenderText,
  RenderWindow,
  loadDirectSurfaceFonts,
} from 'ds-ui'

await loadDirectSurfaceFonts()
const content = new RenderStackPanel({ padding: 24, spacing: 12 })
content.addChild(new RenderText('Hello, DirectSurface!', { role: 'title' }))
const window = new RenderWindow({ title: 'Hello', chrome: 'none' })
window.setChildren([new RenderPage({ child: content })])
const host = Application.mount('#app').run(window, { theme: ImGuiLightTheme })

// Call host.dispose() when the host page is removed.
```

`Application.mount()` requires the matching Canvas to be in the DOM. Give it non-zero CSS dimensions before starting the app. See [runtime and lifecycle](lifecycle.md) for cleanup and remounting.
