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

const checkpointSchema = z.object({
	baseSha: z.string(),
	headSha: z.string().nullable(),
	files: z.array(
		z.object({
			path: z.string(),
			oldOid: z.string().nullable(),
			newOid: z.string().nullable(),
		}),
	),
});

/** what a stored `review.json` must look like to be trusted back off disk */
export const storedReviewSchema = z.object({
	changesetId: z.string(),
	createdAt: z.string(),
	// defaulted so a review.json written before the field still loads;
	// null also means "worktree — no commit to name"
	headSha: z.string().nullable().default(null),
	// the pass's own length budgets are not applied here: they gate what the
	// engine may write, and re-applying them on read makes tightening one
	// retroactively corrupt every session already on disk
	pass: storedReviewPassSchema,
	residue: z.array(z.string()),
	// defaulted so a review.json written before TASK-046 still loads
	commentEdits: z.record(z.string(), commentEditSchema).default({}),
	// both absent on a pass written before ids became data: its findings are
	// named by position, which is exactly the ids the first pass minted
	findingIds: z.array(z.string()).optional(),
	nextFindingId: z.int().min(0).optional(),
	// absent on a pass whose findings were all looked at in the run that
	// wrote it, which is every pass written before delta re-reviews
	carriedFindingIds: z.array(z.string()).optional(),
	// absent on a pass written before checkpoints: a re-review over one of
	// those re-reads everything, exactly as it always did
	checkpoint: checkpointSchema.optional(),
	// defaulted so a review.json written before TASK-050 still loads
	published: publishedRecordSchema.nullable().default(null),
});
