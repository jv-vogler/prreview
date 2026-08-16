# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

prreview: a CLI (`npx prreview`) that serves a GitHub-style diff viewer on localhost for
reviewing PRs, branches, commit ranges, and working-tree changes. M1 (the viewer) is built;
AI analysis arrives in M2+. Authority docs: `PRODUCT.md` (what and why), `ARCHITECTURE.md`
(how), `plan/` (execution state).

## Commands

| Command | Does |
|---|---|
| `npm run dev` | server via tsx watch (`--dev`, port 4973) + Vite client — open Vite's printed URL; it proxies `/api` |
| `npm run build` | `dist/cli.js` (tsdown) + `dist/client/` (vite) — both targets |
| `npm test` | vitest, two projects: `server` (node) and `client` (jsdom) |
| `npx vitest run <path>` | a single test file (e.g. `npx vitest run src/domain/changeset/ids.test.ts`) |
| `npm run test:e2e` | Playwright smoke in `e2e/`; always rebuilds first (tests the built artifact) |
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

## Enforced invariants — do not break

1. `src/interface/http/dto/` imports nothing but zod (and in-folder siblings). Enforced by
   `scripts/check-dto-imports.mjs` in `npm run lint`.
2. No raw colors outside `src/client/src/view/styling/pierre-theme.css` — Primer tokens only.
   Enforced by stylelint.
3. Tests inject fakes through `buildContainer` overrides (see `test/helpers/`), never module
   mocks. Adapter tests run against real temp git repos (`test/helpers/createFixtureRepo.ts`)
   and fake `gh`/`claude` binaries (`test/bin/`) on a stripped PATH.

## Conventions

- One concept per file, named after it; named exports; no barrel files; hooks `useX`,
  providers `XProvider`.
- Errors: `AppError` subclasses with closed reason unions (`src/domain/errors/`); adapters
  throw raw, use-cases convert, only edges handle (HTTP `onError`, CLI boot catch, poller tick).
- CLI surface is frozen (PRODUCT.md §13): `prreview [target] [base]`, flags `--port` and
  `--no-open` only, plus the internal `--dev`. Do not add flags without an argued decision.
