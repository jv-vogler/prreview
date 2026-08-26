import {
	type ReviewPassDto,
	type ReworkInstructionDto,
	reviewPassDtoSchema,
} from "@dto/ReviewDto";
import {
	type RunAcceptedDto,
	runAcceptedDtoSchema,
	runConflictDtoSchema,
} from "@dto/RunDto";
import type { ApiClient } from "../httpClients/apiClient";
import { HttpError } from "../httpClients/HttpError";
import type { PostReviewResult } from "./reviewRun";

export async function editFinding(
	api: ApiClient,
	findingId: string,
	body: string,
): Promise<ReviewPassDto> {
	return reviewPassDtoSchema.parse(
		await api.patch(`/api/review/comments/${findingId}`, { body }),
	);
}

export async function deleteFinding(
	api: ApiClient,
	findingId: string,
): Promise<ReviewPassDto> {
	return reviewPassDtoSchema.parse(
		await api.delete(`/api/review/comments/${findingId}`),
	);
}

export async function restoreFinding(
	api: ApiClient,
	findingId: string,
): Promise<ReviewPassDto> {
	return reviewPassDtoSchema.parse(
		await api.post(`/api/review/comments/${findingId}/restore`),
	);
}

export async function reworkFinding(
	api: ApiClient,
	findingId: string,
	instruction: ReworkInstructionDto,
): Promise<PostReviewResult> {
	try {
		const body: RunAcceptedDto = runAcceptedDtoSchema.parse(
			await api.post(`/api/review/comments/${findingId}/rework`, {
				instruction,
			}),
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
