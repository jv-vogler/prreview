# Spike 3 verdict: fake-claude harness — **GO**

Date: 2026-08-16 · CLI: `claude` 2.1.233 (Claude Code) · Model for all captures:
`--model haiku` → `claude-haiku-4-5-20251001`. All runs in a scratch dir outside the repo,
observations taken from captured files and raw exit codes, never from terminal output.

## What was tested

Captured the full `claude -p --output-format stream-json --verbose` event stream for three
tiny prompts (plain reply, `--json-schema` structured output, one Read tool call) plus one
error case (nonexistent model), then built `fake-claude` (a node script replaying a fixture
line-by-line and exiting with a recorded code) and ran the same consumer (`consumer.mjs`,
which extracts exactly the fields the engine adapter will rely on) against both a **live**
real-CLI run and the fake replaying the earlier capture of the same command.

**Result: the digests are byte-identical** (`digest-real.json` == `digest-fake.json`) across
event-type sequence, session-id consistency, init presence, assistant message structure,
tool_use names and input keys, tool_result count, result envelope shape, and exit code. The
fake also reproduces the CLI's flag contract error (`stream-json` without `--verbose` →
stderr `Error: When using --print, --output-format=stream-json requires --verbose`, exit 1).

## Flag realities (v2.1.233)

- `-p --output-format stream-json` **requires `--verbose`** or it exits 1 without emitting
  anything. The invocation baseline in ARCHITECTURE §7 must add `--verbose`.
- `--output-format json` + `--verbose` changes the output from a single result object to a
  **JSON array of all messages** — the adapter must not combine them, or must parse the array.
- `--json-schema` exists as documented; structured output arrives twice: as a synthetic
  `StructuredOutput` tool_use turn and as `structured_output` (parsed object) on the result
  event, with `result` holding the same JSON as a string.
- `--max-turns N` exists and is enforced, but is **absent from `--help`** (hidden flag).
- `--model haiku` resolves the alias; `modelUsage` in the result names the resolved model.

## Complete event-type inventory observed

One JSON object per line on stdout. Outer `type` (and `subtype`) values seen:

| type | subtypes seen | notes |
|---|---|---|
| `system` | `hook_started`, `hook_response`, `status`, `init`, `thinking_tokens` | hook_* and status come from the *user's* installed hooks/config — environment noise the adapter must skip by subtype whitelist, not crash on |
| `assistant` | — | envelope below; content blocks seen: `thinking`, `text`, `tool_use` |
| `user` | — | carries `tool_result` blocks (tool results ARE in the stream) |
| `rate_limit_event` | — | `{type, rate_limit_info, uuid, session_id}` |
| `result` | `success`, `error_max_turns` | terminal, exactly one, last line |

`system:init` carries `cwd`, `session_id`, `tools[]`, `mcp_servers[{name,status}]`, `model`,
`permissionMode`, `claude_code_version`, plus environment-dependent `skills`/`plugins` lists.

## Exact envelope shapes

Assistant event (outer): `{type:'assistant', message, parent_tool_use_id, session_id, uuid,
timestamp, request_id}`; `message` is an API-shaped message: `{model, id, type:'message',
role:'assistant', content:[...], stop_reason, stop_sequence, stop_details, usage,
diagnostics, context_management}`.

Result event (success): `{type:'result', subtype:'success', is_error:false, session_id,
num_turns, total_cost_usd, usage, modelUsage, permission_denials, terminal_reason:'completed',
result:string, structured_output?:object, duration_ms, duration_api_ms, ttft_ms, uuid, ...}`.

Error case (`fixtures/f4-badmodel.jsonl`, exit 1): the stream still ends with a result event,
but note the trap — **`subtype` stays `'success'` while `is_error:true`**, with
`terminal_reason:'api_error'` and `api_error_status:404`. The adapter must key on `is_error`
(and `terminal_reason`), never on `subtype` alone. `error_max_turns` does appear as a subtype
when the turn cap fires (see spike 4).

Every event carries `session_id`, identical across the whole stream.

## The fake

- `fake-claude` — executable; picks its fixture from `$FAKE_CLAUDE_FIXTURE`; replays each
  jsonl line verbatim; a trailing `#exit N` control line sets the exit code; reproduces the
  `--verbose` requirement and `--version`.
- `fixtures/` — real captures: `f1-simple` (text only), `f2-schema` (StructuredOutput
  round-trip), `f3-tooluse` (Read + tool_result), `f4-badmodel` (is_error result, exit 1).
- `consumer.mjs` — the differential test; run
  `node consumer.mjs claude -p ... ` vs `FAKE_CLAUDE_FIXTURE=... node consumer.mjs ./fake-claude -p ...`.

## Caveats

- Fixtures embed this machine's paths, hook names, and skill/plugin lists inside
  `system:init`/`hook_*` events — deliberately kept, since the adapter must tolerate exactly
  this noise; regenerate fixtures if that ever bothers anyone.
- Timing behavior (inter-event delays, partial flushes) is not replayed; the fake writes the
  whole stream immediately. If the adapter ever depends on backpressure/timing, add delays.
- `--include-partial-messages` (token-level chunks, relevant to chat streaming) exists but was
  not captured here; the chat-lane fixture should be captured when chat is built.

Verdict: GO
