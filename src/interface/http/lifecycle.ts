/**
 * Shutdown lifecycle (ARCHITECTURE §3): the SSE connection count is the
 * liveness signal. When it reaches zero an 8s grace timer starts — cancelled
 * by any reconnect — and on expiry the store is flushed and the process exits
 * 0. The `goodbye` beacon (pagehide) is a fast-path decrement: it counts the
 * tab as gone before its EventSource socket actually tears down, and the
 * eventual close redeems the credit instead of double-counting.
 */

const DEFAULT_GRACE_MS = 8_000;

export interface LifecycleOptions {
	/** flush-on-shutdown: the store's debounced writes land before exit */
	flush: () => Promise<void>;
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

	async function shutdown(): Promise<void> {
		try {
			await options.flush();
		} catch (error) {
			// an unflushable store must not block exit: the debounced
			// write-through already put everything but the last ~500ms on disk
			logError(error);
		}
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
