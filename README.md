# npm package preset

An opinionated starting point for a single, ESM-only npm package written in
strict TypeScript.

## Included

- pnpm with a committed lockfile
- strict TypeScript and generated declaration files
- ESLint and Prettier
- Vitest with V8 coverage thresholds
- package metadata validation with publint
- CI on the oldest supported and current Node.js releases
- npm Trusted Publishing through GitHub Actions
- Dependabot updates for npm and GitHub Actions

## Create a package

Derive a repository while retaining Git ancestry:

```sh
git-lineage derive \
  https://github.com/shazhou-ww/preset-npm-package.git \
  my-package \
  --branch main
cd my-package
```

You can also use GitHub's **Use this template** button if you do not need to
retain lineage.

This preset derives from
[`preset-typescript-base`](https://github.com/shazhou-ww/preset-typescript-base).
Its `.git-lineage.yaml` records that immediate parent, and `git-lineage update`
merges future parent changes without discarding package-specific commits. This
preset documents its own capabilities and does not enumerate descendants.

## Initialize the metadata

Before publishing a derived package:

1. Replace `name`, `description`, `keywords`, `homepage`, `bugs`, and
   `repository` in `package.json`.
2. Set an initial version such as `0.1.0`.
3. Remove `"private": true` or change it to `false` only when the package is
   ready to publish.
4. Replace the example API in `src/index.ts` and its tests.
5. Replace this README and add your copyright line to `LICENSE`.

Keeping the package private initially prevents an accidental publication under
the preset's placeholder name.

## Requirements

- Node.js 22.13 or newer
- pnpm 11.22 or newer

## Development

```sh
pnpm install
pnpm check
```

Useful individual commands:

| Command              | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `pnpm build`         | Compile ESM JavaScript, declarations, and source maps |
| `pnpm typecheck`     | Type-check without emitting files                     |
| `pnpm lint`          | Run ESLint                                            |
| `pnpm format`        | Format supported files with Prettier                  |
| `pnpm test`          | Run the test suite once                               |
| `pnpm test:watch`    | Run tests in watch mode                               |
| `pnpm test:coverage` | Run tests and enforce coverage thresholds             |
| `pnpm lint:package`  | Validate the published package shape                  |

The package entry point is `src/index.ts`. Tests belong in `test/`, and build
artifacts are written to `dist/`.

## Verify the package artifact

Build and inspect the exact files npm would publish:

```sh
pnpm pack
```

The `files` allowlist in `package.json` keeps source, tests, and development
configuration out of the published tarball.

## Publish with npm Trusted Publishing

The publish workflow runs for `v*` tags. Before the first release:

1. Create an `npm` environment in the derived GitHub repository.
2. On npmjs.com, add a GitHub Actions Trusted Publisher with the exact
   organization or user, repository, `publish-npm.yaml` workflow filename, and
   `npm` environment. Enable both **Allow npm publish** and **Allow npm
   dist-tag**.
3. Replace all preset metadata, remove the private safeguard, and commit those
   changes to `main`.
4. Do not create an `NPM_TOKEN` secret or use an OTP. The workflow obtains a
   short-lived credential through GitHub OIDC.
5. Validate a new or changed Trusted Publisher without publishing:

   ```sh
   gh workflow run publish-npm.yaml --ref main
   ```

   Wait for the matching `main` push CI to succeed first. The manual run uses
   the same CI verification gate, assigns a temporary prerelease version in its
   checkout, and performs an npm dry run without publishing or changing a
   dist-tag.

6. Commit the release version to `main`.
7. Wait for that exact commit's `main` push CI, including **Release verification
   (v1)**, to succeed.
8. Create and push the matching tag, for example `v0.1.0`.

The workflow verifies that the tag matches `package.json`, that the commit is
reachable from `main`, and that the version is not already on npm. It reuses the
latest run of `ci.yaml` for the exact checked-out commit, requiring this
repository, the `main` branch, the `push` event, a successful completed run, and
the successfully executed **Release verification (v1)** job and verification
step from that run attempt. Older green runs cannot override newer failures;
missing, pending, cancelled, skipped, old-contract, or inaccessible evidence
blocks publication. Validation policy changes must update the versioned
verification contract in CI and the publish workflow's `--job-name` /
`--step-name` arguments.

The gate uses the `github-ci-verify` CLI, pinned as a development dependency and
installed from the frozen lockfile. Its `--json --summary` options emit
machine-readable evidence and append the successful verification to the Actions
summary. There is no repository-local copy of the verifier.

Publishing installs locked dependencies, builds once through `prepack`, checks
the resulting tarball with publint, and publishes that same tarball using
short-lived OIDC credentials. It does not repeat the complete `pnpm check`. The
release summary records the source SHA, CI run URL, run attempt, and
verification contract.

If publication is blocked before publishing because CI has not succeeded yet,
wait for the matching CI and retry the failed release workflow without moving
the tag. Release tags are immutable. Do not retry an already-successful publish;
an existing npm version is rejected.

After the first successful OIDC release, set npm package **Publishing access**
to **Require two-factor authentication and disallow tokens**. Trusted Publishing
continues to work without a long-lived npm token.

## License

MIT
