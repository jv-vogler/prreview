import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type {
	AgentInfo,
	Engine,
	EngineEvent,
	OutputParser,
	TaskInput,
	TaskSpec,
} from "../../application/ports/Engine";
import type { EngineErrorReason } from "../../domain/errors/EngineError";
import {
	applyTaskCall,
	type ItineraryStep,
} from "../../domain/run/RunProgress";
import { exec } from "../git/exec";
import { parseAgentVersion } from "../toolchain/agentVersion";
import { buildTaskArgv, buildVersionArgv } from "./argv";
import { parseStreamJson, type StreamResultRecord } from "./streamJson";

const AGENT_COMMAND = "claude";

const PROBE_TIMEOUT_MS = 2000;

const DEFAULT_KILL_GRACE_MS = 5000;

const STDERR_TAIL_BYTES = 4096;

const MAX_TURNS_TERMINAL_REASON = "max_turns";

const TIMEOUT_TERMINAL_REASONS = new Set([
	"timeout",
	"timed_out",
	"time_limit",
]);

export interface ClaudeEngineOptions {
	killGraceMs?: number;
}

export class ClaudeEngine implements Engine {
	private readonly killGraceMs: number;

	private readonly liveChildren = new Set<ChildProcessWithoutNullStreams>();

	constructor(options: ClaudeEngineOptions = {}) {
		this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
	}

	async probe(): Promise<AgentInfo> {
		const output = await exec(AGENT_COMMAND, buildVersionArgv(), {
			timeoutMs: PROBE_TIMEOUT_MS,
		});
		return { kind: "claude", version: parseAgentVersion(output) };
	}

	runTask(task: TaskSpec, input: TaskInput): AsyncIterable<EngineEvent> {
		return this.run({
			argv: buildTaskArgv({
				jsonSchema: task.jsonSchema,
				maxTurns: task.maxTurns,
				systemContract: task.systemContract,
			}),
			prompt: input.prompt,
			workspaceDir: input.workspaceDir,
			idleTimeoutMs: task.idleTimeoutMs,
			outputSchema: task.outputSchema,
		});
	}

	async stop(): Promise<void> {
		await Promise.all(
			[...this.liveChildren].map((child) => this.terminateAndWait(child)),
		);
	}

	private terminateAndWait(
		child: ChildProcessWithoutNullStreams,
	): Promise<void> {
		if (child.exitCode !== null || child.signalCode !== null) {
			return Promise.resolve();
		}
		return new Promise((resolveExit) => {
			const killTimer = setTimeout(
				() => child.kill("SIGKILL"),
				this.killGraceMs,
			);
			killTimer.unref();
			child.once("close", () => {
				clearTimeout(killTimer);
				resolveExit();
			});
			child.kill("SIGTERM");
		});
	}

