import { z } from "zod";
import { passFreshnessDtoSchema, reviewPassDtoSchema } from "./ReviewDto";

export const runFailureReasonDtoSchema = z.enum([
	"agent-missing",
	"timed-out",

	"out-of-turns",
	"crashed",
	"schema-violation",

	"api-error",

	"internal",
]);

export type RunFailureReasonDto = z.infer<typeof runFailureReasonDtoSchema>;

export const itineraryStepDtoSchema = z.object({
	label: z.string(),
	state: z.enum(["pending", "active", "done"]),
});

export type ItineraryStepDto = z.infer<typeof itineraryStepDtoSchema>;

export const runProgressDtoSchema = z.object({
	activity: z.string().nullable(),
	toolCalls: z.int().min(0),

	itinerary: z.array(itineraryStepDtoSchema).nullable(),
	lastActivityAt: z.string(),
});

export type RunProgressDto = z.infer<typeof runProgressDtoSchema>;

export const runStatusDtoSchema = z.enum([
	"queued",
	"running",
	"succeeded",
	"failed",
	"cancelled",
	"timed-out",
]);

export const runKindDtoSchema = z.enum(["review", "rework"]);

export type RunKindDto = z.infer<typeof runKindDtoSchema>;

export const runDtoSchema = z.object({
	id: z.string(),
	kind: runKindDtoSchema,
	status: runStatusDtoSchema,
	queuedAt: z.string(),
	startedAt: z.string().optional(),
	endedAt: z.string().optional(),
	error: z
		.object({ reason: runFailureReasonDtoSchema, message: z.string() })
		.optional(),
	progress: runProgressDtoSchema.optional(),

	idleTimeoutMs: z.int().min(0),
	findingId: z.string().optional(),
	result: z.string().optional(),
});

export type RunDto = z.infer<typeof runDtoSchema>;

export const runAcceptedDtoSchema = z.object({ runId: z.string() });

export type RunAcceptedDto = z.infer<typeof runAcceptedDtoSchema>;

export const runConflictDtoSchema = z.object({
	reason: z.literal("run-already-running"),
	message: z.string(),
	existingRunId: z.string(),
});

export type RunConflictDto = z.infer<typeof runConflictDtoSchema>;

export const reviewStatusDtoSchema = z.object({
	run: runDtoSchema.nullable(),
	pass: reviewPassDtoSchema.nullable(),

	freshness: passFreshnessDtoSchema.nullable(),
});

export type ReviewStatusDto = z.infer<typeof reviewStatusDtoSchema>;
