# Engine notes

Facts measured against the real `claude` CLI, carried forward across the rewrite because they
are empirical claims about *the CLI*, not about prreview's old design. Rediscovering any of
these costs a spike; that's why they're written down instead of re-learned. All measured against
`claude` 2.1.233 in scratch repos outside this one. Re-verify against a new CLI release before
trusting them again.

- **`-p --output-format stream-json` requires `--verbose`**, or the CLI exits 1 emitting nothing
  (`Error: When using --print, --output-format=stream-json requires --verbose`).

- **A concurrent `--resume <sid>` needs `--fork-session`.** Two plain `--resume` processes on the
  same session both succeed, but their turns interleave into the *parent's* session file
  (`user,user,assistant,assistant`) — not corruption, but a merged transcript a later resume can't
  make sense of. `--resume <sid> --fork-session` gives each concurrent resume its own session id
  and leaves the parent file untouched. Only a resume whose output should extend the shared
  session may plain-resume, and never concurrently with another plain resume of the same session.

- **`--json-schema` must be draft-07.** The CLI validates it with Ajv 8, which has no
  draft-2020-12 meta-schema registered — a schema carrying
  `"$schema": "https://json-schema.org/draft/2020-12/schema"` makes Ajv's `validateSchema` throw,
  and the CLI refuses the run at spawn before any turn happens. Emit schemas at `target:
  "draft-7"` and strip the `$schema` key entirely so no meta-schema ever has to resolve.

- **`--json-schema` takes an inline JSON string only** — a file path is rejected outright. It
  worked inline up to 85KB; a 171KB schema never reached the CLI (Linux's `Argument list too
  long`, the ~128KB per-argument argv ceiling). Keep schemas well under that.

- **The prompt goes on stdin, not argv.** `claude -p` reads the whole prompt from stdin when no
  positional prompt is given — verified up to 200KB, far past the argv ceiling. This also keeps
  nothing user-sized or user-authored inside argv.

- **`--max-turns` is absent from `--help` but real and enforced.** A schema violation makes the
  CLI retry the structured-output attempt itself, feeding the validation error back as an
  `is_error` tool result; give it turn headroom (task turns + 2–3 retries) rather than
  implementing a retry loop on top.

- **`--max-budget-usd` is a stopping rule, not a ceiling** — evaluated *between* turns, so the
  first turn always runs and always bills, and a run can finish well over budget (0.0001 asked
  for, 0.0125 actually spent). Never render it as "will not exceed"; budget concurrent children
  as `N × (ceiling + one turn)`.

- **Grep/Glob grounding must come from `tool_result`, not `tool_use.input`.** `Read`'s input
  always carries an absolute `file_path`, but Grep/Glob inputs usually omit `path` — the files the
  agent actually saw are in the tool_result content (newline-separated, cwd-relative), joined back
  to the call via `tool_use_id`.

- **On WSL2, a connect to a port nothing is listening on is never refused.** The localhost relay
  hands it to Windows and the connection stays pending — no ECONNREFUSED, ever — so anything that
  waits on that socket hangs forever with no error to show. A dev proxy or health check needs its
  own connect-timeout probe; it cannot rely on the OS to fail fast.

- **`--permission-mode` decision (SEC-003, Phase 4):** the review task uses `bypassPermissions`,
  not the `dontAsk` legacy used alongside `--allowedTools`/`--disallowedTools`. `dontAsk` alone
  (with no tool allow/deny lists) was observed to still route a `Bash` call through "the Claude
  Code auto mode classifier" and deny it outright in this sandboxed environment — not a hang, an
  explicit denial, which would silently defeat SEC-003's whole premise that the agent can run
  code to verify a finding. `bypassPermissions` is the CLI's documented full-autonomy mode and is
  what SEC-003 actually asks for. Not independently re-verified end to end against a real,
  unsandboxed `claude` process (the sandbox blocked the direct comparison); revisit if a real run
  ever shows an unexpected permission prompt or denial.
