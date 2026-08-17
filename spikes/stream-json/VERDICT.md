# Spike 6 verdict: stream-json tool_use fidelity — **GO-WITH-CONSTRAINTS**

Date: 2026-08-16 · CLI: `claude` 2.1.233 · Model: `--model haiku`
(`claude-haiku-4-5-20251001`) · Scratch git repo (3 files), prompt forcing one Read, one
Grep, one Glob under `--allowedTools "Read,Grep,Glob" --permission-mode dontAsk --max-turns 6`.
Full capture: `tools.jsonl` (exit 0, `result: "done"`).

## Where the file paths live

`tool_use` blocks appear in `assistant` events at `message.content[].{id,name,input}`;
`tool_result` blocks appear in `user` events at
`message.content[].{tool_use_id,type:'tool_result',content}` — **results ARE in the stream**,
joinable to their call via `tool_use_id`.

Observed, verbatim:

| tool | tool_use `input` | tool_result `content` |
|---|---|---|
| Read | `{"file_path": "/abs/path/to/src/main.ts"}` — **absolute path, always present** | file text with `N\t` line-number prefixes (string) |
| Grep | `{"pattern": "alpha"}` — **no path field at all** when the model searches the cwd; `path` is optional and model-chosen | `"Found 2 files\nREADME.md\nsrc/main.ts"` — matched paths, **cwd-relative**, one per line after a `Found N files` header (default `files_with_matches` mode) |
| Glob | `{"pattern": "**/*.md"}` — pattern only, `path` optional | `"README.md"` — matched paths, cwd-relative, newline-separated |

## Consequence for grounding verification (§7)

Extraction cannot be input-only. The recorder in the adapter must be per-tool:

- **Read**: take `input.file_path` (absolute — normalize against the engine-workspace cwd
  from `system:init.cwd`).
- **Grep / Glob**: `input.path` is usually absent; the files the agent actually saw are in
  the **tool_result content** — parse the newline-separated relative paths (skipping the
  `Found N files` header line for Grep) and resolve them against cwd. Grep's other output
  modes (`content` mode returns `path:line:text` lines) would need their own parse if the
  model picks them; the default mode is what was observed.
- Join results to calls by `tool_use_id`; take cwd from the `init` event, not from prreview's
  own process.

This is enough to stamp `groundingVerified`: every file a citation can name shows up either
as a Read input path or in a Grep/Glob result list.

## Constraints / unverified

- The Grep result format (`Found N files` + relative paths) is an observed contract, not a
  documented one — pin it with the fake-claude fixture (spike 3) so a CLI format change fails
  a test instead of silently un-grounding findings.
- Only the default Grep output mode was exercised; `content`/`count` modes unobserved.
- MCP tool calls route through a `ToolSearch` → `tool_reference` indirection first (see spike
  5) — harmless for Read/Grep/Glob, which are called directly.

Verdict: GO-WITH-CONSTRAINTS — paths are extractable, but Grep/Glob grounding must be harvested from tool_result contents (relative, cwd-joined), not from tool_use inputs.
