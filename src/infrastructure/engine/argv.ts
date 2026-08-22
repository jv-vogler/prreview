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
 *   prompt the process cannot answer would just hang the run. There is
 *   deliberately no `--allowedTools`/`--disallowedTools` pair.
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

/** `-p --output-format stream-json` requires `--verbose` (CON-001). */
const STREAM_BASELINE = [
	"-p",
	"--output-format",
	"stream-json",
	"--verbose",
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
	];
}

export function buildVersionArgv(): string[] {
	return ["--version"];
}
