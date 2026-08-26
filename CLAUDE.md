# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

prreview: a CLI (`npx @jv-vogler/prreview`, command `prreview`) that serves a code review
workspace on localhost for PRs, branches, commit ranges, and working-tree changes. The
intelligence comes from the user's own `claude` CLI, driven as a short-lived child process —
never a raw API call — so the agent does its own repo grounding.

**Currently mid-rewrite.** The previous implementation (three tabs: Understanding, Diff,
Suggested comments) is being redesigned from a fresh mental model, and `src/` is presently empty.
The old implementation is preserved for reference only, on disk, in the gitignored `legacy/`
directory (mirrors this repo's old root: `legacy/src`, `legacy/test`, `legacy/docs`, old
`PRODUCT.md`/`ARCHITECTURE.md`/`README.md`, etc.), and in full at the `pre-rewrite` git tag. Copy
specific files out of `legacy/` deliberately when something there is worth keeping — do not let
its patterns leak into new code by proximity, and do not treat anything under `legacy/` as
current design or as a source of conventions to follow.

## Architecture (carries forward)

Layering, on both server (`src/`) and client (`src/client/src/`): `domain/` is pure — no I/O, no
child processes, no React; `application/` holds one use-case per file orchestrating domain code
through `ports/` (interfaces only); `infrastructure/` implements those ports; `interface/`
(server: CLI + HTTP) / `view/` + `pages/` (client) are the only ways in, and the only places
errors are handled. No `types/` folder anywhere — types live with the layer that owns them.

`src/interface/http/dto/` is the only shared code between server and client: zod schemas +
`z.infer` types, importing nothing but zod (and in-folder siblings). Enforced by
`scripts/check-dto-imports.mjs` in `npm run lint`.

## Commands

`npm test` (vitest), `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:e2e`
(Playwright, against the built artifact). `npm run dev` runs the API server and Vite side by side:
Vite serves the page on 5173 and proxies `/api` to the server on a **pinned** 4973, so a leftover
server holding that port means the browser is talking to the older process. `npm run dev:mock`
puts `scripts/mock-agent/claude` on PATH so a review costs nothing.

A finished pass is a file: `.prreview/<changeset-key>/review.json` in the repo being reviewed,
plain JSON, gitignored via `.git/info/exclude`. It is loaded on boot, which is why a repo that has
been reviewed already shows that pass instead of an empty screen. `npm run dev:mock:fresh` deletes
`.prreview/` first, for when a fresh run is the point.

## Empirical traps

Facts about the `claude` CLI itself, not about prreview's design — they survive any rewrite and
are expensive to rediscover. Full detail in `docs/engine-notes.md`; the two that will silently
kill a run if missed:

1. `claude -p --output-format stream-json` **requires `--verbose`**, or the CLI exits 1 emitting
   nothing.
2. `--json-schema` **must be draft-07**: the CLI validates it with Ajv 8, which cannot resolve a
   draft-2020-12 `$schema` and kills the run at spawn.
