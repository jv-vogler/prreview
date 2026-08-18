# Captured `claude` stream-json fixtures

In plain terms: these files are real recordings of what the `claude` CLI printed, replayed
byte-for-byte by `test/bin/claude` so the engine tests never spawn the real CLI (REQ-009).

Every fixture is one capture of `claude -p --output-format stream-json --verbose` stdout, one
JSON event per line, optionally ending in a `#exit N` control line that records the CLI's exit
code (absent means exit 0). `test/fakeClaude.test.ts` pins each fixture's normalized digest;
regenerate digests with `UPDATE_GOLDEN=1 npx vitest run test/fakeClaude.test.ts`.

**Fixtures embed this machine's hook names, absolute paths, and skill/plugin lists on
purpose** (spike 3's caveat): the user's own hooks and config inject `system:hook_started` /
`hook_response` / `status` / `thinking_tokens` events and `rate_limit_event`s into the stream,
and the adapter must tolerate exactly this noise. Do not scrub them; recapture with
`node scripts/capture-claude-fixtures.mjs` (requires `PRREVIEW_REAL_CLAUDE=1`) if they ever
bother anyone.

## Promoted from spike 3 (`spikes/fake-claude/fixtures/`)

Captured 2026-08-16 against `claude` 2.1.233 (Claude Code), all in a scratch dir outside the
repo. Argv reconstructed from the spike record (`spikes/fake-claude/VERDICT.md`) plus each
fixture's own `system:init` event (model, permissionMode, tool list).

### simple.jsonl (spike `f1-simple.jsonl`)

Plain text reply, no tools, exit 0.
`claude -p 'Reply with exactly the word "ok"' --output-format stream-json --verbose --model haiku`

### schema.jsonl (spike `f2-schema.jsonl`)

`--json-schema` structured-output round-trip: the synthetic `StructuredOutput` tool_use turn
plus `structured_output` on the result event, exit 0.
`claude -p <status prompt> --output-format stream-json --verbose --model haiku --json-schema <inline JSON>`

### tooluse.jsonl (spike `f3-tooluse.jsonl`)

One `Read` call (`input.file_path` absolute) and its `tool_result`, exit 0. The init event
shows the read-only tool baseline (`Read`, `Grep`, `Glob` present; `Bash`/`Write`/`Edit`
absent) and `permissionMode: dontAsk`.
`claude -p 'read notes.txt and reply with just the magic number' --output-format stream-json --verbose --model haiku --allowedTools "Read,Grep,Glob" --disallowedTools "Write,Edit,Bash" --permission-mode dontAsk`

### badmodel.jsonl (spike `f4-badmodel.jsonl`)

The CON-003 trap: nonexistent model → result event with **`subtype:"success"` but
`is_error:true`**, `terminal_reason:"api_error"`, exit 1 (`#exit 1`).
`claude -p 'Reply with exactly the word "ok"' --output-format stream-json --verbose --model no-such-model-xyz`

## Capture log (appended by `scripts/capture-claude-fixtures.mjs`)

### understanding.jsonl

Captured 2026-08-17 against 2.1.233 (Claude Code). stage A shape: a real --json-schema run against the ComprehensionOut schema (hand-embedded in scripts/capture-claude-fixtures.mjs from ARCHITECTURE §7; Phase 3's zod schema must stay compatible), with Read/Grep/Glob tool use, exit 0.
Prompt delivered on stdin (1246 bytes, TASK-005's primary path).
`claude -p --output-format stream-json --verbose --model haiku --allowedTools Read,Glob,Grep --disallowedTools Write,Edit,Bash --permission-mode dontAsk --max-turns 16 --json-schema <inline ComprehensionOut JSON Schema>`

### chat-stream.jsonl

Captured 2026-08-17 against 2.1.233 (Claude Code). a chat-lane turn with --include-partial-messages (the shape spike 3 flagged as uncaptured): token-level stream_event deltas, no --json-schema, exit 0.
Prompt delivered on stdin (103 bytes, TASK-005's primary path).
`claude -p --output-format stream-json --verbose --include-partial-messages --model haiku --allowedTools Read,Glob,Grep --disallowedTools Write,Edit,Bash --permission-mode dontAsk --max-turns 4`

### hooknoise.jsonl

Captured 2026-08-17 against 2.1.233 (Claude Code). a tiny run under this machine's own hooks and config, capturing the system:hook_started/hook_response/status/thinking_tokens and rate_limit_event noise the parser must skip (CON-002), exit 0.
Prompt delivered on stdin (31 bytes, TASK-005's primary path).
`claude -p --output-format stream-json --verbose --model haiku --max-turns 2`

### maxturns.jsonl

Captured 2026-08-17 against 2.1.233 (Claude Code). --max-turns 1 on a schema task that needs more turns: result subtype:error_max_turns, is_error:true, structured_output:null, exit 1.
Prompt delivered on stdin (115 bytes, TASK-005's primary path).
`claude -p --output-format stream-json --verbose --model haiku --allowedTools Read,Glob,Grep --disallowedTools Write,Edit,Bash --permission-mode dontAsk --max-turns 1 --json-schema <inline two-field probe schema, see scripts/capture-claude-fixtures.mjs>`

### crash.jsonl

Captured 2026-08-17 against 2.1.233 (Claude Code). the hooknoise capture hand-trimmed to end before any result event, plus `#exit 1`: the stream a crashed child leaves behind (adapter must map it to 'crashed'). Derived from hooknoise.jsonl, not a separate CLI run.

### understanding.jsonl — structured_output edited by hand, 2026-08-18

The captured envelope is untouched: the same event sequence, the same tool
calls, the same `result` shape, so the digest this fixture exists to defend
still measures exactly what it measured before. Only the payload inside
`structured_output` was rewritten, from the old `summary: string` to the
`headline` + `summary: string[]` the schema now asks for.

Edited rather than re-captured because the digest asserts the CLI's *envelope*
contract and not its payload, so a re-run would cost a real API call to change
bytes the assertions never look at. Re-record with
`scripts/capture-claude-fixtures.mjs` when the envelope itself may have moved.
