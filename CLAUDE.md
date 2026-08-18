# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

prreview: a CLI (`npx prreview`) that serves a code review workspace on localhost for PRs,
branches, commit ranges, and working-tree changes. **Three tabs**, each a separate deliberate
spend:

| Tab | Route | What it is | Spend |
|---|---|---|---|
| Understanding | `/understand` | what the change is for, whether the code matches, then the change as plain-language topics each carrying its code | comprehension pass |
| Diff | `/diff` | plain GitHub-style diff, GitHub-style per-file "Viewed"; a toggle overlays finding balloons | free |
| Suggested comments | `/comments` | candidate review comments at a chosen depth | its own pass |

Nothing chains one pass off another: reading about a change must never quietly spend on a review
nobody asked for. With no agent installed the two AI tabs are **absent** (not disabled), and the
routes redirect to the diff. `/overview` and `/orient` both redirect to `/understand` — Overview
was its own tab for one release and should not have been: it came from the same pass and read as
the same account, so splitting it charged a click for half a thought.

**Every pass triggers from inside the tab it fills.** There is no analysis button in the header;
one lived there, appeared beside every tab, and belonged to none of them.

Built and working: the viewer, the comprehension pass (topics + overview + opportunistic ticket),
the findings pass (six lenses, adjudication, form and grounding gates), and chat. Not yet:
chat operating on findings as structured ops, `--brain`, and GitHub publishing.

Authority docs: `PRODUCT.md` (what and why), `ARCHITECTURE.md` (how), `plan/` (execution state,
gitignored — `plan/design-understanding-and-comments.md` is the current design agreement).

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
- **Coverage is never inferred**: a per-file "Viewed" box is the only writer, exactly like
  GitHub's, and ticking it folds the file (reopenable without unticking). The
  IntersectionObserver that used to mark hunks viewed on scroll is **gone** — scrolling past code
  is not reading it, review is not linear, and the percentage was measuring how far down the page
  you had got. `applyHunkCoverage` is monotonic between the two seen states but an explicit
  `unseen` always wins, because unticking a box is a statement.
- **A run always says what it is doing**: the engine's tool events reach `RunProgress` in the
  domain, the run manager coalesces them into `run.progress` (~2/s, never after a terminal
  frame), and `view/analysis/RunStatusBar.tsx` renders activity, elapsed against the run's own
  `timeoutMs`, a stall warning, a Stop button, and — wherever the reader is — the failure. The
  client also re-reads `GET /api/analysis/runs` every 8s while a run is live, so a dropped SSE
  frame can make the screen a few seconds stale but never permanently wrong. `interface/cli/
  runReporter.ts` narrates the same facts to the terminal. The rule behind all of it: **anything
  prreview computes about a run has to reach a human without being asked** — three separate bugs
  have now been "a mechanism ran correctly and its result went nowhere".
- **Sessions live in `.prreview/`** at the reviewed repo's root (JSON, atomic temp+rename
  writes, ~500ms debounce, pidfile lock). Delete `.prreview/` to reset a session.
- **Diff rendering**: `@pierre/diffs` (pinned) is imported by exactly three modules, and no
  others: `view/app/WorkerPoolHost.tsx` (the pool + theme, hoisted above the tabs so a tab switch
  does not terminate four workers), `view/diff/DiffWorkspace.tsx` (the Diff tab's virtualized
  `CodeView`), and `view/understanding/TopicBlock.tsx` (the Understanding tab's per-topic
  `FileDiff` excerpts). The narrowing recipe lives in `domain/understanding/narrowToHunks.ts` —
  read its comment before touching it; filtering the `hunks` array does **not** work, and the
  failure renders nothing while logging a renderer error (`spikes/topic-render/VERDICT.md`).
- **Engine layer**: the intelligence is the user's own `claude` CLI, driven as short-lived child
  processes. `src/infrastructure/engine/` spawns them (argv array, `shell: false`, prompt on
  stdin, line-delimited JSON back), and `runManager.ts` runs at most two **runs** at a time — one
  analysis lane, one chat lane. A review run fans out to up to five lens children *inside* its own
  job, behind a semaphore, so the manager still sees one runId, one 202, one cancel, and one abort
  signal; the lane policy is deliberately unaware of it. Every lens resume passes `--fork-session`
  (measured clean at five, `spikes/depth-and-fanout/VERDICT.md`). Everything above it talks to the `Engine` port in `application/ports/`, so
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
