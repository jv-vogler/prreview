# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

prreview: a CLI (`npx @jv-vogler/prreview`, command `prreview`) that serves a code review workspace on localhost for PRs,
branches, commit ranges, and working-tree changes. **Three tabs**, each a separate deliberate
spend:

| Tab | Route | What it is | Spend |
|---|---|---|---|
| Understanding | `/understand` | what the change is for, whether the code matches, then the change as plain-language topics each carrying its code | comprehension pass |
| Diff | `/diff` | plain GitHub-style diff, GitHub-style per-file "Viewed"; findings appear as balloons, with no switch to find | free |
| Suggested comments | `/comments` | candidate review comments at a chosen depth, plus what the pass threw away | its own pass |

Nothing chains one pass off another: reading about a change must never quietly spend on a review
nobody asked for. With no agent installed the two AI tabs are **absent** (not disabled), and the
routes redirect to the diff. `/overview` and `/orient` both redirect to `/understand` — Overview
was its own tab for one release and should not have been: it came from the same pass and read as
the same account, so splitting it charged a click for half a thought.

**Every pass triggers from inside the tab it fills.** There is no analysis button in the header;
one lived there, appeared beside every tab, and belonged to none of them.

Built and working: the viewer, the comprehension pass (topics + overview + opportunistic ticket),
the findings pass (six lenses at a depth you choose, adjudication, form and grounding gates, and
a report of what it threw away), curation through one write path, `--brain`, and chat. Not yet:
chat emitting findings ops through that write path — the path and its gates exist, the chat lane
does not call them — markdown export, the fix brief, and GitHub publishing.

Authority docs: `PRODUCT.md` (what and why), `ARCHITECTURE.md` (how), `plan/` (execution state,
gitignored — `plan/design-understanding-and-comments.md` is the current design agreement).

## Commands

| Command | Does |
|---|---|
| `npm run dev` | server via tsx watch (`--dev`, port 4973) + Vite client — open Vite's printed URL; it proxies `/api`. `PRREVIEW_DEV_TARGET=<target>` chooses what to review; the scripts pass no target, so without it a clean tree on the default branch has nothing to auto-detect and the server refuses to boot |
| `npm run dev:mock` | the same, with `scripts/mock-agent` on PATH as `claude` — real UI, generated answers, no spend |
| `npm run build` | `dist/cli.js` (tsdown) + `dist/client/` (vite) — both targets |
| `npm test` | vitest, two projects: `server` (node) and `client` (jsdom) |
| `npx vitest run <path>` | a single test file (e.g. `npx vitest run src/domain/changeset/ids.test.ts`) |
| `npm run test:e2e` | Playwright specs in `e2e/`; always rebuilds first (tests the built artifact) and wipes `test-results/` |
| `npm run lint` | biome + stylelint + the dto import gate (`scripts/check-dto-imports.mjs`) |
| `npm run typecheck` | `tsc -b` (solution: node side + client) |
| `scripts/verify-pack.sh` | packs the tarball, asserts exact contents, installs it, serves, probes `/api/session` |

**Which repo gets reviewed is the server's cwd, always.** The repo root comes from the process's
own working directory, and `gh pr view <n>` runs there too — so a PR number or URL resolves
against the repo you started the server in, never against the owner/repo in the URL, and the PR's
head is fetched into that clone. `npm run dev` therefore reviews *this* repo. To point the dev
loop at another checkout, start the two halves separately — the server from that checkout, Vite
from here (it proxies `/api` to `127.0.0.1:4973` no matter where the server runs):

```sh
# terminal 1, in the checkout you want reviewed
set -x PATH /path/to/prreview/scripts/mock-agent $PATH   # optional: mock agent instead of real spend
/path/to/prreview/node_modules/.bin/tsx watch /path/to/prreview/src/interface/cli/index.ts --dev 11

# terminal 2, in prreview
npx vite src/client                                      # open http://localhost:5173
```

For plain "does it work on this PR", skip dev mode: `npm run link` here, then `prreview 11` in
that checkout.

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
  frame), and `view/analysis/RunStatusBar.tsx` renders activity, elapsed, a stall warning, a Stop
  button, and — wherever the reader is — the failure. That progress is also what a run is now
  judged on: `idleTimeoutMs` is a budget for **silence**, rearmed by every report, so a run that
  keeps working is never killed for taking a while. The
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
  `FileDiff` excerpts). Its chrome lives in a shadow root, so anything a stylesheet cannot reach
  goes through the `unsafeCSS` option from `view/styling/pierreChromeCss.ts` (Primer tokens only —
  custom properties inherit across the boundary), and anything a prop cannot reach goes through
  one delegated listener reading `composedPath()` (`view/diff/useHeaderFoldClicks.ts`, which is
  what makes the whole file header fold its file). Neither reaches into a shadow root, so a Pierre
  upgrade breaks them into doing nothing rather than into doing something wrong.
  A fold is **eased, not cut to** (`view/diff/useAnimatedCollapse.ts`): the renderer is told to
  collapse only at the end of a fold and the start of an unfold, and the height in between is
  animated with the Web Animations API. This is safe *only* because `CodeView` resize-observes
  the container holding its items and re-reconciles the window, the sticky headers, and the
  scroll anchor on any drift — its layout model follows the DOM rather than fighting it. The e2e
  spec samples an intermediate height in both directions, which is the assertion that fails if
  that ever stops being true.
  The narrowing recipe lives in `domain/understanding/narrowToHunks.ts` —
  read its comment before touching it; filtering the `hunks` array does **not** work, and the
  failure renders nothing while logging a renderer error (`spikes/topic-render/VERDICT.md`).
