# DirectSurface

DirectSurface (`ds-ui`) is a TypeScript Canvas GUI framework and component library.

This repository contains the reusable rendering runtime, layout system, input handling, themes, and general-purpose widgets. Start with the [documentation](https://github.com/hailin-bigbaby/directsurface/blob/main/docs/README.md) or the [runnable basic app](https://github.com/hailin-bigbaby/directsurface/blob/main/examples/basic-app/README.md). See [contributing](https://github.com/hailin-bigbaby/directsurface/blob/main/CONTRIBUTING.md) for development checks.

## Build

```sh
npm ci
npm run check
npm run build
npm test
npm run verify:package
npm run check:icons
npm run check:docs
```

## Use

```ts
import { Application, ImGuiLightTheme, RenderText, RenderWindow } from 'ds-ui'

const window = new RenderWindow({ title: 'Hello DirectSurface' })
window.setChildren([new RenderText('Hello, world!')])
const host = Application.mount('#app').run(window, { theme: ImGuiLightTheme })
// Call host.dispose() when the application unmounts.
```

## Run the example

Try the [live component showcase](https://hailin-bigbaby.github.io/directsurface/). Its [source and setup guide](https://github.com/hailin-bigbaby/directsurface/blob/main/examples/basic-app/README.md) use a locally packed `ds-ui` release, as an external consumer would:

```sh
npm ci
npm run example:dev
```

`npm run verify:consumer` installs that package into the example, then checks its types and production build.

## Regenerate icons

Edit `scripts/icon_manifest.json`, run `npm run generate:icons`, and commit the generated `src/widgets/icon_catalog.generated.ts`. `npm run check:icons` verifies it is current.

Security issues: see the [security policy](https://github.com/hailin-bigbaby/directsurface/blob/main/SECURITY.md).
