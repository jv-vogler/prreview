# prreview: architecture (v1)

PRODUCT.md defines what prreview is. This document defines how it is built. It is written so
that an implementation-planning session can plan M1 from the two documents alone, and so that a
human can review it without knowing the internals first: every section opens in plain terms
before any detail, and the glossary below defines the recurring words.

Decisions already settled with the user, not up for relitigation:

- Diff rendering uses **@pierre/diffs** behind our own wrapper, gated by a go/no-go spike
  (§17.1). If the spike fails, the fallback is **our own renderer**, not another library.
- **Layered architecture on both sides.** The client uses the four-layer frontend architecture
  (infrastructure → domain → view → pages). The server mirrors the same philosophy:
  domain → application (use-cases) → infrastructure (adapters) → interface (HTTP + CLI).
- The repo is a **single npm package** with a two-target build.
- The engine **spawns the installed `claude` CLI** headlessly. No Agent SDK in v1: the SDK
  wants an API key, while the CLI runs on the user's own subscription auth.
- All GitHub interaction goes through a **GithubService port** with swappable implementations;
  v1 ships a `gh`-backed one and a plain-git one (§4).
- The CLI surface is deliberately minimal: `npx prreview [target] [base]` plus `--port` and
  `--no-open`. The full list of forms lives in PRODUCT.md §13.

---

## Glossary

