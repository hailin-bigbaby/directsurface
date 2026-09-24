# Contributing to DirectSurface

Thank you for helping improve the public `directsurface` framework.

## Set up

```sh
npm ci
npm run check:icons
npm run check:docs
npm run check
npm test
npm run verify:consumer
```

`verify:consumer` packs the library and builds the example against the tarball. You can run `npm run example:dev` to try the controls in a browser.

## Make a change

- Keep reusable rendering, layout, interaction, and control behavior in the corresponding `src` area.
- Import the library from `directsurface` in examples. Update `src/index.ts` intentionally when changing the public API.
- Put focused behavioral tests beside the changed source file as `*.test.ts`.
- Update the relevant documentation and the [component catalog](docs/components.md) when changing a public control.
- Edit `scripts/icon_manifest.json` and run `npm run generate:icons` when changing built-in icons. Do not edit the generated catalog by hand.

Keep pull requests focused. Include a summary, the commands you ran, and a screenshot when the visible UI changes.
