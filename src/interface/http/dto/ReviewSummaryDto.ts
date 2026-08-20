import { z } from "zod";

/**
 * `GET /api/review`: what the findings pass decided beyond the comments it
 * produced — what it threw away, and what it could not place.
 *
 * The reasons are a **closed enum**, not the sentences adjudication logged.
 * The tab needs per-reason counts, and grouping by parsing prose would break
 * the first time someone reworded a message; a closed set also means a new
 * reason cannot ship without user-facing text for it, the same rule
 * `runFailureReasonDto` already states.
 *
 * Bodies never appear here. A body that failed the form gate is exactly the
 * noise the gate exists to remove, and putting it back on the wire would undo
 * the pass. Titles do: "4 were cut" tells a reader nothing about whether the
 * right four were cut.
 */
export const discardReasonKindDtoSchema = z.enum([
	"below-confidence-floor",
	"form",
	"ungrounded-blocker",
]);

export type DiscardReasonKindDto = z.infer<typeof discardReasonKindDtoSchema>;

export const discardGroupDtoSchema = z.object({
	reason: discardReasonKindDtoSchema,
	count: z.int().min(1),
	/** titles only, capped — enough to judge the cut, not a second list to read */
	examples: z.array(z.string()).max(5),
});

export const reviewSummaryDtoSchema = z.object({
	discardedTotal: z.int().min(0),
	discarded: z.array(discardGroupDtoSchema),
	/** findings whose anchor named nothing placeable in this diff */
	skippedAnchors: z.int().min(0),
});

export type ReviewSummaryDto = z.infer<typeof reviewSummaryDtoSchema>;
export type DiscardGroupDto = z.infer<typeof discardGroupDtoSchema>;
