/**
 * The review task's numeric budgets, in one place so the task builder and
 * the run manager share the same numbers and neither carries a magic
 * literal.
 *
 * Turn budget: the flow (target, spec, big picture, what changed, scope
 * check, find problems, verify by running code, write) is a full pass in one
 * shot — there is no separate comprehension stage to fork from — sized
 * generously plus the CLI's own schema-validation retries.
 *
 * Raised from 60 after a real 44-file review spent all 60 and was cut off
 * before it wrote anything up. `-p` mode grants no `Glob` or `Grep`, so the
 * agent explores through `Bash` one command at a time and pays a turn for
 * each; the old ceiling was set against a tool set the run does not get.
 * This is a cap, not a spend — a review that finishes early costs early.
 */
export const REVIEW_MAX_TURNS = 150;

/**
 * How long a run may go **silent** before it is stopped — not a wall clock.
 * Sized for the longest legitimate quiet stretch: the model running a test
 * suite, or reading a large PR carefully before its first report.
 */
export const REVIEW_IDLE_TIMEOUT_MS = 300_000;

/**
 * TASK-048's rework call is deliberately small: one comment, one instruction,
 * no verification pass. A budget an order of magnitude below the review's
 * own turns keeps it "short, cheap" as the plan requires — the model is
 * rewording, not re-investigating from scratch.
 */
export const REWORK_MAX_TURNS = 10;

/** A rework rarely has reason to run anything long; a much shorter fuse than the review's. */
export const REWORK_IDLE_TIMEOUT_MS = 60_000;
