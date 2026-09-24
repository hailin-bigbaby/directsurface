# DirectSurface

**Desktop-grade browser workspaces, drawn on Canvas.** DirectSurface (`ds-ui`) is an ESM TypeScript GUI framework for data-heavy applications with dockable windows, virtual data grids, charts, forms, overlays, and themes.

[Live demo](https://hailin-bigbaby.github.io/directsurface/) · [Getting started](docs/getting-started.md) · [Component guides](docs/components/README.md) · [中文说明](https://github.com/hailin-bigbaby/directsurface/blob/main/README.zh-CN.md)

![A dockable DirectSurface workspace with a large data grid and trend chart](https://raw.githubusercontent.com/hailin-bigbaby/directsurface/main/docs/assets/canvas-workspace.png)

## Why DirectSurface

The [Canvas workspace demo](https://hailin-bigbaby.github.io/directsurface/) lets you filter 10,000 locally generated rows, rearrange docked document panels, float and dock an inspector, and switch themes. The Workbench tab shows a complete project-delivery flow with linked filters, metrics, charts, task editing, and date selection. Both demos use the public `ds-ui` package entry and fictional data.

This release does not provide accessibility support for assistive technologies; Canvas controls are not exposed as semantic DOM controls. Task data in the demo resets on refresh, and the displayed user is fictional.

## Install

```sh
npm install ds-ui
```

DirectSurface is ESM-only. Add a full-size Canvas to your Vite + TypeScript app:

```html
<canvas id="app"></canvas>
<style>
  html, body, #app { width: 100%; height: 100%; margin: 0; }
  canvas { display: block; }
</style>
```

Then mount a window and release its host when your page is removed:

```ts
import {
  Application, ImGuiLightTheme, RenderPage,
  RenderStackPanel, RenderText, RenderWindow, loadDirectSurfaceFonts,
} from 'ds-ui'

await loadDirectSurfaceFonts()
const content = new RenderStackPanel({ padding: 24, spacing: 12 })
content.addChild(new RenderText('Hello, DirectSurface!', { role: 'title' }))
const mainWindow = new RenderWindow({ title: 'Hello', chrome: 'none' })
mainWindow.setChildren([new RenderPage({ child: content })])
const host = Application.mount('#app').run(mainWindow, { theme: ImGuiLightTheme })
window.addEventListener('pagehide', () => host.dispose(), { once: true })
```

The [getting-started guide](docs/getting-started.md) covers mounting and cleanup. The [component catalog](docs/components.md) lists public exports; the [detailed guides](docs/components/README.md) describe their use.

## Run the demos from source

```sh
git clone https://github.com/hailin-bigbaby/directsurface.git
cd directsurface
npm ci
npm run example:dev
```

`example:dev` packs the library and installs the tarball into the standalone consumer app. The public [example source](examples/basic-app/) contains the Workbench, Controls, Data & charts, and Canvas workspace tabs.

## Develop and contribute

```sh
npm ci
npm run check
npm test
npm run verify:consumer
npm run test:browser
```

See [CONTRIBUTING.md](CONTRIBUTING.md), the [changelog](CHANGELOG.md), and the [MIT license](LICENSE). Security reports belong in the [security policy](SECURITY.md).
