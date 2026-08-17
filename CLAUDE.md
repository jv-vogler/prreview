# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

prreview: a CLI (`npx prreview`) that serves a GitHub-style diff viewer on localhost for
reviewing PRs, branches, commit ranges, and working-tree changes. M1 (the viewer) and M2
(explanations: intent map, anchored explanations, guided walkthrough, chat) are built; findings,
curation, and export arrive in M3, ticket alignment and GitHub publishing in M4. Authority docs:
`PRODUCT.md` (what and why), `ARCHITECTURE.md` (how), `plan/` (execution state).

## Commands

| Command | Does |
|---|---|
| `npm run dev` | server via tsx watch (`--dev`, port 4973) + Vite client — open Vite's printed URL; it proxies `/api` |
| `npm run build` | `dist/cli.js` (tsdown) + `dist/client/` (vite) — both targets |
| `npm test` | vitest, two projects: `server` (node) and `client` (jsdom) |
| `npx vitest run <path>` | a single test file (e.g. `npx vitest run src/domain/changeset/ids.test.ts`) |
| `npm run test:e2e` | Playwright specs in `e2e/`; always rebuilds first (tests the built artifact) and wipes `test-results/` |
| `npm run lint` | biome + stylelint + the dto import gate (`scripts/check-dto-imports.mjs`) |
| `npm run typecheck` | `tsc -b` (solution: node side + client) |
| `scripts/verify-pack.sh` | packs the tarball, asserts exact contents, installs it, serves, probes `/api/session` |

## Architecture

Layering per ARCHITECTURE.md §2, applied on BOTH sides (server `src/`, client `src/client/src/`):
`domain/` is pure — no I/O, no child processes, no React; `application/` holds one use-case per
file orchestrating domain code through `ports/` (interfaces only); `infrastructure/` implements
those ports (git, github, store, HTTP client); `interface/` (server: CLI + Hono HTTP) and
`view/`+`pages/` (client) are the only ways in, and the only places errors are handled. There is
no `types/` folder anywhere — types live with the layer that owns them.

Key structural facts:

- **Composition root**: `src/container.ts` — `buildContainer(config, toolchain)` builds every
  service once at boot; nothing instantiates services where they're used.
- **Wire contract**: `src/interface/http/dto/` is the ONLY shared code between server and
  client — zod schemas + `z.infer` types. The client imports it via the `@dto` alias.
- **Server-authoritative client**: TanStack Query caches patched by one SSE channel
  (`interface/http/events/`); coverage percentages always come from the server, never
  recomputed for display.
- **Sessions live in `.prreview/`** at the reviewed repo's root (JSON, atomic temp+rename
  writes, ~500ms debounce, pidfile lock). Delete `.prreview/` to reset a session.
- **Diff rendering**: `@pierre/diffs` (pinned) is imported by exactly one module,
  `src/client/src/view/diff/DiffWorkspace.tsx`.
- **Engine layer**: the intelligence is the user's own `claude` CLI, driven as short-lived child
  processes. `src/infrastructure/engine/` spawns them (argv array, `shell: false`, prompt on
  stdin, line-delimited JSON back), and `runManager.ts` runs at most two at a time — one analysis
  lane, one chat lane. Everything above it talks to the `Engine` port in `application/ports/`, so
  a second CLI needs no change to a use-case, a route, or the client. Analysis is only ever
  user-triggered; with no agent installed `deriveFeatureFlags` returns all-false and every AI
  surface is absent rather than disabled.

## Enforced invariants — do not break

1. `src/interface/http/dto/` imports nothing but zod (and in-folder siblings). Enforced by
   `scripts/check-dto-imports.mjs` in `npm run lint`.
2. No raw colors outside `src/client/src/view/styling/pierre-theme.css` — Primer tokens only.
   Enforced by stylelint.
3. Tests inject fakes through `buildContainer` overrides (see `test/helpers/`), never module
   mocks. Adapter tests run against real temp git repos (`test/helpers/createFixtureRepo.ts`)
   and fake `gh`/`claude` binaries (`test/bin/`) on a stripped PATH.
4. `claude -p --output-format stream-json` **requires `--verbose`** or the CLI exits 1 emitting
   nothing, and any resume that could overlap another **must** pass `--fork-session` or both
   threads interleave into the parent session file. Both are empirical (`spikes/*/VERDICT.md`),
   both live in `src/infrastructure/engine/argv.ts`, and the fake enforces the first.
5. `--json-schema` must be **draft-07**: the CLI validates it with Ajv 8, which cannot resolve a
   draft-2020-12 `$schema` and kills the run at spawn (CON-014, `docs/engine-notes.md`). Build
   schema strings only through `toJsonSchema`, and register every task schema in
   `src/application/analysis/taskSchemas.ts` — that registry is what the Ajv gate iterates. The
   fake validates the flag too, so a violation is a red unit test rather than a broken product.

## Testing the agent without paying for it

The whole suite runs with no `claude` installed and no network. `test/bin/claude` is a fake that
replays a recorded `stream-json` capture from `test/fixtures/claude/` line by line and exits with
the recorded code; `test/helpers/shimPath.ts` builds the stripped PATH it sits on. Knobs, all
test-only and never read by `src/`: `FAKE_CLAUDE_FIXTURE`, `FAKE_CLAUDE_FIXTURE_BY_TASK` (route
by prompt substring, so one PATH serves the analysis and chat lanes), `FAKE_CLAUDE_LOG`,
`FAKE_CLAUDE_DELAY_MS`, `FAKE_CLAUDE_EXIT`, `FAKE_CLAUDE_TRAP_SIGTERM`, `FAKE_CLAUDE_VERSION`.

**Never run the real `claude` CLI from inside this repository.** Two opt-in escapes exist, both
refusing to run without `PRREVIEW_REAL_CLAUDE=1`, both using `--model haiku` in a scratch repo
under the OS temp dir:

```sh
PRREVIEW_REAL_CLAUDE=1 npx vitest run test/realClaude.test.ts   # re-validate against a new CLI release
PRREVIEW_REAL_CLAUDE=1 node scripts/capture-claude-fixtures.mjs # re-record the fixtures
```

Run them when the CLI's flags or envelope shapes may have changed — `test/fakeClaude.test.ts`'s
digests are what fail loudly when they have. `docs/engine-notes.md` records what was measured.

## Conventions

- One concept per file, named after it; named exports; no barrel files; hooks `useX`,
  providers `XProvider`.
- Errors: `AppError` subclasses with closed reason unions (`src/domain/errors/`); adapters
  throw raw, use-cases convert, only edges handle (HTTP `onError`, CLI boot catch, poller tick).
- CLI surface is frozen (PRODUCT.md §13): `prreview [target] [base]`, flags `--port` and
  `--no-open` only, plus the internal `--dev`. Do not add flags without an argued decision.
