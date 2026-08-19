import { useEffect, useReducer } from "react";
import type { RunState } from "../../domain/analysis/runReducer";
import {
	initialRunState,
	runStateReducer,
} from "../../domain/analysis/runReducer";
import { getAnalysisRuns } from "../../infrastructure/endpoints/getAnalysisRuns";
import type { ServerEventType } from "../../infrastructure/events/eventSource";
import { useClientContainer } from "../app/ClientContainerProvider";

const RUN_EVENT_TYPES = [
	"run.queued",
	"run.started",
	"run.progress",
	"run.succeeded",
	"run.failed",
	"run.cancelled",
] as const satisfies readonly ServerEventType[];

/**
 * How often the client re-asks the server what is actually running.
 *
 * Only while something is in flight, and never as the primary mechanism — the
 * SSE channel is still what makes the screen feel live. This is the backstop
 * that bounds how wrong the screen can be: a dropped connection, a throttled
 * background tab, or a frame lost between the two used to leave "Running…" on
 * screen forever with no way to find out otherwise except a terminal.
 */
const RECONCILE_MS = 8000;
/** one late check after the run settles, so a missed terminal frame still lands */
const SETTLE_RECHECK_MS = 3000;

/**
 * The whole life of every run: the SSE channel for immediacy, a periodic
 * snapshot for truth. The folding is the domain's; this hook only subscribes,
 * polls, and stops polling when there is nothing to watch.
 */
export function useRunEvents(): RunState {
	const { api, events } = useClientContainer();
	const [state, dispatch] = useReducer(runStateReducer, initialRunState);

	useEffect(() => {
		const unsubscribes = RUN_EVENT_TYPES.map((type) =>
			events.subscribe(type, (event) => dispatch({ type: "run-event", event })),
		);
		return () => {
			for (const unsubscribe of unsubscribes) {
				unsubscribe();
			}
		};
	}, [events]);

	const activeRunId = state.activeRunId;

	useEffect(() => {
		let cancelled = false;

		const snapshot = async () => {
			try {
				const runs = await getAnalysisRuns(api);
				if (!cancelled) {
					dispatch({ type: "runs-snapshot", runs });
				}
			} catch {
				// the server being briefly unreachable is not a run failure, and
				// reporting it as one would be its own kind of lie
			}
		};

		// on mount: a page loaded or reloaded mid-run has to find that run
		void snapshot();
		if (activeRunId === null) {
			// one late look after a run settles, in case its terminal frame was the
			// one that got lost
			const timer = setTimeout(() => void snapshot(), SETTLE_RECHECK_MS);
			return () => {
				cancelled = true;
				clearTimeout(timer);
			};
		}

		const interval = setInterval(() => void snapshot(), RECONCILE_MS);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [api, activeRunId]);

	return state;
}
