import { useEffect, useReducer } from "react";
import type { RunState } from "../../domain/analysis/runReducer";
import { initialRunState, runReducer } from "../../domain/analysis/runReducer";
import type { ServerEventType } from "../../infrastructure/events/eventSource";
import { useClientContainer } from "../app/ClientContainerProvider";

const RUN_EVENT_TYPES = [
	"run.queued",
	"run.started",
	"run.succeeded",
	"run.failed",
	"run.cancelled",
] as const satisfies readonly ServerEventType[];

/**
 * The whole life of every run, as the SSE channel reports it. The reducer is
 * the domain's; this hook only subscribes and unsubscribes.
 */
export function useRunEvents(): RunState {
	const { events } = useClientContainer();
	const [state, dispatch] = useReducer(runReducer, initialRunState);

	useEffect(() => {
		const unsubscribes = RUN_EVENT_TYPES.map((type) =>
			events.subscribe(type, dispatch),
		);
		return () => {
			for (const unsubscribe of unsubscribes) {
				unsubscribe();
			}
		};
	}, [events]);

	return state;
}
