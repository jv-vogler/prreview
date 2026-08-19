/**
 * Every numeric budget of the agent contract in one place (ARCHITECTURE §7),
 * so the NUD serializer, the truncation policy, the output schemas, and the
 * task builders share the same numbers and none of them carries a magic
 * literal.
 *
 * Turn budgets are sized as task turns + 3 for the CLI's own schema-validation
 * retries (CON-006: the CLI self-retries violations, each retry consumes a
 * turn) + 1 for the ToolSearch indirection MCP-aware sessions insert
 * (CON-008/CON-009).
 */

/** stage A comprehension: 26 task turns + 3 validation retries + 1 ToolSearch */
export const COMPREHENSION_MAX_TURNS = 30;

/**
 * one lens child: 16 task turns + 3 validation retries + 1 ToolSearch.
 *
 * Lower than comprehension's on purpose. A lens that has read for sixteen turns
 * without finding anything is not about to; the budget is a ceiling on how long
 * a fruitless search runs, and five of them run at once.
 */
export const REVIEW_MAX_TURNS = 20;

/** a chat turn: 8 task turns + 3 validation retries + 1 ToolSearch */
export const CHAT_MAX_TURNS = 12;

/**
 * How long a run may go **silent** before it is stopped.
 *
 * This used to be a wall clock: ten minutes from the start, finished or not.
 * That number was doing one job — catching a run that had wedged — and it did
 * it by punishing the one case it could not distinguish from a hang, which is a
 * long change being read carefully. A fifty-file PR that had been working
 * steadily for eleven minutes was killed, and its work was thrown away.
 *
 * There is no longer any need to guess, because the run now says what it is
 * doing: every line the agent emits is evidence of life, and the clock resets
 * on each one. So a run that keeps working keeps running, however long that
 * takes, and a run that has genuinely stopped is caught faster than the old
 * ceiling ever caught it. The reader sees the silence at 90 seconds
 * (`RunStatusBar`) and can stop it themselves long before this fires.
 *
 * Sized for the longest legitimate quiet stretch, which is the model thinking
 * about a very large prompt before its first tool call.
 */
export const ANALYSIS_IDLE_TIMEOUT_MS = 300_000;

/** a chat turn streams as it writes, so its silences are much shorter */
export const CHAT_IDLE_TIMEOUT_MS = 120_000;

/** per file, the NUD shows at most this many changed lines before cutting */
export const NUD_PER_FILE_LINE_CAP = 400;

/** soft cap on changed lines across the whole NUD; whole files drop past it */
export const NUD_GLOBAL_LINE_CAP = 3000;

/**
 * schema-enforced ceiling on stage A explanations (CON-013): F3's
 * density-by-philosophy rule, one SSE `annotation.upserted` per explanation
 * against a 500-slot ring buffer, and a diff margin that stays readable
 */
export const MAX_EXPLANATIONS = 60;
