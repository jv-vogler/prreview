import type {
	EngineEvent,
	EngineResultEvent,
	EngineSessionEvent,
} from "./ports/Engine";

export interface ConsumeEngineRunHandlers {
	/** aborted by cancel() or the lane's timeout (ARCHITECTURE §7) */
	signal: AbortSignal;
	/** chat deltas; task runs leave it unset */
	onText?: (text: string) => void;
}

export interface ConsumedEngineRun {
	/** what the stream's init event reported, when it got that far */
	session: EngineSessionEvent | null;
	/** null when the run was abandoned before a terminal result arrived */
	result: EngineResultEvent | null;
	/** every text event, joined — the chat reply's authoritative text */
	text: string;
	aborted: boolean;
}

/**
 * Drives one engine run to its terminal event, or stops early when the run is
 * cancelled. Stopping is the cancellation mechanism: the port exposes no abort
 * handle, so closing the iterator runs the adapter's teardown, which sends
 * SIGTERM and escalates to SIGKILL after the grace period (SEC-002).
 *
 * The signal is raced against each step rather than checked between them, so a
 * child that has gone quiet still dies the moment the user cancels.
 */
export async function consumeEngineRun(
	events: AsyncIterable<EngineEvent>,
	handlers: ConsumeEngineRunHandlers,
): Promise<ConsumedEngineRun> {
	const iterator = events[Symbol.asyncIterator]();
	const aborted = abortPromise(handlers.signal);
	const texts: string[] = [];
	let session: EngineSessionEvent | null = null;
	let result: EngineResultEvent | null = null;

	while (true) {
		const step = await Promise.race([iterator.next(), aborted]);
		if (step === ABORTED) {
			// deliberately not awaited: an async generator suspended on a read
			// finishes its `return()` only once that read settles, and a
			// cancelled run must be reported now. The adapter still tears the
			// child down when it resumes, and its own timeout covers a child
			// that has gone silent for good.
			void closeIterator(iterator);
			return { session, result: null, text: texts.join(""), aborted: true };
		}
		if (step.done === true) {
			break;
		}
		const event = step.value;
		if (event.type === "session") {
			session = event;
		}
		if (event.type === "text") {
			texts.push(event.text);
			handlers.onText?.(event.text);
		}
		if (event.type === "result") {
			result = event;
		}
	}

	return { session, result, text: texts.join(""), aborted: false };
}

const ABORTED = Symbol("engine-run-aborted");

function abortPromise(signal: AbortSignal): Promise<typeof ABORTED> {
	if (signal.aborted) {
		return Promise.resolve(ABORTED);
	}
	return new Promise((resolve) => {
		signal.addEventListener("abort", () => resolve(ABORTED), { once: true });
	});
}

async function closeIterator(
	iterator: AsyncIterator<EngineEvent>,
): Promise<void> {
	try {
		await iterator.return?.();
	} catch {
		// teardown of an already-dead child is not a failure worth reporting
	}
}
