# Releasing prreview

How a version of prreview reaches npm. In short: publishing is automated by
`.github/workflows/release.yml` and fires when a `v*` tag is pushed; before the first release,
the owner must do two one-time setup steps by hand.

## One-time setup (owner, manual)

### 1. Create the public GitHub repository

The workflow assumes the repo lives at `github.com/jv-vogler/prreview` — that URL is already in
`package.json` (`repository`, `homepage`, `bugs`). **This is an assumption** (ASSUMPTION-002 in
the plan): the repo does not exist yet. If the owner picks a different owner/name, update those
three `package.json` fields and the trusted-publisher configuration below to match.

```sh
gh repo create jv-vogler/prreview --public --source . --push
```

The repository must be public: npm provenance attestations are only issued for builds from
public repos.

### 2. Give the workflow permission to publish

Two options; trusted publishing is preferred because no long-lived secret exists to leak.

**Option A — npm trusted publishing (preferred).** On npmjs.com, under the package's
Settings → Publishing access (for a first release: your account → Packages → Add trusted
publisher), register a GitHub Actions publisher with:

- Organization or user: `jv-vogler`
- Repository: `prreview`
- Workflow filename: `release.yml`
- Environment: leave empty

With this in place the workflow authenticates via OIDC; no secret is needed. The workflow
upgrades npm to >= 11.5.1 because older npm versions cannot do the OIDC exchange.

**Option B — `NPM_TOKEN` secret (fallback).** Create a granular automation token on npmjs.com
with publish permission for `prreview`, then store it in the GitHub repo:

```sh
gh secret set NPM_TOKEN
```

The workflow already reads it (`NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`).

## Cutting a release

Versioning is manual by design (ALT-004: no changesets/semantic-release).

1. Make sure `main` is green in CI.
2. Check the name/version is publishable: `npm view prreview` — before the first release this
   must fail with 404 (name unclaimed); afterwards the new version must not already exist.
3. Bump and tag — `npm version` creates the commit and the `vX.Y.Z` tag together:

   ```sh
   npm version patch   # or minor / major / an explicit 0.1.0
   git push origin main --follow-tags
   ```

4. The pushed tag triggers the Release workflow: `npm ci`, tests, build,
   `scripts/verify-pack.sh` (tarball contents + install smoke), then
   `npm publish --provenance --access public`.
5. Smoke-test from the registry, from a directory outside this repo:

   ```sh
   npx prreview@latest --help
   ```

If the workflow fails before the publish step, nothing was published: fix, delete the tag
(`git push --delete origin vX.Y.Z`, `git tag -d vX.Y.Z`), and start over.
