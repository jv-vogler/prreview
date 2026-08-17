# Spike 5 verdict: engine worktree fidelity — **GO**

Date: 2026-08-16 · CLI: `claude` 2.1.233 · Model: `--model haiku`
(`claude-haiku-4-5-20251001`) · Scratch repo under the session scratchpad, never prreview's
repo. Full stream capture: `wt-run.jsonl`.

## Setup

A scratch git repo with two commits, so worktree and main checkout are distinguishable:

- commit **vA**: `CLAUDE.md` says the magic word is `CRANBERRY-vA`; `.mcp.json` declares a
  stdio server `spikesecret` (`node ./mcp-server.mjs`, relative path); the server (this dir's
  `mcp-server.mjs`) speaks just enough MCP (initialize / tools/list / tools/call) to serve one
  tool `get_secret` returning `WORKTREE-MCP-99-vA`; `.claude/settings.json` sets
  `{"enableAllProjectMcpServers": true}` so print mode can use project MCP without an
  interactive approval.
- commit **vB** (main checkout HEAD): same files with `CRANBERRY-vB` / `WORKTREE-MCP-99-vB`.

Then `git worktree add --detach <path> <vA-sha>` and, **from inside the detached worktree**:

```
claude -p "First call the get_secret tool from the spikesecret MCP server. Then reply with
exactly: word=<the project magic word> secret=<the tool result>"
  --model haiku --output-format stream-json --verbose
  --allowedTools "mcp__spikesecret__get_secret" --permission-mode dontAsk
```

## Observed (exit 0)

| probe | evidence in `wt-run.jsonl` | loaded from |
|---|---|---|
| CLAUDE.md visible to the model | final result `word=CRANBERRY-vA` | **worktree** (main says vB) |
| .mcp.json discovered | `system:init` → `mcp_servers: [{name:'spikesecret', status:'connected'}]`, tool `mcp__spikesecret__get_secret` in the tools list | **worktree** |
| MCP server actually spawned | real `tool_use mcp__spikesecret__get_secret {}` → `tool_result "WORKTREE-MCP-99-vA"` | **worktree** (main's server returns vB; relative `command` path resolved against the worktree cwd) |

All three loaded from the worktree at the detached ref; nothing leaked from the main
checkout. §7's "the repo's own CLAUDE.md and .mcp.json then load naturally at the reviewed
ref" holds as written.

## Notes for the adapter

- MCP tools are **deferred** in 2.1.233: before invoking, the model called
  `ToolSearch {query:'select:mcp__spikesecret__get_secret'}` and got a `tool_reference` back.
  Grounding/tooling telemetry must not be confused by the extra ToolSearch tool_use, and MCP
  turn budgets need +1 turn of headroom for it.
- `--permission-mode dontAsk` + explicit `--allowedTools mcp__<server>__*` sufficed for the
  call; `enableAllProjectMcpServers: true` (read from the worktree's `.claude/settings.json`)
  is what let the `.mcp.json` server connect in print mode. **Unverified**: whether the server
  would connect without that setting (possibly with an approval denial instead) — if a target
  repo lacks it, the engine may need `--mcp-config`/`--strict-mcp-config` as a fallback; not
  probed to keep the spike single-variable.
- The worktree was created detached with the standard `git worktree add --detach` the
  architecture prescribes; the CLI showed no HEAD-detached complaints (`cwd` in init is the
  worktree path).

Verdict: GO
