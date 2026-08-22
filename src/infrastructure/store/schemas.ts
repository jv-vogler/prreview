import { z } from "zod";
import { reviewPassSchema } from "../../application/review/reviewSchema";

const commentEditSchema = z.object({
	body: z.string().optional(),
	deleted: z.boolean().optional(),
});

const publishedRecordSchema = z.object({
	reviewId: z.number(),
	htmlUrl: z.string(),
	publishedAt: z.string(),
	commentIds: z.array(z.string()),
});

/** what a stored `review.json` must look like to be trusted back off disk */
export const storedReviewSchema = z.object({
	changesetId: z.string(),
	createdAt: z.string(),
	pass: reviewPassSchema,
	residue: z.array(z.string()),
	// defaulted so a review.json written before TASK-046 still loads
	commentEdits: z.record(z.string(), commentEditSchema).default({}),
	// defaulted so a review.json written before TASK-050 still loads
	published: publishedRecordSchema.nullable().default(null),
});
