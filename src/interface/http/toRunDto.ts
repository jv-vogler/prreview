import type { Run } from "../../domain/review/Run";
import type { RunDto } from "./dto/RunDto";

/** A run as the wire describes it — everything passes straight through. */
export function toRunDto(run: Run): RunDto {
	return {
		id: run.id,
		status: run.status,
		queuedAt: run.queuedAt,
		idleTimeoutMs: run.idleTimeoutMs,
		...(run.progress === undefined ? {} : { progress: run.progress }),
		...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
		...(run.endedAt === undefined ? {} : { endedAt: run.endedAt }),
		...(run.error === undefined ? {} : { error: run.error }),
	};
}
