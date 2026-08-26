export interface TaskArgvOptions {
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
