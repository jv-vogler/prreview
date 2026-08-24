/**
 * The single place a `claude` argv array is built. Every flag here is
 * load-bearing:
 *
 * - `--verbose` is mandatory with `-p --output-format stream-json`, or the
 *   CLI exits 1 emitting nothing (CON-001, docs/engine-notes.md).
 * - `--permission-mode bypassPermissions` is SEC-003's whole point: the old
 *   implementation restricted the agent to `Read,Glob,Grep` and its findings
 *   were correspondingly unverifiable. This rebuild lets the agent run code —
 *   write a temp test, reproduce a crash, delete it — and a permission
 *   prompt the process cannot answer would just hang the run.
 * - `--allowedTools` exists only to reach the task-list tools:
 *   `TaskCreate`/`TaskUpdate`/`TaskList`/`TaskGet` are absent from `-p` mode
 *   unless the flag is passed, and `TodoWrite` does not exist there at all,
 *   so this is the only way the agent can publish the plan the status bar
 *   shows. Measured against the CLI's own `system:init` event the flag is
 *   additive here — 97 granted tools become 101 and nothing is removed,
 *   because `bypassPermissions` already permits everything. It still names
 *   Bash/Read/Write/Edit explicitly so that SEC-003 holds either way: a
 *   superset while the flag stays additive, and exactly the tools a review
 *   needs to verify its own findings if a future CLI makes it restrictive.
 * - there is deliberately **no `--model`**: the user's configured default is
 *   their own cost decision, and the resolved model is read back off the
 *   result event.
 *
 * The prompt is never an argv member — it arrives on stdin (SEC-002,
 * promptDelivery.ts).
 */
export interface TaskArgvOptions {
	/** inline JSON Schema string; CON-003 caps it at 85KB */
	jsonSchema: string;
	maxTurns: number;
	systemContract: string;
}

const PERMISSION_MODE = "bypassPermissions";
const ALLOWED_TOOLS = [
	"Bash",
	"Read",
	"Write",
	"Edit",
	"WebFetch",
	"WebSearch",
	"TaskCreate",
	"TaskUpdate",
	"TaskList",
	"TaskGet",
].join(",");

/** `-p --output-format stream-json` requires `--verbose` (CON-001). */
const STREAM_BASELINE = [
	"-p",
	"--output-format",
	"stream-json",
	"--verbose",
	"--permission-mode",
	PERMISSION_MODE,
	"--allowedTools",
	ALLOWED_TOOLS,
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
	];
}

export function buildVersionArgv(): string[] {
	return ["--version"];
}
