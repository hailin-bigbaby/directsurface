# DirectSurface

DirectSurface (`ds-ui`) is a TypeScript Canvas GUI framework and component library. This repository contains the reusable rendering runtime, layout system, input handling, themes, and general-purpose widgets.

**Start here:** [Try the live component showcase](https://hailin-bigbaby.github.io/directsurface/) · [Read the getting-started guide](docs/getting-started.md) · [Browse component guides](docs/components/README.md)

## Run the showcase locally

```sh
git clone https://github.com/hailin-bigbaby/directsurface.git
cd directsurface
npm ci
npm run example:dev
```

The showcase uses a locally packed `ds-ui` package, as an external application would. Open the Overview, Controls, and Data & charts tabs to explore it. Its [source and setup guide](examples/basic-app/README.md) explains the example; `npm run verify:consumer` checks that it builds against the packed library.

## Use ds-ui in your own application

The first npm registry release has not been published yet. Build a tarball from this repository:

```sh
npm ci
npm pack
```

Then, in your own Vite + TypeScript application, install the resulting `ds-ui-0.1.0.tgz` file:

```sh
npm install /absolute/path/to/directsurface/ds-ui-0.1.0.tgz
```

Create a Canvas element and import from the package entry. The [getting-started guide](docs/getting-started.md) has a complete mounting example and lifecycle notes.

```ts
import { Application, ImGuiLightTheme, RenderText, RenderWindow } from 'ds-ui'

const window = new RenderWindow({ title: 'Hello DirectSurface' })
window.setChildren([new RenderText('Hello, world!')])
const host = Application.mount('#app').run(window, { theme: ImGuiLightTheme })
// Call host.dispose() when the application unmounts.
```

## Develop the framework

```sh
npm ci
npm run check
npm test
npm run verify:consumer
npm run test:browser
```

See [contributing](CONTRIBUTING.md) for code and documentation changes. The [component catalog](docs/components.md) lists the public exports.

## Regenerate icons

Edit `scripts/icon_manifest.json`, run `npm run generate:icons`, and commit the generated `src/widgets/icon_catalog.generated.ts`. `npm run check:icons` verifies it is current.

Security issues: see the [security policy](SECURITY.md).
