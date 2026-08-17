import type { AnalysisRequest, ReviewDepthRequest } from "@dto/AnalysisRequest";
import type { RunDto, RunFailureReasonDto } from "@dto/RunDto";
import { runFailureReasonDtoSchema } from "@dto/RunDto";
import { useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createContext, useContext, useMemo, useState } from "react";
import { postAnalysis } from "../../infrastructure/endpoints/postAnalysis";
import { postCancelRun } from "../../infrastructure/endpoints/postCancelRun";
import { HttpError } from "../../infrastructure/httpClients/HttpError";
import { useAnnotationEvents } from "../annotations/useAnnotationEvents";
import { useClientContainer } from "../app/ClientContainerProvider";
import { useAnalysisArtifactSync } from "./useAnalysisArtifactSync";
import { useRunEvents } from "./useRunEvents";

/** why the last attempt ended badly, in the closed union the copy table maps */
export interface AnalysisFailure {
	reason: RunFailureReasonDto;
	message: string;
}

export interface Analysis {
	/** the comprehension run still in flight, if any */
	activeRun: RunDto | null;
	failure: AnalysisFailure | null;
	/** set when the server refused because a run is already going (409) */
	conflictRunId: string | null;
	/** the trigger request itself is in flight — not the run */
	starting: boolean;
	/** the comprehension pass: fills Overview and Understanding */
	startAnalysis(): void;
	/**
	 * The findings pass: fills Suggested comments.
	 *
	 * A separate trigger, never chained off the comprehension one — reading
	 * about a change must not quietly spend on a review nobody asked for.
	 */
	startReview(depth?: ReviewDepthRequest): void;
	cancelRun(runId: string): void;
	/** the 409's way out: stop the run that is in the way, then start ours */
	cancelAndRestart(runId: string): void;
}

const AnalysisContext = createContext<Analysis | null>(null);

export interface AnalysisProviderProps {
	children: ReactNode;
}

/**
 * Owns everything the analysis lane pushes at the client: the run lifecycle
 * (through the domain's reducer), the explanations arriving one event at a
 * time, and the one refetch of the artifacts a finished run produced. Also
 * owns the two requests that start and stop a run, so no component talks to an
 * endpoint itself.
 *
 * Mounted regardless of the feature flags: with no agent no event ever arrives
 * and nothing is ever requested, so the viewer floor is untouched (REQ-004).
 * Whether the analysis UI exists at all is `useFeatureFlags().analysis`.
 */
export function AnalysisProvider({ children }: AnalysisProviderProps) {
	const { api } = useClientContainer();
	const runs = useRunEvents();
	useAnnotationEvents();
	useAnalysisArtifactSync();

	const [conflictRunId, setConflictRunId] = useState<string | null>(null);

	const start = useMutation({
		mutationFn: (request: AnalysisRequest) => postAnalysis(api, request),
		onSuccess: (result) => {
			setConflictRunId(
				result.kind === "conflict" ? result.existingRunId : null,
			);
		},
	});
	const cancel = useMutation({
		mutationFn: (runId: string) => postCancelRun(api, runId),
		onSuccess: () => setConflictRunId(null),
	});

	const value = useMemo<Analysis>(() => {
		const activeRun =
			runs.activeRunId === null ? null : (runs.byId[runs.activeRunId] ?? null);
		return {
			activeRun,
			failure: toFailure(start.error) ?? runs.lastError,
			conflictRunId,
			starting: start.isPending,
			startAnalysis: () => start.mutate({ task: "comprehension" }),
			startReview: (depth) =>
				start.mutate({
					task: "review",
					...(depth === undefined ? {} : { depth }),
				}),
			cancelRun: (runId) => cancel.mutate(runId),
			// sequential on purpose: starting before the cancel lands would race
			// the lane and earn a second 409
			cancelAndRestart: (runId) =>
				cancel.mutate(runId, {
					onSuccess: () => start.mutate({ task: "comprehension" }),
				}),
		};
	}, [runs, conflictRunId, start, cancel]);

	return (
		<AnalysisContext.Provider value={value}>
			{children}
		</AnalysisContext.Provider>
	);
}

export function useAnalysis(): Analysis {
	const analysis = useContext(AnalysisContext);
	if (analysis === null) {
		throw new Error("useAnalysis must be used inside an AnalysisProvider");
	}
	return analysis;
}

/**
 * A request that never reached a run failed for one of the same reasons a run
 * can (503 `agent-missing` is the one the client can actually see), so it is
 * reported through the same closed union; anything else is `internal`, which
 * the copy table already answers for.
 */
function toFailure(error: unknown): AnalysisFailure | null {
	if (!(error instanceof HttpError)) {
		return error instanceof Error
			? { reason: "internal", message: error.message }
			: null;
	}
	const reason = runFailureReasonDtoSchema.safeParse(error.reason);
	return {
		reason: reason.success ? reason.data : "internal",
		message: error.message,
	};
}
