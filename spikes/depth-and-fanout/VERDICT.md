# Spike 8 verdict: depth controls and lens fan-out — **GO, with one copy correction**

Date: 2026-08-17 · CLI: `claude` 2.1.233 (Claude Code) · Model: `--model haiku` · Scratch git
repo under the OS temp dir, never this repository. Harness: `probe.mjs`
(`PRREVIEW_REAL_CLAUDE=1`), raw findings in `capture.json`. Total spend ≈ $0.10 across 11 child
processes.

## Summary

| # | Question | Verdict |
|---|---|---|
| 1 | `--max-budget-usd` exhaustion semantics | **Typed failure — but it is a stop-threshold, not a cap** |
| 2 | `--effort` behavior | **Accepted at every level; no measurable effect on a trivial task** |
| 3 | 5-way concurrent `--fork-session` | **GO — 5/5 clean, parent session untouched** |

## Confirmed at zero cost (`claude --help`)

| flag | help text | consequence |
|---|---|---|
| `--effort <level>` | `(low, medium, high, xhigh, max)` | **five** levels, not three; `xhigh`/`max` are in reserve for a custom preset |
| `--max-budget-usd <amount>` | `only works with --print` | prreview always passes `-p`, so it is usable on every task child |
| `--json-schema <schema>` | example carries **no `$schema`** | consistent with CON-014 |

## Q1 — `--max-budget-usd` exhaustion: typed, and it overshoots

Exhaustion is a clean typed failure, exactly parallel to `error_max_turns`:

```
subtype: "error_max_budget_usd"   terminal_reason: "budget_exhausted"
is_error: true                    structured_output: null      exit code: 1
```

So the engine needs no new failure path — it maps alongside the `max_turns` case it already
handles, and `terminal_reason` is what the UI surfaces.

**The correction the design needs.** The design says the dialog's number becomes "a ceiling the
CLI enforces". Measured, it does not:

| `--max-budget-usd` | actual `total_cost_usd` | turns run | overshoot |
|---|---|---|---|
| `0.0001` | **0.0125** | 1 | **125×** |
| `0.01` | **0.0132** | 4 | 1.3× |

The budget is checked **between turns**, so the run stops once cumulative spend has *already*
passed the number. The first turn always runs and always bills, however small the ceiling. It is a
**stop-threshold with overshoot of up to one turn**, not a guarantee.

Consequences, all of them about honesty rather than mechanism:

- UI copy must never say "will not exceed $X" or render the number as a cap. "Stops once it has
  spent about $X" is what is true.
- The overshoot is bounded by one turn's cost, which on a large lens child is not negligible.
  With five lens children each carrying its own ceiling, worst-case spend is
  `5 × (ceiling + one turn)`, and the dialog's total should be derived that way rather than as
  `5 × ceiling`.
- A ceiling below one turn's cost does not prevent the run; it makes it fail after paying. So the
  dialog must enforce a sane floor rather than pass an arbitrarily small number through.

## Q2 — `--effort`: safe to pass, effect not demonstrated

All three levels were **accepted alongside prreview's full flag set** (`-p`, stream-json,
`--verbose`, the read-only tool pair, `--permission-mode dontAsk`, `--max-turns`) and exited 0.
That is the compatibility question answered: the flag is safe to add.

The differentiation question is **not** answered, and the honest reading is that this probe shows
nothing:

| effort | turns | duration | cost |
|---|---|---|---|
| `low` | 1 | 3151 ms | 0.0102 |
| `medium` | 1 | 2757 ms | 0.0026 |
| `high` | 1 | 3396 ms | 0.0031 |

Same turn count, durations within noise of each other, and `low` costing **more** than `high` —
which is the tell that the first invocation carried warm-up the others did not, not that low
effort is expensive. The prompt was a one-sentence conceptual question with tools unused; there
was no depth for effort to buy.

What follows for Phase 6: pass `--effort` as designed, but **do not claim in the UI that a preset
buys "more thinking"** on the strength of this evidence. What a preset demonstrably buys is lens
count, grounding hops, and the `nitpick` tier — all of which are prreview's own mechanisms and all
of which are real. Whether effort adds to that should be measured on a realistic review task
during Phase 6, when one exists, and the claim made only if it survives.

## Q3 — five concurrent `--fork-session` resumes: clean

Five lens-shaped children launched **simultaneously** against one parent session:

| property | result |
|---|---|
| exited 0 | **5 / 5** |
| received a new, distinct session id | **5 / 5** |
| still saw parent context (recalled the codename) | **5 / 5** |
| parent session file line count | **10 → 10 (grew by 0)** |
| parent session file still valid JSONL | **yes** |

This closes the gap spike 4 flagged. That spike proved 2 concurrent forks and said plainly it was
"not a stress test"; the lens fan-out needs 5. At 5, forking is still clean and the parent history
is untouched, so **B∥ fan-out at the design's full width is safe**, provided every lens resume
passes `--fork-session` — which spike 4 already established is mandatory, since plain concurrent
resumes interleave into the parent.

Caveat carried forward unchanged: session files are keyed by invocation cwd
(`~/.claude/projects/<cwd-slug>/`), so every fork must run from the same cwd as its parent. All
probe runs did.

## Reproducing

```sh
PRREVIEW_REAL_CLAUDE=1 node spikes/depth-and-fanout/probe.mjs
```
