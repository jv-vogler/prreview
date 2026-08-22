/**
 * The review task's numeric budgets, in one place so the task builder and
 * the run manager share the same numbers and neither carries a magic
 * literal.
 *
 * Turn budget: the flow (target, spec, big picture, what changed, scope
 * check, find problems, verify by running code, write) is a full pass in one
 * shot — there is no separate comprehension stage to fork from — sized
 * generously plus the CLI's own schema-validation retries.
 */
export const REVIEW_MAX_TURNS = 60;

/**
 * How long a run may go **silent** before it is stopped — not a wall clock.
 * Sized for the longest legitimate quiet stretch: the model running a test
 * suite, or reading a large PR carefully before its first report.
 */
export const REVIEW_IDLE_TIMEOUT_MS = 300_000;
