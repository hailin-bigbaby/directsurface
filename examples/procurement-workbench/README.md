# Office procurement workbench

A complete Canvas application for drafting office-supply and equipment orders, built only against the packed public `directsurface` package.

[Live demo](https://hailin-bigbaby.github.io/directsurface/procurement/)

All organizations, requests, approvals and quotations are fictional. The flow ends at **submitted for approval**; no approval service, purchasing integration or real supplier communication exists. The interface uses Chinese office-procurement terminology and a fixed, visible sample business date.

## Run from the repository root

```sh
npm ci
npm run verify:consumer
npm run procurement:setup
npm --prefix examples/procurement-workbench run dev
```

Requires Node 22 or 24. Open `http://127.0.0.1:4190/`. Setup installs the freshly packed library; it does not alias framework source. Dependency installation follows the repository's example setup convention (`--no-package-lock`). SQLite WASM and the browser-test runner have exact dependency versions.

## Try the workflow

1. Select approved requests with the checkboxes, then create an order. Supplies and equipment with incompatible terms must be ordered separately.
2. Enter quantities and delivery dates. Select a line, compare the supplier prices and terms in the quotation panel, and adopt a quotation.
3. Save a draft or submit the completed order. Submission rechecks available source quantities and amounts atomically, then makes the order read-only.
4. Drag and float panels or use compact mode. Ctrl/Cmd+S saves; Ctrl/Cmd+Enter opens the submission confirmation.
5. Export saved snapshots or reset this demo after confirmation. Export is not an import/restore feature.

## Storage and limits

The first visit verifies and imports a static sample into SQLite WASM. A Worker owns an OPFS SAH-pool database, protected by a single-tab Web Lock. HTTPS or localhost is required; COOP/COEP headers are not required. Supported storage is tested in desktop Chromium. Other browsers and mobile layouts have not been qualified.

Saved data belongs to this browser and origin. Clearing site data removes it; unsaved edits are not recovered after refresh. A second tab reports that the database is in use. If storage is unavailable, the user may explicitly enter a clearly marked temporary mode. There is no backend or login. Canvas controls are not exposed as semantic controls for assistive technologies.

## Architecture and checks

- `domain`: exact decimal arithmetic, quotation and order rules.
- `application`: use cases, document state and repository ports.
- `infrastructure`: Worker transport, sample validation and SQLite transactions.
- `presentation`: existing framework controls, editing guards and workspace composition.
- `main.ts`: dependency composition.

```sh
npm run procurement:check
npm run procurement:test:browser
npm run procurement:test:production
```

Install Chromium first with `npx playwright install chromium`. Production tests serve the built output below a subpath and check resources and the absence of test globals. Development-only test hooks are excluded from every production build. `dist/` is suitable for static hosting with the WebAssembly MIME type. The Pages workflow combines it with the main demo under `/procurement/`.

SQLite core is public domain. The `@sqlite.org/sqlite-wasm` package wrapper is Apache-2.0; see [third-party notices](THIRD_PARTY_NOTICES.md).
