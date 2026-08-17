import type {
	AgentInfo,
	ChatTurnInput,
	Engine,
	EngineEvent,
	ReadLog,
	TaskInput,
	TaskSpec,
} from "../../src/application/ports/Engine";

/** one recorded call, so a test can assert what the lane actually asked for */
export interface FakeEngineCall {
	kind: "task" | "chat";
	prompt: string;
	workspaceDir: string;
	resume?: { sessionId: string; fork: boolean };
	task?: TaskSpec;
}

export interface FakeEngineScript {
	/** events yielded in order; the last one is normally the result */
	events: EngineEvent[];
	/**
	 * Held open until the returned release function is called, so a test can
	 * observe a lane while its run is genuinely in flight.
	 */
	blockBeforeResult?: boolean;
	/** the generator throws instead of yielding a result */
	throwWith?: unknown;
}

export const EMPTY_READ_LOG: ReadLog = { reads: [], searchHits: [] };

export interface FakeEngineOptions {
	version?: string;
	task?: FakeEngineScript;
	chat?: FakeEngineScript;
}

/**
 * The Engine port over scripted event lists — the run manager and the M2
 * use-cases under test without a child process anywhere (PAT-001: injected
 * through buildContainer, never module-mocked). `ClaudeEngine` over the fake
 * `claude` binary covers the real adapter; this fake covers the lanes.
 */
export class FakeEngine implements Engine {
	readonly calls: FakeEngineCall[] = [];
	/** resolves once the first run has actually reached the engine */
	readonly started: Promise<void>;
	options: FakeEngineOptions;
	private markStarted!: () => void;
	/** one entry per run currently waiting at its hold point */
	private pendingHolds: (() => void)[] = [];
	/** releases handed out before a run reached its hold point */
	private releaseCredits = 0;
	/** set when a run's iterator was closed by the consumer (cancellation) */
	aborted = false;

	constructor(options: FakeEngineOptions = {}) {
		this.options = options;
		this.started = new Promise((resolve) => {
			this.markStarted = resolve;
		});
	}

	async probe(): Promise<AgentInfo> {
		return { kind: "claude", version: this.options.version ?? "2.1.233" };
	}

	runTask(task: TaskSpec, input: TaskInput): AsyncIterable<EngineEvent> {
		this.calls.push({
			kind: "task",
			prompt: input.prompt,
			workspaceDir: input.workspaceDir,
			...(input.resume === undefined ? {} : { resume: input.resume }),
			task,
		});
		return this.play(this.options.task);
	}

	chatTurn(input: ChatTurnInput): AsyncIterable<EngineEvent> {
		this.calls.push({
			kind: "chat",
			prompt: input.prompt,
			workspaceDir: input.workspaceDir,
			...(input.resume === undefined ? {} : { resume: input.resume }),
		});
		return this.play(this.options.chat);
	}

	/**
	 * Lets one blocked run finish. Calling it before that run has reached its
	 * hold point is fine — the release is banked, because a test cannot see
	 * exactly when the consumer pulls the held event.
	 */
	releaseRun(): void {
		const release = this.pendingHolds.shift();
		if (release === undefined) {
			this.releaseCredits += 1;
			return;
		}
		release();
	}

	private async *play(
		script: FakeEngineScript | undefined,
	): AsyncGenerator<EngineEvent> {
		if (script === undefined) {
			throw new Error("FakeEngine: no script for this call");
		}
		this.markStarted();
		let playedOut = false;
		try {
			for (const event of script.events) {
				if (event.type === "result" && script.blockBeforeResult === true) {
					await this.hold();
				}
				yield event;
			}
			playedOut = true;
			if (script.throwWith !== undefined) {
				throw script.throwWith;
			}
		} finally {
			// a script that never played out was closed by its consumer, which is
			// how a run is cancelled (the adapter kills its child in the same spot)
			this.aborted = this.aborted || !playedOut;
		}
	}

	private hold(): Promise<void> {
		if (this.releaseCredits > 0) {
			this.releaseCredits -= 1;
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			this.pendingHolds.push(resolve);
		});
	}
}

/** the success result most tests need, with the fields they assert filled in */
export function fakeResult(
	overrides: {
		structuredOutput?: unknown;
		text?: string | null;
		sessionId?: string;
		model?: string;
		readLog?: ReadLog;
	} = {},
): EngineEvent {
	return {
		type: "result",
		ok: true,
		...(overrides.structuredOutput === undefined
			? {}
			: { structuredOutput: overrides.structuredOutput }),
		text: overrides.text ?? null,
		sessionId: overrides.sessionId ?? "session-1",
		model: overrides.model ?? "claude-haiku-4-5-20251001",
		numTurns: 3,
		costUsd: 0.01,
		readLog: overrides.readLog ?? EMPTY_READ_LOG,
	};
}

export function fakeSession(sessionId = "session-1"): EngineEvent {
	return {
		type: "session",
		sessionId,
		cwd: "/repo",
		model: "claude-haiku-4-5-20251001",
	};
}
