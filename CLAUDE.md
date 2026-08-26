# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

prreview: a CLI (`npx @jv-vogler/prreview`, command `prreview`) that serves a code review
workspace on localhost for PRs, branches, commit ranges, and working-tree changes. The
intelligence comes from the user's own `claude` CLI, driven as a short-lived child process —
never a raw API call — so the agent does its own repo grounding.

## Where a file goes

**A module lives in `application/` if and only if it takes a port. No port, no I/O → `domain/`.**
Ports declare behaviour, never data shapes: the nouns live in `domain/`, and a port method
returns one.

`domain/` is organised by the thing it describes, not by the feature that uses it. "Review" is a
context, not an entity — a folder named for it collects everything and explains nothing.

| Folder | Holds |
| --- | --- |
| `domain/changeset/` | the diff: parsing, ids, line index, blob refs, placing a range on it |
| `domain/finding/` | one finding: its id, its curation, its effective form |
| `domain/explanation/` | one explanation: its id, its effective form, its topic |
| `domain/pass/` | the stored artifact: the pass shape, the checkpoint, the reuse plan |
| `domain/run/` | one agent execution: progress, itinerary, residue |
| `domain/agentTask/` | how we ask an agent for a pass: prompt, contract, output schema, budgets |
| `domain/githubReview/` | GitHub's own vocabulary: the PR, the review, the comment as their API models them |
| `domain/errors/` | one failure: the base error and the reasons each layer may raise |
| `domain/session/` | what this machine can do: the toolchain probe's answer and the flags derived from it |
| `application/ports/` | interfaces only |
| `application/` | one use-case per file, orchestrating domain code through ports |
| `infrastructure/` | port implementations |
| `interface/` (server), `view/` + `pages/` (client) | the only ways in, and the only places errors are handled |

`domain/agentTask/` is pure and exists only because the `Engine` port does. That is a third
category, not a use-case: it constructs a request, it never issues one.

The client mirrors this. `client/src/domain/` splits by the same entities; `view/review/` splits
by feature (`findings/`, `explanations/`, `run/`). A component moves to a `shared/` folder when a
second feature actually imports it, never in anticipation — two things with the same noun in
their name are usually not the same thing.

No `types/` folder anywhere; types live with the layer that owns them.

`src/interface/http/dto/` is the only shared code between server and client: zod schemas +
`z.infer` types, importing nothing but zod (and in-folder siblings).

Enforced by `scripts/check-layering.mjs`, `scripts/check-dto-imports.mjs` and
`scripts/check-comments.mjs` in `npm run lint`.
If a rule here is not in one of those scripts, it is because it could not be mechanised — not
because it is optional.

## Copy these

Precedent beats prose. When shape is in question, follow the file, not the paragraph:

- a pure domain module: `src/domain/changeset/placeOnDiff.ts`
- a use-case that takes ports: `src/application/review/runReview.ts`
- a port implementation: `src/infrastructure/store/SessionStore.ts`
- an enforcement script: `scripts/check-dto-imports.mjs`

## How code is written

- **No comments.** Enforced by `scripts/check-comments.mjs`; only tool directives survive
  (`biome-ignore`, `@ts-expect-error`, triple-slash references). If something needs explaining,
  the answer is a better name, a smaller function, or a test whose name says it. A fact about the
  world outside this repo (a CLI's behaviour, a library's quirk) goes in `docs/`, not in a file.
- **One name per concept**, everywhere it appears — domain, wire, and UI.
- **Return early.** Guard clauses over nesting. Never nest ternaries.
- **No magic numbers**, but a literal inside an already-named constant is not one, and neither is
  an HTTP status code. Deliberately not linted: biome's `noMagicNumbers` flags about twenty of
  those for every four real ones, and a rule that cries wolf gets ignored wholesale.
- **Keep a function under 15 cognitive complexity.** Enforced by biome's
  `noExcessiveCognitiveComplexity`.
- **Tests are colocated** (`x.test.ts` beside `x.ts`) and named for the behaviour, not the
  function.

## Practices

- Commit small and green. Pre-commit formats what is staged, then runs `typecheck`, `lint` and
  the whole suite over the whole repo (~6s). CI runs the same plus coverage and e2e.
- Coverage has a floor that only moves up (`vitest.config.ts`). Lowering it is not a fix.
- Never `--no-verify`. If a hook is wrong, fix the hook.
- A change that both moves a file and edits it is unreviewable. Moves are their own commit.
- Delete on sight: dead code, stale docs, obsolete plans. There is no archive folder.

## When this file and the code disagree

Match the surrounding code, **and say so in one sentence.** Silent conformity is how every rule
above got broken the first time: a plan named a path, the code followed it, and the next session
read the code instead of this file. Flagging costs one line and is never wrong.

The same applies to a plan or task list that assigns a file to a layer. That assignment is an
architecture decision; check it against the table above before implementing it, not after.

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
