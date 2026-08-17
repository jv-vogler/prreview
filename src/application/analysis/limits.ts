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

/** §7's 10 minutes per analysis task */
export const ANALYSIS_TIMEOUT_MS = 600_000;

/** a chat turn is a live interaction; a 10-minute one is broken */
export const CHAT_TIMEOUT_MS = 180_000;

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
