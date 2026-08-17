/**
 * Shutdown lifecycle (ARCHITECTURE §3): the SSE connection count is the
 * liveness signal. When it reaches zero an 8s grace timer starts — cancelled
 * by any reconnect — and on expiry the shutdown sequence runs and the process
 * exits 0. The `goodbye` beacon (pagehide) is a fast-path decrement: it counts
 * the tab as gone before its EventSource socket actually tears down, and the
 * eventual close redeems the credit instead of double-counting.
 *
 * The sequence, in order, and the order matters: stop the agent's children
 * first (SEC-002 — an `npx` tool must never leave a `claude` process running
 * after the tab closed), then release the engine worktrees this process created
 * (RISK-005 — otherwise the cache grows a checkout per session), then flush the
 * store, then exit. Each step is contained: a step that fails is logged and the
 * next one still runs, because a shutdown that gets stuck is worse than an
 * untidy one.
 */

const DEFAULT_GRACE_MS = 8_000;

export interface LifecycleOptions {
	/** flush-on-shutdown: the store's debounced writes land before exit */
	flush: () => Promise<void>;
	/** SEC-002: cancel every run and kill every child the agent still has */
	stopRuns?: () => Promise<void>;
	/** removes the detached worktrees this process materialized */
	releaseWorktrees?: () => Promise<void>;
	graceMs?: number;
	/** test seam; defaults to process.exit */
	exit?: (code: number) => void;
	logError?: (error: unknown) => void;
}

export interface Lifecycle {
	connectionOpened(): void;
	connectionClosed(): void;
	goodbyeReceived(): void;
	/** connections minus unredeemed goodbye credits, floored at zero */
	liveness(): number;
}

export function createLifecycle(options: LifecycleOptions): Lifecycle {
	const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
	const exit = options.exit ?? ((code: number) => process.exit(code));
	const logError =
		options.logError ?? ((error: unknown) => console.error(error));

	let connections = 0;
	let goodbyeCredits = 0;
	let graceTimer: NodeJS.Timeout | null = null;
	// a server that never had a client (--no-open, browser not opened yet)
	// idles until the user shows up; the grace timer only arms after the
	// FIRST client existed, so boot-time noise can never shut us down
	let everConnected = false;

	function liveness(): number {
		return Math.max(0, connections - goodbyeCredits);
	}

	function cancelGrace(): void {
		if (graceTimer !== null) {
			clearTimeout(graceTimer);
			graceTimer = null;
		}
	}

	function armGraceIfDead(): void {
		if (!everConnected || liveness() > 0 || graceTimer !== null) {
			return;
		}
		graceTimer = setTimeout(() => {
			void shutdown();
		}, graceMs);
	}

	async function contained(
		step: (() => Promise<void>) | undefined,
	): Promise<void> {
		if (step === undefined) {
			return;
		}
		try {
			await step();
		} catch (error) {
			// no step may block exit: an unflushable store has already
			// write-through'd everything but the last ~500ms, a worktree that will
			// not go is cleaned by the next boot's prune, and a child that will not
			// die has already had SIGKILL
			logError(error);
		}
	}

	async function shutdown(): Promise<void> {
		await contained(options.stopRuns);
		await contained(options.releaseWorktrees);
		await contained(options.flush);
		exit(0);
	}

	return {
		connectionOpened() {
			connections++;
			everConnected = true;
			cancelGrace();
		},

		connectionClosed() {
			if (goodbyeCredits > 0) {
				// this close was already counted by its pagehide beacon
				goodbyeCredits--;
			}
			connections = Math.max(0, connections - 1);
			armGraceIfDead();
		},

		goodbyeReceived() {
			// capped at the live count so a stray beacon can never leave a
			// credit that outlives every real connection
			goodbyeCredits = Math.min(goodbyeCredits + 1, connections);
			armGraceIfDead();
		},

		liveness,
	};
}
