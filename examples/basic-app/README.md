# Basic app

This example is adapted from the original DirectSurface consumer scaffold. It imports only the public `ds-ui` package entry and uses the package tarball produced from this repository.

From the repository root:

```sh
npm ci
npm run example:dev
```

Edit the name field or click the button to see the Canvas UI update. Run `npm run verify:consumer` to typecheck and build the example against the packed library.

## GitHub Pages

Live demo: https://hailin-bigbaby.github.io/directsurface/

The repository's deployment workflow builds this example with the `/directsurface/` asset base and publishes only `dist/` to GitHub Pages. Local development keeps the `/` base.
