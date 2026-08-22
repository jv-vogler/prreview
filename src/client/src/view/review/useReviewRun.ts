import type { RunDto } from "@dto/RunDto";
import { serverEventSchema } from "@dto/ServerEvent";
import { useCallback, useEffect, useState } from "react";
import {
	cancelReviewRun,
	getReviewRun,
	postReviewRun,
} from "../../infrastructure/endpoints/reviewRun";
import type { ApiClient } from "../../infrastructure/httpClients/apiClient";

/** while a run is live, how often the poll fallback re-checks (TASK-037) */
const POLL_MS = 8_000;
const LIVE_STATUSES = new Set(["queued", "running"]);

export interface ReviewRunState {
	run: RunDto | null;
	starting: boolean;
	/** a start attempt's own failure — a 409 conflict, or the request itself failing */
	startError: string | null;
	/** SEC-003/TASK-030: files the last successful run left behind, if any */
	residue: string[] | null;
	start(): void;
	cancel(): void;
}

/**
 * The run's state on screen, kept in sync two ways at once: the SSE channel
 * for live updates, and an 8-second poll of `GET /api/review` whenever a
 * run is queued or running, so a dropped SSE frame goes stale for seconds,
 * never permanently wrong (REQ-008, TASK-037).
 */
export function useReviewRun(api: ApiClient): ReviewRunState {
	const [run, setRun] = useState<RunDto | null>(null);
	const [residue, setResidue] = useState<string[] | null>(null);
	const [starting, setStarting] = useState(false);
	const [startError, setStartError] = useState<string | null>(null);

	const refetch = useCallback(() => {
		getReviewRun(api).then((status) => {
			setRun(status.run);
			setResidue(status.residue ?? null);
		}, noop);
	}, [api]);

	useEffect(() => {
		refetch();
	}, [refetch]);

	useEffect(() => {
		const source = new EventSource("/api/events");
		source.onmessage = (event) => {
			const parsed = serverEventSchema.safeParse(JSON.parse(event.data));
			if (!parsed.success || parsed.data.type === "heartbeat") {
				return;
			}
			setRun(parsed.data.run);
			if (parsed.data.type === "run.succeeded") {
				// residue is discovered only by reading the store, so a
				// success frame is followed by one fetch to pick it up
				refetch();
			}
		};
		return () => source.close();
	}, [refetch]);

	const runStatus = run?.status;
	useEffect(() => {
		if (runStatus === undefined || !LIVE_STATUSES.has(runStatus)) {
			return;
		}
		const timer = setInterval(refetch, POLL_MS);
		return () => clearInterval(timer);
	}, [runStatus, refetch]);

	const start = useCallback(() => {
		setStarting(true);
		setStartError(null);
		setResidue(null);
		postReviewRun(api).then(
			(result) => {
				setStarting(false);
				if (result.kind === "conflict") {
					setStartError(result.message);
				}
			},
			(error: unknown) => {
				setStarting(false);
				setStartError(error instanceof Error ? error.message : String(error));
			},
		);
	}, [api]);

	const cancel = useCallback(() => {
		void cancelReviewRun(api);
	}, [api]);

	return { run, residue, starting, startError, start, cancel };
}

function noop(): void {}
