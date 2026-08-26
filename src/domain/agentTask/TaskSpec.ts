export interface OutputParser {
	parse(value: unknown): unknown;
}

export interface TaskSpec {
	jsonSchema: string;
	maxTurns: number;
	idleTimeoutMs: number;
	systemContract: string;
	outputSchema: OutputParser;
}

export interface TaskInput {
	prompt: string;
	workspaceDir: string;
}
