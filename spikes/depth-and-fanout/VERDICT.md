# Spike 8 verdict: depth controls and lens fan-out — **PARTIAL: flags confirmed, behavior pending**

Date: 2026-08-17 · CLI: `claude` 2.1.233 (Claude Code) · Harness: `probe.mjs` (opt-in),
raw findings land in `capture.json`.

## Status

The findings engine's depth design rests on three flags behaving in specific ways. **Their
existence and accepted values are confirmed** from `claude --help`, which costs nothing. **Their
runtime behavior is not yet measured** — that needs real API spend and is gated behind
`PRREVIEW_REAL_CLAUDE=1`, the owner's own control. `probe.mjs` is written and ready; running it is
a decision, not a default.

Nothing in Phase 6 should be built on the unmeasured half until this verdict is completed.

## Confirmed at zero cost (`claude --help`, 2.1.233)

| flag | help text | consequence |
|---|---|---|
| `--effort <level>` | `Effort level for the current session (low, medium, high, xhigh, max)` | **five** levels, not three. The design's Light/Standard/Thorough maps to `low` / *omit* / `high`, with `xhigh` and `max` held in reserve for a custom preset |
| `--max-budget-usd <amount>` | `Maximum dollar amount to spend on API calls (only works with --print)` | prreview always passes `-p` (= `--print`), so the flag is usable on every task child. Confirms the dialog's number can become a real ceiling rather than an estimate |
| `--fork-session` | `When resuming, create a new session ID` | as relied on by spike 4 |
| `--json-schema <schema>` | example shown carries **no `$schema` key** | consistent with CON-014's draft-07-and-strip rule |

The `--effort` value set matters to the design as written: the depth table says "`--effort low` /
default / `--effort high`", and `medium` turning out to be a real, nameable level means "default"
can be stated explicitly rather than left implicit, if measurement shows the default is not
`medium`.

## Open questions `probe.mjs` answers

**Q1 — `--max-budget-usd` exhaustion semantics.** Runs a multi-turn Read task under a ceiling too
low to finish (`0.0001`, then `0.01`) and records the exit code, the emitted event types, and the
`result` envelope (`subtype`, `is_error`, `terminal_reason`, `num_turns`, `total_cost_usd`).

*Why it decides something:* the depth dialog turns a number into this flag. If exhaustion produces
a typed failure like `error_max_turns` does, the engine surfaces it the same way and the user sees
an honest "stopped at your ceiling". If it truncates silently — or refuses pre-flight — the UI
copy and the run-failure mapping both have to change.

**Q2 — `--effort` behavior.** Same prompt at `low`, `medium`, `high`, recording acceptance
alongside our full flag set, wall time, `num_turns`, and `total_cost_usd`.

*Why it decides something:* the design buys depth with `--effort` and deliberately never touches
`--model`. If effort does not measurably change anything on a small task, the presets are
distinguished only by lens count and grounding hops, and the dialog must not claim otherwise.

**Q3 — five concurrent `--fork-session` resumes.** Creates a parent session, launches five lens
children simultaneously against it, and records: exit codes, whether each got a distinct new
session id, whether each still saw parent context, whether the parent's session file grew, and
whether it stayed valid JSONL.

*Why it decides something:* spike 4 proved this at **2** concurrent forks and explicitly flagged
that it was "not a stress test". The lens fan-out runs up to **5**. The gap between what was
measured and what the design assumes is exactly one factor of 2.5, and the failure mode it guards
against — history pollution in the parent session — is silent.

## Cost shape

Deliberately small: `--model haiku` throughout, tiny prompts, turn caps of 3–12, nine short child
processes in total (2 budget + 3 effort + 1 parent + 5 forks), in a scratch git repo under the OS
temp dir. Two of the nine are *designed* to terminate early against a fraction-of-a-cent ceiling.

## Reproducing

```sh
PRREVIEW_REAL_CLAUDE=1 node spikes/depth-and-fanout/probe.mjs
```

Then fill in the results below and change the heading's verdict.

## Results

_Not yet run._