	private async *run(options: RunOptions): AsyncGenerator<EngineEvent> {
		const child = spawn(AGENT_COMMAND, options.argv, {
			cwd: options.workspaceDir,
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.liveChildren.add(child);
		child.once("close", () => this.liveChildren.delete(child));
		child.once("error", () => this.liveChildren.delete(child));

		const stderr = collectStderrTail(child);
		const exited = waitForExit(child);
		const lifetime = this.startLifetime(child, options.idleTimeoutMs);
		writePrompt(child, options.prompt);

		let resultRecord: StreamResultRecord | null = null;
		let resolvedModel = "";
		let itinerary: readonly ItineraryStep[] = [];

		try {
			for await (const record of parseStreamJson(child.stdout)) {
				lifetime.touch();
				switch (record.kind) {
					case "init":
						resolvedModel = record.model;
						yield {
							type: "session",
							sessionId: record.sessionId,
							cwd: record.cwd,
							model: record.model,
						};
						break;
					case "tool-use": {
						yield toolEvent(record.name, record.input);
						const steps = applyTaskCall(itinerary, record.name, record.input);
						if (steps !== null) {
							itinerary = steps;
							yield { type: "plan", steps };
						}
						break;
					}
					case "assistant-text":
						yield { type: "text", text: record.text };
						break;
					case "result":
						resultRecord = record;
						break;
					default:
						break;
				}
			}

			const spawnFailure = await exited;
			yield terminalEvent({
				result: resultRecord,
				model: resolvedModel,
				stderrTail: await stderr.tail(),
				timedOut: lifetime.timedOut(),
				spawnFailure,
				outputSchema: options.outputSchema,
			});
		} finally {
			lifetime.stop();
		}
	}

	private startLifetime(
		child: ChildProcessWithoutNullStreams,
		idleTimeoutMs: number,
	): ChildLifetime {
		let timedOut = false;
		let killTimer: NodeJS.Timeout | undefined;
		let idleTimer: NodeJS.Timeout | undefined;
		let stopped = false;

		const terminate = () => {
			if (child.exitCode !== null || child.signalCode !== null) {
				return;
			}
			child.kill("SIGTERM");
			killTimer = setTimeout(() => child.kill("SIGKILL"), this.killGraceMs);
			killTimer.unref();
		};

		const arm = () => {
			idleTimer = setTimeout(() => {
				timedOut = true;
				terminate();
			}, idleTimeoutMs);
			idleTimer.unref();
		};
		arm();

		return {
			timedOut: () => timedOut,
			touch: () => {
				if (stopped || timedOut) {
					return;
				}
				clearTimeout(idleTimer);
				arm();
			},
			stop: () => {
				stopped = true;
				clearTimeout(idleTimer);
				terminate();
				child.stdout.destroy();
				child.stderr.destroy();
				if (killTimer !== undefined) {
					setImmediate(() => clearTimeout(killTimer)).unref();
				}
			},
		};
	}
}

interface RunOptions {
	argv: string[];
	prompt: string;
	workspaceDir: string;
	idleTimeoutMs: number;
	outputSchema: OutputParser;
}

interface ChildLifetime {
	timedOut(): boolean;
	touch(): void;
	stop(): void;
}

function writePrompt(
	child: ChildProcessWithoutNullStreams,
	prompt: string,
): void {
	child.stdin.on("error", () => {});
	child.stdin.end(prompt);
}

function collectStderrTail(child: ChildProcessWithoutNullStreams): {
	tail(): Promise<string>;
} {
	let tail = "";
	const done = new Promise<void>((resolveDone) => {
		child.stderr.on("data", (chunk: Buffer) => {
			tail = (tail + chunk.toString("utf8")).slice(-STDERR_TAIL_BYTES);
		});
		child.stderr.on("close", () => resolveDone());
		child.stderr.on("error", () => resolveDone());
	});
	return {
		tail: async () => {
			await done;
			return tail;
		},
	};
}

function waitForExit(
	child: ChildProcessWithoutNullStreams,
): Promise<NodeJS.ErrnoException | null> {
	return new Promise((resolveExit) => {
		child.on("close", () => resolveExit(null));
		child.on("error", (error: NodeJS.ErrnoException) => resolveExit(error));
	});
}

function toolEvent(
	name: string,
	input: Record<string, unknown>,
): EngineEvent & { type: "tool" } {
	const target = firstString(
		input.file_path,
		input.pattern,
		input.path,
		input.command,
		input.url,
		input.query,
	);
	return {
		type: "tool",
		name,
		...(target === undefined ? {} : { target }),
	};
}

function firstString(...candidates: unknown[]): string | undefined {
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate !== "") {
			return candidate;
		}
	}
	return undefined;
}

interface TerminalInput {
	result: StreamResultRecord | null;
	model: string;
	stderrTail: string;
	timedOut: boolean;
	spawnFailure: NodeJS.ErrnoException | null;
	outputSchema: OutputParser;
}

function terminalEvent(input: TerminalInput): EngineEvent {
	if (input.spawnFailure?.code === "ENOENT") {
		return failure("agent-missing", null, input);
	}
	if (input.timedOut) {
		return failure(
			"timed-out",
			input.result?.terminalReason ?? null,
			input,
			input.result ?? undefined,
		);
	}
	if (input.result === null) {
		return failure("crashed", null, input);
	}
	if (input.result.isError) {
		return failure(
			failureReason(input.result),
			input.result.terminalReason,
			input,
			input.result,
		);
	}
	return successOrSchemaViolation(input.result, input);
}

function successOrSchemaViolation(
	result: StreamResultRecord,
	input: TerminalInput,
): EngineEvent {
	if (
		result.structuredOutput === null ||
		result.structuredOutput === undefined
	) {
		return failure(failureReason(result), result.terminalReason, input, result);
	}
	try {
		const structuredOutput = input.outputSchema.parse(result.structuredOutput);
		return {
			type: "result",
			ok: true,
			structuredOutput,
			text: result.text,
			sessionId: result.sessionId,
			model: input.model,
			numTurns: result.numTurns,
			costUsd: result.costUsd,
		};
	} catch {
		return failure("schema-violation", result.terminalReason, input, result);
	}
}

function failureReason(result: StreamResultRecord): EngineErrorReason {
	if (result.terminalReason === "api_error") {
		return "api-error";
	}

	if (result.terminalReason === MAX_TURNS_TERMINAL_REASON) {
		return "out-of-turns";
	}
	if (
		result.structuredOutput === null ||
		result.structuredOutput === undefined
	) {
		return "schema-violation";
	}
	if (
		result.terminalReason !== null &&
		TIMEOUT_TERMINAL_REASONS.has(result.terminalReason)
	) {
		return "timed-out";
	}
	return "crashed";
}

function failure(
	reason: EngineErrorReason,
	terminalReason: string | null,
	input: TerminalInput,
	result?: StreamResultRecord,
): EngineEvent {
	const explanation =
		result?.text !== undefined && result?.text !== null && result.text !== ""
			? result.text
			: null;
	const status =
		result?.apiErrorStatus === undefined || result?.apiErrorStatus === null
			? ""
			: `HTTP ${result.apiErrorStatus}: `;
	return {
		type: "result",
		ok: false,
		reason,
		terminalReason,
		stderrTail:
			explanation === null ? input.stderrTail : `${status}${explanation}`,
	};
}
