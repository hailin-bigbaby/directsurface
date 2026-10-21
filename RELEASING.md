# Releasing DirectSurface

Source updates on `main` do not publish npm packages. Maintainers manually sync and review the public repository, then create a version tag to trigger the npm publish workflow.

## One-time npm setup

In the `directsurface` package settings on npmjs.com, add a GitHub Actions trusted publisher:

- GitHub user: `hailin-bigbaby`
- Repository: `directsurface`
- Workflow filename: `publish-npm.yml`
- Environment: none
- Allowed action: **npm publish**

This uses npm's OIDC trust instead of a long-lived npm token. Configure it only after the workflow exists on GitHub. The package owner must perform this account setting.

## Each release

1. Review the manually synchronized public source, package contents, documentation, and changelog. Keep private plans, business data, and private components out of this repository.
2. Update `package.json` and `package-lock.json` together with `npm version <next-version> --no-git-tag-version --ignore-scripts`.
3. Run `npm run verify:consumer`, `npm run test:browser`, and `npm run test:framework:browser`. Commit and push to `main`; wait for CI to pass.
4. Tag that exact commit with `git tag v<next-version>` and push the tag. `.github/workflows/publish-npm.yml` checks the tag and lockfile versions, repeats the package and browser checks, then publishes to npm.
5. Confirm the Actions run succeeded and `npm view directsurface version` reports the new version. A GitHub Release can be added separately for release notes.

Never push a release tag before the trusted publisher is configured. Ordinary pushes only update source and the example site; they do not publish npm.
