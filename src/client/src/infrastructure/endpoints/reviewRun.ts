import {
	type ReviewStatusDto,
	type RunAcceptedDto,
	reviewStatusDtoSchema,
	runAcceptedDtoSchema,
	runConflictDtoSchema,
} from "@dto/RunDto";
import type { ApiClient } from "../httpClients/apiClient";
import { HttpError } from "../httpClients/HttpError";

/** `GET /api/review`, validated at the boundary. */
export async function getReviewRun(api: ApiClient): Promise<ReviewStatusDto> {
	return reviewStatusDtoSchema.parse(await api.get("/api/review"));
}

export type PostReviewResult =
	| { kind: "started"; runId: string }
	| { kind: "conflict"; existingRunId: string; message: string };

export interface PostReviewOptions {
	/** look at the whole change again, not only what moved since the pass */
	full?: boolean;
}

/**
 * `POST /api/review`. A 409 conflict is an ordinary answer, not a thrown
 * error — the caller decides what "already running" means on screen.
 */
export async function postReviewRun(
	api: ApiClient,
	options: PostReviewOptions = {},
): Promise<PostReviewResult> {
	try {
		const body: RunAcceptedDto = runAcceptedDtoSchema.parse(
			await api.post("/api/review", { full: options.full === true }),
		);
		return { kind: "started", runId: body.runId };
	} catch (error) {
		if (error instanceof HttpError && error.body !== undefined) {
			const conflict = runConflictDtoSchema.safeParse(error.body);
			if (conflict.success) {
				return {
					kind: "conflict",
					existingRunId: conflict.data.existingRunId,
					message: conflict.data.message,
				};
			}
		}
		throw error;
	}
}

/** `DELETE /api/review/run`; false when there was nothing to cancel. */
export async function cancelReviewRun(api: ApiClient): Promise<boolean> {
	try {
		await api.delete("/api/review/run");
		return true;
	} catch (error) {
		if (error instanceof HttpError && error.status === 404) {
			return false;
		}
		throw error;
	}
}
