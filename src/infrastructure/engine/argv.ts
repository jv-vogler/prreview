import type { SessionResume } from "../../application/ports/Engine";

/**
 * The single place a `claude` argv array is built (ARCHITECTURE §7's
 * invocation baseline). Every flag here is load-bearing:
 *
 * - `--verbose` is mandatory with `-p --output-format stream-json`, or the CLI
 *   exits 1 emitting nothing (CON-001, spike 3).
 * - the tool allow/deny pair plus `--permission-mode dontAsk` are SEC-001's
 *   read-only promise — prreview never edits the user's tree.
 * - `--fork-session` accompanies every resume that could run concurrently, or
 *   turns interleave into the parent session file (CON-004, spike 4).
 * - there is deliberately **no `--model`**: the user's configured default is
 *   their own cost decision, and the resolved model is read back off the
 *   result event. Depth buys intensity with `--effort` instead.
 * - `--max-budget-usd` is a **stop-threshold, not a cap** (CON-015): the CLI
 *   checks it between turns, so a run halts only once it has already spent past
 *   the number. Never present it to a user as a guarantee.
 *
 * The prompt is never an argv member — it arrives on stdin (SEC-002,
 * promptDelivery.ts).
 */
export interface TaskArgvOptions {
	/** inline JSON Schema string; CON-005 caps it at 85KB */
	jsonSchema: string;
	maxTurns: number;
	systemContract: string;
	resume?: SessionResume;
	/** depth's intensity dial; never `--model` */
	effort?: "low" | "high";
	/** a stop-threshold, not a cap (CON-015); `--print` is always passed */
	maxBudgetUsd?: number;
}

export interface ChatArgvOptions {
	maxTurns: number;
	resume?: SessionResume;
	/** chat turns carry no output schema — one would defeat token streaming (§7) */
	systemContract?: string;
}

const READ_ONLY_TOOLS = "Read,Glob,Grep";
const FORBIDDEN_TOOLS = "Write,Edit,Bash";
const PERMISSION_MODE = "dontAsk";

/** `-p --output-format stream-json` requires `--verbose` (CON-001). */
const STREAM_BASELINE = [
	"-p",
	"--output-format",
	"stream-json",
	"--verbose",
	"--allowedTools",
	READ_ONLY_TOOLS,
	"--disallowedTools",
	FORBIDDEN_TOOLS,
	"--permission-mode",
	PERMISSION_MODE,
];

export function buildTaskArgv(options: TaskArgvOptions): string[] {
	return [
		...STREAM_BASELINE,
		"--max-turns",
		String(options.maxTurns),
		"--append-system-prompt",
		options.systemContract,
		"--json-schema",
		options.jsonSchema,
		...(options.effort === undefined ? [] : ["--effort", options.effort]),
		...(options.maxBudgetUsd === undefined
			? []
			: ["--max-budget-usd", String(options.maxBudgetUsd)]),
		...resumeArgv(options.resume),
	];
}

export function buildChatArgv(options: ChatArgvOptions): string[] {
	return [
		...STREAM_BASELINE,
		"--max-turns",
		String(options.maxTurns),
		...(options.systemContract === undefined
			? []
			: ["--append-system-prompt", options.systemContract]),
		"--include-partial-messages",
		...resumeArgv(options.resume),
	];
}

export function buildVersionArgv(): string[] {
	return ["--version"];
}

function resumeArgv(resume: SessionResume | undefined): string[] {
	if (resume === undefined) {
		return [];
	}
	return [
		"--resume",
		resume.sessionId,
		...(resume.fork ? ["--fork-session"] : []),
	];
}