- **A missing API server is said, not waited on**: in dev the server is a second
  process and is allowed to be absent — `npm run dev` leaves Vite up when the server
  refuses to boot, and `tsx watch` drops it for a moment on every server edit. On WSL2 a
  connect to a port nothing is listening on is never refused; the localhost relay hands
  it to Windows and it stays pending, so no proxy error was ever emitted and the app sat
  on "Loading review…" forever with the real reason printed in a terminal behind the
  browser. Three pieces close it, and none of them is a timeout on the reader's socket:
  `src/client/vite.config.ts` gates `/api` on a 500ms connect probe and answers
  `503 {reason:"unreachable"}` itself (its `proxyTimeout` covers the other silence, a
  server that accepts and then says nothing, and `/api/events` is exempt because SSE is
  an open response), `httpClients/apiClient.ts` turns a fetch that never got an answer
  into that same `HttpError`, and the router's one `errorElement`
  (`view/general/ErrorScreen.tsx`) turns both into a screen naming what is missing. The
  proxy entries carry `changeOrigin` explicitly, because Vite adds it only to the string
  shorthand and the host allowlist rejects a forwarded `Host` without it.
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
- **A review run reports on itself.** Stage 0 (`review/frameSources.ts` → `projectFrame.ts`) reads
  the README, the conventions file and the manifest **at the reviewed revision** through the `Git`
  port, and names the repo's own linters so the pass is told not to duplicate them — the cheapest
  quality lever there is, and it shipped in no preset for a release because it was an optional
  argument the route never passed. Read it inside the run, never accept it as an argument. What
  adjudication decides then has to survive to a person: the discards (with a structured reason),
  the hedges (`marks`), the citations, the repro test, and the anchors it could not place are
  persisted as `rounds/<id>/review.json`, served by `GET /api/review`, rendered as a collapsed
  section on the comments tab, and counted in the terminal. That log is also what a later reword
  is re-grounded against, so it is stored **repo-relative** — a PR's workspace is a cache
  directory released at shutdown, and paths relative to it are unusable by the time anything reads
  them back.

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

**For looking at the UI, use `npm run dev:mock`, not the test fake.** `scripts/mock-agent/claude`
is a second fake that **generates** instead of replaying: it parses the file paths and hunk ids
out of the NUD in the prompt it was handed and answers with topics wired to the hunks actually in
front of it. That distinction is the whole point — a recording's hunk ids belong to the repo it
was recorded against, so replaying one against any other changeset makes every topic fall back to
a whole-file ref and the screen you are inspecting is not the screen users get. It reads its caps,
its `kind` list and its topic count from the `--json-schema` it is passed, so it cannot drift out
of agreement with `understandingSchemas.ts`. The comprehension pass is deliberately arranged to
put every state of the tab on screen at once (overlapping topics so the percentages overshoot, a
topic naming no code, a whole-file ref beside id-level refs, a title and summary at their caps,
every `kind`, and hunks left over so the uncovered notice renders).

The **review** pass generates too (`scripts/mock-agent/review.js`), and it has to satisfy three
gates it cannot see, so each row is designed against a specific outcome: one board carries
findings at several severities, a pair corroborated across two lenses ranked above a lone stronger
finding, a hedged finding whose citation nobody opened, a repro test, two pre-existing problems in
their own lane, and four discards across three reasons. Two invariants there break in silence and
are stated in the module: **every live row needs its own `category`** (`mergeDuplicates` runs
before the gates, so two rows sharing one merge and a discarded body rides into a surviving card),
and the workspace dir must be **parsed out of the prompt** rather than taken from `process.cwd()`
(the two strings have to match byte for byte or nothing is grounded and every blocker is dropped).
`test/mockAgent.test.ts` drives the real pass and asserts the board, because "puts every state on
screen" is exactly the kind of claim that rots without a witness. Any remaining task falls back to
a schema-shaped lorem instance that is valid and meaningless.

It goes on PATH as `claude`, so the run manager, progress events, SSE, the zod gates and the store
all run the production path, and nothing in `src/` knows it exists. Knobs: `MOCK_AGENT_VERDICT`,
`MOCK_AGENT_DELAY_MS`, `MOCK_AGENT_FAIL`, `MOCK_AGENT_SEED`, `MOCK_AGENT_REVIEW=silent` (every
lens finds nothing, for the empty state).

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
