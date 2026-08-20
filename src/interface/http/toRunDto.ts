import type { Run } from "../../application/ports/RunManager";
import type { RunDto } from "./dto/RunDto";

/**
 * A run as the wire describes it: the manager's `taskType` is what the UI calls
 * the run's stage, and everything else passes through. The lane is part of the
 * contract because the two lanes mean different things to the reader — an
 * analysis run blocks re-analysis, a chat turn does not.
 */
export function toRunDto(run: Run): RunDto {
	return {
		id: run.id,
		stage: run.taskType,
		lane: run.lane,
		status: run.status,
		queuedAt: run.queuedAt,
		idleTimeoutMs: run.idleTimeoutMs,
		...(run.progress === undefined ? {} : { progress: run.progress }),
		...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
		...(run.endedAt === undefined ? {} : { endedAt: run.endedAt }),
		...(run.error === undefined ? {} : { error: run.error }),
		...(run.skippedAnchors === undefined
			? {}
			: { skippedAnchors: run.skippedAnchors }),
		...(run.discardedCandidates === undefined
			? {}
			: { discardedCandidates: run.discardedCandidates }),
	};
}
