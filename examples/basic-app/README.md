# Component showcase

This interactive showcase imports only the public `ds-ui` package entry and uses the package tarball produced from this repository. It demonstrates responsive layout, controls, theme switching, charts, and a sortable data grid with sample data.

From the repository root:

```sh
npm ci
npm run example:dev
```

Open the Overview, Controls, and Data & charts tabs to try the Canvas UI. Run `npm run verify:consumer` to typecheck and build the example against the packed library.

## GitHub Pages

Live demo: https://hailin-bigbaby.github.io/directsurface/

The repository's deployment workflow builds this example with the `/directsurface/` asset base and publishes only `dist/` to GitHub Pages. Local development keeps the `/` base.
