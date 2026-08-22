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
import { exec } from "../git/exec";
import { parseAgentVersion } from "../toolchain/agentVersion";
import { buildTaskArgv, buildVersionArgv } from "./argv";
import { PROMPT_DELIVERY } from "./promptDelivery";
import { parseStreamJson, type StreamResultRecord } from "./streamJson";

const AGENT_COMMAND = "claude";
/** Probes must answer fast and never touch the network. */
const PROBE_TIMEOUT_MS = 2000;
/** SEC-002: SIGTERM, then SIGKILL once this grace period has elapsed. */
const DEFAULT_KILL_GRACE_MS = 5000;
/** enough stderr to explain a crash, little enough to keep in a RunDto */
const STDERR_TAIL_BYTES = 4096;

/** terminal_reason values that mean the CLI itself gave up on the clock */
const TIMEOUT_TERMINAL_REASONS = new Set([
	"timeout",
	"timed_out",
	"time_limit",
]);

export interface ClaudeEngineOptions {
	/** overridable so a test can shorten SEC-002's escalation window */
	killGraceMs?: number;
}

/**
 * The claude adapter: one short-lived child process per review task, spawned
 * with an argv array and `shell: false` so no prompt, path, or user text is
 * ever interpolated into a shell (SEC-002). The prompt goes in on stdin
 * (promptDelivery.ts); events come back off stdout as line-delimited JSON.
 * Failures are raw here — the use-case above converts them (GUD-002).
 *
 * There is no schema-retry loop: the CLI already feeds validation errors
 * back to the model and retries until its turn budget runs out, then fails
 * cleanly.
 */
export class ClaudeEngine implements Engine {
	private readonly killGraceMs: number;
	/** every child spawned and not yet reaped — the shutdown kill list (SEC-002) */
	private readonly liveChildren = new Set<ChildProcessWithoutNullStreams>();

	constructor(options: ClaudeEngineOptions = {}) {
		this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
	}

	/** The agent's own report of itself; throws raw when the binary is unusable. */
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

	/**
	 * Ends every child still running, now, and resolves when they are gone.
	 * The one thing shutdown cannot delegate to a generator's cleanup: a
	 * process on its way out never gives the generator another turn.
	 */
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

		try {
			for await (const record of parseStreamJson(child.stdout)) {
				// every line off stdout is proof the child is alive and working,
				// whatever the line says — that is the whole basis of the idle clock
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
					case "tool-use":
						yield toolEvent(record.name, record.input);
						break;
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
			// covers both the normal end and an early `break` by the consumer:
			// a cancelled run must never leave a claude child behind (SEC-002)
			lifetime.stop();
		}
	}

	/**
	 * Owns the child's clock and its death: the idle timeout fires SIGTERM
	 * and escalates to SIGKILL after the grace period, and `stop()` does the
	 * same on the way out of the generator for a child that is still
	 * running.
	 *
	 * The clock measures **silence, not duration**. It is armed at spawn and
	 * rearmed by `touch()` on every line the child emits, so a child that is
	 * working stays alive however long the work takes, and only one that has
	 * genuinely stopped talking gets killed.
	 */
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
				// after stop() there is nothing left to wait for, and rearming here
				// would resurrect a timer the teardown just cleared
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
					// leaving the escalation armed would hold the event loop's
					// last reference to a process that already died
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
	/** proof of life: rearms the idle clock */
	touch(): void;
	stop(): void;
}

/**
 * The prompt is written to stdin and stdin is closed — the CLI reads to EOF
 * (docs/engine-notes.md). A child that died before reading makes this an
 * EPIPE, which is not the failure worth reporting: the exit code is.
 */
function writePrompt(
	child: ChildProcessWithoutNullStreams,
	prompt: string,
): void {
	if (PROMPT_DELIVERY !== "stdin") {
		throw new Error(
			`prompt delivery ${PROMPT_DELIVERY} is documented but not implemented`,
		);
	}
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

/**
 * Resolves once the child is done, with the spawn-level error when there was
 * one. A missing binary surfaces here as ENOENT rather than as a throw, and
 * that is the one failure that means "no agent on this machine".
 */
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
	const target = firstString(input.file_path, input.pattern, input.path);
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
	/** resolved by the CLI, reported on the init event */
	model: string;
	stderrTail: string;
	timedOut: boolean;
	spawnFailure: NodeJS.ErrnoException | null;
	outputSchema: OutputParser;
}

/** Exactly one result event per run, always last (the port's contract). */
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
		// the stream ended without a result event: the child died mid-run
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
	// the CLI accepting its own output is not validation. Captures omit
	// `structured_output` entirely rather than sending null when the model
	// never produced one, so nullish covers both.
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
	// Checked FIRST: an API failure also leaves a schema task with no
	// structured output, and reporting that as a schema violation blames the
	// model for a call that never happened.
	if (result.terminalReason === "api_error") {
		return "api-error";
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

/**
 * The CLI's own explanation is the most useful thing in the envelope on an
 * API failure — it says which model, or that the prompt is too long — so it
 * is put where the UI already looks rather than discarded in favour of
 * stderr, which on these runs is usually empty.
 */
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
