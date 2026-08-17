# Engine notes

In plain terms: this file records what we actually observed when driving the real `claude`
CLI, so the engine adapter's mechanical choices trace back to experiments instead of guesses.
The spike verdicts under `spikes/*/VERDICT.md` are the primary record; this file adds the
answers measured after the spikes closed.

## How the prompt is delivered

Answered empirically on 2026-08-17 against `claude` 2.1.233 (Claude Code), `--model haiku`,
in a scratch git repo outside this repository, by `scripts/capture-claude-fixtures.mjs`
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
read log). Phase 4's adapter implements the stdin path and keeps this fallback behind a single
constant in `src/infrastructure/engine/promptDelivery.ts`.

Corollaries baked into the adapter: the prompt is never an argv member (SEC-002 — nothing
user-sized or user-authored is interpolated into argv), and `--json-schema` stays the only
large argv value, capped at 85KB by a build-time assertion (CON-005).
