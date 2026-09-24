# Component showcase

This interactive showcase imports only the public `ds-ui` package entry and uses the package tarball produced from this repository. The Workbench tab is a complete sample project delivery application with filters, metrics, charts, task editing, and theme settings. The Controls and Data & charts tabs remain independent component showcases. Canvas workspace demonstrates dockable panels and a 10,000-row local data grid.

From the repository root:

```sh
npm ci
npm run example:dev
```

Open Workbench to filter, edit, and create tasks; open Canvas workspace to filter a large grid and float or dock the inspector. Changes to sample tasks reset on refresh; the light/dark preference stays on this device. The displayed user is fictional and there is no login or backend. Run `npm run verify:consumer` to typecheck and build the example against the packed library.

## GitHub Pages

Live demo: https://hailin-bigbaby.github.io/directsurface/

The repository's deployment workflow builds this example with the `/directsurface/` asset base and publishes only `dist/` to GitHub Pages. Local development keeps the `/` base.
