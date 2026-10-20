# Component showcase

This interactive showcase imports only the public `directsurface` package entry and uses the package tarball produced from this repository. The Workbench tab is a complete sample project delivery application with filters, metrics, charts, task editing, and theme settings. The Controls and Data & charts tabs remain independent component showcases. Canvas workspace demonstrates dockable panels and a 10,000-row local data grid.

From the repository root:

```sh
npm ci
npm run example:dev
```

Open Workbench to filter, edit, and create tasks; open Canvas workspace to filter a large grid and float or dock the inspector. Changes to sample tasks reset on refresh; the light/dark preference stays on this device. The displayed user is fictional and there is no login or backend. Run `npm run verify:consumer` to typecheck and build the example against the packed library.

## Chart examples

Open **Data & charts** and scroll below Delivery trend. **Actual vs target** combines grouped bars and a line using one Y axis and unit, including a missing value. **Request size vs duration** keeps repeated X observations and an outlier. Click a bar or point to update the selection text; click a legend item to toggle a series. Cards stack on narrow screens and follow the light/dark theme.

See [ComboChart](../../docs/components/visualization/charts/combo-chart.md) and [ScatterChart](../../docs/components/visualization/charts/scatter-chart.md) for options and limits. The examples use static sample data and do not fetch external services.

## GitHub Pages

Live demo: https://hailin-bigbaby.github.io/directsurface/

The repository's deployment workflow builds this example with the `/directsurface/` asset base and publishes only `dist/` to GitHub Pages. Local development keeps the `/` base.