| Term | Meaning |
|---|---|
| changeset | The thing under review: a set of file changes from a PR, a branch, a commit range, or your uncommitted edits. |
| hunk | One contiguous block of changed lines inside a file's diff. |
| annotation | A note the AI attached to code. Three species per PRODUCT.md: explanation, finding, related finding. |
| anchor | The pointer tying an annotation to specific lines ("this is about lines 40 to 45 of `foo.ts`"). |
| re-anchoring | When the code changes underneath, finding where those lines moved so the note stays attached instead of pointing at the wrong code. |
| session | Everything prreview remembers about your review (annotations, curation, what you've read, chat), saved to disk so reopening resumes where you left off. |
| round | One analysis pass within a session. A re-review after the code changed starts a new round. |
| toolchain | The record of which external tools exist on this machine (claude? gh? a git remote?), checked once at boot and frozen for the session. |
| use-case | One application operation (open a review, run analysis, publish). The organizing unit of the server's application layer. |
| port / adapter | A port is an interface a use-case depends on (GithubService, Engine, SessionStore). An adapter is a concrete implementation of one (`gh`-backed GithubService). |
| IR | The intermediate representation: the changeset parsed into typed files, hunks, and lines that every other part of the system consumes. |
| NUD | Numbered unified diff, the text format we hand the agent: a normal diff with explicit line numbers printed on every line. |
| run | One queued engine task (an analysis stage, a chat turn) with a lifecycle: queued, running, succeeded or failed. |
| coverage | Which hunks you have actually viewed or marked reviewed. The guard against scroll-and-approve. |
| interdiff | The difference between two rounds: which hunks are new, which survived, which disappeared. |
| fix brief | The markdown handoff document of accepted findings, given to a separate fixer agent. |

---

## 1. System overview

In plain terms: `npx prreview` starts one local program. It figures out what you want reviewed,
shows it in a browser UI, runs the claude CLI in the background to explain and review it, and,
when you say so, publishes your curated comments to GitHub. Nothing leaves your machine except
the agent's own traffic and explicit publishes.

One Node process that:

1. Resolves a changeset from git and, for PRs, the GithubService (§4).
2. Loads or creates a session under `.prreview/`.
3. Serves a React SPA plus a JSON and SSE API on `127.0.0.1` using Hono.
4. Spawns short-lived `claude` child processes for analysis and chat, at most two at a time:
   one analysis lane, one chat lane.
5. Publishes to GitHub through the GithubService when the user asks.

```
   browser SPA  (client: pages → view → domain → infrastructure)
        ▲
        │  REST (JSON)  +  one SSE channel (/api/events)
        ▼
   interface/        http (Hono on 127.0.0.1)  +  cli (entry, args)
        ▼
   application/      use-cases: openReview, runAnalysis, publishReview, …
        │            ports: GithubService, Engine, SessionStore
        ▼
   domain/           pure rules: changeset IR, anchors, coverage, curation
        ▲
        │ implemented by
   infrastructure/   git (local repo)          github (gh CLI | plain git)
                     engine (claude children)  store (.prreview JSON files)
```

---

## 2. Code layout and package shape

In plain terms: one published npm package containing two compiled things, the server program and
the browser app. Both are organized in the same layered way: pure rules in `domain/`, operations
in `application/`, the outside world in `infrastructure/`, and the ways in (HTTP, CLI) in
`interface/`. There is no grab-bag `types/` folder; types live with the layer they belong to.

```
src/
  container.ts      # composition root: builds every service once at boot (below)
  domain/           # what things ARE and the rules about them. Pure: no I/O, no HTTP,
                    # no child processes, no React.
    changeset/      #   the IR: files, hunks, lines, stable IDs, diff parsing rules
    anchor/         #   anchors, the re-anchoring algorithm, LineIndex
    annotation/     #   the three species, curation transitions
    coverage/       #   viewed/reviewed rules, percentages, interdiff set arithmetic
    session/        #   session and round records, schema versioning rules
    grounding/      #   pure cross-check of citations against the agent's read log
  application/      # use-cases, one file per operation, orchestrating domain + ports:
                    #   openReview, resolveChangeset, runAnalysis, chatTurn,
                    #   detectDrift, incrementalReview, publishReview,
                    #   exportScratchfile, buildFixBrief, dispatchFixer
    ports/          #   GithubService, Engine, SessionStore, Git (interfaces only)
    analysis/       #   prompt assembly, NUD serialization, output schemas (zod)
  infrastructure/   # adapters implementing the ports:
    git/            #   local repo: ref resolve, diff extract, blob reads, worktrees
    github/         #   GhCliGithubService, GitRemoteGithubService (§4)
    engine/         #   ClaudeEngine (spawn + stream-json parsing), runManager (queue)
    store/          #   .prreview/ JSON layout, atomic writes, migrations
  interface/
    cli/            #   bin entry, argument parsing, startup announce
    http/           #   Hono app, middleware, routes, SSE hub, static serving
      dto/          #   THE wire contract: request/response and SSE event types
  client/           # Vite root: index.html, vite.config.ts, own tsconfig
    src/            #   main.tsx, infrastructure/, domain/, view/, pages/
e2e/                # Playwright smoke
```

### The container (composition root)

In plain terms: services are never instantiated where they are used. One file, `container.ts`,
builds everything once at boot (the git client, the chosen GithubService, the engine, the
session store, and the use-cases that receive them), and everything else imports its services
from the container. To swap an implementation or inject a fake in a test, you touch one file.

```ts
export function buildContainer(config: BootConfig, toolchain: Toolchain) {
  const git = createGitClient(config.repoRoot)

  const githubService: GithubService | null =
    toolchain.github.kind === 'gh'         ? createGhCliGithubService(config.repo)
  : toolchain.github.kind === 'git-remote' ? createGitRemoteGithubService(git)
  : null

  const engine: Engine | null =
    toolchain.agent.kind === 'claude' ? createClaudeEngine(config.workspaceDir) : null

  const store = createSessionStore(config.dataDir)

  return {
    git, githubService, engine, store,
    openReview:    makeOpenReview({git, githubService, store}),
    runAnalysis:   makeRunAnalysis({engine, store}),
    publishReview: makePublishReview({githubService, store}),
    // …one entry per use-case
  }
}
export type Container = ReturnType<typeof buildContainer>
```

It is a function rather than module-level singletons for one concrete reason: the choice of
GithubService implementation is a runtime input (the toolchain probe), so wiring cannot happen
at import time. The CLI entry calls `buildContainer` once and hands the result to the HTTP app
factory; routes read services from it instead of importing implementations. No DI framework, no
decorators, no registry: a plain object, so the full dependency graph is readable in one file.
The client mirrors the shape at its own small scale: a `container.ts` in `client/src/
infrastructure/` builds and exports the configured `apiClient` and the SSE `eventSource`.

**The wire contract.** `interface/http/dto/` is the single definition of what goes over the
wire, written as **zod schemas with their types inferred** (`z.infer`), never as hand-written
types next to schemas: two definitions drift, one inference cannot. The dto folder may import
nothing but zod (enforced), which is what makes it safe for the client's infrastructure layer
to import those schemas at runtime through a Vite alias scoped to that folder alone: the
browser bundle shares the schemas but can never pull in server behavior. This is the layering
rule from the frontend architecture applied across the process boundary.

### Errors: one taxonomy, thrown anywhere, handled only at the edges

In plain terms: any part of the program may *throw* a typed error, but only a handful of
dedicated places *catch*. There is no scattered try/catch; when something fails, it carries a
machine-readable reason that survives all the way to the surface that has to react to it, be
that an HTTP status, a CLI message, or a failed-run event.

```ts
// domain/errors/
export abstract class AppError extends Error {
  abstract readonly reason: string     // machine-readable, stable, part of the wire contract
  constructor(message: string, options?: {cause?: unknown}) { super(message, options) }
}

// derived classes, each with a closed union of reasons:
ChangesetError  reason: 'not-a-repo' | 'branch-not-found' | 'pr-not-found' | 'read-only-checkout'
GithubError     reason: 'gh-unauthenticated' | 'pending-review-exists' | 'anchor-rejected' | 'network'
EngineError     reason: 'agent-missing' | 'timed-out' | 'crashed' | 'schema-violation'
StoreError      reason: 'locked' | 'schema-newer-than-binary' | 'corrupt'
```

The rules:

- **Error classes live in `domain/errors/`** (what can go wrong is part of what the app means).
  Reasons are closed unions, so matching is `instanceof` plus a `reason` switch; matching on
  message text (`message.includes(...)`) is banned.
- **Infrastructure throws without interpreting.** A nonzero `gh` exit or a git failure is
  thrown as-is, or minimally wrapped with the original preserved as `cause`. Adapters never
  decide what a failure means for the app.
- **Application use-cases are the conversion point.** Each use-case catches only the failures
  it *expects* from its ports and rethrows the typed AppError; anything unexpected propagates
  untouched. This is the one place where low-level failure becomes app meaning.
- **Exactly four edges handle:**
  1. **HTTP**: a single `onError` middleware maps AppError → status code plus an
     `ErrorDto {reason, message}`. Anything that is not an AppError becomes a 500 with reason
     `internal`; the stack is logged server-side and never leaks into the response.
  2. **CLI boot**: one catch around startup turns an AppError into a human sentence and an
     exit code (this is where `branch-not-found` renders as "did you mean").
  3. **The run manager**: engine failures after the 202 cannot travel back on HTTP, so they
     become failed runs broadcast as `run.failed` with the reason attached.
  4. **The poller**: a failed tick logs and retries next tick; drift detection never takes the
     server down.
- **The client mirrors it**: infrastructure throws `HttpError` carrying the ErrorDto, the
  client domain converts to its own typed errors, and views map `reason` to copy through an
  exhaustive `Record`, so adding a reason fails the build until it has user-facing copy.

### Validation: zod at every boundary

In plain terms: every piece of data that crosses a boundary is checked against a schema at the
moment it crosses, and nowhere else. Inside the boundaries, code trusts its types.

The four boundaries where zod runs:

1. **HTTP requests**, at the server edge: body and query validated against the dto schema;
   failure is a 400 with reason `validation`.
2. **HTTP responses and SSE events**, at the client edge: validated with the *same* shared
   schemas, on a log-don't-block policy: server/client drift becomes a dev console error, not
   a blank screen.
3. **Engine output**: the task schemas in `application/analysis/` are zod, converted to JSON
   Schema for `--json-schema`, and the final result is re-validated with the same zod schema on
   receipt; so is the fenced `prreview-ops` block from chat turns. The retry policy on
   violation is set by spike 4.
4. **Session files on open**, after the migration chain: a file that fails its schema is
   `StoreError('corrupt')`, refused with a clear message rather than half-loaded.

**Build.** `tsdown` compiles the server: entry `src/interface/cli/index.ts` → `dist/cli.js`,
esm, platform node, dependencies external, with `clean` scoped so it does not wipe
`dist/client`. Vite builds the client into `dist/client`. Build order: tsdown, then Vite. Type
checking is `tsc -b` over two projects, one without DOM libs and one with them.

Package: `"type": "module"`, `bin: {prreview: "./dist/cli.js"}`, `files: ["dist"]`,
`engines.node >= 20.19`.

**Runtime dependencies.** hono, @hono/node-server, commander, get-port, open, zod, simple-git
(or a thin git spawn wrapper), gitdiff-parser (or `diff`'s `parsePatch`). Diff parsing is never
hand-rolled regex.

**Lint and format.** Biome for both, plus stylelint carrying exactly two rules for the
no-raw-color policy in §10.

---

## 3. CLI and boot

In plain terms: you run one command, prreview tells you what it decided to review and why, and
opens the browser. It checks once, at startup, which tools you have installed; the whole session
then behaves according to that answer without re-checking.

### Surface

The supported forms and flags are product scope and live in **PRODUCT.md §13**. Summary:
`npx prreview [target] [base]`, where target is empty (auto-detect), a PR number, a PR URL, a
branch name, a `from..to` commit range, or the keyword `working`. Flags: `--port` (default
4973, walks upward if taken) and `--no-open`. There is deliberately no `--host`: the server
binds `127.0.0.1` unconditionally, because the no-token security posture in §15 is only sound
while the bind address is not configurable. Remote access is a roadmap item that arrives
together with a token scheme.

Positional disambiguation, in order: all digits is a PR number; a GitHub PR URL is that PR; a
string containing `..` is a range; the literal `working` is the working tree; anything else is
a branch, verified with `git rev-parse --verify` and answered with a "did you mean" suggestion
on a miss.

**Auto-detect**, in order: a dirty working tree means review the working tree, whatever branch
you are on. Otherwise, if `gh` is available, the current branch's open PR. Otherwise the current
branch against its merge-base with the repo's default branch, where the default branch comes
from `origin/HEAD` (this is how main versus master resolves itself). If none of those apply, an
error listing usage examples. Git keeps no record of which branch you branched from, so a branch
cut from another feature branch cannot be detected; the explicit `[base]` argument is the
correction for that case. The announcement always states what was resolved and the explicit form
that would override it.

### Startup sequence

Parse arguments → detect the repo (`git rev-parse --show-toplevel`) → probe the toolchain (below)
→ **build the container** (§2) with the probe result → resolve the changeset (for a PR: metadata via GithubService, `git fetch origin pull/N/head`
when the head is not local) → load or create the session keyed by `ChangesetId`, registering
`.prreview/` in `.git/info/exclude` (located via `--git-common-dir`, never touching the user's
`.gitignore`) → serve on `127.0.0.1` → announce the resolved changeset, whether a session was
resumed, the toolchain result, and the URL → `open` the browser. A read-only checkout, where
`.prreview/` cannot be created, exits with a clear error in v1.

The same information is served from `GET /api/session`. The client never re-derives it.

### The toolchain record

Probed once at boot, in parallel, all local with no network: `claude --version` (2s timeout),
`gh --version` plus the exit code of `gh auth token`, and whether a git remote exists.

```ts
type Toolchain = {
  agent:  {kind:'claude', version: string} | {kind:'none'}
  github: {kind:'gh'} | {kind:'git-remote'} | {kind:'none'}   // best available backend
}
```

The result is frozen into the session and everything downstream reads it: prompt assembly, the
UI, the GithubService selection (§4). Nothing ever asks "is gh here?" mid-run; if the user
installs a tool, they restart. The client's domain layer derives `FeatureFlags` from the
toolchain (`deriveFeatureFlags` in `domain/session`), so the viewer-only rule lives in domain
code, not in components. With no agent, the AI surfaces are hidden behind a dismissible notice.
With no `gh`, publishing is disabled and PR metadata is unavailable, but viewing a PR's diff can
still work through the plain-git backend.

### Shutdown

The single SSE connection per tab is the liveness signal. `pagehide` fires
`sendBeacon('/api/goodbye')`. When the connection count reaches zero, an 8s grace timer starts,
cancelled by any reconnect; on expiry the server SIGTERMs children (SIGKILL after 5s), flushes
the store, and exits 0. Session writes are write-through with a ~500ms debounce, so crash safety
never depends on shutdown running.

### Change detection (the F11 trigger)

In plain terms: prreview notices when the code under review changes, so it can offer a
re-review.

A poller checks cheap git state every 5s: the head SHAs of the changeset's refs, and a worktree
fingerprint built as sha256 over sorted `(path, oid)` pairs from `git status --porcelain=v2` and
`git ls-files -s`. PR heads are checked every 60s. Drift emits a `changeset.drifted` SSE event,
which raises a banner. This is **polling, not filesystem watchers**: chokidar was rejected
because watcher semantics are flaky across platforms and especially under WSL2, the development
environment here, while the polled git commands finish in milliseconds.

---

## 4. GitHub access: the GithubService port

In plain terms: prreview never calls GitHub directly from scattered places. Everything GitHub
goes through one interface, and we can swap how that interface is implemented (the `gh` CLI,
plain git, or something else later) without touching the rest of the program.

```ts
interface GithubService {
  probe(): Promise<GithubBackend>            // what this implementation can do here
  getPr(number: number): Promise<PrInfo>     // title, body, base, head, url
  getPrDiff(number: number): Promise<string>
  fetchPrHead(number: number): Promise<void> // make the head commit available locally
  findPendingReview(pr: number): Promise<PendingReview | null>
  createPendingReview(pr: number, input: ReviewInput): Promise<PublishResult>
  deletePendingReview(id: string): Promise<void>
}
```

v1 ships two implementations, selected once at boot and frozen into the toolchain:

- **GhCliGithubService**: full capability, everything through `gh api` and `gh auth token`,
  which inherits the user's login including GHES hosts.
- **GitRemoteGithubService**: a read-only subset over plain git with the user's existing remote
  auth. Fetching a PR's head is just `git fetch origin pull/N/head`; the diff base falls back to
  the merge-base with the default branch, since without the API the PR's declared base is
  unknown. No metadata, no publishing.

Selection is a fallback chain: probe `gh`; if unavailable or unauthenticated, fall back to
git-remote; if there is no remote, GitHub-dependent features are off. The chosen backend is part
of the frozen toolchain, so behavior is deterministic for the whole session.

Two clarifications that shaped this design. First, **the agent never touches GitHub**: analysis
runs with Bash disallowed and gets the diff handed to it, so all GitHub calls are made by
prreview's own deterministic code, where LLM token cost is zero and only latency matters (a few
`gh` invocations per session, negligible). Second, third-party agent-ergonomic wrappers such as
axi's `gh-axi` solve a problem prreview does not have (token-efficient CLI output for agents),
while adding a supply-chain dependency on the user's GitHub credentials; they were considered
and rejected for v1. The port is what keeps such a backend possible later without committing
now.

---

## 5. Changeset representation

In plain terms: whatever you asked to review (a PR, a branch, uncommitted edits) gets parsed
into one common structure of files, hunks, and lines. Every hunk gets an ID derived from its
content, so if the same change survives into a later round, we recognize it.

Identity and snapshot are separate, because sessions are keyed by identity while re-anchoring
needs snapshots:

```ts
type ChangesetSource =
  | {kind:'pr', repo: string, number: number}
  | {kind:'branch', branch: string, base: string}
  | {kind:'range', from: string, to: string}
  | {kind:'worktree'}                          // staged + unstaged together

type ChangesetId = string   // "pr:acme/api#482" | "branch:feat-x..main" | "worktree"

interface ChangesetRef {
  source: ChangesetSource
  requestedAs?: string
  baseSha: string
  headSha: string | null      // null for worktree
  worktreeFingerprint?: string
  resolvedAt: string
}
```

```ts
interface FileDiff {
  id: string
  path: string
  oldPath?: string
  status: 'added'|'modified'|'deleted'|'renamed'|'copied'|'type-changed'
  additions: number
  deletions: number
  isBinary: boolean
  isGenerated: boolean
  language?: string
  oldBlob: BlobRef | null
  newBlob: BlobRef | null
  hunks: Hunk[]
}

interface Hunk {
  id: string
  header: string              // function context preserved verbatim
  oldStart: number; oldLines: number
  newStart: number; newLines: number
  lines: DiffLine[]
}

interface DiffLine {
  type: 'context'|'add'|'del'
  content: string             // prefix character stripped
  oldLine?: number
  newLine?: number
  noEol?: boolean
}
```

The source text is `git diff -M -C --unified=3` (or the GithubService's PR diff), parsed by
gitdiff-parser. All changeset sources go through the same parser.

### Stable IDs

The ID scheme carries more weight than anything else in the IR, because coverage tracking and
incremental re-review are both defined in terms of it.

```
fileId = "f_" + sha256(oldPath + "\0" + path).slice(0, 12)
```

A hash rather than the path, because a changeset that deletes `A` and renames `B` → `A` collides
on any natural key.

**`hunkId` is content-derived and position-independent**: sha256 over the hunk's lines joined as
`type[0] + content`, with position deliberately excluded, plus a `dupIndex` suffix when one file
contains identical hunk bodies. Two payoffs justify the unusual choice. Coverage (F7) carries
across re-review rounds, exactly and without heuristics, for every hunk whose content did not
change. And the interdiff that drives incremental re-review becomes set arithmetic over hunkIds
(§12). Positional IDs were rejected because any insertion above a hunk would invalidate
coverage; UUIDs were rejected because they carry no identity across rounds.

### BlobRefs

File content is never inlined in the IR; the IR carries references.

```ts
type BlobRef =
  | {kind:'odb', oid: string}                    // read via git cat-file
  | {kind:'worktree', path: string, oid: string} // oid from git hash-object = staleness check
  | {kind:'stored', oid: string}                 // .prreview/blobs/<oid>, content-addressed
```

Worktree changesets snapshot their new-side blobs into the store when analysis starts, rewriting
the refs to `stored`, so re-anchoring still has ground truth after the user keeps editing.
Writing into the real git object database with `hash-object -w` was rejected: it is gc-bait and
it writes into the user's `.git`.

### LineIndex

Each FileDiff gets one, built during parse: `newLines: Map<number, HunkId>` and `oldLines` the
same shape. It answers "is this line actually part of the diff?", which GitHub publishing
depends on (§13).

---

## 6. Anchors and re-anchoring

In plain terms: an anchor is how a note stays glued to the right lines. When the code changes,
we search for where those lines went, from the cheapest check to the most tolerant one, and only
give up when the code is truly gone. A note whose code disappeared is kept, just unattached.

```ts
interface Anchor {
  fileId: string
  path: string
  side: 'old' | 'new'
  startLine: number            // 0/0 means file-level
  endLine: number
  placement: 'in-diff' | 'in-file' | 'file-level'   // computed, never agent-supplied
  snapshot: {
    blobOid: string
    targetLines: string[]      // normalized
    lineHash: string
    contextBefore: string[]    // up to 3
    contextAfter: string[]     // up to 3
  }
}

type AnchorStatus = 'anchored' | 'moved' | 'fuzzy' | 'orphaned'
```

One anchor type serves three consumers:

1. **@pierre/diffs**: `{side: old → 'deletions', new → 'additions', lineNumber: endLine,
   metadata}`. Ranges render at their end line, GitHub's own convention. File-level anchors map
   to `lineNumber: 0`.
2. **GitHub**: `{path, side: LEFT|RIGHT, line: endLine, startLine?}`. Valid only if every line
   in the range appears in that side's LineIndex **and** all belong to the same hunk, since
   GitHub multi-line comments cannot span hunks. On violation: clamp to the largest sub-range
   still containing `endLine`, else fall back to `in-file`, else `file-level`.
3. **Re-anchoring**, below.

### The re-anchoring algorithm

Six steps, first hit wins:

1. **Blob-oid identity.** The file's content is unchanged, so the anchor is unchanged. The
   common case.
2. **Exact position.** Hash the same line range in the new blob; on a match, done.
3. **Diff shift.** Run Myers `diffLines` between old and new blob. A target inside an unchanged
   region translates by that region's offset. This is the 95% case for real edits.
4. **Exact-content search** for moved code. Score candidates by matching context lines, up to 3
   before and 3 after, tie-broken by predicted position. Accept when unique, or when the score
   is ≥ 4/6 with a margin of ≥ 2 over the runner-up.
5. **Fuzzy.** Search ±40 lines around the predicted position, requiring normalized Levenshtein
   ≥ 0.9 on the boundary lines, scored by context. Sets `touchedByDelta: true`, which feeds
   incremental adjudication (§12).
6. **Orphaned.** The annotation is kept, shown in a per-file unanchored tray, and publishable
   only at file level.

Rejected alternatives: git-blame tracking (dead on the working tree, falls apart across a
rebase), storing bare line numbers and re-analyzing (destroys the user's curation), word-level
anchors (fragile, and neither consumer wants them).

---

## 7. Engine layer

In plain terms: the engine is how prreview talks to the claude CLI. It runs claude as a
short-lived child process with read-only tools, in a directory that contains the code exactly as
reviewed, asks for structured answers, and checks that every claim the agent makes points at
code it actually read.

### The Engine port

```ts
interface Engine {
  probe(): Promise<AgentInfo>
  runTask(task: TaskSpec, input: TaskInput): AsyncIterable<EngineEvent>   // one-shot, schema-validated
  chatTurn(threadId: string, msg: string, frame: ContextFrame): AsyncIterable<TokenEvent>
  dispatchFixer(brief: FixBrief): AsyncIterable<EngineEvent>
}
```

Defined in `application/ports/`, implemented for claude in `infrastructure/engine/`. The port
exists so a second CLI can follow without touching anything else, which is F12's adapter
principle.

### Invocation baseline

```
claude -p --output-format stream-json --verbose --json-schema <schema>
       --allowedTools "Read,Glob,Grep" --disallowedTools "Write,Edit,Bash"
       --permission-mode dontAsk --max-turns N
       --append-system-prompt <contract>
```

The ticket-alignment task additionally allows `mcp__<ticketserver>__*`. Structured output
arrives in the final result event rather than streaming; that event also carries cost and
session id, which we record. Chat turns run **without** `--json-schema`, since a schema would
defeat token streaming; annotation operations from chat come back inside a fenced
` ```prreview-ops ` JSON block that the server strips and validates with zod. A validation
failure shows the prose plus a note that it could not be applied automatically.

### Engine workspace

Grounding is only worth anything if the agent reads the code at the reviewed revision. When the
repo's HEAD differs from the changeset head, materialize the head commit with
`git worktree add --detach` under `$XDG_CACHE_HOME/prreview/worktrees/<repoHash>/<headSha>`,
never inside the repo, and use it as the agent's cwd. The repo's own `CLAUDE.md` and `.mcp.json`
then load naturally at the reviewed ref. Worktree changesets use the real repo as cwd. Base-side
questions are answered from the diff's old side in v1; a base-side worktree is a documented
extension. None of this touches the user's tree, and the user's tree is what F11 actually makes
promises about.

### Diff serialization: NUD

The agent-facing diff format is a **numbered unified diff**: a normal unified diff with explicit
old/new line numbers printed on every line, and fileId/hunkId printed in the headers. Models
read diffs natively but are unreliable at deriving line numbers arithmetically from `@@`
headers, and an annotation anchored to the wrong line is worse than no annotation. NUD turns
anchor emission into transcription, for about 4 tokens of overhead per line. TOON was rejected
for diffs (diff content is not uniform tabular data) and stays a measured-later option for
uniform digests.

Truncation policy: generated files collapse to a one-line stat entry; per file, cap at ~400
changed lines and then say `Read <path> in the workspace`; a global soft cap of ~3000 changed
lines prioritizes non-generated, non-test files. The full file list with per-file stats is
always included, so the agent always knows what it has not been shown.

### Pipeline: staged over one resumed session

Not a single mega-pass and not independent sessions per stage.

| Stage | Session | Output |
|---|---|---|
| A | fresh | comprehension: intentMap + walkthrough + explanations + risk, one schema |
| B | `--resume` A | findings + relatedFindings |
| C | `--resume` A `--fork-session` | ticket alignment, only when a ticket was detected |
| D | `--resume` A `--fork-session` | PR description, on demand |
| Chat | `--resume` A `--fork-session` on the first turn, then plain-resumes its own thread | context-framed Q&A |
| Lens | `--resume` A | focused re-analysis → ReviewOut |
| Incremental | fresh, deliberately not resumed | §12 |

Stage A lands minutes before findings do, so the user gets something to read early, and what
they get is F4's orientation artifact. Stage B inherits A's grounding at marginal cost, and its
findings respect the intent A established. For stage C, prreview regexes candidate ticket keys
out of the branch name and PR body, and the agent fetches them through the user's own MCP
servers; any failure degrades silently, per F9. Chat turns are prefixed with a context frame
like `[viewing <path>, hunk <id>, lines a–b]`. Lens results are deduplicated against existing
findings on anchor overlap plus identical category.

Incremental analysis uses a fresh session on purpose: resuming carries stale context about code
that has since changed, and stale context is the one failure mode an incremental pass cannot
afford.

### System-prompt contract

Six clauses, appended to every analysis task:

1. **Grounding mandate.** Cite only code actually read.
2. **Precision over volume.** At most `max(3, changedLines / 100)` findings, hard cap 15. Never
   report what a linter, typechecker, or CI catches. Never report style.
3. **Species discipline.** Findings are problems introduced by *this* change. Pre-existing
   problems go to relatedFindings, never mixed in.
4. **Anchoring rules.** Anchor on the new side at the most specific lines possible; the old side
   only for pure deletions; use the printed line numbers.
5. **Confidence calibration.** Explicit definitions of high, medium, low.
6. **Dismissal memory.** Prior dismissals and their reasons are supplied; do not re-raise them.

### Output schemas

Authored in zod, converted to JSON Schema. The agent emits
`AgentAnchor {path, side, startLine, endLine}`; the server converts it into a full `Anchor` by
capturing the snapshot and computing `placement`. The CLI self-retries schema violations
(feeding each validation error back to the model until `--max-turns` runs out), so the adapter
implements no schema-retry loop of its own — it treats `is_error:true` /
`structured_output:null` as the run's failure.

```ts
ComprehensionOut = {
  intentMap: {
    summary: string
    clusters: {name, kind:'core'|'refactor'|'tests'|'config'|'docs'|'generated'|'chore',
               description, members: {path, hunkIds?}[]}[]
    suggestedEntryPoint: string
  }
  walkthrough: { steps: {title, narration, focus: {path, hunkIds}[]}[] }
  explanations: {anchor, kind:'intent'|'mechanism'|'implication', body}[]
  risk: { hunkRisks: {hunkId, score: 2|3|4|5, reason}[] }
}
```

Hunks the agent does not list keep the baseline risk score of 1. Walkthrough steps carry hunkIds
so they link into coverage: viewing a step marks its hunks viewed.

```ts
FindingOut = {
  anchor: AgentAnchor
  title: string            // ≤ 80 chars
  body: string
  category: 'correctness'|'security'|'performance'|'data'|'concurrency'
          | 'api-contract'|'error-handling'|'tests'|'other'
  confidence: 'high'|'medium'|'low'
  citations: Citation[]    // minItems 1: grounding enforced by the schema itself
  suggestedFix?: string
}
ReviewOut = { findings: FindingOut[], relatedFindings: FindingOut[] }

TicketOut = {
  ticket: {key, title, source}
  verdict: 'aligned'|'partial'|'diverged'
  requirements: {requirement, status:'done'|'partial'|'missing', evidence: string[]}[]
  scopeCreep: string[]
  summary: string
}

PrDescriptionOut = { title: string, body: string }
```

`IncrementalOut` is defined in §12.

### Grounding verification

The adapter tails the stream-json `tool_use` events and records every Read, Grep, and Glob
target. Each finding's citations are cross-checked against that record (a pure function in
`domain/grounding/`) and the finding is stamped `groundingVerified`. Findings whose citations do
not check out get a visible marker in the UI. So "grounded" is a property the program checks,
not just an instruction in a prompt.

### Run manager

Two lanes, at most two `claude` children alive:

- **Analysis lane**: FIFO, concurrency 1.
- **Chat lane**: its own FIFO over `--resume`, concurrency 1, so the user can interrogate the
  diff while an analysis runs.

Lifecycle: `queued → running → succeeded | failed | cancelled | timed-out`. Enqueue returns a
runId with 202. A duplicate task type still queued collapses onto the same runId; one already
running returns 409 with `{existingRunId}`, rendered in the UI as "cancel and re-run". Cancel is
SIGTERM then SIGKILL after 5s; annotations that already streamed and validated are kept. The
default budget is **silence, not duration**: a run is stopped after 5 minutes with nothing to
report (2 for a chat turn), and one that keeps reporting keeps running however long the change
takes. The clock is armed at spawn and rearmed by every line the child emits and every
`RunProgress` report, in both the engine and the run manager. It replaced a 10-minute wall clock,
which could not tell a wedged run from a large change being read carefully and killed both. A
crashed child produces a `failed` run with the stderr tail in
`RunDto.error`; the server always survives. A restart does not resume runs: runs are ephemeral,
session data is not.

---

## 8. Server API

In plain terms: the browser talks to the local server over ordinary JSON endpoints, and the
server pushes live updates (analysis progress, new annotations, chat replies) over one
server-sent-events stream.

Everything lives under `/api`; the DTOs are in `interface/http/dto/`.

| Method / path | Purpose |
|---|---|
| `GET /api/session` | descriptor, toolchain, coverage and curation summary, UI defaults |
| `POST /api/goodbye` | sendBeacon liveness decrement, 204 |
| `GET /api/changeset` · `POST /api/changeset/refresh` | files, hunks, risk projection; re-resolve after drift |
| `GET /api/blob?ref=&path=` | context expansion for Pierre's `loadDiffFiles` |
| `GET /api/annotations` · `PATCH /api/annotations/:id` · `POST /api/annotations/batch` | full set; curation and edits; batch ops |
| `GET /api/understanding` | topics + overview from one comprehension pass; 404 `not-produced` until it has run |
| `POST /api/analysis` · `GET /api/analysis/runs[/:id]` · `POST /api/analysis/runs/:id/cancel` | one run machine for every task type |
| `GET /api/chat/messages` · `POST /api/chat/messages` | history; post a turn → 202 `{turnId}`, reply streams over SSE |
| `PUT /api/coverage` | batched, idempotent, set-semantics |
| `POST /api/export/markdown` | `{write, path?}` → `{content, path?}` |
| `POST /api/publish/github` | synchronous, ≤ 30s |
| `POST /api/fix-brief` | `channel: 'file' \| 'dispatch'` |
| `GET /api/events` | THE single SSE channel |

Notes on the less obvious entries. `/api/analysis` is one endpoint for orient, findings,
ticket-alignment, pr-description, incremental, and lens; per-feature trigger endpoints were
rejected because each would need its own copy of the queue, cancel, and status semantics. Chat
requests carry `context {file?, hunkId?, annotationId?}`, supplied by the client, which is how
F8 stays context-aware without the server tracking the viewport. Walkthrough position is
persisted so F13 can resume it. Markdown export defaults to `.prreview/review-<slug>.md`.
Publishing returns `{reviewUrl, publishedCount, skipped: [{annotationId, reason}]}` and is not a
run, because the user is sitting in a dialog waiting for it; anchor failures skip individual
comments and never fail the publish. The clipboard fix-brief channel is client-side, from the
returned content. Error responses follow §2: one `onError` middleware, AppError → status plus
`ErrorDto {reason, message}`, and nothing else in the routes catches.

### The single SSE channel

Events: `heartbeat` every 15s, `run.*`, `annotation.upserted` / `annotation.removed`,
`curation.updated {id, curation, revision, originClientId, clientMutationId}`,
`chat.turn.started` / `.delta` / `.completed` / `.failed`, `coverage.updated`,
`changeset.drifted`. Ids are monotonic, and a 500-event ring buffer honors `Last-Event-ID`, so a
reconnect mid-analysis replays what it missed instead of refetching everything.

Per-run streams were rejected: three or four concurrent EventSources hit the browser's
six-connection HTTP/1.1 limit, and behind the Vite dev proxy that shows up as mysterious hangs.
WebSockets were rejected because there is no client-to-server push requirement, while SSE brings
reconnect and `Last-Event-ID` for free.

### Curation idempotency

`PATCH` carries a `clientMutationId`. Curation is a state set, not a toggle. The server bumps a
per-annotation `revision` and echoes both on SSE. The tab that made the change drops its own
echo; other tabs apply it when `revision` exceeds their cache. Batch operations use the same
semantics over `ids[]`, and a partial failure returns the full post-state rather than a diff.

### Blob endpoint containment

Only paths in the changeset's file allowlist (old or new side) are servable. Committed refs go
through `git show <sha>:<path>`, which makes git enforce tree membership. `WORKING` resolves the
realpath and checks the repo-root prefix after symlink resolution. `INDEX` uses
`git show :<path>`. Absolute paths, `..`, backslashes, and NUL are rejected outright. Over 2MB
returns 413; binary returns 415.

---

## 9. Client application

In plain terms: the browser app is organized so that all the rules (what can be published, what
counts as reviewed, what the feature flags are) live in plain functions with no React in them,
and the components only lay things out. Server data is the source of truth; the SSE stream keeps
it fresh.

Four layers, client-only variant of the frontend architecture: no `SerializedX` ceremony, a
suspense gate at the app shell on session plus changeset, and guaranteed hooks everywhere below
it.

**infrastructure/** `container.ts` builds and exports the configured client-side services
(§2's pattern at small scale). `httpClients/apiClient.ts` is a fetch wrapper with an `HttpError` type.
`endpoints/` holds one function per call, validating responses against the shared dto schemas
(§2) on the log-don't-block policy: drift becomes a dev console error, not a blank screen. `events/eventSource.ts` owns the EventSource lifecycle including `Last-Event-ID`, parses
`ServerEvent`, exposes `subscribe(type, handler)`, and decides nothing.

**domain/** No React, no URLs. `session` derives FeatureFlags from the toolchain. `changeset`
holds `sortFilesByAttention` (F6). `annotation` has the three-species discriminated union, pure
`applyCuration` transitions, and `checkIfPublishable`. `analysis` holds the run reducer, `chat`
holds `reduceChatDelta`. `coverage` has `applyHunkCoverage` — monotonic between the two seen states (viewed never
silently downgrades a hunk already marked reviewed), while an explicit `unseen` always wins,
because unticking the box is a statement and nothing infers coverage any more — plus the
percentage math for F7. Two flow machines
live here: walkthrough as `NotStarted | AtStep{index} | Detoured{fromStep} | Completed`, because
jumping out and coming back is a transition rather than a boolean, and publish as
`Idle → Preflight → Confirming{summary, skipped} → Publishing → Published{url} | Failed`. Errors
are typed with machine-readable reason unions that views map exhaustively.

**State ownership.** Server state is authoritative via TanStack Query, with SSE events patching
caches through `setQueryData` rather than blanket invalidation. `changeset.drifted` only raises
a banner; refetching is a user action. Curation is optimistic through the echo protocol above.
Viewed state comes from a per-file "Viewed" box, flushed by a PUT. It used to come from an
IntersectionObserver over the rendered rows, which meant scrolling past a file marked it read and
the percentage measured scroll position rather than attention; the observer is gone.
Walkthrough position is mirrored to the server. Cursor, scroll, panel sizes, and drafts stay
client-only. Diff mode and theme live in localStorage.

**view/**

- `app/`: AppShell, TopBar with the CoverageRing and the Export/Publish menu.
- `diff/`: DiffWorkspace wrapping @pierre/diffs with `loadDiffFiles` → `getBlob`; FileTreePanel
  with risk-heat dots and coverage ticks; HunkHeatGutter as a three-step background tint,
  because F6 asks for heat and not more balloons.
- `annotations/`, rendered through Pierre's `renderAnnotation` portals: **ExplanationNote**
  (muted, book octicon, no buttons; a margin note that must not read as a comment, per F3),
  **FindingCard** (accent border, confidence badge, expandable GroundingEvidence, Accept / Edit
  / Dismiss), **RelatedFindingCard** (distinct hue and a "pre-existing" tag in its own lane, per
  F3 and F5), DismissDialog with a reason, AnnotationFilterBar, CurationToolbar for batch ops.
- `orient/`: IntentMapView with cluster cards and relative-size bars, EntryPointSuggestion,
  TicketAlignmentPanel (renders nothing at all when no ticket exists), RiskOverview.
- `walkthrough/`: overlay, stepper, a "browse freely" exit, ResumeWalkthroughPill.
- `chat/`: right dock with a context chip.
- `analysis/`: status tray, AnalyzeMenu gated by FeatureFlags.
- `publish/`: PublishDialog driven by the flow machine and showing skipped anchors,
  ExportDialog, FixBriefDialog.
- `session/`: ChangesDetectedBanner offering refresh or incremental, ViewerOnlyNotice.
- `general/`: about twelve primitives. Dialog, DropdownMenu, and Tooltip sit on headless Radix,
  because focus trapping and dismissal are the highest-defect-density code in any UI, while the
  visuals stay 100% ours through tokens. The rest are plain styled elements.

**pages/** `/` is the gate, redirecting to `/understand` when a comprehension pass has run and
coverage is 0, otherwise to `/diff`. The three surfaces are **nested routes under one
`ReviewLayout`**: `/understand?topic=`, `/diff?file=&hunk=&finding=`, `/comments`. `/orient` and
`/overview` both redirect to `/understand` permanently, so a saved link still lands somewhere
true. Overview shipped as its own tab for one release and was folded back in: it and the topics
came from one comprehension pass and read as one account, so the split charged a click for half
a thought.

The layout owns everything that must survive a tab switch — the session and changeset gate,
coverage, analysis, chat, the diff cursor, the drift banner, and **the highlight worker pool**.
The pool in particular cannot live inside the diff: it is a singleton that terminates when its
last provider unmounts, so a tab switch would kill four workers and the switch back would
re-highlight everything. Hoisted, with content-derived cache keys, a remount is a cache hit.

Without an agent the two AI routes redirect to `/diff`. Hiding the tabs is not enough — a
saved link, the `/orient` redirect, or a typed URL all reach a route directly, and the page they
would land on invites the reader to start a pass no agent can run.

**Keyboard-first.** `DiffNavigationProvider` owns a `{fileIndex, hunkIndex}` cursor kept in sync
with scrolling. Keymap: `j`/`k` files, `n`/`p` hunks, `]`/`[` annotations, `a`/`e`/`x`
accept/edit/dismiss, `v`/`m` mark hunk/file reviewed, `f` toggle finding balloons, `c` chat, `s`
split/unified, `g d`/`g u`/`g c` go to diff/understanding/comments, `?` help. All suppressed
inside inputs and dialogs.

**A run is never a bare spinner.** `RunStatusBar` sits in the layout, not in a tab, and reports
the running pass wherever the reader is: what the agent is doing right now (its own tool calls,
forwarded through `RunProgress` and coalesced by the run manager into `run.progress`), elapsed —
counting towards nothing, because the run is not on a countdown — a stall warning when nothing has
moved for 90s that names the idle deadline it is heading for, a Stop button, and — the part that matters most — the failure, with a Try again.
Failures used to be reported only inside the invitation on the tab that started the pass, so a
run that died while the reader was on the diff said nothing anywhere and the screen simply
stopped changing. Alongside the channel the client re-reads `GET /api/analysis/runs` every 8s
while a run is live (`reconcileRuns`), which bounds how wrong a dropped frame can leave it, and
`interface/cli/runReporter.ts` narrates the same facts to the terminal as a second witness.

---

## 10. Styling system

In plain terms: we use GitHub's own published design tokens so the diff looks exactly like
GitHub, and we forbid raw color values everywhere else so nothing can drift off-palette.

`tokens.css` imports @primer/primitives from `dist/css`: base size and typography, functional
size, border, typography and motion, and the functional themes (light, dark, both
high-contrast, both colorblind). That includes the **diffBlob family**
(`--diffBlob-additionLine-bgColor` and friends), which is how the diff colors end up
pixel-accurate rather than approximated.

The root element carries Primer's scheme attributes (`data-color-mode="light|dark|auto"`,
`data-light-theme`, `data-dark-theme`) plus our own computed
**`data-resolved-theme="light|dark"`**, maintained live by a ThemeProvider over `matchMedia`, so
our CSS and Pierre/Shiki key off one concrete attribute instead of resolving `auto` themselves.
The toggle cycles light → dark → auto, persists in localStorage, and is applied pre-paint by an
inline script so there is no flash.

`pierre-theme.css` contains `[data-resolved-theme=…]` blocks assigning every variable we hand to
Pierre's `registerCustomCSSVariableTheme`, mapped onto Primer's `--diffBlob-*`, `--bgColor-*`,
and `--borderColor-*`, plus the dual-theme `--shiki-*` slots. Registration happens once at
startup, so a theme switch is pure CSS cascade with no re-render and no re-highlight. This file
is the only place allowed to contain concrete syntax colors, behind a stylelint disable comment.

Components use **CSS Modules**: zero dependencies, native to Vite, scoped, boring. Tailwind was
rejected because its palette utilities invite bypassing Primer tokens, the exact failure mode
the no-raw-color rule exists to prevent. vanilla-extract and styled-components were rejected as
unnecessary machinery.

**No raw colors**, enforced by stylelint: `color-no-hex`, a `function-disallowed-list` covering
`rgb`, `hsl`, `oklch`, `color-mix` and friends, and a rule that any value on a `/color$/`
property must be `var(--…)`, `transparent`, `currentColor`, or `inherit`. Icons come from
@primer/octicons-react and inherit `currentColor`.

---

## 11. Session persistence

In plain terms: your review state is saved as plain JSON files in a `.prreview/` folder at the
repo root, invisible to git. Close the browser, kill the process, come back tomorrow: the review
resumes. Deleting `.prreview/` is the reset button.

`.prreview/` is registered in `.git/info/exclude`, discoverable by the user, and deleted along
with the checkout. Engine worktrees are the one exception and live in the XDG cache, because a
nested checkout inside the repo tarpits every indexer and grep the user owns.

```
.prreview/sessions/<sessionKey>/     # slug(ChangesetId): pr-482, worktree, …
  lock                               # pid lockfile: one server per session
  session.json                       # manifest
  rounds/rN/changeset.json           # IR snapshot per round (hunks yes, blob contents no)
  rounds/rN/analysis.json            # raw stage outputs + run metadata
  annotations.json
  coverage.json
  chat/<threadId>.json
  exports/
.prreview/blobs/<oid>                # persisted worktree-side snapshots, content-addressed
```

**The IR snapshot is stored, never recomputed.** Worktree changesets are irreproducible once the
code moves on; resume renders instantly; and re-anchoring needs the previous round as its
left-hand side. Size is a non-issue, roughly the diff as JSON.

Key records:

```ts
SessionManifest = {
  schemaVersion: number
  changesetId: ChangesetId
  source: ChangesetSource
  toolchain: Toolchain
  rounds: {id, ref: ChangesetRef, runs: RunMeta[]}[]
  currentRound: string
  engine: {adapter, analysisSessionId?, chatThreads: {id, engineSessionId}[]}
  ticket?: {key, source}
}

RunMeta = {stage, engineSessionId, model, startedAt, endedAt, costUsd?, numTurns?, status}

StoredAnnotation = {
  id: string                 // ulid
  species: 'explanation'|'finding'|'related-finding'
  anchor: Anchor
  anchorStatus: AnchorStatus
  touchedByDelta?: boolean
  title?: string
  body: string
  originalBody?: string      // the AI's original, kept when the user edits
  category?: string
  confidence?: 'high'|'medium'|'low'
  citations?: Citation[]
  groundingVerified?: boolean
  suggestedFix?: string
  curation: {state: 'proposed'|'accepted'|'edited'|'dismissed', dismissReason?, updatedAt}
  resolution?: {addressedInRound: string, evidence: string}
  provenance: {roundId, stage, engineSessionId}
  publish?: {githubThreadId?, publishedAt?, downgradedToFileLevel?}
}
```

`resolution` is deliberately orthogonal to `curation`, because accepted-and-addressed is a real
state and collapsing it into the curation enum would lose information.

Storage format is plain JSON written atomically via temp file plus rename, debounced. **SQLite
was rejected**: a native dependency in an `npx` tool is a support burden, and a user who wants
to know what prreview stored about their code can grep the files. A single integer
`schemaVersion` drives a migration chain on open; a file newer than the binary refuses to load
with "open this with a newer prreview". Additive optional fields never bump the version.

---

## 12. Incremental re-review

In plain terms: when the code changes mid-review, prreview compares the new state of the change
against the old one, keeps every note that still applies, flags the ones the edit touched, and
asks the agent to judge, with evidence, whether each open finding was actually fixed. Your
reading progress carries over for everything that did not change.

Detection is the poller from §3. The delta itself is **content-based, with commits as garnish**.
Commit-based deltas were rejected for three reasons: the working tree has no commits at all;
force-push and rebase, near-universal on AI-authored branches, sever the commit graph; and a
clean fast-forward produces exactly the same delta anyway. The commit list is used purely as
presentation.

Each new round produces two artifacts.

**1. An interdiff at hunk granularity, by set arithmetic over hunkIds.** Per file: unchanged is
`old ∩ new`, new-or-modified is `new − old`, removed is `old − new`. That drives coverage
carry-over and annotation triage. No textual interdiffs, which confuse humans and models alike.

**2. A head-to-head delta for the agent**: `git diff -M oldHead newHead`, or for worktree
changesets, the stored old blobs against current disk. When only the base moved and the head is
identical, which is what a rebase looks like, the delta is empty and the round is a pure
re-anchor with no engine call at all.

**Annotation triage.** Map files old → new including rename detection, run the §6 re-anchoring,
then bucket:

| Bucket | Action |
|---|---|
| anchored or moved, target untouched | carry silently |
| fuzzy, or target inside the delta | mark `touchedByDelta`, becomes an adjudication candidate |
| orphaned, or target deleted | adjudication candidate; a deletion is often the fix |
| orphaned explanation | retire automatically: cheap to regenerate |

**Findings are never auto-marked addressed.** The agent adjudicates and must supply evidence.

**Coverage.** Surviving hunkIds keep their viewed state, new hunks start unviewed, and the total
honestly drops.

The incremental task, in a fresh session, receives: the prior intent summary plus cluster names
(~200 tokens), the NUD delta, the adjudication candidates in full, a one-line digest of every
still-open finding so it does not re-raise them, and the dismissal reasons.

```ts
IncrementalOut = {
  addressed: {findingId, evidence}[]
  stillOpen: string[]
  findings: FindingOut[]
  explanations: ExplanationOut[]
  intentShift?: string
}
```

`addressed` stamps `resolution` while preserving curation, new findings enter as proposed, and
`currentRound` advances.

---

## 13. GitHub publishing

In plain terms: your accepted, human-edited comments become a draft ("pending") review on the
PR, visible only to you, which you then finalize and submit on GitHub itself. prreview checks
every comment's line position before sending, because GitHub rejects the whole batch on a single
bad one without saying which.

All calls go through the GithubService (§4); the constraints below were verified against the
live GraphQL schema, not inferred.

**The happy path is one mutation.** `addPullRequestReview(pullRequestId, commitOID, threads:
[{path, line, side, startLine?, startSide?, body}])` with every thread batched into that single
call and no `event` field, which leaves the review **PENDING**: visible only to the token's
user and submittable from GitHub's own UI. GitHub's own MCP server uses this same flow, which
settles PRODUCT.md §12's feasibility question. `addPullRequestReviewThread` for incremental
top-ups has a known silent-null bug, so it is used only as a top-up path and always followed by
a re-read to confirm. REST `POST /pulls/{n}/reviews` is the fallback and cannot create
file-level comments in a draft. `position` is deprecated; we send line and side only.

**Pre-validation is ours to do.** An anchor outside the diff hunks returns 422 for the *whole*
mutation without naming the offender. So every `(path, side, line)` is validated against the
LineIndex first, and violations are downgraded per §6: to `in-file` or file-level via a GraphQL
top-up with `subjectType: FILE` and a body prefixed "Line N (outside diff):", or excluded and
left for export, at the user's choice. prreview never submits a verdict.

**One pending review per user per PR.** Detect an existing one with GraphQL
`reviews(first: 1, author: <viewer>)` filtered to state PENDING, then offer delete-or-abort,
warning that deleting also loses any edits the user made on GitHub itself.

**Auth** is `gh auth token` and `gh api` passthrough, which handles GHES hosts for free; arrays
go in via `--input -`. A classic token needs `repo`; a fine-grained token needs Pull requests:
write. `gh auth status` is parsed defensively, since `GH_TOKEN` in the environment can shadow
the logged-in account. `subjectType` is feature-detected before use on GHES.

The **curated** body is what publishes. The raw AI text never is.

---

## 14. Export and fix brief

In plain terms: two outputs. A markdown file of your review for your own records, and a fix
brief: a structured to-do document of accepted findings that you hand to a separate fixer agent,
which is the one and only path by which anything edits your code.

**Markdown scratchfile.** Compatible with the `local-pr-review` template: foldable by file, an
Overview, per-file findings, and a Related findings section. Written to
`.prreview/review-<slug>.md`, or returned for the user to copy.

**Fix brief.** Canonical **markdown with a stable heading grammar**, because the consumer is an
agent prompt and the human prunes it before dispatch, editor-in-chief style. An HTML comment
header carries the machine identity: `prreview-fix-brief v1 | session | round | base | head`.
Each issue carries its embedded finding id, file and line numbers on the new side, category and
confidence, the **verbatim quoted target lines** (robust to drift, since the fixer locates by
content rather than by number), the curated body, the evidence citations, the suggested fix, and
verification steps. A preamble instructs: fix only these, no drive-bys, verify against the
evidence. Related findings are excluded by default and opt-in. A JSON projection of
`StoredAnnotation[]` is available for programmatic consumers. The embedded ids close the loop:
incremental `addressed` verdicts correlate back exactly.

**Dispatch channels.** A file under `exports/`; the clipboard, client-side through the browser
API; or a direct spawn through `Engine.dispatchFixer`, which runs
`claude -p <brief> --permission-mode acceptEdits` with cwd set to the user's **real** worktree,
streaming progress into a fixer console. The fixer edits files by design. It is the explicit,
user-initiated carve-out from F11's never-edit rule.

---

## 15. Security

In plain terms: the server only listens on your own machine, refuses requests that pretend to
come from elsewhere, and can only read files that are actually part of the changeset.

The bind address is hardcoded to `127.0.0.1`. The middleware stack, in order:

1. **hostAllowlist**, on every request and first in line, as DNS-rebinding defense. Allow
   exactly `localhost`, `127.0.0.1`, and `[::1]` with or without the bound port, plus the Vite
   port under `--dev`. Everything else gets 403.
2. **securityHeaders**: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
   COOP and CORP same-origin, `no-store` on `/api`, and an SPA CSP of
   `default-src 'self'; style-src 'self' 'unsafe-inline'` (Shiki needs inline styles);
   `worker-src 'self' blob:` (Pierre's workers); `frame-ancestors 'none'`.
3. **cors** with the origin regex `^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$`, which
   exists for cross-port development and is inert in production.
4. **originCheck** on state-changing requests and on `/api/events`: accept `Sec-Fetch-Site` of
   `same-origin` or `none`; otherwise fall back to the Origin regex; if neither header is
   present at all, as with a local curl, allow it.
5. **bodyLimit** of 1MB.
6. Blob and export path containment per §8.

There is no auth token in v1. That is sound only because the server is loopback-only, which is
why there is no `--host` flag. For context: this is the class of issue behind Vite's
CVE-2025-24010, and difit ships none of these protections today.

---

## 16. Testing and development workflow

In plain terms: the expensive external things (the claude CLI, the gh CLI) are replaced in tests
by fake executables that emit canned output, so the whole system is testable in CI without
either tool installed.

**Dev loop.** `concurrently` runs two things: `tsx watch` on the CLI with an internal `--dev`
flag (skips static serving and browser-open, pins the port; not part of the public surface), and
Vite on 5173 proxying `/api`.

**Tests.**

- **domain (server)**: colocated pure-function tests; this layer is the cheapest to test and
  holds the rules, so it gets tested hardest. Same policy as the client domain.
- **infrastructure/git + changeset resolution**: vitest with a `createFixtureRepo()` helper
  building temp-directory git fixtures. The matrix covers all changeset sources, worktree
  states, renames, and binary files.
- **interface/http**: Hono's `app.request()` in-process against a container built with fake
  adapters (the container is the injection seam, no module mocking), including a dedicated
  hostile-request file: bad Host headers, cross-origin POSTs, path traversal.
- **engine + github adapters**: **fake `claude` and `gh` executables placed on PATH**, emitting
  canned output (stream-json for claude) with controllable delay and exit code. That is what
  makes queueing, coalescing, cancel, timeout, crash handling, and the GithubService fallback
  chain testable in CI without the real CLIs.
- **client view**: testing-library over FindingCard states, the keymap, and PublishDialog.
- **e2e**: exactly one Playwright smoke test: build, run `prreview working` against a fixture
  repo with the fake claude on PATH, confirm the diff renders, an annotation arrives over SSE,
  accept it, and the export file is written.

---

## 17. Spikes

Each runs before or at the start of the milestone that depends on it.

1. **Pierre go/no-go (M1).** Render a real 5,000-line multi-file diff with 30 annotations
   across the three species as variable-height portal cards. Verify **programmatic
   scroll-to-file and scroll-to-hunk**, the actual go/no-go item, since keyboard navigation, the
   walkthrough, and annotation jumps all depend on it. Verify the split/unified toggle. Pin down
   the `loadDiffFiles` request shape, which finalizes the blob DTO. Check whether
   `registerCustomCSSVariableTheme` cascades or snapshots when the theme flips live. Check the
   worker pool under our CSP. On failure, build our own renderer: difit's table model, Shiki
   whole-file tokenization in a worker, TanStack Virtual over a flattened row array.
2. **SSE through the Vite dev proxy** (30 minutes, before the events layer).
3. **Fake-claude harness viability**: replay `claude -p --output-format stream-json` from a
   script faithfully enough to test against.
4. **`claude --resume` concurrent forks** (stage B alongside C and D). If it races, serialize C
   and D after B, a graceful degradation. Also: `--json-schema` size limits and what happens on
   a schema violation, which sets the retry policy.
5. **Engine worktree fidelity**: confirm `CLAUDE.md`, `.mcp.json`, and MCP servers all load from
   a detached worktree.
6. **stream-json tool_use fidelity**: confirm Read and Grep file paths appear in the event
   stream, since grounding verification depends on it.
7. **`subjectType: FILE`** accepted in the top-up path against an existing pending review, the
   downgrade path in §13.
8. **`gh auth token` offline behavior** and unauthenticated detection.
9. **Token measurement**: NUD versus raw diff, and TOON for uniform digests, on three real PRs.
   NUD ships either way; this sizes the overhead.

---

## 18. Milestone mapping

Against PRODUCT.md §10. §4's read side (PR resolution) lands in M1; its publish side lands in
M4 with §13.

| Milestone | Sections | Spikes |
|---|---|---|
| M1 "See" | §2, §3, §4 (read side), §5, §8 (viewer subset), §9 (diff, tree, coverage view), §10, §11, §15, §16 | 1, 2 |
| M2 "Understand" | §6, §7 (stage A, chat) + intent map, walkthrough, chat UI | 3, 4, 5, 6 |
| M3 "Review" | §7 (stage B, lens) + findings, related lane, risk, curation UI, markdown export | none |
| M4 "Ship" | §4 (publish side), §12, §13, §14 + ticket (stage C), PR description (stage D), fix dispatch | 7, 8 |

---

## Appendix: answers to PRODUCT.md §12

- **Agent-facing IR.** NUD (numbered unified diff) for diffs, JSON Schema for structured
  output. TOON rejected for diff content; still a candidate for uniform digests, pending
  spike 9.
- **UI stack, server model, agent orchestration.** React with Vite and @pierre/diffs in a
  four-layer client; Hono on loopback with one SSE channel; a staged pipeline of `claude` CLI
  child processes over one resumed session, managed by a two-lane run manager.
- **Pending-review feasibility.** Confirmed, including live schema introspection. Pending
  reviews created through the user's own `gh` token are visible and submittable only by that
  user, which is what PRODUCT.md assumed. Constraints and mitigations are in §13.
- **Incremental re-review.** Content-based, via hunkId set arithmetic. Commits are presentation
  only.
- **Roadmap.** Unchanged: other agent adapters (the §7 port exists for them), other GithubService
  backends (the §4 port exists for them), GitLab and Bitbucket, `review-rules.md`, learning from
  dismissal reasons, a multi-PR inbox, editor deep links, stacked PRs. Remote access joins the
  list, bundled with a token scheme (§3, §15).
