# Spike 4 verdict: `--resume` concurrent forks — **GO-WITH-CONSTRAINTS**

Date: 2026-08-16 · CLI: `claude` 2.1.233 · Model: `--model haiku`
(`claude-haiku-4-5-20251001`) · All runs in a scratch dir; results read from captured JSON
files and raw exit codes.

## Concurrent forks

Setup: parent session created with `claude -p "note that my favorite fruit is kumquat" 
--output-format json` → session id captured from the result envelope. (Aside: haiku refused a
"remember the codeword" framing as prompt-injection-looking; a benign fact worked. Keep engine
memory probes benign.)

Then two `claude -p --resume <sid>` processes launched **simultaneously** with different
prompts, three rounds:

| round | fork A (asks fruit) | fork B (asks fruit, uppercase) | exits |
|---|---|---|---|
| 1 | `kumquat` | `KUMQUAT` | 0 / 0 |
| 2 | `kumquat` | `KUMQUAT` | 0 / 0 |
| 3 | `kumquat` | `KUMQUAT` | 0 / 0 |

6/6 concurrent resumes succeeded with full parent context, no errors, no torn writes: the
parent's session jsonl stayed valid line-by-line JSON throughout.

**The constraint**: plain `--resume` keeps the parent `session_id` and **appends both forks'
turns into the parent's session file, interleaved** (observed `user,user,assistant,assistant`
interleavings in the history file). Not corruption, but history pollution — a later resume of
that session sees a merged, ambiguous transcript.

**The fix is `--fork-session`**: two concurrent `--resume <sid> --fork-session` runs each got
a **new session id**, both answered with correct parent context, and the parent session file
did not grow by a single line (49 → 49). A subsequent plain resume of the parent still
answered correctly. This is exactly the fork primitive §7's stage C/D table assumes.

**Architectural consequence: forks OK → B∥C∥D allowed**, with the constraint that stage C, D
(and any other concurrent resume, e.g. the chat lane while an analysis resume runs) MUST pass
`--fork-session`. Only a fork whose output should extend the shared session (stage B feeding
chat) may plain-resume, and never concurrently with another plain resume of the same session.

## Structured-output flags

- The flag is **`--json-schema <schema>`, exactly as the architecture says** — it survives in
  2.1.233, takes an **inline JSON string only**. A file path is rejected:
  `Error: --json-schema is not valid JSON`. No `@file` form found.
- **Size**: 6.7 KB and **85 KB inline schemas both worked** (structured_output returned
  correctly). A 171 KB schema never reached the CLI: Linux kills it at exec with
  `Argument list too long` (per-arg limit MAX_ARG_STRLEN ≈ 128 KB). So the practical ceiling
  is the OS argv limit, ~128 KB per argument; §7's schemas are a few KB — ample headroom.
- **Violation behavior** (impossible schema `{n: integer, minimum:5, maximum:3}`, captured in
  `violation.jsonl`): **the CLI retries by itself.** Each `StructuredOutput` attempt gets the
  validation error fed back as an `is_error` tool_result
  (`"Output does not match required schema: /n: must be <= 3"`), and the model tries again.
  Under `--max-turns 3` it stopped after 2 attempts with a clean typed failure:
  `result` event `subtype:'error_max_turns'`, `is_error:true`, `terminal_reason:'max_turns'`,
  `structured_output:null`, `result:null`, **exit code 1**. Non-conforming output is never
  returned.

**Retry policy this sets**: the engine does not need its own schema-retry loop — pass
`--max-turns` with headroom (task turns + 2–3 validation retries), treat
`is_error:true` / `structured_output:null` as the run's failure, and surface `terminal_reason`.
One engine-level re-run at most; in-schema retries are the CLI's job.

- `--max-turns` is **absent from `--help` but real and enforced** (a Read task under
  `--max-turns 1` was cut off with `error_max_turns`).

## Caveats

- Concurrency was 2 processes × 3 rounds plus 1 `--fork-session` round on one machine; not a
  stress test. The run manager's "at most two claude children" keeps us inside what was tested.
- Session files live under `~/.claude/projects/<cwd-slug>/` keyed by the invocation cwd —
  resumes must run from the same cwd (all spike runs did; not tested across cwds).

Verdict: GO-WITH-CONSTRAINTS — forks OK → B∥C∥D allowed, provided every concurrent resume uses `--fork-session`; without it, plain concurrent resumes still succeed (3/3) but interleave into the parent history, so if `--fork-session` were ever unavailable, serialize C and D after B.
