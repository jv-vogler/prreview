import type { Run } from "../../domain/review/Run";
import type { RunProgress } from "../../domain/review/RunProgress";
import type { RunDto, RunProgressDto } from "./dto/RunDto";

/** A run as the wire describes it — everything passes straight through. */
export function toRunDto(run: Run): RunDto {
	return {
		id: run.id,
		kind: run.kind,
		status: run.status,
		queuedAt: run.queuedAt,
		idleTimeoutMs: run.idleTimeoutMs,
		...(run.progress === undefined
			? {}
			: { progress: toProgressDto(run.progress) }),
		...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
		...(run.endedAt === undefined ? {} : { endedAt: run.endedAt }),
		...(run.error === undefined ? {} : { error: run.error }),
		...(run.commentId === undefined ? {} : { commentId: run.commentId }),
		...(run.result === undefined ? {} : { result: run.result }),
	};
}

function toProgressDto(progress: RunProgress): RunProgressDto {
	return {
		...progress,
		itinerary: progress.itinerary === null ? null : [...progress.itinerary],
	};
}
