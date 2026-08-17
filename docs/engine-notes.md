# Engine notes

In plain terms: this file records what we observed when driving the real `claude` CLI, so the
engine adapter's mechanical choices trace back to experiments instead of guesses. The spike
verdicts under `spikes/*/VERDICT.md` are the primary record; this file adds the answers measured
after the spikes closed.

## How the prompt is delivered

The measurement ran on 2026-08-17 against `claude` 2.1.233 (Claude Code) with `--model haiku`,
in a scratch git repo outside this repository, from `scripts/capture-claude-fixtures.mjs`
(re-runnable with `PRREVIEW_REAL_CLAUDE=1`). Two probes, both
`claude -p --output-format stream-json --verbose --model haiku --max-turns 2` with the prompt
piped to stdin and **no positional prompt argument**:

| probe | prompt bytes | exit | result event |
|---|---|---|---|
| (a) tiny prompt on stdin | 31 | 0 | `is_error:false`, `num_turns:1`, answered correctly |
| (b) ~200KB filler + one question on stdin | 200,082 | 0 | `is_error:false`, `num_turns:1`, valid result event |

**The answer: stdin is the delivery path.** `claude -p` reads the whole prompt from stdin when
no positional prompt is given, well past any argv limit (200KB accepted; the OS argv ceiling is
~128KB per argument, so stdin is also the only path that scales). Probe (b) ran twice: the
first run answered the embedded question verbatim; the second run's model commented on the
filler-then-instruction pattern looking like prompt injection — but mechanically both runs
accepted the 200KB prompt, exited 0, and produced a normal result event, which is the question
this probe answers. Real task prompts are coherent documents, not adversarial-looking filler.

**Fallback, documented but not needed:** if stdin delivery were ever rejected, write the
prompt to `<runTempDir>/prompt.md` **outside the repo** and pass a short positional prompt
instructing the agent to `Read` that absolute path (the file then legitimately appears in the
read log). The adapter implements the stdin path and keeps this fallback behind a single constant
in `src/infrastructure/engine/promptDelivery.ts`.

Corollaries baked into the adapter: the prompt is never an argv member (SEC-002 — nothing
user-sized or user-authored is interpolated into argv), and `--json-schema` stays the only
large argv value, capped at 85KB by a build-time assertion (CON-005).

## What JSON Schema dialect `--json-schema` accepts (CON-014)

In plain terms: the CLI checks the schema you hand it before it does anything, and it only
understands the older dialect. Give it the newer one and the run dies at startup.

The CLI validates `--json-schema` with **Ajv 8 in draft-07 mode**. Ajv 8 has no draft-2020-12
meta-schema registered, so a schema carrying
`"$schema": "https://json-schema.org/draft/2020-12/schema"` makes `validateSchema` *throw*, and
the CLI refuses the run with

```
--json-schema is not a valid JSON Schema: no schema with key or ref "https://json-schema.org/draft/2020-12/schema"
```

Reproduced directly against `ajv@8.20.0`, the version pinned as a devDependency here for exactly
this reason:

| schema handed to Ajv 8 | `validateSchema` |
|---|---|
| `target: "draft-2020-12"` (what prreview used to emit) | **throws**, unresolvable `$schema` ref |
| `target: "draft-7"`, `$schema` kept | `true` |
| `target: "draft-7"`, `$schema` stripped | `true` |

**What prreview does:** `toJsonSchema` converts at `target: "draft-7"` and strips `$schema`
entirely, so no meta-schema ever has to resolve.

**Why it went unnoticed, and what now prevents a repeat.** Every analysis run failed at spawn
while the whole suite stayed green, because all three places that could have caught it were
looking away: the fixture capture script hand-embedded its own schema (no `$schema` key, so the
recording proved the CLI accepted a value prreview never sent), `test/bin/claude` treated
`--json-schema` as an opaque string it never validated, and the unit test asserted the buggy
`$schema` value as if it were the contract. All three are closed:

- `src/application/analysis/taskSchemas.ts` registers every task schema, and
  `toJsonSchema.test.ts` puts each one through a real Ajv 8 `validateSchema`;
- `test/bin/claude` validates `--json-schema` the same way and fails the run at argv time, so the
  failure is now a red unit test rather than a broken product;
- `test/taskSchemaGate.test.ts` runs a real task spec end to end through the engine and the fake,
  which is the arrangement nothing tested before;
- `scripts/capture-claude-fixtures.mjs` obtains schemas from `scripts/dump-task-schemas.ts`, i.e.
  through the production `toJsonSchema`, so a recording can only be made against the real value.

The fake's exact stderr wording is modeled on the observed production failure rather than a
byte-faithful capture; the behavior tests depend on is *reject before running*, and the prose is
re-checked by the opt-in `test/realClaude.test.ts`.
