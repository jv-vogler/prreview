import { z } from "zod";
import { storedReviewPassSchema } from "../../application/review/reviewSchema";

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
	// the pass's own length budgets are not applied here: they gate what the
	// engine may write, and re-applying them on read makes tightening one
	// retroactively corrupt every session already on disk
	pass: storedReviewPassSchema,
	residue: z.array(z.string()),
	// defaulted so a review.json written before TASK-046 still loads
	commentEdits: z.record(z.string(), commentEditSchema).default({}),
	// defaulted so a review.json written before TASK-050 still loads
	published: publishedRecordSchema.nullable().default(null),
});
